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
  window.addEventListener("storage", event => { if (event.key === "hdr-finisher:application-preferences:v1") { try { applyTheme(JSON.parse(event.newValue || "{}").theme); void window.HDRLibrary?.refreshPins?.(); } catch {} } });
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
  const logView = () => compare?.enabled() ? "compare" : state.review ? "fullscreen" : state.view;
  const pictureRequests = HDRLibraryRequestQueue.create();
  async function api(route, body, signal) {
    const measured = ["/api/library/picture", "/api/library/native", "/api/library/overlay-map"].includes(route);
    const trace = measured ? crypto.randomUUID() : null;
    for (;;) {
      const queued = performance.now();
      if (measured) HDRLibraryStopwatch("picture_requested", { picture_size:route === "/api/library/native" ? "detail preview" : body.edge <= 640 ? "thumbnail" : "screen preview",view:logView(),path: body.path, request: trace });
      const request = async () => {
        if (measured) HDRLibraryStopwatch("picture_dispatched", { picture_size:route === "/api/library/native" ? "detail preview" : body.edge <= 640 ? "thumbnail" : "screen preview",view:logView(),path: body.path, request: trace, queue_ms: performance.now() - queued });
        const response = await fetch(route, { signal, ...(body === undefined ? {} : {
          method: "POST", headers: { "Content-Type": "application/json", ...(trace ? { "X-Library-Request": trace } : {}) }, body: JSON.stringify(body) }) });
        return { response, result: await response.json() };
      };
      const { response, result } = await ((route === "/api/library/picture" || route === "/api/library/native" || route === "/api/library/overlay-map")
        ? pictureRequests.submit(request, signal, body.priority) : request());
      if (response.status === 202) { await sleep(150, signal); continue; }
      if (!response.ok) {
        const error = new Error(typeof result.detail === "string" ? result.detail : "Library request failed.");
        error.status = response.status; error.libraryError = result.library_error; throw error;
      }
      if (measured) HDRLibraryStopwatch("picture_answered", { picture_size:route === "/api/library/native" ? "detail preview" : body.edge <= 640 ? "thumbnail" : "screen preview",view:logView(),path: body.path, request: trace, key: result.key, duration_ms: performance.now() - queued, kept: !!result.kept });
      return result;
    }
  }
  const { showMenu, closeMenu: closeFolderMenu, make } = HDRLibraryDialogs;
  const sameName = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const belongs = (photo, place) => (place.kind === "album" ? photo.albums || [] : photo.marks?.tags || []).some(name => sameName(name, place.name));
  const culling = HDRLibraryCulling.create({ confirm: confirmChange, photos: () => state.allPhotos, selection: () => state.view === "single" && compare.enabled() ? new Set([selected()?.path]) : state.selection, api, status,
    labelName: label => state.labelNames[label] || "",
    optimistic: () => { updateSingleCaption(); updateDetails(); paintGrid(); paintFilm(); },
    updated: result => {
      if (result.grade_changed) {
        invalidateGradePictures((result.photos || []).map(photo => photo.path));
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
  const pictureIdentity = photo => `${photo.path}|${photo.grade_identity || ""}|${photo.bytes}|${photo.mtime_ns}`;
  const idlePictures = HDRLibrarySceneScheduler.createWarmer({
    load:(path,signal)=>HDRLibraryScenes.load(path,640,signal,80,true),
    idle:()=>state.active&&!document.hidden&&!state.reading&&state.view==="grid"&&
      !HDRLibraryScenes.snapshot().sources.active&&!HDRLibraryScenes.snapshot().sources.waiting,
  });
  for(const event of ["pointerdown","keydown","wheel"]) document.addEventListener(event,()=>idlePictures.touch(),{passive:true});
  async function warmPictures(){
    const shown=state.view==="grid" ? state.cells.shown : state.filmCells.shown;
    const center=state.allPhotos.findIndex(photo=>shown?.has(photo.path));
    const rows=state.allPhotos.map((photo,index)=>({path:photo.path,identity:pictureIdentity(photo),distance:Math.abs(index-Math.max(0,center))}));
    rows.sort((a,b)=>a.distance-b.distance);
    idlePictures.update(state.path || JSON.stringify(state.collection),rows);
    await idlePictures.tick();setTimeout(warmPictures,1000);
  }
  setTimeout(warmPictures,1000);
  function pictureMode(img, hdr) {
    img.style.dynamicRangeLimit = hdr ? 'no-limit' : 'standard';
    img.dataset.rendition = hdr ? 'hdr' : 'sdr'; img.dataset.peakNits = hdr ? '1000' : '203';
  }
  // One thumbnail scene size, scaled to fit any grid or filmstrip cell.
  const thumbnailEdge = () => 640;
  const pictureErrors = HDRLibraryPictureErrors.create({api, status, changed: async (paths, result = {}, requeue = false) => {
    invalidateGradePictures(paths);
    for (const [key] of recentPictures) if (paths.some(path => key.startsWith(path + "|"))) recentPictures.delete(key);
    if (result.session) postParent("grade-replaced", {session:result.session});
    if (result.undo_available != null) culling.setUndo(result.undo_available);
    for (const row of result.photos || []) { const photo = state.allPhotos.find(item => item.path === row.path); if (photo) Object.assign(photo, row); }
    paintGrid(); paintFilm();
    if (requeue) for (const path of paths) {
      void HDRLibraryScenes.load(path, 640, undefined, 80).catch(error => {
        if (error.libraryError) pictureErrors.remember(error.libraryError);
        else if (!aborted(error)) status(error.message);
        void activity.refresh();
      });
    }
    if (state.view === "single" && paths.includes(selected()?.path)) { state.singleIdentity = ""; void showSingle(); }
    void activity.refresh();
  }});
  window.addEventListener("library-picture-errors-changed", () => {
    for (const cell of [...state.cells.values(), ...state.filmCells.values()]) pictureErrors.paint(cell);
  });
  const tilePool = HDRLibraryTilePool.create(undefined, cell => {
    cell.controller.abort(); cell.element.remove();
    // Explicitly release the detached canvas backing store on eviction.
    if (cell.fallback) cell.fallback.width = cell.fallback.height = 0;
  });
  const tileKey = (map, identity) => `${map === state.cells ? "grid" : "film"}|${identity}|${state.hdr}|${thumbnailEdge()}`;
  const cacheChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('hdr-library-cache') : null;
  cacheChannel?.addEventListener('message', () => { tilePool.clear(); clearCells(state.cells); clearCells(state.filmCells); paintGrid(); paintFilm(); });
  window.addEventListener("message",event => { if(event.origin === location.origin && event.data?.type === "hdr-library-cache-changed") { tilePool.clear(); clearCells(state.cells); clearCells(state.filmCells); paintGrid(); paintFilm(); } });
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
    if (state.view === "single") { if (rawController) stopRawAhead(); return; }
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
      return cached?.edge >= edge ? Promise.resolve(cached) : HDRLibraryScenes.load(photo.path,edge,signal,5,false,null,{gpuOnly:true});
    },
  });
  function developmentNeighbours() {
    return Array.from({length:browsingLimits.ahead},(_,i)=>state.photos[state.index+(i+1)*rawDirection]).filter(Boolean);
  }
  function developAhead(photo) {
    if (!state.active || state.view !== "single" || compare.enabled() || selected()?.path !== photo.path || !HDRLibraryGpuRaw.enabled()) return;
    readAhead.update(photo,developmentNeighbours(),2560);
  }
  let restoreStandIn = () => {};
  function showStandIn(photo, controller, current, trace) {
    restoreStandIn();
    const cell = HDRLibraryReadyWindow.standIn([...state.cells.values(), ...state.filmCells.values(), ...tilePool.values()],
      pictureIdentity(photo), state.displayEpoch, state.hdr);
    HDRLibraryTrace.mark(trace,"picture_quick_draw_lookup",performance.now(),{quick_draw:true,cache_hit:!!cell});
    if (!cell) return false;
    // Borrow the actual finished HDR/SDR surface: no readback, JPEG or gamut conversion.
    const canvas = cell.fallback, home = canvas.parentNode, style = canvas.style.cssText;
    overlays?.detach(canvas);
    canvas.dataset.standIn = "true";
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none";
    $("single-stage").append(canvas);
    const restore = () => {
      canvas.remove(); home.append(canvas); canvas.style.cssText = style;
      delete canvas.dataset.standIn;
      controller.signal.removeEventListener("abort",restore);
      cell.controller.signal.removeEventListener("abort",restore);
      if (restoreStandIn === restore) restoreStandIn = () => {};
    };
    restoreStandIn = restore;
    controller.signal.addEventListener("abort",restore,{once:true});
    cell.controller.signal.addEventListener("abort",restore,{once:true});
    HDRLibraryTrace.present(trace,()=>current() && canvas.dataset.standIn === "true",{route:cell.meta.route,quick_draw:true,sharp_draw:false});
    return true;
  }
  const readySurfaces = new Map();
  let readyBytes = 0, readyPolling = false;
  const readyKey = photo => `${pictureIdentity(photo)}|${state.hdr}|${state.displayEpoch}|${JSON.stringify(HDRLibraryScreenPreviews.display())}`;
  function releaseReady(value) {
    // Keep the previous selection until a replacement can be published in the
    // same turn. It retains its own identity and is never reported as the new photo.
    if (state.active && state.view === "single" && value.canvas.id === "single-picture" &&
        value.canvas.dataset.picturePath !== selected()?.path && readyWindow.has(selected() || {})) { value.retired = true; return; }
    if (!readySurfaces.delete(value.canvas)) return;
    readyBytes -= value.bytes;
    if (value.canvas.id === "single-picture") { value.canvas.hidden = true; if (value.canvas.dataset.singleIdentity === state.singleIdentity) { state.singleIdentity = ""; state.single?.abort(); } }
    value.canvas.width = value.canvas.height = 0;
    value.canvas.getContext("webgpu")?.unconfigure();
    void HDRLibraryPictures.readyMemory(readyBytes).catch(() => {});
  }
  const navigationGate = HDRLibraryReadyWindow.navigationGate({wait:sleep});
  async function beforeSource(photo,signal,importance) {
    await navigationGate.settled(signal);
    if (signal.aborted || (importance() === 0 && selected()?.path !== photo.path))
      throw new DOMException("Passed during navigation","AbortError");
  }
  function pictureWindow(edge) {
    return HDRLibraryReadyWindow.create({key:readyKey, dispose:releaseReady,
      promote:(photo,priority)=>HDRLibraryScenes.promote(photo.path,priority),
      load:async (photo, signal, current, priority, trace, importance, options, getTrace = () => trace) => {
        const epoch = state.displayEpoch, hdr = state.hdr;
        if (edge === 2560) {
          const canvas = document.createElement('canvas'); canvas.className = $('single-picture').className;
          let value;
          let meta;
          try { meta = await HDRLibraryScreenPreviews.load(photo,canvas,signal,current,hdr,async meta=>{
            value={canvas,meta,bytes:meta.width*meta.height*8};
            readySurfaces.set(canvas,value);readyBytes+=value.bytes;
            const upload=meta.width*meta.height*8;
            await HDRLibraryScenes.reclaim(upload);
            const budget=await HDRLibraryPictures.readyMemory(readyBytes+tilePool.snapshot().bytes);
            if(readyBytes+tilePool.snapshot().bytes>tilePool.snapshot().limit || readyBytes+tilePool.snapshot().bytes+upload>budget){
              const error=Error('Stored screen preview yielded its memory budget.');error.libraryYield=true;throw error;
            }
          }); } catch(error) {if(value)releaseReady(value);throw error;}
          if (meta) {
            if (!current() || epoch !== state.displayEpoch) {releaseReady(value);throw new DOMException('Invalidated','AbortError');}
            return value;
          }
        }
        // Probe stored developments immediately; only a source miss waits for navigation.
        const meta = await HDRLibraryScenes.load(photo.path,edge,signal,importance(),false,trace,
          {cachedOnly:edge===640 && !options.allowSource,beforeSource:()=>beforeSource(photo,signal,importance),
            onSourceDemand:()=>{}});
        if (!meta) return null;
        if (!current()) throw new DOMException("Invalidated","AbortError");
        Object.defineProperty(meta,"trace",{get:getTrace,configurable:true});
        meta.draw_priority = importance;
        meta.fullscreen = true;
        meta.log_view = "fullscreen"; meta.log_step = edge === 640 ? "quick draw" : "sharp draw";
        // A quick draw never starts or waits for Denoise. Finished thumbnails
        // in the pool are already usable; a miss proceeds to the sharp draw.
        if (edge === 640 && meta.denoise?.[hdr ? "hdr" : "sdr"]?.enabled) {
          HDRLibraryTrace.mark(getTrace(),"picture_quick_draw_unavailable",performance.now(),{reason:"No finished Denoise thumbnail",route:"sharp-only"});
          return null;
        }
        await HDRLibraryPictures.prepareDenoise(meta,hdr,getTrace);
        if (!current()) throw new DOMException("Invalidated","AbortError");
        const pictures = edge === 640 ? HDRLibraryQuickPictures : HDRLibraryPictures;
        const canvas = document.createElement("canvas"); canvas.className = $("single-picture").className;
        const value = {canvas,meta,bytes:meta.width * meta.height * 8 * 3};
        readySurfaces.set(canvas,value); readyBytes += value.bytes;
        try {
          const graph = meta.width * meta.height * 64 + 64 * 1024 ** 2;
          await HDRLibraryScenes.reclaim(graph);
          const budget = await HDRLibraryPictures.readyMemory(readyBytes + tilePool.snapshot().bytes);
          if (!current()) throw new DOMException("Invalidated","AbortError");
          if (readyBytes + tilePool.snapshot().bytes > tilePool.snapshot().limit || readyBytes + tilePool.snapshot().bytes + graph > budget) {
            const error = Error("Ready window yielded its memory budget."); error.libraryYield = true; throw error;
          }
          for (;;) {
            try {
              await pictures.show(meta,canvas,signal,()=>current() && epoch === state.displayEpoch,hdr);
              break;
            } catch (error) {
              if (!error.libraryYield || !current()) throw error;
              await sleep(50,signal);
            }
          }
          if (!current() || epoch !== state.displayEpoch) throw new DOMException("Invalidated","AbortError");
          canvas.dataset.picturePath = photo.path; canvas.dataset.pictureEdge = meta.edge; canvas.dataset.pictureKey = meta.key;
          return value;
        } catch(error) { releaseReady(value); throw error; }
      }
    });
  }
  const readyWindow = pictureWindow(2560), quickWindow = pictureWindow(640);
  function showQuick(value,controller,current,trace) {
    if (!value || !current()) return;
    restoreStandIn();
    const canvas = value.canvas;
    canvas.dataset.standIn = "true";
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none";
    $("single-stage").append(canvas); canvas.hidden = false;
    const restore = () => {
      canvas.remove(); delete canvas.dataset.standIn;
      controller.signal.removeEventListener("abort",restore);
      if (restoreStandIn === restore) restoreStandIn = () => {};
    };
    restoreStandIn = restore;
    controller.signal.addEventListener("abort",restore,{once:true});
    HDRLibraryTrace.present(trace,()=>current() && canvas.dataset.standIn === "true",{key:value.meta.key,quick_draw:true,sharp_draw:false});
  }
  async function showCameraPreview(photo,controller,current,trace) {
    if (photo.edited || (!rawTypes.has(photo.type) && !["jpg", "jpeg", "png"].includes(photo.type.toLowerCase()))) return;
    const sourceIdentity = pictureIdentity(photo), started = performance.now();
    const eligible = () => current() && pictureIdentity(selected() || {}) === sourceIdentity && !photo.edited &&
      !readyWindow.has(photo) && !quickWindow.has(photo) && !$('single-stage').querySelector('[data-stand-in="true"]');
    try {
      const response = await fetch('/api/library/preview',{method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo.path,quick_draw:true,bytes:photo.bytes,mtime_ns:photo.mtime_ns})});
      if (response.status !== 200 || !eligible()) return;
      const meta = await response.json();
      if (!meta.url || !eligible()) return;
      const image = document.createElement('img'); image.alt = ''; image.src = meta.url;
      await image.decode();
      if (!eligible()) return;
      restoreStandIn();
      image.dataset.standIn = 'true'; image.dataset.cameraPreview = 'true'; image.dataset.picturePath = photo.path;
      image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none';
      pictureMode(image,false); $('single-stage').append(image);
      const restore = () => { image.remove(); image.removeAttribute('src'); controller.signal.removeEventListener('abort',restore); if(restoreStandIn===restore)restoreStandIn=()=>{}; };
      restoreStandIn = restore; controller.signal.addEventListener('abort',restore,{once:true});
      HDRLibraryTrace.mark(trace,'picture_camera_preview_decoded',started,{picture_size:'camera preview',route:meta.route,quick_draw:true});
      HDRLibraryTrace.present(trace,()=>current() && image.isConnected,{picture_size:'camera preview',route:meta.route,quick_draw:true,sharp_draw:false});
    } catch(error) { if(!aborted(error))console.debug('Library camera preview:',error.message); }
  }
  HDRLibraryScenes.onReclaim(async (bytes,required=false) => {
    let held = readyBytes + tilePool.snapshot().bytes;
    let budget = await HDRLibraryPictures.readyMemory(held);
    if (bytes + held <= budget) return;
    // Evict finished surfaces only. In-progress window draws finish at their normal boundary.
    const other = photo => readyKey(photo) !== readyKey(selected() || {});
    readyWindow.evictFinished(other); quickWindow.evictFinished(other);
    while (bytes + readyBytes + tilePool.snapshot().bytes > budget &&
      tilePool.evictOne(cell => cell.fallback?.dataset.standIn !== "true")) {}
    HDRLibraryStopwatch("picture_thumbnail_reclaim", {route:"incremental",duration_ms:0,reason:required ? "source development" : "draw"});
    held = readyBytes + tilePool.snapshot().bytes;
    budget = await HDRLibraryPictures.readyMemory(held);
    if (required && bytes + held > budget) {
      readyWindow.evictFinished(other);
      held = readyBytes + tilePool.snapshot().bytes;
      budget = await HDRLibraryPictures.readyMemory(held);
      if (bytes + held > budget) { tilePool.discard(cell => cell.fallback?.dataset.standIn !== "true"); quickWindow.evictFinished(other); }
    }
    await HDRLibraryPictures.readyMemory(readyBytes + tilePool.snapshot().bytes);
  });
  async function pollReadyMemory() {
    if (readyPolling || !readyBytes) return;
    readyPolling = true;
    try {
      const permit = await api("/api/delivery/gpu/permit");
      const budget = await HDRLibraryPictures.readyMemory(readyBytes + tilePool.snapshot().bytes);
      const work = HDRLibraryScenes.snapshot();
      // Our own neighbour preparation also makes the shared broker non-idle.
      // Do not discard the selected picture while that source or draw finishes.
      const ownWork = work.draws.active || work.quickDraws?.active || work.sources.active || work.probes.active;
      if (!permit.ready || (!permit.idle && !ownWork && readyWindow.has(selected() || {})) || (!ownWork && readyBytes > budget))
        { readyWindow.invalidate(); quickWindow.invalidate(); }
    } catch (_) { readyWindow.invalidate(); quickWindow.invalidate(); }
    finally {
      readyPolling = false;
      if (state.active && state.view === "single" && !compare.enabled() && !state.singleIdentity) void showSingle();
    }
  }
  setInterval(pollReadyMemory,100);
  function readyNeighbours() {
    return [rawDirection,2*rawDirection,-rawDirection,-2*rawDirection].map(offset=>state.photos[state.index+offset]).filter(Boolean);
  }
  function warmReady(photo, neighbours) {
    void (async () => {
      await navigationGate.settled(state.single?.signal);
      if (selected()?.path !== photo.path || state.view !== "single" || !state.active || compare.enabled()) return;
      await Promise.allSettled(neighbours.map(async neighbour => {
        // A finished 640 surface is useful even when the expensive sharp draw
        // cannot keep up with two selections per second.
        await Promise.allSettled([quickWindow.get(neighbour,5,null,{allowSource:true}), readyWindow.get(neighbour)]);
      }));
    })().catch(error=>{if(!aborted(error))console.debug("Library window:",error.message);});
  }
  function clearPrefetch() { restoreStandIn(); readAhead.clear(); stopRawAhead(); readyWindow.invalidate(); quickWindow.invalidate(); }
  function setActive(active) {
    state.active = active; idlePictures.touch();
    if (active && state.scan?.signal.aborted) {
      void reopen(); return;
    }
    if (!active) {
      tilePool.clear();
      compare.cancel();
      clearCells(state.cells); clearCells(state.filmCells); clearPrefetch(); state.single?.abort();
      state.native?.abort(); state.nativeSource?.abort();
    } else if ((state.path || state.collection) && !state.photos.length) void reopen();
    else { paintGrid(); paintFilm(); if (state.view === "single") showSingle(); }
  }
  function diagnostics(photo, meta, elapsed) {
    if (!state.timing) return;
    const message = `${photo.name}: ${Math.round(elapsed)} ms to preview · ${meta.cache_hit ? "cached" : meta.route} · ${Math.round(meta.stored_bytes / 1024)} KiB`;
    $("library-diagnostic").hidden = false;
    $("library-diagnostic").textContent = message;
    HDRLibraryStopwatch("picture_diagnostic",{...window.HDRLibraryPictureLog?.(meta),path:photo.path,duration_ms:elapsed});
  }
  async function loadAndShow(photo, edge, canvas, controller, isCurrent, priority = 10, prepared = null, trace = null) {
    const started = performance.now();
    let fallback = null;
    try {
      while (isCurrent() && !controller.signal.aborted) {
        try {
          await HDRLibraryPictures.initialize();
          const meta = await (prepared || HDRLibraryScenes.load(photo.path,edge,controller.signal,priority,false,trace));
          prepared = null;
          if (!isCurrent()) return;
          meta.log_view = trace?.view || (edge <= 640 ? "grid" : logView());
          await drawPicture(meta,canvas,controller,isCurrent);
          if (!isCurrent()) return;
          fallback?.remove(); fallback = null; canvas.style.visibility = ""; canvas.hidden = false;
          canvas.dataset.picturePath = photo.path; canvas.dataset.pictureEdge = meta.edge; canvas.dataset.pictureKey = meta.key;
          recentPictures.set(pictureIdentity(photo),meta);
          if (recentPictures.size > 80) recentPictures.delete(recentPictures.keys().next().value);
          HDRLibraryStopwatch("picture_shown", {...window.HDRLibraryPictureLog?.(meta),path:photo.path,key:meta.key,duration_ms:performance.now()-started});
          diagnostics(photo,meta,performance.now()-started);
          overlays?.attach(photo,canvas,meta,controller,isCurrent);
          return meta;
        } catch(error) {
          prepared = null;
          if (aborted(error) || !isCurrent()) return;
          if (error.libraryYield) { await sleep(50,controller.signal); continue; }
          if (error.libraryError || HDRLibraryPictures.usable()) throw error;
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
    tilePool.clear();
    readyWindow.invalidate(); quickWindow.invalidate();
    state.hdr = !state.hdr; state.displayEpoch += 1;
    HDRLibraryStopwatch("rendition_switch",{rendition:state.hdr?"hdr":"sdr",display_epoch:state.displayEpoch,
      view:state.view,visible_thumbnails:[...state.cells.values()].filter(cell=>cell.element.isConnected).length});
    $("hdr-button").setAttribute("aria-pressed", String(state.hdr));
    for (const cell of [...state.cells.values(), ...state.filmCells.values()]) {
      pictureMode(cell.canvas, state.hdr);
      if (cell.fallback && cell.scene) void drawPicture(cell.scene, cell.fallback, cell.controller,
        () => cell.element.isConnected && !cell.controller.signal.aborted).then(() => {
          if (!cell.controller.signal.aborted) cell.displayEpoch = state.displayEpoch;
        }).catch(() => {});
    }
    if (state.view === "single") showSingle();
  }
  $("hdr-button").addEventListener("click", toggleHDR);
  window.addEventListener("hdrfinisher:webgpulost",()=>{
    readyWindow.invalidate(); quickWindow.invalidate();
    tilePool.clear();
    clearCells(state.cells); clearCells(state.filmCells);
    state.single?.abort(); state.singleIdentity="";
    setTimeout(()=>{paintGrid();paintFilm();if(state.view==="single")showSingle();},100);
  });
  function removeUnreadable(photo, error) {
    if (error.libraryError) {
      pictureErrors.remember(error.libraryError);
      void activity.refresh();
      return;
    }
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
    element.addEventListener("click", (event) => { if (!event.target.closest(".library-picture-error")) select(state.photos.findIndex((item) => item.path === photo.path), false, event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single"); });
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
    pictureErrors.paint(cell);
    {
      void (async () => {
        await hydrateVisible(photo,current,cell.controller.signal);
        if(!current())return;
        cell.identity=pictureIdentity(photo);
        const fallback = document.createElement("canvas"); cell.fallback = fallback;
        fallback.hidden = true; frame.append(fallback);
        const preview = fetch("/api/library/preview", {method:"POST", signal:cell.controller.signal,
          headers:{"Content-Type":"application/json"},body:JSON.stringify({path:photo.path})}).then(async response => {
          if (response.status !== 200) return;
          const meta = await response.json();
          if (!current() || cell.meta || !meta.url) return;
          canvas.src = meta.url; canvas.dataset.preview = "true";
          await canvas.decode();
          if (current() && !cell.meta) {
            canvas.style.visibility=""; element.classList.remove("loading");
            const baseline = HDRLibraryTrace.begin(container === space ? "grid" : "filmstrip",photo.path,started);
            HDRLibraryTrace.mark(baseline,"picture_camera_preview_decoded",started,{picture_size:"camera preview",route:/\.arw$/i.test(photo.path) ? "sony_embedded_preview" : meta.route});
            HDRLibraryTrace.present(baseline,()=>current() && !cell.meta,{picture_size:"camera preview",route:/\.arw$/i.test(photo.path) ? "sony_embedded_preview" : meta.route});
          }
        }).catch(()=>{});
        let cpuShown = false;
        while (current()) {
          try {
            const gpu = await HDRLibraryPictures.initialize();
            if (gpu.adapterInfo?.fallback) throw Error("Hardware GPU unavailable.");
            const trace = HDRLibraryTrace.begin(container === space ? "grid" : "filmstrip",photo.path,started);
            const meta = await HDRLibraryScenes.load(photo.path, cell.edge, cell.controller.signal,10,false,trace,
              {beforeSource:async()=>{
                // Fullscreen's own quick/sharp request gets source slots before the filmstrip.
                while (state.view === "single" && !readyWindow.has(selected() || {})) await sleep(50,cell.controller.signal);
                if (state.view === "single") await navigationGate.settled(cell.controller.signal);
              }});
            if (!current()) return;
            await drawPicture(meta, fallback, cell.controller, current);
            if (!current()) return;
            cell.meta = cell.scene = meta; cell.displayEpoch = state.displayEpoch; cell.elapsed = performance.now() - started;
            fallback.hidden = false; canvas.hidden = true; canvas.removeAttribute("src"); element.classList.remove("loading");
            fallback.dataset.pictureKey=meta.key; fallback.dataset.picturePath=photo.path;
            HDRLibraryStopwatch("picture_shown",{...window.HDRLibraryPictureLog?.(meta),view:container === space ? "grid" : "filmstrip",path:photo.path,key:meta.key,duration_ms:cell.elapsed});
            overlays?.attach(photo,fallback,meta,cell.controller,current);
            return;
          } catch(error) {
            if (aborted(error) || !current()) return;
            if (error.libraryYield) { await sleep(50,cell.controller.signal); continue; }
            if (error.libraryError || HDRLibraryPictures.usable()) throw error;
            if (!cpuShown) {
              const meta = await api("/api/library/fallback-picture",{path:photo.path,edge:cell.edge},cell.controller.signal);
              if (!current()) return;
              canvas.src=meta.url; await canvas.decode();
              if (!current()) return;
              canvas.hidden=false; canvas.style.visibility=""; fallback.hidden=true;
              canvas.dataset.preview="false"; canvas.dataset.cpuFallback="true";
              pictureMode(canvas,state.hdr); element.classList.remove("loading");
              window.HDRLibraryFolderPresented?.({view:container === space ? "grid" : "filmstrip"});
            cpuShown=true;
            }
            await sleep(2000,cell.controller.signal);
          }
        }
      })().catch(error=>{if(current()&&!aborted(error)){if(error.folderDetails)status(error.message);else removeUnreadable(photo,error);pictureErrors.paint(cell);cell.controller.abort();}});
      return cell;
    }
  }
  // Finished cached-picture cells stay built for one screen beyond each edge, so
  // scrolling back shows them at once. Loading cells detach from shared preparation.
  function reconcile(map, start, end, container, position) {
    const span = end - start, keepStart = Math.max(0, start - span), keepEnd = Math.min(state.photos.length, end + span);
    const kept = (cell, index) => index >= start && index < end || index >= keepStart && index < keepEnd && cell.meta && (!cell.fallback || cell.scene?.route === "library-live");
    const wanted = new Map(state.photos.slice(keepStart, keepEnd).map((photo, offset) => [photo.path, keepStart + offset]));
    map.shown = new Set(state.photos.slice(start, end).map(photo => photo.path));
    HDRLibraryScenes.viewport([...map.shown],state.photos.slice(keepStart,keepEnd).map(photo=>photo.path));
    for (const [path, cell] of map) {
      if (wanted.has(path) && kept(cell, wanted.get(path))) continue;
      cell.element.remove(); map.delete(path);
      if (cell.meta && cell.fallback && cell.displayEpoch === state.displayEpoch && !cell.controller.signal.aborted) {
        // Budget 16 bytes per pixel for the live surface and presentation buffers.
        overlays?.detach(cell.fallback);
        tilePool.put(tileKey(map, cell.identity), cell, cell.fallback.width * cell.fallback.height * 16);
      } else cell.controller.abort();
    }
    let requested = 0;
    for (let index = keepStart; index < keepEnd; index += 1) {
      const photo = state.photos[index];
      let cell = map.get(photo.path);
      if (cell && (cell.controller.signal.aborted || cell.edge !== thumbnailEdge() || cell.photo.bytes !== photo.bytes || cell.photo.mtime_ns !== photo.mtime_ns || cell.identity !== pictureIdentity(photo))) { cell.controller.abort(); cell.element.remove(); map.delete(photo.path); cell = null; }
      if (!cell && (index < start || index >= end || (map === state.cells && gridSettleTimer))) continue;
      if (!cell) {
        cell = tilePool.take(tileKey(map, pictureIdentity(photo)));
        if (cell) {
          container.append(cell.element); cell.photo = photo; cell.index = index;
          window.HDRLibraryFolderPresented?.({view:map === state.cells ? "grid" : "filmstrip"});
          HDRLibraryStopwatch("picture_thumbnail_reused", {path:photo.path,view:map === state.cells ? "grid" : "filmstrip",route:"recent-thumbnail-pool",picture_size:"thumbnail",duration_ms:0,cache_hit:true});
          overlays?.attach(photo, cell.fallback, cell.meta, cell.controller,
            () => state.active && cell.element.isConnected && !cell.controller.signal.aborted);
        }
        else { cell = makeCell(photo, container, index); requested++; }
        map.set(photo.path, cell);
      }
      position(cell.element, index);
      const active = state.selection.has(photo.path);
      cell.element.classList.toggle("active", active); cell.element.setAttribute("aria-selected", String(active));
      cell.element.classList.toggle("lead", active && index === state.index);
      cell.element.classList.toggle("rejected", photo.marks?.pick === "reject");
      cell.element.querySelector(".library-marks")?.remove(); cell.element.append(culling.strip(photo));
    }
    return requested;
  }
  let gridRequests = 0, gridSettleTimer;
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
    gridRequests += reconcile(state.cells, layout.first, layout.last, space, (element, index) => {
      element.style.cssText = `left:${3 + (index % layout.columns) * layout.cellWidth}px;top:${layout.top(index)}px;width:${layout.cellWidth - 3}px;height:${layout.rowHeight - 3}px`;
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
  let factsTimer, factsPath;
  function wantFacts(photo) {
    // The selected photo's details are read ahead of the folder-wide pass.
    if (factsPath === photo.path && (factsTimer || photo.selectedFactsAsked)) return;
    clearTimeout(factsTimer); factsPath = photo.path;
    if (photo.indexed || photo.selectedFactsAsked) return;
    factsTimer = setTimeout(async () => {
      factsTimer = null; photo.selectedFactsAsked = true;
      const started = performance.now();
      try {
        const result = await api("/api/library/metadata", { paths: [photo.path], demand:"selected" }, state.scan?.signal);
        const name=photo.name; Object.assign(photo, result.photos[0]); if(photo.copy_id)photo.name=name;
        HDRLibraryStopwatch("camera_details_shown",{path:photo.path,duration_ms:performance.now()-started,count:result.photos.length,demand:"selected"});
        if (state.sort === "time" || state.filters.rules?.length) applyQuery();
        else if (selected() === photo) updateDetails();
      } catch (error) { photo.selectedFactsAsked = false; if (!aborted(error)) console.debug("Library details:", error.message); }
    }, 30);
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
  function invalidateGradePictures(paths) {
    const targets = new Set(paths);
    readyWindow.invalidate(photo=>targets.has(photo.path)); quickWindow.invalidate(photo=>targets.has(photo.path));
    readAhead.clear();
    for (const [key] of recentPictures) if (paths.some(path=>key.startsWith(path+"|"))) recentPictures.delete(key);
    HDRLibraryScenes.invalidate(paths);
    tilePool.discard(cell => targets.has(cell.photo.path));
    for (const map of [state.cells, state.filmCells]) for (const [path, cell] of map) if (targets.has(path)) { cell.controller.abort(); cell.element.remove(); map.delete(path); }
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
    $("single-caption").replaceChildren(document.createTextNode(selected().name), culling.strip(selected()));
  }
  function select(index, scroll = false, mode = "single") {
    if(state.folderOpen)state.folderOpen.restore=null;
    if (!state.photos.length) return;
    if (compare.enabled() && state.view === "single") mode = "single";
    const next = HDRLibrarySelection.choose(state.photos.map(photo => photo.path), state.selection, state.anchor, index, mode);
    const previousIndex = state.index;
    state.index = next.index; state.selection = next.selected; state.anchor = next.anchor; updateDetails();
    startRawAhead(previousIndex);
    if (state.view === "grid") {
      if (scroll && state.layout) {
        const top = state.layout.scrollFor(state.index);
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
  let navigationTrace = null;
  async function showSingle() {
    const requestedTrace = navigationTrace; navigationTrace = null;
    if (!state.active || state.view !== "single") return;
    if (compare.enabled()) { restoreStandIn(); readyWindow.invalidate(); quickWindow.invalidate(); void compare.show(); return; }
    const photo = selected(), edge = singleEdge();
    const identity = photo ? `${photo.path}|${edge}|${state.hdr}|${state.displayEpoch}|${photo.grade_identity || ""}|${photo.bytes}|${photo.mtime_ns}|${JSON.stringify(HDRLibraryScreenPreviews.display())}` : "";
    if (identity && identity === state.singleIdentity && !state.single?.signal.aborted) {
      positionZoom();
      if (requestedTrace && state.fitMeta && $("single-picture").dataset.picturePath === photo.path)
        HDRLibraryTrace.present(requestedTrace,()=>selected()?.path === photo.path && state.singleIdentity === identity,{kept:true,quick_draw:false,sharp_draw:true});
      return;
    }
    restoreStandIn();
    HDRLibraryScenes.review?.(photo?.path || null);
    state.singleIdentity = identity;
    const fullIdentity = photo ? `${photo.path}|${photo.bytes}|${photo.mtime_ns}` : "";
    if (state.fullIdentity !== fullIdentity || state.nativeSource?.signal.aborted) {
      state.nativeSource?.abort(); state.fullDetail = null; state.fullSceneQuality = null;
      state.fullIdentity = fullIdentity; state.nativeSource = new AbortController();
    }
    state.single?.abort(); state.native?.abort(); state.nativeMeta = null; state.nativeLoading = false; state.fitMeta = null; $("native-picture").hidden = true;
    if (!photo || !state.active || state.view !== "single") return;
    compare.hide();
    const trace = requestedTrace || HDRLibraryTrace.begin(state.review ? "fullscreen" : "single",photo.path);
    const controller = new AbortController(); state.single = controller;
    controller.signal.addEventListener("abort",()=>{
      if (!trace.sharpPresented) HDRLibraryTrace.mark(trace,"picture_navigation_cancelled",trace.started);
      HDRLibraryTrace.end(trace,"navigation moved");
    },{once:true});
    const current = () => state.active && state.view === "single" && selected()?.path === photo.path && state.singleIdentity === identity && !controller.signal.aborted;
    // The fitted canvas survives Grid/Single switches. Never reveal its old
    // pixels while a different selection is waiting for source or GPU work.
    const canvas = $("single-picture");
    if (!readyWindow.has(photo) && (canvas.dataset.picturePath !== photo.path || canvas.dataset.readyIdentity !== readyKey(photo))) {
      HDRLibraryTrace.mark(trace,"picture_surface_hidden",performance.now(),{reason:"Waiting for selected photo or current grade"});
      canvas.hidden = true;
      delete canvas.dataset.picturePath; delete canvas.dataset.pictureEdge; delete canvas.dataset.pictureKey;
      positionZoom();
    }
    const borrowed = showStandIn(photo,controller,current,trace);
    updateSingleCaption();
    status(`Preparing screen preview · ${photo.name}…`);
    try {
      startRawAhead();
      const neighbours = readyNeighbours();
      readyWindow.update(photo,neighbours); quickWindow.update(photo,neighbours);
      readAhead.update(photo,developmentNeighbours(),2560,false);
      let meta, kept = false;
      try {
        kept = readyWindow.has(photo);
        if (kept) developAhead(photo);
        let sharp = readyWindow.get(photo,0,trace);
        sharp?.catch(()=>{});
        let quick = null;
        if (!kept && !borrowed) {
          const first = await Promise.race([sharp.then(value=>({value})),quickWindow.get(photo,0,trace).then(quick=>({quick})).catch(()=>({quick:null}))]);
          quick = first.quick || null;
          if (!current()) return;
          showQuick(quick,controller,current,trace);
          if (!quick && !first.value) void showCameraPreview(photo,controller,current,trace);
        }
        if (!sharp) {
          // A stored sharp development must not sit behind the quiet gate.
          sharp = readyWindow.get(photo,0,trace);
          sharp.catch(()=>{});
        }
        const waiting = performance.now();
        let value;
        if (!borrowed && !quick && !kept) {
          const small = quickWindow.get(photo,0,trace,{allowSource:true});
          small.catch(()=>{});
          const first = await Promise.race([sharp.then(value=>({value})),small.then(quick=>({quick})).catch(()=>({quick:null}))]);
          if (!current()) return;
          if (first.value) value = first.value;
          else { showQuick(first.quick,controller,current,trace); value = await sharp; }
        } else value = await sharp;
        HDRLibraryTrace.mark(trace,"picture_window_wait",waiting,{kept});
        if (!value) return;
        if (!current()) return;
        const previous = $("single-picture");
        if (previous !== value.canvas) {
          previous.removeAttribute("id"); value.canvas.id = "single-picture";
          previous.replaceWith(value.canvas);
          if (readySurfaces.get(previous)?.retired) releaseReady(readySurfaces.get(previous));
          if (!readySurfaces.has(previous)) { previous.width = previous.height = 0; previous.getContext("webgpu")?.unconfigure(); }
        }
        value.canvas.dataset.readyIdentity = readyKey(photo);
        value.canvas.dataset.singleIdentity = identity;
        value.canvas.dataset.picturePath = photo.path; value.canvas.dataset.pictureEdge = value.meta.edge; value.canvas.dataset.pictureKey = value.meta.key;
        value.canvas.hidden = false; value.canvas.style.visibility = "";
        HDRLibraryTrace.mark(trace,"picture_surface_swap",performance.now(),{kept,reason:"Finished sharp draw published"});
        meta = value.meta;
        overlays?.attach(photo,value.canvas,meta,controller,current);
      } catch (error) {
        if (!current()) return;
        if (!aborted(error) && !error.libraryYield && HDRLibraryPictures.usable()) throw error;
        meta = await loadAndShow(photo,2560,$("single-picture"),controller,current,0,null,trace);
        if (meta) $("single-picture").dataset.readyIdentity = readyKey(photo);
      }
      if (!meta || !current()) return;
      restoreStandIn();
      developAhead(photo);
      warmReady(photo,neighbours);
      if (state.fullSceneQuality && state.fullSceneQuality !== meta.quality) {
        state.nativeSource?.abort(); state.nativeSource = new AbortController(); state.fullDetail = null;
      }
      state.fullSceneQuality = meta.quality;
      state.fitMeta = meta; positionZoom(); if (state.zoom) void showNative();
      HDRLibraryTrace.present(trace,current,{key:meta.key,route:meta.route,cache_hit:!!meta.cache_hit,kept,quick_draw:false,sharp_draw:true});
      HDRLibraryScenes.save?.(meta,true);
      updateSingleCaption();
      status(`${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`);
    } catch (error) { HDRLibraryTrace.end(trace,error.message); if (state.single === controller) state.singleIdentity = ""; if (!aborted(error) && !controller.signal.aborted) removeUnreadable(photo, error); }
  }
  function positionZoom() {
    const canvas = $("single-picture"), native = $("native-picture"), stage = $("single-stage"), meta = state.nativeMeta || state.fitMeta;
    stage.classList.toggle("zoomed", state.zoom);
    const framing=state.fitMeta?.framing,box=meta?HDRPhotoFraming.layout(meta.source_width||meta.width*2,meta.source_height||meta.height*2,framing):null;
    const previousFrame=stage.querySelector("svg[data-photo-framing]");if(previousFrame)previousFrame.style.display="none";
    if ((!state.zoom && !framing?.enabled) || !meta) { canvas.style.cssText = ""; native.hidden = true; return; }
    const dpr = window.devicePixelRatio || 1;
    const scale=state.zoom?state.zoomScale:Math.min(stage.clientWidth*dpr/box.width,stage.clientHeight*dpr/box.height);
    const width = (meta.source_width || meta.width * 2) * scale, height = (meta.source_height || meta.height * 2) * scale;
    const center = state.zoom?HDRLibraryZoom.center(state.zoomX, state.zoomY, width, height, stage.clientWidth * dpr, stage.clientHeight * dpr,(box.frame+box.border)*scale):{x:.5,y:.5};
    state.zoomX = center.x; state.zoomY = center.y;
    const left = stage.clientWidth / 2 - center.x * width / dpr, top = stage.clientHeight / 2 - center.y * height / dpr;
    HDRPhotoFraming.draw(stage,box,framing,{scale:scale/dpr,left:`${left+width/dpr/2}px`,top:`${top+height/dpr/2}px`});
    canvas.style.cssText = `position:absolute;z-index:1;width:${width / dpr}px;height:${height / dpr}px;left:${left}px;top:${top}px;object-fit:fill`;
    if (state.fitMeta?.route === 'stored-screen-preview') canvas.style.visibility = state.zoom ? 'hidden' : '';
    native.hidden=!state.zoom;
    if (state.zoom && state.nativeMeta) {
      const crop = state.nativeMeta;
      native.style.cssText = `z-index:2;width:${crop.width * scale / dpr}px;height:${crop.height * scale / dpr}px;left:${left + crop.crop_x * scale / dpr}px;top:${top + crop.crop_y * scale / dpr}px`;
      native.hidden = false;
    }
  }
  async function prepareRawNative(photo, signal) {
    if (!rawCandidate(photo)) return;
    if (!HDRLibraryGpuRaw.enabled()) {
      HDRLibraryStopwatch("picture_gpu_raw_fallback",{picture_size:"detail preview",view:logView(),path:photo.path,reason:"WebGPU is unavailable or disabled."}); return;
    }
    try { await HDRLibraryGpuRaw.thumbnail(photo.path,2560,signal,{nativeMode:true}); }
    catch(error) { if (aborted(error)) throw error; HDRLibraryStopwatch("picture_gpu_raw_fallback",{picture_size:"detail preview",view:logView(),path:photo.path,reason:error.message}); }
  }
  async function showNative() {
    const photo = selected(); if (!photo || !state.fitMeta || !state.zoom || !state.active || state.view !== "single") return;
    const stage = $("single-stage"), dpr = window.devicePixelRatio || 1, scale = state.zoomScale, percent = `${Math.round(scale * 100)}%`;
    const fit = state.fitMeta;
    if (fit.route !== 'stored-screen-preview' && fit.source_width && fit.width >= fit.source_width * scale) {
      state.native?.abort(); state.nativeMeta = null; state.nativeLoading = false; $("native-picture").hidden = true; positionZoom();
      status(`${percent} · ${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`); return;
    }
    state.native?.abort(); const controller = new AbortController(); state.native = controller; state.nativeLoading = true;
    const current = () => state.active && state.zoom && state.view === "single" && selected()?.path === photo.path && !controller.signal.aborted;
    status(`Preparing detail preview · ${percent} · ${photo.name}…`);
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
      next.id = "native-picture"; next.removeAttribute("aria-hidden"); next.setAttribute("aria-label", "Detail preview");
      state.nativeMeta = {...meta,width,height,crop_x:x,crop_y:y}; next.dataset.picturePath = photo.path; positionZoom();
      status(`${percent} · ${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`);
    } catch (error) {
      if (error.libraryYield && current()) { setTimeout(()=>{ if (current()) void showNative(); },100); }
      else if (!aborted(error) && current()) status(`${percent} unavailable · ${error.message}`);
    }
    finally { if (state.native === controller) state.nativeLoading = false; }
  }
  function singleFrameInset(meta){const s=state.fitMeta?.framing,b=HDRPhotoFraming.layout(meta.source_width||meta.width*2,meta.source_height||meta.height*2,s);return b.frame+b.border;}
  function toggleZoom(point) {
    if (state.view !== "single" || !selected()) return;
    if (compare.enabled()) { compare.zoom(); return; }
    state.zoom = !state.zoom; state.zoomScale = 1; state.native?.abort(); state.nativeLoading = false; state.nativeMeta = null;
    if (state.zoom && point && state.fitMeta) {
      const stage = $("single-stage"), meta = state.fitMeta;
      const center = HDRLibraryZoom.click(point.x, point.y, stage.clientWidth, stage.clientHeight, meta.source_width || meta.width, meta.source_height || meta.height,singleFrameInset(meta));
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
    const fit = HDRLibraryZoom.fitScale(sourceWidth, sourceHeight, width, height,singleFrameInset(meta));
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
    const center = HDRLibraryZoom.anchor(start.x, start.y, (event.clientX - rect.left) * dpr, (event.clientY - rect.top) * dpr, width, height, sourceWidth, sourceHeight, from, to,singleFrameInset(meta));
    state.zoom = true; state.zoomScale = to; state.zoomX = center.x; state.zoomY = center.y;
    $("zoom-button").setAttribute("aria-pressed", "true");
    positionZoom(); nativeTimer = setTimeout(showNative, 150);
  }, { passive: false });
  function setView(view) {
    if (view === "single" && !selected()) return;
    if (view !== "single") { compare.hide(); HDRLibraryScenes.review?.(null); }
    state.view = view; $("library-single").hidden = view !== "single"; grid.hidden = view !== "grid";
    $("zoom-button").disabled = view !== "single";
    $("grid-view").setAttribute("aria-pressed", String(view === "grid")); $("single-view").setAttribute("aria-pressed", String(view === "single"));
    if (view === "single") {
      // Preserve finished grid surfaces in the existing bounded pool for quick draws.
      for (const cell of state.cells.values()) {
        cell.element.remove();
        if (cell.meta && cell.fallback && cell.displayEpoch === state.displayEpoch && !cell.controller.signal.aborted) {
          overlays?.detach(cell.fallback);
          tilePool.put(tileKey(state.cells,cell.identity),cell,cell.fallback.width * cell.fallback.height * 16);
        } else cell.controller.abort();
      }
      state.cells.clear(); select(state.index, true, "preserve");
    }
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
    if(state.folderOpen)HDRLibraryStopwatch("folder_open_cancelled",{path:state.path,request:state.folderOpen.request,reason:"opened another place"});
    state.scan?.abort(); state.single?.abort(); state.native?.abort(); clearPrefetch(); clearCells(state.cells); clearCells(state.filmCells);
    state.collection = place.kind ? { kind: place.kind, name: place.name } : null; state.smartFilters = null; albums.setActive(place.kind === "album" ? place.name : ""); smart.setActive(place.kind === "smart" ? place.name : "");
    if (path) state.lastFolder = path;  // Where a deleted album's view returns to.
    const controller = new AbortController(); state.scan = controller; state.folderOpen = null; state.path = path; state.reading = true; state.scanError = ""; state.allPhotos = []; state.photos = []; state.index = -1; state.selection.clear(); state.anchor = -1; state.hiddenFiles = 0;
    setView("grid"); grid.scrollTop = 0;
    $("check-photos").disabled = !path;
    $("place-title").textContent = place.kind === "smart" ? smart.name(place.name) || "Smart album" : place.kind === "album" ? place.name : place.kind ? `Tag · ${place.name}` : path.split(/[\\/]/).filter(Boolean).at(-1) || path;
    $("place-title").title = place.kind === "smart" ? "Smart album · saved filter across the indexed library" : place.kind === "album" ? "Album. Photos stay where they are." : place.kind ? "Every connected photo that carries this tag" : path; status(place.kind ? "Reading…" : "Reading folder…");
    for (const element of $("folders").querySelectorAll(".library-folder-row")) element.classList.toggle("active", !place.kind && element.dataset.path === path);
    try {
      if (!place.kind) { await openFolderStream(path, controller); return; }
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
  let folderPaintTimer;
  async function openFolderStream(path, controller) {
    const started = performance.now(), rows = new Map(), copies = new Map();
    const opening = {path, controller, started, request:null, presented:false};
    state.folderOpen = opening;
    HDRLibraryStopwatch("folder_open", {path});
    const response = await fetch("/api/library/folder-stream", {method:"POST",signal:controller.signal,
      headers:{"Content-Type":"application/json"},body:JSON.stringify({path})});
    if (!response.ok) throw Error("The folder could not be opened.");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let readyResolve,readyReject;
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    let pending = [], first = true;
    const paint = () => {
      clearTimeout(folderPaintTimer); folderPaintTimer = null;
      if (controller.signal.aborted || state.scan !== controller) return;
      const top=grid.scrollTop,left=film.scrollLeft;
      state.allPhotos = [...rows.values()];
      applyQuery(false); grid.scrollTop=top;film.scrollLeft=left;paintGrid();paintFilm();
    };
    opening.paint=paint;
    const pump=async()=>{try {
      for (;;) {
        const {value,done} = await reader.read();
        if (done) break;
        // A large complete snapshot spans many network chunks. Scan each
        // chunk once and join once per event, rather than rescanning/copying
        // the entire growing JSON message on every 64 KiB arrival.
        const chunk=decoder.decode(value,{stream:true});
        let offset=0,end;
        while ((end=chunk.indexOf("\n",offset))>=0) {
          pending.push(chunk.slice(offset,end));
          const event=JSON.parse(pending.join(""));pending=[];offset=end+1;
          if(controller.signal.aborted || state.scan !== controller)return;
          opening.request=event.request;
          if(event.kind === "error")throw Error(event.message);
          if(event.kind === "rows" || event.kind === "changes") {
            for(const key of event.removed || []) {
              rows.delete(key);
              for(const copy of copies.get(key)||[])rows.delete(copy);
              copies.delete(key);
            }
            if(event.kind==="changes")for(const photo of event.photos)if(!photo.source_path) {
              for(const copy of copies.get(photo.path)||[])rows.delete(copy);
              copies.delete(photo.path);
            }
            for(const photo of event.photos) {
              if(photo.source_path){const family=copies.get(photo.source_path)||new Set();family.add(photo.path);copies.set(photo.source_path,family);}
              const previous=rows.get(photo.path);
              // Optimistic marks and visible hydration win over an older index page.
              rows.set(photo.path,previous?Object.assign(previous,photo):photo);
            }
            if(first && rows.size) {
              first=false;state.reading=false;
              HDRLibraryStopwatch("folder_first_rows",{path,request:event.request,duration_ms:performance.now()-started});
              paint();readyResolve();
            } else if(!folderPaintTimer)folderPaintTimer=setTimeout(paint,500);
          }
          if(event.kind === "indexed") {
            state.reading=rows.size===0;if(first)paint();readyResolve();
            void readDates(controller, [...rows.values()].filter(photo=>!photo.indexed));
            HDRLibraryStopwatch("folder_listed",{path,request:event.request,duration_ms:performance.now()-started});
          }
          if(event.kind === "checked") {
            state.reading=false;paint();
            HDRLibraryStopwatch("folder_complete",{path,request:event.request,duration_ms:performance.now()-started});
            if(event.unreadable_folders?.length)status("Some sub-folders could not be read; existing entries kept");
          }
        }
        if(offset<chunk.length)pending.push(chunk.slice(offset));
      }
    } catch(error) {
      readyReject(error);
      if(!aborted(error) && state.scan===controller){state.reading=false;state.scanError=error.message;status(error.message);}
    } finally {
      readyResolve();reader.releaseLock();clearTimeout(folderPaintTimer);
      HDRLibraryStopwatch("folder_stream_ended",{path,request:opening.request,reason:controller.signal.aborted?"opened another place":"connection ended"});
    }};
    void pump();
    return ready;
  }
  window.HDRLibraryFolderPresented = (trace,fields={}) => {
    const opening=state.folderOpen;
    if(!opening || opening.controller.signal.aborted || trace.view!=="grid")return;
    if(!opening.presented){opening.presented=true;folderPaintTimer=setTimeout(opening.paint,500);}
    const camera=fields.picture_size==="camera preview";
    const flag=camera?"cameraPresented":"thumbnailPresented";
    if(opening[flag])return;opening[flag]=true;
    HDRLibraryStopwatch(camera?"folder_first_camera_preview":"folder_first_thumbnail",{path:opening.path,request:opening.request,duration_ms:performance.now()-opening.started});
  };
  // Batch visible settings reads before any picture work. Offscreen rows already
  // carry indexed marks/grades; their sources are never opened for drawing.
  let visibleDetails = new Map(), detailsTimer;
  function hydrateVisible(photo, current, signal) {
    if(!state.folderOpen || state.folderOpen.controller !== state.scan || photo._details)return Promise.resolve();
    const controller=state.scan;
    return new Promise((resolve,reject)=>{
      const key=photo.source_path || photo.path;
      const pending=visibleDetails.get(key)||[];
      pending.push({photo,current,signal,resolve,reject});visibleDetails.set(key,pending);
      if(detailsTimer)return;
      detailsTimer=setTimeout(async()=>{
        detailsTimer=null;
        const entries=[...visibleDetails];visibleDetails=new Map();
        const live=entries.filter(([,items])=>items.some(item=>item.current()));
        try {
          for(let at=0;at<live.length;at+=32) {
            const group=live.slice(at,at+32);
            const demand=new AbortController();
            const items=group.flatMap(([,items])=>items);
            const cancel=()=>{if(controller.signal.aborted || !items.some(item=>item.current()))demand.abort();};
            controller.signal.addEventListener("abort",cancel,{once:true});
            for(const item of items)item.signal?.addEventListener("abort",cancel,{once:true});
            let result;
            try {
              cancel();
              if(demand.signal.aborted)continue;
              result=await api("/api/library/folder-details",{paths:group.filter(([,items])=>items.some(item=>item.current())).map(([path])=>path)},demand.signal);
            } catch(error) {if(demand.signal.aborted && !controller.signal.aborted)continue;throw error;}
            finally {
              controller.signal.removeEventListener("abort",cancel);
              for(const item of items)item.signal?.removeEventListener("abort",cancel);
            }
            if(controller.signal.aborted)throw new DOMException("Cancelled","AbortError");
            const known=new Map(result.photos.map(photo=>[photo.path,photo]));
            for(const [,items] of group)for(const item of items) {
              if(item.current())Object.assign(item.photo,known.get(item.photo.path),{_details:true});
              item.resolve();
            }
          }
          for(const [,items] of entries)for(const item of items)item.resolve();
          if(state.scan===controller){
            // Hydration changes grade identity before the awaiting cell resumes.
            for(const map of [state.cells,state.filmCells])for(const cell of map.values())
              if(!cell.meta && !cell.controller.signal.aborted)cell.identity=pictureIdentity(cell.photo);
            paintGrid();paintFilm();
            const visible=live.flatMap(([,items])=>items.filter(item=>item.current()).map(item=>item.photo));
            for(let at=0;at<visible.length;at+=32)void readVisibleFacts(visible.slice(at,at+32),controller);
          }
        } catch(error) {error.folderDetails=true;for(const [,items] of entries)for(const item of items)item.reject(error);}
      },0);
    });
  }
  function applyQuery(paint = true) {
    paintFilterButton();
    const restored=state.folderOpen?.restore;
    const lead = restored?.selected || selected()?.path, anchor = restored?.anchor || state.photos[state.anchor]?.path;
    const base = state.collection?.kind === "smart" ? HDRLibraryQuery.apply(state.allPhotos, state.sort, state.descending, state.smartFilters || {}) : state.allPhotos;
    state.photos = HDRLibraryQuery.apply(base, state.sort, state.descending, state.filters);
    const visible = new Set(state.photos.map(photo => photo.path));
    state.selection = new Set([...state.selection].filter(path => visible.has(path)));
    state.index = state.photos.findIndex(photo => photo.path === lead);
    if (state.index < 0 && state.photos.length) { state.index = 0; state.selection.add(state.photos[0].path); }
    if(restored && visible.has(restored.selected)) {
      state.selection=new Set((restored.selection||[restored.selected]).filter(path=>visible.has(path)));
      state.selection.add(restored.selected);state.folderOpen.restore=null;
    }
    state.anchor = state.photos.findIndex(photo => photo.path === anchor);
    if (state.anchor < 0) state.anchor = state.index;
    if (!selected() && state.view === "single") setView("grid");
    updateDetails(); if(paint){paintGrid();paintFilm();}
    startRawAhead();
    if (state.view === "single" && selected()?.path !== lead) showSingle();
    if (!state.reading) status(`${state.photos.length.toLocaleString()} of ${state.allPhotos.length.toLocaleString()} photos${state.hiddenFiles ? ` · ${state.hiddenFiles} unreadable files hidden` : ""}${state.collection?.kind === "smart" && state.smartIndexing ? " · Indexing is still running, so more may turn up." : ""}`);
  }
  let factsQueryTimer;
  async function readVisibleFacts(photos, controller, demand="visible") {
    const waiting=photos.filter(photo=>!photo.indexed && !photo.factsAsked);
    if(!waiting.length)return;
    const started=performance.now();
    if(demand!=="background")for(const photo of waiting)photo.factsAsked=true;
    try {
      const result=await api("/api/library/metadata",{paths:waiting.map(photo=>photo.path),demand},controller.signal);
      if(controller.signal.aborted || state.scan!==controller)return;
      const known=new Map(result.photos.map(photo=>[photo.path,photo]));
      for(const photo of waiting){const name=photo.name;Object.assign(photo,known.get(photo.path));if(photo.copy_id)photo.name=name;}
      HDRLibraryStopwatch("camera_details_shown",{demand,count:result.photos.length,duration_ms:performance.now()-started});
      if(state.sort==="time" || state.filters.rules?.length){
        // Coalesce background fact arrivals instead of sorting a large folder
        // once for every EXIF wave on the page's foreground thread.
        if(!factsQueryTimer)factsQueryTimer=setTimeout(()=>{
          factsQueryTimer=null;
          if(state.scan===controller && state.active){
            const anchor=state.photos[state.layout?.first]?.path;
            const offset=state.layout ? grid.scrollTop-state.layout.scrollFor(state.layout.first) : 0;
            applyQuery(false);
            const index=state.photos.findIndex(photo=>photo.path===anchor);
            if(index>=0 && state.layout)grid.scrollTop=state.layout.scrollFor(index)+offset;
            paintGrid();paintFilm();
          }
        },demand==="background"?1000:100);
      } else if(waiting.includes(selected()))updateDetails();
    } catch(error){if(!aborted(error))console.debug("Library camera details:",error.message);}
    finally{if(demand!=="background")for(const photo of waiting)photo.factsAsked=false;}
  }
  async function readDates(controller, photos) {
    // The helper's low-priority index lane fills missing details. Visible rows
    // and the selection use independent foreground requests ahead of this pass.
    const batch=Math.max(32,navigator.hardwareConcurrency || 32);
    for(let at=0;at<photos.length && !controller.signal.aborted;at+=batch){
      await readVisibleFacts(photos.slice(at,at+batch),controller,"background");
      await sleep(20,controller.signal).catch(()=>{});
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
  // Match the workspace splitters: drag, arrow keys, Home/End and reset.
  for (const [side, maximum, direction] of [["left", 380, 1], ["right", 420, -1]]) {
    const splitter = $(`library-${side}-splitter`);
    let width = 250;
    const setWidth = value => {
      width = Math.max(200, Math.min(maximum, value));
      library.style.setProperty(`--library-${side}-w`, `${width}px`);
      splitter.setAttribute("aria-valuenow", String(Math.round(width)));
    };
    splitter.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = event.clientX, initial = width, pointer = event.pointerId;
      splitter.setPointerCapture(pointer);
      splitter.classList.add("dragging");
      document.documentElement.dataset.resizing = "true";
      const move = next => { if (next.pointerId === pointer) setWidth(initial + (next.clientX - start) * direction); };
      const stop = next => {
        if (next.pointerId !== pointer) return;
        splitter.removeEventListener("pointermove", move);
        splitter.removeEventListener("pointerup", stop);
        splitter.removeEventListener("pointercancel", stop);
        splitter.removeEventListener("lostpointercapture", stop);
        splitter.classList.remove("dragging");
        document.documentElement.removeAttribute("data-resizing");
        if (splitter.hasPointerCapture(pointer)) splitter.releasePointerCapture(pointer);
      };
      splitter.addEventListener("pointermove", move);
      splitter.addEventListener("pointerup", stop);
      splitter.addEventListener("pointercancel", stop);
      splitter.addEventListener("lostpointercapture", stop);
    });
    splitter.addEventListener("dblclick", () => setWidth(250));
    splitter.addEventListener("keydown", event => {
      const value = event.key === "Home" ? 200 : event.key === "End" ? maximum
        : event.key === "ArrowLeft" ? width - 8 * direction
        : event.key === "ArrowRight" ? width + 8 * direction : null;
      if (value === null) return;
      event.preventDefault();
      setWidth(value);
    });
  }
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
    onPictureError: record => pictureErrors.show(record),
    onHealth: next => { pictureErrors.update(next.picture_errors || [], next.picture_errors_checked_at); if(next.file_commands && next.file_commands.revision !== fileRevision) {fileRevision=next.file_commands.revision;if(next.file_commands.changes.length)void filesChanged({...next.file_commands,undo_available:culling.undoAvailable()});} showIndexing(next.index); void refreshCheckedFolders(next.index.checks); } });
  $("library-undo").addEventListener("click", () => { void culling.undo(); });
  let checkEvent = 0, refreshingCheck = false;
  const checkClient = crypto.randomUUID();
  async function refreshCheckedFolders(checks) {
    if (!checks || refreshingCheck || state.reading || (!state.collection && state.folderOpen?.controller === state.scan)) return;
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
        const result = await api("/api/library/settings-status", { paths });
        const byPath = new Map(result.photos.map(photo => [photo.path, photo]));
        let changed = false;
        for (const photo of state.allPhotos) {
          const row = byPath.get(photo.path);
          if (row && (row.grade_identity || "") !== (photo.grade_identity || "")) {
            tilePool.discard(cell => cell.photo.path === photo.path);
            Object.assign(photo, { edited: row.edited, grade_identity: row.grade_identity });
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
    if (state.active && !document.hidden) { try { await api("/api/library/checks", { client: checkClient, visible: state.folderOpen?.controller === state.scan ? "" : state.path }); await activity.refresh(); } catch (error) { console.debug("Library index:", error.message); } }
    setTimeout(pollIndexing, 1000);
  }
  $("thumbnail-size").addEventListener("input", (event) => { state.size = Number(event.target.value); paintSize(); paintGrid(); paintFilm(); });
  let gridFrame = 0, filmFrame = 0;
  grid.addEventListener("scroll", () => {
    if(!gridSettleTimer)gridRequests=0;
    // Detach loading cells immediately; a settled viewport starts fresh demand.
    for(const [path,cell] of state.cells)if(!cell.meta){cell.controller.abort();cell.element.remove();state.cells.delete(path);}
    idlePictures.touch();
    if (!gridFrame) gridFrame = requestAnimationFrame(() => { gridFrame = 0; paintGrid(); });
    clearTimeout(gridSettleTimer);
    gridSettleTimer = setTimeout(() => {
      gridSettleTimer=null;
      paintGrid();
      const layout = state.layout;
      HDRLibraryStopwatch("grid_scroll_settled", {path:state.path,request:state.folderOpen?.request,
        range_start:layout?.first,range_end:layout?.last,total:state.photos.length,scroll_top:grid.scrollTop,
        picture_requests:gridRequests,active:state.active});
      gridRequests = 0;
    },100);
  });
  film.addEventListener("scroll", () => { idlePictures.touch(); if (!filmFrame) filmFrame = requestAnimationFrame(() => { filmFrame = 0; paintFilm(); }); });
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
  window.addEventListener("keyup", event => { if (event.key.startsWith("Arrow")) navigationGate.release(); });
  window.addEventListener("blur", () => navigationGate.release());
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
    if (key in steps) {
      navigationGate.touch();
      const target = state.photos[Math.max(0,Math.min(state.photos.length-1,state.index+steps[key]))];
      if (state.view === "single" && target)
        navigationTrace = HDRLibraryTrace.begin(state.review ? "fullscreen" : "single",target.path);
      event.preventDefault(); select(state.index + steps[key], true, event.shiftKey ? "range" : "single");
    }
    else if (key === "enter") { event.preventDefault(); openGrade(); }
    else if (key === "delete") { event.preventDefault(); fileCommands.remove(state.photos.filter(photo => state.selection.has(photo.path))).catch(error => status(error.message)); }
    else if (key === " ") { event.preventDefault(); setView(state.view === "grid" ? "single" : "grid"); }
    else if (key === "z") { event.preventDefault(); toggleZoom(); }
    else if (key === "h") {
      event.preventDefault();
      if (!event.repeat) {
        const button = $("hdr-button");
        // A previous mouse click can leave focus here. Keyboard modality
        // would then paint a second ring unrelated to the toggle state.
        if (document.activeElement === button) button.blur();
        button.click();
      }
    }
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
    const indices = HDRLibrarySelection.boxIndices(state.layout, state.photos.length, {...box,top:box.top+state.layout.logicalTop-grid.scrollTop,bottom:box.bottom+state.layout.logicalTop-grid.scrollTop});
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
    const previousScan=state.scan;
    state.sort = saved.sort || "time"; state.descending = !!saved.descending; state.filters = { rules: saved.filters?.rules || [], any: false, raw: !!saved.filters?.raw };
    state.size = saved.size || 190; state.hdr = !!saved.hdr; state.zoom = !!saved.zoom;
    state.zoomX = saved.zoomX ?? .5; state.zoomY = saved.zoomY ?? .5; state.zoomScale = saved.zoomScale || 1;
    $("thumbnail-size").value = state.size; paintSort(); paintSize();
    $("hdr-button").setAttribute("aria-pressed", String(state.hdr)); $("zoom-button").setAttribute("aria-pressed", String(state.zoom));
    $("raw-only").setAttribute("aria-pressed", String(state.filters.raw));
    $("library-filterbar").hidden = !saved.filterOpen; paintFilterButton();
    collapse("left", !!saved.leftClosed); collapse("right", !!saved.rightClosed); ruleFilters.render();
    await refreshPins();
    if(state.scan!==previousScan)return;
    if (saved.collection) await browseCollection(saved.collection.kind, saved.collection.name);
    else if (saved.path) await browse(saved.path);
    if(state.folderOpen && !state.photos.some(photo=>photo.path===saved.selected))state.folderOpen.restore=saved;
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
      readyWindow.invalidate(); quickWindow.invalidate();
      state.displayEpoch += 1;
      if (state.view === "single") showSingle(); else { clearCells(state.cells); paintGrid(); }
    });
    window.addEventListener("keydown", event => {
      if (event.key === "F11" && libraryDesktop) { event.preventDefault(); void libraryDesktop.performWindowAction("fullscreen"); }
    });
  }
  // Read-only status for the focused interaction driver; no test-only behavior.
  HDRLibraryStopwatch("ready");
  window.HDRLibrary = Object.freeze({ browse, refreshPins, getSnapshot: () => ({ path: state.path, collection: state.collection, albums: albums.names(), rules: (state.filters.rules || []).length, indexing: state.indexing, facts: selected() ? { camera: selected().camera, lens: selected().lens, iso: selected().iso, indexed: !!selected().indexed, albums: selected().albums || [] } : null, count: state.photos.length,
    overlays: overlays.snapshot(), compare: compare.snapshot(), selected: selected()?.path, selection: [...state.selection], marks: selected()?.marks, view: state.view, review: state.review, visible: shownCells(state.cells).length,
    filmVisible: shownCells(state.filmCells).length, active: state.active, hdr: state.hdr, zoom: state.zoom, zoomScale: state.zoomScale, zoomCenter: [state.zoomX, state.zoomY], nativeLoading: state.nativeLoading, native: state.nativeMeta ? { width: state.nativeMeta.source_width, height: state.nativeMeta.source_height, x: state.nativeMeta.crop_x, y: state.nativeMeta.crop_y } : null, reading: state.reading, total: state.allPhotos.length, sort: state.sort, descending: state.descending, paths: state.photos.map(photo => photo.path) }) });
  (async () => {
    try {
      const options = await api("/api/library/options"); state.timing = options.timing;
      browsingLimits = options.browsing || browsingLimits;
      void HDRLibraryPictures.configure(browsingLimits).catch(() => {});
      state.labelNames = (await api("/api/library/preferences")).label_names;
      void albums.refresh().catch(error => status(error.message)); void pollIndexing();
      const windowState = libraryDesktop ? await libraryDesktop.getLibraryWindow() : null;
      if (windowState) applyTheme(windowState.theme);
      const saved = windowState?.state;
      if (!state.scan) {
        if (saved) await restoreState(saved);
        else { await refreshPins(); const first = state.pins.find((pin) => pin.available); if (first && !state.scan) await browse(first.path); }
      }
      await libraryDesktop?.rendererReady();
      postParent("ready");
    } catch (error) { status(error.message); }
    finally { document.body.dataset.libraryReady="true"; }
  })();
})();
