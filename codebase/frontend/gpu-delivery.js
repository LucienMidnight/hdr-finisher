/* One serial hidden renderer, reusing Grade's class, masks, stocks and Denoise. */
(async () => {
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const canvas=document.createElement("canvas");let gpu,identity=null,initializing;
  async function initialize(beforeNext = async () => {}) {
    if(gpu?.available)return gpu;
    if(!initializing) initializing=(async()=>{
      gpu=new HDRWebGPUPreview(canvas);
      if(!await gpu.initialize(()=>beforeNext(()=>identity!==null)))throw Error("WebGPU is unavailable.");
      return gpu;
    })().finally(()=>{initializing=null;});
    return initializing;
  }
  HDRIdleWarmup.run("delivery", async beforeNext => {
    await initialize(beforeNext);
    await gpu.warmPipelines("rgba16float",beforeNext);
  },()=>identity!==null);
  setInterval(()=>fetch("/api/delivery/gpu/permit").catch(()=>{}),1000);
  // A job asks before each small batch of GPU work (about 700 times per photo).
  // Each ask is a ~3 ms request with the GPU idle, so a "ready" answer is
  // reused for PERMIT_REUSE_MS: Grade or a more urgent job still takes the GPU
  // back within about a tenth of a second plus the batch already running.
  const PERMIT_REUSE_MS=100;let permitted=0;
  async function permit(){
    if(performance.now()-permitted<PERMIT_REUSE_MS)return;
    for(;;){const response=await fetch(`/api/delivery/gpu/permit${identity?"?identity="+identity:""}`);if(!response.ok)throw Error("Delivery scheduler unavailable.");
      const value=await response.json();
      if(value.cancelled)throw Error("GPU delivery job cancelled.");
      if(value.preempt)throw Error(value.reason);
      if(value.ready){permitted=performance.now();return;}await pause(30);}
  }
  for(;;){
    let job,finishing;
    try{
      const response=await fetch("/api/delivery/gpu/next");if(!response.ok)throw Error("Delivery queue unavailable.");job=await response.json();
      if(!job){await pause(50);continue;}
      identity=job.id;permitted=0;
      const timings={},started=performance.now();let mark=started;
      const stamp=(name,lane)=>{const now=performance.now(),spent=now-mark;timings[name]=(timings[name]||0)+spent;
        if(lane)timings[`${lane}_${name}`]=spent;mark=now;};
      await initialize();
      if(gpu.adapterInfo?.fallback)throw Error("No hardware GPU is available.");
      gpu.resetSession(job.id);
      if(job.raw){
        // RAW scratch is released before the creative graph starts.
        const scratch=job.raw.width*job.raw.height*44+64*1024*1024;
        if(scratch>job.budget)throw Error("GPU RAW development exceeds the available memory budget.");
        const lease=await fetch(`/api/delivery/gpu/${job.id}/reserve`,{method:"POST",
          headers:{"Content-Type":"application/json"},body:JSON.stringify({bytes:job.budget})});
        if(!lease.ok)throw Error("Grade needs the shared GPU memory budget.");
        await permit();
        const response=await fetch(`/api/delivery/gpu/${job.id}/raw-sensor`);
        if(!response.ok)throw Error("GPU RAW sensor handoff failed.");
        const body=await response.arrayBuffer(),length=new DataView(body).getUint32(0,true);
        const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(body,4,length)));
        const result=await HDRLibraryGpuRaw.developRaw({meta,
          mosaic:new Uint8Array(body,4+length,meta.mosaic_bytes),
          lensData:meta.lens_grid?new Float32Array(body,4+length+meta.lens_offset,meta.lens_grid.floats):null,
          edges:[job.raw.edge],beforeSubmit:permit,memoryBudget:scratch});
        await permit();
        const picture=result.reduced[job.raw.edge];
        const robust={luma:HDRLibraryGpuRaw.quantile(result.samples,0,.9999),
          channel:HDRLibraryGpuRaw.quantile(result.samples,1,.9999),bt2020:HDRLibraryGpuRaw.quantile(result.samples,2,.9999)};
        const text=new TextEncoder().encode(JSON.stringify({peaks:result.peaks,robust,timings:result.timings}));
        const header=new Uint8Array(text.length+((4-(text.length%4))%4)).fill(32);header.set(text);
        const prefix=new Uint32Array([header.length]);
        const stored=await fetch(`/api/delivery/gpu/${job.id}/raw-developed`,{method:"POST",
          body:new Blob([prefix,header,...picture.planes])});
        if(!stored.ok)throw Error("GPU RAW development handoff failed.");
        stamp("raw_development_ms");
      }
      gpu.executionOverride="tiled";
      const [width,height]=window.HDRGeometryResample?.outputDimensions?.(job.width,job.height,job.adjustments.shared.geometry)||[job.width,job.height];
      // Reserve all full-frame finishing scratch before admitting the creative
      // graph. It can choose its existing tiled route within the remainder.
      const filmPixels=width*height,outputPixels=job.output[0]*job.output[1];
      // Count the largest live finishing stage, including the two-pass resize
      // and six float scratch images used by sharpening. An unsharpened export
      // must not be refused for sharpening buffers it never allocates.
      const resizeBytes=(width!==job.output[0]||height!==job.output[1])
        ?16*(filmPixels+job.output[0]*height+outputPixels):0;
      const reserve=Math.max(filmPixels*24,resizeBytes,
        outputPixels*(job.finishing.sharpening==="off"?32:96))+32*1024*1024;
      if(reserve>job.budget*.8)throw Error("GPU delivery finishing exceeds the available memory budget.");
      const lease=await fetch(`/api/delivery/gpu/${job.id}/reserve`,{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({bytes:job.budget})});
      if(!lease.ok)throw Error("Grade needs the shared GPU memory budget.");
      const creativeBudget=job.budget-reserve;
      if(creativeBudget<256*1024*1024)throw Error("Insufficient memory for the delivery graph.");
      gpu.setMemoryBudget(creativeBudget/(1024**3));
      finishing=new HDRGpuDeliveryFinishing(gpu,permit);await finishing.initialize();
      gpu.device.pushErrorScope("out-of-memory");gpu.device.pushErrorScope("validation");
      stamp("setup_ms");
      try{
        // Without an authored SDR base both lanes start from the same source
        // pixels (render_cache.geometry_source_proxy), so the SDR lane reuses the
        // HDR upload instead of fetching ~0.9 s of identical pixels again. The
        // alias carries no bytes of its own so memory is not counted twice.
        const sharedSource=!(job.authored_sdr&&job.adjustments.sdr?.use_authored_base);let hdrSource=null;
        for(const lane of ["hdr","sdr"]){
          await permit();
          const signature=JSON.stringify(job.adjustments.shared.geometry);
          if(lane==="sdr"&&sharedSource&&hdrSource&&gpu.proxies.get(hdrSource.identity)===hdrSource){
            const prefix=`${job.id}:hdr:`,identity=`${job.id}:sdr:`+hdrSource.identity.slice(prefix.length);
            if(hdrSource.identity.startsWith(prefix)&&!gpu.proxies.has(identity))
              gpu.proxies.set(identity,{...hdrSource,lane,identity,byteSize:0,bindGroups:new Map()});
          }
          const proxy=await gpu.loadProxy(job.id,lane,Math.max(256,job.width,job.height),signature,0,"source");
          if(lane==="hdr")hdrSource=proxy;
          stamp("source_ms",lane);
          const capture=finishing.texture(proxy.width,proxy.height,"rgba16float"),delivery={texture:capture};
          const denoise=job.denoise[lane];
          if(denoise?.enabled){
            if(!await gpu.analyzeDenoiseProxy(job.id,lane,job.adjustments,Math.max(256,job.width,job.height),0,"source",denoise.controls))
              throw Error("GPU Denoise analysis failed.");
          }
          else gpu.denoiseSourceSelector && (gpu.denoiseSourceSelector.selected="original");
          stamp("denoise_ms",lane);
          const result=await gpu.renderTo(canvas,job.id,lane,job.adjustments,sampleCurvePoints,Math.max(256,job.width,job.height),job.locals,0,null,job.white,
            {width:job.width,height:job.height},{delivery,beforeDeliverySubmit:permit,measureOnly:true});
          if(!result?.rendered && result?.execution!=="direct")throw Error(`GPU delivery refused the grade: ${result?.reason||JSON.stringify(result?.refusals)}`);
          if(!delivery.params)throw Error("GPU delivery produced no finished image.");job.params=delivery.params;
          stamp("creative_ms",lane);
          const texture=await finishing.finish(capture,job,lane);stamp("finishing_ms",lane);
          const pixels=await finishing.read(texture);stamp("readback_ms",lane);
          // A Blob body sends the same bytes but stays out of DevTools request events, which a
          // test connection copies in full and can overflow (release README, October 18).
          const uploaded=await fetch(`/api/delivery/gpu/${job.id}/pixels/${lane}`,{method:"POST",body:new Blob([pixels])});
          if(!uploaded.ok)throw Error("GPU encoder handoff failed.");
          stamp("handoff_ms",lane);
        }
      }finally{
        const validation=await gpu.device.popErrorScope(),oom=await gpu.device.popErrorScope();
        if(validation||oom)throw Error((validation||oom).message);
      }
      finishing.destroy();finishing=null;gpu.resetSession(null);
      await fetch(`/api/delivery/gpu/${job.id}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({timings_ms:timings,total_ms:performance.now()-started})});
    }catch(error){
      console.error("GPU delivery",error);
      finishing?.destroy();finishing=null;gpu?.resetSession(null);
      if(job)await fetch(`/api/delivery/gpu/${job.id}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({error:error.message})}).catch(()=>{});
      await pause(100);
    }finally{identity=null;finishing?.destroy();gpu?.resetSession(null);}
  }
})();
