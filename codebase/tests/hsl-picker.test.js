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

test('2x picker sends normalized coordinates and applies the returned colour to the selected channel', async () => {
  const { context, event } = setup();
  const recipe = HDRHSL.newRecipe();
  const channel = { id: 'red', kind: 'band', recipe };
  const ui = context.ui.picker;
  Object.assign(ui, { channel: 'red', mode: 'pick' });
  context.state.adjustments = {};
  context.state.editRevision = 7;
  context.syncGlobalEditState = async () => true;
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
  await context.hslPickSamples(context.ui.stroke);
  assert.deepEqual(body.points, [{ x: .5, y: .5 }]);
  assert.equal(body.lane, 'hdr');
  assert.equal(body.edit_revision, 7);
  assert.equal(recipe.ranges.length, 1);
  assert.ok(Math.abs(recipe.ranges[0].center - HDRHSL.describe([.8, .1, .02]).hue) < 1e-10);
  assert.match(ui.notice, /Colours selected/);
});
