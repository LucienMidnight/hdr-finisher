/* Reserve browser connections for pixels and navigation while pictures decode. */
(function (root) {
  "use strict";
  function create(concurrency = 4) {
    let active = 0;
    const waiting = [];
    const cancelled = () => new DOMException("Cancelled", "AbortError");
    function pump() {
      while (active < concurrency && waiting.length) {
        waiting.sort((a, b) => a.priority - b.priority);
        const job = waiting.shift();
        job.signal?.removeEventListener("abort", job.stop);
        if (job.signal?.aborted) { job.reject(cancelled()); continue; }
        active++;
        Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; pump(); });
      }
    }
    function submit(run, signal, priority = 10) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(cancelled()); return; }
        const job = { run, signal, priority, resolve, reject };
        job.stop = () => {
          const index = waiting.indexOf(job);
          if (index >= 0) { waiting.splice(index, 1); reject(cancelled()); }
        };
        signal?.addEventListener("abort", job.stop, { once: true });
        waiting.push(job); pump();
      });
    }
    return Object.freeze({ submit });
  }
  const api = Object.freeze({ create });
  if (typeof module !== "undefined") module.exports = api;
  else root.HDRLibraryRequestQueue = api;
})(typeof window === "undefined" ? globalThis : window);
