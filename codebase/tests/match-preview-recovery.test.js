const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
function definition(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0);
  const tail = source.slice(start);
  const end = tail.search(/\n(?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end);
}
function fixture(outcomes) {
  const calls = { gpu: 0, cpu: [], scheduled: [] };
  const context = vm.createContext({
    state: { session: { session_id: 'original' }, previewGeneration: { sdr: 3 }, currentView: 'sdr' },
    renderGpuDraft: async () => {
      const outcome = outcomes[calls.gpu++];
      assert.ok(outcome, 'GPU retries must be bounded');
      context.state.lastGpuDraftRefusal = { reason: outcome.reason };
      outcome.change?.(context.state);
      return outcome.ok;
    },
    renderPreviewForLane: async (...args) => calls.cpu.push(args),
    debouncePreview: lane => calls.scheduled.push(lane),
    geometrySignature: () => 'geometry',
  });
  vm.runInContext(`${definition('transientGpuRefusal')}\n${definition('presentMatchedSdrPreview')}`, context);
  return { calls, context, run: () => vm.runInContext('presentMatchedSdrPreview({ longEdge: 1606, tier: "refinement" })', context) };
}
test('Match retries a peak handoff on GPU without CPU fallback', async () => {
  const f = fixture([{ ok: false, reason: 'peak:newer-render-started' }, { ok: true }]);
  assert.equal(await f.run(), false);
  assert.equal(f.calls.gpu, 2);
  assert.deepEqual(f.calls.cpu, []);
  assert.deepEqual(f.calls.scheduled, []);
});
test('Repeated Match cancellation arms replacement work without claiming ready', async () => {
  const f = fixture([{ ok: false, reason: 'superseded-after-masks' }, { ok: false, reason: 'peak:application-not-current' }]);
  assert.equal(await f.run(), true);
  assert.equal(f.calls.gpu, 2);
  assert.deepEqual(f.calls.cpu, []);
  assert.deepEqual(f.calls.scheduled, ['sdr']);
});
test('Unsupported Match graph retains CPU fallback at the selected edge', async () => {
  const f = fixture([{ ok: false, reason: 'gpu-not-eligible' }]);
  assert.equal(await f.run(), false);
  assert.equal(f.calls.gpu, 1);
  assert.equal(f.calls.cpu.length, 1);
  assert.deepEqual(f.calls.cpu[0].slice(0, 3), ['sdr', true, 1606]);
});
for (const replacement of ['session', 'generation']) {
  test(`Match does not render stale state after ${replacement} replacement`, async () => {
    const f = fixture([{ ok: false, reason: 'superseded-during-render', change: state => {
      if (replacement === 'session') state.session = { session_id: 'new' };
      else state.previewGeneration.sdr++;
    } }]);
    assert.equal(await f.run(), true);
    assert.equal(f.calls.gpu, 1);
    assert.deepEqual(f.calls.cpu, []);
    assert.deepEqual(f.calls.scheduled, []);
  });
}
test('Match waits for the edit queue and active render before retrying', async () => {
  const f = fixture([{ ok: false, reason: 'peak:newer-render-started' }, { ok: true }]);
  let release;
  f.context.state.editCommandQueue = new Promise(resolve => { release = resolve; });
  const done = f.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.gpu, 1);
  release(true);
  assert.equal(await done, false);
  assert.equal(f.calls.gpu, 2);
});
test('Match reuses an exact frame presented by replacement GPU work', async () => {
  const f = fixture([{ ok: false, reason: 'peak:newer-render-started', change: state => {
    state.acceptedPresentation = { lane: 'sdr', generation: 3, exact: true,
      processedLongEdge: 1606, geometrySignature: 'geometry' };
  } }]);
  assert.equal(await f.run(), false);
  assert.equal(f.calls.gpu, 1);
  assert.deepEqual(f.calls.cpu, []);
});
test('Match does not reuse an exact frame at the wrong processing edge', async () => {
  const f = fixture([{ ok: true }]);
  f.context.state.acceptedPresentation = { lane: 'sdr', generation: 3, exact: true,
    processedLongEdge: 768, geometrySignature: 'geometry' };
  assert.equal(await f.run(), false);
  assert.equal(f.calls.gpu, 1);
});
