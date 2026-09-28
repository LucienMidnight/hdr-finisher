const assert = require("node:assert/strict");
const { test } = require("node:test");

global.window = {};
global.GPUMapMode = { READ: 1 };
global.performance = { now: () => 20 };
const { HDRScopeReadback } = require("../frontend/scope-readback.js");

function mappedBuffer(values, { reject = false } = {}) {
  let state = "unmapped";
  let unmapped = 0;
  return {
    get mapState() { return state; },
    async mapAsync() {
      if (reject) throw new Error("map failed");
      state = "mapped";
    },
    getMappedRange: () => values.buffer,
    unmap() { state = "unmapped"; unmapped += 1; },
    get unmapped() { return unmapped; },
  };
}

test("scope analysis unpacks padded half-float rows and releases its resource", async () => {
  const words = new Uint16Array(128);
  words.set([1, 2, 3, 4, 5, 6, 7, 8]);
  const readBuffer = mappedBuffer(words);
  const source = {
    lane: "hdr", serial: 9, applicationGeneration: 4,
    geometrySignature: "{}", sessionId: "session",
  };
  const canvas = {};
  let flushed = 0;
  const renderer = {
    scopeSources: new Map([[canvas, source]]),
    instrumentationEnabled: false,
    activeScopeCount: 1,
    flushDeferredDestroy: () => { flushed += 1; },
  };
  const resource = { readBuffer, bytesPerRow: 256, busy: true };

  const result = await HDRScopeReadback.readAnalysis(renderer, {
    canvas, source, resource, width: 2, height: 1, generation: 6, tier: "settled",
    startedAt: 10, encodedAt: 12, submittedAt: 14, halfToFloat: (value) => value,
  });

  assert.deepEqual(Array.from(result.pixels), [1, 2, 3, 5, 6, 7]);
  assert.deepEqual(Array.from(result.cellPeaks), [4, 8]);
  assert.equal(result.metric.byteLength, 256);
  assert.equal(resource.busy, false);
  assert.equal(renderer.activeScopeCount, 0);
  assert.equal(readBuffer.unmapped, 1);
  assert.equal(flushed, 1);
});

test("a stale scope source publishes nothing but still releases its resource", async () => {
  const readBuffer = mappedBuffer(new Uint16Array(128));
  const canvas = {};
  const source = { lane: "hdr" };
  const renderer = {
    scopeSources: new Map([[canvas, { lane: "sdr" }]]),
    instrumentationEnabled: false,
    activeScopeCount: 1,
    flushDeferredDestroy() {},
  };
  const resource = { readBuffer, bytesPerRow: 256, busy: true };

  const result = await HDRScopeReadback.readAnalysis(renderer, {
    canvas, source, resource, width: 1, height: 1, generation: 1, tier: "interactive",
    startedAt: 0, encodedAt: 0, submittedAt: 0, halfToFloat: (value) => value,
  });

  assert.equal(result, null);
  assert.equal(resource.busy, false);
  assert.equal(renderer.activeScopeCount, 0);
  assert.equal(readBuffer.unmapped, 1);
});

test("peak readback returns the maximum and releases the bounded target", async () => {
  const words = new Uint16Array([3, 0, 0, 0, 9, 0, 0, 0, 4, 0, 0, 0]);
  const readBuffer = mappedBuffer(words);
  const target = { readBuffer, busy: true };

  assert.equal(await HDRScopeReadback.readPeak(target, (value) => value), 9);
  assert.equal(target.busy, false);
  assert.equal(readBuffer.unmapped, 1);
});

test("a failed peak mapping returns null and frees the target", async () => {
  const readBuffer = mappedBuffer(new Uint16Array(0), { reject: true });
  const target = { readBuffer, busy: true };

  assert.equal(await HDRScopeReadback.readPeak(target, (value) => value), null);
  assert.equal(target.busy, false);
  assert.equal(readBuffer.unmapped, 0);
});
