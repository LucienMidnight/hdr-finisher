const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function control(value = '') {
  const attributes = new Map();
  const classes = new Set();
  return {value, checked: false, disabled: true, dataset: {}, options: [],
    classList: {toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      add(name) { classes.add(name); }, contains(name) { return classes.has(name); }},
    setAttribute(name, text) { attributes.set(name, text); },
    getAttribute(name) { return attributes.get(name) || null; },
    querySelectorAll() { return []; }, querySelector() { return null; }};
}

function context() {
  const names = ['rawSettingsSection', 'rawSettingsPanel', 'rawSettingsToggle', 'rawHighlightGroup',
    'rawPixelCleanupGroup', 'rawRemoveHotPixels', 'lensMode', 'lensDistortion', 'lensChromaticAberration',
    'lensVignetting', 'lensFocal', 'lensAperture', 'lensDistance', 'manualLensControls', 'lensSettingsNote',
    'lensProfile', 'rawHighlightMethod', 'rawHighlightThreshold', 'rawHighlightThresholdValue',
    'rawEdgeColourExpand', 'rawHighlightBypass'];
  const els = Object.fromEntries(names.map(name => [name, control()]));
  els.rawPixelCleanupGroup.querySelectorAll = () => [els.rawRemoveHotPixels];
  const state = {rawSettingsOpen: false, editDocument: {source: {raw_import_settings: {
    pixel_cleanup: {remove_hot_pixels: true}, highlight_reconstruction: {enabled: true, method: 'edge_colour_v1',
      clipping_threshold: 1.1, edge_colour_expand_percent: 1.5}}}}};
  const result = {els, state, isRawSession: session => session?.raw === true,
    renderRawHighlightState() {}, optionalPositiveNumber: value => Number(value) || null,
    loadLensProfiles() {}, updateRangeVisual() {}};
  vm.createContext(result);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/session-import.js'), 'utf8'), result);
  return result;
}

test('Pixel cleanup is enabled only for supported Bayer RAW and restores saved state', () => {
  const fixture = context();
  const {els} = fixture;
  fixture.renderRawImportControls({raw: true, session_id: 'bayer', source: {suffix: '.arw'},
    metadata: {extra: {raw_pipeline: 'camera_linear_signed_ahd_opposed_v3', raw_pixel_cleanup: {supported: true}}}});
  assert.equal(els.rawRemoveHotPixels.disabled, false);
  assert.equal(els.rawRemoveHotPixels.checked, true);
  assert.equal(els.rawPixelCleanupGroup.classList.contains('modified'), true);
  assert.equal(els.rawHighlightMethod.value, 'edge_colour_v1');
  assert.equal(els.rawEdgeColourExpand.value, '1.5');
  for (const session of [null, {raw: false, source: {suffix: '.png'}, metadata: {}}, {raw: true, source: {suffix: '.raf'},
    metadata: {extra: {raw_pixel_cleanup: {supported: false}}}}, {raw: true, source: {suffix: '.dng'},
    metadata: {extra: {raw_mosaiced: false}}}]) {
    fixture.renderRawImportControls(session);
    assert.equal(els.rawRemoveHotPixels.disabled, true);
    assert.match(els.rawPixelCleanupGroup.title, /Bayer.*X-Trans.*linear DNG/);
  }
});

test('RAW payload carries the checkbox without changing other development controls', () => {
  const fixture = context();
  fixture.els.rawHighlightMethod.value = 'edge_colour_v1';
  fixture.els.rawHighlightThreshold.value = '1.1';
  fixture.els.rawEdgeColourExpand.value = '1.5';
  fixture.els.lensMode.value = 'off';
  fixture.els.rawRemoveHotPixels.checked = true;
  const on = fixture.rawImportSettingsPayload();
  fixture.els.rawRemoveHotPixels.checked = false;
  const off = fixture.rawImportSettingsPayload();
  assert.equal(on.pixel_cleanup.remove_hot_pixels, true);
  assert.equal(off.pixel_cleanup.remove_hot_pixels, false);
  assert.equal(on.highlight_reconstruction.method, 'edge_colour_v1');
  assert.equal(on.highlight_reconstruction.edge_colour_expand_percent, 1.5);
  delete on.pixel_cleanup; delete off.pixel_cleanup;
  assert.deepEqual(on, off);
});
