function scopeLongEdge(tier) {
  // Interactive scopes favor visible motion; the settled pass restores the
  // denser authoring result immediately after the drag ends.
  const profile = scopeQualityProfile();
  if (tier === "interactive") return Math.min(profile.interactiveEdge, interactiveProxyLongEdge());
  if (tier === "refinement") return Math.min(profile.refinementEdge, refinementProxyLongEdge());
  return Math.min(profile.settledEdge, settledProxyLongEdge());
}

function refreshScopes(longEdge = 960, { tier = "settled", generation = null, lane = state.currentView } = {}) {
  if (!state.session || geometryDraftActive()) return Promise.resolve(false);
  // Scopes describe the lane on screen. A request left over from the lane just
  // switched away from could only be a whole-picture CPU grade, and its answer
  // is discarded on arrival.
  if (lane !== state.currentView) return Promise.resolve(false);
  // A live GPU scope during a drag reads the presented canvas, not the
  // backend's copy, so it does not wait for a save round trip. Waiting put its
  // readback on the GPU beside the next drag frame. The save still runs at
  // release and in the settled pass, and a CPU scope still saves first.
  const liveGpuScope = tier === "interactive" && gpuScopeEligible(lane);
  if (state.globalEditDirty && !liveGpuScope) {
    // A deferred or rejected sync can leave edits dirty. Retrying it in a
    // resolved-Promise loop starves input and grows the heap until V8 OOMs.
    return syncGlobalEditState().then((applied) => applied && !state.globalEditDirty
      ? refreshScopes(longEdge, { tier, generation, lane })
      : false);
  }
  // Scheduler generations and direct refreshes originate in different
  // counters. Normalize both into one strictly increasing presentation serial
  // so an older response can never become current again.
  const requestGeneration = Math.max(state.scopeGeneration + 1, generation ?? 0);
  state.scopeGeneration = requestGeneration;
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
    resolve: null,
    controller: null,
  };

  if (gpuScopeEligible(lane)) {
    return enqueueGpuScopeRequest(request);
  }
  if (gpuPreviewEligible(lane)
    && lane === state.currentView
    && els.previewCanvas.style.display !== "none"
    && !state.comparePeekActive
    && state.activeWorkflow !== "proof") {
    // The grading render owns source identity. Never analyze the previous
    // WebGPU texture under a newer edit generation; retain the last valid scope
    // with Updating until the matching preview has actually been presented.
    markScopeUpdating();
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    enqueueScopeRequest({ ...request, resolve });
  });
}

function gpuScopeEligible(lane) {
  return Boolean(
    state.gpuPreview?.available
    && lane === state.currentView
    && state.acceptedPresentation?.lane === lane
    && state.acceptedPresentation?.transport === "WebGPU"
    && state.acceptedPresentation?.generation === state.previewGeneration[lane]
    && state.acceptedPresentation?.geometrySignature === geometrySignature()
    && Number.isInteger(state.acceptedPresentation?.sourceSerial)
    && els.previewCanvas.style.display !== "none"
    && !state.comparePeekActive
    && state.activeWorkflow !== "proof"
  );
}

