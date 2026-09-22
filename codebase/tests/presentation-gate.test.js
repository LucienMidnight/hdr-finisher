const assert = require("node:assert/strict");
const test = require("node:test");

const { HDRPresentationGate } = require("../frontend/presentation-gate.js");

test("presentations to one canvas never overlap", async () => {
  const gate = new HDRPresentationGate();
  const canvas = { width: 0, height: 0 };
  const first = await gate.acquire(canvas, () => true, () => { canvas.width = 10; });
  assert.equal(canvas.width, 10);
  let secondAcquired = false;
  const second = gate.acquire(canvas, () => true, () => { canvas.width = 20; }).then((held) => {
    secondAcquired = true;
    return held;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondAcquired, false);
  assert.equal(canvas.width, 10);
  first.release();
  const secondHeld = await second;
  assert.equal(secondAcquired, true);
  assert.equal(canvas.width, 20);
  secondHeld.release();
});

test("a superseded generation is refused before it can resize", async () => {
  const gate = new HDRPresentationGate();
  const canvas = { width: 5, height: 5 };
  const held = await gate.acquire(canvas, () => true, () => {});
  assert.ok(held);
  let refusedResized = false;
  const pending = gate.acquire(canvas, () => false, () => { refusedResized = true; });
  await new Promise((resolve) => setImmediate(resolve));
  held.release();
  assert.equal(await pending, null);
  assert.equal(refusedResized, false);
  assert.equal(canvas.width, 5);
});

test("staleness is rechecked after the wait, not at the call", async () => {
  const gate = new HDRPresentationGate();
  const canvas = { width: 1, height: 1 };
  let current = true;
  const held = await gate.acquire(canvas, () => current, () => {});
  const pending = gate.acquire(canvas, () => current, () => { canvas.width = 7; });
  current = false;
  held.release();
  assert.equal(await pending, null);
  assert.equal(canvas.width, 1);
});

test("separate canvases do not block each other", async () => {
  const gate = new HDRPresentationGate();
  const left = { width: 0, height: 0 };
  const right = { width: 0, height: 0 };
  const heldLeft = await gate.acquire(left, () => true, () => { left.width = 3; });
  const heldRight = await gate.acquire(right, () => true, () => { right.width = 4; });
  assert.equal(left.width, 3);
  assert.equal(right.width, 4);
  heldLeft.release();
  heldRight.release();
});

test("release is idempotent and the gate is reusable afterwards", async () => {
  const gate = new HDRPresentationGate();
  const canvas = { width: 0, height: 0 };
  const first = await gate.acquire(canvas, () => true, () => {});
  first.release();
  first.release();
  const second = await gate.acquire(canvas, () => true, () => { canvas.width = 8; });
  assert.equal(canvas.width, 8);
  second.release();
});
