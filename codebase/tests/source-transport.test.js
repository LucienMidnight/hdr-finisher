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
const { declarations, frontendSource } = require("./frontend-source.js");

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

test("in-place repair refresh retains native textures with their new source epoch", async () => {
  let transport;
  const geometry = { crop: { x: 0, y: 0, width: 1, height: 1 } };
  const geometrySignature = JSON.stringify(geometry);
  const requests = [];
  const uploads = [];
  const texture = {};
  const proxy = { texture, geometrySignature, sourceEpoch: 3, pixelFormat: "rgba16float",
    sessionId: "session", lane: "hdr", sourceIdentity: "source", width: 16, height: 12, longEdge: 16 };
  const alias = { ...proxy };
  const Preview = loadPreview(async (url) => {
    const params = new URLSearchParams(url.split("?")[1]);
    requests.push(params.get("source_epoch"));
    const headers = new Map([
      ["X-Edit-Revision", "8"], ["X-Geometry-Signature", geometrySignature],
      ["X-Pixel-Format", "rgba16float"], ["X-Source-Epoch", "4"],
      ["X-Tile-X", params.get("x")], ["X-Tile-Y", params.get("y")],
      ["X-Tile-Width", "4"], ["X-Tile-Height", "4"], ["X-Output-Width", "16"],
      ["X-Output-Height", "12"], ["X-Bytes-Per-Row", "32"],
    ]);
    return { ok: true, headers, arrayBuffer: async () => new ArrayBuffer(128) };
  }, { setup: ({ window }) => { transport = window.HDRSourceTransport; } });
  const renderer = new Preview(null);
  renderer.device = { queue: { writeTexture: (...args) => uploads.push(args) } };
  renderer.proxies.set("native", proxy);
  renderer.proxies.set("alias", alias);
  const refreshed = await transport.refreshRepairs(renderer, { sessionId: "session", editRevision: 8,
    sourceEpoch: 4, sourceSize: [16, 12], geometry, isCurrent: () => true,
    records: [[0, 0, 4, 4], [4, 4, 8, 8]].map(search_rect => ({ enabled: true, recipe: { search_rect } })),
  });
  assert.equal(refreshed, true);
  assert.deepEqual(requests, ["4", "4"]);
  assert.equal(uploads.length, 2);
  for (const key of ["native", "alias"]) {
    assert.equal(renderer.proxies.get(key).texture, texture);
    assert.equal(renderer.proxies.get(key).sourceEpoch, 4);
  }
});

test("a repair outside every cached viewport updates the epoch without fetching pixels", async () => {
  let transport;
  let fetches = 0;
  const Preview = loadPreview(async () => { fetches++; throw new Error("unexpected pixel fetch"); }, {
    setup: ({ window }) => { transport = window.HDRSourceTransport; },
  });
  const geometry = { crop: { x: 0, y: 0, width: 1, height: 1 } };
  const texture = {};
  const renderer = new Preview(null);
  renderer.proxies.set("viewport", { texture, geometrySignature: JSON.stringify(geometry), sourceEpoch: 3,
    pixelFormat: "rgba16float", sessionId: "session", lane: "hdr", sourceIdentity: "source",
    width: 3200, height: 2400, longEdge: 3200, regionTransport: true, region: { x: 0, y: 0, width: 800, height: 500 } });
  assert.equal(await transport.refreshRepairs(renderer, { sessionId: "session", editRevision: 8,
    sourceEpoch: 5, sourceSize: [3200, 2400], geometry, isCurrent: () => true,
    records: [{ enabled: true, recipe: { search_rect: [1600, 1000, 1650, 1050] } }],
  }), true);
  assert.equal(fetches, 0);
  assert.equal(renderer.proxies.get("viewport").texture, texture);
  assert.equal(renderer.proxies.get("viewport").sourceEpoch, 5);
});

