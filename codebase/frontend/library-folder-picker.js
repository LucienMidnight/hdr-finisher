/* Temporary media-browser pictures only; this window never prepares Library pictures. */
(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const VIEW_KEY = "hdr-finisher:folder-picker-view";
  function create({ api, sleep, bindFolderMenu, closeFolderMenu }) {
    const list = $("picker-list"), pane = $("picker-preview-pane");
    const requests = HDRLibraryRequestQueue.create(2);
    let view = "grid", observer = null, previewObserver = null, preview = null, stopped = false;
    let focused = -1;
    const tiles = new Map(), previewPictures = new Map();
    try { if (localStorage.getItem(VIEW_KEY) === "list") view = "list"; } catch {}
    const session = { selection: new Set(), scrollPositions: new Map(), current: "", entries: [], anchor: -1,
      browse, setView, clearPreview, stop };
    function release(item) {
      item.controller?.abort(); item.controller = null;
      if (item.url) URL.revokeObjectURL(item.url);
      item.url = null;
      item.image?.removeAttribute("src");
    }
    async function thumbnail(entry, size, signal, embeddedOnly = false, priority = 10) {
      const params = new URLSearchParams({ path: entry.path, size: String(size), embedded_only: String(embeddedOnly) });
      for (;;) {
        const response = await requests.submit(() => fetch(`/api/media-browser/thumbnail?${params}`, { signal }), signal, priority);
        if (response.status === 202) { await sleep(150, signal); continue; }
        if (!response.ok) {
          if (response.status === 409) {
            const payload = await response.json();
            if (payload.detail?.code === "interpretation_required") throw new Error("Open this photo in Grade to choose its colour interpretation.");
          }
          throw new Error("Preview unavailable.");
        }
        return response.blob();
      }
    }
    function clearTiles() {
      observer?.disconnect(); observer = null;
      for (const item of tiles.values()) release(item);
      tiles.clear();
    }
    function clearPreview() {
      preview?.abort(); preview = null;
      previewObserver?.disconnect(); previewObserver = null;
      for (const item of previewPictures.values()) release(item);
      previewPictures.clear();
      $("picker-peek").replaceChildren(); $("picker-peek").hidden = true;
      const image = $("picker-preview"); image.hidden = true; image.removeAttribute("src");
      $("picker-preview-frame").hidden = true;
      $("picker-preview-frame").classList.remove("loading");
      $("picker-preview-name").textContent = "Select a folder or photo.";
      $("picker-preview-note").textContent = "Photo files stay in their folders.";
      $("picker-preview-hint").textContent = "";
    }
    function stop() {
      stopped = true; session.controller?.abort(); clearTiles(); clearPreview();
    }
    async function showPreview(entry) {
      clearPreview();
      const controller = new AbortController(); preview = controller;
      const current = () => !stopped && !controller.signal.aborted;
      $("picker-preview-name").textContent = entry.name;
      $("picker-preview-note").textContent = entry.kind === "directory" ? "Reading folder…" : "Making a temporary preview…";
      try {
        if (entry.kind !== "directory") {
          const frame = $("picker-preview-frame"), image = $("picker-preview");
          frame.hidden = false; frame.classList.add("loading");
          const item = { controller, image }; previewPictures.set(frame, item);
          const blob = await thumbnail(entry, 512, controller.signal, false, 0);
          if (!current()) return;
          item.url = URL.createObjectURL(blob);
          image.onload = () => { if (current()) { image.hidden = false; frame.classList.remove("loading"); } };
          image.onerror = () => { image.hidden=true; if (current()) { frame.classList.remove("loading"); $("picker-preview-note").textContent = "Preview unavailable."; } };
          image.alt = `Preview of ${entry.name}`; image.src = item.url;
          $("picker-preview-note").textContent = `${entry.size == null ? "" : `${Math.round(entry.size / 1024).toLocaleString()} KB · `}${entry.kind_label}`;
          $("picker-preview-hint").textContent = "Temporary browser preview. Photos stay in their folders.";
          return;
        }
        const result = await requests.submit(() => api(`/api/media-browser/folder-peek?path=${encodeURIComponent(entry.path)}`, undefined, controller.signal), controller.signal, 0);
        if (!current()) return;
        $("picker-preview-note").textContent = result.count ? `${result.count.toLocaleString()} photos · ${result.formats.join(", ")}` : "No photos in this folder.";
        $("picker-preview-hint").textContent = result.count ? "A quick look from the camera’s own previews. Double-click to look inside." : "";
        if (!result.samples.length) {
          if (result.count) $("picker-preview-hint").textContent = "No embedded camera previews available. Double-click to look inside.";
          return;
        }
        let next = 0, loaded = 0, finished = 0;
        const peek = $("picker-peek"); peek.hidden = false;
        previewObserver = new IntersectionObserver(changes => {
          for (const change of changes) {
            const item = previewPictures.get(change.target);
            if (!item) continue;
            if (!change.isIntersecting) {
              if (item.url) item.finished = false;
              release(item); change.target.classList.remove("loading"); continue;
            }
            if (item.controller || item.finished) continue;
            item.controller = new AbortController();
            const signal = item.controller.signal;
            change.target.classList.add("loading");
            void (async () => {
              while (current() && !signal.aborted && (item.sample || next < result.samples.length)) {
                const sample = item.sample || result.samples[next++];
                item.sample = sample;
                try {
                  const blob = await thumbnail(sample, 192, signal, true, 1);
                  if (!current() || signal.aborted) return;
                  item.sample = sample; item.url = URL.createObjectURL(blob); item.image.src = item.url;
                  item.image.alt = `Camera preview of ${sample.name}`;
                  if (!item.completed) loaded++; break;
                } catch (error) { if (signal.aborted || !current()) return; item.sample = null; }
              }
              if (!current() || signal.aborted) return;
              item.finished = true;
              if (!item.completed) { item.completed = true; finished++; }
              change.target.classList.remove("loading");
              if (!item.url) change.target.hidden = true;
              if (finished === previewPictures.size && !loaded) {
                peek.hidden = true;
                $("picker-preview-hint").textContent = "No embedded camera previews available. Double-click to look inside.";
              }
            })();
          }
        }, { root: pane });
        for (let i = 0; i < Math.min(4, result.samples.length); i++) {
          const frame = document.createElement("div"), image = document.createElement("img");
          frame.append(image); peek.append(frame);
          previewPictures.set(frame, { image }); previewObserver.observe(frame);
        }
      } catch (error) {
        if (current()) {
          $("picker-preview-frame").classList.remove("loading");
          $("picker-preview-note").textContent = error.message;
        }
      }
    }
    function paintSelection() {
      [...list.children].forEach((button, index) => {
        const selected = session.selection.has(index) || (index === focused && session.entries[index].kind !== "directory");
        button.setAttribute("aria-selected", String(selected)); button.classList.toggle("selected", selected);
      });
      $("picker-status").textContent = session.selection.size ? `${session.selection.size} folder${session.selection.size === 1 ? "" : "s"} selected` : "Pin this folder, or select folders below.";
    }
    function select(index, event) {
      const entry = session.entries[index]; focused = index;
      if (entry.kind === "directory") {
        if (event.shiftKey && session.anchor >= 0) {
          if (!event.ctrlKey && !event.metaKey) session.selection.clear();
          for (let i = Math.min(index, session.anchor); i <= Math.max(index, session.anchor); i++) {
            if (session.entries[i].kind === "directory") session.selection.add(i);
          }
        } else if (event.ctrlKey || event.metaKey) {
          session.selection.has(index) ? session.selection.delete(index) : session.selection.add(index); session.anchor = index;
        } else { session.selection = new Set([index]); session.anchor = index; }
      }
      paintSelection();
      if (entry.supported) void showPreview(entry);
    }
    function render() {
      clearTiles();
      $("folder-picker").dataset.view = view;
      for (const value of ["list", "grid"]) $(`picker-view-${value}`).setAttribute("aria-pressed", String(value === view));
      observer = new IntersectionObserver(changes => {
        for (const change of changes) {
          const item = tiles.get(change.target); if (!item) continue;
          if (!change.isIntersecting) { release(item); item.frame.classList.remove("loading"); continue; }
          if (item.controller) continue;
          item.controller = new AbortController(); const signal = item.controller.signal;
          item.frame.classList.add("loading"); item.frame.title = "Making a temporary thumbnail…";
          void thumbnail(item.entry, 192, signal).then(blob => {
            if (stopped || signal.aborted) return;
            item.url = URL.createObjectURL(blob); item.image.src = item.url;
            item.frame.title = "";
          }).catch(error => { if (!signal.aborted) item.frame.title = error.message; })
            .finally(() => { if (!signal.aborted) item.frame.classList.remove("loading"); });
        }
      }, { root: list });
      const buttons = session.entries.map((entry, index) => {
        const button = document.createElement("button"); button.type = "button"; button.title = entry.path;
        button.className = `directory-browser-entry ${entry.kind}${entry.supported ? " supported" : ""}`;
        button.dataset.path = entry.path; button.setAttribute("role", "option");
        if (view === "grid") {
          const frame = document.createElement("span"); frame.className = "picker-tile-frame";
          if (entry.kind === "directory") {
            const icon = document.createElement("span"); icon.className = "picker-folder-icon"; frame.append(icon);
          } else if (entry.supported) {
            const image = document.createElement("img"); image.alt = ""; frame.append(image);
            tiles.set(button, { entry, frame, image });
          } else { frame.textContent = entry.format?.toUpperCase() || "File"; }
          const name = document.createElement("span"); name.className = "picker-tile-name"; name.textContent = entry.name;
          button.append(frame, name);
        } else {
          const values = [entry.name, entry.size == null ? "--" : `${(entry.size / 1024).toFixed(0)} KB`, entry.kind_label,
            entry.date_added_ms == null ? "--" : new Date(entry.date_added_ms).toLocaleDateString()];
          ["name", "size", "kind", "date"].forEach((column, i) => {
            const span = document.createElement("span"); span.className = `directory-browser-entry-${column}`; span.textContent = values[i]; button.append(span);
          });
        }
        button.addEventListener("click", event => select(index, event));
        if (entry.kind === "directory") {
          button.addEventListener("dblclick", () => browse(entry.path)); bindFolderMenu(button, entry.path);
        }
        return button;
      });
      list.replaceChildren(...buttons); paintSelection();
      for (const button of tiles.keys()) observer.observe(button);
    }
    function setView(value) {
      if (value === view) return;
      view = value;
      try { localStorage.setItem(VIEW_KEY, view); } catch {}
      render(); list.children[focused]?.scrollIntoView({ block: "nearest" });
    }
    async function browse(path = "", returnPath = "") {
      if (session.displayed) session.scrollPositions.set(session.displayed, list.scrollTop);
      closeFolderMenu(); session.controller?.abort(); clearTiles(); clearPreview();
      list.replaceChildren(); focused = -1;
      const controller = new AbortController(); session.controller = controller;
      session.current = ""; session.selection.clear(); $("picker-pin").disabled = true;
      $("picker-status").textContent = "Reading folder…";
      try {
        const result = await api(`/api/media-browser?mode=export_directory&path=${encodeURIComponent(path)}`, undefined, controller.signal);
        if (stopped || controller.signal.aborted) return;
        Object.assign(session, { current: result.current, parent: result.parent, displayed: result.current, entries: result.entries, anchor: -1 });
        $("picker-path").value = result.current; $("picker-up").disabled = !result.parent;
        $("picker-places").replaceChildren(...[...result.drives, ...result.locations, ...result.pinned].map(place => {
          const button = document.createElement("button"); button.type = "button"; button.textContent = place.name; button.title = place.path;
          button.addEventListener("click", () => browse(place.path)); return button;
        }));
        render(); list.scrollTop = session.scrollPositions.get(result.current) || 0;
        const index = session.entries.findIndex(entry => entry.path === returnPath);
        if (index >= 0) { select(index, {}); list.children[index].scrollIntoView({ block: "nearest" }); }
      } catch (error) { if (!controller.signal.aborted && !stopped) $("picker-status").textContent = error.message; }
      finally { if (!stopped && session.controller === controller) $("picker-pin").disabled = !session.current; }
    }
    return session;
  }
  root.HDRLibraryFolderPicker = Object.freeze({ create });
})(window);
