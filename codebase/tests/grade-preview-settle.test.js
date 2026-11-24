const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");
const { declarations, frontendSource } = require("./frontend-source.js");

function grainRenderer(context, method, edge) {
  const { window } = context;
  window.HDRWebGPUShaders = require("../frontend/webgpu-shaders.js").HDRWebGPUShaders;
  window.HDRGraphScale = require("../frontend/graph-scale.js").HDRGraphScale;
  context.HDRTone = require("../frontend/tone-engine.js");
  vm.runInContext(frontendSource("webgpu-preview.js"), context);
  const proxy = { identity: "source", width: edge, height: 1000, longEdge: edge };
  return Object.assign(Object.create(window.HDRWebGPUPreview.prototype), {
    available: true,
    sessionId: "photo",
    renderSerials: new Map(),
    intermediates: new Map(),
    fineGrainReduced: new Map(),
    denoiseSourceSelector: { controls: { method }, cache: { grain: { gpu: true, width: 6000, height: 4000 } } },
    adaptiveDenoiseFor: () => true,
    adaptiveDenoiseSelected: () => true,
    resizeNativeFineGrain: async () => ({ ...proxy }),
    loadProxy: async () => proxy,
    roiRegionFor: () => null,
    prefetchZoomMasks() {},
    configureSurface: () => ({ format: "rgba16float", hdr: true }),
    pipelineFor: () => ({}),
    sourcePixelScaleFor: () => 1,
    graphActivity: () => ({}),
    composedTileHalo: () => ({ halo: 0 }),
    planRender: () => ({ decision: { mode: "tiled", violations: [] }, totals: {} }),
    highlightAnchorRequest: () => null,
    uploadParamsAndCurves() {},
    tiledExecutionRefusals: () => [],
    encodeTiledGeneration: async (_canvas, _context, _proxy, _surface, _pipelines, _params, options) => ({
      rendered: true, nativeReduced: Boolean(options.fineGrainReduced),
    }),
    recordStage() {},
    finishActiveRender() {},
  });
}

