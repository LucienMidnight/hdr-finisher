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
// The renderer's halo math is the declared processing-scale contract, which the
// page loads as its own script. The harness mirrors that script set.
const graphScaleSource = fs.readFileSync(
  path.join(__dirname, "../frontend/graph-scale.js"),
  "utf8",
);
const context = vm.createContext({
  window: {},
  performance: { now: () => 1 },
  console,
  GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
  GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 },
});
vm.runInContext(graphScaleSource, context);
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

test("Tiled sizes the working set to a tile, so peak stops following the image", () => {
  const direct = planFor({ budget: 8, width: 7680, height: 4320 });
  const tiled = direct.tiled;

  assert.equal(tiled.mode, "tiled");
  assert.equal(tiled.tileCount, Math.ceil(7680 / 512) * Math.ceil(4320 / 512));
  assert.ok(tiled.totals.peakLogicalBytes < direct.totals.peakLogicalBytes);

  // The grading working set is one tile, not the whole output.
  const byId = Object.fromEntries(tiled.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId["tile-grading-core"].bytes, 512 * 512 * 8 * 4);
  // Phase 5 retains one packed band image in tile allocations so amount and
  // threshold drags can reuse analysis; only horizontal scratch is tile-sized.
  assert.equal(byId["tile-detail-packed-cache"].bytes, 7680 * 4320 * 8);
  assert.equal(byId["tile-detail-horizontal-scratch"].bytes, 512 * 512 * 8);
  // The source and the presentation surface are deliberately still whole.
  assert.equal(byId["source-proxy"].bytes, 7680 * 4320 * 8);
  assert.equal(byId["presentation-surface"].bytes, 7680 * 4320 * 8);
});

test("a halo grows the working tile but not the whole-image resources", () => {
  const plain = Preview.buildTiledPlan({ width: 4096, height: 4096, tileSize: 512, halo: 0 });
  const haloed = Preview.buildTiledPlan({ width: 4096, height: 4096, tileSize: 512, halo: 16 });

  assert.equal(plain.workWidth, 512);
  assert.equal(haloed.workWidth, 512 + 32);
  assert.equal(plain.tileCount, haloed.tileCount);

  const whole = (plan) => plan.entries.find((entry) => entry.id === "source-proxy").bytes;
  assert.equal(whole(plain), whole(haloed));
  assert.ok(haloed.totals.peakLogicalBytes > plain.totals.peakLogicalBytes);
});

test("Detail band identity reuses amount and threshold but invalidates radius and upstream input", () => {
  const params = new Float32Array(166);
  params[149] = 0.25;
  params[150] = -0.4;
  params[151] = 0.75;
  params[152] = 0.8;
  params[153] = 1.2;
  params[154] = 0.1;
  params[155] = 1;
  const baseline = Preview.detailBandIdentity(params, "upstream-a");
  const liveDrag = new Float32Array(params);
  liveDrag[149] = -0.9;
  liveDrag[150] = 0.7;
  liveDrag[152] = 1.6;
  liveDrag[154] = 0.4;
  assert.equal(Preview.detailBandIdentity(liveDrag, "upstream-a"), baseline);
  liveDrag[151] = 2.5;
  assert.notEqual(Preview.detailBandIdentity(liveDrag, "upstream-a"), baseline);
  assert.notEqual(Preview.detailBandIdentity(params, "upstream-b"), baseline);
});

test("local Detail invalidates downstream bands when an earlier local changes", () => {
  const params = new Float32Array(166);
  params[14] = 0.4;
  params[15] = 0.2;
  params[16] = 0.75;
  params[17] = 0.5;
  params[18] = 0.8;
  params[19] = 0.1;
  const before = Preview.detailBandIdentity(params, "source|local-a:v1", "local");
  const amountDrag = new Float32Array(params);
  amountDrag[14] = -0.8;
  amountDrag[15] = 0.9;
  amountDrag[17] = 1.5;
  amountDrag[19] = 0.3;
  assert.equal(Preview.detailBandIdentity(amountDrag, "source|local-a:v1", "local"), before);
  assert.notEqual(Preview.detailBandIdentity(params, "source|local-a:v2", "local"), before);
});

test("Detail halo covers the maximum separable and coarse-guide reach", () => {
  const params = new Float32Array(166);
  params[151] = 3;
  params[153] = 3;
  params[155] = 1;
  const diagonal = Math.hypot(7680, 4320);
  const halo = Preview.detailTileHalo(7680, 4320, params);
  assert.ok(halo >= Math.ceil(diagonal * 0.03 * 2));
  assert.ok(halo >= Math.ceil(diagonal * 0.0012 * 4));
});

