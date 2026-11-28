const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { frontendSource } = require("./frontend-source.js");

const source = frontendSource("webgpu-preview.js");
const graphScaleSource = frontendSource("graph-scale.js");
const shaderSource = frontendSource("webgpu-shaders.js");
const context = vm.createContext({
  window: {},
  performance: { now: () => 1 },
  console,
});
vm.runInContext(graphScaleSource, context);
vm.runInContext(shaderSource, context);
vm.runInContext(source, context);
const Preview = context.window.HDRWebGPUPreview;

for (const [name, options] of [
  ["bypass", {}],
  ["method replacement", { selectOriginal: false, replaceMethod: true }],
]) {
  test(`committed Denoise ${name} retires only Denoise pixels before the next render`, async () => {
    const preview = new Preview(null);
    const released = [];
    const texture = label => ({ destroy: () => released.push(label) });
    let finishGpuWork;
    const fence = new Promise(resolve => { finishGpuWork = resolve; });
    preview.device = { queue: { onSubmittedWorkDone: () => fence } };
    const original = { texture: texture("source") };
    const accepted = { texture: texture("accepted") };
    preview.proxies.set("source", original);
    preview.lastPresentedFrame = accepted;
    const warmModel = preview.denoiseModelWarm = {};
    const selector = preview.denoiseSourceSelector = {
      selected: "resolved", original,
      resolved: { texture: texture("resolved") },
      cache: { adaptiveScratch: { textures: { current: texture("scratch") } } },
    };
    preview.denoiseTiles.set("old-token", { texture: texture("old-token") });
    preview.denoiseTiles.set("unmarked-endpoint", { texture: texture("endpoint"), endpoints: true });
    preview.fineGrainReduced = new Map([["old-reduced", { texture: texture("reduced") }]]);

    preview.selectDenoiseSelectorSource(false);
    preview.selectDenoiseSelectorSource(true);
    preview.cancelDenoiseProcessing({ selectOriginal: false });
    assert.equal(preview.denoiseSourceSelector, selector);
    assert.deepEqual(released, []);

    preview.activeRenderCount = 1;
    preview.cancelDenoiseProcessing(options);
    assert.equal(preview.denoiseSourceSelector, null);
    assert.equal(preview.denoiseTiles.size, 0);
    assert.equal(preview.fineGrainReduced.size, 0);
    assert.deepEqual(released, []);
    let rendered = false;
    preview.renderToFrame = () => { rendered = true; };
    const next = preview.renderTo({});
    preview.finishActiveRender();
    await Promise.resolve();
    assert.equal(rendered, false);
    assert.deepEqual(released.sort(), ["endpoint", "old-token", "reduced", "resolved", "scratch"]);
    finishGpuWork();
    await next;
    assert.equal(rendered, true);
    assert.equal(preview.proxies.get("source"), original);
    assert.equal(preview.lastPresentedFrame, accepted);
    assert.equal(preview.denoiseModelWarm, warmModel);
  });
}

test("direct model reproduces the approved two-level 24MP logical baseline", () => {
  const model = Preview.directPreviewMemoryModel(6000, 4000);

  assert.equal(model.pixelCount, 24_000_000);
  assert.equal(model.categories.sourceBytes, 24_000_000 * 8);
  assert.equal(model.categories.gradingBytes, 24_000_000 * 8 * 4);
  assert.equal(model.categories.detailBytes, 24_000_000 * 8 * 2);
  assert.equal(model.categories.spatialBytes, 1500 * 1000 * 8 * 2);
  assert.equal(model.categories.denoiseEvidenceBytes, 180_000_000);
  assert.equal(model.categories.denoiseReconstructionScratchBytes, 48_000_000);
  assert.equal(model.categories.denoiseResolvedBytes, 192_000_000);
  assert.equal(model.plannedBytes, 1_788_000_000);
  assert.equal(model.peakLogicalBytes, model.plannedBytes);
});

