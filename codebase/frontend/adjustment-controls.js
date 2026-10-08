function bindRangeResetControls() {
  document.addEventListener("dblclick", (event) => {
    const control = event.target.closest('input[type="range"]:not([data-no-double-reset])');
    if (!control || control.disabled) return;
    event.preventDefault();
    control.value = control.dataset.defaultValue ?? control.defaultValue;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function applyLatitudePresets(latitude) {
  const preset = latitudePresets[latitude] || latitudePresets.MEDIUM;
  Object.entries(preset).forEach(([path, [min, max, step]]) => {
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) {
      control.min = min;
      control.max = max;
      control.dataset.instrumentStep = String(step);
      control.step = String(fineRangeStep(step));
      syncRangeControlFromState(path, control);
    }
  });
}

function resolveAdjustmentPath(path) {
  return path?.startsWith("current.") ? `${state.currentView}.${path.slice("current.".length)}` : path;
}

// Select elements always report strings; numeric paths must not send "4000" where the backend expects 4000.
function readControlValue(control) {
  if (control.type === "checkbox") return control.checked;
  const numeric = control.type === "range" || control.type === "number" || control.dataset.valueType === "number";
  return numeric ? Number(control.value) : control.value;
}

function commitAdjustmentValue(path, value, { manual = false } = {}) {
  const resolvedPath = resolveAdjustmentPath(path);
  if (manual) {
    beginGlobalDetailInteraction(resolvedPath);
    state.previewScheduler?.beginInteraction();
  }
  setValueByPath(state.adjustments, path, value);
  // Only one film look diagnostic map can be on screen at a time.
  if (value === true && /film_look\.(halation|grain)_view_map$/.test(resolvedPath)) {
    const companion = resolvedPath.endsWith("halation_view_map") ? "grain_view_map" : "halation_view_map";
    setValueByPath(state.adjustments, resolvedPath.replace(/[^.]+$/, companion), false);
    syncControlsFromState();
  }
  if (resolvedPath.startsWith("hdr.highlight_compression_")) normalizeHighlightCompressionControls(resolvedPath);
  if (resolvedPath.startsWith("sdr.highlight_compression_")) normalizeSdrHighlightCompressionControls(resolvedPath);
  if (path === "shared.false_color_band_anchor" || path === "shared.false_color_ceiling_nits") {
    renderOverlayPresetNote();
    drawCurveEditor();
    renderLocalAdjustments();
  }
  if (resolvedPath.includes(".tone_equalizer_")) drawToneEqualizerEditor(resolvedPath.startsWith("sdr.") ? "sdr" : "hdr");
  syncRangeControlFromState(path);
  updateControlReadouts();
  renderControlState();
  if (path.startsWith("shared.overlay_")) {
    markGlobalEditDirty();
    if (path === "shared.overlay_mode") refreshOverlayAndScopesImmediately();
    else debounceOverlayAndScopes();
  } else if (resolvedPath.startsWith("shared.geometry")) {
    renderCropOptions();
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else {
    const lane = resolvedPath.startsWith("sdr.") ? "sdr" : "hdr";
    invalidatePreview(lane);
    debouncePreview(lane);
  }
  if (manual) state.previewScheduler?.endInteraction();
}

function syncPressedControl(control, pressed) {
  control.setAttribute("aria-pressed", String(pressed));
  control.lastElementChild.textContent = pressed ? control.dataset.hideLabel : control.dataset.showLabel;
}

function syncControlsFromState() {
  els.controls.forEach((control) => {
    const value = getValueByPath(state.adjustments, control.dataset.path);
    if (value === undefined) return;
    if (control.tagName === "BUTTON") syncPressedControl(control, Boolean(value));
    else if (control.type === "checkbox") control.checked = Boolean(value);
    else {
      if (control.type === "range") syncRangeControlFromState(control.dataset.path, control);
      else if (control.type === "number" && /color_grading\..+\.(hue|saturation)$/.test(control.dataset.path)) {
        control.value = String(Math.round(Number(value)));
      } else control.value = String(value);
    }
  });
  updateControlReadouts();
  syncToneEqualizerControls();
  renderCropOptions();
  renderPerspectiveControls();
  renderColorWheels();
  renderVignetteCenter();
}

function syncRangeControlFromState(path, requestedControl = null) {
  const control = requestedControl || document.querySelector(`[data-path="${path}"]`);
  if (!control || control.type !== "range") return;
  const value = Number(getValueByPath(state.adjustments, path));
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const outsideSlider = value < minimum || value > maximum;
  control.value = String(clamp(value, minimum, maximum));
  control.closest(".range-shell")?.classList.toggle("manual-overflow", outsideSlider);
  updateRangeVisual(control);
}

function syncCurveControlsFromState() {
  els.curveRemove.disabled = currentCurveValues().length <= 2 || isLockedCurveEndpoint(state.selectedCurvePoint);
}

function filmGrainChromaInactive() {
  return state.adjustments?.[state.currentView]?.film_look?.grain_film_type === "black_and_white";
}

function renderFilmGrainChroma() {
  const chroma = document.getElementById("film-grain-chroma");
  if (!chroma) return;
  if (state.session) chroma.disabled = filmGrainChromaInactive();
}

function renderControlState() {
  const defaults = defaultAdjustments();
  const filmLook = state.adjustments[state.currentView]?.film_look;
  document.querySelector("[data-film-grain-custom]")?.toggleAttribute("hidden", filmLook?.grain_film_format !== "custom");
  renderFilmGrainChroma();
  renderHighlightCompressionControls();
  renderSdrHighlightCompressionControls();
  els.controlRows.forEach((row) => {
    row.classList.toggle("modified", isPathModified(row.dataset.controlPath, defaults));
  });
  for (const [group, paths] of Object.entries(controlGroups)) {
    const count = paths.filter((path) => isPathModified(path, defaults)).length;
    const output = document.querySelector(`[data-modified-count="${group}"]`);
    if (output) output.textContent = "";
    output?.closest(".control-group")?.classList.toggle("modified", count > 0);
  }
  renderGeometryResetState(defaults);
  for (const lane of ["hdr", "sdr"]) {
    const keys = Object.keys(defaults[lane]).filter((key) => !key.endsWith("_curve") && !key.endsWith("_section_enabled") && !["highlight_compression_source_peak_nits", "highlight_compression_source_peak_percent"].includes(key));
    const modified = keys.some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]))
      || laneCurvesModified(lane, defaults);
    const button = els.viewButtons.find((item) => item.dataset.kind === lane);
    button?.classList.toggle("modified", modified);
  }
  const currentLaneDefaults = defaults[state.currentView];
  els.gradeModifiedSummary.textContent = "";
  const curvesModified = laneCurvesModified(state.currentView, defaults);
  els.curveGroupState.textContent = "";
  els.curveReset.closest(".control-group")?.classList.toggle("modified", curvesModified);
  const filmModified = !valuesEqual(state.adjustments[state.currentView]?.film_look, currentLaneDefaults.film_look);
  if (els.filmLookState) els.filmLookState.textContent = "";
  els.filmLookReset?.closest(".control-group")?.classList.toggle("modified", filmModified);
  const gradingModified = !valuesEqual(state.adjustments[state.currentView]?.color_grading, currentLaneDefaults.color_grading);
  if (els.colorGradingState) els.colorGradingState.textContent = "";
  els.colorGradingReset?.closest(".control-group")?.classList.toggle("modified", gradingModified);
  const detailModified = !valuesEqual(state.adjustments[state.currentView]?.detail, currentLaneDefaults.detail);
  document.querySelector(".detail-group")?.classList.toggle("modified", detailModified);
  const blackAndWhiteModified = state.adjustments[state.currentView]?.black_and_white_section_enabled === true
    || !valuesEqual(state.adjustments[state.currentView]?.black_and_white, currentLaneDefaults.black_and_white);
  document.querySelector(".black-and-white-group")?.classList.toggle("modified", blackAndWhiteModified);
  const vignetteModified = !valuesEqual(state.adjustments[state.currentView]?.vignette, currentLaneDefaults.vignette);
  if (els.vignetteState) els.vignetteState.textContent = "";
  els.vignetteReset?.closest(".control-group")?.classList.toggle("modified", vignetteModified);
  els.sectionBypasses.forEach((button) => {
    const path = resolveAdjustmentPath(button.dataset.sectionPath);
    const enabled = getValueByPath(state.adjustments, path) !== false;
    button.classList.toggle("bypassed", !enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.closest(".control-group")?.classList.toggle("bypassed", !enabled);
  });
  syncDesktopDocumentState();
}

function isPathModified(path, defaults = defaultAdjustments()) {
  return !valuesEqual(getValueByPath(state.adjustments, path), getValueByPath(defaults, path));
}

function valuesEqual(left, right) {
  if ((left && typeof left === "object") || (right && typeof right === "object")) return JSON.stringify(left) === JSON.stringify(right);
  return left === right;
}

function laneCurvesModified(lane, defaults = defaultAdjustments()) {
  return ["luma_curve", "red_curve", "green_curve", "blue_curve"]
    .some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]));
}

