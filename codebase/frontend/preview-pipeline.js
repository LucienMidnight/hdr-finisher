function debouncePreview(lane = state.currentView) {
  state.previewWatchdogRearms = 0;
  if (!state.previewScheduler) {
    queueGpuDraft(lane);
    window.clearTimeout(state.settleTimer);
    state.settleTimer = window.setTimeout(() => settlePreview(lane), 120);
    return;
  }
  state.previewScheduler.schedule(lane, state.previewGeneration[lane]);
}

function queueGpuDraft(lane = state.currentView) {
  state.gpuQueuedLane = lane;
  if (state.gpuRenderFrame !== null) return;
  state.gpuRenderFrame = requestAnimationFrame(() => {
    state.gpuRenderFrame = null;
    const queuedLane = state.gpuQueuedLane;
    state.gpuQueuedLane = null;
    renderGpuDraft(queuedLane).catch(() => null);
  });
}

/**
 * Whether a refused draft is going to be answered by work that is already
 * scheduled, so this path does not have to pay for a CPU frame.
 *
 * PERF-03. At Full a settled render takes seconds and every interactive draft
 * the scheduler dispatches during a drag is refused outright by the tiled
 * encoder -- but only after it has taken the supersession token, so the
 * settled render in flight comes back `superseded-during-render`. Answering
 * that with `renderPreviewForLane` rendered the whole frame on the CPU
 * backend: measured at 7 059 ms for a 7968 px source, with nothing on the
 * canvas while it ran, to produce the stale values the supersession had just
 * rejected.
 *
 * Being superseded is not a failure, and the frame already on screen is a
 * better answer than a slow render of values the user has moved past. But
 * standing down is only safe when something else is certainly coming. An
 * earlier attempt keyed this on `gpuDraftInFlight` being non-null, which is
 * true for refusals that nothing follows, and the viewer never reached Ready
 * at all.
 *
 * So the test is the scheduler's own image generation. `schedule()` bumps it
 * and arms a settle in the same call, so a generation newer than this task's
 * means a newer settle is already armed and will present. Every other
 * refusal, and any supersession that did not come from newer input, still
 * falls back exactly as before.
 */
function supersededByScheduledWork(task) {
  if (state.lastGpuDraftRefusal?.reason !== "superseded-during-render") return false;
  const scheduler = state.previewScheduler;
  if (!scheduler || task?.imageGeneration === undefined) return false;
  return task.imageGeneration !== scheduler.generations.image;
}

/**
 * A renderer generation can lose ownership while it is awaiting a proxy,
 * mask, or highlight reduction. That is cancellation, not a reason to switch
 * execution engines. At Full the CPU fallback is deliberately bounded and
 * may refuse graphs (locals and spatial film are two examples) that the next
 * GPU generation can render exactly. Showing that CPU refusal between two GPU
 * generations turns an ordinary latest-wins race into a false Unavailable.
 */
function transientGpuRefusal() {
  const reason = String(state.lastGpuDraftRefusal?.reason || "");
  return reason === "superseded-during-render"
    || reason.startsWith("superseded-")
    // The coordinator's name for the same thing: a queued render replaced by
    // a newer one before it was dispatched.
    || reason === "coalesced-by-newer-render"
    || reason.startsWith("peak:newer-render-started")
    || reason.startsWith("peak:application-not-current")
    || (reason.startsWith("tiled-encode-failed:") && reason.includes("superseded"));
}

async function settlePreview(lane = state.currentView, task = {}) {
  // Rotate/Straighten is an explicit Apply/Cancel transaction. A scheduler
  // task left resident by an earlier grading gesture must never settle the
  // transient geometry on slider release.
  if (!state.session || state.rotateDraftGeometry || state.perspectiveMode) return false;
  await syncGlobalEditState();
  // A local slider's `change` handler persists its optimistic value through
  // the serialized edit queue. The scheduler's settle timer is independent of
  // that request and can otherwise snapshot the old revision while the new
  // mask/grade is still being committed. At Full that stale GPU generation is
  // cancelled, then the bounded CPU fallback truthfully refuses locals. Wait
  // for the queue that was present when settling began so the authoritative
  // pass always snapshots one coherent revision.
  const pendingEdits = state.editCommandQueue;
  if (pendingEdits && await pendingEdits === false) return false;
  if (!state.session || state.rotateDraftGeometry || state.perspectiveMode) return false;
  if (task.applicationGeneration !== undefined
    && task.applicationGeneration !== state.previewGeneration[lane]) return false;
  if (state.acceptedPresentation?.lane === lane
    && state.acceptedPresentation.exact
    && state.acceptedPresentation.generation === state.previewGeneration[lane]
    && state.acceptedPresentation.geometrySignature === geometrySignature()
    && state.acceptedPresentation.processedLongEdge === refinementProxyLongEdge()) {
    prepareInactivePreview();
    window.HDRProofing?.settled(lane);
    return true;
  }
  const display = lane === state.currentView;
  const detailRestore = state.detailInteractionRestore?.lane === lane
    && state.detailInteractionRestore.longEdge === refinementProxyLongEdge()
    ? state.detailInteractionRestore.longEdge
    : null;
  const longEdge = detailRestore || settledProxyLongEdge();
  if (state.detailInteractionRestore?.lane === lane) state.detailInteractionRestore = null;
  const tier = longEdge >= refinementProxyLongEdge() ? "refinement" : "settled";
  if (display) {
    if (gpuPreviewEligible(lane)) {
      let rendered = await renderGpuDraft(lane, { longEdge, tier });
      // Latest-wins cancellation is expected while a mask proxy or edit
      // revision changes underneath a Full render. If this is still the
      // current scheduler task, retry once after the serialized edit queue has
      // drained. One bounded retry recovers the real result without turning a
      // normal GPU handoff into an unsupported CPU Full request.
      if (!rendered && transientGpuRefusal() && !supersededByScheduledWork(task)) {
        const retryEdits = state.editCommandQueue;
        if (!retryEdits || await retryEdits !== false) {
          const schedulerCurrent = !state.previewScheduler
            || task.imageGeneration === undefined
            || state.previewScheduler.current?.imageGeneration === task.imageGeneration;
          const applicationCurrent = task.applicationGeneration === undefined
            || task.applicationGeneration === state.previewGeneration[lane];
          if (schedulerCurrent && applicationCurrent && lane === state.currentView) {
            rendered = await renderGpuDraft(lane, { longEdge, tier });
          }
        }
      }
      if (rendered) await refreshOverlay(longEdge);
      else if (!supersededByScheduledWork(task) && !transientGpuRefusal()) {
        state.cpuFallbacks.settle.push(state.lastGpuDraftRefusal?.reason || "unknown");
        await renderPreviewForLane(lane, true, longEdge, { showProgress: false });
      }
    } else {
      await renderPreviewForLane(lane, true, longEdge, { showProgress: false });
    }
    prepareInactivePreview();
  } else {
    state.previewScheduler?.scheduleInactive(lane, state.previewGeneration[lane]);
  }
  window.HDRProofing?.settled(lane);
}

