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

test('Film stock fact chips remain in place until the displayed stock facts change', () => {
 const {frontendSource} = require('./frontend-source.js');
 const panel = {children: [], replaceChildren(...children) { this.children = children; }};
 const film = defaultFilmLook();
 const c = vm.createContext({HDRFilmCharacter: C, state: {currentView: 'hdr', adjustments: {hdr: {film_look: film}}},
  document: {querySelector: () => null, querySelectorAll: () => [],
   getElementById: id => id === 'film-stock-facts' ? panel : null, createElement: () => ({})}});
 vm.runInContext(frontendSource('adjustment-controls.js'), c);
 c.renderFilmPanel();
 const neutral = panel.children;
 assert.deepEqual(neutral.map(chip => chip.textContent), ['Straight response', 'No grain or halation of its own']);
 C.set(film, 'look_strength', 0.55);
 c.renderFilmPanel();
 assert.equal(panel.children, neutral);
 C.select(film, 'kodak_portra_400');
 c.renderFilmPanel();
 assert.notEqual(panel.children, neutral);
 assert.equal(panel.children.length, 4);
 assert.equal(panel.children[0].textContent, 'Still film');
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

test('Portra leads the list while a new Film Look remains Neutral',()=>{
 assert.equal(looks[0].id,'portra-400-natural');
 assert.equal(defaultFilmLook().film_stock,'none');
});


test('saved lens choices round-trip in lane state and full Look recipes',()=>{
 // These are the values previously written by the five Lens shortcuts.
 for(const [filter,strength] of [['none',.5],['black_pro_mist',.125],['pro_mist',.25],['glimmerglass',.25],['cinebloom',.5]]) {
  const f=C.select(defaultFilmLook(),'kodak_portra_400');
  for(const [key,value] of Object.entries({lens_filter:filter,lens_strength:strength,lens_size:1})) C.set(f,key,value);
  const reopened=plain(f);
  assert.deepEqual(plain(C.expand(plain(C.sparse(reopened)))),reopened);
  for(const look of looks) {
   const recipe={...plain(look.recipe),lens_filter:filter,lens_strength:strength,lens_size:1};
   const restored=C.expand(plain(recipe));
   assert.equal(restored.lens_filter,filter); assert.equal(restored.lens_strength,strength); assert.equal(restored.lens_size,1);
   assert.deepEqual(plain(C.expand(plain(C.sparse(restored)))),plain(restored));
  }
 }
});


test('former Print and Scan values survive saved lane and full Look recipe round-trips',()=>{
 const printBase={print_paper:'default',print_exposure:0,stock_print_warmth:0,stock_print_tint:0,stock_preflash:0,print_contrast:0,shadow_contrast:0,highlight_contrast:0};
 const prints=[{}, {stock_print_warmth:15}, {stock_print_warmth:-15}, {print_contrast:-20}, {print_contrast:20}, {print_paper:'kodak_2383'}].map(values=>({...printBase,...values}));
 const scans=[{scan_sharpening:0,lab_levels:false},{scan_sharpening:25,lab_levels:true}];
 for(const print of prints) for(const scan of scans) for(const look of looks) {
  const film=C.expand(plain(look.recipe));
  for(const [key,value] of Object.entries({...print,...scan})) C.set(film,key,value);
  const savedLane=plain(film);
  assert.deepEqual(plain(C.expand(plain(C.sparse(savedLane)))),savedLane);
  for(const [key,value] of Object.entries({...print,...scan})) assert.equal(savedLane[key],value);
 }
});
