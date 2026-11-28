const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { frontendSource } = require('./frontend-source.js');
const HDRHSL = require('../frontend/hsl-engine.js');

function setup(dpr = 2) {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const photo = { getBoundingClientRect: () => rect(-600, -400, 3000, 2000) };
  const surface = { closest: () => null };
  const control = { closest: () => ({}) };
  const pane = { contains: target => target === surface, getBoundingClientRect: () => rect(300, 100, 800, 600) };
  const context = vm.createContext({ HDRHSL, devicePixelRatio: dpr, state: { session: { session_id: 'photo' }, currentView: 'hdr' },
    activePreviewElement: () => photo, els: { previewPrimaryPane: pane, dropzone: pane } });
  vm.runInContext(frontendSource('hsl-panel.js') + '\nglobalThis.ui = hslUI;', context);
  context.ui.picker = { scope: 'global' };
  const event = (x, y, target = surface) => ({ clientX: x, clientY: y, button: 0, target,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
  return { context, event, control };
}

for (const dpr of [1, 2]) test(`HSL picks visible image coordinates in CSS points at ${dpr}x, including pan`, () => {
  const { context, event } = setup(dpr);
  const pointer = event(900, 600);
  context.hslPickStart(pointer);
  assert.equal(context.ui.stroke.points[0].x, .5);
  assert.equal(context.ui.stroke.points[0].y, .5);
  assert.equal(pointer.prevented, true);
  context.hslPickMove(event(1050, 650));
  assert.equal(context.ui.stroke.points.length, 2);
  assert.equal(context.ui.stroke.points[1].x, .55);
  assert.equal(context.ui.stroke.points[1].y, .525);
});

test('armed HSL picker cannot steal controls underneath the offscreen image rectangle', () => {
  const { context, event, control } = setup();
  const pointer = event(200, 350, control);
  context.hslPickStart(pointer);
  assert.equal(context.ui.stroke, null);
  assert.equal(pointer.prevented, undefined);
  assert.equal(context.hslPoint(event(1200, 350)), null);
});

test('HSL picker ignores a floating control over the visible picture', () => {
  const { context, event, control } = setup();
  const pointer = event(900, 600, control);
  context.hslPickStart(pointer);
  assert.equal(context.ui.stroke, null);
  assert.equal(pointer.stopped, undefined);
});

test('oversized photo and pane rectangles are both clipped by the scrolling dropzone', () => {
  const { context, event } = setup();
  context.els.previewPrimaryPane.getBoundingClientRect = () => context.activePreviewElement().getBoundingClientRect();
  context.els.dropzone = { getBoundingClientRect: () => ({ left: 300, top: 100, right: 1100, bottom: 700 }) };
  assert.equal(context.hslPoint(event(1200, 350)), null);
  assert.equal(context.hslPoint(event(900, 600)).x, .5);
});

test('2x picker sends normalized coordinates and applies the returned colour to the selected channel', async () => {
  const { context, event } = setup();
  const recipe = HDRHSL.newRecipe();
  const channel = { id: 'red', kind: 'band', recipe };
  const ui = context.ui.picker;
  Object.assign(ui, { channel: 'red', mode: 'pick' });
  context.state.adjustments = {};
  context.state.editRevision = 7;
  let saves = 0;
  let acknowledge;
  context.syncGlobalEditState = async () => { saves++; return true; };
  context.state.editCommandQueue = new Promise(resolve => { acknowledge = resolve; });
  context.localAdjustments = () => [];
  context.safeJson = response => response.json();
  context.hslNotice = (_ui, text) => { ui.notice = text; };
  context.hslChannel = () => channel;
  context.hslEdit = (_ui, change) => change();
  let body;
  context.fetch = async (_url, request) => {
    body = JSON.parse(request.body);
    return { ok: true, json: async () => ({ samples: [[.8, .1, .02]], edit_revision: 7 }) };
  };
  context.hslPickStart(event(900, 600));
  const pending = context.hslPickSamples(context.ui.stroke);
  await new Promise(setImmediate);
  assert.equal(saves, 1);
  assert.equal(body, undefined);
  acknowledge();
  await pending;
  assert.equal(saves, 1);
  assert.deepEqual(body.points, [{ x: .5, y: .5 }]);
  assert.equal(body.lane, 'hdr');
  assert.equal(body.edit_revision, 7);
  assert.equal(recipe.ranges.length, 1);
  assert.ok(Math.abs(recipe.ranges[0].center - HDRHSL.describe([.8, .1, .02]).hue) < 1e-10);
  assert.match(ui.notice, /Colours selected/);
});

for (const cancellation of ['stop', 'rearm', 'local']) test(`HSL discards a delayed colour sample after ${cancellation}`, async () => {
  const { context, event } = setup();
  const recipe = HDRHSL.newRecipe();
  const ui = context.ui.picker;
  Object.assign(ui, { channel: 'red', mode: 'pick', pickGeneration: 1 });
  context.syncGlobalEditState = async () => true;
  context.hslNotice = () => {};
  context.hslChannel = () => ({ id: 'red', kind: 'band', recipe });
  context.hslEdit = (_ui, change) => change();
  let finish;
  context.hslFetchStage = () => new Promise(resolve => { finish = resolve; });
  context.hslPickStart(event(900, 600));
  const pending = context.hslPickSamples(context.ui.stroke);
  await new Promise(setImmediate);
  if (cancellation === 'stop') context.ui.picker = null;
  if (cancellation === 'rearm') ui.pickGeneration += 1;
  if (cancellation === 'local') {
    ui.scope = 'local';
    context.selectedLocal = () => ({ id: 'another-local' });
  }
  finish({ samples: [[.8, .1, .02]] });
  await pending;
  assert.equal(recipe.ranges.length, 0);
  assert.equal(ui.sampling, false);
});

test('photo cursor follows HSL and local range owners and clears on exit', () => {
  const { context } = setup();
  let armed = false, cursor = '', local = null;
  const pane = context.els.previewPrimaryPane;
  pane.classList = { toggle(_name, value) { armed = value; } };
  pane.style = { setProperty(_name, value) { cursor = value; } };
  context.getComputedStyle = () => ({getPropertyValue: name => ({'--compact-action-size':'26px','--text':'#f2f2f2','--inverse':'#0c0c0c'})[name]});
  context.selectedLocal = () => local;
  context.selectedMaskLeaf = () => local?.leaf;
  context.localGizmoVisible = () => Boolean(local?.gizmo);
  context.state.activeWorkflow = 'grade';context.state.gradeMode = 'global';
  context.syncPhotoPickCursor();assert.equal(armed, true);
  assert.match(cursor, /data:image\/svg\+xml/);assert.match(cursor, /4 22, crosshair$/);
  context.ui.picker = null;context.syncPhotoPickCursor();assert.equal(armed, false);
  local = {gizmo:true,leaf:{type:'hue_range'}};context.state.gradeMode = 'local';
  context.syncPhotoPickCursor();assert.equal(armed, true);
  local.gizmo = false;context.syncPhotoPickCursor();assert.equal(armed, false);
  local.gizmo = true;local.leaf.type = 'luminance_range';context.syncPhotoPickCursor();assert.equal(armed, true);
  local.leaf.type = 'brush';context.syncPhotoPickCursor();assert.equal(armed, false);
  context.ui.picker = {};context.state.activeWorkflow = 'proof';context.syncPhotoPickCursor();assert.equal(armed, false);
  context.state.activeWorkflow = 'grade';context.state.session = null;context.syncPhotoPickCursor();assert.equal(armed, false);
});
