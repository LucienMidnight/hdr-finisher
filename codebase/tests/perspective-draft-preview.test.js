const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");

const { declaration: definition } = require("./frontend-source.js");

function contextFor(fetch) {
  const perspectiveStatus = { textContent: "Draft ready." };
  const context = vm.createContext({
    AbortController,
    console: { error: () => {} },
    els: { perspectiveStatus },
    fetch,
    status: { post: () => {}, clear: () => {} },
    renderViewerStatus: () => {},
    localAdjustments: () => [],
    localsBypassed: () => false,
    mediaQueryMatch: () => false,
    perspectiveDraftLongEdge: () => 1024,
    state: {
      adjustments: { shared: { geometry: {} } },
      currentView: "hdr",
      editRevision: 7,
      perspectiveMode: true,
      perspectivePreviewController: null,
      session: { session_id: "session-1" },
    },
  });
  vm.runInContext(definition("setPerspectiveStatus") + definition("renderPerspectiveDraftPreview"), context);
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
