/* Native gain-map images: batch metadata, asynchronous decoding and a bounded recent pool. */
(function(root) {
  'use strict';
  function create({api, identity, image = () => new Image(), budget = 256 * 1024 ** 2}) {
    const entries = new Map(), queued = new Set();
    let timer, polling = false, bytes = 0, wanted = [];
    const client = globalThis.crypto?.randomUUID?.() || String(Math.random());
    const key = (photo, edge) => `${identity(photo)}|${edge}`;
    function touch(entry) { entries.delete(entry.id); entries.set(entry.id, entry); }
    function trim() {
      for (const [id, entry] of entries) {
        if (bytes <= budget) break;
        if (!entry.ready) continue;
        entries.delete(id); bytes -= entry.bytes;
      }
    }
    function schedule(delay = 0) { if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, delay); }
    async function accept(entry, meta) {
      if (entries.get(entry.id) !== entry || entry.decoding || entry.ready) return;
      entry.decoding = true;
      try {
        const decoded = image(); decoded.decoding = 'async'; decoded.src = meta.url;
        await decoded.decode();
        if (entries.get(entry.id) !== entry) return;
        entry.url = meta.url; entry.image = decoded; entry.meta = meta; entry.ready = true;
        // Conservative allowance: decoded base + RGB gain map + compositor copies.
        entry.bytes = decoded.naturalWidth * decoded.naturalHeight * 24 + (meta.url.startsWith('data:') ? meta.url.length * 2 : 0);
        bytes += entry.bytes; touch(entry); entry.resolve(entry); trim();
      } catch(error) { entries.delete(entry.id); entry.reject(error); }
    }
    async function flush() {
      if (polling) { schedule(20); return; }
      polling = true;
      const waiting = [...queued].filter(entry => entries.get(entry.id) === entry && !entry.ready && !entry.decoding);
      queued.clear();
      try {
        const edges = [...new Set(waiting.map(entry => `${entry.edge}:${entry.priority >= 30 ? 30 : 10}`))];
        await Promise.all(edges.map(async spec => {
          const [edge, priority] = spec.split(':').map(Number);
          const group = waiting.filter(entry => entry.edge === edge && (entry.priority >= 30 ? 30 : 10) === priority);
          for (let offset = 0; offset < group.length; offset += 256) {
            const chunk = group.slice(offset, offset + 256);
            const result = await api('/api/library/thumbnails', {paths:chunk.map(e => e.photo.path), edge, priority,client,wanted});
            for (const meta of result.ready) { const entry = chunk.find(e => e.photo.path === meta.path); if (entry) void accept(entry, meta); }
            for (const failure of result.errors) { const entry = chunk.find(e => e.photo.path === failure.path); if (entry) { entries.delete(entry.id); entry.reject(new Error(failure.message)); } }
            for (const path of result.pending) { const entry = chunk.find(e => e.photo.path === path); if (entry) queued.add(entry); }
          }
        }));
      } catch(error) { for (const entry of waiting) { entries.delete(entry.id); entry.reject(error); } }
      finally { polling = false; if (queued.size) schedule(40); }
    }
    function get(photo, edge, priority = 10) {
      const id = key(photo, edge); let entry = entries.get(id);
      if (entry) { entry.priority = Math.min(entry.priority,priority); touch(entry); return entry.promise; }
      // Bound queued metadata as well as decoded pixels when the user scrolls fast.
      if (entries.size >= 256) {
        for (const [oldId, old] of entries) {
          if (old.ready) { entries.delete(oldId); bytes -= old.bytes; }
          else { entries.delete(oldId); queued.delete(old); old.reject(new DOMException('Scrolled past','AbortError')); }
          if (entries.size < 192) break;
        }
      }
      entry = {id,photo,edge,priority};
      entry.promise = new Promise((resolve,reject) => Object.assign(entry,{resolve,reject}));
      entry.promise.catch(() => {}); entries.set(id,entry); queued.add(entry); schedule();
      return entry.promise;
    }
    function mode(img, hdr) { img.style.dynamicRangeLimit = hdr ? 'no-limit' : 'standard'; img.dataset.rendition = hdr ? 'hdr' : 'sdr'; img.dataset.peakNits = hdr ? '1000' : '203'; }
    async function show(photo, edge, img, current, hdr) {
      const entry = await get(photo,edge);
      if (!current()) return;
      img.decoding = 'async'; mode(img,hdr()); img.src = entry.url;
      await img.decode(); if (!current()) return;
      mode(img,hdr()); img.dataset.kept = String(!!entry.meta.kept); img.dataset.pictureKey = entry.meta.key; img.dataset.picturePath = photo.path; img.dataset.pictureEdge = edge;
      return entry.meta;
    }
    function prefetch(photos, edge) { for (const photo of photos) void get(photo,edge,30).catch(() => {}); }
    function plan(visible, ahead, edge) {
      wanted = [...visible, ...ahead].map(photo => photo.path);
      const ids = new Set([...visible, ...ahead].map(photo => key(photo,edge)));
      for (const [id, entry] of entries) if (!entry.ready && !ids.has(id)) {
        entries.delete(id); queued.delete(entry); entry.reject(new DOMException('Scrolled past','AbortError'));
      }
      for (const photo of visible) void get(photo,edge,10).catch(()=>{});
      prefetch(ahead,edge);
    }
    function clear() { for (const entry of entries.values()) { entry.reject(new DOMException('Cache changed','AbortError')); } entries.clear(); queued.clear(); bytes = 0; }
    return Object.freeze({show,prefetch,plan,mode,clear,snapshot:() => ({bytes,budget,ready:[...entries.values()].filter(e=>e.ready).length,pending:queued.size})});
  }
  const api = Object.freeze({create});
  if (typeof module !== 'undefined') module.exports = api;
  else root.HDRLibraryThumbnails = api;
})(typeof window === 'undefined' ? globalThis : window);
