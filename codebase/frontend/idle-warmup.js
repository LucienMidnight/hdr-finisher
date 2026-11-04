/* Launch-only pipeline preparation. Never submits picture work or reserves memory. */
window.HDRIdleWarmup = (() => {
  let lastInput = performance.now();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("hdr-idle-warmup") : null;
  const touch = () => { lastInput = performance.now(); channel?.postMessage("busy"); };
  if (channel) channel.onmessage = event => { if(event.data==="grid")gridPresented=true;else lastInput = performance.now(); };
  for (const name of ["pointerdown", "keydown", "wheel"]) window.addEventListener(name, touch, {capture:true, passive:true});
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  const results = {};
  let gridPresented = false, serial = Promise.resolve();
  const gridShown = () => { gridPresented = true; channel?.postMessage("grid"); };
  async function run(name, task, busy = () => false) {
    if (!navigator.gpu) { results[name] = "unavailable"; return; }
    async function beforeNext(demand = () => false) {
      for (;;) {
        if (demand()) return;
        while (window.HDRIdleWarmupSuppressed || !gridPresented || busy() || performance.now() - lastInput < 2000) {
          if (demand()) return;
          await pause();
        }
        await new Promise(resolve => requestIdleCallback(resolve));
        const [work, delivery] = await Promise.all([
          fetch("/api/library/warmup-idle").then(r => r.ok ? r.json() : {paused:true}),
          fetch("/api/delivery/gpu/permit").then(r => r.ok ? r.json() : {ready:false}),
        ]);
        if (demand()) return;
        if (gridPresented && !busy() && performance.now() - lastInput >= 2000 && !work.paused && (name.startsWith("library") || work.idle) && delivery.ready && delivery.idle) return;
        await pause();
      }
    }
    const previous=serial;
    let finished;serial=new Promise(resolve=>{finished=resolve;});
    try {
      await previous;
      await beforeNext();
      const adapter = await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
      if (!adapter || adapter.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe/i.test(adapter.info?.description || "")) {
        results[name] = "unavailable"; return;
      }
      const started=performance.now();
      await task(beforeNext);
      results[name] = "ready";
      window.HDRLibraryStopwatch?.('startup_pipelines_ready',{name,duration_ms:performance.now()-started});
    } catch (error) { results[name] = "unavailable"; console.debug('Pipeline preparation:',name,error.message); }
    finally { finished(); } // A failed warm-up never fails a photo.
  }
  return Object.freeze({run, touch, gridShown, results});
})();
