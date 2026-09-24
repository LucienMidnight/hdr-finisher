// Phase 3 exit gate: "A 42 MP source can begin Full preparation without an
// image-sized browser response buffer."
//
// The renderer's streamed loader is driven against a fake backend that records
// every request and bounded staging copy, so the suite can assert the peak
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
// The renderer's halo math is the declared processing-scale contract, which the
// page loads as its own script. The harness mirrors that script set.
const graphScaleSource = fs.readFileSync(
  path.join(__dirname, "../frontend/graph-scale.js"),
  "utf8",
);
// Phase 5 item 1: the renderer registers every cache entry with the central
// allocator, so the harness loads that module with the renderer.
const gpuAllocatorSource = fs.readFileSync(
  path.join(__dirname, "../frontend/gpu-allocator.js"),
  "utf8",
);

function loadPreview(fetchImpl) {
  const context = vm.createContext({
    window: {},
    performance: { now: () => Date.now() },
    console,
    fetch: fetchImpl,
    AbortController,
    // The streaming transport races a pending read against a currency tick so a
    // superseded stream cancels its reader; the sandbox supplies the timers
    // that race needs.
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    GPUTextureUsage: {
      COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
    },
    GPUBufferUsage: {
      MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512,
    },
    GPUMapMode: { READ: 1, WRITE: 2 },
  });
  vm.runInContext(graphScaleSource, context);
  vm.runInContext(gpuAllocatorSource, context);
  vm.runInContext(source, context);
  return context.window.HDRWebGPUPreview;
}

function alignRow(bytes) {
  return Math.ceil(bytes / 256) * 256;
}

/** A response body that delivers arbitrary pieces, like a network stream. */
function chunkedBody(buffer, pieceSize) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (offset >= bytes.length) return { done: true, value: undefined };
        const end = Math.min(bytes.length, offset + pieceSize);
        const value = bytes.subarray(offset, end);
        offset = end;
        return { done: false, value };
      },
    }),
  };
}

/** A whole-frame body whose first channel of each row marks its global row. */
function wholeFrameBuffer(width, height, bytesPerRow) {
  const buffer = new ArrayBuffer(bytesPerRow * height);
  const view = new Uint16Array(buffer);
  for (let row = 0; row < height; row += 1) {
    view[(row * bytesPerRow) / 2] = row;
  }
  return buffer;
}

/**
 * A backend that serves a synthetic image through the tile contract. Each
 * pixel's first channel encodes its global row so a misplaced strip is visible.
 */
function createBackend({
  width, height, geometrySignature = "{}", epoch = 3, declineTiles = false, failAt = null,
  declineStream = false, streamPieceBytes = 128 * 1024, truncateStream = false,
}) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const parsed = new URL(url, "http://localhost");
    const bytesPerRow = alignRow(width * 8);
    if (parsed.pathname.includes("/proxy-stream/")) {
      if (declineStream) {
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ detail: "not found" }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      const buffer = wholeFrameBuffer(width, height, bytesPerRow);
      const trimmed = truncateStream ? buffer.slice(0, bytesPerRow * 2) : buffer;
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
        body: chunkedBody(trimmed, streamPieceBytes),
        arrayBuffer: async () => trimmed,
      };
    }
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
      arrayBuffer: async () => wholeFrameBuffer(width, height, bytesPerRow),
    };
  };
  return { fetchImpl, requests };
}

