const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { declarations, frontendSource } = require('./frontend-source.js');
function fixture() {
  const jobs = [], cache = new Map(), inflight = new Map();
  const state = { session: { session_id: 'one', source: { width: 8000, height: 5000 } },
    adjustments: {}, editRevision: 1, previewGeneration: { hdr: 2 }, importGeneration: 3,
    currentView: 'hdr', requestedEdge: 1600, gpuPreview: { available: true,
      measureEditingPeak: (...args) => new Promise((resolve, reject) => jobs.push({ resolve, reject, options: args.at(-1) })) } };
  const context = vm.createContext({ localsBypassed: () => false, state, exactScopePeakCache: cache, exactScopePeakInflight: inflight,
    exactScopePeakKey: lane => [state.session.session_id, lane, state.editRevision, state.previewGeneration[lane]].join('|'),
    previewTargetLongEdge: () => 8000, performance: { now: () => 1 }, els: { previewCanvas: {} },
    sampleCurvePoints: () => {}, localAdjustments: () => [], projectReferenceWhiteNits: () => 203,
    requiredProcessingLongEdge: () => state.requestedEdge,
    recordEditingMeasurement: () => {} });
  vm.runInContext(declarations('measureExactScopePeak', 'measureExactScopePeakInner'), context);
  return { state, jobs, cache, inflight, run: options => context.measureExactScopePeak(options) };
}
const result = { rendered: true, metrics: { exactPeak: 3, exactPeakLongEdge: 8000, tileCount: 100 } };

function peakRenderer() {
  const context = vm.createContext({ window: {}, document: { createElement: () => ({}) }, performance,
    AbortController, AbortSignal, structuredClone,
    GPUTextureUsage: { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4, COPY_SRC: 8 } });
  for (const name of ['tone-engine.js', 'graph-scale.js', 'viewport-request.js',
    'hsl-selection-gpu.js', 'webgpu-shaders.js', 'webgpu-preview.js']) {
    vm.runInContext(frontendSource(name), context);
  }
  context.HDRTone = context.window.HDRTone;
  context.window.HDRHslSelectionGpu = context.HDRHslSelectionGpu;
  return new context.window.HDRWebGPUPreview(null);
}

test('Repeated robust highlight anchor measurements retain one dedicated set of intermediates', async () => {
  const renderer = peakRenderer(), viewer = {};
  renderer.editingAnalysisCanvas = {};
  renderer.device = { createTexture: () => ({ destroy() {} }) };
  const source = { width: 1600, height: 1068, workingSpace: 'acescg' };
  renderer.loadProxy = async () => source;
  renderer.highlightAnchorRequest = () => ({ key: 'anchor' });
  renderer.ensurePeakReductionPipeline = async () => ({});
  renderer.runPeakReduction = async (_pipeline, film) => {
    assert.ok(film);
    return 3;
  };
  const canvases = [];
  renderer.renderTo = async (canvas, _session, _lane, adjustments) => {
    assert.equal(adjustments.hdr.highlight_section_enabled, false);
    canvases.push(canvas);
    renderer.scopeSources.set(canvas, renderer.ensureIntermediate(canvas, source.width, source.height));
    return source;
  };
  for (const revision of [1, 2, 3]) {
    const result = await renderer.measureEditingPeak(viewer, 'session', 'hdr',
      { hdr: { highlight_section_enabled: true, highlight_compression_peak_measurement: 'robust' } },
      () => {}, [], revision, 203, { width: 8000, height: 5340 }, { highlightAnchorOnly: true });
    assert.equal(result.highlightAnchor.value, 3);
  }
  assert.equal(renderer.intermediates.size, 1);
  assert.notEqual(canvases[0], renderer.editingAnalysisCanvas);
  assert.notEqual(canvases[0], viewer);
  renderer.resetSession();
  assert.equal(renderer.intermediates.size, 0);
  assert.equal(renderer.highlightAnchorCanvas, null);
});

