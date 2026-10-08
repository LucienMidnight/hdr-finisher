function gpuPreviewEligible(lane = state.currentView) {
  return state.renderingMode !== "cpu"
    && Boolean(state.gpuPreview?.available)
    && state.gpuPreview.supportsLocalAdjustments(lane, state.compareWithoutLocals ? [] : localAdjustments());
}

/** @returns {PreviewResolution} */
function previewNeedsRefinement() {
  const accepted = state.acceptedPresentation;
  return !selectedTierReady()
    || accepted?.generation !== state.previewGeneration[state.currentView]
    || accepted?.geometrySignature !== geometrySignature()
    || accepted?.processedLongEdge !== requiredProcessingLongEdge();
}

/**
 * @typedef {"ready"|"updating"|"preparing"|"unavailable"} ViewerStatus
 */

/**
 * The four viewer states are derived, never stored. A stored status drifts out
 * of agreement with the image on screen; a derived one is always a statement
 * about the presentation the viewer can actually see.
 *
 * `detail` says why the viewer is not Ready: the reason it is unavailable,
 * or "geometry" when what is outstanding is a crop or rotation rather than a
 * grading change. Both are derived from the same snapshot; neither is stored.
 *
 * @returns {{ status: ViewerStatus, tier: PreviewResolution, presentedTier: PreviewResolution|null, detail: string }}
 */
function deriveViewerState({
  requestedTier,
  accepted,
  currentGeneration,
  lane,
  geometrySignature: currentGeometrySignature,
  requiredProcessingEdge = null,
  unavailableReason = "",
} = {}) {
  const tier = requestedTier === "display" ? "display"
    : PREVIEW_RESOLUTION_OPTIONS.has(requestedTier) ? requestedTier : DEFAULT_PREVIEW_RESOLUTION;
  const laneMatches = Boolean(accepted) && accepted.lane === lane;
  const presentedTier = laneMatches ? (accepted.tier || null) : null;
  if (unavailableReason) return { status: "unavailable", tier, presentedTier, detail: unavailableReason };
  // The selected tier owns the viewer only once it has produced an exact
  // result of its own. Anything else is still a placeholder, however good it
  // looks, and must be labeled as one.
  const selectedTierAccepted = laneMatches && accepted.exact === true && accepted.requestedTier === tier;
  if (!selectedTierAccepted) return { status: "preparing", tier, presentedTier, detail: "",
    coarse: Boolean(laneMatches && accepted.coarse && accepted.generation === currentGeneration) };
  const geometryCurrent = accepted.geometrySignature === currentGeometrySignature;
  const scaleCurrent = requiredProcessingEdge == null
    || accepted.processedLongEdge === requiredProcessingEdge;
  const current = accepted.generation === currentGeneration && geometryCurrent && scaleCurrent;
  // A geometry change is the slow one -- it invalidates the source proxy, so
  // the whole frame is fetched and re-rolled rather than re-graded. Saying so
  // is the difference between a viewer that looks busy and one that looks
  // stuck.
  return { status: current ? "ready" : "updating", tier, presentedTier,
    detail: !geometryCurrent ? "geometry" : !scaleCurrent ? "scale" : "" };
}

function viewerState(lane = state.currentView) {
  return deriveViewerState({
    requestedTier: state.previewResolutionOverride === false ? "display" : normalizedPreviewResolution(),
    accepted: state.acceptedPresentation,
    currentGeneration: state.previewGeneration[lane],
    lane,
    geometrySignature: geometrySignature(),
    requiredProcessingEdge: requiredProcessingLongEdge(),
    unavailableReason: state.previewUnavailableReason || "",
  });
}

function viewerStatusLabel(viewer = viewerState()) {
  const tierLabel = previewResolutionLabel(viewer.tier);
  if (viewer.status === "unavailable") {
    return `${tierLabel} unavailable${viewer.detail ? ` — ${viewer.detail}` : ""}`;
  }
  if (viewer.status === "preparing") {
    if (viewer.coarse) return `Coarse — refining to ${tierLabel}`;
    const showing = viewer.presentedTier
      ? ` — showing previous ${previewResolutionLabel(viewer.presentedTier)} result`
      : "";
    return `Preparing ${tierLabel}${showing}`;
  }
  if (viewer.status === "updating") {
    if (viewer.detail === "geometry") return `Applying crop & rotation — ${tierLabel}`;
    if (viewer.detail === "scale") return `Preparing view — ${tierLabel}`;
    return `Updating — ${tierLabel}`;
  }
  return `Ready — ${tierLabel}`;
}