function loadPreview(fetchImpl, { now = () => Date.now(), setup = null } = {}) {
  const context = vm.createContext({
    window: {},
    performance: { now },
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
  setup?.(context);
  return context.window.HDRWebGPUPreview;
}

test("a cancellable scope source flight does not own the foreground fetch", async () => {
  const requests = [];
  const scope = new AbortController();
  const Preview = loadPreview(async (_url, { signal }) => {
    requests.push(signal);
    if (signal === scope.signal) return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return { ok: false, status: 418, json: async () => ({ detail: "Foreground reached backend" }) };
  });
  const renderer = new Preview(null);
  const load = (options) => renderer.loadProxy("photo", "hdr", 960, "{}", 7, "source", options);
  const obsolete = assert.rejects(load({ scopeRequest: true, signal: scope.signal }), { name: "AbortError" });
  const foreground = assert.rejects(load({}), { status: 418 });
  scope.abort();
  await Promise.all([obsolete, foreground]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].aborted, false);
});

test("a cancelled pan store upload cannot claim or clear its replacement", async () => {
  const uploads = [];
  let transport;
  const Preview = loadPreview((_url, { signal }) => new Promise((resolve, reject) => {
    uploads.push({ signal, resolve, reject });
  }), { setup: context => { transport = context.window.HDRSourceTransport; } });
  const renderer = new Preview(null);
  renderer.device = createDevice().device;
  const backend = createBackend({ width: 64, height: 4 });
  const request = (signal) => transport.loadPanStore(renderer, {
    sessionId: "session", lane: "hdr", longEdge: 256, geometrySignature: "{}", editRevision: 1,
    options: { signal },
  });
  const old = new AbortController();
  const replacement = new AbortController();
  const cancelled = assert.rejects(request(old.signal), { name: "AbortError" });
  old.abort();
  const current = request(replacement.signal);
  current.catch(() => {});
  uploads[0].reject(old.signal.reason);
  await cancelled;
  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].signal, replacement.signal);

  const joined = request(replacement.signal);
  assert.equal(uploads.length, 2);
  uploads[1].resolve(await backend.fetchImpl("/api/session/session/proxy-stream/hdr"));
  const [proxy, sameProxy] = await Promise.all([current, joined]);
  assert.equal(proxy.panStore, true);
  assert.equal(sameProxy, proxy);
  assert.equal(renderer.proxyInflight.size, 0);
});

test("an old pan store cannot publish over a new photo's source during the copy fence", async () => {
  const backend = createBackend({ width: 64, height: 4 });
  let transport;
  const Preview = loadPreview(backend.fetchImpl, { setup: context => { transport = context.window.HDRSourceTransport; } });
  const renderer = new Preview(null);
  const old = createDevice();
  renderer.device = old.device;
  const fenceStarted = Promise.withResolvers();
  const fence = Promise.withResolvers();
  old.device.queue.onSubmittedWorkDone = () => { fenceStarted.resolve(); return fence.promise; };
  const pending = transport.loadPanStore(renderer, {
    sessionId: "session", lane: "hdr", longEdge: 256, geometrySignature: "{}", editRevision: 1,
  });
  const refused = assert.rejects(pending, /Pan store upload was superseded/);
  await fenceStarted.promise;
  renderer.resetSession("replacement");
  fence.resolve();
  await refused;
  assert.equal(renderer.proxies.size, 0);
  assert.ok(old.textures.every(texture => texture.destroyed));
  assert.ok(old.buffers.every(buffer => buffer.destroyed));
});

test("whole-source 507 backs off without blocking a first region or caching a 409", async () => {
  let status = 507;
  let time = 1;
  const requests = [];
  const Preview = loadPreview(async (url) => {
    requests.push(url);
    return { ok: false, status, json: async () => ({ detail: "Not enough memory" }) };
  }, { now: () => time });
  const preview = new Preview(null);
  const load = (options) => preview.loadProxy("session", "hdr", 7968, "{}", 3, "source", options);
  for (let attempt = 0; attempt < 80; attempt++) {
    await assert.rejects(load(), { status: 507, recoverable: false });
  }
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/proxy-stream\/hdr/);

  const region = { x: 512, y: 1024, width: 512, height: 512 };
  await assert.rejects(load({ region }), { status: 507, recoverable: false });
  await assert.rejects(load({ region }), { status: 507, recoverable: false });
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/source-tile\/hdr/);

  status = 409;
  time += 10000;
  await assert.rejects(load(), { status: 409, recoverable: true });
  await assert.rejects(load(), { status: 409, recoverable: true });
  assert.equal(requests.length, 4);
});

