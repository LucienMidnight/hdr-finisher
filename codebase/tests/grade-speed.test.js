const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { frontendSource, declarations } = require('./frontend-source.js');
const { HDRGpuParamLayout } = require('../frontend/gpu-param-layout.js');

const context = vm.createContext({ window: {}, performance: { now: () => 0 }, console,
  GPUTextureUsage: { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 },
  GPUBufferUsage: { STORAGE: 1, COPY_DST: 2 } });
vm.runInContext(frontendSource('graph-scale.js'), context);
vm.runInContext(frontendSource('webgpu-shaders.js'), context);
vm.runInContext(frontendSource('webgpu-preview.js'), context);
const Preview = context.window.HDRWebGPUPreview;
const indices = HDRGpuParamLayout.indices;

test('only interactive and coarse requests reduce grain, never delivery or measurement', () => {
  for (const request of [{ tier: 'interactive' }, { tier: 'refinement', coarse: true }, { tier: 'settled', coarse: true }]) {
    assert.equal(Preview.usesDraftGrain(request), true);
    assert.equal(Preview.usesDraftGrain({ ...request, delivery: { texture: {} } }), false);
    assert.equal(Preview.usesDraftGrain({ ...request, measureOnly: true }), false);
  }
  for (const request of [{}, { tier: 'settled' }, { tier: 'refinement' }, { tier: 'refinement', panPass: true },
    { tier: 'refinement', roiCatchUp: true }]) assert.equal(Preview.usesDraftGrain(request), false);
});

test('scheduled coarse requests reach the renderer without downgrading settled requests', async () => {
  const requests = [];
  const state = { currentView: 'hdr', session: { session_id: 'grain-test', source: { width: 7968, height: 5320 } },
    previewGeneration: { hdr: 1 }, gpuDraftRefusals: {}, adjustments: {},
    denoise: { hdr: { enabled: false, controls: {} } }, denoiseRuntime: { hdr: {} },
    gpuPreview: { render: async (...args) => { requests.push(args.at(-1)); return null; } } };
  const ui = vm.createContext({ state, performance, geometryDraftActive: () => false,
    gpuPreviewEligible: () => true, geometrySignature: () => '{}', localsBypassed: () => true,
    gpuLumaMaskOverlayOptions: () => null, gpuFrameSizeAt: () => ({ width: 1024, height: 683 }),
    denoiseNoiseViewActive: () => false, sampleCurvePoints() {}, projectReferenceWhiteNits: () => 203,
    gradeGrainAction: () => null, resolveGpuViewport: async () => ({ frameSize: { width: 1024, height: 683 }, viewport: null }), window: { HDRViewportRequest: { covers: () => false } }, liveGradeGrainSelected: () => null, nativeGeometryViewportActive: () => null, nativeDenoiseViewport: () => null, els: { previewCanvas: { style: {} } }, gradeSourceIdentity: () => null, cancelGeometryUnderlayer: () => null });
  vm.runInContext(declarations('renderGpuDraftInner', 'renderGpuDraftForView') + '\nglobalThis.render = renderGpuDraftInner;', ui);
  for (const request of [{ tier: 'refinement', coarse: true }, { tier: 'interactive' }, { tier: 'settled' }]) {
    await ui.render('hdr', { ...request, longEdge: 1024 });
    const actual = requests.at(-1);
    assert.equal(actual.coarse, Boolean(request.coarse));
    assert.equal(actual.tier, request.tier);
    assert.equal(Preview.usesDraftGrain(actual), request.tier !== 'settled');
  }
  assert.equal(requests.length, 3);
});

