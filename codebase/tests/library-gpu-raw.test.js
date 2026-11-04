const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../frontend/library-gpu-raw.js');
const { quantile, reducedSize } = globalThis.HDRLibraryGpuRaw;
function compileScheduled(context,fn){
 const original=context.gpu;
 context.gpu=async()=>({...await original(),device:{pushErrorScope(){},popErrorScope:async()=>null}});
 context.gpuFailures=new Map();context.activeGpuWorks=new Map();context.decodedSources=new Map();
 require('node:vm').runInNewContext(fn+';this.run=scheduledDevelopment;',context);
}

test('Library releases finished cache memory before accepting a RAW budget refusal', async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
  const fn=source.slice(source.indexOf('  function allocationScope('),source.indexOf('  async function develop(path,'));
  let held=80,drawn=0;const order=[];
  const context={performance,crypto:require('node:crypto').webcrypto,DOMException,
    serial:task=>task(),gpu:async()=>{},rawBudget:()=>60,
    root:{HDRLibraryScenes:{reclaim:async(bytes,required)=>{assert.equal(required,true);held=0;order.push('reclaim');},stage(){}}},
    fetch:async(_url,options)=>{if(options.method==='DELETE')return {};order.push('lease');return {ok:true,json:async()=>held+60>100?{fallback:'budget'}:{granted:true}};},
    developRaw:async()=>{drawn++;order.push('GPU');return {timings:{}};}};
  compileScheduled(context,fn);
  await context.run({meta:{},edges:[640,2560],background:true},new AbortController().signal);
  assert.equal(drawn,1);assert.deepEqual(order,['reclaim','lease','GPU']);
});

test('a second development waits at the GPU broker, not behind the first in this window', async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
  const fn=source.slice(source.indexOf('  function allocationScope('),source.indexOf('  async function develop(path,'));
  const started=[];let release;
  const held=new Promise(resolve=>{release=resolve;});
  const context={performance,crypto:require('node:crypto').webcrypto,DOMException,
    gpu:async()=>{},rawBudget:()=>60,
    root:{HDRLibraryScenes:{stage(){}}},
    fetch:async(_url,options)=>{if(options.method==='DELETE')return {};return {ok:true,json:async()=>({granted:true})};},
    developRaw:async({meta})=>{started.push(meta.path);await held;return {timings:{}};}};
  compileScheduled(context,fn);
  const signal=new AbortController().signal;
  const first=context.run({meta:{path:'a'},edges:[640]},signal);
  const second=context.run({meta:{path:'b'},edges:[640]},signal);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(started,['a','b'],'Both developments reached the GPU while the first was held');
  release();
  await Promise.all([first,second]);
});

test('the developed handoff frames the header and planes the backend unframes', async () => {
  const { handoffBody } = globalThis.HDRLibraryGpuRaw;
  const planes = [new Float32Array([0.1, 0.2, 0.3]).buffer, new Float32Array([0.4, 0.5]).buffer];
  const header = { path: 'C:/photos/photo.ARW', identity: ['12', '34'], edge: 640 };
  const bytes = new Uint8Array(handoffBody(header, planes));
  const length = new DataView(bytes.buffer).getUint32(0, true);
  assert.equal((4 + length) % 4, 0, 'Payload stays 4-byte aligned');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))), header);
  let offset = 4 + length;
  for (const plane of planes) {
    assert.deepEqual(bytes.subarray(offset, offset + plane.byteLength), new Uint8Array(plane));
    offset += plane.byteLength;
  }
  assert.equal(offset, bytes.length, 'Every plane byte is present once, in order');
});

