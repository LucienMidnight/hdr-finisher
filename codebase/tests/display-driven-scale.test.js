const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");
function extract(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
function scaleFor(width, height, geometry = {}, zoomMode = "fit", zoomPercent = 100) {
  const state = { session: { source: { width, height } }, adjustments: { shared: { geometry } },
    previewResolutionOverride: false, zoomMode, zoomPercent, compareLayout: "single" };
  const context = vm.createContext({ state, window: { devicePixelRatio: 1 },
    els: { dropzone: { getBoundingClientRect: () => ({ width: 1200, height: 800 }) } },
    previewTargetLongEdge: () => Math.max(width, height) });
  vm.runInContext(extract("function requiredProcessingLongEdge(", "function previewResolutionDimensions(")
    + extract("function displayedLongEdge(", "function residentAuthoringLongEdge(")
    + "globalThis.edge = requiredProcessingLongEdge();", context);
  return context.edge;
}

test("Fit uses the source scale needed by the displayed aspect and crop", () => {
  assert.equal(scaleFor(2400, 1600), 1200);
  assert.equal(scaleFor(2400, 1600, { crop: { width: 0.5, height: 0.5 } }), 2400);
});

test("a quarter-turn recomputes Fit without undersampling portrait sources", () => {
  assert.equal(scaleFor(1600, 2400, { rotation: 90 }), 1200);
});

test("100% and magnified zoom use native, below 100% uses display scale", () => {
  assert.equal(scaleFor(2400, 1600, {}, "custom", 50), 1200);
  assert.equal(scaleFor(2400, 1600, {}, "custom", 100), 2400);
  assert.equal(scaleFor(2400, 1600, {}, "custom", 300), 2400);
});
