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

test('the global parameter list pins Tone endpoint allocations without moving existing positions',()=>{
 assert.equal(layout.count,202+13*140);
 assert.equal(new Set(layout.fields.map(f=>f.name)).size,202);
 assert.deepEqual(layout.fields.map(f=>f.index),[...Array.from({length:200},(_,i)=>i),2020,2021]);
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(layout.fields.slice(0,198).map(({name,index})=>[name,index]))).digest('hex'),'87f2ae12787ae55edc689ed40f125ff375db0f050b44573b3c651be8d636cc83');
 // Positions 4-7 and 54-59 renamed, not moved (Oct 27 2026): Shadow/Lift/Gamma/Gain and their
 // pivots/ranges became BLACKS, SHADOWS, MIDTONES, HIGHLIGHTS and the zones' CENTER/WIDTH.
 // Position 60 became HIGHLIGHT_ATTENUATION (AgX-style Attenuate prototype, Oct 2026).
 // Position 199 became HSL_SHARED_SELECTION (shared colour selection, Oct 27 2026).
 assert.deepEqual(layout.fields.filter(f=>f.reserved).map(f=>f.index),[14]);
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
 assert.ok(audit([...sources,'params[GPU_PARAMS.RESERVED_DENOISE_DETAIL] = 0;']).errors.includes('RESERVED_DENOISE_DETAIL is reserved but used'));
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

test('packed Color matrix stays exact across unrelated edits and follows changed primaries',()=>{
 const vm=require('node:vm');
 const {HDRGpuPassLayouts}=require('../frontend/gpu-param-layout.js');
 const context=vm.createContext({HDRGpuParamLayout:layout,HDRGpuPassLayouts,HDRWebGPUShaders:shaders,
  HDRHSL:require('../frontend/hsl-engine.js'),HDRTone:require('../frontend/tone-engine.js'),
  HDRLensFilters:require('../frontend/lens-filters.js')});
 context.window=context;
 for(const name of ['gpu-render-plan.js','gpu-params.js'])vm.runInContext(read(name),context);
 const branch={tint_purity:19,tint_hue:45,red_hue:-5,blue_purity:8};
 const start=layout.indices.PRIMARIES_MATRIX_00;
 const pack=()=>Array.from(context.buildParams('hdr',{hdr:branch,shared:{}},'acescg',false).slice(start,start+9));
 const initial=pack();
 assert.deepEqual([initial[0],initial[2],initial[4],initial[8]],
  [1.1208137273788452,-.02066849172115326,1.0004334449768066,.6565257906913757]);
 Object.assign(branch,{saturation:20,tint:10,exposure:.5,contrast:.2});
 assert.deepEqual(pack(),initial);
 branch.tint_hue=-5;
 assert.notDeepEqual(pack(),initial);
 branch.tint_hue=45;
 assert.deepEqual(pack(),initial);
});
