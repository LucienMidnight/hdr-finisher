const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { declarations } = require('./frontend-source.js');
function fixture() {
  const jobs = [], cache = new Map(), inflight = new Map();
  const state = { session: { session_id: 'one', source: { width: 8000, height: 5000 } },
    adjustments: {}, editRevision: 1, previewGeneration: { hdr: 2 }, importGeneration: 3,
    currentView: 'hdr', requestedEdge: 1600, gpuPreview: { available: true,
      measureEditingPeak: (...args) => new Promise((resolve, reject) => jobs.push({ resolve, reject, options: args.at(-1) })) } };
  const context = vm.createContext({ state, exactScopePeakCache: cache, exactScopePeakInflight: inflight,
    exactScopePeakKey: lane => [state.session.session_id, lane, state.editRevision, state.previewGeneration[lane]].join('|'),
    previewTargetLongEdge: () => 8000, performance: { now: () => 1 }, els: { previewCanvas: {} },
    sampleCurvePoints: () => {}, localAdjustments: () => [], projectReferenceWhiteNits: () => 203,
    requiredProcessingLongEdge: () => state.requestedEdge,
    recordEditingMeasurement: () => {} });
  vm.runInContext(declarations('measureExactScopePeak', 'measureExactScopePeakInner'), context);
  return { state, jobs, cache, inflight, run: options => context.measureExactScopePeak(options) };
}
const result = { rendered: true, metrics: { exactPeak: 3, exactPeakLongEdge: 8000, tileCount: 100 } };

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