function resetControlGroup(group) {
  if (group === "denoise") {
    const lane = state.currentView;
    const defaults = defaultDenoiseDocument()[lane];
    state.denoise[lane].controls = JSON.parse(JSON.stringify(defaults.controls));
    const runtime = state.denoiseRuntime[lane];
    runtime.dirty = true;
    runtime.status = state.denoise[lane].enabled ? "dirty" : "off";
    runtime.showOriginal = !state.denoise[lane].enabled;
    renderDenoiseControls();
    void persistDenoiseSettings();
    return;
  }
  const paths = controlGroups[group] || [];
  if (!paths.length) return;
  const defaults = defaultAdjustments();
  if (group === "perspective") {
    if (state.perspectiveApplyOperation?.saving) return;
    if (state.perspectiveMode) closePerspectiveMode(false);
    state.perspectiveFailedDraft = null;
    const changed = paths.some((path) => !valuesEqual(getValueByPath(state.adjustments, path), getValueByPath(defaults, path)));
    paths.forEach((path) => setValueByPath(state.adjustments, path, getValueByPath(defaults, path)));
    if (!changed && !state.globalEditDirty) {
      setPerspectiveStatus("Perspective reset.", "applied");
      renderPerspectiveControls();
      return;
    }
    const signature = geometrySignature();
    state.perspectiveApplyOperation = { sessionId: state.session?.session_id, saving: false, signature };
    state.geometryTransformHandoffSignature = signature;
    state.geometryPresentationPending = true;
    state.gpuPreparedLane = { hdr: false, sdr: false };
    syncControlsFromState();
    setPerspectiveStatus("Perspective reset. Updating the preview…", "applying");
    renderPerspectiveControls();
    renderControlState();
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
    return;
  }
  if (group === "geometry") {
    // Perspective is its own module with its own Reset now -- this one only
    // touches what Crop & Rotate owns (rotation, flip, straighten, crop rect,
    // aspect), and leaves an open Perspective draft alone entirely.
    const current = state.cropDraftGeometry || state.adjustments.shared.geometry;
    if (!cropRotateGeometryModified(current, defaults.shared.geometry) && !state.rotateDraftGeometry) return;
    // No confirmation. Every other Reset in the panel acts immediately and is
    // undoable, and this one was the only native `confirm` in the authoring
    // surface -- which on Windows left the renderer unable to open a <select>
    // popup until the window lost and regained focus.
    if (state.cropMode) closeCropMode(false);
    if (state.rotateDraftGeometry) closeRotateMode(false);
  }
  paths.forEach((path) => setValueByPath(state.adjustments, path, getValueByPath(defaults, path)));
  const sectionPath = sectionPathForGroup[group];
  if (sectionPath) setValueByPath(state.adjustments, sectionPath, true);
  syncControlsFromState();
  if (group.endsWith("-equalizer")) drawToneEqualizerEditor(group.startsWith("sdr-") ? "sdr" : "hdr");
  if (group === "geometry") {
    invalidatePreview("hdr"); invalidatePreview("sdr");
  } else invalidatePreview(group.startsWith("sdr-") ? "sdr" : "hdr");
  renderControlState();
  if (group === "geometry" && state.perspectiveMode) {
    // Keep Reset visible inside the active draft, and preserve this separate
    // module's reset if the user subsequently cancels Perspective.
    paths.forEach((path) => {
      const key = path.replace("shared.geometry.", "");
      setValueByPath(state.perspectiveDraftGeometry, key, getValueByPath(defaults, path));
    });
    schedulePerspectiveDraftPreview();
    return;
  }
  debouncePreview(group === "geometry" ? state.currentView : group.startsWith("sdr-") ? "sdr" : "hdr");
}

