boot();

async function boot() {
  initializeLocalOverlayColor();
  initializePreviewPreferences();
  initializeInstrumentShell();
  initializePreviewScheduler();
  initializeBoundedTooltips();
  activateWorkflowTab("import", { focus: false });
  await initializeDesktopBridge();
  await initializeApplicationShell();
  initializeGroupPresetControls();
  bindEvents();
  applyExportPreset(els.exportFormat.value, "web_default", { invalidate: false });
  await initializeGpuPreview();
  await loadCapabilities().catch(() => {
    els.capabilitySummary.textContent = "Encoder status unavailable";
    els.capabilitySummary.className = "capability-chip attention";
  });
  await loadDefaultExportDirectory().catch(() => null);
  renderReadouts();
  drawCurveEditor();
  drawToneEqualizerEditor();
  renderOverlayPresetNote();
  renderLaneChrome();
  renderCompareLayout();
  renderControlState();
  renderCapabilities();
  updateExportAvailability();
  setGradeMode("global");
  renderLocalAdjustments();
  window.addEventListener("resize", () => {
    syncOverlayPlacement();
    renderLocalMaskOverlay();
    syncSourceFilenameOverflow();
  });
  observeScopeSize();
  observeGraphEditorSizes();
  observeViewerSize();
}

async function initializeGpuPreview() {
  if (!window.HDRWebGPUPreview) return;
  state.gpuFailurePolicy = window.HDRRenderFailurePolicy ? new window.HDRRenderFailurePolicy() : null;
  state.gpuPreview = new window.HDRWebGPUPreview(els.previewCanvas);
  state.gpuPreview.featherReferenceScale = maskFeatherReferenceScale;
  state.gpuPreview.acknowledgedMaskSignature = acknowledgedMaskSignature;
  // Preferences can load before or after the renderer exists, so apply the
  // stored budget here as well as on every preferences change.
  state.gpuPreview.setMemoryBudget(state.gpuMemoryBudget ?? "auto");
  // Auto is half of the active card's dedicated video memory when the desktop
  // shell can read it; a browser, or a failed read, keeps the 2 GiB fallback.
  const videoMemory = await desktop?.videoMemory?.().catch(() => null);
  state.gpuPreview.setDetectedVideoMemory(videoMemory?.detected ? videoMemory : null);
  await state.gpuPreview.initialize();
  renderGpuMemoryAutoLabel();
  if (!state.gpuPreview.available && state.gpuFailurePolicy) {
    // Initialization failure is the one permanent failure in Section 5.8.
    state.gpuFailurePolicy.record(new Error(state.gpuPreview.detail || "WebGPU initialization failed"), { init: true });
  }
  state.displayInfo.gpu = state.gpuPreview.detail;
}

/**
 * Rebuild the GPU device after device loss, then re-render. Section 5.8 makes
 * device loss recoverable; only a rebuild that cannot initialize is permanent,
 * and that decision is recorded through the failure policy.
 */
async function rebuildGpuPreview(reason = "") {
  if (!state.gpuPreview) return false;
  try {
    const rebuilt = await state.gpuPreview.rebuild();
    if (!rebuilt) {
      state.gpuFailurePolicy?.record(
        new Error(state.gpuPreview.detail || reason || "WebGPU device rebuild failed"),
        { init: true },
      );
      markPreviewUnavailable(`WebGPU device rebuild failed: ${state.gpuPreview.detail || reason}`);
      return false;
    }
    state.gpuRebuildAttempts = 0;
    state.displayInfo.gpu = state.gpuPreview.detail;
    renderReadouts();
    if (state.session) await settlePreview(state.currentView);
    return true;
  } catch (error) {
    state.gpuFailurePolicy?.record(error, { init: true });
    markPreviewUnavailable(`WebGPU device rebuild failed: ${error?.message || error}`);
    return false;
  }
}

function initializeLocalOverlayColor() {
  if (els.localOverlayColorInput) els.localOverlayColorInput.value = state.localOverlayColor;
  if (els.localOverlayColorSwatch) els.localOverlayColorSwatch.style.backgroundColor = state.localOverlayColor;
}

function initializePreviewPreferences() {
  state.previewResolution = DEFAULT_PREVIEW_RESOLUTION;
  state.previewResolutionOverride = false;
  state.fasterDragging = false;
  state.previewLatencyController = window.HDRPreviewLatencyController
    ? new window.HDRPreviewLatencyController() : null;
  state.scopeMaxNits = 4000;
  state.scopeQuality = DEFAULT_SCOPE_QUALITY;
  state.scopeExactPeak = false;
  state.compareLayout = "single";
  if (els.previewFasterDragging) els.previewFasterDragging.checked = state.fasterDragging;
  if (els.scopeZoom) els.scopeZoom.value = String(state.scopeMaxNits);
  if (els.scopeDetail) els.scopeDetail.value = state.scopeQuality;
  if (els.scopeExactPeak) els.scopeExactPeak.checked = state.scopeExactPeak;
}

/**
 * Re-arm a preview that a deliberate retire left with no follow-up.
 *
 * The contract: while the viewer is not ready and no work is in flight for the
 * current lane, schedule the current generation again once a second. Every
 * guard exists to avoid competing with work that is legitimately running:
 * an active gesture, an in-flight GPU draft, a geometry transaction, an open
 * mask draft, a comparison peek, or a render coordinator lane that already has
 * an in-flight or pending request. Ordinary schedules reset the attempt budget
 * so a user-driven recovery is never counted against the bound, and the bound
 * stops a genuine refusal from becoming a submit loop.
 */
function installPreviewWatchdog() {
  stopPreviewWatchdog();
  state.previewWatchdogTimer = window.setInterval(() => {
    if (!state.session || !state.previewScheduler) return;
    const viewer = viewerState();
    if (viewer.status === "ready" || viewer.status === "unavailable") {
      state.previewWatchdogRearms = 0;
      return;
    }
    if (state.previewScheduler.interacting || state.gpuDraftInFlight) return;
    const cpuFlight = state.cpuPreviewInflight?.get(state.currentView);
    if (cpuFlight?.sessionId === state.session.session_id
      && cpuFlight.generation === state.previewGeneration[state.currentView]) return;
    if (geometryDraftActive() || state.localMaskDraftDirty || state.comparePeekActive) return;
    const laneState = state.renderCoordinator?.snapshot?.()?.lanes?.[state.currentView];
    if (laneState?.inFlight || laneState?.pending) return;
    if (state.previewWatchdogRearms >= PREVIEW_WATCHDOG_MAX_REARMS) return;
    state.previewWatchdogRearms += 1;
    state.previewScheduler.schedule(state.currentView, state.previewGeneration[state.currentView]);
  }, PREVIEW_WATCHDOG_INTERVAL_MS);
}

