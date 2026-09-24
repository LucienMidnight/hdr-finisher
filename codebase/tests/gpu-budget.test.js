// Phase 5 item 2: the Auto budget calibration contract. Verified device
// information and a bounded allocation probe may only *lower* the stated
// policy budget; the policy value is the ceiling until failure recovery
// passes (PRD 5.7), and every decision reports its source.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const POLICY = 2 * 1024 * 1024 * 1024;

function loadBudget() {
  const source = fs.readFileSync(path.join(__dirname, "../frontend/gpu-budget.js"), "utf8");
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(source, context);
  return context.window.HDRGpuBudget;
}

function calibrate(overrides = {}) {
  const Budget = loadBudget();
  return Budget.calibrate({ policyBytes: POLICY, ...overrides });
}

test("with nothing verified, Auto is the stated policy and says it is the fallback", () => {
  const result = calibrate();
  assert.equal(result.budgetBytes, POLICY);
  assert.equal(result.ceilingBytes, POLICY);
  assert.equal(result.source, "policy-fallback");
  assert.equal(result.fallback, true);
  assert.equal(result.probe.passed, null);
  assert.ok(result.notes.some((note) => note.includes("no allocation probe")));
});

test("a software adapter lowers Auto and discloses the reason", () => {
  const result = calibrate({
    adapterInfo: { fallback: true, description: "Google SwiftShader", vendor: "google" },
    limits: { maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 16384 },
  });
  assert.equal(result.budgetBytes, 512 * 1024 * 1024);
  assert.equal(result.source, "software-adapter");
  assert.equal(result.fallback, false);
  assert.equal(result.adapter.fallback, true);
  assert.ok(result.notes.some((note) => note.includes("software fallback")));
});

test("device limits below the reference graph lower Auto to 1 GiB", () => {
  const result = calibrate({
    adapterInfo: { fallback: false, description: "Small GPU", vendor: "vendor" },
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 512 * 1024 * 1024 },
  });
  assert.equal(result.budgetBytes, 1024 * 1024 * 1024);
  assert.equal(result.source, "limited-device");
  assert.ok(result.notes.some((note) => note.includes("maxTextureDimension2D=4096")));
});

test("a passing probe validates the candidate without changing it", () => {
  const probes = [];
  const result = calibrate({
    adapterInfo: { fallback: false, description: "Full GPU", vendor: "vendor" },
    limits: { maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 16384 },
    probe: (bytes) => { probes.push(bytes); return true; },
  });
  assert.equal(result.budgetBytes, POLICY);
  assert.equal(result.source, "policy-fallback");
  assert.equal(result.probe.passed, true);
  assert.equal(result.probe.steps.length, 1);
  assert.equal(probes.length, 1);
  assert.ok(probes[0] <= 256 * 1024 * 1024, "the probe stays bounded by the 256 MiB probe limit");
});

test("a failing probe downgrades Auto one step and records the evidence", () => {
  const result = calibrate({
    adapterInfo: { fallback: false, description: "Full GPU", vendor: "vendor" },
    limits: { maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 16384 },
    probe: () => false,
  });
  assert.equal(result.budgetBytes, 1024 * 1024 * 1024);
  assert.equal(result.source, "probe-downgrade");
  assert.equal(result.probe.passed, false);
  assert.equal(result.probe.steps[0].passed, false);
  assert.equal(result.probe.steps[0].bytes, result.probe.requestedBytes);
});

test("a failing probe on an already-low candidate keeps the conservative floor", () => {
  const result = calibrate({
    adapterInfo: { fallback: true, description: "SwiftShader", vendor: "google" },
    limits: { maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 16384 },
    probe: () => false,
  });
  assert.equal(result.budgetBytes, 512 * 1024 * 1024);
  assert.equal(result.source, "probe-floor");
});

test("Auto never exceeds the platform policy the caller set", () => {
  const result = calibrate({
    policyBytes: 512 * 1024 * 1024,
    adapterInfo: { fallback: false, description: "Full GPU", vendor: "vendor" },
    limits: { maxBufferSize: 512 * 1024 * 1024, maxTextureDimension2D: 16384 },
    probe: () => true,
  });
  assert.equal(result.budgetBytes, 512 * 1024 * 1024);
  assert.equal(result.ceilingBytes, 512 * 1024 * 1024);
});

test("without a policy there is no budget to claim", () => {
  const result = calibrate({ policyBytes: 0 });
  assert.equal(result.budgetBytes, 0);
  assert.equal(result.source, "unavailable");
  assert.equal(result.fallback, true);
});
