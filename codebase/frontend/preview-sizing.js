function normalizedPreviewResolution(value = state.previewResolution) {
  const normalized = String(value || "");
  return PREVIEW_RESOLUTION_OPTIONS.has(normalized) ? normalized : DEFAULT_PREVIEW_RESOLUTION;
}

function previewResolutionLabel(value = state.previewResolution) {
  if (value === "display") return state.zoomMode === "custom" && state.zoomPercent >= 100
    ? "Native region exact" : "Display exact";
  if (value === "native-region") return "Native region";
  const normalized = normalizedPreviewResolution(value);
  if (normalized === "full") return "Full";
  return `${Math.round(Number(normalized) / 1024)}K`;
}

function previewTargetLongEdge(value = state.previewResolution) {
  const normalized = normalizedPreviewResolution(value);
  const sourceEdge = Math.max(Number(state.session?.source?.width) || 0, Number(state.session?.source?.height) || 0);
  if (normalized === "full") return Math.max(256, sourceEdge || 256);
  const requested = Number(normalized);
  return Math.max(256, Math.min(sourceEdge || requested, requested));
}

function requiredProcessingLongEdge() {
  if (state.previewResolutionOverride === false) {
    const nativeEdge = previewTargetLongEdge("full");
    const edge = state.zoomMode !== "custom" ? displayedLongEdge()
      : state.zoomPercent >= 100 ? nativeEdge : steppedProcessingLongEdge(nativeEdge, displayedLongEdge());
    return Math.round(Math.max(256, Math.min(nativeEdge, edge)));
  }
  return state.zoomMode === "custom" && state.zoomPercent >= 100
    ? previewTargetLongEdge("full")
    : previewTargetLongEdge();
}

/**
 * The size a magnified view below 100% is processed at: the smallest of a few
 * fixed sizes (the source's long edge divided by powers of the square root of
 * two) that still covers what is displayed.
 *
 * Every distinct processing size is a resized copy of the whole source in the
 * backend and a fresh set of masks and luminance on the GPU. A wheel zoom
 * lands on arbitrary percentages, and each one used to pay all of that; at
 * 98% it built a copy barely smaller than the source itself. The steps are
 * shared by every percentage in their range, and the view is scaled from the
 * step to the screen, which at most doubles the pixels processed.
 */
function steppedProcessingLongEdge(nativeEdge, displayedEdge) {
  let edge = nativeEdge;
  for (let step = 1; step <= 16; step += 1) {
    const next = Math.round(nativeEdge / 2 ** (step / 2));
    if (next < displayedEdge || next < 1024) break;
    edge = next;
  }
  return edge;
}

function previewResolutionDimensions(value = state.previewResolution) {
  if (value === state.previewResolution && state.previewResolutionOverride === false) value = "display";
  if (value === "display") {
    const edge = requiredProcessingLongEdge();
    const sourceWidth = Math.max(1, Number(state.session?.source?.width) || edge);
    const sourceHeight = Math.max(1, Number(state.session?.source?.height) || edge);
    const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
    return { width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)), longEdge: edge, tier: "display" };
  }
  const normalized = normalizedPreviewResolution(value);
  const sourceWidth = Math.max(0, Number(state.session?.source?.width) || 0);
  const sourceHeight = Math.max(0, Number(state.session?.source?.height) || 0);
  if (!(sourceWidth > 0 && sourceHeight > 0)) {
    const edge = previewTargetLongEdge(normalized);
    return { width: edge, height: edge, longEdge: edge, tier: normalized };
  }
  if (normalized === "full") {
    return { width: sourceWidth, height: sourceHeight, longEdge: Math.max(sourceWidth, sourceHeight), tier: normalized };
  }
  const longEdge = previewTargetLongEdge(normalized);
  const scale = Math.min(1, longEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    longEdge,
    tier: normalized,
  };
}

function previewExecutionForTier(value = state.previewResolution) {
  if (state.previewResolutionOverride === false && value === state.previewResolution) {
    return requiredProcessingLongEdge() >= previewTargetLongEdge("full") ? "strips" : "whole";
  }
  return normalizedPreviewResolution(value) === "full" ? "strips" : "whole";
}