async function refinePreview(lane, task = {}) {
  if (!state.session || geometryDraftActive() || !previewNeedsRefinement() || lane !== state.currentView) return;
  if (task.applicationGeneration !== undefined && task.applicationGeneration !== state.previewGeneration[lane]) return;
  // Let an in-flight render finish first. Superseding it would throw away work
  // that has already loaded its source and measured its highlight peak, and
  // that render may well leave nothing for refinement to do.
  if (state.gpuDraftInFlight) {
    await state.gpuDraftInFlight.catch(() => null);
    if (!state.session || geometryDraftActive() || !previewNeedsRefinement() || lane !== state.currentView) return;
    if (task.applicationGeneration !== undefined && task.applicationGeneration !== state.previewGeneration[lane]) return;
  }
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  const targetLongEdge = refinementProxyLongEdge();
  markRefining();
  const rendered = gpuPreviewEligible(lane)
    ? await renderGpuDraft(lane, { longEdge: targetLongEdge, tier: "refinement" })
    : false;
  if (rendered || geometryDraftActive() || !previewNeedsRefinement() || lane !== state.currentView || targetLongEdge !== refinementProxyLongEdge()) return;
  if (transientGpuRefusal()) return;
  state.cpuFallbacks.refine.push(state.lastGpuDraftRefusal?.reason || "unknown");
  await renderPreviewForLane(lane, true, targetLongEdge, { showProgress: false });
  if (generation !== state.previewGeneration[lane] || signature !== geometrySignature() || !previewNeedsRefinement()) return;
}

function debounceOverlayAndScopes() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    renderOverlayPresetNote();
    await refreshOverlay();
    await refreshScopes();
  }, 120);
}

function refreshOverlayAndScopesImmediately() {
  window.clearTimeout(state.refreshTimer);
  renderOverlayPresetNote();
  if (state.adjustments.shared.overlay_mode === "off") clearPreviewOverlay();
  void (async () => {
    await refreshOverlay();
    await refreshScopes();
  })();
}

async function refreshPreview(options = {}) {
  const longEdge = window.HDRWholeImagePreviewPipe.edgeFor("fitPlaceholder", state.session?.preview?.long_edge || 1600);
  return renderPreviewForLane(state.currentView, true, longEdge, options);
}

async function renderPreviewForLane(
  lane,
  displayWhenReady,
  longEdge = 1600,
  options = {},
) {
  if (!state.session || geometryDraftActive()) return false;
  const sessionId = state.session.session_id;
  if (await syncGlobalEditState() === false || state.session?.session_id !== sessionId) return false;
  if (geometryDraftActive()) return false;
  const raw = options.raw ?? !state.gpuPreview?.available;
  const key = JSON.stringify([sessionId, state.editRevision, state.previewGeneration[lane],
    geometrySignature(), longEdge, displayWhenReady, raw, localsBypassed(),
    state.localPreviewDirty && !localsBypassed() ? localAdjustments() : null]);
  const inflight = state.cpuPreviewInflight ||= new Map();
  const previous = inflight.get(lane);
  // Scheduler settle, scopes and lane preparation can ask for the same CPU
  // image while it is still computing. Aborting and restarting that request
  // wastes the backend work and can prevent any current frame from finishing.
  if (previous?.key === key) return previous.promise;
  const record = { key, sessionId, generation: state.previewGeneration[lane], promise: null };
  record.promise = renderPreviewForLaneInner(lane, displayWhenReady, longEdge, { ...options, raw });
  inflight.set(lane, record);
  try {
    return await record.promise;
  } finally {
    if (inflight.get(lane) === record) inflight.delete(lane);
  }
}

