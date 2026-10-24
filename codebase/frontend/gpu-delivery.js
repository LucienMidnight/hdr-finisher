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
      if(job.operation === "dng_correction") {
        const required=HDRLibraryGpuRaw.rawBudget(job.dng,[100000]);
        if(required>job.budget)throw Error("GPU DNG correction exceeds the available shared memory budget.");
        const lease=await fetch(`/api/delivery/gpu/${job.id}/reserve`,{method:"POST",
          headers:{"Content-Type":"application/json"},body:JSON.stringify({bytes:required})});
        if(!lease.ok)throw Error("Grade needs the shared GPU memory budget.");
        await permit();
        const response=await fetch(`/api/delivery/gpu/${job.id}/dng-source`);
        if(!response.ok)throw Error("GPU DNG input handoff failed.");
        const body=await response.arrayBuffer();
        const inputHandoffMs=performance.now()-started;
        if(body.byteLength!==job.dng.mosaic_bytes)throw Error("Incomplete DNG input.");
        const result=await HDRLibraryRGB.develop({meta:job.dng,mosaic:new Uint8Array(body),
          edges:[100000],beforeSubmit:permit,memoryBudget:required});
        await permit();
        const handingOff=performance.now();
        const stored=await fetch(`/api/delivery/gpu/${job.id}/pixels/dng`,{method:"POST",body:new Blob(result.reduced[100000].planes)});
        if(!stored.ok)throw Error("GPU DNG result handoff failed.");
        const diagnostics={timings_ms:result.timings,memory_peak_bytes:result.memory_peak_bytes,
          reserved_bytes:required,tiles:result.dng_tiles,max_source_bytes:result.dng_max_source_bytes,
          input_handoff_and_initialization_ms:inputHandoffMs,output_handoff_ms:performance.now()-handingOff};
        await fetch(`/api/delivery/gpu/${job.id}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({dng_diagnostics:diagnostics,timings_ms:result.timings,total_ms:performance.now()-started})});
        continue;
      }
      if(job.operation === "edge_colour") {
        const required=job.width*job.height*44+64*1024*1024;
        if(required>job.budget)throw Error(`GPU edge colour needs ${required} bytes; shared budget has ${job.budget}.`);
        const lease=await fetch(`/api/delivery/gpu/${job.id}/reserve`,{method:"POST",
          headers:{"Content-Type":"application/json"},body:JSON.stringify({bytes:required})});
        if(!lease.ok)throw Error("Grade needs the shared GPU memory budget.");
        await permit();
        const {device}=await HDRLibraryGpuRaw.shared.gpu();
        const owned=new Set();let live=0,peak=0;
        const release=b=>{if(owned.delete(b)){live-=b.size;b.destroy();}};
        const make=size=>{if(live+size>required)throw Error("GPU edge colour exceeded its reservation.");
          const b=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
          owned.add(b);live+=size;peak=Math.max(peak,live);return b;};
        const read=async(buffer,size)=>{
          if(live+size>required)throw Error("GPU edge colour readback exceeded its reservation.");
          const b=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
          owned.add(b);live+=size;peak=Math.max(peak,live);
          const enc=device.createCommandEncoder();enc.copyBufferToBuffer(buffer,0,b,0,size);device.queue.submit([enc.finish()]);
          await b.mapAsync(GPUMapMode.READ);const copy=b.getMappedRange().slice(0);release(b);return copy;
        };
        device.pushErrorScope("out-of-memory");device.pushErrorScope("validation");
        let diagnostics;
        try {
          const response=await fetch(`/api/delivery/gpu/${job.id}/edge-source`);
          if(!response.ok)throw Error("GPU edge-colour input handoff failed.");
          const body=await response.arrayBuffer(),bytes=job.width*job.height*4;
          if(body.byteLength!==bytes*4)throw Error("Incomplete edge-colour input.");
          const inputs=[];for(let k=0;k<4;k++){const b=make(bytes);device.queue.writeBuffer(b,0,body,k*bytes,bytes);inputs.push(b);}
          diagnostics=await HDREdgeColour.reconstruct({device,planes:inputs.slice(0,3),ratio:inputs[3],
            width:job.width,height:job.height,expand:job.expand,toBT:job.toBT,fromBT:job.fromBT,make,release,read,beforeSubmit:permit});
          const output=[];for(const b of diagnostics.planes)output.push(await read(b,bytes));
          delete diagnostics.planes;
          const stored=await fetch(`/api/delivery/gpu/${job.id}/pixels/edge`,{method:"POST",body:new Blob(output)});
          if(!stored.ok)throw Error("GPU edge-colour result handoff failed.");
        } finally {
          await device.queue.onSubmittedWorkDone().catch(()=>{});for(const b of owned)release(b);
          const validation=await device.popErrorScope(),oom=await device.popErrorScope();
          if(validation||oom)throw Error((validation||oom).message);
        }
        diagnostics={...diagnostics,algorithm_version:"hdr-finisher-edge-colour-v1",
          stage:"acescg_after_camera_conversion_before_lens_correction",expand_percent:job.expand,memory_peak_bytes:peak};
        await fetch(`/api/delivery/gpu/${job.id}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({edge_diagnostics:diagnostics,total_ms:performance.now()-started})});
        continue;
      }
      if(job.raw){
        // RAW scratch is released before the creative graph starts.
        const scratch=HDRLibraryGpuRaw.rawBudget(job.raw);
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
      if([...job.output,...(job.photo_output||job.output)].some(value=>value>gpu.device.limits.maxTextureDimension2D))
        throw Error("Framed output exceeds the GPU texture limit.");
      // Count the largest live finishing stage, including the two-pass resize
      // and six float scratch images used by sharpening. An unsharpened export
      // must not be refused for sharpening buffers it never allocates.
      const resizeBytes=(width!==job.output[0]||height!==job.output[1])
        ?16*(filmPixels+job.output[0]*height+outputPixels):0;
      const reserve=Math.max(filmPixels*24,resizeBytes,
        outputPixels*(job.finishing.sharpening==="off"?32:96))+(job.framing?outputPixels*16:0)+32*1024*1024;
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