test("static models are named and deterministic for 24MP, 42MP, and 8K", () => {
  const first = Preview.staticPreviewMemoryModels();
  const second = Preview.staticPreviewMemoryModels();

  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.deepEqual(JSON.parse(JSON.stringify(first.map(({ id, width, height }) => [id, width, height]))), [
    ["24MP", 6000, 4000],
    ["42MP", 7000, 6000],
    ["8K UHD", 7680, 4320],
  ]);
  assert.ok(first.every((entry) => entry.peakLogicalBytes > entry.residentBytes));
});

test("live diagnostics count all four grading textures and separate byte lifetimes", () => {
  const preview = new Preview(null);
  const canvas = {};
  preview.intermediates.set(canvas, {
    width: 400,
    height: 200,
    baseTexture: {},
    filmTexture: {},
    finishTexture: {},
    localTexture: {},
    detailATexture: {},
    detailBTexture: {},
    spatialATexture: {},
    spatialBTexture: {},
    compositeParamBuffer: { size: 256 },
  });
  preview.proxies.set("source", { byteSize: 640_000 });
  preview.sceneLuminance.set("luma", { byteSize: 160_000 });
  preview.localMasks.set("mask", { byteSize: 80_000, kind: "gpu-mask-graph" });
  preview.scopeResources.set("scope", [{ byteSize: 4096 }]);
  preview.localParamBuffers.set("local", { size: 128 });
  preview.paramBuffer = { size: 1024 };
  preview.curveBuffer = { size: 2048 };
  preview.denoiseSourceSelector = {
    cache: { byteSize: 32_000, textureCount: 6, levels: [{}, {}] },
    resolved: { byteSize: 640_000 },
  };
  preview.performanceMetrics.presentations.push({ width: 400, height: 200 });

  const resources = preview.diagnosticsSnapshot().resources;
  const expectedGrading = (400 * 200 * 8 * 4)
    + (400 * 200 * 8 * 2)
    // A frame under 2048 px holds its spatial pair at full resolution.
    + (400 * 200 * 8 * 2);
  assert.equal(resources.gradingIntermediateBytes, expectedGrading);
  assert.equal(resources.memory.resident.categories.gradingCoreBytes, 400 * 200 * 8 * 4);
  assert.equal(resources.memory.resident.categories.gradingDetailBytes, 400 * 200 * 8 * 2);
  assert.equal(resources.memory.cached.totalBytes, 640_000 + 160_000 + 80_000 + 32_000);
  assert.equal(resources.memory.retainedPresentationOverlapBytes, 400 * 200 * 8);
  assert.equal(
    resources.memory.peakLogicalBytes,
    resources.memory.resident.totalBytes + resources.memory.retainedPresentationOverlapBytes,
  );
  assert.equal(resources.memory.transient.totalBytes, 0);
  assert.equal(resources.memory.transient.complete, true);
});

test("memory model includes retained-presentation overlap only in peak", () => {
  const model = Preview.directPreviewMemoryModel(1024, 512, {
    detailActive: false,
    spatialActive: false,
    denoiseLevels: 0,
    retainedPresentationOverlapBytes: 1024 * 512 * 8,
  });

  assert.equal(model.residentBytes, 1024 * 512 * 8 * 5);
  assert.equal(model.transientBytes, 0);
  assert.equal(model.cachedBytes, 1024 * 512 * 8);
  assert.equal(model.peakLogicalBytes, model.residentBytes + model.retainedPresentationOverlapBytes);
});

const HDRGrainRoute = require("../frontend/grain-route");
context.HDRGrainRoute = HDRGrainRoute;
context.GPUTextureUsage = { COPY_DST: 1, COPY_SRC: 2, STORAGE_BINDING: 4, TEXTURE_BINDING: 8 };
vm.runInContext(frontendSource("gpu-allocator.js"), context);

const ceiling = 4_000_000_000;
function sample(preview, id, bytes, measurement = "physical-footprint") {
  preview.acceptGrainMemorySample({ sampleId: id, ceilingBytes: ceiling, totalBytes: bytes,
    reservedBytes: 0, unifiedMemory: true, measurement });
}