function renderViewerStatus() {
  const viewer = viewerState();
  const label = state.perspectiveApplyOperation && state.perspectivePhase === "applying"
    ? `Applying perspective — ${previewResolutionLabel(viewer.tier)}`
    : state.perspectiveMode ? "Perspective draft — Apply or Cancel" : viewerStatusLabel(viewer);
  if (els.previewQualityStatus) els.previewQualityStatus.textContent = label;
  // Ready is the quiet state. Active viewer work occupies the same fixed status
  // slot as import/render progress instead of opening a second row beneath it.
  state.viewerTierStatusEntry = viewer.status === "ready" && !state.perspectiveMode
    && !(state.perspectiveApplyOperation && state.perspectivePhase === "applying") ? null : {
    nodeId: "viewer-tier-status",
    severity: viewer.status === "unavailable" ? "error" : "progress",
    message: label,
  };
  syncViewerStatusEntry();
  return viewer;
}

function selectedTierReady(lane = state.currentView) {
  // PRD 2.2: after the selected tier has produced a valid result, interaction
  // keeps processing at that resolution. It never drops to a smaller proxy and
  // then jumps back up once the control settles.
  const accepted = state.acceptedPresentation;
  return Boolean(accepted
    && accepted.lane === lane
    && accepted.exact === true
    && accepted.requestedTier === (state.previewResolutionOverride === false ? "display" : normalizedPreviewResolution()));
}

function applyPreviewResolution(value, { schedule = true } = {}) {
  const previous = `${state.previewResolutionOverride}:${state.previewResolution}`;
  state.previewResolutionOverride = value !== "auto";
  if (state.previewResolutionOverride) state.previewResolution = normalizedPreviewResolution(value);
  if (previous !== `${state.previewResolutionOverride}:${state.previewResolution}`) state.previewUnavailableReason = "";
  if (previous !== `${state.previewResolutionOverride}:${state.previewResolution}`) {
    // The denoise selector is bound to one long edge -- its identity contains
    // it -- and the renderer pins every render to the retained original's edge
    // so that live denoise controls keep hitting the evidence they were
    // analysed against. That pin outranks the requested tier, so leaving a
    // selector from the outgoing tier in place made this selector inert: the
    // renderer was asked for 1024 and kept returning the 7968 frame, while the
    // viewer reported "Ready - 1K" over it.
    //
    // A tier change invalidates a resolution-bound cache by definition, the
    // same way a lane change does where renderPreviewForLane already evicts.
    state.gpuPreview?.evictDenoiseCache?.();
  }
  // PRD 8: changing tiers must not reset the GPU session or clear the current
  // preview. Proxy levels are keyed by long edge and trimmed by the renderer's
  // own LRU, so the outgoing tier is retired only when the budget requires it.
  if (state.denoise?.[state.currentView]?.enabled) {
    state.denoiseRuntime[state.currentView].status = "dirty";
    state.denoiseRuntime[state.currentView].dirty = true;
    if (schedule) window.setTimeout(() => recalculateDenoise(), 300);
  }
  if (state.session) {
    invalidatePreview(state.currentView, { markDirty: false });
    if (schedule) debouncePreview(state.currentView);
  }
  renderReadouts();
  renderCurrentPreviewSize();
  renderViewerStatus();
}