async function renderPreviewForLaneInner(
  lane,
  displayWhenReady,
  longEdge = 1600,
  { showProgress = true, progressSteps = [12, 76, 92], raw = !state.gpuPreview?.available } = {},
) {
  // Perspective owns its transient preview until Apply/Cancel. Revision-based
  // renders still contain the committed geometry, even when the controls reset.
  if (!state.session || geometryDraftActive()) return false;
  const sessionId = state.session.session_id;
  if (await syncGlobalEditState() === false) return false;
  if (geometryDraftActive() || state.session?.session_id !== sessionId) return false;
  if (raw) return renderRawPreviewForLane(lane, displayWhenReady, longEdge, { showProgress });
  const cached = state.previewCache[lane];
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  if (cached?.generation === generation && cached.geometrySignature === signature
    && (cached.requestedLongEdge || cached.longEdge || 0) >= longEdge) {
    if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) showCachedPreview(lane);
    renderCompareStatus();
    return true;
  }

  state.previewControllers[lane]?.abort();
  const controller = new AbortController();
  state.previewControllers[lane] = controller;
  if (displayWhenReady && showProgress) setPreviewMessage(`Rendering ${lane.toUpperCase()} preview...`, progressSteps[0]);

  const response = await fetch(`/api/session/${state.session.session_id}/preview/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edit_revision: state.editRevision,
      include_locals: !localsBypassed(),
      local_adjustments: state.localPreviewDirty && !localsBypassed()
        ? JSON.parse(JSON.stringify(localAdjustments()))
        : null,
      long_edge: longEdge,
      execution: previewExecutionForTier(),
      hdr_display: mediaQueryMatch("(dynamic-range: high)"),
    }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  const requestIsCurrent = () => controller === state.previewControllers[lane]
    && !geometryDraftActive()
    && state.session?.session_id === sessionId
    && generation === state.previewGeneration[lane]
    && signature === geometrySignature();
  if (response.status === 409) {
    const payload = await safeJson(response);
    if (payload?.code === "strip_execution_refused" && displayWhenReady && requestIsCurrent()) {
      const reasons = Array.isArray(payload.refusals) && payload.refusals.length
        ? ` ${payload.refusals.join(", ")}.`
        : "";
      markPreviewUnavailable(`${payload.detail || "Bounded Full preview is unavailable for this graph."}${reasons}`);
    } else if (displayWhenReady && showProgress && requestIsCurrent()) {
      setPreviewMessage("A newer adjustment replaced this render.", progressSteps[0]);
    }
    return false;
  }
  if (!response.ok) {
    const payload = await safeJson(response);
    if (displayWhenReady && requestIsCurrent()) {
      const detail = payload?.detail || "Preview failed to render.";
      setPreviewError(detail);
      // A CPU preview failure moves the
      // viewer to Unavailable and keeps the last valid presentation. Clearing
      // the image here destroyed a good frame because a later one failed.
      if (state.acceptedPresentation?.lane === lane) markPreviewUnavailable(detail);
      else {
        clearPreviewImage();
        clearPreviewOverlay();
      }
    }
    return false;
  }

  if (displayWhenReady && showProgress) setPreviewMessage("Processing complete. Decoding preview...", progressSteps[1]);
  const previewInfo = previewInfoFromResponse(response, lane);
  let width = Number(response.headers.get("X-Image-Width"));
  let height = Number(response.headers.get("X-Image-Height"));
  const scopePeakHeader = response.headers.get("X-Scope-Peak");
  const responseScopePeak = scopePeakHeader === null ? null : Number(scopePeakHeader);
  const blob = await response.blob();
  if (!requestIsCurrent()) return false;
  const url = URL.createObjectURL(blob);
  if (!(width > 0 && height > 0)) {
    try {
      const decoded = await decodePreviewImage(url);
      width = decoded.naturalWidth;
      height = decoded.naturalHeight;
    } catch (error) {
      URL.revokeObjectURL(url);
      if (requestIsCurrent()) setPreviewError(error.message);
      return false;
    }
    if (!requestIsCurrent()) { URL.revokeObjectURL(url); return false; }
  }
  const previous = state.previewCache[lane];
  if (previous?.url) URL.revokeObjectURL(previous.url);
  state.previewCache[lane] = { url, generation, longEdge: Math.max(width, height) || longEdge, requestedLongEdge: longEdge, width, height, geometrySignature: signature, scopePeak: Number.isFinite(responseScopePeak) ? responseScopePeak : null };
  if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) {
    if (showProgress) setPreviewMessage("Presenting preview...", progressSteps[2]);
    const keptGpuSurface = shouldKeepHdrGpuSurface(lane)
      && await renderGpuDraft(lane)
      && state.gpuSurfaceHdr;
    if (!requestIsCurrent()) return false;
    if (!keptGpuSurface) {
      setGpuSurfaceHdr(lane, false);
      state.previewInfoByLane[lane] = previewInfo;
      if (!await applyPreviewUrl(url, requestIsCurrent)) return false;
      state.previewInfo = previewInfo;
      acceptPresentation(lane, longEdge >= refinementProxyLongEdge() ? "refinement" : "settled", width, height, previewInfo.transport, gpuPreviewEligible(lane) ? "" : "CPU/backend", null, generation, null, longEdge, responseScopePeak);
      els.scopeKindLabel.textContent = lane.toUpperCase();
      renderReadouts();
    }
  } else {
    state.previewInfoByLane[lane] = previewInfo;
  }
  renderCompareStatus();
  return true;
}

async function renderRawPreviewForLane(lane, displayWhenReady, longEdge, { showProgress = false } = {}) {
  if (!state.session || geometryDraftActive()) return false;
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  const cached = state.previewCache[lane];
  if (cached?.raw && cached.generation === generation && cached.geometrySignature === signature && cached.longEdge >= longEdge) {
    if (displayWhenReady && lane === state.currentView) applyRawPreview(cached);
    return true;
  }
  state.previewControllers[lane]?.abort();
  const controller = new AbortController();
  state.previewControllers[lane] = controller;
  if (displayWhenReady && showProgress) setPreviewMessage(`Rendering ${lane.toUpperCase()} canvas preview...`, 24);
  const response = await fetch(`/api/session/${state.session.session_id}/preview-raw/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edit_revision: state.editRevision,
      include_locals: !localsBypassed(),
      long_edge: longEdge,
      generation,
      tier: "settled",
      execution: previewExecutionForTier(),
      hdr_display: false,
    }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name !== "AbortError") console.error(error);
    return null;
  });
  if (!response || controller !== state.previewControllers[lane]) return false;
  if (response.status === 409) {
    const payload = await safeJson(response);
    if (payload?.code === "strip_execution_refused" && displayWhenReady && lane === state.currentView) {
      const reasons = Array.isArray(payload.refusals) && payload.refusals.length
        ? ` ${payload.refusals.join(", ")}.`
        : "";
      markPreviewUnavailable(`${payload.detail || "Bounded Full preview is unavailable for this graph."}${reasons}`);
    }
    return false;
  }
  if (!response.ok) {
    // The raw path already retained the previous frame by returning early.
    // Reporting Unavailable is what turns a silent retention into a truthful
    // one: the viewer is told why the image it can see is still the newest.
    const payload = await safeJson(response);
    if (displayWhenReady && lane === state.currentView) {
      markPreviewUnavailable(payload?.detail || "Preview failed to render.");
    }
    return false;
  }
  const width = Number(response.headers.get("X-Image-Width"));
  const height = Number(response.headers.get("X-Image-Height"));
  const rawGeneration = Number(response.headers.get("X-Generation"));
  const scopePeakHeader = response.headers.get("X-Scope-Peak");
  const responseScopePeak = scopePeakHeader === null ? null : Number(scopePeakHeader);
  const data = new Uint8ClampedArray(await response.arrayBuffer());
  if (geometryDraftActive() || controller !== state.previewControllers[lane]
    || generation !== state.previewGeneration[lane] || rawGeneration !== generation || signature !== geometrySignature()) return false;
  const frame = { raw: data, width, height, generation, longEdge: Math.max(width, height) || longEdge, requestedLongEdge: longEdge, geometrySignature: signature, scopePeak: Number.isFinite(responseScopePeak) ? responseScopePeak : null };
  state.previewCache[lane] = frame;
  state.previewInfoByLane[lane] = {
    mediaType: "application/octet-stream",
    transport: "Raw RGBA8",
    colorSpace: "sRGB",
    transfer: "sRGB",
    bitDepth: "8-bit",
    notes: "Persistent CPU fallback canvas; export quality is unchanged",
  };
  if (displayWhenReady && lane === state.currentView && !state.comparePeekActive) applyRawPreview(frame);
  return true;
}

