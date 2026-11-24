const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");

const { declaration: definition, declarations } = require("./frontend-source.js");

for (const operation of ["refreshScopes()", 'queueEditCommand("undo")']) {
  for (const scenario of ["perspective draft", "rejected sync", "deferred sync"]) {
    test(`${operation} stops retrying with ${scenario}`, async () => {
      let syncCalls = 0;
      const context = vm.createContext({ document: {hidden:false}, localsBypassed: () => false,
        discardUnusedLocal: () => false,
        state: { session: {}, currentView: "hdr", globalEditDirty: true,
          perspectiveMode: scenario === "perspective draft" },
        // Bound a regression before it can starve the test process or OOM.
        syncGlobalEditState: async () => {
          if (++syncCalls > 10) throw new Error("Unbounded edit-sync retry");
          return scenario !== "rejected sync";
        },
      });
      vm.runInContext(`${definition("geometryDraftActive")}\n${definition("refreshScopes")}\n${definition("queueEditCommand")}`, context);
      assert.equal(await vm.runInContext(operation, context), false);
      assert.ok(syncCalls <= 1, `Retried sync ${syncCalls} times`);
    });
  }
}

test("scope refresh proceeds after one successful sync", async () => {
  let syncCalls = 0;
  const context = vm.createContext({ document: {hidden:false}, localsBypassed: () => false,
    state: { session: { session_id: "test" }, currentView: "hdr", globalEditDirty: true,
      previewGeneration: { hdr: 1 }, scopeGeneration: 0, scopeMode: "histogram" },
    syncGlobalEditState: async () => { syncCalls++; context.state.globalEditDirty = false; return true; },
    activeScopeRegion: () => null,
    geometrySignature: () => "frame",
    microGrainPreviewRequest: () => ({}),
    window: { HDRWholeImagePreviewPipe: { edgeFor: (_purpose, edge) => Math.min(1600, edge) } },
    gpuScopeEligible: () => true,
    enqueueGpuScopeRequest: async () => true,
  });
  vm.runInContext(declarations("geometryDraftActive", "gradeSourceIdentity", "microGrainPreviewKey",
    "scopePresentationIdentity", "refreshScopes", "cancelGpuScopeRequests"), context);
  assert.equal(await vm.runInContext("refreshScopes()", context), true);
  assert.equal(syncCalls, 1);
});


for(const activeWorkflow of ["import","export"]){
  test(`hidden Grade in ${activeWorkflow} schedules no scopes or edit sync`,async()=>{
    const context=vm.createContext({document:{hidden:false},state:{activeWorkflow,session:{},globalEditDirty:true},
      syncGlobalEditState:()=>{throw Error("hidden work started");}});
    vm.runInContext(definition("refreshScopes"),context);
    assert.equal(await vm.runInContext("refreshScopes()",context),false);
  });
}

test("leaving Grade cancels queued and running instruments without clearing the photo",()=>{
  const calls=[];const session={session_id:"retained"};
  const context=vm.createContext({window:{clearTimeout(){}},cancelGeometryUnderlayer:()=>calls.push("underlayer"),state:{session,scopeGeneration:4,
    previewScheduler:{cancel:()=>calls.push("scheduler")},
    scopeRequestInFlight:{controller:{abort:()=>calls.push("scope")}},
    pendingScopeRequest:{resolve:value=>calls.push(value)},
    pendingGpuScopeRequest:{resolve:value=>calls.push(value)},
    overlayAbortController:{abort:()=>calls.push("overlay")},scopeAwaitingPresentation:{} }});
  vm.runInContext(declarations("clearZoomScopeRefresh", "cancelGpuScopeRequests", "suspendGradeInstruments")
    + ";suspendGradeInstruments()", context);
  assert.deepEqual(calls,["underlayer","scheduler","scope",false,false,"overlay"]);
  assert.equal(context.state.scopeGeneration,5);
  assert.equal(context.state.session,session);
  assert.equal(context.state.pendingScopeRequest,null);
  assert.equal(context.state.pendingGpuScopeRequest,null);
});

