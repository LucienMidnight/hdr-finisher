const exactScopePeakCache = new Map();
const exactScopePeakInflight = new Map();
const exactHighlightAnchorInflight = new Map();

function exactScopePeakKey(lane = state.currentView) {
  return [
    state.session?.session_id || "none",
    lane,
    state.editRevision,
    state.previewGeneration?.[lane] ?? 0,
    geometrySignature(),
    projectReferenceWhiteNits(),
    JSON.stringify(state.adjustments?.[lane] || {}),
    JSON.stringify(state.compareWithoutLocals ? [] : localAdjustments()),
  ].join("|");
}

/**
 * Estimate the finished peak from bounded source evidence and native patches.
 * A downsample alone can erase isolated speculars. Real source candidates
 * locate those pixels; the GPU ranks them and evaluates a fixed patch budget
 * with bounded masks. This remains an estimate, labelled in the scopes.
 * Export and full-size Proof measure the entire finished image exactly.
 * The historical function/cache names remain for performance-driver callers.
 * Returns null on refusal or when foreground work supersedes the measurement.
 */
async function measureExactScopePeak({ lane = state.currentView, force = false } = {}) {
  if (!state.gpuPreview?.available || !state.session) return null;
  // Background measurement paints nothing and yields to foreground work.
  // Importing a source replaces the session this would be measuring, so there
  // is nothing to measure and every reason not to compete for the network and
  // the device while it happens.
  if (state.importInProgress) return null;
  const key = exactScopePeakKey(lane);
  if (!force && exactScopePeakCache.has(key)) return exactScopePeakCache.get(key);
  if (exactScopePeakInflight.has(key)) return exactScopePeakInflight.get(key);
  const run = measureExactScopePeakInner(lane, key);
  exactScopePeakInflight.set(key, run);
  try {
    return await run;
  } finally {
    if (exactScopePeakInflight.get(key) === run) exactScopePeakInflight.delete(key);
  }
}

async function measureExactScopePeakInner(lane, key) {
  const started = performance.now();
  // Never attribute a completed estimate to a replaced session or edit.
  const sessionId = state.session.session_id;
  const importGeneration = state.importGeneration;
  const foregroundSerial = state.gpuRenderSerial;
  let measured = null;
  const generation = state.previewGeneration[lane];
  const revision = state.editRevision;
  const requestedEdge = requiredProcessingLongEdge();
  const current = () => state.session?.session_id === sessionId
    && state.importGeneration === importGeneration && !state.importInProgress
    && state.gpuRenderSerial === foregroundSerial
    && state.previewGeneration[lane] === generation && state.editRevision === revision
    && requiredProcessingLongEdge() === requestedEdge;
  try {
    const result = await state.gpuPreview.measureEditingPeak(
      els.previewCanvas,
      state.session.session_id,
      lane,
      JSON.parse(JSON.stringify(state.adjustments)),
      sampleCurvePoints,
      state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())),
      state.editRevision,
      projectReferenceWhiteNits(),
      { width: state.session.source.width, height: state.session.source.height },
      {
        tier: "settled",
        measureOnly: true,
        applicationGeneration: state.previewGeneration[lane],
        isCurrent: current,
      },
    );
    if (!current() || exactScopePeakKey(lane) !== key) {
      return null;
    }
    if (result?.rendered && Number.isFinite(result.metrics?.exactPeak)) {
      measured = {
        peak: result.metrics.exactPeak,
        longEdge: result.metrics.exactPeakLongEdge,
        exact: false,
        bounded: true,
        tiles: result.metrics.tileCount,
        durationMs: performance.now() - started,
      };
    } else if (result && !result.rendered) {
      measured = { peak: null, exact: false, refusals: result.refusals || [] };
    }
  } catch (error) {
    measured = { peak: null, exact: false, refusals: [String(error?.message || error)] };
  }
  // Only cache against a session that is still the one in hand, or a later
  // session could read this answer as its own.
  if (!current() || exactScopePeakKey(lane) !== key) return null;
  // Refused measurements remain retryable; valid estimates are reused.
  if (Number.isFinite(measured?.peak)) {
    recordEditingMeasurement(lane, {peak: measured.peak});
    exactScopePeakCache.set(key, measured);
    while (exactScopePeakCache.size > 8) exactScopePeakCache.delete(exactScopePeakCache.keys().next().value);
  }
  return measured;
}

