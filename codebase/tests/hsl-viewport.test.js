const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { declarations } = require('./frontend-source.js');

test('2x selection requests the clipped viewport and places its cropped overlay in full-photo coordinates', () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const photo = { getBoundingClientRect: () => rect(-600, -400, 3000, 2000) };
  const pane = { getBoundingClientRect: () => rect(300, 100, 800, 600) };
  const image = { hslOwner: {}, style: {} };
  let scheduled;
  const context = vm.createContext({ devicePixelRatio: 2, activePreviewElement: () => photo,
    els: { previewPrimaryPane: pane, dropzone: pane }, state: { activeWorkflow: 'grade' }, hslUI: {},
    document: { getElementById: () => image }, previewIsVisible: () => true,
    clearTimeout() {}, setTimeout: callback => { scheduled = callback; } });
  vm.runInContext(declarations('hslVisibleRect', 'hslPlaceOverlay'), context);
  const region = context.hslVisibleRect();
  assert.equal(region.x, .3);
  assert.equal(region.y, .25);
  assert.equal(region.width, 800 / 3000);
  assert.equal(region.height, .3);
  image.hslRegion = region;
  context.hslPlaceOverlay();
  assert.deepEqual(image.style, { left: '0px', top: '0px', width: '800px', height: '600px' });
  assert.equal(scheduled, undefined);
  photo.getBoundingClientRect = () => rect(-700, -400, 3000, 2000);
  context.hslPlaceOverlay();
  assert.equal(image.style.left, '-100px');
  assert.equal(typeof scheduled, 'function');
  scheduled = undefined;
  image.hslOwner.selectionRequest = 2;
  context.hslPlaceOverlay();
  assert.equal(scheduled, undefined, 'Pan does not flood an in-flight selection request');
});

test('selection retains the last overlay until its replacement decodes and ignores a cleared response', async () => {
  let active;
  const button = { getAttribute: () => 'true', setAttribute() {} };
  const ui = { scope: 'global', host: { querySelector: () => button } };
  let deliver;
  let decode;
  const previous = { replaceWith: image => { active = image; }, remove: () => { active = null; } };
  active = previous;
  const context = vm.createContext({ state: { session: {}, activeWorkflow: 'grade' }, hslUI: { panels: [ui], overlayRevision: 0 },
    document: { getElementById: () => active, createElement: () => ({ style: {},
      remove: () => { active = null; }, decode: () => new Promise(resolve => { decode = resolve; }) }) },
    els: { previewPrimaryPane: { append: image => { active = image; } } }, clearTimeout() {},
    hslBypassed: () => false, hslChannel: () => ({ recipe: {} }), hslVisibleRect: () => null,
    hslFetchStage: () => new Promise(resolve => { deliver = resolve; }), hslPlaceOverlay() {},
    hslNotice: (_ui, message) => assert.fail(message) });
  vm.runInContext(declarations('hslSelection', 'hslClearSelection'), context);
  const first = context.hslSelection(ui);
  assert.equal(active, previous);
  deliver({ selection_overlay: 'valid-png' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(active, previous, 'Fetch completion must not remove the old image before decode');
  decode();await first;
  assert.notEqual(active, previous);
  const second = context.hslSelection(ui);
  context.hslClearSelection();
  deliver({ selection_overlay: 'stale-png' });await second;
  assert.equal(active, null, 'A late response cannot resurrect a cleared selection');
});
