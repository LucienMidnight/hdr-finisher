function normalizeHighlightCompressionControls(changedPath) {
  const hdr = state.adjustments.hdr;
  if (hdr.highlight_compression_target_nits <= hdr.highlight_compression_start_nits) {
    if (changedPath.endsWith("start_nits")) {
      hdr.highlight_compression_target_nits = Math.min(10000, hdr.highlight_compression_start_nits + 1);
    } else {
      hdr.highlight_compression_start_nits = Math.max(1, hdr.highlight_compression_target_nits - 1);
    }
  }
  for (const path of ["hdr.highlight_compression_start_nits", "hdr.highlight_compression_target_nits"]) {
    syncRangeControlFromState(path);
  }
  if (changedPath.endsWith("peak_measurement") || changedPath.endsWith("manual_peak_nits") || changedPath.endsWith("color_handling")) {
    syncHighlightCompressionSourcePeak();
  }
}

function syncHighlightCompressionSourcePeak() {
  const hdr = state.adjustments.hdr;
  if (!hdr) return;
  if (hdr.highlight_compression_peak_measurement === "manual") {
    hdr.highlight_compression_source_peak_nits = Number(hdr.highlight_compression_manual_peak_nits) || 1000;
    return;
  }
  const analysis = state.session?.analysis;
  const colorHandling = hdr.highlight_compression_color_handling || "smooth_rolloff";
  let linear;
  if (colorHandling === "smooth_rolloff") {
    linear = hdr.highlight_compression_peak_measurement === "robust"
      ? (analysis?.robust_peak_bt2020_linear ?? analysis?.peak_bt2020_linear ?? analysis?.robust_peak_linear ?? analysis?.peak_linear)
      : (analysis?.peak_bt2020_linear ?? analysis?.peak_linear);
  } else if (colorHandling === "path_to_white") {
    linear = hdr.highlight_compression_peak_measurement === "robust"
      ? (analysis?.robust_peak_linear ?? analysis?.peak_linear)
      : analysis?.peak_linear;
  } else {
    linear = hdr.highlight_compression_peak_measurement === "robust"
      ? (analysis?.robust_peak_luma_linear ?? analysis?.peak_luma_linear ?? analysis?.peak_linear)
      : (analysis?.peak_luma_linear ?? analysis?.peak_linear);
  }
  if (Number.isFinite(Number(linear))) {
    hdr.highlight_compression_source_peak_nits = Math.max(1, Number(linear) * projectReferenceWhiteNits() / 0.18);
  }
}

function toneAdjustedHighlightPeakNits(hdr) {
  const referenceWhite = projectReferenceWhiteNits();
  let peakLinear = Math.max(1, Number(hdr.highlight_compression_source_peak_nits) || 1000) * 0.18 / referenceWhite;
  if (hdr.tone_section_enabled === false) return Math.max(1, peakLinear * referenceWhite / 0.18);
  peakLinear *= 2 ** (Number(hdr.exposure) || 0);
  const shadowLift = Number(hdr.shadow_lift) || 0;
  if (shadowLift !== 0) {
    const liftFactor = clamp(shadowLift * (1 - clamp(peakLinear, 0, 1)), Number.NEGATIVE_INFINITY, 1);
    peakLinear *= 1 + liftFactor;
  }
  const contrast = Number(hdr.contrast) || 0;
  if (contrast !== 0 && peakLinear > 0.00000001) {
    const pivot = Math.max(Number(hdr.contrast_pivot) || 0.1845, 0.000001);
    const stops = Math.log2(Math.max(peakLinear, 0.00000001) / pivot);
    peakLinear = pivot * (2 ** clamp(stops * (2 ** contrast), -32, 32));
  }
  return Math.max(1, peakLinear * referenceWhite / 0.18);
}

