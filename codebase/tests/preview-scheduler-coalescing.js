const assert = require("node:assert/strict");

global.window = global;
const animationFrames = [];
global.requestAnimationFrame = (callback) => {
  animationFrames.push(callback);
  return animationFrames.length;
};
global.cancelAnimationFrame = () => {};

require("../frontend/preview-scheduler.js");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const frameGate = deferred();
  const scopeGate = deferred();
  const frameCalls = [];
  const scopeCalls = [];
  let framesInFlight = 0;
  let scopesInFlight = 0;
  let maxFramesInFlight = 0;
  let maxScopesInFlight = 0;
  const scheduler = new global.HDRPreviewScheduler({
    onFrame: async (task) => {
      frameCalls.push(task.imageGeneration);
      framesInFlight += 1;
      maxFramesInFlight = Math.max(maxFramesInFlight, framesInFlight);
      if (task.imageGeneration === 1) await frameGate.promise;
      framesInFlight -= 1;
    },
    onScope: async (task) => {
      scopeCalls.push(task.scopeGeneration);
      scopesInFlight += 1;
      maxScopesInFlight = Math.max(maxScopesInFlight, scopesInFlight);
      if (task.scopeGeneration === 1) await scopeGate.promise;
      scopesInFlight -= 1;
    },
  });

  const first = { imageGeneration: 1, scopeGeneration: 1, inputAt: performance.now() };
  const second = { imageGeneration: 2, scopeGeneration: 2, inputAt: performance.now() };
  const latest = { imageGeneration: 3, scopeGeneration: 3, inputAt: performance.now() };

  scheduler.current = first;
  scheduler.requestFrame(first);
  const firstFrame = animationFrames.shift()();
  await Promise.resolve();
  scheduler.current = second;
  scheduler.requestFrame(second);
  scheduler.current = latest;
  scheduler.requestFrame(latest);
  frameGate.resolve();
  await firstFrame;
  await animationFrames.shift()();

  scheduler.current = first;
  const firstScope = scheduler.runScope({ task: first, tier: "interactive" });
  await Promise.resolve();
  scheduler.current = second;
  const skippedScope = scheduler.runScope({ task: second, tier: "interactive" });
  scheduler.current = latest;
  const latestScope = scheduler.runScope({ task: latest, tier: "interactive" });
  assert.equal(await skippedScope, false);
  scopeGate.resolve();
  await firstScope;
  await latestScope;

  assert.deepEqual(frameCalls, [1, 3]);
  assert.deepEqual(scopeCalls, [1, 3]);
  assert.equal(maxFramesInFlight, 1);
  assert.equal(maxScopesInFlight, 1);
  assert.equal(scheduler.snapshot().coalescedFrames, 2);
  assert.equal(scheduler.snapshot().coalescedScopes, 2);

  for (let index = 0; index < 300; index += 1) scheduler.recordMetric("renderMs", index);
  assert.equal(scheduler.snapshot().renderMs.length, 240);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