test('lens glow identity follows its source and kernel and ignores downstream edits', () => {
  const preview = new Preview(null);
  const proxy = { identity: 'proxy-a', texture: {}, sourceEpoch: 1, width: 1200, height: 800 };
  const recipe = { shared: { geometry: {} }, hdr: { exposure: 0 }, sdr: { exposure: 0, film_look: {} } };
  const params = new Float32Array(HDRGpuParamLayout.count);
  const key = () => preview.lensGlowCacheKey(proxy, 'sdr', recipe, [], params);
  const original = key();
  Object.assign(recipe.sdr.film_look, { lens_strength: 2, grain_amount: 45, halation_amount: 6, film_stock: 'kodak_portra_400' });
  params[indices.LENS_SCATTER] = 0.6;
  params[indices.HIGHLIGHT_ANCHOR] = 5;
  assert.equal(key(), original);
  for (const edit of [
    () => { recipe.sdr.exposure = 1; },
    () => { params[indices.LENS_SIZE] = 2; },
    () => { params[indices.LENS_FILTER] = 3; },
    () => { params[indices.FILM_GATE_HEIGHT_MM] = 7.41; },
    () => { proxy.width = 900; },
    () => { params[indices.SOURCE_PIXEL_SCALE] = 0.5; },
    () => { recipe.shared.geometry.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }; },
    () => { proxy.region = { x: 128, y: 0, width: 500, height: 500 }; },
    () => { proxy.sourceEpoch += 1; },
    () => { proxy.texture = {}; },
    () => { params[indices.TONE_PEAK] = 1; },
    () => { params[indices.PROJECT_REFERENCE_WHITE_NITS] = 100; },
    () => { recipe.sdr.linked_to_hdr = true; params[indices.LINKED_SDR] = 1; },
  ]) {
    const before = key();
    edit();
    assert.notEqual(key(), before);
  }
  assert.notEqual(preview.lensGlowCacheKey(proxy, 'hdr', recipe, [], params), key());
});

test('tiled Mist follows Denoise refresh, fit and the live reconstruction recipe', () => {
  const preview = new Preview(null);
  const controls = { amount: 0.75 };
  const selector = { cache: { identity: 'model-1', grain: { fitKey: 'fit-1' } } };
  const options = {};
  const key = () => JSON.stringify(preview.lensGlowDenoiseKey(selector, controls, options));
  for (const edit of [() => { selector.cache.identity = 'model-2'; },
    () => { selector.cache.grain.fitKey = 'fit-2'; }, () => { controls.amount = 0.5; },
    () => { options.microQuick = true; }, () => { options.quickCpuGrain = true; }]) {
    const before = key();
    edit();
    assert.notEqual(key(), before);
  }
});

test('Direct Mist follows an in-place CPU Grain settlement and its source epoch', async () => {
  const preview = new Preview(null);
  const texture = {};
  const original = { width: 64, height: 64, sourceEpoch: 4 };
  const selector = { original, resolved: { texture }, selected: 'resolved',
    cache: { grain: { token: 'native', controls: { amount: 0.75, luminance: 0.5, colorNoise: 0.75, detailRecovery: 0.5 } } } };
  preview.denoiseSourceSelector = selector;
  preview.ensureAdaptiveDenoisePipelines = async () => {};
  const routes = [];
  preview.preparedGrainTile = async () => ({});
  preview.encodeAdaptiveDenoise = () => { routes.push('wavelet'); return { dispatches: 1, tiles: 1 }; };
  preview.encodePreparedDenoise = () => { routes.push('prepared'); return { dispatches: 1, tiles: 1 }; };
  preview.device = { createCommandEncoder: () => ({ finish() {} }), queue: { submit() {}, async onSubmittedWorkDone() {} } };
  const key = () => JSON.stringify(preview.lensGlowSourceKey(selector.resolved, false));
  const resolve = quick => preview.resolveAdaptiveDenoise(selector, [0.75, 0.5, 0.75, 0.5], {},
    preview.denoiseSelectorGeneration, 0, null, null, null, original, () => true, null, quick);
  assert.equal(await resolve(true), true);
  const underlayer = key();
  assert.equal(await resolve(false), true);
  assert.deepEqual(routes, ['wavelet', 'prepared']);
  assert.equal(selector.resolved.texture, texture);
  assert.equal(selector.resolved.sourceEpoch, 4);
  const settled = key();
  assert.notEqual(settled, underlayer);
  selector.resolvedVersion += 1;
  assert.notEqual(key(), settled);
  const newer = key();
  selector.resolvedQuickCpuGrain = true;
  assert.notEqual(key(), newer);
});

