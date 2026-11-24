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
  const viewer = { target: 1600, signature: "crop", work: {}, draft: false, source: "generated-sdr" };
  const state = {
    session: { session_id: "photo" },
    activeWorkflow: "grade",
    currentView: "sdr",
    previewGeneration: { sdr: 4 },
    acceptedPresentation: { sessionId: "photo", lane: "sdr", generation: 4, exact: true, geometrySignature: "crop", processedLongEdge: 7000 },
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
    AbortSignal,
    els: { scopeFreshness: freshness, previewCanvas: { style: {} }, previewImage: { style: { display: "none" } } },
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
    "cancelGpuScopeRequests", "rescheduleGpuScopeAfterPan",
    "scopePresentationIdentity", "scopePresentationMatches", "showUnavailableMicroScope", "microGrainPreviewKey",
    "debouncePreview", "runQueuedGpuScopeRequest",
    "installPreviewWatchdog", "restoreScopeFreshnessIfIdle", "scopeFreshnessLabel", "markScopeUpdating",
    "enqueueScopeRequest", "runScopeRequest", "renderPreviewForLane",
  ), c);
  Object.assign(state.acceptedPresentation, c.scopePresentationIdentity("sdr"));
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
  state.acceptedPresentation.generation--;
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
  const { c, state, viewer, scopes, freshness, updating, tick } = fixture();
  c.gpuScopeEligible = () => false;
  state.acceptedPresentation.generation--;
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
      presentation: c.scopePresentationIdentity("sdr"),
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

for (const execution of ["cpu-viewport", null]) {
  test(`a current CPU ${execution || "whole canvas"} wakes the scope without accepting a stale picture`, async () => {
    const { c, state, scopes, freshness } = fixture();
    c.gpuScopeEligible = () => false;
    c.enqueueScopeRequest = request => { scopes.push(request); request.resolve(true); };
    state.previewGeneration.sdr++;
    assert.equal(await c.refreshScopes(), false);
    assert.equal(freshness.textContent, "Updating");

    const current = { ...state.acceptedPresentation, transport: "Raw RGBA8", execution, generation: 5 };
    for (const stale of [{ generation: 4 }, { sessionId: "old" }, { lane: "hdr" }, { geometrySignature: "old crop" }]) {
      state.acceptedPresentation = { ...current, ...stale };
      c.refreshScopesAfterPresentation("sdr");
    }
    assert.equal(scopes.length, 0);
    state.acceptedPresentation = current;
    c.refreshScopesAfterPresentation("sdr");
    c.refreshScopesAfterPresentation("sdr");
    assert.deepEqual(scopes.map(({ tier, lane }) => [tier, lane]), [["settled", "sdr"]]);
    assert.equal(state.scopeAwaitingPresentation, null);
  });
}

test("a cache-only Micro scope miss clears the old histogram and stops Updating", async () => {
  const { c, state, freshness, updating } = fixture();
  const controls = { method: "micro_grain", micro_luminance: 0.55 };
  c.gpuScopeEligible = () => false;
  state.acceptedPresentation.transport = "Raw RGBA8";
  state.acceptedPresentation.execution = "cpu-viewport";
  c.microGrainPreviewRequest = () => ({ micro_grain_controls: controls });
  c.safeJson = response => response.json();
  let calls = 0;
  c.fetch = async (_url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body).micro_grain_controls, controls);
    return { ok: false, status: 409, json: async () => ({ detail: { code: "micro_scope_source_unavailable" } }) };
  };
  c.drawHistogram = scope => assert.equal(scope, null);
  c.updateExportAvailability = () => {};
  assert.equal(await c.refreshScopes(), false);
  assert.equal(calls, 1);
  assert.equal(state.lastScope, null);
  assert.equal(freshness.textContent, "Unavailable");
  assert.equal(updating.has("updating"), false);
});

