const HDRGrainRoute = require("../frontend/grain-route");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { frontendSource, declarations } = require("./frontend-source.js");
const { HDRPresentationGate } = require("../frontend/presentation-gate");
const { HDRRenderCoordinator } = require("../frontend/render-coordinator");

test("panning back reveals a covering Clean Grain picture immediately and skips a stale grade", () => {
  const frame = { frameWidth: 5202, frameHeight: 3464, y: 0, width: 100, height: 100 };
  const accepted = { ...frame, x: 0 };
  const other = { ...frame, x: 200 };
  const element = () => ({
    width: 100, height: 100, isConnected: true, hidden: false,
    classList: { add() {}, remove() {} },
  });
  const renderer = {
    available: true, gpuAllocator: { register: () => ({}), unregister() {} },
    grainMemorySnapshot: () => ({ budget_bytes: 20e6, resident_bytes: 0, allocator_bytes: 0 }),
    denoiseTileBudget: () => 10e6, fineGrainReducedBytes: () => 0,
    gradeCanvasSwaps: new Map(), gradeCanvasSwapCost: (width, height) => width * height * 24,
  };
  const versions = { hdr: 1 };
  const base = {};
  let visible = accepted;
  let layouts = 0;
  const context = vm.createContext({
    els: { previewCanvas: base }, state: { gpuPreview: renderer, session: { session_id: "photo" },
      denoiseRuntime: { hdr: {} }, previewGeneration: versions },
    geometrySignature: () => "{}", denoiseNoiseViewActive: () => false,
    nativeGeometryOutputRect: () => visible, HDRGrainRoute,
    window: { HDRViewportRequest: require("../frontend/viewport-request").HDRViewportRequest },
    applyZoomGeometry: () => layouts++,
  });
  vm.runInContext(declarations("cleanGrainLayerIdentity", "cacheCleanGrainLayer",
    "drawCleanGrainLayer", "showCachedCleanGrainViewport"), context);
  const key = context.cleanGrainLayerIdentity("hdr");
  const first = { key, element: element(), renderer, region: accepted, entry: {} };
  const second = { key, element: element(), renderer, region: other };
  for (const layer of [first, second]) renderer.gradeCanvasSwaps.set(layer.element, layer.element);
  Object.assign(base, { hdrSharpLayers: [first, second], hdrSharpDetail: second, hdrFrameRegion: other });
  assert.equal(context.showCachedCleanGrainViewport("hdr"), true);
  assert.equal(base.hdrSharpDetail, first);
  assert.equal(base.hdrFrameRegion, accepted);
  assert.equal(layouts, 1);
  visible = other;
  versions.hdr++;
  assert.equal(context.showCachedCleanGrainViewport("hdr"), false);
  assert.equal(base.hdrFrameRegion, accepted);
});

test("bypass draws the original without waiting and retries a stale source after acknowledgement", async () => {
  for (const method of ["standard", "clean_grain", "micro_grain"]) {
    const state = { session: { session_id: "photo" }, currentView: "hdr", editRevision: 1,
      denoise: { hdr: { enabled: true, controls: { method } } }, denoiseRuntime: { hdr: { generation: 0 } } };
    const draws = [];
    const context = vm.createContext({ state, refinementProxyLongEdge: () => 5202,
      renderDenoiseControls() {}, invalidatePreview() {}, debounceOverlayAndScopes() {}, markScopeUpdating() {},
      persistDenoiseSettings: async () => { await Promise.resolve(); state.editRevision++; return true; },
      renderGpuDraft: async () => {
        draws.push({ revision: state.editRevision, original: state.denoiseRuntime.hdr.showOriginal });
        return state.editRevision === 2;
      },
      transientGpuRefusal: () => true });
    vm.runInContext(declarations("restoreDenoiseStatus", "invalidateDenoisePreparation", "setDenoiseEnabled"), context);
    await context.setDenoiseEnabled(false);
    assert.deepEqual(draws, [{ revision: 1, original: true }, { revision: 2, original: true }], method);
  }
});

test("switching methods while enabling does not leave the original selected", async () => {
  const controls = { method: "standard" };
  const runtime = { generation: 0, showOriginal: true, status: "off" };
  const state = { session: { session_id: "photo" }, currentView: "hdr", denoise: { hdr: { enabled: false, controls } },
    denoiseRuntime: { hdr: runtime } };
  const saves = [];
  const pictures = [];
  const context = vm.createContext({ state, window: { setTimeout }, renderDenoiseControls() {}, invalidatePreview() {},
    liveGrainControl: () => false, persistDenoiseSettings: () => new Promise(resolve => saves.push(resolve)),
    recalculateDenoise: async () => { if (!runtime.showOriginal) pictures.push(controls.method); } });
  vm.runInContext(declarations("restoreDenoiseStatus", "invalidateDenoisePreparation", "deferDenoisePreparation", "setDenoiseEnabled", "commitDenoiseControl"), context);
  const enable = context.setDenoiseEnabled(true);
  const change = context.commitDenoiseControl("method", "micro_grain");
  saves[0](true);
  await enable;
  saves[1](true);
  await change;
  assert.deepEqual(pictures, ["micro_grain"]);
});