function stopPreviewWatchdog() {
  window.clearInterval(state.previewWatchdogTimer);
  state.previewWatchdogTimer = 0;
}

function initializePreviewScheduler() {
  if (!window.HDRPreviewScheduler) return;
  state.previewScheduler = new window.HDRPreviewScheduler({
    highQuality: () => previewNeedsRefinement(),
    onFrame: async (task) => {
      if (state.localMaskDraftDirty) return false;
      // A softer frame is only for an active gesture with Faster
      // dragging on. A frame that runs after release (a coalesced one, or an
      // edit with no gesture) is exact, so nothing coarse follows the release.
      const gesture = Boolean(state.previewScheduler?.interacting);
      let decision = interactiveScaleDecision(task.lane, { interacting: gesture });
      const tiled = interactiveDraftGuaranteedTiled(task.lane);
      if (tiled && !decision.coarse && gesture && state.fasterDragging) {
        decision = { edge: Math.max(256, Math.round(refinementProxyLongEdge() * 0.5)),
          coarse: true, scale: 0.5 };
      }
      if (decision.coarse) decision.edge = responseCoarseLongEdge(refinementProxyLongEdge());
      // The renderer refuses a whole-frame tiled drag frame, but only after
      // the source and parameters are prepared. Refuse it here, before that
      // work; the settled pass draws the edit. A magnified view is a bounded
      // region pass and goes through.
      if (tiled && !decision.coarse && state.zoomMode !== "custom") {
        const reason = "pre-dispatch-tiled";
        state.lastGpuDraftRefusal = { reason, lane: task.lane, tier: "interactive", at: performance.now() };
        const key = `interactive:${reason}`;
        state.gpuDraftRefusals[key] = (state.gpuDraftRefusals[key] || 0) + 1;
        return false;
      }
      const detailActive = gpuDetailGraphActive(task.lane);
      const detailInteraction = state.detailInteractionRestore?.lane === task.lane;
      // A queued interactive callback may become runnable only after pointerup
      // because the preceding Detail graph was GPU-backpressured. The settled
      // callback owns the final value at that point; submitting another low-res
      // frame here could overwrite the restored refined frame.
      if (detailInteraction && !state.previewScheduler?.interacting) return false;
      // Outside a gesture there is no responsiveness to win by starting a
      // second render. Superseding one that is already in flight throws away a
      // source upload and a highlight-peak measurement, and the frame that
      // replaces it is a bootstrap placeholder. During a gesture latest-wins
      // still applies, so this only stands down when nothing is being dragged.
      if (!state.previewScheduler?.interacting && state.gpuDraftInFlight) return false;
      const residentLongEdge = detailActive || detailInteraction ? residentAuthoringLongEdge() : null;
      if (residentLongEdge) {
        state.detailInteractionRestore = { lane: task.lane, longEdge: residentLongEdge };
      }
      const rendered = await renderGpuDraft(task.lane, {
        longEdge: decision.edge,
        // The interactive tier refuses tiled work. Coarse feedback at native
        // zoom must use the bounded refinement route, then settle exact.
        tier: tiled && decision.coarse ? "refinement" : "interactive",
        coarse: decision.coarse,
        // Lets the renderer drop this frame if the gesture ends before it
        // reaches the canvas (see renderGpuDraftInner's isCurrent).
        reason: decision.coarse ? "drag-coarse" : undefined,
      });
      // At most one drag frame may be on the GPU. The next frame waits for this
      // one to finish on the device, not merely to be submitted, so rapid
      // input coalesces to the newest task instead of queueing obsolete
      // frames (up to seven were measured in flight at 200%).
      if (rendered) await state.gpuPreview?.waitForSubmittedWork?.();
      return rendered;
    },
    onScope: (task) => {
      // The exposure overlay follows the same throttled, latest-wins cadence
      // as the scopes: during a drag, after settle and after refinement. It
      // runs beside them rather than inside this callback so an overlay render
      // never delays or inflates the scope pass.
      if (task.lane === state.currentView) requestLiveOverlay(task.tier);
      return refreshScopes(scopeLongEdge(task.tier), {
        tier: task.tier,
        generation: task.scopeGeneration,
        lane: task.lane,
      });
    },
    onSettle: (task) => settlePreview(task.lane, task),
    onRefine: (task) => refinePreview(task.lane, task),
    onInactive: (task) => preloadInactiveLane(task.lane, task.applicationGeneration),
  });
  // The coordinator owns generations, cancellation
  // tokens, priority, one-in-flight/one-latest coalescing, presentation
  // bookkeeping and the deferred follow-ups. app.js supplies the renderer call
  // and the state it presents, and emits intent for everything else.
  state.renderCoordinator = window.HDRRenderCoordinator
    ? new window.HDRRenderCoordinator({
      dispatch: (request) => renderGpuDraftInner(request.lane, request),
      present: (request) => (state.acceptedPresentation?.lane === request.lane
        ? state.acceptedPresentation
        : null),
      canPanRefine: () => Boolean(state.session)
        && !geometryDraftActive()
        && state.acceptedPresentation?.geometrySignature === geometrySignature(),
      onRefusal: (refusal) => {
        state.lastGpuDraftRefusal = {
          reason: refusal.reason, lane: refusal.lane, tier: refusal.tier, at: refusal.at,
        };
      },
      onError: (lane, reason, error) => {
        if (reason === "catch-up") state.roiCatchUpError = String(error?.message || error);
        else if (reason === "pan") state.roiPanError = String(error?.message || error);
      },
      onFollowUpStart: (lane, reason) => {
        if (reason === "catch-up") state.roiCatchUpError = null;
        else if (reason === "pan") state.roiPanError = null;
      },
      roiMode: state.roiPreviewMode,
      regionRoute: true,
      // The frame around a region pass is completed in the background only
      // when that costs the backend nothing. With a hard-edged mask in play it
      // would compile that mask for the whole image, which is the stall this
      // route exists to remove; the pan pass draws what the view reaches.
      canCatchUp: (lane, longEdge) => state.roiPreviewMode === "refinement" || Boolean(
        state.session && state.gpuPreview?.catchUpNeedsNoBackendMasks?.(
          state.session.session_id, lane, longEdge, geometrySignature(),
          state.compareWithoutLocals ? [] : localAdjustments(),
        ),
      ),
      catchUpDelayMs: ROI_CATCH_UP_DELAY_MS,
      panDelayMs: ROI_PAN_DELAY_MS,
    })
    : null;
  // Lost-wake-up safety net. Several flows deliberately retire the scheduler
  // before changing what the viewer must show (zoom refinement, a structural
  // mask gesture, a geometry transaction) and rely on their own follow-up to
  // schedule the next pass. When that follow-up is cancelled, refused or
  // superseded without scheduling anything else, the viewer can sit in
  // "Preparing" with no queued task, no in-flight render and no pending
  // request, and nothing wakes it until the next input. See
  // installPreviewWatchdog for the recovery contract and its bound.
  installPreviewWatchdog();
  window.HDRFinisherPerformance = {
    snapshot: () => state.previewScheduler.snapshot(),
    renderCoordinator: () => state.renderCoordinator?.snapshot() || null,
    previewWatchdog: () => ({
      active: state.previewWatchdogTimer !== 0,
      rearms: state.previewWatchdogRearms,
      maxRearms: PREVIEW_WATCHDOG_MAX_REARMS,
    }),
    // Diagnostic entry for the stall regression; disabling it reproduces the
    // pre-fix behavior for a retired scheduler with a dropped follow-up.
    previewWatchdogEnable: (enabled = true) => {
      if (enabled) installPreviewWatchdog();
      else stopPreviewWatchdog();
      return state.previewWatchdogTimer !== 0;
    },
    // Legacy-versus-ROI diagnostic A/B over the visible region.
    roiParity: (options = {}) => runRoiParity(options),
    gpuSnapshot: () => state.gpuPreview?.diagnosticsSnapshot?.() || null,
    enableGpuInstrumentation: (enabled = true) => state.gpuPreview?.setInstrumentationEnabled?.(enabled),
    // Source transport A/B: "stream" (default), "single", or legacy "strips".
    setSourceTransport: (mode) => state.gpuPreview?.setSourceTransport?.(mode) || null,
    sourceTransportMode: () => state.gpuPreview?.sourceTransportMode || null,
    renderGpuTier: (longEdge) => renderGpuDraft(state.currentView, {
      longEdge: Number(longEdge),
      tier: "settled",
    }),
    // Diagnostic entry for explicit parity and residency probes. Normal
    // user-visible renders reach the same encoder through admission planning.
    renderTiledTier: async (longEdge, options = {}) => {
      if (!state.gpuPreview || !state.session) return { rendered: false, refusals: ["no gpu session"] };
      return state.gpuPreview.renderTiledTo(
        els.previewCanvas,
        state.session.session_id,
        state.currentView,
        JSON.parse(JSON.stringify(state.adjustments)),
        sampleCurvePoints,
        Number(longEdge),
        state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())),
        state.editRevision,
        null,
        projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        {
          tier: "settled",
          tileSize: Number(options.tileSize) || undefined,
          viewport: options.viewport || null,
          applicationGeneration: state.previewGeneration[state.currentView],
        },
      );
    },
    measureExactPeak: (options = {}) => measureExactScopePeak(options),
    tiledExecutionMetrics: () => state.gpuPreview?.tiledExecutionMetrics || null,
    denoiseInputStats: () => state.denoiseInputQueue?.stats || null,
    // ROI rendering switch. "fit" (default) keeps whole-frame rendering;
    // "refinement" limits the refinement-tier pass to the visible region.
    setRoiPreviewMode: (mode) => {
      state.roiPreviewMode = mode === "refinement" ? "refinement" : "fit";
      // Diagnostics flip the mode without disturbing a timer a driver may be
      // measuring; an already-armed follow-up skips itself at fire time.
      state.renderCoordinator?.setRoiMode(state.roiPreviewMode, { cancelFollowUps: false });
      return state.roiPreviewMode;
    },
    roiPreviewMode: () => state.roiPreviewMode,
    roiCatchUpState: () => ({
      timerPending: state.renderCoordinator
        ? state.renderCoordinator.catchUpPending(state.currentView)
        : false,
      mode: state.roiPreviewMode,
      generation: state.previewGeneration[state.currentView],
      inFlight: Boolean(state.gpuDraftInFlight),
      error: state.roiCatchUpError || null,
      refusal: state.lastGpuDraftRefusal,
    }),
    // The same cancellation a new edit performs, for drivers that need to
    // measure a pan without the deferred whole-frame pass arriving mid-pass.
    cancelRoiCatchUp: () => {
      cancelRoiCatchUp();
      return state.renderCoordinator
        ? !state.renderCoordinator.catchUpPending(state.currentView)
        : true;
    },
    // Deferred pan diagnostics and the cache
    // evidence the renderer reports through tiledExecutionMetrics.
    roiPanState: () => ({
      timerPending: state.renderCoordinator
        ? state.renderCoordinator.panPending(state.currentView)
        : false,
      mode: state.roiPreviewMode,
      generation: state.previewGeneration[state.currentView],
      inFlight: Boolean(state.gpuDraftInFlight),
      error: state.roiPanError || null,
      refusal: state.lastGpuDraftRefusal,
    }),
    panRefinement: () => requestRoiPanRefinement(),
    visibleOutputRect: () => visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height),
    // Diagnostic view of the immutable viewport contract. The renderer builds
    // its own frame-anchored request from the actual proxy and composed halo;
    // this app-level version uses the selected tier and is for inspection.
    // Geometry cropping is not modelled here.
    viewportRequest: (options = {}) => {
      const Request = window.HDRViewportRequest;
      if (!Request || !state.session) return null;
      const source = state.session.source;
      const targetLongEdge = Number(options.longEdge) || previewTargetLongEdge();
      const ratio = Math.min(1, targetLongEdge / Math.max(source.width, source.height));
      const output = {
        width: Math.max(1, Math.round(source.width * ratio)),
        height: Math.max(1, Math.round(source.height * ratio)),
      };
      // The request declares the processing scale the graph will
      // run at. It is the same contract the renderer and the CPU reference
      // derive, so a request can never describe a scale the pass did not use.
      const scale = window.HDRGraphScale?.processingScaleFor
        ? window.HDRGraphScale.processingScaleFor({ width: source.width, height: source.height }, output)
        : ratio;
      return Request.build({
        lane: state.currentView,
        sessionId: state.session.session_id,
        geometrySignature: geometrySignature(),
        applicationGeneration: state.previewGeneration[state.currentView],
        editRevision: state.editRevision,
        output,
        source: { width: source.width, height: source.height },
        scale,
        visible: options.visible || null,
        halo: Number(options.halo) || 0,
        minimumRoiFraction: options.minimumRoiFraction,
        tileSize: Number(options.tileSize) || undefined,
        dpr: Number(window.devicePixelRatio) || 1,
        zoom: Number(options.zoom) || 1,
      });
    },
    prepareDenoiseSelectorSeam: (variant = "resolved-a", longEdge = settledProxyLongEdge()) => (
      state.gpuPreview?.prepareDenoiseSelectorSeam?.(
        state.session?.session_id,
        state.currentView,
        JSON.parse(JSON.stringify(state.adjustments)),
        Number(longEdge),
        state.editRevision,
        variant,
      ) || Promise.resolve(false)
    ),
    selectDenoiseSelectorSeam: async (enabled, longEdge = settledProxyLongEdge()) => {
      if (!state.gpuPreview?.selectDenoiseSelectorSource?.(enabled)) return false;
      return renderGpuDraft(state.currentView, { longEdge: Number(longEdge), tier: "settled" });
    },
    sampleDenoiseSelectorSeam: async () => {
      const analysis = await state.gpuPreview?.analyzeScope?.(els.previewCanvas, {
        width: 16,
        height: 16,
        generation: 0,
        tier: "selector-test",
      });
      if (!analysis?.pixels?.length) return null;
      let sum = 0;
      let weighted = 0;
      for (let index = 0; index < analysis.pixels.length; index += 1) {
        const value = analysis.pixels[index];
        sum += value;
        weighted += value * ((index % 97) + 1);
      }
      return { mean: sum / analysis.pixels.length, fingerprint: weighted };
    },
    readDenoiseSelectorPixel: () => state.gpuPreview?.readDenoiseSelectorPixel?.() || Promise.resolve(null),
    readDenoiseResolvedRegion: (width = 16, height = 16) => (
      state.gpuPreview?.readDenoiseResolvedRegion?.(width, height) || Promise.resolve(null)
    ),
    disposeDenoiseSelectorSeam: () => state.gpuPreview?.disposeDenoiseSelectorSeam?.(),
    evictDenoiseCache: () => state.gpuPreview?.evictDenoiseCache?.(),
    sessionId: () => state.session?.session_id || null,
    previewMode: () => `${dragLatencyPreference()}-${state.gpuPreview?.available ? "gpu" : "cpu"}`,
    authoringState: () => ({
      sessionId: state.session?.session_id || null,
      lane: state.currentView,
      adjustments: JSON.parse(JSON.stringify(state.adjustments)),
      requestedTier: state.previewResolutionOverride ? normalizedPreviewResolution() : "display",
      presentedTier: state.acceptedPresentation?.tier || null,
      presentedGeneration: state.acceptedPresentation?.generation ?? null,
      currentGeneration: state.previewGeneration[state.currentView],
      executionMode: previewExecutionMode(),
      gpuBudget: state.gpuMemoryBudget ?? "auto",
      renderPlan: state.gpuPreview?.lastRenderPlan || null,
      allocationBackoff: state.gpuPreview?.allocationBackoff || null,
      previewResolution: state.previewResolutionOverride ? normalizedPreviewResolution() : "auto",
      previewPreference: dragLatencyPreference(),
      fasterDragging: state.fasterDragging,
      previewLatency: state.previewLatencyController?.snapshot() || null,
      previewMaxDimension: requiredProcessingLongEdge(),
      previewDimensions: previewResolutionDimensions(),
      longEdge: settledProxyLongEdge(),
    }),
  };
}