function acceptPresentation(lane, schedulerTier, width, height, transport, fallbackReason = "", sourceSerial = null, generation = state.previewGeneration[lane], execution = null, processedLongEdge = null, scopePeak = null, coarse = false) {
  const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
  const requestedTier = state.previewResolutionOverride === false ? "display" : normalizedPreviewResolution();
  // Exactness is a fact about the resolution this frame was processed at, not
  // about how large the picture that came out of it is. Geometry trims the
  // frame: a 1.8 degree straighten at the 4K tier processes every pixel at
  // 4096 and presents 4011. Judging by the presented edge therefore left any
  // straightened or cropped image permanently "Preparing", dropped every
  // gesture back to the bootstrap proxy, and missed the preview cache on each
  // request -- all three of the symptoms reported for a tier change.
  const processedEdge = Number(processedLongEdge) > 0 ? Number(processedLongEdge) : longEdge;
  // `tier` is what this image actually is, not what the user asked for. A
  // bootstrap proxy accepted while the selected tier is still preparing must
  // never be labeled with the selected tier.
  //
  // The test is equality, not "at least". A frame processed above the selected
  // tier is not that tier either: selecting 1K while a Full frame is resident
  // used to satisfy `>=` and report "Ready - 1K" over 7968 pixels of Full.
  // Someone who picks a smaller tier is asking for less work, and saying it
  // happened when it did not is the same lie in the other direction. If a
  // render ever does overshoot, this reports Preparing and the scheduler
  // renders the tier properly, which self-heals instead of misreporting.
  const exact = longEdge > 0 && processedEdge === requiredProcessingLongEdge();
  // The size a Fit view was last processed at: the mask bitmaps of that size
  // are the ones every zoom level reuses (see maskOverviewLongEdge).
  if (state.zoomMode === "fit" && exact) state.fitProcessingLongEdge = processedEdge;
  state.acceptedPresentation = {
    lane,
    generation,
    geometrySignature: geometrySignature(),
    requestedTier,
    tier: exact ? (requestedTier === "display" ? "display"
      : processedEdge === previewTargetLongEdge(requestedTier) ? requestedTier : "native-region") : null,
    exact,
    coarse: Boolean(coarse) && !exact,
    processedLongEdge: processedEdge,
    schedulerTier,
    width: Number(width) || null,
    height: Number(height) || null,
    longEdge,
    transport,
    execution,
    sourceSerial,
    scopePeak: Number.isFinite(scopePeak) ? scopePeak : null,
    fallbackReason,
  };
  // Start the source's measurement once a picture is visible, before Denoise
  // is enabled or the first zoom asks for it. No source upload or reconstruction.
  if (transport === "WebGPU" && state.gpuPreview?.warmDenoiseModel) {
    const native = Math.max(state.session?.source?.width || 0, state.session?.source?.height || 0);
    void state.gpuPreview?.warmDenoiseModel?.(state.session.session_id, "hdr", native);
  }
  if (exact) state.previewUnavailableReason = "";
  if (lane === state.currentView && width && height) {
    if (state.geometryTransformHandoffSignature === geometrySignature()) {
      state.geometryTransformHandoffSignature = null;
      clearRotateDraftTransformProperties();
      clearInteractiveStraightenPreview();
    }
    const sessionId = state.session?.session_id || null;
    state.zoomReferenceFrame = {
      sessionId,
      geometrySignature: geometrySignature(),
      // Proxy resolution can change between interactive, settled, and refined
      // presentations. Preserve the session's display scale while accepting
      // the authoritative aspect ratio of the newly presented geometry.
      longEdge: state.zoomReferenceFrame?.sessionId === sessionId
        ? state.zoomReferenceFrame.longEdge
        : longEdge,
      aspect: Number(width) / Number(height),
    };
    state.geometryPresentationPending = false;
    applyZoomGeometry();
    if (state.adjustments.shared.geometry.perspective_horizontal
      || state.adjustments.shared.geometry.perspective_vertical) void ensureGeometryCoordinateMap();
  }
  renderCurrentPreviewSize();
  renderReadouts();
  finishPerspectivePresentation();
  renderViewerStatus();
  // The coordinator keeps the same record, so its follow-up decisions (pan
  // candidate, catch-up freshness) read one source of truth.
  state.renderCoordinator?.noteAccepted(state.acceptedPresentation);
}

function markPreviewUnavailable(reason) {
  if (state.perspectiveApplyOperation?.signature === geometrySignature()) {
    setPerspectiveStatus(`Perspective saved, but the preview failed: ${reason}. Change preview tier or try again.`, "previewFailed");
  }
  // Unavailable keeps the last valid presentation on screen. It reports that
  // the selected tier could not be produced; it never blanks the viewer.
  state.previewUnavailableReason = String(reason || "").trim() || "Preview failed to render";
  // A geometry commit normally hands its temporary CSS transform to the first
  // accepted authoritative frame. If this tier is truthfully unavailable,
  // that frame will never arrive. End the handoff here so the retained last
  // frame remains usable and the user can select another tier or keep editing.
  if (state.geometryTransformHandoffSignature === geometrySignature()) {
    state.geometryTransformHandoffSignature = null;
    state.geometryPresentationPending = false;
    clearRotateDraftTransformProperties();
    clearInteractiveStraightenPreview();
    applyZoomGeometry();
  }
  renderCurrentPreviewSize();
  renderReadouts();
  renderViewerStatus();
}