function grade({ tiled = true, cpu = false, faster = false, blockDrag = false, coordinated = false, denoiseMethod } = {}) {
  const events = [];
  const timers = new Map();
  let now = 0;
  let serial = 0;
  let target = 1841;
  let activeDraft;
  let finishDrag;
  let finishPriorRender;
  let savedLocal;
  const local = { id: "local", mask: { leaf: { type: "brush", brush_radius: 0.025 } } };
  const dragRequest = new AbortController();
  const setTimer = (fn, delay) => {
    timers.set(++serial, { fn, at: now + delay });
    return serial;
  };
  const clearTimer = (id) => timers.delete(id);
  const state = {
    session: { session_id: "photo" },
    activeWorkflow: "grade",
    currentView: "hdr",
    scopeMode: "histogram",
    scopeGeneration: 0,
    previewGeneration: { hdr: 1 },
    editRevision: 1,
    fasterDragging: faster,
    zoomMode: tiled ? "custom" : "fit",
    gpuPreview: { available: !cpu, minimumExecutionDecision: () => ({ mode: "direct" }) },
    acceptedPresentation: { sessionId: "photo", lane: "hdr", generation: 1, geometrySignature: "frame",
      execution: tiled ? "tiled" : "direct", processedLongEdge: target, exact: true, width: target, height: 1000,
      transport: cpu ? "PNG" : "WebGPU", sourceSerial: 1 },
    gpuDraftRefusals: {},
    denoise: denoiseMethod ? { hdr: { enabled: true } } : {},
    localMaskCommitDepth: 0,
  };
  const draw = async (_lane, { tier, longEdge, coarse, reason }) => {
    if (cpu) return false;
    events.push(["gpu", tier, longEdge, !!coarse, state.editRevision]);
    if (blockDrag && state.previewScheduler.interacting) {
      activeDraft = { request: { reason } };
      const success = await new Promise((resolve) => {
        finishDrag = () => resolve(true);
        dragRequest.signal.addEventListener("abort", () => resolve(false), { once: true });
      });
      activeDraft = null;
      if (!success) return false;
    }
    const result = denoiseMethod ? await state.gpuPreview.renderTo(c.els.previewCanvas, "photo", "hdr",
      { hdr: {}, sdr: {}, shared: {} }, null, longEdge, [], state.editRevision, null, 203, null,
      { tier, keepProxies: true, viewport: { x: 0, y: 0, width: 300, height: 200 } }) : {};
    if (denoiseMethod) events.push(["denoise", tier, result.nativeReduced, result.approximate]);
    state.acceptedPresentation = { ...state.acceptedPresentation, ...c.scopePresentationIdentity("hdr"),
      processedLongEdge: longEdge, exact: longEdge === target && !result.approximate, sourceSerial: ++serial };
    c.refreshScopesAfterPresentation("hdr");
    return true;
  };
  const c = vm.createContext({
    state,
    AbortController,
    els: { previewCanvas: { style: {}, getContext: () => ({}) } },
    document: { hidden: false },
    performance: { now: () => now },
    window: { setTimeout: setTimer, clearTimeout: clearTimer,
      HDRWholeImagePreviewPipe: { edgeFor: (_kind, edge) => edge } },
    requestAnimationFrame: (fn) => setTimer(() => fn(now), 16),
    cancelAnimationFrame: clearTimer,
    cancelGeometryUnderlayer() {},
    installPreviewWatchdog() {},
    gpuPreviewEligible: () => !cpu,
    geometryDraftActive: () => false,
    geometrySignature: () => "frame",
    gpuDetailGraphActive: () => false,
    cpuMicroPreviewSelected: () => false,
    requiredProcessingLongEdge: () => target,
    settledProxyLongEdge: () => target,
    refinementProxyLongEdge: () => target,
    interactiveScaleDecision: (_lane, { interacting } = {}) => ({ edge: tiled ? target : target - 100,
      coarse: faster && interacting && !state.acceptedPresentation.exact }),
    responseCoarseLongEdge: (edge) => Math.round(edge / 2),
    previewNeedsRefinement: () => false,
    syncGlobalEditState: async () => {
      if (state.globalEditDirty) {
        state.globalEditDirty = false;
        state.editRevision += 1;
        events.push(["sync", state.editRevision]);
      }
      return true;
    },
    renderGpuDraft: draw,
    invalidatePreview: (lane) => { state.previewGeneration[lane] = (state.previewGeneration[lane] ?? 0) + 1; },
    gpuFrameSizeAt: () => ({ width: 921, height: 600 }),
    visibleOutputRect: () => ({ x: 0, y: 0, width: 300, height: 200 }),
    localAdjustments: () => [],
    selectedLocal: () => local,
    unusedLocal: () => false,
    queueEditCommand: async (_command, payload) => { savedLocal = payload.local; state.editRevision += 1; return true; },
    queueLocalMaskOverlayRender() {},
    renderCompareStatus() {},
    updateExportAvailability() {},
    renderPreviewForLane: async (_lane, _display, longEdge) => events.push(["cpu", longEdge, state.editRevision]),
    enqueueGpuScopeRequest: async (request) => { events.push(["scope", request.tier, request.edit_revision]); return true; },
    enqueueScopeRequest: (request) => { events.push(["scope", request.tier, request.edit_revision]); request.resolve(true); },
    scopeLongEdge: () => 960,
    localsBypassed: () => false,
    activeScopeRegion: () => null,
    microGrainPreviewRequest: () => ({}),
    prepareInactivePreview() {},
    wakePendingHighlightAnchor() {},
    refreshOverlay() {},
    requestLiveOverlay() {},
    visiblePreviewCanvasRect() {},
    markScopeUpdating() {},
    restoreScopeFreshnessIfIdle() {},
    renderViewerStatus() {},
  });
  vm.runInContext(frontendSource("preview-scheduler.js"), c);
  vm.runInContext(declarations("initializePreviewScheduler", "interactiveDraftGuaranteedTiled", "previewSourceCapacityRefused",
    "settlePreview", "settlePreviewInner", "settlePreviewFrame", "refreshScopes", "gpuScopeEligible", "refreshScopesAfterPresentation",
    "scopePresentationIdentity", "scopePresentationMatches",
    "gradeSourceIdentity", "microGrainPreviewKey",
    "clearZoomScopeRefresh", "debouncePreview", "scheduleZoomRefinement", "scheduleZoomScopeRefresh", "refineZoomView",
    "scheduleLocalPreview", "commitSelectedLocal", "holdingNativeDenoisePictureForFit"), c);
  Object.assign(state.acceptedPresentation, c.scopePresentationIdentity("hdr"));
  if (denoiseMethod) state.gpuPreview = grainRenderer(c, denoiseMethod, target);
  c.initializePreviewScheduler();
  if (blockDrag) state.renderCoordinator = {
    inFlight: () => activeDraft,
    cancelInFlight: () => dragRequest.abort(),
    dropPending() {},
  };
  if (coordinated) {
    vm.runInContext(frontendSource("render-coordinator.js"), c);
    vm.runInContext("let previewCapacityRecovery = null, geometryMapCapacityRefusals = new Map();\n" +
      declarations("renderGpuDraft", "invalidatePreview", "pacedPreviewInteraction",
        "clearPreviewCapacityRecovery", "clearGeometryMapCapacityRefusals"), c);
    state.renderCoordinator = new c.window.HDRRenderCoordinator({
      dispatch: async (request) => {
        if (request.reason === "prior-render") {
          await new Promise((resolve) => { finishPriorRender = resolve; });
          return false;
        }
        if (request.coarse) {
          if (finishPriorRender) events.push(["coarse-preparation"]);
          await new Promise((resolve) => {
            const timer = setTimer(resolve, 45);
            request.token.signal.addEventListener("abort", () => { clearTimer(timer); resolve(); }, { once: true });
          });
          if (!request.isCurrent()) return false;
        }
        return draw(request.lane, request);
      },
    });
    state.renderCoordinator.noteSource("photo");
    state.previewGeneration.hdr = state.renderCoordinator.generation("hdr", "edit");
    state.acceptedPresentation.generation = state.previewGeneration.hdr;
  }
  return {
    state, events, dragRequest, local,
    savedBrushRadius: () => savedLocal?.mask.leaf.brush_radius,
    finishDrag: () => finishDrag(),
    finishPriorRender: () => finishPriorRender(),
    editLocal: () => c.scheduleLocalPreview(),
    commitLocal: () => c.commitSelectedLocal({ refreshPreview: false }),
    edit() {
      state.globalEditDirty = true;
      if (coordinated) c.invalidatePreview("hdr", { local: true });
      else state.previewGeneration.hdr += 1;
      c.debouncePreview();
    },
    zoom(edge) {
      target = edge;
      c.scheduleZoomRefinement();
    },
    async tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await new Promise(setImmediate);
      }
      now = end;
    },
  };
}

