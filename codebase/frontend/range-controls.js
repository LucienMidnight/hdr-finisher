function enhanceRangeControls() {
  document.querySelectorAll('input[type="range"]').forEach(enhanceRangeControl);
}

function pointerAdjustmentScale(event) {
  return event?.ctrlKey ? FINE_ADJUSTMENT_SCALE : 1;
}

function fineRangeStep(step) {
  return Math.round(Number(step) * FINE_ADJUSTMENT_SCALE * 1e12) / 1e12;
}

function createPrecisionPointerDelta(event) {
  let previousX = event.clientX;
  let previousY = event.clientY;
  let deltaX = 0;
  let deltaY = 0;
  let minimumScale = pointerAdjustmentScale(event);
  return {
    update(nextEvent) {
      const scale = pointerAdjustmentScale(nextEvent);
      minimumScale = Math.min(minimumScale, scale);
      deltaX += (nextEvent.clientX - previousX) * scale;
      deltaY += (nextEvent.clientY - previousY) * scale;
      previousX = nextEvent.clientX;
      previousY = nextEvent.clientY;
      return { x: deltaX, y: deltaY, minimumScale };
    },
  };
}

function enhanceRangeControl(control) {
  if (!control || control.closest(".range-shell")) return;
  const shell = document.createElement("span");
  shell.className = "range-shell";
  const track = document.createElement("span");
  track.className = "slider-track";
  const fill = document.createElement("span");
  fill.className = "slider-fill";
  control.before(shell);
  shell.append(track, fill, control);
  const declaredStep = Number(control.step);
  if (Number.isFinite(declaredStep) && declaredStep > 0) {
    control.dataset.instrumentStep = String(declaredStep);
    control.step = String(fineRangeStep(declaredStep));
  }
  updateRangeVisual(control);
  control.addEventListener("input", () => updateRangeVisual(control));
  bindInstrumentRangePointer(control, shell);
}

function enhanceEditableGradeValues() {
  els.valueOutputs.forEach((output) => {
    const path = output.dataset.valuePath;
    const resolvedPath = resolveAdjustmentPath(path);
    const rulePath = MANUAL_VALUE_RULES[path] ? path : resolvedPath;
    const rule = MANUAL_VALUE_RULES[rulePath];
    if (!rule || !output.closest("#grade-workflow-panel")) return;
    bindEditableValue(output, {
      getValue: () => getValueByPath(state.adjustments, path),
      normalize: (text) => normalizeManualControlValue(rulePath, text),
      commit: ({ value }) => commitAdjustmentValue(path, value, { manual: true }),
      label: () => `${output.closest(".control-heading")?.querySelector("label")?.textContent?.trim() || path} value`,
      range: () => manualRangeLabel(path, rule),
    });
  });

  for (const lane of ["hdr", "sdr"]) {
    const ui = toneEqualizerUi(lane);
    bindEditableValue(ui.bandOutput, {
      getValue: () => currentToneEqualizerNodes(lane)[state.selectedToneEqualizerBand]?.adjustment_ev ?? 0,
      normalize: (text) => normalizeManualNumber(text, {
        min: toneEqualizerBandLimits(state.selectedToneEqualizerBand, currentToneEqualizerNodes(lane))[0],
        max: toneEqualizerBandLimits(state.selectedToneEqualizerBand, currentToneEqualizerNodes(lane))[1],
        decimals: 2,
      }),
      commit: ({ value }) => setToneEqualizerBand(state.selectedToneEqualizerBand, value, lane),
      label: () => `Selected ${lane.toUpperCase()} Exposure Band adjustment`,
      range: () => {
        const [minimum, maximum] = toneEqualizerBandLimits(state.selectedToneEqualizerBand, currentToneEqualizerNodes(lane));
        return `${formatSignedEv(minimum, 2)} to ${formatSignedEv(maximum, 2)}`;
      },
    });

    bindEditableValue(ui.radius, {
      getValue: () => state.adjustments[lane].tone_equalizer_influence_radius,
      normalize: (text) => normalizeManualNumber(text, { min: 0.25, max: 12, decimals: 2 }),
      commit: ({ value }) => {
        state.adjustments[lane].tone_equalizer_influence_radius = value;
        syncToneEqualizerControls(lane);
        drawToneEqualizerEditor(lane);
        renderControlState();
      },
      label: () => `${lane.toUpperCase()} Exposure Band influence`,
      range: () => "0.25 EV to 12.00 EV",
    });
  }
}

