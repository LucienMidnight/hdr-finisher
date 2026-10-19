/* Launch-only pipeline preparation. Never submits picture work or reserves memory. */
window.HDRIdleWarmup = (() => {
  let lastInput = performance.now();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("hdr-idle-warmup") : null;
  const touch = () => { lastInput = performance.now(); channel?.postMessage("busy"); };
  if (channel) channel.onmessage = () => { lastInput = performance.now(); };
  for (const name of ["pointerdown", "keydown", "wheel"]) window.addEventListener(name, touch, {capture:true, passive:true});
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  const results = {};
  async function run(name, task, busy = () => false) {
    if (!navigator.gpu) { results[name] = "unavailable"; return; }
    async function beforeNext(demand = () => false) {
      for (;;) {
        if (demand()) return;
        while (busy() || performance.now() - lastInput < 2000) {
          if (demand()) return;
          await pause();
        }
        await new Promise(resolve => requestIdleCallback(resolve));
        const [work, delivery] = await Promise.all([
          fetch("/api/library/warmup-idle").then(r => r.ok ? r.json() : {idle:false}),
          fetch("/api/delivery/gpu/permit").then(r => r.ok ? r.json() : {ready:false}),
        ]);
        if (demand()) return;
        if (!busy() && performance.now() - lastInput >= 2000 && work.idle && delivery.ready && delivery.idle) return;
        await pause();
      }
    }
    try {
      await beforeNext();
      const adapter = await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
      if (!adapter || adapter.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe/i.test(adapter.info?.description || "")) {
        results[name] = "unavailable"; return;
      }
      await task(beforeNext);
      results[name] = "ready";
    } catch { results[name] = "unavailable"; } // A failed warm-up never fails a photo.
  }
  return Object.freeze({run, touch, results});
})();
