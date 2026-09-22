const assert = require("node:assert/strict");
const test = require("node:test");

const { HDRLatestWorkQueue } = require("../frontend/latest-work-queue.js");

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

test("rapid submits collapse to one in-flight run plus the latest pending", async () => {
  const gate = deferred();
  const ran = [];
  const queue = new HDRLatestWorkQueue(async (payload) => {
    ran.push(payload);
    if (ran.length === 1) await gate.promise;
  });

  const first = queue.submit("a");
  assert.equal(queue.busy, true);
  for (const payload of ["b", "c", "d", "e"]) queue.submit(payload);
  assert.deepEqual(ran, ["a"]);
  assert.equal(queue.stats.coalesced, 4);

  gate.resolve();
  await first;
  assert.deepEqual(ran, ["a", "e"]);
  assert.equal(queue.stats.started, 2);
  assert.equal(queue.stats.completed, 2);
  assert.equal(queue.stats.lastPayload, "e");
  assert.equal(queue.busy, false);
});

test("a coalesced caller waits for the chain that applies the latest state", async () => {
  const gate = deferred();
  const order = [];
  const queue = new HDRLatestWorkQueue(async (payload) => {
    order.push(`start:${payload}`);
    if (payload === "first") await gate.promise;
    order.push(`end:${payload}`);
  });

  const first = queue.submit("first");
  const second = queue.submit("latest");
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["start:first", "end:first", "start:latest", "end:latest"]);
});

test("an idle queue starts the next submit immediately", async () => {
  const ran = [];
  const queue = new HDRLatestWorkQueue(async (payload) => { ran.push(payload); });
  await queue.submit("a");
  await queue.submit("b");
  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(queue.stats.started, 2);
  assert.equal(queue.stats.coalesced, 0);
});

test("a failing run is reported and does not strand the chain", async () => {
  const failures = [];
  const ran = [];
  const queue = new HDRLatestWorkQueue(async (payload) => {
    ran.push(payload);
    if (payload === "bad") throw new Error("reconstruction failed");
  }, { onError: (error) => failures.push(error.message) });

  await queue.submit("bad");
  await queue.submit("good");
  assert.deepEqual(ran, ["bad", "good"]);
  assert.deepEqual(failures, ["reconstruction failed"]);
  assert.equal(queue.stats.failed, 1);
  assert.equal(queue.busy, false);
});

test("a submit made while a failing run drains still runs the latest payload", async () => {
  const gate = deferred();
  const ran = [];
  const queue = new HDRLatestWorkQueue(async (payload) => {
    ran.push(payload);
    if (payload === "first") {
      await gate.promise;
      throw new Error("first failed");
    }
  });

  const first = queue.submit("first");
  queue.submit("latest");
  gate.resolve();
  await first;
  assert.deepEqual(ran, ["first", "latest"]);
  assert.equal(queue.stats.failed, 1);
  assert.equal(queue.stats.started, 2);
});
