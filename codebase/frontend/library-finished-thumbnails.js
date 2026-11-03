/* Exact canvas surfaces; no retained pixel cache beyond the existing tile pool. */
window.HDRLibraryFinishedThumbnails = (() => {
  const query=(path,hdr,format)=>new URLSearchParams({path,lane:hdr?'hdr':'sdr',format});
  let pending=0;
  function capture(gpu,meta,texture,hdr,current) {
    if(meta.edge!==640||meta.route!=='library-live'||!current()||!HDRLibraryScreenPreviews.tryCapture())return;
    // Capture is called synchronously at submission, before the swap chain expires.
    pending++;
    HDRLibraryStopwatch("picture_finished_capture",{path:meta.path,reason:"capture started"});
    const width=texture.width,height=texture.height,format=texture.format;
    const stride=Math.ceil(width*(format==='rgba16float'?8:4)/256)*256;
    let buffer;
    try {
    buffer=gpu.device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const encoder=gpu.device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride,rowsPerImage:height},[width,height]);
    gpu.device.queue.submit([encoder.finish()]);
    } catch(error){buffer?.destroy();pending--;HDRLibraryScreenPreviews.endCapture();console.debug("Finished thumbnail capture:",error.message);return;}
    return (async()=>{
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        if(!current())return;
        const body=buffer.getMappedRange().slice(0);
        buffer.unmap();
        const params=query(meta.path,hdr,format);for(const [key,value] of Object.entries({width,height,stride}))params.set(key,value);
        const response=await HDRLibraryUpload.send('/api/library/finished-thumbnail?'+params,{body,headers:{'X-Thumbnail-Scene':JSON.stringify({source_key:meta.source_key,key:meta.key,grade_identity:meta.grade_identity,adjustments:meta.adjustments})}});
        HDRLibraryStopwatch('picture_finished_saved',{path:meta.path,reason:String(response.status)});
        if(!response.ok&&response.status!==409)console.debug('Finished thumbnail save:',response.status);
      } catch(error){HDRLibraryStopwatch('picture_finished_failed',{path:meta.path,reason:error.message});console.debug('Finished thumbnail capture:',error.message);}
      finally{buffer.destroy();pending--;HDRLibraryScreenPreviews.endCapture();}
    })();
  }
  // One microtask batch for the visible cells. Bodies are request-owned and
  // released after upload; there is no retained JS pixel index or extra LRU.
  const batches=new Map();
  function stored(path,hdr,format,signal){
    const key=hdr+':'+format;
    let batch=batches.get(key);
    if(!batch){
      batch=[];batches.set(key,batch);
      queueMicrotask(async()=>{
        batches.delete(key);
        const active=batch.filter(item=>!item.signal.aborted);
        try{
          if(!active.length)return;
          for(let at=0;at<active.length;at+=32){
          const group=active.slice(at,at+32);
          const response=await fetch('/api/library/finished-thumbnails?'+new URLSearchParams({lane:hdr?'hdr':'sdr',format}),
            {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:group.map(item=>item.path)})});
          if(!response.ok)throw Error('Finished thumbnail batch failed: '+response.status);
          const body=await response.arrayBuffer();
          const length=new DataView(body).getUint32(0,true),start=4+length;
          const records=new Map(JSON.parse(new TextDecoder().decode(new Uint8Array(body,4,length))).map(row=>[row.path,row]));
          for(const item of group){
            const row=records.get(item.path);
            item.resolve(row?{info:row.meta,body:new Uint8Array(body,start+row.offset,row.length)}:null);
          }
          }
        }catch(error){for(const item of active)item.reject(error);}
        finally{for(const item of batch)if(item.signal.aborted)item.reject(new DOMException('Cancelled','AbortError'));}
      });
    }
    return new Promise((resolve,reject)=>batch.push({path,signal,resolve,reject}));
  }
  async function load(photo,canvas,signal,current,hdr) {
    const started=performance.now();
    // Do not allocate/configure an empty swap chain before the cache read.
    // Verify the actual format when the finished dimensions are available.
    const format=hdr&&window.matchMedia?.('(dynamic-range: high)').matches?'rgba16float':navigator.gpu?.getPreferredCanvasFormat?.() || "bgra8unorm";
    const result=await stored(photo.path,hdr,format,signal).catch(error=>{
      if(signal.aborted)throw error;
      console.debug('Finished thumbnail read:',error.message);return null;
    });
    if(!result)return null;
    const gpu=await HDRLibraryPictures.initialize().catch(error=>{if(error.gpuUnavailable)return null;throw error;});
    if(!gpu)return null;
    const {info,body}=result;
    if(body.byteLength!==info.stride*info.height)return null;
    if(signal.aborted||!current())throw new DOMException('Invalidated','AbortError');
    if(info.identity.bytes!==photo.bytes||String(info.identity.mtime_ns)!==String(photo.mtime_ns)||info.identity.grade!==photo.grade_identity)return null;
    canvas.width=info.width;canvas.height=info.height;
    const context=canvas.getContext('webgpu');
    if(gpu.configureSurface(canvas,context,hdr).format!==info.identity.format)return null;
    const texture=context.getCurrentTexture();
    gpu.device.queue.writeTexture({texture},body,{bytesPerRow:info.stride,rowsPerImage:info.height},[info.width,info.height]);
    await gpu.device.queue.onSubmittedWorkDone();
    if(signal.aborted||!current())throw new DOMException('Invalidated','AbortError');
    canvas.dataset.pictureKey=info.key;canvas.dataset.picturePath=photo.path;
    canvas.dataset.rendition=hdr?'hdr':'sdr';canvas.dataset.surface=gpu.surfaceKeys?.get(canvas);canvas.dataset.peakNits=hdr?'1000':'203';
    HDRLibraryStopwatch('picture_finished_thumbnail',{path:photo.path,route:'finished-thumbnail',picture_size:'thumbnail',duration_ms:performance.now()-started,cache_hit:true});
    return {key:info.key,path:photo.path,edge:640,route:'finished-thumbnail',cache_hit:true,stored_bytes:body.byteLength};
  }
  return Object.freeze({capture,load,snapshot:()=>({pending})});
})();
