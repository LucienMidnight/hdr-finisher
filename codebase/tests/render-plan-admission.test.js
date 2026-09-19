// Phase 2 exit gate: "Planner decisions are deterministic for recorded resource
// graphs" and "No heuristic memory estimate disables Full."
//
// buildRenderPlan is pure, so the same recorded graph always produces the same
// entries, the same peak, and the same admission decision. These tests pin that
// behavior and the boundary it enforces: admission chooses Direct or Tiled
// execution, and never changes the selected resolution.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../frontend/webgpu-preview.js"),
  "utf8",
);
const context = vm.createContext({
  window: {},
  performance: { now: () => 1 },
  console,
  GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
  GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 },
});
vm.runInContext(source, context);
const Preview = context.window.HDRWebGPUPreview;

const GIB = 1024 * 1024 * 1024;

// Plan objects are built inside the vm realm, so their arrays do not share the
// host Array prototype. Compare contents, not realms.
const rules = (decision) => decision.violations.map((violation) => violation.rule).join("|");
const idsOf = (plan) => plan.entries.map((entry) => entry.id).join("|");

// A recorded 24 MP graph: RGBA16F source, Detail and spatial film active, a
// two-level Denoise configuration, two masks, and a scope pool.
const RECORDED_24MP = Object.freeze({
  width: 6000,
  height: 4000,
  detailActive: true,
  spatialActive: true,
  denoiseLevels: 2,
  cachedProxyLevels: 1,
  maskCount: 1,
  booleanMaskPasses: 1,
  sceneLuminanceEntries: 1,
  scopeBytes: 2_100_000,
  parameterBufferBytes: 8_000,
  limits: { maxTextureDimension2D: 16384 },
});

function planFor(overrides = {}) {
  return Preview.buildRenderPlan({ ...RECORDED_24MP, ...overrides });
}

test("a recorded graph produces an identical plan every time", () => {
  const first = JSON.stringify(planFor({ budget: 8 }));
  const second = JSON.stringify(planFor({ budget: 8 }));
  assert.equal(first, second);
});

test("the plan enumerates resources instead of estimating bytes per pixel", () => {
  const plan = planFor({ budget: 8 });
  const ids = idsOf(plan);

  assert.equal(ids, [
    "source-proxy",
    "grading-core",
    "grading-detail",
    "spatial-film",
    "denoise-evidence",
    "denoise-resolved",
    "denoise-reconstruction-scratch",
    "cpu-mask-leaves",
    "boolean-mask-nodes",
    "scene-luminance",
    "scope-pool",
    "parameter-buffers",
    "retained-presentation-overlap",
    "contingency-margin",
  ].join("|"));

  // Each entry carries its own lifetime, so retained, cached, and transient
  // bytes are never collapsed into one figure.
  const byId = Object.fromEntries(plan.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId["grading-core"].bytes, 24_000_000 * 8 * 4);
  assert.equal(byId["grading-core"].lifetime, "resident");
  assert.equal(byId["source-proxy"].lifetime, "cached");
  assert.equal(byId["denoise-reconstruction-scratch"].lifetime, "transient");
  assert.equal(byId["retained-presentation-overlap"].lifetime, "overlap");
  assert.equal(byId["retained-presentation-overlap"].bytes, 24_000_000 * 8);
});

test("the peak includes retained-frame overlap, transient scratch, and contingency", () => {
  const plan = planFor({ budget: 8, contingencyFraction: 0 });
  const summed = plan.entries.reduce((total, entry) => total + entry.bytes, 0);
  assert.equal(plan.totals.peakLogicalBytes, summed);

  const withMargin = planFor({ budget: 8 });
  assert.ok(withMargin.totals.contingencyBytes > 0);
  assert.equal(
    withMargin.totals.peakLogicalBytes,
    plan.totals.peakLogicalBytes + withMargin.totals.contingencyBytes,
  );

  const withoutRetained = planFor({ budget: 8, retainedPresentation: false });
  assert.equal(withoutRetained.totals.retainedPresentationOverlapBytes, 0);
  assert.ok(withoutRetained.totals.peakLogicalBytes < withMargin.totals.peakLogicalBytes);
});

test("a budget that fits admits Direct, and one that does not falls back to Tiled", () => {
  const generous = planFor({ budget: 8 });
  assert.equal(generous.decision.mode, "direct");
  assert.equal(generous.decision.admitted, true);
  assert.equal(rules(generous.decision), "");

  const tight = planFor({ budget: 1 });
  assert.equal(tight.decision.mode, "tiled");
  assert.equal(tight.decision.admitted, false);
  assert.equal(rules(tight.decision), "budget");
});

test("Auto is a stated 2 GiB application budget, not a measurement", () => {
  assert.equal(Preview.normalizeGpuBudgetBytes("auto"), 2 * GIB);
  assert.equal(Preview.normalizeGpuBudgetBytes(undefined), 2 * GIB);
  assert.equal(Preview.normalizeGpuBudgetBytes(4), 4 * GIB);
  // Out-of-range values fall back to Auto rather than to an arbitrary number.
  assert.equal(Preview.normalizeGpuBudgetBytes(0.1), 2 * GIB);
  assert.equal(Preview.normalizeGpuBudgetBytes(999), 2 * GIB);
  assert.equal(planFor({}).budgetBytes, 2 * GIB);
});

test("a device dimension limit is a violation, reported by name", () => {
  const plan = planFor({ budget: 64, limits: { maxTextureDimension2D: 4096 } });
  assert.equal(plan.decision.mode, "tiled");
  assert.equal(rules(plan.decision), "maxTextureDimension2D");
  assert.match(plan.decision.violations[0].detail, /6000x4000 exceeds the device limit of 4096/);
});

