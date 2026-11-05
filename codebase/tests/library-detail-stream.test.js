const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

// Runs the real band writer and streamed upload from library-gpu-raw.js
// against a stand-in GPU device and upload stream.
function load({refuseAt=-1}={}){
 const source=fs.readFileSync(require.resolve('../frontend/library-gpu-raw'),'utf8');
 const fn=source.slice(source.indexOf('  const READBACK_BAND'),source.indexOf('  async function developRaw('));
 const writes=[],events=[],destroyed=[];
 const stream={open:async()=>({ok:true}),
  write:async buffer=>{writes.push(new Uint8Array(buffer.slice(0)));return writes.length-1===refuseAt?{ok:false,status:503,text:'{"detail":"Waiting for memory to save detail; request it again."}'}:{ok:true};},
  end:async()=>{events.push('end');return {ok:true,status:200,text:'{}'};},cancel:()=>events.push('cancel')};
 const context={Uint8Array,Uint32Array,Error,Object,GPUBufferUsage:{MAP_READ:1,COPY_DST:2},GPUMapMode:{READ:1},
  root:{HDRLibraryUpload:{stream:()=>stream},HDRLibraryStopwatch:(stage,data)=>events.push(stage)}};
 vm.runInNewContext(fn+';this.sendStreamed=sendStreamed;',context);
 return {sendStreamed:context.sendStreamed,writes,events,destroyed};
}
// A GPU buffer whose bytes are a repeating pattern (or zero), read through
// copyBufferToBuffer and a mapped staging buffer as WebGPU does.
function gpuPlane(byteLength,destroyed,fill=offset=>(offset%251)+1){
 let pending=null;const largest=[0];
 const device={createBuffer:({size})=>{largest[0]=Math.max(largest[0],size);const data=new Uint8Array(size);return {size,data,
   mapAsync:async(_mode,at,length)=>{data.set(pending.subarray(0,length));},getMappedRange:(at,length)=>data.buffer.slice(at,at+length),unmap(){},destroy(){destroyed.push(size);}};},
  createCommandEncoder:()=>({copyBufferToBuffer:(src,from,_dst,_to,size)=>{pending=new Uint8Array(size);for(let i=0;i<size;i+=4096)pending[i]=fill(from+i);},finish:()=>({})}),
  queue:{submit(){}}};
 return {plane:{gpuBuffer:{},device,byteLength},largest};
}

test('full-size detail planes leave the GPU in bands of at most 64 MB, every byte in order',async()=>{
 const {sendStreamed,writes,events,destroyed}=load();
 const header=new Uint8Array([9,9,9,9]).buffer,band=64*1024*1024;
 const {plane,largest}=gpuPlane(band+8,destroyed);
 const answer=await sendStreamed('/api/library/live-developed',[header,plane],undefined,false,'photo');
 assert.equal(answer.ok,true);assert.deepEqual(events,['end']);
 assert.deepEqual(writes.map(w=>w.length),[4,band,8]);
 assert.equal(largest[0],band,'staging never exceeds one band');
 assert.deepEqual(destroyed,[band],'staging is released');
 assert.equal(writes[1][0],1);assert.equal(writes[1][4096],(4096%251)+1);assert.equal(writes[2][0],(band%251)+1);
});

test('a refused receiving buffer stops the stream and answers the refusal',async()=>{
 const {sendStreamed,writes,events,destroyed}=load({refuseAt:1});
 const {plane}=gpuPlane(64*1024*1024+8,destroyed);
 const answer=await sendStreamed('/api/library/live-developed',[new ArrayBuffer(4),plane],undefined,false,'photo');
 assert.equal(answer.ok,false);assert.equal(answer.status,503);
 assert.equal(writes.length,2,'no band is read after the refusal');
 assert.deepEqual(events,['cancel']);assert.equal(destroyed.length,1);
});

test('an empty RAW colour channel is still rejected as a GPU memory fault',async()=>{
 const {sendStreamed,events,destroyed}=load();
 const {plane}=gpuPlane(1024,destroyed,()=>0);
 await assert.rejects(sendStreamed('/api/library/raw-developed',[new ArrayBuffer(4),plane],undefined,true,'photo'),
  error=>error.gpuMemory && error.emptyChannel);
 assert.deepEqual(events,['picture_development_empty_channel','cancel']);
});
