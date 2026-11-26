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
  };
  const window = { setTimeout: (callback) => timers.push(callback), clearTimeout: noop };
  const context = vm.createContext({
    state, window, performance, AbortController, URL, els: { scopeKindLabel: {} },
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

for (const streaming of [false, true]) {
  test(`a 507 ${streaming ? "streamed" : "single-response"} proxy refusal uses CPU and reports a failed fallback`, async () => {
    const { state, context, requests, timers, getStatus } = previewFixture(streaming);
    assert.equal(context.viewerState().status, "preparing");
    await context.settlePreview();

    assert.equal(state.gpuFailurePolicy.snapshot().records[0].kind, "source-memory");
    assert.equal(timers.length, 0, "no GPU retry for a host-memory refusal");
    assert.equal(requests.length, 2, "one GPU attempt and one CPU fallback");
    assert.match(requests[0].url, streaming ? /\/proxy-stream\/hdr/ : /\/proxy\/hdr/);
    assert.match(requests[1].url, /\/preview\/hdr$/);
    assert.match(JSON.parse(requests[1].options.body).cpu_fallback_reason, /memory/);
    assert.equal(context.viewerState().status, "unavailable");
    assert.equal(getStatus().severity, "error");
    assert.ok(getStatus().message.includes(memoryDetail));
    assert.equal(state.gpuPreview.available, true, "a memory refusal does not disable WebGPU");
  });
}

test("a successful CPU fallback supplies the ready frame without going back to WebGPU", async () => {
  const { state, context, requests, timers } = previewFixture(false, {
    cpuResponse: () => new Response(new Uint8Array(1), {
      headers: { "Content-Type": "image/avif", "X-Image-Width": edge, "X-Image-Height": 3300 },
    }),
  });
  // Canvas and image decoding are outside this test. The real preview code
  // still has to select this image and accept it as the current presentation.
  let applied = false;
  context.applyPreviewUrl = (url, isCurrent) => {
    applied = url.startsWith("blob:") && isCurrent();
    return applied;
  };
  await context.settlePreview();
  assert.equal(applied, true);
  assert.equal(context.viewerState().status, "ready");
  assert.equal(state.acceptedPresentation.transport, "AVIF");
  assert.equal(requests.length, 2);
  assert.equal(timers.length, 0);
  URL.revokeObjectURL(state.previewCache.hdr.url);
});

test("a CPU graph refusal explains why the source-memory fallback is unavailable", async () => {
  const detail = "Bounded strip execution refused this graph.";
  const { context, getStatus } = previewFixture(false, {
    cpuResponse: () => new Response(JSON.stringify({
      code: "strip_execution_refused", detail, refusals: ["local adjustments"],
    }), { status: 409 }),
  });
  await context.settlePreview();
  assert.equal(context.viewerState().status, "unavailable");
  assert.equal(getStatus().severity, "error");
  assert.ok(getStatus().message.includes(detail));
  assert.ok(getStatus().message.includes("local adjustments"));
});

test("a failed CPU request after a memory refusal keeps the last accepted frame", async () => {
  const { state, context, getStatus, imageWasCleared } = previewFixture(false, {
    cpuResponse: () => { throw new TypeError("Failed to fetch"); },
  });
  const lastPicture = { lane: "hdr", generation: 0, transport: "WebGPU" };
  state.acceptedPresentation = lastPicture;
  await context.settlePreview();
  assert.equal(context.viewerState().status, "unavailable");
  assert.equal(getStatus().severity, "error");
  assert.match(getStatus().message, /memory/i);
  assert.equal(state.acceptedPresentation, lastPicture);
  assert.equal(imageWasCleared(), false);
});

test("an unusable CPU fallback image is not cached or left preparing", async () => {
  const { state, context, getStatus } = previewFixture(false, {
    cpuResponse: () => new Response(new Uint8Array(1), {
      headers: { "Content-Type": "image/avif", "X-Image-Width": edge, "X-Image-Height": 3300 },
    }),
  });
  context.applyPreviewUrl = () => false;
  await context.settlePreview();
  assert.equal(state.previewCache.hdr, undefined);
  assert.equal(context.viewerState().status, "unavailable");
  assert.match(getStatus().message, /memory/i);
});

test("a CPU memory response for an old generation does not change viewer status", async () => {
  let respond;
  const { state, context, getStatus } = previewFixture(false, {
    cpuResponse: () => new Promise((resolve) => { respond = resolve; }),
  });
  const pending = context.settlePreview();
  await new Promise(setImmediate);
  state.previewGeneration.hdr += 1;
  respond(refusal(507, memoryDetail));
  await pending;
  assert.equal(getStatus(), undefined);
});

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

    assert.equal(state.gpuFailurePolicy.snapshot().records[0].kind, "superseded");
    assert.equal(requests.length, 1, "no CPU fallback for replaced work");
    assert.equal(timers.length, 0);
    assert.equal(getStatus(), undefined);
  });
}
