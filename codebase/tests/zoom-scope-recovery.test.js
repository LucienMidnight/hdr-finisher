const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");
const { declarations } = require("./frontend-source.js");

function fixture() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const scopes = [];
  const edits = [];
  const errors = [];
  const updating = new Set();
  const freshness = { textContent: "Settled", classList: { add: updating.add.bind(updating), remove: updating.delete.bind(updating) } };
  const viewer = { target: 1600, signature: "crop", work: {}, draft: false };
  const state = {
    session: { session_id: "photo" },
    activeWorkflow: "grade",
    currentView: "sdr",
    previewGeneration: { sdr: 4 },
    acceptedPresentation: { lane: "sdr", generation: 4, exact: true, geometrySignature: "crop", processedLongEdge: 7000 },
    previewScheduler: {
      cancel() { this.current = null; },
      schedule(lane, generation) { this.current = { lane, generation }; edits.push(this.current); },
    },
    renderCoordinator: { state: () => viewer.work },
    scopeGeneration: 0,
    scopeMode: "histogram",
    lastScope: { tier: "settled" },
  };
  const c = vm.createContext({
    state,
    AbortController,
    els: { scopeFreshness: freshness, previewCanvas: { style: {} } },
    scopeUi: { freshnessLabel: () => "Settled" },
    stopPreviewWatchdog() {},
    PREVIEW_WATCHDOG_MAX_REARMS: 20,
    PREVIEW_WATCHDOG_INTERVAL_MS: 1000,
    viewerState: () => ({ status: "updating" }),
    window: {
      clearTimeout: (id) => timers.delete(id),
      setInterval(fn) { c.watchdogTick = fn; return 1; },
      setTimeout(fn, ms) {
        const id = ++nextTimer;
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      HDRWholeImagePreviewPipe: { edgeFor: (_purpose, edge) => edge },
    },
    document: { hidden: false },
    console: { error: (...args) => errors.push(args) },
    gpuPreviewEligible: () => true,
    cpuMicroPreviewSelected: () => false,
    renderViewerStatus() {},
    requiredProcessingLongEdge: () => viewer.target,
    geometrySignature: () => viewer.signature,
    gradeSourceIdentity: () => viewer.source,
    geometryDraftActive: () => viewer.draft,
    cancelGeometryUnderlayer() {},
    interactiveScaleDecision: () => ({ coarse: false }),
    noteViewerPan() {},
    scopeLongEdge: () => 960,
    localsBypassed: () => false,
    activeScopeRegion: () => null,
    microGrainPreviewRequest: () => ({}),
    gpuScopeEligible: () => !state.comparePeekActive && state.acceptedPresentation?.lane === state.currentView,
    enqueueGpuScopeRequest: async (request) => { scopes.push({ ...request, at: now }); return true; },
    renderGpuDraft: async (_lane, { longEdge }) => {
      state.acceptedPresentation.processedLongEdge = longEdge;
      c.refreshScopesAfterPresentation("sdr");
      return true;
    },
  });
  vm.runInContext(declarations(
    "scheduleZoomRefinement", "refineZoomView", "holdingNativeDenoisePictureForFit", "scheduleZoomScopeRefresh",
    "clearZoomScopeRefresh", "refreshScopes", "refreshScopesAfterPresentation", "suspendGradeInstruments",
    "debouncePreview", "runQueuedGpuScopeRequest",
    "installPreviewWatchdog", "restoreScopeFreshnessIfIdle", "scopeFreshnessLabel", "markScopeUpdating",
    "enqueueScopeRequest", "runScopeRequest", "renderPreviewForLane",
  ), c);
  return {
    c, state, viewer, scopes, edits, errors, freshness, updating,
    async tick(ms, { waitForCallbacks = true } = {}) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        timers.delete(id);
        const callback = timer.fn();
        await (waitForCallbacks ? callback : Promise.resolve());
      }
      now = end;
    },
  };
}

for (const continuous of [false, true]) {
  const style = continuous ? "continuous" : "single-action";
  test(`${style} zoom finishes ahead of one settled scope refresh`, async () => {
    const { c, state, scopes, tick } = fixture();
    c.scheduleZoomRefinement({ continuous });
    assert.equal(await c.refreshScopes(), false);
    await tick(continuous ? 80 : 0);
    assert.equal(state.acceptedPresentation.processedLongEdge, 1600);
    await tick(continuous ? 119 : 199);
    assert.equal(scopes.length, 0);
    await tick(1);
    assert.equal(state.zoomScopeTimer, 0);
    assert.equal(state.scopeAwaitingPresentation, null);
    assert.deepEqual(scopes.map(({ lane, tier, at }) => [lane, tier, at]), [["sdr", "settled", 200]]);
  });
}