test('sensor transfer slots give selected development the next slot ahead of read-ahead',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 const fn=source.slice(source.indexOf('  const LIMIT = 2'),source.indexOf('  // The grid and the filmstrip'));
 const context={DOMException};vm.runInNewContext(fn+';this.add=(job)=>{waiting.push(job);pump();};',context);
 const order=[];let finish;
 const blocked=new Promise(r=>finish=r),jobs=[];
 const add=(name,priority,hold=false)=>jobs.push(new Promise((resolve,reject)=>context.add({signal:new AbortController().signal,importance:()=>priority,resolve,reject,
  task:async()=>{order.push(name);if(hold)await blocked;}})));
 add('active-a',5,true);add('active-b',5,true);add('ahead',5);add('selected',0);
 await new Promise(r=>setImmediate(r));assert.deepEqual(order,['active-a','active-b']);
 finish();await Promise.all(jobs);assert.deepEqual(order,['active-a','active-b','selected','ahead']);
});

// numpy.quantile(values, q) with the default linear method, for comparison.
function numpyQuantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q, lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

test('robust peaks match numpy quantile and skip cropped-away samples', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const values = Array.from({ length: 20011 }, () => random() ** 3 * 4);
  const samples = new Float32Array(values.length * 3);
  values.forEach((v, i) => { samples[i * 3] = v; samples[i * 3 + 1] = v * 2; samples[i * 3 + 2] = -1; });
  const expected = numpyQuantile(Float32Array.from(values), 0.9999);
  assert.ok(Math.abs(quantile(samples, 0, 0.9999) - expected) <= 1e-6 * expected);
  assert.ok(Math.abs(quantile(samples, 1, 0.9999) - 2 * expected) <= 2e-6 * expected);
  assert.equal(quantile(samples, 2, 0.9999), 0, 'Only cropped-away samples: no measurement');
});

test('reduced sizes follow reduce_picture, including Python rounding and turned photos', () => {
  // 7968 x 5320 to 640: 427.3 rounds down. The GPU reduces in sensor
  // orientation, so a turned photo keeps the sensor-side size; the backend
  // turns the result into the 427 x 640 picture reduce_picture would make.
  assert.deepEqual(reducedSize({ width: 7968, height: 5320, flip: 0 }, 640), [427, 640]);
  assert.deepEqual(reducedSize({ width: 7968, height: 5320, flip: 6 }, 640), [427, 640]);
  assert.deepEqual(reducedSize({ width: 5320, height: 7968, flip: 5 }, 640), [640, 427]);
  // An exact half rounds to the even neighbour, as Python's round() does.
  assert.deepEqual(reducedSize({ width: 1280, height: 853, flip: 0 }, 640), [426, 640]);
  assert.deepEqual(reducedSize({ width: 1280, height: 855, flip: 0 }, 640), [428, 640]);
});


test('DNG reservation fits one-plane reduction without raising shared budgets',()=>{
 const meta={width:8000,height:6000,flip:0,dng_warp:{}};
 const bytes=HDRLibraryGpuRaw.rawBudget(meta);
 assert.ok(bytes<320*1024*1024);
 assert.ok(bytes>=8000*6000*4+6000*2560*4+1920*2560*8);
 assert.equal(HDRLibraryGpuRaw.rawBudget({...meta,dng_warp:undefined}),8000*6000*28+64*1024*1024);
 assert.equal(HDRLibraryGpuRaw.rawBudget({...meta,dng_warp:undefined,repairs:[{}]}),8000*6000*44+64*1024*1024);
});

