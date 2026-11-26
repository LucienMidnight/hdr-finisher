const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { HDRMaskTileBatch } = require("../frontend/mask-request-coordinator.js");

const context = vm.createContext({
  console,
  fetch: null,
  performance: { now: () => 10 },
  window: {},
  GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4 },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/source-transport.js"), "utf8"), context);
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

test("a zoom joining cancelled measurement retries its leaf without losing the frame", async () => {
  const target = renderer();
  let releaseBody, fetches = 0, measurementCurrent = true;
  const bodyReady = new Promise(resolve => { releaseBody = resolve; });
  context.fetch = async () => {
    fetches += 1;
    const first = fetches === 1;
    return {
      ok: true,
      headers: { get: name => ({
        "X-Geometry-Signature": "{}", "X-Image-Width": "2", "X-Image-Height": "2",
      }[name] || null) },
      arrayBuffer: async () => {
        if (first) await bodyReady;
        return new Uint8Array([0, 64, 128, 255]).buffer;
      },
    };
  };
  const measurement = request(target, { isCurrent: () => measurementCurrent });
  const zoom = request(target);
  measurementCurrent = false;
  releaseBody();
  assert.equal(await measurement, null);
  assert.equal((await zoom).byteSize, 4);
  assert.equal(fetches, 2);
  assert.equal(target.writes.length, 1);
  assert.equal(target.localMaskInflight.size, 0);
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

  const first = await tileRequest(target, { sourceEpoch: 1 });
  const second = await tileRequest(target, { sourceEpoch: 1, editRevision: 5 });

  assert.equal(first.localIndex, 3);
  assert.equal(first.entries.size, 1);
  assert.equal(second.entries.get("0,0|h0"), first.entries.get("0,0|h0"));
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].tiles.length, 1);
  assert.equal(bodies[0].tiles[0].local_id, "local-1");
  assert.equal(target.writes[0][2].bytesPerRow, 256);
  assert.equal(target.writes[0][1].byteLength, 512);
  const replaced = await tileRequest(target, { sourceEpoch: 2, editRevision: 5 });
  assert.notEqual(replaced.entries.get("0,0|h0"), first.entries.get("0,0|h0"));
  assert.equal(bodies.length, 2);
});

test("shared mask rectangles upload once and cover contained pans and edits", async () => {
  const target = renderer();
  const bodies = [];
  target.maskTileBatch = {
    cover: HDRMaskTileBatch.cover,
    parse: () => ({ entries: [{ status: "ok", tile_x: 1, tile_y: 2, tile_width: 9, tile_height: 4,
      output_width: 40, output_height: 20, payload: new Uint8Array(36) }] }),
  };
  context.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const tile = (key, x, width) => ({ key, rect: { x, y: 2, width, height: 4 },
    haloRect: { x, y: 2, width, height: 4 }, halo: 0 });
  const batch = { localIndex: 3, local: { id: "local-1" }, sharedRegion: true,
    tiles: [tile("first", 1, 6), tile("second", 4, 6)] };
  const first = await tileRequest(target, { batch, sourceEpoch: 1 });
  assert.deepEqual(bodies[0].tiles, [{ local_id: "local-1", x: 1, y: 2, width: 9, height: 4, halo: 0 }]);
  const entry = first.entries.get("first");
  assert.equal(first.entries.get("second"), entry);
  assert.deepEqual(Array.from(entry.frameRect), [1 / 40, 2 / 20, 9 / 40, 4 / 20]);
  const set = target.maskTiles.set.bind(target.maskTiles);
  let touches = 0;
  target.maskTiles.set = (...args) => { touches += 1; return set(...args); };
  const panned = await tileRequest(target, { sourceEpoch: 1, editRevision: 7,
    batch: { ...batch, tiles: [tile("panned", 2, 7), tile("overlap", 3, 7)] } });
  assert.equal(panned.entries.get("panned"), entry);
  assert.equal(panned.entries.get("overlap"), entry);
  assert.equal(touches, 1);
  assert.equal(bodies.length, 1);
  assert.equal(target.writes.length, 1);
});

test("a neutral-geometry capacity refusal backs off rather than looking superseded", async () => {
  const target = renderer();
  let fetches = 0;
  context.fetch = async () => {
    fetches += 1;
    return { ok: false, status: 507, json: async () => ({ detail: "Mask capacity is busy" }) };
  };
  const refused = { status: 507, message: "Mask capacity is busy", retryAfter: 4010 };
  await assert.rejects(tileRequest(target), refused);
  await assert.rejects(tileRequest(target, { batch: { localIndex: 4, local: { id: "sibling" },
    tiles: [{ key: "2,2|h0", rect: { x: 2, y: 2, width: 2, height: 2 }, halo: 0 }] } }), refused);
  assert.equal(fetches, 1);
  context.window.HDRSourceTransport.clearCapacityRefusals(target);
  await assert.rejects(tileRequest(target), refused);
  assert.equal(fetches, 2);
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

test("an unacknowledged leaf is rasterized from the request, not the committed mask", async () => {
  const target = renderer();
  const calls = [];
  context.fetch = async (url, init = {}) => {
    calls.push({ url, init });
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
  const draftExpression = { operator: "leaf", leaf: { type: "path", feather: 0.2, mask_opacity: 1 } };

  const entry = await request(target, { draftExpression });

  assert.ok(entry);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/session/session/local-mask/local-1/preview");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    mask: draftExpression,
    edit_revision: 4,
    long_edge: 2048,
    geometry_signature: "{}",
  });
  assert.equal(target.localMasks.size, 1);
});
