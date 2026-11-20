const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { frontendSource, declarations } = require("./frontend-source.js");

test("the reduced CPU Denoise image is presented at its actual size without another GPU render", async () => {
  for (const reduced of [null, 4096]) {
    const state = { session: { session_id: "photo" }, currentView: "hdr", gpuPreview: { available: true },
      previewCache: {}, previewGeneration: { hdr: 1 }, previewControllers: {}, previewInfoByLane: {} };
    const edge = reduced || 5202;
    const presentation = [];
    let gpuAttempts = 0;
    const context = vm.createContext({ state, AbortController, URL, els: { scopeKindLabel: {} },
      geometryDraftActive: () => false, geometrySignature: () => "{}", syncGlobalEditState: async () => true,
      cpuPreviewReason: () => "gpu-failed:validation", localsBypassed: () => false,
      previewExecutionForTier: () => "strips", mediaQueryMatch: () => true,
      fetch: async () => new Response(new Blob(["pixels"]), { headers: {
        "X-Image-Width": edge, "X-Image-Height": 3000, ...(reduced ? { "X-Preview-Reduced-Edge": reduced } : {}),
      } }),
      previewInfoFromResponse: () => ({ transport: "JPEG" }), shouldKeepHdrGpuSurface: () => true,
      renderGpuDraft: async () => { gpuAttempts++; }, gpuPreviewEligible: () => true,
      setGpuSurfaceHdr() {}, applyPreviewUrl: async () => true, refinementProxyLongEdge: () => 5202,
      renderCompareStatus() {}, renderReadouts() {}, acceptPresentation: (...args) => presentation.push(args),
      CPU_PREVIEW_MAX_LONG_EDGE: 16384 });
    vm.runInContext(declarations("renderPreviewForLaneInner", "describeReducedDenoisePreview"), context);
    assert.equal(await context.renderPreviewForLaneInner("hdr", true, 5202, { showProgress: false, denoiseFallback: true }), true);
    assert.equal(gpuAttempts, 0);
    assert.equal(presentation[0][9], edge);
    assert.equal(presentation[0][5], "CPU/backend");
    if (reduced) assert.match(state.previewUnavailableReason, /4096px/);
    URL.revokeObjectURL(state.previewCache.hdr.url);
  }
});

test("switching lanes after a hard Denoise failure uses the CPU without another GPU try", async () => {
  const state = { currentView: "hdr", laneSwitchGeneration: 0, compareLayout: "single",
    denoise: { sdr: { enabled: true } }, denoiseRuntime: { sdr: {} } };
  const calls = [];
  const context = vm.createContext({ state, syncGlobalEditState: async () => true, cacheReady: () => true,
    gpuPreviewEligible: () => true, renderGpuDraft: async () => { calls.push("gpu"); return false; },
    transientGpuRefusal: () => false, showCachedPreview: async (_, options) => {
      calls.push(options?.skipGpu ? "cpu-cache" : "gpu-cache"); return false;
    }, renderPreviewForLane: async (_, __, ___, options) => { calls.push(options.denoiseFallback ? "denoised-cpu" : "cpu"); },
    recalculateDenoise: async () => calls.push("gpu-recalculate"), debouncePreview: () => calls.push("refine"),
    currentCurveValues: () => [], settledProxyLongEdge: () => 1600, scopeLongEdge: () => 640,
    previewNeedsRefinement: () => true, endBeforePeek() {}, abandonPerspectiveDraft() {}, suspendGradeInstruments() {},
    renderLaneChrome() {}, renderLocalAdjustments() {}, syncCurveControlsFromState() {}, renderCurveChannelTabs() {},
    drawCurveEditor() {}, renderReadouts() {}, refreshOverlay() {}, refreshScopes() {}, prepareInactivePreview() {} });
  vm.runInContext(declarations("switchLane"), context);
  await context.switchLane("sdr");
  assert.deepEqual(calls, ["gpu", "cpu-cache", "denoised-cpu"]);
});