test('DNG footprints enclose independent per-channel maps across off-centre and non-monotone warps',()=>{
 const {dngFootprint}=HDRLibraryGpuRaw.shared;
 const warp={width:8000,height:6000,center:[2700,3800],radius:6600,
  affine_x:[0,1,70],affine_y:[-1,0,5900],coefficients:[[1.2,-.4,.3,-.1,.06,-.05],[.8,.3,-.2,.1,-.04,.02],[1.1,-.2,.1,0,.03,.02]]};
 for(const [x,y,w,h] of [[0,0,512,1024],[3000,4500,900,700],[1000,1700,200,300]]){
  const box=dngFootprint(warp,x,y,w,h);
  for(let row=y;row<y+h;row+=17)for(let col=x;col<x+w;col+=19)for(const k of warp.coefficients){
   const X=(warp.affine_x[0]*col+warp.affine_x[1]*row+warp.affine_x[2]-warp.center[0])/warp.radius;
   const Y=(warp.affine_y[0]*col+warp.affine_y[1]*row+warp.affine_y[2]-warp.center[1])/warp.radius;
   const r=Math.min(X*X+Y*Y,1),rad=k[0]+k[1]*r+k[2]*r*r+k[3]*r*r*r;
   const sx=Math.max(0,Math.min(7999,warp.center[0]+warp.radius*(X*rad+2*k[4]*X*Y+k[5]*(r+2*X*X))));
   const sy=Math.max(0,Math.min(5999,warp.center[1]+warp.radius*(Y*rad+k[4]*(r+2*Y*Y)+2*k[5]*X*Y)));
   for(let tap=-1;tap<=2;tap++){
    const xx=Math.max(0,Math.min(7999,Math.floor(sx)+tap)),yy=Math.max(0,Math.min(5999,Math.floor(sy)+tap));
    assert.ok(xx>=box.left&&xx<box.left+box.width);assert.ok(yy>=box.top&&yy<box.top+box.height);
   }
  }
 }
});

test('memory admission waits, reclaims and retries the same GPU development',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 const fn=source.slice(source.indexOf('  function allocationScope('),source.indexOf('  async function develop(path,'));
 let leases=0,reclaims=0,developments=0;
 const context={performance,crypto:require('node:crypto').webcrypto,DOMException,
  gpu:async()=>({state:{lost:false}}),rawBudget:()=>60,wait:async()=>{},forgetDirect(){},
  root:{HDRLibraryScenes:{reclaim:async()=>{reclaims++;},stage(){},snapshot:()=>({draws:{active:0}})}},
  fetch:async(_url,options)=>({ok:true,json:async()=>++leases===1?{granted:false,waiting:'memory'}:{granted:true}}),
  developRaw:async()=>{developments++;return {timings:{}};}};
 compileScheduled(context,fn);
 await context.run({meta:{},edges:[640],background:true},new AbortController().signal);
 assert.equal(leases,2);assert.equal(reclaims,2);assert.equal(developments,1);
});

test('yields wait their turn, real failures are explained once, cancellations pass through', async () => {
 const vm=require('node:vm'),fs=require('node:fs');
 const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 const fn=source.slice(source.indexOf('  function allocationScope('),source.indexOf('  async function develop(path,'));
 for(const kind of ['yield','memory','abort','readonly']){
  let attempts=0,deletes=0,releases=0;const events=[];
  const context={performance,crypto:require('node:crypto').webcrypto,DOMException,
   gpu:async()=>({state:{lost:false}}),rawBudget:()=>60,wait:async()=>{},
   root:{HDRLibraryScenes:{stage(){}},HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields})},
   fetch:async(_url,options)=>{if(options.method==='DELETE')deletes++;else if(JSON.parse(options.body).release)releases++;return {ok:true,json:async()=>({granted:true})};},
   developRaw:async()=>{
    attempts++;
    if(kind==='yield'){if(attempts>4)return {developed:true};throw Object.assign(Error('Yielding GPU RAW to shared work.'),{yieldRaw:true});}
    if(kind==='abort')throw new DOMException('Cancelled','AbortError');
    if(kind==='readonly')throw new DOMException('mapAsync failed','OperationError');
    throw Error('RGB preparation exceeds the reserved memory budget.');}};
  compileScheduled(context,fn);
  const run=context.run({meta:{path:'photo.arw'},edges:[640]},new AbortController().signal);
  const failed=events=>events.filter(e=>e.stage==='picture_development_failed').length;
  if(kind==='yield'){
   // Four yields to more urgent work are not failures: the fifth turn finishes.
   assert.deepEqual(await run,{developed:true});
   assert.equal(attempts,5);assert.equal(releases,4);assert.equal(failed(events),0);
   const restarts=events.filter(e=>e.stage==='picture_development_restart');
   assert.equal(restarts.length,4);assert.ok(restarts.every(e=>e.reason&&e.attempt));
  } else if(kind==='abort'){
   await assert.rejects(run,error=>error.name==='AbortError'&&error.message==='Cancelled');
   assert.equal(failed(events),0);assert.equal(events.at(-1).work_stage,'cancelled');
  } else {
   await assert.rejects(run,error=>/^Development stopped after 1 attempt: (RGB preparation|mapAsync failed)/.test(error.message)&&!!error.cause?.message);
   assert.equal(attempts,1);assert.equal(failed(events),1);assert.equal(releases,0);
   assert.equal(events.at(-1).stage,'picture_development_outcome');
  }
  assert.equal(deletes,1);
 }
});


