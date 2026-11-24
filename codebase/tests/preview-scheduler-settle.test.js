// P5 (Preview Responsiveness Tuning Sprint): release -> settled is the metric
// that matters. Releasing a control ends the input, so the settled pass
// (which only runs the scopes when the last drag frame was already exact)
// starts as soon as the frame on the GPU is done, not after the 110 ms
// debounce that exists for input that is still arriving.

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

global.window = global;
let animationFrames = [];
global.requestAnimationFrame = (callback) => {
  animationFrames.push(callback);
  return animationFrames.length;
};
global.cancelAnimationFrame = () => {};
let timers = [];
global.window.setTimeout = (callback, delay) => {
  timers.push({ callback, delay, cancelled: false });
  return timers.length;
};
global.window.clearTimeout = (id) => { if (id && timers[id - 1]) timers[id - 1].cancelled = true; };

require("../frontend/preview-scheduler.js");

const flush = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const liveTimers = () => timers.filter((timer) => !timer.cancelled);
// Settle timers are the debounce (110 ms) or an immediate settle (0 ms); the
// harness keeps interactive scope timers near 100 ms so the two never mix.
const settleTimers = () => liveTimers().filter((timer) => timer.delay === 0 || timer.delay === 110);

beforeEach(() => {
  animationFrames = [];
  timers = [];
});

function harness() {
  const events = [];
  const settledGenerations = [];
  let finishFrame = null;
  const scheduler = new global.HDRPreviewScheduler({
    onFrame: () => new Promise((resolve) => {
      events.push("frame-start");
      finishFrame = () => { events.push("frame-end"); resolve(true); };
    }),
    onSettle: async (task) => { events.push("settle"); settledGenerations.push(task.applicationGeneration); },
    onScope: async (task) => { events.push(`scope:${task.tier}`); },
  });
  scheduler.lastScopeStartedAt = performance.now();
  return { scheduler, events, settledGenerations, finish: () => finishFrame?.() };
}

test("release after a completed drag frame settles without the 110 ms wait", async () => {
  const { scheduler, events, finish } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  const frame = animationFrames.shift()(0);
  finish();
  await frame;
  await flush();
  scheduler.endInteraction();
  const settle = settleTimers().at(-1);
  assert.equal(settle.delay, 0, `settle armed with ${settle.delay} ms after release`);
  await settle.callback();
  await flush();
  assert.deepEqual(events.filter((event) => event !== "scope:interactive"),
    ["frame-start", "frame-end", "settle", "scope:settled"]);
});

test("release with a frame on the GPU settles as soon as that frame finishes", async () => {
  const { scheduler, events, finish } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  const frame = animationFrames.shift()(0);
  await Promise.resolve();
  scheduler.endInteraction();
  // A release keeps a timer for queued work, but an in-flight frame must
  // retire before settling.
  assert.ok(settleTimers().every((timer) => timer.delay > 0), "a zero-delay settle was armed over a frame in flight");
  finish();
  await frame;
  await flush();
  const settle = settleTimers().at(-1);
  assert.equal(settle.delay, 0, `settle armed with ${settle.delay} ms after the frame finished`);
  assert.equal(settleTimers().length, 1, "the debounced fallback was not replaced");
  await settle.callback();
  await flush();
  assert.equal(events.filter((event) => event === "settle").length, 1);
});

test("input still arriving keeps the settle debounce", () => {
  const { scheduler } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  assert.deepEqual(settleTimers().map((timer) => timer.delay), [110]);
});

test("release settles the latest value without drawing a coalesced drag frame", async () => {
  const { scheduler, events, settledGenerations, finish } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  const frame = animationFrames.shift()(0);
  scheduler.schedule("hdr", 2);
  scheduler.endInteraction();
  finish();
  await frame;
  assert.equal(animationFrames.length, 0, "no extra drag frame should run after release");
  const settle = settleTimers().at(-1);
  assert.equal(settle.delay, 0);
  await settle.callback();
  assert.deepEqual(events, ["frame-start", "frame-end", "settle", "scope:settled"]);
  assert.deepEqual(settledGenerations, [2]);
});

