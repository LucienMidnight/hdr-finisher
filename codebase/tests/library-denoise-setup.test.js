const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../frontend/webgpu-preview.js'),'utf8');
const begin=source.indexOf('    async analyzeAdaptiveDenoise('),end=source.indexOf('    encodeAdaptiveDenoise(',begin);
const Renderer=vm.runInNewContext('(class {'+source.slice(begin,end)+'})',{performance,ADAPTIVE_DENOISE_ALGORITHM_VERSION:'adaptive-v1'});
function setup(){
 const renderer=new Renderer(),calls={scratch:0,destroy:0};
 Object.assign(renderer,{available:true,sessionId:'source',reuseDenoiseSetup:true,denoiseSelectorGeneration:1,
  model:{version:1,noise:.1},denoiseCounters:{analysisCalls:0,allocations:0,allocatedBytes:0},proxies:new Map(),
  recordStage(){},recordAllocation(){},fetchDenoiseModel:async()=>structuredClone(renderer.model),
  ensureAdaptiveDenoisePipelines:async()=>{},createAdaptiveDenoiseScratch(){calls.scratch++;return {byteSize:8,textureCount:1};},
  destroyDenoiseSelector(){calls.destroy++;},setDenoiseControls(controls){renderer.controls=controls;}});
 const analyze=(identity='source:hdr:640:geometry:model',controls={amount:.5})=>renderer.analyzeAdaptiveDenoise('source','hdr',{identity},640,0,'geometry',renderer.denoiseSelectorGeneration,controls);
 return {renderer,calls,analyze};
}
test('identical Library source/lane/scale/geometry/model keeps scratch and selector; controls update',async()=>{
 const {renderer,calls,analyze}=setup();await analyze();const selector=renderer.denoiseSourceSelector;
 selector.resolved={texture:'existing'};selector.selected='original';
 renderer.denoiseSelectorGeneration++;await analyze(undefined,{amount:.8,finestNoise:.2});
 assert.equal(renderer.denoiseSourceSelector,selector);assert.equal(calls.scratch,1);assert.equal(calls.destroy,1);
 assert.equal(renderer.controls.amount,.8);assert.equal(renderer.controls.finestNoise,.2);assert.equal(selector.selected,'resolved');
 assert.equal(selector.generation,2);
});
for(const changed of ['source','lane','scale','geometry','model'])test('Library Denoise replaces setup for changed '+changed,async()=>{
 const {renderer,calls,analyze}=setup();await analyze();const old=renderer.denoiseSourceSelector;
 let identity='source:hdr:640:geometry:model';
 if(changed==='model')renderer.model.noise=.2;
 else identity=identity.replace({source:'source',lane:'hdr',scale:'640',geometry:'geometry'}[changed],'different');
 await analyze(identity);assert.notEqual(renderer.denoiseSourceSelector,old);assert.equal(calls.scratch,2);
});
test('a superseded model response cannot reuse or replace the active setup',async()=>{
 const {renderer,calls,analyze}=setup();await analyze();const previous=renderer.denoiseSourceSelector;
 renderer.fetchDenoiseModel=async()=>{renderer.denoiseSelectorGeneration++;return renderer.model;};
 assert.equal(await analyze(),false);assert.equal(renderer.denoiseSourceSelector,previous);assert.equal(calls.scratch,1);
});

test('a finishing-only transport key aliases the exact same denoise source',async()=>{
 const {renderer,calls,analyze}=setup();renderer.denoiseSetupIdentity=()=> 'source:hdr:640:geometry';
 await analyze('old-grade');const selector=renderer.denoiseSourceSelector;
 await analyze('new-grade',{amount:.2});
 assert.equal(renderer.denoiseSourceSelector,selector);assert.equal(calls.scratch,1);
 assert.equal(selector.identity,'new-grade');assert.equal(renderer.controls.amount,.2);
});

test('Library reset retains only scratch for the same source and retires resolved pixels',()=>{
 const library=fs.readFileSync(require.resolve('../frontend/library-gpu.js'),'utf8');
 const start=library.indexOf('  denoiseSetupIdentity('),end=library.indexOf('  async ensureDenoiseResolved',start);
 let retired=0,destroyedScratch=0;
 class Base {resetSession(id){this.sessionId=id;this.denoiseSourceSelector?.cache?.adaptiveScratch.destroy?.();this.denoiseSourceSelector=null;}}
 const GPU=vm.runInNewContext('(class extends Base {'+library.slice(start,end)+'})',{Base});
 const gpu=new GPU();gpu.proxies=new Map();gpu.destroyAfterActiveRenders=fn=>fn();
 gpu.libraryMeta={source_key:'source'};gpu.libraryDenoiseSource='source';
 const selector={original:{},resolved:{texture:{destroy(){retired++;}}},cache:{adaptiveScratch:{destroy(){destroyedScratch++;}}}};
 gpu.denoiseSourceSelector=selector;gpu.resetSession('new-grade-key');
 assert.equal(gpu.denoiseSourceSelector,selector);assert.equal(selector.original,null);assert.equal(selector.resolved,null);
 assert.equal(retired,1);assert.equal(destroyedScratch,0);
 gpu.libraryMeta={source_key:'different-source'};gpu.resetSession('different-source-key');
 assert.equal(gpu.denoiseSourceSelector,null);assert.equal(destroyedScratch,1);
});
