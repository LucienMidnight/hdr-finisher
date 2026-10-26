/* Finished screen previews: persistent Fit pictures, never detail previews. */
window.HDRLibraryScreenPreviews = (() => {
  let pending = 0;
  const captures=[];
  const pipelines = new WeakMap();
  const display = () => ({display_width:Math.min(2560,Math.round(screen.width*(devicePixelRatio||1))),
    display_height:Math.min(2560,Math.round(screen.height*(devicePixelRatio||1)))});
  function query(path,hdr) { return new URLSearchParams({path,lane:hdr?'hdr':'sdr',...display()}); }
  function capture(gpu,meta,canvas,hdr) {
    if (meta.edge !== 2560 || meta.route !== 'library-live' || pending >= 2) return;
    pending++;
    const status={lane:hdr?'hdr':'sdr',stage:'readback'};captures.push(status);if(captures.length>20)captures.shift();
    HDRLibraryStopwatch('picture_stored_screen_preview_capture',{path:meta.path,picture_size:'screen preview'});
    const params = query(meta.path,hdr);
    for (const [key,value] of Object.entries({grade_identity:meta.grade_identity,source_key:meta.source_key,
      source_width:meta.source_width,source_height:meta.source_height})) params.set(key,value);
    // Commands are submitted after the current draw; mapping/HTTP/encoding
    // are deliberately not awaited by the draw or its scene lease.
    void gpu.analyzeScope(canvas,{width:meta.width,height:meta.height,tier:'picture',raw:'rgba',snapshot:true})
      .then(async pixels => {
        status.stage='upload';
        if (!pixels) {console.debug('Stored screen preview: no finished GPU pixels');return;}
        for (const name of ['width','height','stride']) params.set(name,pixels[name]);
        const response = await fetch('/api/library/stored-screen-preview?'+params,{method:'POST',body:pixels.body});
        status.stage='accepted';status.http=response.status;
        if (!response.ok) throw Error('Stored screen preview write refused: '+response.status);
      }).catch(error=>{status.stage='failed';status.error=error.message;console.debug('Stored screen preview:',error.message);}).finally(()=>pending--);
  }
  const shader = `
    override white:f32=203.0;
    @group(0) @binding(0) var picture:texture_2d<u32>;
    @vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
      var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
    }
    fn encode(v:vec3f)->vec3f {let a=abs(v);return sign(v)*select(1.055*pow(a,vec3f(1.0/2.4))-.055,a*12.92,a<=vec3f(.0031308));}
    fn pq(v:vec3f)->vec3f {let p=pow(v,vec3f(1.0/78.84375));return 10000.0*pow(max(p-.8359375,vec3f(0))/max(18.8515625-18.6875*p,vec3f(.000001)),vec3f(1.0/.1593017578125));}
    fn p3(v:vec3f)->vec3f {return vec3f(dot(v,vec3f(1.3435782526,-.2821796705,-.0613985821)),dot(v,vec3f(-.0652974528,1.0757879158,-.0104904631)),dot(v,vec3f(.0028217873,-.0195984945,1.0167767073)));}
    fn aces(v:vec3f)->vec3f {return vec3f(dot(v,vec3f(.9746957086,.0216339017,.0036703891)),dot(v,vec3f(.0016784991,.9977360501,.0005854508)),dot(v,vec3f(.0048862547,.0211319326,.9739818130)));}
    fn srgb(v:vec3f)->vec3f {return vec3f(dot(v,vec3f(1.7048873310,-.6241572745,-.0808867739)),dot(v,vec3f(-.1295209353,1.1383993260,-.0087792418)),dot(v,vec3f(-.0241270599,-.1246206123,1.1488221099)));}
    @fragment fn sdr(@builtin(position) p:vec4f)->@location(0) vec4f {return vec4f(vec3f(textureLoad(picture,vec2i(p.xy),0).rgb)/255.0,1);}
    @fragment fn hdr(@builtin(position) p:vec4f)->@location(0) vec4f {return vec4f(encode(p3(pq(vec3f(textureLoad(picture,vec2i(p.xy),0).rgb)/65535.0)/203.0)),1);}
    @fragment fn hdrSdr(@builtin(position) p:vec4f)->@location(0) vec4f {let rgb=max(srgb(aces(pq(vec3f(textureLoad(picture,vec2i(p.xy),0).rgb)/65535.0)*(.18/white))),vec3f(0));return vec4f(encode(rgb/(vec3f(1)+rgb)),1);}
  `;
  async function load(photo,canvas,signal,current,hdr,admit=async()=>{}) {
    const started=performance.now();
    const response=await fetch('/api/library/stored-screen-preview?'+query(photo.path,hdr),{signal});
    if(response.status===204)return null;
    if(!response.ok)return null;
    const meta={...JSON.parse(response.headers.get('X-Preview-Meta')),route:'stored-screen-preview',edge:2560,cache_hit:true};
    const body=await response.arrayBuffer();
    if(!current()||signal.aborted)throw new DOMException('Invalidated','AbortError');
    const gpu=await HDRLibraryPictures.initialize();
    await admit(meta);
    canvas.width=meta.width;canvas.height=meta.height;
    const context=canvas.getContext('webgpu'),surface=gpu.configureSurface(canvas,context,hdr);
    let cache=pipelines.get(gpu.device);if(!cache){cache=new Map();pipelines.set(gpu.device,cache);}
    const id=surface.format+':'+hdr+':'+meta.white;
    let pipeline=cache.get(id);
    if(!pipeline){const module=gpu.device.createShaderModule({code:shader});pipeline=await gpu.device.createRenderPipelineAsync({layout:'auto',
      vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:hdr?(surface.hdr?'hdr':'hdrSdr'):'sdr',...(!surface.hdr&&hdr?{constants:{white:meta.white}}:{}),targets:[{format:surface.format}]},primitive:{topology:'triangle-list'}});cache.set(id,pipeline);}
    const texture=gpu.device.createTexture({size:[meta.width,meta.height],format:hdr?'rgba16uint':'rgba8uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    try {
      gpu.device.queue.writeTexture({texture},body,{bytesPerRow:meta.width*(hdr?8:4)},[meta.width,meta.height]);
      if(!current()||signal.aborted)throw new DOMException('Invalidated','AbortError');
      const encoder=gpu.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store'}]});
      pass.setPipeline(pipeline);pass.setBindGroup(0,gpu.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()}]}));pass.draw(3);pass.end();
      gpu.device.queue.submit([encoder.finish()]);await gpu.device.queue.onSubmittedWorkDone();
    } finally {texture.destroy();}
    canvas.dataset.picturePath=photo.path;canvas.dataset.pictureEdge='2560';canvas.dataset.pictureKey=meta.key;
    canvas.dataset.rendition=hdr?'hdr':'sdr';
    HDRLibraryStopwatch('picture_stored_screen_preview_draw',{path:photo.path,rendition:hdr?'hdr':'sdr',picture_size:'screen preview',step:'sharp draw',duration_ms:performance.now()-started});
    return meta;
  }
  return Object.freeze({capture,load,display,snapshot:()=>({pending,captures})});
})();