test("an edit without a gesture keeps the settle debounce", () => {
  const { scheduler } = harness();
  scheduler.schedule("hdr", 1);
  assert.deepEqual(settleTimers().map((timer) => timer.delay), [110]);
});

test("a release superseded by newer input does not settle the old task", async () => {
  const { scheduler, events, finish } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  const frame = animationFrames.shift()(0);
  await Promise.resolve();
  scheduler.endInteraction();
  scheduler.schedule("hdr", 2);
  finish();
  await frame;
  await flush();
  // Only the newer input's own debounce may remain.
  assert.deepEqual(settleTimers().map((timer) => timer.delay), [110]);
});

test("a pause while holding waits for the paced frame, then settles once", async () => {
  const { scheduler, events, finish } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  const frame = animationFrames.shift()(0);
  const debounce = settleTimers().at(-1);
  await debounce.callback();
  assert.deepEqual(events, ["frame-start"]);
  finish();
  await frame;
  const settle = settleTimers().at(-1);
  assert.equal(settle.delay, 0);
  await settle.callback();
  assert.equal(scheduler.interacting, true);
  scheduler.endInteraction();
  scheduler.endInteraction();
  assert.equal(settleTimers().at(-1), settle);
  assert.deepEqual(events, ["frame-start", "frame-end", "settle", "scope:settled"]);
});

test("slow release cannot settle from both the timer and the frame retirement", async () => {
  const { scheduler, events, finish } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  const frame = animationFrames.shift()(0);
  scheduler.endInteraction();
  const releaseTimer = settleTimers().at(-1);
  await releaseTimer.callback();
  assert.deepEqual(events, ["frame-start"]);
  finish();
  await frame;
  await settleTimers().at(-1).callback();
  scheduler.endInteraction();
  assert.deepEqual(events, ["frame-start", "frame-end", "settle", "scope:settled"]);
});

test("a newer input after a pause still draws live", async () => {
  const { scheduler, events, finish } = harness();
  scheduler.beginInteraction();
  scheduler.schedule("hdr", 1);
  const firstFrame = animationFrames.shift()(0);
  await settleTimers().at(-1).callback();
  scheduler.schedule("hdr", 2);
  finish();
  await firstFrame;
  const secondFrame = animationFrames.shift()(20);
  finish();
  await secondFrame;
  assert.deepEqual(events, ["frame-start", "frame-end", "frame-start", "frame-end"]);
  await settleTimers().at(-1).callback();
  assert.deepEqual(events.slice(-2), ["settle", "scope:settled"]);
});

test("the watchdog leaves a settling preview and its scopes alone", async () => {
  const { runInNewContext } = require("node:vm");
  const { declarations } = require("./frontend-source.js");
  const settling = Promise.withResolvers();
  const scopes = Promise.withResolvers();
  const scopeStarted = Promise.withResolvers();
  const scheduler = new global.HDRPreviewScheduler({
    onSettle: () => settling.promise,
    onScope: () => { scopeStarted.resolve(); return scopes.promise; },
  });
  const state = { session: { session_id: "photo" }, currentView: "hdr", previewGeneration: { hdr: 1 },
    previewScheduler: scheduler, previewWatchdogRearms: 0 };
  let watchdog;
  runInNewContext(declarations("installPreviewWatchdog") + "\ninstallPreviewWatchdog()", {
    state, stopPreviewWatchdog() {}, viewerState: () => ({ status: "updating" }),
    geometryDraftActive: () => false, PREVIEW_WATCHDOG_MAX_REARMS: 2, PREVIEW_WATCHDOG_INTERVAL_MS: 1000,
    window: { setInterval: callback => { watchdog = callback; } },
  });
  scheduler.schedule("hdr", 1);
  const settle = settleTimers().at(-1).callback();
  watchdog();
  assert.equal(state.previewWatchdogRearms, 0, "during settle");
  settling.resolve();
  await scopeStarted.promise;
  watchdog();
  assert.equal(state.previewWatchdogRearms, 0, "during scopes");
  scopes.resolve();
  await settle;
  watchdog();
  assert.equal(state.previewWatchdogRearms, 1, "after work has finished");
});