test("optional source regions return null on 507 while newer edits and resets get a fresh attempt", async () => {
  let requests = 0;
  let now = 10;
  let transport;
  const Preview = loadPreview(async (url) => {
    requests += 1;
    assert.match(url, /\/source-tile\/hdr/);
    return { ok: false, status: 507, json: async () => ({ detail: "Capacity" }) };
  }, { now: () => now, setup: ({ window }) => { transport = window.HDRSourceTransport; } });
  const preview = new Preview(null);
  const region = { x: 512, y: 512, width: 512, height: 512 };
  const load = (revision, regionOnly) => preview.loadProxy("session", "hdr", 7968, "{}", revision, "source",
    { region, regionOnly, requireRegion: true });
  const [required, optional] = await Promise.allSettled([load(4, false), load(4, true)]);
  assert.equal(required.reason.status, 507);
  assert.deepEqual(optional, { status: "fulfilled", value: null });
  const initialRequests = requests;
  await assert.rejects(load(4, false), { status: 507, retryAfter: 4010 });
  assert.equal(requests, initialRequests);
  await assert.rejects(load(5, false), { status: 507 });
  assert.equal(requests, initialRequests + 1);
  transport.clearCapacityRefusals(preview);
  await assert.rejects(load(5, false), { status: 507 });
  assert.equal(requests, initialRequests + 2);
  now = 4011;
  await assert.rejects(load(5, false), { status: 507 });
  assert.equal(requests, initialRequests + 3);
});

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
    { method: 'clean_grain', cleanSplotches: false, cleanFringes: false, grainEvenness: 1 }, 0, 18001), true);
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
        ["X-Source-Epoch", String(epoch)],
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
      ["X-Source-Epoch", String(epoch)],
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

for (const mode of ["mapping", "before publication"]) {
  test(`device replacement ${mode} retires the old stream without publishing it`, async () => {
    const backend = createBackend({ width: 128, height: 8 });
    const Preview = loadPreview(backend.fetchImpl);
    const preview = new Preview(null);
    let started, resume;
    const waiting = new Promise(resolve => { started = resolve; });
    const hold = new Promise(resolve => { resume = resolve; });
    const old = createDevice();
    const fresh = createDevice();
    preview.device = old.device;
    const allocate = old.device.createBuffer;
    const drain = old.device.queue.onSubmittedWorkDone;
    if (mode === "mapping") {
      old.device.createBuffer = descriptor => {
        const buffer = allocate(descriptor), map = buffer.mapAsync;
        buffer.mapAsync = async () => { started(); await hold; await map(); };
        return buffer;
      };
    } else {
      old.device.queue.onSubmittedWorkDone = async () => { await drain(); started(); await hold; };
    }
    const loading = preview.loadProxyStreaming("session", "hdr", 128, "{}", 0, "source", "key");
    const rejected = assert.rejects(loading, error => error.superseded === true);
    await waiting;
    preview.device = mode === "mapping" ? null : fresh.device;
    resume();
    await rejected;
    assert.equal(old.drains, 1);
    assert.equal(fresh.drains, 0);
    assert.equal(fresh.writes.length, 0);
    if (mode === "mapping") assert.equal(old.writes.length, 0);
    assert.ok(old.buffers.length > 0 && old.buffers.every(buffer => buffer.destroyed && !buffer.mapped));
    assert.equal(old.textures[0].destroyed, true);
    assert.equal(preview.proxies.size, 0);
  });
}

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
  assert.equal(proxy.sourceEpoch, 3);
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
  const backend = createBackend({ width, height, epoch: 0 });
  const Preview = loadPreview(backend.fetchImpl);
  const preview = new Preview(null);
  const harness = createDevice();
  preview.device = harness.device;
  preview.instrumentationEnabled = true;
  preview.sourceTransportMode = "single";
  preview.maxSourceChunkBytes = 128 * 1024;

  const proxy = await preview.loadProxy("session", "hdr", 8192, "{}", 0, "source");
  assert.ok(proxy);
  assert.equal(proxy.sourceEpoch, 0);
  assert.equal(preview.sourceTransportMetrics.route, "streamed");
  assert.equal(preview.sourceTransportMetrics.endpoint, "proxy");
  assert.ok(backend.requests[0].includes("/proxy/"));
  assert.equal(backend.requests.some((url) => url.includes("/source-tile/")), false);
  assert.equal(preview.sourceTransportMetrics.transferredBytes, alignRow(width * 8) * height);
});

test("a directly uploaded whole-frame proxy retains the source epoch", async () => {
  const backend = createBackend({ width: 256, height: 80, epoch: 9 });
  const Preview = loadPreview(backend.fetchImpl);
  const renderer = new Preview(null);
  renderer.device = createDevice().device;
  const proxy = await renderer.loadProxy("session", "hdr", 256, "{}", 0, "source");
  assert.equal(renderer.sourceTransportMetrics.route, "whole-frame");
  assert.equal(proxy.sourceEpoch, 9);
});

