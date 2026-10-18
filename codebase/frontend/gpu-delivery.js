/* One serial hidden renderer, reusing Grade's class, masks, stocks and Denoise. */
(async () => {
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const canvas=document.createElement("canvas");let gpu,identity=null;
  setInterval(()=>fetch("/api/delivery/gpu/permit").catch(()=>{}),1000);
  async function permit(){
    for(;;){const response=await fetch(`/api/delivery/gpu/permit${identity?"?identity="+identity:""}`);if(!response.ok)throw Error("Delivery scheduler unavailable.");
      const value=await response.json();
      if(value.cancelled)throw Error("GPU delivery job cancelled.");
      if(value.preempt)throw Error(value.reason);
      if(value.ready)return;await pause(30);}
  }
  for(;;){
    let job,finishing;
    try{
      const response=await fetch("/api/delivery/gpu/next");if(!response.ok)throw Error("Delivery queue unavailable.");job=await response.json();
      if(!job){await pause(50);continue;}
      identity=job.id;
      if(!gpu?.available){gpu=new HDRWebGPUPreview(canvas);if(!await gpu.initialize())throw Error("WebGPU is unavailable.");}
      if(gpu.adapterInfo?.fallback)throw Error("No hardware GPU is available.");
      gpu.resetSession(job.id);
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
      try{
        for(const lane of ["hdr","sdr"]){
          await permit();
          const signature=JSON.stringify(job.adjustments.shared.geometry);
          const proxy=await gpu.loadProxy(job.id,lane,Math.max(256,job.width,job.height),signature,0,"source");
          const capture=finishing.texture(proxy.width,proxy.height,"rgba16float"),delivery={texture:capture};
          const denoise=job.denoise[lane];
          if(denoise?.enabled){
            if(!await gpu.analyzeDenoiseProxy(job.id,lane,job.adjustments,Math.max(256,job.width,job.height),0,"source",denoise.controls))
              throw Error("GPU Denoise analysis failed.");
          }
          else gpu.denoiseSourceSelector && (gpu.denoiseSourceSelector.selected="original");
          const result=await gpu.renderTo(canvas,job.id,lane,job.adjustments,sampleCurvePoints,Math.max(256,job.width,job.height),job.locals,0,null,job.white,
            {width:job.width,height:job.height},{delivery,beforeDeliverySubmit:permit,measureOnly:true});
          if(!result?.rendered && result?.execution!=="direct")throw Error(`GPU delivery refused the grade: ${result?.reason||JSON.stringify(result?.refusals)}`);
          if(!delivery.params)throw Error("GPU delivery produced no finished image.");job.params=delivery.params;
          const texture=await finishing.finish(capture,job,lane),pixels=await finishing.read(texture);
          const uploaded=await fetch(`/api/delivery/gpu/${job.id}/pixels/${lane}`,{method:"POST",body:pixels});
          if(!uploaded.ok)throw Error("GPU encoder handoff failed.");
        }
      }finally{
        const validation=await gpu.device.popErrorScope(),oom=await gpu.device.popErrorScope();
        if(validation||oom)throw Error((validation||oom).message);
      }
      finishing.destroy();finishing=null;gpu.resetSession(null);
      await fetch(`/api/delivery/gpu/${job.id}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    }catch(error){
      console.error("GPU delivery",error);
      finishing?.destroy();finishing=null;gpu?.resetSession(null);
      if(job)await fetch(`/api/delivery/gpu/${job.id}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({error:error.message})}).catch(()=>{});
      await pause(100);
    }finally{identity=null;finishing?.destroy();gpu?.resetSession(null);}
  }
})();
