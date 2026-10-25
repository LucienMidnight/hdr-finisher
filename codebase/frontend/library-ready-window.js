/* Finished Single surfaces; identity and cancellation own every publication. */
(function(root) {
  "use strict";
  function create({key, load, dispose}) {
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
      for (const id of entries.keys()) if (!wanted.has(id) || (!entries.get(id).value && id !== key(photo))) remove(id);
    }
    function get(photo, priority = 5, trace = null) {
      const id = key(photo);
      if (wanted && !wanted.has(id)) return Promise.reject(new DOMException("Superseded", "AbortError"));
      let entry = entries.get(id);
      if (entry) return entry.promise;
      entry = {photo, controller:new AbortController()}; entries.set(id, entry);
      const current = () => entries.get(id) === entry && !entry.controller.signal.aborted && key(photo) === id;
      entry.promise = Promise.resolve().then(() => load(photo, entry.controller.signal, current, priority, trace)).then(value => {
        if (!current()) { if (value) dispose(value); throw new DOMException("Invalidated", "AbortError"); }
        entry.value = value; return value;
      }).catch(error => { if (entries.get(id) === entry) remove(id); throw error; });
      return entry.promise;
    }
    return Object.freeze({get, update, invalidate, has:photo => !!entries.get(key(photo))?.value, size:() => entries.size});
  }
  const api = Object.freeze({create});
  if (typeof module !== "undefined") module.exports = api; else root.HDRLibraryReadyWindow = api;
})(typeof window === "undefined" ? globalThis : window);
