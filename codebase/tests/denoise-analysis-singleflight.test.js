const assert = require('node:assert/strict');
const vm = require('node:vm');
const {test} = require('node:test');
const {declarations} = require('./frontend-source.js');

test('Denoise method controls recover after a rejected save, missing GPU, or expired preparation', async () => {
  for (const scenario of ['save', 'unavailable', 'expired']) {
    const runtime = { generation: 0, status: 'ready' };
    const state = { currentView: 'hdr', session: { session_id: 'photo' }, denoiseRuntime: { hdr: runtime },
      denoise: { hdr: { enabled: true, controls: { method: 'standard' } } },
      gpuPreview: { available: scenario !== 'unavailable', diagnosticsSnapshot: () => ({ denoise: {} }),
        analyzeDenoiseProxy: async () => { throw new DOMException('Expired', 'AbortError'); } } };
    const context = vm.createContext({ state, console, renderDenoiseControls: () => {},
      persistDenoiseSettings: async () => scenario !== 'save', refinementProxyLongEdge: () => 1600,
      geometrySignature: () => '{}', denoiseRendererControls: controls => controls,
      renderPreviewForLane: async () => true });
    vm.runInContext(declarations('gradeSourceIdentity', 'denoiseRetryError', 'recalculateDenoise', 'recalculateDenoiseAnalysis', 'commitDenoiseControl'), context);
    await context.commitDenoiseControl('method', 'clean_grain');
    assert.equal(runtime.status, 'error', scenario);
    assert.match(runtime.error, /try|retry|again/i, scenario);
  }
});

test('Match and Undo select separate Denoise preparations at the same SDR size', async () => {
  const identities = [];
  const state = { currentView: 'sdr', session: { session_id: 'photo' }, denoiseRuntime: { sdr: { generation: 0 } },
    denoise: { sdr: { enabled: true, controls: { method: 'standard' } } },
    editDocument: { source: { luminance: { sdr_rendition: 'authored' } } },
    adjustments: { sdr: {use_authored_base: true} },
    gpuPreview: { available: true, diagnosticsSnapshot: () => ({ denoise: {} }),
      analyzeDenoiseProxy: async (...args) => { identities.push(args[5]); return true; } } };
  const context = vm.createContext({ state, console, renderDenoiseControls: () => {},
    refinementProxyLongEdge: () => 1600, geometrySignature: () => '{}', denoiseRendererControls: controls => controls });
  vm.runInContext(declarations('gradeSourceIdentity', 'recalculateDenoiseAnalysis'), context);
  await context.recalculateDenoiseAnalysis('sdr', { renderAfter: false });
  state.adjustments.sdr.use_authored_base = false;
  await context.recalculateDenoiseAnalysis('sdr', { renderAfter: false });
  state.adjustments.sdr.use_authored_base = true;
  await context.recalculateDenoiseAnalysis('sdr', { renderAfter: false });
  assert.notEqual(identities[0], identities[1]);
  assert.equal(identities[0], identities[2]);
});
function setup() {
 let resolve;
 const work = new Promise(r => {resolve=r;});
 const calls=[];const renders=[];
 const state={session:{session_id:'photo'},gpuPreview:{available:true},denoise:{hdr:{enabled:true,controls:{method:'standard'},analysis:{algorithm_version:'adaptive'}}},denoiseRuntime:{hdr:{}},currentView:'hdr'};
 const context=vm.createContext({state,geometrySignature:()=> '{}',refinementProxyLongEdge:()=>7968,recalculateDenoiseAnalysis:(...args)=>{calls.push(args);return work;},renderGpuDraft:(...args)=>renders.push(args),debounceOverlayAndScopes:()=>{}});
 vm.runInContext(declarations('gradeSourceIdentity', 'recalculateDenoise'),context);
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