function interactiveDraftGuaranteedTiled(lane = state.currentView) {
  const accepted = state.acceptedPresentation;
  // An edit bumps the generation before this prediction runs. The previous
  // exact frame still describes the same viewport and allocation footprint.
  if (!state.gpuPreview?.available || accepted?.lane !== lane
    || accepted.geometrySignature !== geometrySignature()
    || accepted.processedLongEdge !== requiredProcessingLongEdge()
    || !(accepted.width > 0 && accepted.height > 0)) return false;
  return accepted.execution === "tiled" || state.gpuPreview.minimumExecutionDecision(
    accepted.width,
    accepted.height,
    state.previewResolutionOverride ? normalizedPreviewResolution() : "display",
  )?.mode === "tiled";
}

function applyRoiPreview(value) {
  state.roiPreviewMode = value === "refinement" ? "refinement" : "fit";
  state.renderCoordinator?.setRoiMode(state.roiPreviewMode);
  cancelRoiCatchUp();
  cancelRoiPanRefinement();
  renderReadouts();
  if (state.session) {
    invalidatePreview(state.currentView, { markDirty: false });
    debouncePreview(state.currentView);
  }
}

function cancelRoiCatchUp() {
  state.renderCoordinator?.cancelCatchUp(state.currentView);
}

function cancelRoiPanRefinement() {
  state.renderCoordinator?.cancelPan(state.currentView);
}

/**
 * A pan never waits on a render: the compositor moves the accepted frame
 * immediately. What a pan can do is expose a strip that was never refined for
 * the current generation, so once the scroll pauses the coordinator asks for a
 * refinement pass over the new visible region. The renderer's display-scale pan
 * cache answers every tile it already holds at this generation, so panning back
 * into a refined region costs nothing and only a newly exposed strip is
 * rendered. The pass it starts re-arms the whole-frame catch-up, so stopping
 * after a pan still converges the rest of the image.
 */
function noteViewerPan() {
  state.renderCoordinator?.notePan(state.currentView);
}

async function requestRoiPanRefinement() {
  return state.renderCoordinator
    ? state.renderCoordinator.requestPanRefinement(state.currentView)
    : false;
}

/**
 * The legacy-versus-ROI diagnostic A/B path.
 *
 * Renders the same edit both ways at the same tier and compares the visible
 * region pointwise through the frozen request contract. The generation is
 * bumped between the two passes so the ROI pass re-renders the region instead
 * of reusing the legacy pass's accepted tiles; the graph and edit state are
 * identical, so the route is the only difference under test. The tolerance is
 * supplied by the caller because each module's tolerance is
 * still outstanding.
 */
async function runRoiParity(options = {}) {
  const lane = state.currentView;
  if (!state.session) return { ok: false, reason: "no-session" };
  if (!gpuPreviewEligible(lane)) return { ok: false, reason: "gpu-not-eligible" };
  if (geometryDraftActive()) return { ok: false, reason: "geometry-draft-active" };
  if (!state.gpuPreview?.readPresentationRegion) return { ok: false, reason: "no-readback" };
  const longEdge = Number(options.longEdge) > 0 ? Number(options.longEdge) : refinementProxyLongEdge();
  const visible = visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height);
  if (!visible) return { ok: false, reason: "fit-has-no-roi" };
  const capture = () => state.gpuPreview.readPresentationRegion(
    visible.width,
    visible.height,
    visible.x,
    visible.y,
  );
  const accepted = () => {
    const record = state.acceptedPresentation;
    return record
      ? {
        generation: record.generation ?? null,
        execution: record.execution || null,
        processedLongEdge: record.processedLongEdge ?? null,
      }
      : null;
  };

  const legacy = await renderGpuDraft(lane, { tier: "refinement", longEdge, viewport: false });
  if (!legacy) return { ok: false, reason: "legacy-render-refused", refusal: state.lastGpuDraftRefusal };
  const legacyPixels = await capture();
  if (!legacyPixels) return { ok: false, reason: "legacy-readback-failed" };
  const legacyAccepted = accepted();

  // A newer generation forces the ROI pass to re-render the region rather than
  // reuse the legacy pass's tiles. The graph and edit state are unchanged.
  invalidatePreview(lane, { markDirty: false });
  const roi = await renderGpuDraft(lane, { tier: "refinement", longEdge });
  if (!roi) return { ok: false, reason: "roi-render-refused", refusal: state.lastGpuDraftRefusal };
  const roiPixels = await capture();
  if (!roiPixels) return { ok: false, reason: "roi-readback-failed" };
  const roiAccepted = accepted();

  const comparison = window.HDRViewportRequest?.compareWithLegacy
    ? window.HDRViewportRequest.compareWithLegacy({
      roiPixels: roiPixels.values,
      legacyPixels: legacyPixels.values,
      roiRect: { x: 0, y: 0, width: roiPixels.width, height: roiPixels.height },
      legacyRect: { x: 0, y: 0, width: legacyPixels.width, height: legacyPixels.height },
      roiWidth: roiPixels.width,
      legacyWidth: legacyPixels.width,
      channels: 4,
      tolerance: Number(options.tolerance) || 0,
    })
    : null;
  return {
    ok: true,
    visible,
    longEdge,
    legacy: { ...legacyAccepted, pixels: { width: legacyPixels.width, height: legacyPixels.height } },
    roi: { ...roiAccepted, pixels: { width: roiPixels.width, height: roiPixels.height } },
    comparison,
  };
}

