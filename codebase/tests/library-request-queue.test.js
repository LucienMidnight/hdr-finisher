const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../frontend/library-request-queue.js");
const turn = () => new Promise(resolve => setImmediate(resolve));
function latch() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }

test("picture decoding leaves two browser connections available for pixels", async () => {
  const queue = create(), gate = latch();
  let active = 0, peak = 0, started = 0;
  const jobs = Array.from({ length: 30 }, () => queue.submit(async () => {
    started++; peak = Math.max(peak, ++active); await gate.promise; active--;
  }));
  await turn(); assert.equal(started, 4); assert.equal(peak, 4);
  gate.release(); await Promise.all(jobs); assert.equal(started, 30); assert.equal(peak, 4);
});

test("single picture overtakes waiting read-ahead and equal priorities keep order", async () => {
  const queue = create(1), gate = latch(), order = [];
  const first = queue.submit(() => gate.promise);
  const ahead = queue.submit(() => order.push("ahead"), undefined, 50);
  const tile1 = queue.submit(() => order.push("tile1"), undefined, 10);
  const tile2 = queue.submit(() => order.push("tile2"), undefined, 10);
  const single = queue.submit(() => order.push("single"), undefined, 0);
  gate.release(); await Promise.all([first, ahead, tile1, tile2, single]);
  assert.deepEqual(order, ["single", "tile1", "tile2", "ahead"]);
});

test("scrolled-away queued photos cancel immediately without decoding", async () => {
  const queue = create(1), gate = latch(), controller = new AbortController();
  const first = queue.submit(() => gate.promise);
  let ran = false;
  const queued = queue.submit(() => { ran = true; }, controller.signal);
  const rejected = assert.rejects(queued, { name: "AbortError" }); controller.abort();
  await rejected; assert.equal(ran, false);
  const already = queue.submit(() => { ran = true; }, controller.signal);
  await assert.rejects(already, { name: "AbortError" });
  gate.release(); await first; assert.equal(ran, false);
});

test("failed or cancelled active requests free their connection slot", async () => {
  const queue = create(1), controller = new AbortController();
  const first = queue.submit(() => new Promise((resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  }), controller.signal);
  await turn();
  const next = queue.submit(() => { throw new Error("decode failed"); });
  const last = queue.submit(() => "pixels can proceed");
  const failed = assert.rejects(first, { name: "AbortError" });
  const decode = assert.rejects(next, /decode failed/);
  controller.abort(); await failed; await decode; assert.equal(await last, "pixels can proceed");
});
