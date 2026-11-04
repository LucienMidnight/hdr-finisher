/* Stored scenes use Grade's shaders; finishing never changes source identity. */
window.HDRLibraryScenes = (() => {
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, {once:true});
  });
  // Lightweight cache discovery never queues behind full developments. Keep
  // likely lighter work first; expensive work can borrow an otherwise idle slot.
  const changed = (job,state,error) => {
    window.dispatchEvent?.(new Event("library-work-changed"));
    window.HDRLibraryStopwatch?.("picture_work_"+String(state).replaceAll("-","_"),{path:job.path,request:String(job.sequence),
      ...window.HDRLibraryPictureLog?.(job),work_stage:job.stage,duration_ms:performance.now()-(job.loggedAt || performance.now()),reason:error?.message});
    job.loggedAt=performance.now();
  };
  // Source and cache work with a requester must finish. Priority orders the
  // next admission; only abandoned viewport work may be cancelled.
  // Draw scheduling is independent of source ownership.
  const cpuLanes = Math.max(1, Math.floor(Math.sqrt(globalThis.navigator?.hardwareConcurrency || 1)));
  const probes = HDRLibrarySceneScheduler.create(cpuLanes, undefined, {onChange:changed});
  // Explicit preparations finish their cache even if the immediate waiter
  // detaches. Grid and filmstrip demand use viewport ownership.
  const sources = HDRLibrarySceneScheduler.create(cpuLanes, undefined, {
    heavyLimit:cpuLanes,onChange:changed,fifo:true,
    admit:async job=>{
      const gpu=!job.cpuRoute&&HDRLibraryGpuRaw.enabled()&&HDRLibraryGpuRaw.preflight ? await HDRLibraryGpuRaw.preflight(job.gpuMeta,job.edge,job.controller.signal) : {bytes:0,unified:false};
      job.grant=await HDRLibraryGrants.acquire(job.path,!job.cpuRoute&&HDRLibraryGpuRaw.enabled()?"source":"cpu",job.controller.signal,job.priority,job.edge,gpu.bytes,gpu.unified,!!job.front);
      return true;
    },
    keepRunning:job=>job.retainDetached||(job.edge<=640&&visible.has(job.path))});
  const versions = new Map();
  const history = new Map(), generations = new Map();
  let visible = new Set(), nearby = new Set(), reviewPath = null;
  // Priority belongs to the photo, not to the picture size: a 2560 neighbour
  // and its 640 thumbnail must move together when the view changes.
  const rank = path => {const priority=visible.has(path)?10:nearby.has(path)?50:80;window.HDRLibraryGrants?.promote(path,priority);return priority;};
  const largeBytes = 32 * 1024 * 1024;
  function failure(result) {
    const error = result.changed || result.offline ? new DOMException(result.detail,"AbortError") : Error(result.detail || "The photo could not be prepared.");
    if (result.offline) window.dispatchEvent(new CustomEvent("library-offline", {detail:result}));
    error.status = result.status;
    error.libraryError = result.library_error || (result.library_timeout ? {path:result.path,reason:result.detail,timeout:true,time:Date.now()/1000} : undefined);
    return error;
  }
  async function prepared(path, edge, signal, priority, identity, trace = null, options = {}) {
    const checked = performance.now();
    const generation=generations.get(path)||0;
    const plan = await probes.submit(path+"|"+edge+"|"+generation, async shared => {
      const response = await fetch("/api/library/live-plan", {method:"POST",signal:shared,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge})});
      const result = await response.json();
      if (!response.ok) throw failure(result);
      return result;
    }, signal, priority, {path,edge,viewport:!!options.viewportDemand,background:!!options.cachedOnly,log_view:trace?.view,stage:edge <= 640 ? "Checking thumbnail cache" : edge === 100000 ? "Checking detail preview cache" : "Checking screen preview cache"});
    window.HDRLibraryTrace?.mark(trace,"picture_cache_check",checked,{cache_hit:!!plan.cached});
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (generation!==(generations.get(path)||0)) throw new DOMException("Invalidated", "AbortError");
    // An online-only sync file is read (downloaded) only for the opened photo.
    const urgency = typeof priority === "function" ? priority() : priority;
    if (plan.cloud_only && !plan.cached && urgency !== 0) {
      throw Object.assign(Error("Not downloaded: this photo is online-only. Open it to download it."), {cloudOnly:true});
    }
    const version=plan.render_identity || plan.source_identity || plan.revision;
    const sourceVersion=plan.source_identity || version;
    if(versions.has(path)&&versions.get(path)!==sourceVersion)sources.invalidate(candidate=>candidate===path);
    versions.delete(path);versions.set(path,sourceVersion);
    if(versions.size>1024)versions.delete(versions.keys().next().value);
    const direct = HDRLibraryGpuRaw.cachedDirect?.(path,edge,version);
    // A retained direct scene reuses the stored development without reading
    // the disk cache; it is the fastest reuse and reports as a cache hit.
    if (direct) { options.onSourceDemand?.(); return direct.cache_hit ? direct : {...direct, cache_hit:true}; }
    if (plan.cached) { options.onSourceDemand?.(); return plan.cached; }
    if ((plan.unedited_raw || plan.original_file) && edge !== 100000 && !options.develop) {
      const response = await HDRLibraryGrants.preview({path,edge:edge <= 640 ? 640 : 2560,quick_draw:true},signal);
      if (response.status === 200) {
        const camera = await response.json();
        if (plan.original_file || camera.camera_long_edge >= 1024) return {...camera,path,edge,bitmap:true,key:"original:"+sourceVersion.split(":")[0],cache_hit:true,picture_source:plan.original_file ? "original file" : "camera picture"};
      }
    }
    if (options.cachedOnly) return null;
    await options.beforeSource?.();
    if (signal?.aborted) throw new DOMException("Cancelled","AbortError");
    const previous = history.get(path);
    const elapsed = previous && previous.revision === plan.revision ? previous.ms : 0;
    const heavy = plan.bytes >= largeBytes || elapsed >= 2000;
    const cost = elapsed ? elapsed / 1000 : plan.bytes / largeBytes;
    const shareTiers = edge !== 100000;
    const pending = sources.submit((plan.source_identity || identity+"|"+sourceVersion)+"|"+(shareTiers ? "scene" : edge), async (shared, importance, job) => {
      const started = performance.now();
      window.HDRLibraryStopwatch?.("picture_development_start",{path,reason:options.develop ? "Develop command" : edge === 100000 ? "zoom detail" : plan.edited ? "edited" : plan.unedited_raw ? "no usable camera picture" : "HDR non-RAW",view:trace?.view});
      try {
        const result = await HDRLibraryGrants.run(path,!plan.cpu_route&&HDRLibraryGpuRaw.enabled()?"source":"cpu",shared,
          async (grant,owned)=>{
            const run=size=>develop(path,size,owned,importance,version,options.gpuOnly || (priority >= 80 && !visible.has(path)),grant,plan.cpu_route,shareTiers ? job.edges : null);
            if(!shareTiers || (!plan.cpu_route && HDRLibraryGpuRaw.enabled()))return run(edge);
            const tasks=new Map();
            const add=size=>{if(!tasks.has(size)){const task=run(size);task.catch(()=>{});tasks.set(size,task);}};
            job.onTier=add;
            try {
              for(const size of job.edges)add(size);
              let values;
              do {values=await Promise.all([...tasks.values()]);} while(values.length!==tasks.size);
              return values[0];
            } finally {job.onTier=null;}
          },importance,job.grant,{requeueLane:true});
        if (result && signal?.aborted) save(result);
        return result;
      }
      finally {
        if (!shared.aborted) {
          history.delete(path);
          history.set(path, {revision:plan.revision,ms:performance.now()-started});
          if (history.size > 256) history.delete(history.keys().next().value);
        }
      }
    }, signal, priority, {heavy,cost,path,edge,cpuRoute:plan.cpu_route,gpuMeta:plan.gpu_meta,viewport:!!options.viewportDemand,retainDetached:!options.viewportDemand,log_view:trace?.view,stage:"Developing photo"});
    options.onSourceDemand?.();
    const result=await pending;
    if(result && result.path && result.path!==path){
      const response=await fetch('/api/library/live-plan',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({path,edge})});
      const own=await response.json();if(!response.ok)throw failure(own);
      if(own.cached)return own.cached;
    }
    return result;
  }
  // Selected work follows at most the single sharp draw already in flight.
  // Quick draws use thumbnails and their own renderer and priority queue.
  const draws = HDRLibrarySceneScheduler.create(1, undefined, {onChange:changed});
  const quickDraws = HDRLibrarySceneScheduler.create(1, undefined, {onChange:changed});
  function temporary(error) {
    return !!error.libraryError?.timeout || /timeout|timed out|took too long|grant expired|preparation expired|cancelled|canceled|aborted|waiting for memory|upload.*expired|network|failed to fetch|fetch failed|helper stopped|time limit exceeded|stall/i.test(error.message);
  }
  async function load(path, edge, signal, priority = 10, trace = null, options = {}) {
    const generation=generations.get(path)||0;
    for(let attempt=1;;attempt++){
      try { return await loadOnce(path,edge,signal,priority,trace,options); }
      catch(error){
        if(error.name==="AbortError" || signal?.aborted || generation!==(generations.get(path)||0) || error.laneRequeue || error.cloudOnly || error.needsMemory)throw error;
        const retryable=temporary(error);
        if(!retryable && !error.developmentFailure)throw error;
        if(attempt<3){
          window.HDRLibraryStopwatch?.("picture_preparation_retry",{path,attempt,reason:error.message});
          await wait(attempt===1?500:1500,signal);continue;
        }
        if(retryable){
          error.libraryError={path,reason:"Couldn't finish preparing this photo. Try again.",details:error.message,timeout:true,time:Date.now()/1000};
        }else{
          const response=await fetch("/api/library/development-error",{method:"POST",signal,
            headers:{"Content-Type":"application/json"},body:JSON.stringify({path,source_identity:error.developmentFailure,reason:`Development stopped after ${attempt} attempts: ${error.message}`})});
          if(response.ok)error.libraryError=(await response.json()).error;
        }
        throw error;
      }
    }
  }
  async function loadOnce(path, edge, signal, priority = 10, trace = null, options = {}) {
    const generation=generations.get(path)||0;
    const identity = path + (edge === 100000 ? "|native" : "");
    let meta = await prepared(path, edge, signal, priority, identity, trace, options);
    if (!meta) return null;
    // Shared work may return the first tier. Discover the other stored tier
    // without preparing a scene that nobody requested.
    if (meta.edge !== edge) meta = await prepared(path, edge, signal, priority, path+"|"+edge, trace, options);
    if (generation!==(generations.get(path)||0) || signal?.aborted) throw new DOMException("Invalidated", "AbortError");
    return {...meta, draw_priority:priority, trace, log_view:trace?.view || (edge <= 640 ? "grid,filmstrip" : "single,fullscreen,compare")};
  }
  async function develop(path, edge, signal, importance, version, gpuOnly = false, grant = null, cpuRoute = null, edges = null) {
    let rejectedPixels=false;
    if (!cpuRoute && HDRLibraryGpuRaw.enabled()) {
      try {
        const meta = await HDRLibraryGpuRaw.liveScene(path, edge, signal, importance, version, grant, edges);
        if (meta) return meta;
      } catch (error) {
        if (error.name === "AbortError" || error.libraryError || error.libraryRequeue) throw error;
        if (!error.gpuUnavailable) {
          if(!version)throw error;
          error.developmentFailure=version.split(":")[0];
          throw error;
        }
        rejectedPixels=!!error.gpuInvalidPixels;
        window.HDRLibraryStopwatch?.("picture_source_gpu_fallback",{path,reason:error.message});
        // The structured fallback event above carries the picture labels.
        // Release the retained GPU source so the CPU route can claim it.
        HDRLibraryGpuRaw.releaseSource?.(path);
      }
    }
    if (!cpuRoute && !rejectedPixels && (importance() >= 50 || (gpuOnly && importance() > 0))) return null;
    const cpu=async (token,owned)=>{for (;;) {
      const response = await fetch("/api/library/live-scene", {method:"POST",priority:"low",signal:owned,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge,gpu:false,gpu_invalid_pixels:rejectedPixels,priority:importance(),grant:token})});
      if (response.status === 202) { sources.stage(path,"Waiting to develop photo",true); await wait(150, signal); continue; }
      const meta = await response.json();
      if (!response.ok) throw failure(meta);
      window.HDRLibraryStopwatch?.("picture_source_cpu_completed",{path,edge,route:meta.route});
      return meta;
    }};
    if(!cpuRoute && HDRLibraryGpuRaw.enabled()){
      HDRLibraryGrants.release(grant);
      return HDRLibraryGrants.run(path,rejectedPixels?"edge-cpu":"cpu",signal,cpu,importance,null,{requeueLane:rejectedPixels});
    }
    return cpu(grant,signal);
  }
  async function lease(meta, signal, nativeBudget = false, extraBytes = 0) {
    const url = `/api/delivery/gpu/raw-budget/${crypto.randomUUID()}`;
    // Grade's planner still enforces the shared budget. Reserve room for a small
    // picture graph, including its source and transient render targets, plus
    // any one-off GPU work the caller runs inside the lease.
    let bytes = meta.width * meta.height * 64 + 64 * 1024 * 1024 + extraBytes;
    // Native inspection uses Grade's bounded viewport graph. Wait for the
    // broker's existing budget; never increase it or compete with delivery.
    if (nativeBudget) {
      const response = await fetch(url,{method:"POST",signal,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({bytes:0,background:true})});
      if (!response.ok) throw Error("Library GPU scheduling unavailable.");
      bytes = (await response.json()).budget;
      if (!(bytes > 0)) throw Error("Library GPU budget is unavailable.");
    }
    const check = async (acquiring = false) => {
      const response = await fetch(url,{method:"POST",signal,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({bytes,background:true,draw:!nativeBudget,concurrent:true,priority:typeof meta.draw_priority==='function'?meta.draw_priority():meta.draw_priority??10})});
      if (!response.ok) throw Error("Library GPU scheduling unavailable.");
      const value = await response.json();
      if (value.fallback) throw Error(value.fallback);
      if (acquiring && value.granted && value.preempt) {
        await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({bytes,background:true,release:true})});
      }
      return value.granted && !value.preempt;
    };
    const release = () => fetch(url,{method:"DELETE"}).catch(()=>{});
    try { while (!await check(true)) { draws.stage(meta.path,"Waiting to draw preview",true); await wait(50,signal); } draws.stage(meta.path,`Drawing ${meta.edge === 100000 ? "detail preview" : meta.edge <= 640 ? "thumbnail" : "screen preview"}`); }
    catch(error) { await release(); throw error; }
    return {bytes,check:async()=>{ if (!await check()) {const error=Error("Library draw yielded to Grade or delivery.");error.libraryYield=true;throw error;} },release};
  }
  let reclaim = async () => {};
  function save(meta, presented = false) {
    if (meta.bitmap || meta.route === 'stored-screen-preview' || meta.scene_stored) return;
    if (reviewPath === meta.path && !presented) return;
    const started = performance.now();
    void new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))).then(async()=>{
      for(let attempt=1;;attempt++){
        try {
          await meta.directScene?.store();
          const response=await fetch("/api/library/live-store/"+meta.key,{method:"POST"});
          if(!response.ok)throw Object.assign(Error("Preview save failed: "+response.status),{retryStore:response.status>=500});
          window.HDRLibraryTrace?.mark(meta.trace,"picture_store",started,{picture_size:"thumbnail,screen preview",scope:"shared",key:meta.key,success:true});
          return;
        } catch(error){
          window.HDRLibraryStopwatch?.("picture_store_failed",{path:meta.path,attempt,reason:error.message});
          if(attempt>=3 || !(error.retryStore || temporary(error)))throw error;
          await wait(attempt===1?500:1500);
        }
      }
    }).catch(error=>{window.HDRLibraryTrace?.mark(meta.trace,"picture_store",started,{key:meta.key,success:false,reason:error.message});});
  }
  return Object.freeze({load,lease,save,review:path=>{reviewPath=path;},
    onReclaim:handler=>{reclaim=handler;},
    reclaim:(bytes,required=false)=>reclaim(bytes,required),
    promote:(path,priority)=>{probes.promote(path,priority);sources.promote(path,priority);draws.promote(path,priority);quickDraws.promote(path,priority);},
    viewport:(shown,around)=>{visible=new Set(shown);nearby=new Set(around);window.HDRLibraryGrants?.viewport?.([...shown,...around]);sources.reprioritize(rank);probes.reprioritize(rank);},
    invalidate:(paths,{finishingOnly=false}={})=>{const targets=new Set(paths);for(const path of targets){generations.set(path,(generations.get(path)||0)+1);HDRLibraryGpuRaw.forgetDirect?.(path);}if(!finishingOnly)sources.invalidate(path=>targets.has(path));probes.invalidate(path=>targets.has(path));},
    stage:(path,stage,waiting=false)=>sources.stage(path,stage,waiting),
    draw:(task,signal,priority=10,path="Photo",labels={})=>draws.submit(crypto.randomUUID(),task,signal,priority,{path,...labels,stage:`Drawing ${labels.edge === 100000 ? "detail preview" : labels.edge <= 640 ? "thumbnail" : "screen preview"}`}),
    quickDraw:(task,signal,priority=10,path="Photo",labels={})=>quickDraws.submit(crypto.randomUUID(),task,signal,priority,{path,...labels,stage:"Drawing thumbnail for quick draw"}),
    snapshot:()=>({probes:probes.snapshot(),sources:sources.snapshot(),draws:draws.snapshot(),quickDraws:quickDraws.snapshot()})});
})();
