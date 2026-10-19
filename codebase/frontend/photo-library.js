/* This page owns its state. Folder and picture work are backend commands. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  document.addEventListener("error",event=>{if(event.target instanceof HTMLImageElement)event.target.style.visibility="hidden";},true);
  document.addEventListener("load",event=>{if(event.target instanceof HTMLImageElement)event.target.style.visibility="";},true);
  const library = $("library"), grid = $("library-grid"), space = $("grid-space"), film = $("filmstrip");
  const state = { photos: [], allPhotos: [], reading: false, hdr: false, zoom: false, zoomX: .5, zoomY: .5, zoomScale: 1, native: null, nativeMeta: null, nativeLoading: false, fitMeta: null, displayEpoch: 0, scanError: "", sort: "time", descending: false, filters: {}, index: -1, path: "", view: "grid", review: false, beforeReview: "grid",
    pins: [], cells: new Map(), filmCells: new Map(), size: 190,
    selection: new Set(), anchor: -1, scan: null, single: null, active: true, timing: false, picker: null, hiddenFiles: 0,
    folderSelection: new Set(), folderAnchor: "", collection: null, smartFilters: null, allFacts: false, labelNames: {}, indexing: null };
  const sortKey="hdr-finisher:library-source-sorts";
  function sourceSortKey(place) {
    if(place.kind)return `${place.kind}:${place.name}`;
    const path=(place.path||"").replaceAll("\\","/").replace(/\/$/,"").toLowerCase();
    const pin=state.pins.map(p=>p.path.replaceAll("\\","/").replace(/\/$/,"").toLowerCase()).filter(p=>path===p||path.startsWith(p+"/")).sort((a,b)=>b.length-a.length)[0];
    return `folder:${pin||path}`;
  }
  function readSorts(){try{return JSON.parse(localStorage.getItem(sortKey)||"{}");}catch{return {};}}
  function saveSourceSort(){const values=readSorts();values[sourceSortKey(state.collection||{path:state.path})]={sort:state.sort,descending:state.descending};localStorage.setItem(sortKey,JSON.stringify(values));}
  function restoreSourceSort(place){const saved=readSorts()[sourceSortKey(place)]||{sort:"time",descending:false};state.sort=saved.sort;state.descending=!!saved.descending;paintSort();}
  const standalone = parent === window, libraryDesktop = standalone ? window.hdrFinisherDesktop : null;
  const navigation = HDRLibraryNavigation.create({ root: document.querySelector(".library-nav"), refresh: () => refreshPins() });
  const applyTheme = theme => { document.documentElement.dataset.theme = ["default-dark", "default-light", "studio-gray"].includes(theme) ? theme : "default-dark"; };
  try { applyTheme(libraryDesktop?.startupTheme || JSON.parse(localStorage.getItem("hdr-finisher:application-preferences:v1") || "{}").theme); } catch {}
  if (!standalone) applyTheme(parent.document.documentElement.dataset.theme);
  window.addEventListener("storage", event => { if (event.key === "hdr-finisher:application-preferences:v1") { try { applyTheme(JSON.parse(event.newValue || "{}").theme); } catch {} } });
  const postParent = (action, detail = {}) => {
    if (!standalone) parent.postMessage({ type: "hdr-library", action, ...detail }, location.origin);
    else if (libraryDesktop) {
      const task = action === "open-source" ? libraryDesktop.openSourceInMain(detail.path, detail.itemKey)
        : action === "choose-source" ? libraryDesktop.chooseSourceInMain()
        : action === "review" ? libraryDesktop.getWindowState().then(current => {
          if (current.fullscreen !== detail.enabled) return libraryDesktop.performWindowAction("fullscreen");
        }) : null;
      task?.catch(error => status(error.message));
      if (["grade-replaced", "quick-export", "export-selection", "command-state", "add-export-selection"].includes(action)) void libraryDesktop.forwardLibraryAction?.(action, detail).catch(error => status(error.message));
    }
  };
  const status = (message) => { $("library-status").textContent = message; };
  // Capture OS drops anywhere; internal photo/folder drags keep their own handlers.
  const externalDrop = event => Array.from(event.dataTransfer?.types || []).includes("Files")
    && !Array.from(event.dataTransfer?.types || []).some(type => type.startsWith("application/x-hdr-library-"));
  for (const name of ["dragenter", "dragover"]) document.addEventListener(name, event => {
    if (!externalDrop(event)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy";
  }, true);
  document.addEventListener("drop", event => {
    if (!externalDrop(event)) return;
    event.preventDefault(); event.stopPropagation();
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) { status("Drop one image or project at a time, as with File › Open."); return; }
    if (!standalone) void parent.HDRLibraryHost.openDrop(files[0]).catch(error => status(error.message));
    else if (libraryDesktop) void libraryDesktop.openDroppedFileInMain(files[0]).catch(error => status(error.message));
    else status("Opening dropped files requires the editor window.");
  }, true);
  const confirmChange = (message, undoAvailable) => { status(message); $("library-undo").hidden = !undoAvailable; };
  const aborted = (error) => error?.name === "AbortError";
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
  let overlays = null;
  const pictureRequests = HDRLibraryRequestQueue.create();
  async function api(route, body, signal) {
    const measured = ["/api/library/picture", "/api/library/native", "/api/library/overlay-map"].includes(route);
    const trace = measured ? crypto.randomUUID() : null;
    for (;;) {
      const queued = performance.now();
      if (measured) HDRLibraryStopwatch("picture_requested", { path: body.path, request: trace });
      const request = async () => {
        if (measured) HDRLibraryStopwatch("picture_dispatched", { path: body.path, request: trace, queue_ms: performance.now() - queued });
        const response = await fetch(route, { signal, ...(body === undefined ? {} : {
          method: "POST", headers: { "Content-Type": "application/json", ...(trace ? { "X-Library-Request": trace } : {}) }, body: JSON.stringify(body) }) });
        return { response, result: await response.json() };
      };
      const { response, result } = await ((route === "/api/library/picture" || route === "/api/library/native" || route === "/api/library/overlay-map")
        ? pictureRequests.submit(request, signal, body.priority) : request());
      if (response.status === 202) { await sleep(150, signal); continue; }
      if (!response.ok) {
        const error = new Error(typeof result.detail === "string" ? result.detail : "Library request failed.");
        error.status = response.status; throw error;
      }
      if (measured) HDRLibraryStopwatch("picture_answered", { path: body.path, request: trace, key: result.key, duration_ms: performance.now() - queued, kept: !!result.kept });
      return result;
    }
  }
  const { showMenu, closeMenu: closeFolderMenu, make } = HDRLibraryDialogs;
  const sameName = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const belongs = (photo, place) => (place.kind === "album" ? photo.albums || [] : photo.marks?.tags || []).some(name => sameName(name, place.name));
  const culling = HDRLibraryCulling.create({ confirm: confirmChange, photos: () => state.allPhotos, selection: () => state.view === "single" && compare.enabled() ? new Set([selected()?.path]) : state.selection, api, status,
    labelName: label => state.labelNames[label] || "",
    updated: result => {
      if (result.grade_changed) {
        invalidateGradePictures((result.photos || []).map(photo => photo.path), false);
        clearCells(state.cells); clearCells(state.filmCells);
        paintGrid(); paintFilm(); if (state.view === "single") showSingle();
      }
      if(result.files_changed) { void filesChanged(result); return; }
      if(result.copies_changed) { void refreshPins(); void reopen(); return; }
      if (result.smart_changed) { void smart.refresh().then(() => smart.poll()).then(result => { if (result && state.collection?.kind === "smart") { state.allPhotos = result.photos; state.smartFilters = result.filters; applyQuery(); } }); }
      const place = state.collection;
      if (place && place.kind !== "smart") {
        // An album or tag view is always current: photos join and leave with the command.
        const shown = new Set(state.allPhotos.map(photo => photo.path));
        if (result.photos.some(row => !shown.has(row.path) && belongs(row, place))) { void reopen(); return; }
        state.allPhotos = state.allPhotos.filter(photo => belongs(photo, place));
      }
      applyQuery(); updateSingleCaption(); void albums.refresh().catch(() => {});
    } });
  const albums = HDRLibraryAlbums.create({ root: $("albums"), addButton: $("add-album"), api, status, run: culling.run,
    selection: () => [...state.selection], smartAction: () => smart.menuAction(), open: name => browseCollection("album", name),
    closed: () => { const back = state.lastFolder || state.pins.find(pin => pin.available)?.path; if (back) void browse(back); else void reopen(); } });
  const smart = HDRLibrarySmartAlbums.create({ root: $("smart-albums"), api, status, run: culling.run, pins: () => state.pins,
    open: id => browseCollection("smart", id), closed: () => { const back = state.lastFolder || state.pins.find(pin => pin.available)?.path; if (back) void browse(back); }, });
  void smart.refresh().catch(error => status(error.message));
  $("add-smart-album").addEventListener("click", () => void smart.editor().catch(error => status(error.message)));
  $("filter-save-smart").addEventListener("click", () => { void smart.editor(null, { ...structuredClone(state.filters), raw: undefined, folders: state.path ? [state.path] : [] }).catch(error => status(error.message)); });
  const tagWindow = HDRLibraryTags.create({ api, run: culling.run, undo: culling.undo, undoAvailable: culling.undoAvailable,
    showTag: tag => browseCollection("tag", tag), indexing: () => state.indexing?.state === "indexing",
    labelNames: () => state.labelNames,
    setLabelNames: async names => { state.labelNames = (await api("/api/library/preferences", { label_names: names })).label_names; updateDetails(); paintGrid(); paintFilm(); } });
  async function filesChanged(result) {
    culling.setUndo(result.undo_available); $("library-undo").hidden = !result.undo_available;
    for(const change of result.changes || []) {
      const remap = p => p === change.old || p.startsWith(change.old + "\\") || p.startsWith(change.old + "/") ? change.new + p.slice(change.old.length) : p;
      state.path = remap(state.path); if(state.lastFolder) state.lastFolder=remap(state.lastFolder);
    }
    await refreshPins(); await reopen();
  }
  const fileCommands = HDRLibraryFileCommands.create({api,status,pins:()=>state.pins,changed:filesChanged,removeCopies:removeCopy});
  const reopen = () => state.collection ? browseCollection(state.collection.kind, state.collection.name) : browse(state.path);
  function selected() { return state.photos[state.index]; }
  function clearCells(map) {
    for (const cell of map.values()) { cell.controller.abort(); cell.element.remove(); }
    map.clear();
  }
  // Cells on screen now, without the finished cells kept just beyond it.
  const shownCells = map => [...map.values()].filter(cell => map.shown?.has(cell.photo.path));
  const pictureIdentity = photo => `${photo.path}|${photo.grade_identity || ""}|${photo.picture_key || ""}|${photo.bytes}|${photo.mtime_ns}|${!!photo.pictureCurrent}|${!!photo.picture_updating}`;
  function pictureMode(img, hdr) {
    img.style.dynamicRangeLimit = hdr ? 'no-limit' : 'standard';
    img.dataset.rendition = hdr ? 'hdr' : 'sdr'; img.dataset.peakNits = hdr ? '1000' : '203';
  }
  // One stored scene size, scaled to fit any cell.
  const thumbnailEdge = () => 640;
  const cacheChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('hdr-library-cache') : null;
  cacheChannel?.addEventListener('message', () => { clearCells(state.cells); clearCells(state.filmCells); paintGrid(); paintFilm(); });
  window.addEventListener("message",event => { if(event.origin === location.origin && event.data?.type === "hdr-library-cache-changed") { clearCells(state.cells); clearCells(state.filmCells); paintGrid(); paintFilm(); } });
  const recentPictures = new Map();
  const rawTypes = new Set(["ARW", "CR2", "CR3", "NEF", "NRW", "RAF", "RW2", "ORF", "ORI", "PEF", "DNG", "SRW"]);
  const rawCandidate = photo => photo && rawTypes.has(photo.type) && !photo.edited && !photo.copy_id
    && !recentPictures.get(pictureIdentity(photo))?.route?.includes("linear-dng");
  const browsingSize = {width: Math.min(2560, Math.round(screen.width * (window.devicePixelRatio || 1))),
    height: Math.min(2560, Math.round(screen.height * (window.devicePixelRatio || 1)))};
  let browsingLimits = {ahead:12,gpu_pictures:10}, rawController = null, rawTimer, rawDirection = 1, rawGeneration = 0;
  let rawPlanSignature = "";
  const rawClient = crypto.randomUUID();
  function stopRawAhead() {
    clearTimeout(rawTimer); rawController?.abort(); rawController = null; rawGeneration++;
    rawPlanSignature = "";
    void api("/api/library/raw-plan", {paths:[],...browsingSize,client:rawClient,revision:rawGeneration}).catch(() => {});
  }
  function startRawAhead(previousIndex = state.index) {
    if (!state.active || !selected()) return;
    if (previousIndex !== state.index) rawDirection = state.index > previousIndex ? 1 : -1;
    const photo = selected();
    const neighbours = Array.from({length:browsingLimits.ahead}, (_,i) => state.photos[state.index + (i+1)*rawDirection]);
    neighbours.push(state.photos[state.index - rawDirection], state.photos[state.index - 2*rawDirection]);
    const photos = [photo,...neighbours].filter(Boolean);
    const signature = photos.map(pictureIdentity).join(";");
    if (signature === rawPlanSignature) return;
    rawController?.abort(); clearTimeout(rawTimer);
    const controller = new AbortController(); rawController = controller;
    const generation = ++rawGeneration; rawPlanSignature = signature;
    const current = () => state.active && !controller.signal.aborted && generation === rawGeneration;
    void (async () => {
      for (const item of photos) {
        if (!current()) break;
        try {
          const meta = await HDRLibraryScenes.load(item.path,2560,controller.signal,item.path===photo.path?0:50);
          if (!current()) break;
          if (meta?.route === "gpu-raw-thumbnail") await HDRLibraryPictures.prepare(meta,controller.signal,current);
          if (!current()) break;
          recentPictures.set(pictureIdentity(item),meta);
          while (recentPictures.size > 80) recentPictures.delete(recentPictures.keys().next().value);
        } catch(error) { if (!aborted(error)) console.debug("Library read-ahead:",error.message); }
      }
    })();
  }
  const readAhead = HDRLibraryReadAhead.create({
    key: (photo, edge) => `${pictureIdentity(photo)}|${edge}`,
    load: (photo, edge, signal) => {
      const cached = recentPictures.get(pictureIdentity(photo));
      return cached?.edge >= edge ? Promise.resolve(cached) : HDRLibraryScenes.load(photo.path,edge,signal,50);
    },
  });
  function clearPrefetch() { readAhead.clear(); stopRawAhead(); }
  function setActive(active) {
    state.active = active;
    if (!active) {
      compare.cancel();
      clearCells(state.cells); clearCells(state.filmCells); clearPrefetch(); state.single?.abort();
      state.scan?.abort(); state.native?.abort(); state.nativeSource?.abort();
    } else if ((state.path || state.collection) && !state.photos.length) void reopen();
    else { paintGrid(); paintFilm(); if (state.view === "single") showSingle(); }
  }
  function diagnostics(photo, meta, elapsed) {
    if (!state.timing) return;
    const message = `${photo.name}: ${Math.round(elapsed)} ms to picture · ${meta.cache_hit ? "cached" : meta.route} · ${Math.round(meta.stored_bytes / 1024)} KiB`;
    $("library-diagnostic").hidden = false;
    $("library-diagnostic").textContent = message;
    console.info("[library-picture]", message);
  }
  async function loadAndShow(photo, edge, canvas, controller, isCurrent, priority = 10, prepared = null) {
    const started = performance.now();
    let fallback = null;
    try {
      while (isCurrent() && !controller.signal.aborted) {
        try {
          await HDRLibraryPictures.initialize();
          const meta = await (prepared || HDRLibraryScenes.load(photo.path,edge,controller.signal,priority));
          prepared = null;
          if (!isCurrent()) return;
          await drawPicture(meta,canvas,controller,isCurrent);
          if (!isCurrent()) return;
          fallback?.remove(); fallback = null; canvas.style.visibility = "";
          canvas.dataset.picturePath = photo.path; canvas.dataset.pictureEdge = meta.edge; canvas.dataset.pictureKey = meta.key;
          recentPictures.set(pictureIdentity(photo),meta);
          if (recentPictures.size > 80) recentPictures.delete(recentPictures.keys().next().value);
          HDRLibraryStopwatch("picture_shown", {path:photo.path,key:meta.key,duration_ms:performance.now()-started});
          diagnostics(photo,meta,performance.now()-started);
          overlays?.attach(photo,canvas,meta,controller,isCurrent);
          return meta;
        } catch(error) {
          prepared = null;
          if (aborted(error) || !isCurrent()) return;
          if (error.libraryYield) { await sleep(50,controller.signal); continue; }
          if (HDRLibraryPictures.usable()) throw error;
          if (!fallback) {
            const meta = await api("/api/library/fallback-picture",{path:photo.path,edge},controller.signal);
            if (!isCurrent()) return;
            fallback = document.createElement("img"); fallback.alt = photo.name;
            fallback.className = canvas.className; fallback.style.cssText="width:100%;height:100%;object-fit:contain"; fallback.dataset.cpuFallback = "true";
            fallback.src = meta.url; await fallback.decode();
            if (!isCurrent()) return;
            canvas.after(fallback); canvas.style.visibility = "hidden";
            pictureMode(fallback,state.hdr);
          }
          await sleep(2000,controller.signal);
        }
      }
    } finally { fallback?.remove(); }
  }
  async function drawPicture(meta, canvas, controller, isCurrent) {
    for (;;) {
      const epoch = state.displayEpoch;
      await HDRLibraryPictures.show(meta, canvas, controller.signal, () => isCurrent() && epoch === state.displayEpoch, state.hdr);
      if (!isCurrent() || controller.signal.aborted || epoch === state.displayEpoch) return;
    }
  }
  function toggleHDR() {
    state.hdr = !state.hdr; state.displayEpoch += 1;
    $("hdr-button").setAttribute("aria-pressed", String(state.hdr));
    for (const cell of [...state.cells.values(), ...state.filmCells.values()]) {
      pictureMode(cell.canvas, state.hdr);
      if (cell.fallback && cell.scene) void drawPicture(cell.scene, cell.fallback, cell.controller,
        () => cell.element.isConnected && !cell.controller.signal.aborted).catch(() => {});
    }
    if (state.view === "single") showSingle();
  }
  $("hdr-button").addEventListener("click", toggleHDR);
  window.addEventListener("hdrfinisher:webgpulost",()=>{
    clearCells(state.cells); clearCells(state.filmCells);
    state.single?.abort(); state.singleIdentity="";
    setTimeout(()=>{paintGrid();paintFilm();if(state.view==="single")showSingle();},100);
  });
  function removeUnreadable(photo, error) {
    if (error.status !== 400) { status(error.message); return; }
    const currentPath = selected()?.path, anchorPath = state.photos[state.anchor]?.path;
    const wasSelected = state.selection.has(photo.path);
    state.selection.delete(photo.path);
    state.allPhotos = state.allPhotos.filter((item) => item.path !== photo.path);
    state.photos = state.photos.filter((item) => item.path !== photo.path);
    state.hiddenFiles += 1;
    state.index = Math.max(0, state.photos.findIndex((item) => item.path === currentPath));
    if (!state.photos.length) state.index = -1;
    if (wasSelected && !state.selection.size && state.index >= 0) state.selection.add(state.photos[state.index].path);
    state.anchor = state.photos.findIndex(item => item.path === anchorPath);
    updateDetails(); paintGrid(); paintFilm();
    status(`${state.photos.length.toLocaleString()} photos · ${state.hiddenFiles} unreadable files hidden`);
  }
  function makeCell(photo, container, index) {
    const element = document.createElement("div");
    element.className = "library-cell loading"; element.setAttribute("role", "option"); element.dataset.path = photo.path;
    const frame = document.createElement("div"); frame.className = "picture-frame";
    const canvas = document.createElement("img"); canvas.alt = ""; canvas.style.visibility="hidden"; frame.append(canvas);
    const name = document.createElement("span"); name.className = "name"; name.textContent = photo.name;
    element.append(frame, name); container.append(element);
    const cell = { element, canvas, controller: new AbortController(), photo, index, edge:thumbnailEdge(), identity:pictureIdentity(photo) };
    element.addEventListener("click", (event) => select(state.photos.findIndex((item) => item.path === photo.path), false, event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single"));
    element.addEventListener("dblclick", () => { select(state.photos.findIndex((item) => item.path === photo.path)); openGrade(); });
    element.addEventListener("pointerenter", () => { if (state.timing && cell.meta) diagnostics(photo, cell.meta, cell.elapsed); });
    element.addEventListener("contextmenu", event => photoMenu(event, photo));
    // Thumbnails can be dragged onto an album in the left panel.
    element.draggable = true;
    element.addEventListener("dragstart", event => {
      if (!state.selection.has(photo.path)) select(state.photos.findIndex(item => item.path === photo.path));
      event.dataTransfer.setData(HDRLibraryAlbums.DRAG, String(state.selection.size)); event.dataTransfer.effectAllowed = "copyMove";
    });
    const started = performance.now();
    const current = () => state.active && element.isConnected && !cell.controller.signal.aborted;
    {
      void (async () => {
        const fallback = document.createElement("canvas"); cell.fallback = fallback;
        fallback.hidden = true; frame.append(fallback);
        const preview = fetch("/api/library/preview", {method:"POST", signal:cell.controller.signal,
          headers:{"Content-Type":"application/json"},body:JSON.stringify({path:photo.path})}).then(async response => {
          if (response.status !== 200) return;
          const meta = await response.json();
          if (!current() || cell.meta || !meta.url) return;
          canvas.src = meta.url; canvas.dataset.preview = "true";
          await canvas.decode();
          if (current() && !cell.meta) { canvas.style.visibility=""; element.classList.remove("loading"); }
        }).catch(()=>{});
        let cpuShown = false;
        while (current()) {
          try {
            const gpu = await HDRLibraryPictures.initialize();
            if (gpu.adapterInfo?.fallback) throw Error("Hardware GPU unavailable.");
            const meta = await HDRLibraryScenes.load(photo.path, cell.edge, cell.controller.signal);
            if (!current()) return;
            await drawPicture(meta, fallback, cell.controller, current);
            if (!current()) return;
            cell.meta = cell.scene = meta; cell.elapsed = performance.now() - started;
            fallback.hidden = false; canvas.hidden = true; element.classList.remove("loading");
            fallback.dataset.pictureKey=meta.key; fallback.dataset.picturePath=photo.path;
            HDRLibraryStopwatch("picture_shown",{path:photo.path,key:meta.key,duration_ms:cell.elapsed});
            overlays?.attach(photo,fallback,meta,cell.controller,current);
            return;
          } catch(error) {
            if (aborted(error) || !current()) return;
            if (error.libraryYield) { await sleep(50,cell.controller.signal); continue; }
            if (HDRLibraryPictures.usable()) throw error;
            if (!cpuShown) {
              const meta = await api("/api/library/fallback-picture",{path:photo.path,edge:cell.edge},cell.controller.signal);
              if (!current()) return;
              canvas.src=meta.url; await canvas.decode();
              if (!current()) return;
              canvas.hidden=false; canvas.style.visibility=""; fallback.hidden=true;
              canvas.dataset.preview="false"; canvas.dataset.cpuFallback="true";
              pictureMode(canvas,state.hdr); element.classList.remove("loading");
              cpuShown=true;
            }
            await sleep(2000,cell.controller.signal);
          }
        }
      })().catch(error=>{if(current()&&!aborted(error))removeUnreadable(photo,error);});
      return cell;
    }
  }
  // Finished cached-picture cells stay built for one screen beyond each edge, so
  // scrolling back shows them at once. Cells still loading are dropped as before.
  function reconcile(map, start, end, container, position) {
    const span = end - start, keepStart = Math.max(0, start - span), keepEnd = Math.min(state.photos.length, end + span);
    const kept = (cell, index) => index >= start && index < end || index >= keepStart && index < keepEnd && cell.meta && (!cell.fallback || cell.scene?.route === "library-live");
    const wanted = new Map(state.photos.slice(keepStart, keepEnd).map((photo, offset) => [photo.path, keepStart + offset]));
    map.shown = new Set(state.photos.slice(start, end).map(photo => photo.path));
    for (const [path, cell] of map) {
      if (wanted.has(path) && kept(cell, wanted.get(path))) continue;
      cell.controller.abort(); cell.element.remove(); map.delete(path);
    }
    for (let index = keepStart; index < keepEnd; index += 1) {
      const photo = state.photos[index];
      let cell = map.get(photo.path);
      if (cell && (cell.edge !== thumbnailEdge() || cell.photo.bytes !== photo.bytes || cell.photo.mtime_ns !== photo.mtime_ns || cell.identity !== pictureIdentity(photo))) { cell.controller.abort(); cell.element.remove(); map.delete(photo.path); cell = null; }
      if (!cell && (index < start || index >= end)) continue;
      if (!cell) { cell = makeCell(photo, container, index); map.set(photo.path, cell); }
      position(cell.element, index);
      const active = state.selection.has(photo.path);
      cell.element.classList.toggle("active", active); cell.element.setAttribute("aria-selected", String(active));
      cell.element.classList.toggle("lead", active && index === state.index);
      cell.element.classList.toggle("rejected", photo.marks?.pick === "reject");
      cell.element.querySelector(".library-picture-updating")?.remove();
      if (photo.picture_updating) { const mark = make("span", "library-picture-updating library-edited", state.picturesPaused ? "Paused" : "Updating"); mark.title = state.picturesPaused ? "Library picture work is paused. Resume it in Activity." : "Showing the default look while the saved-grade picture is updated."; mark.setAttribute("role", "status"); cell.element.append(mark); }
      cell.element.querySelector(".library-marks")?.remove(); cell.element.append(culling.strip(photo));
    }
  }
  let lastGridTop = 0;
  function paintGrid() {
    const count = state.photos.length ? String(state.photos.length) : ""; if ($("place-count").textContent !== count) $("place-count").textContent = count;
    if (!state.active || state.view !== "grid") return;
    const layout = HDRLibraryLayout.gridLayout(state.photos.length, grid.clientWidth, grid.clientHeight, grid.scrollTop, state.size);
    state.layout = layout; space.style.height = `${layout.totalHeight}px`;
    $("library-empty").hidden = state.photos.length > 0;
    $("empty-add").hidden = state.pins.length > 0 || state.reading;
    if (!state.photos.length) $("empty-message").textContent = state.reading ? "Reading folder…" : state.scanError || (state.allPhotos.length ? "No photos match these filters."
      : state.collection ? (state.collection.kind === "album" ? "This album is empty. Right-click photos, or drag them here, to add them." : "No connected photos carry this tag.")
      : state.path ? "No readable photos in this folder." : "Add a folder to start browsing.");
    reconcile(state.cells, layout.first, layout.last, space, (element, index) => {
      element.style.cssText = `left:${3 + (index % layout.columns) * layout.cellWidth}px;top:${3 + Math.floor(index / layout.columns) * layout.rowHeight}px;width:${layout.cellWidth - 3}px;height:${layout.rowHeight - 3}px`;
    });
    const screen = Math.max(layout.columns, layout.last - layout.first);
    const forward = grid.scrollTop >= lastGridTop; lastGridTop = grid.scrollTop;
    const first = forward ? layout.last : Math.max(0, layout.first - screen);
    const last = forward ? Math.min(state.photos.length, layout.last + screen) : layout.first;
  }
  let lastFilmLeft = 0;
  let FILM_PITCH = 119; // filmstrip tile width plus the 3px gap
  function paintFilm() {
    if (!state.active || state.view !== "single" || state.review) { clearCells(state.filmCells); return; }
    $("film-space").style.width = `${state.photos.length * FILM_PITCH + 3}px`;
    const first = Math.max(0, Math.floor((film.scrollLeft - 3) / FILM_PITCH));
    const last = Math.min(state.photos.length, Math.ceil((film.scrollLeft + film.clientWidth) / FILM_PITCH));
    reconcile(state.filmCells, first, last, $("film-space"), (element, index) => { element.style.left = `${3 + index * FILM_PITCH}px`; });
    const forward = film.scrollLeft >= lastFilmLeft; lastFilmLeft = film.scrollLeft;
  }
  function updateDetails() {
    if (window.HDRLibraryCommands) commandState();
    const photo = selected(); const root = $("details"), tagFocused = document.activeElement?.id === "library-tag-input"; root.replaceChildren();
    if (!photo || !state.selection.size) { root.textContent = "Select a photo."; return; }
    const one = state.selection.size === 1 && state.selection.has(photo.path);
    const list = rows => { const dl = document.createElement("dl"); for (const [label, value] of rows) dl.append(make("dt", "", label), make("dd", label === "Name" ? "library-file-name" : "", value)); return dl; };
    if (one) {
      const file = make("section", "library-facts"); file.append(make("p", "library-kicker", "File"), list(HDRLibraryFacts.groups(photo)[0][1])); root.append(file);
      if (photo.copy_id) {
        root.append(make("p", "library-details-sub", `Virtual copy “${photo.copy_name}”.`));
        const rename = make("button", "text-button", "Rename copy…"); rename.type = "button";
        rename.addEventListener("click", () => renameCopy(photo).catch(error => status(error.message))); root.append(rename);
      }
    } else root.append(make("strong", "", `${state.selection.size.toLocaleString()} photos selected`));
    root.append(make("p", "library-kicker", "Marks"));
    culling.details(root);
    const manage = make("button", "text-button", "Manage tags and labels…"); manage.type = "button"; manage.id = "manage-tags";
    manage.addEventListener("click", () => void tagWindow.open()); root.append(manage);
    if (one) {
      const facts = make("section", "library-facts"); facts.id = "library-facts";
      if (state.allFacts) for (const [kicker, rows] of HDRLibraryFacts.groups(photo).slice(1)) facts.append(make("p", "library-kicker", kicker), list(rows));
      else facts.append(make("p", "library-kicker", "Camera"), list(HDRLibraryFacts.summary(photo)));
      const more = make("button", "text-button", state.allFacts ? "Show less" : "Show all"); more.type = "button"; more.id = "facts-toggle";
      more.addEventListener("click", () => { state.allFacts = !state.allFacts; updateDetails(); $("facts-toggle")?.focus(); });
      facts.append(more); root.append(facts); wantFacts(photo);
    }
    if (tagFocused) $("library-tag-input")?.focus();
  }
  let factsTimer;
  function wantFacts(photo) {
    // The selected photo's details are read ahead of the folder-wide pass.
    clearTimeout(factsTimer);
    if (photo.indexed || photo.factsAsked) return;
    factsTimer = setTimeout(async () => {
      photo.factsAsked = true;
      try {
        const result = await api("/api/library/metadata", { paths: [photo.path] }, state.scan?.signal);
        const name=photo.name; Object.assign(photo, result.photos[0]); if(photo.copy_id)photo.name=name;
        if (selected() === photo) updateDetails();
      } catch (error) { photo.factsAsked = false; if (!aborted(error)) console.debug("Library details:", error.message); }
    }, 200);
  }
  async function refreshCopies() {
    if(state.collection) await browseCollection(state.collection.kind,state.collection.name);
    else if(state.path) await browse(state.path);
  }
  const plural = (count, one, many = one + "s") => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  const fileName = photo => photo.copy_id ? (photo.source_path || photo.path).split(/[/\\]/).pop() : photo.name;
  async function createCopy(photos) {
    const photo = photos[0], count = photos.length;
    const answer = await HDRLibraryDialogs.ask({ title: count === 1 ? `Create Virtual Copy of ${fileName(photo)}` : `Create ${count} Virtual Copies`,
      message: "A virtual copy is another grade of the same photo. No second image file is made. The copy is kept in the settings file beside the photo, so it travels with it.",
      fields: [
        { name: "start", label: "Start from", options: [{ value: "current", label: "The current grade" }, { value: "clean", label: "A clean start" }], value: "current" },
        { name: "name", label: "Name (optional)", optional: true, placeholder: "For example Black and white" }], confirm: count === 1 ? "Create copy" : `Create ${count} copies` });
    if (!answer) return;
    const result = await api("/api/library/virtual-copies", { paths: photos.map(item => item.path), ...answer });
    culling.setUndo(result.undo_available); await refreshCopies();
    const made = state.photos.findIndex(item => item.path === result.path);
    if (made >= 0) select(made, true);
    confirmChange(`${plural(result.count, "virtual copy", "virtual copies")} created beside ${count === 1 ? "the original" : "their originals"}. Ctrl+Z undoes it.`, true);
  }
  async function renameCopy(photo) {
    const answer = await HDRLibraryDialogs.ask({ title: "Rename Virtual Copy",
      fields: [{ name: "name", label: "Name", value: photo.copy_name }], confirm: "Rename" });
    if (!answer) return;
    const result = await api("/api/library/virtual-copies", { paths: [photo.path], action: "rename", ...answer });
    culling.setUndo(result.undo_available); await refreshCopies();
    confirmChange("Virtual copy renamed. Ctrl+Z undoes it.", result.undo_available);
  }
  async function removeCopy(photos) {
    const copies = photos.filter(photo => photo.copy_id), count = copies.length;
    if (!count) return;
    const photo = copies[0];
    if (!await HDRLibraryDialogs.ask({ title: count === 1 ? `Remove Virtual Copy “${photo.copy_name}”?` : `Remove ${count} Virtual Copies?`,
      message: count === 1 ? `This removes one grade of ${fileName(photo)}, with its own marks and tags. The photo itself stays, with its other grades. Nothing is deleted from disk.`
        : `This removes ${count} virtual copies, with their own marks and tags. The photos stay, with their other grades. Nothing is deleted from disk. A copy open in Grade is left in place.`,
      confirm: count === 1 ? "Remove copy" : `Remove ${count} copies`, danger: true })) return;
    const result = await api("/api/library/virtual-copies", { paths: copies.map(photo => photo.path), action: "remove" });
    culling.setUndo(result.undo_available); await refreshCopies();
    confirmChange(`${plural(result.count, "virtual copy", "virtual copies")} removed. The photos stay.${result.count ? " Ctrl+Z brings them back." : ""} ${result.warnings.join(" ")}`.trim(), result.undo_available);
  }
  const REVERTS = Object.freeze({
    previous: { label: "Restore previous grade…", title: what => `Restore Previous Grade of ${what}?`, done: "Restored the previous grade of",
      message: count => `${plural(count, "photo")} ${count === 1 ? "goes" : "go"} back to ${count === 1 ? "its" : "their"} previous grade.` },
    saved: { label: "Revert to last saved…", title: what => `Revert ${what} to Last Saved?`, done: "Reverted to last saved:",
      message: () => "The unsaved changes in Grade are dropped." },
    session: { label: "Revert to last session…", title: what => `Revert ${what} to Last Session?`, done: "Reverted to last session:",
      message: count => `${plural(count, "photo")} ${count === 1 ? "goes" : "go"} back to the grade ${count === 1 ? "it" : "they"} had before the session that last changed ${count === 1 ? "it" : "them"}.` },
    original: { label: "Revert to original…", title: what => `Revert ${what} to Original?`, done: "Reverted to original:",
      message: count => `All adjustments are cleared on ${plural(count, "photo")}.` },
  });
  async function revertGrades(paths, target, count) {
    const revert = REVERTS[target], one = count === 1;
    const what = paths.length === 1 ? selected().name : `${plural(count, "Photo")}`;
    const kept = target === "saved" ? "" : ` ${one ? "It keeps" : "Each keeps"} its previous grade, so this can be taken back.`;
    if (!await HDRLibraryDialogs.ask({ title: revert.title(what), message: `${revert.message(count)}${kept} Marks and tags are not touched.`, confirm: target === "previous" ? "Restore" : "Revert" })) return;
    const result = await api("/api/library/grade-reverts", { paths, target });
    if (result.session) postParent("grade-replaced", { session: result.session });
    culling.setUndo(result.undo_available);
    confirmChange(`${revert.done} ${plural(result.count, "photo")}.${target === "saved" ? "" : ` ${result.count === 1 ? "It keeps" : "Each keeps"} its previous grade.`}${result.undo_available ? " Ctrl+Z undoes it." : ""}`, result.undo_available);
    await pollSettings();
  }
  const commandState = () => postParent("command-state", {selected: state.selection.size, copied: pasteGrades.available()});
  function invalidateGradePictures(paths, updating = true) {
    const targets = new Set(paths);
    for (const map of [state.cells, state.filmCells]) for (const [path, cell] of map) if (targets.has(path)) { cell.controller.abort(); cell.element.remove(); map.delete(path); }
    if (updating) for (const photo of state.allPhotos) if (targets.has(photo.path)) { photo.pictureCurrent = false; photo.picture_updating = true; }
    if (targets.has(selected()?.path)) { state.single?.abort(); state.fitMeta = null; state.nativeMeta = null; }
  }
  const pasteGrades = HDRGradePaste.create({api, status,
    prepare: paths => standalone ? libraryDesktop?.prepareLibraryPaste?.(paths) ?? Promise.resolve(false) : parent.HDRLibraryHost.preparePaste(paths),
    changed: (_clipboard, result) => {
      commandState(); if (!result) return;
      const paths = (result.photos || []).map(photo => photo.path);
      invalidateGradePictures(paths.length ? paths : [...state.selection]);
      for (const row of result.photos || []) { const photo = state.allPhotos.find(photo => photo.path === row.path); if (photo) Object.assign(photo, row); }
      culling.setUndo(result.undo_available);
      if (result.session) postParent("grade-replaced", {session:result.session});
      confirmChange(`Pasted grade onto ${plural(result.count, "photo")}. Each keeps its previous grade. ${(result.warnings || []).map(warning => typeof warning === "string" ? warning : `${warning.path.split(/[\\/]/).at(-1)}: ${warning.message}`).join(" ")} Ctrl+Z undoes it.`, result.undo_available);
      applyQuery(); paintGrid(); paintFilm(); if (state.view === "single") showSingle();
      void activity.refresh();
    }
  });
  const safeCommand = work => Promise.resolve().then(work).catch(error => status(error.message));
  const commands = Object.freeze({copy: () => safeCommand(() => state.selection.size === 1 && pasteGrades.copy(selected()?.path)),
    paste: (choose = false) => safeCommand(() => pasteGrades.paste([...state.selection], choose)),
    quickExport: () => { if (state.selection.size) postParent("quick-export", {paths:[...state.selection]}); },
    openExport: () => { if (state.selection.size) postParent("export-selection", {paths:[...state.selection]}); },
    selection: () => [...state.selection], canCopy: () => state.selection.size === 1, canPaste: () => !!state.selection.size && pasteGrades.available()});
  window.HDRLibraryCommands = commands;
  function libraryCommand(command) {
    if (document.querySelector("dialog[open]") || document.activeElement?.matches("input,textarea,select,[contenteditable]")) return;
    if (command === "copy-grade") return commands.copy();
    if (command === "paste-grade" || command === "paste-grade-choose") return commands.paste(command === "paste-grade-choose");
    if (command === "quick-export") return commands.quickExport();
    if (command === "undo") return culling.undo();
  }
  libraryDesktop?.onMenuCommand?.(({command}) => libraryCommand(command));
  void pasteGrades.refresh().catch(() => {});
  async function photoMenu(event, photo) {
    event.preventDefault();
    const index = state.photos.findIndex(item => item.path === photo.path);
    if (!state.selection.has(photo.path)) select(index); else { state.index = index; updateDetails(); }
    const paths = [...state.selection], one = paths.length === 1, grades = [];
    try {
      const { counts } = await api("/api/library/grade-reverts", { paths });
      for (const [target, revert] of Object.entries(REVERTS)) if (counts[target]) grades.push({ label: revert.label, run: () => revertGrades(paths, target, counts[target]) });
    } catch (error) { status(error.message); }
    const chosen = state.photos.filter(item => state.selection.has(item.path));
    grades.push({label:"Copy grade", key:"Ctrl+C", disabled:!commands.canCopy(), run:commands.copy},
      {label:"Paste grade", key:"Ctrl+V", disabled:!commands.canPaste(), run:() => commands.paste()},
      {label:"Paste grade (choose settings)…", key:"Ctrl+Shift+V", disabled:!commands.canPaste(), run:() => commands.paste(true)},
      {separator:true}, {label:"Quick export…",key:"Ctrl+Shift+E",run:commands.quickExport},
      {label:"Open in Export",run:commands.openExport});
    grades.push({ label: "Create virtual copy…", run: () => createCopy(chosen) });
    if (one && photo.copy_id) grades.push({ label: "Rename copy…", run: () => renameCopy(photo) });
    showMenu(event, [{ header: one ? photo.name : `${paths.length.toLocaleString()} photos` },
      ...(one ? [{ label: "Open in Grade", key: "Enter", run: openGrade }] : []),
      ...(grades.length ? [...(one ? [{ separator: true }] : []), ...grades] : []),
      { separator: true }, ...albums.menuActions(paths),
      ...(one && !photo.copy_id ? [{label:"Rename photo…",run:()=>fileCommands.rename(photo)}] : []),
      ...(chosen.some(p=>!p.copy_id) ? [{label:"Move to folder…",run:()=>fileCommands.move(chosen)}] : []),
      ...(chosen.some(item => !item.copy_id) ? [{label:'Delete…',key:'Del',danger:true,run:()=>fileCommands.remove(chosen)}] : []),
      ...(chosen.some(item => item.copy_id) ? [{ separator: true }, { label: "Remove virtual copy…", key: "Del", danger: true, run: () => removeCopy(chosen) }] : [])],
      { label: "Photo actions", onError: error => status(error.message) });
  }
  const compare = HDRLibraryCompare.create({api,status,load:(photo,edge,...args)=>loadAndShow(photo,2560,...args),preparePicture:(photo,edge,signal) =>
    HDRLibraryScenes.load(photo.path,2560,signal,0),
    prepareNative:prepareRawNative,draw:drawPicture,strip:culling.strip,
    selected,photos:()=>state.photos,allPhotos:()=>state.allPhotos,active:()=>state.active,
    choose:path=>select(state.photos.findIndex(p=>p.path===path)),setView,
    zoom:()=>({enabled:state.zoom,x:state.zoomX,y:state.zoomY,scale:state.zoomScale}),
    setZoom:(enabled,x,y,scale=state.zoomScale)=>{state.zoom=enabled;state.zoomX=x;state.zoomY=y;state.zoomScale=scale;$("zoom-button").setAttribute("aria-pressed",String(enabled));}
  });
  void compare.init();
  overlays = HDRLibraryOverlays.create({api,status,active:()=>state.active, surfaces:()=>[
    ...[...shownCells(state.cells),...shownCells(state.filmCells)].filter(s=>s.meta).map(s=>({...s,current:()=>state.active&&s.element.isConnected&&!s.controller.signal.aborted})),
    ...(state.view==="single"&&!compare.enabled()&&state.fitMeta?[{photo:selected(),canvas:$("single-picture"),meta:state.fitMeta,controller:state.single,current:()=>state.active&&state.view==="single"&&!compare.enabled()}]:[]),
    ...(compare.enabled()&&state.view==="single"?compare.surfaces().filter(s=>s.meta).map(s=>({...s,canvas:s.fit,current:()=>state.active&&compare.enabled()&&s.fit.isConnected&&!s.controller.signal.aborted})):[])
  ]});
  void overlays.init();
  function updateSingleCaption() {
    if (compare.enabled()) compare.captions();
    if (!selected()) return;
    const updating = selected().picture_updating ? " · Updating saved-grade picture · showing default look" : "";
    $("single-caption").replaceChildren(document.createTextNode(selected().name + updating), culling.strip(selected()));
  }
  function select(index, scroll = false, mode = "single") {
    if (!state.photos.length) return;
    if (compare.enabled() && state.view === "single") mode = "single";
    const next = HDRLibrarySelection.choose(state.photos.map(photo => photo.path), state.selection, state.anchor, index, mode);
    const previousIndex = state.index;
    state.index = next.index; state.selection = next.selected; state.anchor = next.anchor; updateDetails();
    startRawAhead(previousIndex);
    if (state.view === "grid") {
      if (scroll && state.layout) {
        const top = Math.floor(state.index / state.layout.columns) * state.layout.rowHeight;
        if (top < grid.scrollTop) grid.scrollTop = top;
        else if (top + state.layout.rowHeight + 3 > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + state.layout.rowHeight + 3 - grid.clientHeight;
      }
      paintGrid();
    } else {
      const left = state.index * FILM_PITCH;
      if (left < film.scrollLeft) film.scrollLeft = left;
      else if (left + FILM_PITCH + 3 > film.scrollLeft + film.clientWidth) film.scrollLeft = left + FILM_PITCH + 3 - film.clientWidth;
      paintFilm(); showSingle();
    }
  }
  function singleEdge() {
    return Math.max(1280, Math.min(2560, Math.max(browsingSize.width,browsingSize.height)));
  }
  async function showSingle() {
    if (!state.active || state.view !== "single") return;
    if (compare.enabled()) { void compare.show(); return; }
    const photo = selected(), edge = singleEdge();
    const identity = photo ? `${photo.path}|${edge}|${state.hdr}|${state.displayEpoch}|${photo.grade_identity || ""}|${photo.picture_key || ""}|${photo.bytes}|${photo.mtime_ns}` : "";
    if (identity && identity === state.singleIdentity && !state.single?.signal.aborted) { positionZoom(); return; }
    state.singleIdentity = identity;
    const fullIdentity = photo ? `${photo.path}|${photo.bytes}|${photo.mtime_ns}` : "";
    if (state.fullIdentity !== fullIdentity || state.nativeSource?.signal.aborted) {
      state.nativeSource?.abort(); state.fullDetail = null; state.fullSceneQuality = null;
      state.fullIdentity = fullIdentity; state.nativeSource = new AbortController();
    }
    state.single?.abort(); state.native?.abort(); state.nativeMeta = null; state.nativeLoading = false; state.fitMeta = null; $("native-picture").hidden = true;
    if (!photo || !state.active || state.view !== "single") return;
    compare.hide();
    const controller = new AbortController(); state.single = controller;
    const current = () => state.active && state.view === "single" && selected()?.path === photo.path && !controller.signal.aborted;
    status(`Loading ${photo.name}…`);
    try {
      startRawAhead();
      const prepared = HDRLibraryScenes.load(photo.path,2560,controller.signal,0);
      const neighbours = [state.photos[state.index + 1], state.photos[state.index - 1]].filter(Boolean);
      readAhead.update(photo, neighbours, 2560);
      const meta = await loadAndShow(photo, 2560, $("single-picture"), controller, current, 0, prepared);
      if (!meta || !current()) return;
      if (state.fullSceneQuality && state.fullSceneQuality !== meta.quality) {
        state.nativeSource?.abort(); state.nativeSource = new AbortController(); state.fullDetail = null;
      }
      state.fullSceneQuality = meta.quality;
      state.fitMeta = meta; positionZoom(); if (state.zoom) void showNative();
      updateSingleCaption();
      status(`${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`);
    } catch (error) { if (state.single === controller) state.singleIdentity = ""; if (!aborted(error) && !controller.signal.aborted) removeUnreadable(photo, error); }
  }
  function positionZoom() {
    const canvas = $("single-picture"), native = $("native-picture"), stage = $("single-stage"), meta = state.nativeMeta || state.fitMeta;
    stage.classList.toggle("zoomed", state.zoom);
    if (!state.zoom || !meta) { canvas.style.cssText = ""; native.hidden = true; return; }
    const dpr = window.devicePixelRatio || 1, scale = state.zoomScale;
    const width = (meta.source_width || meta.width * 2) * scale, height = (meta.source_height || meta.height * 2) * scale;
    const center = HDRLibraryZoom.center(state.zoomX, state.zoomY, width, height, stage.clientWidth * dpr, stage.clientHeight * dpr);
    state.zoomX = center.x; state.zoomY = center.y;
    const left = stage.clientWidth / 2 - center.x * width / dpr, top = stage.clientHeight / 2 - center.y * height / dpr;
    canvas.style.cssText = `position:absolute;width:${width / dpr}px;height:${height / dpr}px;left:${left}px;top:${top}px;object-fit:fill`;
    if (state.nativeMeta) {
      const crop = state.nativeMeta;
      native.style.cssText = `width:${crop.width * scale / dpr}px;height:${crop.height * scale / dpr}px;left:${left + crop.crop_x * scale / dpr}px;top:${top + crop.crop_y * scale / dpr}px`;
      native.hidden = false;
    }
  }
  async function prepareRawNative(photo, signal) {
    if (!rawCandidate(photo)) return;
    if (!HDRLibraryGpuRaw.enabled()) {
      HDRLibraryStopwatch("gpu_raw_fallback",{path:photo.path,reason:"WebGPU is unavailable or disabled."}); return;
    }
    try { await HDRLibraryGpuRaw.thumbnail(photo.path,2560,signal,{nativeMode:true}); }
    catch(error) { if (aborted(error)) throw error; HDRLibraryStopwatch("gpu_raw_fallback",{path:photo.path,reason:error.message}); }
  }
  async function showNative() {
    const photo = selected(); if (!photo || !state.fitMeta || !state.zoom || !state.active || state.view !== "single") return;
    const stage = $("single-stage"), dpr = window.devicePixelRatio || 1, scale = state.zoomScale, percent = `${Math.round(scale * 100)}%`;
    const fit = state.fitMeta;
    if (fit.source_width && fit.width >= fit.source_width * scale) {
      state.native?.abort(); state.nativeMeta = null; state.nativeLoading = false; $("native-picture").hidden = true; positionZoom();
      status(`${percent} · ${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`); return;
    }
    state.native?.abort(); const controller = new AbortController(); state.native = controller; state.nativeLoading = true;
    const current = () => state.active && state.zoom && state.view === "single" && selected()?.path === photo.path && !controller.signal.aborted;
    status(`Loading ${percent} · ${photo.name}…`);
    try {
      // Development belongs to the selected photo, not the zoom gesture. A
      // zoom-out or pan cancels presentation while this one source completes.
      if (!state.fullDetail) {
        const pending = HDRLibraryScenes.load(photo.path,100000,state.nativeSource.signal,0);
        state.fullDetail = pending;
        pending.catch(()=>{ if (state.fullDetail === pending) state.fullDetail = null; });
      }
      let full = await state.fullDetail;
      if (!current()) return;
      if (full.grade_identity !== state.fitMeta.grade_identity) {
        // Finishing changes describe the same stored source with the new grade.
        state.fullDetail = HDRLibraryScenes.load(photo.path,100000,state.nativeSource.signal,0);
        full = await state.fullDetail;
        if (!current()) return;
      }
      const width = Math.min(full.width,Math.ceil(stage.clientWidth*dpr/scale)), height = Math.min(full.height,Math.ceil(stage.clientHeight*dpr/scale));
      const x = Math.max(0,Math.min(full.width-width,Math.round(state.zoomX*full.width-width/2)));
      const y = Math.max(0,Math.min(full.height-height,Math.round(state.zoomY*full.height-height/2)));
      const meta = {...full,crop_x:0,crop_y:0,viewport:{x,y,width,height}};
      // Draw off screen, then swap. Drawing into the shown canvas would show the new
      // crop at the old crop's place for a frame, a flicker during and after a pan.
      const next = $("native-picture-next");
      await drawPicture(meta, next, controller, current);
      if (!current()) return;
      const shown = $("native-picture");
      shown.id = "native-picture-next"; shown.hidden = true; shown.removeAttribute("aria-label"); shown.setAttribute("aria-hidden", "true");
      next.id = "native-picture"; next.removeAttribute("aria-hidden"); next.setAttribute("aria-label", "Native-resolution crop");
      state.nativeMeta = {...meta,width,height,crop_x:x,crop_y:y}; next.dataset.picturePath = photo.path; positionZoom();
      status(`${percent} · ${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`);
    } catch (error) {
      if (error.libraryYield && current()) { setTimeout(()=>{ if (current()) void showNative(); },100); }
      else if (!aborted(error) && current()) status(`${percent} unavailable · ${error.message}`);
    }
    finally { if (state.native === controller) state.nativeLoading = false; }
  }
  function toggleZoom(point) {
    if (state.view !== "single" || !selected()) return;
    if (compare.enabled()) { compare.zoom(); return; }
    state.zoom = !state.zoom; state.zoomScale = 1; state.native?.abort(); state.nativeLoading = false; state.nativeMeta = null;
    if (state.zoom && point && state.fitMeta) {
      const stage = $("single-stage"), meta = state.fitMeta;
      const center = HDRLibraryZoom.click(point.x, point.y, stage.clientWidth, stage.clientHeight, meta.source_width || meta.width, meta.source_height || meta.height);
      state.zoomX = center.x; state.zoomY = center.y;
    }
    $("zoom-button").setAttribute("aria-pressed", String(state.zoom));
    positionZoom(); if (state.zoom) void showNative();
  }
  $("zoom-button").addEventListener("click", () => toggleZoom());
  let drag = null, nativeTimer;
  const singleStage = $("single-stage");
  singleStage.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !state.fitMeta) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, centerX: state.zoomX, centerY: state.zoomY, moved: false };
    singleStage.setPointerCapture(event.pointerId); event.preventDefault();
  });
  singleStage.addEventListener("pointermove", event => {
    if (!drag || !state.zoom) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 4 && !drag.moved) return;
    drag.moved = true; state.native?.abort();
    const meta = state.nativeMeta || state.fitMeta, dpr = window.devicePixelRatio || 1;
    state.zoomX = drag.centerX - dx * dpr / ((meta.source_width || meta.width * 2) * state.zoomScale);
    state.zoomY = drag.centerY - dy * dpr / ((meta.source_height || meta.height * 2) * state.zoomScale);
    positionZoom(); clearTimeout(nativeTimer); nativeTimer = setTimeout(showNative, 120);
  });
  function endPan(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved; drag = null; clearTimeout(nativeTimer);
    if (singleStage.hasPointerCapture(event.pointerId)) singleStage.releasePointerCapture(event.pointerId);
    if (event.type === "pointercancel") return;
    if (moved) void showNative();
    else { const rect = singleStage.getBoundingClientRect(); toggleZoom({ x: event.clientX - rect.left, y: event.clientY - rect.top }); }
  }
  singleStage.addEventListener("pointerup", endPan); singleStage.addEventListener("pointercancel", endPan);
  singleStage.addEventListener("wheel", event => {
    if (state.view !== "single" || !state.fitMeta || !selected() || compare.enabled()) return;
    event.preventDefault();
    const meta = state.nativeMeta || state.fitMeta, dpr = window.devicePixelRatio || 1, rect = singleStage.getBoundingClientRect();
    const sourceWidth = meta.source_width || meta.width * 2, sourceHeight = meta.source_height || meta.height * 2;
    const width = singleStage.clientWidth * dpr, height = singleStage.clientHeight * dpr;
    const fit = HDRLibraryZoom.fitScale(sourceWidth, sourceHeight, width, height);
    const from = state.zoom ? state.zoomScale : fit;
    const to = HDRLibraryZoom.wheel(from, event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1), fit);
    if (to === from) return;
    state.native?.abort(); clearTimeout(nativeTimer);
    if (to <= fit) {
      state.zoom = false; state.nativeLoading = false; state.nativeMeta = null;
      $("zoom-button").setAttribute("aria-pressed", "false"); positionZoom();
      status(`${state.index + 1} of ${state.photos.length.toLocaleString()} · ${selected().name}`); return;
    }
    const start = state.zoom ? { x: state.zoomX, y: state.zoomY } : { x: .5, y: .5 };
    const center = HDRLibraryZoom.anchor(start.x, start.y, (event.clientX - rect.left) * dpr, (event.clientY - rect.top) * dpr, width, height, sourceWidth, sourceHeight, from, to);
    state.zoom = true; state.zoomScale = to; state.zoomX = center.x; state.zoomY = center.y;
    $("zoom-button").setAttribute("aria-pressed", "true");
    positionZoom(); nativeTimer = setTimeout(showNative, 150);
  }, { passive: false });
  function setView(view) {
    if (view === "single" && !selected()) return;
    if (view !== "single") compare.hide();
    state.view = view; $("library-single").hidden = view !== "single"; grid.hidden = view !== "grid";
    $("zoom-button").disabled = view !== "single";
    $("grid-view").setAttribute("aria-pressed", String(view === "grid")); $("single-view").setAttribute("aria-pressed", String(view === "single"));
    if (view === "single") { clearCells(state.cells); select(state.index, true, "preserve"); }
    else { state.single?.abort(); state.native?.abort(); state.nativeSource?.abort(); clearPrefetch(); clearCells(state.filmCells); paintGrid(); }
  }
  function setReview(review) {
    if (review && !selected()) return;
    if (review) state.beforeReview = state.view;
    state.review = review; library.classList.toggle("review", review);
    if (review) setView("single"); else setView(state.beforeReview);
    postParent("review", { enabled: review });
  }
  function openGrade() {
    if (!selected()) return;
    if (state.review) setReview(false);
    const clickedAt = performance.timeOrigin + performance.now();
    HDRLibraryStopwatch("grade_open_click", { path: selected().path });
    postParent("open-source", { path: selected().source_path || selected().path, itemKey: selected().path, clickedAt });
  }
  const browse = path => openPlace({ path });
  const browseCollection = (kind, name) => openPlace({ kind, name });
  async function openPlace(place) {
    const path = place.path || "";
    restoreSourceSort(place);
    state.scan?.abort(); state.single?.abort(); state.native?.abort(); clearPrefetch(); clearCells(state.cells); clearCells(state.filmCells);
    state.collection = place.kind ? { kind: place.kind, name: place.name } : null; state.smartFilters = null; albums.setActive(place.kind === "album" ? place.name : ""); smart.setActive(place.kind === "smart" ? place.name : "");
    if (path) state.lastFolder = path;  // Where a deleted album's view returns to.
    const controller = new AbortController(); state.scan = controller; state.path = path; state.reading = true; state.scanError = ""; state.allPhotos = []; state.photos = []; state.index = -1; state.selection.clear(); state.anchor = -1; state.hiddenFiles = 0;
    setView("grid"); grid.scrollTop = 0;
    $("check-photos").disabled = !path;
    $("place-title").textContent = place.kind === "smart" ? smart.name(place.name) || "Smart album" : place.kind === "album" ? place.name : place.kind ? `Tag · ${place.name}` : path.split(/[\\/]/).filter(Boolean).at(-1) || path;
    $("place-title").title = place.kind === "smart" ? "Smart album · saved filter across the indexed library" : place.kind === "album" ? "Album. Photos stay where they are." : place.kind ? "Every connected photo that carries this tag" : path; status(place.kind ? "Reading…" : "Reading folder…");
    for (const element of $("folders").querySelectorAll(".library-folder-row")) element.classList.toggle("active", !place.kind && element.dataset.path === path);
    try {
      const result = place.kind === "smart" ? await smart.open(place.name) : place.kind ? await api("/api/library/collection", { kind: place.kind, name: place.name }, controller.signal) : await api("/api/library/scan", { path }, controller.signal);
      if (controller.signal.aborted) return;
      if (place.kind === "smart") { state.smartFilters = result.filters; state.smartIndexing = result.indexing; $("place-title").textContent = result.name; }
      HDRLibraryStopwatch("folder_listed", { path });
      state.reading = false; state.allPhotos = result.photos; state.photos = result.photos; state.index = result.photos.length ? 0 : -1;
      state.selection = new Set(state.index >= 0 ? [state.photos[0].path] : []); state.anchor = state.index;
      culling.setUndo(result.undo_available);
      applyQuery();
      const notes = [...(result.unreadable_folders.length ? ["Some sub-folders could not be read"] : []), ...(result.missing ? [`${result.missing.toLocaleString()} more are on folders that are not connected`] : [])];
      if (notes.length) status(`${result.photos.length.toLocaleString()} photos · ${notes.join(" · ")}`);
      if (result.warnings?.length) status(result.warnings[0]);
      void readDates(controller, result.photos.filter(photo => !photo.indexed));
    } catch (error) { if (!aborted(error) && state.scan === controller) { state.reading = false; state.scanError = error.message; status(error.message); paintGrid(); } }
  }
  function applyQuery() {
    paintFilterButton();
    const lead = selected()?.path, anchor = state.photos[state.anchor]?.path;
    const base = state.collection?.kind === "smart" ? HDRLibraryQuery.apply(state.allPhotos, state.sort, state.descending, state.smartFilters || {}) : state.allPhotos;
    state.photos = HDRLibraryQuery.apply(base, state.sort, state.descending, state.filters);
    const visible = new Set(state.photos.map(photo => photo.path));
    state.selection = new Set([...state.selection].filter(path => visible.has(path)));
    state.index = state.photos.findIndex(photo => photo.path === lead);
    if (state.index < 0 && state.photos.length) { state.index = 0; state.selection.add(state.photos[0].path); }
    state.anchor = state.photos.findIndex(photo => photo.path === anchor);
    if (state.anchor < 0) state.anchor = state.index;
    if (!selected() && state.view === "single") setView("grid");
    updateDetails(); paintGrid(); paintFilm();
    startRawAhead();
    if (state.view === "single" && selected()?.path !== lead) showSingle();
    if (!state.reading) status(`${state.photos.length.toLocaleString()} of ${state.allPhotos.length.toLocaleString()} photos${state.hiddenFiles ? ` · ${state.hiddenFiles} unreadable files hidden` : ""}${state.collection?.kind === "smart" && state.smartIndexing ? " · Indexing is still running, so more may turn up." : ""}`);
  }
  async function readDates(controller, photos) {
    // One small low-priority batch at a time; picture connections stay available.
    for (let start = 0; start < photos.length && !controller.signal.aborted; start += 32) {
      try {
        const result = await api("/api/library/metadata", { paths: photos.slice(start, start + 32).map(photo => photo.path) }, controller.signal);
        if (controller.signal.aborted || state.scan !== controller) return;
        const byPath = new Map(result.photos.map(photo => [photo.path, photo]));
        for (const photo of photos.slice(start, start + 32)) { const name=photo.name; Object.assign(photo, byPath.get(photo.path)); if(photo.copy_id)photo.name=name; }
        if (state.sort === "time" || state.filters.rules?.length) applyQuery();
        else if (byPath.has(selected()?.path)) updateDetails();
      } catch (error) { if (!aborted(error)) console.debug("Library capture dates:", error.message); return; }
    }
  }
  function folderRow(folder, depth = 0) {
    const wrapper = document.createElement("div"), row = document.createElement("div"), children = document.createElement("div");
    row.className = "library-folder-row"; row.dataset.path = folder.path; row.style.paddingLeft = `${depth * 14}px`;
    if (folder.available === false) row.classList.add("unavailable");
    const expand = document.createElement("button"); expand.className = "expand-folder"; expand.setAttribute("aria-expanded", "false"); expand.setAttribute("aria-label", `Expand ${folder.name}`);
    const name = document.createElement("button"); name.className = "folder-name"; name.textContent = folder.name; name.title = folder.path;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", String(state.folderSelection.has(folder.path)));
    name.addEventListener("click", event => {
      const paths = [...$("folders").querySelectorAll(".library-folder-row")].map(item => item.dataset.path);
      if (event.shiftKey && paths.includes(state.folderAnchor)) {
        const from = paths.indexOf(state.folderAnchor), to = paths.indexOf(folder.path);
        if (!event.ctrlKey && !event.metaKey) state.folderSelection.clear();
        paths.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(path => state.folderSelection.add(path));
      } else if (event.ctrlKey || event.metaKey) {
        state.folderSelection.has(folder.path) ? state.folderSelection.delete(folder.path) : state.folderSelection.add(folder.path);
        state.folderAnchor = folder.path;
      } else {
        state.folderSelection = new Set([folder.path]); state.folderAnchor = folder.path; void browse(folder.path);
      }
      paintFolderSelection();
    });
    bindFolderMenu(row, folder.path);
    expand.addEventListener("click", async () => {
      const open = expand.getAttribute("aria-expanded") === "true";
      expand.setAttribute("aria-expanded", String(!open)); children.hidden = open;
      if (open || children.childElementCount) return;
      try { const result = await api("/api/library/tree", { path: folder.path }); children.replaceChildren(...result.children.map((item) => folderRow(item, depth + 1))); }
      catch (error) { status(error.message); }
    });
    row.append(expand, name); if (depth === 0) navigation.pinHandle(row, folder.path); wrapper.append(row, children); return wrapper;
  }
  async function refreshPins() {
    const result = await api("/api/library/pins"); state.pins = navigation.orderPins(result.pinned);
    $("folders").replaceChildren(...state.pins.map((pin) => folderRow(pin))); paintGrid();
  }
  function paintFolderSelection() {
    for (const row of $("folders").querySelectorAll(".library-folder-row")) {
      row.setAttribute("aria-selected", String(state.folderSelection.has(row.dataset.path)));
    }
  }
  async function requestCheck(paths) {
    await api("/api/library/checks", { paths }); await activity.refresh();
  }
  $("delete-rejected").addEventListener("click", () => {
    const base=state.collection?.kind==='smart' ? HDRLibraryQuery.apply(state.allPhotos,state.sort,state.descending,state.smartFilters||{}) : state.allPhotos;
    void fileCommands.remove(base.filter(p=>p.marks?.pick==='reject'),true).catch(error=>status(error.message));
  });
  $("check-photos").addEventListener("click", () => { if (state.path) void requestCheck([state.path]).catch(error => status(error.message)); });
  function bindFolderMenu(element, path) {
    element.addEventListener("contextmenu", event => showFolderMenu(event, path));
    element.addEventListener("dragover", event => { if(!state.picker && event.dataTransfer.types.includes(HDRLibraryAlbums.DRAG)) {event.preventDefault();event.dataTransfer.dropEffect="move";} });
    element.addEventListener("drop", event => { if(state.picker || !event.dataTransfer.types.includes(HDRLibraryAlbums.DRAG))return;event.preventDefault();event.stopPropagation();void fileCommands.move(state.photos.filter(p=>state.selection.has(p.path)),path).catch(e=>status(e.message)); });
    element.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) showFolderMenu(event, path);
    });
  }
  function showFolderMenu(event, path = "") {
    const key = value => /^[a-z]:|^\\\\/i.test(value) ? value.toLowerCase() : value;
    if (path && !state.folderSelection.has(path)) { state.folderSelection = new Set([path]); paintFolderSelection(); }
    const pinned = state.pins.find(pin => key(pin.path) === key(path));
    const actions = path ? [{ label: pinned ? "Unpin folder" : "Pin folder", run: async () => {
      if (pinned) {
        const impact = await api("/api/library/pins/impact", { path: pinned.path });
        const message = `${impact.leaving.toLocaleString()} photos leave the library. ${impact.kept ? `${impact.kept.toLocaleString()} stay because they are in albums. ` : ""}Nothing is deleted from disk.`;
        if (!await HDRLibraryDialogs.ask({ title: `Stop showing ${pinned.name}?`, message, confirm: "Unpin folder" })) return;
      }
      await api(pinned ? "/api/library/pins/remove" : "/api/library/pins", pinned ? { path: pinned.path } : { paths: [path] });
      await refreshPins();
      updateDetails(); void albums.refresh().catch(error => status(error.message)); void tagWindow.refresh().catch(error => status(error.message));
      if (state.collection || state.path) void reopen();
      status(pinned ? "Folder unpinned. Photos stay where they are." : "Folder pinned.");
    }}] : [{ label: "Add folder…", run: openPicker }];
    if (path && !state.picker) {
      const selection = [...state.folderSelection];
      const control = async (action, name = "") => {
        const result = await api("/api/library/folder-command", { action, paths: action === "show" ? selection : [path], name });
        culling.setUndo(result.undo_available); await refreshPins();
        if (action === "new") await browse(path);
        confirmChange(action === "new" ? `Folder ${name} created. Ctrl+Z removes it while empty.` : action === "label" ? "Folder label saved. The folder on disk is unchanged." : "Opened in Explorer.", result.undo_available);
      };
      actions.push({ separator: true },
        { label: "New folder inside…", disabled: selection.length !== 1, run: async () => {
          const answer = await HDRLibraryDialogs.ask({ title: "New folder inside", fields: [{ name: "name", label: "Folder name" }], confirm: "Create folder" });
          if (answer) await control("new", answer.name);
        } },
        ...(pinned ? [{ label: "Rename label…", disabled: selection.length !== 1, run: async () => {
          const answer = await HDRLibraryDialogs.ask({ title: "Rename label", message: "Only the name in this list changes.", fields: [{ name: "name", label: "Label", value: state.pins.find(p => p.path === path)?.name }], confirm: "Save label" });
          if (answer) await control("label", answer.name);
        } }] : []),
        { label: "Rename folder…", disabled: selection.length !== 1, run: () => fileCommands.folder('folder_rename',selection) },
        { label: "Move folder…", run: () => fileCommands.folder('folder_move',selection) },
        { label: "Show in Explorer", run: () => control("show") });
    }
    if (path && !state.picker) actions.unshift({ label: "Check for new photos", run: () => requestCheck([...state.folderSelection]) }, { separator: true });
    showMenu(event, actions, { label: "Folder actions", anchor: event.target.closest("button") || $("add-folder"),
      onError: error => { if (state.picker) $("picker-status").textContent = error.message; else status(error.message); } });
  }
  $("folders").addEventListener("contextmenu", event => showFolderMenu(event));
  function pickerBrowse(path = "", returnPath = "") { return state.picker?.browse(path, returnPath); }
  function openPicker() {
    state.picker = HDRLibraryFolderPicker.create({ api, sleep, bindFolderMenu, closeFolderMenu });
    $("folder-picker").showModal(); pickerBrowse(state.path);
  }
  ["list", "grid"].forEach(view => $(`picker-view-${view}`).addEventListener("click", () => state.picker?.setView(view)));
  $("picker-pin").addEventListener("click", async () => {
    const picker = state.picker; if (!picker?.current) return;
    const paths = picker.selection.size ? [...picker.selection].map((index) => picker.entries[index].path) : [picker.current];
    $("picker-pin").disabled = true;
    try { const result = await api("/api/library/pins", { paths }); $("folder-picker").close(); await refreshPins(); await browse(paths[0]); if (result.skipped) status(`${state.photos.length.toLocaleString()} photos · ${result.skipped} already pinned folders skipped`); }
    catch (error) { $("picker-status").textContent = error.message; }
    finally { $("picker-pin").disabled = false; }
  });
  $("folder-picker").addEventListener("close", () => { closeFolderMenu(); state.picker?.stop(); state.picker = null; });
  $("picker-cancel").addEventListener("click", () => $("folder-picker").close());
  $("picker-go").addEventListener("click", () => pickerBrowse($("picker-path").value));
  $("picker-path").addEventListener("keydown", (event) => { if (event.key === "Enter") pickerBrowse(event.target.value); });
  $("picker-up").addEventListener("click", () => pickerBrowse(state.picker.parent, state.picker.current));
  $("add-folder").addEventListener("click", openPicker); $("empty-add").addEventListener("click", openPicker);
  $("open-image").addEventListener("click", () => postParent("choose-source"));
  $("grid-view").addEventListener("click", () => setView("grid")); $("single-view").addEventListener("click", () => setView("single")); $("review-view").addEventListener("click", () => setReview(true));
  function collapse(side, closed) {
    library.classList.toggle(`library-${side}-closed`, closed);
    $(`collapse-${side}`).setAttribute("aria-expanded", String(!closed));
    $(`collapse-${side}`).setAttribute("aria-label", `${closed ? "Expand" : "Collapse"} ${side === "left" ? "folders" : "details"}`);
  }
  for (const side of ["left", "right"]) $(`collapse-${side}`).addEventListener("click", () => collapse(side, !library.classList.contains(`library-${side}-closed`)));
  function paintFilterButton() {
    const active = !!state.filters.rules?.length;
    $("filter-button").setAttribute("aria-pressed", String(active));
    $("filter-add").setAttribute("aria-pressed", String(active));
    $("filter-button").setAttribute("aria-expanded", String(!$("library-filterbar").hidden));
  }
  function toggleFilters() { $("library-filterbar").hidden = !$("library-filterbar").hidden; paintFilterButton(); }
  $("picture-settings").addEventListener("click", async () => {
    try {
      const prefs = await api("/api/library/picture-settings");
      const answer = await HDRLibraryDialogs.ask({ title: "Library pictures", message: `Saved-grade picture resolution. The Library cache location and separate size limits are in Settings › Performance.`, fields: [
        { name: "edge", label: "Edited-picture resolution", options: [{value:"screen",label:"Screen size"}, "512", "1024", "1920"], value: String(prefs.edited_resolution) }], confirm: "Save" });
      if (answer) { await api("/api/library/picture-settings", { edited_resolution: answer.edge === "screen" ? "screen" : Number(answer.edge) }); status("Library picture settings saved."); }
    } catch (error) { status(error.message); }
  });
  $("filter-button").addEventListener("click", toggleFilters);
  let openPopover = null;
  function closePopover() { if (!openPopover) return; openPopover.menu.hidden = true; openPopover.button.setAttribute("aria-expanded", "false"); openPopover = null; }
  function togglePopover(button, menu) {
    const opening = openPopover?.menu !== menu; closePopover(); if (!opening) return;
    menu.hidden = false; button.setAttribute("aria-expanded", "true"); openPopover = { button, menu };
    const bounds = button.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(bounds.left, innerWidth - menu.offsetWidth - 4))}px`; menu.style.top = `${bounds.bottom + 4}px`;
  }
  for (const name of ["sort", "more"]) {
    $(name + "-button").addEventListener("click", () => togglePopover($(name + "-button"), $(name + "-menu")));
    $(name + "-menu").addEventListener("click", event => { if (event.target.closest("button")) closePopover(); });
  }
  document.addEventListener("pointerdown", event => { if (openPopover && !openPopover.menu.contains(event.target) && !openPopover.button.contains(event.target)) closePopover(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && openPopover) { event.preventDefault(); event.stopImmediatePropagation(); const { button } = openPopover; closePopover(); button.focus(); } }, true);
  window.addEventListener("blur", closePopover); window.addEventListener("resize", closePopover);
  function paintSort() {
    for (const item of $("sort-menu").querySelectorAll("[data-sort]")) {
      item.setAttribute("aria-checked", String(item.dataset.sort === state.sort));
      if (item.dataset.sort === state.sort) $("sort-button").title = `Sorted by ${item.textContent.toLowerCase()}`;
    }
    const label = state.descending ? "Descending. Switch to ascending" : "Ascending. Switch to descending";
    $("sort-dir").dataset.descending = String(state.descending); $("sort-dir").setAttribute("aria-label", label); $("sort-dir").title = label;
  }
  function paintSize() {
    const input = $("thumbnail-size"), anchor = film.scrollLeft / FILM_PITCH;
    input.parentElement.style.setProperty("--fill-w", `${(input.value - input.min) / (input.max - input.min) * 100}%`);
    const width = Math.round(state.size * 116 / 190), pictureHeight = Math.round(width * 80 / 116);
    FILM_PITCH = width + 3;
    film.style.setProperty("--film-width", `${width}px`);
    film.style.setProperty("--film-picture-height", `${pictureHeight}px`);
    film.style.setProperty("--film-tile-height", `${pictureHeight + 25}px`);
    film.style.setProperty("--film-height", `${pictureHeight + 31}px`);
    $("film-space").style.width = `${state.photos.length * FILM_PITCH + 3}px`;
    film.scrollLeft = anchor * FILM_PITCH;
  }
  paintSort(); paintSize();
  $("sort-menu").addEventListener("click", event => { const item = event.target.closest("[data-sort]"); if (!item) return; state.sort = item.dataset.sort; saveSourceSort(); paintSort(); applyQuery(); });
  $("sort-dir").addEventListener("click", () => { state.descending = !state.descending; saveSourceSort(); paintSort(); applyQuery(); });
  $("raw-only").addEventListener("click", () => { state.filters.raw = !state.filters.raw; $("raw-only").setAttribute("aria-pressed", String(!!state.filters.raw)); applyQuery(); });
  $("filter-clear").addEventListener("click", () => { state.filters = { rules: [], raw: state.filters.raw }; ruleFilters.render(); applyQuery(); });
  const ruleFilters = HDRLibraryFilters.create({ bar: $("filter-rules"), addButton: $("filter-add"), photos: () => state.allPhotos,
    filters: () => state.filters, changed: () => applyQuery(), reading: () => state.allPhotos.some(photo => !photo.indexed) });
  // One health snapshot owns Activity, indexing and live writer state.
  function showIndexing(next) {
    const before = state.indexing?.passes; state.indexing = next;
    if (before !== next.passes) void albums.refresh().catch(error => status(error.message));
  }
  let fileRevision = 0;
  const activity = HDRLibraryActivity.create({ button: $("index-status"), panel: $("library-activity"), api, status,
    onHealth: next => { if(next.file_commands && next.file_commands.revision !== fileRevision) {fileRevision=next.file_commands.revision;if(next.file_commands.changes.length)void filesChanged({...next.file_commands,undo_available:culling.undoAvailable()});} showIndexing(next.index); void refreshCheckedFolders(next.index.checks); } });
  $("library-undo").addEventListener("click", () => { void culling.undo(); });
  let checkEvent = 0, refreshingCheck = false;
  const checkClient = crypto.randomUUID();
  async function refreshCheckedFolders(checks) {
    if (!checks || refreshingCheck || state.reading) return;
    const events = checks.events.filter(event => event.id > checkEvent);
    if (!events.length) return;
    refreshingCheck = true;
    const controller = state.scan, place = state.path, collection = state.collection;
    try {
      const changed = events.some(event => event.changed);
      if (changed) { void albums.refresh().catch(error => status(error.message)); void smart.refresh().catch(error => status(error.message)); void tagWindow.refresh().catch(error => status(error.message)); }
      if (changed && (collection || events.some(event => event.path === place || place.startsWith(event.path + "\\") || event.path.startsWith(place + "\\")))) {
        const result = collection?.kind === "smart" ? await smart.open(collection.name) : collection ? await api("/api/library/collection", { ...collection, cached: true }, controller?.signal)
          : await api("/api/library/view", { path: place }, controller?.signal);
        if (state.scan !== controller) return;
        if (result.photos) {
          const leadPhoto = selected(), lead = leadPhoto?.path, oldIndex = state.index;
          const top = grid.scrollTop, left = film.scrollLeft;
          state.allPhotos = result.photos; if (collection?.kind === "smart") { state.smartFilters = result.filters; state.smartIndexing = result.indexing; }
          if (!result.photos.some(photo => photo.path === lead)) {
            const sorted = HDRLibraryQuery.apply(result.photos, state.sort, state.descending, state.filters);
            const neighbour = sorted[Math.min(Math.max(0, oldIndex), sorted.length - 1)];
            if (neighbour) { state.photos = result.photos; state.index = result.photos.indexOf(neighbour); state.selection.add(neighbour.path); }
          }
          applyQuery(); grid.scrollTop = top; film.scrollLeft = left; paintGrid(); paintFilm();
          if (state.view === "single" && (selected()?.path !== lead || selected()?.bytes !== leadPhoto?.bytes || selected()?.mtime_ns !== leadPhoto?.mtime_ns)) showSingle();
        }
        for (const expand of $("folders").querySelectorAll('.expand-folder[aria-expanded="true"]')) {
          const row = expand.parentElement, children = row.nextElementSibling;
          if (!row.isConnected) continue;
          const result = await api("/api/library/tree", { path: row.dataset.path }, controller?.signal);
          const existing = new Map([...children.children].map(wrapper => [wrapper.firstElementChild.dataset.path, wrapper]));
          children.replaceChildren(...result.children.map(folder => existing.get(folder.path) || folderRow(folder, Math.round(parseFloat(row.style.paddingLeft) / 14) + 1)));
        }
      }
      checkEvent = events.at(-1).id;
      status(events.map(event => event.message).join(" · "));
    } catch (error) { if (!aborted(error)) status(error.message); }
    finally { refreshingCheck = false; }
  }
  let writerEvent = 0;
  async function pollSettings() {
    if (state.active && !document.hidden) {
      try {
        if (state.collection?.kind === "smart") {
          const place = state.collection, snapshot = await smart.poll();
          if (snapshot && state.collection === place) {
            const changed = snapshot.changed || JSON.stringify(state.smartFilters) !== JSON.stringify(snapshot.filters) || state.smartIndexing !== snapshot.indexing;
            state.smartFilters = snapshot.filters; state.smartIndexing = snapshot.indexing;
            if (changed) { state.allPhotos = snapshot.photos; applyQuery(); }
          }
        }
        // A first saved grade is not yet marked edited in this page. Check only
        // visible pictures as well, so returning from Grade discovers it.
        const visible = new Set([...shownCells(state.cells), ...shownCells(state.filmCells)].map(cell => cell.photo.path).concat(selected()?.path));
        const paths = state.allPhotos.filter(photo => photo.storage === "database" || photo.edited || visible.has(photo.path)).map(photo => photo.path);
        // Grid order, so the photo top-left on screen is made first.
        const onScreen = state.photos.map(photo => photo.path).filter(path => visible.has(path));
        void api("/api/library/paste-pictures", {paths:onScreen}).then(pictures => {
          if (!!pictures?.paused === !!state.picturesPaused) return;
          state.picturesPaused = !!pictures?.paused; paintGrid();
        }).catch(() => {});
        const result = await api("/api/library/settings-status", { paths });
        const byPath = new Map(result.photos.map(photo => [photo.path, photo]));
        let changed = false;
        for (const photo of state.allPhotos) {
          const row = byPath.get(photo.path);
          // A photo that has not loaded yet has no pictureCurrent. Treat missing as
          // false, or every newly shown thumbnail is thrown away and drawn twice.
          if (row && ((row.grade_identity || "") !== (photo.grade_identity || "") || (row.picture_key || "") !== (photo.picture_key || "") || !!row.pictureCurrent !== !!photo.pictureCurrent || !!row.picture_updating !== !!photo.picture_updating)) {
            Object.assign(photo, { edited: row.edited, grade_identity: row.grade_identity, picture_key: row.picture_key, pictureCurrent: row.pictureCurrent, picture_updating: row.picture_updating });
            for (const map of [state.cells, state.filmCells]) { const cell = map.get(photo.path); if (cell) { cell.controller.abort(); cell.element.remove(); map.delete(photo.path); } }
            changed = true;
          }
          // A missing write_reason means "". A false change here restarts Compare
          // every second, before its pictures can finish loading.
          if (row && JSON.stringify(row.marks) === JSON.stringify(photo.marks) && JSON.stringify(row.albums) === JSON.stringify(photo.albums)
              && (row.storage !== photo.storage || (row.write_reason || "") !== (photo.write_reason || ""))) {
            photo.storage = row.storage; photo.write_reason = row.write_reason || ""; changed = true;
          }
        }
        if (changed) { applyQuery(); updateDetails(); paintGrid(); paintFilm(); if (state.view === "single") showSingle(); }
        const events = result.events.filter(event => event.id > writerEvent);
        if (events.length) {
          writerEvent = events.at(-1).id;
          status(events.map(event => event.message).join(" "));
        }
      } catch (error) { console.debug("Library settings:", error.message); }
    }
    setTimeout(pollSettings, 1000);
  }
  void pollSettings();
  async function pollIndexing() {
    if (state.active && !document.hidden) { try { await api("/api/library/checks", { client: checkClient, visible: state.path }); await activity.refresh(); } catch (error) { console.debug("Library index:", error.message); } }
    setTimeout(pollIndexing, 1000);
  }
  $("thumbnail-size").addEventListener("input", (event) => { state.size = Number(event.target.value); paintSize(); paintGrid(); paintFilm(); });
  let gridFrame = 0, filmFrame = 0;
  grid.addEventListener("scroll", () => { if (!gridFrame) gridFrame = requestAnimationFrame(() => { gridFrame = 0; paintGrid(); }); });
  film.addEventListener("scroll", () => { if (!filmFrame) filmFrame = requestAnimationFrame(() => { filmFrame = 0; paintFilm(); }); });
  // An ordinary mouse wheel scrolls up and down; the filmstrip only scrolls sideways.
  film.addEventListener("wheel", event => {
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    film.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? film.clientWidth : 1);
  }, { passive: false });
  let resizeTimer;
  new ResizeObserver(() => { paintGrid(); paintFilm(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.view === "single" && state.active) showSingle(); }, 150); }).observe($("single-stage"));
  new ResizeObserver(() => { paintGrid(); paintFilm(); }).observe(grid);
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "hdr-library-host") return;
    if (event.data.action === "theme") applyTheme(event.data.theme);
    if (event.data.action === "active") setActive(event.data.enabled);
    if (event.data.action === "add-export-selection") postParent("add-export-selection", {paths:[...state.selection]});
    if (event.data.action === "command") libraryCommand(event.data.command);
    if (event.data.action === "add-folder") openPicker();
    if (event.data.action === "restore") void restoreState(event.data.state).catch(error => status(error.message));
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || ((!event.ctrlKey && !event.metaKey) && (event.target.closest(".library-activity") || event.target.matches("#index-status,#library-undo")))) return;
    if (document.querySelector("dialog[open]") || event.target.matches("input,textarea,select,[contenteditable]") || event.target.closest(".library-filter-panel,.library-folder-menu")) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === "c") { event.preventDefault(); void commands.copy(); }
      if (key === "v") { event.preventDefault(); void commands.paste(event.shiftKey); }
      if (key === "e" && event.shiftKey) { event.preventDefault(); commands.quickExport(); }
      if (key === "f") { event.preventDefault(); toggleFilters(); }
      if (key === "a") { event.preventDefault(); state.selection = new Set(state.photos.map(photo => photo.path)); updateDetails(); paintGrid(); paintFilm(); }
      if (key === "z") { event.preventDefault(); void culling.undo(); }
      return;
    }
    if (event.altKey) return;
    if (key==="e"||key==="s") {event.preventDefault();void overlays.toggle(key==="e"?"exposure":"focus");return;}
    if (["c","[","]"].includes(key)) {event.preventDefault();void compare.command(key==="["?"left":key==="]"?"right":compare.enabled()?"off":"on");return;}
    if (compare.enabled() && state.view === "single" && key.startsWith("arrow")) {event.preventDefault();void compare.command("move",["arrowleft","arrowup"].includes(key)?-1:1);return;}
    if (culling.shortcut(key)) { event.preventDefault(); return; }
    if (key === "t") { event.preventDefault(); collapse("right", false); $("library-tag-input")?.focus(); return; }
    const steps = { arrowright: 1, arrowleft: -1, arrowdown: state.view === "grid" ? state.layout?.columns || 1 : 1, arrowup: state.view === "grid" ? -(state.layout?.columns || 1) : -1 };
    if (key in steps) { event.preventDefault(); select(state.index + steps[key], true, event.shiftKey ? "range" : "single"); }
    else if (key === "enter") { event.preventDefault(); openGrade(); }
    else if (key === "delete") { event.preventDefault(); fileCommands.remove(state.photos.filter(photo => state.selection.has(photo.path))).catch(error => status(error.message)); }
    else if (key === " ") { event.preventDefault(); setView(state.view === "grid" ? "single" : "grid"); }
    else if (key === "z") { event.preventDefault(); toggleZoom(); }
    else if (key === "h") { event.preventDefault(); toggleHDR(); }
    else if (key === "g") setView("grid");
    else if (key === "f") setReview(!state.review);
    else if (key === "escape") { if (state.review) setReview(false); else setView("grid"); }
    else if (key === "tab") { event.preventDefault(); const closed = !(library.classList.contains("library-left-closed") && library.classList.contains("library-right-closed")); collapse("left", closed); collapse("right", closed); }
    else if (key === "i") collapse("right", !library.classList.contains("library-right-closed"));
  });
  // Box selection uses grid coordinates for all photos, including virtual rows.
  let band = null, suppressGridClick = false;
  const selectionBox = document.createElement("div"); selectionBox.id = "library-selection-box"; selectionBox.hidden = true; space.append(selectionBox);
  function updateBand(event) {
    if (!band || !state.layout) return;
    const bounds = grid.getBoundingClientRect();
    band.clientX = event.clientX; band.clientY = event.clientY;
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top + grid.scrollTop;
    if (!band.moved && Math.abs(x - band.x) + Math.abs(y - band.y) < 4) return;
    band.moved = true;
    const box = { left: Math.min(x, band.x), right: Math.max(x, band.x), top: Math.min(y, band.y), bottom: Math.max(y, band.y) };
    selectionBox.hidden = false; selectionBox.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.right - box.left}px;height:${box.bottom - box.top}px`;
    const indices = HDRLibrarySelection.boxIndices(state.layout, state.photos.length, box);
    state.selection = new Set([...band.base, ...indices.map(index => state.photos[index].path)]);
    if (indices.length) { state.index = indices.at(-1); state.anchor = indices[0]; }
    updateDetails(); paintGrid();
  }
  grid.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest(".library-cell,button") || !state.photos.length) return;
    const bounds = grid.getBoundingClientRect();
    band = { pointerId: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top + grid.scrollTop,
      base: event.ctrlKey || event.metaKey ? new Set(state.selection) : new Set(), moved: false };
    grid.setPointerCapture(event.pointerId); event.preventDefault();
  });
  grid.addEventListener("pointermove", updateBand);
  function endBand(event) {
    if (!band || event.pointerId !== band.pointerId) return;
    suppressGridClick = band.moved; band = null; selectionBox.hidden = true;
    if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
  }
  grid.addEventListener("pointerup", endBand); grid.addEventListener("pointercancel", endBand);
  grid.addEventListener("scroll", () => { if (band?.moved) updateBand({ clientX: band.clientX, clientY: band.clientY }); });
  grid.addEventListener("click", event => {
    if (suppressGridClick) { suppressGridClick = false; return; }
    if (!event.target.closest(".library-cell,button")) { state.selection.clear(); updateDetails(); paintGrid(); }
  });
  function portableState() {
    return { path: state.path, collection: state.collection, selected: selected()?.path, selection: [...state.selection], anchor: state.photos[state.anchor]?.path,
      sort: state.sort, descending: state.descending, filters: state.filters, size: state.size, view: state.view,
      hdr: state.hdr, zoom: state.zoom, zoomX: state.zoomX, zoomY: state.zoomY, zoomScale: state.zoomScale,
      gridScroll: grid.scrollTop, filmScroll: film.scrollLeft, filterOpen: !$("library-filterbar").hidden,
      leftClosed: library.classList.contains("library-left-closed"), rightClosed: library.classList.contains("library-right-closed") };
  }
  async function restoreState(saved) {
    if (!saved) return;
    state.sort = saved.sort || "time"; state.descending = !!saved.descending; state.filters = { rules: saved.filters?.rules || [], any: false, raw: !!saved.filters?.raw };
    state.size = saved.size || 190; state.hdr = !!saved.hdr; state.zoom = !!saved.zoom;
    state.zoomX = saved.zoomX ?? .5; state.zoomY = saved.zoomY ?? .5; state.zoomScale = saved.zoomScale || 1;
    $("thumbnail-size").value = state.size; paintSort(); paintSize();
    $("hdr-button").setAttribute("aria-pressed", String(state.hdr)); $("zoom-button").setAttribute("aria-pressed", String(state.zoom));
    $("raw-only").setAttribute("aria-pressed", String(state.filters.raw));
    $("library-filterbar").hidden = !saved.filterOpen; paintFilterButton();
    collapse("left", !!saved.leftClosed); collapse("right", !!saved.rightClosed); ruleFilters.render();
    await refreshPins();
    if (saved.collection) await browseCollection(saved.collection.kind, saved.collection.name);
    else if (saved.path) await browse(saved.path);
    state.index = state.photos.findIndex(photo => photo.path === saved.selected);
    if (state.index < 0 && state.photos.length) state.index = 0;
    const paths = new Set(state.photos.map(photo => photo.path));
    state.selection = new Set((saved.selection || []).filter(path => paths.has(path)));
    state.anchor = state.photos.findIndex(photo => photo.path === saved.anchor);
    setView(saved.view === "single" ? "single" : "grid"); updateDetails();
    grid.scrollTop = saved.gridScroll || 0; film.scrollLeft = saved.filmScroll || 0; paintGrid(); paintFilm();
  }
  $("popout-library").addEventListener("click", async () => {
    if (!standalone) { if (state.review) setReview(false); postParent("pop-out", { state: portableState() }); return; }
    if (libraryDesktop) await libraryDesktop.dockLibrary(portableState()).catch(error => status(error.message));
  });
  if (standalone) {
    $("popout-library").classList.add("dock"); $("popout-library").setAttribute("aria-label", "Dock Library");
    $("popout-library").title = "Return Library to the main window";
    libraryDesktop?.onLibraryWindowChanged(message => {
      if (message.action === "theme") applyTheme(message.theme);
      if (message.action === "close") void libraryDesktop.dockLibrary(portableState()).catch(error => status(error.message));
    });
    libraryDesktop?.onDisplayStateChanged(() => {
      state.displayEpoch += 1;
      if (state.view === "single") showSingle(); else { clearCells(state.cells); paintGrid(); }
    });
    window.addEventListener("keydown", event => {
      if (event.key === "F11" && libraryDesktop) { event.preventDefault(); void libraryDesktop.performWindowAction("fullscreen"); }
    });
  }
  // Read-only status for the focused interaction driver; no test-only behavior.
  HDRLibraryStopwatch("ready");
  window.HDRLibrary = Object.freeze({ browse, getSnapshot: () => ({ path: state.path, collection: state.collection, albums: albums.names(), rules: (state.filters.rules || []).length, indexing: state.indexing, facts: selected() ? { camera: selected().camera, lens: selected().lens, iso: selected().iso, indexed: !!selected().indexed, albums: selected().albums || [] } : null, count: state.photos.length,
    overlays: overlays.snapshot(), compare: compare.snapshot(), selected: selected()?.path, selection: [...state.selection], marks: selected()?.marks, view: state.view, review: state.review, visible: shownCells(state.cells).length,
    filmVisible: shownCells(state.filmCells).length, active: state.active, hdr: state.hdr, zoom: state.zoom, zoomScale: state.zoomScale, zoomCenter: [state.zoomX, state.zoomY], nativeLoading: state.nativeLoading, native: state.nativeMeta ? { width: state.nativeMeta.source_width, height: state.nativeMeta.source_height, x: state.nativeMeta.crop_x, y: state.nativeMeta.crop_y } : null, reading: state.reading, total: state.allPhotos.length, sort: state.sort, descending: state.descending, paths: state.photos.map(photo => photo.path) }) });
  (async () => {
    try {
      await api("/api/library/picture-settings", {screen_edge:singleEdge()});
      const options = await api("/api/library/options"); state.timing = options.timing;
      browsingLimits = options.browsing || browsingLimits;
      void HDRLibraryPictures.configure(browsingLimits).catch(() => {});
      state.labelNames = (await api("/api/library/preferences")).label_names;
      void albums.refresh().catch(error => status(error.message)); void pollIndexing();
      const windowState = libraryDesktop ? await libraryDesktop.getLibraryWindow() : null;
      if (windowState) applyTheme(windowState.theme);
      const saved = windowState?.state;
      if (saved) await restoreState(saved);
      else { await refreshPins(); const first = state.pins.find((pin) => pin.available); if (first) await browse(first.path); }
      await libraryDesktop?.rendererReady();
      postParent("ready");
    } catch (error) { status(error.message); }
  })();
})();