test('Concurrent robust anchors never measure a newer edit on their shared canvas', async () => {
  const renderer = peakRenderer();
  const source = { width: 1600, height: 1068, workingSpace: 'acescg' };
  const compiling = Promise.withResolvers(), pipeline = Promise.withResolvers();
  const reducing = Promise.withResolvers(), readback = Promise.withResolvers();
  const rendered = [];
  renderer.loadProxy = async () => source;
  renderer.highlightAnchorRequest = (_lane, adjustments) => ({ key: `anchor-${adjustments.hdr.exposure}` });
  renderer.ensurePeakReductionPipeline = async () => {
    compiling.resolve();
    return pipeline.promise;
  };
  renderer.renderTo = async (canvas, _session, _lane, _adjustments, _curveSampler, _edge, _locals, revision) => {
    rendered.push(revision);
    const frame = renderer.scopeSources.get(canvas) || { ...source, filmTexture: {} };
    frame.filmTexture.value = revision;
    renderer.scopeSources.set(canvas, frame);
    return source;
  };
  renderer.runPeakReduction = async (_pipeline, film, _width, _height, _params, _method, key) => {
    if (key === 'anchor-1') {
      reducing.resolve();
      await readback.promise;
    }
    renderer.peakReductionCache.set(key, film.value);
    return film.value;
  };
  const measure = (revision, isCurrent) => renderer.measureEditingPeak({}, 'session', 'hdr',
    { hdr: { highlight_compression_peak_measurement: 'robust', exposure: revision } },
    () => {}, [], revision, 203, source, { highlightAnchorOnly: true, isCurrent });
  let stale = false;
  const first = measure(1, () => !stale);
  await compiling.promise;
  const skipped = measure(2, () => false);
  const latest = measure(3);
  pipeline.resolve({});
  await reducing.promise;
  await new Promise(resolve => setImmediate(resolve));
  const duringReadback = [...rendered];
  stale = true;
  readback.resolve();
  const [firstResult, skippedResult, latestResult] = await Promise.all([first, skipped, latest]);
  assert.deepEqual(duringReadback, [1]);
  assert.deepEqual(rendered, [1, 3]);
  assert.equal(firstResult, null);
  assert.equal(skippedResult, null);
  assert.equal(latestResult.highlightAnchor.value, 3);
  assert.equal(renderer.peakReductionCache.get('anchor-1'), 1);
  assert.equal(renderer.peakReductionCache.get('anchor-3'), 3);
});

test('A scene viewport with Hue and Luma preserves the globally aligned source window', () => {
  const renderer = peakRenderer();
  const sourceSize = { width: 7968, height: 5320 };
  const frame = { ...sourceSize, longEdge: sourceSize.width, workingSpace: 'acescg' };
  renderer.lastPresentedFrame = frame;
  renderer.retainedTiledFrame = () => true;
  renderer.configureSurface = () => ({ hdr: true, format: 'rgba16float' });
  renderer.composedTileHalo = () => ({ halo: 0 });
  renderer.executionOverrideFor = () => 'tiled';
  const hue = { operator: 'leaf', leaf: { type: 'hue_range', hue_center: 90 } };
  const luma = { operator: 'leaf', leaf: { type: 'luminance_range', mask_feather: 0 } };
  const union = { operator: 'intersect', children: [hue, luma] };
  const options = { viewport: { x: 792, y: 648, width: 1691, height: 895 }, tileSize: 509 };
  const region = renderer.roiRegionFor({}, {}, 'session', 'hdr', { hdr: {} }, sourceSize, 203,
    options, [{ mask: union }], sourceSize.width);
  assert.ok(region && region.width < frame.width && region.height < frame.height);
  assert.equal(region.alignment, 4);
  assert.equal(region.x % 4, 0);
  assert.equal(region.y % 4, 0);
  assert.ok(region.x < 509 && region.y < 509);
  assert.ok(region.x + region.width > 2545 && region.y + region.height > 2036);
  luma.leaf.mask_feather = .001;
  assert.equal(renderer.roiRegionFor({}, {}, 'session', 'hdr', { hdr: {} }, sourceSize, 203,
    options, [{ mask: union }], sourceSize.width), null);
});

for (const origin of ['scope', 'source']) {
  test(`Cancelling ${origin} aborts mask loads for peak candidate ranking`, async () => {
    const renderer = peakRenderer(), source = new AbortController(), scope = new AbortController();
    renderer.sourceAbortSignal = () => source.signal;
    renderer.editingCandidateCache = new Map([['session:hdr:{}:undefined', {
      width: 1024, height: 512, samples: [[1, 2, .5, .6, .7]], working_space: 'acescg',
    }]]);
    renderer.device = { createTexture: () => ({ destroy() {} }), queue: { writeTexture() {} } };
    renderer.uploadParamsAndCurves = renderer.markResidentMaskFrame = renderer.highlightAnchorRequest = () => {};
    renderer.pipelineFor = () => ({});
    const loading = Promise.withResolvers(), finish = Promise.withResolvers();
    renderer.loadEditingMask = async (...args) => {
      const signal = args.at(-1);
      signal.addEventListener('abort', () => finish.resolve(null), { once: true });
      loading.resolve({ signal });
      return finish.promise;
    };
    const ranking = renderer.rankEditingPeakCandidates('session', 'hdr', { hdr: {} }, () => {},
      [{ opacity: 1, hdr_grade: {} }], 1, 203, { width: 1024, height: 512 }, () => true, scope.signal);
    const { signal } = await Promise.race([loading.promise, ranking.then(() => { throw new Error('No mask load'); })]);
    try {
      assert.equal(signal.aborted, false);
      (origin === 'scope' ? scope : source).abort();
      assert.equal(signal.aborted, true);
    } finally {
      finish.resolve(null);
    }
    assert.equal(await ranking, null);
  });
}

