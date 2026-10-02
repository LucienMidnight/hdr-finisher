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
