const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { frontendSource, declarations } = require("./frontend-source.js");

test("bypass draws the original against the acknowledged edit revision for each method", async () => {
  for (const method of ["standard", "fine_grain", "clean_grain", "micro_grain"]) {
    const state = { session: { session_id: "photo" }, currentView: "hdr", editRevision: 1,
      denoise: { hdr: { enabled: true, controls: { method } } }, denoiseRuntime: { hdr: { generation: 0 } } };
    const draws = [];
    const context = vm.createContext({ state, refinementProxyLongEdge: () => 5202,
      renderDenoiseControls() {}, invalidatePreview() {}, debounceOverlayAndScopes() {},
      persistDenoiseSettings: async () => { await Promise.resolve(); state.editRevision++; return true; },
      renderGpuDraft: async () => {
        draws.push({ revision: state.editRevision, original: state.denoiseRuntime.hdr.showOriginal });
        return state.editRevision === 2;
      },
      transientGpuRefusal: () => true });
    vm.runInContext(declarations("setDenoiseEnabled"), context);
    await context.setDenoiseEnabled(false);
    assert.equal(draws.at(-1)?.revision, 2, method);
    assert.equal(draws.at(-1)?.original, true, method);
  }
});

test("switching methods while enabling does not leave the original selected", async () => {
  const controls = { method: "standard" };
  const runtime = { generation: 0, showOriginal: true, status: "off" };
  const state = { session: { session_id: "photo" }, currentView: "hdr", denoise: { hdr: { enabled: false, controls } },
    denoiseRuntime: { hdr: runtime } };
  const saves = [];
  const pictures = [];
  const context = vm.createContext({ state, renderDenoiseControls() {}, invalidatePreview() {},
    liveGrainControl: () => false, persistDenoiseSettings: () => new Promise(resolve => saves.push(resolve)),
    recalculateDenoise: async () => { if (!runtime.showOriginal) pictures.push(controls.method); } });
  vm.runInContext(declarations("setDenoiseEnabled", "commitDenoiseControl"), context);
  const enable = context.setDenoiseEnabled(true);
  const change = context.commitDenoiseControl("method", "micro_grain");
  saves[0](true);
  await enable;
  saves[1](true);
  await change;
  assert.deepEqual(pictures, ["micro_grain"]);
});

test("the reduced CPU Denoise image is presented at its actual size without another GPU render", async () => {
  for (const { reduced, stale } of [{}, { reduced: 4096 }, { reduced: 4096, stale: true }]) {
    const state = { session: { session_id: "photo" }, currentView: "hdr", gpuPreview: { available: true },
      previewCache: {}, previewGeneration: { hdr: 1 }, previewControllers: {}, previewInfoByLane: {} };
    if (reduced) {
      state.denoise = { hdr: { controls: { method: "micro_grain", micro_color: 0.62 } } };
      state.denoiseRuntime = { hdr: { showOriginal: false } };
    }
    const edge = reduced || 5202;
    const presentation = [];
    let request;
    let gpuAttempts = 0;
    const context = vm.createContext({ state, AbortController, URL, els: { scopeKindLabel: {} },
      geometryDraftActive: () => false, geometrySignature: () => "{}", syncGlobalEditState: async () => true,
      cpuPreviewReason: () => "gpu-failed:validation", localsBypassed: () => false,
      previewExecutionForTier: () => "strips", mediaQueryMatch: () => true,
      fetch: async (_, options) => {
        request = JSON.parse(options.body);
        if (stale) state.denoise.hdr.controls.micro_color = 0.7;
        return new Response(new Blob(["pixels"]), { headers: {
          "X-Image-Width": edge, "X-Image-Height": 3000, ...(reduced ? { "X-Preview-Reduced-Edge": reduced } : {}),
        } });
      },
      previewInfoFromResponse: () => ({ transport: "JPEG" }), shouldKeepHdrGpuSurface: () => true,
      renderGpuDraft: async () => { gpuAttempts++; }, gpuPreviewEligible: () => true,
      setGpuSurfaceHdr() {}, applyPreviewUrl: async () => true, refinementProxyLongEdge: () => 5202,
      renderCompareStatus() {}, renderReadouts() {}, acceptPresentation: (...args) => presentation.push(args),
      CPU_PREVIEW_MAX_LONG_EDGE: 16384 });
    vm.runInContext(declarations("renderPreviewForLaneInner", "describeReducedDenoisePreview", "microGrainPreviewRequest", "microGrainPreviewKey"), context);
    assert.equal(await context.renderPreviewForLaneInner("hdr", true, 5202, { showProgress: false, denoiseFallback: true }), !stale);
    assert.equal(gpuAttempts, 0);
    if (stale) {
      assert.equal(request.micro_grain_controls.micro_color, 0.62);
      assert.deepEqual(presentation, []);
      assert.equal(state.previewCache.hdr, undefined);
      continue;
    }
    assert.equal(presentation[0][9], edge);
    assert.equal(presentation[0][5], "CPU/backend");
    if (reduced) {
      assert.match(state.previewUnavailableReason, /4096px/);
      assert.deepEqual(request.micro_grain_controls, state.denoise.hdr.controls);
      assert.equal(request.micro_grain_original, false);
    } else {
      assert.equal(Object.hasOwn(request, "micro_grain_controls"), false);
    }
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
    vm.runInContext(declarations("gradeGrainGpuPreferred", "gradeGrainGpuEnabled", "gradeSourceIdentity", "liveGradeGrainSelected"), context);
    context.denoiseUnderlayerEdge = () => 1600;
    context.visibleOutputRect = () => previous;
    assert.equal(await context.renderGpuDraftInner("hdr", { longEdge: 5202, viewport: previous }), true);
    assert.equal(underlayerDraws, 1);
    assert.deepEqual(detailBeforeReplacement, { target: detail, region: previous, width: previous.width });
    assert.equal(canvas.hdrFrameRegion, next);
  });
}
