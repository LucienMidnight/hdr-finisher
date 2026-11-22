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
test('inactive preloads skip CPU Micro and native size but keep GPU Fit and explicit compare', async () => {
  const queued = [], loaded = [];
  const state = {
    session: { session_id: 'photo' }, activeWorkflow: 'grade', currentView: 'hdr', compareLayout: 'single',
    previewResolutionOverride: false, previewGeneration: { sdr: 2 }, gpuPreparedLane: {},
    gpuPreview: { available: true, loadProxy: async (_session, lane, edge) => loaded.push([lane, edge]) },
    previewScheduler: { scheduleInactive: (...args) => queued.push(args) },
    denoise: { sdr: { enabled: true, controls: { method: 'micro_grain', micro_luminance: 1 } } },
    denoiseRuntime: { sdr: { microBackup: {} } },
  };
  const ctx = context(state);
  let edge = 1600, gpuAllowed = true;
  Object.assign(ctx, {
    AbortController, cacheReady: () => false, renderCompareStatus() {},
    gpuPreviewEligible: () => gpuAllowed, geometrySignature: () => 'geometry',
    gradeSourceIdentity: () => 'generated-sdr', settledProxyLongEdge: () => edge, previewTargetLongEdge: () => 7968,
  });

  ctx.prepareInactivePreview();
  assert.equal(queued.length, 0);
  state.denoiseRuntime.sdr.microBackup = null;
  gpuAllowed = false;
  ctx.prepareInactivePreview();
  assert.equal(queued.length, 0);
  gpuAllowed = true;
  ctx.prepareInactivePreview();
  assert.deepEqual(queued.map(([lane, generation]) => [lane, generation]), [['sdr', 2]]);
  await ctx.preloadInactiveLane('sdr', 2);
  assert.deepEqual(loaded, [['sdr', 1600]]);
  assert.equal(state.gpuPreparedLane.sdr, true);

  edge = 7968;
  ctx.prepareInactivePreview();
  await ctx.preloadInactiveLane('sdr', 2);
  assert.equal(queued.length, 1);
  assert.equal(loaded.length, 1);
  ctx.prepareInactivePreview({ immediate: true });
  assert.deepEqual(loaded, [['sdr', 1600], ['sdr', 7968]]);
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
