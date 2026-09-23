const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../frontend/webgpu-preview.js"),
  "utf8",
);
const graphScaleSource = fs.readFileSync(
  path.join(__dirname, "../frontend/graph-scale.js"),
  "utf8",
);
const context = vm.createContext({
  window: {},
  performance: { now: () => 1 },
  console,
});
vm.runInContext(graphScaleSource, context);
vm.runInContext(source, context);
const Preview = context.window.HDRWebGPUPreview;

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
    + (100 * 50 * 8 * 2);
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