function bindEditableValue(element, { getValue, normalize, commit, label, range }) {
  if (!element) return;
  element.classList.add("editable-value");
  element.tabIndex = 0;

  const refreshAccessibility = () => {
    const rangeText = range();
    element.title = `Double-click or press Enter to type a value. Manual range: ${rangeText}.`;
    element.setAttribute("aria-label", `${label()}. Press Enter to edit. Manual range ${rangeText}.`);
  };
  refreshAccessibility();

  let editing = false;
  let previousText = "";
  const finish = () => {
    editing = false;
    element.dataset.editing = "false";
    element.removeAttribute("contenteditable");
    element.removeAttribute("role");
    refreshAccessibility();
  };
  const cancel = () => {
    if (!editing) return;
    finish();
    element.textContent = previousText;
  };
  const apply = () => {
    if (!editing) return;
    const normalized = normalize(element.textContent);
    if (!normalized) {
      cancel();
      return;
    }
    finish();
    commit(normalized);
    if (normalized.clamped) {
      element.classList.remove("value-clamped");
      requestAnimationFrame(() => element.classList.add("value-clamped"));
      window.setTimeout(() => element.classList.remove("value-clamped"), 900);
    }
  };
  const begin = () => {
    if (editing || !state.session) return;
    const pairedControl = element.dataset.valuePath
      ? document.querySelector(`[data-path="${element.dataset.valuePath}"]`)
      : null;
    if (pairedControl?.disabled) return;
    editing = true;
    previousText = element.textContent;
    element.dataset.editing = "true";
    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute("role", "textbox");
    const value = Number(getValue());
    const rule = element.dataset.valuePath ? MANUAL_VALUE_RULES[element.dataset.valuePath] : null;
    element.textContent = String(rule?.entryScale ? value * rule.entryScale : value);
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    const contents = document.createRange();
    contents.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(contents);
  };

  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    begin();
  });
  element.addEventListener("keydown", (event) => {
    if (!editing && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      begin();
      return;
    }
    if (!editing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  element.addEventListener("blur", apply);
}

function normalizeManualControlValue(path, text) {
  const rule = MANUAL_VALUE_RULES[path];
  if (!rule) return null;
  const parsed = parseManualNumber(text);
  if (!Number.isFinite(parsed)) return null;
  const storedValue = rule.entryScale ? parsed / rule.entryScale : parsed;
  return normalizeManualNumber(storedValue, rule);
}

function normalizeManualNumber(textOrValue, rule) {
  const parsed = typeof textOrValue === "number" ? textOrValue : parseManualNumber(textOrValue);
  if (!Number.isFinite(parsed)) return null;
  const bounded = clamp(parsed, rule.min, rule.max);
  const scale = 10 ** rule.decimals;
  return {
    value: Math.round(bounded * scale) / scale,
    clamped: bounded !== parsed,
  };
}

function parseManualNumber(text) {
  let normalized = String(text ?? "").trim().replace(/\u2212/g, "-");
  normalized = normalized.replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1").replace(",", ".");
  const match = normalized.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  return match ? Number(match[0]) : Number.NaN;
}

function manualRangeLabel(path, rule) {
  return `${formatControlValue(path, rule.min)} to ${formatControlValue(path, rule.max)}`;
}

function updateRangeVisual(control) {
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const value = Number(control.value);
  const percent = maximum > minimum ? clamp((value - minimum) / (maximum - minimum), 0, 1) * 100 : 0;
  const shell = control.closest(".range-shell");
  if (!shell) return;
  const bipolar = minimum < 0 && maximum > 0;
  const fillOriginValue = bipolar ? rangeControlHome(control, minimum, maximum) : minimum;
  const fillOrigin = maximum > minimum ? clamp((fillOriginValue - minimum) / (maximum - minimum), 0, 1) * 100 : 0;
  shell.style.setProperty("--pos", `${percent}%`);
  shell.style.setProperty("--fill-start", `${Math.min(percent, fillOrigin)}%`);
  shell.style.setProperty("--fill-w", `${Math.abs(percent - fillOrigin)}%`);
  shell.dataset.bipolar = String(bipolar);
}

function syncRangeVisuals(root = document) {
  root.querySelectorAll?.('input[type="range"]').forEach(updateRangeVisual);
}

function bindInstrumentRangePointer(control, shell) {
  control.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const minimum = Number(control.min);
    const maximum = Number(control.max);
    const ordinaryStep = Number(control.dataset.instrumentStep) || Number(control.step) || (maximum - minimum) / 100;
    const direction = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
    const next = event.shiftKey
      ? adjacentRangeSnap(control, Number(control.value), direction)
      : clamp(Number(control.value) + direction * ordinaryStep * pointerAdjustmentScale(event), minimum, maximum);
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });

  control.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || control.disabled) return;
    event.preventDefault();
    control.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    const rect = control.getBoundingClientRect();
    const minimum = Number(control.min);
    const maximum = Number(control.max);
    const step = Number(control.dataset.instrumentStep) || Number(control.step) || (maximum - minimum) / 100;
    const startX = event.clientX;
    const startValue = Number(control.value);
    const directValue = minimum + clamp((startX - rect.left) / Math.max(rect.width, 1), 0, 1) * (maximum - minimum);
    let mode = event.shiftKey ? "snap" : event.ctrlKey ? "fine" : "ordinary";
    let previousX = startX;
    let requestedValue = mode === "fine" ? startValue : directValue;
    shell.classList.add("dragging");
    control.setPointerCapture(pointerId);

    const quantize = (requested, precision = 1) => {
      const clamped = clamp(requested, minimum, maximum);
      const quantum = step * Math.min(1, precision);
      const steps = Math.round((clamped - minimum) / quantum);
      return clamp(minimum + steps * quantum, minimum, maximum);
    };
    const setValue = (requested, activeMode) => {
      const next = activeMode === "snap"
        ? nearestRangeSnap(control, requested)
        : quantize(requested, activeMode === "fine" ? FINE_ADJUSTMENT_SCALE : 1);
      if (Number(control.value) === next) return;
      control.value = String(next);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };

    setValue(requestedValue, mode);
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const nextMode = moveEvent.shiftKey ? "snap" : moveEvent.ctrlKey ? "fine" : "ordinary";
      if (nextMode !== mode) {
        requestedValue = Number(control.value);
        previousX = moveEvent.clientX;
        mode = nextMode;
        if (mode === "snap") setValue(requestedValue, mode);
        return;
      }
      const scale = mode === "fine" ? FINE_ADJUSTMENT_SCALE : 1;
      requestedValue += ((moveEvent.clientX - previousX) / Math.max(rect.width, 1)) * (maximum - minimum) * scale;
      previousX = moveEvent.clientX;
      setValue(requestedValue, mode);
    };
    const stop = (stopEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      control.removeEventListener("pointermove", move);
      control.removeEventListener("pointerup", stop);
      control.removeEventListener("pointercancel", stop);
      if (control.hasPointerCapture(pointerId)) control.releasePointerCapture(pointerId);
      shell.classList.remove("dragging");
      control.dispatchEvent(new Event("change", { bubbles: true }));
    };
    control.addEventListener("pointermove", move);
    control.addEventListener("pointerup", stop);
    control.addEventListener("pointercancel", stop);
  });
}