function hueMaskRenderer() {
  let params;
  const Preview = loadPreview(null, { setup: context => {
    vm.runInContext(frontendSource("hsl-selection-gpu.js"), context);
    const { count, indices } = context.window.HDRGpuParamLayout;
    params = new Float32Array(count);
    params[indices.SOURCE_PIXEL_SCALE] = 1;
    params[indices.BLACK_AND_WHITE_ENABLED] = 1;
    params[indices.BLACK_AND_WHITE_ENABLED + 1] = 0.3;
  } });
  const local = { id: "hue", mask: { operator: "leaf", leaf: { type: "hue_range", hue_center: 90 } } };
  return { renderer: new Preview(null), params, local };
}

test("a viewport Hue mask snaps its crop outward and retains the non-grid frame edges", async () => {
  const { renderer, params, local } = hueMaskRenderer();
  const viewport = { x: 253, y: 241, width: 417, height: 319 };
  const tile = { key: "viewport", haloRect: viewport };
  const proxy = { width: 5202, height: 3463 };
  const regions = [];
  renderer.loadGpuHueLeaf = async (...args) => { regions.push({ ...args.at(-1) }); return {}; };
  const load = () => renderer.loadLocalMaskTiles("photo", { local, localIndex: 0, tiles: [tile] },
    5202, 0, "{}", () => true, null, proxy, null, { params });
  assert.equal((await load()).entries.size, 1);
  assert.deepEqual(regions[0], { x: 172, y: 160, width: 580, height: 480 });
  Object.assign(viewport, { x: 4831, y: 3197, width: 371, height: 266 });
  await load();
  assert.deepEqual(regions[1], { x: 4748, y: 3116, width: 454, height: 347 });
});

test("a tall Hue mask reads the Black & White guide neighbourhood on both sides of a seam", async () => {
  const { renderer, params, local } = hueMaskRenderer();
  const pass = Object.fromEntries(["setViewport", "setScissorRect", "setPipeline", "setBindGroup", "draw", "end"]
    .map(name => [name, () => {}]));
  const engine = Object.fromEntries(["ensure", "commit", "dropRetired", "release"].map(name => [name, () => {}]));
  const copies = [];
  const texture = { format: "rgba16float", createView() {}, destroy() {} };
  Object.assign(renderer, {
    hslSelectionTemplate: { fork: () => engine },
    device: { createTexture: () => texture, queue: { submit() {}, writeBuffer() {} }, createCommandEncoder: () => ({
      copyTextureToTexture: (from, _to, size) => copies.push([from.origin.y, size.height]),
      beginRenderPass: () => pass, finish() {},
    }) },
    createMaskTexture: () => texture, createStorageBuffer: () => ({ destroy() {} }),
    hueContextIdentity: () => "hue", pipelineFor: () => ({}), bindGraphResources() {},
    encodeHslSelection: () => ({}), retainLocalMask() {},
  });
  const proxy = { width: 4096, height: 2800, texture };
  await renderer.loadGpuHueLeaf("photo", local.mask, { proxy, params }, 4096);
  assert.deepEqual(copies, [[0, 1064], [984, 1104], [2008, 792]]);
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
function createRegionBackend({ width, height, geometry = "{}", failAt = null, delayMs = 5 }) {
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
      ["X-Geometry-Signature", geometry], ["X-Source-Epoch", "7"], ["X-Bytes-Per-Row", String(bytesPerRow)],
    ]);
    return { ok: true, status: 200, headers: { get: (name) => headers.get(name) ?? null },
      arrayBuffer: async () => new ArrayBuffer(bytesPerRow * rect.height) };
  };
  return { fetchImpl, state };
}