test("the scheduler leaves CPU Micro scopes to its settled picture pass", async () => {
  const { c, state, scopes } = fixture();
  c.gpuScopeEligible = () => false;
  c.cpuMicroPreviewSelected = () => true;
  c.enqueueScopeRequest = request => { scopes.push(request); request.resolve(true); };
  assert.equal(await c.refreshScopes(960, { tier: "interactive", generation: 1 }), false);
  assert.equal(state.scopeAwaitingPresentation ?? null, null);
  assert.equal(await c.refreshScopes(960, { tier: "settled", generation: 1 }), true);
  assert.deepEqual(scopes.map(({ tier }) => tier), ["settled"]);
});

test("a whole-picture CPU Micro preview wakes the histogram when its image has been presented", async () => {
  const { c, state, scopes, freshness } = fixture();
  c.gpuScopeEligible = c.gpuPreviewEligible = () => false;
  c.cpuMicroPreviewSelected = () => true;
  c.els.previewCanvas.style.display = "none";
  c.els.previewImage.style.display = "block";
  c.enqueueScopeRequest = request => { scopes.push(request); request.resolve(true); };
  state.previewGeneration.sdr++;

  assert.equal(await c.refreshScopes(), false);
  assert.equal(scopes.length, 0);
  assert.equal(freshness.textContent, "Updating");
  state.acceptedPresentation = { ...c.scopePresentationIdentity("sdr"), transport: "AVIF" };
  c.refreshScopesAfterPresentation("sdr");
  assert.equal(scopes.length, 1);
  assert.equal(state.scopeAwaitingPresentation, null);
});

for (const [name, change] of [
  ["Micro strength", ({ state }) => { state.denoise.sdr.controls.micro_luminance = 0.8; }],
  ["authored SDR", ({ viewer }) => { viewer.source = "authored-sdr"; }],
  ["Denoise enabled", ({ state }) => { state.denoise.sdr.enabled = false; }],
  ["Denoise method", ({ state }) => { state.denoise.sdr.controls.method = "standard"; }],
  ["original view", ({ state }) => { state.denoiseRuntime.sdr.showOriginal = true; }],
  ["edit revision", ({ state }) => { state.editRevision = 2; }],
  ["repair source", ({ state }) => { state.repairSourceGeneration = 2; }],
  ["source replacement", ({ state }) => { state.importGeneration = 2; }],
  ["RAW redevelop", ({ state }) => { state.rawRedevelopGeneration = 1; }],
  ["RAW history undo", ({ state }) => { state.editDocument = { source: { raw_import_settings: { demosaic: "new" } } }; }],
]) {
  test(`a CPU histogram response is dropped after ${name} changes with no preview generation bump`, async () => {
    const harness = fixture();
    const { c, state, scopes } = harness;
    state.denoise = { sdr: { enabled: true, controls: { method: "micro_grain", micro_luminance: 0.55 } } };
    state.denoiseRuntime = { sdr: { showOriginal: false } };
    state.editRevision = state.importGeneration = 1;
    Object.assign(state.acceptedPresentation, c.scopePresentationIdentity("sdr"));
    c.gpuScopeEligible = () => false;
    c.fetch = async () => {
      change(harness);
      return { ok: true, json: async () => ({ generation: 1, micro_source_long_edge: 960 }) };
    };
    c.applyEditingScopePeak = c.applyAcceptedCpuScopePeak = c.recordDisplayedScopePeak = () => {};
    c.presentScopePayload = () => scopes.push({ source: "cpu" });
    assert.equal(await c.refreshScopes(), false);
    assert.equal(scopes.length, 0);
  });
}

