const test = require("node:test");
const assert = require("node:assert/strict");

const { HDRRenderCoordinator } = require("../frontend/render-coordinator.js");

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimer(callback, ms) {
      const id = nextId += 1;
      pending.set(id, { callback, ms });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    fireAll() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, entry] of entries) entry.callback();
    },
    count() {
      return pending.size;
    },
    lastDelay() {
      const entries = [...pending.values()];
      return entries.length ? entries[entries.length - 1].ms : null;
    },
  };
}

function deferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function deferredDispatch() {
  const queue = [];
  let immediate = false;
  return {
    queue,
    impl: () => {
      if (immediate) return { rendered: true, execution: "tiled" };
      const entry = deferred();
      queue.push(entry);
      return entry.promise;
    },
    release() {
      immediate = true;
    },
  };
}

async function flush(times = 4) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

function makeCoordinator(options = {}) {
  const timers = fakeTimers();
  const dispatches = [];
  const presentations = [];
  const refusals = [];
  const coordinator = new HDRRenderCoordinator({
    now: () => 0,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    dispatch: async (request) => {
      dispatches.push(request);
      if (options.dispatchImpl) return options.dispatchImpl(request);
      return { rendered: true, execution: options.execution || "tiled" };
    },
    present: (request, result) => {
      presentations.push({ request, result });
      const record = {
        lane: request.lane,
        generation: request.applicationGeneration,
        geometrySignature: "{}",
        transport: "WebGPU",
        execution: result.execution || "direct",
        exact: true,
        processedLongEdge: request.longEdge,
      };
      coordinator.noteAccepted(record);
      return record;
    },
    canPanRefine: options.canPanRefine || (() => true),
    onRefusal: (refusal) => refusals.push(refusal),
    catchUpDelayMs: options.catchUpDelayMs ?? 700,
    panDelayMs: options.panDelayMs ?? 140,
    roiMode: options.roiMode,
    sessionId: options.sessionId,
  });
  return { coordinator, timers, dispatches, presentations, refusals };
}

test("edit generations gate every token from before them", async () => {
  const dispatch = deferredDispatch();
  const { coordinator, dispatches } = makeCoordinator({ dispatchImpl: dispatch.impl });
  const inFlight = coordinator.submit({ lane: "hdr", reason: "settled" });
  await flush();
  const request = dispatches[0];
  assert.equal(request.token.isCurrent(), true);
  assert.equal(coordinator.generation("hdr", "edit"), 0);

  coordinator.noteEdit("hdr");
  assert.equal(coordinator.generation("hdr", "edit"), 1);
  assert.equal(request.token.isCurrent(), false);
  assert.equal(request.token.cancelled, true);
  assert.equal(request.token.cancelReason, "superseded-by-edit");
  assert.equal(request.token.signal.aborted, true);
  dispatch.queue[0].resolve({ rendered: true });
  await inFlight;

  dispatch.release();
  await coordinator.submit({ lane: "hdr", reason: "settled" });
  assert.equal(dispatches[1].token.isCurrent(), true);
  assert.equal(dispatches[1].applicationGeneration, 1);
});

test("one in-flight render plus one latest pending collapses rapid input", async () => {
  const dispatch = deferredDispatch();
  const { coordinator, dispatches, refusals } = makeCoordinator({ dispatchImpl: dispatch.impl });

  const submitA = coordinator.submit({ lane: "hdr", reason: "a" });
  await flush();
  assert.equal(dispatches.length, 1);

  const submitB = coordinator.submit({ lane: "hdr", reason: "b" });
  await flush();
  assert.equal(dispatches.length, 1, "B must not start while A is in flight");
  assert.equal(dispatches[0].token.cancelled, true);
  assert.equal(dispatches[0].token.cancelReason, "superseded-by-newer-render");

  const submitC = coordinator.submit({ lane: "hdr", reason: "c" });
  await flush();
  assert.equal(dispatches.length, 1, "C collapses onto the pending slot");
  assert.equal(await submitB, false);
  assert.equal(refusals.at(-1).reason, "coalesced-by-newer-render");

  dispatch.queue[0].resolve({ rendered: true, execution: "tiled" });
  await submitA;
  await flush();
  assert.equal(dispatches.length, 2, "the latest pending starts after the in-flight settles");
  assert.equal(dispatches[1].reason, "c");

  dispatch.queue[1].resolve({ rendered: true, execution: "tiled" });
  assert.deepEqual(await submitC, { rendered: true, execution: "tiled" });
});

