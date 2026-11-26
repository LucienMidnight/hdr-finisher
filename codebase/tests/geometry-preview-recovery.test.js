const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");
const { declarations, frontendSource } = require("./frontend-source.js");

function fixture() {
  const element = () => ({ style: { display: "block", getPropertyValue: () => "" }, classList: { toggle() {} } });
  const els = Object.fromEntries([
    "previewCanvas", "previewImage", "previewStage", "dropzone", "zoomFit", "zoomActual", "previewDenoiseDetail",
    "previewMicroDetail", "previewMicroHdrDetail", "comparisonCanvas", "comparisonImage", "chromeProofImage",
  ].map(name => [name, element()]));
  const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  Object.assign(els.dropzone, { clientWidth: 800, clientHeight: 600, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => box(0, 0, 800, 600) });
  els.previewStage.dataset = { primaryLane: "hdr" };
  els.previewCanvas.parentElement = { ...element(), toggleAttribute() {} };
  els.chromeProofImage.style.display = els.previewImage.style.display = "none";
  const geometry = { width: 1400, height: 900 };
  const accepted = { lane: "hdr", sessionId: "photo", exact: true, requestedTier: "full", tier: "full",
    processedLongEdge: 4096, generation: 4, geometrySignature: JSON.stringify(geometry) };
  const state = {
    session: { session_id: "photo", source: { width: 6000, height: 4000 } },
    activeWorkflow: "grade", currentView: "hdr", previewGeneration: { hdr: 4 },
    zoomMode: "custom", zoomPercent: 65, editRevision: 8, acceptedPresentation: accepted,
    adjustments: { shared: { geometry } }, denoise: {}, gpuPreparedLane: { hdr: true }, previewUnavailableReason: "",
  };
  let retry;
  const context = vm.createContext({
    state, els, performance: { now: () => 1000 },
    window: { devicePixelRatio: 1, setTimeout: (fn, delay) => { retry = { fn, delay }; }, clearTimeout() {} },
    geometryTransformIsNeutral: () => false,
    geometrySignature: () => JSON.stringify(state.adjustments.shared.geometry),
    sourcePixelFrameDimensions: () => state.adjustments.shared.geometry,
    normalizedPreviewResolution: () => "full", previewTargetLongEdge: () => 6000,
    requiredProcessingLongEdge: () => 4096, perspectiveDraftLongEdge: () => 1600,
    previewCanvasFrameSize: () => state.acceptedPresentation,
    geometryDraftActive: () => false, cpuMicroPreviewSelected: () => false, interactiveScaleDecision: () => ({ coarse: false }),
    updateZoomReadout() {}, syncOverlayPlacement() {}, renderCurrentPreviewSize() {}, renderReadouts() {},
    clearRotateDraftTransformProperties() {}, clearInteractiveStraightenPreview() {}, debounceOverlayAndScopes() {},
    noteViewerPan() {}, renderViewerStatus() { return context.viewerState(); },
  });
  vm.runInContext(frontendSource("viewport-request.js"), context);
  vm.runInContext('let previewCapacityRecovery = null; const PREVIEW_RESOLUTION_OPTIONS = new Set(["full", "auto"]);\n' + declarations(
    "nativeGeometryViewportActive", "geometryViewportLayout", "nativeGeometryOutputRect", "previewIsVisible",
    "activePreviewElement", "visibleOutputRect", "clearPreviewCapacityRecovery", "schedulePreviewCapacityRecovery",
    "refineZoomView", "holdingNativeDenoisePictureForFit", "applyZoomGeometry", "acceptPreviewGeometry",
    "markPreviewUnavailable", "previewStatusText", "finishFailedGeometryHandoff", "viewerState", "deriveViewerState",
  ), context);
  return { context, els, state, accepted, box, retry: () => retry };
}

