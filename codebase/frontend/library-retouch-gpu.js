/* Retouch in the Library's existing RAW lease, before source reduction. */
window.HDRLibraryRetouch=async function({device,repairDevice,meta,planes,make,release,read,budget,permit,signal,peaks,samples,timings}){
 const w=meta.width,h=meta.height,n=w*h,turned=[5,6].includes(meta.flip),ow=turned?h:w;
 const flip=meta.flip;
 const sensor=`fn index(x:u32,y:u32)->u32{${flip===3?`return (${h-1}u-y)*${w}u+${w-1}u-x;`:flip===6?`return (${h-1}u-x)*${w}u+y;`:flip===5?`return x*${w}u+${w-1}u-y;`:`return y*${w}u+x;`}}`;
 const bindings=`@group(0) @binding(0) var<storage,read_write> r:array<f32>;
 @group(0) @binding(1) var<storage,read_write> g:array<f32>;
 @group(0) @binding(2) var<storage,read_write> b:array<f32>;
 @group(0) @binding(3) var<storage,read_write> values:array<f32>;`;
 const compile=async code=>{
  await permit();
  const module=device.createShaderModule({code});
  return device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
 };
 const dispatch=(pipeline,buffers,rectangles)=>{
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);
  for(const {count,parameters} of rectangles){
   const resources=buffers.map(buffer=>({buffer}));
   if(parameters)resources.push(parameters);
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
   pass.setBindGroup(0,group);
   pass.dispatchWorkgroups(Math.min(65535,Math.ceil(count/64)),Math.ceil(count/(65535*64)));
  }
  pass.end();device.queue.submit([encoder.finish()]);
 };
 const geometry=bindings+sensor+`
 struct Rectangle { left:u32, top:u32, width:u32, count:u32, offset:u32 }
 @group(0) @binding(4) var<storage,read> rect:Rectangle;
 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
  let i=id.x+id.y*4194240u;if(i>=rect.count){return;}
  let p=index(rect.left+i%rect.width,rect.top+i/rect.width);
 `;
 const gather=await compile(geometry+`
  let j=rect.offset+i*3u; values[j]=r[p];values[j+1u]=g[p];values[j+2u]=b[p];
 }`);
 const scatter=await compile(geometry+`
  let j=rect.offset+i*4u;if(values[j+3u]<=0.0){return;}
  r[p]=values[j];g[p]=values[j+1u];b[p]=values[j+2u];
 }`);
 const runRectangles=async(pipeline,buffers,rectangles,channels)=>{
  await permit();
  const stride=Math.max(32,device.limits.minStorageBufferOffsetAlignment);
  const parameters=make(stride*rectangles.length);
  try{
   const packed=new Uint32Array(stride/4*rectangles.length);
   let offset=0;
   const work=rectangles.map(([l,t,r,b],i)=>{
    const width=r-l,count=width*(b-t);
    packed.set([l,t,width,count,offset],i*stride/4);
    offset+=count*channels;
    return {count,parameters:{buffer:parameters,offset:i*stride,size:20}};
   });
   device.queue.writeBuffer(parameters,0,packed);
   dispatch(pipeline,buffers,work);
   await device.queue.onSubmittedWorkDone();
  }finally{release(parameters);}
 };
 const recordTiming=(name,elapsed)=>{
  const key='retouch_'+name;
  timings[key]=name.includes('_max_') ? Math.max(timings[key]||0,elapsed) : (timings[key]||0)+elapsed;
 };
 const edited=planes.map(()=>make(n*4));
 let accepted=false;
 try{
  const copy=device.createCommandEncoder();planes.forEach((p,i)=>copy.copyBufferToBuffer(p,0,edited[i],0,n*4));device.queue.submit([copy.finish()]);
  for(const [batch,repairs] of meta.repairs.entries()){
   let started=performance.now();
   const rectangles=repairs.flatMap(repair=>repair.rectangles);
   const bytes=rectangles.reduce((size,[l,t,r,b])=>size+(r-l)*(b-t)*12,0);
   const buffer=make(bytes);
   let part;
   try{
    await runRectangles(gather,[...planes,buffer],rectangles,3);
    part=await read(buffer,bytes);
   }finally{release(buffer);}
   const gathered=performance.now()-started;
   recordTiming('gather_ms',gathered);recordTiming('gather_max_batch_ms',gathered);
   const text=new TextEncoder().encode(JSON.stringify({source_job:meta.source_job,item_path:meta.item_path,batch}));
   const prefix=new Uint8Array(4+text.length+(4-(4+text.length)%4)%4).fill(32);
   new DataView(prefix.buffer).setUint32(0,prefix.length-4,true);prefix.set(text,4);
   await permit();
   started=performance.now();
   const response=await fetch('/api/library/retouch-packet',{method:'POST',signal,body:new Blob([prefix,part])});
   if(response.status===499)throw new DOMException('Library Retouch replay was cancelled.','AbortError');
   if(!response.ok){
    const body=await response.text();
    if(response.status===409){
     let conflict;
     try{conflict=JSON.parse(body);}catch{}
     if(conflict?.superseded===true)throw Object.assign(new DOMException(conflict.detail,'AbortError'),{repairSuperseded:true});
    }
    throw Error('Library repair preparation failed: '+body);
   }
   const body=await response.arrayBuffer(),length=new DataView(body).getUint32(0,true);
   const answer=JSON.parse(new TextDecoder().decode(new Uint8Array(body,4,length)));
   recordTiming('request_ms',performance.now()-started);
   for(const [key,value] of Object.entries(answer.timings))recordTiming(key,value);
   const patches=[];
   for(const packet of answer.repairs){
    const offset=4+length+packet.offset;
    if(packet.mode!=='inpaint'){
     patches.push(new Float32Array(body,offset,packet.bytes/4));
     continue;
    }
    started=performance.now();
    const result=await HDRRetouchGPU.run(repairDevice,packet,body.slice(offset,offset+packet.bytes),permit,budget());
    const elapsed=performance.now()-started;
    recordTiming('gpu_solve_ms',elapsed);recordTiming('gpu_solve_max_ms',elapsed);
    const count=packet.pw*packet.ph,packed=new Float32Array(count*4);
    const pixels=new Float32Array(result.pixels),input=new Float32Array(body,offset,packet.bytes/4);
    for(let i=0;i<count;i++){
     packed.set(pixels.subarray(i*3,i*3+3),i*4);
     const ai=(packet.y+Math.floor(i/packet.pw))*packet.nw+packet.x+i%packet.pw;
     packed[i*4+3]=input[packet.input.alpha+ai];
    }
    patches.push(packed);
   }
   started=performance.now();
   const packed=new Float32Array(patches.reduce((sum,part)=>sum+part.length,0));
   let offset=0;
   for(const part of patches){packed.set(part,offset);offset+=part.length;}
   const patch=make(packed.byteLength);
   try{
    device.queue.writeBuffer(patch,0,packed);
    await runRectangles(scatter,[...edited,patch],answer.repairs.map(packet=>{
     const [l,t]=packet.origin;
     return [l,t,l+packet.pw,t+packet.ph];
    }),4);
   }finally{release(patch);}
   const scattered=performance.now()-started;
   recordTiming('scatter_ms',scattered);recordTiming('scatter_max_batch_ms',scattered);
  }
  // Re-measure the repaired native source, including samples used by selections.
  device.queue.writeBuffer(peaks,0,new Uint32Array(3));
  const matrix=meta.acescg_to_bt2020.map(row=>`vec3f(${row.map(v=>Number(v).toExponential(9)).join(',')})`);
  const code=bindings.replace('@group(0) @binding(3) var<storage,read_write> values:array<f32>;',`@group(0) @binding(3) var<storage,read_write> peak:array<atomic<u32>>;@group(0) @binding(4) var<storage,read_write> samples:array<f32>;`)+sensor+`
 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x+id.y*4194240u;if(i>=${n}u){return;}
 let y=i/${ow}u;let x=i%${ow}u;let p=index(x,y);let v=vec3f(r[p],g[p],b[p]);
 let top=max(v.x,max(v.y,v.z));let luma=dot(v,vec3f(0.2722287,0.6740818,0.0536895));
 let bt=vec3f(dot(v,${matrix[0]}),dot(v,${matrix[1]}),dot(v,${matrix[2]}));let btop=max(bt.x,max(bt.y,bt.z));
 atomicMax(&peak[0],bitcast<u32>(max(top,0.0)));atomicMax(&peak[1],bitcast<u32>(max(luma,0.0)));atomicMax(&peak[2],bitcast<u32>(max(btop,0.0)));
 if(x%${meta.sample_stride}u==0u&&y%${meta.sample_stride}u==0u){let si=(y/${meta.sample_stride}u*${Math.ceil(ow/meta.sample_stride)}u+x/${meta.sample_stride}u)*3u;samples[si]=max(luma,0.0);samples[si+1u]=max(top,0.0);samples[si+2u]=max(btop,0.0);}}
 `;
  dispatch(await compile(code),[...edited,peaks,samples],[{count:n}]);
  await device.queue.onSubmittedWorkDone();accepted=true;return edited;
 }finally{if(!accepted){await device.queue.onSubmittedWorkDone().catch(()=>{});edited.forEach(release);}}
};
