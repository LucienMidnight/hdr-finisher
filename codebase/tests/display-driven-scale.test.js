const assert = require("node:assert/strict");
const vm = require("node:vm");
const test = require("node:test");

const { declarations } = require("./frontend-source.js");
function scaleFor(width, height, geometry = {}, zoomMode = "fit", zoomPercent = 100) {
  const state = { session: { source: { width, height } }, adjustments: { shared: { geometry } },
    previewResolutionOverride: false, zoomMode, zoomPercent, compareLayout: "single" };
  const context = vm.createContext({ state, window: { devicePixelRatio: 1 },
    els: { dropzone: { getBoundingClientRect: () => ({ width: 1200, height: 800 }) } },
    previewTargetLongEdge: () => Math.max(width, height) });
  vm.runInContext(declarations("requiredProcessingLongEdge", "steppedProcessingLongEdge", "displayedLongEdge")
    + "\nglobalThis.edge = requiredProcessingLongEdge();", context);
  return context.edge;
}

test("Fit uses the source scale needed by the displayed aspect and crop", () => {
  assert.equal(scaleFor(2400, 1600), 1200);
  assert.equal(scaleFor(2400, 1600, { crop: { width: 0.5, height: 0.5 } }), 2400);
});

test("a quarter-turn recomputes Fit without undersampling portrait sources", () => {
  assert.equal(scaleFor(1600, 2400, { rotation: 90 }), 1200);
});

test("100% and magnified zoom use native, below 100% uses a fixed step that covers the display", () => {
  assert.equal(scaleFor(2400, 1600, {}, "custom", 50), 1200);
  assert.equal(scaleFor(2400, 1600, {}, "custom", 100), 2400);
  assert.equal(scaleFor(2400, 1600, {}, "custom", 300), 2400);
});

test("arbitrary zoom percentages share a few processing sizes", () => {
  // A wheel zoom lands anywhere; each distinct size used to be a new resized
  // copy of the whole source and a new set of masks.
  const sizes = new Set();
  for (let percent = 12; percent < 100; percent += 0.37) {
    const edge = scaleFor(7968, 5320, {}, "custom", percent);
    assert.ok(edge >= Math.floor(7968 * percent / 100), `${percent}% is covered by ${edge}`);
    assert.ok(edge <= Math.ceil(7968 * percent / 100 * Math.SQRT2) + 1 || edge <= 1409, `${percent}% is not oversampled beyond one step`);
    sizes.add(edge);
  }
  assert.deepEqual([...sizes].sort((a, b) => a - b), [1409, 1992, 2817, 3984, 5634, 7968]);
  assert.equal(scaleFor(7968, 5320, {}, "custom", 98.288), 7968, "near 100% is processed at native, not at a 98% copy");
  assert.equal(scaleFor(7968, 5320, {}, "custom", 78.878), 7968);
  assert.equal(scaleFor(7968, 5320, {}, "custom", 63.3), 5634);
  assert.equal(scaleFor(7968, 5320, {}, "custom", 5), 1409);
});