test('reduced Clean Grain blends use the cached base and strength, not temporary textures', () => {
  const preview = new Preview(null);
  const base = { texture: {}, width: 64, height: 64, cleanGrainDelta: true };
  preview.createDenoiseTexture = () => ({ texture: {} });
  preview.encodePreparedDenoise = () => ({ paramBuffer: { destroy() {} } });
  preview.device = { createCommandEncoder: () => ({ finish() {} }), queue: { submit() {} } };
  const first = preview.blendReducedCleanGrain(base, 0.5);
  const next = preview.blendReducedCleanGrain(base, 0.5);
  const key = proxy => JSON.stringify(preview.lensGlowSourceKey(proxy, false));
  assert.notEqual(first.texture, next.texture);
  assert.equal(key(first), key(next));
  assert.notEqual(key(first), key(preview.blendReducedCleanGrain(base, 0.75)));
  assert.notEqual(key(first), key(preview.blendReducedCleanGrain({ ...base, texture: {} }, 0.5)));
});

test('tiled Mist can keep overlapping halo rectangles across same-epoch region uploads', () => {
  const preview = new Preview(null);
  const first = { texture: {}, identity: 'region-1', sourceIdentity: 'source', sessionId: 'session', lane: 'hdr',
    width: 1200, height: 800, longEdge: 1200, geometrySignature: '{}', regionTransport: true, sourceEpoch: 0,
    region: { x: 0, y: 0, width: 900, height: 800 } };
  const next = { ...first, texture: {}, identity: 'region-2', region: { ...first.region, x: 300 } };
  const params = new Float32Array(HDRGpuParamLayout.count);
  const key = (proxy, reuse) => preview.lensGlowCacheKey(proxy, 'hdr', { hdr: {} }, [], params, null, reuse);
  assert.equal(key(first, true), key(next, true));
  assert.notEqual(key(first, false), key(next, false));
  assert.notEqual(key(first, true), key({ ...next, sourceEpoch: 1 }, true));
  assert.notEqual(key(first, true), key({ ...next, sourceIdentity: 'another-source' }, true));
});

test('tiled Mist waits for ready tiles, replaces changed masks and checks live GPU headroom', () => {
  const preview = new Preview(null);
  const pending = new Map();
  const firstRect = { x: 0, y: 0, width: 64, height: 64 };
  const secondRect = { ...firstRect, x: 64 };
  const masks = [{ key: 'brush', texture: {} }];
  const destroyed = [];
  let otherBytes = 0;
  preview.memoryBudgetBytes = () => 6000;
  preview.resourceMemorySnapshot = () => ({ resident: { totalBytes: otherBytes
    + [...preview.lensGlowTiles.values()].reduce((total, entry) => total + entry.byteSize, 0) } });
  preview.device = { createTexture: () => { const texture = { destroy: () => destroyed.push(texture) }; return texture; } };
  preview.setLensGlowTileFrameKey('frame');
  const tile = (rect, currentMasks = masks, frame = 'frame') => preview.lensGlowTileFor(frame, rect, 4, currentMasks, pending);
  const first = tile(firstRect);
  assert.equal(first.ready, false);
  assert.equal(tile(firstRect), null);
  first.ready = true;
  assert.equal(tile(firstRect), first);
  otherBytes += 1500;
  assert.equal(tile(secondRect), null);
  otherBytes = 0;
  assert.ok(tile(secondRect));
  const replacement = tile(firstRect, [{ ...masks[0], texture: {} }]);
  assert.notEqual(replacement, first);
  assert.equal(replacement.ready, false);
  assert.deepEqual(destroyed, [first.texture]);
  preview.setLensGlowTileFrameKey(null);
  assert.equal(preview.lensGlowTiles.size, 0);
  assert.equal(destroyed.length, 3);
  assert.equal(tile(firstRect), null);
});