for (const transition of ["slider commit", "live adjustment", "recalculate", "disable", "enable"]) {
  test(`a CPU Micro ${transition} refreshes scopes after presenting the picture`, async () => {
    const controls = { method: "micro_grain", micro_luminance: 0.55 };
    const runtime = { generation: 0, microBackup: { reason: "unsupported_lens_correction" } };
    const state = { session: { session_id: "photo" }, currentView: "hdr", activeWorkflow: "grade", editRevision: 1,
      denoise: { hdr: { enabled: transition !== "enable", controls } }, denoiseRuntime: { hdr: runtime } };
    const events = [];
    let finishPreview, notifyPreview;
    const previewStarted = new Promise(resolve => { notifyPreview = resolve; });
    const context = vm.createContext({ state, window: { setTimeout: fn => queueMicrotask(fn) },
      refinementProxyLongEdge: () => 1600, markScopeUpdating() {}, renderDenoiseControls() {},
      invalidatePreview() {}, useMicroGrainCpu() {}, microGrainUnavailable: () => "",
      persistDenoiseSettings: async () => { state.editRevision++; return true; },
      debounceOverlayAndScopes: () => events.push("scope"), renderGpuDraft: async () => false,
      transientGpuRefusal: () => false, previewSourceCapacityRefused: () => false,
      renderPreviewForLane: () => new Promise(resolve => { finishPreview = resolve; notifyPreview(); }),
    });
    vm.runInContext(declarations("setDenoiseEnabled", "restoreDenoiseStatus", "invalidateDenoisePreparation",
      "deferDenoisePreparation", "recalculateDenoiseForView", "gradeSourceIdentity", "commitDenoiseControl",
      "runLiveDenoise", "microGrainControlsMatch"), context);
    context.recalculateDenoise = (lane, options) => context.recalculateDenoiseForView(lane, options);
    const action = {
      "slider commit": () => context.commitDenoiseControl("micro_luminance", 0.8),
      "live adjustment": () => context.runLiveDenoise({ lane: "hdr", sessionId: "photo", generation: 0,
        controls: { method: "micro_grain", microLuminance: 0.55 } }),
      recalculate: () => context.recalculateDenoiseForView("hdr", {}),
      disable: () => context.setDenoiseEnabled(false),
      enable: () => context.setDenoiseEnabled(true),
    }[transition];
    const complete = action();
    await Promise.race([previewStarted, complete]);
    assert.equal(typeof finishPreview, "function");
    assert.deepEqual(events, []);
    finishPreview(true);
    await complete;
    assert.deepEqual(events, ["scope"]);
  });
}

test("changing colour cleaning while bypassed prepares the new settings on enable", async () => {
  const runtime = { generation: 0, showOriginal: true, status: "off" };
  const controls = { method: "clean_grain", clean_splotches: false, clean_fringes: false, grain_evenness: 0.65 };
  const draws = [];
  const state = { session: { session_id: "photo" }, currentView: "hdr", denoise: { hdr: { enabled: false, controls } },
    denoiseRuntime: { hdr: runtime },
    gpuPreview: { denoiseSourceSelector: { controls: { method: "clean_grain", cleanSplotches: false, cleanFringes: false } },
      diagnosticsSnapshot: () => ({ denoise: { cacheReady: true, identity: "photo:hdr:1600:{}:source" } }),
      selectDenoiseSelectorSource: () => draws.push("stale") } };
  const context = vm.createContext({ state, window: { setTimeout }, renderDenoiseControls() {}, invalidatePreview() {},
    persistDenoiseSettings: async () => true, refinementProxyLongEdge: () => 1600,
    geometrySignature: () => "{}", gradeSourceIdentity: () => "source",
    recalculateDenoise: async () => draws.push({ ...controls }) });
  vm.runInContext(declarations("restoreDenoiseStatus", "invalidateDenoisePreparation", "deferDenoisePreparation",
    "setDenoiseEnabled", "commitDenoiseControl"), context);
  await context.commitDenoiseControl("clean_splotches", true);
  assert.deepEqual(draws, []);
  await context.setDenoiseEnabled(true);
  assert.deepEqual(draws, [{ method: "clean_grain", clean_splotches: true, clean_fringes: false, grain_evenness: 0.65 }]);
});

