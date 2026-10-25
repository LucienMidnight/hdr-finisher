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
      // A selected photo must not inherit a running neighbour's lower priority.
      // Restart its demand at foreground priority; lower-priority GPU work yields.
      if (entry && !entry.value && priority < entry.priority) { remove(id); entry = null; }
      if (entry) return entry.promise;
      entry = {photo, priority, controller:new AbortController()}; entries.set(id, entry);
      const current = () => entries.get(id) === entry && !entry.controller.signal.aborted && key(photo) === id;
      entry.promise = Promise.resolve().then(() => load(photo, entry.controller.signal, current, priority, trace)).then(value => {
        if (!current()) { if (value) dispose(value); throw new DOMException("Invalidated", "AbortError"); }
        entry.value = value; return value;
      }).catch(error => { if (entries.get(id) === entry) remove(id); throw error; });
      return entry.promise;
    }
    return Object.freeze({get, update, invalidate, has:photo => !!entries.get(key(photo))?.value, size:() => entries.size});
  }
  // Only the finished live surface qualifies, never its camera JPEG sibling.
  function standIn(cells, identity, epoch, hdr) {
    return cells.find(cell => cell.identity === identity && cell.displayEpoch === epoch &&
      !cell.controller.signal.aborted && cell.meta?.route === "library-live" &&
      cell.fallback?.dataset.rendition === (hdr ? "hdr" : "sdr") &&
      cell.fallback.dataset.picturePath === cell.photo.path && !cell.fallback.hidden);
  }
  const api = Object.freeze({create, standIn});
  if (typeof module !== "undefined") module.exports = api; else root.HDRLibraryReadyWindow = api;
})(typeof window === "undefined" ? globalThis : window);