function peakFitCurveInfo(hdr) {
  const start = Math.max(1, Number(hdr.highlight_compression_start_nits) || 400);
  const target = Math.max(start + 1, Number(hdr.highlight_compression_target_nits) || 1000);
  const peak = Math.max(target, toneAdjustedHighlightPeakNits(hdr));
  const startStop = Math.log2(start);
  const targetStop = Math.log2(target);
  const peakStop = Math.log2(peak);
  const detail = clamp((Number(hdr.highlight_compression_peak_detail) || 0) / 100, 0, 1);
  const bias = clamp((Number(hdr.highlight_compression_bias) || 0) / 100, -1, 1) * 0.6;
  const requiredRatio = clamp((1 / (1 + bias) + detail / (1 - bias)) / 3, 0.001, 0.95);
  const requestedRatio = (targetStop - startStop) / Math.max(peakStop - startStop, 0.000001);
  const effectiveStartStop = requestedRatio < requiredRatio
    ? (targetStop - requiredRatio * peakStop) / (1 - requiredRatio)
    : startStop;
  return { start, target, peak, startStop, targetStop, peakStop, detail, bias, effectiveStartStop };
}

function mapHighlightNits(inputNits, hdr) {
  const mode = hdr.highlight_compression_mode || "peak_fit";
  if (mode === "off") return inputNits;
  if (mode === "clip") return Math.min(inputNits, Number(hdr.highlight_compression_target_nits) || 1000);
  if (mode === "soft_ceiling") {
    const softness = Number(hdr.highlight_compression_softness) || 0;
    if (softness <= 0) return inputNits;
    const start = Number(hdr.highlight_compression_start_nits) || 400;
    const target = Math.max(start + 1, Number(hdr.highlight_compression_target_nits) || 1000);
    if (inputNits <= start) return inputNits;
    const normalized = (inputNits - start) / (target - start);
    const exponent = 2 ** (5 * (1 - clamp(softness / 100, 0, 1)));
    const compressed = normalized <= 1
      ? normalized / ((1 + normalized ** exponent) ** (1 / exponent))
      : 1 / ((1 + (1 / normalized) ** exponent) ** (1 / exponent));
    const position = clamp(softness / 10, 0, 1);
    const activation = position * position * (3 - 2 * position);
    return start + ((inputNits - start) + activation * ((target - start) * compressed - (inputNits - start)));
  }
  const info = peakFitCurveInfo(hdr);
  if (inputNits <= 2 ** info.effectiveStartStop) return inputNits;
  const u = clamp((Math.log2(inputNits) - info.effectiveStartStop) / Math.max(info.peakStop - info.effectiveStartStop, 0.000001), 0, 1);
  const w = clamp(u + info.bias * u * (1 - u), 0, 1);
  const span = info.targetStop - info.effectiveStartStop;
  const m0 = (info.peakStop - info.effectiveStartStop) / Math.max(span * (1 + info.bias), 0.000001);
  const m1 = info.detail * (info.peakStop - info.effectiveStartStop) / Math.max(span * (1 - info.bias), 0.000001);
  const mapped = w * (1 - w) * (1 - w) * m0 + w * w * (3 - 2 * w) + w * w * (w - 1) * m1;
  return 2 ** (info.effectiveStartStop + span * mapped);
}