test("CPU comparison requests leave Micro Grain cache priority with the viewer", async () => {
  const requests = [];
  const state = {
    session: { session_id: "photo" }, currentView: "hdr", previewCache: {},
    previewGeneration: { sdr: 1 }, previewControllers: {},
  };
  const context = vm.createContext({ state, AbortController,
    geometryDraftActive: () => false, geometrySignature: () => "{}", syncGlobalEditState: async () => true,
    cpuPreviewReason: () => "test", localsBypassed: () => false, previewExecutionForTier: () => "whole",
    mediaQueryMatch: () => false, microGrainPreviewKey: () => null, microGrainPreviewRequest: () => ({}),
    grainCpuPreviewHeaders: () => ({}), safeJson: async () => null, CPU_PREVIEW_MAX_LONG_EDGE: 16384,
    fetch: async (url, options) => {
      requests.push([url, JSON.parse(options.body).background_preview]);
      return { ok: false };
    },
  });
  vm.runInContext(declarations("renderPreviewForLaneInner", "renderRawPreviewForLane"), context);
  for (const raw of [false, true]) {
    await context.renderPreviewForLaneInner("sdr", false, 256, { raw, showProgress: false });
  }
  assert.deepEqual(requests, [
    ["/api/session/photo/preview/sdr", true],
    ["/api/session/photo/preview-raw/sdr", true],
  ]);
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
    vm.runInContext(declarations("renderPreviewForLaneInner", "describeReducedDenoisePreview", "microGrainPreviewRequest", "microGrainPreviewKey", "grainCpuPreviewHeaders", "backendGrainFrame", "previewDiagnosticReason"), context);
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
      const notice = `Denoise is using the CPU here, so the picture is shown at ${(4096).toLocaleString()} px. Export is full size.`;
      assert.equal(presentation[0][13], notice);
      vm.runInContext(declarations("deriveViewerState", "viewerStatusLabel"), context);
      context.PREVIEW_RESOLUTION_OPTIONS = new Set(["full"]);
      context.previewResolutionLabel = () => "Display exact";
      const viewer = context.deriveViewerState({ requestedTier: "full", lane: "hdr", currentGeneration: 1,
        geometrySignature: "{}", accepted: { requestedTier: "full", lane: "hdr", generation: 1,
          geometrySignature: "{}", reducedNotice: notice } });
      assert.equal(viewer.status, "reduced");
      assert.equal(context.viewerStatusLabel(viewer), notice);
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
  const context = vm.createContext({ state, cancelGeometryUnderlayer() {}, syncGlobalEditState: async () => true, cacheReady: () => true,
    gpuPreviewEligible: () => true, renderGpuDraft: async () => { calls.push("gpu"); return false; },
    transientGpuRefusal: () => false, showCachedPreview: async (_, options) => {
      calls.push(options?.skipGpu ? "cpu-cache" : "gpu-cache"); return false;
    }, renderPreviewForLane: async (_, __, ___, options) => { calls.push(options.denoiseFallback ? "denoised-cpu" : "cpu"); },
    recalculateDenoise: async () => calls.push("gpu-recalculate"), debouncePreview: () => calls.push("refine"),
    currentCurveValues: () => [], settledProxyLongEdge: () => 1600, scopeLongEdge: () => 640,
    previewNeedsRefinement: () => true, endBeforePeek() {}, abandonPerspectiveDraft() {}, suspendGradeInstruments() {},
    renderLaneChrome() {}, renderLocalAdjustments() {}, syncCurveControlsFromState() {}, renderCurveChannelTabs() {},
    drawCurveEditor() {}, renderReadouts() {}, refreshOverlay() {}, refreshScopes() {}, prepareInactivePreview() {} });
  vm.runInContext(declarations("switchLane", "previewSourceCapacityRefused"), context);
  await context.switchLane("sdr");
  assert.deepEqual(calls, ["gpu", "cpu-cache", "denoised-cpu"]);
});

test("a validation failure drawing the quick CPU Grain picture still requests the CPU fallback", async () => {
  const state = {
    currentView: "sdr", session: { session_id: "photo", source: { width: 1600, height: 1000 } },
    zoomMode: "fit", previewGeneration: { sdr: 1 }, gpuDraftRefusals: {}, displayInfo: {}, adjustments: {},
    denoise: { sdr: { enabled: true, controls: { method: "clean_grain", clean_splotches: false, clean_fringes: false } } },
    denoiseRuntime: { sdr: {} },
    gpuFailurePolicy: { record: error => ({ kind: "validation", detail: error.message, recoverable: true }) },
  };
  let attempts = 0;
  state.gpuPreview = {
    diagnosticsSnapshot: () => ({ denoise: { cacheReady: true, identity: "photo:sdr:1600:{}:authored-sdr" } }),
    denoiseSourceSelector: { cache: { grain: { token: "cpu-preparation" } } },
    async render() {
      attempts++;
      throw new Error("Injected validation failure");
    },
  };
  const context = vm.createContext({
    state, performance, window: { setTimeout, clearTimeout }, els: { previewCanvas: {} }, console: { warn() {} },
    gradeGrainAction: () => null, gradeGrainGpuPreferred: () => false, liveGradeGrainSelected: () => false,
    geometryDraftActive: () => false, gpuPreviewEligible: () => true, nativeDenoiseViewport: () => false,
    geometrySignature: () => "{}", gradeSourceIdentity: () => "authored-sdr", denoiseNoiseViewActive: () => false,
    gpuLumaMaskOverlayOptions: () => null, projectReferenceWhiteNits: () => 203, gpuFrameSizeAt: () => null,
    localAdjustments: () => [], localsBypassed: () => true, sampleCurvePoints() {}, renderReadouts() {},
  });
  vm.runInContext(frontendSource("preview-pipeline.js") + declarations("trackGrainCpuWork"), context);
  assert.equal(await context.renderGpuDraftInner("sdr", { longEdge: 1600 }), false);
  assert.equal(attempts, 1);
  assert.equal(context.transientGpuRefusal(), false);
  assert.equal(state.lastGpuDraftRefusal.detail, "Injected validation failure");
});

for (const method of ["standard", "clean_grain"]) {
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
      zoomMode: "custom", displayInfo: {},
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
      state, HDRGrainRoute, performance, window: {}, els: { previewCanvas: canvas, previewDenoiseDetail: detail,
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
    vm.runInContext(declarations("gradeGrainGpuPreferred", "gradeGrainGpuEnabled", "gradeSourceIdentity", "liveGradeGrainSelected", "gradeGrainAction"), context);
    context.denoiseUnderlayerEdge = () => 1600;
    context.nativeGeometryOutputRect = () => previous;
    assert.equal(await context.renderGpuDraftInner("hdr", { longEdge: 5202, viewport: previous }), true);
    assert.equal(underlayerDraws, 1);
    assert.deepEqual(detailBeforeReplacement, { target: detail, region: previous, width: previous.width });
    assert.equal(canvas.hdrFrameRegion, next);
  });
}

