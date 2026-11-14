const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { frontendSource, declarations } = require('./frontend-source.js');
const { HDRGpuParamLayout } = require('../frontend/gpu-param-layout.js');

const context = vm.createContext({ window: {}, performance: { now: () => 0 }, console });
vm.runInContext(frontendSource('graph-scale.js'), context);
vm.runInContext(frontendSource('webgpu-shaders.js'), context);
vm.runInContext(frontendSource('webgpu-preview.js'), context);
const Preview = context.window.HDRWebGPUPreview;
const indices = HDRGpuParamLayout.indices;

test('lens glow identity ignores only Strength and follows source, lane and upstream edits', () => {
  const preview = new Preview(null);
  let source = 'source-a';
  preview.highlightSourceToken = () => source;
  const proxy = { identity: 'proxy-a', width: 1200, height: 800 };
  const recipe = { hdr: { exposure: 0, film_look: { lens_strength: .125, lens_size: 1 } },
    sdr: { exposure: 0, film_look: { lens_strength: .125, lens_size: 1 } } };
  const params = new Float32Array(HDRGpuParamLayout.count);
  const key = () => preview.lensGlowCacheKey(proxy, 'sdr', recipe, [], params);
  const original = key();
  recipe.sdr.film_look.lens_strength = 2;
  assert.equal(key(), original);
  for (const edit of [() => { recipe.sdr.exposure = 1; },
    () => { recipe.sdr.film_look.lens_size = 2; },
    () => { proxy.width = 900; }, () => { source = 'denoise-b'; },
    () => { params[indices.HIGHLIGHT_ANCHOR] = 5; }]) {
    const before = key();
    edit();
    assert.notEqual(key(), before);
  }
  assert.notEqual(preview.lensGlowCacheKey(proxy, 'hdr', recipe, [], params), key());
});

test('lens cache skips only the summed glow and grain quality changes only the finish pass', () => {
  const preview = new Preview(null);
  const texture = name => ({ name, createView: () => name });
  const graph = Object.fromEntries(['film', 'finish', 'spatialA', 'spatialB', 'lensGlow']
    .map(name => [name + 'Texture', texture(name)]));
  graph.spatialGrid = 4;
  const passes = [];
  let copies = 0;
  const encoder = { beginRenderPass: () => ({ setViewport() {}, setScissorRect() {},
    setPipeline: pipeline => passes.push(pipeline), setBindGroup() {}, draw() {}, end() {} }),
    copyTextureToTexture: () => { copies++; } };
  const pipelines = Object.fromEntries(['response', 'lensExtract', 'lensHorizontal', 'lensVertical', 'lens',
    'scatter', 'finish', 'finishInteractive', 'scan', 'structure', 'extract', 'blurHorizontal', 'blurVertical']
    .map(name => [name, name]));
  const params = new Float32Array(HDRGpuParamLayout.count);
  for (const field of ['FILM_RESPONSE_ENABLED', 'FILM_LOOK_STRENGTH', 'LENS_FILTER', 'LENS_SCATTER', 'FILM_RESOLUTION', 'HALATION_ENABLED']) params[indices[field]] = 1;
  const render = interactive => preview.encodeFilmChain(encoder, pipelines, graph, 'original', () => ({}),
    params, 1200, 800, { lensGlowKey: 'same', interactive });
  assert.equal(render(true), true);
  assert.equal(passes.filter(pass => pass === 'lensVertical').length, 27);
  assert.ok(passes.includes('finishInteractive'));
  assert.equal(copies, 1);
  graph.lensGlowKey = 'same';
  passes.length = 0;
  assert.equal(render(false), true);
  assert.ok(!passes.includes('lensVertical'));
  assert.ok(passes.includes('blurVertical'));
  assert.ok(passes.includes('finish'));
  assert.ok(!passes.includes('finishInteractive'));
  assert.equal(copies, 1);
  preview.encodeFilmChain(encoder, pipelines, graph, 'original', () => ({}), params, 1200, 800);
  assert.equal(graph.lensGlowKey, 'same');
  assert.equal(copies, 1);
  params[indices.LENS_SCATTER] = 0;
  assert.equal(render(false), false);
});

test('lens glow is charged to existing resident GPU admission', () => {
  const options = { spatialActive: true, denoiseLevels: 0 };
  const baseline = Preview.directPreviewMemoryModel(1200, 800, options);
  const cached = Preview.directPreviewMemoryModel(1200, 800, { ...options, lensGlowCache: true });
  assert.equal(cached.plannedBytes - baseline.plannedBytes, baseline.categories.spatialBytes / 2);
  const plan = Preview.buildRenderPlan({ width: 1200, height: 800, ...options, lensGlowCache: true });
  assert.equal(plan.entries.find(entry => entry.id === 'lens-glow').bytes, cached.categories.lensGlowBytes);
});

test('presentation records processing resolution and never accepts drag grain as settled', () => {
  const state = { currentView: 'sdr', previewGeneration: { hdr: 1, sdr: 1 }, zoomMode: 'fit',
    adjustments: { shared: { geometry: {} } } };
  let requiredEdge = 1200;
  const ui = vm.createContext({ state, Number, Math, normalizedPreviewResolution: () => 'display',
    requiredProcessingLongEdge: () => requiredEdge, geometrySignature: () => '{}',
    applyZoomGeometry() {}, renderCurrentPreviewSize() {}, renderReadouts() {},
    scheduleNavigationThumbnail() {}, finishPerspectivePresentation() {}, renderViewerStatus() {},
    refreshScopesAfterPresentation() {} });
  vm.runInContext(declarations('acceptPresentation') + '\nglobalThis.accept = acceptPresentation;', ui);
  ui.accept('sdr', 'interactive', 1200, 800, 'WebGPU', '', null, 1, 'direct', 1200, null, false, true);
  assert.equal(state.acceptedPresentation.exact, false);
  assert.equal(state.acceptedPresentation.approximate, true);
  ui.accept('sdr', 'settled', 1200, 800, 'WebGPU', '', null, 1, 'direct', 1200);
  assert.equal(state.acceptedPresentation.exact, true);
  assert.equal(state.acceptedPresentation.approximate, false);
  requiredEdge = 4096;
  for (const [width, processedEdge, exact] of [[4011, 4096, true], [4011, 8192, false],
    [4011, 2048, false], [4096, null, true], [0, null, false]]) {
    ui.accept('sdr', 'settled', width, width / 2, 'WebGPU', '', null, 1, 'direct', processedEdge);
    assert.equal(state.acceptedPresentation.exact, exact);
    assert.equal(state.acceptedPresentation.processedLongEdge, processedEdge || width);
  }
});