function setSdrColorSliders(source) {
  if (!state.session || !source) return;
  COLOR_CONTROL_KEYS.forEach((key) => {
    state.adjustments.sdr[key] = source[key];
  });
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
}

function matchHdrColorsToSdr() {
  setSdrColorSliders(state.adjustments.hdr);
}

function resetFilmLook() {
  const lane = state.currentView;
  state.adjustments[lane].film_look = defaultFilmLook();
  state.adjustments[lane].film_look_section_enabled = true;
  syncControlsFromState();
  invalidatePreview(lane);
  renderControlState();
  debouncePreview(lane);
}

function matchHdrFilmLookToSdr() {
  if (!state.session) return;
  const topLevelEnabled = state.adjustments.sdr.film_look_section_enabled;
  state.adjustments.sdr.film_look = JSON.parse(JSON.stringify(state.adjustments.hdr.film_look));
  state.adjustments.sdr.film_look_section_enabled = topLevelEnabled;
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
}

function resetLaneObject(key, neutral) {
  const lane = state.currentView;
  state.adjustments[lane][key] = JSON.parse(JSON.stringify(neutral));
  state.adjustments[lane][`${key}_section_enabled`] = true;
  syncControlsFromState();
  invalidatePreview(lane);
  renderControlState();
  debouncePreview(lane);
}

/** Copy HDR's Black & White, sliders and on/off, to SDR once (BW-01). */
function matchHdrBlackAndWhiteToSdr() {
  if (!state.session) return;
  state.adjustments.sdr.black_and_white = JSON.parse(JSON.stringify(state.adjustments.hdr.black_and_white));
  state.adjustments.sdr.black_and_white_section_enabled = state.adjustments.hdr.black_and_white_section_enabled === true;
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
}

function matchLaneObject(key) {
  if (!state.session) return;
  state.adjustments.sdr[key] = JSON.parse(JSON.stringify(state.adjustments.hdr[key]));
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
}

function renderOutputFinishingControls() {
  const mode = els.exportResizeMode?.value || "original";
  els.exportLongEdgeRow?.classList.toggle("hidden", mode !== "long_edge");
  els.exportFitRow?.classList.toggle("hidden", mode !== "fit");
  window.HDRProofing?.invalidate("settings");
}

