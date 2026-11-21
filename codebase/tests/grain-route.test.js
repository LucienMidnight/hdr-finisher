const assert = require("node:assert/strict");
const test = require("node:test");
const HDRGrainRoute = require("../frontend/grain-route");
const { Failures, failureReason, describe, headroom } = HDRGrainRoute;

const vm = require("node:vm");
const { declarations, frontendSource } = require("./frontend-source");
const device = {}, rebuilt = {};
const snapshot = { budget_bytes: 1000, resident_bytes: 850, allocator_bytes: 830, requested_bytes: 100 };

test("the help line appears only when the slower CPU route is used or the method cannot run", () => {
  const route = (frame, extra = {}) => describe({ method: "clean_grain", enabled: true, frame, ...extra });
  assert.deepEqual(route({ route: "gpu" }), { message: "" });
  assert.deepEqual(route({ route: "gpu", reduced: true }), { message: "" });
  assert.deepEqual(route(null, { enabled: false }), { message: "" });
  assert.deepEqual(route({ route: "gpu" }, { original: true }), { message: "" });
  assert.deepEqual(route(null), { message: "" });
  assert.match(route(null, { cpuBusy: true }).message, /on the CPU/);
  assert.match(route({ route: "gpu" }, { cpuBusy: true }).message, /on the CPU/);
  assert.equal(route(null, { unavailable: "Micro Grain needs an ordinary Bayer RAW." }).message,
    "Micro Grain needs an ordinary Bayer RAW.");
  assert.equal(route(null, { method: "standard" }), null);
  const memory = route({ route: "cpu", reason: "gpu_budget_exceeded" }, { canRetry: true });
  assert.deepEqual(memory, { message: "Clean Grain is using the slower CPU because graphics memory was short. "
    + "Export is unchanged.", action: "Retry on GPU" });
  const lens = route({ route: "cpu", reason: "unsupported_lens_correction" }, { method: "micro_grain" });
  assert.deepEqual(lens, { message: "Micro Grain is using the slower CPU because lens correction is on. "
    + "Export is unchanged.", action: "Switch to Clean Grain" });
  const reduced = route({ route: "cpu", reason: "gpu_unavailable", reduced: true, reducedEdge: 4096 });
  assert.match(reduced.message, /Preview limited to 4,096 px\. Export is full size/);
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
  const els = { denoiseRouteAction: {}, denoiseStatus: {} };
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

test("Grade shares the app ceiling and reclaims after the final active scope", async () => {
  const context = vm.createContext({ window: {}, performance, HDRGrainRoute: { headroom } });
  for (const name of ["webgpu-shaders.js", "webgpu-preview.js"]) vm.runInContext(frontendSource(name), context);
  const renderer = new context.window.HDRWebGPUPreview(null);
  let resident = 100;
  renderer.resourceMemorySnapshot = () => ({ resident: { totalBytes: resident, categories: {} } });
  renderer.memoryBudgetBytes = () => 1000;
  const reclaim = renderer.reclaimGrainResources;
  let pressureReclaims = 0;
  renderer.reclaimGrainResources = function (snapshot, action, reservation) {
    if (!reservation) pressureReclaims++;
    return reclaim.call(this, snapshot, action, reservation);
  };
  const sample = { unifiedMemory: true, sampleId: 1, totalBytes: 360, ceilingBytes: 500, reservedBytes: 40 };
  renderer.activeScopeCount = 1;
  renderer.acceptGrainMemorySample({ ...sample, grainReclaim: true });
  assert.equal(pressureReclaims, 0);
  resident += 60;
  assert.equal(headroom(renderer.grainMemorySnapshot()), 40);
  await assert.rejects(renderer.reserveFineGrain("grain", { strip: 41 }), { grainReason: "app_memory_ceiling" });
  renderer.activeScopeCount = 0;
  renderer.flushDeferredDestroy();
  renderer.flushDeferredDestroy();
  assert.equal(pressureReclaims, 1);
  renderer.acceptGrainMemorySample({ ...sample, sampleId: 2, unifiedMemory: false });
  assert.equal(headroom(renderer.grainMemorySnapshot()), 740);
});

test("a live Grain reservation releases an unused source proxy immediately", async () => {
  const context = vm.createContext({ window: {}, performance, HDRGrainRoute: { headroom } });
  for (const name of ["webgpu-shaders.js", "webgpu-preview.js"]) vm.runInContext(frontendSource(name), context);
  const renderer = new context.window.HDRWebGPUPreview(null);
  const destroyed = [];
  for (const [key, longEdge, pins] of [["visible", 1600, 0], ["render", 2000, 1], ["old", 600, 0]]) {
    const proxy = { lane: "hdr", longEdge, texture: { destroy: () => destroyed.push(key) } };
    renderer.proxies.set(key, proxy);
    renderer.gpuAllocator ||= { entries: new Map(), usedBytes() { return this.entries.size * 100; },
      unregister(entry) { this.entries.delete(entry.key); }, reserve: ({ bytes }) => bytes };
    renderer.gpuAllocator.entries.set(key, { key, kind: "source-proxy", pins, bytes: 100, evict() {} });
  }
  renderer.lastPresentedFrame = renderer.proxies.get("visible");
  renderer.resourceMemorySnapshot = () => ({ resident: { totalBytes: renderer.proxies.size * 100, categories: {} } });
  renderer.memoryBudgetBytes = () => 400;
  renderer.waitForSubmittedWork = async () => {};
  renderer.activeRenderCount = 1;
  assert.equal(await renderer.reserveFineGrain("grain", { strip: 120 }), 120);
  assert.deepEqual(destroyed, ["old"]);
  assert.deepEqual([...renderer.proxies.keys()], ["visible", "render"]);
});
