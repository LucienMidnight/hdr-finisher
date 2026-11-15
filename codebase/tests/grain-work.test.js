const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function context(state) {
  const ctx = vm.createContext({state, window:{clearTimeout(){}}, document:{hidden:false}, localsBypassed:()=>false, localAdjustments:()=>[]});
  for(const name of ['preview-pipeline.js','scope-requests.js']) vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend',name),'utf8'),ctx);
  return ctx;
}
test('CPU reason distinguishes eligibility and actual renderer refusal',()=>{
  const state={renderingMode:'auto',gpuPreview:{available:true,supportsLocalAdjustments:()=>true}};
  const ctx=context(state);
  state.lastGpuDraftRefusal={lane:'sdr',reason:'gpu-failed:validation',detail:'invalid pixels'};
  assert.equal(ctx.cpuPreviewReason('sdr'),'gpu-failed:validation: invalid pixels');
  assert.equal(ctx.cpuPreviewReason('hdr'),'backend-preview-requested');
  state.gpuPreview.available=false;
  state.gpuPreview.detail='context lost';
  assert.match(ctx.cpuPreviewReason('sdr'),/context lost/);
  state.renderingMode='cpu';
  assert.equal(ctx.cpuPreviewReason('sdr'),'user-selected-cpu');
});
test('leaving Grade cancels both preview lanes and scope work',()=>{
  const aborted=[];const resolved=[];
  const state={scopeGeneration:3,previewControllers:{hdr:{abort(){aborted.push('hdr')}},sdr:{abort(){aborted.push('sdr')}}},scopeRequestInFlight:{controller:{abort(){aborted.push('scope')}}},pendingScopeRequest:{resolve:v=>resolved.push(v)}};
  context(state).suspendGradeInstruments();
  assert.deepEqual(aborted,['hdr','sdr','scope']);assert.deepEqual(resolved,[false]);
  assert.equal(state.scopeGeneration,4);assert.equal(state.previewControllers.hdr,null);assert.equal(state.pendingScopeRequest,null);
});
test('queued scope from old photo or lane never starts a fetch',async()=>{
  const state={session:{session_id:'new'},currentView:'sdr',activeWorkflow:'grade'};
  const ctx=context(state);let result;
  await ctx.runScopeRequest({sessionId:'old',lane:'hdr',resolve:v=>result=v});
  assert.equal(result,false);assert.equal(state.scopeRequestInFlight,undefined);
});
test('a CPU preview waiting for edit sync cannot restart after Grade leaves',async()=>{
  const state={session:{session_id:'photo'},currentView:'sdr'};
  const ctx=context(state);let release;
  ctx.geometryDraftActive=()=>false;
  ctx.syncGlobalEditState=()=>new Promise(resolve=>release=resolve);
  const pending=ctx.renderPreviewForLane('sdr',true,960);
  ctx.suspendGradeInstruments();release(true);
  assert.equal(await pending,false);
});
