/* This page owns its state. Folder and picture work are backend commands. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const library = $("library"), grid = $("library-grid"), space = $("grid-space"), film = $("filmstrip");
  const state = { photos: [], index: -1, path: "", view: "grid", review: false, beforeReview: "grid",
    pins: [], cells: new Map(), filmCells: new Map(), prefetch: new Map(), size: 190,
    scan: null, single: null, active: true, timing: false, picker: null, hiddenFiles: 0 };
  const postParent = (action, detail = {}) => parent.postMessage({ type: "hdr-library", action, ...detail }, location.origin);
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
      const { response, result } = await (route === "/api/library/picture"
        ? pictureRequests.submit(request, signal, body.priority) : request());
      if (response.status === 202) { await sleep(150, signal); continue; }
      if (!response.ok) {
        const error = new Error(typeof result.detail === "string" ? result.detail : "Library request failed.");
        error.status = response.status; throw error;
      }
      return result;
    }
  }
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
      state.scan?.abort();
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
    await HDRLibraryPictures.show(meta, canvas, controller.signal, isCurrent);
    if (!isCurrent()) return;
    diagnostics(photo, meta, performance.now() - started);
    if (slow && meta.route.endsWith("-placeholder")) {
      meta = await api("/api/library/picture", { path: photo.path, edge, quality: "quick", priority: priority + 1 }, controller.signal);
      if (!isCurrent()) return;
      await HDRLibraryPictures.show(meta, canvas, controller.signal, isCurrent);
      if (!isCurrent()) return;
    }
    canvas.dataset.pictureKey = meta.key;
    canvas.dataset.picturePath = photo.path;
    return meta;
  }
  function removeUnreadable(photo, error) {
    if (error.status !== 400) { status(error.message); return; }
    const currentPath = selected()?.path;
    state.photos = state.photos.filter((item) => item.path !== photo.path);
    state.hiddenFiles += 1;
    state.index = Math.max(0, state.photos.findIndex((item) => item.path === currentPath));
    if (!state.photos.length) state.index = -1;
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
    element.addEventListener("click", () => select(state.photos.findIndex((item) => item.path === photo.path)));
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
      const active = index === state.index;
      cell.element.classList.toggle("active", active); cell.element.setAttribute("aria-selected", String(active));
    }
  }
  function paintGrid() {
    if (!state.active || state.view !== "grid") return;
    const layout = HDRLibraryLayout.gridLayout(state.photos.length, grid.clientWidth, grid.clientHeight, grid.scrollTop, state.size);
    state.layout = layout; space.style.height = `${layout.totalHeight}px`;
    $("library-empty").hidden = state.photos.length > 0;
    $("empty-add").hidden = state.pins.length > 0;
    if (!state.photos.length) $("empty-message").textContent = state.path ? "No readable photos in this folder." : "Add a folder to start browsing.";
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
    const photo = selected(); const root = $("details"); root.replaceChildren();
    if (!photo) { root.textContent = "Select a photo."; return; }
    const title = document.createElement("strong"); title.textContent = photo.name; root.append(title);
    const list = document.createElement("dl");
    for (const [label, value] of [["File type", photo.type], ["Size", `${(photo.bytes / 1024 / 1024).toFixed(1)} MB`], ["Location", photo.path]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; list.append(dt, dd);
    }
    root.append(list);
  }
  function select(index, scroll = false) {
    if (!state.photos.length) return;
    state.index = Math.max(0, Math.min(state.photos.length - 1, index)); updateDetails();
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
    const photo = selected(); state.single?.abort(); clearPrefetch();
    if (!photo || !state.active || state.view !== "single") return;
    const controller = new AbortController(); state.single = controller;
    const current = () => state.active && state.view === "single" && selected()?.path === photo.path && !controller.signal.aborted;
    status(`Loading ${photo.name}…`);
    try {
      const edge = singleEdge();
      const meta = await loadAndShow(photo, edge, $("single-picture"), controller, current, 0);
      if (!meta || !current()) return;
      $("single-caption").textContent = photo.name;
      status(`${state.index + 1} of ${state.photos.length.toLocaleString()} · ${photo.name}`);
      for (const index of [state.index + 1, state.index - 1]) {
        const next = state.photos[index]; if (!next) continue;
        const ahead = new AbortController(); state.prefetch.set(next.path, ahead);
        api("/api/library/picture", { path: next.path, edge, quality: "quick", priority: 50 }, ahead.signal)
          .catch((error) => { if (!aborted(error)) console.debug("Library read-ahead:", error.message); });
      }
    } catch (error) { if (!aborted(error) && !controller.signal.aborted) removeUnreadable(photo, error); }
  }
  function setView(view) {
    if (view === "single" && !selected()) return;
    state.view = view; $("library-single").hidden = view !== "single"; grid.hidden = view !== "grid";
    $("grid-view").setAttribute("aria-pressed", String(view === "grid")); $("single-view").setAttribute("aria-pressed", String(view === "single"));
    if (view === "single") { clearCells(state.cells); select(state.index, true); }
    else { state.single?.abort(); clearPrefetch(); clearCells(state.filmCells); paintGrid(); }
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
    state.scan?.abort(); state.single?.abort(); clearPrefetch(); clearCells(state.cells); clearCells(state.filmCells);
    const controller = new AbortController(); state.scan = controller; state.path = path; state.photos = []; state.index = -1; state.hiddenFiles = 0;
    setView("grid"); grid.scrollTop = 0; $("place-title").textContent = path.split(/[\\/]/).filter(Boolean).at(-1) || path;
    $("place-title").title = path; status("Reading folder…");
    for (const element of $("folders").querySelectorAll(".library-folder-row")) element.classList.toggle("active", element.dataset.path === path);
    try {
      const result = await api("/api/library/scan", { path }, controller.signal);
      if (controller.signal.aborted) return;
      state.photos = result.photos; state.index = result.photos.length ? 0 : -1;
      status(`${result.photos.length.toLocaleString()} photos${result.unreadable_folders.length ? " · Some sub-folders could not be read" : ""}`);
      updateDetails(); paintGrid();
    } catch (error) { if (!aborted(error)) status(error.message); }
  }
  function folderRow(folder, depth = 0) {
    const wrapper = document.createElement("div"), row = document.createElement("div"), children = document.createElement("div");
    row.className = "library-folder-row"; row.dataset.path = folder.path; row.style.paddingLeft = `${depth * 14}px`;
    if (folder.available === false) row.classList.add("unavailable");
    const expand = document.createElement("button"); expand.className = "expand-folder"; expand.setAttribute("aria-expanded", "false"); expand.setAttribute("aria-label", `Expand ${folder.name}`);
    const name = document.createElement("button"); name.className = "folder-name"; name.textContent = folder.name; name.title = folder.path;
    name.addEventListener("click", () => browse(folder.path));
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
  async function pickerBrowse(path = "") {
    const picker = state.picker; if (!picker) return;
    picker.controller?.abort(); clearPickerPreview();
    const controller = new AbortController(); picker.controller = controller;
    picker.current = ""; picker.selection.clear(); $("picker-pin").disabled = true;
    $("picker-status").textContent = "Reading folder…";
    try {
      const result = await api(`/api/media-browser?mode=export_directory&path=${encodeURIComponent(path)}`, undefined, controller.signal);
      if (state.picker !== picker || controller.signal.aborted) return;
      picker.current = result.current; picker.parent = result.parent; picker.entries = result.entries; picker.selection = new Set(); picker.anchor = -1;
      $("picker-path").value = result.current; $("picker-up").disabled = !result.parent; $("picker-status").textContent = "Pin this folder, or select folders below.";
      $("picker-places").replaceChildren(...[...result.drives, ...result.locations, ...result.pinned].map((place) => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = place.name; button.title = place.path; button.addEventListener("click", () => pickerBrowse(place.path)); return button;
      }));
      $("picker-list").scrollTop = 0;
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
        if (folder.kind === "directory") button.addEventListener("dblclick", () => pickerBrowse(folder.path)); return button;
      }));
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
  function openPicker() { state.picker = { selection: new Set() }; $("folder-picker").showModal(); pickerBrowse(state.path); }
  $("picker-pin").addEventListener("click", async () => {
    const picker = state.picker; if (!picker?.current) return;
    const paths = picker.selection.size ? [...picker.selection].map((index) => picker.entries[index].path) : [picker.current];
    $("picker-pin").disabled = true;
    try { const result = await api("/api/library/pins", { paths }); $("folder-picker").close(); await refreshPins(); await browse(paths[0]); if (result.skipped) status(`${state.photos.length.toLocaleString()} photos · ${result.skipped} already pinned folders skipped`); }
    catch (error) { $("picker-status").textContent = error.message; }
    finally { $("picker-pin").disabled = false; }
  });
  $("folder-picker").addEventListener("close", () => { state.picker?.controller?.abort(); clearPickerPreview(); state.picker = null; });
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
  });
  window.addEventListener("keydown", (event) => {
    if ($("folder-picker").open || event.target.matches("input,textarea,select,[contenteditable]")) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const steps = { arrowright: 1, arrowleft: -1, arrowdown: state.view === "grid" ? state.layout?.columns || 1 : 1, arrowup: state.view === "grid" ? -(state.layout?.columns || 1) : -1 };
    if (key in steps) { event.preventDefault(); select(state.index + steps[key], true); }
    else if (key === "enter") { event.preventDefault(); openGrade(); }
    else if (key === " ") { event.preventDefault(); setView(state.view === "grid" ? "single" : "grid"); }
    else if (key === "g") setView("grid");
    else if (key === "f") setReview(!state.review);
    else if (key === "escape") { if (state.review) setReview(false); else setView("grid"); }
    else if (key === "tab") { event.preventDefault(); const closed = !(library.classList.contains("library-left-closed") && library.classList.contains("library-right-closed")); collapse("left", closed); collapse("right", closed); }
    else if (key === "i") collapse("right", !library.classList.contains("library-right-closed"));
  });
  // Read-only status for the focused interaction driver; no test-only behavior.
  window.HDRLibrary = Object.freeze({ browse, getSnapshot: () => ({ path: state.path, count: state.photos.length,
    selected: selected()?.path, view: state.view, review: state.review, visible: state.cells.size,
    filmVisible: state.filmCells.size, active: state.active }) });
  (async () => {
    try {
      const options = await api("/api/library/options"); state.timing = options.timing;
      await refreshPins(); const first = state.pins.find((pin) => pin.available);
      if (first) await browse(first.path);
      postParent("ready");
    } catch (error) { status(error.message); }
  })();
})();
