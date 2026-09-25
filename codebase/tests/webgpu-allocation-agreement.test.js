// Phase 0 exit gate: "Diagnostic totals agree with allocations in deterministic
// tests." The sibling webgpu-memory-diagnostics suite checks the static logical
// models against approved baselines using hand-built fixtures. This suite instead
// drives the real allocation code paths through a recording GPUDevice stub and
// proves that resourceMemorySnapshot() reports exactly the bytes the renderer
// actually asked the device to create, with destroyed resources removed. It runs
// deterministically on any machine and therefore does not depend on a live
// WebGPU adapter.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Kept in step with webgpu-preview.js, where 160 and 161 carry the tile origin
// and 166 the Show noise view flag.
const PARAM_COUNT = 167;

const BYTES_PER_PIXEL = {
  rgba32float: 16,
  rgba16float: 8,
  rg16float: 4,
  r16float: 2,
  r8unorm: 1,
};

function createRecordingDevice() {
  const live = new Map();
  let nextId = 0;
  const ledger = {
    created: [],
    destroyed: [],
    get liveTextureBytes() {
      return [...live.values()]
        .filter((entry) => entry.kind === "texture")
        .reduce((sum, entry) => sum + entry.byteSize, 0);
    },
    get liveBufferBytes() {
      return [...live.values()]
        .filter((entry) => entry.kind === "buffer")
        .reduce((sum, entry) => sum + entry.byteSize, 0);
    },
    get liveBytes() {
      return [...live.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
    },
    bytesCreatedSince(mark) {
      return ledger.created.slice(mark).reduce((sum, entry) => sum + entry.byteSize, 0);
    },
  };

  function register(kind, byteSize, detail) {
    const id = nextId;
    nextId += 1;
    const entry = { id, kind, byteSize, ...detail };
    live.set(id, entry);
    ledger.created.push(entry);
    const handle = {
      __id: id,
      mapState: "unmapped",
      destroy() {
        if (live.delete(id)) ledger.destroyed.push(entry);
      },
    };
    // GPUBuffer exposes `size`; the diagnostics read it for parameter buffers.
    if (kind === "buffer") handle.size = byteSize;
    return handle;
  }

  const device = {
    limits: { maxTextureDimension2D: 16384, maxBufferSize: 2 ** 31 },
    createTexture(descriptor) {
      const width = descriptor.size.width ?? descriptor.size[0];
      const height = descriptor.size.height ?? descriptor.size[1] ?? 1;
      const bytesPerPixel = BYTES_PER_PIXEL[descriptor.format];
      assert.ok(
        bytesPerPixel,
        'test stub does not know the byte size of format "' + descriptor.format + '"',
      );
      return register("texture", width * height * bytesPerPixel, {
        width,
        height,
        format: descriptor.format,
      });
    },
    createBuffer(descriptor) {
      return register("buffer", descriptor.size, { size: descriptor.size });
    },
  };

  return { device, ledger };
}

function loadPreviewModule() {
  const source = fs.readFileSync(
    path.join(__dirname, "../frontend/webgpu-preview.js"),
    "utf8",
  );
  // The renderer's halo math is the declared processing-scale contract, which
  // the page loads as its own script. The harness mirrors that script set.
  const graphScaleSource = fs.readFileSync(
    path.join(__dirname, "../frontend/graph-scale.js"),
    "utf8",
  );
  const allocatorSource = fs.readFileSync(
    path.join(__dirname, "../frontend/gpu-allocator.js"),
    "utf8",
  );
  const budgetSource = fs.readFileSync(
    path.join(__dirname, "../frontend/gpu-budget.js"),
    "utf8",
  );
  const context = vm.createContext({
    window: {},
    performance: { now: () => 1 },
    console,
    GPUTextureUsage: {
      COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
    },
    GPUBufferUsage: {
      MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64,
      STORAGE: 128, QUERY_RESOLVE: 512,
    },
  });
  vm.runInContext(graphScaleSource, context);
  vm.runInContext(allocatorSource, context);
  vm.runInContext(budgetSource, context);
  vm.runInContext(source, context);
  return context.window.HDRWebGPUPreview;
}

function createPreview() {
  const Preview = loadPreviewModule();
  const preview = new Preview(null);
  const { device, ledger } = createRecordingDevice();
  preview.device = device;
  // recordAllocation is a no-op unless instrumentation is on.
  preview.instrumentationEnabled = true;
  return { preview, ledger };
}

test("grading residency reports the four core textures the device actually created", () => {
  const { preview, ledger } = createPreview();
  const canvas = {};

  preview.ensureIntermediate(canvas, 640, 480, false, false);

  const fullSizeTextures = ledger.created.filter(
    (entry) => entry.kind === "texture" && entry.width === 640 && entry.height === 480,
  );
  // The historic diagnostic counted three grading textures while
  // ensureIntermediate allocated four (Base, Film, Finish, Local).
  assert.equal(fullSizeTextures.length, 4);

  const resources = preview.diagnosticsSnapshot().resources;
  assert.equal(resources.memory.resident.categories.gradingCoreBytes, ledger.liveTextureBytes);
  assert.equal(resources.memory.resident.categories.gradingCoreBytes, 640 * 480 * 8 * 4);
  assert.equal(resources.gradingIntermediateBytes, ledger.liveTextureBytes);
});

test("resident total equals live device bytes across detail, spatial, scope, and parameter allocations", () => {
  const { preview, ledger } = createPreview();
  const canvas = {};

  preview.ensureIntermediate(canvas, 640, 480, true, true);
  preview.ensureStorageBuffers(PARAM_COUNT * 4, 1024 * 4);
  const scope = preview.acquireScopeResource(256, 256);
  assert.ok(scope);

  const memory = preview.diagnosticsSnapshot().resources.memory;
  assert.equal(memory.resident.totalBytes, ledger.liveBytes);

  const categories = memory.resident.categories;
  assert.equal(categories.gradingCoreBytes, 640 * 480 * 8 * 4);
  assert.equal(categories.gradingDetailBytes, 640 * 480 * 8 * 2);
  assert.equal(categories.gradingSpatialBytes, 160 * 120 * 8 * 2);
  assert.equal(categories.parameterBufferBytes, PARAM_COUNT * 4 + 1024 * 4);
  // The scope pool reports its texture, its row-aligned read buffer, and its
  // parameter buffer as one byte size, so it covers every scope-owned buffer.
  assert.equal(
    categories.scopeBytes,
    256 * 256 * 8 + Math.ceil((256 * 8) / 256) * 256 * 256 + PARAM_COUNT * 4,
  );
  assert.equal(
    Object.values(categories).reduce((sum, value) => sum + value, 0),
    memory.resident.totalBytes,
  );
});

test("a resize destroys the previous graph and residency follows the live device set", () => {
  const { preview, ledger } = createPreview();
  const canvas = {};

  preview.ensureIntermediate(canvas, 640, 480, true, true);
  const beforeResize = preview.diagnosticsSnapshot().resources.memory.resident.totalBytes;
  assert.equal(beforeResize, ledger.liveBytes);

  preview.ensureIntermediate(canvas, 320, 240, true, true);

  assert.equal(ledger.destroyed.length, 8);
  const afterResize = preview.diagnosticsSnapshot().resources.memory.resident.totalBytes;
  assert.equal(afterResize, ledger.liveBytes);
  assert.equal(
    afterResize,
    320 * 240 * 8 * 6 + Math.ceil(320 / 4) * Math.ceil(240 / 4) * 8 * 2,
  );
});

test("the recordAllocation ledger matches the bytes each call asked the device to create", () => {
  const { preview, ledger } = createPreview();
  const canvas = {};

  const beforeBase = ledger.created.length;
  preview.ensureIntermediate(canvas, 800, 600, false, false);
  const baseAllocation = preview.performanceMetrics.allocations.at(-1);
  assert.equal(baseAllocation.kind, "grading-intermediates");
  assert.equal(baseAllocation.bytes, ledger.bytesCreatedSince(beforeBase));

  const beforeDetail = ledger.created.length;
  preview.ensureIntermediate(canvas, 800, 600, false, true);
  const detailAllocation = preview.performanceMetrics.allocations.at(-1);
  assert.equal(detailAllocation.kind, "grading-detail-intermediates");
  assert.equal(detailAllocation.bytes, ledger.bytesCreatedSince(beforeDetail));

  const beforeSpatial = ledger.created.length;
  preview.ensureIntermediate(canvas, 800, 600, true, true);
  const spatialAllocation = preview.performanceMetrics.allocations.at(-1);
  assert.equal(spatialAllocation.kind, "grading-spatial-intermediates");
  assert.equal(spatialAllocation.bytes, ledger.bytesCreatedSince(beforeSpatial));

  const beforeScope = ledger.created.length;
  preview.acquireScopeResource(320, 200);
  const scopeAllocation = preview.performanceMetrics.allocations.at(-1);
  assert.equal(scopeAllocation.kind, "scope");
  assert.equal(scopeAllocation.bytes, ledger.bytesCreatedSince(beforeScope));

  assert.equal(preview.diagnosticsSnapshot().resources.memory.resident.totalBytes, ledger.liveBytes);
});

test("the planned model for the resident graph agrees with the measured grading categories", () => {
  const { preview } = createPreview();
  const canvas = {};

  preview.ensureIntermediate(canvas, 1024, 1024, true, true);

  const memory = preview.diagnosticsSnapshot().resources.memory;
  const planned = memory.planned;
  assert.ok(planned);
  assert.equal(planned.width, 1024);
  assert.equal(planned.height, 1024);
  assert.equal(planned.categories.gradingBytes, memory.resident.categories.gradingCoreBytes);
  assert.equal(planned.categories.detailBytes, memory.resident.categories.gradingDetailBytes);
  assert.equal(planned.categories.spatialBytes, memory.resident.categories.gradingSpatialBytes);
  // No presentation has been recorded, so peak carries no retained overlap yet.
  assert.equal(memory.retainedPresentationOverlapBytes, 0);
  assert.equal(memory.peakLogicalBytes, memory.resident.totalBytes);
});

function cacheTexture(preview, width, height) {
  return {
    texture: preview.device.createTexture({
      size: { width, height }, format: "rgba16float", usage: 1,
    }),
    width,
    height,
    byteSize: width * height * 8,
  };
}

test("every cache map registers through the allocator, so a set is an allocation", () => {
  const { preview } = createPreview();
  preview.detailBandTiles.set("detail:1", cacheTexture(preview, 32, 16));
  preview.maskTiles.set("mask:1", cacheTexture(preview, 16, 16));
  preview.sceneLuminance.set("scene:1", cacheTexture(preview, 64, 8));
  preview.localMasks.set("local:1", cacheTexture(preview, 8, 8));
  preview.proxies.set("session:hdr:1600:{}:source", cacheTexture(preview, 96, 24));

  const snapshot = preview.gpuAllocator.snapshot();
  assert.equal(snapshot.byKind["detail-band-tile"].bytes, 32 * 16 * 8);
  assert.equal(snapshot.byKind["mask-tile"].bytes, 16 * 16 * 8);
  assert.equal(snapshot.byKind["scene-luminance"].bytes, 64 * 8 * 8);
  assert.equal(snapshot.byKind["local-mask"].bytes, 8 * 8 * 8);
  assert.equal(snapshot.byKind["source-proxy"].bytes, 96 * 24 * 8);
  assert.equal(snapshot.registeredBytes, (32 * 16 + 16 * 16 + 64 * 8 + 8 * 8 + 96 * 24) * 8);

  for (const map of [preview.detailBandTiles, preview.maskTiles, preview.sceneLuminance,
    preview.localMasks, preview.proxies]) {
    for (const entry of map.values()) {
      assert.ok(entry.allocatorEntry, "every cache entry must carry its registration");
    }
  }
  // Deleting through the map releases the registration with it.
  preview.maskTiles.delete("mask:1");
  assert.equal(preview.gpuAllocator.snapshot().byKind["mask-tile"], undefined);
});

test("budget pressure evicts the global LRU across cache kinds, through each entry's release", () => {
  const { preview, ledger } = createPreview();
  preview.detailBandTiles.set("detail:lru", cacheTexture(preview, 24, 24));
  preview.maskTiles.set("mask:lru", cacheTexture(preview, 24, 24));
  assert.equal(preview.gpuAllocator.usedBytes(), 2 * 24 * 24 * 8);

  preview.gpuAllocator.setBudget(24 * 24 * 8);
  // The detail tile was registered first, so it is the LRU victim; the mask
  // tile survives, and the victim's texture is destroyed through its owner.
  assert.equal(preview.detailBandTiles.size, 0);
  assert.equal(preview.maskTiles.size, 1);
  assert.equal(preview.gpuAllocator.evictions, 1);
  assert.equal(preview.gpuAllocator.usedBytes(), 24 * 24 * 8);
  assert.equal(ledger.destroyed.length >= 1, true);
  assert.ok(preview.maskTiles.get("mask:lru").allocatorEntry);
});

test("calibrated Auto lowers the budget, adopts the allocator, and reports its source", () => {
  const { preview } = createPreview();
  preview.adapterInfo = {
    fallback: true, description: "software", vendor: "sw",
    limits: { maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 16384 },
  };
  const budget = preview.calibrateGpuBudget();
  assert.ok(budget);
  assert.equal(budget.budgetBytes, 512 * 1024 * 1024);
  assert.equal(budget.source, "software-adapter");
  assert.equal(preview.memoryBudgetBytes(), 512 * 1024 * 1024);
  assert.equal(preview.gpuAllocator.budgetBytes, 512 * 1024 * 1024);
  assert.equal(preview.diagnosticsSnapshot().resources.budget.calibration.source, "software-adapter");
});

test("an explicit budget setting outranks the calibration, and Auto returns to it", () => {
  const { preview } = createPreview();
  preview.adapterInfo = {
    fallback: true, description: "software", vendor: "sw",
    limits: { maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 16384 },
  };
  preview.calibrateGpuBudget();
  assert.equal(preview.setMemoryBudget(4), 4 * 1024 * 1024 * 1024);
  assert.equal(preview.gpuAllocator.budgetBytes, 4 * 1024 * 1024 * 1024);
  assert.equal(preview.setMemoryBudget("auto"), 512 * 1024 * 1024);
  assert.equal(preview.gpuAllocator.budgetBytes, 512 * 1024 * 1024);
});

test("a failed allocation probe downgrades Auto before a single preview is planned", () => {
  const { preview } = createPreview();
  preview.adapterInfo = {
    fallback: false, description: "full", vendor: "vendor",
    limits: { maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 16384 },
  };
  preview.probeGpuAllocation = () => false;
  const budget = preview.calibrateGpuBudget();
  assert.equal(budget.budgetBytes, 1024 * 1024 * 1024);
  assert.equal(budget.source, "probe-downgrade");
  assert.equal(preview.memoryBudgetBytes(), 1024 * 1024 * 1024);
  assert.equal(preview.gpuAllocator.budgetBytes, 1024 * 1024 * 1024);
});

test("the tiled working graph and the retained presentation are pinned reservations", () => {
  const { preview } = createPreview();
  const graph = preview.ensureTileGraph(64, 32, "rgba16float", "rgba16float", false, false);
  const target = preview.ensurePresentationTarget(64, 32, "rgba16float");
  assert.ok(graph);
  assert.ok(target);

  preview.gpuAllocator.setBudget(1);
  assert.ok(preview.gpuAllocator.entries.has(graph.allocatorEntry.id), "the tile graph must not be evicted");
  assert.ok(preview.gpuAllocator.entries.has(target.allocatorEntry.id), "the retained frame must not be evicted");
  assert.equal(preview.gpuAllocator.snapshot().overBudgetBytes > 0, true);
  assert.equal(preview.gpuAllocator.evictions, 0);

  const graphEntryId = graph.allocatorEntry.id;
  preview.destroyTileGraph();
  assert.equal(preview.gpuAllocator.entries.has(graphEntryId), false);
});

test("a detected card raises Auto to half its video memory, and a manual limit still wins", () => {
  const GIB = 1024 * 1024 * 1024;
  const { preview } = createPreview();
  preview.adapterInfo = {
    fallback: false, description: "lovelace", vendor: "nvidia",
    limits: { maxBufferSize: 2 * GIB, maxTextureDimension2D: 16384 },
  };
  preview.probeGpuAllocation = () => true;
  preview.setDetectedVideoMemory({ bytes: 12 * GIB, device: "NVIDIA GeForce RTX 4070 Ti" });
  assert.equal(preview.gpuBudget.source, "detected-vram");
  assert.equal(preview.memoryBudgetBytes(), 6 * GIB);
  assert.equal(preview.gpuAllocator.budgetBytes, 6 * GIB);
  // Admission plans against the calibrated Auto, not the 2 GiB fallback.
  assert.equal(preview.planRender(7968, 5320).budgetBytes, 6 * GIB);
  assert.equal(preview.minimumExecutionDecision(7968, 5320) !== null, true);
  // A lower manual limit overrides Auto, and returning to Auto restores it.
  assert.equal(preview.setMemoryBudget(1), GIB);
  assert.equal(preview.setMemoryBudget("auto"), 6 * GIB);
});