function displayedLongEdge() {
  const rect = els.dropzone.getBoundingClientRect();
  const paneWidth = state.compareLayout === "side-horizontal" ? rect.width / 2 : rect.width;
  const paneHeight = state.compareLayout === "side-vertical" ? rect.height / 2 : rect.height;
  // Keep this calculation independent of the geometry coordinate-map cache:
  // that cache keys itself by settledProxyLongEdge(), which calls this helper.
  const source = { width: state.session?.source?.width || 1, height: state.session?.source?.height || 1 };
  const geometry = state.adjustments?.shared?.geometry || {};
  const rotated = [90, 270].includes(Number(geometry.rotation) || 0);
  const crop = geometry.crop || {};
  const frame = {
    width: Math.max(1, (rotated ? source.height : source.width) * (Number(crop.width) || 1)),
    height: Math.max(1, (rotated ? source.width : source.height) * (Number(crop.height) || 1)),
  };
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const fitScale = Math.min(paneWidth * dpr / frame.width, paneHeight * dpr / frame.height);
  return Math.max(source.width, source.height) * (state.zoomMode === "fit"
    ? fitScale : Math.min(1, state.zoomPercent / 100));
}

function residentAuthoringLongEdge() {
  const accepted = state.acceptedPresentation;
  const target = requiredProcessingLongEdge();
  if (!gpuPreviewEligible(state.currentView)
    || accepted?.transport !== "WebGPU"
    || accepted.lane !== state.currentView
    || accepted.geometrySignature !== geometrySignature()
    || (accepted.processedLongEdge ?? accepted.longEdge) !== target
    || els.previewCanvas.style.display === "none") return null;
  return target;
}

function bootstrapProxyLongEdge() {
  // Used only while the selected tier is still Preparing, so the viewer has
  // something truthful to show instead of an empty surface. It is labeled as a
  // placeholder and is never accepted as the selected tier.
  return Math.round(Math.min(requiredProcessingLongEdge(), clamp(displayedLongEdge(), 512, 1024)));
}

function interactiveProxyLongEdge() {
  // Once the selected tier has produced a
  // valid result, a gesture may not change the processing resolution. The
  // previous display-bounded 512-1024 proxy is now the bootstrap path only.
  if (selectedTierReady()) return requiredProcessingLongEdge();
  return bootstrapProxyLongEdge();
}

function previewGraphTimingKey(lane = state.currentView) {
  const film = state.adjustments?.[lane]?.film_look || {};
  return [lane, Boolean(state.denoise?.[lane]?.enabled), gpuDetailGraphActive(lane),
    localAdjustments().filter((item) => item.enabled !== false).length,
    Number(film.grain_amount) > 0, Number(film.bloom_amount) > 0,
    Number(film.halation_amount) > 0,
    Number(state.adjustments?.[lane]?.detail?.softness) > 0 || (Number(state.adjustments?.[lane]?.detail?.microcontrast) || 0) !== 0,
    state.zoomMode === "custom" ? "zoom" : "fit"].join(":");
}

