const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname,'../frontend/app.js'),'utf8');
const begin = source.indexOf('async function recalculateDenoise(');
const end = source.indexOf('async function recalculateDenoiseAnalysis(',begin);
function setup() {
 let resolve;
 const work = new Promise(r => {resolve=r;});
 const calls=[];const renders=[];
 const state={session:{session_id:'photo'},gpuPreview:{available:true},denoise:{hdr:{enabled:true,analysis:{algorithm_version:'adaptive'}}},denoiseRuntime:{hdr:{}},currentView:'hdr'};
 const context=vm.createContext({state,geometrySignature:()=> '{}',refinementProxyLongEdge:()=>7968,recalculateDenoiseAnalysis:(...args)=>{calls.push(args);return work;},renderGpuDraft:(...args)=>renders.push(args),debounceOverlayAndScopes:()=>{}});
 vm.runInContext(source.slice(begin,end),context);
 return {context,state,calls,renders,resolve};
}
test('enable, pan and drag share one setup for the same photo, scale and geometry',async()=>{
 const f=setup();
 const a=f.context.recalculateDenoise('hdr');
 const b=f.context.recalculateDenoise('hdr',{longEdge:7968,renderAfter:false});
 const c=f.context.recalculateDenoise('hdr',{longEdge:7968,renderAfter:false});
 assert.equal(f.calls.length,1);f.resolve(true);
 assert.deepEqual(await Promise.all([a,b,c]),[true,true,true]);
 assert.equal(f.renders.length,1);assert.equal(f.state.denoiseRuntime.hdr.analysisInFlight,null);
});
test('disable during shared setup does not render denoise on',async()=>{
 const f=setup();const a=f.context.recalculateDenoise('hdr');
 f.state.denoise.hdr.enabled=false;f.resolve(true);
 assert.equal(await a,false);assert.equal(f.renders.length,0);
});
test('different scales do not share setup',async()=>{
 const f=setup();const a=f.context.recalculateDenoise('hdr',{longEdge:960,renderAfter:false});
 const b=f.context.recalculateDenoise('hdr',{longEdge:7968,renderAfter:false});
 assert.equal(f.calls.length,2);f.resolve(true);await Promise.all([a,b]);
});