function applyRawPreview(frame) {
  let canvas = els.previewCanvas;
  let context = canvas.getContext("2d");
  if (!context) {
    const replacement = document.createElement("canvas");
    replacement.id = canvas.id;
    replacement.className = canvas.className;
    canvas.replaceWith(replacement);
    els.previewCanvas = replacement;
    canvas = replacement;
    context = canvas.getContext("2d");
  }
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.putImageData(new ImageData(frame.raw, frame.width, frame.height), 0, 0);
  els.previewImage.style.display = "none";
  canvas.style.display = "block";
  els.emptyState.style.display = "none";
  setGpuSurfaceHdr(state.currentView, false);
  state.previewInfo = state.previewInfoByLane[state.currentView];
  hidePreviewMessage();
  clearInteractiveStraightenPreview();
  applyZoomGeometry();
  renderReadouts();
  const rawProcessedEdge = frame.requestedLongEdge || frame.longEdge;
  acceptPresentation(state.currentView, rawProcessedEdge >= refinementProxyLongEdge() ? "refinement" : "settled", frame.width, frame.height, "Raw RGBA8", "CPU/backend", null, frame.generation, null, rawProcessedEdge, frame.scopePeak);
}

function applyRawComparisonPreview(frame) {
  let canvas = els.comparisonCanvas;
  let context = canvas.getContext("2d");
  if (!context) {
    const replacement = document.createElement("canvas");
    replacement.id = canvas.id;
    replacement.setAttribute("aria-label", canvas.getAttribute("aria-label") || "Settled comparison preview");
    canvas.replaceWith(replacement);
    els.comparisonCanvas = replacement;
    canvas = replacement;
    context = canvas.getContext("2d");
  }
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.putImageData(new ImageData(frame.raw, frame.width, frame.height), 0, 0);
  els.comparisonImage.style.display = "none";
  canvas.style.display = "block";
}

/**
 * Keep the exposure overlay following edits.
 *
 * The overlay is a backend image composited over the GPU preview, so it only
 * changes when it is asked for again. Before this it was asked for only from
 * the GPU settle path, which the refinement pass bypasses: after an exposure
 * drag the zebra stayed on the pre-drag frame indefinitely. The scheduler's
 * scope pass runs at every tier, so it drives this loop instead.
 *
 * One request in flight, newest tier pending: a drag produces a steady stream
 * of overlays at the interactive edge instead of aborting each one before it
 * lands, and the settled request that follows always runs.
 */
function decodePreviewImage(url) {
  return new Promise((resolve, reject) => {
    const decoder = new Image();
    decoder.onload = () => resolve(decoder);
    decoder.onerror = () => reject(new Error("Image element could not load preview data."));
    decoder.src = url;
  });
}

async function applyPreviewUrl(url, isCurrent = () => true) {
  try {
    await decodePreviewImage(url);
  } catch (error) {
    if (isCurrent()) setPreviewError(error.message || "Preview image failed to decode.");
    return false;
  }
  if (!isCurrent()) return false;
  els.previewImage.src = url;

  els.previewCanvas.style.display = "none";
  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  clearInteractiveStraightenPreview();
  setZoomMode(state.zoomMode);
  syncOverlayPlacement();
  updateZoomReadout();
  hidePreviewMessage();
  return true;
}

function renderGpuDraft(lane = state.currentView, options = {}) {
  const tier = options.tier || "settled";
  const longEdge = Number(options.longEdge) > 0 ? Number(options.longEdge) : settledProxyLongEdge();
  const coordinator = state.renderCoordinator;
  if (coordinator) {
    // The visible region is measured here, where the mounted canvas is known,
    // and handed to the coordinator so the deferred pan pass can use the same
    // model without measuring DOM state from inside the state machine.
    const frame = gpuFrameSizeAt(longEdge) || approximateGpuFrameSizeAt(longEdge);
    coordinator.noteViewport(lane, visibleOutputRect(frame.width, frame.height));
    coordinator.noteScale(lane, { tier, longEdge });
  }
  const pending = coordinator
    ? coordinator.submit({
      lane,
      tier,
      longEdge,
      reason: options.reason || tier,
      priority: options.priority || "foreground",
      // The refinement pass is the expensive one at large tiers, so that is
      // where the visible region pays off. Interactive and settled passes stay
      // whole frame: pan and zoom then always show complete pixels, and the ROI
      // pass only improves a region that is already correct. A catch-up pass is
      // the whole-frame follow-up that closes the seam, so it never carries a
      // viewport.
      viewport: options.viewport !== undefined
        ? Boolean(options.viewport)
        : (state.roiPreviewMode === "refinement" && tier === "refinement" && !options.roiCatchUp)
          || (state.zoomMode === "custom" && !options.roiCatchUp),
      catchUp: Boolean(options.roiCatchUp),
      panPass: Boolean(options.panPass),
      allowInactive: Boolean(options.allowInactive),
      hideStatus: options.hideStatus !== false,
      coarse: Boolean(options.coarse),
      interactiveSnapshot: tier === "interactive" && Boolean(state.previewScheduler?.interacting)
        && Boolean(state.denoise?.[lane]?.enabled),
    })
    : renderGpuDraftInner(lane, options);
  state.gpuDraftInFlight = pending;
  // Which tier is holding the device. A settled draft at Full is a multi-second
  // tiled render; an interactive one is refused immediately. Telling them apart
  // is what lets a caller decide whether waiting is worth anything.
  state.gpuDraftInFlightTier = tier;
  void pending.catch(() => null).finally(() => {
    if (state.gpuDraftInFlight === pending) {
      state.gpuDraftInFlight = null;
      state.gpuDraftInFlightTier = null;
    }
  });
  return pending;
}

