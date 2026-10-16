function bindRangeResetControls() {
  document.addEventListener("dblclick", (event) => {
    const control = event.target.closest('input[type="range"]:not([data-no-double-reset])');
    if (!control || control.disabled) return;
    event.preventDefault();
    const stockControl = filmStockUiContext(control.dataset.path);
    if (stockControl && HDRFilmCharacter.tracked.includes(stockControl.key)) {
      resetFilmStockControl(stockControl.key);
      return;
    }
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
  return numeric ? filmStockUiValue(control.dataset.path, Number(control.value), false) : control.value;
}

function commitAdjustmentValue(path, value, { manual = false } = {}) {
  const resolvedPath = resolveAdjustmentPath(path);
  if (manual) {
    beginGlobalDetailInteraction(resolvedPath);
    state.previewScheduler?.beginInteraction();
  }
  const filmPath = resolvedPath.match(/^(hdr|sdr)\.film_look\.([^.]+)$/);
  if (filmPath) {
    const film = state.adjustments[filmPath[1]].film_look;
    if (filmPath[2] === "film_stock") HDRFilmCharacter.select(film, value);
    else HDRFilmCharacter.set(film, filmPath[2], value);
    syncControlsFromState();
  } else setValueByPath(state.adjustments, path, value);
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
  syncFilmStockSlider(path, control);
  const value = Number(filmStockUiValue(path, getValueByPath(state.adjustments, path), true));
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

const FILM_PRINT_KEYS = Object.freeze(["print_paper", "print_exposure", "stock_print_warmth", "stock_print_tint", "stock_preflash", "print_contrast", "shadow_contrast", "highlight_contrast"]);
const FILM_SLIDE_STOCKS = new Set(["fujifilm_provia_100f", "fujifilm_velvia_100", "kodak_ektachrome_100", "kodak_kodachrome_64"]);

function renderFilmStockControls() {
  if (!state.session) return;
  const slide = FILM_SLIDE_STOCKS.has(state.adjustments?.[state.currentView]?.film_look?.film_stock);
  FILM_PRINT_KEYS.forEach((key) => {
    const control = document.querySelector(`[data-path="current.film_look.${key}"]`);
    if (control) control.disabled = slide;
  });
  document.querySelector("[data-film-slide-note]")?.toggleAttribute("hidden", !slide);
  const printControls = document.querySelector(".film-print-controls");
  if (printControls) printControls.disabled = slide;
  document.querySelector('[data-film-section="print"]')?.classList.toggle("film-slide", slide);
  for (const key of ["lens_strength", "lens_size"]) {
    const control = document.querySelector(`[data-path="current.film_look.${key}"]`);
    if (control) control.disabled = state.adjustments[state.currentView].film_look.lens_filter === "none";
  }
  renderFilmPanel();
}

function renderControlState() {
  const defaults = defaultAdjustments();
  const filmLook = state.adjustments[state.currentView]?.film_look;
  document.querySelector("[data-film-grain-custom]")?.toggleAttribute("hidden", filmLook?.grain_film_format !== "custom");
  renderFilmGrainChroma();
  renderFilmStockControls();
  renderFilmStockDots();
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
  const context = filmStockUiContext(path);
  if (context && HDRFilmCharacter.tracked.includes(context.key)) return (context.film.stock_overrides || []).includes(context.key);
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


// Stock ownership belongs to the lane's saved Film Look object, not to the DOM.
function filmStockUiContext(path) {
  if (typeof HDRFilmCharacter === "undefined" || typeof state === "undefined" || !path) return null;
  const match = resolveAdjustmentPath(path).match(/^(hdr|sdr)\.film_look\.([^.]+)$/);
  const film = match && state.adjustments?.[match[1]]?.film_look;
  return film ? {film, key:match[2]} : null;
}

function filmStockUiValue(path, value, toUi) {
  const context = filmStockUiContext(path);
  if (!context) return value;
  return HDRFilmCharacter[toUi ? "toUi" : "fromUi"](context.film, context.key, value);
}

function syncFilmStockSlider(path, control) {
  const context = filmStockUiContext(path);
  if (!context || !HDRFilmCharacter.owned.includes(context.key)) return;
  if (!control.dataset.stockOriginalMin) {
    control.dataset.stockOriginalMin = control.min;
    control.dataset.stockOriginalMax = control.max;
  }
  control.dataset.defaultValue = String(filmStockUiValue(path, HDRFilmCharacter.defaults(context.film)[context.key], true));
  control.min = filmStockUiValue(path, Number(control.dataset.stockOriginalMin), true);
  control.max = filmStockUiValue(path, Number(control.dataset.stockOriginalMax), true);
  const scale = HDRFilmCharacter.scale(context.film, context.key);
  if (scale?.offset) {
    // Keep zero on the range step lattice; typed values retain full bounds.
    control.min = Math.ceil(Number(control.min));
    control.max = Math.floor(Number(control.max));
  }
  if (scale && !scale.offset) {
    control.max = Math.min(Number(control.max), context.key === "halation_radius" ? 400 : 200);
  }
}

function resetFilmStockControl(key) {
  if (!state.session) return;
  HDRFilmCharacter.reset(state.adjustments[state.currentView].film_look, key);
  syncControlsFromState();
  invalidatePreview(state.currentView);
  renderControlState();
  debouncePreview(state.currentView);
}

function renderFilmStockDots() {
  if (typeof HDRFilmCharacter === "undefined") return;
  const film = state.adjustments?.[state.currentView]?.film_look;
  if (!film) return;
  for (const key of HDRFilmCharacter.tracked) {
    const control = document.querySelector(`[data-path="current.film_look.${key}"]`);
    let heading = control?.closest(".control-row")?.querySelector(".control-heading");
    const labelRow = control?.closest(".select-control, .numeric-control, .film-module-toggle");
    if (!heading && labelRow) {
      heading = labelRow.querySelector(".film-control-label");
      if (!heading) {
        heading = document.createElement("span"); heading.className = "film-control-label";
        const copy = [...labelRow.childNodes].filter(node => node !== control);
        heading.append(...copy); labelRow.prepend(heading);
      }
    }
    if (!heading) continue;
    let dot = heading.querySelector("[data-stock-reset]");
    if (!dot) {
      dot = document.createElement("button");
      dot.type = "button";
      dot.dataset.stockReset = key;
      dot.className = "film-stock-reset";
      dot.textContent = "●";
      dot.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); resetFilmStockControl(key); });
      heading.prepend(dot);
    }
    const set = (film.stock_overrides || []).includes(key);
    dot.hidden = !set;
    dot.disabled = !state.session || Boolean(control.closest("fieldset:disabled"));
    const row = control.closest(".control-row, .select-control, .numeric-control, .film-module-toggle");
    row?.classList.toggle("film-control-set", set);
    if (HDRFilmCharacter.owned.includes(key)) {
      let tag = heading.querySelector(".film-stock-tag");
      if (!tag) { tag = document.createElement("span"); tag.className = "film-stock-tag"; tag.textContent = "STOCK"; heading.append(tag); }
      tag.hidden = set;
    }
    const name = (heading.querySelector("label")?.textContent || heading.textContent).replace(/●|STOCK/g, "").trim();
    const effect = control.closest(".film-effect-tile")?.querySelector(".film-module-header strong")?.textContent;
    const label = effect ? (name === "Enabled" ? effect : `${effect} ${name}`) : name || key.replaceAll("_", " ");
    control.setAttribute("aria-label", label);
    dot.setAttribute("aria-label", `Reset ${label} to ${HDRFilmCharacter.owned.includes(key) ? "the stock" : "the baseline"}`);
    dot.title = `Mod. Reset ${label} to ${HDRFilmCharacter.owned.includes(key) ? "the stock" : "the baseline"}`;
    if (HDRFilmCharacter.owned.includes(key) && key.startsWith("halation_")) control.title = film.film_stock === "none"
      ? "Neutral has no halation of its own; these are absolute effect controls."
      : "100% is this stock's own value; Hue Offset 0 keeps its colour. Set values stay fixed when changing stock.";
  }
}

// Panel presentation only: never writes the saved Film Look or renderer data.
function renderFilmPanel() {
  const film = state.adjustments?.[state.currentView]?.film_look;
  if (!film) return;
  const character = HDRFilmCharacter.character(film);
  const slide = film.film_stock !== "none" && character.default_paper === null;
  const text = key => {
    const control = document.querySelector(`[data-path="current.film_look.${key}"]`);
    return control?.selectedOptions?.[0]?.textContent || String(film[key]);
  };
  const paperName = id => {
    if (!id) return "None";
    const option = document.querySelector(`[data-path="current.film_look.print_paper"] option[value="${id}"]`);
    return option?.textContent || id.split("_").map(word => word === "typeii" ? "Type II" : word[0].toUpperCase()+word.slice(1)).join(" ");
  };
  const paper = paperName(film.print_paper === "default" ? character.default_paper : film.print_paper);
  const facts = document.getElementById("film-stock-facts");
  if (facts) {
    const estimate = status => status && status !== "Confirmed" ? " · estimate" : "";
    const amount = character.defaults.grain_amount;
    const grain = amount <= 21 ? "Very fine grain" : amount <= 25 ? "Fine grain" : amount <= 30 ? "Medium grain" : "Coarse grain";
    const halation = {strong:"Low halation", weak:"Visible halation", none:"Strong halation"}[character.halation?.antihalation] || "Halation";
    const chips = film.film_stock === "none" ? ["Straight response", "No grain or halation of its own"] : [
      (character.halation?.use === "cine" ? "Cinema film" : "Still film")+(slide ? " · slide" : ""),
      grain+estimate(character.provenance?.grain_amount?.status),
      halation+estimate(character.halation?.status),
      slide ? "Scanned directly, no print" : `Prints on ${paperName(character.default_paper)}`];
    facts.replaceChildren(...chips.map(copy => { const chip = document.createElement("span"); chip.textContent = copy; return chip; }));
  }
  const formatKeys = ["grain_film_format", "grain_capture_geometry", "grain_custom_width_mm", "grain_custom_height_mm", "stock_exposure", "lens_filter", "lens_strength", "lens_size"];
  const printKeys = [...FILM_PRINT_KEYS];
  const scanKeys = ["lab_levels", "scan_sharpening"];
  const stageKeys = {camera:formatKeys, negative:HDRFilmCharacter.tracked.filter(key => ![...formatKeys, ...printKeys, ...scanKeys, "push_pull", "look_strength"].includes(key)), development:["push_pull"], print:printKeys, scan:scanKeys};
  const grade = {0.125:"1/8", 0.25:"1/4", 0.5:"1/2", 1:"1", 2:"2"}[film.lens_strength] || Number(film.lens_strength).toFixed(2);
  const summaries = {
    camera:text("grain_film_format")+(film.lens_filter === "none" ? "" : ` · ${text("lens_filter")} ${grade}`),
    negative:(film.grain_enabled ? `Grain ${Math.round(film.grain_amount)}` : "No grain")+" · "+(film.halation_enabled ? `Halation ${Math.round(HDRFilmCharacter.toUi(film, "halation_amount", film.halation_amount))}%` : "No halation"),
    development:film.push_pull === 0 ? "Normal" : film.push_pull > 0 ? `Push +${film.push_pull}` : `Pull ${film.push_pull}`,
    print:slide ? "No print" : paper+(film.stock_print_warmth ? film.stock_print_warmth > 0 ? " · Warm" : " · Cool" : ""),
    scan:(film.lab_levels ? "Lab levels" : "Clean")+(film.scan_sharpening ? ` · Sharpen ${film.scan_sharpening}` : "")};
  for (const [name, keys] of Object.entries(stageKeys)) {
    const stage = document.querySelector(`[data-film-section="${name}"]`);
    if (!stage) continue;
    const summary = stage.querySelector(".film-stage-summary"); summary.textContent = summaries[name]; summary.title = summaries[name];
    const count = keys.filter(key => (film.stock_overrides || []).includes(key)).length;
    stage.querySelector(".film-stage-mod").textContent = count ? `${count} Mod` : "";
  }
  document.querySelectorAll("[data-film-push]").forEach(button => {
    button.disabled = !state.session;
    button.setAttribute("aria-pressed", String(Number(button.dataset.filmPush) === film.push_pull));
  });
  const note = document.getElementById("film-push-note");
  if (note) note.textContent = film.film_stock === "kodak_portra_800"
    ? "Portra 800 +1 and +2 use Kodak’s measured push data. Other positions approximate development through film contrast."
    : "Approximate for this stock: changes film contrast in whole stops. Measured push data exists only for Portra 800 +1 and +2.";
  const output = document.getElementById("film-output-note");
  if (output) output.textContent = state.currentView === "hdr"
    ? "HDR output: highlights above paper white keep their brightness ratios, so lamps and the sun stay bright. Nothing to set."
    : "SDR output: the print fits the screen’s white. Nothing to set.";
}
