(function () {
  const model = window.HDRTonePreviewModel;
  let hovered = null;
  let dragging = null;
  let clipping = false;
  let frame = 0;
  let engine = null;
  let failed = false;
  let identity = "";
  let serial = null;
  let baselinePending = false;
  let baselineSerial = null;
  let key = null;
  let chart = null;
  let caption = null;
  let overlay = null;
  let lastChart = "";
  let proxyFlight = false;
  let proxyGeneration = null;
  let paletteSignature = "";
  let palette = null;
  const metrics = { frames: [], resources: null };

  function target(element) {
    if (!(element instanceof Element)) return null;
    const row = element.closest(".control-row");
    const input = element.matches("input[type=range]") ? element : row?.querySelector("input[type=range]");
    const local = input?.dataset.localGrade;
    const match = model.control(local || input?.dataset.path);
    return match && !input.disabled ? { ...match, input, local: Boolean(local), lane: match.lane || state.currentView } : null;
  }

  function selection() {
    const selected = dragging || hovered;
    if (!selected || state.activeWorkflow !== "grade" || !state.session || selected.lane !== state.currentView
      || !selected.input.isConnected || !selected.input.getClientRects().length
      || geometryDraftActive() || state.comparePeekActive || denoiseNoiseViewActive(selected.lane)) return null;
    const local = selected.local ? selectedLocal() : null;
    if (selected.local && !local) return null;
    const global = state.adjustments[selected.lane];
    const branch = selected.local ? { ...local[`${selected.lane}_grade`], highlight_compression_target_nits: global.highlight_compression_target_nits } : global;
    const bypassed = selected.local && (local.enabled === false || localsBypassed());
    return { ...selected, branch: bypassed ? { ...branch, tone_section_enabled: false } : branch, localId: local?.id, opacity: selected.local ? local.opacity ?? 1 : 1 };
  }

  function surfaces() {
    if (key) return;
    key = document.createElement("div");
    key.id = "tone-preview-key";
    key.className = "tone-preview-key hidden";
    key.setAttribute("role", "status");
    caption = document.createElement("span");
    chart = document.createElement("canvas");
    chart.setAttribute("aria-label", "Effective pre-look Tone range on a neutral ray, in stops from photographic mid-grey");
    key.append(caption, chart);
    els.previewPrimaryPane.append(key);
    overlay = document.createElement("canvas");
    overlay.id = "tone-clipping-overlay";
    overlay.className = "tone-clipping-overlay hidden";
    overlay.setAttribute("aria-hidden", "true");
    els.previewPrimaryPane.append(overlay);
  }

  function range(selected, luminance, maximum = luminance) {
    const result = model.influence(selected.branch, selected.lane === "hdr", selected.zone, luminance, maximum, projectReferenceWhiteNits());
    return { ...result, weight: result.weight * selected.opacity };
  }

  function drawChart(selected) {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(chart.clientWidth));
    const height = Math.max(1, Math.round(chart.clientHeight));
    chart.width = width * ratio;
    chart.height = height * ratio;
    const context = chart.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const grey = selected.lane === "hdr" ? 0.0324 : 0.18 * 100 / 203;
    const plotHeight = height - 18;
    context.strokeStyle = uiToken("--scope-guide-line-labeled");
    context.beginPath(); context.moveTo(0, plotHeight); context.lineTo(width, plotHeight); context.stroke();
    context.strokeStyle = uiToken("--accent-strong");
    context.beginPath();
    for (let index = 0; index <= width; index++) {
      const weight = range(selected, grey * 2 ** (-10 + 18 * index / width)).weight;
      const vertical = plotHeight - weight * (plotHeight - 2);
      if (index) context.lineTo(index, vertical); else context.moveTo(index, vertical);
    }
    context.stroke();
    context.font = HDRAppearance.font("min");
    context.fillStyle = uiToken("--muted");
    context.textBaseline = "bottom";
    for (const stop of [-10, -5, 0, 5, 8]) {
      const horizontal = (stop + 10) / 18 * width;
      context.textAlign = stop === -10 ? "left" : stop === 8 ? "right" : "center";
      context.fillText(`${stop > 0 ? "+" : ""}${stop}${stop === 0 ? " grey" : ""}`, horizontal, height);
    }
  }

  function place() {
    const preview = activePreviewElement();
    const bounds = preview.getBoundingClientRect();
    const pane = els.previewPrimaryPane.getBoundingClientRect();
    Object.assign(overlay.style, { left: `${bounds.left - pane.left}px`, top: `${bounds.top - pane.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  }

  function releaseGpu() {
    engine?.destroy(); engine = null;
    serial = null; identity = "";
  }

  function hide() {
    const wasVisible = key && !key.classList.contains("hidden");
    key?.classList.add("hidden");
    overlay?.classList.add("hidden");
    if (engine) releaseGpu();
    lastChart = "";
    if (wasVisible) drawHistogram(state.lastScope || []);
  }

  function colors() {
    const tokens = ["--scope-red", "--scope-green", "--scope-blue", "--scope-luma", "--accent-strong", "--attention"].map(token => uiToken(token));
    const signature = JSON.stringify(tokens);
    if (signature === paletteSignature) return palette;
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    palette = tokens.map(color => {
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      return [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel / 255);
    });
    paletteSignature = signature;
    return palette;
  }

  function displayLimit() {
    const displays = state.displayTelemetry?.displays || [];
    const display = displays.find(item => item.primary) || displays[0];
    return model.displayPeak(display, projectReferenceWhiteNits());
  }

  function warm(selected) {
    const renderer = state.gpuPreview;
    if (!renderer?.available || failed) return;
    const nextIdentity = JSON.stringify([state.session.session_id, selected.lane, geometrySignature(), selected.localId, selected.zone]);
    if (nextIdentity !== identity) { releaseGpu(); identity = nextIdentity; }
    if (!engine) {
      engine = new window.HDRTonePreviewGpu(renderer, overlay);
      const candidate = engine;
      void candidate.ready.catch(error => {
        if (engine !== candidate) return;
        console.warn("Tone clipping preview unavailable", error);
        failed = true; releaseGpu();
      });
    }
  }

  async function tiledSource(renderer, accepted, selected) {
    const source = renderer.scopeSources.get(renderer.scopeAnalysisCanvas);
    if (source?.applicationGeneration === accepted.generation && source.sessionId === state.session.session_id
      && source.lane === selected.lane && source.geometrySignature === geometrySignature()) return source;
    if (proxyFlight || proxyGeneration === accepted.generation || state.previewScheduler?.frameInFlight || renderer.activeRenderCount > 0) return null;
    proxyFlight = true;
    proxyGeneration = accepted.generation;
    const sessionId = state.session.session_id;
    const isCurrent = () => clipping && state.session?.session_id === sessionId
      && state.currentView === selected.lane && state.acceptedPresentation?.generation === accepted.generation;
    try {
      await renderer.renderScopeProxy(sessionId, selected.lane, state.adjustments, sampleCurvePoints,
        640, localsBypassed() ? [] : localAdjustments(), state.editRevision, projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        { applicationGeneration: accepted.generation, isCurrent });
      return isCurrent() ? renderer.scopeSources.get(renderer.scopeAnalysisCanvas) : null;
    } finally { proxyFlight = false; }
  }

  async function paintClipping(selected) {
    const renderer = state.gpuPreview;
    const accepted = state.acceptedPresentation;
    const source = accepted?.execution === "tiled" && renderer?.available
      ? await tiledSource(renderer, accepted, selected) : renderer?.scopeSources?.get(els.previewCanvas);
    if (!renderer?.available || accepted?.transport !== "WebGPU" || els.previewCanvas.style.display === "none"
      || !source || source.sessionId !== state.session.session_id
      || source.lane !== selected.lane || (accepted.execution !== "tiled" && source.serial !== accepted.sourceSerial)
      || source.applicationGeneration !== accepted.generation || source.geometrySignature !== geometrySignature()
      || renderer.activeRenderCount > 0) {
      overlay.classList.add("hidden");
      return "Clipping preview updating from the GPU; range remains available.";
    }
    if (!clipping || selection()?.input !== selected.input) return "";
    warm(selected);
    if (!engine || failed) return "Clipping preview unavailable; range remains available.";
    if (!engine.clippingPipeline) return "Preparing clipping preview…";
    if (baselinePending) {
      if (source.serial === baselineSerial) engine.draw(source, { black: selected.zone === "blacks", baseline: true, colors: colors(), referenceWhite: projectReferenceWhiteNits() });
      else engine.hasBaseline = false;
      baselinePending = false;
      serial = null;
    }
    if (serial !== source.serial) {
      const started = performance.now();
      metrics.resources = engine.draw(source, { black: selected.zone === "blacks", colors: colors(), displayPeak: displayLimit(), referenceWhite: projectReferenceWhiteNits() });
      serial = source.serial;
      overlay.dataset.sourceSerial = String(serial);
      overlay.dataset.generation = String(accepted.generation);
      const metric = { submitMs: performance.now() - started, completeMs: null };
      metrics.frames.push(metric);
      if (metrics.frames.length > 120) metrics.frames.shift();
      void renderer.device.queue.onSubmittedWorkDone().then(() => { metric.completeMs = performance.now() - started; }).catch(() => {});
    }
    place();
    overlay.classList.remove("hidden");
    return selected.lane === "hdr"
      ? `Finished, post-cap · RGB: cap-clipped; dashed RGB: new endpoint; pale dots: touch only · accent: >100 nit SDR white · warning: >primary display${displayLimit() ? "" : " (unknown)"} · pale: HC target guide ${selected.branch.highlight_compression_target_nits ?? 1000} nit`
      : "Finished, post-cap · RGB: cap-clipped; dashed RGB: new endpoint; pale dots: touch only · multiple channels alternate";
  }

  let painting = false;
  function tick() {
    frame = 0;
    const selected = selection();
    if (!selected) { hide(); return; }
    surfaces();
    key.classList.remove("hidden");
    const signature = JSON.stringify([selected.zone, selected.branch, selected.opacity, projectReferenceWhiteNits(), clipping, key.clientWidth, uiToken("--accent-strong")]);
    if (signature !== lastChart) { drawChart(selected); lastChart = signature; drawHistogram(state.lastScope || []); }
    const limiter = range(selected, 0).limiter;
    const name = selected.zone[0].toUpperCase() + selected.zone.slice(1);
    const explanation = `${name} · Pre-look neutral-ray range${selected.local ? " before spatial mask" : ""} · limiter ${Math.round(limiter * 100)}%${selected.local ? ` · opacity ${Math.round(selected.opacity * 100)}%` : ""}`;
    if (clipping && !painting) {
      painting = true;
      void paintClipping(selected).then(message => { if (clipping && selection()) caption.textContent = `${explanation}\n${message}`; }).catch(error => {
        console.warn("Tone clipping preview unavailable", error);
        failed = true; releaseGpu(); overlay.classList.add("hidden");
        caption.textContent = `${explanation}\nClipping preview unavailable; range remains available.`;
      }).finally(() => { painting = false; });
    } else if (!clipping) {
      caption.textContent = `${explanation} · Alt/Option-drag Blacks or Whites for clipping`;
      overlay.classList.add("hidden");
      if (["blacks", "whites"].includes(selected.zone) && selected.dimension === "amount") warm(selected);
      else if (engine) releaseGpu();
    }
    frame = requestAnimationFrame(tick);
  }

  function wake() { if (!frame) frame = requestAnimationFrame(tick); }
  function end() { dragging = null; clipping = false; baselinePending = false; if (!hovered) hide(); wake(); }
  document.addEventListener("pointerover", event => { if (dragging) return; hovered = target(event.target); wake(); }, true);
  document.addEventListener("pointerout", event => { if (!dragging) hovered = target(event.relatedTarget); wake(); }, true);
  document.addEventListener("focusin", event => { hovered = target(event.target); wake(); }, true);
  document.addEventListener("focusout", event => { if (!dragging) hovered = target(event.relatedTarget); wake(); }, true);
  document.addEventListener("pointerdown", event => {
    const selected = target(event.target);
    if (event.button !== 0 || !selected) return;
    dragging = selected;
    clipping = event.altKey && ["blacks", "whites"].includes(selected.zone) && selected.dimension === "amount";
    baselinePending = clipping;
    failed = false;
    baselineSerial = state.gpuPreview?.scopeSources?.get(els.previewCanvas)?.serial ?? null;
    if (clipping) { surfaces(); void paintClipping(selection() || selected).catch(() => {}); }
    wake();
  }, true);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) document.addEventListener(type, end, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { hovered = null; end(); }
    if (event.key === "Alt" && dragging && ["blacks", "whites"].includes(dragging.zone) && dragging.dimension === "amount") {
      clipping = true; baselinePending = true;
      baselineSerial = state.gpuPreview?.scopeSources?.get(els.previewCanvas)?.serial ?? null;
      wake();
    }
  }, true);
  document.addEventListener("keyup", event => { if (event.key === "Alt") { clipping = false; overlay?.classList.add("hidden"); wake(); } }, true);
  window.addEventListener("blur", () => { hovered = null; end(); });
  window.addEventListener("hdrfinisher:workflowchange", () => { hovered = null; end(); });

  function tooltips() {
    for (const input of document.querySelectorAll("input[data-path], input[data-local-grade]")) {
      const selected = model.control(input.dataset.localGrade || input.dataset.path);
      if (!selected) continue;
      const label = input.closest(".control-row")?.querySelector("label");
      if (!label || label.dataset.tonePreviewTip) continue;
      label.dataset.tonePreviewTip = "true";
      const gesture = ["blacks", "whites"].includes(selected.zone) && selected.dimension === "amount"
        ? " Alt/Option-drag to inspect finished clipping. Pale dots mean endpoint only; RGB marks lost channels; dashed RGB marks channels newly reaching an endpoint."
        : "";
      label.dataset.tooltip = `${label.dataset.tooltip || ""} Hover or drag to see the effective, endpoint-protected range and limiter.${gesture}`.trim();
      label.classList.add("tooltip-trigger");
    }
  }
  tooltips();
  const observer = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node instanceof Element
      && (node.matches("input[data-path], input[data-local-grade]") || node.querySelector("input[data-path], input[data-local-grade]"))))) tooltips();
  });
  observer.observe(document.getElementById("control-panel") || document.body, { childList: true, subtree: true });

  window.HDRTonePreview = Object.freeze({ selection, range, metrics, end, drawScope(context, scope, waveform, left, top, width, height) {
    const selected = selection();
    if (!selected || selected.lane !== scope.preview_kind) return;
    context.save();
    context.strokeStyle = uiToken("--accent-strong");
    context.beginPath();
    for (let index = 0; index <= 256; index++) {
      const position = index / 256;
      const value = selected.lane === "hdr" ? 10 ** (position * Math.log10(scopeUi.hdrCeiling(scope))) : position;
      const luminance = selected.lane === "hdr" ? value * 0.18 / projectReferenceWhiteNits()
        : value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      const weight = range(selected, luminance).weight;
      const horizontal = waveform ? left + weight * width : left + position * width;
      const vertical = waveform ? top + (1 - position) * height : top + (1 - weight) * height;
      if (index) context.lineTo(horizontal, vertical); else context.moveTo(horizontal, vertical);
    }
    context.stroke(); context.restore();
  } });
})();
