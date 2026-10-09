const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const {HDRGpuParamLayout:layout}=require('../frontend/gpu-param-layout.js');
const {HDRWebGPUShaders:shaders}=require('../frontend/webgpu-shaders.js');
const {auditGlobalParameterUses}=require('./gpu-param-layout-audit.js');
const read=name=>fs.readFileSync(path.join(__dirname,'../frontend',name),'utf8');
const sources=['gpu-render-plan.js','gpu-params.js','webgpu-preview.js','graph-scale.js'].map(read);
const shaderSource=shaders.SHADER_SOURCE+'\n'+shaders.PEAK_REDUCTION_SHADER_SOURCE;
const audit=(js=sources,wgsl=shaderSource)=>auditGlobalParameterUses(js,wgsl,layout.fields);

test('the global parameter list preserves all 190 names and original positions',()=>{
 assert.equal(layout.count,190);
 assert.equal(new Set(layout.fields.map(f=>f.name)).size,190);
 assert.deepEqual(layout.fields.map(f=>f.index),Array.from({length:190},(_,i)=>i));
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(layout.fields.map(({name,index})=>[name,index]))).digest('hex'),'42f4f5f064f2580cf65203db259e7e673809d412516c4ea87a02a0e8aa37cc51');
 assert.deepEqual(layout.fields.filter(f=>f.reserved).map(f=>f.index),[14,60]);
 assert.deepEqual(layout.fields.filter(f=>f.hostOnly).map(f=>f.name),['DETAIL_ENABLED']);
 assert.ok(Object.isFrozen(layout)&&Object.isFrozen(layout.indices)&&Object.isFrozen(layout.fields));
 assert.ok(layout.fields.every(Object.isFrozen));
 assert.equal(shaders.BLACK_AND_WHITE_PARAM,layout.indices.BLACK_AND_WHITE_ENABLED);
});

test('every active global setting has its writer and its consumer',()=>{
 assert.deepEqual(audit().errors,[]);
});

test('the use guard catches a shader read without a JavaScript write',()=>{
 const changed=sources.map(s=>s.replace(/params\[GPU_PARAMS\.EXPOSURE\](\s*=(?!=))/g,'params[GPU_PARAMS.HIGHLIGHT_SOFTNESS]$1'));
 assert.ok(audit(changed).errors.includes('EXPOSURE is read but never written'));
});

test('the use guard catches a JavaScript write without a shader read',()=>{
 const changed=shaderSource.replace(/\b(p|peakParams)\[2\]/g,'$1[3]');
 assert.ok(audit(sources,changed).errors.includes('EXPOSURE is written but never read'));
});

test('the use guard rejects unknown names and reserved positions',()=>{
 assert.throws(()=>audit([...sources,'params[GPU_PARAMS.UNKNOWN_SETTING] = 0;']),/Unknown parameter UNKNOWN_SETTING/);
 assert.ok(audit([...sources,'params[GPU_PARAMS.RESERVED_60] = 0;']).errors.includes('RESERVED_60 is reserved but used'));
});

test('the global position list loads before the consumers in the page',()=>{
 const html=read('index.html'),schema=html.indexOf('gpu-param-layout.js');
 assert.ok(schema>=0);
 for(const name of ['graph-scale.js','webgpu-shaders.js','gpu-render-plan.js','gpu-params.js','webgpu-preview.js'])assert.ok(schema<html.indexOf(name),name);
});
test('global writers and host readers contain no bare parameter positions',()=>{
 const {skipLiteral}=require('./frontend-source.js');
 const {bareGlobalPositions}=require('./gpu-param-layout-audit.js');
 assert.deepEqual(bareGlobalPositions(sources,skipLiteral),[]);
 const changed=sources.map(s=>s.replace('params[GPU_PARAMS.EXPOSURE] =','params[2] ='));
 assert.ok(bareGlobalPositions(changed,skipLiteral).some(issue=>issue.includes('params[2]')));
});

test('local-buffer writers cannot hide a missing global grading writer',()=>{
 const changed=sources.map(s=>s.replace(/params\[GPU_PARAMS\.COLOR_GRADING_ENABLED\](\s*=(?!=))/g,'params[GPU_PARAMS.OVERLAY_ENABLED]$1'));
 assert.ok(audit(changed).errors.includes('COLOR_GRADING_ENABLED is read but never written'));
});
