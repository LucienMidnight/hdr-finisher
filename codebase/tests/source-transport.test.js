// Phase 3 exit gate: "A 42 MP source can begin Full preparation without an
// image-sized browser response buffer."
//
// The renderer's streamed loader is driven against a fake backend that records
// every request and every writeTexture, so the suite can assert the peak
// response buffer, the assembled coverage, and the stale-source behavior
// without a WebGPU adapter or a live server.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../frontend/webgpu-preview.js"),
  "utf8",
);

function loadPreview(fetchImpl) {
  const context = vm.createContext({
    window: {},
    performance: { now: () => Date.now() },
    console,
    fetch: fetchImpl,
    GPUTextureUsage: {
      COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
    },
    GPUBufferUsage: {
      MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512,
    },
  });
  vm.runInContext(source, context);
  return context.window.HDRWebGPUPreview;
}

function alignRow(bytes) {
  return Math.ceil(bytes / 256) * 256;
}

/**
 * A backend that serves a synthetic image through the tile contract. Each
 * pixel's first channel encodes its global row so a misplaced strip is visible.
 */
function createBackend({ width, height, geometrySignature = "{}", epoch = 3, declineTiles = false, failAt = null }) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname.includes("/source-tile/")) {
      if (declineTiles) {
        return { ok: false, status: 409, headers: new Map(), json: async () => ({ detail: "declined" }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      const y = Number(parsed.searchParams.get("y"));
      const rows = Number(parsed.searchParams.get("height"));
      const tileWidth = Number(parsed.searchParams.get("width"));
      if (failAt !== null && y === failAt) {
        return {
          ok: false,
          status: 409,
          headers: { get: () => null },
          json: async () => ({ detail: "Stale source epoch tile request dropped." }),
        };
      }
      const bytesPerRow = alignRow(tileWidth * 8);
      const buffer = new ArrayBuffer(bytesPerRow * rows);
      const view = new Uint16Array(buffer);
      for (let row = 0; row < rows; row += 1) {
        view[(row * bytesPerRow) / 2] = y + row;
      }
      const headers = new Map([
        ["X-Output-Width", String(width)],
        ["X-Output-Height", String(height)],
        ["X-Pixel-Format", "rgba16float"],
        ["X-Working-Space", "acescg"],
        ["X-Geometry-Signature", geometrySignature],
        ["X-Source-Epoch", String(epoch)],
        ["X-Bytes-Per-Row", String(bytesPerRow)],
      ]);
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => headers.get(name) ?? null },
        arrayBuffer: async () => buffer,
      };
    }
    // The whole-frame fallback.
    const bytesPerRow = alignRow(width * 8);
    const headers = new Map([
      ["X-Image-Width", String(width)],
      ["X-Image-Height", String(height)],
      ["X-Bytes-Per-Row", String(bytesPerRow)],
      ["X-Working-Space", "acescg"],
      ["X-Pixel-Format", "rgba16float"],
      ["X-Geometry-Signature", geometrySignature],
    ]);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => headers.get(name) ?? null },
      arrayBuffer: async () => new ArrayBuffer(bytesPerRow * height),
    };
  };
  return { fetchImpl, requests };
}

function createDevice() {
  const writes = [];
  const textures = [];
  return {
    writes,
    textures,
    device: {
      limits: { maxTextureDimension2D: 16384 },
      createTexture(descriptor) {
        const entry = { ...descriptor.size, format: descriptor.format, destroyed: false };
        textures.push(entry);
        return { __entry: entry, destroy() { entry.destroyed = true; } };
      },
      createBuffer(descriptor) {
        return { size: descriptor.size, destroy() {} };
      },
      queue: {
        writeTexture(destination, data, layout, size) {
          writes.push({
            originY: destination.origin?.y ?? 0,
            bytes: data.byteLength,
            rows: size.height,
            width: size.width,
            bytesPerRow: layout.bytesPerRow,
          });
        },
      },
    },
  };
}

async function streamProxy({ width, height, chunkBytes, ...backendOptions }) {
  const backend = createBackend({ width, height, ...backendOptions });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  if (chunkBytes !== undefined) preview.maxSourceChunkBytes = chunkBytes;
  const proxy = await preview.loadProxyStreamed("session", "hdr", Math.max(width, height), "{}", 0, "source", "key");
  return { preview, proxy, harness, backend };
}

test("a 42 MP source streams in chunks that never reach the whole image size", async () => {
  // 7000 x 6000 at rgba16float is 336 MB as one response.
  const { preview, proxy, harness } = await streamProxy({ width: 7000, height: 6000 });

  assert.ok(proxy);
  assert.equal(proxy.width, 7000);
  assert.equal(proxy.height, 6000);
  assert.equal(proxy.streamed, true);

  const metrics = preview.sourceTransportMetrics;
  assert.equal(metrics.route, "tiled");
  const wholeFrameBytes = alignRow(7000 * 8) * 6000;
  assert.ok(wholeFrameBytes > 300_000_000, "the whole frame really is image-sized");

  // The gate: no single response approaches the image size.
  assert.ok(metrics.largestResponseBytes <= preview.maxSourceChunkBytes);
  assert.ok(metrics.largestResponseBytes < wholeFrameBytes / 20);
  assert.ok(metrics.chunkCount > 1);
  assert.equal(typeof metrics.timeToFirstTileMs, "number");
  assert.ok(metrics.transferredBytes > 0);

  // One texture allocated, filled incrementally.
  assert.equal(harness.textures.length, 1);
  assert.equal(harness.writes.length, metrics.chunkCount);
});

