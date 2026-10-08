function loadDenoiseDocument(document) {
  const fallback = defaultDenoiseDocument();
  const source = document?.denoise || fallback;
  const next = {
    schema_version: 1,
    hdr: {
      ...fallback.hdr,
      ...(source.hdr || {}),
      controls: { ...fallback.hdr.controls, ...(source.hdr?.controls || {}) },
      analysis: { ...fallback.hdr.analysis, ...(source.hdr?.analysis || {}) },
    },
    sdr: {
      ...fallback.sdr,
      ...(source.sdr || {}),
      controls: { ...fallback.sdr.controls, ...(source.sdr?.controls || {}) },
      analysis: { ...fallback.sdr.analysis, ...(source.sdr?.analysis || {}) },
    },
  };
  const sessionId = state.session?.session_id || null;
  const sameSession = state.denoiseDocumentSessionId === sessionId;
  const unchanged = JSON.stringify(next) === JSON.stringify(state.denoise);
  state.denoise = next;
  state.denoiseDocumentSessionId = sessionId;
  if (sameSession && unchanged) {
    renderDenoiseControls();
    return;
  }
  for (const lane of ["hdr", "sdr"]) {
    state.denoiseRuntime[lane] = {
      status: state.denoise[lane].enabled ? "dirty" : "off",
      dirty: Boolean(state.denoise[lane].enabled),
      generation: (state.denoiseRuntime[lane]?.generation || 0) + 1,
      showOriginal: false,
      error: "",
    };
  }
  renderDenoiseControls();
}

function renderDenoiseControls() {
  if (!els.denoiseBypass) return;
  const lane = state.currentView;
  const settings = state.denoise[lane];
  const runtime = state.denoiseRuntime[lane];
  const enabled = Boolean(settings.enabled);
  const group = els.denoiseBypass.closest(".control-group");
  const defaults = defaultDenoiseDocument()[lane];
  const modified = !valuesEqual(settings.controls, defaults.controls);
  els.denoiseBypass.classList.toggle("bypassed", !enabled);
  els.denoiseBypass.setAttribute("aria-pressed", String(enabled));
  group?.classList.toggle("bypassed", !enabled);
  group?.classList.toggle("modified", modified);
  const controls = [
    [els.denoiseAmount, els.denoiseAmountValue, settings.controls.amount],
    [els.denoiseLuminance, els.denoiseLuminanceValue, settings.controls.luminance],
    [els.denoiseColor, els.denoiseColorValue, settings.controls.color_noise],
    [els.denoiseDetail, els.denoiseDetailValue, settings.controls.detail_recovery],
    [els.denoiseFinest, els.denoiseFinestValue, settings.controls.finest_noise ?? 0.5],
    [els.denoiseFine, els.denoiseFineValue, settings.controls.fine_noise ?? 0.5],
    [els.denoiseMedium, els.denoiseMediumValue, settings.controls.medium_noise ?? 0.5],
    [els.denoiseCoarse, els.denoiseCoarseValue, settings.controls.coarse_noise ?? 0.5],
  ];
  for (const [input, output, value] of controls) {
    input.value = String(value);
    output.textContent = `${Math.round(value * 100)}%`;
    input.disabled = !enabled || !["ready", "dirty"].includes(runtime.status);
    updateRangeVisual(input);
  }
  els.denoiseRecalculate.disabled = !enabled || ["preparing", "recalculating"].includes(runtime.status);
  renderDenoiseNoiseViewControl();
  renderDenoiseAdvancedVisibility();
  const labels = { off: "Off", preparing: "Preparing", ready: "Ready", dirty: "Dirty", recalculating: "Recalculating", error: "Error" };
  if (els.denoiseState) els.denoiseState.textContent = labels[runtime.status] || runtime.status;
  els.denoiseStatus.textContent = runtime.error || ({
    off: "Denoise is off.",
    preparing: "Preparing the denoise cache; the original remains interactive.",
    ready: "Denoise cache ready.",
    dirty: "The view changed. The previous valid result remains visible until recalculated.",
    recalculating: "Recalculating; the previous valid result remains interactive.",
    error: "Denoise could not be prepared. The original pipeline remains available.",
  }[runtime.status] || "");
}