async function renderGpuDraftInner(
  lane = state.currentView,
  request = {},
) {
  const {
    hideStatus = true,
    longEdge = settledProxyLongEdge(),
    allowInactive = false,
    tier = "settled",
    roiCatchUp = false,
    panPass = false,
  } = request;
  const renderStartedAt = performance.now();
  // Record why a draft declined. A silent false is very hard to diagnose from
  // a failing browser test, and every one of these is a legitimate refusal.
  const refuse = (reason) => {
    state.lastGpuDraftRefusal = { reason, lane, tier, at: performance.now() };
    // Cumulative, because the interesting refusals arrive in bursts during a
    // drag and only the histogram distinguishes "superseded once" from the
    // repeated supersession that PERF-03 is about.
    const key = `${tier}:${reason}`;
    state.gpuDraftRefusals[key] = (state.gpuDraftRefusals[key] || 0) + 1;
    return false;
  };
  if (geometryDraftActive()) return refuse("geometry-draft-active");
  if (!gpuPreviewEligible(lane)) return refuse("gpu-not-eligible");
  if (!state.session || (!allowInactive && lane !== state.currentView)) return refuse("no-session-or-inactive-lane");
  if (state.comparePeekActive && !allowInactive) return refuse("compare-peek-active");
  if (state.globalEditDirty && state.acceptedPresentation?.geometrySignature !== geometrySignature()) return refuse("dirty-edit-with-stale-geometry");
  // The coordinator assigns the dispatch serial when the render actually
  // starts; a superseded or coalesced intent never consumes one.
  const serial = Number(request.dispatchSerial) || 0;
  state.gpuRenderSerial = serial;
  if (!allowInactive) state.gpuPreview?.backgroundMaskRequestCoordinator?.cancel();
  const sessionId = state.session.session_id;
  const generation = Number.isFinite(Number(request.applicationGeneration))
    ? Number(request.applicationGeneration)
    : state.previewGeneration[lane];
  const requestedGeometrySignature = geometrySignature();
  if (state.denoise?.[lane]?.enabled && !state.denoiseRuntime?.[lane]?.showOriginal) {
    const expectedIdentity = `${sessionId}:${lane}:${longEdge}:${requestedGeometrySignature}:source`;
    const denoise = state.gpuPreview?.diagnosticsSnapshot?.().denoise;
    if (state.denoiseRuntime[lane].dirty || !denoise?.cacheReady || denoise.identity !== expectedIdentity) {
      // At 100% on a large frame this is several seconds with the previous
      // picture still up, so say what the wait is.
      const waiting = "Preparing Denoise for this view…";
      if (hideStatus && lane === state.currentView) setIndeterminatePreviewMessage(waiting);
      const ready = await recalculateDenoise(lane, { longEdge, renderAfter: false });
      if (state.previewStatusEntry?.message === waiting) hidePreviewMessage();
      if (!ready) return refuse("denoise-scale-analysis-unavailable");
    }
  }
  // A magnified pass fetches a region of the frame it will produce, so it has
  // to know that frame's exact size first.
  if (request.viewport && !gpuFrameSizeAt(longEdge)) await ensureGeometryCoordinateMap(longEdge);
  const adjustmentsSnapshot = JSON.parse(JSON.stringify(state.adjustments));
  const localSnapshot = localsBypassed()
    ? []
    : JSON.parse(JSON.stringify(localAdjustments()));
  const maskOverlay = gpuLumaMaskOverlayOptions();
  const sourceOptions = {
    tier,
    applicationGeneration: generation,
    viewport: request.viewport || null,
    // The frame this pass will produce, so that the first magnified pass can
    // fetch only the region it draws.
    frameSize: geometrySignature() === requestedGeometrySignature ? gpuFrameSizeAt(longEdge) : null,
    roiCatchUp,
    panPass,
    noiseView: denoiseNoiseViewActive(lane),
    // Adaptive reconstruction reads ungraded source pixels. A slider changes
    // the render, but leaves these pixels useful to its replacement. Keep the
    // load alive while the photo and geometry remain the same.
    isSourceCurrent: state.denoise?.[lane]?.enabled
      ? () => !geometryDraftActive() && state.session?.session_id === sessionId
        && requestedGeometrySignature === geometrySignature()
      : null,
    onSourceProgress: (progress) => {
      if (progress.state !== "building" || !sourceOptions.isCurrent() || !hideStatus) return;
      const completed = Math.max(0, Number(progress.completed) || 0);
      const total = Math.max(1, Number(progress.total) || 1);
      setPreviewMessage(`Preparing source level · ${completed}/${total} channels`,
        15 + Math.round(30 * completed / total));
    },
    // WebGPU renders directly into the mounted canvas. Guard inside the
    // renderer, before it resizes or submits to that canvas, because rejecting
    // the result here after await would already be visibly too late. The
    // coordinator's token covers generations and cancellation; these are the
    // app-domain facts it cannot know.
    isCurrent: () => (typeof request.isCurrent === "function" ? request.isCurrent() : true)
      && !geometryDraftActive()
      && state.session?.session_id === sessionId
      && (generation === state.previewGeneration[lane]
        || (request.interactiveSnapshot && state.previewScheduler?.interacting))
      && requestedGeometrySignature === geometrySignature()
      && (allowInactive || lane === state.currentView)
      // A softer drag frame is never shown after release. One still on
      // the GPU when the pointer lifts is dropped before it reaches the
      // canvas; the settled pass that follows the release draws full detail.
      && !(request.coarse && request.reason === "drag-coarse" && !state.previewScheduler?.interacting),
  };
  try {
    const result = await state.gpuPreview.render(
      sessionId,
      lane,
      adjustmentsSnapshot,
      sampleCurvePoints,
      longEdge,
      localSnapshot,
      state.editRevision,
      maskOverlay,
      projectReferenceWhiteNits(),
      { width: state.session.source.width, height: state.session.source.height },
      sourceOptions,
    );
    if (!result) return refuse(state.gpuPreview.lastRenderRefusal?.reason || "renderer-returned-nothing");
    if (!sourceOptions.isCurrent()) return refuse("superseded-during-render");
    state.gpuRenderRetries = 0;
    state.gpuFailurePolicy?.noteSuccess();
    // The coordinator arms the whole-frame catch-up once this pass presents,
    // so the refinement boundary stops being visible as a seam. It owns the
    // deferred follow-up and cancels it on a newer edit or a mode change.
    state.gpuPreparedLane[lane] = true;
    setGpuSurfaceHdr(lane, result.hdr);
    els.previewImage.style.display = "none";
    els.previewCanvas.style.display = "block";
    els.emptyState.style.display = "none";
    state.previewInfo = {
      mediaType: "WebGPU canvas",
      transport: "GPU texture",
      colorSpace: result.hdr ? "Display P3 extended" : "sRGB",
      transfer: "linear canvas",
      bitDepth: result.proxyFormat === "rgba16float" ? "16-bit float proxy" : "32-bit float proxy",
      notes: `Settled WebGPU authoring preview · ${longEdge}px proxy · export quality unchanged`,
    };
      state.previewInfoByLane[lane] = state.previewInfo;
    acceptPresentation(
      lane,
      tier,
      result.width || longEdge,
      result.height || longEdge,
      "WebGPU",
      "",
      result.sourceSerial,
      generation,
      result.execution || "direct",
      result.processedLongEdge || longEdge,
      null,
      request.coarse,
    );
    const exactEdge = refinementProxyLongEdge();
    const visibleEdge = Math.min(exactEdge, Math.max(1, displayedLongEdge()));
    // Total wall time is the model input on purpose. Feeding
    // the renderer's graph-only stage time here (source and mask waits
    // excluded): at 42 MP it made the controller skip the coarse frame
    // entirely at warm 50%, because a scale change always pays a fresh source
    // upload and that upload is exactly the cost the coarse frame buys down.
    state.previewLatencyController?.record({ graph: previewGraphTimingKey(lane), edge: longEdge,
      exactEdge, visiblePixels: visibleEdge * visibleEdge, elapsedMs: performance.now() - renderStartedAt });
    setZoomMode(state.zoomMode);
    renderReadouts();
      if (hideStatus) hidePreviewMessage();
      const submittedAt = performance.now();
      requestAnimationFrame((animationFrameAt) => {
        if (serial !== state.gpuRenderSerial || (!allowInactive && lane !== state.currentView)) return;
        // rAF supplies the start of the frame, which can precede this render's
        // submission. Use the callback observation for latency, retaining the
        // frame timestamp independently for trace interpretation.
        const presentedAt = performance.now();
        state.gpuPreview?.recordPresentation?.({
          serial,
          lane,
          longEdge,
          submittedAt,
          presentedAt,
          submitToPresentMs: presentedAt - submittedAt,
          animationFrameAt,
        });
        window.dispatchEvent(new CustomEvent("hdrfinisher:preview-presented", {
          detail: { serial, sourceSerial: result.sourceSerial, generation, lane, longEdge, submittedAt, presentedAt },
        }));
        if (maskOverlay) {
          window.dispatchEvent(new CustomEvent("hdrfinisher:mask-presented", {
            detail: {
              localId: maskOverlay.localId,
              generation: serial,
              longEdge,
              requestedAt: submittedAt,
              presentedAt,
              gpuResident: true,
              cpuMaskMs: null,
              byteLength: 0,
            },
          }));
        }
      });
      return true;
  } catch (error) {
    const verdict = state.gpuFailurePolicy
      ? state.gpuFailurePolicy.record(error, { superseded: Boolean(error?.recoverable) })
      : {
        kind: error?.recoverable ? "superseded" : "transport",
        recoverable: true,
        retryable: false,
        disabled: false,
        detail: error?.message || "WebGPU draft failed",
      };
    if (verdict.kind === "superseded") {
      console.debug("WebGPU authoring render deferred until geometry commit.", error);
      // Say so. A silent false leaves the previous refusal standing, and the
      // settle pass then reads an old hard refusal (stale geometry, say) as
      // this render's and draws a CPU picture for an ordinary supersession.
      return refuse("superseded-during-render");
    }
    if (verdict.recoverable && !verdict.disabled) {
      // Section 5.8: keep the device and the accepted frame. A retryable
      // transport or allocation failure is re-dispatched within a bounded
      // budget; a validation failure only counts toward the sticky threshold.
      console.warn(`WebGPU authoring render failed (${verdict.kind}); keeping the accepted frame.`, error);
      state.gpuPreview.detail = `${verdict.kind} failure: ${verdict.detail}`;
      state.displayInfo.gpu = state.gpuPreview.detail;
      renderReadouts();
      if (verdict.retryable && state.gpuRenderRetries < 2) {
        state.gpuRenderRetries += 1;
        window.setTimeout(() => {
          if (state.session) settlePreview(lane).catch(() => null);
        }, 250);
      }
      return false;
    }
    console.warn("WebGPU authoring render failed permanently; using raw CPU preview.", error);
    state.gpuPreview.available = false;
    setGpuSurfaceHdr(lane, false);
    state.gpuPreview.detail = `${verdict.kind} failure: ${verdict.detail}`;
    state.displayInfo.gpu = state.gpuPreview.detail;
    renderReadouts();
    return false;
  }
}