for (const [name, zoomMode, zoomPercent, expected] of [
  ["Fit", "fit", 30, 1], ["60%", "custom", 60, 1], ["100%", "custom", 100, 0],
]) test(`${name} retries an unavailable Micro scope only at a whole-picture scale`, async () => {
  const { c, state, scopes, tick, viewer } = fixture();
  c.gpuPreviewEligible = c.gpuScopeEligible = () => false;
  c.cpuMicroPreviewSelected = () => true;
  c.cpuMicroViewport = () => null;
  c.syncGlobalEditState = async () => true;
  c.renderPreviewForLaneInner = async () => {
    state.acceptedPresentation = { ...c.scopePresentationIdentity("sdr"), exact: false,
      transport: "Raw RGBA8", processedLongEdge: viewer.target - 200, reducedNotice: "Reduced" };
    return true;
  };
  c.enqueueScopeRequest = request => { scopes.push(request); request.resolve(true); };
  state.scopeUnavailable = c.scopePresentationIdentity("sdr");
  Object.assign(state, { zoomMode, zoomPercent });
  c.scheduleZoomRefinement();
  await tick(200);
  await new Promise(setImmediate);
  assert.equal(scopes.length, expected);
});

test("framing history can clear the original flag without changing a disabled Denoise picture", () => {
  const { c, state } = fixture();
  state.denoiseRuntime = { sdr: { showOriginal: true } };
  for (const method of ["standard", "clean_grain", "micro_grain"]) {
    state.denoise = { sdr: { enabled: false, controls: { method } } };
    state.denoiseRuntime.sdr.showOriginal = true;
    const frame = c.scopePresentationIdentity("sdr");
    state.denoiseRuntime.sdr.showOriginal = false;
    assert.equal(c.scopePresentationMatches(frame, "sdr"), true, method);
  }
});

test("completed saves do not make the visible GPU frame ineligible for its histogram", async () => {
  const { c, state, scopes, freshness } = fixture();
  vm.runInContext(declarations("gpuScopeEligible", "enqueueGpuScopeRequest", "runGpuScopeRequest"), c);
  Object.assign(state, { editRevision: 12, repairSourceGeneration: 1 });
  Object.assign(state.acceptedPresentation, c.scopePresentationIdentity("sdr"), { transport: "WebGPU", sourceSerial: 7 });
  state.session.source = { width: 3200, height: 2000 };
  state.gpuPreview = { available: true, analyzeScope: async () => {
    state.editRevision++;
    return { sessionId: "photo", sourceSerial: 7, applicationGeneration: 4, geometrySignature: "crop" };
  } };
  c.performance = { now: () => 0 };
  c.sampleCurvePoints = () => [];
  c.localAdjustments = () => [];
  c.projectReferenceWhiteNits = () => 203;
  c.measureExactScopePeak = async () => null;
  c.buildGpuScopePayload = () => ({});
  c.applyEditingScopePeak = c.recordDisplayedScopePeak = () => {};
  c.presentScopePayload = (_payload, { source }) => {
    scopes.push(source);
    freshness.textContent = "Settled";
  };
  for (const execution of ["whole", "tiled"]) {
    state.acceptedPresentation.execution = execution;
    state.editRevision++;
    state.gpuPreview.renderScopeProxy = async (...args) => {
      assert.equal(args[6], state.editRevision);
      return { canvas: c.els.previewCanvas, sourceSerial: 7 };
    };
    assert.equal(await c.refreshScopes(), true, execution);
    assert.equal(freshness.textContent, "Settled");
  }
  const revisions = [];
  state.gpuPreview.renderScopeProxy = async (...args) => {
    revisions.push(args[6]);
    if (revisions.length === 1) {
      state.editCommandQueue = Promise.resolve().then(() => state.editRevision++);
      throw Object.assign(new Error("Revision conflict"), { status: 409 });
    }
    return { canvas: c.els.previewCanvas, sourceSerial: 7 };
  };
  const revision = state.editRevision;
  assert.equal(await c.refreshScopes(), true);
  assert.deepEqual(revisions, [revision, revision + 1]);
  assert.deepEqual(scopes, ["gpu", "gpu", "gpu"]);
  state.repairSourceGeneration++;
  assert.equal(await c.refreshScopes(), false);
  assert.equal(freshness.textContent, "Updating");
});

