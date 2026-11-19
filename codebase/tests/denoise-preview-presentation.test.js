const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { frontendSource } = require("./frontend-source.js");

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
    context.denoiseUnderlayerEdge = () => 1600;
    context.visibleOutputRect = () => previous;
    assert.equal(await context.renderGpuDraftInner("hdr", { longEdge: 5202, viewport: previous }), true);
    assert.equal(underlayerDraws, 1);
    assert.deepEqual(detailBeforeReplacement, { target: detail, region: previous, width: previous.width });
    assert.equal(canvas.hdrFrameRegion, next);
  });
}
