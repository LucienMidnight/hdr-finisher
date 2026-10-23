/* Stored scenes use Grade's shaders; finishing never changes source identity. */
window.HDRLibraryScenes = (() => {
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, {once:true});
  });
  // Lightweight cache discovery never queues behind full developments. Keep
  // one of the two existing source slots available for likely lighter work.
  const changed = (job,state,error) => {
    window.dispatchEvent?.(new Event("library-work-changed"));
    window.HDRLibraryStopwatch?.("scene_"+state,{path:job.path,request:String(job.sequence),
      key:job.stage,duration_ms:performance.now()-(job.loggedAt || performance.now()),reason:error?.message});
    job.loggedAt=performance.now();
  };
  const probes = HDRLibrarySceneScheduler.create(2, undefined, {onChange:changed});
  const sources = HDRLibrarySceneScheduler.create(2, undefined, {heavyLimit:1,onChange:changed});
  const history = new Map();
  const largeBytes = 32 * 1024 * 1024;
  function failure(result) {
    const error = Error(result.detail || "The photo could not be prepared.");
    error.libraryError = result.library_error;
    return error;
  }
  async function prepared(path, edge, signal, priority, identity) {
    const plan = await probes.submit(path+"|"+edge, async shared => {
      const response = await fetch("/api/library/live-plan", {method:"POST",signal:shared,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge})});
      const result = await response.json();
      if (!response.ok) throw failure(result);
      return result;
    }, signal, priority, {path,stage:"Checking stored picture"});
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (plan.cached) return plan.cached;
    const previous = history.get(path);
    const elapsed = previous && previous.revision === plan.revision ? previous.ms : 0;
    const heavy = plan.bytes >= largeBytes || elapsed >= 2000;
    const cost = elapsed ? elapsed / 1000 : plan.bytes / largeBytes;
    return sources.submit(identity, async (shared, importance) => {
      const started = performance.now();
      try { return await develop(path, edge, shared, importance); }
      finally {
        if (!shared.aborted) {
          history.delete(path);
          history.set(path, {revision:plan.revision,ms:performance.now()-started});
          if (history.size > 256) history.delete(history.keys().next().value);
        }
      }
    }, signal, priority, {heavy,cost,path,stage:"Reading and developing source"});
  }
  const draws = HDRLibrarySceneScheduler.create(1, undefined, {onChange:changed});
  async function load(path, edge, signal, priority = 10) {
    const identity = path + (edge === 100000 ? "|native" : "");
    let meta = await prepared(path, edge, signal, priority, identity);
    // One development stores both sizes. A waiter asking for the other size
    // reads it after the shared development; it never starts another import.
    if (meta.edge !== edge) meta = await prepared(path, edge, signal, priority, path+"|"+edge);
    return {...meta, draw_priority:priority};
  }
  async function develop(path, edge, signal, importance) {
    if (HDRLibraryGpuRaw.enabled()) {
      try {
        const meta = await HDRLibraryGpuRaw.liveScene(path, edge, signal, importance);
        if (meta) return meta;
      } catch (error) { if (error.name === "AbortError" || error.libraryError) throw error; console.warn("Library source CPU fallback:",error.message); }
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
  return Object.freeze({load,lease,
    stage:(path,stage,waiting=false)=>sources.stage(path,stage,waiting),
    draw:(task,signal,priority=10,path="Photo")=>draws.submit(crypto.randomUUID(),task,signal,priority,{path,stage:"Drawing picture on GPU"}),
    snapshot:()=>({probes:probes.snapshot(),sources:sources.snapshot(),draws:draws.snapshot()})});
})();
