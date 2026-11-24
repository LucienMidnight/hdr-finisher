function clearZoomScopeRefresh() {
  if (!state.zoomScopeTimer) return;
  window.clearTimeout(state.zoomScopeTimer);
  state.zoomScopeTimer = 0;
  restoreScopeFreshnessIfIdle();
}

function suspendGradeInstruments() {
  cancelGeometryUnderlayer();
  state.gradeWorkGeneration = (state.gradeWorkGeneration || 0) + 1;
  state.previewScheduler?.cancel();
  state.cpuPreviewInflight?.clear();
  window.clearTimeout(state.refreshTimer);
  window.clearTimeout(state.settleTimer);
  clearZoomScopeRefresh();
  state.zoomRefinementInFlight = null;
  for (const [lane, controller] of Object.entries(state.previewControllers || {})) {
    controller?.abort();
    state.previewControllers[lane] = null;
  }
  state.scopeGeneration += 1;
  state.scopeRequestInFlight?.controller?.abort();
  state.pendingScopeRequest?.resolve(false);
  cancelGpuScopeRequests();
  state.pendingScopeRequest = null;
  state.scopeAwaitingPresentation = null;
  state.overlayAbortController?.abort();
}

function scopeLongEdge(tier) {
  // Interactive scopes favor visible motion; the settled pass restores the
  // denser authoring result immediately after the drag ends.
  const profile = scopeQualityProfile();
  if (tier === "interactive") return Math.min(profile.interactiveEdge, interactiveProxyLongEdge());
  if (tier === "refinement") return Math.min(profile.refinementEdge, refinementProxyLongEdge());
  return Math.min(profile.settledEdge, settledProxyLongEdge());
}

function refreshScopes(longEdge = 960, { tier = "settled", generation = null, lane = state.currentView } = {}) {
  if (["import", "export"].includes(state.activeWorkflow) || document.hidden || !state.session || geometryDraftActive()) return Promise.resolve(false);
  if (state.rawRedevelopGeneration != null && state.rawRedevelopGeneration === state.importGeneration) {
    return Promise.resolve(false);
  }
  // Scopes describe the lane on screen. A request left over from the lane just
  // switched away from could only be a whole-picture CPU grade, and its answer
  // is discarded on arrival.
  if (lane !== state.currentView) return Promise.resolve(false);
  if (state.zoomScopeTimer) {
    if (tier === "settled") state.scopeAwaitingPresentation = scopePresentationIdentity(lane);
    return Promise.resolve(false);
  }
  // A live GPU scope during a drag reads the presented canvas, not the
  // backend's copy, so it does not wait for a save round trip. Waiting put its
  // readback on the GPU beside the next drag frame. The save still runs at
  // release and in the settled pass, and a CPU scope still saves first.
  const liveGpuScope = tier === "interactive" && gpuScopeEligible(lane);
  if (tier === "interactive" && generation !== null && !liveGpuScope && cpuMicroPreviewSelected(lane)) {
    return Promise.resolve(false);
  }
  if (state.globalEditDirty && !liveGpuScope) {
    // A deferred or rejected sync can leave edits dirty. Retrying it in a
    // resolved-Promise loop starves input and grows the heap until V8 OOMs.
    const workGeneration = state.gradeWorkGeneration;
    return syncGlobalEditState().then((applied) => workGeneration === state.gradeWorkGeneration && applied && !state.globalEditDirty
      ? refreshScopes(longEdge, { tier, generation, lane })
      : false);
  }
  // Scheduler generations and direct refreshes originate in different
  // counters. Normalize both into one strictly increasing presentation serial
  // so an older response can never become current again.
  const requestGeneration = Math.max(state.scopeGeneration + 1, generation ?? 0);
  state.scopeGeneration = requestGeneration;
  cancelGpuScopeRequests();
  const mode = state.scopeMode;
  const resolution = mode === "waveform"
    ? waveformRequestResolution(tier)
    : mode === "vectorscope" ? vectorscopeRequestResolution(tier)
      : { bins: 256, columns: 256 };
  const effectiveLongEdge = window.HDRWholeImagePreviewPipe.edgeFor("scopes",
    mode === "waveform" ? waveformScopeLongEdge(tier, longEdge) : longEdge);
  const includeLocals = !localsBypassed();
  const scopeRegion = activeScopeRegion();

  const request = {
    sessionId: state.session.session_id,
    presentation: scopePresentationIdentity(lane),
    importGeneration: state.importGeneration,
    rawRedevelopGeneration: state.rawRedevelopGeneration,
    lane,
    mode,
    quality: state.scopeQuality,
    channelMode: state.scopeChannelMode,
    tier,
    generation: requestGeneration,
    longEdge: effectiveLongEdge,
    resolution,
    maxNits: state.scopeMaxNits,
    edit_revision: state.editRevision,
    include_locals: includeLocals,
    localAdjustments: state.localPreviewDirty && includeLocals
      ? JSON.parse(JSON.stringify(localAdjustments()))
      : null,
    scopeRegion,
    microGrain: microGrainPreviewRequest(lane),
    resolve: null,
    controller: null,
  };

  const useGpu = gpuScopeEligible(lane);
  const canvasVisible = !useGpu && els.previewCanvas.style.display !== "none";
  const imageVisible = !useGpu && els.previewImage && els.previewImage.style.display !== "none";
  if (!useGpu && !scopePresentationMatches(state.acceptedPresentation, lane)
    && ((canvasVisible && (gpuPreviewEligible(lane) || state.acceptedPresentation?.execution === "cpu-viewport"))
      || (cpuMicroPreviewSelected(lane) && (canvasVisible || imageVisible)))
    && !state.comparePeekActive
    && state.activeWorkflow !== "proof") {
    // The grading render owns source identity. Keep the last scope until the
    // matching picture arrives; a scheduler gesture already owns its settle.
    if (tier === "interactive" && generation !== null) return Promise.resolve(false);
    state.scopeAwaitingPresentation = request.presentation;
    markScopeUpdating();
    return Promise.resolve(false);
  }

  const pending = state.scopeAwaitingPresentation;
  if (tier === "settled" && pending?.sessionId === request.sessionId && pending.lane === lane) {
    state.scopeAwaitingPresentation = null;
  }
  if (useGpu) return enqueueGpuScopeRequest(request);
  return new Promise((resolve) => {
    enqueueScopeRequest({ ...request, resolve });
  });
}