async function checkGeometryPatchOrder(scenario) {
  const rendererSource = frontendSource("webgpu-preview.js");
  const gateStart = rendererSource.lastIndexOf("const presentation = this.presentationGate");
  const gateEnd = rendererSource.indexOf("this.configureSurface", gateStart);
  const acquireDirectPresentation = vm.runInNewContext(`(async function (canvas, proxy, sourceOptions, backgroundUnderlayer) {
    const serial = 1, resourceGeneration = this.resourceGeneration, refuse = () => null;
    ${rendererSource.slice(gateStart, gateEnd)}
    return presentation;
  })`).bind({
    presentationGate: new HDRPresentationGate(), renderSerials: { get: () => 1 }, resourceGeneration: 1,
  });
  const signature = JSON.stringify({ crop: { x: .2, y: .2, width: .1, height: .1 } });
  const lane = scenario === "lane switch" ? "sdr" : "hdr";
  const panPass = ["first far pan", "second pan"].includes(scenario);
  const explicitWhole = scenario === "explicit whole frame at native zoom";
  const pending = !["lane switch", "grade edit"].includes(scenario) && !panPass;
  const cropped = scenario === "fully visible" || scenario === "explicit Full Fit";
  const newFrame = cropped ? { width: 512, height: 341 } : { width: 1250, height: 900 };
  const visible = cropped ? { x: 0, y: 0, ...newFrame } : { x: 250, y: 300, width: 1000, height: 600 };
  const region = { ...visible, frameWidth: newFrame.width, frameHeight: newFrame.height };
  const canvas = { hdrWholeFrame: { key: "old-crop", edge: 1600 }, width: 160, height: 107,
    style: { display: "block" }, parentElement: { hasAttribute: () => false } };
  const detail = {};
  const state = {
    activeWorkflow: "grade", currentView: lane, zoomMode: scenario === "explicit Full Fit" ? "fit" : "custom",
    zoomPercent: explicitWhole ? 90 : 100,
    previewResolutionOverride: true,
    session: { session_id: "photo", source: { width: 5202, height: 3464 } },
    previewGeneration: { [lane]: 2 }, acceptedPresentation: { lane: scenario === "lane switch" ? "hdr" : lane,
      geometrySignature: pending ? "old-crop" : signature },
    geometryPresentationPending: pending, adjustments: { shared: { geometry: JSON.parse(signature) } },
    denoise: { [lane]: { enabled: false, controls: { method: "standard" } } }, denoiseRuntime: { [lane]: {} },
    gpuDraftRefusals: {}, gpuPreparedLane: {}, previewInfoByLane: {}, displayInfo: {},
  };
  const drawn = [];
  const animationFrames = [];
  const idleTimers = [];
  let finishBackground;
  let backgroundOptions;
  let detailState;
  let handoffState;
  state.gpuPreview = {
    async render(...args) {
      if (explicitWhole) {
        assert.equal(args[4], 5202);
        assert.equal(args.at(-1).viewport, null);
        assert.equal(args.at(-1).backgroundUnderlayer, false);
        drawn.push("whole frame");
        return false;
      }
      drawn.push(`underlayer ${args[4]}`);
      backgroundOptions = args.at(-1);
      await new Promise(resolve => { finishBackground = resolve; });
      const presentation = await acquireDirectPresentation(canvas, { width: 1600, height: 1152 },
        backgroundOptions, backgroundOptions.backgroundUnderlayer);
      if (!presentation) return false;
      backgroundOptions.onFrameSubmitted(null, true);
      presentation.release();
      return { execution: "direct" };
    },
    async renderTo(target, ...args) {
      drawn.push("detail");
      const options = args.at(-1);
      detailState = {
        target, oldBase: canvas.hdrWholeFrame?.key, pending: state.geometryPresentationPending,
        viewport: { ...options.viewport }, covers: options.coversViewport(region, newFrame.width, newFrame.height),
      };
      if (scenario === "zoom changes before submit") {
        state.zoomPercent = 31;
        detailState.coversAfterZoom = options.coversViewport({ x: 0, y: 0, ...newFrame }, newFrame.width, newFrame.height);
        return false;
      }
      options.onFrameSubmitted(region, true);
      return { execution: "tiled", ...newFrame };
    },
  };
  const noop = () => {};
  const context = vm.createContext({
    state, performance, AbortController, CustomEvent: class {}, navigationThumbnail: {},
    window: { dispatchEvent: () => drawn.push("presented"), clearTimeout: noop,
      setTimeout: callback => idleTimers.push(callback),
      HDRViewportRequest: require("../frontend/viewport-request").HDRViewportRequest, devicePixelRatio: 2 },
    console, els: { dropzone: { clientWidth: 500, clientHeight: 300, scrollLeft: 1000, scrollTop: 900 },
      previewCanvas: canvas, previewDenoiseDetail: detail,
      previewImage: { style: {} }, emptyState: { style: {} } },
    gpuPreviewEligible: () => true, geometryDraftActive: () => false, geometryTransformIsNeutral: () => false,
    nativeDenoiseViewport: () => false, gradeGrainAction: () => null, liveGradeGrainSelected: () => false,
    gradeSourceIdentity: () => "source", geometrySignature: () => signature, denoiseNoiseViewActive: () => false,
    gpuLumaMaskOverlayOptions: () => null, projectReferenceWhiteNits: () => 203, requiredProcessingLongEdge: () => 5202,
    gpuFrameSizeAt: () => newFrame, sourcePixelFrameDimensions: () => newFrame,
    previewTargetLongEdge: () => 5202, localsBypassed: () => true, sampleCurvePoints: noop, setGpuSurfaceHdr: noop,
    acceptPreviewGeometry: (width, height) => {
      handoffState = { width, height, base: canvas.hdrWholeFrame, baseWidth: canvas.width };
      state.geometryPresentationPending = false;
    }, applyZoomGeometry: noop,
    acceptPresentation: () => { state.acceptedPresentation = { lane, generation: 2, exact: true, geometrySignature: signature }; },
    refinementProxyLongEdge: () => 5202, displayedLongEdge: () => 5202,
    renderReadouts: noop, hidePreviewMessage: noop, requestAnimationFrame: callback => animationFrames.push(callback), setZoomMode: noop,
    cpuMicroPreviewSelected: () => false,
  });
  vm.runInContext(frontendSource("preview-pipeline.js"), context);
  context.visibleOutputRect = () => visible;
  state.renderCoordinator = new HDRRenderCoordinator({ sessionId: "photo", activeLane: lane,
    dispatch: request => context.renderGpuDraftInner(request.lane, request) });
  state.renderCoordinator.noteEdit(lane);
  state.renderCoordinator.noteEdit(lane);
  const submitted = scenario !== "zoom changes before submit";
  if (explicitWhole) {
    assert.equal(await context.renderGpuDraft(lane, { longEdge: 5202, viewport: false }), false);
    assert.deepEqual(drawn, ["whole frame"]);
    assert.equal(animationFrames.length, 0);
    return;
  }
  const foreground = context.renderGpuDraft(lane, { longEdge: 5202, viewportRequested: true, panPass });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(drawn, ["detail"]);
  assert.equal(state.gpuDraftInFlight, null, "the sharp patch must release the foreground before background work");
  assert.equal(await foreground, submitted);
  assert.deepEqual(detailState, { target: detail, oldBase: "old-crop", pending, viewport: visible, covers: true,
    ...(submitted ? {} : { coversAfterZoom: false }) });
  if (submitted && pending) assert.deepEqual(handoffState, { ...newFrame, base: null, baseWidth: 1 });
  assert.equal(Boolean(canvas.hdrFrameRegion?.nativeGeometryViewport), submitted);
  if (submitted) assert.equal(canvas.width, 1, "the old underlayer retires at the sharp handoff");
  if (scenario === "scopes busy before submit") state.zoomScopeTimer = 1;
  while (animationFrames.length) void animationFrames.shift()(0);
  if (scenario === "scopes busy before submit") {
    assert.deepEqual(drawn, ["detail", "presented"]);
    assert.equal(idleTimers.length, 1);
    state.zoomScopeTimer = null;
    void idleTimers.shift()();
  }
  await new Promise(resolve => setImmediate(resolve));
  if (!submitted || cropped) {
    assert.ok(!drawn.includes("underlayer 1600"));
    return;
  }
  assert.deepEqual(drawn, ["detail", "presented", "underlayer 1600"]);
  assert.equal(state.gpuDraftInFlight, null);
  const patch = canvas.hdrFrameRegion;
  const cancel = ["second pan", "switch while loading", "edit while loading", "zoom while loading", "replace session"].includes(scenario);
  if (scenario === "second pan") {
    vm.runInContext(declarations("noteViewerPan"), context);
    context.visibleOutputRect = () => ({ ...visible, x: 0 });
    context.noteViewerPan();
  } else if (scenario === "covered pan") {
    vm.runInContext(declarations("noteViewerPan"), context);
    context.visibleOutputRect = () => ({ ...visible, x: visible.x + 1, width: visible.width - 1 });
    context.noteViewerPan();
    assert.equal(backgroundOptions.signal.aborted, false);
  } else if (scenario === "switch while loading") {
    Object.assign(context, { endBeforePeek: noop, abandonPerspectiveDraft: noop, syncGlobalEditState: async () => false });
    vm.runInContext(declarations("switchLane"), context);
    const switching = context.switchLane("sdr");
    assert.ok(backgroundOptions.signal.aborted, "abort the outgoing stream before waiting for edit sync");
    await switching;
  } else if (scenario === "edit while loading") {
    Object.assign(context, { clearGeometryMapCapacityRefusals: noop, cancelRoiCatchUp: noop, cancelRoiPanRefinement: noop,
      renderCompareStatus: noop, updateExportAvailability: noop, renderViewerStatus: noop });
    context.invalidatePreview(lane, { markDirty: false });
  } else if (scenario === "zoom while loading") {
    Object.assign(context, { clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
      MIN_ZOOM_PERCENT: 1, MAX_ZOOM_PERCENT: 400, activePreviewElement: noop,
      previewIsVisible: () => false, syncOverlayPlacement: noop, scheduleNavigationThumbnail: noop, scheduleZoomRefinement: noop });
    vm.runInContext(declarations("setCustomZoom"), context);
    context.setCustomZoom(31, { clientX: 200, clientY: 100 });
  } else if (scenario === "replace session") {
    Object.assign(context, Object.fromEntries(["clearGeometryMapCapacityRefusals", "clearPerspectiveGpuDraft",
      "setPerspectiveStatus", "renderGeometryToolState", "renderPerspectiveControls", "clearRotateDraftTransformProperties",
      "endBeforePeek", "clearComparisonPreview"].map(name => [name, noop])));
    Object.assign(context, { geometryCoordinateMapRequests: new Map(), geometryCoordinateMapCache: new Map(),
      geometryFullOutputFrames: new Map() });
    context.window.clearTimeout = noop;
    context.els.scopeFreshness = { classList: { remove: noop } };
    state.previewControllers = {};
    state.previewCache = {};
    context.clearPreviewCache({ preservePicture: true });
    state.session = { session_id: "replacement" };
  }
  if (cancel) {
    assert.ok(backgroundOptions.signal.aborted);
    assert.ok(!backgroundOptions.isCurrent());
  }
  finishBackground();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(canvas.hdrFrameRegion, patch);
  assert.equal(canvas.width, cancel ? 1 : 1600);
  assert.equal(canvas.hdrWholeFrame?.edge, cancel ? undefined : 1600);
  assert.equal(state.acceptedPresentation?.generation, scenario === "replace session" ? undefined : 2);
}

