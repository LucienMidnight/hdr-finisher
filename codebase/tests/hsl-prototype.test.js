const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = import('../tools/hsl-prototype/engine.mjs');

test('picker unions separated colors, subtracts, wraps red and rejects neutral samples',async()=>{
  const e=await engine,r=e.newRecipe();
  const color=h=>e.fromLab([.7,.15*Math.cos(h*Math.PI/180),.15*Math.sin(h*Math.PI/180)]);
  assert.equal(e.addSample(r,[.5,.5,.5]),false);
  e.addSample(r,color(355));e.addSample(r,color(140),'add');
  assert.ok(e.selection(color(2),r.ranges).weight>.99);
  assert.ok(e.selection(color(140),r.ranges).weight>.99);
  assert.equal(e.selection(color(70),r.ranges).weight,0);
  e.addSample(r,color(140),'subtract');
  assert.equal(e.selection(color(140),r.ranges).weight,0);
  assert.ok(e.selection(color(355),r.ranges).weight>.99);
  e.addSample(r,color(50),'pick');assert.equal(r.ranges.length,1);
});
test('feather is continuous and ranges are exposure independent',async()=>{
  const e=await engine,r={center:0,width:10,feather:20};
  assert.equal(e.rangeWeight(10,r),1);assert.equal(e.rangeWeight(20,r),.5);assert.equal(e.rangeWeight(30,r),0);
  const rgb=[.4,.08,.03],recipe=e.newRecipe();e.addSample(recipe,rgb);
  const a=e.selection(rgb,recipe.ranges).weight,b=e.selection(rgb.map(x=>x*64),recipe.ranges).weight;
  assert.ok(Math.abs(a-b)<1e-10);
});
test('neutral recipe and zero local mask leave HDR and negative channels exactly untouched',async()=>{
  const e=await engine,r=e.newRecipe(),pixels=new Float32Array([12,.2,-.03,.5]);
  assert.deepEqual(e.processCPU(pixels,r),pixels);
  e.addSample(r,[12,.2,-.03]);r.hue=70;r.saturation=50;
  assert.deepEqual(e.processCPU(pixels,r,new Float32Array([0])),pixels);
  const output=e.processCPU(pixels,r);assert.ok(output.every(Number.isFinite));assert.ok(Math.max(...output)>1);assert.equal(output[3],.5);
});
test('hue shift uses original selection, saturation removes chroma, EV scales linear light, and mask blends',async()=>{
  const e=await engine,r=e.newRecipe(),rgb=[.4,.08,.03];e.addSample(r,rgb);
  r.hue=100;const shifted=e.applyPixel(rgb,r);assert.ok(Math.abs(e.delta(e.describe(shifted).hue,e.describe(rgb).hue)-100)<.001);
  r.hue=0;r.saturation=-100;assert.ok(e.describe(e.applyPixel(rgb,r)).chroma<1e-6);
  r.saturation=0;r.luminance=1;const bright=e.applyPixel(rgb,r);rgb.forEach((x,i)=>assert.ok(Math.abs(bright[i]-2*x)<1e-6));
  const blend=e.applyPixel(rgb,r,.25);blend.forEach((x,i)=>assert.ok(Math.abs(x-(rgb[i]+.25*(bright[i]-rgb[i])))<1e-10));
});
test('uniformity contracts hues toward each selected center without changing membership',async()=>{
  const e=await engine,r=e.newRecipe();r.ranges=[{center:50,width:30,feather:10,subtract:false}];r.uniformity=100;
  const color=e.fromLab([.7,.15*Math.cos(65*Math.PI/180),.15*Math.sin(65*Math.PI/180)]);
  assert.ok(Math.abs(e.describe(e.applyPixel(color,r)).hue-50)<.001);
});
test('sampling averages linear light, ignores transparent pixels and clips neighborhood to image',async()=>{
  const e=await engine,p=new Float32Array([1,0,0,1,0,1,0,0,0,0,1,1,0,0,0,1]);
  assert.deepEqual(e.sampleNeighborhood(p,2,2,0,0),[1/3,0,1/3]);
});
test('recipes roundtrip, reject invalid numbers/capacity and do not silently truncate picker samples',async()=>{
  const e=await engine,r=e.newRecipe();e.addSample(r,[1,.1,0]);
  assert.deepEqual(e.validateRecipe(JSON.parse(JSON.stringify(r))),r);
  assert.throws(()=>e.validateRecipe({...r,hue:NaN}));
  assert.throws(()=>e.validateRecipe({...r,ranges:Array(33).fill(r.ranges[0])}));
  r.ranges=Array.from({length:32},(_,i)=>({center:i,width:1,feather:1,subtract:false}));
  assert.throws(()=>e.addSample(r,e.fromLab([.7,-.1,0]),'add'),/limited/);
});