function renderHighlightCompressionControls() {
  const hdr = state.adjustments.hdr;
  if (!hdr || !els.highlightCompressionGraph) return;
  syncHighlightCompressionSourcePeak();
  const mode = hdr.highlight_compression_mode || "peak_fit";
  document.querySelector('[data-control-path="hdr.highlight_compression_start_nits"]')?.toggleAttribute("hidden", mode === "clip");
  document.querySelector('[data-control-path="hdr.highlight_compression_softness"]')?.toggleAttribute("hidden", mode !== "soft_ceiling");
  document.querySelector('[data-control-path="hdr.highlight_compression_peak_detail"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="hdr.highlight_compression_color_handling"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="hdr.highlight_compression_peak_measurement"]')?.toggleAttribute("hidden", mode === "clip");
  document.querySelector('[data-control-path="hdr.highlight_compression_bias"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="hdr.highlight_compression_manual_peak_nits"]')?.toggleAttribute("hidden", hdr.highlight_compression_peak_measurement !== "manual");

  const canvas = els.highlightCompressionGraph;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 35, right: 9, top: 9, bottom: 24 };
  const sourcePeak = Math.max(1000, mode === "peak_fit"
    ? toneAdjustedHighlightPeakNits(hdr)
    : (Number(hdr.highlight_compression_source_peak_nits) || 1000) * (2 ** (Number(hdr.exposure) || 0)));
  const maximum = Math.max(10000, sourcePeak, Number(hdr.highlight_compression_target_nits) * 1.5);
  const minimum = 10;
  const xFor = (value) => pad.left + (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (width - pad.left - pad.right);
  const yFor = (value) => height - pad.bottom - (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (height - pad.top - pad.bottom);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#343d41";
  context.fillStyle = "#93a0a4";
  context.font = "9px monospace";
  for (const tick of [10, 100, 1000, 10000, 100000]) {
    if (tick > maximum) continue;
    context.beginPath();
    context.moveTo(xFor(tick), pad.top);
    context.lineTo(xFor(tick), height - pad.bottom);
    context.moveTo(pad.left, yFor(tick));
    context.lineTo(width - pad.right, yFor(tick));
    context.stroke();
    context.fillText(tick >= 1000 ? `${tick / 1000}k` : String(tick), xFor(tick) - 6, height - 8);
  }
  context.setLineDash([4, 3]);
  context.strokeStyle = "#6d777b";
  context.beginPath(); context.moveTo(xFor(minimum), yFor(minimum)); context.lineTo(xFor(maximum), yFor(maximum)); context.stroke();
  context.setLineDash([]);
  context.strokeStyle = "#68d7ed";
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index <= 160; index += 1) {
    const input = minimum * ((maximum / minimum) ** (index / 160));
    const x = xFor(input);
    const y = yFor(mapHighlightNits(input, hdr));
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  context.lineWidth = 1;
  if (mode === "off") {
    els.highlightCompressionSummary.dataset.tooltip = "Compression is off. The ultraviolet identity line leaves highlights unchanged.";
  } else if (mode === "clip") {
    els.highlightCompressionSummary.dataset.tooltip = `Clip applies a hard final-output ceiling at ${Math.round(hdr.highlight_compression_target_nits)} nit.`;
  } else if (mode === "soft_ceiling") {
    els.highlightCompressionSummary.dataset.tooltip = `Soft Ceiling approaches ${Math.round(hdr.highlight_compression_target_nits)} nit without a hard peak anchor.`;
  } else {
    const info = peakFitCurveInfo(hdr);
    const effective = 2 ** info.effectiveStartStop;
    const adjusted = effective < Number(hdr.highlight_compression_start_nits) * 0.99;
    const colorNote = hdr.highlight_compression_color_handling === "path_to_white"
      ? "; RGB channels are grouped and converge to neutral white"
      : hdr.highlight_compression_color_handling === "preserve_color"
        ? "; color ratios are preserved"
        : "; Rec.2020 channels roll off smoothly toward white";
    els.highlightCompressionSummary.dataset.tooltip = `Peak Fit anchors the measured final-grade peak near ${Math.round(info.target)} nit${adjusted ? `; the curve fit widens the shoulder to ${Math.round(effective)} nit` : ""}${colorNote}.`;
  }
}

function normalizeSdrHighlightCompressionControls(changedPath) {
  const sdr = state.adjustments.sdr;
  if (!sdr) return;
  if (changedPath.endsWith("peak_measurement") || changedPath.endsWith("manual_peak_percent") || changedPath.endsWith("color_handling")) {
    syncSdrHighlightCompressionSourcePeak();
  }
}

function syncSdrHighlightCompressionSourcePeak() {
  const sdr = state.adjustments.sdr;
  if (!sdr) return;
  if (sdr.highlight_compression_peak_measurement === "manual") {
    sdr.highlight_compression_source_peak_percent = Number(sdr.highlight_compression_manual_peak_percent) || 100;
    return;
  }
  const authored = state.editDocument?.source?.luminance?.sdr_rendition === "authored" && sdr.use_authored_base !== false;
  const analysis = state.session?.analysis;
  let linear = sdr.highlight_compression_peak_measurement === "robust"
    ? (analysis?.robust_peak_linear ?? analysis?.peak_linear)
    : analysis?.peak_linear;
  let percent = authored ? 100 : Number(linear) * (100 / 203) / 0.18 * 100;
  if (Number.isFinite(percent)) {
    sdr.highlight_compression_source_peak_percent = Math.max(1, percent);
  }
}

function sdrHighlightCurveAdapter(sdr) {
  return {
    tone_section_enabled: false,
    highlight_compression_mode: sdr.highlight_compression_mode,
    highlight_compression_start_nits: Number(sdr.highlight_compression_start_percent) || 50,
    highlight_compression_target_nits: 100,
    highlight_compression_softness: sdr.highlight_compression_softness,
    highlight_compression_source_peak_nits: (Number(sdr.highlight_compression_source_peak_percent) || 100)
      * (sdr.tone_section_enabled === false ? 1 : 2 ** (Number(sdr.exposure) || 0)),
    highlight_compression_peak_detail: sdr.highlight_compression_peak_detail,
    highlight_compression_bias: sdr.highlight_compression_bias,
  };
}

function renderSdrHighlightCompressionControls() {
  const sdr = state.adjustments.sdr;
  const canvas = els.sdrHighlightCompressionGraph;
  if (!sdr || !canvas) return;
  syncSdrHighlightCompressionSourcePeak();
  const mode = sdr.highlight_compression_mode || "peak_fit";
  document.querySelector('[data-control-path="sdr.highlight_compression_start_percent"]')?.toggleAttribute("hidden", mode === "clip");
  document.querySelector('[data-control-path="sdr.highlight_compression_softness"]')?.toggleAttribute("hidden", mode !== "soft_ceiling");
  document.querySelector('[data-control-path="sdr.highlight_compression_peak_detail"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="sdr.highlight_compression_color_handling"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="sdr.highlight_compression_manual_peak_percent"]')?.toggleAttribute("hidden", sdr.highlight_compression_peak_measurement !== "manual");

  const curve = sdrHighlightCurveAdapter(sdr);
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 35, right: 9, top: 9, bottom: 24 };
  const sourcePeak = Math.max(100, Number(curve.highlight_compression_source_peak_nits) || 100);
  const maximum = Math.max(1000, sourcePeak * 1.25);
  const minimum = 1;
  const xFor = (value) => pad.left + (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (width - pad.left - pad.right);
  const yFor = (value) => height - pad.bottom - (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (height - pad.top - pad.bottom);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#343d41";
  context.fillStyle = "#93a0a4";
  context.font = "9px monospace";
  for (const tick of [1, 10, 100, 1000, 10000, 100000]) {
    if (tick > maximum) continue;
    context.beginPath();
    context.moveTo(xFor(tick), pad.top); context.lineTo(xFor(tick), height - pad.bottom);
    context.moveTo(pad.left, yFor(tick)); context.lineTo(width - pad.right, yFor(tick)); context.stroke();
    context.fillText(tick >= 1000 ? `${tick / 1000}k%` : `${tick}%`, xFor(tick) - 7, height - 8);
  }
  context.setLineDash([4, 3]);
  context.strokeStyle = "#6d777b";
  context.beginPath(); context.moveTo(xFor(minimum), yFor(minimum)); context.lineTo(xFor(maximum), yFor(maximum)); context.stroke();
  context.setLineDash([]);
  context.strokeStyle = "#68d7ed";
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index <= 160; index += 1) {
    const input = minimum * ((maximum / minimum) ** (index / 160));
    const x = xFor(input);
    const y = yFor(mapHighlightNits(input, curve));
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke(); context.lineWidth = 1;
  if (els.sdrHighlightCompressionSummary) {
    const colorNote = sdr.highlight_compression_color_handling === "path_to_white"
      ? " Brightest highlights converge to neutral white."
      : sdr.highlight_compression_color_handling === "preserve_color"
        ? " Color ratios are preserved."
        : " sRGB channels roll off independently for smooth color transitions.";
    els.sdrHighlightCompressionSummary.dataset.tooltip = mode === "clip"
      ? "Clip applies a hard ceiling at display white."
      : mode === "soft_ceiling"
        ? "Soft Ceiling approaches display white without a measured peak anchor."
        : `Peak Fit places the measured ${Math.round(sourcePeak)}% input peak at display white.${colorNote}`;
  }
}

