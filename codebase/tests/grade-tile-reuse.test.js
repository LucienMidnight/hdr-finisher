const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");
const { frontendSource } = require("./frontend-source.js");
const { HDRTileScheduler } = require("../frontend/tile-scheduler.js");
const { HDRWebGPUShaders } = require("../frontend/webgpu-shaders.js");

async function reusesTiles(change) {
  const window = { HDRWebGPUShaders, HDRGraphScale: require("../frontend/graph-scale.js").HDRGraphScale };
  const context = vm.createContext({ window, HDRHSL: require("../frontend/hsl-engine.js").HDRHSL });
  vm.runInContext(frontendSource("webgpu-preview.js"), context);
  const frame = { sessionId: "test", lane: "hdr", geometrySignature: "{}",
    execution: "tiled", format: "rgba16float", width: 256, height: 128,
    applicationGeneration: 7, tileRevision: 11 };
  const renderer = Object.assign(Object.create(window.HDRWebGPUPreview.prototype), {
    graphActivity: () => ({}),
    adaptiveDenoiseFor: () => false,
    composedTileHalo: () => ({ halo: 0 }),
    tileViewportRequest: () => ({ fit: true }),
    memoryBudgetBytes: () => 2 ** 27,
    presentationTarget: { valid: true },
    lastPresentedFrame: frame,
  });
  const proxy = { identity: "source", width: frame.width, height: frame.height };
  const params = new Float32Array(require("../frontend/gpu-param-layout.js").HDRGpuParamLayout.count);
  const options = { sessionId: "test", gradePreview: true, applicationGeneration: "7", editRevision: 12,
    Scheduler: HDRTileScheduler, roiCatchUp: true };
  const scheduler = renderer.tileScheduler = new HDRTileScheduler();
  const plan = scheduler.plan.bind(scheduler);
  const planned = new Error("stop before GPU allocation");
  async function planFrame(packed, request) {
    let plannedTiles;
    scheduler.plan = (input) => { plannedTiles = plan(input); throw planned; };
    await assert.rejects(renderer.encodeTiledGeneration({}, {}, proxy, { format: frame.format }, {}, packed, request),
      error => error === planned);
    return plannedTiles;
  }
  const beforeParams = new Float32Array(params);
  const before = await planFrame(beforeParams, { ...options, roiCatchUp: false, editRevision: frame.tileRevision });
  frame.gradeTileParams = beforeParams;
  for (const tile of before.tiles) scheduler.acceptTile(tile.key, before.generation);
  change?.({ renderer, proxy, params, options });
  const after = await planFrame(params, options);
  assert.equal(scheduler.isVisibleSetComplete(after, after.generation), !change);
  return after.identity === before.identity;
}

test("catch-up reuses tiles when the saved revision is the only change", async () => {
  assert.equal(await reusesTiles(), true);
});

const changedInputs = {
  parameters: ({ params }) => { params[0] = 1; },
  locals: ({ options }) => { options.activeLocals = [{ id: "local", hdr_grade: {} }]; },
  denoise: ({ renderer, proxy }) => { renderer.denoiseSourceSelector = { identity: proxy.identity,
    selected: "resolved", original: proxy, cache: { settings: { levels: 1 } } }; },
  dimensions: ({ proxy }) => { proxy.width = 255; },
  generation: ({ options }) => { options.applicationGeneration = 8; },
};

for (const [input, change] of Object.entries(changedInputs)) {
  test(`catch-up cannot reuse the previous tile revision with changed ${input}`, async () => {
    assert.equal(await reusesTiles(change), false);
  });
}