test("capacity recovery requests the bounded route at the same reduced edge", async () => {
  const { context, state, retry } = fixture();
  state.acceptedPresentation.processedLongEdge = 2048;
  assert.equal(context.nativeGeometryViewportActive("hdr", 4096), false);
  context.markPreviewUnavailable("Source refused");
  context.renderGpuDraft = async (lane, options) => {
    assert.equal(options.longEdge, 4096);
    assert.equal(options.viewport, true);
    assert.equal(context.nativeGeometryViewportActive(lane, options.longEdge, options.reason === "source-capacity-recovery"), true);
    state.acceptedPresentation.processedLongEdge = options.longEdge;
    return true;
  };
  context.schedulePreviewCapacityRecovery({ retryAfter: 5000 }, "hdr", "photo", 4, "refinement", 4096);
  assert.equal(retry().delay, 4000);
  assert.equal(context.viewerState().status, "unavailable");
  await retry().fn();
  assert.equal(context.viewerState().status, "ready");
  assert.equal(state.previewUnavailableReason, "");
});

test("Fit replaces a partial picture even at the same processing edge", async () => {
  const { context, els, state } = fixture();
  state.zoomMode = "fit";
  els.previewCanvas.hdrFrameRegion = { nativeGeometryViewport: true, frameWidth: 900, frameHeight: 700,
    x: 150, y: 100, width: 600, height: 450 };
  let draws = 0;
  context.renderGpuDraft = async (_lane, { longEdge }) => {
    ++draws;
    assert.equal(longEdge, 4096);
    els.previewCanvas.hdrFrameRegion = null;
    return true;
  };
  assert.equal(context.viewerState().status, "updating");
  await context.refineZoomView(null, 4096, "hdr", "photo");
  assert.equal(draws, 1);
  assert.equal(context.viewerState().status, "ready");
});

test("returning to a matching, already accepted picture clears Unavailable without a redraw", () => {
  const { context, state, accepted } = fixture();
  accepted.processedLongEdge = 5634;
  context.markPreviewUnavailable("Source refused");
  assert.equal(context.viewerState().status, "unavailable");
  context.requiredProcessingLongEdge = () => 5634;
  assert.equal(context.viewerState().status, "ready");
  assert.equal(state.previewUnavailableReason, "");
  assert.equal(state.acceptedPresentation, accepted);
});

test("Unavailable stays until an exact picture matches the current tier, lane, generation, geometry and edge", () => {
  const { context, state, accepted } = fixture();
  state.zoomPercent = 100;
  for (const mismatch of [{ requestedTier: "auto" }, { requestedTier: "display" }, { lane: "sdr" },
    { exact: false }, { generation: 3 }, { geometrySignature: "{}" }, { processedLongEdge: 3900 }]) {
    state.acceptedPresentation = { ...accepted, ...mismatch };
    context.markPreviewUnavailable("Source refused");
    assert.equal(context.viewerState().status, "unavailable", JSON.stringify(mismatch));
  }
  state.previewResolutionOverride = false;
  state.acceptedPresentation = accepted;
  assert.equal(context.viewerState().status, "unavailable");
  state.acceptedPresentation = { ...accepted, requestedTier: "display" };
  assert.equal(context.viewerState().status, "ready");
});

test("pending Before/After measures the right and lower After panes even on HDR", () => {
  const { context, els, state } = fixture();
  state.zoomPercent = 100;
  state.geometryPresentationPending = true;
  state.compareMode = "before";
  els.previewStage.dataset.primaryLane = "sdr";
  state.compareLayout = "side-horizontal";
  els.dropzone.scrollLeft = 1200;
  const horizontal = context.nativeGeometryOutputRect({ width: 1400, height: 900 });
  assert.equal(horizontal?.x, 0);
  assert.equal(horizontal?.width, 600);
  state.compareLayout = "side-vertical";
  els.dropzone.scrollLeft = 200;
  els.dropzone.scrollTop = 700;
  const vertical = context.nativeGeometryOutputRect({ width: 1400, height: 900 });
  assert.equal(vertical?.y, 0);
  assert.equal(vertical?.height, 400);
});