function scopePresentationIdentity(lane) {
  const settings = state.denoise?.[lane];
  return {
    sessionId: state.session?.session_id,
    lane,
    generation: state.previewGeneration[lane],
    geometrySignature: geometrySignature(),
    gradeSourceIdentity: gradeSourceIdentity(lane),
    denoiseEnabled: Boolean(settings?.enabled),
    denoiseMethod: settings?.enabled ? settings.controls?.method : undefined,
    denoiseOriginal: Boolean(settings?.enabled && state.denoiseRuntime?.[lane]?.showOriginal),
    microKey: settings?.enabled ? microGrainPreviewKey(lane) : null,
    repairSourceGeneration: state.repairSourceGeneration || 0,
    rawSettingsKey: JSON.stringify(state.editDocument?.source?.raw_import_settings ?? null),
  };
}

function scopePresentationMatches(presentation, lane) {
  const current = scopePresentationIdentity(lane);
  return Boolean(current.sessionId && lane === state.currentView && presentation
    && Object.keys(current).every((key) => presentation[key] === current[key]));
}

function refreshScopesAfterPresentation(lane) {
  if (state.zoomScopeTimer || !scopePresentationMatches(state.scopeAwaitingPresentation, lane)
    || !scopePresentationMatches(state.acceptedPresentation, lane)) return;
  void refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane });
}

function gpuScopeEligible(lane) {
  return Boolean(
    state.gpuPreview?.available
    && scopePresentationMatches(state.acceptedPresentation, lane)
    && state.acceptedPresentation?.transport === "WebGPU"
    && Number.isInteger(state.acceptedPresentation?.sourceSerial)
    && els.previewCanvas.style.display !== "none"
    && !state.comparePeekActive
    && state.activeWorkflow !== "proof"
  );
}

