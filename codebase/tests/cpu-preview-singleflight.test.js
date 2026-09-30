const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
const start = source.indexOf('async function renderPreviewForLane(');
const end = source.indexOf('async function renderPreviewForLaneInner(', start);
function fixture() {
  const jobs = [];
  const context = vm.createContext({
    state: { session: { session_id: 'one' }, editRevision: 1, previewGeneration: { hdr: 1 },
      gpuPreview: { available: true } },
    geometryDraftActive: () => false,
    geometrySignature: () => 'geometry',
    localAdjustments: () => [],
    syncGlobalEditState: async () => true,
    renderPreviewForLaneInner: () => new Promise((resolve, reject) => jobs.push({ resolve, reject })),
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, jobs, render: () => vm.runInContext('renderPreviewForLane("hdr", true, 1606)', context) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Concurrent identical CPU preview requests share one computation', async () => {
  const f = fixture(); const a = f.render(), b = f.render(); await tick();
  assert.equal(f.jobs.length, 1);
  f.jobs[0].resolve(true);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(f.context.state.cpuPreviewInflight.size, 0);
});
test('A newer generation replaces the flight without the old completion deleting it', async () => {
  const f = fixture(); const a = f.render(); await tick();
  f.context.state.previewGeneration.hdr++;
  const b = f.render(); await tick(); assert.equal(f.jobs.length, 2);
  f.jobs[0].resolve(false); assert.equal(await a, false);
  assert.equal(f.context.state.cpuPreviewInflight.size, 1);
  const c = f.render(); await tick(); assert.equal(f.jobs.length, 2);
  f.jobs[1].resolve(true); assert.deepEqual(await Promise.all([b, c]), [true, true]);
});
test('Failed CPU work releases its flight so a later request can retry', async () => {
  const f = fixture(); const a = f.render(); await tick();
  const rejected = assert.rejects(a, /decode/); f.jobs[0].reject(Error('decode')); await rejected;
  assert.equal(f.context.state.cpuPreviewInflight.size, 0);
  const b = f.render(); await tick(); assert.equal(f.jobs.length, 2);
  f.jobs[1].resolve(true); await b;
});
test('An edit revision change is not mistaken for the same CPU request', async () => {
  const f = fixture(); const a = f.render(); await tick();
  f.context.state.editRevision++;
  const b = f.render(); await tick(); assert.equal(f.jobs.length, 2);
  f.jobs.forEach(job => job.resolve(true)); await Promise.all([a, b]);
});
for (const stale of [false, true]) {
  test(`Watchdog ${stale ? 'recovers obsolete' : 'does not restart active'} CPU work`, () => {
    let tick, schedules = 0;
    const context = vm.createContext({
      state: { session: { session_id: 'one' }, currentView: 'hdr', previewGeneration: { hdr: 2 },
        cpuPreviewInflight: new Map([['hdr', { sessionId: 'one', generation: stale ? 1 : 2 }]]),
        previewScheduler: { schedule: () => schedules++ }, previewWatchdogRearms: 0 },
      stopPreviewWatchdog: () => {}, geometryDraftActive: () => false,
      viewerState: () => ({ status: 'updating' }),
      PREVIEW_WATCHDOG_MAX_REARMS: 20, PREVIEW_WATCHDOG_INTERVAL_MS: 1000,
      window: { setInterval: callback => { tick = callback; return 1; } },
    });
    const begin = source.indexOf('function installPreviewWatchdog(');
    const finish = source.indexOf('function stopPreviewWatchdog(', begin);
    vm.runInContext(source.slice(begin, finish), context);
    vm.runInContext('installPreviewWatchdog()', context); tick();
    assert.equal(schedules, stale ? 1 : 0);
  });
}