test("the first viewport after a geometry edit uses the mapped frame and requests source tiles", async () => {
  const sourceSize = { width: 7968, height: 5320 };
  const frameSize = { width: 7771, height: 5021 };
  const geometry = { straighten_angle: 2.4 };
  const signature = JSON.stringify(geometry);
  const backend = createRegionBackend({ ...frameSize, geometry: signature });
  const state = { session: { session_id: "session", source: sourceSize }, editRevision: 3,
    adjustments: { shared: { geometry } } };
  let resolveViewport;
  let mapCalls = 0;
  const Preview = loadPreview(async (url, options) => {
    if (url.endsWith("/geometry-map")) {
      mapCalls++;
      assert.equal(JSON.parse(options.body).edit_revision, 3);
      assert.equal(JSON.parse(options.body).long_edge, 7968);
      return { ok: true, json: async () => ({ output_width: frameSize.width, output_height: frameSize.height }) };
    }
    assert.match(url, /\/source-tile\/hdr/);
    return backend.fetchImpl(url, options);
  }, { setup: (context) => {
    Object.assign(context, {
      state, geometryMath: require("../frontend/geometry-math.js").HDRGeometryMath,
      geometryCoordinateMapCache: new Map(), geometryCoordinateMapRequests: new Map(), geometryFullOutputFrames: new Map(),
      applyZoomGeometry() {}, queueLocalMaskOverlayRender() {},
      visibleOutputRect: (width, height) => ({ x: width - 700, y: height - 540, width: 700, height: 540 }),
    });
    vm.runInContext(frontendSource("geometry-tools.js"), context);
    vm.runInContext(frontendSource("viewport-request.js"), context);
    vm.runInContext(declarations("gpuFrameSizeAt", "resolveGpuViewport"), context);
    resolveViewport = context.resolveGpuViewport;
  } });
  const preview = new Preview(null);
  preview.device = createDevice().device;
  preview.lastPresentedFrame = { sessionId: "session", lane: "hdr", ...sourceSize, workingSpace: "acescg" };
  preview.configureSurface = () => ({ format: "rgba16float" });
  preview.roiSourceHalo = () => 3;
  const options = await resolveViewport(7968, null, { remeasure: true, isCurrent: () => true });
  assert.equal(mapCalls, 1);
  assert.deepEqual({ ...options.frameSize }, frameSize);
  const region = preview.roiRegionFor({}, {}, "session", "hdr", state.adjustments, sourceSize, 203,
    { ...options, nativeGeometryViewport: true }, [], 7968);
  const proxy = await preview.loadProxy("session", "hdr", 7968, signature, 3, "source", { region });
  assert.equal(proxy.regionTransport, true);
  assert.equal(proxy.width, frameSize.width);
  assert.equal(proxy.height, frameSize.height);
  assert.equal(proxy.region.x + proxy.region.width, frameSize.width);
  assert.equal(proxy.region.y + proxy.region.height, frameSize.height);
  assert.ok(proxy.region.width * proxy.region.height < frameSize.width * frameSize.height / 10);
});

test("a fully visible crop fetches native tiles on the first frame in a different lane", async () => {
  const frameSize = { width: 160, height: 128 };
  const sourceSize = { width: 7968, height: 5320 };
  const geometry = { crop: { x: .45, y: .45, width: .02, height: .024 } };
  const signature = JSON.stringify(geometry);
  const backend = createRegionBackend({ ...frameSize, geometry: signature });
  const Preview = loadPreview((url, options) => {
    assert.match(url, /\/source-tile\/sdr/);
    return backend.fetchImpl(url, options);
  }, { setup: context => vm.runInContext(frontendSource("viewport-request.js"), context) });
  const preview = new Preview(null);
  preview.device = createDevice().device;
  preview.lastPresentedFrame = { sessionId: "session", lane: "hdr", ...sourceSize, workingSpace: "acescg" };
  preview.configureSurface = () => ({ format: "rgba16float" });
  preview.roiSourceHalo = () => 3;
  const options = { frameSize, viewport: { x: 0, y: 0, ...frameSize }, nativeGeometryViewport: true, identity: "generated-sdr" };
  const region = preview.roiRegionFor({}, {}, "session", "sdr", { shared: { geometry } }, sourceSize, 203, options, [], 7968);
  assert.deepEqual({ ...region }, options.viewport);
  const proxy = await preview.loadProxy("session", "sdr", 7968, signature, 3, "generated-sdr", { region, requireRegion: true });
  assert.equal(proxy.regionTransport, true);
  assert.equal(proxy.longEdge, 7968);
  assert.deepEqual({ ...proxy.region }, options.viewport);
});

test("native geometry keeps the viewport when local luminance needs a different mask route", () => {
  const Preview = loadPreview(() => assert.fail("Planning must not request a source"),
    { setup: context => vm.runInContext(frontendSource("viewport-request.js"), context) });
  const preview = new Preview(null);
  preview.configureSurface = () => ({ format: "rgba16float" });
  preview.roiSourceHalo = () => 3;
  preview.sourceSpaceMask = () => null;
  const geometry = { straighten_angle: 1.3 };
  const sourceSize = { width: 7968, height: 5320 };
  const frameSize = { width: 7400, height: 5000 };
  const luminance = feather => ({ operator: "leaf", leaf: { type: "luminance_range", mask_feather: feather } });
  const regionFor = activeLocals => preview.roiRegionFor({}, {}, "session", "hdr", { shared: { geometry } },
    sourceSize, 203, { frameSize, viewport: { x: 2000, y: 1500, width: 1000, height: 600 }, nativeGeometryViewport: true },
    activeLocals, 7968);
  const unsupported = regionFor([{ mask: { operator: "union", children: [luminance(0),
    { operator: "leaf", leaf: { type: "brush", mask_feather: .05 } }] } }]);
  const alignment = regionFor([{ mask: luminance(.05) }, { mask: luminance(.0496) }]);
  assert.ok(unsupported?.width < frameSize.width);
  assert.ok(alignment?.width < frameSize.width);
  assert.equal(alignment.backendLumaMasks, true);
});

