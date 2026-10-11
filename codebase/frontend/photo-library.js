/* This page owns its state. Folder and picture work are backend commands. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const library = $("library"), grid = $("library-grid"), space = $("grid-space"), film = $("filmstrip");
  const state = { photos: [], allPhotos: [], reading: false, hdr: false, zoom: false, zoomX: .5, zoomY: .5, native: null, nativeMeta: null, nativeLoading: false, fitMeta: null, displayEpoch: 0, scanError: "", sort: "time", descending: false, filters: {}, index: -1, path: "", view: "grid", review: false, beforeReview: "grid",
    pins: [], cells: new Map(), filmCells: new Map(), prefetch: new Map(), size: 190,
    selection: new Set(), anchor: -1, scan: null, single: null, active: true, timing: false, picker: null, hiddenFiles: 0,
    folderSelection: new Set(), folderAnchor: "", collection: null, allFacts: false, labelNames: {}, indexing: null };
  const standalone = parent === window, libraryDesktop = standalone ? window.hdrFinisherDesktop : null;
  const postParent = (action, detail = {}) => {
    if (!standalone) parent.postMessage({ type: "hdr-library", action, ...detail }, location.origin);
    else if (libraryDesktop) {
      const task = action === "open-source" ? libraryDesktop.openSourceInMain(detail.path, detail.itemKey)
        : action === "choose-source" ? libraryDesktop.chooseSourceInMain()
        : action === "review" ? libraryDesktop.getWindowState().then(current => {
          if (current.fullscreen !== detail.enabled) return libraryDesktop.performWindowAction("fullscreen");
        }) : null;
      task?.catch(error => status(error.message));
    }
  };
  const status = (message) => { $("library-status").textContent = message; };
  const confirmChange = (message, undoAvailable) => { status(message); $("library-undo").hidden = !undoAvailable; };
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
  const { showMenu, closeMenu: closeFolderMenu, make } = HDRLibraryDialogs;
  const sameName = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const belongs = (photo, place) => (place.kind === "album" ? photo.albums || [] : photo.marks?.tags || []).some(name => sameName(name, place.name));
  const culling = HDRLibraryCulling.create({ confirm: confirmChange, photos: () => state.allPhotos, selection: () => state.selection, api, status,
    labelName: label => state.labelNames[label] || "",
    updated: result => {
      if(result.copies_changed) { void reopen(); return; }
      const place = state.collection;
      if (place) {
        // An album or tag view is always current: photos join and leave with the command.
        const shown = new Set(state.allPhotos.map(photo => photo.path));
        if (result.photos.some(row => !shown.has(row.path) && belongs(row, place))) { void reopen(); return; }
        state.allPhotos = state.allPhotos.filter(photo => belongs(photo, place));
      }
      applyQuery(); updateSingleCaption(); void albums.refresh().catch(() => {});
    } });
  const albums = HDRLibraryAlbums.create({ root: $("albums"), addButton: $("add-album"), api, status, run: culling.run,
    selection: () => [...state.selection], open: name => browseCollection("album", name),
    closed: () => { const back = state.lastFolder || state.pins.find(pin => pin.available)?.path; if (back) void browse(back); else void reopen(); } });
  const tagWindow = HDRLibraryTags.create({ api, run: culling.run, undo: culling.undo, undoAvailable: culling.undoAvailable,
    showTag: tag => browseCollection("tag", tag), indexing: () => state.indexing?.state === "indexing",
    labelNames: () => state.labelNames,
    setLabelNames: async names => { state.labelNames = (await api("/api/library/preferences", { label_names: names })).label_names; updateDetails(); paintGrid(); paintFilm(); } });
  const reopen = () => state.collection ? browseCollection(state.collection.kind, state.collection.name) : browse(state.path);
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
    photo.pictureCurrent = !!meta.kept;
    canvas.closest(".library-cell")?.querySelector(".library-edited")?.setAttribute("title", meta.kept ? "Saved grade" : "This photo has a saved grade, but its Library picture is not current. Open it in Grade and save to update the picture.");
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
    element.addEventListener("contextmenu", event => photoMenu(event, photo));
    // Thumbnails can be dragged onto an album in the left panel.
    element.draggable = true;
    element.addEventListener("dragstart", event => {
      if (!state.selection.has(photo.path)) select(state.photos.findIndex(item => item.path === photo.path));
      event.dataTransfer.setData(HDRLibraryAlbums.DRAG, String(state.selection.size)); event.dataTransfer.effectAllowed = "copy";
    });
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
      if (cell && (cell.photo.bytes !== photo.bytes || cell.photo.mtime_ns !== photo.mtime_ns || cell.photo.grade_identity !== photo.grade_identity)) { cell.controller.abort(); cell.element.remove(); map.delete(photo.path); cell = null; }
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
    if (!state.photos.length) $("empty-message").textContent = state.reading ? "Reading folder…" : state.scanError || (state.allPhotos.length ? "No photos match these filters."
      : state.collection ? (state.collection.kind === "album" ? "This album is empty. Right-click photos, or drag them here, to add them." : "No connected photos carry this tag.")
      : state.path ? "No readable photos in this folder." : "Add a folder to start browsing.");
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
    const one = state.selection.size === 1 && state.selection.has(photo.path);
    root.append(make("strong", "", one ? fileName(photo) : `${state.selection.size.toLocaleString()} photos selected`));
    if (one) {
      if (photo.copy_id) root.append(make("p", "library-details-sub", `Virtual copy \u201c${photo.copy_name}\u201d. Its own grade, marks and tags. No second image file.`));
      root.append(make("p", "library-details-sub", HDRLibraryFacts.headline(photo)));
      root.append(make("p", "library-details-sub", `${photo.edited ? "Edited" : "Not edited"}${photo.copy_count ? ` \u00b7 ${plural(photo.copy_count, "virtual copy", "virtual copies")}` : ""}`));
      if (photo.albums?.length) root.append(make("p", "library-details-sub", `In ${photo.albums.join(", ")}`));
    }
    culling.details(root);
    const manage = make("button", "text-button", "Manage tags and labels…"); manage.type = "button"; manage.id = "manage-tags";
    manage.addEventListener("click", () => void tagWindow.open()); root.append(manage);
    if (one) {
      const facts = make("section", "library-facts"); facts.id = "library-facts";
      const list = rows => { const dl = document.createElement("dl"); for (const [label, value] of rows) dl.append(make("dt", "", label), make("dd", "", value)); return dl; };
      if (state.allFacts) for (const [kicker, rows] of HDRLibraryFacts.groups(photo)) facts.append(make("p", "library-kicker", kicker), list(rows));
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
  async function createCopy(photo) {
    const answer = await HDRLibraryDialogs.ask({ title: `Create Virtual Copy of ${fileName(photo)}`,
      message: "A virtual copy is another grade of the same photo. No second image file is made. The copy is kept in the settings file beside the photo, so it travels with it.",
      fields: [
        { name: "start", label: "Start from", options: [{ value: "current", label: "The current grade" }, { value: "clean", label: "A clean start" }], value: "current" },
        { name: "name", label: "Name (optional)", optional: true, placeholder: "For example Black and white" }], confirm: "Create copy" });
    if (!answer) return;
    const result = await api("/api/library/virtual-copies", { path: photo.path, ...answer });
    culling.setUndo(result.undo_available); await refreshCopies();
    const made = state.photos.findIndex(item => item.path === result.path);
    if (made >= 0) select(made, true);
    confirmChange("Virtual copy created beside the original. Ctrl+Z undoes it.", true);
  }
  // Removing a virtual copy is the smaller action: one grade goes, the photo stays.
  async function removeCopy(photo) {
    if (!await HDRLibraryDialogs.ask({ title: `Remove Virtual Copy “${photo.copy_name}”?`,
      message: `This removes one grade of ${fileName(photo)}, with its own marks and tags. The photo itself stays, with its other grades. Nothing is deleted from disk.`,
      confirm: "Remove copy", danger: true })) return;
    const result = await api("/api/library/virtual-copies", { path: photo.path, action: "remove" });
    culling.setUndo(result.undo_available); await refreshCopies();
    confirmChange("Virtual copy removed. The photo stays. Ctrl+Z brings it back.", true);
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
  async function photoMenu(event, photo) {
    event.preventDefault();
    const index = state.photos.findIndex(item => item.path === photo.path);
    if (!state.selection.has(photo.path)) select(index); else { state.index = index; updateDetails(); }
    const paths = [...state.selection], one = paths.length === 1, grades = [];
    try {
      const { counts } = await api("/api/library/grade-reverts", { paths });
      for (const [target, revert] of Object.entries(REVERTS)) if (counts[target]) grades.push({ label: revert.label, run: () => revertGrades(paths, target, counts[target]) });
    } catch (error) { status(error.message); }
    if (one) grades.push({ label: "Create virtual copy…", run: () => createCopy(photo) });
    showMenu(event, [{ header: one ? photo.name : `${paths.length.toLocaleString()} photos` },
      ...(one ? [{ label: "Open in Grade", key: "Enter", run: openGrade }] : []),
      ...(grades.length ? [...(one ? [{ separator: true }] : []), ...grades] : []),
      { separator: true }, ...albums.menuActions(paths),
      ...(one && photo.copy_id ? [{ separator: true }, { label: "Remove virtual copy…", key: "Del", danger: true, run: () => removeCopy(photo) }] : [])],
      { label: "Photo actions", onError: error => status(error.message) });
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
    if (photo.edited) { state.native?.abort(); state.nativeMeta = null; state.nativeLoading = false; $("native-picture").hidden = true; positionZoom(); status("Saved Library picture enlarged. Check detail in Grade."); return; }
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
    postParent("open-source", { path: selected().source_path || selected().path, itemKey: selected().path });
  }
  const browse = path => openPlace({ path });
  const browseCollection = (kind, name) => openPlace({ kind, name });
  async function openPlace(place) {
    const path = place.path || "";
    state.scan?.abort(); state.single?.abort(); state.native?.abort(); clearPrefetch(); clearCells(state.cells); clearCells(state.filmCells);
    state.collection = place.kind ? { kind: place.kind, name: place.name } : null; albums.setActive(place.kind === "album" ? place.name : "");
    if (path) state.lastFolder = path;  // Where a deleted album's view returns to.
    const controller = new AbortController(); state.scan = controller; state.path = path; state.reading = true; state.scanError = ""; state.allPhotos = []; state.photos = []; state.index = -1; state.selection.clear(); state.anchor = -1; state.hiddenFiles = 0;
    setView("grid"); grid.scrollTop = 0;
    $("check-photos").disabled = !path;
    $("place-title").textContent = place.kind === "album" ? place.name : place.kind ? `Tag · ${place.name}` : path.split(/[\\/]/).filter(Boolean).at(-1) || path;
    $("place-title").title = place.kind === "album" ? "Album. Photos stay where they are." : place.kind ? "Every connected photo that carries this tag" : path; status(place.kind ? "Reading…" : "Reading folder…");
    for (const element of $("folders").querySelectorAll(".library-folder-row")) element.classList.toggle("active", !place.kind && element.dataset.path === path);
    try {
      const result = place.kind ? await api("/api/library/collection", { kind: place.kind, name: place.name }, controller.signal) : await api("/api/library/scan", { path }, controller.signal);
      if (controller.signal.aborted) return;
      $("filter-type").replaceChildren(new Option("All file types", ""), ...[...new Set([...result.photos.map(photo => photo.type), ...(state.filters.type ? [state.filters.type] : [])])].sort().map(type => new Option(type, type)));
      $("filter-type").value = state.filters.type || "";
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
    row.append(expand, name); wrapper.append(row, children); return wrapper;
  }
  async function refreshPins() {
    const result = await api("/api/library/pins"); state.pins = result.pinned;
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
  $("check-photos").addEventListener("click", () => { if (state.path) void requestCheck([state.path]).catch(error => status(error.message)); });
  function bindFolderMenu(element, path) {
    element.addEventListener("contextmenu", event => showFolderMenu(event, path));
    element.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) showFolderMenu(event, path);
    });
  }
  function showFolderMenu(event, path = "") {
    const key = value => /^[a-z]:|^\\\\/i.test(value) ? value.toLowerCase() : value;
    if (path && !state.folderSelection.has(path)) { state.folderSelection = new Set([path]); paintFolderSelection(); }
    const pinned = state.pins.find(pin => key(pin.path) === key(path));
    const actions = path ? [{ label: pinned ? "Unpin folder" : "Pin folder", run: async () => {
      await api(pinned ? "/api/library/pins/remove" : "/api/library/pins", pinned ? { path: pinned.path } : { paths: [path] });
      await refreshPins();
      status(pinned ? "Folder unpinned. Photos stay where they are." : "Folder pinned.");
    }}] : [{ label: "Add folder…", run: openPicker }];
    if (path && !state.picker) actions.unshift({ label: "Check for new photos", run: () => requestCheck([...state.folderSelection]) }, { separator: true });
    showMenu(event, actions, { label: "Folder actions", anchor: event.target.closest("button") || $("add-folder"),
      onError: error => { if (state.picker) $("picker-status").textContent = error.message; else status(error.message); } });
  }
  $("folders").addEventListener("contextmenu", event => showFolderMenu(event));
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
  $("picture-settings").addEventListener("click", async () => {
    try {
      const prefs = await api("/api/library/picture-settings");
      const answer = await HDRLibraryDialogs.ask({ title: "Library pictures", message: `${(prefs.used_bytes / 1024**3).toFixed(2)} GB in use. Resolution applies to pictures made after the next save.`, fields: [
        { name: "limit", label: "Storage limit (GB)", type: "number", min: 1, step: 1, value: String(Math.round(prefs.limit_bytes / 1024**3)) },
        { name: "edge", label: "Edited-picture resolution", options: ["512", "1024", "1920"], value: String(prefs.edited_edge) }], confirm: "Save" });
      if (answer) { await api("/api/library/picture-settings", { limit_bytes: Math.round(Number(answer.limit) * 1024**3), edited_edge: Number(answer.edge) }); status("Library picture settings saved."); }
    } catch (error) { status(error.message); }
  });
  $("filter-button").addEventListener("click", toggleFilters);
  $("library-sort").addEventListener("change", event => { state.sort = event.target.value; applyQuery(); });
  $("sort-dir").addEventListener("click", () => { state.descending = !state.descending; $("sort-dir").textContent = state.descending ? "↓" : "↑"; $("sort-dir").setAttribute("aria-label", state.descending ? "Descending. Switch to ascending" : "Ascending. Switch to descending"); applyQuery(); });
  $("raw-only").addEventListener("click", () => { state.filters.raw = !state.filters.raw; $("raw-only").setAttribute("aria-pressed", String(!!state.filters.raw)); applyQuery(); });
  for (const name of ["rating", "pick", "label", "type", "search"]) $("filter-" + name).addEventListener(name === "search" ? "input" : "change", event => { state.filters[name] = event.target.value; applyQuery(); });
  $("filter-clear").addEventListener("click", () => { state.filters = {}; for (const name of ["rating", "pick", "label", "type", "search"]) $("filter-" + name).value = ""; $("raw-only").setAttribute("aria-pressed", "false"); ruleFilters.render(); applyQuery(); });
  const ruleFilters = HDRLibraryFilters.create({ bar: $("filter-rules"), addButton: $("filter-add"), match: $("filter-match"), photos: () => state.allPhotos,
    filters: () => state.filters, changed: () => applyQuery(), reading: () => state.allPhotos.some(photo => !photo.indexed) });
  // One health snapshot owns Activity, indexing and live writer state.
  function showIndexing(next) {
    const before = state.indexing?.passes; state.indexing = next;
    if (before !== next.passes) void albums.refresh().catch(error => status(error.message));
  }
  const activity = HDRLibraryActivity.create({ button: $("index-status"), panel: $("library-activity"), api, status,
    onHealth: next => { showIndexing(next.index); void refreshCheckedFolders(next.index.checks); } });
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
      if (changed) { void albums.refresh().catch(error => status(error.message)); void tagWindow.refresh().catch(error => status(error.message)); }
      if (changed && (collection || events.some(event => event.path === place || place.startsWith(event.path + "\\") || event.path.startsWith(place + "\\")))) {
        const result = collection ? await api("/api/library/collection", { ...collection, cached: true }, controller?.signal)
          : await api("/api/library/view", { path: place }, controller?.signal);
        if (state.scan !== controller) return;
        if (result.photos) {
          const leadPhoto = selected(), lead = leadPhoto?.path, oldIndex = state.index;
          const top = grid.scrollTop, left = film.scrollLeft;
          state.allPhotos = result.photos;
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
        const paths = state.allPhotos.filter(photo => photo.storage === "database" || photo.edited).map(photo => photo.path);
        const result = await api("/api/library/settings-status", { paths });
        const byPath = new Map(result.photos.map(photo => [photo.path, photo]));
        let changed = false;
        for (const photo of state.allPhotos) {
          const row = byPath.get(photo.path);
          if (row && (row.grade_identity !== photo.grade_identity || row.pictureCurrent !== photo.pictureCurrent)) {
            Object.assign(photo, { edited: row.edited, grade_identity: row.grade_identity, pictureCurrent: row.pictureCurrent });
            for (const map of [state.cells, state.filmCells]) { const cell = map.get(photo.path); if (cell) { cell.controller.abort(); cell.element.remove(); map.delete(photo.path); } }
            changed = true;
          }
          if (row && JSON.stringify(row.marks) === JSON.stringify(photo.marks) && JSON.stringify(row.albums) === JSON.stringify(photo.albums)
              && (row.storage !== photo.storage || row.write_reason !== photo.write_reason)) {
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
    if (event.defaultPrevented || ((!event.ctrlKey && !event.metaKey) && (event.target.closest(".library-activity") || event.target.matches("#index-status,#library-undo")))) return;
    if (document.querySelector("dialog[open]") || event.target.matches("input,textarea,select,[contenteditable]") || event.target.closest(".library-filter-panel,.library-folder-menu")) return;
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
    else if (key === "delete") { if (state.selection.size === 1 && selected()?.copy_id) { event.preventDefault(); removeCopy(selected()).catch(error => status(error.message)); } }
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
  window.HDRLibrary = Object.freeze({ browse, getSnapshot: () => ({ path: state.path, collection: state.collection, albums: albums.names(), rules: (state.filters.rules || []).length, indexing: state.indexing, facts: selected() ? { camera: selected().camera, lens: selected().lens, iso: selected().iso, indexed: !!selected().indexed, albums: selected().albums || [] } : null, count: state.photos.length,
    selected: selected()?.path, selection: [...state.selection], marks: selected()?.marks, view: state.view, review: state.review, visible: state.cells.size,
    filmVisible: state.filmCells.size, active: state.active, hdr: state.hdr, zoom: state.zoom, zoomCenter: [state.zoomX, state.zoomY], nativeLoading: state.nativeLoading, native: state.nativeMeta ? { width: state.nativeMeta.source_width, height: state.nativeMeta.source_height, x: state.nativeMeta.crop_x, y: state.nativeMeta.crop_y } : null, reading: state.reading, total: state.allPhotos.length, sort: state.sort, descending: state.descending, paths: state.photos.map(photo => photo.path) }) });
  (async () => {
    try {
      const options = await api("/api/library/options"); state.timing = options.timing;
      state.labelNames = (await api("/api/library/preferences")).label_names;
      void albums.refresh().catch(error => status(error.message)); void pollIndexing();
      const saved = libraryDesktop ? (await libraryDesktop.getLibraryWindow()).state : null;
      if (saved) await restoreState(saved);
      else { await refreshPins(); const first = state.pins.find((pin) => pin.available); if (first) await browse(first.path); }
      await libraryDesktop?.rendererReady();
      postParent("ready");
    } catch (error) { status(error.message); }
  })();
})();