test('small RGB direct scene reservation covers source, reductions and retained textures',()=>{
 const estimate=globalThis.HDRLibraryGpuRaw.rawBudget({rgb:true,width:2400,height:1801,colour:{authored_sdr:true}},[640,2560]);
 assert.ok(estimate>=190_786_160,'IMG_0267 measured peak must fit');
});


test('a finished GPU frees a local place while that photo is still saving',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 const fn=source.slice(source.indexOf('  const LIMIT = 2'),source.indexOf('  // The grid and the filmstrip'));
 const context={DOMException};vm.runInNewContext(fn+';this.add=(job)=>{waiting.push(job);pump();};',context);
 const started=[],finished=[];let gpuDone,saveDone;
 const saving=new Promise(r=>saveDone=r),tasks=[];
 const add=(name,hold=false)=>tasks.push(new Promise((resolve,reject)=>context.add({signal:new AbortController().signal,importance:()=>10,resolve,reject,
  task:async release=>{started.push(name);if(hold){gpuDone=release;await saving;}finished.push(name);}})));
 add('a',true);add('b',true);add('c');
 await new Promise(r=>setImmediate(r));assert.deepEqual(started,['a','b']);
 gpuDone();await new Promise(r=>setImmediate(r));
 assert.deepEqual(started,['a','b','c']);assert.deepEqual(finished,['c']);
 saveDone();await Promise.all(tasks);
});

test('cooperative uploads preserve aligned source bytes and allow cancellation between copies',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');let clock=0,yields=0,stop=false;
 const context={performance:{now:()=>clock},DOMException,Uint8Array,ArrayBuffer,
  setTimeout:resolve=>{yields++;if(stop)controller.abort();resolve();}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8'),context);
 const upload=context.HDRLibraryGpuRaw.shared.uploadBuffer;
 const source=new Uint8Array(8*1024*1024+32).fill(71),view=source.subarray(8,source.length-8),target=new Uint8Array(view.length);
 const device={queue:{writeBuffer:(_,offset,body,start,count)=>{target.set(new Uint8Array(body,start,count),offset);clock+=5;}}};
 await upload(device,{},view);assert.deepEqual(target,view);assert.ok(yields>=2);
 const controller=new AbortController();stop=true;target.fill(0);
 await assert.rejects(upload(device,{},view,view.length,controller.signal),{name:'AbortError'});
 assert.equal(target[0],71);assert.equal(target.at(-1),0);
});

