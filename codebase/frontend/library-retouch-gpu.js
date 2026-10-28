/* Retouch in the Library's existing RAW lease, before source reduction. */
window.HDRLibraryRetouch=async function({device,meta,planes,make,release,read,budget,permit,signal,peaks,samples}){
 const w=meta.width,h=meta.height,n=w*h,turned=[5,6].includes(meta.flip),ow=turned?h:w;
 const flip=meta.flip;
 const sensor=`fn index(x:u32,y:u32)->u32{${flip===3?`return (${h-1}u-y)*${w}u+${w-1}u-x;`:flip===6?`return (${h-1}u-x)*${w}u+y;`:flip===5?`return x*${w}u+${w-1}u-y;`:`return y*${w}u+x;`}}`;
 const bindings=`@group(0) @binding(0) var<storage,read_write> r:array<f32>;
 @group(0) @binding(1) var<storage,read_write> g:array<f32>;
 @group(0) @binding(2) var<storage,read_write> b:array<f32>;
 @group(0) @binding(3) var<storage,read_write> values:array<f32>;`;
 const run=async(code,buffers,count)=>{
  await permit();
  const module=device.createShaderModule({code});
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.min(65535,Math.ceil(count/64)),Math.ceil(count/(65535*64)));pass.end();device.queue.submit([encoder.finish()]);
 };
 const edited=planes.map(()=>make(n*4));
 let accepted=false;
 try{
  const copy=device.createCommandEncoder();planes.forEach((p,i)=>copy.copyBufferToBuffer(p,0,edited[i],0,n*4));device.queue.submit([copy.finish()]);
  for(const repair of meta.repairs){
   const parts=[];
   for(const [l,t,right,bottom] of repair.rectangles){
    const rw=right-l,rh=bottom-t,count=rw*rh,buffer=make(count*12);
    try{
     await run(bindings+sensor+`@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x+id.y*4194240u;if(i>=${count}u){return;}let p=index(${l}u+i%${rw}u,${t}u+i/${rw}u);values[i*3u]=r[p];values[i*3u+1u]=g[p];values[i*3u+2u]=b[p];}`,[...planes,buffer],count);
     parts.push(await read(buffer,count*12));
    }finally{release(buffer);}
   }
   const text=new TextEncoder().encode(JSON.stringify({source_job:meta.source_job,item_path:meta.item_path,repair:repair.id}));
   const prefix=new Uint8Array(4+text.length+(4-(4+text.length)%4)%4).fill(32);
   new DataView(prefix.buffer).setUint32(0,prefix.length-4,true);prefix.set(text,4);
   const response=await fetch('/api/library/retouch-packet',{method:'POST',signal,body:new Blob([prefix,...parts])});
   if(!response.ok)throw Error('Library repair preparation failed: '+await response.text());
   const body=await response.arrayBuffer(),length=new DataView(body).getUint32(0,true);
   const packet=JSON.parse(new TextDecoder().decode(new Uint8Array(body,4,length)));
   const result=await HDRRetouchGPU.run(device,packet,body.slice(4+length),permit,budget());
   const count=packet.pw*packet.ph,patch=make(count*16);
   const packed=new Float32Array(count*4),pixels=new Float32Array(result.pixels),input=new Float32Array(body,4+length);
   for(let i=0;i<count;i++){
    packed.set(pixels.subarray(i*3,i*3+3),i*4);
    const ai=packet.mode==='inpaint'?(packet.y+Math.floor(i/packet.pw))*packet.nw+packet.x+i%packet.pw:i;
    packed[i*4+3]=input[packet.input.alpha+ai];
   }
   try{
    device.queue.writeBuffer(patch,0,packed);
    const [l,t]=packet.origin;
    await run(bindings+sensor+`@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x+id.y*4194240u;if(i>=${count}u||values[i*4u+3u]<=0.0){return;}let p=index(${l}u+i%${packet.pw}u,${t}u+i/${packet.pw}u);r[p]=values[i*4u];g[p]=values[i*4u+1u];b[p]=values[i*4u+2u];}`,[...edited,patch],count);
   }finally{release(patch);}
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
  await run(code,[...edited,peaks,samples],n);
  await device.queue.onSubmittedWorkDone();accepted=true;return edited;
 }finally{if(!accepted){await device.queue.onSubmittedWorkDone().catch(()=>{});edited.forEach(release);}}
};