test('lens cache skips only the summed glow and grain quality changes only the finish pass', () => {
  const preview = new Preview(null);
  const texture = name => ({ name, createView: () => name });
  const allocations = [];
  preview.device = {
    createTexture(descriptor) {
      allocations.push(descriptor);
      return texture('weights');
    },
    createBindGroup: ({ entries }) => entries[0].resource,
  };
  const graph = Object.fromEntries(['film', 'finish', 'spatialA', 'spatialB', 'lensGlow']
    .map(name => [name + 'Texture', texture(name)]));
  graph.spatialGrid = 4;
  const passes = [];
  let copies = 0;
  const encoder = { beginRenderPass: () => ({ setViewport() {}, setScissorRect() {},
    setPipeline: pipeline => passes.push(pipeline), setBindGroup() {}, draw() {}, end() {} }),
    copyTextureToTexture: () => { copies++; } };
  const pipelines = Object.fromEntries(['response', 'lensWeights', 'lensExtract', 'lensHorizontal', 'lensVertical', 'lens',
    'scatter', 'finish', 'finishInteractive', 'scan', 'structure', 'extract', 'blurHorizontal', 'blurVertical']
    .map(name => [name, name]));
  const params = new Float32Array(HDRGpuParamLayout.count);
  for (const field of ['FILM_RESPONSE_ENABLED', 'FILM_LOOK_STRENGTH', 'LENS_FILTER', 'LENS_SCATTER', 'FILM_RESOLUTION', 'HALATION_ENABLED']) params[indices[field]] = 1;
  const render = interactive => preview.encodeFilmChain(encoder, pipelines, graph, 'original', () => ({}),
    params, 1200, 800, { lensGlowKey: 'same', interactive });
  assert.equal(render(true), true);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].format, 'r32float');
  assert.deepEqual(passes.slice(0, 2), ['lensWeights', 'lensExtract']);
  assert.equal(passes.filter(pass => pass === 'lensVertical').length, 27);
  assert.ok(passes.includes('finishInteractive'));
  assert.equal(copies, 1);
  graph.lensGlowKey = 'same';
  passes.length = 0;
  assert.equal(render(false), true);
  assert.ok(!passes.includes('lensWeights'));
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

test('film detail dispatches over the whole partial tile without a frame scratch texture', () => {
  const preview = new Preview(null);
  const encoded = [];
  const order = [];
  const inputs = new Map();
  const encoder = {
    beginRenderPass: () => ({ setViewport() {}, setScissorRect() {},
      setPipeline(name) { this.name = name; order.push(name); },
      setBindGroup(index, source) { if (index === 0) inputs.set(this.name, source); }, draw() {}, end() {} }),
    beginComputePass: () => ({ setPipeline({ name }) { this.name = name; },
      setBindGroup(index, entries) { this.entries = entries; },
      dispatchWorkgroups(width, height) {
        order.push(this.name);
        encoded.push({ name: this.name, width, height, entries: this.entries });
      }, end() {} }),
  };
  preview.device = { createBindGroup: ({entries}) => Object.fromEntries(entries.map(({binding, resource}) => [binding, resource])) };
  preview.filmStockBinding = () => ({ buffer: 'stock' });
  const pipelines = Object.fromEntries(['scatter','structure'].map(name => [name, {
    name, getBindGroupLayout: () => name,
  }]));
  Object.assign(pipelines, { response: 'response', lens: 'lens', finish: 'finish', scan: 'scan' });
  const graph = { filmTexture: { createView: () => 'film' }, finishTexture: { createView: () => 'finish' } };
  const params = new Float32Array(HDRGpuParamLayout.count);
  const parameterBinding = { buffer: 'tile parameters', offset: 256, size: params.byteLength };
  const set = (name, value) => { params[indices[name]] = value; };
  set('FILM_RESPONSE_ENABLED', 1);
  set('FILM_LOOK_STRENGTH', 1);
  set('FILM_RESOLUTION', 1);
  set('STRUCTURE_ENABLED', 1);
  const render = () => preview.encodeFilmChain(encoder, pipelines, graph, 'original', source => source,
    params, 257, 129, { parameterBinding });
  render();
  assert.deepEqual(encoded, []);
  order.length = 0;
  set('FILM_RESOLUTION', 0);
  set('STRUCTURE_SOFTNESS', 0.8);
  set('STRUCTURE_MICROCONTRAST', -0.5);
  render();
  assert.deepEqual(order, ['lens', 'scatter', 'finish', 'scan', 'structure']);
  assert.equal(inputs.get('lens'), 'original', 'Lens reads the already stored input without copying it');
  assert.deepEqual(encoded.map(({name}) => name), ['scatter', 'structure']);
  const block = context.window.HDRWebGPUShaders.FILM_DETAIL_BLOCK;
  assert.deepEqual(encoded.map(({name,width,height,entries}) => [name,width,height,entries[0],entries[8]]), [
    ['scatter', Math.ceil(257/block.width), Math.ceil(129/block.height), 'finish', 'film'],
    ['structure', Math.ceil(257/block.width), Math.ceil(129/block.height), 'film', 'finish'],
  ]);
  assert.ok(encoded.every(({entries}) => entries[1] === parameterBinding));
  assert.equal(encoded[1].entries[6].buffer, 'stock');
  encoded.length = 0;
  set('GRAIN_ENABLED', 1);
  set('GRAIN_VIEW_MAP', 1);
  render();
  assert.deepEqual(encoded.map(({name}) => name), ['scatter']);
  encoded.length = 0;
  set('FILM_RESPONSE_ENABLED', 0);
  render();
  assert.deepEqual(encoded.map(({name}) => name), ['structure']);
});

