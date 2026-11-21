const assert = require("node:assert/strict");
const test = require("node:test");
const HDRGrainRoute = require("../frontend/grain-route");
const { Failures, failureReason, describe } = HDRGrainRoute;

const vm = require("node:vm");
const { declarations, frontendSource } = require("./frontend-source");
const device = {}, rebuilt = {};
const snapshot = { budget_bytes: 1000, resident_bytes: 850, allocator_bytes: 830, requested_bytes: 100 };

test("the label and help describe the Grain route that actually produced the preview", () => {
  const route = (frame, extra = {}) => describe({ method: "clean_grain", enabled: true, frame, ...extra });
  assert.equal(route({ route: "gpu" }).label, "GPU");
  assert.equal(route({ route: "gpu", reduced: true }).label, "Reduced preview");
  assert.deepEqual(route(null, { enabled: false }), { label: "Off", message: "Denoise is off." });
  assert.deepEqual(route({ route: "gpu" }, { original: true }), { label: "Original", message: "Showing the original." });
  assert.equal(route(null).label, "Preparing");
  assert.equal(route(null, { unavailable: "Micro Grain needs an ordinary Bayer RAW." }).label, "Paused");
  assert.equal(route(null, { method: "standard" }), null);
  const memory = route({ route: "cpu", reason: "gpu_budget_exceeded" }, { canRetry: true });
  assert.deepEqual(memory, { label: "CPU backup",
    message: "Clean Grain is using the CPU because graphics memory was short. Export is unchanged.", action: "Retry on GPU" });
  const lens = route({ route: "cpu", reason: "unsupported_lens_correction" }, { method: "micro_grain" });
  assert.deepEqual(lens, { label: "CPU backup",
    message: "Micro Grain is using the CPU because lens correction is on. Export is unchanged.", action: "Switch to Clean Grain" });
  const reduced = route({ route: "cpu", reason: "gpu_unavailable", reduced: true, reducedEdge: 4096 });
  assert.equal(reduced.label, "Reduced preview");
  assert.match(reduced.message, /Export is full size/);
  const forced = route({ route: "cpu", reason: "gpu_grain_not_selected" });
  assert.equal(forced.action, null);
  assert.match(forced.message, /GPU Denoise is turned off/);
});

test("CPU activity appears after two seconds and clears when the request completes", async () => {
  let elapsed, finish;
  const state = {
    currentView: "hdr", session: { session_id: "photo" },
    denoise: { hdr: { enabled: true, controls: { method: "clean_grain" } } },
    denoiseRuntime: { hdr: {} },
  };
  const els = { denoiseRoute: {}, denoiseRouteAction: {}, denoiseStatus: {} };
  const context = vm.createContext({ HDRGrainRoute, state, els, geometrySignature: () => "{}",
    window: { setTimeout: (fn, ms) => { assert.equal(ms, 2000); elapsed = fn; }, clearTimeout() {} },
  });
  vm.runInContext(declarations("currentGrainFrame", "renderDenoiseRoute", "trackGrainCpuWork"), context);
  context.renderDenoiseRoute();
  const before = els.denoiseStatus.textContent;
  const work = context.trackGrainCpuWork("hdr", "clean_grain", () => new Promise(resolve => { finish = resolve; }));
  assert.equal(els.denoiseStatus.textContent, before);
  elapsed();
  assert.match(els.denoiseStatus.textContent, /on the CPU/);
  finish();
  await work;
  assert.equal(els.denoiseStatus.textContent, before);
});

test("the offered action checks GPU recovery or selects Clean Grain", async () => {
  const calls = [];
  const state = {
    currentView: "hdr", session: { session_id: "photo" },
    denoise: { hdr: { enabled: true, controls: { method: "micro_grain" } } },
    denoiseRuntime: { hdr: {} }, gpuPreview: { grainFailureCanRun: () => false },
    acceptedPresentation: { lane: "hdr", geometrySignature: "{}", grainRoute: {
      method: "micro_grain", sessionId: "photo", route: "cpu", key: "source", reason: "device_lost",
    } },
  };
  const els = { denoiseRouteAction: { hidden: false, textContent: "Retry on GPU" } };
  const context = vm.createContext({ state, els, geometrySignature: () => "{}", renderDenoiseRoute() {},
    recalculateDenoise: lane => calls.push(lane), commitDenoiseControl: (...args) => calls.push(args),
  });
  vm.runInContext(declarations("currentGrainFrame", "runDenoiseRouteAction"), context);
  await context.runDenoiseRouteAction();
  assert.deepEqual(calls, []);
  assert.match(state.acceptedPresentation.grainRoute.retryNote, /still busy/);
  state.gpuPreview.grainFailureCanRun = () => true;
  await context.runDenoiseRouteAction();
  els.denoiseRouteAction.textContent = "Switch to Clean Grain";
  await context.runDenoiseRouteAction();
  assert.deepEqual(calls, ["hdr", ["method", "clean_grain"]]);
});

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
  const presentation = renderer.presentationTarget = {};
  const events = [];
  renderer.grainEvent = (event, route, reason, context, fields) => events.push({ event, route, reason, action: context?.id, ...fields });
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
  assert.equal(renderer.presentationTarget, presentation);
  assert.equal(events[0].event, "grain_eviction");
  assert.equal(events[0].presentation_kept, true);
  assert.equal(events[0].evicted_bytes_by_kind["source-proxy"], 100);
  assert.equal(events[1].event, "grain_gpu_reserved");
  assert.equal(events[1].reason, "gpu_reservation_granted");
  assert.equal(events[1].action, "trace");
  assert.equal(events[1].snapshot.requested_bytes, 120);
  assert.equal(events[1].snapshot.resident_bytes, 200);
});