function markRefining() {
  renderCurrentPreviewSize();
  renderViewerStatus();
}

function previewExecutionMode() {
  // The four modes in PRD 8. Execution is a renderer decision; it is tracked
  // separately from the tier so neither can be read off the other.
  const accepted = state.acceptedPresentation;
  const gpu = accepted ? accepted.transport === "WebGPU" : Boolean(state.gpuPreview?.available);
  const tiled = accepted ? accepted.execution === "tiled" : state.gpuPreview?.lastRenderPlan?.decision?.mode === "tiled";
  if (!gpu) return "direct-cpu";
  return tiled ? "tiled-gpu" : "direct-gpu";
}

function previewExecutionLabel() {
  const execution = previewExecutionMode();
  const engine = execution === "direct-cpu" ? "CPU" : "GPU";
  const mode = execution === "tiled-gpu" ? "Tiled" : "Direct";
  const budget = state.gpuMemoryBudget === "auto" || state.gpuMemoryBudget === undefined
    ? (window.HDRGpuBudget?.autoLabel?.(state.gpuPreview?.gpuBudget) || "Auto")
    : `${state.gpuMemoryBudget} GiB`;
  if (engine !== "GPU") return `Direct CPU · budget ${budget}`;
  const backoff = state.gpuPreview?.allocationBackoff ? " · allocation backoff" : "";
  return `${mode} GPU · budget ${budget}${backoff}`;
}

/**
 * The Technical readout: what the preview is showing and why, in plain words.
 *
 * Thirteen rows chosen by the owner (ledger 9.6). Everything else, including
 * generations, caches and the controller's state, lives under Diagnostics.
 */
function setGpuSurfaceHdr(lane, active) {
  if (lane === "hdr" || lane === "sdr") state.gpuSurfaceHdrByLane[lane] = Boolean(active);
  state.gpuSurfaceHdr = Boolean(state.gpuSurfaceHdrByLane.hdr);
}

function clearGpuSurfaceHdr() {
  state.gpuSurfaceHdrByLane = { hdr: false, sdr: false };
  state.gpuSurfaceHdr = false;
}

function syncViewerStatusEntry() {
  const next = state.previewStatusEntry || state.viewerTierStatusEntry;
  if (!next) {
    status.clear("viewer");
    return;
  }
  const normalized = {
    id: "viewer",
    ...next,
    actions: state.previewStatusEntry && state.previewCancelVisible
      ? [{ id: "cancel-import", label: "Cancel import", run: cancelActiveImport }]
      : [],
    cancelVisible: Boolean(state.previewStatusEntry && state.previewCancelVisible),
  };
  const current = status.get("viewer");
  if (current
    && current.message === normalized.message
    && current.severity === normalized.severity
    && current.progress === normalized.progress
    && current.nodeId === normalized.nodeId
    && current.cancelVisible === normalized.cancelVisible) return;
  status.post(normalized);
}

function setPreviewMessage(message, progress = 0) {
  state.previewStatusEntry = {
    nodeId: "preview-status",
    copyId: "preview-status-copy",
    progressId: "preview-progress",
    severity: "progress",
    message,
    progress: clamp(Number(progress) || 0, 0, 100),
  };
  syncViewerStatusEntry();
}

function setIndeterminatePreviewMessage(message) {
  state.previewStatusEntry = {
    nodeId: "preview-status",
    copyId: "preview-status-copy",
    progressId: "preview-progress",
    severity: "progress",
    message,
    progress: "indeterminate",
  };
  syncViewerStatusEntry();
}

function setPreviewError(message) {
  if (state.perspectiveApplyOperation?.signature === geometrySignature()) {
    setPerspectiveStatus(`Perspective saved, but the preview failed: ${message}. Change preview tier or try again.`, "previewFailed");
  }
  state.previewStatusEntry = {
    nodeId: "preview-status",
    copyId: "preview-status-copy",
    severity: "error",
    message,
  };
  syncViewerStatusEntry();
}

function hidePreviewMessage() {
  state.previewStatusEntry = null;
  state.previewCancelVisible = false;
  syncViewerStatusEntry();
}

