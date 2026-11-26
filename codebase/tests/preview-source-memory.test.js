const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { frontendSource } = require("./frontend-source.js");

const memoryDetail = "Full preview needs more host working memory than is safely available.";
const edge = 5000;
const noop = () => {};
const refusal = (status, detail) => new Response(JSON.stringify({ detail }), { status });

function previewFixture(streaming, {
  sourceResponse = () => refusal(507, memoryDetail),
  cpuResponse = () => refusal(507, memoryDetail),
} = {}) {
  const requests = [];
  const timers = [];
  let cleared = false;
  let statusEntry;
  const scheduler = { generations: { image: 1 }, current: { imageGeneration: 1 } };
  const state = {
    session: { session_id: "photo", source: { width: edge, height: 3300 } },
    currentView: "hdr", adjustments: { shared: { geometry: {} } }, previewGeneration: { hdr: 1 },
    previewResolutionOverride: false, previewScheduler: scheduler,
    cpuFallbacks: { settle: [] }, previewControllers: {}, previewCache: {},
    displayInfo: {}, previewInfoByLane: {}, gpuSurfaceHdrByLane: {}, gpuRenderRetries: 0, gpuDraftRefusals: {},
    denoise: { hdr: { enabled: false, controls: {} }, sdr: { enabled: false, controls: {} } },
    denoiseRuntime: { hdr: {}, sdr: {} },
  };
  const window = { setTimeout: (callback) => timers.push(callback), clearTimeout: noop };
  const context = vm.createContext({
    state, window, performance, AbortController, URL, els: { scopeKindLabel: {}, previewCanvas: { style: {} } },
    console: { debug: noop, warn: noop, error: noop },
    status: { get: () => statusEntry, post: (entry) => { statusEntry = entry; }, clear: noop },
    geometryDraftActive: () => false, geometrySignature: () => "{}",
    settledProxyLongEdge: () => edge, refinementProxyLongEdge: () => edge,
    requiredProcessingLongEdge: () => edge, previewResolutionLabel: (tier) => tier,
    PREVIEW_RESOLUTION_OPTIONS: new Set(),
    localsBypassed: () => true, syncGlobalEditState: async () => true,
    gpuLumaMaskOverlayOptions: () => null, gpuFrameSizeAt: () => null,
    denoiseNoiseViewActive: () => false, sampleCurvePoints: noop, projectReferenceWhiteNits: () => 203,
    previewExecutionForTier: () => "strips", mediaQueryMatch: () => false,
    renderReadouts: noop, renderCurrentPreviewSize: noop,
    shouldKeepHdrGpuSurface: () => true,
    applyZoomGeometry: noop, scheduleNavigationThumbnail: noop, finishPerspectivePresentation: noop,
    refreshScopesAfterPresentation: noop, renderCompareStatus: noop,
    safeJson: (response) => response.json(),
    gradeGrainAction: () => null,
    liveGradeGrainSelected: () => null,
    nativeDenoiseViewport: () => null,
    gradeSourceIdentity: () => null,
    async fetch(url, options) {
      requests.push({ url, options });
      return options?.method === "POST" ? cpuResponse() : sourceResponse();
    },
  });
  for (const script of ["source-transport.js", "render-failure.js", "preview-pipeline.js", "viewer-status.js"]) {
    vm.runInContext(frontendSource(script), context);
  }
  context.prepareInactivePreview = noop;
  context.clearPreviewImage = () => { cleared = true; };
  context.clearPreviewOverlay = noop;
  const transport = window.HDRSourceTransport;
  state.gpuFailurePolicy = new window.HDRRenderFailurePolicy();
  state.gpuPreview = {
    available: true, supportsLocalAdjustments: () => true,
    proxies: new Map(), proxyInflight: new Map(), maxSourceChunkBytes: streaming ? 1024 : Infinity,
    sourceAbortSignal: () => new AbortController().signal,
    destroyAfterActiveRenders: (destroy) => destroy(),
    loadProxyStreaming(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, options) {
      return transport.loadStreaming(this, { sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, options });
    },
    render(sessionId, lane, adjustments, sample, longEdge, locals, editRevision, overlay, white, size, options) {
      return transport.loadProxy(this, { sessionId, lane, longEdge, editRevision, options: { isCurrent: options.isCurrent } });
    },
  };
  return { state, context, requests, timers, getStatus: () => statusEntry, imageWasCleared: () => cleared };
}

// November 26 merge: the Denoise branch's capacity design owns a whole-frame
// source memory refusal. The viewer reports it as Unavailable with the
// backend's reason at once (never an endless "Preparing…"), keeps WebGPU
// enabled and schedules its bounded capacity recovery.
for (const streaming of [false, true]) {
  test(`a 507 ${streaming ? "streamed" : "single-response"} proxy refusal reports Unavailable instead of preparing`, async () => {
    const { state, context, requests, getStatus } = previewFixture(streaming);
    assert.equal(context.viewerState().status, "preparing");
    await context.settlePreview();

    assert.equal(requests.length, 1, "one GPU source attempt");
    assert.match(requests[0].url, streaming ? /\/proxy-stream\/hdr/ : /\/proxy\/hdr/);
    assert.equal(state.lastGpuDraftRefusal.reason, "preview-source-capacity");
    assert.equal(context.viewerState().status, "unavailable");
    assert.equal(getStatus().severity, "error");
    assert.ok(getStatus().message.includes(memoryDetail));
    assert.equal(state.gpuPreview.available, true, "a memory refusal does not disable WebGPU");
  });
}

test("a source revision conflict still retries as stale work, with no CPU fallback", async () => {
  const { state, context, requests, timers, getStatus } = previewFixture(true, {
    sourceResponse: () => refusal(409, "The backend is waiting for the committed edit."),
  });
  await context.settlePreview();
  assert.equal(state.gpuFailurePolicy.snapshot().records[0].kind, "superseded");
  assert.equal(requests.length, 2, "only the bounded stale-work retry, with no CPU fallback");
  assert.ok(requests.every(({ url }) => url.includes("/proxy-stream/hdr")));
  assert.equal(timers.length, 0);
  assert.equal(getStatus(), undefined);
});

for (const status of [409, 507]) {
  test(`a late ${status} from a replaced request leaves the newer preview alone`, async () => {
    let respond;
    const { state, context, requests, timers, getStatus } = previewFixture(true, {
      sourceResponse: () => new Promise((resolve) => { respond = resolve; }),
    });
    const pending = context.settlePreview("hdr", { imageGeneration: 1, applicationGeneration: 1 });
    await new Promise(setImmediate);
    state.previewGeneration.hdr = 2;
    state.previewScheduler.generations.image = 2;
    respond(refusal(status, status === 507 ? memoryDetail : "The backend is waiting for the committed edit."));
    await pending;

    assert.equal(state.lastGpuDraftRefusal.reason, "superseded-during-render");
    assert.equal(requests.length, 1, "no CPU fallback for replaced work");
    assert.equal(timers.length, 0);
    assert.equal(getStatus(), undefined);
  });
}
