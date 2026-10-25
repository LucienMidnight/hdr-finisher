const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../frontend/library-gpu-raw.js');
const { quantile, reducedSize } = globalThis.HDRLibraryGpuRaw;

test('Library releases finished cache memory before accepting a RAW budget refusal', async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
  const fn=source.slice(source.indexOf('  async function scheduledDevelopment('),source.indexOf('  async function develop(path,'));
  let held=80,drawn=0;const order=[];
  const context={performance,crypto:require('node:crypto').webcrypto,DOMException,
    serial:task=>task(),gpu:async()=>{},rawBudget:()=>60,
    root:{HDRLibraryScenes:{reclaim:async(bytes,required)=>{assert.equal(required,true);held=0;order.push('reclaim');},stage(){}}},
    fetch:async(_url,options)=>{if(options.method==='DELETE')return {};order.push('lease');return {ok:true,json:async()=>held+60>100?{fallback:'budget'}:{granted:true}};},
    developRaw:async()=>{drawn++;order.push('GPU');return {timings:{}};}};
  vm.runInNewContext(fn+';this.run=scheduledDevelopment;',context);
  await context.run({meta:{},edges:[640,2560],background:true},new AbortController().signal);
  assert.equal(drawn,1);assert.deepEqual(order,['reclaim','lease','GPU']);
});

test('a second development waits at the GPU broker, not behind the first in this window', async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
  const fn=source.slice(source.indexOf('  async function scheduledDevelopment('),source.indexOf('  async function develop(path,'));
  const started=[];let release;
  const held=new Promise(resolve=>{release=resolve;});
  const context={performance,crypto:require('node:crypto').webcrypto,DOMException,
    gpu:async()=>{},rawBudget:()=>60,
    root:{HDRLibraryScenes:{stage(){}}},
    fetch:async(_url,options)=>{if(options.method==='DELETE')return {};return {ok:true,json:async()=>({granted:true})};},
    developRaw:async({meta})=>{started.push(meta.path);await held;return {timings:{}};}};
  vm.runInNewContext(fn+';this.run=scheduledDevelopment;',context);
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
  const bytes = new Uint8Array(await handoffBody(header, planes).arrayBuffer());
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
 assert.equal(HDRLibraryGpuRaw.rawBudget({...meta,dng_warp:undefined}),8000*6000*44+64*1024*1024);
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
