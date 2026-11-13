const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Run the production scheduling loop with a faulting GPU operation. GPU failure
// rule (master PRD, November 6): a rejected result goes to the CPU with no retry. The real
// Electron driver separately checks actual reconstruction, scanning and display.
function setup(rejections,failure=()=>Object.assign(Error('GPU edge colour produced 141 invalid pixels'),{gpuInvalidPixels:true,gpuUnavailable:true}),others=[],loseDevice=false,lateAllocationFailure=false,abortOnLoss=false){
 const source=fs.readFileSync(process.env.HDR_RETRY_SOURCE||path.join(__dirname,'../frontend/library-gpu-raw.js'),'utf8');
 const start=source.indexOf('  async function scheduledDevelopment(');
 const end=source.indexOf('  const directScenes',start);
 let calls=0;const events=[],leases=[];let controller;
 const context={gpu:async()=>({state:{}}),rawBudget:()=>100,gpuFailures:new Map(),activeGpuWorks:new Map(others.map(key=>[key,{}])),gpuRejectedWork:new Set(),
  allocationScope:context=>({context,check:async()=>{if(lateAllocationFailure)throw Object.assign(Error('Late allocation failure'),{gpuMemory:true});}}),crypto:require('node:crypto').webcrypto,performance,
  root:{HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields}),HDRLibraryGrants:{gpuLost:()=>{if(abortOnLoss)controller.abort();}}},
  fetch:async(url,options)=>{leases.push(options.method);
   if(loseDevice==='admission'&&options.method==='POST'){const {device}=await context.shared;device.destroy();await device.lost;throw new DOMException('Lost reservation','AbortError');}
   return {ok:true,json:async()=>({granted:true})};},
  wait:async()=>{},DOMException,destroyKept:()=>{},
  developRaw:async({context})=>{calls++;if(calls<=rejections){if(loseDevice){context.device.destroy();await context.device.lost;}throw failure();}return {reduced:{},memory_peak_bytes:100};}};
 if(loseDevice){
  context.shared=null;context.releaseNative=()=>{};
  context.hardwareAdapter=async()=>({features:new Set(),limits:{},requestDevice:async()=>{
   let lost;const device={lost:new Promise(resolve=>{lost=resolve;}),destroy:()=>lost(),addEventListener(){}};
   if(loseDevice==='startup')device.destroy();return device;
  }});
  vm.runInNewContext(source.slice(source.indexOf('  async function gpu('),source.indexOf('  async function preparePipelines(')),context);
 }
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.run=scheduledDevelopment;',context);
 return {run:(meta={path:'photo'},options={})=>{controller=new AbortController();return context.run({mosaic:new Uint16Array(1),meta,edges:[640],grant:'grant',...options},controller.signal);},events,leases,calls:()=>calls};
}
test('an invalid result goes to the CPU at once and releases its reservation',async()=>{
 const job=setup(1);await assert.rejects(job.run(),error=>error.gpuInvalidPixels&&error.gpuUnavailable);
 assert.equal(job.calls(),1);assert.equal(job.leases.at(-1),'DELETE');
 assert.equal(job.events.filter(e=>e.stage==='picture_development_gpu_rejected').length,1);
 assert.equal(job.events.filter(e=>e.stage==='picture_development_gpu_retry').length,0);
});
test('rejected work skips the GPU for the rest of the session; other photos keep it',async()=>{
 const job=setup(1);await assert.rejects(job.run());
 await assert.rejects(job.run(),error=>error.gpuInvalidPixels&&error.gpuUnavailable);
 assert.equal(job.calls(),1);
 await job.run({path:'another photo'});assert.equal(job.calls(),2);
});
test('an empty channel counts as a rejected result, not a memory failure',async()=>{
 const job=setup(1,()=>Object.assign(Error('GPU development returned an empty red channel at 640.'),{gpuMemory:true,emptyChannel:true}),['busy|640']);
 await assert.rejects(job.run(),error=>error.gpuInvalidPixels&&error.gpuUnavailable);assert.equal(job.calls(),1);
});
test('a development error that would repeat goes to the CPU',async()=>{
 const job=setup(1,()=>Error('Shader validation failed'));
 await assert.rejects(job.run(),error=>error.gpuUnavailable&&!error.gpuInvalidPixels);assert.equal(job.calls(),1);
});
test('out of memory retries once only while other GPU work holds memory',async()=>{
 const oom=()=>Object.assign(Error('GPU out of memory'),{gpuMemory:true,gpuUnavailable:true});
 const alone=setup(1,oom);
 await assert.rejects(alone.run(),error=>error.gpuUnavailable&&!error.libraryRequeue);
 const shared=setup(2,oom,['busy|640']);
 await assert.rejects(shared.run(),error=>error.libraryRequeue&&error.gpuRetry);
 await assert.rejects(shared.run(),error=>error.gpuUnavailable&&!error.libraryRequeue);
});
test('full source settings isolate permanent rejections without depending on object order',async()=>{
 const job=setup(1);
 const meta={path:'photo',identity:'source-one',failure_revision:'saved-grade-one',source_quality:'quality-one',
  raw_import_settings:{highlight_reconstruction:{method:'edge_colour_v1',edge_colour_expand_percent:.5},lens:{mode:'auto'}}};
 await assert.rejects(job.run(meta));
 const reordered={...meta,raw_import_settings:{lens:{mode:'auto'},highlight_reconstruction:{edge_colour_expand_percent:.5,method:'edge_colour_v1'}}};
 await assert.rejects(job.run(reordered),error=>error.gpuUnavailable);assert.equal(job.calls(),1);
 for(const changed of [
  {...meta,identity:'source-two'}, {...meta,failure_revision:'saved-grade-two'}, {...meta,source_quality:'quality-two'},
  {...meta,raw_import_settings:{...meta.raw_import_settings,highlight_reconstruction:{method:'edge_colour_v1',edge_colour_expand_percent:3}}},
  {...meta,raw_import_settings:{...meta.raw_import_settings,lens:{mode:'off'}}}, {...meta,repairs:[{id:'repair',rectangles:[[0,0,2,2]]}]}])await job.run(changed);
 assert.equal(job.calls(),7);
 await assert.rejects(job.run(meta),error=>error.gpuUnavailable);assert.equal(job.calls(),7);
});
test('two actual device losses allow one recovery, then CPU without another GPU attempt',async()=>{
 const job=setup(10,()=>Error('Device was destroyed'),[],true);
 await assert.rejects(job.run(),error=>error.libraryRequeue&&error.gpuRetry&&!error.gpuUnavailable);
 await assert.rejects(job.run(),error=>!error.libraryRequeue&&!error.gpuRetry&&error.gpuUnavailable);
 await assert.rejects(job.run(),error=>error.gpuUnavailable&&!error.libraryRequeue);
 assert.equal(job.calls(),2);assert.equal(job.leases.at(-1),'DELETE');
 assert.equal(job.events.filter(event=>event.stage==='picture_development_gpu_retry').length,1);
});
test('a device lost during native handoff also spends the one recovery',async()=>{
 const job=setup(0,undefined,[],true);
 const consume=async result=>{result.device.destroy();await result.device.lost;throw Error('Native handoff lost its device');};
 await assert.rejects(job.run(undefined,{consume}),error=>error.libraryRequeue);
 await assert.rejects(job.run(undefined,{consume}),error=>error.gpuUnavailable&&!error.libraryRequeue);
 await assert.rejects(job.run(),error=>error.gpuUnavailable);
 assert.equal(job.calls(),2);
});
test('successful recovery clears the temporary budget, not permanent rejections',async()=>{
 const job=setup(1,()=>Error('Device was destroyed'),[],true);
 await assert.rejects(job.run(),error=>error.libraryRequeue);
 await job.run();await job.run();assert.equal(job.calls(),3);
});
test('loss before development registration is counted even without the loss callback seeing the work',async()=>{
 const job=setup(10,()=>Error('Already lost device'),[],'startup');
 await assert.rejects(job.run(),error=>error.libraryRequeue&&error.gpuRetry);
 await assert.rejects(job.run(),error=>error.gpuUnavailable&&!error.libraryRequeue);
 await assert.rejects(job.run(),error=>error.gpuUnavailable);
 assert.equal(job.calls(),2);
});
test('device loss while acquiring a reservation cannot escape the recovery ceiling as cancellation',async()=>{
 const job=setup(0,undefined,[],'admission');
 await assert.rejects(job.run(),error=>error.libraryRequeue&&error.gpuRetry);
 await assert.rejects(job.run(),error=>error.gpuUnavailable&&!error.libraryRequeue);
 await assert.rejects(job.run(),error=>error.gpuUnavailable);
 assert.equal(job.calls(),0);assert.equal(job.leases.filter(method=>method==='DELETE').length,2);
});
test('a pixel rejection wins over simultaneous device loss, cancellation and a late allocation error',async()=>{
 const job=setup(1,()=>Object.assign(Error('Invalid pixels'),{gpuInvalidPixels:true,needsMemory:true}),['busy'],true,true,true);
 await assert.rejects(job.run(),error=>error.gpuInvalidPixels&&error.gpuUnavailable&&!error.libraryRequeue);
 await assert.rejects(job.run(),error=>error.gpuInvalidPixels&&error.gpuUnavailable&&!error.libraryRequeue);
 assert.equal(job.calls(),1);assert.equal(job.events.filter(event=>event.stage==='picture_development_gpu_retry').length,0);
});
