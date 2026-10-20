/* Stored scenes use Grade's shaders; finishing never changes source identity. */
window.HDRLibraryScenes = (() => {
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, {once:true});
  });
  const sources = HDRLibrarySceneScheduler.create(2);
  const draws = HDRLibrarySceneScheduler.create(1);
  async function load(path, edge, signal, priority = 10) {
    const identity = path + (edge === 100000 ? "|native" : "");
    let meta = await sources.submit(identity, (shared, importance) => develop(path,edge,shared,importance), signal, priority);
    // One development stores both sizes. A waiter asking for the other size
    // reads it after the shared development; it never starts another import.
    if (meta.edge !== edge) meta = await sources.submit(path+"|"+edge, (shared,importance)=>develop(path,edge,shared,importance), signal, priority);
    return {...meta, draw_priority:priority};
  }
  async function develop(path, edge, signal, importance) {
    if (HDRLibraryGpuRaw.enabled()) {
      try {
        const meta = await HDRLibraryGpuRaw.liveScene(path, edge, signal, importance);
        if (meta) return meta;
      } catch (error) { if (error.name === "AbortError") throw error; console.warn("Library source CPU fallback:",error.message); }
    }
    for (;;) {
      const response = await fetch("/api/library/live-scene", {method:"POST",signal,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge,gpu:false,priority:importance()})});
      if (response.status === 202) { await wait(150, signal); continue; }
      const meta = await response.json();
      if (!response.ok) throw Error(meta.detail || "The stored scene could not be prepared.");
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
    try { while (!await check(true)) await wait(50,signal); }
    catch(error) { await release(); throw error; }
    return {bytes,check:async()=>{ if (!await check()) {const error=Error("Library draw yielded to Grade or delivery.");error.libraryYield=true;throw error;} },release};
  }
  return Object.freeze({load,lease,
    draw:(task,signal,priority=10)=>draws.submit(crypto.randomUUID(),task,signal,priority),
    snapshot:()=>({sources:sources.snapshot(),draws:draws.snapshot()})});
})();