for (const conflict of ["queued save", "backend revision", "obsolete CPU request", "new repair source", "revision after retry"]) {
  test(`CPU scope 409 recovery: ${conflict}`, async () => {
    const { c, state, scopes } = fixture();
    state.editRevision = 10;
    Object.assign(state.acceptedPresentation, c.scopePresentationIdentity("sdr"));
    c.gpuScopeEligible = () => false;
    c.safeJson = response => response.json();
    c.applyEditingScopePeak = c.applyAcceptedCpuScopePeak = c.recordDisplayedScopePeak = () => {};
    c.presentScopePayload = () => scopes.push("cpu");
    let reloads = 0;
    c.refreshEditState = async () => { reloads++; state.editRevision++; };
    const revisions = [];
    c.fetch = async (_url, { body }) => {
      const request = JSON.parse(body);
      revisions.push(request.edit_revision);
      if (revisions.length === 1) {
        if (conflict === "queued save") state.editCommandQueue = Promise.resolve().then(() => state.editRevision++);
        if (conflict === "new repair source") state.repairSourceGeneration = 1;
        return { status: 409, json: async () => ({ detail: conflict === "obsolete CPU request"
          ? "Stale scope request dropped." : "Edit revision conflict" }) };
      }
      if (conflict === "revision after retry") state.editRevision++;
      return { ok: true, json: async () => ({ generation: request.generation, micro_source_long_edge: 960 }) };
    };
    const canRetry = !["obsolete CPU request", "new repair source"].includes(conflict);
    const canPresent = canRetry && conflict !== "revision after retry";
    assert.equal(await c.refreshScopes(), canPresent);
    assert.deepEqual(revisions, canRetry ? [10, 11] : [10]);
    assert.equal(reloads, canRetry && conflict !== "queued save" ? 1 : 0);
    assert.equal(scopes.length, Number(canPresent));
  });
}

