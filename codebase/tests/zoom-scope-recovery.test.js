const vm=require('node:vm'),assert=require('node:assert/strict');const {test}=require('node:test');
const {declarations}=require('./frontend-source.js');
function fixture(continuous){let timer,delay;const scopes=[];const state={session:{session_id:'s'},currentView:'sdr',previewGeneration:{sdr:4},previewScheduler:{cancel(){}},acceptedPresentation:{lane:'sdr',generation:4,exact:true,processedLongEdge:7000}};
const c=vm.createContext({state,window:{clearTimeout(){},setTimeout(fn,ms){timer=fn;delay=ms;return 1}},gpuPreviewEligible:()=>true,renderViewerStatus(){},requiredProcessingLongEdge:()=>1600,interactiveScaleDecision:()=>({coarse:false}),noteViewerPan(){},scopeLongEdge:()=>960,refreshScopes:async(e,o)=>scopes.push(o),renderGpuDraft:async()=>{state.acceptedPresentation.processedLongEdge=1600;}});
vm.runInContext(declarations('scheduleZoomRefinement'),c);return {state,c,scopes,run:async()=>{c.scheduleZoomRefinement({continuous});assert.equal(delay,continuous?80:0);await timer();}};}
for (const continuous of [false,true]) {
const style=continuous?'continuous':'single-action';
test(`${style} zoom restores cancelled scopes after exact replacement presentation`,async()=>{const f=fixture(continuous);await f.run();assert.equal(f.scopes.length,1);assert.equal(f.scopes[0].lane,'sdr');});
test(`superseded ${style} zoom cannot refresh scopes against stale generation`,async()=>{const f=fixture(continuous);f.c.renderGpuDraft=async()=>{f.state.acceptedPresentation.processedLongEdge=1600;f.state.previewGeneration.sdr++;};await f.run();assert.equal(f.scopes.length,0);});
}