test("background work never displaces foreground work", async () => {
  const dispatch = deferredDispatch();
  const { coordinator, dispatches, refusals } = makeCoordinator({ dispatchImpl: dispatch.impl });

  const submitForeground = coordinator.submit({ lane: "hdr", reason: "settle", priority: "foreground" });
  await flush();
  assert.equal(dispatches.length, 1);

  // Background work waits behind the in-flight foreground render.
  const backgroundA = coordinator.submit({ lane: "hdr", reason: "preload", priority: "background" });
  await flush();
  assert.equal(dispatches.length, 1, "background must not start while foreground is in flight");
  assert.equal(coordinator.state("hdr").pending.priority, "background");

  // A newer background collapses onto the pending slot.
  const backgroundB = coordinator.submit({ lane: "hdr", reason: "analysis", priority: "background" });
  assert.equal(await backgroundA, false);
  assert.equal(refusals.at(-1).reason, "coalesced-by-newer-render");

  dispatch.queue[0].resolve({ rendered: true });
  await submitForeground;
  await flush();
  assert.equal(dispatches.length, 2, "the pending background runs once the lane is idle");
  assert.equal(dispatches[1].reason, "analysis");

  // A foreground submission supersedes in-flight background work.
  const submitNewer = coordinator.submit({ lane: "hdr", reason: "settle", priority: "foreground" });
  await flush();
  assert.equal(dispatches[1].token.cancelled, true);
  assert.equal(dispatches[1].token.cancelReason, "superseded-by-newer-render");
  assert.equal(coordinator.state("hdr").pending.reason, "settle");

  // Background never displaces a foreground pending.
  const deferredBackground = coordinator.submit({ lane: "hdr", reason: "preload", priority: "background" });
  assert.equal(await deferredBackground, false);
  assert.equal(refusals.at(-1).reason, "background-deferred");

  dispatch.queue[1].resolve({ rendered: true });
  dispatch.release();
  await backgroundB;
  await flush();
  assert.equal(dispatches.length, 3);
  assert.equal(dispatches[2].reason, "settle");
  await submitNewer;
});

test("viewport generation moves only when the visible region changes", () => {
  const { coordinator } = makeCoordinator();
  assert.equal(coordinator.generation("hdr", "viewport"), 0);
  assert.equal(coordinator.noteViewport("hdr", { x: 10, y: 20, width: 100, height: 50 }), true);
  assert.equal(coordinator.generation("hdr", "viewport"), 1);
  assert.equal(coordinator.noteViewport("hdr", { x: 10, y: 20, width: 100, height: 50 }), false);
  assert.equal(coordinator.generation("hdr", "viewport"), 1);
  assert.equal(coordinator.noteViewport("hdr", { x: 11, y: 20, width: 100, height: 50 }), true);
  assert.equal(coordinator.generation("hdr", "viewport"), 2);
  assert.equal(coordinator.noteViewport("hdr", null), true);
  assert.equal(coordinator.generation("hdr", "viewport"), 3);
  assert.equal(coordinator.noteViewport("hdr", { x: 0, y: 0, width: 0, height: 50 }), false);
  assert.equal(coordinator.generation("hdr", "viewport"), 3);
});

test("a request carries a viewport only for a refinement pass that is not a catch-up", async () => {
  const { coordinator, dispatches } = makeCoordinator();
  coordinator.setRoiMode("refinement");
  coordinator.noteViewport("hdr", { x: 5, y: 6, width: 70, height: 80 });

  await coordinator.submit({ lane: "hdr", tier: "refinement", viewport: true, longEdge: 1000, reason: "refine" });
  assert.deepEqual(dispatches[0].viewport, { x: 5, y: 6, width: 70, height: 80 });

  await coordinator.submit({ lane: "hdr", tier: "settled", viewport: true, longEdge: 1000, reason: "settle" });
  assert.equal(dispatches[1].viewport, null, "only the refinement tier may be ROI-limited");

  await coordinator.submit({ lane: "hdr", tier: "refinement", viewport: true, catchUp: true, longEdge: 1000, reason: "catch-up" });
  assert.equal(dispatches[2].viewport, null, "a catch-up is a whole-frame pass");
  assert.equal(dispatches[2].roiCatchUp, true);

  coordinator.setRoiMode("fit");
  await coordinator.submit({ lane: "hdr", tier: "refinement", viewport: true, longEdge: 1000, reason: "refine" });
  assert.equal(dispatches[3].viewport, null, "Fit has nothing to skip");
});