test("a recorded allocation failure forces Tiled without touching the tier", () => {
  const plan = planFor({ budget: 64, tier: "full", allocationBackoff: "grading-base: out of memory" });
  assert.equal(plan.decision.mode, "tiled");
  assert.equal(rules(plan.decision), "allocation-backoff");
  // Admission changes execution strategy, never the selected resolution.
  assert.equal(plan.decision.tier, "full");
});

test("no heuristic disables a tier: an oversized graph is Tiled, never refused", () => {
  // 42 MP at the Auto budget cannot run Direct, which is a statement about
  // execution. The decision has no representation for "unavailable", so no
  // plan can express refusing the resolution.
  const plan = Preview.buildRenderPlan({
    width: 7000,
    height: 6000,
    denoiseLevels: 4,
    tier: "full",
    limits: { maxTextureDimension2D: 16384 },
  });
  assert.equal(plan.decision.mode, "tiled");
  assert.equal(plan.decision.tier, "full");
  assert.ok(["direct", "tiled"].includes(plan.decision.mode));
});

test("the 42 MP and 8K recorded graphs stay deterministic across runs", () => {
  const cases = [
    { id: "42MP", width: 7000, height: 6000 },
    { id: "8K UHD", width: 7680, height: 4320 },
  ];
  for (const entry of cases) {
    const a = Preview.buildRenderPlan({ ...entry, denoiseLevels: 2, limits: { maxTextureDimension2D: 16384 } });
    const b = Preview.buildRenderPlan({ ...entry, denoiseLevels: 2, limits: { maxTextureDimension2D: 16384 } });
    assert.equal(JSON.stringify(a), JSON.stringify(b), `${entry.id} plan was not deterministic`);
    assert.ok(a.totals.peakLogicalBytes > 0);
  }
});

test("the live planner merges renderer state and records the last plan", () => {
  const preview = new Preview(null);
  preview.instrumentationEnabled = true;
  preview.proxies.set("a", { byteSize: 1 });
  preview.proxies.set("b", { byteSize: 1 });
  preview.localMasks.set("m1", { byteSize: 1, kind: "cpu-mask" });
  preview.localMasks.set("m2", { byteSize: 1, kind: "gpu-mask-graph" });
  preview.sceneLuminance.set("s", { byteSize: 1 });
  preview.paramBuffer = { size: 640 };
  preview.curveBuffer = { size: 4096 };
  preview.setMemoryBudget(4);

  const plan = preview.planRender(2048, 2048);
  const byId = Object.fromEntries(plan.entries.map((entry) => [entry.id, entry]));

  assert.equal(plan.budgetBytes, 4 * GIB);
  assert.equal(byId["source-proxy"].levels, 2);
  assert.equal(byId["cpu-mask-leaves"].masks, 1);
  assert.equal(byId["boolean-mask-nodes"].passes, 1);
  assert.equal(byId["scene-luminance"].entries, 1);
  assert.equal(byId["parameter-buffers"].bytes, 640 + 4096);
  assert.equal(preview.lastRenderPlan, plan);
  assert.equal(preview.diagnosticsSnapshot().resources.plan, plan);
  assert.equal(preview.diagnosticsSnapshot().resources.budget.bytes, 4 * GIB);
});

test("an allocation failure is recorded, forces Tiled, and is recoverable", () => {
  const preview = new Preview(null);
  preview.instrumentationEnabled = true;
  preview.device = {
    createTexture() { throw new Error("Out of memory"); },
    createBuffer(descriptor) { return { size: descriptor.size, destroy() {} }; },
  };

  const intermediate = preview.ensureIntermediate({}, 4096, 4096, false, false);
  // The render is abandoned rather than retried at a smaller resolution.
  assert.equal(intermediate, null);
  assert.ok(preview.allocationBackoff);
  assert.equal(preview.allocationBackoff.kind, "grading-base");
  assert.match(preview.allocationBackoff.reason, /Out of memory/);

  const backedOff = preview.planRender(4096, 4096);
  assert.equal(backedOff.decision.mode, "tiled");
  assert.ok(backedOff.decision.violations.some((v) => v.rule === "allocation-backoff"));

  preview.clearAllocationBackoff();
  assert.equal(preview.allocationBackoff, null);
  const recovered = preview.planRender(1024, 1024, { budget: 8 });
  assert.equal(recovered.decision.mode, "direct");
});

test("Denoise levels carry an explicit, enforceable byte cost in the plan", () => {
  const none = planFor({ budget: 64, denoiseLevels: 0 });
  const two = planFor({ budget: 64, denoiseLevels: 2 });
  const four = planFor({ budget: 64, denoiseLevels: 4 });

  assert.equal(none.entries.some((entry) => entry.category === "denoise"), false);
  const denoiseBytes = (plan) => plan.entries
    .filter((entry) => entry.category === "denoise")
    .reduce((total, entry) => total + entry.bytes, 0);

  assert.ok(denoiseBytes(two) > 0);
  assert.ok(denoiseBytes(four) > denoiseBytes(two));

  // The budget can refuse Direct execution on Denoise cost alone, which is
  // what makes the Phase 2 Denoise byte budget enforceable rather than advisory.
  const enforced = planFor({ budget: 1.5, denoiseLevels: 4 });
  assert.equal(enforced.decision.mode, "tiled");
  assert.ok(enforced.decision.violations.some((v) => v.rule === "budget"));
});