async function runGpuScopeRequest(request) {
  const { lane, mode, tier, generation, resolution, maxNits, scopeRegion } = request;
  const signal = request.controller?.signal;
  const widthLimit = tier === "interactive"
    ? state.scopeQuality === "performance" ? 192 : state.scopeQuality === "reference" ? 384 : 320
    : state.scopeQuality === "performance" ? 384 : state.scopeQuality === "reference" ? 768 : 640;
  const sampleWidth = Math.max(64, Math.min(widthLimit, resolution.columns));
  const sampleHeight = tier === "interactive"
    ? state.scopeQuality === "performance" ? 128 : state.scopeQuality === "reference" ? 256 : 192
    : state.scopeQuality === "performance" ? 256 : state.scopeQuality === "reference" ? 512 : 384;
  // A live scope never shares the GPU with a drag frame. The scheduler
  // starts it in the gap after a frame; if a frame has started since, this
  // pass stands down and the next one (at most 100 ms later) runs instead.
  if (tier === "interactive" && state.previewScheduler?.frameInFlight) {
    state.previewScheduler.recordStaleResult();
    return false;
  }
  const accepted = state.acceptedPresentation;
  const isCurrent = () => !signal?.aborted && scopePresentationMatches(request.presentation, lane)
    && scopePresentationMatches(state.acceptedPresentation, lane)
    && request.importGeneration === state.importGeneration
    && request.rawRedevelopGeneration === state.rawRedevelopGeneration
    && (accepted?.execution === "tiled" || state.acceptedPresentation?.sourceSerial === accepted?.sourceSerial)
    && accepted?.generation === state.previewGeneration[lane]
    && generation === state.scopeGeneration
    && !state.zoomScopeTimer
    && request.sessionId === state.session?.session_id
    && lane === state.currentView && mode === state.scopeMode;
  if (!isCurrent()) return false;
  markScopeUpdating();
  let scopeCanvas = els.previewCanvas;
  let sourceSerial = accepted?.sourceSerial;
  if (accepted?.execution === "tiled") {
    // A tiled canvas retains only the viewport. Its scopes still describe the
    // entire picture, so grade a bounded proxy on a separate GPU canvas after
    // settlement. Live input keeps the last scope until its settled request;
    // it never starts an extra grading graph beside the gesture's tiles.
    if (tier === "interactive") return false;
    let sourceConflictRevision = null;
    const renderProxy = async () => {
      if (!isCurrent()) return null;
      cancelGeometryUnderlayer();
      while (isCurrent() && (state.gpuDraftInFlight || state.gpuPreview.activeRenderCount > 0)) {
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
      if (!isCurrent()) return null;
      const revision = state.editRevision;
      return state.gpuPreview.renderScopeProxy(
        request.sessionId, lane, state.adjustments, sampleCurvePoints,
        request.longEdge, request.include_locals ? localAdjustments() : [],
        revision, projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        { applicationGeneration: accepted.generation, isCurrent, signal, cancelCoarseFetches: true },
      ).catch((error) => {
        // A newer generation stopping this one's source load is not a failure;
        // the scope that replaces it is already on its way.
        // A save can reach the backend before its revision reaches this browser.
        // Retry only if the acknowledgement leaves the picture identity intact.
        if (error?.status === 409) { sourceConflictRevision = revision; return null; }
        if (error?.superseded || !isCurrent() || revision !== state.editRevision) return null;
        throw error;
      });
    };
    const startedAt = performance.now();
    let rendered = await renderProxy();
    if (!isCurrent()) return false;
    const refusal = state.gpuPreview.lastRenderRefusal;
    if (sourceConflictRevision !== null) {
      await state.editCommandQueue;
      if (!isCurrent() || state.editRevision === sourceConflictRevision) return false;
      sourceConflictRevision = null;
      rendered = await renderProxy();
    } else if (!rendered && refusal?.at >= startedAt && String(refusal.reason).startsWith("superseded")) {
      // A same-generation pan can take this pass's masks without replacing the scope.
      rendered = await renderProxy();
    }
    if (!isCurrent() || sourceConflictRevision !== null) return false;
    if (!rendered) {
      // The accepted tiled picture is current, but an auxiliary GPU graph
      // can still be refused under memory pressure. Keep the same generation
      // guards and settle through the established CPU scope fallback.
      return new Promise(resolve => enqueueScopeRequest({ ...request, edit_revision: state.editRevision, signal, resolve }));
    }
    scopeCanvas = rendered.canvas;
    sourceSerial = rendered.sourceSerial;
  }
  const analysis = await state.gpuPreview.analyzeScope(scopeCanvas, {
    width: sampleWidth,
    height: sampleHeight,
    generation,
    tier,
  });
  // A saturated two-buffer readback pool is intentional backpressure. Keep
  // the last valid scope visible and let the next scheduled generation win;
  // never fall back to an image-sized CPU request merely because the GPU is busy.
  if (!analysis) return false;
  if (analysis.sessionId !== request.sessionId
    || analysis.sourceSerial !== sourceSerial
    || analysis.applicationGeneration !== accepted?.generation
    || accepted?.generation !== state.previewGeneration[lane]
    || analysis.geometrySignature !== accepted?.geometrySignature
    || generation !== state.scopeGeneration
    || lane !== state.currentView
    || mode !== state.scopeMode
    || request.sessionId !== state.session?.session_id
    || !isCurrent()) {
    state.previewScheduler?.recordStaleResult();
    return false;
  }
  // The peak is the one scope number a delivery decision is made on, so on a
  // settled read it uses bounded peak evidence rather than just the proxy
  // the rest of the scope is drawn from. Only settled: during a drag the
  // proxy peak is the right trade, and it is labelled as such.
  let exactPeak = null;
  if (tier === "settled" && !scopeRegion) {
    exactPeak = await measureExactScopePeak({ lane, signal });
    // The measurement is a render of its own and takes time. Anything that
    // moved underneath it invalidates this payload exactly as it would have
    // above, so the same question is asked again rather than presenting a
    // number against a generation that is no longer on screen.
    if (generation !== state.scopeGeneration
      || lane !== state.currentView
      || state.previewGeneration[lane] !== accepted?.generation
      || !isCurrent()) {
      state.previewScheduler?.recordStaleResult();
      return false;
    }
  }
  const payload = buildGpuScopePayload(analysis, {
    lane,
    mode,
    tier,
    generation,
    bins: resolution.bins,
    columns: resolution.columns,
    maxNits,
    scopeRegion,
    exactPeak,
  });
  applyEditingScopePeak(payload, exactPeak, lane);
  recordDisplayedScopePeak(payload, request);
  presentScopePayload(payload, { generation, tier, lane, mode, source: "gpu", metric: analysis.metric });
  return true;
}

function cancelGpuScopeRequests() {
  state.gpuScopeRequestInFlight?.controller?.abort();
  state.pendingGpuScopeRequest?.resolve(false);
  state.pendingGpuScopeRequest = null;
}

function rescheduleGpuScopeAfterPan(lane) {
  const sessionId = state.session?.session_id;
  if (![state.gpuScopeRequestInFlight, state.pendingGpuScopeRequest].some((request) => (
    request?.lane === lane && request.sessionId === sessionId && !request.controller?.signal.aborted
  ))) return;
  cancelGpuScopeRequests();
  state.scopeAwaitingPresentation = scopePresentationIdentity(lane);
  clearZoomScopeRefresh();
  scheduleZoomScopeRefresh({ sessionId, lane, generation: state.previewGeneration[lane],
    signature: geometrySignature(), target: requiredProcessingLongEdge() });
}

function enqueueGpuScopeRequest(request) {
  return new Promise((resolve) => {
    const queued = { ...request, resolve };
    if (state.gpuScopeRequestInFlight) {
      state.pendingGpuScopeRequest?.resolve(false);
      state.pendingGpuScopeRequest = queued;
      markScopeUpdating();
      return;
    }
    void runQueuedGpuScopeRequest(queued);
  });
}

async function runQueuedGpuScopeRequest(request) {
  request.controller = new AbortController();
  state.gpuScopeRequestInFlight = request;
  let applied = false;
  try {
    applied = await runGpuScopeRequest(request);
  } catch (error) {
    if (!request.controller.signal.aborted) console.error("GPU scope refresh failed", error);
  } finally {
    request.resolve(applied);
    if (state.gpuScopeRequestInFlight !== request) return;
    state.gpuScopeRequestInFlight = null;
    const next = state.pendingGpuScopeRequest;
    state.pendingGpuScopeRequest = null;
    if (next) void runQueuedGpuScopeRequest(next);
    else if (!applied) restoreScopeFreshnessIfIdle();
  }
}

function enqueueScopeRequest(request) {
  const active = state.scopeRequestInFlight;
  if (!active) {
    void runScopeRequest(request);
    return;
  }

  state.pendingScopeRequest?.resolve(false);
  state.pendingScopeRequest = request;
  markScopeUpdating();

  // The last valid scope remains visible while the newest generation replaces
  // obsolete work. Slow scope computation must never queue in front of input.
  active.controller?.abort();
}

function markScopeUpdating() {
  els.scopeFreshness.textContent = "Updating";
  els.scopeFreshness.classList.add("updating");
}

function scopeFreshnessLabel(tier) {
  return scopeUi.freshnessLabel(tier);
}

function restoreScopeFreshnessIfIdle() {
  if (state.scopeRequestInFlight || state.pendingScopeRequest
    || state.gpuScopeRequestInFlight || state.pendingGpuScopeRequest) return;
  if (els.scopeFreshness.textContent !== "Updating") return;
  els.scopeFreshness.classList.remove("updating");
  if (state.scopeUnavailable && scopePresentationMatches(state.scopeUnavailable, state.currentView)) {
    els.scopeFreshness.textContent = "Unavailable";
  } else {
    const current = !state.scopeResultPresentation || scopePresentationMatches(state.scopeResultPresentation, state.currentView);
    els.scopeFreshness.textContent = state.lastScope && current ? scopeFreshnessLabel(state.lastScope.tier) : "Waiting";
  }
}

async function runScopeRequest(request) {
  let signal = request.signal;
  const isCurrentPresentation = () => !signal?.aborted && !state.zoomScopeTimer && !geometryDraftActive()
    && !["import", "export"].includes(state.activeWorkflow) && !document.hidden
    && scopePresentationMatches(request.presentation, request.lane)
    && request.importGeneration === state.importGeneration
    && request.rawRedevelopGeneration === state.rawRedevelopGeneration
    && request.generation === state.scopeGeneration && request.mode === state.scopeMode;
  const isCurrent = () => isCurrentPresentation() && request.edit_revision === state.editRevision;
  if (!isCurrent()) {
    request.resolve(false);
    restoreScopeFreshnessIfIdle();
    return;
  }
  const controller = new AbortController();
  signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  request.controller = controller;
  state.scopeRequestInFlight = request;
  markScopeUpdating();
  let applied = false;

  try {
    const { sessionId, lane, mode, tier, generation, longEdge, resolution, maxNits, edit_revision, include_locals, localAdjustments: requestLocals, channelMode, scopeRegion } = request;
    const requestedChannels = channelMode === "luma" ? "luma" : "rgb";
    const resolutionQuery = `&bins=${resolution.bins}&columns=${resolution.columns}&channels=${requestedChannels}`;
    const requestScope = (revision) => fetch(`/api/session/${sessionId}/scopes?kind=${lane}&mode=${mode}&long_edge=${longEdge}&max_nits=${maxNits}${resolutionQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edit_revision: revision,
        include_locals,
        local_adjustments: requestLocals,
        long_edge: longEdge,
        generation,
        tier,
        scope_region: scopeRegion,
        ...request.microGrain,
      }),
      signal,
    });
    let response = await requestScope(edit_revision);
    if (response.status === 409) {
      const conflict = await safeJson(response);
      // Latest-state cancellation intentionally uses 409, but it is not an
      // edit conflict. Reloading the committed document here can replace the
      // optimistic slider value in the middle of a gesture and visibly flash
      // both the preview and the next scope back to an older state.
      if (conflict?.detail === "Stale scope request dropped.") return false;
      if (showUnavailableMicroScope(conflict, request, isCurrent)) return false;
      await (state.editCommandQueue || Promise.resolve());
      if (!isCurrentPresentation()) return false;
      if (state.editRevision === edit_revision) {
        await refreshEditState({ preserveLocalDraft: state.localPreviewDirty });
      }
      request.edit_revision = state.editRevision;
      if (!isCurrent()) return false;
      response = await requestScope(request.edit_revision);
    }
    if (!response.ok) {
      if (!isCurrent()) return false;
      if (response.status === 409 && showUnavailableMicroScope(await safeJson(response), request, isCurrent)) return false;
      if (!isCurrent()) return false;
      els.scopeNote.textContent = `The ${mode} could not be refreshed. It will retry with the next edit.`;
      return false;
    }
    const payload = await response.json();
    if (!isCurrent()) return false;
    if (payload.generation !== null && payload.generation !== generation) return false;
    if (payload.micro_source_long_edge != null) {
      applyEditingScopePeak(payload, null, lane);
    } else if (tier === "settled" && !request.scopeRegion) {
      const measured = await measureExactScopePeak({lane, signal});
      if (!isCurrent()) return false;
      applyEditingScopePeak(payload, measured, lane);
    }
    applyAcceptedCpuScopePeak(payload, request);
    recordDisplayedScopePeak(payload, request);
    presentScopePayload(payload, { generation, tier, lane, mode, source: "cpu",
      metric: { applicationGeneration: request.presentation.generation } });
    applied = true;
    return true;
  } catch (error) {
    if (!signal.aborted && error.name !== "AbortError") console.error(error);
    return false;
  } finally {
    if (state.scopeRequestInFlight === request) state.scopeRequestInFlight = null;
    request.resolve(applied);
    const next = state.pendingScopeRequest;
    state.pendingScopeRequest = null;
    if (next) {
      void runScopeRequest(next);
    } else if (!applied) restoreScopeFreshnessIfIdle();
  }
}

function showUnavailableMicroScope(error, request, isCurrent) {
  if (error?.detail?.code !== "micro_scope_source_unavailable") return false;
  if (!isCurrent()) return true;
  state.scopeUnavailable = request.presentation;
  state.lastScope = null;
  els.scopeFreshness.textContent = "Unavailable";
  els.scopeFreshness.classList.remove("updating");
  drawHistogram(null);
  updateExportAvailability();
  return true;
}

function applyAcceptedCpuScopePeak(payload, request) {
  const accepted = state.acceptedPresentation;
  if (payload?.peak_exact === false || request.scopeRegion || payload?.preview_kind !== "hdr"
    || accepted?.transport === "WebGPU" || accepted?.lane !== request.lane
    || accepted?.generation !== state.previewGeneration[request.lane]
    || accepted?.geometrySignature !== geometrySignature() || !accepted?.exact
    || !Number.isFinite(accepted?.scopePeak)) return;
  const peak = accepted.scopePeak;
  payload.peak_value = peak;
  payload.peak_exact = false;
  payload.peak_measured_long_edge = accepted.processedLongEdge;
  if (Array.isArray(payload.stats) && payload.stats.length) {
    payload.stats[0] = {
      label: "Peak (preview)",
      value: peak >= 1000 ? `${peak.toFixed(0)} nit` : peak >= 99.995 ? `${peak.toFixed(1)} nit` : `${peak.toFixed(2)} nit`,
    };
  }
}

function applyEditingScopePeak(payload, measured, lane) {
  if (!Number.isFinite(measured?.peak)) {
    // A refused bounded measurement leaves only the proxy's scope value.
    // It must not inherit the label reserved for the measured estimate.
    payload.peak_exact = false;
    if (payload.stats?.length) payload.stats[0] = {...payload.stats[0], label: "Peak (preview)"};
    return;
  }
  const peak = lane === "hdr" ? measured.peak / .18 * projectReferenceWhiteNits() : measured.peak;
  payload.peak_value = peak;
  payload.peak_exact = false;
  payload.peak_measured_long_edge = measured.longEdge;
  if (payload.stats?.length) payload.stats[0] = {
    label: "Peak (estimate)",
    value: lane === "hdr" ? `${peak >= 1000 ? peak.toFixed(0) : peak.toFixed(1)} nit` : `${(peak*100).toFixed(1)}%`,
  };
}

function recordDisplayedScopePeak(payload, { tier, lane, scopeRegion }) {
  // Compare delivery with the full-image number the owner actually saw,
  // including a preview-only fallback after bounded measurement was refused.
  // A live drag or a selected scope region is not delivery evidence.
  if (tier !== "settled" || scopeRegion || !Number.isFinite(payload?.peak_value)) return;
  const peak = lane === "hdr" ? payload.peak_value * .18 / projectReferenceWhiteNits() : payload.peak_value;
  recordEditingMeasurement(lane, { peak });
}

function editingMeasurementRecipe() {
  return JSON.stringify([state.session?.session_id, state.editRevision, state.adjustments, localAdjustments(),
    state.denoise, state.editDocument?.sdr_match, localsBypassed()]);
}

function recordEditingMeasurement(lane, values) {
  state.editingMeasurementEvidence ||= {};
  const recipe = editingMeasurementRecipe();
  const previous = state.editingMeasurementEvidence[lane];
  state.editingMeasurementEvidence[lane] = {recipe, values:{...(previous?.recipe === recipe ? previous.values : {}), ...values}};
}

function editingMeasurementsForDelivery() {
  const recipe = editingMeasurementRecipe();
  return Object.fromEntries(Object.entries(state.editingMeasurementEvidence || {})
    .filter(([,evidence]) => evidence.recipe === recipe && !localsBypassed())
    .map(([lane,evidence]) => [lane,evidence.values]));
}

function waveformRequestResolution(tier) {
  const width = Math.max(1, els.histogram.clientWidth);
  if (state.scopeQuality === "performance") {
    return {
      columns: Math.round(clamp(width / 2, 320, 384)),
      bins: tier === "interactive" ? 64 : tier === "refinement" ? 160 : 128,
    };
  }
  if (state.scopeQuality === "reference") {
    return {
      columns: Math.round(tier === "interactive" ? clamp(width * 0.7, 512, 640) : clamp(width, 768, 1024)),
      bins: tier === "interactive" ? 128 : 384,
    };
  }
  return {
    columns: Math.round(tier === "interactive" ? clamp(width * 0.55, 384, 512) : clamp(width * 0.75, 512, 768)),
    bins: tier === "interactive" ? 96 : 256,
  };
}

function waveformScopeLongEdge(tier, requestedLongEdge) {
  const profile = scopeQualityProfile();
  if (tier === "interactive") return Math.min(requestedLongEdge, profile.interactiveEdge);
  if (tier === "refinement") return Math.min(requestedLongEdge, profile.refinementEdge);
  return Math.min(requestedLongEdge, profile.settledEdge);
}

function vectorscopeRequestResolution(tier) {
  return scopeUi.requestResolution(tier, state.scopeQuality);
}

function scopeQualityProfile() {
  return scopeUi.qualityProfile(SCOPE_QUALITY_PROFILES, state.scopeQuality, DEFAULT_SCOPE_QUALITY);
}

function presentScopePayload(payload, { generation, tier, lane, mode, source, metric = null }) {
  state.scopeUnavailable = null;
  state.scopeResultPresentation = scopePresentationIdentity(lane);
  state.lastScope = payload;
  els.scopeFreshness.textContent = scopeFreshnessLabel(tier);
  els.scopeFreshness.classList.remove("updating");
  drawHistogram(payload);
  renderDockSummary();
  updateExportAvailability();
  const scopeFingerprint = payload.channels.reduce((total, channel, channelIndex) => {
    const channelWeight = channelIndex + 1;
    const binTotal = (channel.bins || []).reduce(
      (sum, value, index) => sum + value * (index + 1) * channelWeight,
      0,
    );
    const gridTotal = (channel.grid || []).reduce(
      (sum, row, rowIndex) => sum + row.reduce(
        (rowSum, value, columnIndex) => rowSum + value * (rowIndex + columnIndex + 2) * channelWeight,
        0,
      ),
      0,
    );
    return total + binTotal + gridTotal;
  }, 0);
  window.dispatchEvent(new CustomEvent("hdrfinisher:scope-presented", {
    detail: {
      generation,
      tier,
      lane,
      mode,
      source,
      metric,
      peakValue: payload.peak_value,
      fingerprint: scopeFingerprint,
      presentedAt: performance.now(),
    },
  }));
}

function buildGpuScopePayload(analysis, options) {
  return scopeAnalysis.buildGpuScopePayload(analysis, {
    ...options,
    channelMode: state.scopeChannelMode,
    referenceWhite: projectReferenceWhiteNits(),
  });
}