/**
 * Whether the current preview can show what Denoise removes. Only the WebGPU
 * preview reconstructs denoise, and only once an analysis exists; a dirty
 * analysis still has its previous valid result on screen.
 */
function denoiseNoiseViewAvailable(lane = state.currentView) {
  const runtime = state.denoiseRuntime?.[lane];
  return Boolean(
    state.gpuPreview?.available
    && state.denoise?.[lane]?.enabled
    && runtime && !runtime.showOriginal
    && ["ready", "dirty", "recalculating"].includes(runtime.status),
  );
}

function denoiseNoiseViewActive(lane = state.currentView) {
  return Boolean(state.denoiseNoiseView) && denoiseNoiseViewAvailable(lane);
}

function renderDenoiseNoiseViewControl() {
  const active = denoiseNoiseViewActive();
  if (els.denoiseShowNoise) {
    els.denoiseShowNoise.disabled = !denoiseNoiseViewAvailable();
    els.denoiseShowNoise.setAttribute("aria-pressed", String(active));
    els.denoiseShowNoise.lastElementChild.textContent = active ? "Hide noise" : "Show noise";
  }
  els.noiseViewBadge?.classList.toggle("hidden", !active);
  document.body.classList.toggle("denoise-noise-view", active);
}

function toggleDenoiseNoiseView() {
  const lane = state.currentView;
  if (!state.denoiseNoiseView && !denoiseNoiseViewAvailable(lane)) return;
  state.denoiseNoiseView = !state.denoiseNoiseView;
  renderDenoiseNoiseViewControl();
  // A view change, not an edit: a new generation so no pass of the other view
  // is accepted, without marking the grade dirty.
  invalidatePreview(lane, { markDirty: false });
  debouncePreview(lane);
  // Scopes describe the graded picture, so they only refresh on the way back.
  if (!state.denoiseNoiseView) debounceOverlayAndScopes();
}

function markDenoiseAnalysisDirty() {
  const lane = state.currentView;
  const runtime = state.denoiseRuntime[lane];
  runtime.dirty = true;
  runtime.error = "";
  runtime.status = state.denoise[lane].enabled ? "dirty" : "off";
  renderDenoiseControls();
}

/**
 * Show or hide the Advanced denoise controls.
 *
 * PRD 6.3: Amount and Detail Recovery are always visible, Luminance and
 * Colour Noise are Advanced. This changes nothing but visibility -- the
 * values persist, are still written by `renderDenoiseControls`, and still
 * reach the render, which is what "without changing results silently"
 * requires.
 */
function renderDenoiseAdvancedVisibility() {
  const open = Boolean(state.denoiseAdvancedOpen);
  els.denoiseAdvancedToggle?.setAttribute("aria-expanded", String(open));
  els.denoiseAdvancedPanel?.classList.toggle("hidden", !open);
}

async function persistDenoiseSettings() {
  if (!state.session) return false;
  const applied = await queueEditCommand("set_denoise_settings", { denoise: JSON.parse(JSON.stringify(state.denoise)) }, null, { refreshPreview: false });
  if (applied) renderLaneChrome();
  return applied;
}

async function setDenoiseEnabled(enabled) {
  const lane = state.currentView;
  state.denoise[lane].enabled = Boolean(enabled);
  const runtime = state.denoiseRuntime[lane];
  runtime.error = "";
  if (!enabled) {
    runtime.generation += 1;
    runtime.status = "off";
    runtime.showOriginal = true;
    state.denoiseNoiseView = false;
    state.gpuPreview?.cancelDenoiseProcessing?.({ selectOriginal: true });
    // The button answers the click at once; the redraw can take a while at Full.
    renderDenoiseControls();
    await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
    renderDenoiseControls();
    void persistDenoiseSettings();
    return;
  }
  if (!await persistDenoiseSettings()) {
    runtime.status = "error";
    runtime.error = "Denoise settings could not be saved";
    renderDenoiseControls();
    return;
  }
  const denoise = state.gpuPreview?.diagnosticsSnapshot?.().denoise;
  const expectedIdentity = `${state.session?.session_id}:${lane}:${refinementProxyLongEdge()}:${JSON.stringify(state.adjustments.shared?.geometry || {})}:source`;
  if (!runtime.dirty && denoise?.cacheReady && denoise.identity === expectedIdentity) {
    state.gpuPreview.selectDenoiseSelectorSource(true);
    runtime.status = "ready";
    runtime.showOriginal = false;
    await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
    debounceOverlayAndScopes();
    renderDenoiseControls();
    return;
  }
  await recalculateDenoise();
}