test("Grade charges the soft and sharp swaps once, including during parking and the next census", () => {
  const base = { width: 2000, height: 1000 };
  const sharp = { width: 1000, height: 800, hdrGrainLayer: {} };
  const preview = new Preview(base);
  preview.gpuAllocator = new context.window.HDRGpuAllocator({ budgetBytes: 2 ** 30 });
  preview.presentationTarget = { byteSize: 6_400_000 };
  preview.noteGradeCanvasSwap(base, "bgra8unorm");
  sample(preview, 1, 3_000_000_000);
  const baselineBytes = preview.grainMemorySample.gpuBytes;
  preview.noteGradeCanvasSwap(sharp, "rgba16float");
  const baseBytes = base.width * base.height * 4 * 3;
  const sharpBytes = sharp.width * sharp.height * 8 * 3;
  assert.equal(preview.cachedGrainCanvasBytes(), sharpBytes);
  const { categories } = preview.resourceMemorySnapshot().resident;
  assert.equal(categories.canvasSwapBytes, baseBytes + sharpBytes);
  assert.equal(categories.presentationSurfaceBytes, preview.presentationTarget.byteSize);
  assert.equal(preview.grainMemorySnapshot().app_headroom_bytes, 1_000_000_000 - sharpBytes);

  sharp.hdrGrainLayer.entry = preview.gpuAllocator.register({ kind: "grain-preview-layer", bytes: sharpBytes });
  assert.equal(preview.grainMemorySnapshot().app_headroom_bytes, 1_000_000_000 - sharpBytes);
  sample(preview, 1, 3_000_000_000);
  assert.equal(preview.grainMemorySample.gpuBytes, baselineBytes, "the same census does not swallow new GPU bytes");
  sample(preview, 2, 3_000_000_000 + sharpBytes);
  assert.equal(preview.grainMemorySnapshot().app_headroom_bytes, 1_000_000_000 - sharpBytes);
  sample(preview, 3, 3_000_000_000, "proportional-resident");
  assert.equal(preview.grainMemorySnapshot().app_headroom_bytes,
    1_000_000_000 - baseBytes - sharpBytes - preview.presentationTarget.byteSize);
});

test("Grade checks native source growth before starting an upload and rechecks the census after draining", async () => {
  for (const [width, height] of [[7952, 5304], [9504, 6336], [11648, 8736]]) {
    const events = [];
    const canvas = { width: 2000, height: 1000, getContext: () => ({}) };
    const preview = new Preview(canvas);
    preview.available = preview.observeGradeMemory = true;
    preview.sessionId = "photo";
    preview.noteGradeCanvasSwap(canvas, "bgra8unorm");
    const visible = preview.lastPresentedFrame = {};
    const target = preview.presentationTarget = { byteSize: 8_000_000, valid: true };
    preview.memoryBudgetBytes = () => 2 ** 31;
    preview.loadProxy = () => { events.push("upload"); return null; };
    preview.reclaimGrainResources = () => events.push("reclaim");
    preview.waitForSubmittedWork = async () => events.push("drain");
    const render = () => preview.renderToFrame(canvas, "photo", "hdr", { hdr: {} }, null,
      width, [], 0, null, 203, { width, height }, { frameSize: { width, height } });

    sample(preview, 1, 3_700_000_000);
    preview.refreshGrainMemorySample = async () => {
      events.push("census");
      sample(preview, 2, 3_800_000_000);
    };
    assert.equal(await render(), false);
    assert.equal(preview.lastRenderRefusal.reason, "app-memory-ceiling");
    assert.deepEqual(events, ["reclaim", "drain", "census"]);
    assert.equal(preview.lastPresentedFrame, visible);
    assert.equal(preview.presentationTarget, target);
    assert.deepEqual([canvas.width, canvas.height], [2000, 1000]);

    events.length = 0;
    preview.refreshGrainMemorySample = async () => {
      events.push("census");
      sample(preview, 3, 1_500_000_000);
    };
    await render();
    assert.deepEqual(events, ["reclaim", "drain", "census", "upload"]);
  }
});