test("presentation acceptance stores the accepted frame and refuses stale results", async () => {
  const dispatch = deferredDispatch();
  const { coordinator, presentations } = makeCoordinator({ dispatchImpl: dispatch.impl });
  const first = coordinator.submit({ lane: "hdr", longEdge: 1000, reason: "settle" });
  await flush();
  dispatch.queue[0].resolve({ rendered: true, execution: "tiled" });
  await first;
  assert.equal(presentations.length, 1);
  assert.equal(coordinator.accepted("hdr").generation, 0);
  assert.equal(coordinator.accepted("hdr").execution, "tiled");

  const second = coordinator.submit({ lane: "hdr", longEdge: 1000, reason: "settle" });
  await flush();
  coordinator.noteEdit("hdr");
  dispatch.queue[1].resolve({ rendered: true, execution: "tiled" });
  await second;
  assert.equal(presentations.length, 1, "a superseded result must not be presented");
});

test("catch-up arms after a viewport pass, fires once, and yields to edits", async () => {
  const { coordinator, timers, dispatches } = makeCoordinator({ sessionId: "s1", roiMode: "refinement" });
  coordinator.noteViewport("hdr", { x: 0, y: 0, width: 100, height: 100 });

  await coordinator.submit({ lane: "hdr", tier: "refinement", viewport: true, longEdge: 1000, reason: "refine" });
  assert.equal(coordinator.catchUpPending("hdr"), true);
  assert.equal(timers.lastDelay(), 700);

  timers.fireAll();
  await flush();
  assert.equal(dispatches.length, 2);
  assert.equal(dispatches[1].reason, "catch-up");
  assert.equal(dispatches[1].roiCatchUp, true);
  assert.equal(dispatches[1].viewport, null);
  assert.equal(coordinator.catchUpPending("hdr"), false);

  await coordinator.submit({ lane: "hdr", tier: "refinement", viewport: true, longEdge: 1000, reason: "refine" });
  assert.equal(coordinator.catchUpPending("hdr"), true);
  coordinator.noteEdit("hdr");
  assert.equal(coordinator.catchUpPending("hdr"), false);
  assert.equal(timers.count(), 0);
});

test("a catch-up armed for an older generation never dispatches", async () => {
  const { coordinator, timers, dispatches } = makeCoordinator({ sessionId: "s1", roiMode: "refinement" });
  coordinator.noteEdit("hdr");
  coordinator.armCatchUp("hdr", { longEdge: 1000, generation: 0 });
  timers.fireAll();
  await flush();
  assert.equal(dispatches.length, 0);
});

test("the pan follow-up waits for busy work, re-arms, and re-arms the catch-up", async () => {
  const dispatch = deferredDispatch();
  const { coordinator, timers, dispatches } = makeCoordinator({
    sessionId: "s1",
    roiMode: "refinement",
    dispatchImpl: dispatch.impl,
  });
  coordinator.noteViewport("hdr", { x: 0, y: 0, width: 100, height: 100 });
  coordinator.noteAccepted({
    lane: "hdr",
    generation: 0,
    transport: "WebGPU",
    execution: "tiled",
    exact: true,
    processedLongEdge: 1000,
    geometrySignature: "{}",
  });
  assert.equal(coordinator.panCandidate("hdr"), true);

  coordinator.notePan("hdr");
  assert.equal(coordinator.panPending("hdr"), true);
  assert.equal(timers.lastDelay(), 140);
  timers.fireAll();
  await flush();
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].panPass, true);
  assert.equal(dispatches[0].viewport?.width, 100);
  dispatch.queue[0].resolve({ rendered: true, execution: "tiled" });
  await flush();
  assert.equal(coordinator.catchUpPending("hdr"), true, "the pan pass re-arms the whole-frame catch-up");

  coordinator.cancelCatchUp("hdr");
  const busySubmit = coordinator.submit({ lane: "hdr", reason: "settle", longEdge: 1000 });
  await flush();
  coordinator.notePan("hdr");
  timers.fireAll();
  await flush();
  assert.equal(coordinator.panPending("hdr"), true, "the follow-up re-arms while the device is busy");
  assert.equal(dispatches.length, 2, "the pan pass did not supersede the busy render");

  dispatch.queue[1].resolve({ rendered: true, execution: "tiled" });
  await busySubmit;
  await flush();
  assert.equal(coordinator.panPending("hdr"), true, "the re-armed follow-up is still waiting on its timer");
  timers.fireAll();
  await flush();
  assert.equal(coordinator.panPending("hdr"), false);
  assert.equal(dispatches.length, 3);
  assert.equal(dispatches[2].panPass, true);
});