test('Clarity joins an independent render without letting a cancelled scope use its result', async () => {
  const renderer = peakRenderer(), jobs = [];
  renderer.highlightSourceToken = () => 'source';
  renderer.renderTo = (canvas, ...args) => new Promise(resolve => jobs.push({ canvas, options: args.at(-1), resolve }));
  const measure = (revision, options = {}) => renderer.measurementClaritySurround('session', 'hdr',
    { hdr: {} }, () => {}, [], revision, 203, { width: 4000, height: 3000 }, options);
  const scope = new AbortController();
  const anchor = measure(1), cancelled = measure(1, { signal: scope.signal });
  const alsoWaiting = measure(1, { signal: new AbortController().signal });
  const nextEdit = measure(2);
  assert.equal(jobs.length, 1);
  scope.abort();
  assert.equal(jobs[0].options.isCurrent(), true);
  jobs[0].options.captureClarity.frameWidth = 4000;
  jobs[0].resolve({ width: 1600 });
  const retained = await anchor;
  assert.equal(await cancelled, null);
  assert.equal(await alsoWaiting, retained);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].canvas, jobs[1].canvas);
  jobs[1].options.captureClarity.frameWidth = 4000;
  jobs[1].resolve({ width: 1600 });
  assert.notEqual(await nextEdit, retained);
});

test('Concurrent peak requests share one bounded measurement, including forced requests', async () => {
  const f = fixture(), first = f.run(), second = f.run({ force: true });
  assert.equal(f.jobs.length, 1); assert.equal(f.jobs[0].options.isCurrent(), true);
  f.jobs[0].resolve(result); const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(a.exact, false); assert.equal(a.bounded, true); assert.equal(f.inflight.size, 0);
  assert.equal(await f.run(), a); assert.equal(f.jobs.length, 1);
});

for (const change of ['generation', 'revision', 'session', 'import', 'zoom']) {
  test(`A changed ${change} cancels obsolete measurement and cannot cache its peak`, async () => {
    const f = fixture(), job = f.run();
    if (change === 'generation') f.state.previewGeneration.hdr++;
    if (change === 'revision') f.state.editRevision++;
    if (change === 'session') f.state.session.session_id = 'two';
    if (change === 'import') f.state.importInProgress = true;
    if (change === 'zoom') f.state.requestedEdge = 8000;
    assert.equal(f.jobs[0].options.isCurrent(), false);
    f.jobs[0].resolve(result); assert.equal(await job, null);
    assert.equal(f.cache.size, 0); assert.equal(f.inflight.size, 0);
  });
}

test('A transient refusal can retry instead of poisoning the completed cache', async () => {
  const f = fixture(), first = f.run();
  f.jobs[0].resolve({ rendered: false, refusals: ['superseded'] });
  assert.equal((await first).exact, false); assert.equal(f.cache.size, 0);
  const second = f.run(); assert.equal(f.jobs.length, 2); f.jobs[1].resolve(result);
  assert.equal((await second).bounded, true);
});

test('A valid shorter-edge result retains its disclosure and remains reusable', async () => {
  const f = fixture(), first = f.run();
  f.jobs[0].resolve({ rendered: true, metrics: { exactPeak: 3, exactPeakLongEdge: 4608, tileCount: 81 } });
  const measured = await first; assert.equal(measured.exact, false);
  assert.equal(await f.run(), measured); assert.equal(f.jobs.length, 1);
});

test('Old completion cannot remove or satisfy a newer edit measurement', async () => {
  const f = fixture(), first = f.run(); f.state.previewGeneration.hdr++;
  const second = f.run(); assert.equal(f.jobs.length, 2);
  f.jobs[0].resolve(result); assert.equal(await first, null); assert.equal(f.inflight.size, 1);
  const duplicate = f.run(); assert.equal(f.jobs.length, 2);
  f.jobs[1].resolve(result); assert.equal((await second), (await duplicate));
  assert.equal(f.inflight.size, 0); assert.equal(f.cache.size, 1);
});

test('A cancelled scope peak cannot publish evidence or abort an independent measurement', async () => {
  const f = fixture(), controller = new AbortController();
  const independent = f.run(), scope = f.run({ signal: controller.signal });
  assert.equal(f.jobs.length, 2);
  assert.equal(f.jobs[1].options.signal, controller.signal);
  controller.abort();
  assert.equal(f.jobs[1].options.isCurrent(), false);
  f.jobs[1].resolve(result);
  assert.equal(await scope, null);
  assert.equal(f.cache.size, 0);
  assert.equal(f.jobs[0].options.isCurrent(), true);
  f.jobs[0].resolve(result);
  assert.equal((await independent).peak, 3);
});