for (const scenario of ["geometry commit", "lane switch", "grade edit", "fully visible", "explicit Full Fit", "explicit whole frame at native zoom",
  "zoom changes before submit", "scopes busy before submit", "first far pan", "second pan", "covered pan", "switch while loading", "edit while loading",
  "zoom while loading", "replace session"]) {
  test(`the exact geometry patch draws first: ${scenario}`, () => checkGeometryPatchOrder(scenario));
}

test("Crop & Rotate Reset keeps the mounted picture until its new Perspective geometry arrives", () => {
  const state = { currentView: "hdr", adjustments: { shared: { geometry: { rotation: 90, perspective_horizontal: 12 } } } };
  const presentations = [];
  const context = vm.createContext({ state, controlGroups: { geometry: ["shared.geometry.rotation"] }, sectionPathForGroup: {},
    defaultAdjustments: () => ({ shared: { geometry: { rotation: 0, perspective_horizontal: 0 } } }),
    resolveAdjustmentPath: path => path, invalidatePreview() {}, renderControlState() {},
    syncControlsFromState: () => presentations.push(state.geometryPresentationPending),
    debouncePreview: () => presentations.push(state.geometryPresentationPending),
  });
  vm.runInContext(declarations("resetControlGroup", "getValueByPath", "setValueByPath", "valuesEqual", "cropRotateGeometryModified"), context);
  context.resetControlGroup("geometry");
  assert.deepEqual(state.adjustments.shared.geometry, { rotation: 0, perspective_horizontal: 12 });
  assert.deepEqual(presentations, [true, true]);
});