function hueViewportPreview(fetchImpl) {
  const Preview = loadPreview(fetchImpl, { setup: (context) => {
    vm.runInContext(frontendSource("viewport-request.js"), context);
    vm.runInContext(frontendSource("hsl-selection-gpu.js"), context);
    context.window.HDRHslSelectionGpu = context.HDRHslSelectionGpu;
  } });
  const preview = new Preview(null);
  preview.configureSurface = () => ({ format: "rgba16float" });
  preview.executionOverrideFor = () => "tiled";
  preview.roiSourceHalo = () => 0;
  preview.retainedTiledFrame = () => true;
  return preview;
}

const hueLeaf = { operator: "leaf", leaf: { type: "hue_range", hue_center: 90 } };

test("both SDR pictures keep compound Hue on the GPU at Fit and native zoom", async () => {
  const sourceSize = { width: 7968, height: 5320 };
  const gradient = { operator: "leaf", leaf: { type: "linear_gradient", start: { x: 0, y: 0 }, end: { x: 1, y: 1 },
    gradient_midpoint_1: .3, gradient_midpoint_2: .7 } };
  const luma = { operator: "leaf", leaf: { type: "luminance_range", mask_feather: 0 } };
  const featheredLuma = { operator: "leaf", leaf: { ...luma.leaf, mask_feather: .004 } };
  const featheredBrush = { operator: "leaf", leaf: { type: "brush", mask_feather: .05 } };
  for (const [sourceIdentity, workingSpace] of [["source", "acescg"], ["generated-sdr", "acescg"], ["authored-sdr", "linear-srgb"]]) {
    const preview = hueViewportPreview(async () => assert.fail("unexpected mask request"));
    const full = { ...sourceSize, longEdge: sourceSize.width, lane: "sdr", sourceIdentity, workingSpace };
    preview.lastPresentedFrame = full;
    const gpuCalls = [];
    preview.loadGpuMaskGraph = async (...args) => { gpuCalls.push(args[8]); return { kind: "gpu-graph" }; };
    preview.loadCpuMaskTiles = async () => { throw Object.assign(new Error("whole CPU mask exceeds budget"), { status: 507 }); };
    for (const [leaf, regional] of [[gradient, true], [luma, sourceIdentity === "source"],
      [featheredLuma, false], [featheredBrush, false]]) {
      const local = { mask: { operator: "intersect", children: [hueLeaf, leaf] } };
      const tile = { key: "tile" };
      const options = { identity: sourceIdentity, viewport: { x: 792, y: 648, width: 1691, height: 895 } };
      const region = preview.roiRegionFor({}, {}, "session", "sdr", {}, sourceSize, 203, options, [local], sourceSize.width);
      assert.equal(Boolean(region), regional, `${sourceIdentity} / ${leaf.leaf.type} / ${leaf.leaf.mask_feather ?? 0}`);
      const zoom = region ? { ...full, region } : full;
      for (const proxy of [full, zoom]) {
        const result = await preview.loadLocalMaskTiles("session", { local, localIndex: 0, tiles: [tile] },
          sourceSize.width, 1, "{}", () => true, undefined, proxy, null, { lane: "sdr", proxy });
        assert.equal(result.entries.get(tile.key).kind, "gpu-graph");
        assert.equal(gpuCalls.at(-1), proxy);
      }
    }
  }
});