async function recalculateDenoise(lane = state.currentView, options = {}) {
  const settings = state.denoise[lane];
  if (!state.session || !settings.enabled || !state.gpuPreview?.available) return false;
  const runtime = state.denoiseRuntime[lane];
  const longEdge = options.longEdge || refinementProxyLongEdge();
  const key = JSON.stringify([
    state.session.session_id, lane, longEdge, geometrySignature(),
    "source", settings.analysis,
  ]);
  // Pan, enable and the first edit can all ask for the same setup. Sharing it
  // keeps them from repeatedly replacing the selector and measuring again.
  let pending = runtime.analysisInFlight;
  if (pending?.key !== key) {
    pending = { key, promise: recalculateDenoiseAnalysis(lane, { longEdge, renderAfter: false }) };
    runtime.analysisInFlight = pending;
  }
  let ready;
  try {
    ready = await pending.promise;
  } finally {
    if (runtime.analysisInFlight === pending) runtime.analysisInFlight = null;
  }
  if (!ready || !settings.enabled) return false;
  if (options.renderAfter !== false) {
    await renderGpuDraft(lane, { longEdge });
    debounceOverlayAndScopes();
  }
  return true;
}

async function recalculateDenoiseAnalysis(lane = state.currentView, options = {}) {
  const settings = state.denoise[lane];
  if (!state.session || !settings.enabled || !state.gpuPreview?.available) return false;
  const runtime = state.denoiseRuntime[lane];
  const generation = ++runtime.generation;
  runtime.status = state.gpuPreview.diagnosticsSnapshot().denoise.cacheReady ? "recalculating" : "preparing";
  runtime.error = "";
  if (lane === state.currentView) renderDenoiseControls();
  try {
    const ready = await state.gpuPreview.analyzeDenoiseProxy(
      state.session.session_id,
      lane,
      JSON.parse(JSON.stringify(state.adjustments)),
      options.longEdge || refinementProxyLongEdge(),
      state.editRevision,
      "source",
      denoiseRendererControls(settings.controls),
    );
    if (generation !== runtime.generation) return false;
    if (!ready) throw new Error("The denoise analysis was replaced before completion.");
    runtime.status = "ready";
    runtime.dirty = false;
    runtime.showOriginal = false;
    if (options.renderAfter !== false) {
      await renderGpuDraft(lane, { longEdge: options.longEdge || refinementProxyLongEdge() });
      debounceOverlayAndScopes();
    }
    if (lane === state.currentView) renderDenoiseControls();
    return true;
  } catch (error) {
    if (generation !== runtime.generation) return false;
    runtime.status = "error";
    runtime.error = error?.message || error?.detail || JSON.stringify(error) || "Denoise analysis failed.";
    console.warn("Denoise analysis failed.", error);
    if (lane === state.currentView) renderDenoiseControls();
    return false;
  }
}

async function updateLiveDenoiseControl(key, value) {
  const lane = state.currentView;
  const settings = state.denoise[lane];
  const runtime = state.denoiseRuntime[lane];
  settings.controls[key] = clamp(value, 0, 1);
  renderDenoiseControls();
  if (!settings.enabled || runtime.status !== "ready" || runtime.showOriginal) return;
  // Section 5.6: reconstruction is coalesced to one in-flight run plus one
  // latest pending state, so dragging a control costs runs rather than input
  // events and the last value is the one that lands.
  await denoiseInputQueue().submit({
    lane,
    controls: denoiseRendererControls(settings.controls),
  });
}

