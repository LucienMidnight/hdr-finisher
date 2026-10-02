const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
const begin = source.indexOf('function applyAcceptedCpuScopePeak(');
const end = source.indexOf('function editingMeasurementRecipe()', begin);

test('a refused editing measurement cannot become an exact peak through CPU fallback', () => {
  const state = {scopeExactPeak:true, previewGeneration:{hdr:1}, acceptedPresentation:{
    lane:'hdr', generation:1, geometrySignature:'{}', exact:true, scopePeak:600, processedLongEdge:1600,
  }};
  const context = vm.createContext({state, geometrySignature:()=>'{}', projectReferenceWhiteNits:()=>203});
  vm.runInContext(source.slice(begin, end), context);
  const payload = {preview_kind:'hdr', peak_value:500, stats:[{label:'Peak', value:'500 nit'}]};
  context.applyEditingScopePeak(payload, {peak:null, refusals:['bounded measurement unavailable']}, 'hdr');
  context.applyAcceptedCpuScopePeak(payload, {lane:'hdr'});
  assert.equal(payload.peak_value, 500);
  assert.equal(payload.peak_exact, false);
  assert.equal(payload.stats[0].label, 'Peak (preview)');
  const fallback = {preview_kind:'hdr', stats:[{label:'Peak',value:'500 nit'}]};
  context.applyAcceptedCpuScopePeak(fallback, {lane:'hdr'});
  assert.equal(fallback.peak_value, 600);
  assert.equal(fallback.peak_exact, false);
  assert.equal(fallback.stats[0].label, 'Peak (preview)');
});

test('the displayed fallback peak is sent to delivery in its reference units', () => {
  const recorded = [];
  const context = vm.createContext({
    projectReferenceWhiteNits: () => 203,
    recordEditingMeasurement: (lane, values) => recorded.push({lane, peak:values.peak}),
  });
  vm.runInContext(source.slice(begin, end), context);
  context.recordDisplayedScopePeak({peak_value:2459.9817, peak_exact:false}, {tier:'settled',lane:'hdr'});
  context.recordDisplayedScopePeak({peak_value:.52, peak_exact:false}, {tier:'settled',lane:'sdr'});
  assert.equal(recorded.length, 2);
  assert.equal(recorded[0].lane, 'hdr');
  assert.equal(recorded[0].peak, 2459.9817*.18/203);
  assert.deepEqual(recorded[1], {lane:'sdr',peak:.52});
});

test('live, regional and missing peaks cannot replace delivery evidence', () => {
  let count = 0;
  const context = vm.createContext({recordEditingMeasurement: () => count++});
  vm.runInContext(source.slice(begin, end), context);
  context.recordDisplayedScopePeak({peak_value:600}, {tier:'interactive',lane:'hdr'});
  context.recordDisplayedScopePeak({peak_value:600}, {tier:'settled',lane:'hdr',scopeRegion:{x:0}});
  context.recordDisplayedScopePeak({}, {tier:'settled',lane:'hdr'});
  assert.equal(count, 0);
});
