(function () {
  'use strict';
  // Rounded bounded bitmaps and native Shift regions. Native peak reduction
  // scans the full painted field; normalization is never inferred per tile.
  const EXTRA = `
    @group(1) @binding(0) var paintedMaximum:texture_2d<f32>;
    @group(1) @binding(1) var blurredMaximum:texture_2d<f32>;
    fn brushPosition(i:i32,length:f32,factor:f32)->f32 {
      let count=i32(ceil(length/factor));
      if(i==0){return .5/factor-.5;}
      if(i==count+1){return (length-.5)/factor-.5;}
      return (f32(i-1)+min(f32(i),length/factor))*.5-.5;
    }
    @fragment fn brushCoarse(input:VertexOut)->@location(0) vec4f {
      let size=vec2i(textureDimensions(sourceTexture));let at=vec2i(input.position.xy);let factor=i32(p[0]);
      let count=(size+factor-1)/factor;
      var first=(at-1)*factor;var last=min(first+factor,size);
      if(at.x==0){first.x=0;last.x=1;}if(at.y==0){first.y=0;last.y=1;}
      if(at.x==count.x+1){first.x=size.x-1;last.x=size.x;}
      if(at.y==count.y+1){first.y=size.y-1;last.y=size.y;}
      var sum=0.0;for(var y=first.y;y<last.y;y++){for(var x=first.x;x<last.x;x++){sum+=textureLoad(sourceTexture,vec2i(x,y),0).r;}}
      return vec4f(vec3f(sum/f32((last.x-first.x)*(last.y-first.y))),1.0);
    }
    @fragment fn brushFractionalBox(input:VertexOut)->@location(0) vec4f {
      let at=vec2i(input.position.xy);let vertical=p[1]>.5;let length=select(p[2],p[3],vertical);
      let factor=p[0];let count=i32(ceil(length/factor));let half=p[4];
      let center=brushPosition(select(at.x,at.y,vertical),length,factor);
      var sum=0.0;for(var i=0;i<count+2;i++){
        var left=f32(i-1)-.5;var right=min(f32(i),length/factor)-.5;
        if(i==0){left=-.5-half-2.0;right=-.5;}
        if(i==count+1){left=length/factor-.5;right=left+half+2.0;}
        let weight=max(0.0,min(right,center+half)-max(left,center-half));
        sum+=weight*textureLoad(sourceTexture,select(vec2i(i,at.y),vec2i(at.x,i),vertical),0).r;
      }
      return vec4f(vec3f(sum/(2.0*half)),1.0);
    }
    fn brushTap(pixel:f32,length:f32,factor:f32)->vec2f {
      let position=(pixel+.5)/factor-.5;let count=i32(ceil(length/factor));var lower=0;
      for(var i=1;i<count+1;i++){if(brushPosition(i,length,factor)<=position){lower=i;}}
      let left=brushPosition(lower,length,factor);let right=brushPosition(lower+1,length,factor);
      return vec2f(f32(lower),clamp((position-left)/max(right-left,1e-9),0.0,1.0));
    }
    @fragment fn brushExpand(input:VertexOut)->@location(0) vec4f {
      let at=vec2i(input.position.xy);let x=brushTap(f32(at.x),p[1],p[0]);let y=brushTap(f32(at.y),p[2],p[0]);
      let origin=vec2i(i32(x.x),i32(y.x));
      let top=mix(textureLoad(sourceTexture,origin,0).r,textureLoad(sourceTexture,origin+vec2i(1,0),0).r,x.y);
      let bottom=mix(textureLoad(sourceTexture,origin+vec2i(0,1),0).r,textureLoad(sourceTexture,origin+vec2i(1,1),0).r,x.y);
      return vec4f(vec3f(clamp(mix(top,bottom,y.y),0.0,1.0)),1.0);
    }
    @fragment fn brushBox(input: VertexOut) -> @location(0) vec4f {
      let size=vec2i(textureDimensions(sourceTexture));
      let at=vec2i(input.position.xy);let radius=i32(p[0]);
      var sum=0.0;
      for(var i=-radius;i<=radius;i++) {
        let offset=select(vec2i(i,0),vec2i(0,i),p[1]>0.5);
        sum+=textureLoad(sourceTexture,clamp(at+offset,vec2i(0),size-1),0).r;
      }
      return vec4f(vec3f(sum/f32(2*radius+1)),1.0);
    }
    @fragment fn brushMaximum(input: VertexOut) -> @location(0) vec4f {
      let size=vec2i(textureDimensions(sourceTexture));let at=vec2i(input.position.xy);
      let vertical=p[0]>0.5;let count=select(size.x,size.y,vertical);
      var value=0.0;
      for(var i=0;i<count;i++) {
        value=max(value,textureLoad(sourceTexture,select(vec2i(i,at.y),vec2i(0,i),vertical),0).r);
      }
      return vec4f(vec3f(value),1.0);
    }
    @fragment fn brushFinish(input: VertexOut) -> @location(0) vec4f {
      let at=vec2i(input.position.xy);
      let peak=textureLoad(paintedMaximum,vec2i(0),0).r;
      let blurPeak=textureLoad(blurredMaximum,vec2i(0),0).r;
      let gain=select(0.0,peak/max(blurPeak,1e-30),blurPeak>0.0);
      var value=clamp(textureLoad(sourceTexture,at,0).r*gain,0.0,peak);
      if(p[0]>0.5){value=1.0-value;}
      value*=textureLoad(operandTexture,at,0).r;
      if(p[1]<0.5){value=0.0;}
      value=round(clamp(value,0.0,1.0)*255.0)/255.0;
      return vec4f(vec3f(value),1.0);
    }
    @fragment fn brushNormalize(input:VertexOut)->@location(0) vec4f {
      let peak=textureLoad(paintedMaximum,vec2i(0),0).r;
      return vec4f(vec3f(textureLoad(sourceTexture,vec2i(input.position.xy),0).r/max(peak,1e-30)),1.0);
    }
    @fragment fn brushShift(input: VertexOut) -> @location(0) vec4f {
      let at=vec2i(input.position.xy);
      let peak=textureLoad(paintedMaximum,vec2i(0),0).r;
      let threshold=select(.841345,.158655,p[0]>0.0);
      let shifted=smoothstep(threshold-.035,threshold+.035,
        textureLoad(sourceTexture,at,0).r/select(max(peak,1e-30),1.0,p[1]>.5))*peak;
      let original=textureLoad(operandTexture,at,0).r;
      let value=select(min(original,shifted),max(original,shifted),p[0]>0.0);
      return vec4f(vec3f(value),1.0);
    }`;
  const evenRound=n=>{const a=Math.floor(n),f=n-a;return f===.5 ? a+(a%2) : Math.round(n);};
  // Convert half-float mask readbacks through a byte table. Computing an
  // exponent per texel dominated packing of the larger qualification retry.
  const halfBytes=new Uint8Array(65536);
  for(let word=0;word<32768;word++){
    const exponent=(word>>10)&31,mantissa=word&1023;
    const value=exponent?(1+mantissa/1024)*2**(exponent-15):mantissa*2**-24;
    halfBytes[word]=Math.round(Math.min(1,value)*255);
  }
  function plan(expression,width,height,signature) {
    const leaf=expression?.leaf;
    if(expression?.operator!=='leaf'||leaf?.type!=='brush'
      || (!Number(leaf.mask_shift_edge)&&!Number(leaf.mask_feather)))return null;
    const spatial={...expression,leaf:{...leaf,mask_feather:0,mask_shift_edge:0}};
    let geometry;try{geometry=JSON.parse(signature);}catch{return null;}
    const crop=geometry.crop||{x:0,y:0,width:1,height:1};
    const rasterSignature=JSON.stringify({...geometry,crop:{x:0,y:0,width:1,height:1}});
    if(!window.HDRMaskRaster.eligible(spatial,rasterSignature)||Math.max(width,height)>3200)return null;
    const left=Math.min(width-1,Math.max(0,evenRound((crop.x||0)*width)));
    const top=Math.min(height-1,Math.max(0,evenRound((crop.y||0)*height)));
    const right=Math.min(width,Math.max(left+1,evenRound(((crop.x||0)+(crop.width??1))*width)));
    const bottom=Math.min(height,Math.max(top+1,evenRound(((crop.y||0)+(crop.height??1))*height)));
    const sigma=.18*Math.pow(Math.min(1,leaf.mask_feather/.05),.75)*Math.max(width,height);
    let lower=Math.max(1,Math.floor(Math.sqrt(2*sigma*sigma+1)));
    if(!(lower%2))lower=Math.max(1,lower-1);
    const count=Math.max(0,Math.min(6,evenRound((12*sigma*sigma-6*lower*lower-24*lower-18)/(-4*lower-4))));
    const radii=Array.from({length:6},(_,i)=>(lower+(i<count?0:2)-1)/2);
    const shiftSigma=Math.abs(Number(leaf.mask_shift_edge)||0)*Math.max(width,height);
    let shiftLower=Math.max(1,Math.floor(Math.sqrt(2*shiftSigma*shiftSigma+1)));
    if(!(shiftLower%2))shiftLower=Math.max(1,shiftLower-1);
    const shiftCount=Math.max(0,Math.min(6,evenRound((12*shiftSigma*shiftSigma-6*shiftLower*shiftLower-24*shiftLower-18)/(-4*shiftLower-4))));
    const shiftRadii=shiftSigma<.25?[]:Array.from({length:6},(_,i)=>(shiftLower+(i<shiftCount?0:2)-1)/2);
    let factor=Math.floor(Math.min(sigma/16,32));
    if(factor<2||Math.min(width,height)<2*factor)factor=1;
    const variance=radii.reduce((sum,r)=>sum+((2*r+1)**2-1)/12,0);
    const own=(1-1/(factor*factor))/12+1/6;
    return {spatial,rasterSignature,crop:{x:left,y:top,width:right-left,height:bottom-top},
      shiftRadii,radii:sigma<.25?[]:radii,factor,halfWidth:Math.sqrt(3*Math.max(variance/(factor*factor)-own,1e-6)/6)};
  }
  function ensurePipelines(renderer) {
    const d=renderer.device;
    if(renderer.brushPipelineDevice!==d)renderer.brushPipelines=null;
    renderer.brushPipelines ||= (()=>{
      const module=d.createShaderModule({code:window.HDRWebGPUShaders.LUMA_MASK_SHADER_SOURCE+EXTRA});
      const peakLayout=d.createBindGroupLayout({entries:[0,1].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,
        texture:{sampleType:'unfilterable-float'}}))});
      const finishLayout=d.createPipelineLayout({bindGroupLayouts:[renderer.maskBindGroupLayout,peakLayout]});
      const pipeline=(entryPoint,format='r32float',layout=renderer.maskPipelineLayout)=>d.createRenderPipeline({layout,
        vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint,targets:[{format}]},primitive:{topology:'triangle-list'}});
      return {paint:pipeline('brushPaintFragmentMain'),erase:pipeline('brushEraseFragmentMain'),
        box:pipeline('brushBox'),coarse:pipeline('brushCoarse'),fractional:pipeline('brushFractionalBox'),expand:pipeline('brushExpand'),
        normalize:pipeline('brushNormalize','r32float',finishLayout),maximum:pipeline('brushMaximum'),shift:pipeline('brushShift','r32float',finishLayout),
        finish:pipeline('brushFinish','r16float',finishLayout),peakLayout};
    })();
    renderer.brushPipelineDevice=d;
  }
  async function generate(renderer,expression,width,height,signature,isCurrent=()=>true) {
    const recipe=plan(expression,width,height,signature);if(!recipe||!isCurrent())return null;
    const started=performance.now(),timings={};
    const d=renderer.device,temporary=[],buffers=[];
    const texture=(w,h,format='r32float')=>{
      const t=d.createTexture({size:[w,h],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
      temporary.push(t);return t;
    };
    ensurePipelines(renderer);
    const pass=(encoder,pipeline,input,target,values,operand=input,extra=null)=>{
      const buffer=renderer.createStorageBuffer(values);buffers.push(buffer);d.queue.writeBuffer(buffer,0,values);
      const bindGroup=renderer.createMaskBindGroup(input,buffer,operand);
      if(!extra){renderer.encodeMaskPass(encoder,pipeline,bindGroup,target);return;}
      const render=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),
        clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});
      render.setPipeline(pipeline);render.setBindGroup(0,bindGroup);render.setBindGroup(1,extra);render.draw(3);render.end();
    };
    const read=async(t,w,h)=>{
      const stride=Math.ceil(w*2/256)*256;
      const buffer=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const encoder=d.createCommandEncoder();encoder.copyTextureToBuffer({texture:t},{buffer,bytesPerRow:stride},[w,h]);d.queue.submit([encoder.finish()]);
      const submitted=performance.now();
      try{await buffer.mapAsync(GPUMapMode.READ);timings.gpuReadbackWaitMs=performance.now()-submitted;
        const packed=performance.now(),bytes=buffer.getMappedRange();
        const words=new Uint16Array(bytes),result=new Uint8Array(w*h);
        for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
          result[y*w+x]=halfBytes[words[y*stride/2+x]];
        }
        timings.packMs=performance.now()-packed;
        return result;
      }finally{buffer.destroy();}
    };
    try {
      const paint=texture(width,height),erase=texture(width,height),a=texture(width,height),b=texture(width,height);
      const values=window.HDRMaskRaster.parameters(recipe.spatial,{x:0,y:0,width,height},width,height,recipe.rasterSignature);
      if(!values)return null;
      let encoder=d.createCommandEncoder();
      pass(encoder,renderer.brushPipelines.paint,a,paint,values);
      pass(encoder,renderer.brushPipelines.erase,a,erase,values);
      const row=texture(1,height),paintPeak=texture(1,1),blurPeak=texture(1,1);
      let painted=paint;
      if(recipe.shiftRadii.length){
        pass(encoder,renderer.brushPipelines.maximum,paint,row,new Float32Array([0]));
        pass(encoder,renderer.brushPipelines.maximum,row,paintPeak,new Float32Array([1]));
        let shiftedBlur=paint,target=a;
        for(const axis of [0,1])for(const radius of recipe.shiftRadii)if(radius){
          pass(encoder,renderer.brushPipelines.box,shiftedBlur,target,new Float32Array([radius,axis]));
          shiftedBlur=target;target=target===a?b:a;
        }
        painted=texture(width,height);
        const shiftMaxima=d.createBindGroup({layout:renderer.brushPipelines.peakLayout,entries:[
          {binding:0,resource:paintPeak.createView()},{binding:1,resource:paintPeak.createView()}]});
        pass(encoder,renderer.brushPipelines.shift,shiftedBlur,painted,
          new Float32Array([expression.leaf.mask_shift_edge,0]),paint,shiftMaxima);
      }
      let blurred=painted,next=a;
      if(recipe.factor>1){
        const factor=recipe.factor,w=Math.ceil(width/factor)+2,h=Math.ceil(height/factor)+2;
        const ca=texture(w,h),cb=texture(w,h);
        pass(encoder,renderer.brushPipelines.coarse,painted,ca,new Float32Array([factor]));
        blurred=ca;next=cb;
        for(const axis of [0,1])for(let i=0;i<6;i++){
          pass(encoder,renderer.brushPipelines.fractional,blurred,next,new Float32Array([factor,axis,width,height,recipe.halfWidth]));
          blurred=next;next=next===ca?cb:ca;
        }
        pass(encoder,renderer.brushPipelines.expand,blurred,a,new Float32Array([factor,width,height]));blurred=a;
      }else for(const axis of [0,1])for(const radius of recipe.radii)if(radius) {
        pass(encoder,renderer.brushPipelines.box,blurred,next,new Float32Array([radius,axis]));
        blurred=next;next=next===a?b:a;
      }
      pass(encoder,renderer.brushPipelines.maximum,painted,row,new Float32Array([0]));
      pass(encoder,renderer.brushPipelines.maximum,row,paintPeak,new Float32Array([1]));
      pass(encoder,renderer.brushPipelines.maximum,blurred,row,new Float32Array([0]));
      pass(encoder,renderer.brushPipelines.maximum,row,blurPeak,new Float32Array([1]));
      let result=texture(width,height,'r16float');
      const maxima=d.createBindGroup({layout:renderer.brushPipelines.peakLayout,entries:[
        {binding:0,resource:paintPeak.createView()},{binding:1,resource:blurPeak.createView()}]});
      pass(encoder,renderer.brushPipelines.finish,blurred,result,new Float32Array([
        expression.inverted?1:0,expression.enabled===false?0:1]),erase,maxima);
      const crop=recipe.crop;
      if(crop.x||crop.y||crop.width!==width||crop.height!==height){
        const cropped=texture(crop.width,crop.height,'r16float');
        encoder.copyTextureToTexture({texture:result,origin:[crop.x,crop.y]},
          {texture:cropped},[crop.width,crop.height]);result=cropped;
      }
      d.queue.submit([encoder.finish()]);
      timings.prepareEncodeMs=performance.now()-started;
      const bitmap=await read(result,crop.width,crop.height);
      if(!isCurrent())return null;
      temporary.splice(temporary.indexOf(result),1);
      return {texture:result,bitmap,width:crop.width,height:crop.height,
        byteSize:crop.width*crop.height*2,kind:'gpu-brush-feather',timings};
    }finally {
      // Queue completion precedes release even on cancellation or validation
      // errors. Scratch never belongs to the native editing-Peak allocator.
      await d.queue.onSubmittedWorkDone().catch(()=>{});
      temporary.forEach(t=>t.destroy());buffers.forEach(buffer=>buffer.destroy());
    }
  }
  // Native Shift is never stretched from a qualified soft bitmap. Its peak
  // includes every painted pixel, scanned in bounded bands, before filtering
  // the viewport plus the complete finite support of all twelve box passes.
  // Export derives sigma from the rounded full-frame source grid steps.
  const nativeSigma=(radius,width,height)=>{
    const f=Math.fround,step=n=>f(f(1.5/n)-f(.5/n));
    return Math.min(2048,Math.max(0,radius)/Math.min(step(width),step(height)));
  };
  const featherRadius=value=>.18*Math.pow(Math.min(1,Math.max(0,Number(value)||0)/.05),.75);
  const boxRadii=sigma=>{
    let lower=Math.max(1,Math.floor(Math.sqrt(2*sigma*sigma+1)));
    if(!(lower%2))lower=Math.max(1,lower-1);
    const count=Math.max(0,Math.min(6,evenRound((12*sigma*sigma-6*lower*lower-24*lower-18)/(-4*lower-4))));
    return Array.from({length:6},(_,i)=>(lower+(i<count?0:2)-1)/2);
  };
  function shiftRegionPlan(expression,width,height,signature,rect,limit=8192) {
    const leaf=expression?.leaf;
    if(!Number(leaf?.mask_shift_edge)||width<2||height<2)return null;
    // Export leaves the mask untouched below a quarter-pixel feather.
    if(nativeSigma(featherRadius(leaf.mask_feather),width,height)>=.25)return null;
    const spatial={...expression,leaf:{...leaf,mask_feather:0,mask_shift_edge:0}};
    if(!window.HDRMaskRaster.eligible(spatial,signature))return null;
    const sigma=nativeSigma(Math.abs(leaf.mask_shift_edge),width,height);
    if(sigma<.25)return null;
    const radii=boxRadii(sigma);
    const reach=radii.reduce((a,b)=>a+b,0);
    const x=Math.max(0,rect.x-reach),y=Math.max(0,rect.y-reach);
    const right=Math.min(width,rect.x+rect.width+reach),bottom=Math.min(height,rect.y+rect.height+reach);
    const region={x,y,width:right-x,height:bottom-y};
    // Scratch cap is an admission guard, not a relaxed accuracy limit.
    if(!(rect.width>0&&rect.height>0)||region.width>limit||region.height>limit||region.width*region.height>16777216
      ||width>limit||rect.x<0||rect.y<0||rect.x+rect.width>width||rect.y+rect.height>height)return null;
    return {spatial,radii,region,rect,width,height,signature};
  }
  const PREFIX=`
    @group(0) @binding(0) var source:texture_2d<f32>;
    @group(0) @binding(1) var destination:texture_storage_2d<r32float,write>;
    @group(0) @binding(2) var<storage,read_write> sums:array<f32>;
    @group(0) @binding(3) var<uniform> settings:vec4u;
    @compute @workgroup_size(64) fn prefix(@builtin(global_invocation_id) id:vec3u) {
      let size=textureDimensions(source);let vertical=settings.y!=0u;
      let length=select(size.x,size.y,vertical);let lines=select(size.y,size.x,vertical);
      if(id.x>=lines){return;}let radius=settings.x;let stride=length+2u*radius+1u;
      let offset=id.x*stride;var sum=0.0;sums[offset]=0.0;
      for(var i=0u;i<length+2u*radius;i++){
        let index=clamp(i32(i)-i32(radius),0,i32(length)-1);
        sum+=textureLoad(source,select(vec2i(index,i32(id.x)),vec2i(i32(id.x),index),vertical),0).r;
        sums[offset+i+1u]=sum;
      }
    }
    @compute @workgroup_size(8,8) fn box(@builtin(global_invocation_id) id:vec3u) {
      let size=textureDimensions(source);if(any(id.xy>=size)){return;}
      let vertical=settings.y!=0u;let length=select(size.x,size.y,vertical);
      let index=select(id.x,id.y,vertical);let line=select(id.y,id.x,vertical);
      let radius=settings.x;let width=2u*radius+1u;let offset=line*(length+2u*radius+1u)+index;
      textureStore(destination,vec2i(id.xy),vec4f((sums[offset+width]-sums[offset])/f32(width)));
    }`;
  function nativeBrushParameters(expression,rect,width,height,signature) {
    const values=window.HDRMaskRaster.parameters(expression,{x:0,y:0,width,height},width,height,signature);
    if(!values)return null;
    // A stroke wholly outside the frame is omitted from the packed list.
    if(values[7]!==(expression.leaf.strokes||[]).filter(stroke=>stroke.points?.length).length)return null;
    values[1]=rect.x;values[2]=rect.y;
    const w=values[3],h=values[4],f=Math.fround;
    const originX=f(.5/w),originY=f(.5/h);
    const scaleY=f(f(1.5/w)-originX)/f(f(1.5/h)-originY);
    const point=p=>[p.x-originX,(p.y-originY)*scaleY];
    let cursor=10;
    for(const stroke of expression.leaf.strokes||[]){
      const points=stroke.points||[];if(!points.length)continue;
      const segments=points.length===1?[[points[0],points[0]]]:points.slice(1).map((p,i)=>[points[i],p]);
      cursor+=10;
      for(const [a,b] of segments){const first=point(a),last=point(b);values.set([...first,last[0]-first[0],last[1]-first[1]],cursor);cursor+=5;}
    }
    return new Float32Array([...values,originX,originY,scaleY,scaleY-f(scaleY)]);
  }
  async function generateShiftRegion(renderer,expression,width,height,signature,rect,isCurrent=()=>true) {
    const recipe=shiftRegionPlan(expression,width,height,signature,rect,renderer.device.limits.maxTextureDimension2D);
    if(!recipe||!isCurrent())return null;
    const d=renderer.device,temporary=[],buffers=[],started=performance.now();
    const texture=(w,h,format='r32float')=>{const t=d.createTexture({size:[w,h],format,usage:
      GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST
      |(format==='r32float'?GPUTextureUsage.STORAGE_BINDING:0)});temporary.push(t);return t;};
    if(!ensureNativePipelines(renderer))return null;
    const pass=(encoder,pipeline,input,target,values,operand=input,extra=null)=>{
      const buffer=renderer.createStorageBuffer(values);buffers.push(buffer);d.queue.writeBuffer(buffer,0,values);
      const bind=renderer.createMaskBindGroup(input,buffer,operand);
      if(!extra){renderer.encodeMaskPass(encoder,pipeline,bind,target);return;}
      const render=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
      render.setPipeline(pipeline);render.setBindGroup(0,bind);render.setBindGroup(1,extra);render.draw(3);render.end();
    };
    try{
      const bandHeight=Math.min(256,height),bands=Math.ceil(height/bandHeight);
      const band=texture(width,bandHeight),rows=texture(1,bandHeight),peak=texture(1,1),peaks=texture(1,bands);
      for(let i=0;i<bands;i++){
        if(!isCurrent())return null;
        const y=i*bandHeight,h=Math.min(bandHeight,height-y);
        const values=nativeBrushParameters(recipe.spatial,{x:0,y,width,height:h},width,height,signature);
        if(!values)return null;
        // Stroke bounds clip to the physical frame; unused rows in a short
        // final band are zero and cannot introduce a larger painted peak.
        const encoder=d.createCommandEncoder();
        pass(encoder,renderer.brushPipelines.nativePaint,rows,band,values);
        pass(encoder,renderer.brushPipelines.maximum,band,rows,new Float32Array([0]));
        pass(encoder,renderer.brushPipelines.maximum,rows,peak,new Float32Array([1]));
        encoder.copyTextureToTexture({texture:peak},{texture:peaks,origin:[0,i]},[1,1]);
        d.queue.submit([encoder.finish()]);
        await d.queue.onSubmittedWorkDone();
      }
      if(!isCurrent())return null;
      const r=recipe.region,paint=texture(r.width,r.height),erase=texture(r.width,r.height),a=texture(r.width,r.height),b=texture(r.width,r.height);
      const encoder=d.createCommandEncoder();
      pass(encoder,renderer.brushPipelines.maximum,peaks,peak,new Float32Array([1]));
      const maxima=d.createBindGroup({layout:renderer.brushPipelines.peakLayout,entries:[0,1].map(binding=>({binding,resource:peak.createView()}))});
      const values=nativeBrushParameters(recipe.spatial,r,width,height,signature);
      if(!values)return null;
      pass(encoder,renderer.brushPipelines.nativePaint,a,paint,values);
      pass(encoder,renderer.brushPipelines.nativeErase,a,erase,values);
      pass(encoder,renderer.brushPipelines.normalize,paint,a,new Float32Array([0]),paint,maxima);
      const scratchBytes=prefixScratchBytes(r,recipe.radii);
      if(scratchBytes>d.limits.maxStorageBufferBindingSize)return null;
      const scratch=d.createBuffer({size:scratchBytes,usage:GPUBufferUsage.STORAGE});buffers.push(scratch);
      const [input,target]=boxPasses(renderer,encoder,a,b,recipe.radii,r,scratch,buffers);
      pass(encoder,renderer.brushPipelines.shift,input,target,new Float32Array([expression.leaf.mask_shift_edge,1]),paint,maxima);
      const finished=texture(r.width,r.height,'r16float'),result=texture(rect.width,rect.height,'r16float');
      pass(encoder,renderer.brushPipelines.finish,target,finished,new Float32Array([expression.inverted?1:0,expression.enabled===false?0:1]),erase,maxima);
      encoder.copyTextureToTexture({texture:finished,origin:[rect.x-r.x,rect.y-r.y]},{texture:result},[rect.width,rect.height]);
      d.queue.submit([encoder.finish()]);await d.queue.onSubmittedWorkDone();
      if(!isCurrent())return null;
      temporary.splice(temporary.indexOf(result),1);
      return {texture:result,width:rect.width,height:rect.height,byteSize:rect.width*rect.height*2,
        kind:'gpu-brush-native-shift',timings:{gpuPrepareMs:performance.now()-started},scratchRegion:r};
    }finally{await d.queue.onSubmittedWorkDone().catch(()=>{});temporary.forEach(t=>t.destroy());buffers.forEach(b=>b.destroy());}
  }
  const prefixScratchBytes=(r,radii)=>{
    const radius=Math.max(0,...radii);
    return Math.max(r.height*(r.width+2*radius+1),r.width*(r.height+2*radius+1))*4;
  };
  // Six horizontal then six vertical float32 prefix boxes, as export orders them.
  function boxPasses(renderer,encoder,input,target,radii,r,scratch,buffers) {
    const d=renderer.device,pipelines=renderer.brushPrefix;
    for(const axis of [0,1])for(const radius of radii)if(radius){
      const settings=d.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(settings);
      d.queue.writeBuffer(settings,0,new Uint32Array([radius,axis,0,0]));
      const bind=d.createBindGroup({layout:pipelines.prefix.getBindGroupLayout(0),entries:[
        {binding:0,resource:input.createView()},{binding:1,resource:target.createView()},{binding:2,resource:{buffer:scratch}},{binding:3,resource:{buffer:settings}}]});
      for(const [pipeline,x,y] of [[pipelines.prefix,Math.ceil((axis?r.width:r.height)/64),1],[pipelines.box,Math.ceil(r.width/8),Math.ceil(r.height/8)]]){
        const compute=encoder.beginComputePass();compute.setPipeline(pipeline);compute.setBindGroup(0,bind);compute.dispatchWorkgroups(x,y);compute.end();
      }
      [input,target]=[target,input];
    }
    return [input,target];
  }
  function ensureNativePipelines(renderer) {
    const d=renderer.device;
    ensurePipelines(renderer);
    if(!renderer.brushPipelines.nativePaint){
      const source=window.HDRWebGPUShaders.LUMA_MASK_SHADER_SOURCE;
      if(!source.includes('let delta = last - first;')||!source.includes('let point = pixel / p[3];'))return false;
      // This module follows export's native display metric; the qualified
      // rounded bitmap pipelines above retain their original raster.
      const code=source
        .replace('let delta = last - first;','let delta = last;')
        .replace('let point = pixel / p[3];',`
        let tail=arrayLength(&p)-4u;
        let normY=maskDivide(pixel.y,p[4]);let originY=p[tail+1u];
        let deltaY=normY-originY;let back=deltaY-normY;
        let deltaLow=(normY-(deltaY-back))-(originY+back);
        let product=deltaY*p[tail+2u];
        let residual=fma(deltaY,p[tail+2u],-product)+deltaLow*p[tail+2u]+deltaY*p[tail+3u];
        let point=vec2f(maskDivide(pixel.x,p[3])-p[tail],product+residual);`);
      const module=d.createShaderModule({code});
      for(const [key,entryPoint] of [['nativePaint','brushPaintFragmentMain'],['nativeErase','brushEraseFragmentMain']]){
        renderer.brushPipelines[key]=d.createRenderPipeline({layout:renderer.maskPipelineLayout,
          vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint,targets:[{format:'r32float'}]},primitive:{topology:'triangle-list'}});
      }
    }
    if(renderer.brushPrefixDevice!==d){
      const module=d.createShaderModule({code:PREFIX});
      const bindLayout=d.createBindGroupLayout({entries:[
        {binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}},
        {binding:1,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32float'}},
        {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
        {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
      const layout=d.createPipelineLayout({bindGroupLayouts:[bindLayout]});
      const prefix=d.createComputePipeline({layout,compute:{module,entryPoint:'prefix'}});
      const box=d.createComputePipeline({layout,compute:{module,entryPoint:'box'}});
      renderer.brushPrefix={prefix,box};renderer.brushPrefixDevice=d;
    }
    if(!renderer.brushPipelines.bandMaximum){
      const module=d.createShaderModule({code:window.HDRWebGPUShaders.LUMA_MASK_SHADER_SOURCE+EXTRA+NATIVE});
      for(const [key,entryPoint] of [['bandMaximum','brushBandMaximum'],['coarseBand','brushCoarseBand'],
        ['fractionalWindow','brushFractionalBoxWindow'],['expandWindow','brushExpandWindow']]){
        renderer.brushPipelines[key]=d.createRenderPipeline({layout:renderer.maskPipelineLayout,
          vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint,targets:[{format:'r32float'}]},primitive:{topology:'triangle-list'}});
      }
    }
    return true;
  }
  // Native Feather follows export's reduced grid over the uncropped frame.
  // Windowed loops visit the same nonzero terms, in the same order, as the
  // rounded producer's whole-line loops; only zero-weight cells are skipped.
  const NATIVE=`
    @fragment fn brushBandMaximum(input:VertexOut)->@location(0) vec4f {
      let y=i32(input.position.y);var value=0.0;
      if(y>=i32(p[0])&&y<i32(p[1])){
        for(var x=i32(p[2]);x<i32(p[3]);x++){value=max(value,textureLoad(sourceTexture,vec2i(x,y),0).r);}
      }
      return vec4f(vec3f(clamp(value,0.0,1.0)),1.0);
    }
    @fragment fn brushCoarseBand(input:VertexOut)->@location(0) vec4f {
      let frame=vec2i(i32(p[1]),i32(p[2]));let origin=vec2i(i32(p[3]),i32(p[4]));
      let size=vec2i(textureDimensions(sourceTexture));let at=vec2i(input.position.xy);let factor=i32(p[0]);
      let count=(frame+factor-1)/factor;
      var first=(at-1)*factor;var last=min(first+factor,frame);
      if(at.x==0){first.x=0;last.x=1;}if(at.y==0){first.y=0;last.y=1;}
      if(at.x==count.x+1){first.x=frame.x-1;last.x=frame.x;}
      if(at.y==count.y+1){first.y=frame.y-1;last.y=frame.y;}
      // Pixels outside the banded field lie beyond the shifted paint: zero.
      let begin=max(first-origin,vec2i(0));let end=min(last-origin,size);
      var sum=0.0;for(var y=begin.y;y<end.y;y++){for(var x=begin.x;x<end.x;x++){sum+=textureLoad(sourceTexture,vec2i(x,y),0).r;}}
      return vec4f(vec3f(sum/f32((last.x-first.x)*(last.y-first.y))),1.0);
    }
    fn brushCellWeight(i:i32,count:i32,length:f32,factor:f32,center:f32,half:f32)->f32 {
      var left=f32(i-1)-.5;var right=min(f32(i),length/factor)-.5;
      if(i==0){left=-.5-half-2.0;right=-.5;}
      if(i==count+1){left=length/factor-.5;right=left+half+2.0;}
      return max(0.0,min(right,center+half)-max(left,center-half));
    }
    @fragment fn brushFractionalBoxWindow(input:VertexOut)->@location(0) vec4f {
      let at=vec2i(input.position.xy);let vertical=p[1]>.5;let length=select(p[2],p[3],vertical);
      let factor=p[0];let count=i32(ceil(length/factor));let half=p[4];
      let center=brushPosition(select(at.x,at.y,vertical),length,factor);
      let lower=clamp(i32(floor(center-half+.5)),1,count);
      let upper=clamp(i32(floor(center+half+.5))+2,1,count);
      var sum=brushCellWeight(0,count,length,factor,center,half)
        *textureLoad(sourceTexture,select(vec2i(0,at.y),vec2i(at.x,0),vertical),0).r;
      for(var i=lower;i<=upper;i++){
        sum+=brushCellWeight(i,count,length,factor,center,half)
          *textureLoad(sourceTexture,select(vec2i(i,at.y),vec2i(at.x,i),vertical),0).r;
      }
      sum+=brushCellWeight(count+1,count,length,factor,center,half)
        *textureLoad(sourceTexture,select(vec2i(count+1,at.y),vec2i(at.x,count+1),vertical),0).r;
      return vec4f(vec3f(sum/(2.0*half)),1.0);
    }
    fn brushTapWindow(pixel:f32,length:f32,factor:f32)->vec2f {
      let position=(pixel+.5)/factor-.5;let count=i32(ceil(length/factor));
      var lower=clamp(i32(floor(position))+1,0,count);
      for(var i=0;i<4&&lower<count&&brushPosition(lower+1,length,factor)<=position;i++){lower++;}
      for(var i=0;i<4&&lower>0&&brushPosition(lower,length,factor)>position;i++){lower--;}
      let left=brushPosition(lower,length,factor);let right=brushPosition(lower+1,length,factor);
      return vec2f(f32(lower),clamp((position-left)/max(right-left,1e-9),0.0,1.0));
    }
    @fragment fn brushExpandWindow(input:VertexOut)->@location(0) vec4f {
      let at=floor(input.position.xy)+vec2f(p[3],p[4]);
      let x=brushTapWindow(at.x,p[1],p[0]);let y=brushTapWindow(at.y,p[2],p[0]);
      let origin=vec2i(i32(x.x),i32(y.x));
      let top=mix(textureLoad(sourceTexture,origin,0).r,textureLoad(sourceTexture,origin+vec2i(1,0),0).r,x.y);
      let bottom=mix(textureLoad(sourceTexture,origin+vec2i(0,1),0).r,textureLoad(sourceTexture,origin+vec2i(1,1),0).r,x.y);
      return vec4f(vec3f(clamp(mix(top,bottom,y.y),0.0,1.0)),1.0);
    }`;
  // Shift, when present, precedes Feather. A reduced feather returns coarse
  // dimensions; a narrow one keeps export's full-resolution boxes.
  function featherFieldPlan(expression,width,height,signature,limit=8192) {
    const leaf=expression?.leaf;
    if(expression?.operator!=='leaf'||leaf?.type!=='brush'||width<2||height<2||width>limit)return null;
    const sigma=nativeSigma(featherRadius(leaf.mask_feather),width,height);
    if(sigma<.25)return null;
    const spatial={...expression,leaf:{...leaf,mask_feather:0,mask_shift_edge:0}};
    if(!window.HDRMaskRaster.eligible(spatial,signature))return null;
    const shift=Number(leaf.mask_shift_edge)||0,shiftSigma=nativeSigma(Math.abs(shift),width,height);
    const shiftActive=shiftSigma>=.25,shiftRadii=shiftActive?boxRadii(shiftSigma):[];
    const radii=boxRadii(sigma),sum=values=>values.reduce((a,b)=>a+b,0);
    let factor=Math.floor(Math.min(sigma/16,32));
    if(factor<2||Math.min(width,height)<2*factor)factor=1;
    const variance=radii.reduce((total,r)=>total+((2*r+1)**2-1)/12,0);
    const own=(1-1/(factor*factor))/12+1/6;
    return {spatial,shift,shiftActive,shiftRadii,shiftReach:sum(shiftRadii),radii,reach:sum(radii),factor,
      halfWidth:Math.sqrt(3*Math.max(variance/(factor*factor)-own,1e-6)/6),width,height,signature,
      coarse:factor>1?{width:Math.ceil(width/factor)+2,height:Math.ceil(height/factor)+2}:null};
  }
  function featherRegionPlan(expression,width,height,signature,rect,limit=8192) {
    const recipe=featherFieldPlan(expression,width,height,signature,limit);
    if(!recipe||!(rect.width>0&&rect.height>0)||rect.x<0||rect.y<0
      ||rect.x+rect.width>width||rect.y+rect.height>height)return null;
    const halo=recipe.coarse?0:recipe.shiftReach+recipe.reach;
    const x=Math.max(0,rect.x-halo),y=Math.max(0,rect.y-halo);
    const region={x,y,width:Math.min(width,rect.x+rect.width+halo)-x,height:Math.min(height,rect.y+rect.height+halo)-y};
    if(region.width>limit||region.height>limit||region.width*region.height>16777216)return null;
    return {...recipe,region,rect};
  }
  // Output-frame bounds of every painted stroke. Paint is exactly zero beyond
  // them, so the shifted field is zero beyond them plus the Shift reach.
  function paintBounds(values,width,height,signature) {
    const geometry=JSON.parse(signature),rotation=Number(geometry.rotation||0)/90;
    const sourceWidth=values[3],sourceHeight=values[4];
    let cursor=10,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(let i=0;i<values[7];i++){
      if(!(values[cursor+4]>.5)){
        left=Math.min(left,values[cursor+5]);top=Math.min(top,values[cursor+6]);
        right=Math.max(right,values[cursor+7]);bottom=Math.max(bottom,values[cursor+8]);
      }
      cursor+=10+5*values[cursor];
    }
    if(!(right>left&&bottom>top))return null;
    const output=(sx,sy)=>{
      let x=sx,y=sy;
      if(rotation===1){x=sourceHeight-sy;y=sx;}
      else if(rotation===2){x=sourceWidth-sx;y=sourceHeight-sy;}
      else if(rotation===3){x=sy;y=sourceWidth-sx;}
      if(geometry.flip_horizontal)x=width-x;
      if(geometry.flip_vertical)y=height-y;
      return [x,y];
    };
    const a=output(left,top),b=output(right,bottom);
    return {x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),right:Math.max(a[0],b[0]),bottom:Math.max(a[1],b[1])};
  }
  function nativeScratch(renderer,isCurrent) {
    const d=renderer.device,temporary=new Set(),buffers=[];
    const texture=(w,h,format='r32float')=>{const t=d.createTexture({size:[w,h],format,usage:
      GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST
      |(format==='r32float'?GPUTextureUsage.STORAGE_BINDING:0)});temporary.add(t);return t;};
    const draw=(encoder,pipeline,input,target,values,{operand=input,extra=null,scissor=null}={})=>{
      const buffer=renderer.createStorageBuffer(values);buffers.push(buffer);d.queue.writeBuffer(buffer,0,values);
      const render=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),
        loadOp:scissor?'load':'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
      render.setPipeline(pipeline);render.setBindGroup(0,renderer.createMaskBindGroup(input,buffer,operand));
      if(extra)render.setBindGroup(1,extra);
      if(scissor)render.setScissorRect(...scissor);
      render.draw(3);render.end();
    };
    const maxima=(painted,blurred)=>d.createBindGroup({layout:renderer.brushPipelines.peakLayout,entries:[
      {binding:0,resource:painted.createView()},{binding:1,resource:blurred.createView()}]});
    return {d,temporary,buffers,texture,draw,maxima,
      release:(...textures)=>textures.forEach(t=>{if(t&&temporary.delete(t))t.destroy();}),
      // Several bands reuse one scratch set, so each waits for the last. A
      // single band is encoded and submitted without yielding.
      settle:async wait=>{if(wait)await d.queue.onSubmittedWorkDone();return isCurrent();},
      // Queue completion precedes release even on cancellation or errors;
      // the caller does not wait for it.
      dispose:async()=>{await d.queue.onSubmittedWorkDone().catch(()=>{});temporary.forEach(t=>t.destroy());buffers.forEach(b=>b.destroy());}};
  }
  /** Viewport-independent part of native Feather: the blurred coarse grid of
   * the (optionally shifted) full painted field and its three global peaks.
   * Shifted paint is filtered in bounded bands carrying the complete Shift
   * halo; no native-frame texture or CPU mask is allocated. The last texel
   * row holds painted, shifted and blurred peaks for every later viewport.
   */
  async function generateFeatherField(renderer,expression,width,height,signature,isCurrent=()=>true) {
    const limit=renderer.device.limits.maxTextureDimension2D;
    const recipe=featherFieldPlan(expression,width,height,signature,limit);
    if(!recipe||!isCurrent()||!ensureNativePipelines(renderer))return null;
    const base=nativeBrushParameters(recipe.spatial,{x:0,y:0},width,height,signature);
    if(!base)return null;
    const started=performance.now(),pipelines=renderer.brushPipelines,{coarse,factor}=recipe;
    const scratch=nativeScratch(renderer,isCurrent),{d,texture,draw,release,settle,buffers}=scratch;
    const at=(x,y)=>{const values=base.slice();values[1]=x;values[2]=y;return values;};
    let set=null,bands=0;
    try{
      const [paintPeak,sourcePeak,blurPeak,one]=[0,1,2,3].map(()=>texture(1,1));
      let grid=coarse&&texture(coarse.width,coarse.height),spare=coarse&&texture(coarse.width,coarse.height);
      const bounds=paintBounds(base,width,height,signature);
      if(bounds&&recipe.shiftActive){
        // Shift normalizes by the peak of every painted pixel before filtering.
        const w=bounds.right-bounds.x,h=bounds.bottom-bounds.y;
        const rows=Math.max(1,Math.min(h,limit,Math.floor(4194304/w))),count=Math.ceil(h/rows);
        const band=texture(w,rows),line=texture(1,rows),list=texture(1,count);
        for(let i=0;i<count;i++){
          const encoder=d.createCommandEncoder();
          draw(encoder,pipelines.nativePaint,line,band,at(bounds.x,bounds.y+i*rows));
          draw(encoder,pipelines.maximum,band,line,new Float32Array([0]));
          draw(encoder,pipelines.maximum,line,one,new Float32Array([1]));
          encoder.copyTextureToTexture({texture:one},{texture:list,origin:[0,i]},[1,1]);
          if(i===count-1)draw(encoder,pipelines.maximum,list,paintPeak,new Float32Array([1]));
          d.queue.submit([encoder.finish()]);
          if(!await settle(count>1))return null;
        }
        if(count>1)release(band,line,list);
      }
      if(bounds){
        const halo=recipe.shiftReach+(coarse?0:recipe.reach);
        const x0=Math.max(0,bounds.x-halo),x1=Math.min(width,bounds.right+halo);
        const y0=Math.max(0,bounds.y-halo),y1=Math.min(height,bounds.bottom+halo);
        // The scratch cap is an admission guard, not a relaxed accuracy limit.
        let rows=Math.min(Math.floor(16777216/(x1-x0)),limit)-2*halo;
        if(coarse)rows-=rows%factor;
        if(rows<factor)return null;
        const start=coarse?y0-y0%factor:y0,count=Math.ceil((y1-start)/rows);
        const sourceList=texture(1,count),blurList=coarse?null:texture(1,count);
        const paintMaxima=scratch.maxima(paintPeak,paintPeak),filtered=recipe.shiftActive||!coarse;
        for(let v0=start;v0<y1;v0+=rows,bands++){
          const v1=Math.min(v0+rows,height),y=Math.max(y0,v0-halo);
          const r={x:x0,y,width:x1-x0,height:Math.min(y1,v1+halo)-y};
          if(!set||set.width!==r.width||set.height!==r.height){
            // Only a later band replaces a set, after its predecessor settled.
            if(set){release(set.paint,set.a,set.b,set.line);set.scratch?.destroy();}
            set={width:r.width,height:r.height,paint:texture(r.width,r.height),line:texture(1,r.height)};
            if(filtered){
              const bytes=prefixScratchBytes(r,[...recipe.shiftRadii,...(coarse?[]:recipe.radii)]);
              if(bytes>d.limits.maxStorageBufferBindingSize)return null;
              set.a=texture(r.width,r.height);set.b=texture(r.width,r.height);
              set.scratch=d.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE});
            }
          }
          const encoder=d.createCommandEncoder();
          draw(encoder,pipelines.nativePaint,one,set.paint,at(r.x,r.y));
          let field=set.paint,free=set.a;
          if(recipe.shiftActive){
            draw(encoder,pipelines.normalize,set.paint,set.a,new Float32Array([0]),{extra:paintMaxima});
            const [blurred,target]=boxPasses(renderer,encoder,set.a,set.b,recipe.shiftRadii,r,set.scratch,buffers);
            draw(encoder,pipelines.shift,blurred,target,new Float32Array([recipe.shift,1]),{operand:set.paint,extra:paintMaxima});
            field=target;free=blurred;
          }
          // Halo rows of an interior band are incomplete; reduce only its own rows.
          const valid=new Float32Array([Math.max(v0,r.y)-r.y,Math.min(v1,r.y+r.height)-r.y,0,r.width]);
          const reduce=(source,list)=>{
            draw(encoder,pipelines.bandMaximum,source,set.line,valid);
            draw(encoder,pipelines.maximum,set.line,one,new Float32Array([1]));
            encoder.copyTextureToTexture({texture:one},{texture:list,origin:[0,bands]},[1,1]);
          };
          reduce(field,sourceList);
          if(coarse){
            const first=v0?v0/factor+1:0,last=Math.ceil(v1/factor)+(v1===height?1:0);
            draw(encoder,pipelines.coarseBand,field,grid,new Float32Array([factor,width,height,r.x,r.y]),
              {scissor:[0,first,coarse.width,last-first+1]});
          }else{
            const [blurred]=boxPasses(renderer,encoder,field,free,recipe.radii,r,set.scratch,buffers);
            reduce(blurred,blurList);
          }
          if(v0+rows>=y1){
            draw(encoder,pipelines.maximum,sourceList,sourcePeak,new Float32Array([1]));
            if(blurList)draw(encoder,pipelines.maximum,blurList,blurPeak,new Float32Array([1]));
          }
          d.queue.submit([encoder.finish()]);
          if(!await settle(count>1))return null;
        }
        if(count>1){release(set.paint,set.a,set.b,set.line);set.scratch?.destroy();set=null;}
      }
      if(bounds&&coarse){
        let encoder=d.createCommandEncoder();
        for(const axis of [0,1])for(let i=0;i<6;i++){
          draw(encoder,pipelines.fractionalWindow,grid,spare,new Float32Array([factor,axis,width,height,recipe.halfWidth]));
          [grid,spare]=[spare,grid];
        }
        d.queue.submit([encoder.finish()]);
        // Export normalizes by the largest interpolated native pixel, which
        // need not coincide with a coarse sample.
        const rows=Math.max(1,Math.min(height,limit,Math.floor(4194304/width))),count=Math.ceil(height/rows);
        const band=texture(width,rows),line=texture(1,rows),list=texture(1,count);
        encoder=d.createCommandEncoder();
        for(let i=0;i<count;i++){
          const y=i*rows;
          draw(encoder,pipelines.expandWindow,grid,band,new Float32Array([factor,width,height,0,y]));
          draw(encoder,pipelines.bandMaximum,band,line,new Float32Array([0,Math.min(rows,height-y),0,width]));
          draw(encoder,pipelines.maximum,line,one,new Float32Array([1]));
          encoder.copyTextureToTexture({texture:one},{texture:list,origin:[0,i]},[1,1]);
        }
        draw(encoder,pipelines.maximum,list,blurPeak,new Float32Array([1]));
        d.queue.submit([encoder.finish()]);
      }
      const fieldWidth=coarse?coarse.width:3,fieldHeight=(coarse?coarse.height:0)+1;
      const field=texture(fieldWidth,fieldHeight),encoder=d.createCommandEncoder();
      if(coarse)encoder.copyTextureToTexture({texture:grid},{texture:field},[coarse.width,coarse.height]);
      [recipe.shiftActive?paintPeak:sourcePeak,sourcePeak,blurPeak].forEach((peak,i)=>
        encoder.copyTextureToTexture({texture:peak},{texture:field,origin:[i,fieldHeight-1]},[1,1]));
      d.queue.submit([encoder.finish()]);
      if(!isCurrent())return null;
      scratch.temporary.delete(field);
      return {texture:field,width:fieldWidth,height:fieldHeight,byteSize:fieldWidth*fieldHeight*4,
        kind:'gpu-brush-native-feather-field',factor,bands,timings:{gpuPrepareMs:performance.now()-started}};
    }finally{if(set?.scratch)buffers.push(set.scratch);void scratch.dispose();}
  }
  /** Native Feather for one viewport from a resident field: interpolate the
   * coarse grid (or run export's narrow boxes over the finite halo), restore
   * the painted peak, then apply inversion and ordered erase at native centres.
   */
  async function generateFeatherRegion(renderer,expression,width,height,signature,rect,field,isCurrent=()=>true) {
    const recipe=featherRegionPlan(expression,width,height,signature,rect,renderer.device.limits.maxTextureDimension2D);
    if(!recipe||!field?.texture||field.destroyed||!isCurrent()||!ensureNativePipelines(renderer))return null;
    const base=nativeBrushParameters(recipe.spatial,{x:0,y:0},width,height,signature);
    if(!base)return null;
    const started=performance.now(),pipelines=renderer.brushPipelines,r=recipe.region;
    const scratch=nativeScratch(renderer,isCurrent),{d,texture,draw,buffers}=scratch;
    const at=(x,y)=>{const values=base.slice();values[1]=x;values[2]=y;return values;};
    try{
      const peaks=[0,1,2].map(()=>texture(1,1)),encoder=d.createCommandEncoder();
      peaks.forEach((peak,i)=>encoder.copyTextureToTexture(
        {texture:field.texture,origin:[i,field.height-1]},{texture:peak},[1,1]));
      const paintMaxima=scratch.maxima(peaks[0],peaks[0]),finalMaxima=scratch.maxima(peaks[1],peaks[2]);
      const finish=new Float32Array([expression.inverted?1:0,expression.enabled===false?0:1]);
      const erase=texture(r.width,r.height),result=texture(rect.width,rect.height,'r16float');
      if(recipe.coarse){
        const expanded=texture(rect.width,rect.height);
        draw(encoder,pipelines.nativeErase,expanded,erase,at(rect.x,rect.y));
        draw(encoder,pipelines.expandWindow,field.texture,expanded,new Float32Array([recipe.factor,width,height,rect.x,rect.y]));
        draw(encoder,pipelines.finish,expanded,result,finish,{operand:erase,extra:finalMaxima});
      }else{
        const paint=texture(r.width,r.height),a=texture(r.width,r.height),b=texture(r.width,r.height);
        const bytes=prefixScratchBytes(r,[...recipe.shiftRadii,...recipe.radii]);
        if(bytes>d.limits.maxStorageBufferBindingSize)return null;
        const prefix=d.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE});buffers.push(prefix);
        const values=at(r.x,r.y);
        draw(encoder,pipelines.nativePaint,a,paint,values);
        draw(encoder,pipelines.nativeErase,a,erase,values);
        let shifted=paint,free=a;
        if(recipe.shiftActive){
          draw(encoder,pipelines.normalize,paint,a,new Float32Array([0]),{extra:paintMaxima});
          const [blurred,target]=boxPasses(renderer,encoder,a,b,recipe.shiftRadii,r,prefix,buffers);
          draw(encoder,pipelines.shift,blurred,target,new Float32Array([recipe.shift,1]),{operand:paint,extra:paintMaxima});
          shifted=target;free=blurred;
        }
        const [blurred]=boxPasses(renderer,encoder,shifted,free,recipe.radii,r,prefix,buffers);
        const finished=texture(r.width,r.height,'r16float');
        draw(encoder,pipelines.finish,blurred,finished,finish,{operand:erase,extra:finalMaxima});
        encoder.copyTextureToTexture({texture:finished,origin:[rect.x-r.x,rect.y-r.y]},{texture:result},[rect.width,rect.height]);
      }
      d.queue.submit([encoder.finish()]);
      if(!isCurrent())return null;
      scratch.temporary.delete(result);
      return {texture:result,width:rect.width,height:rect.height,byteSize:rect.width*rect.height*2,
        kind:'gpu-brush-native-feather',timings:{gpuPrepareMs:performance.now()-started},scratchRegion:r,factor:recipe.factor};
    }finally{void scratch.dispose();}
  }
  // Pipeline compilation can overlap the source transfer of a zoom.
  const warm=renderer=>{try{return ensureNativePipelines(renderer);}catch{return false;}};
  window.HDRGpuBrushMask=Object.freeze({plan,generate,evenRound,shiftRegionPlan,generateShiftRegion,warm,
    featherFieldPlan,featherRegionPlan,generateFeatherField,generateFeatherRegion});
})();