test("five rapid zooms produce one scope refresh for the final exact picture", async () => {
  const { c, viewer, scopes, tick } = fixture();
  for (let i = 0; i < 5; i += 1) {
    viewer.target = 1600 + 50 * i;
    c.scheduleZoomRefinement({ continuous: i % 2 === 0 });
    await tick(60);
    assert.equal(scopes.length, 0);
  }
  await tick(139);
  assert.equal(scopes.length, 0);
  await tick(1);
  await tick(200);
  assert.deepEqual(scopes.map(({ at }) => at), [440]);
});

test("the watchdog waits through wheel debounce, then hands a refused zoom back to the scheduler", async () => {
  const { c, state, scopes, edits, tick } = fixture();
  state.previewWatchdogRearms = 0;
  c.renderGpuDraft = async () => false;
  c.installPreviewWatchdog();
  c.scheduleZoomRefinement({ continuous: true });
  c.watchdogTick();
  assert.equal(edits.length, 0);
  await tick(80);
  c.watchdogTick();
  assert.equal(edits.length, 1);
  assert.equal(await c.refreshScopes(), true);
  await tick(400);
  assert.deepEqual(scopes.map(({ at }) => at), [80]);
});

test("a refused zoom still refreshes a scope owed to the current edit", async () => {
  const { c, state, scopes, freshness, updating, tick } = fixture();
  c.gpuScopeEligible = () => false;
  assert.equal(await c.refreshScopes(), false);
  assert.equal(freshness.textContent, "Updating");
  c.renderGpuDraft = async () => false;
  c.scheduleZoomRefinement();
  c.gpuScopeEligible = () => true;
  await tick(200);
  await new Promise(setImmediate);
  assert.equal(scopes.length, 1);
  assert.equal(state.scopeAwaitingPresentation, null);
  assert.equal(freshness.textContent, "Settled");
  assert.equal(updating.has("updating"), false);
});

test("a geometry draft defers an owed scope without leaving the badge updating", async () => {
  const { c, viewer, scopes, freshness, updating, tick } = fixture();
  c.gpuScopeEligible = () => false;
  await c.refreshScopes();
  c.scheduleZoomRefinement();
  viewer.draft = true;
  await tick(200);
  assert.equal(scopes.length, 0);
  assert.equal(freshness.textContent, "Settled");
  assert.equal(updating.has("updating"), false);
  viewer.draft = false;
  c.gpuScopeEligible = () => true;
  await tick(200);
  assert.equal(scopes.length, 1);
});

for (const stage of ["JSON decoding", "peak measurement"]) {
  test(`a CPU scope overtaken by zoom during ${stage} neither presents nor leaves Updating`, async () => {
    const { c, state, scopes, freshness, updating, tick } = fixture();
    let notifyBlocked, finishStage;
    const blocked = new Promise(resolve => { notifyBlocked = resolve; });
    const wait = () => new Promise(resolve => { finishStage = resolve; notifyBlocked(); });
    const payload = { generation: 1 };
    let fetches = 0;
    c.fetch = async () => {
      fetches++;
      return { ok: true, json: stage === "JSON decoding" ? wait : async () => payload };
    };
    c.measureExactScopePeak = stage === "peak measurement" ? wait : async () => null;
    c.applyEditingScopePeak = c.applyAcceptedCpuScopePeak = c.recordDisplayedScopePeak = () => {};
    c.presentScopePayload = () => scopes.push({ source: "cpu" });
    state.scopeGeneration = 1;
    const request = { sessionId: "photo", lane: "sdr", mode: "histogram", tier: "settled", generation: 1,
      resolution: { bins: 1, columns: 1 }, scopeRegion: stage === "JSON decoding" ? {} : null };
    const active = new Promise(resolve => c.enqueueScopeRequest({ ...request, resolve }));
    await blocked;
    c.scheduleZoomRefinement();
    const queued = new Promise(resolve => c.enqueueScopeRequest({ ...request, resolve }));
    finishStage(payload);
    assert.deepEqual(await Promise.all([active, queued]), [false, false]);
    assert.equal(fetches, 1);
    assert.equal(scopes.length, 0);
    assert.equal(freshness.textContent, "Settled");
    assert.equal(updating.has("updating"), false);
    await tick(200);
    assert.equal(scopes.length, 1);
  });
}

