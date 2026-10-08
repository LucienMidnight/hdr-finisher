const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { frontendSource } = require("./frontend-source.js");

const source = frontendSource("webgpu-preview.js");
// The renderer's halo math is the declared processing-scale contract, which the
// page loads as its own script. The harness mirrors that script set.
const graphScaleSource = frontendSource("graph-scale.js");
const shaderSource = frontendSource("webgpu-shaders.js");

function loadPreview() {
  const context = vm.createContext({
    window: { HDRTileScheduler: { DEFAULT_TILE_SIZE: 512 } },
    // The renderer inspects the surface before it requests a source, because
    // a retained frame's format decides whether a region fetch is safe.
    navigator: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
    performance: { now: () => Date.now() },
    console,
    fetch: async () => { throw new Error("unexpected fetch"); },
    GPUTextureUsage: {
      COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
    },
    GPUBufferUsage: {
      MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512,
    },
  });
  vm.runInContext(graphScaleSource, context);
  vm.runInContext(shaderSource, context);
  vm.runInContext(source, context);
  return context.window.HDRWebGPUPreview;
}

test("direct renderTiledTo calls retain resources until their async lifetime ends", async () => {
  const Preview = loadPreview();
  const preview = new Preview(null);
  preview.available = true;
  preview.device = {};
  let rejectProxy;
  preview.loadProxy = () => new Promise((_resolve, reject) => { rejectProxy = reject; });
  const canvas = { getContext: () => ({ configure() {} }) };
  const adjustments = { shared: { geometry: {} } };

  const render = preview.renderTiledTo(canvas, "session", "hdr", adjustments, null);
  assert.equal(preview.activeRenderCount, 1);
  let destroyed = false;
  preview.destroyAfterActiveRenders(() => { destroyed = true; });
  assert.equal(destroyed, false);

  rejectProxy(new Error("synthetic proxy failure"));
  await assert.rejects(render, /synthetic proxy failure/);

  assert.equal(preview.activeRenderCount, 0);
  assert.equal(destroyed, true);
  assert.equal(preview.deferredDestroy.length, 0);
});

test("pressure eviction retains referenced mask and detail textures until renders and scopes drain", () => {
  const preview = new (loadPreview())(null);
  const destroyed = [];
  for (const [kind, cache] of [["mask-tile", preview.maskTiles], ["detail-band-tile", preview.detailBandTiles]]) {
    cache.set(kind, { texture: { destroy: () => destroyed.push(kind) } });
  }
  preview.activeRenderCount = 2;
  preview.activeScopeCount = 1;
  preview.evictGpuCacheEntry("mask-tile", "mask-tile");
  preview.evictGpuCacheEntry("detail-band-tile", "detail-band-tile");
  assert.equal(preview.maskTiles.size, 0);
  assert.equal(preview.detailBandTiles.size, 0);
  assert.deepEqual(destroyed, []);
  preview.finishActiveRender();
  preview.finishActiveRender();
  assert.deepEqual(destroyed, []);
  preview.activeScopeCount = 0;
  preview.flushDeferredDestroy();
  assert.deepEqual(destroyed, ["mask-tile", "detail-band-tile"]);
  preview.flushDeferredDestroy();
  assert.equal(destroyed.length, 2);
  preview.maskTiles.set("idle", { texture: { destroy: () => destroyed.push("idle") } });
  preview.evictGpuCacheEntry("mask-tile", "idle");
  assert.equal(destroyed.at(-1), "idle");
});

test("cache replacement and local trimming retain textures used by an active render", () => {
  const preview = new (loadPreview())(null);
  let destroyed = 0;
  const entry = () => ({byteSize: 100, texture: {destroy: () => destroyed++}});
  preview.activeRenderCount = 1;
  preview.releaseGpuCacheValue("mask-tile", entry());
  preview.releaseGpuCacheValue("detail-band-tile", entry());
  preview.cacheBudgetBytes = () => 0;
  preview.maskTiles.set("mask", entry());
  preview.detailBandTiles.set("detail", entry());
  assert.equal(preview.trimMaskTiles(), 0);
  assert.equal(preview.trimDetailBandTiles(), 0);
  assert.equal(destroyed, 0);
  preview.finishActiveRender();
  assert.equal(destroyed, 4);
});