function clearPreviewImage() {
  els.previewImage.onload = null;
  els.previewImage.onerror = null;
  els.previewImage.removeAttribute("src");
  els.previewImage.style.display = "none";
  els.previewCanvas.style.display = "none";
  els.emptyState.style.display = "grid";
  clearPreviewOverlay();
}

function activePreviewElement() {
  if (els.chromeProofImage?.style.display !== "none") return els.chromeProofImage;
  return els.previewCanvas.style.display !== "none" ? els.previewCanvas : els.previewImage;
}

/**
 * The part of the presented canvas the viewer can actually see, in output
 * pixels, or null when the whole frame is visible (Fit).
 *
 * Measured from the mounted canvas and the scrolling dropzone rather than from
 * the zoom model, so centering, scroll position, comparison layouts and any
 * future transform are all accounted for by construction. Returning null for a
 * fully visible frame is deliberate: a Fit viewport has no offscreen tiles to
 * skip and must keep the whole-frame path.
 */
function visibleOutputRect(outputWidth, outputHeight) {
  if (!previewIsVisible()) return null;
  const width = Math.max(1, Math.floor(Number(outputWidth) || 0));
  const height = Math.max(1, Math.floor(Number(outputHeight) || 0));
  const canvas = els.previewCanvas;
  const box = canvas.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return null;
  const viewport = els.dropzone.getBoundingClientRect();
  const left = Math.max(box.left, viewport.left);
  const top = Math.max(box.top, viewport.top);
  const right = Math.min(box.right, viewport.right);
  const bottom = Math.min(box.bottom, viewport.bottom);
  if (right <= left || bottom <= top) return null;
  const scaleX = width / box.width;
  const scaleY = height / box.height;
  const x = Math.max(0, Math.floor((left - box.left) * scaleX));
  const y = Math.max(0, Math.floor((top - box.top) * scaleY));
  const visibleWidth = Math.min(width - x, Math.ceil((right - left) * scaleX));
  const visibleHeight = Math.min(height - y, Math.ceil((bottom - top) * scaleY));
  if (!(visibleWidth > 0 && visibleHeight > 0)) return null;
  if (x === 0 && y === 0 && visibleWidth >= width && visibleHeight >= height) return null;
  return { x, y, width: visibleWidth, height: visibleHeight };
}

function previewIsVisible() {
  return Boolean(state.session && activePreviewElement().style.display !== "none");
}

