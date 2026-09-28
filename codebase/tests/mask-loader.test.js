const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const context = vm.createContext({
  console,
  fetch: null,
  performance: { now: () => 10 },
  window: {},
  GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4 },
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../frontend/mask-loader.js"), "utf8"),
  context,
);
const { loadCpuMaskLeaf, loadCpuMaskTiles } = context.window.HDRMaskLoader;

function renderer() {
  const writes = [];
  const retained = [];
  return {
    localMasks: new Map(),
    localMaskInflight: new Map(),
    maskTiles: new Map(),
    maskTileBatch: null,
    maskUseSerial: 7,
    instrumentationEnabled: false,
    performanceMetrics: {},
    device: {
      createTexture: (descriptor) => ({ descriptor, destroy() {} }),
      queue: { writeTexture: (...args) => writes.push(args) },
    },
    retainLocalMask: (...args) => retained.push(args),
    writes,
    retained,
  };
}

function tileRequest(target, overrides = {}) {
  return loadCpuMaskTiles(target, {
    sessionId: "session",
    batch: {
      localIndex: 3,
      local: { id: "local-1" },
      tiles: [{ key: "0,0|h0", rect: { x: 0, y: 0, width: 2, height: 2 }, halo: 0 }],
    },
    longEdge: 2048,
    editRevision: 4,
    geometrySignature: "{}",
    maskSignature: "mask-signature",
    isCurrent: () => true,
    signal: new AbortController().signal,
    ...overrides,
  });
}

function request(target, overrides = {}) {
  return loadCpuMaskLeaf(target, {
    sessionId: "session",
    local: { id: "local-1" },
    maskPath: "",
    longEdge: 2048,
    editRevision: 4,
    geometrySignature: "{}",
    maskSignature: "mask-signature",
    isCurrent: () => true,
    signal: new AbortController().signal,
    ...overrides,
  });
}

test("a stale mask response is cancelled without an upload", async () => {
  const target = renderer();
  let cancelled = 0;
  context.fetch = async () => ({
    ok: true,
    headers: { get: (name) => (name === "X-Geometry-Signature" ? "old" : null) },
    body: { cancel: async () => { cancelled += 1; } },
  });

  assert.equal(await request(target), null);
  assert.equal(cancelled, 1);
  assert.equal(target.writes.length, 0);
  assert.equal(target.localMaskInflight.size, 0);
});

test("supersession after the body read publishes no texture", async () => {
  const target = renderer();
  let current = true;
  context.fetch = async () => ({
    ok: true,
    headers: { get: (name) => ({
      "X-Geometry-Signature": "{}",
      "X-Image-Width": "2",
      "X-Image-Height": "2",
    }[name] || null) },
    arrayBuffer: async () => {
      current = false;
      return new Uint8Array([0, 64, 128, 255]).buffer;
    },
  });

  assert.equal(await request(target, { isCurrent: () => current }), null);
  assert.equal(target.writes.length, 0);
  assert.equal(target.localMasks.size, 0);
});

test("the uploaded mask is padded, retained, and reused from cache", async () => {
  const target = renderer();
  let fetches = 0;
  context.fetch = async () => {
    fetches += 1;
    return {
      ok: true,
      headers: { get: (name) => ({
        "X-Geometry-Signature": "{}",
        "X-Image-Width": "2",
        "X-Image-Height": "2",
      }[name] || null) },
      arrayBuffer: async () => new Uint8Array([0, 64, 128, 255]).buffer,
    };
  };

  const first = await request(target);
  const second = await request(target);

  assert.equal(first, second);
  assert.equal(fetches, 1);
  assert.equal(target.writes.length, 1);
  assert.equal(target.writes[0][2].bytesPerRow, 256);
  assert.equal(target.writes[0][1].byteLength, 512);
  assert.equal(target.retained.length, 1);
  assert.equal(first.byteSize, 4);
  assert.equal(first.lastUseSerial, 7);
});

test("a tile batch posts only missing tiles and caches its padded uploads", async () => {
  const target = renderer();
  const bodies = [];
  target.maskTileBatch = {
    parse: () => ({ entries: [{
      status: "ok", tile_width: 2, tile_height: 2,
      payload: new Uint8Array([0, 64, 128, 255]),
    }] }),
  };
  context.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  const first = await tileRequest(target);
  const second = await tileRequest(target);

  assert.equal(first.localIndex, 3);
  assert.equal(first.entries.size, 1);
  assert.equal(second.entries.get("0,0|h0"), first.entries.get("0,0|h0"));
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].tiles.length, 1);
  assert.equal(bodies[0].tiles[0].local_id, "local-1");
  assert.equal(target.writes[0][2].bytesPerRow, 256);
  assert.equal(target.writes[0][1].byteLength, 512);
});

test("a superseded tile batch publishes none of its decoded entries", async () => {
  const target = renderer();
  target.maskTileBatch = {
    parse: () => ({ entries: [{
      status: "ok", tile_width: 2, tile_height: 2,
      payload: new Uint8Array([0, 64, 128, 255]),
    }] }),
  };
  context.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });

  const result = await tileRequest(target, { isCurrent: () => false });

  assert.equal(result.entries.size, 0);
  assert.equal(target.maskTiles.size, 0);
  assert.equal(target.writes.length, 0);
});
