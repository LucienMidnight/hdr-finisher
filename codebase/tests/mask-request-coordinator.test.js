const assert = require("node:assert/strict");
const test = require("node:test");

const {
  HDRMaskRequestCoordinator,
  HDRMaskTileBatch,
} = require("../frontend/mask-request-coordinator.js");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("mask requests never exceed the configured concurrency", async () => {
  const coordinator = new HDRMaskRequestCoordinator(3);
  let active = 0;
  let maxActive = 0;
  const gates = Array.from({ length: 9 }, () => deferred());
  const run = coordinator.run("generation-1", gates, async (gate, index) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await gate.promise;
    active -= 1;
    return index;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 3);
  for (let index = 0; index < gates.length; index += 1) {
    gates[index].resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const result = await run;

  assert.equal(result.current, true);
  assert.equal(maxActive, 3);
  assert.deepEqual(result.results, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(coordinator.snapshot().maxObserved, 3);
});

test("a newer generation aborts active work and never starts obsolete queued requests", async () => {
  const coordinator = new HDRMaskRequestCoordinator(2);
  const oldStarted = [];
  const oldRun = coordinator.run(
    "old",
    [0, 1, 2, 3, 4, 5],
    (_task, index, signal) => new Promise((resolve, reject) => {
      oldStarted.push(index);
      signal.addEventListener("abort", () => reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ), { once: true });
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(oldStarted, [0, 1]);
  const next = await coordinator.run("new", ["latest"], async (value) => value);
  const old = await oldRun;

  assert.equal(old.current, false);
  assert.deepEqual(oldStarted, [0, 1]);
  assert.equal(next.current, true);
  assert.deepEqual(next.results, ["latest"]);
  assert.equal(coordinator.snapshot().cancelled, 2);
});

function makeTile(x, y, halo = 0, size = 32) {
  return {
    key: `${x},${y}|h${halo}`,
    rect: { x, y, width: size, height: size },
    halo,
  };
}

test("mask batches group tiles by local and respect the tile and byte caps", () => {
  const locals = [{ id: "a" }, { id: "b" }];
  const tiles = Array.from({ length: 5 }, (_value, index) => makeTile(index * 32, 0, 4));
  const batches = HDRMaskTileBatch.plan({ locals, tiles, maxTiles: 2 });

  assert.deepEqual(batches.map((batch) => batch.local.id), ["a", "a", "a", "b", "b", "b"]);
  assert.deepEqual(batches.map((batch) => batch.tiles.length), [2, 2, 1, 2, 2, 1]);
  assert.deepEqual(
    batches.filter((batch) => batch.localIndex === 0).flatMap((batch) => batch.tiles.map((tile) => tile.key)),
    tiles.map((tile) => tile.key),
  );

  const byBytes = HDRMaskTileBatch.plan({
    locals: [locals[0]],
    tiles: Array.from({ length: 4 }, (_value, index) => makeTile(index * 32, 0, 0, 64)),
    maxBytes: 64 * 64 * 2,
  });
  assert.equal(byBytes.length, 2);
  assert.deepEqual(byBytes.map((batch) => batch.tiles.length), [2, 2]);
  assert.ok(byBytes.every((batch) => batch.bytes <= 64 * 64 * 2));
});

test("batches are coordinator slots, not tiles", async () => {
  const coordinator = new HDRMaskRequestCoordinator(2);
  const locals = [{ id: "a" }];
  const tiles = Array.from({ length: 6 }, (_value, index) => makeTile(index * 32, 0));
  const batches = HDRMaskTileBatch.plan({ locals, tiles, maxTiles: 2 });
  let active = 0;
  let maxActive = 0;
  const result = await coordinator.run("batch-generation", batches, async (batch) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return batch.tiles.length;
  });

  assert.equal(result.current, true);
  assert.equal(maxActive, 2);
  assert.deepEqual(result.results, [2, 2, 2]);
  assert.equal(coordinator.snapshot().started, 3);
});

test("the batch container parses its manifest and length-prefixed payloads", () => {
  const payloads = [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([9, 8])];
  const manifest = {
    version: 1,
    long_edge: 256,
    edit_revision: 7,
    entries: [
      { index: 0, status: "ok", tile_width: 2, tile_height: 2, payload_length: 4 },
      { index: 1, status: "ok", tile_width: 1, tile_height: 2, payload_length: 2 },
    ],
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const frames = [];
  for (const payload of payloads) {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, payload.byteLength, true);
    frames.push(header, payload);
  }
  const header = new Uint8Array(16);
  header.set(new TextEncoder().encode("HDRMTB1\n"), 0);
  new DataView(header.buffer).setUint32(8, 2, true);
  new DataView(header.buffer).setUint32(12, manifestBytes.byteLength, true);
  const container = Buffer.concat([header, manifestBytes, ...frames].map(Buffer.from));

  const parsed = HDRMaskTileBatch.parse(container);
  assert.equal(parsed.manifest.edit_revision, 7);
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual([...parsed.entries[0].payload], [1, 2, 3, 4]);
  assert.deepEqual([...parsed.entries[1].payload], [9, 8]);
  assert.equal(parsed.entries[1].tile_width, 1);
});

test("the batch container rejects a bad magic and a truncated payload", () => {
  const manifestBytes = new TextEncoder().encode(JSON.stringify({ entries: [] }));
  const header = new Uint8Array(16);
  header.set(new TextEncoder().encode("NOTBATCH"), 0);
  new DataView(header.buffer).setUint32(12, manifestBytes.byteLength, true);
  assert.throws(
    () => HDRMaskTileBatch.parse(Buffer.concat([header, manifestBytes].map(Buffer.from))),
    /magic/,
  );

  const good = new Uint8Array(16);
  good.set(new TextEncoder().encode("HDRMTB1\n"), 0);
  new DataView(good.buffer).setUint32(8, 1, true);
  new DataView(good.buffer).setUint32(12, manifestBytes.byteLength, true);
  const truncated = Buffer.concat([good, manifestBytes, Buffer.from([4, 0, 0, 0, 1])].map(Buffer.from));
  assert.throws(() => HDRMaskTileBatch.parse(truncated), /truncated/);
});