function pendingGeometryFixture(syncGlobalEditState) {
  const calls = [];
  const state = { session: { session_id: "photo" }, currentView: "hdr", previewGeneration: { hdr: 9 },
    geometryPresentationPending: true, geometryTransformHandoffSignature: null };
  const context = vm.createContext({ state, window: {}, syncGlobalEditState,
    geometrySignature: () => "reset geometry", geometryDraftActive: () => false,
    clearRotateDraftTransformProperties: () => calls.push("rotate"),
    clearInteractiveStraightenPreview: () => calls.push("straighten"),
    applyZoomGeometry: () => calls.push(state.geometryPresentationPending ? "blocked" : "zoom"),
    renderCurrentPreviewSize() {}, renderReadouts() {}, renderViewerStatus() {},
  });
  vm.runInContext(declarations("settlePreviewInner", "settlePreviewFrame", "finishFailedGeometryHandoff",
    "previewStatusText", "markPreviewUnavailable"), context);
  return { state, context, calls };
}

test("a refused Reset with no transform signature unblocks geometry and clears Straighten", () => {
  const { state, context, calls } = pendingGeometryFixture();
  context.markPreviewUnavailable("Source capacity refused the reset");
  assert.equal(state.geometryPresentationPending, false);
  assert.match(state.previewUnavailableReason, /capacity/);
  assert.deepEqual(calls, ["rotate", "straighten", "zoom"]);
});

test("a rejected edit save ends its own pending geometry, but not a newer edit's", async () => {
  let respond;
  const sync = () => new Promise(resolve => { respond = resolve; });
  const { state, context, calls } = pendingGeometryFixture(sync);
  const replaced = context.settlePreviewInner("hdr", { applicationGeneration: 9 });
  state.previewGeneration.hdr++;
  respond(false);
  assert.equal(await replaced, false);
  assert.equal(state.geometryPresentationPending, true);
  assert.deepEqual(calls, []);
  const current = context.settlePreviewInner("hdr", { applicationGeneration: 10 });
  respond(false);
  assert.equal(await current, false);
  assert.equal(state.geometryPresentationPending, false);
  assert.deepEqual(calls, ["rotate", "straighten", "zoom"]);
});

test("a refreshed 409 edit document schedules the acknowledged geometry without saving it again", async () => {
  const calls = [];
  const state = { session: { session_id: "photo" }, currentView: "sdr", adjustments: { rotation: 90 } };
  const document = { global_adjustments: { rotation: 0 } };
  const context = vm.createContext({ state, geometryDraftActive: () => false,
    geometrySignature: () => String(state.adjustments.rotation),
    fetch: async () => ({ ok: true }), safeJson: async () => ({ revision: 3, document }),
    resetRepairSource: async () => {}, recordAcknowledgedLocals() {}, loadDenoiseDocument() {}, renderLocalAdjustments() {},
    invalidatePreview: (lane, { local }) => calls.push([lane, local]), debouncePreview: lane => calls.push(lane),
  });
  vm.runInContext(definition("refreshEditState"), context);
  await context.refreshEditState();
  assert.equal(state.geometryPresentationPending, true);
  assert.deepEqual(calls, [["hdr", true], ["sdr", true], "sdr"]);
});

test("Before and uncached lane peeks cancel the underlayer before starting work", async () => {
  const calls = [];
  const context = vm.createContext({
    state: { session: {}, compareLayout: "single", currentView: "hdr" },
    cancelGeometryUnderlayer: () => calls.push("cancel"),
    renderBeforePreview: async () => { calls.push("before"); return false; },
    cacheReady: () => false,
    prepareInactivePreview: () => calls.push("other lane"),
  });
  vm.runInContext(declarations("beginBeforePeek", "peekOtherLane"), context);
  await context.beginBeforePeek();
  assert.deepEqual(calls, ["cancel", "before"]);
  await context.peekOtherLane();
  assert.deepEqual(calls, ["cancel", "before", "cancel", "other lane"]);
});
