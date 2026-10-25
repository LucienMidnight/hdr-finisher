/* Library-only M9 triangular shrink and camera conversion. Grade shaders are unchanged. */
window.HDRLibraryRawGPU = (() => {
  const code = `struct P {src:vec4u,dst:vec4u,r0:vec4f,r1:vec4f,r2:vec4f};
    @group(0) @binding(0) var<storage,read> input:array<u32>;
    @group(0) @binding(1) var<storage,read_write> middle:array<vec4f>;
    @group(0) @binding(2) var<uniform> p:P;
    fn channel(i:u32)->f32 {let v=input[i/2];return f32(select(v&65535u,v>>16,(i&1u)==1u));}
    @compute @workgroup_size(8,8) fn horizontal(@builtin(global_invocation_id) id:vec3u){
     if(id.x>=p.dst.x||id.y>=p.src.y){return;}let scale=f32(p.src.x)/f32(p.dst.x);let support=max(1.,scale);let center=(f32(id.x)+.5)*scale;
     let first=max(0,i32(center-support+.5));let last=min(i32(p.src.x),i32(center+support+.5));var value=vec3f(0);var norm=0.;
     for(var x=first;x<last;x++){let weight=max(0.,1.-abs((f32(x)+.5-center)/support));let i=(id.y*p.src.x+u32(x))*3;value+=vec3f(channel(i),channel(i+1),channel(i+2))*weight;norm+=weight;}
     middle[id.y*p.dst.x+id.x]=vec4f(value/norm,1.);
    }
    @group(1) @binding(0) var<storage,read> temporary:array<vec4f>;
    @group(1) @binding(1) var destination:texture_storage_2d<rgba16float,write>;
    @group(1) @binding(2) var<uniform> q:P;
    @compute @workgroup_size(8,8) fn vertical(@builtin(global_invocation_id) id:vec3u){
     if(id.x>=q.dst.x||id.y>=q.dst.y){return;}let scale=f32(q.src.y)/f32(q.dst.y);let support=max(1.,scale);let center=(f32(id.y)+.5)*scale;
     let first=max(0,i32(center-support+.5));let last=min(i32(q.src.y),i32(center+support+.5));var value=vec3f(0);var norm=0.;
     for(var y=first;y<last;y++){let weight=max(0.,1.-abs((f32(y)+.5-center)/support));value+=temporary[u32(y)*q.dst.x+id.x].rgb*weight;norm+=weight;}
     let camera=value/norm/65535.;var rgb=vec3f(dot(q.r0.xyz,camera),dot(q.r1.xyz,camera),dot(q.r2.xyz,camera));
     let lo=min(rgb.r,min(rgb.g,rgb.b));let hi=max(rgb.r,max(rgb.g,rgb.b));if(lo<0){rgb=select(vec3f(0),hi*(rgb-vec3f(lo))/max(hi-lo,1e-20),hi>0);}
     if(any(camera>=vec3f(q.r0.w,q.r1.w,q.r2.w))){rgb=vec3f(max(rgb.r,max(rgb.g,rgb.b)));}
     textureStore(destination,vec2i(id.xy),vec4f(clamp(rgb,vec3f(0),vec3f(65504)),1));
    }`;
  function create(gpu) {
    const cache = new Map();
    let pipelines, pictureLimit = 10;
    const device = gpu.device;
    const byteLimit = Math.max(32 * 1024**2, Math.min(384 * 1024**2, gpu.memoryBudgetBytes() / 12));
    const get = key => { const value = cache.get(key); if (value) { cache.delete(key); cache.set(key, value); } return value; };
    function remove(key) {
      const entry = cache.get(key); if (!entry) return;
      cache.delete(key);
      for (const [id, proxy] of gpu.proxies) if (proxy.texture === entry.texture) gpu.proxies.delete(id);
      entry.texture.destroy();
    }
    function trim(protectedKeys) {
      const full = () => [...cache.values()].filter(e => e.meta.edge >= 1280).length;
      const total = () => [...cache.values()].reduce((n, e) => n + e.byteSize, 0);
      while (cache.size > 80 || full() > pictureLimit || total() > byteLimit) {
        const key = [...cache.keys()].find(key => !protectedKeys.has(key));
        if (!key) break; remove(key);
      }
    }
    async function initialize() {
      if (!pipelines) pipelines = (async () => {
        const module = device.createShaderModule({code});
        const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
        if (errors.length) throw Error(errors.map(m => m.message).join('; '));
        return Promise.all(['horizontal', 'vertical'].map(entryPoint => device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}})));
      })();
      return pipelines;
    }
    async function convert(meta, signal) {
      if (get(meta.key)) return get(meta.key);
      if (meta.route === 'gpu-raw-thumbnail') {
        await gpu.acquireForegroundDeliveryBudget();
        gpu.activeRenderCount++;
        let texture;
        try {
          const response = await fetch('/api/library/pixels/' + meta.key + '?lane=hdr', {signal});
          if (!response.ok) throw Error('The developed preview data is unavailable; revisit this photo.');
          const body = await response.arrayBuffer();
          const width = Number(response.headers.get('X-Image-Width')), height = Number(response.headers.get('X-Image-Height'));
          texture = device.createTexture({size:[width,height],format:'rgba16float',
            usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
          device.queue.writeTexture({texture},body,{bytesPerRow:Number(response.headers.get('X-Bytes-Per-Row')),rowsPerImage:height},[width,height]);
          await device.queue.onSubmittedWorkDone();
          const entry = {texture,meta,byteSize:body.byteLength};
          cache.set(meta.key,entry); trim(new Set([meta.key]));
          return entry;
        } catch(error) { texture?.destroy(); throw error; }
        finally { gpu.activeRenderCount--; }
      }
      const [hp, vp] = await initialize();
      const started = performance.now();
      const response = await fetch('/api/library/raw-transport/' + meta.transport_key, {signal});
      if (!response.ok) throw Error('The RAW preview data was released; select the photo again.');
      const body = await response.arrayBuffer();
      const rawSize = Math.ceil(body.byteLength / 4) * 4;
      if (rawSize > device.limits.maxStorageBufferBindingSize) throw Error('This RAW exceeds the graphics card’s Library preview limit.');
      const raw = device.createBuffer({size:rawSize,usage:GPUBufferUsage.STORAGE,mappedAtCreation:true});
      new Uint8Array(raw.getMappedRange()).set(new Uint8Array(body)); raw.unmap();
      HDRLibraryStopwatch('picture_raw_uploaded', {...window.HDRLibraryPictureLog?.(meta),key:meta.key,duration_ms:performance.now()-started});
      const resources = [raw], made = [], encoder = device.createCommandEncoder();
      const sizes = [meta];
      if (meta.edge < 1280 && meta.prepare_full) {
        sizes.push({...meta,key:meta.browse_key,width:meta.browse_width,height:meta.browse_height,edge:Math.max(1280,meta.browse_width,meta.browse_height)});
      }
      if (meta.edge >= 1280) {
        const scale = Math.min(512 / Math.max(meta.raw_width, meta.raw_height), 1);
        sizes.push({...meta,key:meta.transport_key + ':thumb',width:Math.round(meta.raw_width*scale),height:Math.round(meta.raw_height*scale),edge:512});
      }
      try {
        for (const size of sizes) {
          if (get(size.key)) continue;
          const w=size.width,h=size.height,midSize=w*meta.raw_height*16;
          if (midSize > device.limits.maxStorageBufferBindingSize) throw Error('This RAW exceeds the graphics card’s Library resize limit.');
          const mid=device.createBuffer({size:midSize,usage:GPUBufferUsage.STORAGE});
          const params=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
          resources.push(mid,params);
          const bytes=new ArrayBuffer(80); new Uint32Array(bytes).set([meta.raw_width,meta.raw_height,0,0,w,h,0,0]);
          new Float32Array(bytes,32).set(meta.matrix.flatMap((r,i)=>[...r,meta.threshold[i]]));device.queue.writeBuffer(params,0,bytes);
          const texture=device.createTexture({size:[w,h],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
          const entry={texture,meta:size,byteSize:w*h*8}; made.push(entry);
          const b1=device.createBindGroup({layout:hp.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:raw}},{binding:1,resource:{buffer:mid}},{binding:2,resource:{buffer:params}}]});
          const b2=device.createBindGroup({layout:vp.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:mid}},{binding:1,resource:texture.createView()},{binding:2,resource:{buffer:params}}]});
          let pass=encoder.beginComputePass(); pass.setPipeline(hp);pass.setBindGroup(0,b1);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(meta.raw_height/8));pass.end();
          pass=encoder.beginComputePass();pass.setPipeline(vp);pass.setBindGroup(1,b2);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();
        }
        device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        for (const entry of made) cache.set(entry.meta.key,entry);
        trim(new Set(sizes.map(size=>size.key)));
        // Only a tiny thumbnail is read back, after the full-size scene is ready.
        const thumb=sizes.find(size=>size.edge<=512), entry=thumb && cache.get(thumb.key);
        if (entry && thumb.edge <= 512) void saveThumbnail(entry,meta.transport_key).catch(error=>console.debug('Library thumbnail:',error.message));
        HDRLibraryStopwatch('picture_raw_converted', {...window.HDRLibraryPictureLog?.(meta),key:meta.key,duration_ms:performance.now()-started});
        return get(meta.key);
      } catch(error) { for(const entry of made) { cache.delete(entry.meta.key); entry.texture.destroy(); } throw error;
      } finally { resources.forEach(resource=>resource.destroy()); }
    }
    async function saveThumbnail(entry,key) {
      const {width,height}=entry.meta, stride=Math.ceil(width*8/256)*256;
      const buffer=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try {
        const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:entry.texture},{buffer,bytesPerRow:stride},[width,height]);device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);const body=buffer.getMappedRange().slice(0);buffer.unmap();
        const response=await fetch('/api/library/raw-thumbnail/'+key,{method:'POST',body});
        if (!response.ok && response.status !== 409) throw Error('Thumbnail could not be saved.');
      } finally {buffer.destroy();}
    }
    function proxy(meta, lane, entry, geometrySignature, sourceIdentity) {
      return {texture:entry.texture,width:meta.width,height:meta.height,sessionId:meta.key,lane,longEdge:meta.edge,
        workingSpace:'acescg',pixelFormat:'rgba16float',geometrySignature,sourceIdentity,identity:meta.key+':'+lane,
        byteSize:entry.byteSize,bindGroups:new Map(),libraryRetained:true};
    }
    function clear() { for(const key of [...cache.keys()]) remove(key); }
    device.lost.then(clear);
    return {get,convert,proxy,clear,initialize,release:texture=>{for(const [key,entry] of cache) if(entry.texture===texture) remove(key);},owns:texture=>[...cache.values()].some(e=>e.texture===texture),
      configure:limits=>{pictureLimit=limits?.gpu_pictures||10;trim(new Set());},
      snapshot:()=>({pictures:[...cache.values()].filter(e=>e.meta.edge>=1280).length,bytes:[...cache.values()].reduce((n,e)=>n+e.byteSize,0),limitBytes:byteLimit})};
  }
  return {create};
})();