for (const operation of ["undo", "redo"]) {
  test(`${operation} between two corrected geometries waits for the new picture before reflow`, async () => {
    const frame = { shared: { geometry: { rotation: 90, perspective_horizontal: 12 } } };
    const previous = { shared: { geometry: { rotation: 0, perspective_horizontal: 12 } } };
    const state = { currentView: "hdr", session: { session_id: "photo" }, adjustments: frame, editRevision: 1 };
    const rendered = [];
    const context = vm.createContext({ state, console, els: { hdrReferenceWhite: {} },
      window: { HDRPhotoFramingUI: { render() {} } }, status: { get: () => null },
      fetch: async () => ({ ok: true }), safeJson: async () => ({ revision: 2, document: { global_adjustments: previous } }),
      geometryDraftActive: () => false, localAdjustments: () => [], projectReferenceWhiteNits: () => 203,
      discardUnusedLocal() {}, resetRepairSource() {}, recordAcknowledgedLocals() {}, renderLocalAdjustments() {},
      loadDenoiseDocument() {}, renderLaneChrome() {}, syncCurveControlsFromState() {}, drawCurveEditor() {},
      drawToneEqualizerEditor() {}, renderOverlayPresetNote() {}, updateExportAvailability() {}, invalidatePreview() {},
      applyZoomGeometry: () => rendered.push(state.geometryPresentationPending),
      debouncePreview: () => rendered.push(state.geometryPresentationPending),
    });
    vm.runInContext(declarations("queueEditCommand", "stablePreviewJson", "geometrySignature"), context);
    assert.equal(await context.queueEditCommand(operation), true);
    assert.equal(state.adjustments, previous);
    assert.deepEqual(rendered, [true, true]);
  });
}

test("direct Straighten keeps its temporary transform until the matching sharp frame", () => {
  const state = { currentView: "hdr", straightenGestureActive: true, straightenPreviewBaseAngle: 1,
    adjustments: { shared: { geometry: { straighten_angle: 8, perspective_horizontal: 12 } } } };
  const requested = [];
  const context = vm.createContext({ state, hideStraightenGrid() {}, invalidatePreview() {},
    debouncePreview: () => requested.push(state.geometryPresentationPending),
  });
  vm.runInContext(declarations("finishStraightenGesture", "geometrySignature"), context);
  context.finishStraightenGesture();
  assert.deepEqual(requested, [true]);
  assert.equal(state.geometryTransformHandoffSignature, context.geometrySignature());
});

for (const operation of ["disable", "enable with preparation cached", "recalculate"]) {
  test(`a source capacity refusal during Denoise ${operation} does not draw a CPU frame`, async () => {
    const controls = { method: "standard" };
    const runtime = { generation: 0, dirty: false, status: "ready" };
    const refusal = { reason: "preview-source-capacity" };
    const state = { session: { session_id: "photo" }, currentView: "hdr", activeWorkflow: "grade",
      denoise: { hdr: { enabled: operation !== "enable with preparation cached", controls } },
      denoiseRuntime: { hdr: runtime }, gpuPreview: { available: true,
        diagnosticsSnapshot: () => ({ denoise: { cacheReady: true, identity: "photo:hdr:7968:{}:source" } }),
        selectDenoiseSelectorSource() {} },
    };
    let gpuDraws = 0, cpuDraws = 0;
    const context = vm.createContext({ state, window: { setTimeout },
      refinementProxyLongEdge: () => 7968, geometrySignature: () => "{}", gradeSourceIdentity: () => "source",
      renderDenoiseControls() {}, invalidatePreview() {}, debounceOverlayAndScopes() {}, markScopeUpdating() {},
      persistDenoiseSettings: async () => true, recalculateDenoiseAnalysis: async () => true,
      restoreScopeFreshnessIfIdle() {},
      denoiseRetryError: () => { runtime.status = "error"; },
      renderGpuDraft: async () => { gpuDraws++; state.lastGpuDraftRefusal = refusal; return false; },
      renderPreviewForLane: async () => { cpuDraws++; },
    });
    vm.runInContext(declarations("setDenoiseEnabled", "restoreDenoiseStatus", "invalidateDenoisePreparation",
      "deferDenoisePreparation", "recalculateDenoiseForView", "transientGpuRefusal", "previewSourceCapacityRefused"), context);
    if (operation === "recalculate") await context.recalculateDenoiseForView("hdr", {});
    else await context.setDenoiseEnabled(operation !== "disable");
    assert.equal(gpuDraws, 1);
    assert.equal(cpuDraws, 0);
    assert.notEqual(runtime.status, "error");
  });
}

