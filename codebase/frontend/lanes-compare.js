async function applyComparisonUrl(url) {
  try {
    await new Promise((resolve, reject) => {
      els.comparisonImage.onload = () => resolve();
      els.comparisonImage.onerror = () => reject(new Error("Comparison image could not load settled preview data."));
      els.comparisonImage.src = url;
    });
  } catch (error) {
    console.warn(error);
    return false;
  } finally {
    els.comparisonImage.onload = null;
    els.comparisonImage.onerror = null;
  }
  els.comparisonCanvas.style.display = "none";
  els.comparisonImage.style.display = "block";
  return true;
}

/**
 * Track the render in flight for the current lane.
 *
 * Two grading renders racing means the loser is abandoned after it has already
 * paid for its source upload and its highlight-peak measurement. Refinement is
 * the one caller that can start while another render is still running, so it
 * waits on this instead of superseding it.
 */
/**
 * The exact size of the frame a render at `longEdge` produces, or null until
 * the coordinate map for that size has said what geometry makes of it.
 */
function clearComparisonPreview({ keepRenderedState = false } = {}) {
  els.comparisonImage.removeAttribute("src");
  els.comparisonImage.style.display = "none";
  els.comparisonCanvas.style.display = "none";
  if (!keepRenderedState) {
    state.comparisonRenderedLane = null;
    state.comparisonRenderedGeneration = null;
    state.comparisonRenderedGeometry = null;
  }
}

async function switchLane(lane) {
  if (!["hdr", "sdr"].includes(lane)) return;
  const switchGeneration = ++state.laneSwitchGeneration;
  state.comparePendingPeek = false;
  abandonPerspectiveDraft();
  if (state.rotateDraftGeometry) closeRotateMode(false);
  // A lane change is a presentation boundary. Commit the newest optimistic
  // global state before either lane renders so a round trip cannot replace a
  // settled draft with an older authoritative revision.
  if (await syncGlobalEditState() === false || switchGeneration !== state.laneSwitchGeneration) return;
  if (state.currentView === lane && cacheReady(lane)) {
    renderLaneChrome();
    renderLocalAdjustments();
    return;
  }
  state.currentView = lane;
  state.renderCoordinator?.noteActiveLane(lane);
  state.selectedCurvePoint = Math.min(state.selectedCurvePoint ?? 0, currentCurveValues().length - 1);
  renderLaneChrome();
  // Local controls belong to the selected rendition too. Update them before
  // waiting for preview/scopes so rapid HDR/SDR switching never leaves the
  // previous lane's values or slider positions visible during rendering.
  renderLocalAdjustments();
  syncCurveControlsFromState();
  renderCurveChannelTabs();
  drawCurveEditor();
  renderReadouts();
  const previewTask = (async () => {
    const rendered = gpuPreviewEligible(lane)
      ? await renderGpuDraft(lane, { longEdge: settledProxyLongEdge() })
      : false;
    if (rendered) return true;
    if (cacheReady(lane)) return showCachedPreview(lane);
    return renderPreviewForLane(lane, true, settledProxyLongEdge(), { showProgress: false });
  })();
  await previewTask;
  if (switchGeneration !== state.laneSwitchGeneration || lane !== state.currentView) return;
  const denoiseIdentity = state.gpuPreview?.diagnosticsSnapshot?.().denoise?.identity || "";
  if (state.denoise[lane].enabled && !denoiseIdentity.includes(`:${lane}:`)) {
    state.denoiseRuntime[lane].status = "dirty";
    await recalculateDenoise();
    if (switchGeneration !== state.laneSwitchGeneration || lane !== state.currentView) return;
  } else if (!state.denoise[lane].enabled && denoiseIdentity && !denoiseIdentity.includes(`:${lane}:`)) {
    state.gpuPreview?.evictDenoiseCache?.();
  }
  // GPU scopes read the presented canvas. Wait until this lane has replaced
  // the previous lane's canvas before sampling it.
  await Promise.all([refreshOverlay(), refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane })]);
  if (state.compareLayout !== "single") {
    const other = lane === "hdr" ? "sdr" : "hdr";
    await renderComparisonPreview(other, { force: true });
  }
  prepareInactivePreview();
  if (previewNeedsRefinement()) debouncePreview(lane);
}