async function runGpuScopeRequest(request) {
  const { lane, mode, tier, generation, resolution, maxNits, scopeRegion } = request;
  markScopeUpdating();
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
  const isCurrent = () => state.acceptedPresentation?.lane === lane
    && state.acceptedPresentation?.generation === accepted?.generation
    && state.acceptedPresentation?.geometrySignature === accepted?.geometrySignature
    && (accepted?.execution === "tiled" || state.acceptedPresentation?.sourceSerial === accepted?.sourceSerial)
    && accepted?.generation === state.previewGeneration[lane]
    && generation === state.scopeGeneration
    && request.sessionId === state.session?.session_id
    && lane === state.currentView && mode === state.scopeMode;
  let scopeCanvas = els.previewCanvas;
  let sourceSerial = accepted?.sourceSerial;
  if (accepted?.execution === "tiled") {
    // A tiled canvas retains only the viewport. Its scopes still describe the
    // entire picture, so grade a bounded proxy on a separate GPU canvas after
    // settlement. Live input keeps the last scope until its settled request;
    // it never starts an extra grading graph beside the gesture's tiles.
    if (tier === "interactive") return false;
    const renderProxy = async () => {
      while (isCurrent() && (state.gpuDraftInFlight || state.gpuPreview.activeRenderCount > 0)) {
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
      if (!isCurrent()) return null;
      return state.gpuPreview.renderScopeProxy(
        request.sessionId, lane, state.adjustments, sampleCurvePoints,
        request.longEdge, request.include_locals ? localAdjustments() : [],
        request.edit_revision, projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        { applicationGeneration: accepted.generation, isCurrent },
      ).catch((error) => {
        // A newer generation stopping this one's source load is not a failure;
        // the scope that replaces it is already on its way.
        if (error?.superseded || !isCurrent() || request.edit_revision !== state.editRevision) return null;
        throw error;
      });
    };
    const startedAt = performance.now();
    let rendered = await renderProxy();
    if (!isCurrent()) return false;
    // A pan or catch-up pass of the same generation can start meanwhile and
    // take this pass's masks. That is not the GPU refusing the scope, and no
    // later request replaces it: wait for that pass and ask once more.
    const refusal = state.gpuPreview.lastRenderRefusal;
    if (!rendered && refusal?.at >= startedAt && String(refusal.reason).startsWith("superseded")) {
      rendered = await renderProxy();
    }
    if (!isCurrent()) return false;
    if (!rendered) {
      // The accepted tiled picture is current, but an auxiliary GPU graph
      // can still be refused under memory pressure. Keep the same generation
      // guards and settle through the established CPU scope fallback.
      return new Promise(resolve => enqueueScopeRequest({...request,resolve}));
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
    exactPeak = await measureExactScopePeak({ lane });
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
  state.gpuScopeRequestInFlight = request;
  let applied = false;
  try {
    applied = await runGpuScopeRequest(request);
  } finally {
    request.resolve(applied);
    if (state.gpuScopeRequestInFlight !== request) return;
    state.gpuScopeRequestInFlight = null;
    const next = state.pendingGpuScopeRequest;
    state.pendingGpuScopeRequest = null;
    if (next) void runQueuedGpuScopeRequest(next);
    else if (!state.scopeRequestInFlight && gpuScopeEligible(state.currentView)) {
      els.scopeFreshness.classList.remove("updating");
      if (!applied) els.scopeFreshness.textContent = state.lastScope ? scopeFreshnessLabel(state.lastScope.tier) : "Waiting";
    }
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

async function runScopeRequest(request) {
  const controller = new AbortController();
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
      }),
      signal: controller.signal,
    });
    let response = await requestScope(edit_revision);
    if (response.status === 409) {
      const conflict = await safeJson(response);
      // Latest-state cancellation intentionally uses 409, but it is not an
      // edit conflict. Reloading the committed document here can replace the
      // optimistic slider value in the middle of a gesture and visibly flash
      // both the preview and the next scope back to an older state.
      if (conflict?.detail === "Stale scope request dropped.") return false;
      await (state.editCommandQueue || Promise.resolve());
      if (state.editRevision === edit_revision) {
        await refreshEditState({ preserveLocalDraft: state.localPreviewDirty });
      }
      if (state.session?.session_id !== sessionId || lane !== state.currentView || mode !== state.scopeMode) return false;
      request.edit_revision = state.editRevision;
      response = await requestScope(state.editRevision);
    }
    if (!response.ok) {
      els.scopeNote.textContent = `The ${mode} could not be refreshed. It will retry with the next edit.`;
      return false;
    }
    const payload = await response.json();
    if (state.session?.session_id !== sessionId || lane !== state.currentView || mode !== state.scopeMode) return false;
    if (payload.generation !== null && payload.generation !== generation) return false;
    if (generation !== state.scopeGeneration) {
      state.previewScheduler?.recordStaleResult();
      return false;
    }
    if (tier === "settled" && !request.scopeRegion) {
      const measured = await measureExactScopePeak({lane});
      if (generation !== state.scopeGeneration || request.sessionId !== state.session?.session_id) return false;
      applyEditingScopePeak(payload, measured, lane);
    }
    applyAcceptedCpuScopePeak(payload, request);
    recordDisplayedScopePeak(payload, request);
    presentScopePayload(payload, { generation, tier, lane, mode, source: "cpu" });
    applied = true;
    return true;
  } catch (error) {
    if (error.name !== "AbortError") console.error(error);
    return false;
  } finally {
    if (state.scopeRequestInFlight === request) state.scopeRequestInFlight = null;
    request.resolve(applied);
    const next = state.pendingScopeRequest;
    state.pendingScopeRequest = null;
    if (next) {
      void runScopeRequest(next);
    } else {
      els.scopeFreshness.classList.remove("updating");
      if (!applied) els.scopeFreshness.textContent = state.lastScope ? scopeFreshnessLabel(state.lastScope.tier) : "Waiting";
    }
  }
}

function applyAcceptedCpuScopePeak(payload, request) {
  const accepted = state.acceptedPresentation;
  if (payload?.peak_exact === false || !state.scopeExactPeak || request.scopeRegion || payload?.preview_kind !== "hdr"
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