for (const late of [false, true]) test(`different GPU tiers share one source with independent cancellation (${late ? 'during reduction' : 'during read'})`, async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
  let unblock,entered;
  const gate=new Promise(resolve=>{unblock=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  let reads=0,releases=0;const reductions=[];
  const meta={source_job:'owner',path:'photo',identity:[],mosaic_bytes:0,width:1280,height:640};
  const header=Buffer.from(JSON.stringify(meta)),body=Buffer.alloc(4+header.length);
  body.writeUInt32LE(header.length);header.copy(body,4);
  const context={performance,crypto:require('node:crypto').webcrypto,DOMException,AbortController,
    Uint8Array,Float32Array,DataView,TextDecoder,setInterval,clearInterval,
    decodedSources:new Map(),directScenes:new Map(),cachedDirect:()=>null,
    sourceStorageLimit:async()=>Infinity,quantile:()=>1,
    handoffBody:globalThis.HDRLibraryGpuRaw.handoffBody,
    fetch:async(_url,options)=>{if(options.method==='DELETE')releases++;return {ok:true};},
    scheduledDevelopment:async({edges})=>{
      reductions.push([...edges]);if(late&&reductions.length===1){entered();await gate;}
      return {samples:[],peaks:{},timings:{},reduced:Object.fromEntries(edges.map(edge=>[edge,{width:Math.min(edge,1280),height:320,planes:[new ArrayBuffer(4)]}]))};
    },
    root:{HDRLibraryUpload:{
      fetchSource:async()=>{reads++;if(!late){entered();await gate;}return {ok:true,status:200,headers:{get:()=>''},arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.length)};},
      send:async(_url,{body,parts})=>{body=parts?.[0] || body;const n=new DataView(body).getUint32(0,true);const h=JSON.parse(new TextDecoder().decode(new Uint8Array(body,4,n)));return {ok:true,text:JSON.stringify({edge:h.edge,width:h.width})};}
    }}
  };
  vm.runInNewContext(source.slice(source.indexOf('  async function develop(path,'),source.indexOf('  const warmup ='))+';this.request=thumbnail;this.jobs=inflight;',context);
  const cancel=new AbortController();
  const small=context.request('photo',640,cancel.signal,{liveScene:true});
  const rejected=assert.rejects(small,{name:'AbortError'});
  await started;
  const completedJob=context.jobs.values().next().value;
  const large=context.request('photo',2560,null,{liveScene:true});
  cancel.abort();unblock();await rejected;
  assert.equal((await large).edge,2560);
  assert.equal(reads,1);assert.equal(releases,1);
  assert.equal(completedJob.source,null,'Completed shared work must relinquish its downloaded samples even while picture callbacks keep the job alive');
  assert.deepEqual(reductions.flat().sort((a,b)=>a-b),[640,2560]);
});

for (const liveScene of [false,true]) test(`native requests develop and hand off full size separately from scene demand (live=${liveScene})`,async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
  const meta={path:'photo',identity:[],mosaic_bytes:0,width:6000,height:4000};
  const header=Buffer.from(JSON.stringify(meta)),body=Buffer.alloc(4+header.length);
  body.writeUInt32LE(header.length);header.copy(body,4);
  const requests=[],reductions=[],handoffs=[];
  const context={performance,crypto:require('node:crypto').webcrypto,DOMException,AbortController,
    Uint8Array,Float32Array,DataView,TextDecoder,setInterval,clearInterval,
    decodedSources:new Map(),directScenes:new Map(),cachedDirect:()=>null,
    sourceStorageLimit:async()=>Infinity,quantile:()=>1,
    handoffBody:globalThis.HDRLibraryGpuRaw.handoffBody,
    fetch:async()=>({ok:true}),
    scheduledDevelopment:async({edges})=>{
      reductions.push([...edges]);
      return {samples:[],peaks:{},timings:{},reduced:Object.fromEntries(edges.map(edge=>{
        const [height,width]=reducedSize(meta,edge);
        return [edge,{width,height,planes:[new ArrayBuffer(4)]}];
      }))};
    },
    root:{HDRLibraryUpload:{
      fetchSource:async(_url,{body:request})=>{requests.push(JSON.parse(request));return {ok:true,status:200,headers:{get:()=>''},arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.length)};},
      send:async(_url,{body,parts})=>{body=parts?.[0] || body;const n=new DataView(body).getUint32(0,true);const h=JSON.parse(new TextDecoder().decode(new Uint8Array(body,4,n)));handoffs.push(h);return {ok:true,text:JSON.stringify({edge:h.edge,width:h.width,height:h.height})};}
    }}
  };
  vm.runInNewContext(source.slice(source.indexOf('  async function develop(path,'),source.indexOf('  const warmup ='))+';this.request=thumbnail;this.jobs=inflight;',context);
  const scene=context.request('photo',2560,null,{liveScene:true});
  const native=context.request('photo',2560,null,{liveScene,nativeMode:true,edges:new Set([640,2560])});
  assert.equal((await scene).width,2560);
  const result=await native;
  assert.equal(result.width,6000);assert.equal(result.height,4000);
  assert.deepEqual(reductions.flat().sort((a,b)=>a-b),[2560,100000]);
  assert.deepEqual(requests.map(r=>r.edge).sort((a,b)=>a-b),liveScene?[2560,100000]:[2560,2560]);
  if (!liveScene) assert.equal(requests.find(r=>r.native_mode)?.edge,2560,'Sensor API keeps its bounded edge; native_mode selects the full sensor');
  const full=handoffs.find(h=>h.edge===100000);
  assert.equal(full.native_mode,!liveScene);
  assert.equal(full.width,full.source_width);assert.equal(full.height,full.source_height);
});