/**
 * Resolve Peak Fit's shoulder anchor with bounded editing measurement.
 *
 * HDR measures the finished picture before output highlights. SDR measures
 * its prefix before display grading and locals. The key excludes preview
 * resolution, so every zoom reuses the same value for an unchanged recipe.
 */
const pendingHighlightAnchors = new Map();
function scheduleExactHighlightAnchor(request) {
  const { lane, key } = request;
  const previous = pendingHighlightAnchors.get(lane);
  if (previous) window.clearTimeout(previous.timer);
  // Renderer deduplication covers dispatched work. Pending work belongs to
  // this latest-input queue and must not suppress a later generation's event.
  state.gpuPreview?.requestedCanonicalHighlightKeys?.delete(key);
  const pending = { request, sessionId: state.session?.session_id, timer: null };
  const dispatch = () => {
    if (pendingHighlightAnchors.get(lane) !== pending) return;
    if (state.session?.session_id !== pending.sessionId || state.currentView !== lane || state.importInProgress) {
      pendingHighlightAnchors.delete(lane);
      return;
    }
    const scheduler = state.previewScheduler;
    if (scheduler?.interacting || scheduler?.frameInFlight || scheduler?.framePending
      || state.gpuDraftInFlight || !state.acceptedPresentation?.exact
      || state.acceptedPresentation?.generation !== state.previewGeneration[lane]) {
      pending.timer = window.setTimeout(dispatch, 200);
      return;
    }
    pendingHighlightAnchors.delete(lane);
    void measureExactHighlightAnchor(pending.request);
  };
  pendingHighlightAnchors.set(lane, pending);
  pending.timer = window.setTimeout(dispatch, 200);
}

async function measureExactHighlightAnchor({ lane, key, used }) {
  if (!state.gpuPreview?.available || !state.session || !key || state.importInProgress) return null;
  if (exactHighlightAnchorInflight.has(key)) return exactHighlightAnchorInflight.get(key);
  const sessionId = state.session.session_id;
  const importGeneration = state.importGeneration;
  const foregroundSerial = state.gpuRenderSerial;
  const previewGeneration = state.previewGeneration[lane];
  const revision = state.editRevision;
  const requestedEdge = requiredProcessingLongEdge();
  const run = (async () => {
    try {
      const result = await state.gpuPreview.measureEditingPeak(
        els.previewCanvas,
        sessionId,
        lane,
        JSON.parse(JSON.stringify(state.adjustments)),
        sampleCurvePoints,
        state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())),
        state.editRevision,
        projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        {
          tier: "settled",
          measureOnly: true,
          highlightAnchorOnly: true,
          applicationGeneration: previewGeneration,
          isCurrent: () => state.session?.session_id === sessionId
            && state.importGeneration === importGeneration && !state.importInProgress
            && state.gpuRenderSerial === foregroundSerial
            && state.currentView === lane && state.editRevision === revision
            && state.previewGeneration[lane] === previewGeneration
            && requiredProcessingLongEdge() === requestedEdge,
        },
      );
      if (state.session?.session_id !== sessionId || state.importGeneration !== importGeneration
        || state.editRevision !== revision || state.currentView !== lane
        || state.previewGeneration[lane] !== previewGeneration) return null;
      if (!Number.isFinite(result?.highlightAnchor?.value)) return null;
      const measured = result.highlightAnchor.value;
      // A request queued during a drag can carry an earlier input's key. The
      // measurement is of the recipe in hand all the same (the checks above),
      // so it is kept as evidence; `used` then belongs to that earlier input
      // and the frame is redrawn.
      recordEditingMeasurement(lane, {anchor: measured});
      // One redraw per measured key: if the redraw asks again under a key the
      // measurement can never answer, repeating it would never settle.
      const mismatched = result.highlightAnchor.key !== key;
      if (mismatched && state.lastMismatchedAnchorKey === result.highlightAnchor.key) return measured;
      if (mismatched) state.lastMismatchedAnchorKey = result.highlightAnchor.key;
      if (mismatched
        || Math.abs(measured / Math.max(Number(used) || measured, 1e-9) - 1) > 0.0001) {
        invalidatePreview(lane, { markDirty: false });
        debouncePreview(lane);
      }
      return measured;
    } catch (error) {
      console.warn("Editing highlight anchor measurement failed", error);
      return null;
    } finally {
      exactHighlightAnchorInflight.delete(key);
    }
  })();
  exactHighlightAnchorInflight.set(key, run);
  return run;
}

