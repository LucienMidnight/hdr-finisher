const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(process.env.HDR_FINISHER_TEST_APP_JS
  || path.join(__dirname, "../frontend/app.js"), "utf8");
function definition(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  const tail = source.slice(start);
  const end = tail.search(/\n(?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end);
}

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
    gpuScopeEligible: () => true,
    enqueueGpuScopeRequest: async () => true,
  });
  vm.runInContext(`${definition("geometryDraftActive")}\n${definition("refreshScopes")}`, context);
  assert.equal(await vm.runInContext("refreshScopes()", context), true);
  assert.equal(syncCalls, 1);
});