test("CPU Micro Grain zoom survives a save that outlasts the quiet period", async () => {
  const { c, state, scopes, tick } = fixture();
  let finishSync;
  const sync = new Promise(resolve => { finishSync = resolve; });
  c.gpuPreviewEligible = () => false;
  c.cpuMicroPreviewSelected = () => true;
  c.cpuMicroViewport = () => null;
  c.syncGlobalEditState = () => sync;
  c.renderPreviewForLaneInner = async (_lane, _display, longEdge) => {
    state.acceptedPresentation.processedLongEdge = longEdge;
    return true;
  };
  c.scheduleZoomRefinement();
  await tick(200, { waitForCallbacks: false });
  assert.equal(state.cpuPreviewInflight, undefined);
  assert.equal(scopes.length, 0);
  finishSync(true);
  await new Promise(setImmediate);
  await tick(200);
  assert.deepEqual(scopes.map(({ at }) => at), [400]);
});

test("holding V prevents a CPU fallback and refreshes once after the original lane returns", async () => {
  const { c, state, scopes, tick } = fixture();
  c.enqueueScopeRequest = ({ resolve }) => { scopes.push({ source: "cpu" }); resolve(true); };
  c.scheduleZoomRefinement();
  await tick(50);
  state.comparePeekActive = true;
  await tick(150);
  assert.equal(scopes.length, 0);
  const original = state.acceptedPresentation;
  state.acceptedPresentation = { ...original, lane: "hdr" };
  await tick(200);
  assert.equal(scopes.length, 0);
  state.comparePeekActive = false;
  state.acceptedPresentation = original;
  await tick(200);
  assert.deepEqual(scopes.map(({ at }) => at), [600]);
});

test("zoom scopes wait for foreground GPU work and a queued pan", async () => {
  const { c, state, viewer, scopes, tick } = fixture();
  c.scheduleZoomRefinement();
  state.gpuPreview = { activeRenderCount: 1 };
  await tick(200);
  assert.ok(state.zoomScopeTimer);
  state.gpuPreview.activeRenderCount = 0;
  viewer.work.panTimerPending = true;
  await tick(200);
  assert.ok(state.zoomScopeTimer);
  assert.equal(scopes.length, 0);
  viewer.work.panTimerPending = false;
  await tick(200);
  assert.deepEqual(scopes.map(({ at }) => at), [600]);
});

test("a zoom at the painted edge redraws after a failed geometry handoff", async () => {
  const { c, state, viewer } = fixture();
  viewer.target = state.acceptedPresentation.processedLongEdge;
  viewer.signature = "Reset geometry";
  state.previewGeneration.sdr++;
  const rendered = [];
  c.renderGpuDraft = async (lane, { longEdge }) => { rendered.push([lane, longEdge]); return true; };
  await c.refineZoomView(null, viewer.target, "sdr", "photo");
  assert.deepEqual(rendered, [["sdr", viewer.target]]);
});

test("an edit after zoom cancels its scope timer and can refresh scopes normally", async () => {
  const { c, state, scopes, edits, tick } = fixture();
  c.scheduleZoomRefinement();
  await tick(50);
  state.previewGeneration.sdr++;
  c.debouncePreview();
  assert.equal(state.zoomScopeTimer, 0);
  assert.deepEqual(edits, [{ lane: "sdr", generation: 5 }]);
  await c.refreshScopes(960, { tier: "settled" });
  await tick(400);
  assert.deepEqual(scopes.map(({ at }) => at), [50]);
});

test("suspending Grade cancels the quiet timer before a session replacement", async () => {
  const { c, state, scopes, tick } = fixture();
  c.scheduleZoomRefinement();
  await tick(50);
  c.suspendGradeInstruments();
  state.session.session_id = "next photo";
  assert.equal(state.zoomScopeTimer, 0);
  await tick(400);
  assert.equal(scopes.length, 0);
});