function previewInfoFromResponse(response, kind) {
  const mediaType = response.headers.get("content-type") || "unknown";
  if (kind === "hdr") {
    if (mediaType.startsWith("image/png")) {
      return {
        mediaType,
        transport: "PNG",
        colorSpace: "sRGB",
        transfer: "sRGB",
        bitDepth: "8-bit",
        notes: "Deterministic HDR-to-SDR preview for a standard-range display",
      };
    }
    return {
      mediaType,
      transport: "AVIF",
      colorSpace: "BT.2020",
      transfer: "PQ",
      bitDepth: "10-bit 4:4:4",
      notes: "Browser-decoded HDR preview",
    };
  }
  return {
    mediaType,
    transport: "PNG",
    colorSpace: "sRGB",
    transfer: "sRGB",
    bitDepth: "8-bit",
    notes: "Embedded or derived SDR fallback",
  };
}

function invalidatePreview(lane, { local = false, markDirty = true } = {}) {
  if (markDirty && !local) markGlobalEditDirty();
  // A newer edit makes the pending catch-up obsolete; it would render the old
  // generation into the frame. The same is true of the deferred pan pass: its
  // newly exposed strip belongs to the generation the edit just replaced.
  // The coordinator bumps the generation and cancels both follow-ups; the
  // mirror keeps every existing reader of previewGeneration valid.
  const coordinator = state.renderCoordinator;
  if (coordinator) {
    coordinator.noteEdit(lane, {
      preserveInteractive: Boolean(state.previewScheduler?.interacting)
        && Boolean(state.denoise?.[lane]?.enabled),
    });
    state.previewGeneration[lane] = coordinator.generation(lane, "edit");
  } else {
    cancelRoiCatchUp();
    cancelRoiPanRefinement();
    state.previewGeneration[lane] += 1;
  }
  if (lane === state.currentView && state.overlayPresented
    && state.overlayPresented.generation !== state.previewGeneration[lane]) {
    // The old overlay remains fully composited while its replacement renders.
    // Dimming here made every slider input look like the overlay toggled off.
    els.previewOverlay.dataset.stale = "true";
  }
  window.HDRProofing?.invalidate(lane);
  renderCompareStatus();
  updateExportAvailability();
  // The generation bump is what moves the viewer to Updating. Reporting it
  // here is what keeps that feedback inside the 100 ms acceptance target,
  // rather than waiting for the render that follows.
  if (lane === state.currentView) renderViewerStatus();
}

function clearPreviewCache() {
  // Source/project replacement must retire tool transactions, without copying
  // their old snapshots into the newly loaded document.
  state.perspectiveSolveController?.abort();
  state.perspectiveSolveController = null;
  state.perspectiveMode = false;
  clearPerspectiveGpuDraft();
  state.perspectiveApplyOperation = null;
  state.perspectiveFailedDraft = null;
  setPerspectiveStatus("Choose a guide tool or move a slider.", "");
  state.perspectiveDraftGeometry = null;
  state.perspectiveGuides = null;
  state.perspectiveGuidesDirty = false;
  state.perspectiveTool = null;
  state.perspectiveGuideDrag = null;
  state.rotateDraftGeometry = null;
  state.cropMode = false;
  state.cropDraftGeometry = null;
  state.cropEditBaseCrop = null;
  state.cropDrag = null;
  state.geometryTool = null;
  state.straightenGestureActive = false;
  state.straightenPreviewBaseAngle = null;
  state.globalEditDirty = false;
  state.globalEditSyncPending = null;
  for (const overlay of [els.cropEditorOverlay, els.perspectiveEditorOverlay, els.straightenGridOverlay]) {
    overlay?.classList.add("hidden");
    overlay?.setAttribute("aria-hidden", "true");
  }
  renderGeometryToolState();
  renderPerspectiveControls();
  state.geometryTransformHandoffSignature = null;
  state.detailInteractionRestore = null;
  clearRotateDraftTransformProperties();
  state.previewScheduler?.cancel();
  state.perspectivePreviewController?.abort();
  state.perspectivePreviewController = null;
  window.clearTimeout(state.perspectivePreviewTimer);
  state.perspectivePreviewTimer = 0;
  if (state.perspectivePreviewUrl) URL.revokeObjectURL(state.perspectivePreviewUrl);
  state.perspectivePreviewUrl = null;
  state.scopeRequestInFlight?.controller?.abort();
  state.pendingScopeRequest?.resolve(false);
  state.pendingGpuScopeRequest?.resolve(false);
  state.scopeRequestInFlight = null;
  state.pendingScopeRequest = null;
  state.pendingGpuScopeRequest = null;
  state.overlayAbortController?.abort();
  state.overlayAbortController = null;
  // The coordinator retires every lane's tokens, retained-frame facts and
  // deferred follow-ups. Its generations stay monotonic, so work already
  // queued by the browser can never publish into the replacement document.
  state.renderCoordinator?.noteSource(null);
  for (const lane of ["hdr", "sdr"]) {
    state.previewControllers[lane]?.abort();
    state.previewControllers[lane] = null;
    const cached = state.previewCache[lane];
    if (cached?.url) URL.revokeObjectURL(cached.url);
    state.previewCache[lane] = null;
    state.previewGeneration[lane] = state.renderCoordinator
      ? state.renderCoordinator.generation(lane, "edit")
      : 0;
  }
  state.comparePeekActive = false;
  endBeforePeek();
  state.beforeRenderedKey = null;
  state.comparisonRenderedLane = null;
  state.comparisonRenderedGeneration = null;
  state.comparisonRenderedGeometry = null;
  clearGpuSurfaceHdr();
  state.gpuPreparedLane = { hdr: false, sdr: false };
  // A replacement source can have a completely different orientation. Do not
  // let the previous session's fitted aspect survive until the new GPU canvas
  // has presented its first frame.
  state.zoomReferenceFrame = null;
  state.geometryPresentationPending = false;
  // Keep this monotonic across source/session replacement so an old readback
  // can never collide with the first generation of the new source.
  state.scopeGeneration += 1;
  els.scopeFreshness.textContent = "Waiting";
  els.scopeFreshness.classList.remove("updating");
  clearPreviewImage();
  clearComparisonPreview();
  window.HDRProofing?.reset();
}

function cacheReady(lane) {
  const cached = state.previewCache[lane];
  return Boolean(
    (gpuPreviewEligible(lane) && state.gpuPreparedLane[lane])
    || (cached?.generation === state.previewGeneration[lane]
      && cached.geometrySignature === geometrySignature()
      && (cached.url || cached.raw)),
  );
}

