/* Stored scenes use Grade's shaders; finishing never changes source identity. */
window.HDRLibraryScenes = (() => {
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, {once:true});
  });
  async function load(path, edge, signal) {
    if (HDRLibraryGpuRaw.enabled()) {
      try {
        const meta = await HDRLibraryGpuRaw.liveScene(path, edge, signal);
        if (meta) return meta;
      } catch (error) { if (error.name === "AbortError") throw error; }
    }
    for (;;) {
      const response = await fetch("/api/library/live-scene", {method:"POST",signal,
        headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge,gpu:false})});
      if (response.status === 202) { await wait(150, signal); continue; }
      const meta = await response.json();
      if (!response.ok) throw Error(meta.detail || "The stored scene could not be prepared.");
      return meta;
    }
  }
  async function lease(meta, signal) {
    const url = `/api/delivery/gpu/raw-budget/${crypto.randomUUID()}`;
    // Grade's planner still enforces the shared budget. Reserve room for a small
    // picture graph, including its source and transient render targets.
    const bytes = meta.width * meta.height * 64 + 64 * 1024 * 1024;
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
    return {check:async()=>{ if (!await check()) {const error=Error("Library draw yielded to Grade or delivery.");error.libraryYield=true;throw error;} },release};
  }
  return Object.freeze({load,lease});
})();
