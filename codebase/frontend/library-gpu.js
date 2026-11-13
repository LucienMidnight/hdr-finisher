/* Independent picture transport; Grade's renderer and pinned shaders are reused unchanged. */
window.clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
// Small exact models survive fullscreen revisits without grid cache churn.
// No pixel arrays or GPU resources are retained by this 16-entry LRU.
const libraryDenoiseModels = new Map();
// The backend's crop of a reduced scene (finishing.apply_geometry): Python's
// half-to-even rounding on the scene size. Null when the result would not be
// the described picture size, so the backend route draws it instead.
function libraryDirectCrop(meta) {
  const crop=meta.adjustments?.shared?.geometry?.crop || {x:0,y:0,width:1,height:1};
  const sceneWidth=meta.scene_width,sceneHeight=meta.scene_height;
  const round=value=>{const floor=Math.floor(value),rest=value-floor;return rest>.5||(rest===.5&&floor%2!==0)?floor+1:floor;};
  const left=Math.min(sceneWidth-1,Math.max(0,round(crop.x*sceneWidth)));
  const top=Math.min(sceneHeight-1,Math.max(0,round(crop.y*sceneHeight)));
  const right=Math.min(sceneWidth,Math.max(left+1,round((crop.x+crop.width)*sceneWidth)));
  const bottom=Math.min(sceneHeight,Math.max(top+1,round((crop.y+crop.height)*sceneHeight)));
  const result={left,top,width:right-left,height:bottom-top};
  return result.width===meta.width && result.height===meta.height ? result : null;
}
const libraryDenoiseMeasurements = HDRLibrarySceneScheduler.create(1);
async function libraryDenoiseModel(url, meta = {}, measure) {
  const priority = typeof meta.draw_priority === 'function' ? meta.draw_priority() : meta.draw_priority ?? 5;
  let model = libraryDenoiseModels.get(url);
  if (model) { libraryDenoiseMeasurements.promote(meta.path,priority); libraryDenoiseModels.delete(url); libraryDenoiseModels.set(url,model); return model; }
  if (!measure) throw Error("Denoise measurement requires the picture renderer.");
  // Keep quick draws independent. Only one large measurement runs at a time;
  // a selected photo moves ahead of queued neighbour measurements.
  model = (meta.edge > 640 ? libraryDenoiseMeasurements.submit(url,measure,undefined,priority,{path:meta.path}) : measure()).catch(error => {
    if (libraryDenoiseModels.get(url) === model) libraryDenoiseModels.delete(url);
    throw error;
  });
  libraryDenoiseModels.set(url,model);
  while (libraryDenoiseModels.size > 16) libraryDenoiseModels.delete(libraryDenoiseModels.keys().next().value);
  return model;
}
// Transport only: reproduce the stored half-float scene and Pillow's bilinear
// source reduction, then pack the requested rectangle. Finishing stays in Grade.
const libraryNativePack = /* wgsl */ `
struct P { raw:vec4<u32>, output:vec4<u32>, region:vec4<u32>, crop:vec4<u32> };
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> red:array<f32>;
@group(0) @binding(2) var<storage,read> green:array<f32>;
@group(0) @binding(3) var<storage,read> blue:array<f32>;
@group(0) @binding(4) var packedOutput:texture_storage_2d<rgba16float,write>;
fn sampleAt(x:u32,y:u32)->vec3<f32>{
  var sx=x;var sy=y;
  if(p.raw.z==6u){sx=y;sy=p.raw.y-1u-x;}
  if(p.raw.z==5u){sx=p.raw.x-1u-y;sy=x;}
  if(p.raw.z==3u){sx=p.raw.x-1u-x;sy=p.raw.y-1u-y;}
  let i=sy*p.raw.x+sx;
  let v=clamp(vec3<f32>(red[i],green[i],blue[i]),vec3<f32>(0),vec3<f32>(65504));
  return vec3<f32>(unpack2x16float(pack2x16float(v.xy)),unpack2x16float(pack2x16float(vec2<f32>(v.z,0))).x);
}
@compute @workgroup_size(16,16)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  if(g.x>=p.region.z || g.y>=p.region.w){return;}
  let scale=vec2<f32>(p.output.xy)/vec2<f32>(p.output.zw);
  let center=(vec2<f32>(g.xy+p.region.xy+p.crop.xy)+vec2<f32>(.5))*scale;
  let support=max(vec2<f32>(1),scale);
  let lo=max(vec2<i32>(0),vec2<i32>(floor(center-support+vec2<f32>(.5))));
  let hi=min(vec2<i32>(p.output.xy),vec2<i32>(floor(center+support+vec2<f32>(.5))));
  var sum=vec3<f32>(0);var total=0.;
  for(var y=lo.y;y<hi.y;y++){for(var x=lo.x;x<hi.x;x++){
    let weight=max(vec2<f32>(0),vec2<f32>(1)-abs((vec2<f32>(f32(x)+.5,f32(y)+.5)-center)/support));
    let w=weight.x*weight.y;sum+=sampleAt(u32(x),u32(y))*w;total+=w;
  }}
  textureStore(packedOutput,vec2<i32>(g.xy),vec4<f32>(sum/max(total,1e-20),1));
}`;
class HDRLibraryGPU extends HDRWebGPUPreview {
  async requestPreviewDevice() {
    try { return (await HDRLibraryGpuRaw.shared.gpu()).device; }
    catch(error) { this.libraryInitializationError=error; throw error; }
  }
  async fetchDenoiseModel(url) {
    return this.libraryMeta?.fullscreen ? libraryDenoiseModel(url,this.libraryMeta,()=>super.fetchDenoiseModel(url)) : super.fetchDenoiseModel(url);
  }
  async reportDeliveryActivity(active) {
    // Every Library rendition is background work, including initialization.
    // Grade activity would pause our own source helper and preempt our leases.
    return {reserved:0};
  }
  resourceMemorySnapshot() {
    const value = super.resourceMemorySnapshot();
    const referenced = new Map([...this.proxies.values()].filter(p => this.rawPictures?.owns(p.texture))
      .map(p => [p.texture, p.byteSize || 0]));
    const extra = Math.max(0, (this.rawPictures?.snapshot().bytes || 0) -
      [...referenced.values()].reduce((a, b) => a + b, 0));
    for (const category of [value.resident, value.cached]) {
      category.categories.libraryRetainedBytes = extra;
      category.totalBytes += extra;
    }
    value.peakLogicalBytes += extra;
    value.totals.residentBytes += extra;
    value.totals.cachedBytes += extra;
    value.totals.peakLogicalBytes += extra;
    return value;
  }
  evictGpuCacheEntry(kind, key) {
    const proxy = kind === "source-proxy" ? this.proxies.get(key) : null;
    if (proxy && this.rawPictures?.owns(proxy.texture)) { this.rawPictures.release(proxy.texture); return; }
    super.evictGpuCacheEntry(kind,key);
  }
  resetSession(sessionId = null) {
    // Retained Library scenes have their own bounded owner. Detach references
    // before Grade's unchanged reset clears its per-picture working resources.
    for (const [key, proxy] of this.proxies) if (this.rawPictures?.owns(proxy.texture)) this.proxies.delete(key);
    super.resetSession(sessionId);
  }
  async ensureDenoiseResolved(...args) {
    const started = performance.now();
    try { return await super.ensureDenoiseResolved(...args); }
    finally { window.HDRLibraryTrace?.mark(this.libraryMeta?.trace,"picture_denoise_resolve",started,window.HDRLibraryPictureLog?.(this.libraryMeta)); }
  }
  async loadDirectMasks(...args) {
    const started = performance.now();
    try { return await super.loadDirectMasks(...args); }
    finally { window.HDRLibraryTrace?.mark(this.libraryMeta?.trace,"picture_local_masks",started,window.HDRLibraryPictureLog?.(this.libraryMeta)); }
  }
  async waitForSubmittedWork(...args) {
    const started = performance.now();
    const result = await super.waitForSubmittedWork(...args);
    HDRLibraryStopwatch("picture_gpu_wait", { ...window.HDRLibraryPictureLog?.(this.libraryMeta), duration_ms: performance.now() - started });
    return result;
  }
  async measureToneAdjustedPeak(...args) {
    const started = performance.now();
    const result = await super.measureToneAdjustedPeak(...args);
    HDRLibraryStopwatch("picture_peak_analysis", { ...window.HDRLibraryPictureLog?.(this.libraryMeta), duration_ms: performance.now() - started });
    return result;
  }
  async resolveHighlightAnchor(...args) {
    const started = performance.now();
    // These bounded scenes have no Grade scheduler to answer the canonical
    // anchor event. Measure their SDR prefix just as CPU finishing does.
    const [anchor,proxy,params,options] = args;
    const result = this.liveMode && options?.lane === 'sdr'
      ? await this.measureToneAdjustedPeak(proxy,params,anchor.measurement,anchor.key)
      : await super.resolveHighlightAnchor(...args);
    HDRLibraryStopwatch("picture_highlight_analysis", { ...window.HDRLibraryPictureLog?.(this.libraryMeta), duration_ms: performance.now() - started });
    return result;
  }
  pipelineFor(format, factory = null) {
    const started = performance.now();
    let result;
    if (factory || this.pipelines.has(format)) result = super.pipelineFor(format,factory);
    else {
      const staged = super.pipelineFor(format,descriptor=>({descriptor}));
      this.libraryPipelineTokens ||= new Map();
      this.libraryPipelineTokens.set(format,staged);
      result = {};
      for (const [name,token] of Object.entries(staged)) Object.defineProperty(result,name,{
        enumerable:true,get:()=>{
          if(!token.pipeline){
            if(token.pending)throw Error('Library pipeline must finish preparation before drawing.');
            token.pipeline=this.device.createRenderPipeline(token.descriptor);HDRLibraryStopwatch("picture_pipeline_demand",{name,format,path:this.libraryMeta?.path});
          }
          return token.pipeline;
        }
      });
      this.pipelines.set(format,result);
    }
    HDRLibraryStopwatch("picture_pipeline", { ...window.HDRLibraryPictureLog?.(this.libraryMeta), duration_ms: performance.now() - started });
    return result;
  }
  async prepareLibraryDraw() {
    for (const format of new Set([navigator.gpu.getPreferredCanvasFormat(),'rgba16float']))
      await this.prepareLibraryPipelines(format);
  }
  async renderTo(...args) {
    await this.prepareLibraryDraw();
    return super.renderTo(...args);
  }
  async renderTiledTo(...args) {
    await this.prepareLibraryDraw();
    return super.renderTiledTo(...args);
  }
  async prepareLibraryPipelines(format, names, beforeNext = async()=>{}) {
    const pipelines=this.pipelineFor(format);
    const tokens = this.libraryPipelineTokens?.get(format);
    if (!tokens) return;
    for (const name of names || Object.keys(tokens)) {
      await beforeNext();
      if(this.pipelines.get(format)!==pipelines)return;
      const token=tokens[name];
      if (!token || token.pipeline) continue;
      if(!token.pending){const started=performance.now();token.pending=this.device.createRenderPipelineAsync(token.descriptor).then(pipeline=>{
        HDRLibraryStopwatch('picture_pipeline_prepared',{name,format,duration_ms:performance.now()-started});return token.pipeline ||= pipeline;
      }).catch(error=>{token.pending=null;throw error;});}
      await token.pending;
    }
  }
  async warmPipelines(format, beforeNext) {
    return this.prepareLibraryPipelines(format,null,beforeNext);
  }
  async nativeDirectProxy(sessionId,lane,longEdge,geometrySignature,sourceIdentity,key,region=null) {
    const meta=this.libraryMeta,direct=meta?.directScene;
    if(!direct?.native)return null;
    const planes=direct.planes?.();
    if(!planes?.length || direct.device!==this.device)throw Object.assign(Error('Selected GPU scene released before drawing.'),{libraryYield:true});
    const scale=Math.min(1,Math.max(256,longEdge)/Math.max(meta.scene_width,meta.scene_height));
    const crop=meta.adjustments.shared.geometry.crop || {x:0,y:0,width:1,height:1};
    const round=v=>{const f=Math.floor(v);return v-f>.5||(v-f===.5&&f%2)?f+1:f;};
    const sw=Math.max(1,round(meta.scene_width*scale)),sh=Math.max(1,round(meta.scene_height*scale));
    const left=Math.min(sw-1,Math.max(0,round(crop.x*sw))),top=Math.min(sh-1,Math.max(0,round(crop.y*sh)));
    const width=Math.min(sw,Math.max(left+1,round((crop.x+crop.width)*sw)))-left;
    const height=Math.min(sh,Math.max(top+1,round((crop.y+crop.height)*sh)))-top;
    const r=region ? {x:Math.max(0,region.x),y:Math.max(0,region.y),width:Math.min(width-region.x,region.width),height:Math.min(height-region.y,region.height)} : {x:0,y:0,width,height};
    if(r.width<=0||r.height<=0)return null;
    if(!this.nativePackPipeline){
      const module=this.device.createShaderModule({code:libraryNativePack});
      const info=await module.getCompilationInfo();
      const errors=info.messages.filter(m=>m.type==='error');
      if(errors.length)throw Error(errors.map(m=>m.lineNum+': '+m.message).join('; '));
      this.nativePackPipeline=await this.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    }
    // Re-check after asynchronous compilation: hand-over can have dropped planes.
    if(!direct.planes?.()?.length)throw Object.assign(Error('Selected GPU scene released before drawing.'),{libraryYield:true});
    const texture=this.device.createTexture({size:[r.width,r.height],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
    const params=this.device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const authored=lane==='sdr' && meta.adjustments.sdr.use_authored_base && meta.has_reference;
    try{
      this.device.queue.writeBuffer(params,0,new Uint32Array([direct.rawWidth,direct.rawHeight,direct.flip,0,meta.scene_width,meta.scene_height,sw,sh,r.x,r.y,r.width,r.height,left,top,width,height]));
      const bindings=[{buffer:params},...planes.slice(authored?3:0,authored?6:3).map(p=>({buffer:p.gpuBuffer})),texture.createView()];
      const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();
      pass.setPipeline(this.nativePackPipeline);pass.setBindGroup(0,this.device.createBindGroup({layout:this.nativePackPipeline.getBindGroupLayout(0),entries:bindings.map((resource,binding)=>({binding,resource}))}));
      pass.dispatchWorkgroups(Math.ceil(r.width/16),Math.ceil(r.height/16));pass.end();this.device.queue.submit([encoder.finish()]);
    }catch(error){texture.destroy();throw error;}finally{params.destroy();}
    const proxy={texture,width,height,...(region?{region:r,textureWidth:r.width,textureHeight:r.height,regionTransport:true,streamed:true}:{}),
      sessionId,lane,longEdge,workingSpace:authored?'linear-srgb':'acescg',pixelFormat:'rgba16float',geometrySignature,sourceIdentity,identity:key,byteSize:r.width*r.height*8,bindGroups:new Map()};
    this.proxies.set(key,proxy);
    this.recordAllocation('source-proxy',proxy.byteSize,{width:r.width,height:r.height,lane,longEdge,pixelFormat:'rgba16float',region:!!region});
    HDRLibraryStopwatch('picture_direct_native',{path:meta.path,region:!!region,bytes:proxy.byteSize});
    return proxy;
  }
  async loadProxyRegion(sessionId,lane,longEdge,geometrySignature,revision,sourceIdentity,key,region,options={}) {
    return await this.nativeDirectProxy(sessionId,lane,longEdge,geometrySignature,sourceIdentity,key,region)
      || super.loadProxyRegion(sessionId,lane,longEdge,geometrySignature,revision,sourceIdentity,key,region,options);
  }
  async holdSourceForPanning(...args) {
    if(this.libraryMeta?.directScene?.native && this.libraryMeta.directScene.planes?.()?.length)return true;
    return super.holdSourceForPanning(...args);
  }
  async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", revision = 0, sourceIdentity = "source", options = {}) {
    if (this.libraryMeta?.edge === 100000 && this.liveMode) {
      const base=`${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}`;
      const region=options.region;
      // The first viewport pass has only a Fit presentation. Its requested
      // frame size is authoritative for our planes; the shared transport's
      // whole-frame retry must not allocate another full-size source texture.
      if(!region && this.libraryMeta.directScene?.native && longEdge>=Math.max(this.libraryMeta.scene_width,this.libraryMeta.scene_height)) {
        const regional=[...this.proxies.values()].find(p=>p.identity.startsWith(base+':region:'));
        if(regional)return regional;
      }
      const key=base+(region?`:region:${region.x},${region.y},${region.width},${region.height}`:'');
      return this.proxies.get(key) || await this.nativeDirectProxy(sessionId,lane,longEdge,geometrySignature,sourceIdentity,key,region)
        || super.loadProxy(sessionId,lane,longEdge,geometrySignature,revision,sourceIdentity,options);
    }
    const key = this.libraryMeta?.route === "library-live" ? `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}` : `${sessionId}:${lane}`;
    if (this.proxies.has(key)) return this.proxies.get(key);
    if (["camera-raw-gpu", "gpu-raw-thumbnail"].includes(this.libraryMeta?.route)) {
      this.rawPictures ||= HDRLibraryRawGPU.create(this);
      this.rawPictures.configure(this.libraryLimits);
      const entry = await this.rawPictures.convert(this.libraryMeta, this.librarySignal);
      const proxy = this.rawPictures.proxy(this.libraryMeta, lane, entry, geometrySignature, sourceIdentity);
      this.proxies.set(key, proxy);
      return proxy;
    }
    const direct=this.libraryMeta?.directScene, cropped=direct && libraryDirectCrop(this.libraryMeta);
    const retained=cropped && direct.texture(lane);
    if(retained && direct.device===this.device){
      const {left,top,width,height}=cropped;
      const texture=this.device.createTexture({size:[width,height],format:"rgba16float",
        usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
      const encoder=this.device.createCommandEncoder();encoder.copyTextureToTexture({texture:retained,origin:{x:left,y:top}},{texture},[width,height]);
      this.device.queue.submit([encoder.finish()]);
      const proxy={texture,width,height,sessionId,lane,longEdge,workingSpace:lane==="sdr" && this.libraryMeta.adjustments.sdr.use_authored_base && this.libraryMeta.has_reference ? "linear-srgb" : "acescg",
        pixelFormat:"rgba16float",geometrySignature,sourceIdentity,identity:key,byteSize:width*height*8,bindGroups:new Map()};
      this.proxies.set(key,proxy);
      HDRLibraryStopwatch("picture_direct_scene",{...window.HDRLibraryPictureLog?.(this.libraryMeta),key:sessionId});
      return proxy;
    }
    const planes=cropped && direct.planes?.();
    if(planes?.length && typeof Float16Array !== 'undefined'){
      const started=performance.now(),{left,top,width,height}=cropped;
      const authored=lane==="sdr" && this.libraryMeta.adjustments.sdr.use_authored_base && this.libraryMeta.has_reference;
      const source=planes.slice(authored?3:0,authored?6:3).map(p=>direct.sampleBytes===2 ? new Float16Array(p) : new Float32Array(p));
      const rgba=new Float16Array(width*height*4),rw=direct.rawWidth,rh=direct.rawHeight;
      for(let oy=0;oy<height;oy++)for(let ox=0;ox<width;ox++){
        const x=ox+left,y=oy+top,j=(oy*width+ox)*4;
        const sx=direct.flip===6 ? y : direct.flip===5 ? rw-1-y : direct.flip===3 ? rw-1-x : x;
        const sy=direct.flip===6 ? rh-1-x : direct.flip===5 ? x : direct.flip===3 ? rh-1-y : y;
        const i=sy*rw+sx;
        for(let c=0;c<3;c++)rgba[j+c]=Math.min(65504,Math.max(0,source[c][i]));
        rgba[j+3]=1;
      }
      const texture=this.device.createTexture({size:[width,height],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
      this.device.queue.writeTexture({texture},rgba,{bytesPerRow:width*8},[width,height]);
      const proxy={texture,width,height,sessionId,lane,longEdge,workingSpace:authored?'linear-srgb':'acescg',pixelFormat:'rgba16float',geometrySignature,sourceIdentity,identity:key,byteSize:rgba.byteLength,bindGroups:new Map()};
      this.proxies.set(key,proxy);
      HDRLibraryStopwatch('picture_direct_scene',{...window.HDRLibraryPictureLog?.(this.libraryMeta),duration_ms:performance.now()-started,key:sessionId});
      return proxy;
    }
    if(direct)await direct.store();
    const started = performance.now();
    const url = this.libraryMeta?.route === "library-live" ? `/api/library/live-pixels/${sessionId}?lane=${lane}` : this.libraryMeta?.route === "camera-raw-scene" ? `/api/library/raw-thumbnail/${sessionId}` : `/api/library/pixels/${sessionId}?lane=${lane}`;
    const response = await fetch(url, { signal: this.librarySignal });
    if (!response.ok) throw new Error("The cached preview is unavailable; revisit this photo.");
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const stride = Number(response.headers.get("X-Bytes-Per-Row"));
    const body = await response.arrayBuffer();
    HDRLibraryStopwatch("picture_pixels_fetched", { ...window.HDRLibraryPictureLog?.(this.libraryMeta), key: sessionId, duration_ms: performance.now() - started });
    this.libraryFetchMs = (this.libraryFetchMs || 0) + performance.now() - started;
    window.HDRLibraryTrace?.mark(this.libraryMeta?.trace,"picture_pixel_fetch",started,{...window.HDRLibraryPictureLog?.(this.libraryMeta),key:sessionId});
    if (options.isCurrent?.() === false) return null;
    const uploaded = performance.now();
    const texture = this.device.createTexture({ size: [width, height], format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    this.device.queue.writeTexture({ texture }, body, { bytesPerRow: stride, rowsPerImage: height }, [width, height]);
    this.libraryUploadMs = (this.libraryUploadMs || 0) + performance.now() - uploaded;
    window.HDRLibraryTrace?.mark(this.libraryMeta?.trace,"picture_upload",uploaded,{...window.HDRLibraryPictureLog?.(this.libraryMeta),key:sessionId});
    const proxy = { texture, width, height, sessionId, lane, longEdge,
      workingSpace: response.headers.get("X-Working-Space"), pixelFormat: "rgba16float",
      geometrySignature, sourceIdentity, identity: key, byteSize: body.byteLength, bindGroups: new Map() };
    this.proxies.set(key, proxy);
    return proxy;
  }
}
const HDRLibraryPictureFactory = (quick = false) => {
  const surface = document.createElement("canvas");
  let renderer, ready, queue = Promise.resolve(), draws = 0, foreground = 0;
  let configuredLimits;
  let initializationDemand = false;
  async function initialize(warm = false, beforeNext = async () => {}) {
    if (!warm) initializationDemand = true;
    if (renderer && !renderer.available && renderer.deviceLost) {
      clearInterval(renderer.deliveryActivityTimer); ready = null; renderer = null;
    }
    if (!ready) ready = (async () => {
      const started = performance.now();
      renderer = new HDRLibraryGPU(surface);
      renderer.libraryLimits = configuredLimits;
      // Auto is half of the active card's dedicated video memory, the same
      // rule Grade follows. Without it this renderer kept the 2 GiB policy
      // fallback, and the scheduler held every Library development to a
      // fraction of the real GPU budget.
      const desktop = window.hdrFinisherDesktop || window.parent?.hdrFinisherDesktop;
      const videoMemory = await Promise.resolve(desktop?.videoMemory?.()).catch(() => null);
      renderer.setDetectedVideoMemory(videoMemory?.detected ? videoMemory : null);
      if (!await renderer.initialize(() => beforeNext(() => initializationDemand))) {
        const error=renderer.libraryInitializationError || new Error(renderer.detail || "Library GPU initialization did not finish.");
        if (!navigator.gpu || renderer.detail === "No WebGPU adapter was returned" || renderer.deviceLost) error.gpuUnavailable=true;
        throw error;
      }
      if (renderer.adapterInfo?.fallback) {
        clearInterval(renderer.deliveryActivityTimer);
        const device = renderer.device; renderer.device = null; device?.destroy();
        throw Object.assign(Error("Drawing Library previews requires a hardware GPU."),{gpuUnavailable:true});
      }
      HDRLibraryStopwatch("picture_renderer_setup", { duration_ms: performance.now() - started });
      return renderer;
    })();
    try { return await ready; } catch (error) { ready = null; throw error; }
  }
  let preparingScreen;
  function prepareScreen(hdr = false) {
    const format=hdr && window.matchMedia?.('(dynamic-range: high)').matches ? 'rgba16float' : navigator.gpu.getPreferredCanvasFormat();
    if (preparingScreen?.format === format) return preparingScreen.promise;
    const promise=initialize().then(gpu=>gpu.prepareLibraryPipelines(format,['base','finish','response','scan','local','localCandidate','hslFields','hslMask']));
    preparingScreen={format,promise};
    promise.catch(()=>{if(preparingScreen?.promise===promise)preparingScreen=null;});
    return promise;
  }
  function show(meta, canvas, signal, isCurrent, hdr = false) {
    hdr = Boolean(hdr && !meta.unedited_raw);
    if (meta.bitmap) return (async()=>{
      const image = new Image(); image.src = meta.url; await image.decode();
      if (signal.aborted || !isCurrent()) throw new DOMException("Cancelled","AbortError");
      canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      canvas.getContext("2d").drawImage(image,0,0);
      canvas.style.dynamicRangeLimit="standard";canvas.dataset.rendition="sdr";
      canvas.dataset.picturePath=meta.path;canvas.dataset.pictureKey=meta.key;canvas.dataset.cameraPreview="true";
      if(meta.picture_source==="camera picture")window.HDRLibraryTrace?.mark(meta.trace,"picture_camera_preview_decoded",performance.now(),{picture_size:"camera preview",route:meta.route});
      HDRLibraryStopwatch("picture_shown",{path:meta.path,route:meta.route,reason:meta.picture_source,view:meta.log_view});
    })();
    const queued = performance.now();
    foreground++;
    const originalCurrent = isCurrent, originalSignal = signal;
    const render = async (shared = originalSignal) => {
      signal = shared === originalSignal ? originalSignal : AbortSignal.any([originalSignal,shared]);
      isCurrent = () => !signal.aborted && originalCurrent();
      if (signal.aborted || !isCurrent()) return;
      HDRLibraryStopwatch("picture_draw_dispatched", { ...window.HDRLibraryPictureLog?.(meta), key: meta.key, queue_ms: performance.now() - queued });
      window.HDRLibraryTrace?.mark(meta.trace,"picture_queue_wait",Math.max(queued,meta.trace?.started || queued),{...window.HDRLibraryPictureLog?.(meta),key:meta.key});
      const gpu = await initialize();
      if (signal.aborted || !isCurrent()) return;
      // Keep the accepted frame at its own shape while conversion and pixels load.
      // renderTo resizes through its presentation gate when the new frame is ready.
      gpu.liveMode = meta.route === "library-live";
      if (gpu.liveMode && gpu.adapterInfo?.fallback) throw Object.assign(Error("Drawing Library previews requires a hardware GPU."),{gpuUnavailable:true});
      if (!gpu.liveMode && !gpu.deliveryActivityTimer) {
        gpu.deliveryActivityTimer = setInterval(()=>gpu.reportDeliveryActivity().catch(()=>{}),100);
      }
      gpu.librarySignal = signal;
      gpu.libraryMeta = meta;
      if (meta.route === "camera-raw-gpu" && !gpu.rawPictures?.get(meta.key)) {
        gpu.rawPictures ||= HDRLibraryRawGPU.create(gpu);
        gpu.rawPictures.configure(gpu.libraryLimits);
        await gpu.rawPictures.convert(meta, signal);
        if (signal.aborted || !isCurrent()) return;
      }
      const adjustments = structuredClone(meta.adjustments);
      adjustments.hdr.highlight_compression_target_nits = 1000;
      const started = performance.now();
      const native = meta.edge === 100000 && gpu.liveMode;
      const leasing = performance.now();
      const lease = meta.route === "library-live" ? await HDRLibraryScenes.lease(meta, signal, native) : null;
      window.HDRLibraryTrace?.mark(meta.trace,"picture_lease_wait",leasing,{...window.HDRLibraryPictureLog?.(meta),key:meta.key});
      if (lease) { clearInterval(gpu.deliveryActivityTimer); gpu.deliveryActivityTimer = null; }
      let result, refusal, thumbnailSave;
      if (!quick && meta.edge === 2560) await prepareScreen(hdr);
      const rendering = performance.now();
      gpu.libraryFetchMs = 0; gpu.libraryUploadMs = 0;
      const previousBudget = gpu.deliveryBudgetBytes;
      try {
      if (gpu.liveMode && gpu.sessionId !== meta.key) gpu.resetSession(meta.key);
      const lane = hdr ? "hdr" : "sdr", denoise = meta.denoise?.[lane];
      if (native) {
        gpu.deliveryBudgetBytes = Math.min(gpu.memoryBudgetBytes(),lease.bytes);
        gpu.gpuAllocator?.setBudget(gpu.memoryBudgetBytes());
        // Establish this scene's working space at Fit before Grade requests a
        // native region. The offscreen canvas is swapped only after detail is ready.
        await gpu.renderTo(canvas,meta.key,lane,adjustments,sampleCurvePoints,2560,meta.locals || [],0,null,meta.white,
          {width:meta.width,height:meta.height},{isCurrent,beforeDeliverySubmit:lease.check});
      }
      const edge = native ? Math.max(meta.scene_width,meta.scene_height,meta.width,meta.height) : Math.max(256,meta.edge);
      if (denoise?.enabled) {
        const analysis = performance.now();
        if (!await gpu.analyzeDenoiseProxy(meta.key,lane,adjustments,edge,0,"source",denoise.controls)) throw Error("Library Denoise analysis failed.");
        window.HDRLibraryTrace?.mark(meta.trace,"picture_denoise_analysis",analysis,{...window.HDRLibraryPictureLog?.(meta),key:meta.key});
      } else if (gpu.denoiseSourceSelector) gpu.denoiseSourceSelector.selected = "original";
      result = await gpu.renderTo(canvas, meta.key, lane, adjustments,
        sampleCurvePoints, edge, meta.locals || [], 0, null, meta.white,
        { width: meta.width, height: meta.height }, { scopeAnalysis: !native, isCurrent,
          ...(native ? {viewport:meta.viewport,frameSize:{width:meta.width,height:meta.height}} : {}),
          onPresented:texture=>{thumbnailSave=window.HDRLibraryFinishedThumbnails?.capture(gpu,meta,texture,hdr,isCurrent);},
          ...(lease ? {beforeDeliverySubmit:lease.check} : {}) });
      if (native && result?.rendered && isCurrent() && !signal.aborted) {
        // Retain only the visible crop after Grade finishes its frame-anchored
        // viewport graph. The full presentation target is released below.
        const r = meta.viewport, context = canvas.getContext("webgpu");
        await lease.check();
        canvas.width = r.width; canvas.height = r.height;
        gpu.configureSurface(canvas,context,hdr);
        const encoder = gpu.device.createCommandEncoder();
        encoder.copyTextureToTexture({texture:gpu.presentationTarget.texture,origin:{x:r.x,y:r.y}},
          {texture:context.getCurrentTexture()},[r.width,r.height]);
        gpu.device.queue.submit([encoder.finish()]);
      }
      HDRLibraryStopwatch("picture_gpu_encoding",{...window.HDRLibraryPictureLog?.(meta),path:meta.path,duration_ms:performance.now()-rendering});
      await gpu.waitForSubmittedWork();
      if(meta.handoff)await thumbnailSave;
      if (result?.rendered || result?.execution === "direct")
        if(meta.buildPreview || meta.handoff)await window.HDRLibraryScreenPreviews.capture(gpu,meta,canvas,hdr);
        else window.HDRLibraryScreenPreviews?.capture(gpu,meta,canvas,hdr);
      window.HDRLibraryTrace?.mark(meta.trace,"picture_render",rendering,{...window.HDRLibraryPictureLog?.(meta),key:meta.key,
        duration_ms:performance.now()-rendering-gpu.libraryFetchMs-gpu.libraryUploadMs});
      refusal = gpu.lastRenderRefusal?.reason;
      } finally {
        if (native) { gpu.deliveryBudgetBytes = previousBudget; gpu.gpuAllocator?.setBudget(gpu.memoryBudgetBytes()); }
        if (lease) { if (native) gpu.resetSession(null); await lease.release(); }
      }
      if (signal.aborted || !isCurrent()) return;
      if (!result?.rendered && result?.execution !== "direct") throw new Error("The Library preview could not be drawn: " + (result?.reason || refusal || "render refused"));
      window.HDRLibraryTrace?.mark(meta.trace,"picture_draw_complete",started,{...window.HDRLibraryPictureLog?.(meta),key:meta.key,route:meta.route,cache_hit:!!meta.cache_hit});
      HDRLibraryStopwatch("picture_drawn", { ...window.HDRLibraryPictureLog?.(meta), key: meta.key, duration_ms: performance.now() - started, first: draws++ === 0, kept: false });
      let route=canvas.parentElement?.querySelector('.library-retouch-route');
      if(meta.repair_fallback_reason){
        if(!route){route=document.createElement('span');route.className='library-retouch-route';route.style.cssText='position:absolute;bottom:0;left:0;right:0;background:#332819;color:#fff;font:var(--font-size-xs) var(--font-body);padding:4px;z-index:2';canvas.after(route);}
        route.textContent=meta.path.split(/[\\/]/).at(-1)+' · '+meta.repair_fallback_reason;
      }else route?.remove();
      canvas.dataset.rendition = hdr ? "hdr" : "sdr";
      canvas.dataset.surface = gpu.surfaceKeys.get(canvas);
      canvas.dataset.peakNits = hdr ? "1000" : "203";
      // Fullscreen saves after publishing both draws; grid saves
      // after its thumbnail. The request owns no GPU reservation while saving.
      if (meta.route === "library-live" && !meta.fullscreen)
        HDRLibraryScenes.save(meta);
      return result;
    };
    const priority = typeof meta.draw_priority === "function" ? meta.draw_priority() : meta.draw_priority ?? 10;
    const logLabels = {edge:meta.edge,log_view:meta.trace?.view || meta.log_view,log_step:meta.log_step};
    const pending = (quick ? HDRLibraryScenes.quickDraw(render,signal,priority,meta.path,logLabels) : meta.route === "library-live" ? HDRLibraryScenes.draw(render,signal,priority,meta.path,logLabels)
      : queue.catch(()=>{}).then(()=>render())).finally(() => { foreground--; });
    queue = pending;
    return pending.then(value => {
      if (!originalSignal.aborted && signal.aborted) { const error = Error("Library draw yielded to fullscreen."); error.libraryYield = true; throw error; }
      return value;
    }).catch(error => {
      if (!originalSignal.aborted && signal.aborted) {
        const yielded = Error("Library draw yielded to fullscreen."); yielded.libraryYield = true; throw yielded;
      }
      throw error;
    });
  }
  function prepare(meta, signal, isCurrent = () => true) {
    window.HDRIdleWarmup?.touch();
    const task = queue.catch(() => {}).then(async () => {
      if (signal.aborted || !isCurrent()) return;
      const gpu = await initialize();
      gpu.rawPictures ||= HDRLibraryRawGPU.create(gpu);
      gpu.rawPictures.configure(gpu.libraryLimits);
      return gpu.rawPictures.convert(meta, signal);
    }); queue = task; return task;
  }
  window.HDRIdleWarmup?.run(quick ? "library-quick" : "library", async beforeNext => {
    await beforeNext();
    const gpu = await initialize(true, beforeNext);
    if (gpu.adapterInfo?.fallback) return;
    for(const format of [navigator.gpu.getPreferredCanvasFormat(),"rgba16float"]) {
      await gpu.prepareLibraryPipelines(format,['finish','base','response','scan','local','localCandidate','hslFields','hslMask'],beforeNext);
    }
    if(!quick) {
      await HDRLibraryRGB.warmup(beforeNext);
      await HDRLibraryGpuRaw.warmup(beforeNext);
    }
    await gpu.warmPipelines("rgba16float", beforeNext);
    await gpu.warmPipelines(navigator.gpu.getPreferredCanvasFormat(), beforeNext);
    await beforeNext();
    await window.HDRDenoiseMeasurement?.warm(gpu.device);
    await beforeNext();
    await gpu.ensureAdaptiveDenoisePipelines(beforeNext);
    await beforeNext();
    await window.HDRGpuMaskResample?.warm(gpu,beforeNext);
    if (quick) return; // Quick scenes never develop RAW sensors.
    await beforeNext();
    gpu.rawPictures ||= HDRLibraryRawGPU.create(gpu);
    await gpu.rawPictures.initialize();

  }, () => foreground > 0);
  let readyClient;
  let readyReports = Promise.resolve();
  function readyMemory(bytes) {
    const report = readyReports.catch(()=>{}).then(async () => {
      const gpu = await initialize();
      // Publish the configured budget before shared deductions, as Grade does.
      const previous = gpu.deliveryBudgetBytes; gpu.deliveryBudgetBytes = null;
      const budget = gpu.memoryBudgetBytes(); gpu.deliveryBudgetBytes = previous;
      const response = await fetch("/api/delivery/gpu/activity", {method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:readyClient ||= "library-ready-" + crypto.randomUUID(),active:false,bytes:bytes+(HDRLibraryGpuRaw.directBytes?.() || 0),budget})});
      if (!response.ok) throw Error("Ready window accounting unavailable.");
      return (await response.json()).budget;
    });
    readyReports = report; return report;
  }
  async function prepareDenoise(meta, hdr, trace) {
    hdr = Boolean(hdr && !meta.unedited_raw);
    const lane = hdr ? "hdr" : "sdr";
    if (!meta.denoise?.[lane]?.enabled) return;
    const started = performance.now();
    const geometry = JSON.stringify(meta.adjustments?.shared?.geometry || {});
    const url = `/api/session/${meta.key}/denoise-model/${lane}?long_edge=${Math.max(256,meta.edge)}&edit_revision=0&geometry_signature=${encodeURIComponent(geometry)}`;
    const cached = libraryDenoiseModels.has(url);
    const gpu = await initialize();
    await libraryDenoiseModel(url,meta,async()=>{
      const response=await fetch(url.replace("/denoise-model/","/denoise-measurement/"));
      if(response.status===200)return response.json();
      if(!response.ok)throw Error(`Denoise measurement request failed (${response.status}).`);
      // The GPU measurement holds eight 16-byte-per-sample buffers over at most
      // 4 MP (denoise-measurement.js). Without room for them it fell back to
      // the CPU, about 2 s for a screen preview.
      const measured=Math.min(4194304,(meta.width||0)*(meta.height||0));
      const lease=await HDRLibraryScenes.lease(meta,undefined,meta.edge===100000,meta.edge===100000?0:measured*16*8+16*1024*1024);
      const previous=gpu.deliveryBudgetBytes;
      try {
        gpu.deliveryBudgetBytes=Math.min(gpu.memoryBudgetBytes(),lease.bytes);
        return await HDRWebGPUPreview.prototype.fetchDenoiseModel.call(gpu,url);
      } finally {gpu.deliveryBudgetBytes=previous;await lease.release();}
    });
    window.HDRLibraryTrace?.mark(typeof trace === "function" ? trace() : trace,"picture_denoise_prepare",started,{...window.HDRLibraryPictureLog?.(meta),key:meta.key,cache_hit:cached});
  }
  async function reclaimHost() {
    if (!renderer || foreground) return;
    const idle = queue;
    await idle.catch(()=>{});
    if (foreground || queue !== idle) return;
    const before=renderer.resourceMemorySnapshot().resident.totalBytes;
    renderer.rawPictures?.clear();
    renderer.resetSession(null);
    renderer.libraryMeta = null;
    return Math.max(0,before-renderer.resourceMemorySnapshot().resident.totalBytes);
  }
  return Object.freeze({ show, initialize, prepare, prepareScreen, prepareDenoise, readyMemory, reclaimHost,
    configure: async limits => { configuredLimits = limits; if (renderer) renderer.libraryLimits = limits; },
    lost: () => !!renderer?.deviceLost,
    usable: () => !!renderer?.available && !renderer.deviceLost && !renderer.adapterInfo?.fallback,
    resident: key => !!renderer?.rawPictures?.get(key),
    snapshot: () => renderer?.rawPictures?.snapshot() || {pictures:0,bytes:0} });
};
window.HDRLibraryPictures = HDRLibraryPictureFactory();
window.HDRLibraryQuickPictures = HDRLibraryPictureFactory(true);
