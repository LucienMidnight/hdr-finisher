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

// Kept in step with webgpu-preview.js, where 160 and 161 carry the tile origin.
const PARAM_COUNT = 166;

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