test("a source capacity refusal after SDR Match leaves recovery in charge", async () => {
  const state = { session: { session_id: "photo" }, currentView: "sdr", previewGeneration: { sdr: 3 }, denoise: {} };
  let cpuDraws = 0;
  const context = vm.createContext({ state,
    renderGpuDraft: async () => { state.lastGpuDraftRefusal = { reason: "preview-source-capacity" }; return false; },
    renderPreviewForLane: () => { cpuDraws++; },
  });
  vm.runInContext(declarations("presentMatchedSdrPreview", "transientGpuRefusal", "previewSourceCapacityRefused"), context);
  assert.equal(await context.presentMatchedSdrPreview({ longEdge: 7968 }), true);
  assert.equal(cpuDraws, 0);
});

function denoiseScopeFixture({ enabled, method = "micro_grain", saved = true, gpu = false, cpu = false, refused = false, backup = false }) {
  const runtime = { generation: 0, status: enabled ? "ready" : "off", microBackup: backup ? { reason: "gpu_unavailable" } : null };
  const state = { session: { session_id: "photo" }, currentView: "hdr", activeWorkflow: "grade", editRevision: 1,
    denoise: { hdr: { enabled, controls: { method } } }, denoiseRuntime: { hdr: runtime },
    acceptedPresentation: {}, lastScope: { tier: "settled" } };
  const freshness = { textContent: "Settled", classList: { add() {}, remove() {} } };
  const calls = [];
  const context = vm.createContext({ state, HDRGrainRoute, window: { setTimeout: queueMicrotask },
    els: { scopeFreshness: freshness },
    scopeUi: { freshnessLabel: () => "Settled" }, scopePresentationMatches: () => false,
    refinementProxyLongEdge: () => 1600, geometrySignature: () => "crop", gradeSourceIdentity: () => "source",
    renderDenoiseControls() {}, invalidatePreview() {},
    debounceOverlayAndScopes: () => { calls.push("scope"); context.els.scopeFreshness.textContent = "Settled"; },
    persistDenoiseSettings: async () => { await Promise.resolve(); if (saved) state.editRevision++; return saved; },
    renderGpuDraft: async () => { calls.push("gpu"); return gpu; },
    renderPreviewForLane: async () => { calls.push("cpu"); return cpu; },
    transientGpuRefusal: () => refused, previewSourceCapacityRefused: () => false,
    recalculateDenoise: (lane) => context.recalculateDenoiseForView(lane, {}),
  });
  vm.runInContext(declarations("setDenoiseEnabled", "commitDenoiseControl", "liveGrainControl", "recalculateDenoiseForView", "denoiseRetryError",
    "useMicroGrainCpu", "restoreDenoiseStatus", "invalidateDenoisePreparation", "deferDenoisePreparation",
    "markScopeUpdating", "restoreScopeFreshnessIfIdle", "scopeFreshnessLabel"), context);
  return { state, context, freshness, calls };
}

for (const [name, settings, operation, expected] of [
  ["failed enable save", { enabled: false, saved: false }, "enable", []],
  ["cached enable with CPU fallback", { enabled: false, cpu: true }, "cached enable", ["gpu", "cpu", "scope"]],
  ["cached enable with refused fallback", { enabled: false }, "cached enable", ["gpu", "cpu"]],
  ["saved Micro bypass with no new picture", { enabled: true, refused: true }, "disable", ["gpu", "gpu"]],
  ["saved Micro bypass after a successful draw", { enabled: true, gpu: true }, "disable", ["gpu", "scope"]],
  ["standard bypass after a successful draw", { enabled: true, method: "standard", gpu: true }, "disable", ["gpu", "scope"]],
  ["saved CPU Micro control with no new picture", { enabled: true, backup: true }, "micro control", ["cpu"]],
  ["CPU switch to Standard", { enabled: true, cpu: true }, "standard", ["cpu", "scope"]],
  ["CPU switch to Clean Grain", { enabled: true, cpu: true }, "clean_grain", ["cpu", "scope"]],
]) {
  test(`the histogram recovers after ${name}`, async () => {
    const { state, context, freshness, calls } = denoiseScopeFixture(settings);
    if (operation === "cached enable") {
      state.gpuPreview = { diagnosticsSnapshot: () => ({ denoise: { cacheReady: true, identity: "photo:hdr:1600:crop:source" } }),
        denoiseSourceSelector: { controls: { method: "micro_grain" } }, selectDenoiseSelectorSource() {} };
    }
    if (operation === "enable" || operation === "cached enable") await context.setDenoiseEnabled(true);
    else if (operation === "disable") await context.setDenoiseEnabled(false);
    else if (operation === "micro control") await context.commitDenoiseControl("micro_luminance", 0.7);
    else {
      freshness.textContent = "Unavailable";
      await context.commitDenoiseControl("method", operation);
    }
    assert.deepEqual(calls, expected);
    assert.equal(freshness.textContent, "Settled");
  });
}

