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
    window.HDRLibraryStopwatch?.("scene_"+state,{path:job.path,request:String(job.sequence),
      key:job.stage,duration_ms:performance.now()-(job.loggedAt || performance.now()),reason:error?.message});
    job.loggedAt=performance.now();
  };
  // In-window jobs (priority 0/5) finish; only ordinary grid/idle work is preemptible.
  const preemptLower = job => job.priority >= 10;
  const probes = HDRLibrarySceneScheduler.create(2, undefined, {onChange:changed,preemptLower});
  const sources = HDRLibrarySceneScheduler.create(2, undefined, {heavyLimit:1,onChange:changed,keepRunning:job=>job.priority>=10,preemptLower});
  const versions = new Map();
  const history = new Map(), generations = new Map();
  let visible = new Set(), nearby = new Set();
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
    }, signal, priority, {path,stage:"Checking stored picture"});
    window.HDRLibraryTrace?.mark(trace,"cache_check",checked,{cache_hit:!!plan.cached});
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (generation!==(generations.get(path)||0)) throw new DOMException("Invalidated", "AbortError");
    const version=plan.source_identity || plan.revision;
    if(versions.has(path)&&versions.get(path)!==version)sources.invalidate(candidate=>candidate===path);
    versions.delete(path);versions.set(path,version);
    if(versions.size>1024)versions.delete(versions.keys().next().value);
    if (plan.cached) return plan.cached;
    if (options.cachedOnly) return null;
    await options.beforeSource?.();
    if (signal?.aborted) throw new DOMException("Cancelled","AbortError");
    if (idle && !plan.warm_allowed) return null;
    const previous = history.get(path);
    const elapsed = previous && previous.revision === plan.revision ? previous.ms : 0;
    const heavy = plan.bytes >= largeBytes || elapsed >= 2000;
    const cost = elapsed ? elapsed / 1000 : plan.bytes / largeBytes;
    return sources.submit(identity+"|"+(plan.source_identity || plan.revision)+"|"+generation, async (shared, importance) => {
      const started = performance.now();
      try { return await develop(path, edge, shared, importance, version); }
      finally {
        if (!shared.aborted) {
          history.delete(path);
          history.set(path, {revision:plan.revision,ms:performance.now()-started});
          if (history.size > 256) history.delete(history.keys().next().value);
        }
      }
    }, signal, priority, {heavy,cost,path,stage:"Reading and developing source"});
  }
  // Selected work follows at most the single sharp draw already in flight.
  // Quick pictures own a separate renderer and priority queue.
  const draws = HDRLibrarySceneScheduler.create(1, undefined, {onChange:changed,preemptLower});
  const quickDraws = HDRLibrarySceneScheduler.create(1, undefined, {onChange:changed,preemptLower});
  async function load(path, edge, signal, priority = 10, idle = false, trace = null, options = {}) {
    const generation=generations.get(path)||0;
    const identity = path + (edge === 100000 ? "|native" : "");
    let meta = await prepared(path, edge, signal, priority, identity, idle, trace, options);
    if (!meta) return null;
    // One development stores both sizes. A waiter asking for the other size
    // reads it after the shared development; it never starts another import.
    if (meta.edge !== edge) meta = await prepared(path, edge, signal, priority, path+"|"+edge, false, trace, options);
    if (generation!==(generations.get(path)||0) || signal?.aborted) throw new DOMException("Invalidated", "AbortError");
    return {...meta, draw_priority:priority, trace};
  }
  async function develop(path, edge, signal, importance, version) {
    if (HDRLibraryGpuRaw.enabled()) {
      try {
        const meta = await HDRLibraryGpuRaw.liveScene(path, edge, signal, importance, version);
        if (meta) return meta;
      } catch (error) {
        if (error.name === "AbortError" || error.libraryError) throw error;
        window.HDRLibraryStopwatch?.("source_gpu_fallback",{path,reason:error.message});
        console.warn("Library source CPU fallback:",error.message);
      }
    }
    for (;;) {
      const response = await fetch("/api/library/live-scene", {method:"POST",signal,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge,gpu:false,priority:importance()})});
      if (response.status === 202) { sources.stage(path,"Waiting for source reading",true); await wait(150, signal); continue; }
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
        body:JSON.stringify({bytes,background:true})});
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
    try { while (!await check(true)) { draws.stage(meta.path,"Waiting for GPU drawing",true); await wait(50,signal); } draws.stage(meta.path,"Drawing picture on GPU"); }
    catch(error) { await release(); throw error; }
    return {bytes,check:async()=>{ if (!await check()) {const error=Error("Library draw yielded to Grade or delivery.");error.libraryYield=true;throw error;} },release};
  }
  let reclaim = async () => {};
  return Object.freeze({load,lease,
    onReclaim:handler=>{reclaim=handler;},
    reclaim:(bytes,required=false)=>reclaim(bytes,required),
    promote:(path,priority)=>{probes.promote(path,priority);sources.promote(path,priority);draws.promote(path,priority);quickDraws.promote(path,priority);},
    viewport:(shown,around)=>{visible=new Set(shown);nearby=new Set(around);sources.reprioritize(rank);probes.reprioritize(rank);},
    invalidate:paths=>{const targets=new Set(paths);for(const path of targets)generations.set(path,(generations.get(path)||0)+1);sources.invalidate(path=>targets.has(path));probes.invalidate(path=>targets.has(path));},
    stage:(path,stage,waiting=false)=>sources.stage(path,stage,waiting),
    draw:(task,signal,priority=10,path="Photo")=>draws.submit(crypto.randomUUID(),task,signal,priority,{path,stage:"Drawing picture on GPU"}),
    quickDraw:(task,signal,priority=10,path="Photo")=>quickDraws.submit(crypto.randomUUID(),task,signal,priority,{path,stage:"Drawing quick picture on GPU"}),
    snapshot:()=>({probes:probes.snapshot(),sources:sources.snapshot(),draws:draws.snapshot(),quickDraws:quickDraws.snapshot()})});
})();
