/* Keep neighbouring picture work alive when its photo becomes selected. */
(function(root) {
  "use strict";
  function create({load, key}) {
    const jobs = new Map();
    function clear() { for (const job of jobs.values()) job.controller.abort(); jobs.clear(); }
    function take(photo, edge) { return jobs.get(key(photo, edge))?.promise; }
    function update(selected, neighbours, edge) {
      const wanted = new Set([selected, ...neighbours].map(photo => key(photo, edge)));
      for (const [id, job] of jobs) if (!wanted.has(id)) { job.controller.abort(); jobs.delete(id); }
      for (const photo of neighbours) {
        const id = key(photo, edge); if (jobs.has(id)) continue;
        const controller = new AbortController(), job = {controller};
        job.promise = Promise.resolve().then(() => load(photo, edge, controller.signal));
        jobs.set(id, job);
        job.promise.catch(() => { if (jobs.get(id) === job) jobs.delete(id); });
      }
    }
    return Object.freeze({clear, take, update});
  }
  const api = Object.freeze({create});
  if (typeof module !== "undefined") module.exports = api;
  else root.HDRLibraryReadAhead = api;
})(typeof window === "undefined" ? globalThis : window);
