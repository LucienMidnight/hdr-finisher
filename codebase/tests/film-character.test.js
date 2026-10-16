const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../frontend/film-character.js');
const data = require('../frontend/film-character-data.js');
function film() { return {...data.stocks.none.defaults, film_stock:'none', stock_overrides:[], grain_film_format:'16mm', push_pull:0, lens_filter:'cinebloom', look_strength:60, stock_exposure:1}; }
test('stock defaults update only inherited controls, including equal-value deliberate edits', () => {
 const f=film(); C.select(f,'kodak_portra_400');
 assert.equal(f.grain_amount,data.portra_400_anchor_amount);
 assert.ok(f.halation_amount>0);
 C.set(f,'grain_amount',f.grain_amount); C.set(f,'print_paper','kodak_2383');
 const amount=f.grain_amount; C.select(f,'kodak_vision3_500t');
 assert.equal(f.grain_amount,amount); assert.equal(f.print_paper,'kodak_2383');
 assert.equal(f.grain_size,data.stocks.kodak_vision3_500t.defaults.grain_size);
 for (const [k,v] of Object.entries({grain_film_format:'16mm',push_pull:0,lens_filter:'cinebloom',look_strength:60,stock_exposure:1})) assert.equal(f[k],v);
 C.reset(f,'grain_amount'); assert.equal(f.grain_amount,data.stocks.kodak_vision3_500t.defaults.grain_amount);
 C.select(f,'kodak_gold_200'); assert.equal(f.grain_amount,data.stocks.kodak_gold_200.defaults.grain_amount);
});
test('each owned control independently keeps its value and returns to current stock', () => {
 for(const key of C.owned) {
  const f=film(); C.select(f,'kodak_portra_400'); C.set(f,key,f[key]); const held=f[key];
  C.select(f,'kodak_vision3_50d'); assert.equal(f[key],held); assert.deepEqual(f.stock_overrides,[key]);
  C.reset(f,key); assert.equal(f[key],data.stocks.kodak_vision3_50d.defaults[key]); assert.deepEqual(f.stock_overrides,[]);
 }
});
test('Neutral adds no own effects and slide switches preserve deliberately chosen paper', () => {
 const f=film(); C.select(f,'kodak_portra_400'); C.select(f,'none'); assert.equal(f.grain_amount,0); assert.equal(f.halation_amount,0);
 C.set(f,'grain_amount',40); C.set(f,'print_paper','kodak_2383'); C.select(f,'fujifilm_velvia_100'); C.select(f,'none');
 assert.equal(f.grain_amount,40); assert.equal(f.print_paper,'kodak_2383');
});
test('halation UI is relative, round-trips ordinary renderer values and preserves absolute overrides', () => {
 for(const id of Object.keys(data.stocks)) {
  const f=film(); C.select(f,id);
  for(const key of ['halation_amount','halation_radius','halation_hue_offset','halation_saturation']) {
   for(const v of [0,50,100]) assert.ok(Math.abs(C.toUi(f,key,C.fromUi(f,key,v))-v)<1e-6);
   if(id!=='none') assert.ok(Math.abs(C.toUi(f,key,f[key])-(key==='halation_hue_offset'?0:100))<1e-6);
  }
 }
 const f=film(); C.select(f,'kodak_portra_400'); C.set(f,'halation_amount',7); C.select(f,'kodak_verita_200d'); assert.equal(f.halation_amount,7);
});
test('Portra measured pushes update inherited grain without owning Push/Pull', () => {
 const f=film(); C.select(f,'kodak_portra_800'); C.set(f,'push_pull',1); assert.equal(f.grain_amount,data.stocks.kodak_portra_800_push1.defaults.grain_amount);
 C.set(f,'grain_size',20); C.set(f,'push_pull',2); assert.equal(f.grain_size,20); assert.equal(f.grain_amount,data.stocks.kodak_portra_800_push2.defaults.grain_amount);
 C.select(f,'kodak_portra_400'); assert.equal(f.push_pull,2); assert.equal(f.grain_amount,data.portra_400_anchor_amount);
});
test('saved lane ownership survives JSON and Match copies without sharing state', () => {
 const hdr=film(); C.select(hdr,'kodak_portra_400'); C.set(hdr,'grain_amount',19);
 const reopened=JSON.parse(JSON.stringify({hdr})); const sdr=structuredClone(reopened.hdr);
 C.select(sdr,'kodak_gold_200'); assert.equal(sdr.grain_amount,19); C.reset(sdr,'grain_amount');
 assert.equal(reopened.hdr.grain_amount,19); assert.deepEqual(reopened.hdr.stock_overrides,['grain_amount']);
});
