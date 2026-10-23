const {test}=require('node:test');
const assert=require('node:assert/strict');
const h=require('../frontend/hsl-engine.js');
const {HDRGpuParamLayout:layout}=require('../frontend/gpu-param-layout.js');

test('HSL packs every bounded channel and range without touching existing slots',()=>{
 const settings=h.defaultSettings();
 for(let i=0;i<4;i++)settings.channels.push({id:`custom-${i}`,kind:'custom',recipe:h.newRecipe()});
 for(const c of settings.channels){c.recipe.hue=25;c.recipe.ranges=Array.from({length:32},(_,i)=>({center:i*10,width:5,feather:2,subtract:i%2===1}));}
 const values=new Float32Array(layout.count).fill(-7);
 assert.equal(h.pack(values,settings),13);
 assert.ok(values.slice(0,198).every(v=>v===-7));
 assert.equal(values[198],13);assert.equal(values[199],-7);
 for(let i=0;i<13;i++){
  const at=200+i*136;assert.deepEqual(Array.from(values.slice(at,at+6)),[25,0,0,0,32,1]);
  assert.deepEqual(Array.from(values.slice(at+8+31*4,at+8+32*4)),[310,5,2,1]);
 }
 assert.equal(200+13*136,values.length);
 assert.equal(h.pack(values,settings,false),0);assert.equal(values[198],0);
 assert.equal(h.pack(values,h.defaultSettings()),0);
});

test('global channels combine deltas from one input, independently of order',()=>{
 const r=h.newRecipe();h.addSample(r,[.4,.08,.03]);r.hue=45;
 const b=structuredClone(r);b.saturation=25;b.hue=-20;
 const rgb=[.4,.08,.03],channels=[{recipe:r},{recipe:b}];
 const expected=rgb.map((v,i)=>v+h.applyPixel(rgb,r)[i]-v+h.applyPixel(rgb,b)[i]-v);
 const actual=h.applyChannels(rgb,channels);
 actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-12));
 assert.deepEqual(h.applyChannels(rgb,[]),rgb);
});
