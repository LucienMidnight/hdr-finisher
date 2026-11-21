function loadDenoiseDocument(document) {
  const fallback = defaultDenoiseDocument();
  const loadLane = (lane) => {
    const saved = document?.denoise?.[lane];
    const defaults = fallback[lane];
    if (!saved) return defaults;
    return {
      ...defaults, ...saved,
      // Method-less grades used the adaptive wavelet method when saved.
      controls: { ...defaults.controls, method: "standard", ...saved.controls },
      analysis: { ...defaults.analysis, ...saved.analysis },
    };
  };
  const next = { schema_version: 1, hdr: loadLane("hdr"), sdr: loadLane("sdr") };
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
    const previous = state.denoiseRuntime[lane];
    previous?.analysisController?.abort();
    const retainMicroFallback = sameSession && next[lane].controls.method === "micro_grain" && previous?.microCpu;
    state.denoiseRuntime[lane] = {
      status: state.denoise[lane].enabled ? "dirty" : "off",
      dirty: Boolean(state.denoise[lane].enabled),
      generation: (state.denoiseRuntime[lane]?.generation || 0) + 1,
      showOriginal: false,
      microCpu: Boolean(retainMicroFallback),
      microFailureKey: retainMicroFallback ? previous.microFailureKey : null,
      microCpuReason: retainMicroFallback ? previous.microCpuReason : null,
      error: "",
    };
  }
  renderDenoiseControls();
}

function microGrainUnavailable(lane) {
  const metadata = state.session?.metadata?.extra;
  if (!metadata?.micro_grain_bayer) return "Micro Grain needs an ordinary Bayer RAW.";
  const source = state.session.source;
  if (source?.width % 2 || source?.height % 2) return "Micro Grain needs complete Bayer cells at the sensor edges.";
  const highlights = state.editDocument?.source?.raw_import_settings?.highlight_reconstruction;
  if (highlights?.enabled && highlights.method === "edge_colour_v1") return "Micro Grain is not available with Edge Colour highlight reconstruction.";
  if (gradeSourceIdentity(lane) === "authored-sdr") return "Micro Grain needs sensor data, not an authored SDR image.";
  if (state.editDocument?.repairs?.length) return "Micro Grain is not available with retouch repairs.";
  return "";
}

function microGrainControlsMatch(lane, controls) {
  const live = state.denoise[lane].controls;
  return live.method === "micro_grain" && live.micro_luminance === controls.microLuminance
    && live.micro_color === controls.microColor && live.micro_detail === controls.microDetail;
}

