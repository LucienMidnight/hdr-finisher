// P6 (Preview Responsiveness Tuning Sprint): drag frames are paced at 60 fps
// whatever the display's refresh rate, and an interactive scope never runs
// while a preview frame is in flight.

const assert = require("node:assert/strict");
const { test } = require("node:test");

global.window = global;
let animationFrames = [];
global.requestAnimationFrame = (callback) => {
  animationFrames.push(callback);
  return animationFrames.length;
};
global.cancelAnimationFrame = () => {};
const timers = [];
global.window.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
global.window.clearTimeout = () => {};

require("../frontend/preview-scheduler.js");

async function runDisplay(refreshHz, durationMs, { frameMs = 1 } = {}) {
  animationFrames = [];
  const starts = [];
  const scheduler = new global.HDRPreviewScheduler({
    onFrame: async () => {
      starts.push(clock);
      await new Promise((resolve) => setImmediate(resolve));
    },
  });
  const interval = 1000 / refreshHz;
  let clock = 0;
  // Continuous input: a new task every vsync, as a 1 kHz mouse coalesces to.
  for (clock = 0; clock <= durationMs; clock += interval) {
    const task = { imageGeneration: Math.round(clock), inputAt: clock };
    scheduler.current = task;
    scheduler.requestFrame(task);
    const due = animationFrames;
    animationFrames = [];
    for (const callback of due) await callback(clock);
    for (let settle = 0; settle < 3; settle += 1) await new Promise((resolve) => setImmediate(resolve));
  }
  return { starts, fps: (starts.length * 1000) / durationMs };
}

test("drag frames are capped at 60 fps on a 164 Hz display", async () => {
  const { fps, starts } = await runDisplay(164, 2000);
  assert.ok(fps <= 63, `presented ${fps.toFixed(1)} fps`);
  assert.ok(fps >= 45, `presented only ${fps.toFixed(1)} fps`);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(starts[index] - starts[index - 1] >= 1000 / 60 - 2.5, `frames ${starts[index] - starts[index - 1]} ms apart`);
  }
});

test("a 60 Hz display still gets every frame", async () => {
  const { fps } = await runDisplay(60, 2000);
  assert.ok(fps >= 58, `presented only ${fps.toFixed(1)} fps`);
});

test("an interactive scope waits for the frame in flight", async () => {
  animationFrames = [];
  timers.length = 0;
  const events = [];
  let releaseFrame;
  const scheduler = new global.HDRPreviewScheduler({
    onFrame: () => new Promise((resolve) => { events.push("frame-start"); releaseFrame = () => { events.push("frame-end"); resolve(); }; }),
    onScope: async () => { events.push("scope"); },
  });
  const task = { imageGeneration: 1, scopeGeneration: 1, inputAt: 0 };
  scheduler.current = task;
  scheduler.requestFrame(task);
  const frame = animationFrames.shift()(0);
  await Promise.resolve();
  scheduler.armInteractiveScope(task);
  const scopeTimer = timers.at(-1);
  assert.ok(scopeTimer.delay >= 100 || scopeTimer.delay === 0, `scope delay ${scopeTimer.delay}`);
  await scopeTimer.callback();
  assert.deepEqual(events, ["frame-start"], "the scope must not run while the frame is in flight");
  releaseFrame();
  await frame;
  for (let settle = 0; settle < 3; settle += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["frame-start", "frame-end", "scope"]);
});

test("interactive scopes run at most every 100 ms", () => {
  const scheduler = new global.HDRPreviewScheduler({});
  assert.ok(scheduler.timings.interactiveScopeMs >= 100);
});