test("the tiled shared-memory refusal leaves the visible canvas and target untouched", async () => {
  const canvas = { width: 2000, height: 1000 };
  const preview = new Preview(canvas);
  const visible = preview.lastPresentedFrame = {};
  const target = preview.presentationTarget = { byteSize: 8_000_000, valid: true };
  preview.noteGradeCanvasSwap(canvas, "bgra8unorm");
  preview.graphActivity = () => ({});
  preview.composedTileHalo = () => ({ halo: 0 });
  preview.tileViewportRequest = () => ({ fit: true });
  preview.memoryBudgetBytes = () => 2 ** 31;
  const events = [];
  preview.ensurePresentationTarget = () => { throw Error("visible target was replaced"); };
  preview.ensureTileGraph = () => { throw Error("graph was allocated"); };
  preview.waitForSubmittedWork = async () => events.push("drain");
  preview.refreshGrainMemorySample = async () => {
    events.push("census");
    sample(preview, 2, 4_010_000_000);
  };
  sample(preview, 1, 4_020_000_000);
  class Scheduler { plan() { return { tiles: [] }; } }
  Scheduler.DEFAULT_TILE_SIZE = 512;
  const result = await preview.encodeTiledGeneration(canvas, {}, { width: 9504, height: 6336 },
    { format: "rgba16float" }, {}, new Float32Array(1024), { Scheduler, gradeMemory: true });
  assert.equal(result.appMemoryRefused, true);
  assert.deepEqual(events, ["drain", "census"]);
  assert.equal(preview.lastPresentedFrame, visible);
  assert.equal(preview.presentationTarget, target);
  assert.equal(target.valid, true);
  assert.deepEqual([canvas.width, canvas.height], [2000, 1000]);
});

test("Denoise tiles already used by the visible frame still obey the retention allowance", () => {
  const preview = new Preview(null);
  const destroyed = [];
  preview.denoiseTileBudget = () => 100;
  preview.fineGrainReducedBytes = () => 16;
  preview.device = { createTexture: () => ({ destroy() {} }) };
  for (const key of ["old", "onscreen-1", "onscreen-2"]) {
    preview.denoiseTiles.set(key, { byteSize: 64, texture: { destroy: () => destroyed.push(key) } });
  }
  preview.presentedDenoiseTileKeys = new Set(["onscreen-1", "onscreen-2"]);
  assert.equal(preview.trimDenoiseTiles(["onscreen-1", "onscreen-2"]), 64);
  assert.deepEqual(destroyed, ["old", "onscreen-1"]);
  assert.deepEqual([...preview.denoiseTiles.keys()], ["onscreen-2"]);
  preview.activeRenderCount = 1;
  assert.equal(preview.denoiseTile("scratch-only", 4, 4), null);
  const endpoint = preview.denoiseTile("endpoint", 4, 4, true, true);
  assert.equal(endpoint.transient, true);
  assert.deepEqual([...preview.denoiseTiles.keys()], ["onscreen-2"]);
});

test("a tiled memory preflight can drain and release rebuildable Denoise tiles without releasing the picture", async () => {
  const preview = new Preview(null);
  const target = preview.presentationTarget = { byteSize: 16, valid: true };
  preview.activeRenderCount = 1;
  const events = [];
  preview.denoiseTiles.set("shown", { byteSize: 24, texture: { destroy: () => events.push("release-tile") } });
  preview.presentedDenoiseTileKeys = new Set(["shown"]);
  sample(preview, 1, ceiling + 1);
  preview.waitForSubmittedWork = async () => events.push("drain");
  preview.refreshGrainMemorySample = async () => {
    events.push("census");
    sample(preview, 2, ceiling - 16);
  };
  assert.equal(await preview.admitGradeMemory("tiled-preview", () => 8), true);
  assert.deepEqual(events, ["drain", "release-tile", "census"]);
  assert.equal(preview.denoiseTiles.size, 0);
  assert.equal(preview.presentationTarget, target);
  assert.equal(target.valid, true);
});