test("24MP, 42MP and 8K all fit the Auto budget under Tiled execution", () => {
  // The Phase 4 exit gate: jobs at these sizes stay within configured budgets.
  const cases = [
    { id: "24MP", width: 6000, height: 4000 },
    { id: "42MP", width: 5320, height: 7968 },
    { id: "8K UHD", width: 7680, height: 4320 },
  ];
  const autoBudget = 2 * GIB;

  for (const entry of cases) {
    const plan = Preview.buildRenderPlan({
      ...entry,
      denoiseLevels: 2,
      detailActive: true,
      spatialActive: true,
      limits: { maxTextureDimension2D: 16384 },
    });
    assert.ok(
      plan.tiled.totals.peakLogicalBytes <= autoBudget,
      `${entry.id} tiled peak ${plan.tiled.totals.peakLogicalBytes} exceeded the Auto budget`,
    );
  }
});

test("Tiled is what rescues a graph Direct cannot fit", () => {
  // 8K with four-level Denoise is over the Auto budget as one graph.
  const plan = Preview.buildRenderPlan({
    width: 7680,
    height: 4320,
    denoiseLevels: 4,
    tier: "full",
    limits: { maxTextureDimension2D: 16384 },
  });
  assert.equal(plan.decision.mode, "tiled");
  assert.ok(plan.totals.peakLogicalBytes > plan.budgetBytes);
  // And the execution that replaces it does fit, so the tier is never at risk.
  assert.ok(plan.tiled.totals.peakLogicalBytes <= plan.budgetBytes);
  assert.equal(plan.decision.tier, "full");
});

// Preview Responsiveness Tuning Sprint P2: resident source proxies are charged
// at their real byte size, not as the current frame's size times the number of
// cached levels, and a region request goes through ordinary admission.
test("resident source proxies are charged at their summed real bytes", () => {
  const preview = new Preview(null);
  const native = 7968 * 5320 * 8;
  const levels = [1024 * 684 * 8, 2048 * 1367 * 8, native];
  levels.forEach((byteSize, index) => preview.proxies.set(`level-${index}`, { byteSize, sessionId: "s" }));
  preview.setMemoryBudget(8);
  const plan = preview.planRender(7968, 5320, { sourceBytesPerPixel: 8 });
  const sourceEntry = plan.entries.find((entry) => entry.id === "source-proxy");
  assert.equal(sourceEntry.bytes, levels.reduce((sum, bytes) => sum + bytes, 0));
  assert.equal(plan.decision.mode, "direct");
  assert.equal(plan.decision.admitted, true);
});

test("a source the render has yet to hold resident is charged at its frame size", () => {
  const preview = new Preview(null);
  preview.proxies.set("region", { byteSize: 1000 });
  preview.setMemoryBudget(8);
  const plan = preview.planRender(4000, 3000, { sourceBytesPerPixel: 8, pendingSourceBytes: 4000 * 3000 * 8 });
  assert.equal(plan.entries.find((entry) => entry.id === "source-proxy").bytes, 1000 + 4000 * 3000 * 8);
});

test("a region request is admitted like any other: Direct when it fits", () => {
  const preview = new Preview(null);
  preview.setMemoryBudget(8);
  const viewport = { x: 3000, y: 2000, width: 969, height: 522 };
  const override = preview.executionOverrideFor({ viewport });
  assert.equal(override, null);
  const plan = preview.planRender(7968, 5320, { sourceBytesPerPixel: 8, executionOverride: override });
  assert.equal(plan.decision.mode, "direct");
  // The diagnostic Execution override still applies to region requests.
  preview.executionOverride = "tiled";
  assert.equal(preview.executionOverrideFor({ viewport }), "tiled");
});

test("stale source levels are evicted before planning, current levels are kept", () => {
  const preview = new Preview(null);
  const put = (key, fields) => preview.proxies.set(key, { identity: key, byteSize: 100, ...fields });
  const current = { sessionId: "s", lane: "hdr", geometrySignature: "{}", sourceIdentity: "src" };
  put("s:hdr:1024:{}:src", { ...current, longEdge: 1024 });
  put("s:hdr:7968:{}:src", { ...current, longEdge: 7968 });
  put("s:sdr:7968:{}:src", { ...current, lane: "sdr", longEdge: 7968 });
  put("old:hdr:7968:{}:src", { ...current, sessionId: "old", longEdge: 7968 });
  put("s:hdr:7968:{\"crop\":1}:src", { ...current, geometrySignature: "{\"crop\":1}", longEdge: 7968 });
  put("s:hdr:7968:{}:src:region:0,0,10,10", { ...current, longEdge: 7968 });
  put("s:hdr:7968:{}:src:region:5,5,10,10", { ...current, longEdge: 7968 });
  const evicted = preview.evictStaleProxies({ ...current, keep: "s:hdr:7968:{}:src:region:5,5,10,10" });
  assert.deepEqual([...preview.proxies.keys()].sort(), [
    "s:hdr:1024:{}:src",
    "s:hdr:7968:{}:src",
    "s:hdr:7968:{}:src:region:5,5,10,10",
    "s:sdr:7968:{}:src",
  ]);
  assert.equal(evicted, 3);
});
