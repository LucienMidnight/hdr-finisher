const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {frontendSource}=require('./frontend-source.js');
const context=vm.createContext({window:{},document:{createElement:()=>({})},performance,
 HDRLibrarySceneScheduler:require('../frontend/library-scene-scheduler')});
for(const file of ['gpu-allocator.js','webgpu-shaders.js','webgpu-preview.js'])vm.runInContext(frontendSource(file),context);
context.HDRWebGPUPreview=context.window.HDRWebGPUPreview;
const Renderer=vm.runInContext(frontendSource('library-gpu.js')+'\nHDRLibraryGPU;',context);
function setup(){
 const renderer=new Renderer(null),calls={scratch:0,destroy:0};
 Object.assign(renderer,{available:true,sessionId:'source',denoiseSelectorGeneration:1,
  model:{version:1,noise:.1},fetchDenoiseModel:async()=>structuredClone(renderer.model),
  ensureAdaptiveDenoisePipelines:async()=>{},createAdaptiveDenoiseScratch(){
   calls.scratch++;
   return {byteSize:8,textureCount:1,textures:{scratch:{destroy(){calls.destroy++;}}}};
  }});
 const analyze=(identity='source:hdr:640:geometry:model',controls={amount:.5})=>renderer.analyzeAdaptiveDenoise('source','hdr',{identity},640,0,'geometry',renderer.denoiseSelectorGeneration,controls);
 return {renderer,calls,analyze};
}
test('identical Library source/lane/scale/geometry/model keeps scratch and selector; controls update',async()=>{
 const {renderer,calls,analyze}=setup();await analyze();const selector=renderer.denoiseSourceSelector;
 selector.resolved={texture:'existing'};selector.selected='original';
 renderer.denoiseSelectorGeneration++;await analyze(undefined,{amount:.8,finestNoise:.2});
 assert.equal(renderer.denoiseSourceSelector,selector);assert.equal(calls.scratch,1);assert.equal(calls.destroy,0);
 assert.equal(selector.controls.amount,.8);assert.equal(selector.controls.finestNoise,.2);assert.equal(selector.selected,'resolved');
 assert.equal(selector.generation,2);
});
for(const changed of ['source','lane','scale','geometry','model'])test('Library Denoise replaces setup for changed '+changed,async()=>{
 const {renderer,calls,analyze}=setup();await analyze();const old=renderer.denoiseSourceSelector;
 let identity='source:hdr:640:geometry:model';
 if(changed==='model')renderer.model.noise=.2;
 else identity=identity.replace({source:'source',lane:'hdr',scale:'640',geometry:'geometry'}[changed],'different');
 renderer.activeRenderCount=1;
 await analyze(identity);assert.notEqual(renderer.denoiseSourceSelector,old);assert.equal(calls.scratch,2);
 assert.equal(calls.destroy,0);
 renderer.activeRenderCount=0;renderer.flushDeferredDestroy();
 assert.equal(calls.destroy,1);
});
test('a superseded model response cannot reuse or replace the active setup',async()=>{
 const {renderer,calls,analyze}=setup();await analyze();const previous=renderer.denoiseSourceSelector;
 renderer.fetchDenoiseModel=async()=>{renderer.denoiseSelectorGeneration++;return renderer.model;};
 assert.equal(await analyze(),false);assert.equal(renderer.denoiseSourceSelector,previous);assert.equal(calls.scratch,1);
});

test('a finishing-only transport key aliases the exact same denoise source',async()=>{
 const {renderer,calls,analyze}=setup();renderer.libraryMeta={source_key:'source'};
 await analyze('old-grade');const selector=renderer.denoiseSourceSelector;
 await analyze('new-grade',{amount:.2});
 assert.equal(renderer.denoiseSourceSelector,selector);assert.equal(calls.scratch,1);
 assert.equal(selector.identity,'new-grade');assert.equal(selector.controls.amount,.2);
});

test('Library reset retains only scratch for the same source and retires resolved pixels',()=>{
 let retired=0,destroyedScratch=0;
 const gpu=new Renderer(null);
 gpu.libraryMeta={source_key:'source'};gpu.libraryDenoiseSource='source';
 const selector={original:{},resolved:{texture:{destroy(){retired++;}}},
  cache:{adaptiveScratch:{textures:{scratch:{destroy(){destroyedScratch++;}}}}}};
 gpu.denoiseSourceSelector=selector;gpu.resetSession('new-grade-key');
 assert.equal(gpu.denoiseSourceSelector,selector);assert.equal(selector.original,null);assert.equal(selector.resolved,null);
 assert.equal(retired,1);assert.equal(destroyedScratch,0);
 gpu.libraryMeta={source_key:'different-source'};gpu.resetSession('different-source-key');
 assert.equal(gpu.denoiseSourceSelector,null);assert.equal(destroyedScratch,1);
});
