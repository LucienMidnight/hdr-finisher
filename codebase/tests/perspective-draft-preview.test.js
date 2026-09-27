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

function contextFor(fetch) {
  const perspectiveStatus = { textContent: "Draft ready." };
  const context = vm.createContext({
    AbortController,
    console: { error: () => {} },
    els: { perspectiveStatus },
    fetch,
    localAdjustments: () => [],
    mediaQueryMatch: () => false,
    perspectiveDraftLongEdge: () => 1024,
    state: {
      adjustments: { shared: { geometry: {} } },
      compareWithoutLocals: false,
      currentView: "hdr",
      editRevision: 7,
      perspectiveMode: true,
      perspectivePreviewController: null,
      session: { session_id: "session-1" },
    },
  });
  vm.runInContext(definition("renderPerspectiveDraftPreview"), context);
  return { context, perspectiveStatus };
}

test("perspective draft cancellation leaves the current status alone", async () => {
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
  const { context, perspectiveStatus } = contextFor(async () => { throw aborted; });

  await vm.runInContext("renderPerspectiveDraftPreview()", context);

  assert.equal(perspectiveStatus.textContent, "Draft ready.");
});

test("perspective draft transport failure is visible in its status", async () => {
  const { context, perspectiveStatus } = contextFor(async () => {
    throw new Error("Backend disconnected.");
  });

  await vm.runInContext("renderPerspectiveDraftPreview()", context);

  assert.equal(perspectiveStatus.textContent, "Backend disconnected.");
});
