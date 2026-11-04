// Run the real polling loop with small inputs and check reachability after each
// completed job, including upload failure and scheduler cancellation.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
async function worker(){
  const refs=[];let pending,active,uploads=0,completion,clock=0;
  const track=buffer=>{refs.push(new WeakRef(buffer));return buffer;};
  const buffer=size=>track(new ArrayBuffer(size));
  const plane=()=>new Float32Array(buffer(16384));
  const device={limits:{maxTextureDimension2D:16384},
    queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:async()=>{}},
    createBuffer:({size})=>({size,destroy(){},mapAsync:async()=>{},getMappedRange:()=>buffer(size)}),
    createCommandEncoder:()=>({copyBufferToBuffer(){},finish(){}}),
    pushErrorScope(){},popErrorScope:async()=>null};
  class GPU{
    constructor(){this.device=device;this.proxies=new Map();}
    async initialize(){this.available=true;return true;}
    resetSession(){this.proxies.clear();}
    setMemoryBudget(){}
    async loadProxy(){return {width:64,height:64,identity:'source'};}
    async renderTo(...args){await args.at(-1).beforeDeliverySubmit();args.at(-1).delivery.params=[];return {execution:'direct'};}
  }
  class Finishing{
    async initialize(){}
    texture(){return {};}
    async finish(){return {};}
    async read(){return plane();}
    destroy(){}
  }
  const fetch=async(url,options)=>{
    if(url.endsWith('/next'))return new Promise(resolve=>{pending=job=>resolve({ok:true,json:async()=>job});});
    if(url.endsWith('/complete'))completion=JSON.parse(options.body);
    if(url.includes('/permit'))return {ok:true,json:async()=>({ready:true,cancelled:active.cancel})};
    if(url.includes('/pixels/')||url.endsWith('/raw-developed')){
      uploads++;if(active.fail)throw Error('upload failed');
    }
    return {ok:true,arrayBuffer:async()=>{
      if(url.endsWith('/raw-sensor')){
        const text=new TextEncoder().encode(JSON.stringify({mosaic_bytes:16384}));
        const out=buffer(4+text.length+16384);new DataView(out).setUint32(0,text.length,true);
        new Uint8Array(out,4,text.length).set(text);return out;
      }
      return buffer(64*64*16);
    }};
  };
  let resolveIdle;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/gpu-delivery.js'),'utf8'),{
    document:{createElement:()=>({})},window:{hdrDeliveryMemory:{idle:value=>{if(value)resolveIdle();}}},
    performance:{now:()=>clock+=101},fetch,setTimeout,setInterval:()=>{},console:{error(){}},
    HDRIdleWarmup:{run(){}},HDRWebGPUPreview:GPU,HDRGpuDeliveryFinishing:Finishing,
    HDRRetouchGPU:{run:async()=>({pixels:plane(),reservedBytes:65536})},
    HDRLibraryRGB:{develop:async()=>({reduced:{100000:{planes:[plane(),plane(),plane()]}},timings:{}})},
    HDRLibraryGpuRaw:{rawBudget:()=>65536,shared:{gpu:async()=>({device})},quantile:()=>0,
      developRaw:async()=>({reduced:{640:{planes:[plane(),plane(),plane()]}},samples:[],timings:{}})},
    HDREdgeColour:{reconstruct:async({make,beforeSubmit})=>{await beforeSubmit();return {planes:[make(16384),make(16384),make(16384)]};}},
    GPUBufferUsage:{STORAGE:1,COPY_SRC:2,COPY_DST:4,MAP_READ:8},GPUMapMode:{READ:1},
    sampleCurvePoints(){},TextEncoder,TextDecoder,
    Blob:class{constructor(parts){for(const part of parts){const data=part.buffer||part;if(data instanceof ArrayBuffer)track(data);}}},
  });
  for(const operation of ['retouch','dng_correction','edge_colour','finishing','raw']){
    for(const outcome of ['success','failure','cancelled']){
      // Invalidation must be tested after allocation, so cancellation happens at
      // the second permit (after a retouch computation or DNG development).
      refs.length=0;uploads=0;completion=null;
      const job={id:operation+outcome,operation,width:64,height:64,output:[64,64],budget:4e9,
        adjustments:{shared:{geometry:{}},sdr:{}},denoise:{},finishing:{sharpening:'off'},
        retouch:{input_count:4096,scratch_count:4096,output_count:4096},dng:{mosaic_bytes:65536},
        fail:outcome==='failure',cancel:false};
      if(operation==='raw')job.raw={edge:640};
      active=job;
      // Cancel at the upload boundary: the following permit detects it. For
      // finishing this is the SDR permit, after HDR has completed its readback.
      let permitCalls=0;
      Object.defineProperty(job,'cancel',{get(){return outcome==='cancelled'&&++permitCalls>(operation==='finishing'?2:1);}});
      const idle=new Promise(resolve=>{resolveIdle=resolve;});
      while(!pending)await new Promise(setImmediate);
      const deliver=pending;pending=null;deliver(job);await idle;
      for(let n=0;n<3;n++){await new Promise(setImmediate);global.gc();}
      assert.ok(refs.length>0,`${operation} ${outcome}: no photo buffers exercised`);
      assert.equal(refs.filter(ref=>ref.deref()).length,0,`${operation} ${outcome}: completed buffers retained`);
      if(outcome==='success'){assert.ok(uploads>0,`${operation}: no output delivered`);assert.equal(completion.error,undefined);}
      else assert.match(completion.error,outcome==='cancelled'?/cancelled/:/upload failed/);
    }
  }
}
if(process.argv.includes('--lifetime-worker')){
  worker().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
}else{
  const {test}=require('node:test'),{spawnSync}=require('node:child_process');
  test('completed delivery buffers are unreachable before the next job, on success, failure and cancellation',()=>{
    const child=spawnSync(process.execPath,['--expose-gc',__filename,'--lifetime-worker'],{encoding:'utf8',timeout:20000});
    assert.equal(child.status,0,child.stderr||child.error?.message);
  });
}