function createDevice() {
  const writes = [];
  const textures = [];
  const buffers = [];
  let drains = 0;
  return {
    writes,
    textures,
    buffers,
    get drains() { return drains; },
    device: {
      limits: { maxTextureDimension2D: 16384 },
      createTexture(descriptor) {
        const entry = { ...descriptor.size, format: descriptor.format, destroyed: false };
        textures.push(entry);
        return { __entry: entry, destroy() { entry.destroyed = true; } };
      },
      createBuffer(descriptor) {
        const data = new ArrayBuffer(descriptor.size);
        const entry = { size: descriptor.size, destroyed: false, mapped: false };
        buffers.push(entry);
        return {
          size: descriptor.size,
          __entry: entry,
          __data: data,
          getMappedRange: () => data,
          mapAsync: async () => { entry.mapped = true; },
          unmap() { entry.mapped = false; },
          destroy() { entry.destroyed = true; },
        };
      },
      createCommandEncoder() {
        return {
          copyBufferToTexture(source, destination, size) {
            writes.push({
              originY: destination.origin?.y ?? 0,
              bytes: source.buffer.__data.byteLength,
              rows: size.height,
              width: size.width,
              bytesPerRow: source.bytesPerRow,
              data: source.buffer.__data,
              buffer: source.buffer,
            });
          },
          finish: () => ({}),
        };
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
        submit() {},
        onSubmittedWorkDone: async () => { drains += 1; },
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

test("staging is a bounded ring: one queue drain per stream, not one per chunk", async () => {
  const { preview, harness } = await streamProxy({ width: 512, height: 512, chunkBytes: 64 * 1024 });

  const metrics = preview.sourceTransportMetrics;
  assert.ok(metrics.chunkCount > 4, "the fixture must need more chunks than the ring holds");
  // The staging bound is the ring, not the chunk count and not the image.
  const distinct = new Set(harness.writes.map((write) => write.buffer));
  assert.equal(distinct.size, 4, "four slots must carry every chunk");
  assert.equal(harness.buffers.length, 4, "no buffer is created beyond the ring");
  // Copies wait only for their own slot, so the stream drains once at the end
  // rather than once per chunk (the pre-Phase-5 behaviour).
  assert.equal(harness.drains, 1, `expected one queue drain, saw ${harness.drains}`);
  // Every staging buffer is released when the stream completes.
  assert.ok(harness.buffers.every((buffer) => buffer.destroyed), "staging must be released");
});

test("the streaming route reads one response through the same bounded ring", async () => {
  const width = 1024;
  const height = 1200;
  const backend = createBackend({ width, height, streamPieceBytes: 100 * 1024 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  preview.maxSourceChunkBytes = 256 * 1024;

  const proxy = await preview.loadProxy("session", "hdr", 8192, "{}", 0, "source");
  assert.ok(proxy);
  const metrics = preview.sourceTransportMetrics;
  assert.equal(metrics.route, "streamed");
  assert.equal(metrics.endpoint, "proxy-stream");
  // One request for the frame, not one request per chunk.
  assert.equal(backend.requests.length, 1);
  assert.ok(backend.requests[0].includes("/proxy-stream/"));
  const wholeBytes = alignRow(width * 8) * height;
  assert.equal(metrics.transferredBytes, wholeBytes);
  assert.ok(metrics.chunkCount > 1);
  // The gate: what the browser buffers is the chunk, never the frame.
  assert.ok(metrics.largestResponseBytes <= preview.maxSourceChunkBytes);
  assert.ok(metrics.largestResponseBytes < wholeBytes / 10);
  assert.equal(typeof metrics.timeToFirstByteMs, "number");
  assert.equal(typeof metrics.timeToFirstTileMs, "number");

  const covered = new Array(height).fill(0);
  let expectedOrigin = 0;
  for (const write of harness.writes) {
    assert.equal(write.originY, expectedOrigin, "stream pieces must be rebased in row order");
    for (let row = write.originY; row < write.originY + write.rows; row += 1) covered[row] += 1;
    expectedOrigin += write.rows;
  }
  assert.equal(expectedOrigin, height);
  assert.ok(covered.every((count) => count === 1), "every row written exactly once");
  assert.equal(new Set(harness.writes.map((write) => write.buffer)).size, 4);
  assert.equal(harness.buffers.length, 4);
  assert.equal(harness.drains, 1);
  assert.ok(harness.buffers.every((buffer) => buffer.destroyed));
  assert.equal(harness.textures.length, 1);
  // Phase 5 item 1: the published proxy is registered centrally, with the
  // bytes the texture was created for.
  const allocator = preview.gpuAllocator.snapshot();
  assert.equal(allocator.byKind["source-proxy"].entries, 1);
  assert.equal(allocator.byKind["source-proxy"].bytes, alignRow(width * 8) * height);
  assert.ok(proxy.allocatorEntry);
});

test("single mode reads the prebuilt whole-frame response the same way", async () => {
  const width = 512;
  const height = 900;
  const backend = createBackend({ width, height });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  preview.sourceTransportMode = "single";
  preview.maxSourceChunkBytes = 128 * 1024;

  const proxy = await preview.loadProxy("session", "hdr", 8192, "{}", 0, "source");
  assert.ok(proxy);
  assert.equal(preview.sourceTransportMetrics.route, "streamed");
  assert.equal(preview.sourceTransportMetrics.endpoint, "proxy");
  assert.ok(backend.requests[0].includes("/proxy/"));
  assert.equal(backend.requests.some((url) => url.includes("/source-tile/")), false);
  assert.equal(preview.sourceTransportMetrics.transferredBytes, alignRow(width * 8) * height);
});

test("a streamed response that ends early is recoverable and publishes nothing", async () => {
  const backend = createBackend({ width: 512, height: 900, truncateStream: true });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;

  await assert.rejects(
    () => preview.loadProxy("session", "hdr", 8192, "{}", 0, "source"),
    (error) => {
      assert.equal(error.recoverable, true);
      assert.match(error.message, /ended before the whole frame/);
      return true;
    },
  );
  assert.equal(preview.proxies.size, 0);
  assert.equal(harness.textures.length, 1);
  assert.equal(harness.textures[0].destroyed, true);
});

test("an unavailable streaming route falls back to per-strip requests", async () => {
  const backend = createBackend({ width: 4096, height: 4096, declineStream: true });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;

  const proxy = await preview.loadProxy("session", "hdr", 4096, "{}", 0, "source");
  assert.ok(proxy);
  assert.equal(preview.sourceTransportMetrics.route, "tiled");
  assert.ok(backend.requests.some((url) => url.includes("/proxy-stream/")));
  assert.ok(backend.requests.some((url) => url.includes("/source-tile/")));
});

test("a superseded streaming read stops early and destroys the partial texture", async () => {
  const base = createBackend({ width: 512, height: 512, streamPieceBytes: 8 * 1024 });
  let current = true;
  let reads = 0;
  const fetchImpl = async (url, init) => {
    const response = await base.fetchImpl(url, init);
    if (!url.includes("/proxy-stream/")) return response;
    const reader = response.body.getReader();
    return {
      ...response,
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            if (reads === 3) current = false;
            return reader.read();
          },
        }),
      },
    };
  };
  const Preview = loadPreview(fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  preview.maxSourceChunkBytes = 64 * 1024;

  await assert.rejects(
    () => preview.loadProxy("session", "hdr", 8192, "{}", 0, "source", { isCurrent: () => current }),
    (error) => {
      assert.equal(error.recoverable, true);
      assert.equal(error.superseded, true);
      return true;
    },
  );

  assert.ok(reads <= 4, `a superseded stream must stop reading, saw ${reads}`);
  assert.equal(preview.proxies.size, 0);
  assert.equal(harness.textures.length, 1);
  assert.equal(harness.textures[0].destroyed, true);
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

test("loadProxy takes the bounded streaming route once the whole frame would exceed the chunk budget", async () => {
  const backend = createBackend({ width: 4096, height: 4096 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;

  const proxy = await preview.loadProxy("session", "hdr", 4096, "{}", 0, "source");
  assert.ok(proxy);
  assert.equal(preview.sourceTransportMetrics.route, "streamed");
  assert.ok(backend.requests.some((url) => url.includes("/proxy-stream/")));
  assert.equal(backend.requests.some((url) => url.includes("/source-tile/")), false);
});

test("strips mode keeps the per-strip request route as the in-field fallback", async () => {
  const backend = createBackend({ width: 4096, height: 4096 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  assert.equal(preview.setSourceTransport("strips"), "strips");

  const proxy = await preview.loadProxy("session", "hdr", 4096, "{}", 0, "source");
  assert.ok(proxy);
  assert.equal(preview.sourceTransportMetrics.route, "tiled");
  assert.ok(backend.requests.some((url) => url.includes("/source-tile/")));
  assert.equal(backend.requests.some((url) => url.includes("/proxy-stream/")), false);
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

test("a superseded source stream stops fetching and destroys the partial texture", async () => {
  const backend = createBackend({ width: 512, height: 512 });
  let current = true;
  let chunkResponses = 0;
  const fetchImpl = async (url, init) => {
    const response = await backend.fetchImpl(url, init);
    if (url.includes("/source-tile/") && !url.includes("width=1&height=1")) {
      chunkResponses += 1;
      if (chunkResponses === 1) current = false;
    }
    return response;
  };
  const Preview = loadPreview(fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  preview.maxSourceChunkBytes = 512 * 8 * 256; // exactly 256 rows per chunk

  await assert.rejects(
    () => preview.loadProxyStreamed("session", "hdr", 512, "{}", 0, "source", "key", {
      isCurrent: () => current,
    }),
    (error) => {
      assert.equal(error.recoverable, true);
      assert.equal(error.superseded, true);
      return true;
    },
  );

  // Probe plus exactly one chunk: the second chunk was never requested.
  const tileRequests = backend.requests.filter((url) => url.includes("/source-tile/"));
  assert.equal(tileRequests.length, 2, "a superseded stream must stop fetching");
  assert.equal(preview.proxies.size, 0);
  assert.equal(harness.textures.length, 1);
  assert.equal(harness.textures[0].destroyed, true, "the partial texture must be destroyed");
});

test("a superseded whole-frame proxy is never uploaded", async () => {
  const backend = createBackend({ width: 256, height: 256 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;

  await assert.rejects(
    () => preview.loadProxy("session", "hdr", 256, "{}", 0, "source", { isCurrent: () => false }),
    (error) => {
      assert.equal(error.recoverable, true);
      assert.equal(error.superseded, true);
      return true;
    },
  );
  assert.equal(harness.textures.length, 0, "no texture is created for a superseded proxy");
  assert.equal(preview.proxies.size, 0);
});

test("replacing the session aborts in-flight source transport", () => {
  const backend = createBackend({ width: 64, height: 64 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  preview.device = createDevice().device;

  const signal = preview.sourceAbortSignal();
  assert.equal(signal.aborted, false);
  preview.resetSession("next-session");
  assert.equal(signal.aborted, true);
  assert.notEqual(preview.sourceAbortSignal(), signal, "a new session gets a fresh signal");
  assert.equal(preview.sourceAbortSignal().aborted, false);
});