function observeScopeSize() {
  if (!window.ResizeObserver) {
    window.addEventListener("resize", () => drawHistogram(state.lastScope || []));
    return;
  }
  scopeResizeObserver = new ResizeObserver(() => {
    if (scopeResizeFrame !== null) cancelAnimationFrame(scopeResizeFrame);
    scopeResizeFrame = requestAnimationFrame(() => {
      scopeResizeFrame = null;
      drawHistogram(state.lastScope || []);
    });
  });
  scopeResizeObserver.observe(els.histogram);
}

function observeViewerSize() {
  const refreshGeometry = () => {
    if (viewerResizeFrame !== null) cancelAnimationFrame(viewerResizeFrame);
    viewerResizeFrame = requestAnimationFrame(() => {
      viewerResizeFrame = null;
      applyZoomGeometry();
    });
  };
  if (!window.ResizeObserver) {
    window.addEventListener("resize", refreshGeometry);
    return;
  }
  viewerResizeObserver = new ResizeObserver(refreshGeometry);
  viewerResizeObserver.observe(els.dropzone);
}

function bindEvents() {
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason?.name === "AbortError") event.preventDefault();
  });
  els.workflowTabs.forEach((button) => {
    button.addEventListener("click", () => activateWorkflowTab(button.dataset.workflowTab));
    button.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const enabled = els.workflowTabs.filter((tab) => !tab.disabled);
      const current = enabled.indexOf(button);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = enabled[(current + direction + enabled.length) % enabled.length];
      next?.focus();
      if (next) activateWorkflowTab(next.dataset.workflowTab, { focus: false });
    });
  });
  document.querySelectorAll(".lane-switch, .local-lane-switch, .proof-preview-switch").forEach((segment) => {
    const buttons = [...segment.querySelectorAll("button")];
    buttons.forEach((button) => button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const enabled = buttons.filter((candidate) => !candidate.disabled && !candidate.hidden);
      if (!enabled.length) return;
      event.preventDefault();
      const current = Math.max(0, enabled.indexOf(button));
      let next;
      if (event.key === "Home") next = enabled[0];
      else if (event.key === "End") next = enabled.at(-1);
      else {
        const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        next = enabled[(current + direction + enabled.length) % enabled.length];
      }
      next?.focus();
      next?.click();
    }));
  });
  els.proofLaneButtons.forEach((button) => button.addEventListener("click", () => {
    switchLane(button.dataset.proofLane);
  }));
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await importByteFile(file, "import another source");
    event.target.value = "";
  });
  els.importButton.addEventListener("click", requestSourceImport);
  els.testPatternButton.addEventListener("click", async () => {
    if (!await confirmUnsavedTransition("replace the source with a test pattern")) return;
    const confirmedDocument = documentTransitionToken();
    const importGeneration = claimSessionReplacement();
    status.post({ id: "proof", severity: "progress", message: "Generating delivery proof test pattern…", progress: "indeterminate" });
    try {
      const response = await fetch("/api/proof/test-pattern");
      if (importGeneration !== state.importGeneration) return;
      if (!response.ok) throw new Error(`Test pattern failed with HTTP ${response.status}.`);
      const file = new File([await response.blob()], "hdr_delivery_proof_pattern.tiff", { type: "image/tiff" });
      if (importGeneration !== state.importGeneration) return;
      await importByteFile(file, "replace the source with a test pattern", confirmedDocument, importGeneration);
    } catch (error) {
      status.post({ id: "proof", severity: "error", message: error?.message || "The delivery proof test pattern could not be generated." });
    }
  });
  els.emptyImportButton.addEventListener("click", requestSourceImport);
  els.sourceRailExpand.addEventListener("click", toggleSourceRail);
  bindLocalAdjustmentEvents();
  els.projectOpen?.addEventListener("click", () => openProjectFromPath());
  els.projectSave?.addEventListener("click", () => saveProjectToPath());
  els.hdrReferenceWhite?.addEventListener("change", async () => {
    if (!state.session) return;
    const requested = Number(els.hdrReferenceWhite.value);
    const previous = projectReferenceWhiteNits();
    if (![100, 203].includes(requested) || requested === previous) return;
    els.hdrReferenceWhite.disabled = true;
    const applied = await queueEditCommand("set_hdr_reference_white", { hdr_reference_white_nits: requested });
    if (!applied) els.hdrReferenceWhite.value = String(previous);
    else {
      state.gpuPreview?.resetSession(state.session?.session_id || null);
      state.gpuPreparedLane = { hdr: false, sdr: false };
      renderSession();
      await settlePreview(state.currentView);
    }
    els.hdrReferenceWhite.disabled = false;
  });
  els.sourceSettingsToggle.addEventListener("click", () => {
    state.sourceSettingsOpen = !state.sourceSettingsOpen;
    renderSourceSettingsVisibility();
  });
  els.rawSettingsToggle?.addEventListener("click", () => {
    state.rawSettingsOpen = !state.rawSettingsOpen;
    renderRawImportControls(state.session);
  });
  els.lensMode?.addEventListener("change", () => renderRawImportControls(state.session));
  let lensSearchTimer = 0;
  els.lensProfileSearch?.addEventListener("input", () => {
    window.clearTimeout(lensSearchTimer);
    lensSearchTimer = window.setTimeout(loadLensProfiles, 250);
  });
  els.applyRawSettings?.addEventListener("click", applyRawImportSettings);
  els.rawHighlightBypass?.addEventListener("click", async () => {
    const enabled = els.rawHighlightBypass.getAttribute("aria-pressed") !== "true";
    renderRawHighlightState({ enabled });
    await applyRawImportSettings();
  });
  els.rawHighlightMethod?.addEventListener("change", applyRawImportSettings);
  els.rawHighlightThreshold?.addEventListener("input", () => {
    renderRawHighlightState({
      enabled: els.rawHighlightBypass.getAttribute("aria-pressed") === "true",
    });
  });
  els.rawHighlightThreshold?.addEventListener("change", applyRawImportSettings);
  els.rawHighlightReset?.addEventListener("click", async () => {
    els.rawHighlightMethod.value = "opposed_color_v1";
    els.rawHighlightThreshold.value = "1";
    renderRawHighlightState({ enabled: true });
    await applyRawImportSettings();
  });
  els.metadataToggle.addEventListener("click", () => {
    state.metadataOpen = !state.metadataOpen;
    renderMetadataVisibility();
  });
  els.interpretationMode.addEventListener("change", () => {
    renderSourceSettingsControls();
  });
  els.interpretationTransfer.addEventListener("change", () => renderSourceSettingsControls());
  els.scopeMode.addEventListener("change", async () => {
    await activateDockTab(els.scopeMode.value);
  });
  els.scopeChannelMode.addEventListener("change", async () => {
    state.scopeChannelMode = els.scopeChannelMode.value;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.scopeZoom.addEventListener("change", async () => {
    const requestedMaxNits = Number(els.scopeZoom.value);
    state.scopeMaxNits = [1000, 4000, 10000].includes(requestedMaxNits) ? requestedMaxNits : 4000;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.previewFasterDragging?.addEventListener("change", () => {
    const enabled = els.previewFasterDragging.checked === true;
    window.HDRApplicationShell?.setFasterDragging?.(enabled);
    state.fasterDragging = enabled;
    renderReadouts();
  });
  els.scopeDetail?.addEventListener("change", async () => {
    state.scopeQuality = SCOPE_QUALITY_PROFILES[els.scopeDetail.value] ? els.scopeDetail.value : DEFAULT_SCOPE_QUALITY;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.scopeExactPeak?.addEventListener("change", async () => {
    state.scopeExactPeak = Boolean(els.scopeExactPeak.checked);
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.scopeRegionToggle?.addEventListener("click", () => toggleScopeRegion());
  els.scopeRegionOverlay?.addEventListener("pointerdown", beginScopeRegionDrag);
  els.scopeRegionOverlay?.addEventListener("pointermove", moveScopeRegionDrag);
  els.scopeRegionOverlay?.addEventListener("pointerup", endScopeRegionDrag);
  els.scopeRegionOverlay?.addEventListener("pointercancel", endScopeRegionDrag);
  els.scopeRegionBox?.addEventListener("keydown", handleScopeRegionKeydown);

  ["dragenter", "dragover"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      els.dropzone.classList.add("drag-active");
    });
  });
  document.addEventListener("dragleave", (event) => {
    if (event.relatedTarget || (event.clientX > 0 && event.clientY > 0)) return;
    els.dropzone.classList.remove("drag-active");
  });
  document.addEventListener("drop", async (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    els.dropzone.classList.remove("drag-active");
    const files = event.dataTransfer.files;
    const [file] = files || [];
    if (!file) return;
    try {
      if (desktop) {
        // Pass the actual File through the preload bridge. A DOM FileList is
        // not reliably cloneable across Electron's isolated-world boundary.
        const selection = await desktop.resolveDroppedFile(file);
        if (!selection) {
          // Windows shell integrations and catalog applications can provide a
          // real File without exposing a filesystem path to Electron. Upload
          // those bytes through the local backend instead of misreporting the
          // source extension as unsupported.
          await importByteFile(file, "import another source");
          return;
        }
        await openDesktopSelection(selection);
      } else {
        await importByteFile(file, "import another source");
      }
    } catch (error) {
      console.error(error);
      showUploadError(error?.message || "The dropped file could not be opened.");
    }
  });
  [els.previewImage, els.comparisonImage, els.previewOverlay].forEach((image) => {
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await switchLane(button.dataset.kind);
    });
  });

  els.controls.forEach((control) => {
    // Pressed-state buttons (the Film Look map views) are one click, one
    // history step, so they skip the slider gesture plumbing below.
    if (control.tagName === "BUTTON") {
      control.addEventListener("click", () => {
        beginGlobalEditGesture(control);
        const pressed = control.getAttribute("aria-pressed") !== "true";
        commitAdjustmentValue(control.dataset.path, pressed);
        syncPressedControl(control, pressed);
        endGlobalEditGesture(control);
      });
      return;
    }
    const transactionOwnedControl = control.dataset.path === "shared.geometry.straighten_angle";
    control.addEventListener("pointerdown", () => {
      if (transactionOwnedControl) return;
      beginGlobalEditGesture(control);
      beginGlobalDetailInteraction(control.dataset.path);
      state.previewScheduler?.beginInteraction();
    });
    ["pointerup", "pointercancel", "change"].forEach((eventName) => {
      control.addEventListener(eventName, () => {
        if (transactionOwnedControl) return;
        if (eventName === "change" && control.dataset.historyKeyboardActive === "true") return;
        state.previewScheduler?.endInteraction();
        endGlobalEditGesture(control);
      });
    });
    control.addEventListener("keydown", (event) => {
      if (transactionOwnedControl) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
        control.dataset.historyKeyboardActive = "true";
        beginGlobalEditGesture(control);
        beginGlobalDetailInteraction(control.dataset.path);
        state.previewScheduler?.beginInteraction();
      }
    }, true);
    control.addEventListener("keyup", () => {
      if (transactionOwnedControl) return;
      delete control.dataset.historyKeyboardActive;
      state.previewScheduler?.endInteraction();
      endGlobalEditGesture(control);
    });
    control.addEventListener("input", () => {
      const value = readControlValue(control);
      if (control.dataset.path === "shared.geometry.straighten_angle") {
        updateStraightenInteractive(value);
        return;
      }
      if (state.cropMode && isCropDraftControl(control.dataset.path)) {
        updateCropDraftControl(control.dataset.path, value);
        return;
      }
      commitAdjustmentValue(control.dataset.path, value);
    });
  });
  els.denoiseBypass?.addEventListener("click", () => setDenoiseEnabled(!state.denoise[state.currentView].enabled));
  els.denoiseShowNoise?.addEventListener("click", toggleDenoiseNoiseView);
  const denoiseSliders = [
    [els.denoiseAmount, "amount"],
    [els.denoiseLuminance, "luminance"],
    [els.denoiseColor, "color_noise"],
    [els.denoiseDetail, "detail_recovery"],
    [els.denoiseFinest, "finest_noise"],
    [els.denoiseFine, "fine_noise"],
    [els.denoiseMedium, "medium_noise"],
    [els.denoiseCoarse, "coarse_noise"],
  ];
  for (const [control, key] of denoiseSliders) {
    // Capture phase: the instrument slider's own pointerdown moves the value
    // to the click and fires `input` at once, and that first reconstruction
    // must already count as part of the drag (else it is a whole-frame one).
    control?.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction(), { capture: true });
    control?.addEventListener("input", () => updateLiveDenoiseControl(key, Number(control.value)));
    for (const eventName of ["pointerup", "pointercancel", "change"]) {
      control?.addEventListener(eventName, () => {
        state.previewScheduler?.endInteraction();
        const stale = state.denoiseWholeFrameStale;
        if (stale) {
          state.denoiseWholeFrameStale = null;
          void denoiseInputQueue().submit({ ...stale, wholeFrame: true });
        }
        if (eventName === "change") void persistDenoiseSettings();
      });
    }
  }
  els.denoiseRecalculate?.addEventListener("click", () => recalculateDenoise());
  // PRD 6.3 progressive disclosure. Purely a matter of what is on screen:
  // the controls keep their values and keep applying while the panel is shut,
  // because `renderDenoiseControls` writes to them either way.
  els.denoiseAdvancedToggle?.addEventListener("click", () => {
    state.denoiseAdvancedOpen = !state.denoiseAdvancedOpen;
    renderDenoiseAdvancedVisibility();
  });
  bindRangeResetControls();

  els.curveChannelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCurveChannel = button.dataset.curveChannel;
      renderCurveChannelTabs();
      drawCurveEditor();
    });
  });
  els.curveReset.addEventListener("click", () => {
    setValueByPath(state.adjustments, `${currentCurveLane()}.curves_section_enabled`, true);
    ["luma", "red", "green", "blue"].forEach((channel) => {
      setCurveValues(channel, defaultCurvePoints());
    });
    state.selectedCurvePoint = Math.floor(defaultCurvePoints().length / 2);
    syncCurveControlsFromState();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  els.curveAdd.addEventListener("click", () => {
    addCurvePoint();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  els.curveRemove.addEventListener("click", () => {
    removeCurvePoint();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  bindCurveEditor();
  bindToneEqualizerEditor();
  bindZoneScopeOverlays();

  els.exportConfirmButton.addEventListener("click", exportCurrentSession);
  els.exportDirectoryBrowse.addEventListener("click", chooseExportDirectory);
  els.directoryBrowserGo.addEventListener("click", () => loadMediaDirectory(els.directoryBrowserPath.value));
  els.directoryBrowserUp.addEventListener("click", () => loadMediaDirectory(els.directoryBrowser.dataset.parent));
  els.directoryBrowserPin.addEventListener("click", pinCurrentMediaFolder);
  els.directoryBrowserList.addEventListener("keydown", handleMediaBrowserListKeydown);
  els.directoryBrowserSortButtons.forEach((button) => {
    button.addEventListener("click", () => sortMediaBrowserBy(button.dataset.mediaBrowserSort));
  });
  els.directoryBrowserColumnResizers.forEach((resizer) => {
    resizer.addEventListener("pointerdown", beginMediaBrowserColumnResize);
    resizer.addEventListener("pointermove", continueMediaBrowserColumnResize);
    resizer.addEventListener("pointerup", endMediaBrowserColumnResize);
    resizer.addEventListener("pointercancel", endMediaBrowserColumnResize);
    resizer.addEventListener("lostpointercapture", endMediaBrowserColumnResize);
    resizer.addEventListener("keydown", handleMediaBrowserColumnResizeKeydown);
  });
  els.directoryBrowserPreviewResizer.addEventListener("pointerdown", beginMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("pointermove", continueMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("pointerup", endMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("pointercancel", endMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("lostpointercapture", endMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("keydown", handleMediaBrowserPreviewResizeKeydown);
  els.directoryBrowserPath.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    loadMediaDirectory(els.directoryBrowserPath.value);
  });
  els.directoryBrowserFilename.addEventListener("input", updateProjectSaveBrowserAction);
  els.directoryBrowserFilename.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmMediaBrowserSelection();
  });
  [els.directoryBrowserClose, els.directoryBrowserCancel].forEach((button) => {
    button.addEventListener("click", closeExportDirectoryBrowser);
  });
  els.directoryBrowserSelect.addEventListener("click", confirmMediaBrowserSelection);
  els.directoryBrowser.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeExportDirectoryBrowser();
  });
  els.applyInterpretationButton.addEventListener("click", applyInterpretationOverride);
  els.resetInterpretationButton.addEventListener("click", resetInterpretationToAuto);
  els.ejectButton.addEventListener("click", ejectCurrentSession);
  els.copySourcePath.addEventListener("click", copySourcePath);
  els.copyExportPath.addEventListener("click", copyLastExportPath);
  els.revealExportPath?.addEventListener("click", () => desktop?.revealPath(state.lastExportPath));
  els.openExportPath?.addEventListener("click", () => desktop?.openPath(state.lastExportPath));

  els.groupToggles.forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".control-group");
      if (!group) return;
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
      if (group.dataset.group === "perspective" && collapsed) abandonPerspectiveDraft();
      else if (group.dataset.group === "perspective" && state.perspectiveFailedDraft) {
        openPerspectiveMode();
        schedulePerspectiveDraftPreview();
      }
      else if (group.dataset.group !== "perspective" && !collapsed) abandonPerspectiveDraft();
      if (group === els.localAdjustmentGroup) setGradeMode(collapsed ? "global" : "local");
      renderVignetteCenter();
    });
  });
  els.groupResets.forEach((button) => {
    button.addEventListener("click", () => resetControlGroup(
      ["detail", "black-and-white"].includes(button.dataset.resetGroup)
        ? `${state.currentView}-${button.dataset.resetGroup}`
        : button.dataset.resetGroup
    ));
  });
  els.sdrMatchHdrColors.addEventListener("click", matchHdrColorsToSdr);
  els.sdrMatchEntire?.addEventListener("click", () => setSdrMatch());
  els.detailMatchHdr?.addEventListener("click", () => matchLaneObject("detail"));
  els.blackAndWhiteMatchHdr?.addEventListener("click", matchHdrBlackAndWhiteToSdr);
  els.filmLookReset?.addEventListener("click", resetFilmLook);
  els.filmLookMatchHdr?.addEventListener("click", matchHdrFilmLookToSdr);
  els.colorGradingReset?.addEventListener("click", () => resetLaneObject("color_grading", defaultColorGrading()));
  els.colorGradingMatchHdr?.addEventListener("click", () => matchLaneObject("color_grading"));
  els.vignetteReset?.addEventListener("click", () => resetLaneObject("vignette", defaultVignette()));
  els.vignetteMatchHdr?.addEventListener("click", () => matchLaneObject("vignette"));
  bindColorWheels();
  bindCropEditor();
  bindPerspectiveEditor();
  bindVignetteCenter();
  els.sectionBypasses.forEach((button) => {
    button.addEventListener("click", () => {
      const path = resolveAdjustmentPath(button.dataset.sectionPath);
      setValueByPath(state.adjustments, path, !Boolean(getValueByPath(state.adjustments, path)));
      invalidatePreview(path.startsWith("sdr.") ? "sdr" : "hdr");
      renderControlState();
      debouncePreview(path.startsWith("sdr.") ? "sdr" : "hdr");
    });
  });

  els.zoomFit.addEventListener("click", () => setZoomMode("fit"));
  els.zoomActual.addEventListener("click", () => setZoomMode("actual"));
  els.zoomOut.addEventListener("click", () => stepZoom(-1));
  els.zoomIn.addEventListener("click", () => stepZoom(1));
  els.zoomSlider.addEventListener("input", () => {
    setCustomZoom(sliderToZoomPercent(Number(els.zoomSlider.value)), null, { continuous: true });
  });
  els.zoomReadout.addEventListener("focus", () => els.zoomReadout.select());
  els.zoomReadout.addEventListener("change", commitZoomReadout);
  els.zoomReadout.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitZoomReadout();
      els.zoomReadout.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      updateZoomReadout();
      els.zoomReadout.blur();
    }
  });
  els.dropzone.addEventListener("wheel", handleViewerWheel, { passive: false });
  els.dropzone.addEventListener("scroll", () => {
    syncLocalMaskOverlayViewport();
    queueLocalMaskOverlayRender();
    updateNavigationViewport();
    // The pan itself is compositor-only; this updates the coordinator's
    // viewport model and schedules the deferred follow-up that refines a newly
    // exposed strip.
    state.renderCoordinator?.noteViewport(
      state.currentView,
      visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height),
    );
    noteViewerPan();
  }, { passive: true });
  els.navigationThumb.addEventListener("click", (event) => {
    if (!state.session || state.zoomMode !== "custom") return;
    const imageBox = els.navigationThumbImage.getBoundingClientRect();
    const x = event.detail === 0 ? 0.5 : clamp((event.clientX - imageBox.left) / Math.max(1, imageBox.width), 0, 1);
    const y = event.detail === 0 ? 0.5 : clamp((event.clientY - imageBox.top) / Math.max(1, imageBox.height), 0, 1);
    els.dropzone.scrollLeft = x * els.dropzone.scrollWidth - els.dropzone.clientWidth / 2;
    els.dropzone.scrollTop = y * els.dropzone.scrollHeight - els.dropzone.clientHeight / 2;
    updateNavigationViewport();
  });
  els.overlayToggle.addEventListener("click", toggleOverlayPopover);
  els.overlayClose.addEventListener("click", closeOverlayPopover);
  els.previewToggle.addEventListener("click", togglePreviewPopover);
  els.previewClose.addEventListener("click", closePreviewPopover);
  document.addEventListener("pointerdown", (event) => {
    if (state.compactSourceOpen && !event.target.closest(".source-rail")) closeCompactSourceRail();
    if (!els.overlayPopover.classList.contains("hidden") && !event.target.closest("#overlay-popover, #overlay-toggle")) closeOverlayPopover({ restoreFocus: false });
    if (!els.previewPopover.classList.contains("hidden") && !event.target.closest("#preview-popover, #preview-toggle")) closePreviewPopover({ restoreFocus: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.overlayPopover.classList.contains("hidden")) {
      event.preventDefault();
      closeOverlayPopover();
      return;
    }
    if (!els.previewPopover.classList.contains("hidden")) {
      event.preventDefault();
      closePreviewPopover({ restoreFocus: true });
      return;
    }
    if (state.compactSourceOpen) {
      event.preventDefault();
      closeCompactSourceRail({ restoreFocus: true });
    }
  });
  els.dockCollapse.addEventListener("click", toggleAnalysisDock);
  els.dockTabs.forEach((button) => {
    button.addEventListener("click", () => activateDockTab(button.dataset.dockTab));
  });
  els.exportFormat.addEventListener("change", () => {
    const requestedPreset = els.exportPreset.value === "custom" ? "web_default" : els.exportPreset.value;
    applyExportPreset(els.exportFormat.value, requestedPreset);
    updateExportAvailability();
    renderWorkflowContext();
  });
  els.exportPreset.addEventListener("change", () => {
    if (els.exportPreset.value === "custom") return;
    applyExportPreset(els.exportFormat.value, els.exportPreset.value);
  });
  els.exportQuality.addEventListener("input", () => {
    els.exportQualityValue.textContent = els.exportQuality.value;
    markExportPresetCustom();
    window.HDRProofing?.invalidate("settings");
  });
  els.jpegGainMapQuality.addEventListener("input", () => {
    els.jpegGainMapQualityValue.textContent = els.jpegGainMapQuality.value;
    markExportPresetCustom();
    window.HDRProofing?.invalidate("settings");
  });
  els.avifGainMapQuality.addEventListener("input", () => {
    els.avifGainMapQualityValue.textContent = els.avifGainMapQuality.value;
    markExportPresetCustom();
    window.HDRProofing?.invalidate("settings");
  });
  [
    els.avifBitDepth,
    els.avifChromaSubsampling,
    els.avifGainMapScale,
    els.jpegUltrahdrChromaSubsampling,
    els.jpegGainMapScale,
    els.jpegChromaSubsampling,
    els.jpegxlPrecision,
    els.sdrPngBitDepth,
    els.exportDithering,
    els.exportMetadataPolicy,
  ].forEach((control) => control?.addEventListener("change", () => {
    markExportPresetCustom();
    renderFormatCards();
    window.HDRProofing?.invalidate("settings");
  }));
  els.exportResizeMode?.addEventListener("change", () => {
    markExportPresetCustom();
    renderOutputFinishingControls();
  });
  [els.exportLongEdge, els.exportWidth, els.exportHeight].forEach((control) => control?.addEventListener("change", markExportPresetCustom));
  els.exportPreventEnlargement?.addEventListener("change", markExportPresetCustom);
  els.exportSharpening?.addEventListener("change", markExportPresetCustom);

  bindCompareControl();
  // A drag frame carries the last highlight measurement instead of waiting
  // for one. When the measurement it skipped lands and differs, redraw the
  // current view so the resting frame uses the real anchor. The renderer has
  // cached it, so the redraw is one ordinary pass.
  window.addEventListener("hdrfinisher:highlight-anchor-measured", (event) => {
    const lane = event.detail?.lane;
    if (!state.session || lane !== state.currentView) return;
    invalidatePreview(lane, { markDirty: false });
    debouncePreview(lane);
  });
  window.addEventListener("hdrfinisher:highlight-anchor-needed", (event) => {
    const { lane, key, used } = event.detail || {};
    if (!state.session || lane !== state.currentView || !key) return;
    scheduleExactHighlightAnchor({ lane, key, used });
  });
  window.addEventListener("hdrfinisher:webgpulost", (event) => {
    const message = event.detail?.message || "WebGPU device lost";
    const verdict = state.gpuFailurePolicy?.record(new Error(message), { deviceLost: true });
    state.displayInfo.gpu = verdict?.recoverable === false
      ? message
      : `${message}; rebuilding the device`;
    clearGpuSurfaceHdr();
    renderReadouts();
    if (verdict?.recoverable !== false && state.gpuRebuildAttempts < 2) {
      state.gpuRebuildAttempts += 1;
      void rebuildGpuPreview(message);
      return;
    }
    markPreviewUnavailable(`${message}. WebGPU could not be rebuilt for this session.`);
    if (state.session) settlePreview(state.currentView).catch(() => null);
  });
  if (window.matchMedia) {
    ["(dynamic-range: high)", "(color-gamut: p3)", "(color-gamut: rec2020)"].forEach((query) => {
      const media = window.matchMedia(query);
      media.addEventListener?.("change", () => {
        state.displayInfo = buildDisplayProbe(state.desktopEnvironment);
        state.displayInfo.gpu = state.gpuPreview?.detail || "Backend fallback";
        clearGpuSurfaceHdr();
        state.gpuPreview?.invalidateSurfaces?.();
        renderReadouts();
        if (state.session) {
          invalidatePreview(state.currentView, { markDirty: false });
          settlePreview(state.currentView).catch(() => null);
        }
      });
    });
  }
}

function observeGraphEditorSizes() {
  const redraw = (canvas) => {
    if (canvas.clientWidth < 2 || canvas.clientHeight < 2) return;
    if (canvas === els.curveEditor) drawCurveEditor();
    if (canvas === els.toneEqualizerEditor) drawToneEqualizerEditor("hdr");
    if (canvas === els.sdrToneEqualizerEditor) drawToneEqualizerEditor("sdr");
  };
  if (!window.ResizeObserver) {
    window.addEventListener("resize", () => {
      redraw(els.curveEditor);
      redraw(els.toneEqualizerEditor);
      redraw(els.sdrToneEqualizerEditor);
    });
    return;
  }
  graphEditorResizeObserver = new ResizeObserver((entries) => {
    entries.forEach(({ target }) => redraw(target));
  });
  graphEditorResizeObserver.observe(els.curveEditor);
  graphEditorResizeObserver.observe(els.toneEqualizerEditor);
  graphEditorResizeObserver.observe(els.sdrToneEqualizerEditor);
}

renderSessionChrome();
renderCurveChannelTabs();