test('presentation records processing resolution and never accepts drag grain as settled', () => {
  const state = { currentView: 'sdr', previewGeneration: { hdr: 1, sdr: 1 }, zoomMode: 'fit',
    adjustments: { shared: { geometry: {} } } };
  let requiredEdge = 1200;
  const ui = vm.createContext({ state, els: {}, Number, Math, normalizedPreviewResolution: () => 'display',
    requiredProcessingLongEdge: () => requiredEdge, geometrySignature: () => '{}',
    applyZoomGeometry() {}, renderCurrentPreviewSize() {}, renderReadouts() {},
    scheduleNavigationThumbnail() {}, finishPerspectivePresentation() {}, renderViewerStatus() {},
    refreshScopesAfterPresentation() {} });
  vm.runInContext(declarations('acceptPreviewGeometry', 'acceptPresentation', 'scopePresentationIdentity', 'gradeSourceIdentity',
    'microGrainPreviewKey', 'renderDenoiseRoute', 'currentGrainFrame') + '\nglobalThis.accept = acceptPresentation;', ui);
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

test('the bounded zoom canvas reuses Mist tiles and invalidates them on a changed input', async () => {
  const preview = new Preview({});
  const detail = {};
  const texture = () => ({ createView: () => ({}), destroy() {} });
  const graph = Object.fromEntries(['source', 'base', 'local', 'detailScratch', 'detailResult', 'film', 'finish']
    .map(name => [name + 'Texture', texture()]));
  graph.spatialGrid = 4;
  const noop = () => {};
  const draw = { setViewport: noop, setScissorRect: noop, setPipeline: noop, setBindGroup: noop, draw: noop, end: noop };
  const region = { x: 0, y: 0, width: 64, height: 64 };
  const used = [];
  const context = { getCurrentTexture: texture };
  const Scheduler = require('../frontend/tile-scheduler.js').HDRTileScheduler;
  Object.assign(preview, {
    device: {
      createBuffer: ({ size }) => ({ size, destroy: noop }),
      createCommandEncoder: () => ({ beginRenderPass: () => draw, copyTextureToTexture: noop, finish: noop }),
      createTexture: texture, pushErrorScope: noop, popErrorScope: async () => null,
      queue: { submit: noop, writeBuffer: noop },
    },
    tileViewportRequest: () => ({ fit: true, roi: region }),
    composedTileHalo: () => ({ halo: 0 }),
    memoryBudgetBytes: () => 2 ** 20, resourceMemorySnapshot: () => ({ resident: { totalBytes: 0 } }),
    ensurePresentationTarget: (width, height) => ({ width, height, texture: texture() }),
    ensureTileGraph: () => graph, ensureScopePeakTarget: () => null, bindGraphResources: noop,
    configureSurface: noop, loadSceneMaskRegion: async () => null, markResidentMaskFrame: noop,
    scheduleTileCacheTrim: noop, recordSubmission: noop, recordFrameMasks: noop,
    encodeFilmChain: (_encoder, _pipelines, _graph, _source, _bind, _params, _width, _height, { lensGlowTile }) => used.push(lensGlowTile),
  });
  const params = new Float32Array(HDRGpuParamLayout.count);
  for (const field of ['FILM_RESPONSE_ENABLED', 'FILM_LOOK_STRENGTH', 'LENS_FILTER', 'LENS_SCATTER']) params[indices[field]] = 1;
  const proxy = { identity: 'photo', width: 64, height: 64, texture: texture(), pixelFormat: 'rgba16float' };
  const render = async (exposure, { measureOnly = false, comparison = false } = {}) => {
    const result = await preview.encodeTiledGeneration(comparison ? {} : detail, context, proxy, { format: 'rgba16float' }, {}, params, {
      Scheduler, measureOnly, tileSize: 64, boundedPresentation: !measureOnly && !comparison, lensGlowRecipe: { hdr: { exposure } },
    });
    assert.equal(result.rendered, true);
  };
  await render(0);
  await render(0);
  assert.ok(used[0]?.ready, 'the finished tile is retained on the detail canvas');
  assert.equal(used[1], used[0]);
  await render(1, { measureOnly: true });
  assert.equal(used[2], null);
  assert.equal(preview.lensGlowTiles.size, 1);
  await render(1);
  assert.ok(used[3]?.ready);
  assert.notEqual(used[3], used[0]);

  const viewerGlow = preview.presentedLensGlowTileFrameKey;
  assert.ok(viewerGlow);
  preview.retainPresentedTiles(['visible-mask'], ['visible-denoise'], viewerGlow);
  await render(1, { comparison: true });
  assert.deepEqual([...preview.presentedMaskKeys], ['visible-mask']);
  assert.deepEqual([...preview.presentedDenoiseTileKeys], ['visible-denoise']);
  assert.equal(preview.presentedLensGlowTileFrameKey, viewerGlow);
});

test('only a Direct viewer presentation releases the previous tiled pins', async () => {
  const texture = { createView: () => ({}) };
  const canvas = { getContext: () => ({ getCurrentTexture: () => texture }) };
  const preview = new Preview(canvas);
  const proxy = { width: 64, height: 48, longEdge: 64, texture, identity: 'source', workingSpace: 'acescg' };
  const noop = () => {};
  const pass = { setPipeline: noop, setBindGroup: noop, draw: noop, end: noop };
  context.HDRTone = require("../frontend/tone-engine.js");
  Object.assign(preview, {
    available: true, sessionId: 'photo',
    device: { createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: noop }), queue: { submit: noop, writeBuffer: noop } },
    loadProxy: async () => proxy, roiRegionFor: () => null, evictStaleProxies: noop,
    configureSurface: () => ({ format: 'rgba16float' }), pipelineFor: () => ({}),
    composedTileHalo: () => ({ halo: 0 }), planRender: () => ({ decision: { mode: 'direct' } }),
    highlightAnchorRequest: () => null, uploadParamsAndCurves: noop, bindGraphResources: noop, encodeFilmChain: noop,
    ensureIntermediate: () => ({ baseTexture: texture, finishTexture: texture, compositeParamBuffer: { size: Infinity } }),
  });
  const comparison = { getContext: canvas.getContext };
  const present = (options, target = canvas) => preview.renderToFrame(target, 'photo', 'hdr', { hdr: {}, sdr: {}, shared: {} },
    () => [], 64, [], 1, null, 203, null, options);
  preview.retainPresentedTiles(['visible-mask'], ['visible-denoise'], 'visible-glow');
  assert.equal((await present({ measureOnly: true })).execution, 'direct');
  assert.equal((await present({ underlayerOnly: true })).execution, 'direct');
  assert.equal((await present({}, comparison)).execution, 'direct');
  assert.deepEqual([...preview.presentedMaskKeys], ['visible-mask']);
  assert.deepEqual([...preview.presentedDenoiseTileKeys], ['visible-denoise']);
  assert.equal(preview.presentedLensGlowTileFrameKey, 'visible-glow');
  assert.equal((await present({})).execution, 'direct');
  assert.equal(preview.presentedMaskKeys.size, 0);
  assert.equal(preview.presentedDenoiseTileKeys.size, 0);
  assert.equal(preview.presentedLensGlowTileFrameKey, null);
});
