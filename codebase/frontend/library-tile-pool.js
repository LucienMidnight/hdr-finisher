/* Finished live surfaces survive scrolling within the agreed 512 MiB pool. */
(function(root) {
  "use strict";
  function create(limit = 512 * 1024 ** 2, dispose = () => {}) {
    const entries = new Map(); let bytes = 0;
    function remove(key, release = true) {
      const entry = entries.get(key);
      if (!entry) return;
      entries.delete(key); bytes -= entry.bytes;
      if (release) dispose(entry.value);
      return entry.value;
    }
    return Object.freeze({
      put(key, value, size) {
        remove(key);
        if (!(size > 0) || size > limit) { dispose(value); return; }
        entries.set(key, {value, bytes:size}); bytes += size;
        while (bytes > limit) remove(entries.keys().next().value);
      },
      take:key => remove(key, false),
      values:() => [...entries.values()].map(entry => entry.value),
      discard(predicate) { for (const [key, entry] of entries) if (predicate(entry.value)) remove(key); },
      clear() { for (const key of entries.keys()) remove(key); },
      snapshot:() => ({bytes, count:entries.size, limit})
    });
  }
  const api = Object.freeze({create});
  if (typeof module !== "undefined") module.exports = api; else root.HDRLibraryTilePool = api;
})(typeof window === "undefined" ? globalThis : window);
