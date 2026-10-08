const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test}=require('node:test');
const crypto=require('node:crypto');
const {HDRGpuPassLayouts:passes}=require('../frontend/gpu-param-layout');
const {auditPassUses}=require('./gpu-pass-layout-audit');
const names=['gpu-params.js','webgpu-shaders.js','gpu-brush-mask.js','gpu-mask-resample.js','mask-raster.js','webgpu-preview.js'];
const sources=names.map(name=>fs.readFileSync(path.join(__dirname,'../frontend',name),'utf8'));
const audit=(input=sources)=>auditPassUses(input,passes.layouts);
test('local and mask pass slots have one frozen position list',()=>{
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(Object.entries(passes.layouts).map(([name,layout])=>[name,layout.fields]))).digest('hex'),'acf70297b2e2962ba457c9f0eb80790a95e4024ebe13573e6fdc7ad003647a5e');
 for(const layout of Object.values(passes.layouts)){
  assert.ok(Object.isFrozen(layout)&&Object.isFrozen(layout.fields)&&Object.isFrozen(layout.indices));
  assert.equal(new Set(layout.fields.map(f=>f.name)).size,layout.count);
  assert.deepEqual(layout.fields.map(f=>f.index),Array.from({length:layout.count},(_,i)=>i));
 }
 assert.equal(passes.layouts.LOCAL.count,23);assert.equal(passes.layouts.RASTER.count,10);
 assert.equal(passes.layouts.STROKE.count,10);assert.equal(passes.layouts.SEGMENT.count,5);
 assert.deepEqual(passes.record('BOX',{AXIS:1,RADIUS:7}),[7,1]);
 assert.throws(()=>passes.record('BOX',{UNKNOWN:0}),/Unknown BOX parameter/);
});
test('every local and mask setting is written and consumed by a shader',()=>assert.deepEqual(audit().errors,[]));
test('pass agreement rejects a missing local writer',()=>{
 const changed=sources.map(s=>s.replace('values[MASK_PARAMS.LOCAL.EXPOSURE] =','values[MASK_PARAMS.LOCAL.HIGHLIGHTS] ='));
 assert.ok(audit(changed).errors.includes('LOCAL.EXPOSURE read but never written'));
});
test('pass agreement rejects a missing mask writer or shader reader',()=>{
 assert.ok(audit(sources.map(s=>s.replace(/START_X: Number\(leaf.start.x\)/g,'START_Y: Number(leaf.start.x)'))).errors.includes('GRADIENT.START_X read but never written'));
 assert.ok(audit(sources.map(s=>s.replace(/MASK_PARAMS\.SHIFT\.NORMALIZED/g,'MASK_PARAMS.SHIFT.EDGE'))).errors.includes('SHIFT.NORMALIZED written but never read'));
});
test('pass agreement rejects bare positions, unknown names and reserved shader reads',()=>{
 assert.ok(audit([...sources,'const extra=`p[99]`;']).errors.includes('Bare shader parameter position'));
 assert.ok(audit([...sources,'const extra=`p[${MASK_PARAMS.STROKE.RESERVED}]`;']).errors.includes('STROKE.RESERVED reserved but read'));
 assert.ok(audit([...sources,'PASS_LAYOUTS.record("BOX", { UNKNOWN: 0 });']).errors.includes('Unknown BOX.UNKNOWN'));
});
test('shared local and mask layouts load before all browser consumers',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
 for(const name of names)assert.ok(html.indexOf('gpu-param-layout.js')<html.indexOf(name),name);
});

test('local and packed brush host access uses named positions and strides',()=>{
 const local=sources[0].slice(sources[0].indexOf('function buildLocalParams'),sources[0].indexOf('function softMaskIdentity'));
 const bare=text=>/\b(?:values|header)\[(?:cursor\s*\+\s*)?\d+\]/.test(text);
 assert.equal(bare(local),false);assert.equal(bare(sources[2]),false);assert.equal(bare(sources[4]),false);
 assert.ok(bare(local.replace('values[MASK_PARAMS.LOCAL.EXPOSURE]', 'values[2]')));
});
