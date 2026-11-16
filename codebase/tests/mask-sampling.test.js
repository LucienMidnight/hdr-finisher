const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { frontendSource } = require('./frontend-source.js');

function setup() {
  let local = { id: 'local', mask: { id: 'mask', leaf: { type: 'hue_range', hue_center: null } } };
  const calls = [];
  const context = vm.createContext({
    state: { session: { session_id: 'photo' }, currentView: 'hdr', activeWorkflow: 'grade', gradeMode: 'local', editRevision: 1, localHiddenGizmoIds: new Set() },
    selectedLocal: () => local,
    localGizmoVisible: owner => Boolean(owner && !context.state.localHiddenGizmoIds.has(owner.id)),
    selectedMaskLeaf: owner => owner.mask.leaf,
    selectedMaskExpression: owner => owner.mask,
    syncGlobalEditState: async () => true,
    settledProxyLongEdge: () => 1000,
    safeJson: response => response.json(),
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ center: 123, width: 8 }) };
    },
    scheduleSpatialMaskPreview() {}, renderMaskTreeEditor() {}, syncRangeVisuals() {},
    queueLocalMaskOverlayRender() {}, els: {},
    commitSelectedLocal: async () => calls.push('commit'),
    console, status: { post: error => { throw Error(error.message); } },
  });
  vm.runInContext(frontendSource('mask-gestures.js'), context);
  const gesture = { localId: 'local', lane: 'hdr', expressionId: 'mask', points: [{ x: .3, y: .4 }] };
  return { context, calls, gesture, local: () => local, replace: () => { local = structuredClone(local); } };
}

test('range sampling waits for saved upstream edits and reacquires the acknowledged mask', async () => {
  const fixture = setup();
  const { context, calls, gesture } = fixture;
  const oldLeaf = fixture.local().mask.leaf;
  let finish;
  context.syncGlobalEditState = () => new Promise(resolve => { finish = () => {
    fixture.replace();
    context.state.editRevision = 2;
    resolve(true);
  }; });
  const pending = context.finishLuminanceSampleGesture(gesture);
  assert.equal(calls.length, 0);
  finish();
  await pending;
  assert.equal(calls[0].edit_revision, 2);
  assert.equal(fixture.local().mask.leaf.hue_center, 123);
  assert.equal(oldLeaf.hue_center, null);
  assert.equal(calls[1], 'commit');
});

for (const changed of ['lane', 'mask', 'local', 'workflow', 'hidden gizmo']) test(`range sampling discards an in-flight result after changing ${changed}`, async () => {
  const fixture = setup();
  const { context, calls, gesture } = fixture;
  let finish;
  context.fetch = () => new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => ({ center: 123, width: 8 }) }); });
  const pending = context.finishLuminanceSampleGesture(gesture);
  await new Promise(setImmediate);
  if (changed === 'lane') context.state.currentView = 'sdr';
  if (changed === 'mask') fixture.local().mask.id = 'different-mask';
  if (changed === 'local') fixture.local().id = 'different-local';
  if (changed === 'workflow') context.state.activeWorkflow = 'proof';
  if (changed === 'hidden gizmo') context.state.localHiddenGizmoIds.add('local');
  finish();
  await pending;
  assert.equal(fixture.local().mask.leaf.hue_center, null);
  assert.equal(calls.length, 0);
});

test('a newer range gesture wins even when an older sample finishes last', async () => {
  const { context, gesture, local } = setup();
  const responses = [];
  context.fetch = () => new Promise(resolve => responses.push(hue => resolve({ ok: true, json: async () => ({ center: hue, width: 8 }) })));
  const first = context.finishLuminanceSampleGesture(gesture);
  await new Promise(setImmediate);
  const second = context.finishLuminanceSampleGesture(gesture);
  await new Promise(setImmediate);
  responses[1](150);
  await second;
  responses[0](20);
  await first;
  assert.equal(local().mask.leaf.hue_center, 150);
});