test("streamed chunks cover every row exactly once, in order, with no gap", async () => {
  const width = 640;
  const height = 401; // not a multiple of any chunk size
  const { preview, harness } = await streamProxy({ width, height, chunkBytes: 64 * 1024 });

  const covered = new Array(height).fill(0);
  let expectedOrigin = 0;
  for (const write of harness.writes) {
    assert.equal(write.originY, expectedOrigin, "chunks must be written in row order");
    assert.equal(write.width, width);
    for (let row = write.originY; row < write.originY + write.rows; row += 1) covered[row] += 1;
    expectedOrigin += write.rows;
  }
  assert.equal(expectedOrigin, height, "the chunks must span exactly the image height");
  assert.ok(covered.every((count) => count === 1), "every row written exactly once");

  // The last chunk is partial, which is where an off-by-one would show.
  const last = harness.writes.at(-1);
  assert.ok(last.rows <= preview.sourceTransportMetrics.rowsPerChunk);
  assert.equal(last.originY + last.rows, height);
});

test("each chunk keeps the whole-frame row pitch, so the texture matches", async () => {
  const width = 1024;
  const { harness } = await streamProxy({ width, height: 700, chunkBytes: 256 * 1024 });
  const expectedPitch = alignRow(width * 8);
  for (const write of harness.writes) {
    assert.equal(write.bytesPerRow, expectedPitch);
  }
});

test("a backend that declines the tile route returns null so the caller can fall back", async () => {
  const { proxy, harness } = await streamProxy({ width: 4096, height: 4096, declineTiles: true });
  assert.equal(proxy, null);
  // Nothing was allocated for a route that was never taken.
  assert.equal(harness.textures.length, 0);
});

test("a stale response mid-stream destroys the partial texture and reports recoverable", async () => {
  const backend = createBackend({ width: 512, height: 512, failAt: 256 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  preview.maxSourceChunkBytes = 512 * 8 * 256; // exactly 256 rows per chunk

  await assert.rejects(
    () => preview.loadProxyStreamed("session", "hdr", 512, "{}", 0, "source", "key"),
    (error) => {
      assert.equal(error.recoverable, true);
      assert.equal(error.status, 409);
      return true;
    },
  );

  // The partially filled texture is not retained, and nothing was published.
  assert.equal(preview.proxies.size, 0);
  assert.equal(harness.textures.length, 1);
});

test("a geometry signature that changed under the request is rejected before any upload", async () => {
  const backend = createBackend({ width: 512, height: 512, geometrySignature: '{"rotation":90}' });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;

  await assert.rejects(
    () => preview.loadProxyStreamed("session", "hdr", 512, "{}", 0, "source", "key"),
    (error) => {
      assert.equal(error.recoverable, true);
      assert.match(error.message, /Stale WebGPU geometry tile/);
      return true;
    },
  );
  assert.equal(harness.textures.length, 0);
});

test("every tile request carries the source epoch the probe reported", async () => {
  const { backend } = await streamProxy({ width: 512, height: 512, epoch: 11, chunkBytes: 64 * 1024 });
  const tileRequests = backend.requests.filter((url) => url.includes("/source-tile/"));
  assert.ok(tileRequests.length > 2);
  // The probe has no epoch; every chunk after it pins the one it learned.
  assert.equal(tileRequests[0].includes("source_epoch="), false);
  for (const request of tileRequests.slice(1)) {
    assert.ok(request.includes("source_epoch=11"), `missing epoch in ${request}`);
  }
});

test("loadProxy uses the whole-frame route when the payload is already bounded", async () => {
  const backend = createBackend({ width: 256, height: 256 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;

  const proxy = await preview.loadProxy("session", "hdr", 256, "{}", 0, "source");
  assert.ok(proxy);
  assert.equal(preview.sourceTransportMetrics.route, "whole-frame");
  assert.equal(backend.requests.some((url) => url.includes("/source-tile/")), false);
});

test("loadProxy takes the tile route once the whole frame would exceed the chunk budget", async () => {
  const backend = createBackend({ width: 4096, height: 4096 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;

  const proxy = await preview.loadProxy("session", "hdr", 4096, "{}", 0, "source");
  assert.ok(proxy);
  assert.equal(preview.sourceTransportMetrics.route, "tiled");
  assert.ok(backend.requests.some((url) => url.includes("/source-tile/")));
});

test("a second request for the same proxy is single-flighted, not re-fetched", async () => {
  const backend = createBackend({ width: 4096, height: 4096 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;

  const [first, second] = await Promise.all([
    preview.loadProxy("session", "hdr", 4096, "{}", 0, "source"),
    preview.loadProxy("session", "hdr", 4096, "{}", 0, "source"),
  ]);
  assert.equal(first, second);

  const before = backend.requests.length;
  const cached = await preview.loadProxy("session", "hdr", 4096, "{}", 0, "source");
  assert.equal(cached, first);
  assert.equal(backend.requests.length, before, "a cached proxy must issue no requests");
});
