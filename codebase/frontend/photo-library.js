/* This page owns its state. Folder and picture work are backend commands. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const library = $("library"), grid = $("library-grid"), space = $("grid-space"), film = $("filmstrip");
  const state = { photos: [], allPhotos: [], reading: false, hdr: false, zoom: false, zoomX: .5, zoomY: .5, native: null, nativeMeta: null, nativeLoading: false, fitMeta: null, displayEpoch: 0, scanError: "", sort: "time", descending: false, filters: {}, index: -1, path: "", view: "grid", review: false, beforeReview: "grid",
    pins: [], cells: new Map(), filmCells: new Map(), prefetch: new Map(), size: 190,
    selection: new Set(), anchor: -1, scan: null, single: null, active: true, timing: false, picker: null, hiddenFiles: 0 };
  const standalone = parent === window, libraryDesktop = standalone ? window.hdrFinisherDesktop : null;
  const postParent = (action, detail = {}) => {
    if (!standalone) parent.postMessage({ type: "hdr-library", action, ...detail }, location.origin);
    else if (libraryDesktop) {
      const task = action === "open-source" ? libraryDesktop.openSourceInMain(detail.path)
        : action === "choose-source" ? libraryDesktop.chooseSourceInMain()
        : action === "review" ? libraryDesktop.getWindowState().then(current => {
          if (current.fullscreen !== detail.enabled) return libraryDesktop.performWindowAction("fullscreen");
        }) : null;
      task?.catch(error => status(error.message));
    }
  };
  const status = (message) => { $("library-status").textContent = message; };
  const aborted = (error) => error?.name === "AbortError";
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
  const pictureRequests = HDRLibraryRequestQueue.create();
  async function api(route, body, signal) {
    for (;;) {
      const request = async () => {
        const response = await fetch(route, { signal, ...(body === undefined ? {} : {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
        return { response, result: await response.json() };
      };
      const { response, result } = await ((route === "/api/library/picture" || route === "/api/library/native")
        ? pictureRequests.submit(request, signal, body.priority) : request());
      if (response.status === 202) { await sleep(150, signal); continue; }
      if (!response.ok) {
        const error = new Error(typeof result.detail === "string" ? result.detail : "Library request failed.");
        error.status = response.status; throw error;
      }
      return result;
    }
  }
  const culling = HDRLibraryCulling.create({ photos: () => state.allPhotos, selection: () => state.selection, api, status,
    updated: () => { applyQuery(); updateSingleCaption(); } });
  function selected() { return state.photos[state.index]; }
  function clearCells(map) {
    for (const cell of map.values()) { cell.controller.abort(); cell.element.remove(); }
    map.clear();
  }
  function clearPrefetch() {
    for (const controller of state.prefetch.values()) controller.abort();
    state.prefetch.clear();
  }
  function setActive(active) {
    state.active = active;
    if (!active) {
      clearCells(state.cells); clearCells(state.filmCells); clearPrefetch(); state.single?.abort();
      state.scan?.abort(); state.native?.abort();
    } else if (state.path && !state.photos.length) void browse(state.path);
    else { paintGrid(); paintFilm(); if (state.view === "single") showSingle(); }
  }
  function diagnostics(photo, meta, elapsed) {
    if (!state.timing) return;
    const message = `${photo.name}: ${Math.round(elapsed)} ms to picture · ${meta.cache_hit ? "cached" : meta.route} · ${Math.round(meta.stored_bytes / 1024)} KiB`;
    $("library-diagnostic").hidden = false;
    $("library-diagnostic").textContent = message;
    console.info("[library-picture]", message);
  }
  async function loadAndShow(photo, edge, canvas, controller, isCurrent, priority = 10) {
    const started = performance.now();
    const slow = ["DNG", "HEIC", "HEIF", "TIF", "TIFF"].includes(photo.type);
    let meta = await api("/api/library/picture", { path: photo.path, edge, quality: slow ? "fast" : "quick", priority }, controller.signal);
    if (!isCurrent()) return;
    await drawPicture(meta, canvas, controller, isCurrent);
    if (!isCurrent()) return;
    diagnostics(photo, meta, performance.now() - started);
    if (slow && meta.route.endsWith("-placeholder")) {
      meta = await api("/api/library/picture", { path: photo.path, edge, quality: "quick", priority: priority + 1 }, controller.signal);
      if (!isCurrent()) return;
      await drawPicture(meta, canvas, controller, isCurrent);
      if (!isCurrent()) return;
    }
    canvas.dataset.pictureKey = meta.key;
    canvas.dataset.picturePath = photo.path;
    return meta;
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
      if (cell.meta) void drawPicture(cell.meta, cell.canvas, cell.controller, () => state.active && cell.element.isConnected && !cell.controller.signal.aborted)
        .catch(error => { if (!aborted(error)) status(error.message); });
    }
    if (state.view === "single") showSingle();
  }
  $("hdr-button").addEventListener("click", toggleHDR);
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
    const canvas = document.createElement("canvas"); canvas.setAttribute("aria-label", photo.name); frame.append(canvas);
    const name = document.createElement("span"); name.className = "name"; name.textContent = photo.name;
    element.append(frame, name); container.append(element);
    const cell = { element, canvas, controller: new AbortController(), photo, index };
    element.addEventListener("click", (event) => select(state.photos.findIndex((item) => item.path === photo.path), false, event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single"));
    element.addEventListener("dblclick", () => { select(state.photos.findIndex((item) => item.path === photo.path)); openGrade(); });
    element.addEventListener("pointerenter", () => { if (state.timing && cell.meta) diagnostics(photo, cell.meta, cell.elapsed); });
    const started = performance.now();
    loadAndShow(photo, container === $("film-space") ? 192 : 512, canvas, cell.controller,
      () => state.active && element.isConnected && !cell.controller.signal.aborted).then((meta) => {
        if (!meta) return;
        cell.meta = meta; cell.elapsed = performance.now() - started;
        element.classList.remove("loading");
      }).catch((error) => { if (!aborted(error) && !cell.controller.signal.aborted) removeUnreadable(photo, error); });
    return cell;
  }
  function reconcile(map, start, end, container, position) {
    const wanted = new Set(state.photos.slice(start, end).map((photo) => photo.path));
    for (const [path, cell] of map) {
      if (wanted.has(path)) continue;
      cell.controller.abort(); cell.element.remove(); map.delete(path);
    }
    for (let index = start; index < end; index += 1) {
      const photo = state.photos[index];
      let cell = map.get(photo.path);
      if (!cell) { cell = makeCell(photo, container, index); map.set(photo.path, cell); }
      position(cell.element, index);
      const active = state.selection.has(photo.path);
      cell.element.classList.toggle("active", active); cell.element.setAttribute("aria-selected", String(active));
      cell.element.classList.toggle("rejected", photo.marks?.pick === "reject");
      cell.element.querySelector(".library-marks")?.remove(); cell.element.append(culling.strip(photo));
    }
  }
  function paintGrid() {
    if (!state.active || state.view !== "grid") return;
    const layout = HDRLibraryLayout.gridLayout(state.photos.length, grid.clientWidth, grid.clientHeight, grid.scrollTop, state.size);
    state.layout = layout; space.style.height = `${layout.totalHeight}px`;
    $("library-empty").hidden = state.photos.length > 0;
    $("empty-add").hidden = state.pins.length > 0 || state.reading;
    if (!state.photos.length) $("empty-message").textContent = state.reading ? "Reading folder…" : state.scanError || (state.allPhotos.length ? "No photos match these filters." : state.path ? "No readable photos in this folder." : "Add a folder to start browsing.");
    reconcile(state.cells, layout.first, layout.last, space, (element, index) => {
      element.style.cssText = `left:${10 + (index % layout.columns) * layout.cellWidth}px;top:${10 + Math.floor(index / layout.columns) * layout.rowHeight}px;width:${layout.cellWidth}px;height:${layout.rowHeight}px`;
    });
  }
  function paintFilm() {
    if (!state.active || state.view !== "single" || state.review) { clearCells(state.filmCells); return; }
    $("film-space").style.width = `${state.photos.length * 128}px`;
    const first = Math.max(0, Math.floor(film.scrollLeft / 128));
    const last = Math.min(state.photos.length, Math.ceil((film.scrollLeft + film.clientWidth) / 128));
    reconcile(state.filmCells, first, last, $("film-space"), (element, index) => { element.style.left = `${index * 128}px`; });
  }
  function updateDetails() {
    const photo = selected(); const root = $("details"), tagFocused = document.activeElement?.id === "library-tag-input"; root.replaceChildren();
    if (!photo || !state.selection.size) { root.textContent = "Select a photo."; return; }
    const title = document.createElement("strong"); title.textContent = photo.name; root.append(title);
    const list = document.createElement("dl");
    for (const [label, value] of [["File type", photo.type], ["Size", `${(photo.bytes / 1024 / 1024).toFixed(1)} MB`], ["Location", photo.path]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; list.append(dt, dd);
    }
    culling.details(root); root.append(list);
    if (tagFocused) $("library-tag-input")?.focus();
  }
  function updateSingleCaption() {
    if (!selected()) return;
    $("single-caption").replaceChildren(document.createTextNode(selected().name), culling.strip(selected()));
  }
  function select(index, scroll = false, mode = "single") {
    if (!state.photos.length) return;
    const next = HDRLibrarySelection.choose(state.photos.map(photo => photo.path), state.selection, state.anchor, index, mode);
    state.index = next.index; state.selection = next.selected; state.anchor = next.anchor; updateDetails();
    if (state.view === "grid") {
      if (scroll && state.layout) {
        const top = 10 + Math.floor(state.index / state.layout.columns) * state.layout.rowHeight;
        if (top < grid.scrollTop) grid.scrollTop = top;
        else if (top + state.layout.rowHeight > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + state.layout.rowHeight - grid.clientHeight;
      }
      paintGrid();
    } else {
      const left = state.index * 128;
      if (left < film.scrollLeft) film.scrollLeft = left;
      else if (left + 128 > film.scrollLeft + film.clientWidth) film.scrollLeft = left + 128 - film.clientWidth;
      paintFilm(); showSingle();
    }
  }
  function singleEdge() {
    const stage = $("single-stage");
    const wanted = Math.max(stage.clientWidth, stage.clientHeight) * (window.devicePixelRatio || 1);
    return wanted <= 1280 ? 1280 : wanted <= 1920 ? 1920 : 2560;
  }
  async function showSingle() {
    const photo = selected(); state.single?.abort(); state.native?.abort(); state.nativeMeta = null; state.nativeLoading = false; state.fitMeta = null; $("native-picture").hidden = true; clearPrefetch();
    if (!photo || !state.active || state.view !== "single") return;
    const controller = new AbortController(); state.single = controller;
    const current = () => state.active && state.view === "single" && selected()?.path === photo.path && !controller.signal.aborted;
    status(`Loading ${photo.name}…`);
    try {
      const edge = singleEdge();
      const meta = await loadAndShow(photo, edge, $("single-picture"), controller, current, 0);
      if (!meta || !current()) return;
      state.fitMeta = meta; positionZoom(); if (state.zoom) void showNative();
      updateSingleCaption();
      status(`${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`);
      for (const index of [state.index + 1, state.index - 1]) {
        const next = state.photos[index]; if (!next) continue;
        const ahead = new AbortController(); state.prefetch.set(next.path, ahead);
        api("/api/library/picture", { path: next.path, edge, quality: "quick", priority: 50 }, ahead.signal)
          .catch((error) => { if (!aborted(error)) console.debug("Library read-ahead:", error.message); });
      }
    } catch (error) { if (!aborted(error) && !controller.signal.aborted) removeUnreadable(photo, error); }
  }
  function positionZoom() {
    const canvas = $("single-picture"), native = $("native-picture"), stage = $("single-stage"), meta = state.nativeMeta || state.fitMeta;
    stage.classList.toggle("zoomed", state.zoom);
    if (!state.zoom || !meta) { canvas.style.cssText = ""; native.hidden = true; return; }
    const dpr = window.devicePixelRatio || 1, width = meta.source_width || meta.width * 2, height = meta.source_height || meta.height * 2;
    const center = HDRLibraryZoom.center(state.zoomX, state.zoomY, width, height, stage.clientWidth * dpr, stage.clientHeight * dpr);
    state.zoomX = center.x; state.zoomY = center.y;
    const left = stage.clientWidth / 2 - center.x * width / dpr, top = stage.clientHeight / 2 - center.y * height / dpr;
    canvas.style.cssText = `position:absolute;width:${width / dpr}px;height:${height / dpr}px;left:${left}px;top:${top}px;object-fit:fill`;
    if (state.nativeMeta) {
      const crop = state.nativeMeta;
      native.style.cssText = `width:${crop.width / dpr}px;height:${crop.height / dpr}px;left:${left + crop.crop_x / dpr}px;top:${top + crop.crop_y / dpr}px`;
      native.hidden = false;
    }
  }
  async function showNative() {
    const photo = selected(); if (!photo || !state.fitMeta || !state.zoom || !state.active || state.view !== "single") return;
    state.native?.abort(); const controller = new AbortController(); state.native = controller; state.nativeLoading = true;
    const stage = $("single-stage"), dpr = window.devicePixelRatio || 1;
    const current = () => state.active && state.zoom && state.view === "single" && selected()?.path === photo.path && !controller.signal.aborted;
    status(`Loading 100% · ${photo.name}…`);
    try {
      const meta = await api("/api/library/native", { path: photo.path, center_x: state.zoomX, center_y: state.zoomY,
        width: Math.max(64, Math.min(4096, Math.ceil(stage.clientWidth * dpr))), height: Math.max(64, Math.min(4096, Math.ceil(stage.clientHeight * dpr))), priority: 0 }, controller.signal);
      if (!current()) return;
      // Fit and native pictures share the exact same starting look.
      meta.adjustments = state.fitMeta.adjustments;
      await drawPicture(meta, $("native-picture"), controller, current);
      if (!current()) return;
      state.nativeMeta = meta; $("native-picture").dataset.picturePath = photo.path; positionZoom();
      status(`100% · ${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`);
    } catch (error) { if (!aborted(error) && current()) status(`100% unavailable · ${error.message}`); }
    finally { if (state.native === controller) state.nativeLoading = false; }
  }
  function toggleZoom(point) {
    if (state.view !== "single" || !selected()) return;
    state.zoom = !state.zoom; state.native?.abort(); state.nativeLoading = false; state.nativeMeta = null;
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
    state.zoomX = drag.centerX - dx * dpr / (meta.source_width || meta.width * 2);
    state.zoomY = drag.centerY - dy * dpr / (meta.source_height || meta.height * 2);
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
  function setView(view) {
    if (view === "single" && !selected()) return;
    state.view = view; $("library-single").hidden = view !== "single"; grid.hidden = view !== "grid";
    $("zoom-button").disabled = view !== "single";
    $("grid-view").setAttribute("aria-pressed", String(view === "grid")); $("single-view").setAttribute("aria-pressed", String(view === "single"));
    if (view === "single") { clearCells(state.cells); select(state.index, true, "preserve"); }
    else { state.single?.abort(); state.native?.abort(); clearPrefetch(); clearCells(state.filmCells); paintGrid(); }
  }
  function setReview(review) {
    if (review && !selected()) return;
    if (review) state.beforeReview = state.view;
    state.review = review; library.classList.toggle("review", review);
    if (review) setView("single"); else setView(state.beforeReview);
    postParent("review", { enabled: review });
    requestAnimationFrame(() => { if (state.view === "single") showSingle(); });
  }
  function openGrade() {
    if (!selected()) return;
    if (state.review) setReview(false);
    postParent("open-source", { path: selected().path });
  }
  async function browse(path) {
    state.scan?.abort(); state.single?.abort(); state.native?.abort(); clearPrefetch(); clearCells(state.cells); clearCells(state.filmCells);
    const controller = new AbortController(); state.scan = controller; state.path = path; state.reading = true; state.scanError = ""; state.allPhotos = []; state.photos = []; state.index = -1; state.selection.clear(); state.anchor = -1; state.hiddenFiles = 0;
    setView("grid"); grid.scrollTop = 0; $("place-title").textContent = path.split(/[\\/]/).filter(Boolean).at(-1) || path;
    $("place-title").title = path; status("Reading folder…");
    for (const element of $("folders").querySelectorAll(".library-folder-row")) element.classList.toggle("active", element.dataset.path === path);
    try {
      const result = await api("/api/library/scan", { path }, controller.signal);
      if (controller.signal.aborted) return;
      $("filter-type").replaceChildren(new Option("All file types", ""), ...[...new Set([...result.photos.map(photo => photo.type), ...(state.filters.type ? [state.filters.type] : [])])].sort().map(type => new Option(type, type)));
      $("filter-type").value = state.filters.type || "";
      state.reading = false; state.allPhotos = result.photos; state.photos = result.photos; state.index = result.photos.length ? 0 : -1;
      state.selection = new Set(state.index >= 0 ? [state.photos[0].path] : []); state.anchor = state.index;
      culling.setUndo(result.undo_available);
      status(`${result.photos.length.toLocaleString()} photos${result.unreadable_folders.length ? " · Some sub-folders could not be read" : ""}`);
      applyQuery();
      if (result.warnings?.length) status(result.warnings[0]); void readDates(controller, result.photos);
    } catch (error) { if (!aborted(error) && state.scan === controller) { state.reading = false; state.scanError = error.message; status(error.message); paintGrid(); } }
  }
  function applyQuery() {
    const lead = selected()?.path, anchor = state.photos[state.anchor]?.path;
    state.photos = HDRLibraryQuery.apply(state.allPhotos, state.sort, state.descending, state.filters);
    const visible = new Set(state.photos.map(photo => photo.path));
    state.selection = new Set([...state.selection].filter(path => visible.has(path)));
    state.index = state.photos.findIndex(photo => photo.path === lead);
    if (state.index < 0 && state.photos.length) { state.index = 0; state.selection.add(state.photos[0].path); }
    state.anchor = state.photos.findIndex(photo => photo.path === anchor);
    if (state.anchor < 0) state.anchor = state.index;
    if (!selected() && state.view === "single") setView("grid");
    updateDetails(); paintGrid(); paintFilm();
    if (state.view === "single" && selected()?.path !== lead) showSingle();
    if (!state.reading) status(`${state.photos.length.toLocaleString()} of ${state.allPhotos.length.toLocaleString()} photos${state.hiddenFiles ? ` · ${state.hiddenFiles} unreadable files hidden` : ""}`);
  }
  async function readDates(controller, photos) {
    // One small low-priority batch at a time; picture connections stay available.
    for (let start = 0; start < photos.length && !controller.signal.aborted; start += 32) {
      try {
        const result = await api("/api/library/metadata", { paths: photos.slice(start, start + 32).map(photo => photo.path) }, controller.signal);
        if (controller.signal.aborted || state.scan !== controller) return;
        const byPath = new Map(result.photos.map(photo => [photo.path, photo]));
        for (const photo of photos.slice(start, start + 32)) Object.assign(photo, byPath.get(photo.path));
        if (state.sort === "time") applyQuery();
      } catch (error) { if (!aborted(error)) console.debug("Library capture dates:", error.message); return; }
    }
  }
  function folderRow(folder, depth = 0) {
    const wrapper = document.createElement("div"), row = document.createElement("div"), children = document.createElement("div");
    row.className = "library-folder-row"; row.dataset.path = folder.path; row.style.paddingLeft = `${depth * 14}px`;
    if (folder.available === false) row.classList.add("unavailable");
    const expand = document.createElement("button"); expand.className = "expand-folder"; expand.setAttribute("aria-expanded", "false"); expand.setAttribute("aria-label", `Expand ${folder.name}`);
    const name = document.createElement("button"); name.className = "folder-name"; name.textContent = folder.name; name.title = folder.path;
    name.addEventListener("click", () => browse(folder.path));
    bindFolderMenu(row, folder.path);
    expand.addEventListener("click", async () => {
      const open = expand.getAttribute("aria-expanded") === "true";
      expand.setAttribute("aria-expanded", String(!open)); children.hidden = open;
      if (open || children.childElementCount) return;
      try { const result = await api("/api/library/tree", { path: folder.path }); children.replaceChildren(...result.children.map((item) => folderRow(item, depth + 1))); }
      catch (error) { status(error.message); }
    });
    row.append(expand, name); wrapper.append(row, children); return wrapper;
  }
  async function refreshPins() {
    const result = await api("/api/library/pins"); state.pins = result.pinned;
    $("folders").replaceChildren(...state.pins.map((pin) => folderRow(pin))); paintGrid();
  }
  const folderMenu = document.createElement("div");
  folderMenu.id = "library-folder-menu"; folderMenu.className = "window-menu-popover library-folder-menu";
  folderMenu.setAttribute("role", "menu"); folderMenu.setAttribute("aria-label", "Folder actions"); folderMenu.hidden = true;
  let menuOrigin = null;
  function closeFolderMenu(restoreFocus = false) {
    folderMenu.hidden = true;
    if (restoreFocus && menuOrigin?.isConnected) menuOrigin.focus({ preventScroll: true });
    menuOrigin = null;
  }
  function bindFolderMenu(element, path) {
    element.addEventListener("contextmenu", event => showFolderMenu(event, path));
    element.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) showFolderMenu(event, path);
    });
  }
  function showFolderMenu(event, path = "") {
    event.preventDefault(); event.stopPropagation(); closeFolderMenu();
    menuOrigin = event.target.closest("button") || $("add-folder");
    const key = value => /^[a-z]:|^\\\\/i.test(value) ? value.toLowerCase() : value;
    const pinned = state.pins.find(pin => key(pin.path) === key(path));
    const actions = path ? [{ label: pinned ? "Unpin folder" : "Pin folder", run: async () => {
      await api(pinned ? "/api/library/pins/remove" : "/api/library/pins", pinned ? { path: pinned.path } : { paths: [path] });
      await refreshPins();
      status(pinned ? "Folder unpinned. Photos stay where they are." : "Folder pinned.");
    }}] : [{ label: "Add folder…", run: openPicker }];
    folderMenu.replaceChildren(...actions.map(action => {
      const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "menuitem"); button.textContent = action.label;
      button.addEventListener("click", async () => {
        closeFolderMenu(true);
        try { await action.run(); } catch (error) { if (state.picker) $("picker-status").textContent = error.message; else status(error.message); }
      }); return button;
    }));
    ($("folder-picker").open ? $("folder-picker") : document.body).append(folderMenu);
    const bounds = menuOrigin.getBoundingClientRect();
    folderMenu.hidden = false;
    const x = event.type === "contextmenu" ? event.clientX : bounds.left;
    const y = event.type === "contextmenu" ? event.clientY : bounds.bottom;
    folderMenu.style.left = `${Math.max(0, Math.min(x, innerWidth - folderMenu.offsetWidth))}px`;
    folderMenu.style.top = `${Math.max(0, Math.min(y, innerHeight - folderMenu.offsetHeight))}px`;
    folderMenu.querySelector("button").focus({ preventScroll: true });
  }
  $("folders").addEventListener("contextmenu", event => showFolderMenu(event));
  document.addEventListener("pointerdown", event => { if (!folderMenu.contains(event.target)) closeFolderMenu(); });
  document.addEventListener("keydown", event => {
    if (folderMenu.hidden) return;
    if (["Escape", "Tab"].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); closeFolderMenu(true); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); folderMenu.querySelector("button").focus(); }
  }, true);
  window.addEventListener("blur", () => closeFolderMenu());
  window.addEventListener("resize", () => closeFolderMenu());
  async function pickerBrowse(path = "") {
    const picker = state.picker; if (!picker) return;
    if (picker.displayed) picker.scrollPositions.set(picker.displayed, $("picker-list").scrollTop);
    closeFolderMenu(); picker.controller?.abort(); clearPickerPreview();
    const controller = new AbortController(); picker.controller = controller;
    picker.current = ""; picker.selection.clear(); $("picker-pin").disabled = true;
    $("picker-status").textContent = "Reading folder…";
    try {
      const result = await api(`/api/media-browser?mode=export_directory&path=${encodeURIComponent(path)}`, undefined, controller.signal);
      if (state.picker !== picker || controller.signal.aborted) return;
      picker.current = result.current; picker.parent = result.parent; picker.entries = result.entries; picker.selection = new Set(); picker.anchor = -1;
      if (document.activeElement !== $("picker-path")) $("picker-path").value = result.current; $("picker-up").disabled = !result.parent; $("picker-status").textContent = "Pin this folder, or select folders below.";
      $("picker-places").replaceChildren(...[...result.drives, ...result.locations, ...result.pinned].map((place) => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = place.name; button.title = place.path; button.addEventListener("click", () => pickerBrowse(place.path)); return button;
      }));
      picker.displayed = result.current;
      $("picker-list").replaceChildren(...picker.entries.map((folder, index) => {
        const button = document.createElement("button"); button.type = "button"; button.title = folder.path;
        button.className = `directory-browser-entry ${folder.kind}${folder.supported ? " supported" : ""}`;
        button.dataset.path = folder.path;
        button.setAttribute("role", "option"); button.setAttribute("aria-selected", "false");
        const values = [folder.name, folder.size == null ? "--" : `${(folder.size / 1024).toFixed(0)} KB`, folder.kind_label,
          folder.date_added_ms == null ? "--" : new Date(folder.date_added_ms).toLocaleDateString()];
        ["name", "size", "kind", "date"].forEach((column, i) => {
          const span = document.createElement("span"); span.className = `directory-browser-entry-${column}`; span.textContent = values[i]; button.append(span);
        });
        button.addEventListener("click", (event) => {
          if (folder.kind !== "directory") {
            if (folder.supported) void pickerPreview(folder);
            return;
          }
          clearPickerPreview();
          if (event.shiftKey && picker.anchor >= 0) {
            if (!event.ctrlKey) picker.selection.clear();
            for (let i = Math.min(index, picker.anchor); i <= Math.max(index, picker.anchor); i++) { if (picker.entries[i].kind === "directory") picker.selection.add(i); }
          } else if (event.ctrlKey || event.metaKey) {
            picker.selection.has(index) ? picker.selection.delete(index) : picker.selection.add(index); picker.anchor = index;
          } else { picker.selection = new Set([index]); picker.anchor = index; }
          [...$("picker-list").children].forEach((element, i) => { element.setAttribute("aria-selected", String(picker.selection.has(i))); element.classList.toggle("selected", picker.selection.has(i)); });
          $("picker-status").textContent = `${picker.selection.size} folders selected`;
        });
        if (folder.kind === "directory") {
          button.addEventListener("dblclick", () => pickerBrowse(folder.path)); bindFolderMenu(button, folder.path);
        } return button;
      }));
      $("picker-list").scrollTop = picker.scrollPositions.get(result.current) || 0;
    } catch (error) { if (!aborted(error) && state.picker === picker) $("picker-status").textContent = error.message; }
    finally { if (state.picker === picker && picker.controller === controller) $("picker-pin").disabled = !picker.current; }
  }
  function clearPickerPreview() {
    const picker = state.picker;
    picker?.preview?.abort();
    $("picker-preview").onload = null; $("picker-preview").onerror = null;
    if (picker?.previewUrl) { URL.revokeObjectURL(picker.previewUrl); picker.previewUrl = null; }
    $("picker-preview").hidden = true; $("picker-preview").removeAttribute("src");
    $("picker-preview-name").textContent = "Select a photo to preview.";
    $("picker-preview-note").textContent = "Photo files stay in their folders.";
  }
  async function pickerPreview(entry) {
    clearPickerPreview();
    const picker = state.picker, controller = new AbortController(); picker.preview = controller;
    $("picker-preview-name").textContent = entry.name; $("picker-preview-note").textContent = "Loading preview…";
    const current = () => state.picker === picker && !controller.signal.aborted;
    try {
      const params = new URLSearchParams({ path: entry.path, size: "512", key: entry.thumbnail_key || "", version: "natural-aspect-v4" });
      let response;
      for (;;) {
        response = await fetch(`/api/media-browser/thumbnail?${params}`, { signal: controller.signal });
        if (response.status !== 202) break;
        await sleep(150, controller.signal);
      }
      if (!response.ok) {
        if (response.status === 409) {
          const payload = await response.json();
          if (payload.detail?.code === "interpretation_required") throw new Error("Open this photo in Grade to choose its colour interpretation.");
        }
        throw new Error("Preview unavailable.");
      }
      const blob = await response.blob(); if (!current()) return;
      picker.previewUrl = URL.createObjectURL(blob);
      const image = $("picker-preview");
      image.onload = () => { if (current()) { image.hidden = false; $("picker-preview-note").textContent = "SDR browser thumbnail"; } };
      image.onerror = () => { if (current()) $("picker-preview-note").textContent = "Preview unavailable."; };
      image.alt = `Preview of ${entry.name}`; image.src = picker.previewUrl;
    } catch (error) { if (!aborted(error) && current()) $("picker-preview-note").textContent = error.message; }
  }
  function openPicker() { state.picker = { selection: new Set(), scrollPositions: new Map() }; $("folder-picker").showModal(); pickerBrowse(state.path); }
  $("picker-pin").addEventListener("click", async () => {
    const picker = state.picker; if (!picker?.current) return;
    const paths = picker.selection.size ? [...picker.selection].map((index) => picker.entries[index].path) : [picker.current];
    $("picker-pin").disabled = true;
    try { const result = await api("/api/library/pins", { paths }); $("folder-picker").close(); await refreshPins(); await browse(paths[0]); if (result.skipped) status(`${state.photos.length.toLocaleString()} photos · ${result.skipped} already pinned folders skipped`); }
    catch (error) { $("picker-status").textContent = error.message; }
    finally { $("picker-pin").disabled = false; }
  });
  $("folder-picker").addEventListener("close", () => { closeFolderMenu(); state.picker?.controller?.abort(); clearPickerPreview(); state.picker = null; });
  $("picker-cancel").addEventListener("click", () => $("folder-picker").close());
  $("picker-go").addEventListener("click", () => pickerBrowse($("picker-path").value));
  $("picker-path").addEventListener("keydown", (event) => { if (event.key === "Enter") pickerBrowse(event.target.value); });
  $("picker-up").addEventListener("click", () => pickerBrowse(state.picker.parent));
  $("add-folder").addEventListener("click", openPicker); $("empty-add").addEventListener("click", openPicker);
  $("open-image").addEventListener("click", () => postParent("choose-source"));
  $("grid-view").addEventListener("click", () => setView("grid")); $("single-view").addEventListener("click", () => setView("single")); $("review-view").addEventListener("click", () => setReview(true));
  function collapse(side, closed) {
    library.classList.toggle(`library-${side}-closed`, closed);
    $(`collapse-${side}`).setAttribute("aria-expanded", String(!closed));
    $(`collapse-${side}`).setAttribute("aria-label", `${closed ? "Expand" : "Collapse"} ${side === "left" ? "folders" : "details"}`);
  }
  for (const side of ["left", "right"]) $(`collapse-${side}`).addEventListener("click", () => collapse(side, !library.classList.contains(`library-${side}-closed`)));
  function toggleFilters() { const hidden = !$("library-filterbar").hidden; $("library-filterbar").hidden = hidden; $("filter-button").setAttribute("aria-pressed", String(!hidden)); }
  $("filter-button").addEventListener("click", toggleFilters);
  $("library-sort").addEventListener("change", event => { state.sort = event.target.value; applyQuery(); });
  $("sort-dir").addEventListener("click", () => { state.descending = !state.descending; $("sort-dir").textContent = state.descending ? "↓" : "↑"; $("sort-dir").setAttribute("aria-label", state.descending ? "Descending. Switch to ascending" : "Ascending. Switch to descending"); applyQuery(); });
  $("raw-only").addEventListener("click", () => { state.filters.raw = !state.filters.raw; $("raw-only").setAttribute("aria-pressed", String(!!state.filters.raw)); applyQuery(); });
  for (const name of ["rating", "pick", "label", "type", "search"]) $("filter-" + name).addEventListener(name === "search" ? "input" : "change", event => { state.filters[name] = event.target.value; applyQuery(); });
  $("filter-clear").addEventListener("click", () => { state.filters = {}; for (const name of ["rating", "pick", "label", "type", "search"]) $("filter-" + name).value = ""; $("raw-only").setAttribute("aria-pressed", "false"); applyQuery(); });
  $("thumbnail-size").addEventListener("input", (event) => { state.size = Number(event.target.value); paintGrid(); });
  let gridFrame = 0, filmFrame = 0;
  grid.addEventListener("scroll", () => { if (!gridFrame) gridFrame = requestAnimationFrame(() => { gridFrame = 0; paintGrid(); }); });
  film.addEventListener("scroll", () => { if (!filmFrame) filmFrame = requestAnimationFrame(() => { filmFrame = 0; paintFilm(); }); });
  let resizeTimer;
  new ResizeObserver(() => { paintGrid(); paintFilm(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.view === "single" && state.active) showSingle(); }, 150); }).observe($("single-stage"));
  new ResizeObserver(() => { paintGrid(); paintFilm(); }).observe(grid);
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "hdr-library-host") return;
    if (event.data.action === "active") setActive(event.data.enabled);
    if (event.data.action === "add-folder") openPicker();
    if (event.data.action === "restore") void restoreState(event.data.state).catch(error => status(error.message));
  });
  window.addEventListener("keydown", (event) => {
    if ($("folder-picker").open || event.target.matches("input,textarea,select,[contenteditable]")) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === "f") { event.preventDefault(); toggleFilters(); }
      if (key === "a") { event.preventDefault(); state.selection = new Set(state.photos.map(photo => photo.path)); updateDetails(); paintGrid(); paintFilm(); }
      if (key === "z") { event.preventDefault(); void culling.undo(); }
      return;
    }
    if (event.altKey) return;
    if (culling.shortcut(key)) { event.preventDefault(); return; }
    if (key === "t") { event.preventDefault(); collapse("right", false); $("library-tag-input")?.focus(); return; }
    const steps = { arrowright: 1, arrowleft: -1, arrowdown: state.view === "grid" ? state.layout?.columns || 1 : 1, arrowup: state.view === "grid" ? -(state.layout?.columns || 1) : -1 };
    if (key in steps) { event.preventDefault(); select(state.index + steps[key], true, event.shiftKey ? "range" : "single"); }
    else if (key === "enter") { event.preventDefault(); openGrade(); }
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
    return { path: state.path, selected: selected()?.path, selection: [...state.selection], anchor: state.photos[state.anchor]?.path,
      sort: state.sort, descending: state.descending, filters: state.filters, size: state.size, view: state.view,
      hdr: state.hdr, zoom: state.zoom, zoomX: state.zoomX, zoomY: state.zoomY,
      gridScroll: grid.scrollTop, filmScroll: film.scrollLeft, filterOpen: !$("library-filterbar").hidden,
      leftClosed: library.classList.contains("library-left-closed"), rightClosed: library.classList.contains("library-right-closed") };
  }
  async function restoreState(saved) {
    if (!saved) return;
    state.sort = saved.sort || "time"; state.descending = !!saved.descending; state.filters = saved.filters || {};
    state.size = saved.size || 190; state.hdr = !!saved.hdr; state.zoom = !!saved.zoom;
    state.zoomX = saved.zoomX ?? .5; state.zoomY = saved.zoomY ?? .5;
    $("library-sort").value = state.sort; $("thumbnail-size").value = state.size;
    $("sort-dir").textContent = state.descending ? "↓" : "↑";
    $("sort-dir").setAttribute("aria-label", state.descending ? "Descending. Switch to ascending" : "Ascending. Switch to descending");
    $("hdr-button").setAttribute("aria-pressed", String(state.hdr)); $("zoom-button").setAttribute("aria-pressed", String(state.zoom));
    $("raw-only").setAttribute("aria-pressed", String(!!state.filters.raw));
    for (const name of ["rating", "pick", "label", "type", "search"]) $("filter-" + name).value = state.filters[name] || "";
    $("library-filterbar").hidden = !saved.filterOpen; $("filter-button").setAttribute("aria-pressed", String(!!saved.filterOpen));
    collapse("left", !!saved.leftClosed); collapse("right", !!saved.rightClosed);
    await refreshPins();
    if (saved.path) await browse(saved.path);
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
    $("popout-library").textContent = "Dock Library";
    $("popout-library").title = "Return Library to the main window";
    libraryDesktop?.onLibraryWindowChanged(message => {
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
  window.HDRLibrary = Object.freeze({ browse, getSnapshot: () => ({ path: state.path, count: state.photos.length,
    selected: selected()?.path, selection: [...state.selection], marks: selected()?.marks, view: state.view, review: state.review, visible: state.cells.size,
    filmVisible: state.filmCells.size, active: state.active, hdr: state.hdr, zoom: state.zoom, zoomCenter: [state.zoomX, state.zoomY], nativeLoading: state.nativeLoading, native: state.nativeMeta ? { width: state.nativeMeta.source_width, height: state.nativeMeta.source_height, x: state.nativeMeta.crop_x, y: state.nativeMeta.crop_y } : null, reading: state.reading, total: state.allPhotos.length, sort: state.sort, descending: state.descending, paths: state.photos.map(photo => photo.path) }) });
  (async () => {
    try {
      const options = await api("/api/library/options"); state.timing = options.timing;
      const saved = libraryDesktop ? (await libraryDesktop.getLibraryWindow()).state : null;
      if (saved) await restoreState(saved);
      else { await refreshPins(); const first = state.pins.find((pin) => pin.available); if (first) await browse(first.path); }
      await libraryDesktop?.rendererReady();
      postParent("ready");
    } catch (error) { status(error.message); }
  })();
})();