test("a temporary Micro Grain failure retries the exact Fit frame without drawing another quick frame", async () => {
  const draws = [];
  const state = {
    activeWorkflow: "grade", zoomMode: "fit", currentView: "hdr",
    session: { session_id: "photo", source: { width: 5202, height: 3464 } },
    previewGeneration: { hdr: 2 }, adjustments: {}, denoiseRuntime: { hdr: {} },
    denoise: { hdr: { enabled: true, controls: { method: "micro_grain" } } },
    gpuDraftRefusals: {}, gpuPreparedLane: {}, previewInfoByLane: {},
    gpuPreview: {
      diagnosticsSnapshot: () => ({ denoise: { cacheReady: true, identity: "photo:hdr:1600:{}:source" } }),
      hasReducedMicroGrain: () => false,
      grainSourceKey: () => "source", noteGrainFailure: () => ({}),
      recoverGrainFailure: async () => true,
      async render(...args) {
        const { microQuick } = args.at(-1);
        draws.push(microQuick);
        if (draws.length === 2) throw Error("temporary allocation pressure");
        return { execution: "direct", approximate: true };
      },
    },
  };
  const noop = () => {};
  const canvas = { style: {} };
  const context = vm.createContext({
    state, performance, window: {}, els: { previewCanvas: canvas, previewImage: { style: {} }, emptyState: { style: {} } },
    geometryDraftActive: () => false, gpuPreviewEligible: () => true, nativeDenoiseViewport: () => false,
    geometryTransformIsNeutral: () => true, gradeGrainAction: () => null, liveGradeGrainSelected: () => false, gradeGrainGpuPreferred: () => false,
    gradeSourceIdentity: () => "source", microGrainUnavailable: () => "", denoiseRendererControls: () => ({}),
    microGrainControlsMatch: () => true, geometrySignature: () => "{}", denoiseNoiseViewActive: () => false,
    gpuLumaMaskOverlayOptions: () => null, projectReferenceWhiteNits: () => 203, requiredProcessingLongEdge: () => 1600,
    gpuFrameSizeAt: () => ({ width: 1600, height: 1065 }), localsBypassed: () => true,
    sampleCurvePoints: noop, setGpuSurfaceHdr: noop, acceptPresentation: noop, setZoomMode: noop,
    refinementProxyLongEdge: () => 1600, displayedLongEdge: () => 1600, renderReadouts: noop,
    renderDenoiseControls: noop, hidePreviewMessage: noop, requestAnimationFrame: noop,
  });
  vm.runInContext(frontendSource("preview-pipeline.js"), context);
  assert.equal(await context.renderGpuDraftInner("hdr", { longEdge: 1600 }), true);
  assert.deepEqual(draws, [true, false, false]);
});

test("memory-refused native preview prepares a screen-sized CPU replacement without clearing the frame", async () => {
  const canvas = { width: 9504, height: 6336 };
  const els = { previewCanvas: canvas, scopeKindLabel: {} };
  const state = { session: { session_id: "photo" }, currentView: "hdr", gpuPreview: { available: true },
    lastGpuDraftRefusal: { lane: "hdr", reason: "app-memory-ceiling" },
    previewCache: {}, previewGeneration: { hdr: 1 }, previewControllers: {}, previewInfoByLane: {} };
  const decoded = Promise.withResolvers();
  const presenting = Promise.withResolvers();
  let request;
  let accepted;
  const ctx = vm.createContext({ state, els, AbortController, URL,
    CPU_PREVIEW_MAX_LONG_EDGE: 16384, denoiseUnderlayerEdge: () => 1920,
    geometryDraftActive: () => false, geometrySignature: () => "{}",
    syncGlobalEditState: async () => true, cpuMicroPreviewSelected: () => false,
    localsBypassed: () => false, previewExecutionForTier: () => "strips",
    cpuPreviewReason: () => state.lastGpuDraftRefusal.reason, mediaQueryMatch: () => true,
    fetch: async (_, options) => {
      request = JSON.parse(options.body);
      return new Response(new Blob(["pixels"]), { headers: { "X-Image-Width": 1920, "X-Image-Height": 1280 } });
    },
    previewInfoFromResponse: () => ({ transport: "PNG" }),
    shouldKeepHdrGpuSurface: () => { throw Error("the fallback tried to re-render on the GPU"); },
    applyPreviewUrl: async () => { presenting.resolve(); return decoded.promise; },
    gpuPreviewEligible: () => true, setGpuSurfaceHdr() {}, refinementProxyLongEdge: () => 9504,
    renderCompareStatus() {}, renderReadouts() {}, acceptPresentation: (...args) => { accepted = args; },
  });
  vm.runInContext(declarations("renderPreviewForLane", "renderPreviewForLaneInner", "describeReducedDenoisePreview",
    "microGrainPreviewRequest", "microGrainPreviewKey", "grainCpuPreviewHeaders", "backendGrainFrame"), ctx);
  const pending = ctx.renderPreviewForLane("hdr", true, 9504, { showProgress: false });
  await presenting.promise;
  assert.equal(request.long_edge, 1920);
  assert.deepEqual([canvas.width, canvas.height], [9504, 6336]);
  assert.equal(accepted, undefined);
  decoded.resolve(true);
  assert.equal(await pending, true);
  assert.deepEqual([canvas.width, canvas.height], [1, 1]);
  assert.equal(accepted[9], 1920);
  assert.ok(accepted[13]);
  URL.revokeObjectURL(state.previewCache.hdr.url);
});