test("a pan candidate needs a retained tiled frame at an exact tier and a magnified viewport", () => {
  const { coordinator } = makeCoordinator({ roiMode: "refinement" });
  coordinator.noteViewport("hdr", { x: 0, y: 0, width: 100, height: 100 });
  coordinator.noteAccepted({ lane: "hdr", transport: "WebGPU", execution: "direct", exact: true, processedLongEdge: 1000 });
  assert.equal(coordinator.panCandidate("hdr"), false);
  coordinator.noteAccepted({ lane: "hdr", transport: "WebGPU", execution: "tiled", exact: false, processedLongEdge: 1000 });
  assert.equal(coordinator.panCandidate("hdr"), false);
  coordinator.noteAccepted({ lane: "hdr", transport: "WebGPU", execution: "tiled", exact: true, processedLongEdge: 1000 });
  assert.equal(coordinator.panCandidate("hdr"), true);
  coordinator.setRoiMode("fit");
  assert.equal(coordinator.panCandidate("hdr"), false);
});

test("a source replacement retires tokens, pending work, and retained-frame facts", async () => {
  const dispatch = deferredDispatch();
  const { coordinator, dispatches, refusals } = makeCoordinator({ dispatchImpl: dispatch.impl });
  const submitA = coordinator.submit({ lane: "hdr", reason: "settle" });
  await flush();
  const submitB = coordinator.submit({ lane: "hdr", reason: "settle" });
  await flush();
  coordinator.noteAccepted({ lane: "hdr", transport: "WebGPU", execution: "tiled", exact: true, processedLongEdge: 1000 });

  coordinator.noteSource("s2");
  assert.equal(coordinator.generation("hdr", "source"), 1);
  assert.equal(dispatches[0].token.isCurrent(), false);
  assert.equal(coordinator.accepted("hdr"), null);
  assert.equal(await submitB, false);
  assert.equal(refusals.at(-1).reason, "superseded-by-source");

  dispatch.queue[0].resolve({ rendered: true });
  await submitA;
});

test("scale and lane generations move only on real changes", () => {
  const { coordinator } = makeCoordinator();
  assert.equal(coordinator.noteScale("hdr", { tier: "settled", longEdge: 1600 }), true);
  assert.equal(coordinator.generation("hdr", "scale"), 1);
  assert.equal(coordinator.noteScale("hdr", { tier: "settled", longEdge: 1600 }), false);
  assert.equal(coordinator.generation("hdr", "scale"), 1);
  assert.equal(coordinator.noteScale("hdr", { tier: "refinement", longEdge: 4096 }), true);
  assert.equal(coordinator.generation("hdr", "scale"), 2);

  assert.equal(coordinator.noteActiveLane("hdr"), false);
  assert.equal(coordinator.noteActiveLane("sdr"), true);
  assert.equal(coordinator.generation("sdr", "lane"), 1);
  assert.equal(coordinator.generation("hdr", "lane"), 0);
});

test("timing feedback records dispatch and queue latency", async () => {
  const { coordinator } = makeCoordinator();
  await coordinator.submit({ lane: "hdr", reason: "settle" });
  const snapshot = coordinator.snapshot();
  assert.equal(snapshot.metrics.submits, 1);
  assert.equal(snapshot.metrics.dispatched, 1);
  assert.equal(snapshot.metrics.foregroundDispatches, 1);
  assert.equal(snapshot.metrics.dispatchMs.length, 1);
  assert.equal(snapshot.metrics.queueDelayMs.length, 1);
  assert.equal(snapshot.lanes.hdr.generations.edit, 0);
  assert.equal(snapshot.lanes.hdr.panTimerPending, false);
  assert.equal(snapshot.lanes.hdr.catchUpTimerPending, false);
});
