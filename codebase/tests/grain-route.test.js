const assert = require("node:assert/strict");
const test = require("node:test");
const { Failures, failureReason } = require("../frontend/grain-route");

const vm = require("node:vm");
const { frontendSource } = require("./frontend-source");
const device = {}, rebuilt = {};
const snapshot = { budget_bytes: 1000, resident_bytes: 850, allocator_bytes: 830, requested_bytes: 100 };

test("budget denial waits until the actual request fits, then grants one retry", () => {
  const failures = new Failures();
  failures.record("photo", "gpu_budget_exceeded", snapshot, device);
  assert.equal(failures.takeRetry("photo", { ...snapshot, resident_bytes: 805 }, device, true), false);
  const recovered = { ...snapshot, allocator_bytes: 780, resident_bytes: 790 };
  assert.equal(failures.takeRetry("photo", recovered, device, true), true);
  failures.record("photo", "gpu_budget_exceeded", snapshot, device);
  assert.equal(failures.takeRetry("photo", recovered, rebuilt, true), false);
  failures.succeeded("photo");
  assert.equal(failures.get("photo"), null);
});

test("temporary source failures expire, sticky failures survive a device rebuild", () => {
  let now = 1000;
  const failures = new Failures({ now: () => now, ttlMs: 300, transportDelayMs: 50 });
  failures.record("size", "source_too_large", snapshot, device);
  failures.record("transport", "transport_timeout", snapshot, device);
  failures.record("lost", "device_lost", snapshot, device);
  assert.equal(failures.takeRetry("transport", snapshot, device, true), false);
  assert.equal(failures.takeRetry("lost", snapshot, rebuilt, false), false);
  assert.equal(failures.takeRetry("lost", snapshot, device, true), false);
  assert.equal(failures.takeRetry("lost", snapshot, rebuilt, true), true);
  now += 50;
  assert.equal(failures.takeRetry("transport", snapshot, device, true), true);
  now += 250;
  assert.equal(failures.get("transport"), null);
  assert.equal(failures.takeRetry("size", snapshot, rebuilt, true), false);
  assert.equal(failures.get("size").reason, "source_too_large");
});

test("cancellations do not latch and validation and source limits are distinct", () => {
  const failures = new Failures();
  assert.equal(failureReason({ name: "AbortError" }, true), "superseded");
  assert.equal(failures.record("photo", "superseded", snapshot, device), null);
  assert.equal(failures.get("photo"), null);
  assert.equal(failureReason(new Error("Fine Grain calibration exceeds the supported source size.")), "source_too_large");
  assert.equal(failureReason(new Error("Micro Grain does not support applied lens correction.")), "unsupported_lens_correction");
  assert.equal(failureReason(new Error("Invalid Fine Grain calibration statistics")), "gpu_validation_error");
  assert.equal(failureReason({ name: "TimeoutError" }), "transport_timeout");
});

test("reclaim drains submitted work, preserves the visible proxy and skips pinned entries", async () => {
  const context = vm.createContext({ window: {}, performance });
  for (const name of ["webgpu-shaders.js", "webgpu-preview.js"]) vm.runInContext(frontendSource(name), context);
  const renderer = new context.window.HDRWebGPUPreview(null);
  const visible = { lane: "hdr", longEdge: 1600, geometrySignature: "{}" };
  renderer.lastPresentedFrame = visible;
  const released = [];
  let drained = false;
  const entries = new Map();
  const proxies = new Map([["visible", visible], ["old", { ...visible, longEdge: 1000 }]]);
  proxies.get = key => {
    const entry = entries.get(key);
    entries.delete(key);
    entries.set(key, entry);
    return Map.prototype.get.call(proxies, key);
  };
  renderer.proxies = proxies;
  for (const [key, kind, pins] of [
    ["pinned", "fine-grain-reduced", 1], ["visible", "source-proxy", 0], ["old", "source-proxy", 0],
  ]) {
    entries.set(key, { key, kind, pins, bytes: 100, evict: () => released.push(key) });
  }
  renderer.gpuAllocator = {
    entries,
    unregister: entry => entries.delete(entry.key),
    usedBytes: () => entries.size * 100,
    reserve: ({ bytes }) => { assert.ok(drained); return bytes; },
  };
  renderer.resourceMemorySnapshot = () => ({ resident: { totalBytes: entries.size * 100, categories: {} } });
  renderer.memoryBudgetBytes = () => 400;
  renderer.waitForSubmittedWork = async () => { drained = true; };
  assert.equal(await renderer.reserveFineGrain("fine-grain-fit", { strip: 120 }, { id: "trace" }), 120);
  assert.deepEqual(released, ["old"]);
  assert.deepEqual([...entries.keys()], ["pinned", "visible"]);
});
