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
  let finishFrame = null;
  const scheduler = new global.HDRPreviewScheduler({
    onFrame: () => new Promise((resolve) => {
      events.push("frame-start");
      finishFrame = () => { events.push("frame-end"); resolve(true); };
    }),
    onSettle: async () => { events.push("settle"); },
    onScope: async (task) => { events.push(`scope:${task.tier}`); },
  });
  scheduler.lastScopeStartedAt = performance.now();
  return { scheduler, events, finish: () => finishFrame?.() };
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
  // Nothing may settle over the top of the frame still in flight except the
  // ordinary debounce, which stays armed as the fallback.
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
