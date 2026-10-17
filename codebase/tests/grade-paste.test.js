const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectionModel} = require('../frontend/grade-paste.js');
const groups = [
  {id:'hdr-tone',lane:'hdr',settings:[{id:'hdr.exposure',modified:true},{id:'hdr.contrast',modified:false}]},
  {id:'sdr-colour',lane:'sdr',settings:[{id:'sdr.saturation',modified:true}]},
  {id:'geometry',settings:[{id:'shared.geometry',modified:true}]}
];
test('paste selection preserves partial choices and inactive lane values', () => {
  const model = selectionModel(groups,{lanes:['hdr'],settings:['hdr.exposure','sdr.saturation','unknown']});
  assert.deepEqual(model.value(),{lanes:['hdr'],settings:['hdr.exposure','sdr.saturation']});
  assert.deepEqual(model.active().map(g=>g.id),['hdr-tone']);
  model.toggleLane('sdr',true); assert.deepEqual(model.active().map(g=>g.id),['hdr-tone','sdr-colour']);
  model.toggle('hdr.contrast',true); model.toggle('hdr.exposure',false);
  assert.deepEqual(model.value().settings,['hdr.contrast','sdr.saturation']);
});
test('quick paste choices select results from per-setting modifications', () => {
  const model=selectionModel(groups,{lanes:['hdr','sdr'],settings:[]});
  model.choose('modified'); assert.deepEqual(model.value().settings,['hdr.exposure','sdr.saturation','shared.geometry']);
  model.choose('none'); assert.deepEqual(model.active(),[]);
  model.choose('all'); assert.equal(model.value().settings.length,4);
});
