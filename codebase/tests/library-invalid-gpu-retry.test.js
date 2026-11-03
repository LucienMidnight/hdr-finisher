const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Run the production scheduling loop with a faulting GPU operation. The real
// Electron driver separately checks actual reconstruction, scanning and display.
function setup(rejections){
 const source=fs.readFileSync(process.env.HDR_RETRY_SOURCE||path.join(__dirname,'../frontend/library-gpu-raw.js'),'utf8');
 const start=source.indexOf('  async function scheduledDevelopment(');
 const end=source.indexOf('  const directScenes',start);
 let calls=0;const events=[],leases=[];
 const context={gpu:async()=>({state:{}}),rawBudget:()=>100,gpuFailures:new Map(),activeGpuWorks:new Map(),
  allocationScope:()=>({context:{},check:async()=>{}}),crypto:require('node:crypto').webcrypto,performance,
  root:{HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields})},
  fetch:async(url,options)=>{leases.push(options.method);return {ok:true,json:async()=>({granted:true})};},
  wait:async()=>{},DOMException,
  developRaw:async()=>{calls++;if(calls<=rejections)throw Object.assign(Error('GPU edge colour produced 141 invalid pixels'),{gpuInvalidPixels:true,gpuUnavailable:true});return {reduced:{},memory_peak_bytes:100};}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.run=scheduledDevelopment;',context);
 return {run:()=>context.run({mosaic:new Uint16Array(1),meta:{path:'photo'},edges:[640],grant:'grant'},new AbortController().signal),events,leases,calls:()=>calls};
}
test('first invalid result retries on the GPU and succeeds without losing the lease',async()=>{
 const job=setup(1);await job.run();assert.equal(job.calls(),2);
 assert.equal(job.events.filter(e=>e.stage==='picture_development_gpu_retry_passed').length,1);
 assert.equal(job.leases.at(-1),'DELETE');
});
test('two invalid results stop the GPU route and release its reservation',async()=>{
 const job=setup(2);await assert.rejects(job.run(),error=>error.gpuInvalidPixels&&error.gpuUnavailable);
 assert.equal(job.calls(),2);assert.equal(job.leases.at(-1),'DELETE');
});
