(function () {
  'use strict';
  // Bounded whole bitmaps only. Native shifted edges retain the exact fallback;
  // global normalization is not approximated per tile.
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
    @fragment fn brushShift(input: VertexOut) -> @location(0) vec4f {
      let at=vec2i(input.position.xy);
      let peak=textureLoad(paintedMaximum,vec2i(0),0).r;
      let threshold=select(.841345,.158655,p[0]>0.0);
      let shifted=smoothstep(threshold-.035,threshold+.035,
        textureLoad(sourceTexture,at,0).r/max(peak,1e-30))*peak;
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
  async function generate(renderer,expression,width,height,signature,isCurrent=()=>true) {
    const recipe=plan(expression,width,height,signature);if(!recipe||!isCurrent())return null;
    const started=performance.now(),timings={};
    const d=renderer.device,temporary=[],buffers=[];
    const texture=(w,h,format='r32float')=>{
      const t=d.createTexture({size:[w,h],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
      temporary.push(t);return t;
    };
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
        maximum:pipeline('brushMaximum'),shift:pipeline('brushShift','r32float',finishLayout),
        finish:pipeline('brushFinish','r16float',finishLayout),peakLayout};
    })();
    renderer.brushPipelineDevice=d;
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
          new Float32Array([expression.leaf.mask_shift_edge]),paint,shiftMaxima);
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
  window.HDRGpuBrushMask=Object.freeze({plan,generate,evenRound});
})();