test("a near-full Hue source accepts whole-frame fallback when geometry tiles cannot downsample", async () => {
  const sourceSize = { width: 7968, height: 5320 };
  for (const geometry of [{ straighten_angle: 2 }, { perspective_vertical: 12 }]) {
    let probes = 0;
    const preview = hueViewportPreview(async (url) => {
      assert.match(url, /\/source-tile\/sdr/);
      probes++;
      return { ok: false, status: 409, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    preview.lastPresentedFrame = { ...sourceSize, longEdge: sourceSize.width, workingSpace: "acescg" };
    const full = { ...sourceSize, region: null };
    preview.loadProxyStreaming = async () => full;
    preview.loadProxyStreamed = async () => full;
    const options = { viewport: { x: 0, y: 0, width: 7400, height: 5100 } };
    const region = preview.roiRegionFor({}, {}, "session", "sdr", { shared: { geometry } }, sourceSize, 203,
      options, [{ mask: hueLeaf }], sourceSize.width);
    assert.ok(region.width * region.height >= sourceSize.width * sourceSize.height * .9);
    const proxy = await preview.loadProxy("session", "sdr", sourceSize.width, JSON.stringify(geometry), 1, "source",
      { region, requireRegion: region.requireRegion });
    assert.equal(proxy, full);
    assert.equal(probes, 1);
  }
});

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

test("a native geometry render without required source bounds is refused, not superseded", async () => {
  const Preview = loadPreview(async () => assert.fail("No whole-source request should be made"));
  const canvas = { getContext: () => ({}) };
  const preview = new Preview(canvas);
  preview.available = true;
  preview.sessionId = "session";
  preview.roiRegionFor = () => null;
  preview.prefetchZoomMasks = () => {};
  assert.equal(await preview.renderTo(canvas, "session", "hdr", {}, null, 7968, [], 0, null,
    203, null, { nativeGeometryViewport: true }), false);
  assert.equal(preview.lastRenderRefusal.reason, "required-source-region-unavailable");
});

for (const route of ["foreground", "scope", "navigation"]) {
  test(`${route} render cancels an active underlayer and never waits for its unfinished preparation`, async () => {
    const canvas = { getContext: () => ({}) };
    const neverPrepare = new Promise(() => {});
    const controller = new AbortController();
    const seen = [];
    let preview;
    const Preview = loadPreview(async () => assert.fail("Unexpected source request"), { setup: context => {
      context.window.HDRFilmStocks = { request(stock) {
        seen.push([stock, preview.activeRenderCount]);
        return stock === "waiting" ? neverPrepare : undefined;
      } };
      context.document = { createElement: () => canvas };
    } });
    preview = new Preview(canvas);
    preview.available = true;
    preview.sessionId = "session";
    preview.roiRegionFor = () => null;
    preview.prefetchZoomMasks = () => {};
    const options = { nativeGeometryViewport: true, isCurrent: () => true };
    const background = preview.render("session", "hdr", { hdr: { film_look: { film_stock: "waiting" } } }, null,
      1600, [], 0, null, 203, null, { ...options, backgroundUnderlayer: true,
        cancelUnderlayer: () => controller.abort(), signal: controller.signal });
    const rejected = assert.rejects(background, { name: "AbortError" });
    assert.equal(preview.activeRenderCount, 1);
    const competing = route === "scope" ? preview.renderScopeProxy("session", "hdr", {}, null, 1600, [], 0, 203, null, options)
      : route === "navigation" ? preview.renderNavigationProxy("session", "hdr", {}, null, [], 0, 203, null, options)
        : preview.render("session", "hdr", {}, null, 1600, [], 0, null, 203, null, options);
    assert.equal(await competing, route === "foreground" ? false : null);
    assert.deepEqual(seen, [["waiting", 1], ["none", 1]]);
    await rejected;
    assert.equal(preview.activeRenderCount, 0);
    const foregroundRefusal = preview.lastRenderRefusal;
    await preview.render("", "hdr", {}, null, 1600, [], 0, null, 203, null, { backgroundUnderlayer: true });
    assert.equal(preview.lastRenderRefusal, foregroundRefusal);
  });
}

test("underlayer Direct scratch is not retained, and replacing shared scratch defers disposal", () => {
  const Preview = loadPreview(async () => assert.fail("Unexpected source request"));
  const canvas = {};
  const preview = new Preview(canvas);
  preview.device = createDevice().device;
  const retained = preview.ensureIntermediate(canvas, 1800, 1200);
  preview.activeRenderCount = 1;
  const scratch = preview.ensureIntermediate(canvas, 1600, 900, true, true, true, false);
  assert.equal(preview.intermediates.get(canvas), retained);
  preview.destroyIntermediate(scratch);
  assert.equal(scratch.finishTexture.__entry.destroyed, true);
  const replacement = preview.ensureIntermediate(canvas, 1900, 1200);
  assert.equal(preview.intermediates.get(canvas), replacement);
  assert.equal(retained.finishTexture.__entry.destroyed, false);
  preview.finishActiveRender();
  assert.equal(retained.finishTexture.__entry.destroyed, true);
});

test("a live underlayer reports resident scratch without requesting export preemption", async () => {
  const heartbeats = [];
  const Preview = loadPreview(async (url, options) => {
    assert.equal(url, "/api/delivery/gpu/activity");
    heartbeats.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({}) };
  });
  const canvas = {};
  const preview = new Preview(canvas);
  preview.deliveryClientId = "grade";
  const { device, textures } = createDevice();
  preview.device = device;
  preview.activeRenderCount = 1;
  await preview.reportDeliveryActivity();
  preview.geometryUnderlayerRender = {};
  const scratch = preview.ensureIntermediate(canvas, 1600, 900, true, true, true, false);
  await preview.reportDeliveryActivity();
  preview.destroyIntermediate(scratch);
  preview.geometryUnderlayerRender = null;
  preview.finishActiveRender();
  await preview.reportDeliveryActivity();
  const scratchBytes = textures.reduce((sum, entry) => sum + entry.width * entry.height * 8, 0);
  assert.ok(scratchBytes > 0);
  assert.deepEqual(heartbeats.map(beat => beat.active), [true, false, false]);
  assert.deepEqual(heartbeats.map(beat => beat.bytes - heartbeats[0].bytes), [0, scratchBytes, 0]);
});

test("fill scratch allocation failure releases partial textures and preserves foreground backoff", () => {
  const Preview = loadPreview(async () => assert.fail("Unexpected source request"));
  const preview = new Preview({});
  const { device, textures } = createDevice();
  preview.device = device;
  const createTexture = device.createTexture;
  device.createTexture = descriptor => {
    if (textures.at(-1)?.destroyed !== false) return createTexture(descriptor);
    throw Error("Injected allocation failure");
  };
  const backoff = preview.recordAllocationFailure("foreground", Error("previous failure"));
  preview.geometryUnderlayerRender = {};
  assert.equal(preview.ensureIntermediate({}, 1600, 900, false, false, false, false), null);
  assert.equal(preview.allocationBackoff, backoff);
  assert.equal(preview.geometryUnderlayerRender.intermediate, undefined);
  assert.equal(textures.length, 1);
  assert.equal(textures[0].destroyed, true);
  preview.geometryUnderlayerRender = null;
  assert.equal(preview.ensureIntermediate({}, 1600, 900, false, false), null);
  assert.match(preview.allocationBackoff.reason, /grading-film: Injected allocation failure/);
});

test("aborted underlayer refuses Denoise's looser source current check and does not upload late bytes", async () => {
  const controller = new AbortController();
  const data = new ArrayBuffer(64);
  const Preview = loadPreview(async () => ({ ok: true, headers: new Headers({ "X-Geometry-Signature": "{}" }),
    arrayBuffer: async () => { controller.abort(); return data; } }));
  const canvas = {};
  const preview = new Preview(canvas);
  preview.renderSerials.set(canvas, 3);
  const sourceOptions = { backgroundUnderlayer: true, signal: controller.signal,
    isCurrent: () => true, isSourceCurrent: () => true };
  assert.equal(preview.sourceLoadIsCurrent(canvas, 3, preview.resourceGeneration, sourceOptions), true);
  const harness = createDevice();
  preview.device = harness.device;
  await assert.rejects(preview.loadProxy("photo", "hdr", 256, "{}", 0, "source", sourceOptions), /superseded/);
  assert.equal(preview.sourceLoadIsCurrent(canvas, 3, preview.resourceGeneration, sourceOptions), false);
  assert.equal(harness.writes.length, 0);
  assert.equal(preview.proxies.size, 0);
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
        createBuffer({ size, usage }) {
          const data = new Float32Array(size / 4);
          const buffer = { data, usage, maps: 0, async mapAsync() { this.maps++; },
            getMappedRange: () => data.buffer, destroy() { this.destroyed = true; } };
          buffers.push(buffer);
          return buffer;
        },
        createCommandEncoder: () => ({
          copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
            target.data.set(source.data.subarray(sourceOffset / 4, (sourceOffset + size) / 4), targetOffset / 4);
          },
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
    const [storage, readback] = buffers;
    assert.ok(storage.data.byteLength <= maxStorageBufferBindingSize);
    assert.ok(readback.data.byteLength <= renderer.device.limits.maxBufferSize);
    assert.equal(readback.maps, 1);
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
