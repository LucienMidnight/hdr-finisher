// Library mock-up. Everything here is pretend: marks live in memory only and
// nothing is read from or written to disk.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const app = $("app");

  // ---------- pretend data ----------

  const SCENES = [
    { prefix: "DSC0", ext: "ARW", kind: "RAW", camera: "Sony ILCE-7RM5", lens: "FE 24-70mm F2.8 GM II", iso: 100, shutter: "1/640", aperture: "f/8", focal: "35 mm", tags: ["langkawi", "beach"] },
    { prefix: "IMG_", ext: "HEIC", kind: "HEIC", camera: "Apple iPhone 12 Pro", lens: "Unknown", iso: 320, shutter: "1/60", aperture: "f/1.6", focal: "26 mm", tags: ["lego"] },
    { prefix: "DSC0", ext: "ARW", kind: "RAW", camera: "Sony ILCE-7RM5", lens: "FE 16-35mm F2.8 GM", iso: 3200, shutter: "1/30", aperture: "f/2.8", focal: "16 mm", tags: ["langkawi", "hotel"] },
    { prefix: "DJI_", ext: "DNG", kind: "RAW", camera: "DJI Mavic 3", lens: "Hasselblad 24mm", iso: 100, shutter: "1/800", aperture: "f/4", focal: "24 mm", tags: ["drone"] },
    { prefix: "DJI_", ext: "DNG", kind: "RAW", camera: "DJI Mavic 3", lens: "Hasselblad 24mm", iso: 100, shutter: "1/1000", aperture: "f/4", focal: "24 mm", tags: ["drone"] },
    { prefix: "DSC0", ext: "ARW", kind: "RAW", camera: "Sony ILCE-7RM5", lens: "FE 50mm F1.2 GM", iso: 800, shutter: "1/125", aperture: "f/1.8", focal: "50 mm", tags: ["drinks"] },
    { prefix: "DSC0", ext: "JPG", kind: "JPG", camera: "Sony ILCE-7RM5", lens: "FE 50mm F1.2 GM", iso: 400, shutter: "1/125", aperture: "f/2", focal: "50 mm", tags: ["drinks"] },
  ];

  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const sceneIds = [...new Set(window.MOCK_PHOTOS.map((p) => p.burst))];
  const photos = window.MOCK_PHOTOS.map((p, i) => {
    const sceneIndex = sceneIds.indexOf(p.burst);
    const scene = SCENES[sceneIndex % SCENES.length];
    const roll = rand();
    return {
      id: p.id,
      scene: sceneIndex,
      name: scene.prefix + String(4100 + i * 3 + (i % 2)) + "." + scene.ext,
      kind: scene.kind,
      w: p.w,
      h: p.h,
      facts: scene,
      time: "12 Sep 2026 " + String(9 + sceneIndex).padStart(2, "0") + ":" + String(10 + (i % 7) * 4).padStart(2, "0"),
      stars: roll > 0.7 ? 3 + Math.floor(rand() * 3) : 0,
      flag: roll > 0.82 ? "pick" : roll < 0.12 ? "reject" : null,
      edited: rand() > 0.8,
      copies: i === 3 ? 2 : 0,
      tags: scene.tags.slice(),
    };
  });

  const PLACES = [
    { heading: "Folders", add: "Add folder" },
    { id: "trip", icon: "folder", label: "2026-09 Langkawi", scenes: [0, 2, 3, 4], open: true, children: [
      { id: "trip-1", icon: "folder", label: "Day 1 Beach", scenes: [0] },
      { id: "trip-2", icon: "folder", label: "Day 2 Hotel", scenes: [2] },
      { id: "trip-3", icon: "folder", label: "Drone", scenes: [3, 4] },
    ] },
    { id: "studio", icon: "folder", label: "Studio tests", scenes: [1, 5], open: false, children: [
      { id: "studio-1", icon: "folder", label: "Lego", scenes: [1] },
      { id: "studio-2", icon: "folder", label: "Drinks", scenes: [5] },
    ] },
    { id: "client", icon: "folder", label: "Client work (NAS)", offline: true },
    { id: "card", icon: "card", label: "Memory card (E:)", scenes: [6], note: "not pinned" },
    { heading: "Projects" },
    { id: "project", icon: "project", label: "Harbour Hotel HDR set", scenes: [2] },
    { heading: "Albums", add: "New album" },
    { id: "album", icon: "album", label: "Portfolio", match: (p) => p.stars >= 4 },
    { id: "smart", icon: "smart", label: "Picked, not edited", match: (p) => p.flag === "pick" && !p.edited },
  ];

  const ICONS = {
    twist: "M9 6l6 6l-6 6",
    folder: "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2",
    card: "M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-9l2 -2z M10 4v3 M13 4v3 M16 4v3",
    project: "M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2",
    album: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z M12 4v7l2 -2l2 2v-7",
    smart: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z M8 9h8 M8 13h5",
    plus: "M12 5v14 M5 12h14",
    flag: "M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9z M5 21v-7",
    reject: "M18 6l-12 12 M6 6l12 12",
    edited: "M4 6h8 M16 6h4 M4 12h2 M10 12h10 M4 18h10 M18 18h2 M14 4v4 M8 10v4 M16 16v4",
  };
  const icon = (name, cls) => `<svg viewBox="0 0 24 24" class="${cls || name}"><path d="${ICONS[name]}"/></svg>`;

  // ---------- state ----------

  const state = {
    place: "trip-1",
    view: "grid",
    sel: new Set(),
    active: null,
    anchor: null,
    filters: { minStars: 0, picked: false, unmarked: false, hideRejected: false, edited: false, rawOnly: false, text: "" },
    sort: "time",
    undo: [],
    shown: [],
    review: false,
    ref: null,
    zoom: { on: false, fx: 0.5, fy: 0.5 },
  };

  const remember = (key, value) => { try { localStorage.setItem("libmock-" + key, value); } catch (e) { /* fine */ } };
  const recall = (key, fallback) => { try { return localStorage.getItem("libmock-" + key) || fallback; } catch (e) { return fallback; } };

  const TINT_DEFAULTS = { focus: "#55e579", high: "#ff1f1f", low: "#009eff" };
  const tints = { focus: recall("tint-focus", TINT_DEFAULTS.focus), high: recall("tint-high", TINT_DEFAULTS.high), low: recall("tint-low", TINT_DEFAULTS.low) };

  const byId = (id) => photos.find((p) => p.id === id);
  const flatPlaces = () => PLACES.flatMap((p) => [p, ...(p.children || [])]).filter((p) => p.id);
  const placeOf = (id) => flatPlaces().find((p) => p.id === id);
  const inPlace = (place) => !place ? [] : photos.filter((p) => (place.match ? place.match(p) : (place.scenes || []).includes(p.scene)));

  function computeShown() {
    const f = state.filters;
    const text = f.text.trim().toLowerCase();
    let list = inPlace(placeOf(state.place)).filter((p) =>
      p.stars >= f.minStars &&
      (!f.picked || p.flag === "pick") &&
      (!f.unmarked || (!p.flag && !p.stars)) &&
      (!f.hideRejected || p.flag !== "reject") &&
      (!f.edited || p.edited) &&
      (!f.rawOnly || p.kind === "RAW") &&
      (!text || p.name.toLowerCase().includes(text) || p.tags.some((t) => t.includes(text))));
    const order = { pick: 0, null: 1, reject: 2 };
    const sorts = {
      time: (a, b) => a.id - b.id,
      name: (a, b) => a.name.localeCompare(b.name),
      rating: (a, b) => b.stars - a.stars || a.id - b.id,
      pick: (a, b) => order[a.flag] - order[b.flag] || a.id - b.id,
    };
    state.shown = list.sort(sorts[state.sort]);
  }

  // ---------- navigation rail ----------

  function renderNav() {
    const rows = [];
    const row = (p, depth) => {
      const count = p.offline ? "" : inPlace(p).length;
      rows.push(`<button type="button" class="nav-row${p.id === state.place ? " selected" : ""}${p.offline ? " offline" : ""}" style="--depth:${depth}" data-place="${p.id}">
        ${icon("twist", "twist" + (p.children ? (p.open ? " open" : "") : " none"))}${icon(p.icon)}
        <span class="label">${p.label}</span>
        <span class="${p.note || p.offline ? "note" : "count"}">${p.offline ? "offline" : p.note || count}</span></button>`);
      if (p.children && p.open) p.children.forEach((c) => row(c, depth + 1));
    };
    PLACES.forEach((p) => {
      if (p.heading) {
        rows.push(`<div class="nav-heading"><span>${p.heading}</span>${p.add ? `<button type="button" class="nav-add" title="${p.add}" aria-label="${p.add}">${icon("plus")}</button>` : ""}${rows.length ? "" : collapseButton("nav", "folders")}</div>`);
      } else row(p, 0);
    });
    $("nav").innerHTML = rows.join("");
  }

  $("nav").addEventListener("click", (event) => {
    if (event.target.closest(".side-collapse")) return toggleSide("nav");
    const add = event.target.closest(".nav-add");
    if (add) return add.title === "Add folder" ? openPicker() : toast("Albums come in a later round.");
    const button = event.target.closest(".nav-row");
    if (!button) return;
    const place = placeOf(button.dataset.place);
    if (place.offline) return toast("This drive is not connected. Its photos stay listed and show as offline.");
    if (place.children && (event.target.closest(".twist") || place.id === state.place)) place.open = !place.open;
    else if (place.children) place.open = true;
    goTo(place.id);
  });

  function goTo(id) {
    const changed = id !== state.place;
    state.place = id;
    computeShown();
    if (changed) {
      state.sel.clear();
      state.active = state.anchor = null;
    }
    renderNav();
    renderGrid(changed);
    refresh();
  }

  // ---------- grid ----------

  function marksHtml(p) {
    const right = [];
    if (p.copies) right.push(`<span class="copy" title="Has virtual copies">+${p.copies}</span>`);
    if (p.edited) right.push(icon("edited"));
    if (p.flag === "pick") right.push(icon("flag"));
    if (p.flag === "reject") right.push(icon("reject"));
    return `<span class="stars">${"★".repeat(p.stars)}</span><span class="right">${right.join("")}</span>`;
  }

  // The focus and exposure maps are small images kept beside the thumbnails
  // and drawn over them. They load only once an overlay is switched on.
  const mapSrc = (kind, p) => `photos/${kind}/${String(p.id).padStart(3, "0")}.png`;
  const MAPS = ["focus", "high", "low"];
  const overlayImgs = (p) => MAPS.map((kind) => `<img class="ov ov-${kind}" src="${mapSrc(kind, p)}" alt="" loading="lazy">`).join("");

  function cellHtml(p) {
    return `<div class="cell" data-id="${p.id}"><div class="frame"><img src="photos/t/${String(p.id).padStart(3, "0")}.jpg" alt="" loading="lazy">${overlayImgs(p)}</div>
      <div class="marks"></div><div class="name"><span>${p.name}</span><span>${p.kind}</span></div></div>`;
  }

  function renderGrid(arriving) {
    const grid = $("grid");
    grid.innerHTML = state.shown.map(cellHtml).join("");
    const slow = $("opt-slow").checked && arriving;
    [...grid.children].forEach((cell, i) => {
      if (!slow) return;
      cell.classList.add("loading");
      setTimeout(() => cell.classList.remove("loading"), 120 + i * 22);
    });
    grid.scrollTop = 0;
    const place = placeOf(state.place);
    const total = inPlace(place).length;
    $("empty").hidden = state.shown.length > 0 || state.view !== "grid";
    $("empty").innerHTML = !place
      ? `<h2>Add a folder to begin</h2><p>Photos stay where they are. Nothing is copied or imported.</p>
         <button type="button" class="button-primary" id="empty-add">Add folder</button><small>or drag a folder in from Explorer</small>`
      : total ? "<p>No photos match the filter.</p>" : "<p>No photos here yet.</p>";
    $("place-title").textContent = place ? place.label : "Library";
    $("place-count").textContent = state.shown.length === total ? String(total) : `${state.shown.length} of ${total}`;
    renderFilmstrip();
  }

  function renderFilmstrip() {
    $("filmstrip").innerHTML = state.shown.map(cellHtml).join("");
  }

  // Repaint marks and selection without rebuilding the thumbnails.
  function refresh() {
    document.querySelectorAll(".cell").forEach((cell) => {
      const p = byId(Number(cell.dataset.id));
      cell.classList.toggle("selected", state.sel.has(p.id));
      cell.classList.toggle("active", state.active === p.id);
      cell.classList.toggle("rejected", p.flag === "reject");
      cell.classList.toggle("reference", state.view === "compare" && state.ref === p.id);
      cell.querySelector(".marks").innerHTML = marksHtml(p);
    });
    app.dataset.view = state.view;
    $("grid").hidden = state.view !== "grid";
    $("single").hidden = state.view === "grid";
    document.querySelectorAll("[data-view-button]").forEach((b) => b.classList.toggle("active", b.dataset.viewButton === state.view));
    if (state.view === "single") renderSingle();
    if (state.view === "compare") renderCompare();
    if (state.review) renderReview();
    renderDetails();
    renderStatus();
    renderFilters();
    syncOptions();
  }

  function renderStatus() {
    const all = inPlace(placeOf(state.place));
    const count = (test) => all.filter(test).length;
    const parts = [`<b>${state.shown.length}</b> photos`];
    if (state.sel.size > 1) parts.push(`<b>${state.sel.size}</b> selected`);
    parts.push(`<b>${count((p) => p.flag === "pick")}</b> picked`, `<b>${count((p) => p.flag === "reject")}</b> rejected`);
    const legend = [];
    const swatch = (kind, text) => `<label title="Click the square to change this colour. Double-click to reset."><input type="color" data-tint="${kind}" value="${tints[kind]}">${text}</label>`;
    if (app.dataset.focus === "on") legend.push(`<span class="legend">${swatch("focus", "sharpest detail")}</span>`);
    if (app.dataset.exposure === "on") legend.push(`<span class="legend">${swatch("high", "blown highlights")}${swatch("low", "blocked shadows")}</span>`);
    $("status").innerHTML = parts.map((t) => `<span>${t}</span>`).join("") + legend.join("");
  }

  function select(id, mode) {
    const ids = state.shown.map((p) => p.id);
    if (mode === "toggle") {
      state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id);
      state.anchor = id;
    } else if (mode === "range" && state.anchor !== null && ids.includes(state.anchor)) {
      const [a, b] = [ids.indexOf(state.anchor), ids.indexOf(id)].sort((x, y) => x - y);
      state.sel = new Set(ids.slice(a, b + 1));
    } else {
      state.sel = new Set([id]);
      state.anchor = id;
    }
    state.active = id;
    refresh();
    const holder = state.view === "grid" ? $("grid") : $("filmstrip");
    const cell = holder.querySelector(`[data-id="${id}"]`);
    if (cell) cell.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function move(delta, extend) {
    const ids = state.shown.map((p) => p.id);
    if (!ids.length) return;
    const from = ids.indexOf(state.active);
    const to = from < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, from + delta));
    select(ids[to], extend ? "range" : "single");
  }

  function columns() {
    const cells = [...$("grid").children];
    return cells.filter((c) => c.offsetTop === cells[0].offsetTop).length || 1;
  }

  function onCellClick(event) {
    const cell = event.target.closest(".cell");
    if (!cell) {
      if (event.currentTarget.id === "grid") { state.sel.clear(); state.active = null; refresh(); }
      return;
    }
    // In compare the selected photo is always the right-hand one.
    select(Number(cell.dataset.id), state.view === "compare" ? "single" : event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "range" : "single");
  }
  $("grid").addEventListener("click", onCellClick);
  $("filmstrip").addEventListener("click", onCellClick);
  $("grid").addEventListener("dblclick", (event) => { if (event.target.closest(".cell")) openInGrade(); });
  $("filmstrip").addEventListener("dblclick", (event) => { if (event.target.closest(".cell")) openInGrade(); });

  // ---------- marks ----------

  // What marks and the details panel act on. In compare that is always the right-hand photo.
  function targets() {
    return [...state.sel].map(byId);
  }

  function mark(change, label) {
    const list = targets();
    if (!list.length) return;
    state.undo.push(list.map((p) => ({ p, stars: p.stars, flag: p.flag })));
    list.forEach(change);
    sync(list);
    flash(label);
    const advance = $("opt-advance").checked && list.length === 1;
    computeShown();
    if (state.shown.length !== document.querySelectorAll("#grid .cell").length) renderGrid(false);
    if (advance) move(1); else refresh();
  }

  const setStars = (n) => mark((p) => { p.stars = n; }, n ? "★".repeat(n) : "No stars");
  const setFlag = (flag) => mark((p) => { p.flag = flag; }, flag === "pick" ? "Picked" : flag === "reject" ? "Rejected" : "Unmarked");

  function undo() {
    const last = state.undo.pop();
    if (!last) return;
    if (last.deleted) {
      last.deleted.forEach(({ p, at }) => photos.splice(at, 0, p));
      computeShown();
      renderNav();
      renderGrid(false);
      refresh();
      return toast(`Restored ${last.deleted.length} from the Recycle Bin`);
    }
    last.forEach(({ p, stars, flag }) => { p.stars = stars; p.flag = flag; });
    sync(last.map((entry) => entry.p));
    computeShown();
    renderGrid(false);
    refresh();
    toast(last.length > 1 ? `Undid marks on ${last.length} photos` : "Undid last mark");
  }

  // ---------- single photo and full-screen review ----------

  const large = (p) => `photos/${String(p.id).padStart(3, "0")}.jpg`;

  // One photo in a stage: fitted, or at 100% and draggable. The zoom and the
  // spot being looked at are kept while flipping, so the same detail can be
  // checked across a run of frames.
  const ZOOM_EDGE = 1600;

  function place(img, p) {
    const box = img.parentElement.getBoundingClientRect();
    img.classList.toggle("zoomed", state.zoom.on);
    const follow = () => img.parentElement.querySelectorAll(".stage-ov").forEach((o) => {
      const src = mapSrc(o.dataset.kind, p);
      if (o.getAttribute("src") !== src) o.src = src;
      o.classList.toggle("zoomed", state.zoom.on);
      o.style.cssText = img.style.cssText;
    });
    if (!state.zoom.on) {
      img.style.cssText = "";
      return follow();
    }
    const scale = ZOOM_EDGE / Math.max(p.w, p.h);
    const [w, h] = [p.w * scale, p.h * scale];
    const edge = (size, room, f) => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, room / 2 - f * size)));
    img.style.cssText = `width:${w}px;height:${h}px;left:${edge(w, box.width, state.zoom.fx)}px;top:${edge(h, box.height, state.zoom.fy)}px`;
    follow();
  }

  function show(img, p) {
    const fresh = img.dataset.id !== String(p.id);
    const detail = state.zoom.on ? "full" : "fit";
    if (fresh || img.dataset.detail !== detail) {
      img.dataset.id = p.id;
      img.dataset.detail = detail;
      const slow = $("opt-slow").checked;
      // Fitted: the thumbnail first, the screen-sized preview a moment later.
      // At 100%: soft at first, sharp once the quick decode would be ready.
      if (fresh) img.src = slow ? `photos/t/${String(p.id).padStart(3, "0")}.jpg` : large(p);
      img.classList.toggle("soft", slow && state.zoom.on);
      if (slow) setTimeout(() => {
        if (img.dataset.id !== String(p.id)) return;
        img.src = large(p);
        if (img.dataset.detail === detail) img.classList.remove("soft");
      }, state.zoom.on ? 420 : 160);
    }
    place(img, p);
  }

  function setZoom(on, fx, fy) {
    Object.assign(state.zoom, { on, fx: fx === undefined ? state.zoom.fx : fx, fy: fy === undefined ? state.zoom.fy : fy });
    refresh();
  }

  // Click to zoom on that spot, click again to fit, drag to move around.
  function zoomable(stage, photo) {
    let drag = null;
    stage.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY, fx: state.zoom.fx, fy: state.zoom.fy, moved: false };
    });
    window.addEventListener("mousemove", (event) => {
      if (!drag) return;
      const [dx, dy] = [event.clientX - drag.x, event.clientY - drag.y];
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!state.zoom.on || !drag.moved) return;
      const rect = stage.querySelector("img").getBoundingClientRect();
      state.zoom.fx = Math.min(1, Math.max(0, drag.fx - dx / rect.width));
      state.zoom.fy = Math.min(1, Math.max(0, drag.fy - dy / rect.height));
      rezoom();
    });
    window.addEventListener("mouseup", (event) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      const p = photo();
      if (moved || !p) return;
      if (state.zoom.on) return setZoom(false);
      const box = stage.getBoundingClientRect();
      const pad = stage === $("review") ? 0 : 14;
      const fit = Math.min((box.width - pad * 2) / p.w, (box.height - pad * 2) / p.h);
      const fx = (event.clientX - (box.left + box.width / 2)) / (p.w * fit) + 0.5;
      const fy = (event.clientY - (box.top + box.height / 2)) / (p.h * fit) + 0.5;
      setZoom(true, Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy)));
    });
  }

  // Zoom is shared: in compare both sides move together.
  function rezoom() {
    if (state.review) return place($("review-image"), current());
    if (state.view === "single") return place($("single-image"), current());
    place($("compare-ref-image"), byId(state.ref));
    place($("compare-image"), current());
  }

  function current() {
    if (state.active === null && state.shown.length) select(state.shown[0].id);
    return byId(state.active);
  }

  function renderSingle() {
    const p = current();
    if (!p) return;
    show($("single-image"), p);
    $("single-image").classList.toggle("rejected", p.flag === "reject");
    const index = state.shown.indexOf(p) + 1;
    $("single-caption").innerHTML = `<span>${p.name}</span><span class="stars">${"★".repeat(p.stars)}</span>${p.flag ? icon(p.flag === "pick" ? "flag" : "reject") : ""}<span>${index} / ${state.shown.length}</span><span>${state.zoom.on ? "100%" : "Fit"}</span>`;
  }

  function renderReview() {
    const p = current();
    if (!p) return;
    show($("review-image"), p);
    $("review-image").classList.toggle("rejected", p.flag === "reject");
    $("review-marks").innerHTML = `<span>${"★".repeat(p.stars)}</span>${p.flag ? icon(p.flag === "pick" ? "flag" : "reject") : ""}${state.zoom.on ? "<span>100%</span>" : ""}`;
  }

  const captionMarks = (p) => `<span class="stars">${"★".repeat(p.stars)}</span>${p.flag ? icon(p.flag === "pick" ? "flag" : "reject") : ""}`;

  function renderCompare() {
    const [r, c] = [byId(state.ref), current()];
    if (!r || !c) return;
    show($("compare-ref-image"), r);
    show($("compare-image"), c);
    $("compare-ref-image").classList.toggle("rejected", r.flag === "reject");
    $("compare-image").classList.toggle("rejected", c.flag === "reject");
    $("compare-ref-caption").innerHTML = `<span>${r.name}</span>${captionMarks(r)}`;
    $("compare-caption").innerHTML = `<span>${c.name}</span>${captionMarks(c)}<span>${state.shown.indexOf(c) + 1} / ${state.shown.length}</span><span>${state.zoom.on ? "100%" : "Fit"}</span>`;
  }

  // Fill the two sides. With two or more photos selected, the first goes left
  // and the second right. Otherwise the current photo goes to the side asked
  // for and a neighbour fills the other.
  function startCompare(side) {
    const ids = state.shown.map((p) => p.id);
    const picked = ids.filter((id) => state.sel.has(id));
    const now = current() && current().id;
    if (now === null || now === undefined || ids.length < 2) return false;
    const neighbour = (id, step) => ids[ids.indexOf(id) + step] === undefined ? ids[ids.indexOf(id) - step] : ids[ids.indexOf(id) + step];
    let left, right;
    if (picked.length >= 2) [left, right] = picked;
    else if (side === "right") [left, right] = [ids.includes(state.ref) && state.ref !== now ? state.ref : neighbour(now, -1), now];
    else [left, right] = [now, neighbour(now, 1)];
    state.ref = left;
    state.active = state.anchor = right;
    state.sel = new Set([right]);
    return true;
  }

  // [ puts the selected photo on the left, ] puts it on the right. From the
  // grid or single view that opens compare. Inside compare the selected photo
  // is already the right-hand one, so [ moves it across and ] changes nothing.
  function chooseSide(side) {
    if (state.review) return;
    if (state.view !== "compare") return setView("compare", side);
    if (side === "left") promote();
  }

  // The right-hand photo moves to the left and the next one takes its place.
  function promote() {
    if (state.view !== "compare") return;
    const ids = state.shown.map((p) => p.id);
    const at = ids.indexOf(state.active);
    state.ref = state.active;
    select(ids[at + 1 < ids.length ? at + 1 : at - 1]);
  }

  function setView(view, side) {
    if (view === "compare" && !startCompare(side)) return toast("Compare needs at least two photos.");
    state.view = view;
    state.zoom.on = false;
    if (view === "single") current();
    $("empty").hidden = true;
    refresh();
    if (view === "grid") {
      $("empty").hidden = state.shown.length > 0;
      const cell = $("grid").querySelector(".cell.active");
      if (cell) cell.scrollIntoView({ block: "nearest" });
    } else {
      const cell = $("filmstrip").querySelector(".cell.active");
      if (cell) cell.scrollIntoView({ inline: "center" });
    }
  }

  function setReview(on) {
    if (on && !current()) return;
    state.review = on;
    state.zoom.on = false;
    $("review").hidden = !on;
    if (on) {
      renderReview();
      if ($("review").requestFullscreen) $("review").requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) document.exitFullscreen();
    refresh();
  }
  zoomable($("single-stage"), current);
  zoomable($("review"), current);
  zoomable($("compare-ref-stage"), () => byId(state.ref));
  zoomable($("compare-stage"), current);
  window.addEventListener("resize", refresh);
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && state.review) setReview(false); });

  let flashTimer;
  function flash(text) {
    if (!state.review) return;
    const el = $("review-flash");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove("show"), 350);
  }

  // ---------- Grade stand-in ----------

  function setStage(stage) {
    app.dataset.stage = stage;
    $("grade-stage").hidden = stage !== "grade";
    document.querySelectorAll("[data-stage-tab]").forEach((t) => t.classList.toggle("active", t.dataset.stageTab === stage));
  }

  function showInGrade(p) {
    $("grade-image").hidden = !p;
    if (p) $("grade-image").src = large(p);
    $("grade-name").textContent = p ? p.name : "";
    const auto = $("autosave").getAttribute("aria-pressed") === "true";
    $("grade-note").textContent = !p ? "No photo open. Double-click a photo in the Library window."
      : auto
        ? "Stand-in for the Grade workspace. Autosave is on: changes save beside the photo, and switching photos never asks."
        : "Stand-in for the Grade workspace. Autosave is off: switching to another photo asks Save / Don't save / Cancel if this one has unsaved work.";
    setStage("grade");
  }

  function openInGrade() {
    const p = current();
    if (!p) return;
    if (POPPED) {
      tell({ lib: "grade", id: p.id });
      return toast(`${p.name} opened in Grade in the main window.`);
    }
    if (state.review) setReview(false);
    showInGrade(p);
  }

  document.querySelectorAll("[data-stage-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const stage = tab.dataset.stageTab;
    if (stage === "library") return popOpen() ? pop.focus() : setStage("library");
    if (stage === "grade") return popOpen() ? setStage("grade") : openInGrade();
    toast("Proof and Export are not part of this mock-up.");
  }));

  $("autosave").addEventListener("click", () => {
    const on = $("autosave").getAttribute("aria-pressed") !== "true";
    $("autosave").setAttribute("aria-pressed", on);
    $("autosave").querySelector("span").textContent = on ? "Autosave on" : "Autosave off";
  });

  document.querySelectorAll(".stub-grade-list").forEach((list) => {
    list.innerHTML = ["Crop & Rotate", "Perspective", "Denoise", "Tone", "Exposure Bands", "Lift, Gamma, Gain", "Highlight Compression", "Curves", "Color", "Color Grading", "Local Adjustments", "Detail", "Film Look"]
      .map((name, i) => `<div class="stub-row"><i>${String(i + 2).padStart(2, "0")}</i>${icon("twist")}${name}</div>`).join("");
  });

  // ---------- details ----------

  function renderDetails() {
    const list = targets();
    const title = `<div class="details-title"><span class="panel-title">Details</span>${collapseButton("details", "details")}</div>`;
    if (!list.length) {
      $("details").innerHTML = title + `<p class="details-sub">Nothing selected.</p>`;
      return;
    }
    const one = list.length === 1 ? list[0] : null;
    const same = (get) => (list.every((p) => get(p) === get(list[0])) ? get(list[0]) : undefined);
    const stars = same((p) => p.stars);
    const flag = same((p) => p.flag);
    const tags = [...new Set(list.flatMap((p) => p.tags))];
    const head = one
      ? `<p class="details-name">${one.name}</p><p class="details-sub">${one.kind} · ${one.w} × ${one.h} · ${one.time}</p><p class="details-sub">${one.edited ? "Edited" : "Not edited"}${one.copies ? ` · ${one.copies} virtual copies` : ""}</p>`
      : `<p class="details-name">${list.length} photos selected</p><p class="details-sub">Marks and tags apply to all of them.</p>`;
    const facts = one ? `<div class="details-section"><p class="details-kicker">Camera</p><dl class="details-facts">
        <dt>Camera</dt><dd>${one.facts.camera}</dd><dt>Lens</dt><dd>${one.facts.lens}</dd>
        <dt>Focal length</dt><dd>${one.facts.focal}</dd><dt>Aperture</dt><dd>${one.facts.aperture}</dd>
        <dt>Shutter</dt><dd>${one.facts.shutter} s</dd><dt>ISO</dt><dd>${one.facts.iso}</dd></dl>
        <button type="button" class="details-more">Show all</button></div>` : "";
    $("details").innerHTML = title + head + `
      <div class="details-section"><p class="details-kicker">Marks</p>
        <div class="details-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-stars="${n}" class="${stars >= n ? "on" : ""}" aria-label="${n} stars">★</button>`).join("")}</div>
        <div class="details-flags">${[["pick", "Pick"], ["", "Unmarked"], ["reject", "Reject"]].map(([v, l]) => `<button type="button" data-flag="${v}" class="${flag !== undefined && (flag || "") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="details-section"><p class="details-kicker">Tags</p>
        <div class="details-tags">${tags.map((t) => `<span>${t}</span>`).join("")}<input type="text" placeholder="Add tag" spellcheck="false"></div>
      </div>` + facts;
  }

  $("details").addEventListener("click", (event) => {
    if (event.target.closest(".side-collapse")) return toggleSide("details");
    const star = event.target.closest("[data-stars]");
    const flag = event.target.closest("[data-flag]");
    if (star) {
      const n = Number(star.dataset.stars);
      setStars(targets().every((p) => p.stars === n) ? 0 : n);
    } else if (flag) setFlag(flag.dataset.flag || null);
    else if (event.target.closest(".details-more")) toast("The full metadata list comes in a later round.");
  });
  $("details").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.target.matches(".details-tags input")) return;
    const tag = event.target.value.trim().toLowerCase();
    if (tag) targets().forEach((p) => { if (!p.tags.includes(tag)) p.tags.push(tag); });
    renderDetails();
    $("details").querySelector(".details-tags input").focus();
  });

  // ---------- filter bar ----------

  $("filter-stars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-min="${n}" title="${n} stars or more">★</button>`).join("");

  function renderFilters() {
    const f = state.filters;
    document.querySelectorAll("[data-min]").forEach((b) => b.classList.toggle("on", Number(b.dataset.min) <= f.minStars));
    document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("on", f[b.dataset.filter]));
    const active = (f.minStars ? 1 : 0) + (f.text ? 1 : 0) + ["picked", "unmarked", "hideRejected", "edited", "rawOnly"].filter((k) => f[k]).length;
    $("filter-button").textContent = active ? `Filter · ${active}` : "Filter";
    $("filter-button").setAttribute("aria-pressed", active > 0 || !$("filterbar").hidden);
    $("raw-only").setAttribute("aria-pressed", f.rawOnly);
  }

  function filtersChanged() {
    computeShown();
    if (!state.shown.some((p) => p.id === state.active)) { state.sel.clear(); state.active = null; }
    renderGrid(false);
    refresh();
  }

  $("filterbar").addEventListener("click", (event) => {
    const f = state.filters;
    const min = event.target.closest("[data-min]");
    const chip = event.target.closest("[data-filter]");
    if (min) f.minStars = f.minStars === Number(min.dataset.min) ? 0 : Number(min.dataset.min);
    else if (chip) f[chip.dataset.filter] = !f[chip.dataset.filter];
    else if (event.target.id === "filter-clear") {
      Object.assign(f, { minStars: 0, picked: false, unmarked: false, hideRejected: false, edited: false, rawOnly: false, text: "" });
      $("search").value = "";
    } else if (event.target.id === "filter-save") return toast("Saving a filter as a smart album comes in a later round.");
    else return;
    filtersChanged();
  });
  $("search").addEventListener("input", () => { state.filters.text = $("search").value; filtersChanged(); });
  $("raw-only").addEventListener("click", () => { state.filters.rawOnly = !state.filters.rawOnly; filtersChanged(); });
  $("sort").addEventListener("change", () => { state.sort = $("sort").value; filtersChanged(); });

  function toggleFilterBar(focus) {
    $("filterbar").hidden = focus ? false : !$("filterbar").hidden;
    if (!$("filterbar").hidden && focus) $("search").focus();
    renderFilters();
  }
  $("filter-button").addEventListener("click", () => toggleFilterBar(false));

  // ---------- bar ----------

  // Grid and single switch on a click. Compare, like Focus and Exposure, opens its options instead.
  document.querySelectorAll("[data-view-button]").forEach((b) => b.addEventListener("click", () =>
    (b.dataset.viewButton === "compare" ? openOptions("compare", b) : setView(b.dataset.viewButton))));
  $("review-button").addEventListener("click", () => setReview(true));
  $("thumb-size").addEventListener("input", () => $("grid").style.setProperty("--thumb", $("thumb-size").value + "px"));
  // ---------- pop-out: the library in its own window ----------

  // One app, two windows. The main window stays on Grade while the library is
  // out; marks made in either window show in the other.
  const POPPED = new URLSearchParams(location.search).get("window") === "library";
  // The window this library came out of (when it is the popped-out one).
  const HOME = window.opener || (window.parent !== window ? window.parent : null);
  let pop = null;
  const popOpen = () => !!pop && !pop.closed;
  function tell(message) {
    const other = POPPED ? HOME : pop;
    if (other && !other.closed) other.postMessage(message, "*");
  }
  function sync(list) {
    tell({ lib: "marks", list: list.map((p) => ({ id: p.id, stars: p.stars, flag: p.flag })) });
  }
  function takeMarks(list) {
    list.forEach((m) => { const p = byId(m.id); if (p) { p.stars = m.stars; p.flag = m.flag; } });
    computeShown();
    renderGrid(false);
    refresh();
  }
  function setPopped(on) {
    app.dataset.popped = on ? "on" : "off";
    document.querySelector('[data-stage-tab="library"]').innerHTML = `<span aria-hidden="true">01</span>Library${on ? '<i class="away">in own window</i>' : ""}`;
    if (on) showInGrade(state.active !== null ? byId(state.active) : null);
    else pop = null;
  }
  $("popout").addEventListener("click", () => {
    if (POPPED && HOME) return window.close();
    if (POPPED) return location.assign(location.pathname + (state.place ? "?place=" + state.place : ""));
    const address = location.pathname + "?window=library" + (state.place ? "&place=" + state.place : "");
    pop = window.open(address, "hdrf-library", "width=1500,height=950");
    if (!pop) return toast("The browser blocked the new window. Allow pop-ups for this page, then try again.");
    setPopped(true);
  });
  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.lib === "hello" && !POPPED) pop = pop || event.source;
    if (data.lib === "hello") tell({ lib: "marks", list: photos.map((p) => ({ id: p.id, stars: p.stars, flag: p.flag })) });
    if (data.lib === "marks") takeMarks(data.list);
    if (data.lib === "grade") { showInGrade(byId(data.id)); window.focus(); }
    if (data.lib === "closed" && pop) { setPopped(false); toast("Library window closed. The library is docked here again."); }
  });
  setInterval(() => { if (pop && pop.closed) { setPopped(false); toast("Library window closed. The library is docked here again."); } }, 800);
  if (POPPED) {
    app.dataset.window = "library";
    document.title = "Library · HDR Finisher";
    $("popout").title = "Dock the library in the main window";
    tell({ lib: "hello" });
    window.addEventListener("beforeunload", () => tell({ lib: "closed" }));
    // Some viewers load the new window over the old one instead of beside it.
    if (!HOME) setTimeout(() => toast("This viewer cannot open a second window, so the library replaced the main one. The button at top right goes back. Open the mock-up in your own browser to try both windows."), 400);
  }

  // ---------- overlays ----------

  ["single-image", "compare-ref-image", "compare-image", "review-image"].forEach((id) =>
    $(id).insertAdjacentHTML("afterend", MAPS.map((kind) => `<img class="stage-ov ov-${kind}" data-kind="${kind}" alt="">`).join("")));

  // Overlay colours: click a square in the legend to choose another. Remembered between visits.
  function setTint(kind, colour) {
    tints[kind] = colour;
    document.querySelector(`#tint-${kind} feFlood`).setAttribute("flood-color", colour);
    remember("tint-" + kind, colour);
  }
  MAPS.forEach((kind) => setTint(kind, tints[kind]));
  $("status").addEventListener("input", (event) => { if (event.target.dataset.tint) setTint(event.target.dataset.tint, event.target.value); });
  $("status").addEventListener("dblclick", (event) => {
    const input = event.target.closest("label") && event.target.closest("label").querySelector("[data-tint]");
    if (!input) return;
    event.preventDefault();
    setTint(input.dataset.tint, TINT_DEFAULTS[input.dataset.tint]);
    refresh();
  });

  function toggleOverlay(kind) {
    const on = app.dataset[kind] !== "on";
    app.dataset[kind] = on ? "on" : "off";
    document.querySelector(`[data-overlay="${kind}"]`).setAttribute("aria-pressed", on);
    // Maps are made in the background, photos on screen first, the first time an overlay is used.
    if (on && $("opt-slow").checked && !toggleOverlay["made" + kind + state.place]) {
      toggleOverlay["made" + kind + state.place] = true;
      [...$("grid").children].forEach((cell, i) => {
        cell.querySelectorAll(kind === "focus" ? ".ov-focus" : ".ov-high, .ov-low").forEach((o) => {
          o.style.opacity = 0;
          setTimeout(() => { o.style.opacity = ""; }, 200 + i * 45);
        });
      });
    }
    refresh();
  }
  document.querySelectorAll("[data-overlay]").forEach((b) => b.addEventListener("click", () => openOptions(b.dataset.overlay, b)));

  // ---------- options panels ----------
  // A key is the instant on/off. A click opens the panel, which has the same
  // on/off switch plus the slower, detailed settings.

  const opts = { focus: { strength: 85, sensitivity: 50 }, exposure: { strength: 90, high: true, low: true }, compare: { layout: "side", names: true } };
  let optionsKind = null;

  function applyOptions() {
    app.style.setProperty("--focus-strength", opts.focus.strength / 100);
    app.style.setProperty("--exposure-strength", opts.exposure.strength / 100);
    // Sensitivity: how much fine detail counts as sharp.
    const floor = ((100 - opts.focus.sensitivity) / 100) * 0.7;
    const funcA = document.querySelector("#tint-focus feFuncA");
    funcA.setAttribute("slope", 3);
    funcA.setAttribute("intercept", -floor * 3);
    app.dataset.high = opts.exposure.high ? "on" : "off";
    app.dataset.low = opts.exposure.low ? "on" : "off";
    $("compare").dataset.layout = opts.compare.layout;
    app.dataset.compareNames = opts.compare.names ? "on" : "off";
  }

  const isOn = (kind) => (kind === "compare" ? state.view === "compare" : app.dataset[kind] === "on");
  const row = (label, key, control) => `<label class="opt-row"><span>${label}${key ? `<kbd>${key}</kbd>` : ""}</span>${control}</label>`;
  const slider = (kind, name, label, low, high) => `<div class="opt-slider"><label class="opt-row"><span>${label}</span><output>${opts[kind][name]}%</output></label>
    <input type="range" min="${low}" max="${high}" value="${opts[kind][name]}" data-opt="${kind}.${name}"></div>`;
  const colour = (kind, label) => `<span class="opt-colour"><input type="color" data-tint="${kind}" value="${tints[kind]}" aria-label="${label} colour"><input type="text" data-tint-text="${kind}" value="${tints[kind]}" maxlength="7" spellcheck="false"></span>`;

  const PANELS = {
    focus: () => `
      ${row("Show focus overlay", "S", `<input type="checkbox" class="opt-switch" data-switch="focus" ${isOn("focus") ? "checked" : ""}>`)}
      <hr>
      ${slider("focus", "strength", "Strength", 10, 100)}
      ${slider("focus", "sensitivity", "Sensitivity", 0, 100)}
      ${row("Colour", "", colour("focus", "Focus"))}
      <p class="helper">Shows where the sharp plane is, not whether it is on the right subject. At high ISO, noise can read as detail; lower the sensitivity.</p>`,
    exposure: () => `
      ${row("Show exposure overlay", "E", `<input type="checkbox" class="opt-switch" data-switch="exposure" ${isOn("exposure") ? "checked" : ""}>`)}
      <hr>
      ${slider("exposure", "strength", "Strength", 10, 100)}
      ${row(`<span class="opt-check"><input type="checkbox" data-opt="exposure.high" ${opts.exposure.high ? "checked" : ""}> Blown highlights</span>`, "", colour("high", "Blown highlights"))}
      ${row(`<span class="opt-check"><input type="checkbox" data-opt="exposure.low" ${opts.exposure.low ? "checked" : ""}> Blocked shadows</span>`, "", colour("low", "Blocked shadows"))}
      <p class="helper">Read from the RAW data, before any grade, so it shows what the file really holds.</p>`,
    compare: () => `
      ${row("Compare", "C", `<input type="checkbox" class="opt-switch" data-switch="compare" ${isOn("compare") ? "checked" : ""}>`)}
      <hr>
      <div class="opt-row"><span>Layout</span></div>
      <div class="opt-segment">${[["side", "Side by side"], ["top", "Top and bottom"], ["split", "Split"]].map(([v, l]) => `<button type="button" data-layout="${v}" class="${opts.compare.layout === v ? "on" : ""}">${l}</button>`).join("")}</div>
      ${row(`<span class="opt-check"><input type="checkbox" data-opt="compare.names" ${opts.compare.names ? "checked" : ""}> File names and marks under photos</span>`, "", "")}
      <p class="helper">Arrows flip the right-hand photo. [ and ] place the selected photo left or right. Zoom and position are shared. In Split, drag the divider.</p>`,
  };
  const TITLES = { focus: "Focus overlay", exposure: "Exposure overlay", compare: "Compare" };

  function openOptions(kind, button) {
    if (optionsKind === kind) return closeOptions();
    optionsKind = kind;
    const panel = $("options");
    panel.innerHTML = `<div class="popover-heading"><span>${TITLES[kind]}</span><button type="button" class="text-button" data-close>Close</button></div>` + PANELS[kind]();
    panel.hidden = false;
    const at = button.getBoundingClientRect();
    panel.style.top = at.bottom + 8 + "px";
    panel.style.left = Math.max(8, Math.min(at.left, innerWidth - panel.offsetWidth - 8)) + "px";
  }
  function closeOptions() {
    optionsKind = null;
    $("options").hidden = true;
  }
  // Keep the panel's switch in step when the key is used while it is open.
  function syncOptions() {
    const box = optionsKind && $("options").querySelector("[data-switch]");
    if (box) box.checked = isOn(optionsKind);
    $("options").querySelectorAll("[data-tint]").forEach((i) => { i.value = tints[i.dataset.tint]; });
  }

  $("options").addEventListener("input", (event) => {
    const t = event.target;
    if (t.dataset.switch === "compare") setView(t.checked ? "compare" : "grid");
    else if (t.dataset.switch) toggleOverlay(t.dataset.switch);
    else if (t.dataset.opt) {
      const [kind, name] = t.dataset.opt.split(".");
      opts[kind][name] = t.type === "checkbox" ? t.checked : Number(t.value);
      if (t.type === "range") t.previousElementSibling.querySelector("output").textContent = t.value + "%";
      applyOptions();
    } else if (t.dataset.tint) {
      setTint(t.dataset.tint, t.value);
      $("options").querySelector(`[data-tint-text="${t.dataset.tint}"]`).value = t.value;
      refresh();
    } else if (t.dataset.tintText && /^#[0-9a-f]{6}$/i.test(t.value)) {
      setTint(t.dataset.tintText, t.value);
      $("options").querySelector(`[data-tint="${t.dataset.tintText}"]`).value = t.value;
      refresh();
    }
  });
  $("options").addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) return closeOptions();
    const layout = event.target.closest("[data-layout]");
    if (!layout) return;
    opts.compare.layout = layout.dataset.layout;
    $("options").querySelectorAll("[data-layout]").forEach((b) => b.classList.toggle("on", b === layout));
    applyOptions();
    if (state.view === "compare") refresh();
  });
  window.addEventListener("mousedown", (event) => {
    if (optionsKind && !event.target.closest("#options, [data-overlay], [data-view-button='compare']")) closeOptions();
  });

  // Split compare: drag the divider.
  let splitting = false;
  $("split-handle").addEventListener("mousedown", (event) => { splitting = true; event.preventDefault(); event.stopPropagation(); });
  window.addEventListener("mousemove", (event) => {
    if (!splitting) return;
    const box = $("compare").getBoundingClientRect();
    $("compare").style.setProperty("--split", Math.min(95, Math.max(5, ((event.clientX - box.left) / box.width) * 100)) + "%");
  });
  window.addEventListener("mouseup", () => { splitting = false; });

  applyOptions();

  // Side panels: open or collapsed to a rail, like Metadata on the other stages.
  function collapseButton(side, name) {
    const open = app.dataset[side] !== "collapsed";
    return `<button type="button" class="panel-collapse-button side-collapse" aria-expanded="${open}" title="${open ? "Collapse" : "Open"} ${name}" aria-label="${open ? "Collapse" : "Open"} ${name}"></button>`;
  }
  function toggleSide(side, open) {
    const collapse = open === undefined ? app.dataset[side] !== "collapsed" : !open;
    app.dataset[side] = collapse ? "collapsed" : "open";
    renderNav();
    renderDetails();
  }
  const toggleDetails = () => toggleSide("details");

  let toastTimer;
  function toast(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2600);
  }

  // ---------- keyboard ----------

  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]")) return;
    if (!$("menu").hidden) { closeMenu(); if (event.key === "Escape") return; }
    if (optionsKind && event.key === "Escape") return closeOptions();
    const typing = event.target instanceof Element && event.target.matches("input[type=text], input[type=range]");
    const key = event.key;
    if (key === "Escape") {
      if (typing) return event.target.blur();
      if (!$("keys").hidden) return ($("keys").hidden = true);
      if (state.zoom.on && (state.review || state.view !== "grid")) return setZoom(false);
      if (state.review) return setReview(false);
      if (app.dataset.stage === "grade") return setStage("library");
      if (state.view !== "grid") return setView("grid");
      if (!$("filterbar").hidden) return toggleFilterBar(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "f") { event.preventDefault(); return toggleFilterBar(true); }
    if (typing || app.dataset.stage !== "library") return;
    if (event.ctrlKey || event.metaKey) {
      if (key.toLowerCase() === "a") { event.preventDefault(); state.sel = new Set(state.shown.map((p) => p.id)); refresh(); }
      if (key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      return;
    }
    const step = state.view === "grid" && !state.review ? columns() : 0;
    const actions = {
      ArrowRight: () => move(1, event.shiftKey),
      ArrowLeft: () => move(-1, event.shiftKey),
      ArrowDown: () => move(step || 1, event.shiftKey),
      ArrowUp: () => move(-(step || 1), event.shiftKey),
      Enter: openInGrade,
      " ": () => setView(state.view === "grid" ? "single" : "grid"),
      g: () => setView("grid"),
      f: () => setReview(!state.review),
      z: () => { if (state.review || state.view !== "grid") setZoom(!state.zoom.on); },
      c: () => setView(state.view === "compare" ? "grid" : "compare"),
      "[": () => chooseSide("left"),
      "]": () => chooseSide("right"),
      i: toggleDetails,
      s: () => toggleOverlay("focus"),
      e: () => toggleOverlay("exposure"),
      Delete: () => confirmDelete(targets()),
      Tab: () => {
        const open = app.dataset.nav === "collapsed" && app.dataset.details === "collapsed";
        toggleSide("nav", open);
        toggleSide("details", open);
      },
      p: () => setFlag("pick"),
      x: () => setFlag("reject"),
      u: () => setFlag(null),
    };
    const action = actions[key.length === 1 ? key.toLowerCase() : key];
    if (action) { event.preventDefault(); action(); } else if (/^[0-5]$/.test(key)) setStars(Number(key));
  });

  // ---------- drag a box to select ----------

  let band = null;
  let swallowClick = false;
  $("grid").addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest("img")) return;
    band = { x: event.clientX, y: event.clientY, base: event.ctrlKey || event.metaKey ? new Set(state.sel) : new Set(), moved: false };
  });
  window.addEventListener("mousemove", (event) => {
    if (!band) return;
    if (Math.abs(event.clientX - band.x) + Math.abs(event.clientY - band.y) > 4) band.moved = true;
    if (!band.moved) return;
    const frame = $("content").getBoundingClientRect();
    const box = {
      left: Math.max(frame.left, Math.min(band.x, event.clientX)), right: Math.min(frame.right, Math.max(band.x, event.clientX)),
      top: Math.max(frame.top, Math.min(band.y, event.clientY)), bottom: Math.min(frame.bottom, Math.max(band.y, event.clientY)),
    };
    const m = $("marquee");
    m.hidden = false;
    m.style.cssText = `left:${box.left - frame.left}px;top:${box.top - frame.top}px;width:${box.right - box.left}px;height:${box.bottom - box.top}px`;
    const hits = [...$("grid").children].filter((cell) => {
      const r = cell.getBoundingClientRect();
      return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
    }).map((cell) => Number(cell.dataset.id));
    state.sel = new Set([...band.base, ...hits]);
    state.active = state.anchor = hits.length ? hits[hits.length - 1] : null;
    refresh();
  });
  window.addEventListener("mouseup", () => {
    if (band && band.moved) { swallowClick = true; $("marquee").hidden = true; setTimeout(() => { swallowClick = false; }, 0); }
    band = null;
  });
  $("grid").addEventListener("click", (event) => { if (swallowClick) { swallowClick = false; event.stopImmediatePropagation(); } }, true);

  // ---------- right-click menus ----------

  const later = (what) => () => toast(`${what} comes in a later round.`);

  function openMenu(x, y, items) {
    const menu = $("menu");
    menu.innerHTML = items.filter(Boolean).map((item, i) =>
      item === "-" ? "<hr>" : item.header ? `<div class="menu-header">${item.header}</div>`
        : `<button type="button" role="menuitem" data-item="${i}" class="${item.danger ? "danger" : ""}"><span>${item.label}</span>${item.key ? `<kbd>${item.key}</kbd>` : ""}</button>`).join("");
    menu.items = items.filter(Boolean);
    menu.hidden = false;
    const size = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - size.width - 6) + "px";
    menu.style.top = Math.min(y, innerHeight - size.height - 6) + "px";
  }
  function closeMenu() { $("menu").hidden = true; }
  $("menu").addEventListener("click", (event) => {
    const button = event.target.closest("[data-item]");
    if (!button) return;
    const item = $("menu").items[Number(button.dataset.item)];
    closeMenu();
    (item.action || later(item.label.replace("…", "")))();
  });
  window.addEventListener("mousedown", (event) => { if (!event.target.closest("#menu")) closeMenu(); });
  window.addEventListener("blur", closeMenu);

  function photoMenu() {
    const list = targets();
    const one = list.length === 1;
    const rejected = list.every((p) => p.flag === "reject");
    return [
      { header: one ? list[0].name : `${list.length} photos` },
      one && { label: "Open in Grade", key: "Enter", action: openInGrade },
      { label: "Put on left in compare", key: "[", action: () => chooseSide("left") },
      { label: "Put on right in compare", key: "]", action: () => chooseSide("right") },
      "-",
      { label: "Pick", key: "P", action: () => setFlag("pick") },
      { label: rejected ? "Unmark" : "Reject", key: rejected ? "U" : "X", action: () => setFlag(rejected ? null : "reject") },
      "-",
      { label: "Copy grade…" },
      { label: "Paste grade…" },
      { label: "Apply look preset…" },
      { label: one ? "Create virtual copy" : "Create virtual copies" },
      "-",
      { label: "Add to album…" },
      { label: "Create HDR previews" },
      { label: "Export…" },
      "-",
      one && { label: "Rename…" },
      { label: "Move to folder…" },
      { label: "Show in Explorer" },
      "-",
      { label: one ? "Delete photo…" : `Delete ${list.length} photos…`, key: "Del", danger: true, action: () => confirmDelete(list) },
    ];
  }

  function placeMenu(place) {
    const top = PLACES.includes(place);
    const rejected = inPlace(place).filter((p) => p.flag === "reject");
    const deleteRejected = rejected.length && { label: `Delete ${rejected.length} rejected…`, danger: true, action: () => confirmDelete(rejected, place) };
    if (place.offline) return [{ header: place.label }, { label: "Locate…" }, "-", { label: "Unpin", action: () => unpin(place) }];
    if (place.icon === "project") return [{ header: place.label }, { label: "Show in Explorer" }, { label: "Relink photos…" }, { label: "Export project…" }, "-", { label: "Remove from list", action: () => unpin(place) }];
    if (place.icon === "album") return [{ header: place.label }, { label: "Rename…" }, { label: "Export project…" }, "-", { label: "Delete album (photos stay)", action: () => unpin(place) }];
    if (place.icon === "smart") return [{ header: place.label }, { label: "Edit rules…" }, { label: "Rename…" }, "-", { label: "Delete smart album", action: () => unpin(place) }];
    if (place.note) return [{ header: place.label }, { label: "Pin this folder", action: () => { delete place.note; place.icon = "folder"; renderNav(); toast(`${place.label} pinned.`); } }, { label: "Show in Explorer" }, "-", { label: "Close", action: () => unpin(place) }];
    return [
      { header: place.label },
      top ? { label: "Re-scan" } : { label: "Pin as its own entry" },
      { label: "New folder inside…" },
      { label: top ? "Rename label…" : "Rename folder…" },
      !top && { label: "Move folder…" },
      { label: "Show in Explorer" },
      "-",
      { label: "Create HDR previews" },
      { label: "Export project…" },
      deleteRejected,
      top && "-",
      top && { label: "Unpin", action: () => unpin(place) },
    ];
  }

  function unpin(place) {
    PLACES.splice(PLACES.indexOf(place), 1);
    const gone = !placeOf(state.place);
    if (gone) {
      const next = flatPlaces().find((p) => !p.offline);
      state.place = next ? next.id : null;
      state.sel.clear();
      state.active = null;
      if (state.view !== "grid") state.view = "grid";
    }
    computeShown();
    renderNav();
    renderGrid(gone);
    refresh();
    toast(`${place.label} removed from the library. Nothing was deleted from disk.`);
  }

  document.addEventListener("contextmenu", (event) => {
    const cell = event.target.closest("#grid .cell, #filmstrip .cell");
    const row = event.target.closest("#nav .nav-row");
    if (!cell && !row) return;
    event.preventDefault();
    if (cell) {
      const id = Number(cell.dataset.id);
      if (!state.sel.has(id)) select(id);
      return openMenu(event.clientX, event.clientY, photoMenu());
    }
    openMenu(event.clientX, event.clientY, placeMenu(placeOf(row.dataset.place)));
  });

  // ---------- delete, always behind a confirmation ----------

  function confirmDelete(list, fromPlace) {
    if (!list.length) return;
    const n = list.length;
    const what = n === 1 ? "photo" : "photos";
    const copies = list.reduce((sum, p) => sum + p.copies, 0);
    const graded = list.filter((p) => p.edited).length;
    const place = fromPlace || placeOf(state.place);
    const bin = place.id !== "card";
    const extras = [graded ? `${graded === n && n > 1 ? "their" : graded === 1 && n === 1 ? "its" : graded} saved grade${graded === 1 ? "" : "s"}` : "", copies ? `${copies} virtual ${copies === 1 ? "copy" : "copies"}` : ""].filter(Boolean);
    $("confirm-title").textContent = `Delete ${n === 1 ? list[0].name : `${n} photos`}?`;
    $("confirm-message").textContent =
      `${n === 1 ? "This photo" : `These ${n} photos`} will be deleted from disk` +
      (extras.length ? `, along with ${extras.join(" and ")}` : "") + ". Ratings and tags go with " + (n === 1 ? "it" : "them") + ".\n\n" +
      (bin ? `${n === 1 ? "It goes" : "They go"} to the Recycle Bin and can be restored from there.`
        : `${place.label} has no Recycle Bin. ${n === 1 ? "It" : "They"} will be gone for good.`);
    $("confirm-actions").innerHTML = `<button type="button" data-answer="no">Cancel</button><button type="button" class="button-danger" data-answer="yes">${bin ? "Move to Recycle Bin" : "Delete for good"}</button>`;
    $("confirm").onclick = (event) => {
      const answer = event.target.dataset && event.target.dataset.answer;
      if (!answer) return;
      $("confirm").close();
      if (answer !== "yes") return;
      if (bin) state.undo.push({ deleted: list.map((p) => ({ p, at: photos.indexOf(p) })).sort((a, b) => a.at - b.at) });
      list.forEach((p) => photos.splice(photos.indexOf(p), 1));
      state.sel.clear();
      state.active = state.anchor = null;
      if (state.view !== "grid") state.view = "grid";
      computeShown();
      renderNav();
      renderGrid(false);
      refresh();
      toast(bin ? `${n} ${what} moved to the Recycle Bin. Ctrl+Z restores.` : `${n} ${what} deleted.`);
    };
    $("confirm").showModal();
    $("confirm").querySelector("[data-answer=no]").focus();
  }

  // ---------- Add folder picker ----------

  const DISK = { name: "This PC", children: [
    { name: "Photos (D:)", children: [
      { name: "2026-08 Oslo", photos: 0, scenes: [6], children: [{ name: "Day 1", photos: 120 }, { name: "Day 2", photos: 94 }] },
      { name: "2026-09 Langkawi", photos: 0, pinned: true, scenes: [0, 2, 3, 4], children: [
        { name: "Day 1 Beach", photos: 7, scenes: [0] }, { name: "Day 2 Hotel", photos: 7, scenes: [2] }, { name: "Drone", photos: 14, scenes: [3, 4] }] },
      { name: "2026-10 Studio", photos: 61, scenes: [1, 5] },
      { name: "Archive", photos: 0, children: [{ name: "2025", photos: 4120 }, { name: "2024", photos: 3876 }] },
    ] },
    { name: "Memory card (E:)", children: [{ name: "DCIM", photos: 0, children: [{ name: "100MSDCF", photos: 7, scenes: [6] }] }] },
    { name: "Pictures", children: [{ name: "Screenshots", photos: 312 }, { name: "Phone backup", photos: 1840 }] },
    { name: "NAS (\\\\studio)", offline: true },
  ] };
  const picker = { path: [DISK.children[0]], chosen: [], anchor: null };
  const total = (node) => (node.photos || 0) + (node.children || []).reduce((sum, c) => sum + total(c), 0);

  // What Pin would add: the ticked folders, or the folder being looked at.
  function pickerTargets() {
    if (picker.chosen.length) return picker.chosen;
    return picker.path.length > 1 ? [picker.path[picker.path.length - 1]] : [];
  }

  function renderPicker() {
    const here = picker.path[picker.path.length - 1];
    $("picker-places").innerHTML = DISK.children.map((d, i) =>
      `<button type="button" class="nav-row${d === picker.path[0] ? " selected" : ""}${d.offline ? " offline" : ""}" data-drive="${i}">${icon(d.name.includes("card") ? "card" : "folder")}<span class="label">${d.name}</span>${d.offline ? `<span class="note">offline</span>` : ""}</button>`).join("");
    $("picker-crumbs").innerHTML = picker.path.map((n, i) => `<button type="button" data-crumb="${i}">${n.name}</button>`).join("<span>›</span>");
    const rows = here.children || [];
    $("picker-list").innerHTML = rows.length ? rows.map((n, i) =>
      `<button type="button" class="nav-row${picker.chosen.includes(n) ? " selected" : ""}" data-row="${i}">${icon("twist", "twist" + (n.children ? "" : " none"))}${icon("folder")}<span class="label">${n.name}</span>
        <span class="count">${n.pinned ? "pinned · " : ""}${total(n).toLocaleString()} photos</span></button>`).join("")
      : "<p>No sub-folders here.</p>";
    const targets = pickerTargets();
    const fresh = targets.filter((n) => !n.pinned);
    const photosIn = fresh.reduce((sum, n) => sum + total(n), 0).toLocaleString();
    const where = picker.path.slice(0, picker.chosen.length ? undefined : -1).map((n) => n.name).join(" › ");
    $("picker-target").textContent = !targets.length ? "Choose one or more folders"
      : targets.length === 1 ? `${where} › ${targets[0].name}  ·  ${total(targets[0]).toLocaleString()} photos, sub-folders included`
        : `${targets.length} folders in ${where}  ·  ${photosIn} photos, sub-folders included` + (fresh.length < targets.length ? `  ·  ${targets.length - fresh.length} already pinned` : "");
    $("picker-pin").disabled = $("picker-open").disabled = !fresh.length;
    $("picker-pin").textContent = targets.length && !fresh.length ? "Already pinned" : fresh.length > 1 ? `Pin ${fresh.length} folders` : "Pin folder";
    $("picker-open").textContent = fresh.length > 1 ? `Open ${fresh.length} without pinning` : "Open without pinning";
  }

  function openPicker() {
    picker.chosen = [];
    picker.anchor = null;
    renderPicker();
    $("picker").showModal();
  }

  function addPlaces(pin) {
    const nodes = pickerTargets().filter((n) => !n.pinned);
    // The pretend disk has no real photos, so every folder borrows some of the
    // sample ones; a folder never arrives looking empty when it claims photos.
    let serial = 0;
    const borrowed = (node) => node.scenes || [[...node.name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % SCENES.length];
    const asPlace = (node) => {
      const place = { id: `added-${Date.now()}-${serial++}`, icon: "folder", label: node.name, scenes: borrowed(node) };
      if (node.children) {
        place.children = node.children.map(asPlace);
        place.scenes = [...new Set([...(node.scenes || []), ...place.children.flatMap((c) => c.scenes)])];
        place.open = true;
      }
      return place;
    };
    const added = nodes.map((node) => {
      const place = asPlace(node);
      if (!pin) place.icon = "card";
      if (pin) node.pinned = true; else place.note = "not pinned";
      PLACES.splice(PLACES.findIndex((p) => p.heading === "Projects"), 0, place);
      return place;
    });
    $("picker").close();
    goTo(added[0].id);
    const count = nodes.reduce((sum, n) => sum + total(n), 0).toLocaleString();
    const what = nodes.length === 1 ? nodes[0].name : `${nodes.length} folders`;
    toast(pin ? `${what} pinned. Indexing ${count} photos in the background.` : `${what} opened without pinning.`);
  }

  $("picker").addEventListener("click", (event) => {
    const here = picker.path[picker.path.length - 1];
    const drive = event.target.closest("[data-drive]");
    const crumb = event.target.closest("[data-crumb]");
    const row = event.target.closest("[data-row]");
    if (drive) {
      const d = DISK.children[Number(drive.dataset.drive)];
      if (d.offline) return;
      picker.path = [d];
      picker.chosen = [];
    } else if (crumb) {
      picker.path = picker.path.slice(0, Number(crumb.dataset.crumb) + 1);
      picker.chosen = [];
    } else if (row) {
      // Click, Ctrl-click and Shift-click, the same as photos in the grid.
      const at = Number(row.dataset.row);
      const node = here.children[at];
      if (event.ctrlKey || event.metaKey) {
        picker.chosen = picker.chosen.includes(node) ? picker.chosen.filter((n) => n !== node) : [...picker.chosen, node];
        picker.anchor = at;
      } else if (event.shiftKey && picker.anchor !== null) {
        const [from, to] = [picker.anchor, at].sort((x, y) => x - y);
        picker.chosen = here.children.slice(from, to + 1);
      } else {
        picker.chosen = [node];
        picker.anchor = at;
      }
    } else if (event.target.id === "picker-cancel") return $("picker").close();
    else if (event.target.id === "picker-pin") return addPlaces(true);
    else if (event.target.id === "picker-open") return addPlaces(false);
    else return;
    renderPicker();
  });
  $("picker").addEventListener("dblclick", (event) => {
    if (!event.target.closest("[data-row]") || picker.chosen.length !== 1 || !picker.chosen[0].children) return;
    picker.path.push(picker.chosen[0]);
    picker.chosen = [];
    picker.anchor = null;
    renderPicker();
  });
  $("picker").addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
    event.preventDefault();
    picker.chosen = (picker.path[picker.path.length - 1].children || []).slice();
    renderPicker();
  });
  $("empty").addEventListener("click", (event) => { if (event.target.id === "empty-add") openPicker(); });

  // ---------- first run ----------

  function firstRun() {
    for (let i = PLACES.length - 1; i >= 0; i--) if (!PLACES[i].heading) PLACES.splice(i, 1);
    DISK.children[0].children[1].pinned = false;
    state.place = null;
    state.view = "grid";
    state.sel.clear();
    state.active = null;
    computeShown();
    renderNav();
    renderGrid(false);
    refresh();
  }
  $("opt-first").addEventListener("change", () => ($("opt-first").checked ? firstRun() : location.reload()));

  // ---------- mock-up controls ----------

  function setFit(fit) {
    app.dataset.fit = fit;
    remember("fit", fit);
    document.querySelectorAll("button[data-fit]").forEach((b) => b.classList.toggle("on", b.dataset.fit === fit));
  }
  $("mock-strip").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.fit) setFit(b.dataset.fit);
    if (b.id === "keys-button") $("keys").hidden = !$("keys").hidden;
    b.blur();
  });
  $("opt-names").addEventListener("change", () => { app.dataset.names = $("opt-names").checked ? "on" : "off"; });
  document.querySelectorAll(".mock-check input").forEach((box) => box.addEventListener("change", () => box.blur()));

  // ---------- start ----------

  // The address can ask for a starting state, for example
  // index.html?place=trip&view=single&details=collapsed&nav=collapsed&filter=on
  const ask = new URLSearchParams(location.search);
  setFit(ask.get("fit") || recall("fit", "contain"));
  if (placeOf(ask.get("place"))) state.place = ask.get("place");
  if (ask.get("details") === "collapsed") app.dataset.details = "collapsed";
  if (ask.get("nav") === "collapsed") app.dataset.nav = "collapsed";
  if (ask.get("filter") === "on") $("filterbar").hidden = false;
  if (ask.get("names") === "on") { $("opt-names").checked = true; app.dataset.names = "on"; }
  if (ask.has("view")) $("opt-slow").checked = false;
  computeShown();
  renderNav();
  renderGrid(true);
  refresh();
  if (ask.has("select")) ask.get("select").split(",").forEach((n, i) => select(state.shown[Number(n)].id, i ? "toggle" : "single"));
  if (ask.has("focus")) { $("opt-slow").checked = false; toggleOverlay("focus"); }
  if (ask.has("exposure")) { $("opt-slow").checked = false; toggleOverlay("exposure"); }
  if (ask.get("popped") === "on") setPopped(true);
  if (ask.has("layout")) { opts.compare.layout = ask.get("layout"); applyOptions(); }
  if (ask.has("options")) setTimeout(() => openOptions(ask.get("options"), document.querySelector(`[data-overlay="${ask.get("options")}"], [data-view-button="${ask.get("options")}"]`)), 50);
  if (ask.get("first") === "on") { $("opt-first").checked = true; firstRun(); }
  if (ask.get("picker") === "on") { openPicker(); picker.chosen = picker.path[0].children.slice(0, 3); renderPicker(); }
  if (ask.has("delete")) confirmDelete(targets());
  if (ask.has("menu")) openMenu(900, 300, photoMenu());
  if (ask.get("view") === "single") setView("single");
  if (ask.get("view") === "compare") setView("compare");
  if (ask.get("zoom") === "on") setZoom(true, 0.5, 0.45);
  if (ask.get("view") === "grade") openInGrade();
  if (ask.get("view") === "review") { state.review = true; $("review").hidden = false; refresh(); }
})();
