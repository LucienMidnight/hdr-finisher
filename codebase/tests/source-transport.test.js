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
const { frontendSource } = require("./frontend-source.js");

const source = frontendSource("webgpu-preview.js");
const transportSource = fs.readFileSync(
  path.join(__dirname, "../frontend/source-transport.js"),
  "utf8",
);
const shaderSource = frontendSource("webgpu-shaders.js");
// The renderer's halo math is the declared processing-scale contract, which the
// page loads as its own script. The harness mirrors that script set.
const graphScaleSource = frontendSource("graph-scale.js");
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
    AbortSignal,
    DOMException,
    URLSearchParams,
    // The streaming transport races a pending read against a currency tick so a
    // superseded stream cancels its reader; the sandbox supplies the timers
    // that race needs.
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    GPUShaderStage: { COMPUTE: 1 },
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
  vm.runInContext(transportSource, context);
  vm.runInContext(shaderSource, context);
  vm.runInContext(source, context);
  return context.window.HDRWebGPUPreview;
}

test('Grain skips uploads and further reads when a region becomes obsolete during readback', async () => {
  let current = true;
  let reads = 0, uploads = 0, destroyed = 0;
  const Renderer = loadPreview(async () => {
    reads++;
    return { ok: true, arrayBuffer: async () => {
      current = false;
      return new ArrayBuffer(1024 * 1024 * 16);
    } };
  });
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, { denoiseTiles: new Map(), trimDenoiseTiles: () => 0,
    denoiseTileBudget: () => 0, device: { createTexture: () => ({ destroy: () => destroyed++ }),
      queue: { writeTexture: () => uploads++ } } });
  const region = { x: 0, y: 0, width: 2048, height: 1024 };
  await assert.rejects(renderer.preparedGrainTile({ token: 'draw', url: '/grain' }, region, region,
    () => current), { name: 'AbortError' });
  assert.deepEqual({ reads, uploads, destroyed }, { reads: 1, uploads: 0, destroyed: 1 });
});

test('Wide panorama Grain at Fit requests a measurement the API can serve', async () => {
  let measurementEdge;
  const Renderer = loadPreview(async () => ({ ok: true, json: async () => ({ fit: null, token: null }) }));
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, { available: true, sessionId: 'photo', denoiseSelectorGeneration: 0,
    denoiseCounters: { analysisCalls: 0, cacheBuilds: 0 }, recordStage() {},
    denoiseTiles: new Map(), proxies: new Map(), destroyDenoiseSelector() {},
    ensureGrainPipelines: async () => {}, warmDenoiseModel() {}, ensureAdaptiveDenoisePipelines: async () => {},
    createAdaptiveDenoiseScratch: () => ({ byteSize: 0, textureCount: 0 }),
    async fetchDenoiseModel(url) {
      measurementEdge = Number(new URL(url, 'http://local').searchParams.get('long_edge'));
      if (measurementEdge > 16384) throw Error('Measurement request failed (422)');
      return { a: .01, b: 0, c: 0, band_sigmas: Array.from({ length: 3 }, () => [1, 1, 1, 1, 1]) };
    },
  });
  assert.equal(await renderer.analyzeDenoiseProxy('photo', 'hdr', {}, 1600, 0, 'source',
    { method: 'clean_grain', cleanColor: false, grainEvenness: 1 }, 0, 18001), true);
  assert.equal(measurementEdge, 1600);
});

test("Clean Grain blends prepared CPU pixels and falls back when a preparation control changes", async () => {
  const Renderer = loadPreview();
  const renderer = Object.create(Renderer.prototype);
  const controls = {
    amount: 0.75, luminance: 0.5, colorNoise: 0.75, detailRecovery: 0.5,
    finestNoise: 0.5, fineNoise: 0.5, mediumNoise: 0.5, coarseNoise: 0.5,
    method: "clean_grain", grainEvenness: 1, splotchSize: "small",
  };
  const grain = { token: "prepared", controls: { ...controls, microLuminance: 0.5, microColor: 0.5, microDetail: 0.5 } };
  const selector = { cache: { grain } };
  const routes = [];
  Object.assign(renderer, {
    denoiseSourceSelector: selector, denoiseCounters: { resolveDispatches: 0, resolveTiles: 0 },
    ensureAdaptiveDenoisePipelines: async () => {}, preparedGrainTile: async () => ({}),
    encodePreparedDenoise: (...args) => { routes.push(["prepared", args.at(-1)]); return { dispatches: 1, tiles: 1 }; },
    encodeAdaptiveDenoise: () => { routes.push(["wavelet"]); return { dispatches: 1, tiles: 1 }; },
  });
  const draw = sizes => renderer.resolveAdaptiveDenoise(selector, [0.75, 0.5, 0.75, 0.5], sizes, 1, 0,
    null, {}, {}, { width: 96, height: 64 });
  await draw({ ...controls, colorSplotches: 0.3 });
  await draw({ ...controls, splotchSize: "large", colorSplotches: 0.3 });
  assert.deepEqual(routes, [["prepared", 0.3], ["wavelet"]]);
});