/** The renderer's names for a lane's live denoise controls. */
function denoiseRendererControls(controls) {
  return {
    amount: controls.amount,
    luminance: controls.luminance,
    colorNoise: controls.color_noise,
    detailRecovery: controls.detail_recovery,
    finestNoise: controls.finest_noise ?? 0.5,
    fineNoise: controls.fine_noise ?? 0.5,
    mediumNoise: controls.medium_noise ?? 0.5,
    coarseNoise: controls.coarse_noise ?? 0.5,
  };
}

// Frames a Denoise drag may start per second: the drag cap every other slider
// has (HDRPreviewScheduler maxInteractiveFps).
const DENOISE_DRAG_MAX_FPS = 60;

// Margin, in source pixels, reconstructed around the visible area during a
// drag, so filters that sample neighbours near the viewer edge see denoised
// pixels. Also the grid the region is snapped to (a wavelet tile must start
// on its own grid).
const LIVE_DENOISE_REGION_MARGIN = 64;

/**
 * The part of the denoise frame on screen, or null when that is the whole
 * frame or cannot be mapped (any crop, rotation or perspective moves the
 * output away from the source grid, so those keep whole-frame work).
 */
function liveDenoiseRegion() {
  const source = state.gpuPreview?.denoiseSourceSelector?.original;
  if (!source?.width || !source?.height || !geometryTransformIsNeutral()) return null;
  const visible = visibleOutputRect(source.width, source.height);
  if (!visible) return null;
  const grid = LIVE_DENOISE_REGION_MARGIN;
  const x = Math.max(0, Math.floor((visible.x - grid) / grid) * grid);
  const y = Math.max(0, Math.floor((visible.y - grid) / grid) * grid);
  return {
    x,
    y,
    width: Math.min(source.width, visible.x + visible.width + grid) - x,
    height: Math.min(source.height, visible.y + visible.height + grid) - y,
  };
}

async function runLiveDenoise({ lane, controls, wholeFrame = false }) {
  const startedAt = performance.now();
  const interacting = !wholeFrame && Boolean(state.previewScheduler?.interacting);
  // NEXT-01 #4. During a drag only what is on screen is reconstructed: a
  // tiled render (Full, or zoomed in) reconstructs each tile it draws itself,
  // and a whole-frame render zoomed in needs only the visible region. At 200%
  // on a 42 MP frame the whole-frame reconstruction took ~145 ms a step. The
  // rest of the frame is brought up to date once, on release (wholeFrame).
  const region = interacting ? liveDenoiseRegion() : null;
  if (interacting && interactiveDraftGuaranteedTiled(lane) && state.gpuPreview?.setDenoiseControls?.(controls)) {
    state.denoiseWholeFrameStale = { lane, controls };
  } else {
    const ready = await state.gpuPreview?.resolveDenoiseProxy?.(controls, region ? { region } : {});
    if (!ready) return;
    state.denoiseWholeFrameStale = region ? { lane, controls } : null;
  }
  if (lane !== state.currentView) return;
  if (interacting) {
    // NEXT-01 #4. During a drag the picture is drawn by the ordinary drag
    // path, so a Denoise drag gets what every other slider has: the 60 fps
    // cap, one frame on the GPU at a time, throttled scopes and the settled
    // pass on release. Drawing a settled frame per reconstruction here, back
    // to back, ran above the cap with frames queued on the GPU and cost 60%
    // more card power than an Exposure drag at Fit.
    invalidatePreview(lane, { markDirty: false });
    debouncePreview(lane);
    // The next reconstruction waits for this one to leave the GPU and for the
    // frame interval, so reconstructions cannot outrun the drawing.
    await state.gpuPreview?.waitForSubmittedWork?.();
    const remaining = 1000 / DENOISE_DRAG_MAX_FPS - (performance.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    return;
  }
  await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
  debounceOverlayAndScopes();
}

function denoiseInputQueue() {
  if (!state.denoiseInputQueue) {
    const Queue = window.HDRLatestWorkQueue;
    state.denoiseInputQueue = Queue
      ? new Queue(runLiveDenoise, { onError: (error) => console.warn("Live denoise reconstruction failed.", error) })
      : null;
  }
  return state.denoiseInputQueue || { submit: runLiveDenoise, stats: null };
}