for (const [reason, invalidate] of [
  ["session", ({ state }) => { state.session.session_id = "next photo"; }],
  ["lane", ({ state }) => { state.currentView = "hdr"; }],
  ["generation", ({ state }) => { state.previewGeneration.sdr++; }],
  ["geometry", ({ viewer }) => { viewer.signature = "new crop"; }],
  ["target", ({ viewer }) => { viewer.target = 1700; }],
  ["inexact picture", ({ state }) => { state.acceptedPresentation.exact = false; }],
  ["stale picture at the right edge", ({ state }) => { state.acceptedPresentation.generation--; }],
  ["workflow", ({ state }) => { state.activeWorkflow = "export"; }],
  ["hidden Grade", ({ c }) => { c.document.hidden = true; }],
  ["draft", ({ viewer }) => { viewer.draft = true; }],
  ["scheduled edit", ({ state }) => { state.previewScheduler.current = {}; }],
]) {
  test(`zoom scopes stand down for ${reason}`, async () => {
    const f = fixture();
    f.c.scheduleZoomRefinement();
    await f.tick(50);
    invalidate(f);
    await f.tick(200);
    assert.equal(f.state.zoomScopeTimer, 0);
    assert.equal(f.scopes.length, 0);
  });
}

test("a rejected zoom scope refresh is caught", async () => {
  const { c, errors, tick } = fixture();
  const error = Error("scope readback failed");
  c.refreshScopes = async () => { throw error; };
  c.scheduleZoomRefinement();
  await tick(200);
  await new Promise(setImmediate);
  assert.deepEqual(errors, [["Zoom scope refresh failed", error]]);
});

test("a rejected GPU scope resolves false and releases the queue", async () => {
  const { c, state, errors } = fixture();
  const error = Error("scope proxy failed");
  const results = [];
  c.gpuScopeEligible = () => false;
  c.runGpuScopeRequest = async ({ generation }) => {
    if (generation === 1) throw error;
    return true;
  };
  const next = new Promise((resolve) => { state.pendingGpuScopeRequest = { generation: 2, resolve }; });
  await c.runQueuedGpuScopeRequest({ generation: 1, resolve: (ok) => results.push(ok) });
  assert.deepEqual(results, [false]);
  assert.equal(await next, true);
  assert.deepEqual(errors, [["GPU scope refresh failed", error]]);
  assert.equal(state.gpuScopeRequestInFlight, null);
});

test("the watchdog lets an active frame and its pending settle finish", () => {
  const { c, state, edits } = fixture();
  state.previewWatchdogRearms = 0;
  c.installPreviewWatchdog();
  state.previewScheduler.frameInFlight = true;
  c.watchdogTick();
  state.previewScheduler.frameInFlight = false;
  state.previewScheduler.settleTimer = 1;
  c.watchdogTick();
  assert.equal(edits.length, 0);
  state.previewScheduler.settleTimer = null;
  c.watchdogTick();
  assert.equal(edits.length, 1);
});

test("a settled scope request cancels a live fill before waiting for shared renderer state", async () => {
  const { c, state, tick, errors } = fixture();
  const events = [];
  const canvas = {};
  const fill = new AbortController();
  state.session.source = { width: 7968, height: 5312 };
  state.acceptedPresentation.execution = "tiled";
  state.gpuPreview = {
    activeRenderCount: 1,
    async renderScopeProxy() {
      assert.equal(fill.signal.aborted, true);
      assert.equal(this.activeRenderCount, 0);
      events.push("scope-proxy");
      return { canvas, sourceSerial: 3 };
    },
    async analyzeScope(scopeCanvas) {
      assert.equal(scopeCanvas, canvas);
      return { sessionId: "photo", sourceSerial: 3, applicationGeneration: 4, geometrySignature: "crop" };
    },
  };
  fill.signal.addEventListener("abort", () => {
    events.push("cancel-fill");
    c.window.setTimeout(() => { state.gpuPreview.activeRenderCount = 0; }, 8);
  });
  Object.assign(c, {
    performance: { now: () => 0 },
    cancelGeometryUnderlayer: () => fill.abort(),
    sampleCurvePoints() {},
    localAdjustments: () => [],
    projectReferenceWhiteNits: () => 203,
    measureExactScopePeak: async () => null,
    buildGpuScopePayload: () => ({}),
    applyEditingScopePeak() {},
    recordDisplayedScopePeak() {},
    presentScopePayload: () => events.push("scope-presented"),
  });
  vm.runInContext(declarations("enqueueGpuScopeRequest", "runGpuScopeRequest"), c);
  const result = c.refreshScopes();
  assert.deepEqual(events, ["cancel-fill"]);
  await tick(16, { waitForCallbacks: false });
  const applied = await result;
  assert.deepEqual(errors, []);
  assert.equal(applied, true);
  assert.deepEqual(events, ["cancel-fill", "scope-proxy", "scope-presented"]);
});