test("a zoomed tiled edit settles exactly once after edit sync and requests one scope", async () => {
  const { state, events, edit, tick } = grade();
  edit();
  await tick(16);
  assert.deepEqual(events, []);
  assert.equal(state.scopeAwaitingPresentation, undefined);
  await tick(160);
  assert.deepEqual(events, [
    ["sync", 2], ["gpu", "refinement", 1841, false, 2], ["scope", "settled", 2],
  ]);
});

for (const faster of [false, true]) {
  test(`a zoomed tiled drag gives ${faster ? "coarse" : "exact"} live feedback`, async () => {
    const { state, events, edit, tick } = grade({ faster });
    state.previewScheduler.beginInteraction();
    edit();
    await tick(16);
    assert.deepEqual(events, [["gpu", faster ? "refinement" : "interactive", faster ? 921 : 1841, faster, 1]]);
  });
}

test("a direct Fit edit draws feedback before the synced exact frame", async () => {
  const { events, edit, tick } = grade({ tiled: false });
  edit();
  await tick(160);
  assert.deepEqual(events.filter(([kind]) => kind === "gpu"), [
    ["gpu", "interactive", 1741, false, 2], ["gpu", "refinement", 1841, false, 2],
  ]);
});

test("zoom during an edit cancels its settle and the zoom timer refreshes the scope once", async () => {
  const { state, events, edit, zoom, tick } = grade();
  edit();
  await tick(20);
  zoom(2000);
  await tick(199);
  assert.ok(state.zoomScopeTimer);
  assert.deepEqual(events, [["gpu", "refinement", 2000, false, 1]]);
  await tick(5);
  assert.equal(state.zoomScopeTimer, 0);
  assert.deepEqual(events.slice(1), [["sync", 2], ["scope", "settled", 2]]);
});

test("CPU-only editing draws one settled CPU frame", async () => {
  const { events, edit, tick } = grade({ cpu: true });
  edit();
  await tick(160);
  assert.deepEqual(events.filter(([kind]) => kind === "cpu"), [["cpu", 1841, 2]]);
});

test("release with an unchanged value adopts the in-flight exact frame once", async () => {
  const { state, events, edit, tick, finishDrag, dragRequest } = grade({ blockDrag: true });
  state.previewScheduler.beginInteraction();
  edit();
  await tick(120);
  state.previewScheduler.endInteraction();
  await tick(120);
  assert.equal(dragRequest.signal.aborted, false);
  assert.deepEqual(events, [["gpu", "interactive", 1841, false, 1]]);
  finishDrag();
  await new Promise(setImmediate);
  await tick(160);
  assert.deepEqual(events.slice(1), [["sync", 2], ["scope", "settled", 2]]);
});