for(const cancelAll of [false,true])test(`shared samples release after ${cancelAll?'last requester cancels':'handoff fails'}`,async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 let enter,release,releases=0;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const meta={source_job:'owner',path:'photo',identity:[],mosaic_bytes:0,width:1280,height:640};
 const header=Buffer.from(JSON.stringify(meta)),bytes=Buffer.alloc(4+header.length);bytes.writeUInt32LE(header.length);header.copy(bytes,4);
 const context={performance,crypto:require('node:crypto').webcrypto,DOMException,AbortController,
  Uint8Array,Float32Array,DataView,TextDecoder,setInterval,clearInterval,
  decodedSources:new Map(),directScenes:new Map(),cachedDirect:()=>null,sourceStorageLimit:async()=>Infinity,quantile:()=>1,
  handoffBody:globalThis.HDRLibraryGpuRaw.handoffBody,
  fetch:async(_url,options)=>{if(options.method==='DELETE')releases++;return {ok:true};},
  scheduledDevelopment:async()=>({samples:[],peaks:{},timings:{},reduced:{640:{width:640,height:320,planes:[]}}}),
  root:{HDRLibraryUpload:{fetchSource:async()=>{enter();await gate;return {ok:true,status:200,headers:{get:()=>''},arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};},send:async()=>{throw Error('handoff failed');}}}};
 vm.runInNewContext(source.slice(source.indexOf('  async function develop(path,'),source.indexOf('  const warmup ='))+';this.request=thumbnail;this.jobs=inflight;',context);
 const controller=new AbortController(),request=context.request('photo',640,controller.signal,{liveScene:true});
 const rejected=assert.rejects(request,cancelAll?{name:'AbortError'}:/handoff failed/);
 await entered;const job=context.jobs.values().next().value;
 if(cancelAll)controller.abort();release();await rejected;
 await assert.rejects(job.promise,cancelAll?{name:'AbortError'}:/handoff failed/);
 assert.equal(job.source,null);assert.equal(releases,1);
});


test('shared samples release before CPU fallback',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 let enter,release,releases=0;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const meta={source_job:'owner',path:'photo',identity:[],mosaic_bytes:0,width:1280,height:640};
 const header=Buffer.from(JSON.stringify(meta)),bytes=Buffer.alloc(4+header.length);bytes.writeUInt32LE(header.length);header.copy(bytes,4);
 const context={performance,crypto:require('node:crypto').webcrypto,DOMException,AbortController,
  Uint8Array,Float32Array,DataView,TextDecoder,setInterval,clearInterval,
  decodedSources:new Map(),directScenes:new Map(),cachedDirect:()=>null,sourceStorageLimit:async()=>Infinity,quantile:()=>1,
  handoffBody:globalThis.HDRLibraryGpuRaw.handoffBody,
  fetch:async(_url,options)=>{if(options.method==='DELETE')releases++;return {ok:true};},
  scheduledDevelopment:async()=>{throw Object.assign(Error('handoff failed'),{gpuUnavailable:true});},
  root:{HDRLibraryUpload:{fetchSource:async()=>{enter();await gate;return {ok:true,status:200,headers:{get:()=>''},arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};},send:async()=>{throw Error('handoff failed');}}}};
 vm.runInNewContext(source.slice(source.indexOf('  async function develop(path,'),source.indexOf('  const warmup ='))+';this.request=thumbnail;this.jobs=inflight;',context);
 const controller=new AbortController(),request=context.request('photo',640,controller.signal,{liveScene:true});
 const rejected=assert.rejects(request,/handoff failed/);
 await entered;const job=context.jobs.values().next().value;
 release();await rejected;
 await assert.rejects(job.promise,/handoff failed/);
 assert.equal(job.source,null);assert.equal(releases,1);
});


