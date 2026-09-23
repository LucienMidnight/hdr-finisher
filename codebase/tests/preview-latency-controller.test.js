const assert = require("node:assert/strict");
const test = require("node:test");
const { HDRPreviewLatencyController } = require("../frontend/preview-latency-controller.js");

test("Precise always starts exact and interaction ends at exact scale", () => {
  const controller = new HDRPreviewLatencyController();
  controller.record({ graph: "heavy", edge: 1000, exactEdge: 1000, visiblePixels: 1e6, elapsedMs: 300 });
  assert.equal(controller.choose({ preference: "precise", graph: "heavy", exactEdge: 1000, visiblePixels: 1e6 }).edge, 1000);
  assert.equal(controller.choose({ preference: "responsive", graph: "heavy", exactEdge: 1000,
    visiblePixels: 1e6, interacting: false }).edge, 1000);
});

test("Responsive uses measured graph timing and holds a scale near a boundary", () => {
  const controller = new HDRPreviewLatencyController();
  const cold = controller.choose({ preference: "responsive", graph: "detail", exactEdge: 2000,
    visiblePixels: 1e6 });
  assert.equal(cold.coarse, true);
  controller.record({ graph: "detail", edge: 1000, exactEdge: 2000, visiblePixels: 1e6, elapsedMs: 30 });
  const first = controller.choose({ preference: "responsive", graph: "detail", exactEdge: 2000,
    visiblePixels: 1e6 });
  assert.equal(first.coarse, true);
  controller.record({ graph: "detail", edge: first.edge, exactEdge: 2000,
    visiblePixels: 1e6, elapsedMs: 31 });
  const second = controller.choose({ preference: "responsive", graph: "detail", exactEdge: 2000,
    visiblePixels: 1e6 });
  assert.equal(second.edge, first.edge);
});

test("Timing evidence stays separate by graph", () => {
  const controller = new HDRPreviewLatencyController();
  controller.record({ graph: "heavy", edge: 2000, exactEdge: 2000, visiblePixels: 1e6, elapsedMs: 400 });
  const heavy = controller.choose({ graph: "heavy", exactEdge: 2000, visiblePixels: 1e6 });
  const light = controller.choose({ graph: "light", exactEdge: 2000, visiblePixels: 1e6 });
  assert.ok(heavy.edge < light.edge);
  assert.equal(light.edge, 2000);
  assert.equal(heavy.coarse, true);
});

test("Balanced starts exact on an unmeasured graph and goes coarse after slow evidence", () => {
  const controller = new HDRPreviewLatencyController();
  assert.equal(controller.choose({ preference: "balanced", graph: "new", exactEdge: 2000,
    visiblePixels: 1e6 }).coarse, false);
  controller.record({ graph: "new", edge: 2000, exactEdge: 2000,
    visiblePixels: 1e6, elapsedMs: 300 });
  assert.equal(controller.choose({ preference: "balanced", graph: "new", exactEdge: 2000,
    visiblePixels: 1e6 }).coarse, true);
});

test("alternating timing near the target does not switch visible scales", () => {
  const controller = new HDRPreviewLatencyController();
  const edges = [];
  for (let index = 0; index < 30; index += 1) {
    controller.record({ graph: "steady", edge: 1000, exactEdge: 2000,
      visiblePixels: 1e6, elapsedMs: index % 2 ? 30 : 36 });
    edges.push(controller.choose({ preference: "responsive", graph: "steady",
      exactEdge: 2000, visiblePixels: 1e6 }).edge);
  }
  assert.deepEqual([...new Set(edges)], [1000]);
});