function rangeControlHome(control, minimum, maximum) {
  const declared = Number(control.dataset.defaultValue ?? control.defaultValue);
  if (Number.isFinite(declared)) return clamp(declared, minimum, maximum);
  return minimum < 0 && maximum > 0 ? 0 : minimum + (maximum - minimum) / 2;
}

function rangeSnapProfile(control) {
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return [];
  const home = rangeControlHome(control, minimum, maximum);
  const identity = `${control.id || ""} ${control.dataset.path || ""} ${control.dataset.localGrade || ""} ${control.dataset.localMaskParam || ""}`.toLowerCase();
  const row = control.closest(".control-row");
  const heading = row?.querySelector("label")?.textContent?.toLowerCase() || "";
  const output = row?.querySelector("output")?.textContent || "";
  let authored = [];
  let usesDefaultLinearProfile = false;

  if (identity.includes("kelvin") || heading.includes("temperature")) {
    authored = [1000, 2000, 2500, 3200, 4300, 5600, 6500, 7500, 10000, 12000, 25000];
  } else if (identity.includes("nit") || /\bnit\b/i.test(output)) {
    authored = [0, 100, 203, 400, 600, 1000, 2000, 4000, 10000, 100000];
  } else if (identity.includes("angle") || heading.includes("degree") || output.includes("°")) {
    authored = [-180, -90, -45, -30, -15, 0, 15, 30, 45, 90, 180];
  } else if (output.includes("%") || ["opacity", "strength", "saturation", "vibrance"].some((term) => identity.includes(term) || heading.includes(term))) {
    authored = [minimum, minimum + (maximum - minimum) * 0.25, home, minimum + (maximum - minimum) * 0.75, maximum];
    usesDefaultLinearProfile = true;
  } else if (identity.includes("exposure") || /\bev\b/i.test(output)) {
    for (let value = Math.ceil(minimum); value <= Math.floor(maximum); value += 1) authored.push(value);
    // Narrow EV ranges still need the standard five useful landing positions.
    // Keep authored whole stops when the range supports them, then supplement
    // short ranges with quartiles rather than collapsing to min/home/max.
    if (new Set([...authored, minimum, home, maximum]).size < 5) {
      usesDefaultLinearProfile = true;
      authored.push(
        minimum + (maximum - minimum) * 0.25,
        minimum + (maximum - minimum) * 0.75,
      );
    }
  } else {
    usesDefaultLinearProfile = true;
    authored = [minimum, minimum + (maximum - minimum) * 0.25, home, minimum + (maximum - minimum) * 0.75, maximum];
  }

  authored.push(minimum, home, maximum);
  if (minimum < 0 && maximum > 0) authored.push(0);
  let legal = authored
    .filter((value) => Number.isFinite(value) && value >= minimum && value <= maximum)
    .map((value) => Math.round(value * 1e8) / 1e8)
    .sort((a, b) => a - b);
  legal = legal.filter((value, index) => index === 0 || Math.abs(value - legal[index - 1]) > 1e-8);
  if (usesDefaultLinearProfile && legal.length < 5) {
    for (const fraction of [0.5, 0.125, 0.375, 0.625, 0.875]) {
      const candidate = Math.round((minimum + (maximum - minimum) * fraction) * 1e8) / 1e8;
      if (!legal.some((value) => Math.abs(value - candidate) <= 1e-8)) legal.push(candidate);
      if (legal.length >= 5) break;
    }
    legal.sort((a, b) => a - b);
  }
  return legal;
}

