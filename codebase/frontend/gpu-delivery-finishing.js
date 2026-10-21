/* Delivery finishing on the shared renderer's device. CPU order and controls:
 * completed film -> separable Lanczos3 -> edge-aware multiscale -> limiter.
 * rgba32float scratch avoids introducing half-float rounding in repeated blur.
 */
window.HDRGpuDeliveryFinishing = class {
  constructor(gpu, permit) { this.gpu=gpu; this.device=gpu.device; this.permit=permit; this.owned=new Set(); }
  // Rows per submission. Each submission waits for the GPU, so 128-row strips of
  // a 42 MP image spent more time in round trips than in work. About 4 M pixels
  // keeps each submission to a few milliseconds of GPU time, so Grade can still
  // take the GPU back promptly. The split never changes a pixel.
  strip(width) { return Math.min(4096,Math.max(128,Math.floor(4194304/Math.max(1,width)/8)*8)); }
  texture(width,height,format="rgba32float") {
    const value=this.device.createTexture({size:[width,height],format,
      usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    this.owned.add(value); return value;
  }
  release(value) { if(this.owned.delete(value)) value.destroy(); }
  destroy() { for(const value of this.owned) value.destroy(); this.owned.clear(); this.ranges?.destroy(); }
  async initialize() {
    const code=`
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(1) var fine:texture_2d<f32>;
@group(0) @binding(2) var medium:texture_2d<f32>;
@group(0) @binding(3) var residual:texture_2d<f32>;
@group(0) @binding(4) var dst:texture_storage_2d<rgba32float,write>;
@group(0) @binding(5) var<storage,read> p:array<f32>;
@group(0) @binding(6) var<storage,read_write> ranges:array<atomic<u32>>;
fn at(t:texture_2d<f32>,q:vec2i)->vec4f { return textureLoad(t,clamp(q,vec2i(0),vec2i(textureDimensions(t))-1),0); }
fn order(v:f32)->u32 { let b=bitcast<u32>(v); return select(b^0x80000000u,~b,(b&0x80000000u)!=0u); }
fn unorder(b:u32)->f32 { return bitcast<f32>(select(~b,b^0x80000000u,(b&0x80000000u)!=0u)); }
fn luma(v:vec3f)->f32 { return dot(v,select(vec3f(.2126,.7152,.0722),vec3f(.2722287,.6740818,.0536895),p[3]>0.5)); }
fn encode(v:f32)->f32 { let x=clamp(v,0.,1.); return select(1.055*pow(x,1./2.4)-.055,12.92*x,x<=.0031308); }
fn decode(v:f32)->f32 { let x=clamp(v,0.,1.); return select(pow((x+.055)/1.055,2.4),x/12.92,x<=.04045); }
fn sinc(v:f32)->f32 { if(abs(v)<1e-7){return 1.;} let a=v*3.141592653589793; return sin(a)/a; }
fn lanczos(v:f32)->f32 { if(abs(v)>=3.){return 0.;} return sinc(v)*sinc(v/3.); }
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {
 let q=vec2i(i32(id.x),i32(id.y)+i32(p[8])); let size=vec2i(textureDimensions(dst));
 if(any(q>=size)){return;} let mode=i32(p[0]); var value=vec4f(0.,0.,0.,1.);
 if(mode==0) {
   let stored=at(src,q); value=vec4f(stored.rgb*stored.a,1.);
   for(var c=0;c<3;c++){ atomicMin(&ranges[c],order(value[c])); atomicMax(&ranges[c+3],order(value[c])); }
 } else if(mode==1) {
   let axis=i32(p[1]); let scale=f32(textureDimensions(src)[axis])/f32(size[axis]); let support=max(1.,scale);
   let center=(f32(q[axis])+.5)*scale; let first=max(0,i32(floor(center-support*3.+.5)));
   let last=min(i32(textureDimensions(src)[axis]),i32(floor(center+support*3.+.5)));
   var total=vec3f(0.); var weight=0.;
   for(var i=first;i<last;i++){var pos=q;pos[axis]=i;let w=lanczos((f32(i)+.5-center)/support);total+=at(src,pos).rgb*w;weight+=w;}
   var rgb=total/max(weight,1e-8);
   if(axis==1){for(var c=0;c<3;c++){rgb[c]=clamp(rgb[c],unorder(atomicLoad(&ranges[c])),unorder(atomicLoad(&ranges[c+3])));}}
   value=vec4f(rgb,1.);
 } else if(mode==2) {
   let y=luma(at(src,q).rgb); var signal=encode(y); if(p[3]>.5){signal=log2(max(y,1e-7)/.18);} value=vec4f(signal,0.,0.,1.);
 } else if(mode==3) {
   let r=i32(p[2]); let axis=i32(p[1]); var sum=0.;
   for(var i=-r;i<=r;i++){var pos=q;pos[axis]+=i;sum+=at(src,pos).r;} value=vec4f(sum/f32(2*r+1),0.,0.,1.);
 } else if(mode==4) { value=vec4f(abs(at(src,q).r-at(fine,q).r),0.,0.,1.);
 } else if(mode==5) {
   let rgb=at(src,q).rgb;let signal=at(fine,q).r;let bases=at(medium,q).rg;
   let f=signal-bases.r;let m=bases.r-bases.g;
   let gx=abs(at(medium,q+vec2i(1,0)).g-bases.g);let gy=abs(at(medium,q+vec2i(0,1)).g-bases.g);
   let structure=length(vec2f(gx,gy));let noise=at(residual,q).r;
   var mask=clamp(.18+2.8*structure/(structure+noise+1e-6),0.,1.);
   if(abs(f)+abs(m)<=1e-7){mask=0.;} let detail=mask*(p[4]*f+p[5]*m);
   var low=signal;var high=signal;
   for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let v=at(fine,q+vec2i(x,y)).r;low=min(low,v);high=max(high,v);}}
   let allowance=p[6]*(high-low);let sharpened=clamp(signal+detail,low-allowance,high+allowance);
   var targetY=decode(sharpened);if(p[3]>.5){targetY=.18*exp2(clamp(sharpened,-32.,16.));}
   var gain=1.;let y=luma(rgb);if(y>1e-7 && abs(detail)>1e-7){gain=targetY/y;}
   value=vec4f(max(rgb*gain,vec3f(0.)),1.);
 } else if(mode==6) {value=vec4f(at(src,q).r,at(fine,q).r,0.,1.);}
 else if(mode==7) {var rgb=max(at(src,q).rgb,vec3f(0.));if(p[3]<.5){rgb=min(rgb,vec3f(1.));} value=vec4f(rgb,1.);}
 textureStore(dst,q,value);
}`;
    const module=this.device.createShaderModule({code});
    const info=await module.getCompilationInfo(); const errors=info.messages.filter(v=>v.type==="error");
    if(errors.length) throw Error(errors.map(v=>v.message).join("; "));
    this.pipeline=await this.device.createComputePipelineAsync({layout:"auto",compute:{module,entryPoint:"main"}});
    this.ranges=this.device.createBuffer({size:24,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    this.device.queue.writeBuffer(this.ranges,0,new Uint32Array([0xffffffff,0xffffffff,0xffffffff,0,0,0]));
  }
  async run(mode,src,dst,{axis=0,radius=0,hdr=false,amounts=[0,0],allowance=.12,fine=src,medium=src,residual=src}={}) {
    const buffer=this.device.createBuffer({size:48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    try {
      const rows=this.strip(dst.width);
      for(let row=0;row<dst.height;row+=rows){
        await this.permit();
        this.device.queue.writeBuffer(buffer,0,new Float32Array([mode,axis,radius,hdr?1:0,...amounts,allowance,0,row,0,0,0]));
        const group=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:src.createView()},{binding:1,resource:fine.createView()},
          {binding:2,resource:medium.createView()},{binding:3,resource:residual.createView()},
          {binding:4,resource:dst.createView()},{binding:5,resource:{buffer}},{binding:6,resource:{buffer:this.ranges}},
        ]});
        const encoder=this.device.createCommandEncoder();const pass=encoder.beginComputePass();
        pass.setPipeline(this.pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(dst.width/8),Math.ceil(Math.min(rows,dst.height-row)/8));pass.end();
        this.device.queue.submit([encoder.finish()]);await this.gpu.waitForSubmittedWork();
      }
    } finally {buffer.destroy();}
  }
  async blur(src,radius){
    const a=this.texture(src.width,src.height),b=this.texture(src.width,src.height);
    await this.run(3,src,a,{axis:0,radius});await this.run(3,a,b,{axis:1,radius});this.release(a);return b;
  }
  async finish(capture,job,lane){
    this.device.queue.writeBuffer(this.ranges,0,new Uint32Array([0xffffffff,0xffffffff,0xffffffff,0,0,0]));
    const hdr=lane==="hdr";let image=this.texture(capture.width,capture.height);
    await this.run(0,capture,image);this.release(capture);
    const [width,height]=job.output;
    if(width!==image.width || height!==image.height){
      const horizontal=this.texture(width,image.height), resized=this.texture(width,height);
      await this.run(1,image,horizontal,{axis:0});this.release(image);
      await this.run(1,horizontal,resized,{axis:1});this.release(horizontal);image=resized;
    }
    if(job.finishing.sharpening!=="off"){
      const signal=this.texture(width,height);await this.run(2,image,signal,{hdr});
      const fine=await this.blur(signal,1),medium=await this.blur(fine,2),packed=this.texture(width,height);
      await this.run(6,fine,packed,{fine:medium});this.release(medium);
      const absolute=this.texture(width,height);await this.run(4,signal,absolute,{fine});this.release(fine);
      const residual=await this.blur(absolute,1);this.release(absolute);
      const sharp=this.texture(width,height);const strength=job.finishing.sharpening;
      await this.run(5,image,sharp,{hdr,fine:signal,medium:packed,residual,
        amounts:{subtle:[.22,.08],standard:[.38,.14],strong:[.58,.22]}[strength],allowance:strength==="strong"?.18:.12});
      for(const texture of [image,signal,packed,residual])this.release(texture);image=sharp;
    }
    const clipped=this.texture(width,height);await this.run(7,image,clipped,{hdr});this.release(image);image=clipped;
    const gpu=this.gpu,P=window.HDRGpuParamLayout.indices,params=new Float32Array(job.params);
    params[P.TILE_VALID_WIDTH]=width;params[P.TILE_VALID_HEIGHT]=height;
    params[P.TILE_ORIGIN_X]=0;params[P.TILE_ORIGIN_Y]=0;params[P.FRAME_WIDTH]=width;params[P.FRAME_HEIGHT]=height;
    // Re-measure the delivered film, including resize and sharpening, before
    // the shared limiter (Peak Fit must not use Grade's estimate).
    if(hdr && params[P.HIGHLIGHT_MODE]===1 && job.adjustments.hdr.highlight_compression_peak_measurement!=="manual"){
      const pipeline=await gpu.ensurePeakReductionPipeline("finishedPeakReductionMain");
      params[P.HIGHLIGHT_ANCHOR]=await gpu.runPeakReduction(pipeline,image,width,height,params,
        job.adjustments.hdr.highlight_compression_peak_measurement,`${job.id}:${lane}:delivery`);
    }
    const finished=this.texture(width,height);
    const buffer=gpu.createStorageBuffer(params);this.device.queue.writeBuffer(buffer,0,params);
    const pipeline=await this.device.createRenderPipelineAsync({layout:gpu.pipelineLayout,
      vertex:{module:gpu.module,entryPoint:"vertexMain"},fragment:{module:gpu.module,entryPoint:"outputPictureFragmentMain",targets:[{format:"rgba32float"}]},primitive:{topology:"triangle-list"}});
    const dummy=this.texture(1,1,"rgba16float");
    const bind=gpu.bindGraphResources(image.createView(),dummy.createView(),{buffer},dummy.createView());
    try{
      const rows=this.strip(width);
      for(let row=0;row<height;row+=rows){await this.permit();const encoder=this.device.createCommandEncoder();
        const pass=encoder.beginRenderPass({colorAttachments:[{view:finished.createView(),loadOp:row?"load":"clear",storeOp:"store"}]});
        pass.setScissorRect(0,row,width,Math.min(rows,height-row));pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
        this.device.queue.submit([encoder.finish()]);await gpu.waitForSubmittedWork();}
    }finally{buffer.destroy();this.release(image);this.release(dummy);}
    return finished;
  }
  async read(texture){
    const width=texture.width,height=texture.height,stride=Math.ceil(width*16/256)*256;
    const output=new Float32Array(width*height*4);
    const rows=Math.max(1,Math.min(128,Math.floor(this.device.limits.maxBufferSize/stride)));
    const buffer=this.device.createBuffer({size:stride*rows,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{for(let row=0;row<height;row+=rows){await this.permit();const count=Math.min(rows,height-row),encoder=this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture,origin:[0,row]},{buffer,bytesPerRow:stride},[width,count]);this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);const mapped=new Float32Array(buffer.getMappedRange());
      for(let y=0;y<count;y++)output.set(mapped.subarray(y*stride/4,y*stride/4+width*4),(row+y)*width*4);
      buffer.unmap();}
    }finally{buffer.destroy();this.release(texture);}return output;
  }
};
