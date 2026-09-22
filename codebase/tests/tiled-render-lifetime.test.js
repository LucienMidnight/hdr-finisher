const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../frontend/webgpu-preview.js"),
  "utf8",
);

function loadPreview() {
  const context = vm.createContext({
    window: { HDRTileScheduler: { DEFAULT_TILE_SIZE: 512 } },
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
  const canvas = {};
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