function nearestRangeSnap(control, requested) {
  const profile = rangeSnapProfile(control);
  return profile.reduce((nearest, value) => (
    Math.abs(value - requested) < Math.abs(nearest - requested) ? value : nearest
  ), profile[0] ?? requested);
}

function adjacentRangeSnap(control, current, direction) {
  const profile = rangeSnapProfile(control);
  const epsilon = Math.max(1, Math.abs(current)) * 1e-8;
  if (direction > 0) return profile.find((value) => value > current + epsilon) ?? profile.at(-1) ?? current;
  return [...profile].reverse().find((value) => value < current - epsilon) ?? profile[0] ?? current;
}

function updateControlReadouts() {
  els.valueOutputs.forEach((output) => {
    if (output.dataset.editing === "true") return;
    const path = output.dataset.valuePath;
    const value = getValueByPath(state.adjustments, path);
    if (value === undefined) return;
    const text = formatControlValue(path, value);
    output.textContent = text;
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) control.setAttribute("aria-valuetext", text);
  });
  syncTintPurityVisuals();
}

function syncTintPurityVisuals() {
  for (const lane of ["hdr", "sdr"]) {
    const control = document.querySelector(`[data-path="${lane}.tint_purity"]`);
    const track = control?.closest(".range-shell")?.querySelector(".slider-track");
    if (!track) continue;
    track.style.background = `linear-gradient(90deg, #718080, ${darktableTintHueColor(state.adjustments[lane].tint_hue)})`;
  }
}

