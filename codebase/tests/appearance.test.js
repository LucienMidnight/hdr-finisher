const {test}=require("node:test");
const assert=require("node:assert/strict");
const appearance=require("../frontend/appearance.js");
const {sanitizeApplicationPreferences}=require("../desktop/lib/application-preferences.js");
test("accent choices survive preference sanitization and match browser normalization",()=>{
 for(const preset of Object.keys(appearance.presets)){
  const accent={preset,color:"#ffffff"};
  assert.deepEqual(sanitizeApplicationPreferences({accent}).accent,appearance.normalize(accent));
  assert.equal(appearance.normalize(accent).color,appearance.presets[preset]);
 }
 const accent={preset:"custom",color:"#A1B2C3"};
 assert.deepEqual(sanitizeApplicationPreferences({accent}).accent,{preset:"custom",color:"#a1b2c3"});
});
test("malformed accents return the approved orange default",()=>{
 for(const accent of [null,{}, {preset:"custom",color:"red"},{preset:"custom",color:"#123"},{preset:"unknown"}])
  assert.deepEqual(sanitizeApplicationPreferences({accent}).accent,appearance.normalize());
});
test("accent foreground uses linearized sRGB luminance",()=>{
 assert.equal(appearance.luminance("#000000"),0);
 assert.equal(appearance.luminance("#ffffff"),1);
 assert.ok(appearance.luminance("#d0612a")>.18);
 assert.ok(appearance.luminance("#566481")<.18);
});

test("theme redraw waits for editor state and elements, then redraws loaded graphs",()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 let changed,draws=0;
 const context=vm.createContext({window:{document:{documentElement:{},addEventListener(){}},MutationObserver:true},
   getComputedStyle:()=>({getPropertyValue:()=>"#aaa"}),
   MutationObserver:class {constructor(callback){changed=callback;}observe(){}},
   console:{warn:()=>assert.fail("Theme redraw threw")}});
 context.window.document.documentElement.style={setProperty(){}};
 vm.runInContext(fs.readFileSync(require.resolve('../frontend/appearance.js'),'utf8'),context);
 context.window.drawCurveEditor=()=>{draws++;};
 changed();assert.equal(draws,0);
 vm.runInContext('const state={session:null};',context);
 changed();assert.equal(draws,0);
 vm.runInContext('const els={};',context);
 changed();assert.equal(draws,1);
});

test("supported themes survive sanitization and retired or missing themes use Modern Dark",()=>{
 for(const theme of ["modern-dark","default-light","studio-gray"])
  assert.equal(sanitizeApplicationPreferences({theme}).theme,theme);
 for(const theme of ["default-dark","unknown",null,undefined,""])
  assert.equal(sanitizeApplicationPreferences({theme}).theme,"modern-dark");
});

test("first paint normalizes retired and missing themes in the app and embedded Library",()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const source=fs.readFileSync(require.resolve('../frontend/theme-startup.js'),'utf8');
 for(const theme of ['default-dark',undefined,'modern-dark','default-light','studio-gray']){
  const expected=['default-light','studio-gray'].includes(theme)?theme:'modern-dark';
  for(const embedded of [false,true]){
   const document={documentElement:{dataset:{}}},window={};
   const parent=embedded?{document:{documentElement:{dataset:{theme}}}}:window;
   vm.runInNewContext(source,{window,parent,document,localStorage:{getItem:()=>JSON.stringify({theme})}});
   assert.equal(document.documentElement.dataset.theme,expected);
  }
 }
});