test("an offscreen After pane skips drawing and resumes the same bounded request when scrolled into view", async () => {
  const { context, els, state } = fixture();
  state.compareLayout = "side-horizontal";
  state.geometryPresentationPending = true;
  state.gpuPreview = {};
  state.denoiseRuntime = {};
  state.gpuDraftRefusals = {};
  els.previewStage.dataset.primaryLane = "sdr";
  const frame = { width: 1400, height: 900 };
  const calls = [];
  Object.assign(context, {
    gpuPreviewEligible: () => true, cancelGeometryUnderlayer() {}, gradeSourceIdentity: () => "source",
    nativeDenoiseViewport: () => false, liveGradeGrainSelected: () => false, denoiseNoiseViewActive: () => false,
    gpuLumaMaskOverlayOptions: () => null, projectReferenceWhiteNits: () => 203, gpuFrameSizeAt: () => frame,
    renderGpuDraft: async (lane, options) => { calls.push([lane, options]); return true; },
  });
  vm.runInContext(declarations("resumeOffscreenGeometryPreview", "renderGpuDraftForView", "transientGpuRefusal"), context);
  const request = { longEdge: 4096, tier: "refinement", viewport: true, reason: "source-capacity-recovery" };
  assert.equal(await context.renderGpuDraftForView("hdr", request), false);
  assert.equal(state.previewUnavailableReason, "");
  assert.equal(context.transientGpuRefusal(), true);
  assert.equal(context.resumeOffscreenGeometryPreview("hdr"), true);
  assert.equal(calls.length, 0);
  els.dropzone.scrollLeft = 700;
  assert.equal(context.resumeOffscreenGeometryPreview("hdr"), true);
  assert.equal(context.resumeOffscreenGeometryPreview("hdr"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "hdr");
  assert.deepEqual({ ...calls[0][1] }, { ...request, preservePicture: undefined });

  els.dropzone.scrollLeft = 0;
  assert.equal(await context.renderGpuDraftForView("hdr", request), false);
  state.previewGeneration.hdr++;
  els.dropzone.scrollLeft = 700;
  assert.equal(context.resumeOffscreenGeometryPreview("hdr"), false);
  assert.equal(calls.length, 1);
  delete els.previewStage;
  els.dropzone.scrollLeft = 0;
  assert.equal(context.nativeGeometryOutputRect(frame)?.width, Math.ceil(800 / .65));
});

test("the GPU handover measures the mounted CPU image instead of the hidden canvas", () => {
  const { context, els, state, accepted, box } = fixture();
  state.zoomPercent = 100;
  state.zoomReferenceFrame = { geometrySignature: accepted.geometrySignature };
  els.previewCanvas.style.display = "none";
  els.previewCanvas.getBoundingClientRect = () => box(0, 0, 0, 0);
  els.previewImage.style.display = "block";
  els.previewImage.getBoundingClientRect = () => box(-325, -70, 1400, 900);
  const visible = context.nativeGeometryOutputRect({ width: 1400, height: 900 });
  assert.equal(visible?.x, 325);
  assert.equal(visible?.y, 70);
  assert.equal(visible?.width, 800);
});

test("a refused tall crop keeps the wide picture's layout until replacement pixels arrive", () => {
  const { context, els, state, accepted } = fixture();
  Object.assign(accepted, { width: 1400, height: 900 });
  state.zoomMode = "fit";
  context.acceptPreviewGeometry(1400, 900, 4096);
  const dimensions = () => [els.previewCanvas.style.width, els.previewCanvas.style.height];
  const wide = dimensions();
  state.adjustments.shared.geometry = { width: 500, height: 1000 };
  state.geometryPresentationPending = true;
  context.markPreviewUnavailable("Source refused");
  assert.equal(state.geometryPresentationPending, false);
  assert.deepEqual(dimensions(), wide);
  context.acceptPreviewGeometry(500, 1000, 4096);
  assert.deepEqual(dimensions(), ["300px", "600px"]);
});
