const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../frontend/film-character.js');
const source = fs.readFileSync(require.resolve('../frontend/app-state.js'),'utf8');
const context = vm.createContext({HDRFilmCharacter:C});
vm.runInContext(source.slice(source.indexOf('const defaultFilmLook ='), source.indexOf('const defaultColorGrading ='))+'; globalThis.result={defaultFilmLook,FILM_LOOK_PRESETS};',context);
const {defaultFilmLook,FILM_LOOK_PRESETS:looks}=context.result;
const plain = x => JSON.parse(JSON.stringify(x));
test('each stage changes only its controls and owns every deliberately set value',()=>{
 const allowed={Lens:['lens_filter','lens_strength','lens_size'],Format:['grain_film_format'],Development:['push_pull'],Print:['print_paper','print_exposure','stock_print_warmth','stock_print_tint','stock_preflash','print_contrast','shadow_contrast','highlight_contrast'],Scan:['scan_sharpening','lab_levels']};
 for(const [stage,entries] of Object.entries(C.stages)) for(let i=0;i<entries.length;i++) {
  const f=C.select(defaultFilmLook(),'kodak_gold_200');
  C.set(f,'look_strength',63); const before=plain(f);
  C.stage(f,stage,i);
  for(const key of Object.keys(f)) if(key!=='stock_overrides' && !allowed[stage].includes(key)) assert.deepEqual(f[key],before[key],`${stage} changed ${key}`);
  for(const key of Object.keys(entries[i][1])) assert.ok(f.stock_overrides.includes(key));
 }
});
test('all approved Looks replace previous choices and survive sparse save/reopen and stock changes',()=>{
 assert.equal(looks.length,11);
 for(const look of looks) {
  const f=C.expand(look.recipe);
  assert.deepEqual(plain(Object.keys(f).sort()),plain(Object.keys(defaultFilmLook()).sort()));
  const saved=plain(C.sparse(f));
  assert.deepEqual(plain(C.expand(saved)),plain(f));
  const held=Object.fromEntries(f.stock_overrides.map(key=>[key,f[key]]));
  C.select(f,'kodak_gold_200');
  for(const [key,value] of Object.entries(held)) assert.equal(f[key],value);
  if(!f.stock_overrides.includes('grain_amount')) assert.equal(f.grain_amount,C.character(f).defaults.grain_amount);
  for(const key of Object.keys(saved)) assert.ok(['film_stock','print_paper','stock_overrides',...f.stock_overrides].includes(key));
 }
 const natural=C.expand(looks.find(x=>x.id==='portra-400-natural').recipe);
 assert.deepEqual(natural.stock_overrides,[]);
 assert.deepEqual(Object.keys(C.sparse(natural)).sort(),['film_stock','print_paper','stock_overrides']);
});
test('manual equal-value edits, toggles and strength are saved; maps are never Looks',()=>{
 const f=C.select(defaultFilmLook(),'kodak_portra_400');
 for(const key of C.tracked) C.set(f,key,f[key]);
 f.grain_view_map=true; f.halation_view_map=true;
 const saved=C.sparse(f), reopened=C.expand(plain(saved));
 for(const key of C.tracked) assert.equal(reopened[key],f[key]);
 assert.equal(reopened.grain_view_map,false); assert.equal(reopened.halation_view_map,false);
 for(const key of C.tracked) {C.reset(reopened,key); assert.equal(reopened[key],C.defaults(reopened)[key]);}
 assert.deepEqual(reopened.stock_overrides,[]);
});
test('measured push inherits pushed grain without pinning it into the Look',()=>{
 const f=C.expand(looks.find(x=>x.id==='high-speed-texture').recipe);
 assert.equal(f.grain_amount,C.character(f).defaults.grain_amount);
 assert.equal(f.push_pull,1); assert.equal(f.grain_film_format,'super16');
 assert.equal(C.sparse(f).grain_amount,undefined);
});
