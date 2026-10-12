/* Always-on stage records; only paths and timing/identity metadata leave the page. */
(() => {
  let events = [], timer;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!events.length) return;
    const batch = events; events = [];
    void fetch("/api/library/stopwatch", { method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch)
    }).catch(() => {});
  }
  window.HDRLibraryStopwatch = (stage, fields = {}) => {
    events.push({ stage, time: (performance.timeOrigin + performance.now()) / 1000, ...fields });
    if (events.length >= 64) flush();
    else if (!timer) timer = setTimeout(flush, 100);
  };
  window.addEventListener("pagehide", flush);
})();
HDRLibraryStopwatch("loaded");