for (const method of ["standard", "fine_grain", "clean_grain"]) {
  test(`${method} keeps the sharp patch mounted while the replacement is drawn`, async () => {
    const previous = { x: 10, y: 20, width: 900, height: 600, frameWidth: 5202, frameHeight: 3464 };
    const next = { ...previous };
    const canvas = { hdrFrameRegion: previous, style: { display: "block" },
      parentElement: { hasAttribute: () => true, removeAttribute: () => {} } };
    const detail = { width: previous.width, height: previous.height };
    const state = {
      currentView: "hdr", session: { session_id: "photo", source: { width: 5202, height: 3464 } },
      previewGeneration: { hdr: 2 }, acceptedPresentation: { lane: "hdr", geometrySignature: "{}" },
      adjustments: {}, denoise: { hdr: { enabled: true, controls: { method } } },
      denoiseRuntime: { hdr: {} }, gpuDraftRefusals: {}, gpuPreparedLane: {}, previewInfoByLane: {},
      zoomMode: "custom",
    };
    let edge = 5202;
    let underlayerDraws = 0;
    let detailBeforeReplacement;
    state.gpuPreview = {
      diagnosticsSnapshot: () => ({ denoise: { cacheReady: true, identity: `photo:hdr:${edge}:{}:source` } }),
      retargetPreparedDenoise: (_session, _lane, nextEdge) => { edge = nextEdge; return true; },
      async render(...args) {
        underlayerDraws++;
        // The renderer clears the whole-photo canvas's own region metadata
        // at submission, while the sharp pixels live in the separate canvas.
        canvas.hdrFrameRegion = null;
        args.at(-1).onFrameSubmitted(null, true);
        return { execution: "direct" };
      },
      async renderTo(target, ...args) {
        detailBeforeReplacement = { target, region: canvas.hdrFrameRegion, width: detail.width };
        args.at(-1).onFrameSubmitted(next, true);
        return { execution: "tiled", width: next.frameWidth, height: next.frameHeight };
      },
    };
    const noop = () => {};
    const context = vm.createContext({
      state, performance, window: {}, els: { previewCanvas: canvas, previewDenoiseDetail: detail,
        previewImage: { style: {} }, emptyState: { style: {} } },
      geometryDraftActive: () => false, gpuPreviewEligible: () => true, nativeDenoiseViewport: () => true,
      geometrySignature: () => "{}", denoiseNoiseViewActive: () => false, gpuLumaMaskOverlayOptions: () => null,
      projectReferenceWhiteNits: () => 203, requiredProcessingLongEdge: () => 5202,
      recalculateDenoise: async (_lane, options) => { edge = options.longEdge; return true; },
      gpuFrameSizeAt: () => ({ width: 5202, height: 3464 }),
      localsBypassed: () => true, sampleCurvePoints: noop, setGpuSurfaceHdr: noop,
      acceptPreviewGeometry: noop, applyZoomGeometry: noop, acceptPresentation: noop,
      refinementProxyLongEdge: () => 5202, displayedLongEdge: () => 5202,
      renderReadouts: noop, hidePreviewMessage: noop, requestAnimationFrame: noop,
    });
    vm.runInContext(frontendSource("preview-pipeline.js"), context);
    vm.runInContext(declarations("gradeFineGrainGpuTrial", "gradeSourceIdentity", "liveFineGrainSelected"), context);
    context.denoiseUnderlayerEdge = () => 1600;
    context.visibleOutputRect = () => previous;
    assert.equal(await context.renderGpuDraftInner("hdr", { longEdge: 5202, viewport: previous }), true);
    assert.equal(underlayerDraws, 1);
    assert.deepEqual(detailBeforeReplacement, { target: detail, region: previous, width: previous.width });
    assert.equal(canvas.hdrFrameRegion, next);
  });
}