function darktableTintHueColor(requestedHue) {
  const hue = clamp(Number(requestedHue) || 0, -180, 180);
  const upperIndex = DARKTABLE_TINT_HUE_STOPS.findIndex(([angle]) => angle >= hue);
  const lowerIndex = Math.max(0, upperIndex - 1);
  const [lowerAngle, lowerColor] = DARKTABLE_TINT_HUE_STOPS[lowerIndex];
  const [upperAngle, upperColor] = DARKTABLE_TINT_HUE_STOPS[Math.max(upperIndex, 0)];
  const mix = upperAngle === lowerAngle ? 0 : (hue - lowerAngle) / (upperAngle - lowerAngle);
  const channels = lowerColor.map((channel, index) => Math.round(channel + (upperColor[index] - channel) * mix));
  return `rgb(${channels.join(", ")})`;
}

function formatControlValue(path, value) {
  const numeric = Number(value);
  if (path.endsWith("straighten_angle")) return `${numeric.toFixed(1)}\u00b0`;
  if (path.endsWith("luminance_ev")) return `${numeric.toFixed(2)} EV`;
  if (path.includes("color_grading") || path.includes("vignette")) {
    if (path.endsWith(".hue")) return `${Math.round(numeric)}\u00b0`;
    return `${numeric > 0 && path.endsWith("balance") ? "+" : ""}${Math.round(numeric)}${path.endsWith("balance") ? "" : "%"}`;
  }
  if (path.endsWith("white_balance_kelvin")) return `${Math.round(numeric)} K`;
  if (path.endsWith("clarity_radius_percent")) return `${numeric.toFixed(2)}%`;
  if (path.endsWith("sharpen_radius_px")) return `${numeric.toFixed(2)} px`;
  if (path.includes(".black_and_white.")) return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}`;
  if (path.includes(".detail.")) return `${numeric > 0 && !path.endsWith("sharpen_threshold") ? "+" : ""}${Math.round(numeric)}`;
  if (path.endsWith("_hue")) return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)}°`;
  if (path.endsWith("_purity") || path.endsWith(".saturation") || path.endsWith(".vibrance")) return `${numeric > 0 ? "+" : ""}${Math.round(path.endsWith("_purity") ? numeric : numeric * 100)}%`;
  if (path.endsWith(".exposure")) return `${numeric.toFixed(2)} EV`;
  if (path.endsWith("_nits")) return `${Math.round(numeric)} nit`;
  if (path.endsWith("highlight_compression_start_percent") || path.endsWith("highlight_compression_manual_peak_percent")) return `${Math.round(numeric)}%`;
  if (path.endsWith("film_look.halation_radius")) return `${numeric.toFixed(2)}% 35mm gate`;
  if (path.endsWith("film_look.bloom_radius")) return `${numeric.toFixed(2)}% output diag`;
  if (path.includes("film_look")) {
    const signed = /(contrast|toe|shoulder|density|hue_offset)$/.test(path);
    return `${signed && numeric > 0 ? "+" : ""}${Math.round(numeric)}%`;
  }
  if (path.endsWith("highlight_compression_softness")) {
    if (numeric <= 0) return "Off";
    return `${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1)}%`;
  }
  if (path.endsWith("highlight_compression_peak_detail")) return `${Math.round(numeric)}%`;
  if (path.endsWith("highlight_compression_bias")) return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}`;
  if (path.endsWith("_range") || (path.endsWith("_pivot") && !path.endsWith("contrast_pivot"))) return `${numeric.toFixed(2)} EV`;
  if (path === "shared.overlay_opacity") return `${Math.round(numeric * 100)}%`;
  if (path === "shared.overlay_threshold") return `${Math.round(numeric)} nit`;
  if (path.endsWith("contrast_pivot")) return numeric.toFixed(path.startsWith("hdr.") ? 4 : 3);
  if (path.endsWith("contrast") || path.endsWith("lift") || path.endsWith("gain") || path.endsWith("gamma") || path.endsWith("shadow_lift")) return numeric.toFixed(3);
  return numeric.toFixed(2);
}

// Only the fields Crop & Rotate itself owns -- Perspective has its own
// independent Reset and shouldn't be swept up by this one.