function arrangeLaneControlGroups(lane) {
  const panel = els.lanePanels.find((candidate) => candidate.dataset.lanePanel === lane);
  if (!panel) return;
  // HDR runs Highlight Compression as the output limiter, so it reads after the
  // tone and curve work it compresses and before Color. SDR keeps its shoulder
  // early, where it is the scene-to-display placement rather than a limiter.
  const groupOrder = lane === "hdr"
    ? ["denoise", "hdr-tone", "hdr-equalizer", "hdr-zones", "curves", "hdr-highlights", "hdr-color"]
    : ["denoise", "sdr-tone", "sdr-highlights", "sdr-equalizer", "sdr-zones", "curves", "sdr-color"];
  for (const groupName of groupOrder) {
    const group = document.querySelector(`.control-group[data-group="${groupName}"]`);
    if (group) panel.append(group);
  }
  const colorGrading = document.querySelector('.control-group[data-group="color-grading"]');
  const blackAndWhiteGroup = document.querySelector('.control-group[data-group="black-and-white"]');
  const localAdjustmentsGroup = document.querySelector('.control-group[data-group="local-adjustments"]');
  // Panel order after Color: 12 Color Grading, 13 Black & White, 14 Local
  // Adjustments. Only the panel order: Black & White still processes straight
  // after Color, so the Color Grading wheels can tone the grey picture.
  if (colorGrading && blackAndWhiteGroup) colorGrading.after(blackAndWhiteGroup);
  const beforeLocals = blackAndWhiteGroup || colorGrading;
  if (beforeLocals && localAdjustmentsGroup) beforeLocals.after(localAdjustmentsGroup);
}

function renderLaneChrome() {
  const lane = state.currentView;
  arrangeLaneControlGroups(lane);
  document.body.dataset.activeLane = lane;
  els.previewStage.dataset.primaryLane = lane;
  els.previewPrimaryPane.dataset.lane = lane;
  els.previewSecondaryPane.dataset.lane = lane === "hdr" ? "sdr" : "hdr";
  els.viewButtons.forEach((button) => {
    const active = button.dataset.kind === lane;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  els.proofLaneButtons.forEach((button) => {
    const active = button.dataset.proofLane === lane;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  els.lanePanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.lanePanel !== lane));
  els.viewerBranchNote.textContent = branchCopy[lane];
  els.scopeKindLabel.textContent = lane.toUpperCase();
  renderScopeControlAvailability();
  state.previewInfo = state.previewInfoByLane[lane];
  renderDenoiseControls();
  els.filmLookSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.colorGradingSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.vignetteSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.detailSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.blackAndWhiteSdrActions?.classList.toggle("hidden", lane !== "sdr");
  const match = state.editDocument?.sdr_match;
  els.sdrMatchEntireActions?.classList.toggle("hidden", lane !== "sdr");
  if (els.sdrMatchEntire) els.sdrMatchEntire.disabled = !state.session;
  if (els.sdrMatchEntireStatus) {
    els.sdrMatchEntireStatus.textContent = match?.materialized_status === "needs_review"
      ? "Match needs review · editable SDR controls populated"
      : match?.materialized_status === "matched"
        ? "Matched into editable SDR controls"
        : "";
  }
  syncControlsFromState();
  drawToneEqualizerEditor(lane);
  window.HDRProofing?.syncLane();
  renderCompareStatus();
  updateControlReadouts();
  renderControlState();
}

function renderCompareStatus() {
  if (!state.session) {
    els.compareLayoutButtons.forEach((button) => { button.disabled = true; });
    return;
  }
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  const ready = cacheReady(other);
  els.compareLayoutButtons.forEach((button) => { button.disabled = false; });
  // Readiness does not gate the control. Inactive-lane work
  // is deferred to true idle, so disabling the control would make the
  // deferral unreachable; an explicit click or held comparison starts the
  // load now instead. `dataset.prepared` keeps the state observable to
  // diagnostics and tests.
  els.compareButton.dataset.prepared = String(ready);
}

function bindCompareControl() {
  els.compareLayoutButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const layout = button.dataset.compareLayout;
      if (layout === "single" && state.compareLayout === "single") {
        const other = state.currentView === "hdr" ? "sdr" : "hdr";
        // Explicit comparison intent: warm the other lane now. `switchLane`
        // renders it either way, but the preload marks the lane prepared so a
        // following hold-to-peek is instant.
        if (!cacheReady(other)) prepareInactivePreview({ immediate: true });
        await switchLane(other);
        return;
      }
      await setCompareLayout(layout);
    });
  });
}

function beginCompareHold() {
  if (!state.session || state.compareHoldTimer || state.comparePeekActive) return;
  if (state.compareLayout !== "single") {
    const other = state.currentView === "hdr" ? "sdr" : "hdr";
    switchLane(other).catch(() => null);
    return;
  }
  state.compareHeld = true;
  state.compareHoldTimer = window.setTimeout(async () => {
    state.compareHoldTimer = null;
    if (!state.compareHeld) return;
    // `false` means the lane is not prepared: an explicit preload has started
    // and the peek completes when it lands, if the hold is still down.
    if (await peekOtherLane() === false && state.compareHeld) state.comparePendingPeek = true;
  }, 180);
}

