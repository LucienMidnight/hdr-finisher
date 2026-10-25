/* Finished Single surfaces; identity and cancellation own every publication. */
(function(root) {
  "use strict";
  function create({key, load, dispose, promote = () => {}}) {
    const entries = new Map(); let wanted = null;
    function remove(id) {
      const entry = entries.get(id); if (!entry) return;
      entries.delete(id); entry.controller.abort();
      if (entry.value) dispose(entry.value);
    }
    function invalidate(predicate = () => true) {
      for (const [id, entry] of entries) if (predicate(entry.photo)) remove(id);
    }
    function update(photo, neighbours) {
      wanted = new Set([photo, ...neighbours].map(key));
      for (const id of entries.keys()) if (!wanted.has(id)) remove(id);
    }
    function get(photo, priority = 5, trace = null, options = {}) {
      const id = key(photo);
      if (wanted && !wanted.has(id)) return Promise.reject(new DOMException("Superseded", "AbortError"));
      let entry = entries.get(id);
      if (entry) {
        if (priority < entry.priority) { entry.priority = priority; promote(photo,priority); }
        return entry.promise;
      }
      entry = {photo, priority, controller:new AbortController()}; entries.set(id, entry);
      const current = () => entries.get(id) === entry && !entry.controller.signal.aborted && key(photo) === id;
      entry.promise = Promise.resolve().then(() => load(photo, entry.controller.signal, current, entry.priority, trace, () => entry.priority, options)).then(value => {
        if (!current()) { if (value) dispose(value); throw new DOMException("Invalidated", "AbortError"); }
        if (!value) { entries.delete(id); return null; }
        entry.value = value; return value;
      }).catch(error => { if (entries.get(id) === entry) remove(id); throw error; });
      return entry.promise;
    }
    return Object.freeze({get, update, invalidate, contains:photo => entries.has(key(photo)),
      evictFinished:(predicate=()=>true)=>{for(const [id,entry] of entries)if(entry.value && predicate(entry.photo))remove(id);}, has:photo => !!entries.get(key(photo))?.value, size:() => entries.size});
  }
  // Only the finished live surface qualifies, never its camera JPEG sibling.
  function standIn(cells, identity, epoch, hdr) {
    return cells.find(cell => cell.identity === identity && cell.displayEpoch === epoch &&
      !cell.controller.signal.aborted && cell.meta?.route === "library-live" &&
      cell.fallback?.dataset.rendition === (hdr ? "hdr" : "sdr") &&
      cell.fallback.dataset.picturePath === cell.photo.path && !cell.fallback.hidden);
  }
  function navigationGate({wait, now=()=>performance.now(), delay=120}) {
    let touched = -Infinity;
    return Object.freeze({touch:()=>{touched=now();},
      async settled(signal) { while(now()-touched<delay) await wait(delay-(now()-touched),signal); }
    });
  }
  const api = Object.freeze({create, standIn, navigationGate});
  if (typeof module !== "undefined") module.exports = api; else root.HDRLibraryReadyWindow = api;
})(typeof window === "undefined" ? globalThis : window);
