const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Grade gestures send the accepted pause reason and release it after the gesture", async () => {
  const documentEvents = new Map(), windowEvents = new Map(), timers = new Map(), requests = [];
  const context = {
    state: { activeWorkflow: "grade" },
    document: {
      createElement: () => ({ setAttribute() {}, addEventListener() {} }),
      body: { append() {} },
      getElementById: () => ({ addEventListener() {} }),
      addEventListener: (name, handler) => documentEvents.set(name, handler),
    },
    addEventListener: (name, handler) => windowEvents.set(name, handler),
    setInterval() {},
    setTimeout: handler => { const id = Symbol(); timers.set(id, handler); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, "/api/library-worker/pause");
      // These are the backend's public pause reasons. A UI-only name is rejected.
      assert.ok(["grading", "export", "manual"].includes(body.reason));
      requests.push(body);
      return { ok: true };
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/grade-saving.js"), "utf8"), context);
  const control = { target: { closest: () => true } };
  documentEvents.get("pointerdown")(control);
  assert.deepEqual(requests, [{ reason: "grading", paused: true }]);
  windowEvents.get("pointerup")();
  for (const callback of timers.values()) callback();
  await Promise.resolve();
  assert.deepEqual(requests, [{ reason: "grading", paused: true }, { reason: "grading", paused: false }]);
  context.state.activeWorkflow = "library";
  documentEvents.get("pointerdown")(control);
  assert.equal(requests.length, 2);
});
