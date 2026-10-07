const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");

const { declaration: definition } = require("./frontend-source.js");

for (const operation of ["refreshScopes()", 'queueEditCommand("undo")']) {
  for (const scenario of ["perspective draft", "rejected sync", "deferred sync"]) {
    test(`${operation} stops retrying with ${scenario}`, async () => {
      let syncCalls = 0;
      const context = vm.createContext({
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
  const context = vm.createContext({
    state: { session: { session_id: "test" }, currentView: "hdr", globalEditDirty: true,
      scopeGeneration: 0, scopeMode: "histogram" },
    syncGlobalEditState: async () => { syncCalls++; context.state.globalEditDirty = false; return true; },
    activeScopeRegion: () => null,
    window: { HDRWholeImagePreviewPipe: { edgeFor: (_purpose, edge) => Math.min(1600, edge) } },
    gpuScopeEligible: () => true,
    enqueueGpuScopeRequest: async () => true,
  });
  vm.runInContext(`${definition("geometryDraftActive")}\n${definition("refreshScopes")}`, context);
  assert.equal(await vm.runInContext("refreshScopes()", context), true);
  assert.equal(syncCalls, 1);
});