test("adaptive Denoise shares device compilation and an old device cannot publish", async () => {
  const Renderer = loadPreview();
  const renderer = Object.create(Renderer.prototype);
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const device = info => ({
    modules: 0, dummies: 0,
    createShaderModule() { this.modules++; return { getCompilationInfo: () => info }; },
    createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
    createComputePipelineAsync: async () => ({}),
    createTexture() { this.dummies++; return {}; },
  });
  const oldDevice = renderer.device = device(held);
  const warm = renderer.ensureAdaptiveDenoisePipelines();
  const draw = renderer.ensureAdaptiveDenoisePipelines();
  const aborted = Promise.all([assert.rejects(warm, { name: "AbortError" }), assert.rejects(draw, { name: "AbortError" })]);
  assert.equal(oldDevice.modules, 1);
  renderer.device = device({ messages: [] });
  renderer.adaptiveDenoiseCompilation = null;
  const fresh = await renderer.ensureAdaptiveDenoisePipelines();
  finish({ messages: [] });
  await aborted;
  assert.equal(renderer.adaptiveDenoisePipelines, fresh);
  assert.equal(oldDevice.dummies, 0);
  assert.equal(renderer.device.dummies, 3);
});

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
              originX: destination.origin?.x ?? 0,
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

test("a changed halo reuses a containing source region without fetching", async () => {
  const Preview = loadPreview(async () => { throw new Error("unexpected source request"); });
  const preview = new Preview(null);
  const identity = "session:sdr:7968:{}:source:region:100,200,2000,3000";
  const resident = { identity, sessionId: "session", lane: "sdr", longEdge: 7968,
    geometrySignature: "{}", sourceIdentity: "source", regionTransport: true,
    region: { x: 100, y: 200, width: 2000, height: 3000 }, byteSize: 48000000 };
  preview.proxies.set(identity, resident);
  const options = { region: { x: 150, y: 250, width: 1800, height: 2800 } };
  assert.equal(await preview.loadProxy("session", "sdr", 7968, "{}", 12, "source", options), resident);
  assert.deepEqual(resident.region, { x: 100, y: 200, width: 2000, height: 3000 });
  assert.equal(await preview.loadProxy("session", "sdr", 7968, "{}", 12, "source",
    { region: { ...options.region, alignment: 4 } }), resident, "an origin on the requested cells still serves");
  for (const [lane, geometry, sourceIdentity, region] of [
    ["hdr", "{}", "source", options.region],
    ["sdr", "changed", "source", options.region],
    ["sdr", "{}", "matched", options.region],
    ["sdr", "{}", "source", { x: 50, y: 250, width: 1800, height: 2800 }],
    // A luma feather's downsample cells: the resident origin is not on them.
    ["sdr", "{}", "source", { ...options.region, alignment: 16 }],
  ]) await assert.rejects(preview.loadProxy("session", lane, 7968, geometry, 12, sourceIdentity, { region }), /unexpected source request/);
});

/** A region backend that answers after a delay and counts overlapping requests. */
function createRegionBackend({ width, height, failAt = null, delayMs = 5 }) {
  const state = { requests: [], active: 0, peakActive: 0 };
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url, "http://localhost");
    const rect = Object.fromEntries(["x", "y", "width", "height"].map((name) => [name, Number(parsed.searchParams.get(name))]));
    const probe = rect.width === 1 && rect.height === 1;
    state.requests.push({ ...rect, probe, epoch: parsed.searchParams.get("source_epoch"), headers: options.headers });
    if (!probe) {
      state.active += 1;
      state.peakActive = Math.max(state.peakActive, state.active);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      state.active -= 1;
    }
    if (failAt !== null && !probe && rect.y === failAt) {
      return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({ detail: "Stale source tile request dropped." }) };
    }
    const bytesPerRow = alignRow(rect.width * 8);
    const headers = new Map([
      ["X-Output-Width", String(width)], ["X-Output-Height", String(height)],
      ["X-Tile-X", String(rect.x)], ["X-Tile-Y", String(rect.y)],
      ["X-Tile-Width", String(rect.width)], ["X-Tile-Height", String(rect.height)],
      ["X-Pixel-Format", "rgba16float"], ["X-Working-Space", "acescg"],
      ["X-Geometry-Signature", "{}"], ["X-Source-Epoch", "7"], ["X-Bytes-Per-Row", String(bytesPerRow)],
    ]);
    return { ok: true, status: 200, headers: { get: (name) => headers.get(name) ?? null },
      arrayBuffer: async () => new ArrayBuffer(bytesPerRow * rect.height) };
  };
  return { fetchImpl, state };
}

