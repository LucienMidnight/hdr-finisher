const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Run the production scheduling loop with a faulting GPU operation. GPU failure
// rule (master PRD, November 6): a rejected result goes to the CPU with no retry. The real
// Electron driver separately checks actual reconstruction, scanning and display.
function setup(rejections,failure=()=>Object.assign(Error('GPU edge colour produced 141 invalid pixels'),{gpuInvalidPixels:true,gpuUnavailable:true}),others=[]){
 const source=fs.readFileSync(process.env.HDR_RETRY_SOURCE||path.join(__dirname,'../frontend/library-gpu-raw.js'),'utf8');
 const start=source.indexOf('  async function scheduledDevelopment(');
 const end=source.indexOf('  const directScenes',start);
 let calls=0;const events=[],leases=[];
 const context={gpu:async()=>({state:{}}),rawBudget:()=>100,gpuFailures:new Map(),activeGpuWorks:new Map(others.map(key=>[key,{}])),gpuRejectedWork:new Set(),
  allocationScope:()=>({context:{},check:async()=>{}}),crypto:require('node:crypto').webcrypto,performance,
  root:{HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields})},
  fetch:async(url,options)=>{leases.push(options.method);return {ok:true,json:async()=>({granted:true})};},
  wait:async()=>{},DOMException,
  developRaw:async()=>{calls++;if(calls<=rejections)throw failure();return {reduced:{},memory_peak_bytes:100};}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.run=scheduledDevelopment;',context);
 return {run:(meta={path:'photo'})=>context.run({mosaic:new Uint16Array(1),meta,edges:[640],grant:'grant'},new AbortController().signal),events,leases,calls:()=>calls};
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