async function endCompareHold() {
  if (state.compareLayout !== "single") return;
  if (!state.compareHeld) return;
  state.compareHeld = false;
  state.comparePendingPeek = false;
  if (state.compareHoldTimer) {
    window.clearTimeout(state.compareHoldTimer);
    state.compareHoldTimer = null;
    const other = state.currentView === "hdr" ? "sdr" : "hdr";
    if (cacheReady(other)) await switchLane(other);
    return;
  }
  if (state.comparePeekActive) await restoreActiveLane();
}

async function peekOtherLane() {
  if (state.compareLayout !== "single") return false;
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (!cacheReady(other)) {
    // Explicit comparison intent: prepare the lane now instead of leaving the
    // gesture inert, and let the preload complete it.
    prepareInactivePreview({ immediate: true });
    return false;
  }
  state.comparePeekActive = true;
  window.HDRProofing?.syncLane();
  clearPreviewOverlay();
  await showCachedPreview(other);
  els.viewerBranchNote.textContent = `${branchCopy[other]} Release V to return to the authored preview.`;
  return true;
}

async function restoreActiveLane() {
  state.comparePeekActive = false;
  window.HDRProofing?.syncLane();
  await showCachedPreview(state.currentView);
  renderLaneChrome();
  await refreshOverlay();
}

async function setCompareLayout(layout) {
  if (!COMPARE_LAYOUTS.has(layout)) return;
  state.compareLayout = layout;
  state.comparePeekActive = false;
  state.comparePendingPeek = false;
  renderCompareLayout();
  if (layout === "single") {
    await showCachedPreview(state.currentView);
    await refreshOverlay();
    return;
  }
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  await renderComparisonPreview(other, { force: true });
}

function renderCompareLayout() {
  const layout = COMPARE_LAYOUTS.has(state.compareLayout) ? state.compareLayout : "single";
  els.previewStage.dataset.compareLayout = layout;
  els.previewSecondaryPane.setAttribute("aria-hidden", String(layout === "single"));
  els.compareLayoutButtons.forEach((button) => {
    const active = button.dataset.compareLayout === layout;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (layout === "single") clearComparisonPreview({ keepRenderedState: true });
  applyZoomGeometry();
  syncOverlayPlacement();
  renderCompareStatus();
}

async function renderComparisonPreview(lane, { force = false } = {}) {
  if (!state.session || state.compareLayout === "single" || lane === state.currentView) return false;
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  const alreadyRendered = state.comparisonRenderedLane === lane
    && state.comparisonRenderedGeneration === generation
    && state.comparisonRenderedGeometry === signature
    && (els.comparisonCanvas.style.display !== "none" || els.comparisonImage.style.display !== "none");
  if (!force && alreadyRendered) return true;

  els.previewSecondaryPane.dataset.lane = lane;
  if (gpuPreviewEligible(lane)) {
    try {
      const result = await state.gpuPreview.renderTo(
        els.comparisonCanvas,
        state.session.session_id,
        lane,
        state.adjustments,
        sampleCurvePoints,
        settledProxyLongEdge(),
        state.compareWithoutLocals ? [] : localAdjustments(),
        state.editRevision,
        null,
        projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
      );
      if (result && lane !== state.currentView && generation === state.previewGeneration[lane]) {
        state.gpuPreparedLane[lane] = true;
        els.comparisonImage.style.display = "none";
        els.comparisonCanvas.style.display = "block";
        state.comparisonRenderedLane = lane;
        state.comparisonRenderedGeneration = generation;
        state.comparisonRenderedGeometry = signature;
        state.comparisonPresentation = {
          lane,
          generation,
          longEdge: settledProxyLongEdge(),
          transport: "WebGPU",
          exact: true,
        };
        applyZoomGeometry();
        renderCompareStatus();
        return true;
      }
    } catch (error) {
      console.warn("Comparison WebGPU render failed; using the settled backend preview.", error);
    }
  }

  let cached = state.previewCache[lane];
  if (!(cached?.generation === generation && cached.geometrySignature === signature && (cached.raw || cached.url))) {
    await renderPreviewForLane(lane, false, settledProxyLongEdge(), {
      showProgress: false,
      raw: !state.gpuPreview?.available,
    });
    cached = state.previewCache[lane];
  }
  if (!cached || lane === state.currentView || generation !== state.previewGeneration[lane]) return false;
  if (cached.raw) applyRawComparisonPreview(cached);
  else if (cached.url) {
    const applied = await applyComparisonUrl(cached.url);
    if (!applied) return false;
  } else return false;
  state.comparisonRenderedLane = lane;
  state.comparisonRenderedGeneration = generation;
  state.comparisonRenderedGeometry = signature;
  state.comparisonPresentation = {
    lane,
    generation,
    longEdge: settledProxyLongEdge(),
    transport: cached.raw ? "CPU" : "CPU (encoded)",
    exact: true,
  };
  applyZoomGeometry();
  renderCompareStatus();
  return true;
}