test("a region-only refusal does not start a whole-source fallback", async () => {
  const Preview = loadPreview(async()=>{throw new Error('unexpected whole-source request');});
  const preview = new Preview(null);
  let calls=0;
  preview.loadProxyRegion=async()=>{calls++;return null;};
  preview.loadProxyStreaming=async()=>{throw new Error('unexpected stream');};
  preview.loadProxyStreamed=async()=>{throw new Error('unexpected strips');};
  const result=await preview.loadProxy('session','hdr',7968,'{}',0,'source',
    {region:{x:0,y:0,width:128,height:128},regionOnly:true});
  assert.equal(result,null);assert.equal(calls,1);assert.equal(preview.proxyInflight.size,0);
});

function regionPreview(backend, chunkRows, regionWidth) {
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.maxSourceChunkBytes = regionWidth * 8 * chunkRows;
  return { preview, harness };
}

test("a source region fetches its chunks side by side, bounded by the staging ring", async () => {
  const backend = createRegionBackend({ width: 5320, height: 7968 });
  const region = { x: 686, y: 2618, width: 1024, height: 1003 };
  const { preview, harness } = regionPreview(backend, 100, region.width);
  const proxy = await preview.loadProxyRegion("session", "sdr", 7968, "{}", 0, "source", "key", region);

  assert.deepEqual({ ...proxy.region }, region);
  assert.equal(preview.sourceTransportMetrics.chunkCount, 11);
  assert.ok(backend.state.peakActive > 1, "chunks overlap");
  assert.ok(backend.state.peakActive <= 4, `at most one request per staging slot, saw ${backend.state.peakActive}`);
  // Only the ring's buffers ever exist, however many chunks pass through.
  assert.ok(harness.buffers.length <= 5, `staging buffers: ${harness.buffers.length}`);
  assert.ok(harness.buffers.every((buffer) => buffer.destroyed));
  const covered = new Array(region.height).fill(0);
  for (const write of harness.writes) {
    assert.equal(write.width, region.width);
    for (let row = write.originY; row < write.originY + write.rows; row += 1) covered[row] += 1;
  }
  assert.ok(covered.every((count) => count === 1), "every row written exactly once");
  const chunks = backend.state.requests.filter((request) => !request.probe);
  assert.ok(chunks.every((request) => request.epoch === "7" && request.x === region.x && request.width === region.width));
});

test("a failed region chunk stops every lane before the partial texture is released", async () => {
  const backend = createRegionBackend({ width: 5320, height: 7968, failAt: 2618 + 300 });
  const region = { x: 686, y: 2618, width: 1024, height: 1000 };
  const { preview, harness } = regionPreview(backend, 100, region.width);
  let destroyedWhileActive = null;
  preview.destroyAfterActiveRenders = (release) => { destroyedWhileActive = backend.state.active; release(); };

  await assert.rejects(
    () => preview.loadProxyRegion("session", "sdr", 7968, "{}", 0, "source", "key", region),
    (error) => error.recoverable === true && error.status === 409,
  );
  assert.equal(destroyedWhileActive, 0, "no request was still in flight when the texture was released");
  assert.equal(preview.proxies.size, 0);
  assert.equal(harness.textures.length, 1);
  assert.equal(harness.textures[0].destroyed, true);
  // Lanes stop asking once one has failed: the tail of the region is never requested.
  assert.ok(backend.state.requests.filter((request) => !request.probe).length < 10);
});


test("a wide source region covers every output column within the wire and buffer limits", async () => {
  const backend = createRegionBackend({ width: 9504, height: 6336 });
  const region = { x: 177, y: 11, width: 9000, height: 100 };
  const { preview, harness } = regionPreview(backend, 100, region.width);
  const maxBufferSize = 512 * 1024;
  harness.device.limits.maxBufferSize = maxBufferSize;
  const headers = new Headers({ "X-HDR-Finisher-Action": "wide-photo" });
  await preview.loadProxyRegion("session", "hdr", 9504, "{}", 0, "source", "wide", region, { headers });
  assert.ok(backend.state.requests.every(request => request.headers?.get("X-HDR-Finisher-Action") === "wide-photo"));
  const requested = backend.state.requests.filter(request => !request.probe);
  assert.ok(requested.some(request => request.x > region.x));
  assert.ok(requested.every(request => request.width <= 8192 && request.epoch === "7"));
  assert.ok(harness.buffers.every(buffer => buffer.size <= maxBufferSize));
  const coverage = new Uint8Array(region.width * region.height);
  for (const { originX, originY, width, rows } of harness.writes) {
    for (let y = originY; y < originY + rows; y++) {
      for (let x = originX; x < originX + width; x++) coverage[y * region.width + x]++;
    }
  }
  assert.ok(coverage.every(count => count === 1));
});