async function showCachedPreview(lane) {
  if (geometryDraftActive()) return false;
  const sessionId = state.session?.session_id;
  const cached = state.previewCache[lane];
  // Restoring a view is the final presentation, not a grading gesture. The
  // display-bounded default can replace a refined frame with a 1K proxy after
  // comparison/peek or cancelling Perspective, with no scheduler task left to
  // refine it again. Request the selected quality explicitly; geometry may
  // make the returned bitmap smaller than the requested proxy edge.
  if (gpuPreviewEligible(lane) && state.gpuPreparedLane[lane] && await renderGpuDraft(lane, {
    allowInactive: lane !== state.currentView,
    longEdge: refinementProxyLongEdge(),
    tier: "refinement",
  })) return true;
  const isCurrent = () => !geometryDraftActive() && state.session?.session_id === sessionId
    && cached === state.previewCache[lane] && cached?.generation === state.previewGeneration[lane]
    && cached.geometrySignature === geometrySignature();
  if (!cached || !isCurrent()) return false;
  if (cached.raw) applyRawPreview(cached);
  else if (cached.url) {
    if (!await applyPreviewUrl(cached.url, isCurrent)) return false;
    const cachedProcessedEdge = cached.requestedLongEdge || cached.longEdge;
    acceptPresentation(lane, cachedProcessedEdge >= refinementProxyLongEdge() ? "refinement" : "settled", cached.width, cached.height, state.previewInfoByLane[lane].transport, "CPU/backend", null, cached.generation, null, cachedProcessedEdge, cached.scopePeak);
  }
  state.previewInfo = state.previewInfoByLane[lane];
  renderReadouts();
  if (lane === state.currentView && !state.comparePeekActive
    && (cached.requestedLongEdge || cached.longEdge || 0) < refinementProxyLongEdge()) {
    debouncePreview(lane);
  }
  return true;
}

/**
 * Whether the editor is actually idle.
 *
 * The inactive lane's preparation is a whole-frame proxy upload for a lane
 * nobody is looking at. `requestIdleCallback` fires on any quiet moment in the
 * event loop, including the gap between a settled frame and the refinement
 * that is about to follow it. This gate is the app's own answer: no draft in
 * flight, no gesture, and no pass queued or running for either lane.
 */
function previewIdleNow() {
  if (!state.session || state.gpuDraftInFlight || geometryDraftActive()) return false;
  if (state.previewScheduler?.interacting) return false;
  const coordinator = state.renderCoordinator;
  if (coordinator) {
    for (const lane of ["hdr", "sdr"]) {
      const laneState = coordinator.state(lane);
      if (laneState.inFlight || laneState.pending
        || laneState.panTimerPending || laneState.catchUpTimerPending) return false;
    }
  }
  return true;
}

function prepareInactivePreview({ immediate = false } = {}) {
  if (!state.session) return;
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (state.compareLayout !== "single") {
    renderComparisonPreview(other).catch(() => null);
    return;
  }
  if (cacheReady(other)) {
    renderCompareStatus();
    return;
  }
  // An explicit comparison gesture runs now; the automatic path waits for
  // true idle so a background lane cannot compete with the edit on screen.
  if (immediate) {
    if (!state.inactiveSourceController) {
      void preloadInactiveLane(other, state.previewGeneration[other]);
    }
    return;
  }
  // Full would retain another native source just for an unseen lane. A lane
  // switch already loads that source within its one render; explicit compare
  // intent above can still prepare it immediately.
  if (state.previewResolutionOverride && normalizedPreviewResolution() === "full") return;
  state.previewScheduler?.scheduleInactive(other, state.previewGeneration[other], previewIdleNow);
}

/**
 * Once a magnified view has settled on the region route, stream the whole
 * frame's source to the device in the background. Later pans copy their
 * region from it instead of downloading it again (PAN-FETCH-01). The renderer
 * declines when the store would crowd the memory budget.
 */
async function holdSourceForPanning(lane, longEdge) {
  // The view may have left this size since the catch-up was armed.
  if (!state.session || lane !== state.currentView || !gpuPreviewEligible(lane)
    || requiredProcessingLongEdge() !== longEdge || !state.gpuPreview?.holdSourceForPanning) return;
  const sessionId = state.session.session_id;
  const signature = geometrySignature();
  const controller = new AbortController();
  state.panSourceController?.abort();
  state.panSourceController = controller;
  try {
    await state.gpuPreview.holdSourceForPanning(
      sessionId, lane, longEdge, signature, state.editRevision, approximateGpuFrameSizeAt(longEdge),
      { signal: controller.signal, isCurrent: () => !controller.signal.aborted
        && state.session?.session_id === sessionId && state.currentView === lane
        && geometrySignature() === signature && requiredProcessingLongEdge() === longEdge },
    );
  } catch (error) {
    // An edit or a zoom ends the stream early; the next settled view asks again.
    if (!controller.signal.aborted) console.debug("Whole-source hold for panning skipped.", error);
  } finally {
    if (state.panSourceController === controller) state.panSourceController = null;
  }
}

async function preloadInactiveLane(lane, generation) {
  if (!state.session || generation !== state.previewGeneration[lane] || !state.gpuPreview?.available) return;
  if (state.compareLayout !== "single" && lane !== state.currentView) {
    await renderComparisonPreview(lane);
    return;
  }
  const controller = new AbortController();
  state.inactiveSourceController?.abort();
  state.inactiveSourceController = controller;
  try {
    await state.gpuPreview.loadProxy(
      state.session.session_id,
      lane,
      settledProxyLongEdge(),
      geometrySignature(),
      state.editRevision,
      "source",
      { signal: controller.signal, isCurrent: () => !controller.signal.aborted
        && generation === state.previewGeneration[lane] },
    );
    if (controller.signal.aborted || generation !== state.previewGeneration[lane]) return;
    state.gpuPreparedLane[lane] = true;
    renderCompareStatus();
    // A held comparison gesture asked for this lane before it was ready.
    // Complete the peek now, while the user is still holding.
    if (state.comparePendingPeek && state.compareHeld
      && state.compareLayout === "single" && !state.comparePeekActive
      && lane !== state.currentView) {
      state.comparePendingPeek = false;
      await peekOtherLane();
    }
  } catch (error) {
    if (!controller.signal.aborted) console.debug("Inactive GPU lane preparation skipped.", error);
  } finally {
    if (state.inactiveSourceController === controller) state.inactiveSourceController = null;
  }
}