test('invalid-pixel rejection keeps its CPU fallback identity through the GPU scheduler',async()=>{
 const source=fsRead();
 function fsRead(){return require('node:fs').readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');}
 const fn=source.slice(source.indexOf('  function allocationScope('),source.indexOf('  async function develop(path,'));
 const events=[];let attempts=0;
 const context={performance,crypto:require('node:crypto').webcrypto,DOMException,wait:async()=>{},
  gpu:async()=>({state:{lost:false}}),rawBudget:()=>60,
  root:{HDRLibraryScenes:{stage(){}},HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields})},
  fetch:async()=>({ok:true,json:async()=>({granted:true})}),
  developRaw:async()=>{attempts++;throw Object.assign(Error('GPU edge colour produced 141 invalid pixels; using the CPU.'),{gpuUnavailable:true,gpuInvalidPixels:true});}};
 compileScheduled(context,fn);
 await assert.rejects(context.run({meta:{path:'photo.arw'},edges:[640]},new AbortController().signal),error=>error.gpuUnavailable&&error.gpuInvalidPixels);
 assert.equal(events.filter(e=>e.stage==='picture_development_failed').length,0);
 assert.equal(events.filter(e=>e.stage==='picture_development_gpu_rejected').length,1);
 assert.equal(attempts,2);
 assert.equal(events.filter(e=>e.stage==='picture_development_gpu_retry').length,1);
});


test('late sharp request publishes its thumbnail and adopts the retained source across sizes',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 const events=[],meta={source_job:'owner',path:'photo',mosaic_bytes:0};
 const header=Buffer.from(JSON.stringify(meta)),bytes=Buffer.alloc(4+header.length);bytes.writeUInt32LE(header.length);header.copy(bytes,4);
 const decodedSources=new Map([['photo|scene|revision',{body:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),token:'owner'}]]);
 const context={performance,crypto:require('node:crypto').webcrypto,DOMException,AbortController,
  Uint8Array,Float32Array,DataView,TextDecoder,setInterval,clearInterval,decodedSources,
  directScenes:new Map([['photo|revision:sdr',{variants:{640:{}},store:async()=>events.push('publish thumbnail')}]]),
  sourceStorageLimit:async()=>Infinity,
  fetch:async(_url,options)=>{events.push(options.method);return {ok:true};},
  scheduledDevelopment:async()=>{events.push('develop retained samples');throw Object.assign(Error('stop after adoption'),{gpuUnavailable:true});},
  root:{HDRLibraryUpload:{fetchSource:async()=>{throw Error('must reuse existing samples');}}}};
 vm.runInNewContext(source.slice(source.indexOf('  async function develop(path,'),source.indexOf('  const warmup ='))+';this.run=develop;',context);
 const shared={edges:new Set([2560]),results:new Map()};
 await assert.rejects(context.run('photo',2560,null,false,false,true,()=>0,'revision:sdr',null,()=>{},shared),/stop after adoption/);
 assert.deepEqual(events,['publish thumbnail','POST','develop retained samples','DELETE']);
 assert.equal(decodedSources.size,0);assert.equal(shared.source,null);
});