test("Edge Colour RAW does not schedule CPU Micro preview work", () => {
  const { c, state } = fixture();
  vm.runInContext(declarations("cpuMicroPreviewSelected", "microGrainUnavailable"), c);
  state.session.metadata = { extra: { micro_grain_bayer: true } };
  state.session.source = { width: 3200, height: 2000 };
  state.denoise = { sdr: { enabled: true, controls: { method: "micro_grain", micro_luminance: 0.55 } } };
  c.gpuPreviewEligible = () => false;
  assert.equal(c.cpuMicroPreviewSelected("sdr"), true);
  state.editDocument = { source: { raw_import_settings: {
    highlight_reconstruction: { enabled: true, method: "edge_colour_v1" },
  } } };
  assert.equal(c.cpuMicroPreviewSelected("sdr"), false);
  c.scheduleZoomRefinement();
  assert.equal(state.zoomRefinementTimer, undefined);
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

function useRealGpuScopes({ c: context, state, scopes, freshness }) {
  Object.assign(state.acceptedPresentation, { transport: "WebGPU", sourceSerial: 12 });
  state.gpuPreview = { available: true, analyzeScope: async () => ({
    sessionId: "photo", sourceSerial: 12, applicationGeneration: 4, geometrySignature: "crop",
  }) };
  state.previewScheduler.recordStaleResult = () => {};
  context.enqueueGpuScopeRequest = request => context.runGpuScopeRequest(request);
  context.measureExactScopePeak = async () => null;
  context.buildGpuScopePayload = () => ({});
  context.applyEditingScopePeak = context.recordDisplayedScopePeak = () => {};
  context.presentScopePayload = (_payload, { mode, source }) => {
    scopes.push({ mode, source });
    freshness.textContent = "Settled";
  };
  vm.runInContext(declarations("gpuScopeEligible", "runGpuScopeRequest"), context);
}

test("changing histogram channels after cancelling a project relink reuses the visible GPU picture", async () => {
  const testFixture = fixture();
  const { c: context, state, scopes, freshness } = testFixture;
  state.importGeneration = 5;
  state.projectOpenGeneration = 0;
  state.byteUploadQueue = Promise.resolve();
  Object.assign(state.acceptedPresentation, context.scopePresentationIdentity("sdr"));
  useRealGpuScopes(testFixture);
  const picture = state.acceptedPresentation;
  let relinked = 0;
  context.desktop = { relinkSource: async () => { relinked++; return null; } };
  context.fetch = () => assert.fail("the open transport is stubbed");
  context.projectIo = { openDesktopProject: async () => ({ response: { ok: false }, payload: {} }) };
  context.confirmUnsavedTransition = async () => true;
  context.documentTransitionToken = () => "photo";
  context.beginProjectOpenStatus = () => 0;
  context.projectOpenNeedsSourceRelink = () => true;
  context.hidePreviewMessage = () => {};
  context.status = { clear() {}, get() {}, post: ({ message }) => assert.fail(message) };
  context.els.projectOpen = {};
  context.window.requestAnimationFrame = resolve => resolve();
  context.window.clearInterval = () => {};
  vm.runInContext(declarations("openProjectFromPath"), context);

  await context.openProjectFromPath({ path: "missing-source.hdrfinisher", grant: "project" });
  assert.equal(relinked, 1);
  assert.equal(state.importGeneration, 6);
  assert.equal(state.acceptedPresentation, picture);
  state.scopeChannelMode = "luma";
  assert.equal(await context.refreshScopes(), true);
  assert.deepEqual(scopes, [{ mode: "histogram", source: "gpu" }]);
  assert.equal(freshness.textContent, "Settled");
});

for (const source of ["gpu", "cpu"]) {
  for (const [generationKey, action] of [["importGeneration", "import"], ["rawRedevelopGeneration", "RAW redevelop"]]) {
    test(`${source} scope in flight is dropped when a new ${action} starts`, async () => {
      const testFixture = fixture();
      const { c: context, state, scopes, errors } = testFixture;
      useRealGpuScopes(testFixture);
      if (source === "gpu") {
        const analyze = state.gpuPreview.analyzeScope;
        state.gpuPreview.analyzeScope = async () => {
          state[generationKey] = 1;
          return analyze();
        };
      } else {
        state.gpuPreview.available = false;
        context.fetch = async () => {
          state[generationKey] = 1;
          return { ok: true, json: async () => ({ generation: state.scopeGeneration }) };
        };
        context.applyAcceptedCpuScopePeak = () => {};
      }
      assert.equal(await context.refreshScopes(), false);
      assert.equal(state[generationKey], 1);
      assert.deepEqual(scopes, []);
      assert.deepEqual(errors, []);
    });
  }
}

test("changing the disabled Denoise method does not invalidate the visible picture", async () => {
  const testFixture = fixture();
  const { c: context, state } = testFixture;
  state.denoise = { sdr: { enabled: false, controls: { method: "micro_grain" } } };
  Object.assign(state.acceptedPresentation, context.scopePresentationIdentity("sdr"));
  useRealGpuScopes(testFixture);
  state.denoise.sdr.controls.method = "clean_grain";
  assert.equal(await context.refreshScopes(), true);
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

test("panning aborts the histogram proxy fetch and only the replacement histogram is presented", async () => {
  const { c, state, tick, errors } = fixture();
  const signals = [];
  const presented = [];
  state.session.source = { width: 3200, height: 2000 };
  state.acceptedPresentation.execution = "tiled";
  const picture = new AbortController();
  state.denoise = {};
  state.previewControllers = { sdr: picture };
  state.gpuPreview = {
    async renderScopeProxy(...args) {
      const { signal, cancelCoarseFetches } = args[9];
      assert.ok(signal);
      assert.equal(cancelCoarseFetches, true);
      signals.push(signal);
      if (signals.length === 1) await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      return { canvas: c.els.previewCanvas, sourceSerial: 7 };
    },
    async analyzeScope() {
      return { sessionId: "photo", sourceSerial: 7, applicationGeneration: 4, geometrySignature: "crop" };
    },
  };
  Object.assign(c, {
    performance: { now: () => 0 }, liveGradeGrainSelected: () => false,
    sampleCurvePoints() {}, localAdjustments: () => [], projectReferenceWhiteNits: () => 203,
    measureExactScopePeak: async () => null, buildGpuScopePayload: () => ({}),
    applyEditingScopePeak() {}, recordDisplayedScopePeak() {},
    presentScopePayload: (_payload, { generation }) => presented.push(generation),
  });
  vm.runInContext(declarations("enqueueGpuScopeRequest", "runGpuScopeRequest", "noteViewerPan"), c);
  state.renderCoordinator.notePan = () => {};
  const obsolete = c.refreshScopes();
  assert.equal(signals.length, 1);
  c.noteViewerPan();
  assert.equal(signals[0].aborted, true);
  assert.equal(picture.signal.aborted, false);
  assert.equal(await obsolete, false);
  await tick(200);
  await new Promise(setImmediate);
  assert.equal(signals.length, 2);
  assert.equal(signals[1].aborted, false);
  assert.deepEqual(presented, [2]);
  assert.deepEqual(errors, []);
});

for (const phase of ["CPU fallback fetch", "CPU fallback peak", "GPU scope peak"]) {
  test(`panning cancels the ${phase} and settles the replacement histogram`, async () => {
    const { c, state, tick, errors, freshness, updating } = fixture();
    const presented = [];
    const entered = Promise.withResolvers();
    const hang = (signal) => {
      entered.resolve(signal);
      if (!signal) return Promise.reject(new Error("scope work has no cancellation signal"));
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    };
    state.session.source = { width: 3200, height: 2000 };
    state.acceptedPresentation.execution = "tiled";
    state.denoise = {};
    state.gpuPreview = {
      async renderScopeProxy() {
        if (state.scopeGeneration === 1 && phase.startsWith("CPU")) return null;
        return { canvas: c.els.previewCanvas, sourceSerial: 7 };
      },
      async analyzeScope() {
        return { sessionId: "photo", sourceSerial: 7, applicationGeneration: 4, geometrySignature: "crop" };
      },
    };
    Object.assign(c, {
      performance: { now: () => 0 }, liveGradeGrainSelected: () => false,
      sampleCurvePoints() {}, localAdjustments: () => [], projectReferenceWhiteNits: () => 203,
      fetch: async (_url, { signal }) => phase === "CPU fallback fetch" ? hang(signal)
        : { ok: true, json: async () => ({ generation: null }) },
      measureExactScopePeak: async ({ signal }) => state.scopeGeneration === 1 ? hang(signal) : null,
      buildGpuScopePayload: () => ({}), applyEditingScopePeak() {}, recordDisplayedScopePeak() {},
      presentScopePayload: (_payload, { generation }) => {
        presented.push(generation);
        freshness.textContent = "Settled";
        updating.delete("updating");
      },
    });
    vm.runInContext(declarations("enqueueGpuScopeRequest", "runGpuScopeRequest", "noteViewerPan"), c);
    state.renderCoordinator.notePan = () => {};
    const obsolete = c.refreshScopes();
    const signal = await entered.promise;
    assert.ok(signal);
    assert.equal(freshness.textContent, "Updating");
    c.noteViewerPan();
    assert.equal(signal.aborted, true);
    assert.equal(await obsolete, false);
    assert.ok(!state.scopeRequestInFlight);
    assert.deepEqual(presented, []);
    await tick(200);
    await new Promise(setImmediate);
    assert.deepEqual(presented, [2]);
    assert.equal(freshness.textContent, "Settled");
    assert.deepEqual(errors, []);
  });
}
