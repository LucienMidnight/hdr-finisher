const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../frontend/webgpu-preview.js'), 'utf8');
const start = source.indexOf('  function buildTiledLocalState(');
const end = source.indexOf('  /**', start);

function fixture() {
  let builds = 0, masks = 0;
  const context = vm.createContext({
    CLARITY_MAP_SCALE_INDEX: 170, CLARITY_MAP_SIGMA_INDEX: 171, CLARITY_MAP_TAPS_INDEX: 172,
    CLARITY_MAP_ORIGIN_X_INDEX: 173, CLARITY_MAP_ORIGIN_Y_INDEX: 174,
    CLARITY_BASE_SCALE_INDEX: 175, CLARITY_BASE_ORIGIN_X_INDEX: 176, CLARITY_BASE_ORIGIN_Y_INDEX: 177,
    gpuLocalDetailActive: grade => grade.detail,
    buildLocalParams: (local, lane, scale) => { builds++; return new Float32Array([local[lane + '_grade'].exposure, scale]); },
    gpuMaskRenderPayload: mask => { masks++; return mask; },
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, count: () => ({ builds, masks }),
    run: (locals, lane = 'hdr', scale = 2) => context.buildTiledLocalState('source', [0.1, 0.2], locals, lane, scale) };
}
const local = (id, detail = true) => ({ id, opacity: 0.8, mask: { strokes: [id] },
  hdr_grade: { exposure: id.length, detail }, sdr_grade: { exposure: 2, detail } });

test('Local Detail prefixes preserve the original cache identity exactly', () => {
  const f = fixture(), locals = [local('one'), local('two', false), local('three')];
  const states = f.run(locals);
  let preceding = 'source|' + JSON.stringify([0.1, 0.2]);
  locals.forEach((entry, index) => {
    assert.deepEqual(Array.from(states[index].params), [entry.hdr_grade.exposure, 2]);
    assert.equal(states[index].detailPrefix, entry.hdr_grade.detail
      ? `local:${entry.id}|${preceding}|${JSON.stringify([entry.hdr_grade.exposure, 2])}` : null);
    preceding += `|${JSON.stringify(entry.mask)}|${JSON.stringify(entry.hdr_grade)}|${entry.opacity}`;
  });
  assert.deepEqual(f.count(), { builds: 3, masks: 2 });
});

test('Changing an earlier mask invalidates downstream Detail but not its own bands', () => {
  const f = fixture(), locals = [local('one'), local('two')];
  const before = f.run(locals); locals[0].mask.strokes.push('changed'); const after = f.run(locals);
  assert.equal(after[0].detailPrefix, before[0].detailPrefix);
  assert.notEqual(after[1].detailPrefix, before[1].detailPrefix);
});

test('No local Detail means no mask serialization or identity construction', () => {
  const f = fixture(), states = f.run([local('one', false), local('two', false)]);
  assert.ok(states.every(state => state.detailPrefix === null));
  assert.deepEqual(f.count(), { builds: 2, masks: 0 });
});

test('Lane and source scale remain part of the local parameter identity', () => {
  const f = fixture(), locals = [local('one')];
  const hdr = f.run(locals), sdr = f.run(locals, 'sdr'), resized = f.run(locals, 'hdr', 1);
  assert.notEqual(hdr[0].detailPrefix, sdr[0].detailPrefix);
  assert.notEqual(hdr[0].detailPrefix, resized[0].detailPrefix);
});