function useMicroGrainCpu(lane, error, action) {
  const runtime = state.denoiseRuntime[lane];
  if (!runtime.microCpu) console.warn("Micro Grain GPU unavailable; using the CPU.", error);
  if (action) {
    runtime.microCpuAction = action;
    runtime.microCpuReason = error ? error.grainReason || HDRGrainRoute.failureReason(error)
      : runtime.microCpuReason || "prior_failure_latched";
  }
  if (error?.grainSourceKey) runtime.microFailureKey = error.grainSourceKey;
  Object.assign(runtime, { microCpu: true, status: "ready", dirty: false, error: "" });
  if (lane === state.currentView) renderDenoiseControls();
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
  const experimental = settings.controls.method !== "standard";
  const micro = settings.controls.method === "micro_grain";
  const unavailable = microGrainUnavailable(lane);
  const editable = enabled && (!micro || !unavailable);
  const option = els.denoiseMethod.querySelector('option[value="micro_grain"]');
  if (option) {
    const label = unavailable ? "Micro Grain · Unavailable" : "Micro Grain · Experimental";
    if (option.disabled !== Boolean(unavailable)) option.disabled = Boolean(unavailable);
    if (option.title !== unavailable) option.title = unavailable;
    if (option.textContent !== label) option.textContent = label;
  }
  if (els.denoiseMethod.value !== settings.controls.method) els.denoiseMethod.value = settings.controls.method;
  els.denoiseGrainControls.classList.toggle("hidden", !experimental || micro);
  els.denoiseMicroControls?.classList.toggle("hidden", !micro);
  els.denoiseAmount.closest(".control-row").classList.toggle("hidden", micro);
  els.denoiseDetail.closest(".control-row").classList.toggle("hidden", micro);
  els.denoiseAdvancedToggle.classList.toggle("hidden", micro);
  els.denoiseCleanControls.classList.toggle("hidden", settings.controls.method !== "clean_grain");
  els.denoiseSplotchSize.value = settings.controls.splotch_size;
  els.denoiseSplotchSize.disabled = !editable;
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
    [els.denoiseEvenness, els.denoiseEvennessValue, settings.controls.grain_evenness],
    [els.denoiseSplotches, els.denoiseSplotchesValue, settings.controls.color_splotches],
    ...els.denoiseMicroSliders.map(([input, key, output]) => [input, output, settings.controls[key]]),
  ];
  for (const [input, output, value] of controls) {
    input.value = String(value);
    output.textContent = `${Math.round(value * 100)}%`;
    input.disabled = !editable;
    updateRangeVisual(input);
  }
  els.denoiseRecalculate.disabled = !editable || ["preparing", "recalculating"].includes(runtime.status);
  renderDenoiseNoiseViewControl();
  renderDenoiseAdvancedVisibility();
  const labels = { off: "Off", preparing: "Preparing", ready: "Ready", dirty: "Dirty", recalculating: "Recalculating", error: "Error" };
  if (els.denoiseState) els.denoiseState.textContent = labels[runtime.status] || runtime.status;
  els.denoiseStatus.textContent = (micro && unavailable) || runtime.error
    || (micro && enabled && !runtime.microCpu && !runtime.showOriginal && (
      ["preparing", "recalculating"].includes(runtime.status) || runtime.microUpdating
      || (runtime.status === "ready" && state.activeWorkflow === "grade"
        && (state.acceptedPresentation?.lane !== lane || !state.acceptedPresentation.exact
          || state.acceptedPresentation.generation !== state.previewGeneration[lane])))
      && "Preparing Micro Grain. The first full-quality picture can take several seconds.") || ({
    off: "Denoise is off.",
    preparing: experimental
      ? "Preparing grain from the whole photo. You can keep viewing the current picture."
      : "Preparing the denoise cache; the original remains interactive.",
    ready: runtime.microCpu && micro ? "Micro Grain is using the CPU." : "Denoise cache ready.",
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
    && runtime && !runtime.showOriginal && !(state.denoise[lane].controls.method === "micro_grain" && runtime.microCpu)
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

function restoreDenoiseStatus(lane) {
  const runtime = state.denoiseRuntime[lane];
  runtime.status = !state.denoise[lane].enabled ? "off" : runtime.dirty ? "dirty" : "ready";
  runtime.error = "";
  if (lane === state.currentView) renderDenoiseControls();
}

function invalidateDenoisePreparation(lane, { dirty = false } = {}) {
  const runtime = state.denoiseRuntime[lane];
  if (!runtime) return;
  runtime.generation += 1;
  runtime.analysisController?.abort();
  runtime.analysisController = null;
  runtime.analysisInFlight = null;
  runtime.preparationAfterCommit = null;
  if (dirty) runtime.dirty = true;
  restoreDenoiseStatus(lane);
}

function deferDenoisePreparation(runtime, saving) {
  // A short pause lets rapid releases and toggles collapse onto the final
  // settings. A render that arrives meanwhile waits for the same saved edit.
  const quiet = new Promise(resolve => window.setTimeout(resolve, 120));
  const pending = Promise.all([saving, quiet]).then(([saved]) => {
    if (runtime.preparationAfterCommit === pending) runtime.preparationAfterCommit = null;
    return saved;
  });
  runtime.preparationAfterCommit = pending;
  return pending;
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
  const open = Boolean(state.denoiseAdvancedOpen) && state.denoise[state.currentView].controls.method !== "micro_grain";
  els.denoiseAdvancedToggle?.setAttribute("aria-expanded", String(open));
  els.denoiseAdvancedPanel?.classList.toggle("hidden", !open);
}

async function persistDenoiseSettings() {
  if (!state.session) return false;
  const draft = state.denoise;
  const denoise = structuredClone(draft);
  if (state.currentView === "hdr" && state.adjustments?.sdr?.linked_to_hdr) {
    denoise.sdr = structuredClone(denoise.hdr);
  }
  const applied = await queueEditCommand("set_denoise_settings", { denoise }, null, { refreshPreview: false });
  if (applied && state.denoise === draft) {
    if (state.adjustments?.sdr?.linked_to_hdr && valuesEqual(draft.hdr, denoise.hdr)
      && !valuesEqual(draft.sdr, draft.hdr)) {
      draft.sdr = structuredClone(draft.hdr);
      invalidateDenoisePreparation("sdr", { dirty: true });
    }
    renderLaneChrome();
  }
  return applied;
}

async function setDenoiseEnabled(enabled, { action } = {}) {
  if (!state.session) return;
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  state.denoise[lane].enabled = Boolean(enabled);
  const runtime = state.denoiseRuntime[lane];
  runtime.showOriginal = !enabled;
  invalidateDenoisePreparation(lane);
  const generation = runtime.generation;
  const isCurrent = () => state.session?.session_id === sessionId
    && state.denoiseRuntime[lane] === runtime && generation === runtime.generation;
  state.renderCoordinator?.cancelLane(lane, "superseded-by-denoise-toggle", { detach: true });
  invalidatePreview(lane, { markDirty: false });
  if (!enabled) {
    runtime.status = "off";
    state.denoiseNoiseView = false;
    state.gpuPreview?.cancelDenoiseProcessing?.({ selectOriginal: true });
    renderDenoiseControls();
    const saving = persistDenoiseSettings().catch(() => false);
    const revision = state.editRevision;
    const longEdge = refinementProxyLongEdge();
    let rendered = await renderGpuDraft(lane, { longEdge });
    const saved = await saving;
    if (!isCurrent() || lane !== state.currentView) return;
    runtime.saveFailed = !saved;
    if (rendered === false && saved && state.editRevision !== revision) {
      rendered = await renderGpuDraft(lane, { longEdge });
    }
    if (rendered === false && !transientGpuRefusal() && saved && isCurrent() && lane === state.currentView) {
      await renderPreviewForLane(lane, true, longEdge, { denoiseFallback: true });
    }
    if (!isCurrent()) return;
    renderDenoiseControls();
    return;
  }
  const saving = persistDenoiseSettings().catch(() => false);
  const afterCommit = deferDenoisePreparation(runtime, saving);
  runtime.status = "preparing";
  renderDenoiseControls();
  const applied = await saving;
  if (!isCurrent()) return;
  runtime.saveFailed = !applied;
  if (!applied) {
    denoiseRetryError(lane, "Denoise settings could not be saved.");
    return;
  }
  if (runtime.microCpu && state.denoise[lane].controls.method === "micro_grain") {
    await recalculateDenoise(lane, { operation: "enable_grain", action });
    return;
  }
  const denoise = state.gpuPreview?.diagnosticsSnapshot?.().denoise;
  const longEdge = refinementProxyLongEdge();
  const geometry = geometrySignature();
  const source = gradeSourceIdentity(lane);
  const expectedIdentity = `${sessionId}:${lane}:${longEdge}:${geometry}:${source}`;
  const cachedMethod = state.gpuPreview?.denoiseSourceSelector?.controls?.method || "standard";
  if (!runtime.dirty && denoise?.cacheReady && cachedMethod === state.denoise[lane].controls.method
    && (denoise.identity === expectedIdentity || state.gpuPreview.retargetPreparedDenoise?.(sessionId, lane, longEdge, geometry, source))) {
    state.gpuPreview.selectDenoiseSelectorSource(true);
    runtime.status = "ready";
    renderDenoiseControls();
    const rendered = await renderGpuDraft(lane, { longEdge });
    if (!isCurrent()) return;
    if (rendered === false && lane === state.currentView && !transientGpuRefusal()) {
      if (!runtime.microCpu) denoiseRetryError(lane, "The GPU could not draw the denoised preview.");
      await renderPreviewForLane(lane, true, longEdge, { denoiseFallback: true });
      return;
    }
    debounceOverlayAndScopes();
    renderDenoiseControls();
    return;
  }
  if (await afterCommit && isCurrent()) await recalculateDenoise(lane, { operation: "enable_grain", action });
}

function nativeDenoiseViewport(lane) {
  // Keep the original picture bounded at native zoom too. It can stay on
  // screen while Grain starts, without keeping a native-sized canvas alive.
  return state.zoomMode === "custom" && state.zoomPercent >= 100
    && (Boolean(state.denoise[lane]?.enabled) || gradeGrainGpuPreferred(lane)
      || (state.activeWorkflow === "grade" && lane === state.currentView && Boolean(els.previewCanvas.hdrFrameRegion)));
}

function gradeGrainGpuPreferred(lane) {
  if (state.activeWorkflow !== "grade" || !state.gpuPreview) return false;
  const method = state.denoise[lane]?.controls.method;
  if (method === "micro_grain") return !microGrainUnavailable(lane) && !state.denoiseRuntime[lane]?.microCpu;
  if (method === "clean_grain") return state.gpuPreview.enableGradeCleanGrainGpu !== false;
  return method === "fine_grain" && state.gpuPreview.enableGradeFineGrainGpu !== false;
}

function gradeGrainGpuEnabled(lane) {
  return Boolean(state.denoise[lane]?.enabled) && !state.denoiseRuntime[lane]?.showOriginal
    && gradeGrainGpuPreferred(lane);
}

function gradeSourceIdentity(lane) {
  if (lane !== "sdr") return "source";
  return state.adjustments?.sdr?.use_authored_base !== false
    && state.editDocument?.source?.luminance?.sdr_rendition === "authored" ? "authored-sdr" : "generated-sdr";
}

function denoiseRetryError(lane, detail) {
  const runtime = state.denoiseRuntime[lane];
  runtime.dirty = true;
  runtime.status = "error";
  runtime.error = `${detail} Try Recalculate again.`;
  if (lane === state.currentView) renderDenoiseControls();
  return false;
}

function gradeGrainAction(lane, operation) {
  const session = state.session;
  const method = state.denoise[lane]?.controls.method;
  if (!session || state.activeWorkflow !== "grade" || !state.denoise[lane]?.enabled
    || state.denoiseRuntime[lane]?.showOriginal || !method?.endsWith("_grain")) return null;
  return globalThis.HDRDiagnostics?.start("denoise", operation, { id: session.session_id, name: session.source?.filename },
    { lane, method, zoom_percent: state.zoomPercent });
}

async function recalculateDenoise(lane = state.currentView, options = {}) {
  const action = options.action ?? (options.logAction === false ? undefined
    : gradeGrainAction(lane, options.operation || "prepare_grain"));
  let ready = false, failed = false;
  try {
    ready = await recalculateDenoiseForView(lane, { ...options, action });
    return ready;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!options.action) action?.finish(failed ? "error" : ready ? "ready" : "stopped");
  }
}

async function recalculateDenoiseForView(lane, options) {
  const settings = state.denoise[lane];
  if (!state.session || !settings.enabled || state.denoiseRuntime[lane]?.showOriginal) return false;
  const runtime = state.denoiseRuntime[lane];
  const sessionId = state.session.session_id;
  const sourceIdentity = gradeSourceIdentity(lane);
  const method = settings.controls.method;
  const workflow = state.activeWorkflow;
  const current = () => state.session?.session_id === sessionId && state.denoiseRuntime[lane] === runtime
    && settings.enabled && !runtime.showOriginal && settings.controls.method === method
    && state.activeWorkflow === workflow && gradeSourceIdentity(lane) === sourceIdentity;
  const afterCommit = runtime.preparationAfterCommit;
  if (afterCommit && !(options.force && runtime.saveFailed)) {
    const generation = runtime.generation;
    if (!await afterCommit || !current() || runtime.generation !== generation) return false;
  }
  if (options.force && runtime.saveFailed) {
    const generation = ++runtime.generation;
    runtime.status = "recalculating";
    renderDenoiseControls();
    const saved = await persistDenoiseSettings().catch(() => false);
    if (generation !== runtime.generation) return false;
    if (!current()) {
      if (state.denoiseRuntime[lane] === runtime) restoreDenoiseStatus(lane);
      return false;
    }
    runtime.saveFailed = !saved;
    if (!saved) return denoiseRetryError(lane, "Denoise settings could not be saved.");
  }
  if (!state.gpuPreview?.available) {
    if (settings.controls.method === "micro_grain" && !microGrainUnavailable(lane)) {
      const renderer = state.gpuPreview;
      const reason = renderer?.deviceLost ? "device_lost" : "gpu_unavailable";
      const key = renderer?.deviceLost && renderer.grainSourceKey(sessionId, geometrySignature(), sourceIdentity,
        state.repairSourceGeneration || 0, method);
      const error = Object.assign(new Error("The GPU is unavailable."), { grainReason: reason, grainSourceKey: key });
      if (key && !renderer.grainFailures.get(key)) renderer.noteGrainFailure(key, error, options.action);
      renderer?.grainEvent?.("grain_route", "cpu", reason, options.action);
      useMicroGrainCpu(lane, error, options.action);
    } else {
      denoiseRetryError(lane, "The GPU is unavailable.");
    }
    if (options.renderAfter !== false && lane === state.currentView) {
      await renderPreviewForLane(lane, true, options.longEdge || refinementProxyLongEdge(), { denoiseFallback: true });
    }
    return false;
  }
  if (method === "micro_grain" && runtime.microCpu && runtime.microFailureKey
    && state.gpuPreview.grainFailureCanRun(runtime.microFailureKey)) {
    runtime.microCpu = false;
    runtime.dirty = true;
  }
  if (method === "micro_grain" && runtime.microCpu) {
    state.gpuPreview.grainEvent?.("grain_gpu_skipped", "cpu", "prior_failure_latched", options.action,
      { prior_reason: runtime.microCpuReason });
    useMicroGrainCpu(lane, null, options.action);
    if (options.renderAfter !== false && lane === state.currentView) {
      await renderPreviewForLane(lane, true, options.longEdge || refinementProxyLongEdge(), { denoiseFallback: true });
    }
    return false;
  }
  const pixels = sourceIdentity === "authored-sdr" ? "authoredSdr" : "scene";
  // Recalculate replaces preparation for these pixels. Both generated
  // renditions can use the new result, including after a switch of lane.
  if (state.denoiseGrainRefresh?.sessionId !== sessionId) {
    state.denoiseGrainRefresh = { sessionId, scene: 0, authoredSdr: 0 };
  }
  const refreshes = state.denoiseGrainRefresh;
  if (options.force && settings.controls.method !== "standard") refreshes[pixels]++;
  const refresh = refreshes[pixels];
  const longEdge = options.longEdge || refinementProxyLongEdge();
  const { color_splotches, ...preparationControls } = settings.controls;
  const nativePreparation = preparationControls.amount
    && (preparationControls.luminance || preparationControls.color_noise)
    && (preparationControls.method === "clean_grain"
      || (preparationControls.method === "fine_grain" && preparationControls.grain_evenness));
  const key = JSON.stringify([
    sessionId, lane, nativePreparation ? "native" : longEdge, geometrySignature(),
    pixels, state.repairSourceGeneration || 0, settings.analysis, refresh,
    settings.controls.method === "standard" ? "standard" : [gradeGrainGpuEnabled(lane), preparationControls],
  ]);
  // Pan, enable and the first edit can all ask for the same setup. Sharing it
  // keeps them from repeatedly replacing the selector and measuring again.
  let pending = runtime.analysisInFlight;
  if (pending?.key !== key) {
    const promise = recalculateDenoiseAnalysis(lane, { longEdge, refresh, action: options.action });
    pending = { key, promise, generation: runtime.generation };
    runtime.analysisInFlight = pending;
  }
  let ready;
  try {
    ready = await pending.promise;
  } finally {
    if (runtime.analysisInFlight === pending) runtime.analysisInFlight = null;
  }
  if (!current() || pending.generation !== runtime.generation) return false;
  if (!ready) {
    if (options.renderAfter !== false && lane === state.currentView && (runtime.status === "error" || runtime.microCpu)) {
      await renderPreviewForLane(lane, true, longEdge, { denoiseFallback: true });
    }
    return false;
  }
  if (options.renderAfter !== false) {
    const currentEdge = nativePreparation ? refinementProxyLongEdge() : longEdge;
    state.gpuPreview.retargetPreparedDenoise?.(state.session.session_id, lane, currentEdge,
      geometrySignature(), sourceIdentity);
    const rendered = await renderGpuDraft(lane, { longEdge: currentEdge, action: options.action });
    if (!current() || pending.generation !== runtime.generation) return false;
    if (rendered === false && lane === state.currentView && !transientGpuRefusal()) {
      if (!runtime.microCpu) denoiseRetryError(lane, "The GPU could not draw the denoised preview.");
      await renderPreviewForLane(lane, true, currentEdge, { denoiseFallback: true });
      return false;
    }
    debounceOverlayAndScopes();
  }
  return true;
}

async function recalculateDenoiseAnalysis(lane = state.currentView, options = {}) {
  const settings = state.denoise[lane];
  if (!state.session || !settings.enabled || state.denoiseRuntime[lane]?.showOriginal
    || !state.gpuPreview?.available) return false;
  const sessionId = state.session.session_id;
  const runtime = state.denoiseRuntime[lane];
  const generation = ++runtime.generation;
  const sourceIdentity = gradeSourceIdentity(lane);
  const geometry = geometrySignature();
  const workflow = state.activeWorkflow;
  const method = settings.controls.method;
  const gradeGpuGrain = gradeGrainGpuEnabled(lane);
  const controller = new AbortController();
  runtime.analysisController?.abort();
  runtime.analysisController = controller;
  const ownsStatus = () => state.session?.session_id === sessionId
    && state.denoiseRuntime[lane] === runtime && generation === runtime.generation;
  const current = () => ownsStatus() && !controller.signal.aborted
    && settings.enabled && !runtime.showOriginal && settings.controls.method === method
    && state.activeWorkflow === workflow && gradeSourceIdentity(lane) === sourceIdentity
    && geometrySignature() === geometry;
  const cacheReady = state.gpuPreview.diagnosticsSnapshot().denoise.cacheReady;
  if (!cacheReady) runtime.dirty = true;
  runtime.status = cacheReady ? "recalculating" : "preparing";
  runtime.error = "";
  if (lane === state.currentView) renderDenoiseControls();
  if (gradeGpuGrain && lane === state.currentView && nativeDenoiseViewport(lane)) {
    state.panSourceController?.abort();
  }
  try {
    while (current()) {
      const revision = state.editRevision;
      const isCurrent = () => current() && state.editRevision === revision;
      let ready;
      try {
        ready = await state.gpuPreview.analyzeDenoiseProxy(
          sessionId, lane, structuredClone(state.adjustments),
          options.longEdge || refinementProxyLongEdge(), revision, sourceIdentity,
          denoiseRendererControls(settings.controls), options.refresh ?? 0,
          Math.max(256, state.session.source?.width || 0, state.session.source?.height || 0),
          { signal: controller.signal, isCurrent, gradeGpuGrain, repairGeneration: state.repairSourceGeneration || 0,
            action: options.action },
        );
      } catch (error) {
        if (!current()) return false;
        if (state.editRevision !== revision) continue;
        if (error?.name === "AbortError" || error?.status === 409) {
          // The backend can reject the old revision before its new revision
          // reaches the browser in the outstanding edit acknowledgement.
          await state.editCommandQueue?.catch(() => false);
          if (current() && state.editRevision !== revision) continue;
          return false;
        }
        if (method === "micro_grain") {
          state.gpuPreview.grainEvent?.("grain_route", "cpu", globalThis.HDRGrainRoute?.failureReason(error), options.action, { lane, method });
          useMicroGrainCpu(lane, error, options.action);
          return false;
        }
        state.gpuPreview.grainEvent?.("grain_preparation_failed", "refused", globalThis.HDRGrainRoute?.failureReason(error), options.action,
          { level: "error", lane, method });
        console.warn("Denoise analysis failed.", error);
        return denoiseRetryError(lane, error?.message || error?.detail || "Denoise analysis failed.");
      }
      if (!current()) return false;
      if (state.editRevision !== revision) continue;
      if (!ready) return false;
      runtime.dirty = false;
      restoreDenoiseStatus(lane);
      return true;
    }
    return false;
  } finally {
    if (ownsStatus()) {
      runtime.analysisController = null;
      if (["preparing", "recalculating"].includes(runtime.status)) restoreDenoiseStatus(lane);
    }
  }
}

async function updateLiveDenoiseControl(key, value) {
  const lane = state.currentView;
  const settings = state.denoise[lane];
  const runtime = state.denoiseRuntime[lane];
  const next = clamp(value, 0, 1);
  if (settings.controls.method === "micro_grain" && key.startsWith("micro_") && settings.controls[key] === next) return;
  settings.controls[key] = next;
  renderDenoiseControls();
  if (key === "grain_evenness" && !liveGradeGrainSelected(lane)) return;
  if (!settings.enabled || runtime.status !== "ready" || runtime.showOriginal) return;
  // Section 5.6: reconstruction is coalesced to one in-flight run plus one
  // latest pending state, so dragging a control costs runs rather than input
  // events and the last value is the one that lands.
  await denoiseInputQueue().submit({
    lane,
    sessionId: state.session?.session_id,
    generation: runtime.generation,
    controls: denoiseRendererControls(settings.controls),
    liveGrainControl: liveGrainControl(key, lane) ? key : null,
  });
}

function liveGradeGrainSelected(lane) {
  const selector = state.gpuPreview?.denoiseSourceSelector;
  return gradeGrainGpuEnabled(lane) && selector?.cache?.grain?.gpu && selector.selected === "resolved"
    && selector.controls?.method === state.denoise[lane].controls.method
    && selector.cache.preparedFrame === JSON.stringify([state.session?.session_id, lane, geometrySignature(), gradeSourceIdentity(lane)]);
}

function liveGrainControl(key, lane) {
  if (state.denoise[lane].controls.method === "micro_grain") return key.startsWith("micro_");
  return key === "grain_evenness" || (state.denoise[lane].controls.method === "clean_grain"
    && (key === "color_splotches" || key === "splotch_size"));
}

async function commitDenoiseControl(key, value) {
  const lane = state.currentView;
  const settings = state.denoise[lane];
  const runtime = state.denoiseRuntime[lane];
  const sessionId = state.session?.session_id;
  if (!sessionId) return;
  if (key === "method" && value === settings.controls.method) return;
  if (value !== undefined) settings.controls[key] = value;
  if (key === "method") {
    runtime.microCpu = false;
    runtime.microFailureKey = runtime.microCpuAction = runtime.microCpuReason = null;
    runtime.showOriginal = !settings.enabled;
    state.gpuPreview?.cancelDenoiseProcessing?.({ selectOriginal: false });
  }
  if (key.startsWith("micro_") && runtime.microCpu && settings.enabled) {
    invalidateDenoisePreparation(lane);
    const generation = runtime.generation;
    const saved = await deferDenoisePreparation(runtime, persistDenoiseSettings().catch(() => false));
    if (state.denoiseRuntime[lane] !== runtime || runtime.generation !== generation) return;
    runtime.saveFailed = !saved;
    if (!saved) return denoiseRetryError(lane, "Denoise settings could not be saved.");
    useMicroGrainCpu(lane);
    if (lane === state.currentView) {
      invalidatePreview(lane, { markDirty: false });
      await renderPreviewForLane(lane, true, refinementProxyLongEdge(), { denoiseFallback: true });
    }
    return;
  }
  if (runtime.status === "ready" && liveGrainControl(key, lane) && liveGradeGrainSelected(lane)) {
    const generation = runtime.generation;
    const saved = await persistDenoiseSettings().catch(() => false);
    if (state.session?.session_id !== sessionId || state.denoiseRuntime[lane] !== runtime
      || runtime.generation !== generation || !settings.enabled) return;
    runtime.saveFailed = !saved;
    if (!saved) return denoiseRetryError(lane, "Denoise settings could not be saved.");
    const controls = denoiseRendererControls(settings.controls);
    const current = state.gpuPreview.denoiseSourceSelector.controls;
    const viewport = nativeDenoiseViewport(lane);
    if (controls.method === "micro_grain") {
      if (viewport && !runtime.microUpdating && state.acceptedPresentation?.exact
        && controls.microLuminance === current.microLuminance && controls.microColor === current.microColor
        && controls.microDetail === current.microDetail) return;
      await denoiseInputQueue().submit({ lane, sessionId, generation: runtime.generation,
        controls, liveGrainControl: key, wholeFrame: true });
      return;
    }
    const exactBlend = key === "color_splotches" && state.gpuPreview.hasReducedCleanGrain();
    if ((!viewport && !exactBlend) || controls.grainEvenness !== current.grainEvenness
      || controls.colorSplotches !== current.colorSplotches || controls.splotchSize !== current.splotchSize) {
      const render = { lane, sessionId, generation: runtime.generation, controls, liveGrainControl: key };
      const queue = denoiseInputQueue();
      if (!viewport && key === "splotch_size") {
        await queue.submit({ ...render, provisional: true });
        // Let the quick picture reach the screen before the exact draw takes over.
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (settings.controls.splotch_size !== controls.splotchSize) return;
      }
      await queue.submit({ ...render, wholeFrame: true });
    }
    return;
  }
  if (!settings.enabled && key !== "method") return persistDenoiseSettings();
  const needsPreparation = key === "method" || runtime.status !== "ready"
    || (settings.controls.method !== "standard" && key !== "color_splotches");
  if (!needsPreparation) {
    const saved = await persistDenoiseSettings().catch(() => false);
    // The prepared CPU correction already contains the two blend endpoints.
    if (saved && key === "color_splotches" && settings.enabled && lane === state.currentView
      && state.denoiseRuntime[lane] === runtime) {
      invalidatePreview(lane, { markDirty: false });
      await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
    }
    return saved;
  }
  invalidateDenoisePreparation(lane, { dirty: true });
  const generation = runtime.generation;
  invalidatePreview(lane, { markDirty: false });
  const saving = persistDenoiseSettings().catch(() => false);
  if (settings.enabled) {
    runtime.status = "recalculating";
    renderDenoiseControls();
    await deferDenoisePreparation(runtime, saving);
  }
  const saved = await saving;
  if (state.session?.session_id !== sessionId || state.denoiseRuntime[lane] !== runtime
    || runtime.generation !== generation) return;
  runtime.saveFailed = !saved;
  if (!settings.enabled) return;
  if (!saved) return denoiseRetryError(lane, "Denoise settings could not be saved.");
  await recalculateDenoise(lane, { operation: key === "method" ? "choose_grain_method" : "release_grain_control" });
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
    method: controls.method,
    grainEvenness: controls.grain_evenness,
    colorSplotches: controls.color_splotches,
    splotchSize: controls.splotch_size,
    ...(controls.method === "micro_grain" ? { microLuminance: controls.micro_luminance,
      microColor: controls.micro_color, microDetail: controls.micro_detail } : {}),
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

async function runLiveDenoise({ lane, sessionId, generation, controls, wholeFrame = false, liveGrainControl = null, provisional = false }) {
  const isCurrent = () => sessionId === state.session?.session_id
    && generation === state.denoiseRuntime[lane]?.generation && state.denoise[lane]?.enabled
    && !state.denoiseRuntime[lane]?.showOriginal
    && (controls.method !== "micro_grain" || microGrainControlsMatch(lane, controls));
  if (!isCurrent()) return;
  if (controls.method === "micro_grain" && state.denoiseRuntime[lane].microCpu) {
    invalidatePreview(lane, { markDirty: false });
    await renderPreviewForLane(lane, true, refinementProxyLongEdge(), { denoiseFallback: true, showProgress: false });
    return;
  }
  const viewport = nativeDenoiseViewport(lane);
  const interacting = !wholeFrame && Boolean(state.previewScheduler?.interacting);
  if (liveGrainControl && lane === state.currentView && liveGradeGrainSelected(lane)
    && (viewport || wholeFrame || controls.method === "clean_grain" || controls.method === "micro_grain")) {
    state.gpuPreview.setDenoiseControls(controls);
    invalidatePreview(lane, { markDirty: false });
    const exactBlend = liveGrainControl === "color_splotches" && state.gpuPreview.hasReducedCleanGrain();
    const rendered = await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge(), viewport,
      tier: (provisional || interacting) && !viewport && !exactBlend ? "interactive" : "settled",
      reason: "grade-grain-control" });
    if (!rendered && isCurrent() && controls.method === "micro_grain" && state.denoiseRuntime[lane].microCpu) {
      await renderPreviewForLane(lane, true, refinementProxyLongEdge(), { denoiseFallback: true, showProgress: false });
    }
    if (isCurrent()) debounceOverlayAndScopes();
    return;
  }
  const startedAt = performance.now();
  // NEXT-01 #4. During a drag only what is on screen is reconstructed: a
  // tiled render (Full, or zoomed in) reconstructs each tile it draws itself,
  // and a whole-frame render zoomed in needs only the visible region. At 200%
  // on a 42 MP frame the whole-frame reconstruction took ~145 ms a step. The
  // rest of the frame is brought up to date once, on release (wholeFrame).
  const region = interacting ? liveDenoiseRegion() : null;
  if (interacting && interactiveDraftGuaranteedTiled(lane) && state.gpuPreview?.setDenoiseControls?.(controls)) {
    state.denoiseWholeFrameStale = { lane, sessionId, generation, controls };
  } else {
    const ready = await state.gpuPreview?.resolveDenoiseProxy?.(controls, region ? { region } : {});
    if (!ready || !isCurrent()) return;
    state.denoiseWholeFrameStale = region ? { lane, sessionId, generation, controls } : null;
  }
  if (!isCurrent() || lane !== state.currentView) return;
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
  if (!isCurrent()) return;
  debounceOverlayAndScopes();
}

async function runDenoiseInput(request) {
  if (request.controls.method !== "micro_grain") return runLiveDenoise(request);
  const runtime = state.denoiseRuntime[request.lane];
  if (request.sessionId !== state.session?.session_id || request.generation !== runtime.generation) return;
  runtime.microUpdating = true;
  if (request.lane === state.currentView) renderDenoiseControls();
  try {
    await runLiveDenoise(request);
  } finally {
    runtime.microUpdating = false;
    if (request.lane === state.currentView && runtime === state.denoiseRuntime[request.lane]) renderDenoiseControls();
  }
}

function denoiseInputQueue() {
  if (!state.denoiseInputQueue) {
    const Queue = window.HDRLatestWorkQueue;
    state.denoiseInputQueue = Queue
      ? new Queue(runDenoiseInput, { onError: (error) => console.warn("Live denoise reconstruction failed.", error) })
      : null;
  }
  return state.denoiseInputQueue || { submit: runDenoiseInput, stats: null };
}