/**
 * The latency controller's preference for the current setting.
 *
 * The preview policy uses
 * response menu with one opt-in. Off is the old Precise: every frame exact,
 * no coarse pass. On is the old Balanced: the controller may choose a coarse
 * scale when its timing evidence says an exact frame would be slow.
 */
function dragLatencyPreference() {
  return state.fasterDragging ? "balanced" : "precise";
}

function interactiveScaleDecision(lane = state.currentView, { interacting = true } = {}) {
  const exactEdge = refinementProxyLongEdge();
  const visibleEdge = Math.min(exactEdge, Math.max(1, displayedLongEdge()));
  return state.previewLatencyController?.choose({
    preference: dragLatencyPreference(),
    graph: previewGraphTimingKey(lane),
    exactEdge,
    visiblePixels: visibleEdge * visibleEdge,
    interacting,
  }) || { edge: interactiveProxyLongEdge(), coarse: false, scale: 1 };
}

function responseCoarseLongEdge(exactEdge) {
  // Reuse one small source level across nearby zooms and graph changes. Exact
  // output remains at the display-required edge in the mandatory follow-up.
  const edge = Math.min(2048, Math.max(256, exactEdge - 1));
  return edge >= 1024 ? (edge >= 2048 ? 2048 : 1024)
    : edge >= 512 ? 512 : 256;
}

function globalDetailActive(lane = state.currentView) {
  const branch = state.adjustments?.[lane];
  const detail = branch?.detail || {};
  return Boolean(
    branch?.detail_section_enabled !== false
    && [detail.texture_amount, detail.clarity_amount, detail.sharpen_amount]
      .some((value) => Math.abs(Number(value) || 0) > 0.000001)
  );
}

function gpuDetailGraphActive(lane = state.currentView) {
  if (globalDetailActive(lane)) return true;
  return localAdjustments().some((local) => {
    const grade = local?.[`${lane}_grade`];
    const detail = grade?.detail || {};
    return local?.enabled !== false
      && Number(local?.opacity) > 0
      && grade?.enabled !== false
      && [detail.texture_amount, detail.clarity_amount, detail.sharpen_amount]
        .some((value) => Math.abs(Number(value) || 0) > 0.000001);
  });
}

function beginGlobalDetailInteraction(path) {
  const resolvedPath = resolveAdjustmentPath(path);
  if (!/^(hdr|sdr)\.detail\./.test(resolvedPath || "")) {
    // A no-op Detail pointer gesture does not schedule a settle callback.
    // Reset its marker when any other global gesture starts so unrelated
    // controls never inherit Detail backpressure or refinement restoration.
    state.detailInteractionRestore = null;
    return;
  }
  const lane = resolvedPath.startsWith("sdr.") ? "sdr" : "hdr";
  state.detailInteractionRestore = {
    lane,
    longEdge: residentAuthoringLongEdge(),
  };
}

function settledProxyLongEdge() {
  const resident = residentAuthoringLongEdge();
  if (resident) return resident;
  // The settled pass always aims at the selected tier. Stopping short of it
  // here is what produced the old "low while dragging, high once it settles"
  // jump that the current policy prevents.
  return Math.round(requiredProcessingLongEdge());
}

function refinementProxyLongEdge() {
  return Math.round(requiredProcessingLongEdge());
}

// One measured peak per edit state, so a scope refresh that changes nothing
// about the picture does not pay for the pass again.
function gpuFrameSizeAt(longEdge) {
  return geometryMath.frameSizeAtEdge(
    state.session?.source,
    state.adjustments?.shared?.geometry,
    longEdge,
    geometryCoordinateMapCache.get(geometryCoordinateMapKey(geometrySignature(), longEdge)),
  );
}

/**
 * About the size of that frame: the full-resolution output scaled by the
 * processing edge over the source's. Good for placing the view, not for
 * addressing pixels.
 */
function approximateGpuFrameSizeAt(longEdge) {
  const source = { width: state.session?.source?.width || 1, height: state.session?.source?.height || 1 };
  const frame = sourcePixelFrameDimensions(state.adjustments?.shared?.geometry) || source;
  const scale = Math.min(1, longEdge / Math.max(1, source.width, source.height));
  return {
    width: Math.max(1, Math.round(frame.width * scale)),
    height: Math.max(1, Math.round(frame.height * scale)),
  };
}

