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


test('picker drag widens one range across red and keeps every sampled hue selected',async()=>{
  const e=await engine,r=e.newRecipe();
  const color=h=>e.fromLab([.7,.15*Math.cos(h*Math.PI/180),.15*Math.sin(h*Math.PI/180)]);
  for(let h=330;h<=430;h++)e.addSample(r,color(h),h===330?'pick':'add');
  assert.equal(r.ranges.length,1);
  assert.ok(r.ranges[0].width>60);
  for(let h=330;h<=430;h++)assert.ok(e.selection(color(h),r.ranges).weight>.999);
  assert.equal(e.selection(color(180),r.ranges).weight,0);
  e.addSample(r,color(180),'add');
  assert.equal(r.ranges.length,2,'Separated colours retain their own range');
  for(let h=350;h<=390;h++)e.addSample(r,color(h),'subtract');
  assert.equal(r.ranges.length,3,'Subtraction widens independently of inclusion');
  assert.equal(r.ranges.filter(v=>v.subtract).length,1);
  assert.equal(e.selection(color(10),r.ranges).weight,0);
  assert.ok(e.selection(color(180),r.ranges).weight>.999);
});

test('picker bridges existing ranges before checking capacity and can cover the full wheel',async()=>{
  const e=await engine,r=e.newRecipe();
  const color=h=>e.fromLab([.7,.15*Math.cos(h*Math.PI/180),.15*Math.sin(h*Math.PI/180)]);
  r.ranges=[{center:0,width:16,feather:12,subtract:false},{center:60,width:16,feather:12,subtract:false}];
  e.addSample(r,color(30),'add');assert.equal(r.ranges.length,1);
  assert.ok(r.ranges[0].width>45);
  r.ranges=Array.from({length:32},(_,i)=>({center:i*10,width:1,feather:1,subtract:false}));
  e.addSample(r,color(0),'add');assert.ok(r.ranges.length<32);
  e.addSample(r,color(0),'pick');
  for(let h=1;h<=360;h++)e.addSample(r,color(h),'add');
  assert.equal(r.ranges.length,1);assert.equal(r.ranges[0].width,180);
  for(let h=0;h<360;h++)assert.ok(e.selection(color(h),r.ranges).weight>.999);
});