test("releasing a coarse drag aborts its pending work before settling exact", async () => {
  const { state, events, edit, tick, dragRequest } = grade({ faster: true, blockDrag: true });
  state.previewScheduler.beginInteraction();
  edit();
  await tick(16);
  state.previewScheduler.endInteraction();
  assert.equal(dragRequest.signal.aborted, true);
  await new Promise(setImmediate);
  await tick(1);
  assert.deepEqual(events, [
    ["gpu", "refinement", 921, true, 1], ["sync", 2],
    ["gpu", "refinement", 1841, false, 2], ["scope", "settled", 2],
  ]);
});

test("motion does not abort the coarse fetch, but release does", async () => {
  const { state, events, edit, tick } = grade({ faster: true, coordinated: true });
  state.previewScheduler.beginInteraction();
  edit();
  await tick(16);
  const first = state.renderCoordinator.inFlight("hdr").token;
  for (let input = 0; input < 5; input += 1) {
    await tick(10);
    edit();
  }
  assert.equal(first.signal.aborted, false);
  assert.deepEqual(events, [["gpu", "refinement", 921, true, 1]]);
  await tick(32);
  const next = state.renderCoordinator.inFlight("hdr")?.token;
  assert.ok(next, "newest slider value starts the next live frame");
  assert.notEqual(next, first);
  state.previewScheduler.endInteraction();
  assert.equal(next.signal.aborted, true);
  await new Promise(setImmediate);
  await tick(40);
  assert.deepEqual(events.slice(1), [
    ["sync", 2], ["gpu", "refinement", 1841, false, 2], ["scope", "settled", 2],
  ]);
});

test("release drops a queued coarse draft before its preparation can start", async () => {
  const { state, events, edit, tick, finishPriorRender } = grade({ faster: true, coordinated: true });
  const prior = state.renderCoordinator.submit({ lane: "hdr", reason: "prior-render" });
  state.previewScheduler.beginInteraction();
  edit();
  await tick(16);
  assert.equal(state.renderCoordinator.state("hdr").pending?.reason, "drag-coarse");
  state.previewScheduler.endInteraction();
  finishPriorRender();
  await prior;
  await new Promise(setImmediate);
  await tick(80);
  assert.deepEqual(events, [["sync", 2], ["gpu", "refinement", 1841, false, 2], ["scope", "settled", 2]]);
});

test("a brush settings commit saves without redrawing or refreshing scopes", async () => {
  const { state, events, local, savedBrushRadius, editLocal, tick, commitLocal } = grade();
  editLocal();
  assert.equal(await commitLocal(), true);
  await tick(120);
  const before = events.length;
  assert.ok(events.some(([kind]) => kind === "gpu"));

  local.mask.leaf.brush_radius = 0.04;
  assert.equal(await commitLocal(), true);
  assert.equal(savedBrushRadius(), 0.04);
  assert.equal(state.editRevision, 3);
  await tick(120);
  assert.deepEqual(events.slice(before), []);
});

test("a local commit after a pause settle redraws and measures the saved revision", async () => {
  const { state, events, editLocal, tick, commitLocal } = grade();
  state.previewScheduler.beginInteraction();
  editLocal();
  await tick(120);
  assert.deepEqual(events.filter(([kind, tier]) => kind === "scope" && tier === "settled"), [["scope", "settled", 1]]);
  const generation = state.previewGeneration.hdr;
  state.previewScheduler.endInteraction();
  assert.equal(await commitLocal(), true);
  state.previewScheduler.endInteraction();
  const before = events.length;
  await tick(120);
  assert.deepEqual(events.slice(before), [["gpu", "refinement", 1841, false, 2], ["scope", "settled", 2]]);
  assert.equal(state.previewGeneration.hdr, generation);
});

for (const method of ["fine_grain", "clean_grain"]) {
  test(`release replaces the proxy-scale ${method} drag frame with native-reduced denoise`, async () => {
    const { state, events, edit, tick } = grade({ denoiseMethod: method });
    state.previewScheduler.beginInteraction();
    edit();
    await tick(16);
    assert.equal(state.acceptedPresentation.exact, false);
    state.previewScheduler.endInteraction();
    await tick(110);
    assert.deepEqual(events.filter(([kind]) => kind === "denoise"), [
      ["denoise", "interactive", false, true], ["denoise", "refinement", true, false],
    ]);
    assert.equal(state.acceptedPresentation.exact, true);
  });
}
