const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { frontendSource } = require('./frontend-source.js');

test('projective brush fallback replays paint and erase in order and reuses the finished mask', () => {
  const canvases = [];
  const draws = [];
  const context = vm.createContext({
    state: { localShowMask: false },
    document: { createElement: () => {
      const canvas = { alpha: 0 };
      const ctx = {
        canvas,
        fillRect() { canvas.alpha = 255; },
        drawImage(source) { canvas.alpha = source.alpha; },
        getImageData() { return { data: Uint8ClampedArray.of(0, 0, 0, canvas.alpha) }; },
        putImageData({ data }) { canvas.alpha = data[3]; },
      };
      canvas.getContext = () => ctx;
      canvases.push(canvas);
      return canvas;
    } },
    settledProxyLongEdge: () => 256,
    localBrushMaskCanvasCache: new Map(), LOCAL_BRUSH_MASK_CACHE_LIMIT: 4,
    clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)),
  });
  vm.runInContext(frontendSource('mask-overlay.js'), context);
  context.postProcessBrushMaskPreview = source => source;
  context.tintedBrushMaskCanvas = source => source;
  context.drawBrushMaskStroke = (ctx, { alpha, erase }) => {
    ctx.canvas.alpha = erase ? 0 : alpha;
    draws.push([canvases.indexOf(ctx.canvas), alpha, Boolean(erase)]);
  };
  const painted = [];
  const surface = { save() {}, restore() {}, drawImage(canvas) { painted.push(canvas.alpha); } };
  const strokes = [{ alpha: 255 }, { alpha: 0, erase: true }, { alpha: 128 }];
  const expression = { operator: 'leaf', leaf: { type: 'brush', strokes } };
  const mapped = [];
  const mapper = { signature: 'perspective', stroke: stroke => { mapped.push(stroke); return stroke; } };
  const options = { localId: 'local', spatialSignature: 'mask', suppressGizmo: true };
  const draw = extra => context.drawBrushExpressionOutputSpace(surface, expression, x => x, y => y, { ...options, ...extra }, mapper);

  draw();
  context.state.localShowMask = true;
  draw({ authoritative: { canvas: { alpha: 80 } } });
  assert.deepEqual(mapped, []);
  assert.deepEqual(painted, []);
  draw();
  draw();
  assert.deepEqual(mapped, strokes);
  assert.deepEqual(draws, [[0, 255, false], [1, 0, true], [0, 128, false], [1, 128, false]]);
  assert.deepEqual(painted, [64, 64]);
});

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
