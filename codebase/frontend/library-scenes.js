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
    window.HDRLibraryStopwatch?.("picture_work_"+state,{path:job.path,request:String(job.sequence),
      ...window.HDRLibraryPictureLog?.(job),work_stage:job.stage,duration_ms:performance.now()-(job.loggedAt || performance.now()),reason:error?.message});
    job.loggedAt=performance.now();
  };
  // Draws finish in flight. Developments yield to the selected photo,
  // including unfinished neighbours (priority 5).
  const preemptLower = job => job.priority >= 10;
  const cpuLanes = Math.max(1, Math.floor(Math.sqrt(globalThis.navigator?.hardwareConcurrency || 1)));
  const probes = HDRLibrarySceneScheduler.create(cpuLanes, undefined, {onChange:changed,preemptLower});
  const sources = HDRLibrarySceneScheduler.create(cpuLanes, undefined, {heavyLimit:cpuLanes,onChange:changed,keepRunning:job=>job.priority>=5,preemptLower:job=>job.priority>0,preemptForCapacity:true});
  const versions = new Map();
  const history = new Map(), generations = new Map();
  let visible = new Set(), nearby = new Set(), reviewPath = null;
  const rank = path => visible.has(path) ? 10 : nearby.has(path) ? 50 : 80;
  const largeBytes = 32 * 1024 * 1024;
  function failure(result) {
    const error = Error(result.detail || "The photo could not be prepared.");
    error.libraryError = result.library_error;
    return error;
  }
  async function prepared(path, edge, signal, priority, identity, idle = false, trace = null, options = {}) {
    const checked = performance.now();
    const generation=generations.get(path)||0;
    const plan = await probes.submit(path+"|"+edge+"|"+generation, async shared => {
      const response = await fetch("/api/library/live-plan", {method:"POST",signal:shared,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge})});
      const result = await response.json();
      if (!response.ok) throw failure(result);
      return result;
    }, signal, priority, {path,edge,log_view:trace?.view,stage:edge <= 640 ? "Checking thumbnail cache" : edge === 100000 ? "Checking detail preview cache" : "Checking screen preview cache"});
    window.HDRLibraryTrace?.mark(trace,"picture_cache_check",checked,{cache_hit:!!plan.cached});
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (generation!==(generations.get(path)||0)) throw new DOMException("Invalidated", "AbortError");
    const version=plan.render_identity || plan.source_identity || plan.revision;
    if(versions.has(path)&&versions.get(path)!==version)sources.invalidate(candidate=>candidate===path);
    versions.delete(path);versions.set(path,version);
    if(versions.size>1024)versions.delete(versions.keys().next().value);
    const direct = HDRLibraryGpuRaw.cachedDirect?.(path,edge,version);
    if (direct) { options.onSourceDemand?.(); return direct; }
    if (plan.cached) { options.onSourceDemand?.(); return plan.cached; }
    if (options.cachedOnly) return null;
    await options.beforeSource?.();
    if (signal?.aborted) throw new DOMException("Cancelled","AbortError");
    if (idle && !plan.warm_allowed) return null;
    const previous = history.get(path);
    const elapsed = previous && previous.revision === plan.revision ? previous.ms : 0;
    const heavy = plan.bytes >= largeBytes || elapsed >= 2000;
    const cost = elapsed ? elapsed / 1000 : plan.bytes / largeBytes;
    const pending = sources.submit(identity+"|"+version+"|"+generation, async (shared, importance) => {
      const started = performance.now();
      try { const result = await develop(path, edge, shared, importance, version, options.gpuOnly); if (result && idle) save(result); return result; }
      finally {
        if (!shared.aborted) {
          history.delete(path);
          history.set(path, {revision:plan.revision,ms:performance.now()-started});
          if (history.size > 256) history.delete(history.keys().next().value);
        }
      }
    }, signal, priority, {heavy,cost,path,edge,log_view:trace?.view,stage:"Developing photo"});
    options.onSourceDemand?.();
    return pending;
  }
  // Selected work follows at most the single sharp draw already in flight.
  // Quick draws use thumbnails and their own renderer and priority queue.
  const draws = HDRLibrarySceneScheduler.create(1, undefined, {onChange:changed,preemptLower});
  const quickDraws = HDRLibrarySceneScheduler.create(1, undefined, {onChange:changed,preemptLower});
  async function load(path, edge, signal, priority = 10, idle = false, trace = null, options = {}) {
    const generation=generations.get(path)||0;
    const identity = path + (edge === 100000 ? "|native" : "");
    let meta = await prepared(path, edge, signal, priority, identity, idle, trace, options);
    if (!meta) return null;
    // One development publishes both sizes in memory. A waiter asking for
    // the other size reuses that data; it never starts another import.
    if (meta.edge !== edge) meta = await prepared(path, edge, signal, priority, path+"|"+edge, false, trace, options);
    if (generation!==(generations.get(path)||0) || signal?.aborted) throw new DOMException("Invalidated", "AbortError");
    return {...meta, draw_priority:priority, trace, log_view:trace?.view || (edge <= 640 ? "grid,filmstrip" : "single,fullscreen,compare")};
  }
  async function develop(path, edge, signal, importance, version, gpuOnly = false) {
    if (HDRLibraryGpuRaw.enabled()) {
      try {
        const meta = await HDRLibraryGpuRaw.liveScene(path, edge, signal, importance, version);
        if (meta) return meta;
      } catch (error) {
        if (error.name === "AbortError" || error.libraryError) throw error;
        window.HDRLibraryStopwatch?.("picture_source_gpu_fallback",{path,reason:error.message});
        // The structured fallback event above carries the picture labels.
      }
    }
    if (gpuOnly && importance() > 0) return null;
    for (;;) {
      const response = await fetch("/api/library/live-scene", {method:"POST",signal,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge,gpu:false,priority:importance()})});
      if (response.status === 202) { sources.stage(path,"Waiting to develop photo",true); await wait(150, signal); continue; }
      const meta = await response.json();
      if (!response.ok) throw failure(meta);
      return meta;
    }
  }
  async function lease(meta, signal, nativeBudget = false) {
    const url = `/api/delivery/gpu/raw-budget/${crypto.randomUUID()}`;
    // Grade's planner still enforces the shared budget. Reserve room for a small
    // picture graph, including its source and transient render targets.
    let bytes = meta.width * meta.height * 64 + 64 * 1024 * 1024;
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
        body:JSON.stringify({bytes,background:true,priority:typeof meta.draw_priority==='function'?meta.draw_priority():meta.draw_priority??10})});
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
    if (reviewPath === meta.path && !presented) return;
    const started = performance.now();
    void Promise.resolve().then(()=>meta.directScene?.store()).then(()=>fetch("/api/library/live-store/"+meta.key,{method:"POST"})).then(response=>{
      window.HDRLibraryTrace?.mark(meta.trace,"picture_store",started,{picture_size:"thumbnail,screen preview",scope:"shared",key:meta.key,success:response.ok});
    }).catch(error=>{window.HDRLibraryTrace?.mark(meta.trace,"picture_store",started,{key:meta.key,success:false,reason:error.message});});
  }
  return Object.freeze({load,lease,save,review:path=>{reviewPath=path;},
    onReclaim:handler=>{reclaim=handler;},
    reclaim:(bytes,required=false)=>reclaim(bytes,required),
    promote:(path,priority)=>{probes.promote(path,priority);sources.promote(path,priority);draws.promote(path,priority);quickDraws.promote(path,priority);},
    viewport:(shown,around)=>{visible=new Set(shown);nearby=new Set(around);sources.reprioritize(rank);probes.reprioritize(rank);},
    invalidate:paths=>{const targets=new Set(paths);for(const path of targets){generations.set(path,(generations.get(path)||0)+1);HDRLibraryGpuRaw.forgetDirect?.(path);}sources.invalidate(path=>targets.has(path));probes.invalidate(path=>targets.has(path));},
    stage:(path,stage,waiting=false)=>sources.stage(path,stage,waiting),
    draw:(task,signal,priority=10,path="Photo",labels={})=>draws.submit(crypto.randomUUID(),task,signal,priority,{path,...labels,stage:`Drawing ${labels.edge === 100000 ? "detail preview" : labels.edge <= 640 ? "thumbnail" : "screen preview"}`}),
    quickDraw:(task,signal,priority=10,path="Photo",labels={})=>quickDraws.submit(crypto.randomUUID(),task,signal,priority,{path,...labels,stage:"Drawing thumbnail for quick draw"}),
    snapshot:()=>({probes:probes.snapshot(),sources:sources.snapshot(),draws:draws.snapshot(),quickDraws:quickDraws.snapshot()})});
})();
