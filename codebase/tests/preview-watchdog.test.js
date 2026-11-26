const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { declarations } = require('./frontend-source.js');

for (const busy of [{ frameInFlight: true }, { framePending: true }, { frame: 0 }, {}]) {
  test(`watchdog waits for real scheduler work ${JSON.stringify(busy)}`, () => {
    let tick, schedules = 0;
    const state = { session: { session_id: 'photo' }, currentView: 'hdr', previewGeneration: { hdr: 9 }, previewWatchdogRearms: 0,
      previewScheduler: { frame: null, ...busy, schedule(lane, generation) { assert.equal(lane, 'hdr'); assert.equal(generation, 9); schedules++; } } };
    const ctx = vm.createContext({ state, window: { setInterval(fn) { tick = fn; return 1; } },
      stopPreviewWatchdog() {}, viewerState: () => ({ status: 'preparing' }), geometryDraftActive: () => false,
      PREVIEW_WATCHDOG_MAX_REARMS: 20, PREVIEW_WATCHDOG_INTERVAL_MS: 1000 });
    vm.runInContext(declarations('installPreviewWatchdog'), ctx);
    ctx.installPreviewWatchdog(); tick();
    assert.equal(schedules, Object.keys(busy).length ? 0 : 1);
    assert.equal(state.previewWatchdogRearms, schedules);
  });
}

test('the watchdog does not restart Grade work in Export', () => {
  let tick, schedules = 0;
  const state = { activeWorkflow: 'export', session: { session_id: 'photo' }, currentView: 'hdr',
    previewGeneration: { hdr: 9 }, previewWatchdogRearms: 0,
    previewScheduler: { schedule() { schedules++; } } };
  const ctx = vm.createContext({ state, window: { setInterval(fn) { tick = fn; return 1; } },
    stopPreviewWatchdog() {}, viewerState: () => ({ status: 'preparing' }), geometryDraftActive: () => false,
    PREVIEW_WATCHDOG_MAX_REARMS: 20, PREVIEW_WATCHDOG_INTERVAL_MS: 1000 });
  vm.runInContext(declarations('installPreviewWatchdog'), ctx);
  ctx.installPreviewWatchdog();
  tick();
  assert.equal(schedules, 0);
  state.activeWorkflow = 'grade';
  tick();
  assert.equal(schedules, 1);
});
