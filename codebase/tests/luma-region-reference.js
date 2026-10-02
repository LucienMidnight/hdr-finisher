/** GPU regional luma versus the existing whole-source GPU mask. No project. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const outputIndex=process.argv.indexOf('--output'),output=path.resolve(outputIndex<0?'output/performance/luma-region-reference.json':process.argv[outputIndex+1]);
(async()=>{const browser=await chromium.launch();try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8799');await page.waitForFunction(()=>state.gpuPreview?.available);
  const results=await page.evaluate(async()=>{
    const renderer=state.gpuPreview,d=renderer.device,width=768,height=512,results=[];
    const module=d.createShaderModule({code:HDRWebGPUShaders.LUMA_MASK_SHADER_SOURCE+`@fragment fn probe(input:VertexOut)->@location(0) vec4f{return textureLoad(sourceTexture,vec2i(input.position.xy)+vec2i(p[0],p[1]),0);}`});
    const pipeline=d.createRenderPipeline({layout:renderer.maskPipelineLayout,vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint:'probe',targets:[{format:'r16float'}]},primitive:{topology:'triangle-list'}});
    const half=v=>{const e=(v>>10)&31,m=v&1023;return (v&32768?-1:1)*(e?(1+m/1024)*2**(e-15):m*2**-24);};
    const makeSource=region=>{
      const rect=region||{x:0,y:0,width,height},data=new Float32Array(rect.width*rect.height*4);
      for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){
        const value=.18*2**(5*Math.sin((x+rect.x)*.071)+2*Math.cos((y+rect.y)*.13));const at=(y*rect.width+x)*4;
        data.set([value,value*.7,value*.4,1],at);
      }
      const texture=d.createTexture({size:[rect.width,rect.height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      d.queue.writeTexture({texture},data,{bytesPerRow:rect.width*16},[rect.width,rect.height]);
      return {texture,width,height,textureWidth:rect.width,textureHeight:rect.height,region,lane:'hdr',sourceIdentity:'source'};
    };
    const read=async(entry,x,y)=>{
      const params=renderer.createStorageBuffer(new Float32Array([x,y,0,0]));d.queue.writeBuffer(params,0,new Float32Array([x,y,0,0]));
      const texture=d.createTexture({size:[32,32],format:'r16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});const buffer=d.createBuffer({size:256*32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const e=d.createCommandEncoder();renderer.encodeMaskPass(e,pipeline,renderer.createMaskBindGroup(entry.texture,params),texture);e.copyTextureToBuffer({texture},{buffer,bytesPerRow:256},[32,32]);d.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);const data=new Uint16Array(buffer.getMappedRange());return Array.from({length:1024},(_,i)=>half(data[Math.floor(i/32)*128+i%32]));}
      finally{if(buffer.mapState==='mapped')buffer.unmap();[buffer,texture,params].forEach(v=>v.destroy());}
    };
    for(const feather of [0,.004,.01,.03])for(const inverted of [false,true]){
      const sigma=.09*Math.min(1,feather/.05)*width,factor=sigma<8?1:Math.floor(sigma/4),halo=Math.ceil(3*sigma)+2*factor;
      const x=Math.floor((352-halo)/factor)*factor,y=Math.floor((240-halo)/factor)*factor;
      const right=Math.ceil((384+halo)/factor)*factor,bottom=Math.ceil((272+halo)/factor)*factor;
      const region={x,y,width:right-x,height:bottom-y},sessionId=`luma-reference-${feather}-${inverted}`;
      const local={mask:{operator:'leaf',enabled:true,inverted,leaf:{type:'luminance_range',mask_feather:feather,fade_in_start_ev:-6,full_start_ev:-3,full_end_ev:2,fade_out_end_ev:5}}};
      const wholeSource=makeSource(null),regionSource=makeSource(region);
      try{
        const whole=await renderer.loadGpuLumaMask(sessionId,local,width,0,'{}',()=>true,undefined,false,wholeSource);
        const regional=await renderer.loadGpuLumaMask(sessionId,local,width,0,'{}',()=>true,undefined,false,regionSource);
        const a=await read(whole,352,240),b=await read(regional,352-x,240-y);
        const maxLevels=Math.max(...a.map((v,i)=>Math.abs(v-b[i])*255));
        results.push({feather,inverted,factor,region,wholePixels:width*height,regionPixels:region.width*region.height,comparedPixels:1024,maxLevels,kind:regional.kind,frameRect:regional.frameRect});
      }finally{wholeSource.texture.destroy();regionSource.texture.destroy();}
    }
    return results;
  });
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
  for(const result of results)assert.ok(result.maxLevels<=.25,JSON.stringify(result));
  console.log(`GPU regional luma: ${results.length} whole-source comparison cases pass.`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