test("Fine Grain calibration matches the whole-width fit when GPU readback forces chunks", async () => {
  const Renderer = loadPreview(async () => { throw new Error("Unexpected network request"); });
  const width = 1457, height = 579;
  async function fit(maxStorageBufferBindingSize) {
    const renderer = Object.create(Renderer.prototype);
    const targets = [];
    const buffers = [];
    const pixel = (x, y) => ((31 * x + 117 * y) % 257) / 256;
    Object.assign(renderer, {
      device: {
        limits: { maxTextureDimension2D: 4096, maxBufferSize: 8 * 1024 * 1024, maxStorageBufferBindingSize },
        pushErrorScope() {},
        async popErrorScope() { return null; },
        createBuffer({ size }) {
          const data = new Float32Array(size / 4);
          const buffer = { data, async mapAsync() {}, getMappedRange: () => data.buffer, destroy() { this.destroyed = true; } };
          buffers.push(buffer);
          return buffer;
        },
        createCommandEncoder: () => ({
          copyBufferToBuffer(source, sourceOffset, target) { target.data.set(source.data); },
          finish() {},
        }),
        queue: { submit() {} },
      },
      ensureGrainFitPipeline: async () => ({}),
      createAdaptiveDenoiseScratch: () => ({ textures: {} }),
      reserveFineGrain() {},
      recordStage() {},
      loadProxyRegion: async (session, lane, native, geometry, revision, identity, key, requested, { stripUpload }) => {
        const region = { ...requested, width: Math.min(requested.width, width - requested.x),
          height: Math.min(requested.height, height - requested.y) };
        assert.ok(region.width <= stripUpload.maxWidth && region.height <= stripUpload.maxRows);
        return { region, width, height };
      },
      encodeAdaptiveDenoise(encoder, selector, weights, sizes, target, candidate, destination, source, reduction) {
        const { margin, stride, partials } = reduction;
        const { region } = source;
        targets.push(target);
        assert.equal(region.x, Math.max(0, target.x - margin));
        assert.equal(region.y, Math.max(0, target.y - margin));
        assert.equal(region.x + region.width, Math.min(width, target.x + target.width + margin));
        assert.equal(region.y + region.height, Math.min(height, target.y + target.height + margin));
        for (let band = 0; band < 2; band++) {
          let block = 0;
          for (let tile = target.x; tile < target.x + target.width; tile += 512) {
            const endX = Math.min(tile + 512, target.x + target.width);
            for (let y = target.y; y < target.y + target.height; y += 32) {
              for (let x = tile; x < endX; x += 32) {
                // Emulate the shader's additive statistics for one core block
                // using a local sample from the overlap where available.
                const left = Math.max(region.x, x - margin);
                const value = .25 + pixel(x, y) + pixel(left, y);
                const area = Math.min(32, endX - x) * Math.min(32, target.y + target.height - y);
                partials.data.set([value * area, value * area * .9, value * area * .2, value * area * .05],
                  (band * stride + block++) * 4);
              }
            }
          }
          assert.equal(block, stride);
        }
        return { paramBuffer: { destroy() {} } };
      },
    });
    const result = await renderer.measureFineGrain("photo", "hdr", width, "{}", 1, "source", {}, {}, null, () => true);
    assert.ok(buffers.every(buffer => buffer.destroyed));
    assert.ok(buffers.every(buffer => buffer.data.byteLength <= maxStorageBufferBindingSize));
    return { result, targets };
  }

  const unchunked = await fit(64 * 1024);
  const chunked = await fit(8 * 1024);
  assert.deepEqual(unchunked.targets.map(target => target.width), [width, width]);
  assert.equal(chunked.targets.length, 6);
  assert.deepEqual(chunked.targets.map(target => target.x), [0, 512, 1024, 0, 512, 1024]);
  assert.deepEqual(chunked.result, unchunked.result);
});


test("Micro Grain's Bayer work limit follows the padded region and device storage limit", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(frontendSource("micro-grain-gpu.js"), context);
  const { regionLimit } = context.window.HDRMicroGrainGpu;
  const device = { limits: { maxTextureDimension2D: 8192, maxComputeWorkgroupsPerDimension: 65535,
    maxBufferSize: 16 * 1024 * 1024, maxStorageBufferBindingSize: 4 * 1024 * 1024 } };
  assert.equal(regionLimit(device, { width: 768, height: 720 }), null);
  assert.equal(regionLimit(device, { width: 1536, height: 720 }).reason, "source_too_large");
  assert.equal(regionLimit(device, { width: 2048, height: 2049 }).reason, "source_too_large");
  assert.equal(regionLimit(device, { width: 8193, height: 128 }).reason, "source_too_large");
});
