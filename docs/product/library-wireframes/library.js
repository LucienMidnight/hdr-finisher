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
      look: "",
      label: [null, null, null, "red", null, "green", null, null, "orange", null, null, "blue", null][i % 13],
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
    { id: "client", icon: "folder", label: "Client work (NAS)", offline: true, scenes: [5] },
    { id: "card", icon: "card", label: "Memory card (E:)", scenes: [6], note: "not pinned" },
    { heading: "Projects", add: "Open project" },
    { id: "project", icon: "project", label: "Harbour Hotel HDR set", scenes: [2] },
    { heading: "Albums", add: "New album" },
    // An album is a hand-picked set. A smart album is a saved set of rules.
    { id: "album", icon: "album", label: "Portfolio", ids: new Set(photos.filter((p) => p.stars >= 4).map((p) => p.id)) },
    { id: "smart", icon: "smart", label: "Picked, not edited", rules: { mode: "all", folders: null, list: [{ field: "pick", op: "is", value: "Picked" }, { field: "state", op: "not", value: "Edited" }] } },
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
    link: "M9 15l6 -6 M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464 M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463",
    edited: "M4 6h8 M16 6h4 M4 12h2 M10 12h10 M4 18h10 M18 18h2 M14 4v4 M8 10v4 M16 16v4",
    copy: "M8 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2",
  };
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cap = (text) => text[0].toUpperCase() + text.slice(1);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const icon = (name, cls) => `<svg viewBox="0 0 24 24" class="${cls || name}"><path d="${ICONS[name]}"/></svg>`;

  // ---------- state ----------

  const state = {
    place: "trip-1",
    view: "grid",
    sel: new Set(),
    active: null,
    anchor: null,
    filters: { minStars: 0, picked: false, unmarked: false, hideRejected: false, edited: false, rawOnly: false, text: "", labels: new Set(), rules: [] },
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
  const inPlace = (place) => !place ? [] : photos.filter((p) => (place.rules ? matches(p, place.rules) : place.ids ? place.ids.has(p.id) : inFolder(p, place)));
  // A photo is in a folder if it sits there directly or in one of its sub-folders.
  // Photos that have been moved carry their folder; the rest come from the sample sets.
  function inFolder(p, place) {
    const moved = p.folder !== undefined && place.icon !== "project";
    const here = moved ? p.folder === place.id : (place.children ? place.ownScenes || [] : place.scenes || []).includes(p.scene);
    return here || (place.children || []).some((c) => inFolder(p, c));
  }
  // Where a photo's image comes from, its place in capture order, and its name on screen.
  const pic = (p) => String(p.pic === undefined ? p.id : p.pic).padStart(3, "0");
  const ord = (p) => (p.order === undefined ? p.id : p.order);
  const title = (p) => p.name + (p.copyOf === undefined ? "" : " · " + p.copyName);

  // ---------- virtual copies ----------
  // A further grade of one photo, with no second image file. A copy is its own
  // item with its own grade, marks and tags, and sits beside its original.

  let copySerial = 1000;
  const copiesOf = (p) => photos.filter((c) => c.copyOf === p.id);
  function makeCopy(from, name, clean) {
    const root = from.copyOf === undefined ? from : byId(from.copyOf);
    const siblings = copiesOf(root);
    let n = 1;
    while (siblings.some((c) => c.copyName === "Copy " + n)) n++;
    const copy = Object.assign({}, from, {
      id: copySerial++, pic: root.id, copyOf: root.id, copyName: name || "Copy " + n,
      order: root.id + (siblings.length + 1) / 100,
      tags: from.tags.slice(), edited: clean ? false : from.edited, look: clean ? "" : from.look, before: undefined, exported: false, link: undefined, session: undefined, hdr: false,
    });
    photos.splice(photos.indexOf(root) + siblings.length + 1, 0, copy);
    return copy;
  }
  // Two to start with, so the idea shows without making one first.
  (function () {
    const root = photos[3];
    root.edited = true;
    Object.assign(makeCopy(root, "Black and white"), { look: "grayscale(1) contrast(1.15)", edited: true, stars: 0, flag: null, label: null });
    Object.assign(makeCopy(root, "Warm"), { look: "sepia(.28) saturate(1.25) contrast(1.05)", edited: true, stars: 0, flag: null, label: null });
  })();

  // ---------- rules: one engine for the filter bar and smart albums ----------

  const IS = [["is", "is"], ["not", "is not"]];
  const AMOUNT = [["gte", "is at least"], ["is", "is"], ["lte", "is at most"]];
  const same = (get) => (p, value) => get(p).toLowerCase() === value;
  const FIELDS = {
    rating: { label: "Rating", ops: AMOUNT, values: ["0", "1", "2", "3", "4", "5"], number: (p) => p.stars },
    pick: { label: "Pick status", ops: IS, values: ["Picked", "Unmarked", "Rejected"], test: same((p) => (p.flag === "pick" ? "Picked" : p.flag === "reject" ? "Rejected" : "Unmarked")) },
    label: { label: "Colour label", ops: IS, values: ["Red", "Orange", "Green", "Blue", "None"], test: same((p) => p.label || "None") },
    tag: { label: "Tag", ops: IS, test: (p, value) => p.tags.includes(value) },
    state: { label: "State", ops: IS, values: ["Edited", "Exported"], test: (p, value) => !!(value === "edited" ? p.edited : p.exported) },
    type: { label: "File type", ops: IS, values: ["RAW", "JPG", "HEIC"], test: same((p) => p.kind) },
    kind: { label: "Kind", ops: IS, values: ["Virtual copy", "Original"], test: same((p) => (p.copyOf === undefined ? "Original" : "Virtual copy")) },
    camera: { label: "Camera", ops: IS, values: [...new Set(SCENES.map((s) => s.camera))], test: same((p) => p.facts.camera) },
    lens: { label: "Lens", ops: IS, values: [...new Set(SCENES.map((s) => s.lens))], test: same((p) => p.facts.lens) },
    iso: { label: "ISO", ops: AMOUNT, number: (p) => p.facts.iso },
    focal: { label: "Focal length", ops: IS, values: [...new Set(SCENES.map((s) => s.focal))], test: same((p) => p.facts.focal) },
    aperture: { label: "Aperture", ops: IS, values: [...new Set(SCENES.map((s) => s.aperture))], test: same((p) => p.facts.aperture) },
    shutter: { label: "Shutter speed", ops: IS, values: [...new Set(SCENES.map((s) => s.shutter))], test: same((p) => p.facts.shutter) },
    date: { label: "Capture date", ops: [["gte", "is on or after"], ["lte", "is on or before"]], order: () => "2026-09-12" },
    linked: { label: "Linked", ops: IS, values: ["Yes", "No"], test: same((p) => (p.link ? "Yes" : "No")) },
    name: { label: "File name", ops: [["is", "contains"], ["not", "does not contain"]], test: (p, value) => p.name.toLowerCase().includes(value) },
  };
  function ruleHolds(p, rule) {
    const field = FIELDS[rule.field];
    const value = String(rule.value).trim().toLowerCase();
    if (field.order) {
      const at = field.order(p);
      return rule.op === "gte" ? at >= value : rule.op === "lte" ? at <= value : at === value;
    }
    if (field.number) {
      const [n, v] = [field.number(p), Number(value)];
      return rule.op === "gte" ? n >= v : rule.op === "lte" ? n <= v : n === v;
    }
    return field.test(p, value) === (rule.op !== "not");
  }
  const topFolders = () => PLACES.filter((p) => p.icon === "folder" && !p.offline);
  function matches(p, rules) {
    if (rules.folders && !rules.folders.some((id) => placeOf(id) && inFolder(p, placeOf(id)))) return false;
    const live = rules.list.filter((rule) => String(rule.value).trim() !== "");
    if (!live.length) return false;
    return rules.mode === "any" ? live.some((rule) => ruleHolds(p, rule)) : live.every((rule) => ruleHolds(p, rule));
  }

  function computeShown() {
    const f = state.filters;
    const text = f.text.trim().toLowerCase();
    let list = inPlace(placeOf(state.place)).filter((p) =>
      p.stars >= f.minStars &&
      (!f.picked || p.flag === "pick") &&
      (!f.unmarked || (!p.flag && !p.stars)) &&
      (!f.hideRejected || p.flag !== "reject") &&
      (!f.edited || p.edited) &&
      (!f.labels.size || f.labels.has(p.label)) &&
      (!f.rawOnly || p.kind === "RAW") &&
      f.rules.every((rule) => ruleHolds(p, rule)) &&
      (!text || p.name.toLowerCase().includes(text) || p.tags.some((t) => t.includes(text))));
    const order = { pick: 0, null: 1, reject: 2 };
    const sorts = {
      time: (a, b) => ord(a) - ord(b),
      name: (a, b) => a.name.localeCompare(b.name) || ord(a) - ord(b),
      rating: (a, b) => b.stars - a.stars || ord(a) - ord(b),
      pick: (a, b) => order[a.flag] - order[b.flag] || ord(a) - ord(b),
    };
    Object.assign(sorts, {
      type: (a, b) => a.kind.localeCompare(b.kind) || ord(a) - ord(b),
      modified: (a, b) => (b.edited ? 1 : 0) - (a.edited ? 1 : 0) || ord(a) - ord(b),
      edited: (a, b) => (b.edited ? 1 : 0) - (a.edited ? 1 : 0) || ord(a) - ord(b),
    });
    state.shown = list.sort(sorts[state.sort]);
    if (state.sortDown) state.shown.reverse();
  }

  // ---------- navigation rail ----------

  function renderNav() {
    const rows = [];
    const row = (p, depth) => {
      const count = p.offline ? "" : inPlace(p).length;
      rows.push(`<button type="button" class="nav-row${p.id === state.place ? " selected" : ""}${p.offline ? " offline" : ""}" style="--depth:${depth}" data-place="${p.id}">
        ${icon("twist", "twist" + (p.children ? (p.open ? " open" : "") : " none"))}${icon(p.icon)}
        <span class="label">${p.label}</span>
        <span class="${p.note || p.offline || (p.missing && p.missing.size) ? "note" : "count"}">${p.offline ? "offline" : p.note || (p.missing && p.missing.size ? p.missing.size + " missing" : count)}</span></button>`);
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
    if (add) {
      if (add.title === "Add folder") return openPicker();
      if (add.title === "Open project") return openProject();
      const at = add.getBoundingClientRect();
      const list = targets();
      return openMenu(at.left, at.bottom + 4, [
        { label: list.length ? `New album from ${plural(list.length, "selected photo")}…` : "New album…", action: () => newAlbum(list) },
        { label: "New smart album…", action: () => openRules(null) },
      ]);
    }
    const button = event.target.closest(".nav-row");
    if (!button) return;
    const place = placeOf(button.dataset.place);
    if (place.offline) toast("This drive is not connected. Its photos stay listed, and marks and tags still work.");
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
    const copies = copiesOf(p).length;
    if (p.link) right.push(`<span class="copy" title="Linked with ${plural(mates(p).length - 1, "other photo")}: a grade change to one reaches all">${icon("link")}</span>`);
    if (p.hdr && app.dataset.hdr === "on") right.push(`<span class="hdr-tag" title="Showing its HDR preview">HDR</span>`);
    if (copies) right.push(`<span class="copy" title="Has ${plural(copies, "virtual copy", "virtual copies")}">+${copies}</span>`);
    if (p.copyOf !== undefined) right.push(`<span class="copy" title="Virtual copy: ${esc(p.copyName)}">${icon("copy")}</span>`);
    if (p.edited) right.push(icon("edited"));
    if (p.flag === "pick") right.push(icon("flag"));
    if (p.flag === "reject") right.push(icon("reject"));
    return `${labelDot(p)}<span class="stars">${"★".repeat(p.stars)}</span><span class="right">${right.join("")}</span>`;
  }

  // The focus and exposure maps are small images kept beside the thumbnails
  // and drawn over them. They load only once an overlay is switched on.
  const mapSrc = (kind, p) => `photos/${kind}/${pic(p)}.png`;
  const MAPS = ["focus", "high", "low"];
  const overlayImgs = (p) => MAPS.map((kind) => `<img class="ov ov-${kind}" src="${mapSrc(kind, p)}" alt="" loading="lazy">`).join("");

  // Colour labels: a small dot, keys 6 to 9. The same key again clears it.
  const LABELS = ["red", "orange", "green", "blue"];
  const labelDot = (p) => (p.label ? `<i class="label-dot" style="background:var(--label-${p.label})" title="${esc(labelTitle(p.label))}"></i>` : "");

  function cellHtml(p) {
    return `<div class="cell" data-id="${p.id}"><div class="frame"><img src="photos/t/${pic(p)}.jpg" alt="" loading="lazy" draggable="true">${overlayImgs(p)}</div>
      <div class="marks"></div><div class="name"><span>${esc(title(p))}</span><span>${p.kind}</span></div></div>`;
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
      : total ? "<p>No photos match the filter.</p>"
        : place.ids ? "<p>This album is empty.</p><small>Drag photos onto it in the left panel, or right-click photos and choose Add to album.</small>"
          : place.rules ? "<p>No photos match these rules yet.</p><small>Right-click the smart album to edit its rules.</small>" : "<p>No photos here yet.</p>";
    $("place-title").textContent = place ? place.label : "Library";
    $("place-count").textContent = state.shown.length === total ? String(total) : `${state.shown.length} of ${total}`;
    renderFilmstrip();
  }

  function renderFilmstrip() {
    $("filmstrip").innerHTML = state.shown.map(cellHtml).join("");
  }

  // Repaint marks and selection without rebuilding the thumbnails.
  function refresh() {
    const here = placeOf(state.place);
    document.querySelectorAll(".cell").forEach((cell) => {
      const p = byId(Number(cell.dataset.id));
      cell.classList.toggle("selected", state.sel.has(p.id));
      cell.classList.toggle("active", state.active === p.id);
      cell.classList.toggle("rejected", p.flag === "reject");
      cell.classList.toggle("reference", state.view === "compare" && state.ref === p.id);
      cell.querySelector(".marks").innerHTML = marksHtml(p);
      // The grid shows the saved grade, and the HDR preview where one exists and HDR is on.
      cell.querySelector(".frame img").style.filter = [p.look, p.hdr && app.dataset.hdr === "on" ? `brightness(${(1 + 0.28 * hdr.cap / 1000).toFixed(2)}) contrast(1.06)` : ""].filter(Boolean).join(" ");
      cell.classList.toggle("offline", !!(here && here.offline));
      cell.classList.toggle("missing", !!(here && here.missing && here.missing.has(p.id)));
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
    syncSizeSlider();
    syncStripScroll();
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
    $("status").innerHTML = parts.map((t) => `<span>${t}</span>`).join("") + exportStatus() + jobsStatus() + legend.join("");
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
    state.undo.push(list.map((p) => ({ p, stars: p.stars, flag: p.flag, label: p.label })));
    list.forEach(change);
    sync(list);
    flash(label);
    const advance = $("opt-advance").checked && list.length === 1;
    computeShown();
    if (state.shown.length !== document.querySelectorAll("#grid .cell").length) renderGrid(false);
    if (advance) move(1); else refresh();
  }

  const setStars = (n) => mark((p) => { p.stars = n; }, n ? "★".repeat(n) : "No stars");
  const setLabel = (label) => {
    const clear = targets().every((p) => p.label === label);
    mark((p) => { p.label = clear ? null : label; }, clear ? "No label" : label[0].toUpperCase() + label.slice(1) + " label");
  };
  const setFlag = (flag) => mark((p) => { p.flag = flag; }, flag === "pick" ? "Picked" : flag === "reject" ? "Rejected" : "Unmarked");

  function undo() {
    const last = state.undo.pop();
    if (!last) return;
    if (last.back) {
      last.back();
      computeShown();
      renderNav();
      renderGrid(false);
      refresh();
      if ($("tags").open) renderTags();
      return toast(last.text);
    }
    if (last.pasted) {
      last.pasted.forEach(({ p, edited, before, look }) => { p.edited = edited; p.before = before; p.look = look; });
      if (last.also) last.also();
      computeShown();
      renderGrid(false);
      refresh();
      return toast(`Undid ${last.what} on ${plural(last.pasted.length, "photo")}`);
    }
    if (last.deleted) {
      last.deleted.forEach(({ p, at }) => photos.splice(at, 0, p));
      computeShown();
      renderNav();
      renderGrid(false);
      refresh();
      return toast(`Restored ${last.deleted.length} from the Recycle Bin`);
    }
    last.forEach(({ p, stars, flag, label }) => { p.stars = stars; p.flag = flag; p.label = label; });
    sync(last.map((entry) => entry.p));
    computeShown();
    renderGrid(false);
    refresh();
    toast(last.length > 1 ? `Undid marks on ${last.length} photos` : "Undid last mark");
  }

  // ---------- single photo and full-screen review ----------

  const large = (p) => `photos/${pic(p)}.jpg`;

  // One photo in a stage: fitted, or at 100% and draggable. The zoom and the
  // spot being looked at are kept while flipping, so the same detail can be
  // checked across a run of frames.
  const ZOOM_EDGE = 1600;

  function place(img, p) {
    const box = img.parentElement.getBoundingClientRect();
    img.classList.toggle("zoomed", state.zoom.on);
    let css = "";
    if (state.zoom.on) {
      const scale = ZOOM_EDGE / Math.max(p.w, p.h);
      const [w, h] = [p.w * scale, p.h * scale];
      const edge = (size, room, f) => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, room / 2 - f * size)));
      css = `width:${w}px;height:${h}px;left:${edge(w, box.width, state.zoom.fx)}px;top:${edge(h, box.height, state.zoom.fy)}px`;
    }
    // The look is drawn on the photo only, never on the overlay maps.
    img.style.cssText = css + (p.look ? `;filter:${p.look}` : "");
    img.parentElement.querySelectorAll(".stage-ov").forEach((o) => {
      const src = mapSrc(o.dataset.kind, p);
      if (o.getAttribute("src") !== src) o.src = src;
      o.classList.toggle("zoomed", state.zoom.on);
      o.style.cssText = css;
    });
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
      if (fresh) img.src = slow ? `photos/t/${pic(p)}.jpg` : large(p);
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
  }

  function renderReview() {
    const p = current();
    if (!p) return;
    show($("review-image"), p);
    $("review-image").classList.toggle("rejected", p.flag === "reject");
    $("review-marks").innerHTML = `${labelDot(p)}<span class="stars">${"★".repeat(p.stars)}</span>${p.flag ? icon(p.flag === "pick" ? "flag" : "reject") : ""}${state.zoom.on ? "<span>100%</span>" : ""}`;
  }

  const captionMarks = (p) => `${labelDot(p)}<span class="stars">${"★".repeat(p.stars)}</span>${p.flag ? icon(p.flag === "pick" ? "flag" : "reject") : ""}`;

  function renderCompare() {
    const [r, c] = [byId(state.ref), current()];
    if (!r || !c) return;
    show($("compare-ref-image"), r);
    show($("compare-image"), c);
    $("compare-ref-image").classList.toggle("rejected", r.flag === "reject");
    $("compare-image").classList.toggle("rejected", c.flag === "reject");
    $("compare-ref-caption").innerHTML = `<span>${esc(title(r))}</span>${captionMarks(r)}`;
    $("compare-caption").innerHTML = `<span>${esc(title(c))}</span>${captionMarks(c)}<span>${state.shown.indexOf(c) + 1} / ${state.shown.length}</span><span>${state.zoom.on ? "100%" : "Fit"}</span>`;
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

  // ---------- questions ----------
  // One small window for every question: a title, a sentence, optional fields
  // and the answers. Escape is the same as Cancel.

  function askUser({ title: heading, message, fields = [], buttons }, done) {
    $("confirm-title").textContent = heading;
    $("confirm-message").textContent = message || "";
    $("confirm-fields").innerHTML = fields.map((f) => `<label class="lib-export-field"><span>${f.label}</span>` + (f.options
      ? `<select data-name="${f.name}">${f.options.map((o) => `<option ${o === f.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
      : `<input type="text" data-name="${f.name}" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}" spellcheck="false">`) + `</label>`).join("");
    $("confirm-actions").innerHTML = buttons.map(([answer, text, cls]) => `<button type="button" data-answer="${answer}" class="${cls || ""}">${text}</button>`).join("");
    $("confirm").onclick = (event) => {
      const answer = event.target.dataset && event.target.dataset.answer;
      if (!answer) return;
      const values = {};
      $("confirm-fields").querySelectorAll("[data-name]").forEach((el) => { values[el.dataset.name] = el.value.trim(); });
      $("confirm").close();
      done(answer, values);
    };
    $("confirm").showModal();
    const first = $("confirm-fields").querySelector("input, select") || $("confirm-actions").lastElementChild;
    first.focus();
    if (first.select) first.select();
  }
  $("confirm").addEventListener("close", () => { $("confirm-fields").innerHTML = ""; });
  $("confirm").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.target.matches("input[type=text]")) return;
    event.preventDefault();
    $("confirm-actions").lastElementChild.click();
  });
  const GO = "button-primary lib-confirm-go";

  // ---------- Grade stand-in, and saving ----------
  // Only one photo is open in Grade at a time, so only one photo can ever have
  // unsaved work. The library always shows the saved grade.

  const grade = { photo: null, dirty: false, draft: null, saving: null, edits: 0 };
  const autosaveOn = () => $("autosave").getAttribute("aria-pressed") === "true";
  const DRAFTS = ["brightness(1.14) contrast(1.06)", "saturate(1.35) contrast(1.08)", "sepia(.22) brightness(1.05)"];

  function setStage(stage) {
    app.dataset.stage = stage;
    $("grade-stage").hidden = stage !== "grade";
    document.querySelectorAll("[data-stage-tab]").forEach((t) => t.classList.toggle("active", t.dataset.stageTab === stage));
    renderGrade();
  }

  function renderGrade() {
    const p = grade.photo;
    const auto = autosaveOn();
    $("grade-image").hidden = !p;
    if (p) {
      $("grade-image").src = large(p);
      $("grade-image").style.filter = (grade.draft === null ? p.look : grade.draft) || "";
    }
    $("grade-name").textContent = p ? title(p) + (p.link ? ` · linked with ${plural(mates(p).length - 1, "other photo")}` : "") : "";
    $("grade-save").textContent = !p ? "" : grade.saving ? "Saving…" : grade.dirty ? "Unsaved changes" : auto ? "All changes saved" : "No unsaved changes";
    $("grade-save").classList.toggle("dirty", grade.dirty && !grade.saving);
    $("grade-save-button").hidden = $("grade-revert").hidden = !grade.dirty || auto;
    $("mock-edit").disabled = !p || app.dataset.stage !== "grade";
    document.querySelector('[data-stage-tab="grade"]').classList.toggle("unsaved", grade.dirty && !auto);
    $("grade-note").textContent = !p ? "No photo open. Double-click a photo in the Library window."
      : auto
        ? "Stand-in for the Grade workspace. Autosave is on: changes save beside the photo a moment after you stop, and switching photos never asks. Try “Make a pretend edit” in the yellow strip."
        : "Stand-in for the Grade workspace. Autosave is off: nothing is written until you save (Ctrl+S). Switching photos or closing the app asks first. Try “Make a pretend edit” in the yellow strip.";
  }

  function saveGrade() {
    const p = grade.photo;
    clearTimeout(grade.saving);
    grade.saving = null;
    if (!p || !grade.dirty) return renderGrade();
    if (!p.session) p.session = { look: p.look, edited: p.edited };
    if (grade.draft !== null) p.look = grade.draft;
    p.edited = true;
    // Linked photos share one grade: saving one reaches the others.
    const others = mates(p).filter((o) => o !== p);
    others.forEach((o) => {
      if (!o.session) o.session = { look: o.look, edited: o.edited };
      Object.assign(o, { before: { look: o.look, edited: o.edited }, look: p.look, edited: true });
    });
    if (others.length) toast(`Saved, and applied to ${plural(others.length, "linked photo")}.`);
    Object.assign(grade, { draft: null, dirty: false });
    renderGrade();
    refresh();
  }

  function dropGrade() {
    clearTimeout(grade.saving);
    Object.assign(grade, { draft: null, dirty: false, saving: null });
    renderGrade();
  }

  // Stands in for moving a slider on the Grade stage.
  function pretendEdit() {
    if (!grade.photo) return;
    grade.draft = DRAFTS[grade.edits++ % DRAFTS.length];
    grade.dirty = true;
    clearTimeout(grade.saving);
    grade.saving = autosaveOn() ? setTimeout(saveGrade, 900) : null;
    renderGrade();
  }

  // The one gate for leaving the open photo: opening another photo or virtual
  // copy, and closing the app. Browsing, culling and comparing never come here.
  function leaveCurrentPhoto(proceed, doing) {
    if (!grade.photo || !grade.dirty) return proceed();
    if (autosaveOn()) { saveGrade(); return proceed(); }
    askUser({
      title: "Unsaved changes",
      message: `Save changes to ${title(grade.photo)} before ${doing}?`,
      buttons: [["cancel", "Cancel"], ["drop", "Don't save"], ["save", "Save", GO]],
    }, (answer) => {
      if (answer === "cancel") return;
      if (answer === "save") saveGrade(); else dropGrade();
      proceed();
    });
  }

  function showInGrade(p) {
    Object.assign(grade, { photo: p || null, dirty: false, draft: null });
    setStage("grade");
  }

  function openInGrade() {
    const p = current();
    if (!p) return;
    if (POPPED) {
      tell({ lib: "grade", id: p.id });
      return toast(`Opening ${title(p)} in Grade in the main window.`);
    }
    const here = placeOf(state.place) || {};
    if (here.offline) return toast(`${p.name} is on a drive that is not connected. Connect it to open the photo in Grade.`);
    if (here.missing && here.missing.has(p.id)) return toast(`${p.name} is missing. Right-click the project and choose Relink photos.`);
    if (state.review) setReview(false);
    if (p === grade.photo) return setStage("grade");
    leaveCurrentPhoto(() => showInGrade(p), "opening " + title(p));
  }

  document.querySelectorAll("[data-stage-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const stage = tab.dataset.stageTab;
    if (stage === "library") return popOpen() ? pop.focus() : setStage("library");
    // Going back to Grade returns to the photo that is open there.
    if (stage === "grade") return grade.photo || popOpen() ? setStage("grade") : openInGrade();
    toast("Proof and Export are not part of this mock-up.");
  }));

  $("autosave").addEventListener("click", () => {
    const on = !autosaveOn();
    $("autosave").setAttribute("aria-pressed", on);
    $("autosave").querySelector("span").textContent = on ? "Autosave on" : "Autosave off";
    if (on && grade.dirty) saveGrade();
    renderGrade();
  });
  $("grade-save-button").addEventListener("click", saveGrade);
  $("grade-revert").addEventListener("click", dropGrade);
  document.querySelector(".window-control-close").addEventListener("click", () => {
    if (!POPPED) leaveCurrentPhoto(() => toast("HDR Finisher would close here."), "closing HDR Finisher");
  });

  document.querySelectorAll(".stub-grade-list").forEach((list) => {
    list.innerHTML = ["Crop & Rotate", "Perspective", "Denoise", "Tone", "Exposure Bands", "Lift, Gamma, Gain", "Highlight Compression", "Curves", "Color", "Color Grading", "Local Adjustments", "Detail", "Film Look"]
      .map((name, i) => `<div class="stub-row"><i>${String(i + 2).padStart(2, "0")}</i>${icon("twist")}${name}</div>`).join("");
  });

  // ---------- details ----------

  // Names for the colour labels, and the authoring template. Both are personal
  // settings, remembered between launches.
  const labelNames = { red: "", orange: "", green: "", blue: "" };
  const template = { creator: "", copyright: "", usage: "" };
  try {
    Object.assign(labelNames, JSON.parse(recall("label-names", "{}")));
    Object.assign(template, JSON.parse(recall("template", "{}")));
  } catch (e) { /* start empty */ }
  const labelTitle = (label) => (labelNames[label] ? `${labelNames[label]} · ${label} label` : `${cap(label)} label`);

  // What each pretend camera wrote into its files. Anything a camera did not
  // record is shown as not recorded, never guessed.
  const MAKER = {
    "Sony ILCE-7RM5": { maker: "Sony", serial: "4871236", firmware: "3.01", type: "Sony ARW, lossless compressed, 14-bit", mb: 1.05, lensMaker: "Sony", lensSerial: "1802244", comp: "−0.3 EV", program: "Aperture priority", metering: "Multi-segment", wb: "Auto", focusMode: "Continuous AF", afArea: "Tracking: Flexible Spot M", distance: "4.2 m", drive: "Continuous Hi", shutter: "Electronic", steady: "On, body and lens", profile: "Off", crop: "Full frame" },
    "Apple iPhone 12 Pro": { maker: "Apple", firmware: "iOS 17.6", type: "HEIC, 10-bit", mb: 0.22, comp: "0 EV", program: "Program", metering: "Multi-segment", wb: "Auto", gps: "6.3041° N, 99.8523° E" },
    "DJI Mavic 3": { maker: "DJI", serial: "1581F45TB22A", firmware: "01.00.0900", type: "DNG, uncompressed, 12-bit", mb: 1.9, lensMaker: "Hasselblad", comp: "0 EV", program: "Manual", metering: "Centre-weighted", wb: "Daylight", shutter: "Electronic", gps: "6.3718° N, 99.6712° E · 84 m" },
  };
  const none = (text) => `<i class="unk">${text}</i>`;
  const dl = (rows) => `<dl class="details-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;

  function folderPath(p) {
    const top = PLACES.find((f) => f.icon === "folder" && f.children && inFolder(p, f));
    const sub = top && top.children.find((c) => inFolder(p, c));
    return top ? `D:\\Photos\\${top.label}${sub ? "\\" + sub.label : ""}` : "E:\\DCIM\\100MSDCF";
  }

  // The lens is the unreliable part: unknown stays unknown, and a name can be typed in.
  function lensHtml(p) {
    const set = `<button type="button" class="details-link" data-set-lens>${p.lensByHand ? "Change" : "Set name"}…</button>`;
    if (p.lensByHand) return `${esc(p.lensByHand)}<br>${none("entered by hand")} ${set}`;
    return p.facts.lens === "Unknown" ? `${none("Unknown")} ${set}` : p.facts.lens;
  }

  function allFacts(p) {
    const m = MAKER[p.facts.camera];
    const or = (value) => value || none("Not recorded");
    const mp = (p.w * p.h) / 1e6;
    const marked = p.edited || p.stars || p.flag || p.label || p.copyOf !== undefined || copiesOf(p).length;
    return [
      ["File", [["File name", p.name], ["Folder", folderPath(p)], ["Type", p.kind === "JPG" ? "JPEG, 8-bit" : m.type], ["Dimensions", `${p.w} × ${p.h}`],
        ["Megapixels", mp.toFixed(1) + " MP"], ["File size", (mp * (p.kind === "JPG" ? 0.42 : m.mb)).toFixed(1) + " MB"], ["Captured", p.time + ":07"],
        ["Settings file", marked ? "Beside the photo" : none("None yet")]]],
      ["Camera", [["Maker", m.maker], ["Model", p.facts.camera.replace(m.maker + " ", "")], ["Serial number", or(m.serial)], ["Firmware", m.firmware]]],
      ["Lens", [["Lens", lensHtml(p)], ["Lens maker", p.lensByHand ? none("Not recorded") : or(m.lensMaker)], ["Lens serial", p.lensByHand ? none("Not recorded") : or(m.lensSerial)], ["Focal length", p.facts.focal]]],
      ["Exposure", [["Shutter", p.facts.shutter + " s"], ["Aperture", p.facts.aperture], ["ISO", p.facts.iso], ["Compensation", m.comp], ["Program", m.program], ["Metering", m.metering], ["White balance", m.wb], ["Flash", "Did not fire"]]],
      ["Focus and drive", [["Focus mode", or(m.focusMode)], ["Focus area", or(m.afArea)], ["Focus distance", or(m.distance)], ["Drive mode", or(m.drive)], ["Shutter type", or(m.shutter)], ["Stabilisation", or(m.steady)], ["Picture profile", or(m.profile)], ["Crop mode", or(m.crop)]],
        "Each camera maker records these differently. They are shown where the camera wrote them."],
      ["Location", [["GPS", or(m.gps)]], "Location and serial numbers can be left out of exported files."],
    ];
  }

  function renderDetails() {
    const list = targets();
    const titleBar = `<div class="details-title"><span class="panel-title">Details</span>${collapseButton("details", "details")}</div>`;
    if (!list.length) {
      $("details").innerHTML = titleBar + `<p class="details-sub">Nothing selected.</p>`;
      return;
    }
    const one = list.length === 1 ? list[0] : null;
    const shared = (get) => (list.every((p) => get(p) === get(list[0])) ? get(list[0]) : undefined);
    const stars = shared((p) => p.stars);
    const flag = shared((p) => p.flag);
    const tagCount = {};
    list.forEach((p) => p.tags.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const copies = one ? copiesOf(one).length : 0;
    const inAlbums = one ? PLACES.filter((a) => a.ids && a.ids.has(one.id)).map((a) => esc(a.label)) : [];
    const head = one
      ? `<p class="details-name">${esc(one.name)}</p>` +
        (one.copyOf === undefined ? "" : `<p class="details-sub">Virtual copy “${esc(one.copyName)}”. Its own grade, marks and tags. No second image file.</p>`) +
        `<p class="details-sub">${one.kind} · ${one.w} × ${one.h} · ${one.time}</p>
         <p class="details-sub">${one.edited ? "Edited" : "Not edited"}${one.exported ? " · Exported" : ""}${copies ? ` · ${plural(copies, "virtual copy", "virtual copies")}` : ""}</p>` +
        (inAlbums.length ? `<p class="details-sub">In ${inAlbums.join(", ")}</p>` : "")
      : `<p class="details-name">${list.length} photos selected</p><p class="details-sub">Marks and tags apply to all of them.</p>`;
    const tagChip = (t) => {
      const some = tagCount[t] < list.length;
      return `<span class="${some ? "some" : ""}" ${some ? `data-tag-all="${esc(t)}" title="On ${tagCount[t]} of the ${list.length} selected photos. Click to add it to all of them."` : ""}>${esc(t)}<button type="button" data-untag="${esc(t)}" title="Remove from the selection" aria-label="Remove tag ${esc(t)}">×</button></span>`;
    };
    const author = (name) => (template[name] ? esc(template[name]) : none("Not set"));
    const facts = !one ? "" : !state.allFacts
      ? `<div class="details-section"><p class="details-kicker">Camera</p>${dl([["Camera", one.facts.camera], ["Lens", lensHtml(one)], ["Focal length", one.facts.focal],
          ["Aperture", one.facts.aperture], ["Shutter", one.facts.shutter + " s"], ["ISO", one.facts.iso]])}
          <button type="button" class="details-more" data-all-facts>Show all</button></div>`
      : allFacts(one).map(([kicker, rows, foot]) => `<div class="details-section"><p class="details-kicker">${kicker}</p>${dl(rows)}${foot ? `<p class="helper details-foot">${foot}</p>` : ""}</div>`).join("") +
        `<div class="details-section"><p class="details-kicker">Authoring · written into exported files</p>
          <label class="lib-export-field"><span>Title</span><input type="text" data-author="title" value="${esc(one.title || "")}" spellcheck="false"></label>
          <label class="lib-export-field"><span>Caption</span><input type="text" data-author="caption" value="${esc(one.caption || "")}" spellcheck="false"></label>
          ${dl([["Creator", author("creator")], ["Copyright", author("copyright")], ["Usage", author("usage")]])}
          <button type="button" class="details-more" data-template>Edit template…</button></div>
        <button type="button" class="details-more" data-all-facts>Show less</button>`;
    $("details").innerHTML = titleBar + head + `
      <div class="details-section"><p class="details-kicker">Marks</p>
        <div class="details-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-stars="${n}" class="${stars >= n ? "on" : ""}" aria-label="${n} stars">★</button>`).join("")}</div>
        <div class="details-labels">${LABELS.map((l) => `<button type="button" data-label="${l}" class="${list.every((p) => p.label === l) ? "on" : ""}" title="${esc(labelTitle(l))}" aria-label="${esc(labelTitle(l))}"><i style="background:var(--label-${l})"></i></button>`).join("")}</div>
        <div class="details-flags">${[["pick", "Pick"], ["", "Unmarked"], ["reject", "Reject"]].map(([v, l]) => `<button type="button" data-flag="${v}" class="${flag !== undefined && (flag || "") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="details-section"><p class="details-kicker">Tags</p>
        <div class="details-tags">${Object.keys(tagCount).sort().map(tagChip).join("")}<input type="text" placeholder="Add tag" spellcheck="false" autocomplete="off"></div>
        <div class="tag-suggest" id="tag-suggest" hidden></div>
        <button type="button" class="details-more" data-manage-tags>Manage tags and labels…</button>
      </div>` + facts;
  }

  // ---------- tags ----------
  // Tags save at once and are never unsaved work. Every change is one undo.

  // The library's list of tags. A tag stays on the list, even on no photos,
  // until it is removed in the Tags and Labels window.
  let tagList = new Set(photos.flatMap((p) => p.tags));
  const allTags = () => {
    const known = new Map([...tagList].map((t) => [t, 0]));
    photos.forEach((p) => p.tags.forEach((t) => known.set(t, (known.get(t) || 0) + 1)));
    return known;
  };

  function editTags(list, change, text) {
    const before = list.map((p) => ({ p, tags: p.tags.slice() }));
    const listBefore = new Set(tagList);
    list.forEach(change);
    list.forEach((p) => p.tags.forEach((t) => tagList.add(t)));
    state.undo.push({ back: () => { before.forEach(({ p, tags }) => { p.tags = tags; }); tagList = listBefore; }, text });
    renderNav();
  }

  function addTag(tag) {
    tag = tag.trim().toLowerCase();
    const list = targets().filter((p) => !p.tags.includes(tag));
    if (tag && list.length) editTags(list, (p) => p.tags.push(tag), `Undid tag “${tag}” on ${plural(list.length, "photo")}`);
    renderDetails();
    const input = $("details").querySelector(".details-tags input");
    if (input) { input.focus(); renderSuggest(input); }
  }

  function removeTag(tag) {
    const list = targets().filter((p) => p.tags.includes(tag));
    editTags(list, (p) => { p.tags = p.tags.filter((t) => t !== tag); }, `Put tag “${tag}” back on ${plural(list.length, "photo")}`);
    renderDetails();
  }

  // Suggestions while typing: tags already in the library, most likely first.
  let suggestAt = -1;
  function renderSuggest(input) {
    const box = $("tag-suggest");
    if (!box) return;
    const typed = input.value.trim().toLowerCase();
    const list = targets();
    const known = allTags();
    const rows = [...known].filter(([t]) => t.includes(typed) && !list.every((p) => p.tags.includes(t)))
      .sort((a, b) => (b[0].startsWith(typed) - a[0].startsWith(typed)) || b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
    suggestAt = Math.min(suggestAt, rows.length - 1);
    box.innerHTML = rows.map(([t, n], i) => `<button type="button" data-suggest="${esc(t)}" class="${i === suggestAt ? "on" : ""}"><span>${esc(t)}</span><span class="count">${n}</span></button>`).join("") +
      (typed && !known.has(typed) ? `<p>Enter adds the new tag “${esc(typed)}”</p>` : "");
    box.hidden = !box.innerHTML;
  }

  $("details").addEventListener("click", (event) => {
    if (event.target.closest(".side-collapse")) return toggleSide("details");
    const hit = (selector) => event.target.closest(selector);
    const label = hit("[data-label]");
    const star = hit("[data-stars]");
    const flag = hit("[data-flag]");
    if (label) return setLabel(label.dataset.label);
    if (star) {
      const n = Number(star.dataset.stars);
      return setStars(targets().every((p) => p.stars === n) ? 0 : n);
    }
    if (flag) return setFlag(flag.dataset.flag || null);
    if (hit("[data-untag]")) return removeTag(hit("[data-untag]").dataset.untag);
    if (hit("[data-tag-all]")) return addTag(hit("[data-tag-all]").dataset.tagAll);
    if (hit("[data-manage-tags]")) return openTags();
    if (hit("[data-all-facts]")) { state.allFacts = !state.allFacts; return renderDetails(); }
    const p = targets()[0];
    if (hit("[data-set-lens]")) {
      return askUser({ title: "Lens Name", message: `${p.name} does not say which lens was used. That is usual for adapted and manual lenses. A name typed here is kept with the photo and marked as entered by hand.`,
        fields: [{ name: "lens", label: "Lens", value: p.lensByHand || "", placeholder: "For example Helios 44-2 58mm F2" }], buttons: [["no", "Cancel"], ["yes", "Set lens name", GO]] },
      (answer, v) => { if (answer === "yes") { p.lensByHand = v.lens; renderDetails(); } });
    }
    if (hit("[data-template]")) {
      return askUser({ title: "Authoring Template", message: "Entered once and written into every exported file. Title and caption stay per photo.",
        fields: [{ name: "creator", label: "Creator", value: template.creator, placeholder: "Your name" }, { name: "copyright", label: "Copyright", value: template.copyright, placeholder: "© 2026 Your name" },
          { name: "usage", label: "Usage notes", value: template.usage, placeholder: "For example: All rights reserved" }], buttons: [["no", "Cancel"], ["yes", "Save template", GO]] },
      (answer, v) => { if (answer === "yes") { Object.assign(template, v); remember("template", JSON.stringify(template)); renderDetails(); } });
    }
  });
  $("details").addEventListener("change", (event) => {
    if (event.target.dataset.author) targets()[0][event.target.dataset.author] = event.target.value;
  });
  const isTagInput = (event) => event.target instanceof Element && event.target.matches(".details-tags input");
  $("details").addEventListener("input", (event) => { if (isTagInput(event)) { suggestAt = -1; renderSuggest(event.target); } });
  $("details").addEventListener("focusin", (event) => { if (isTagInput(event)) { suggestAt = -1; renderSuggest(event.target); } });
  $("details").addEventListener("focusout", (event) => { if (isTagInput(event) && $("tag-suggest")) $("tag-suggest").hidden = true; });
  $("details").addEventListener("mousedown", (event) => {
    const pick = event.target.closest("[data-suggest]");
    if (!pick) return;
    event.preventDefault();
    addTag(pick.dataset.suggest);
  });
  $("details").addEventListener("keydown", (event) => {
    if (!isTagInput(event)) return;
    const rows = $("tag-suggest").querySelectorAll("[data-suggest]");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      suggestAt = Math.max(-1, Math.min(rows.length - 1, suggestAt + (event.key === "ArrowDown" ? 1 : -1)));
      return renderSuggest(event.target);
    }
    if (event.key === "Enter") addTag(suggestAt >= 0 && rows[suggestAt] ? rows[suggestAt].dataset.suggest : event.target.value);
  });

  // Tag management: every tag in the library with its count. Rename, merge or
  // remove a tag everywhere. Colour labels can be given a meaning here.
  const tagsUi = { sel: new Set(), sort: "name" };

  function renderTags() {
    const known = allTags();
    [...tagsUi.sel].forEach((t) => { if (!known.has(t)) tagsUi.sel.delete(t); });
    const find = $("tags-search").value.trim().toLowerCase();
    const rows = [...known].filter(([t]) => t.includes(find)).sort((a, b) => (tagsUi.sort === "count" ? b[1] - a[1] : 0) || a[0].localeCompare(b[0]));
    $("tags-list").innerHTML = `<div class="paste-kicker">Colour labels · give each a meaning if you like</div>` +
      LABELS.map((l, i) => `<div class="tag-row"><i class="label-dot" style="background:var(--label-${l})"></i><input type="text" data-label-name="${l}" value="${esc(labelNames[l])}" placeholder="${cap(l)} · key ${i + 6}" spellcheck="false"><span class="count">${photos.filter((p) => p.label === l).length}</span></div>`).join("") +
      `<div class="paste-kicker tags-kicker"><span>Tags</span><button type="button" class="text-button" id="tags-new">+ New tag</button></div>` +
      (rows.length ? rows.map(([t, n]) => `<button type="button" class="tag-row${tagsUi.sel.has(t) ? " selected" : ""}" data-tag="${esc(t)}"><span class="name">${esc(t)}</span><span class="count">${n}</span></button>`).join("")
        : `<p class="tags-none">${find ? "No tag matches." : "No tags yet."}</p>`);
    const sel = [...tagsUi.sel];
    const on = photos.filter((p) => sel.some((t) => p.tags.includes(t))).length;
    $("tags-notes").textContent = !sel.length ? `${plural(known.size, "tag")} in the library. Click one to select it. Ctrl-click to select several, then merge them into one.`
      : sel.length === 1 ? (on ? `“${sel[0]}” is on ${plural(on, "photo")}.` : `“${sel[0]}” is not on any photo yet.`) : `${sel.length} tags selected, on ${plural(on, "photo")} between them.`;
    $("tags-show").disabled = $("tags-rename").disabled = sel.length !== 1;
    $("tags-merge").disabled = sel.length < 2;
    $("tags-delete").disabled = !sel.length;
    document.querySelectorAll("[data-tagsort]").forEach((b) => b.classList.toggle("on", b.dataset.tagsort === tagsUi.sort));
  }

  function openTags() {
    tagsUi.sel.clear();
    $("tags-search").value = "";
    renderTags();
    $("tags").showModal();
  }

  // Replace some tags by one (rename and merge), or by nothing (remove).
  function retag(olds, to, text) {
    const list = photos.filter((p) => olds.some((t) => p.tags.includes(t)));
    editTags(list, (p) => {
      p.tags = p.tags.filter((t) => !olds.includes(t));
      if (to && !p.tags.includes(to)) p.tags.push(to);
    }, text);
    olds.forEach((t) => tagList.delete(t));
    if (to) tagList.add(to);
    tagsUi.sel = new Set(to ? [to] : []);
    filtersChanged();
    renderTags();
  }

  $("tags").addEventListener("click", (event) => {
    const row = event.target.closest("[data-tag]");
    const sort = event.target.closest("[data-tagsort]");
    const sel = [...tagsUi.sel];
    const count = (tags) => photos.filter((p) => tags.some((t) => p.tags.includes(t))).length;
    if (row) {
      const tag = row.dataset.tag;
      if (event.ctrlKey || event.metaKey) tagsUi.sel.has(tag) ? tagsUi.sel.delete(tag) : tagsUi.sel.add(tag);
      else tagsUi.sel = new Set(tagsUi.sel.has(tag) && tagsUi.sel.size === 1 ? [] : [tag]);
    } else if (sort) tagsUi.sort = sort.dataset.tagsort;
    else if (event.target.id === "tags-new") {
      return askUser({ title: "New Tag", message: "The tag is added to the list and offered as a suggestion when you tag photos.", fields: [{ name: "name", label: "Name", placeholder: "Tag name" }], buttons: [["no", "Cancel"], ["yes", "Add tag", GO]] }, (answer, v) => {
        const name = v.name.toLowerCase();
        if (answer !== "yes" || !name) return;
        const fresh = !tagList.has(name);
        const listBefore = new Set(tagList);
        tagList.add(name);
        if (fresh) state.undo.push({ back: () => { tagList = listBefore; }, text: `Took the new tag “${name}” off the list again` });
        tagsUi.sel = new Set([name]);
        $("tags-search").value = "";
        renderTags();
        const row = [...$("tags-list").querySelectorAll("[data-tag]")].find((r) => r.dataset.tag === name);
        if (row) row.scrollIntoView({ block: "nearest" });
        if (!fresh) toast(`“${name}” is already on the list.`);
      });
    } else if (event.target.id === "tags-close") return $("tags").close();
    else if (event.target.id === "tags-show") {
      $("tags").close();
      state.filters.text = $("search").value = sel[0];
      $("filterbar").hidden = false;
      filtersChanged();
      return toast(`Showing “${sel[0]}” in ${placeOf(state.place).label}. A smart album shows a tag across the whole library.`);
    } else if (event.target.id === "tags-rename") {
      return askUser({ title: `Rename Tag “${sel[0]}”`, message: `${plural(count(sel), "photo")} will carry the new name.`, fields: [{ name: "name", label: "New name", value: sel[0] }], buttons: [["no", "Cancel"], ["yes", "Rename", GO]] }, (answer, v) => {
        const name = v.name.toLowerCase();
        if (answer !== "yes" || !name || name === sel[0]) return;
        if (!allTags().has(name)) return retag(sel, name, `Undid rename of “${sel[0]}”`);
        // A tag of that name exists already: stop and ask, never merge silently.
        askUser({ title: "Merge Tags?", message: `A tag called “${name}” already exists. Merging puts “${name}” on the ${plural(count(sel), "photo")} that carry “${sel[0]}”, and “${sel[0]}” disappears.`,
          buttons: [["no", "Cancel"], ["yes", "Merge", GO]] }, (again) => { if (again === "yes") retag(sel, name, `Undid merge of “${sel[0]}” into “${name}”`); });
      });
    } else if (event.target.id === "tags-merge") {
      return askUser({ title: `Merge ${sel.length} Tags`, message: `${plural(count(sel), "photo")} will carry the name you keep. The other ${sel.length === 2 ? "name disappears" : "names disappear"}.`,
        fields: [{ name: "keep", label: "Keep the name", options: sel.slice().sort(), value: sel[0] }], buttons: [["no", "Cancel"], ["yes", "Merge", GO]] },
      (answer, v) => { if (answer === "yes") retag(sel.filter((t) => t !== v.keep), v.keep, `Undid merge into “${v.keep}”`); });
    } else if (event.target.id === "tags-delete") {
      const what = sel.length === 1 ? `“${sel[0]}”` : `${sel.length} tags`;
      return askUser({ title: `Remove ${what}?`, message: `${cap(what)} will be taken off ${plural(count(sel), "photo")}. The photos themselves are not touched.`,
        buttons: [["no", "Cancel"], ["yes", sel.length === 1 ? "Remove tag" : "Remove tags", "button-danger"]] },
      (answer) => { if (answer === "yes") retag(sel, null, `Put ${what} back`); });
    } else return;
    renderTags();
  });
  $("tags-search").addEventListener("input", renderTags);
  $("tags").addEventListener("change", (event) => {
    const label = event.target.dataset.labelName;
    if (!label) return;
    labelNames[label] = event.target.value.trim();
    remember("label-names", JSON.stringify(labelNames));
    refresh();
  });

  // ---------- filter bar ----------

  $("filter-stars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-min="${n}" title="${n} stars or more">★</button>`).join("") +
    `<span class="lib-filter-labels">${LABELS.map((l) => `<button type="button" data-filter-label="${l}" title="Show ${l} labels" aria-label="Show ${l} labels"><i style="background:var(--label-${l})"></i></button>`).join("")}</span>`;

  function renderFilters() {
    const f = state.filters;
    document.querySelectorAll("[data-min]").forEach((b) => b.classList.toggle("on", Number(b.dataset.min) <= f.minStars));
    document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("on", f[b.dataset.filter]));
    document.querySelectorAll("[data-filter-label]").forEach((b) => b.classList.toggle("on", f.labels.has(b.dataset.filterLabel)));
    const active = (f.minStars ? 1 : 0) + (f.text ? 1 : 0) + f.labels.size + f.rules.length + ["picked", "unmarked", "hideRejected", "edited", "rawOnly"].filter((k) => f[k]).length;
    const opText = (rule) => FIELDS[rule.field].ops.find(([op]) => op === rule.op)[1];
    $("filter-rules").innerHTML = f.rules.map((rule, i) => `<button type="button" class="lib-chip on" data-rule-chip="${i}" title="Click to remove this filter">${FIELDS[rule.field].label} ${opText(rule)} ${esc(rule.value)} ×</button>`).join("");
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
    const tint = event.target.closest("[data-filter-label]");
    const ruleChip = event.target.closest("[data-rule-chip]");
    if (event.target.id === "filter-add") return addFilterMenu(event.target);
    if (ruleChip) f.rules.splice(Number(ruleChip.dataset.ruleChip), 1);
    else if (tint) f.labels.has(tint.dataset.filterLabel) ? f.labels.delete(tint.dataset.filterLabel) : f.labels.add(tint.dataset.filterLabel);
    else if (min) f.minStars = f.minStars === Number(min.dataset.min) ? 0 : Number(min.dataset.min);
    else if (chip) f[chip.dataset.filter] = !f[chip.dataset.filter];
    else if (event.target.id === "filter-clear") {
      Object.assign(f, { minStars: 0, picked: false, unmarked: false, hideRejected: false, edited: false, rawOnly: false, text: "", labels: new Set(), rules: [] });
      $("search").value = "";
    } else if (event.target.id === "filter-save") return openRules(null, filterAsRules());
    else return;
    filtersChanged();
  });
  $("search").addEventListener("input", () => { state.filters.text = $("search").value; filtersChanged(); });
  $("raw-only").addEventListener("click", () => { state.filters.rawOnly = !state.filters.rawOnly; filtersChanged(); });
  $("sort").addEventListener("change", () => { state.sort = $("sort").value; filtersChanged(); });

  // "+ Filter": pick a field, then a value. Each one becomes a chip on the bar.
  function addFilterMenu(button) {
    const at = button.getBoundingClientRect();
    const here = inPlace(placeOf(state.place));
    const add = (rule) => { state.filters.rules.push(rule); filtersChanged(); };
    const fields = ["camera", "lens", "iso", "focal", "aperture", "shutter", "date", "type", "tag", "state", "kind", "linked"];
    openMenu(at.left, at.bottom + 4, [{ header: "Filter by" }, ...fields.map((key) => ({ label: FIELDS[key].label + "…", action: () => {
      const field = FIELDS[key];
      if (key === "date") {
        return askUser({ title: "Capture Date", message: "Leave one end empty for an open range.", fields: [{ name: "from", label: "From", placeholder: "2026-09-01" }, { name: "to", label: "To", placeholder: "2026-09-30" }], buttons: [["no", "Cancel"], ["yes", "Filter", GO]] },
          (answer, v) => { if (answer !== "yes") return; if (v.from) add({ field: key, op: "gte", value: v.from }); if (v.to) add({ field: key, op: "lte", value: v.to }); });
      }
      if (field.number) {
        return askUser({ title: field.label, fields: [{ name: "op", label: field.label, options: field.ops.map(([, text]) => text) }, { name: "value", label: "Value", placeholder: "For example 800" }], buttons: [["no", "Cancel"], ["yes", "Filter", GO]] },
          (answer, v) => { if (answer === "yes" && v.value) add({ field: key, op: field.ops.find(([, text]) => text === v.op)[0], value: v.value.replace(/\D/g, "") }); });
      }
      // Values that occur in this folder, each with its count.
      const values = (field.values || [...allTags().keys()].sort()).map((value) => [value, here.filter((p) => ruleHolds(p, { field: key, op: "is", value })).length]).filter(([, n]) => n);
      if (!values.length) return toast(`Nothing here to filter by ${field.label.toLowerCase()}.`);
      openMenu(at.left, at.bottom + 4, [{ header: field.label }, ...values.map(([value, n]) => ({ label: value, key: String(n), action: () => add({ field: key, op: "is", value }) }))]);
    } }))]);
  }
  $("sort-dir").addEventListener("click", () => {
    state.sortDown = !state.sortDown;
    $("sort-dir").classList.toggle("down", state.sortDown);
    $("sort-dir").title = state.sortDown ? "Descending. Click for ascending." : "Ascending. Click for descending.";
    filtersChanged();
  });

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
  // One size slider. In the grid it sizes the thumbnails; in single view and
  // compare it sizes the filmstrip, which can also be dragged by its top edge.
  const sizes = { grid: 190, strip: 80 };
  const STRIP = [44, 260];
  function setStrip(height) {
    sizes.strip = Math.round(Math.max(STRIP[0], Math.min(STRIP[1], height)));
    $("filmstrip").style.setProperty("--strip", sizes.strip + "px");
  }
  function syncSizeSlider() {
    const grid = state.view === "grid";
    const slider = $("thumb-size");
    [slider.min, slider.max] = grid ? [140, 360] : STRIP;
    slider.value = grid ? sizes.grid : sizes.strip;
    slider.setAttribute("aria-label", grid ? "Thumbnail size" : "Filmstrip size");
    slider.parentElement.title = grid ? "Thumbnail size" : "Filmstrip size";
  }
  $("thumb-size").addEventListener("input", () => {
    const value = Number($("thumb-size").value);
    if (state.view === "grid") { sizes.grid = value; return $("grid").style.setProperty("--thumb", value + "px"); }
    setStrip(value);
    refresh();
  });
  let stripDrag = null;
  $("strip-handle").addEventListener("mousedown", (event) => { stripDrag = { y: event.clientY, from: sizes.strip }; event.preventDefault(); });
  window.addEventListener("mousemove", (event) => {
    if (!stripDrag) return;
    setStrip(stripDrag.from + (stripDrag.y - event.clientY));
    refresh();
  });
  window.addEventListener("mouseup", () => { stripDrag = null; });
  $("strip-handle").addEventListener("dblclick", () => { setStrip(80); refresh(); });

  // The filmstrip's scrollbar sits along its top edge. The mouse wheel scrolls
  // the strip and never changes which photo is selected.
  function syncStripScroll() {
    const [strip, bar] = [$("filmstrip"), $("strip-scroll")];
    const thumb = bar.firstElementChild;
    const spare = strip.scrollWidth - strip.clientWidth;
    bar.classList.toggle("idle", spare <= 1);
    if (spare <= 1) return;
    thumb.style.width = Math.max(36, (bar.clientWidth * strip.clientWidth) / strip.scrollWidth) + "px";
    thumb.style.left = ((bar.clientWidth - thumb.offsetWidth) * strip.scrollLeft) / spare + "px";
  }
  $("filmstrip").addEventListener("scroll", syncStripScroll);
  const wheelStrip = (event) => {
    event.preventDefault();
    $("filmstrip").scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  };
  $("filmstrip").addEventListener("wheel", wheelStrip, { passive: false });
  $("strip-scroll").addEventListener("wheel", wheelStrip, { passive: false });
  let barDrag = null;
  $("strip-scroll").addEventListener("mousedown", (event) => {
    const [strip, bar] = [$("filmstrip"), $("strip-scroll")];
    const thumb = bar.firstElementChild;
    const room = bar.clientWidth - thumb.offsetWidth;
    if (room <= 0) return;
    event.preventDefault();
    const scale = (strip.scrollWidth - strip.clientWidth) / room;
    // A click beside the thumb brings the thumb under the pointer first.
    if (event.target !== thumb) strip.scrollLeft = (event.clientX - bar.getBoundingClientRect().left - thumb.offsetWidth / 2) * scale;
    barDrag = { x: event.clientX, from: strip.scrollLeft, scale };
    bar.classList.add("dragging");
  });
  window.addEventListener("mousemove", (event) => { if (barDrag) $("filmstrip").scrollLeft = barDrag.from + (event.clientX - barDrag.x) * barDrag.scale; });
  window.addEventListener("mouseup", () => { barDrag = null; $("strip-scroll").classList.remove("dragging"); });
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
    tell({ lib: "marks", list: list.map((p) => ({ id: p.id, stars: p.stars, flag: p.flag, label: p.label })) });
  }
  function takeMarks(list) {
    list.forEach((m) => { const p = byId(m.id); if (p) { p.stars = m.stars; p.flag = m.flag; p.label = m.label; } });
    computeShown();
    renderGrid(false);
    refresh();
  }
  function setPopped(on) {
    app.dataset.popped = on ? "on" : "off";
    document.querySelector('[data-stage-tab="library"]').innerHTML = `<span aria-hidden="true">01</span>Library${on ? '<i class="away">in own window</i>' : ""}`;
    if (on) grade.photo ? setStage("grade") : showInGrade(state.active !== null ? byId(state.active) : null);
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
    if (data.lib === "hello") tell({ lib: "marks", list: photos.map((p) => ({ id: p.id, stars: p.stars, flag: p.flag, label: p.label })) });
    if (data.lib === "marks") takeMarks(data.list);
    if (data.lib === "grade") {
      const p = byId(data.id);
      window.focus();
      if (p && p === grade.photo) setStage("grade");
      else leaveCurrentPhoto(() => showInGrade(p), "opening " + (p ? title(p) : "another photo"));
    }
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

  // Remembered between launches, with the colours. Whether an overlay is on is not.
  const opts = { focus: { strength: 85, sensitivity: 50 }, exposure: { strength: 90, high: true, low: true }, compare: { layout: "side", names: true } };
  try {
    const saved = JSON.parse(recall("options", "{}"));
    Object.keys(opts).forEach((kind) => Object.assign(opts[kind], saved[kind] || {}));
  } catch (e) { /* start from the defaults */ }
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
    remember("options", JSON.stringify(opts));
  }

  const isOn = (kind) => (kind === "compare" ? state.view === "compare" : app.dataset[kind] === "on");
  // HDR in the grid: off by default. The brightness limit is a personal setting.
  const hdr = { cap: Number(recall("hdr-cap", "1000")) };
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
      ${row("Color", "", colour("focus", "Focus"))}
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
  PANELS.hdr = () => `
      ${row("Show HDR previews", "H", `<input type="checkbox" class="opt-switch" data-switch="hdr" ${isOn("hdr") ? "checked" : ""}>`)}
      <hr>
      <div class="opt-slider"><label class="opt-row"><span>Brightness limit in the grid</span><output>${hdr.cap} nits</output></label>
        <input type="range" min="400" max="1600" step="50" value="${hdr.cap}" data-hdr-cap></div>
      <button type="button" class="opt-action" data-hdr-make>Create HDR previews for this folder</button>
      <p class="helper">Turning HDR on makes previews for the photos on screen. A photo without one stays SDR until it is ready. The limit keeps a bright grid comfortable; single view and compare show the true image.</p>`;
  const TITLES = { focus: "Focus overlay", exposure: "Exposure overlay", compare: "Compare", hdr: "HDR previews" };

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
    if (t.dataset.switch === "hdr") toggleHdr();
    else if (t.dataset.hdrCap !== undefined) {
      hdr.cap = Number(t.value);
      remember("hdr-cap", t.value);
      t.previousElementSibling.querySelector("output").textContent = t.value + " nits";
      refresh();
    } else if (t.dataset.switch === "compare") setView(t.checked ? "compare" : "grid");
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
    if (event.target.closest("[data-hdr-make]")) { closeOptions(); return makeHdr(inPlace(placeOf(state.place))); }
    const layout = event.target.closest("[data-layout]");
    if (!layout) return;
    opts.compare.layout = layout.dataset.layout;
    $("options").querySelectorAll("[data-layout]").forEach((b) => b.classList.toggle("on", b === layout));
    applyOptions();
    if (state.view === "compare") refresh();
  });
  window.addEventListener("mousedown", (event) => {
    if (optionsKind && !event.target.closest("#options, [data-overlay], [data-view-button='compare'], #hdr-button")) closeOptions();
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
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "s") { event.preventDefault(); return saveGrade(); }
    if (typing || app.dataset.stage !== "library") return;
    if (event.ctrlKey || event.metaKey) {
      if (key.toLowerCase() === "a") { event.preventDefault(); state.sel = new Set(state.shown.map((p) => p.id)); refresh(); }
      if (key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      if (key.toLowerCase() === "e" && event.shiftKey) { event.preventDefault(); return openExport(); }
      if (key.toLowerCase() === "c") { event.preventDefault(); copyGrade(); }
      if (key.toLowerCase() === "v") { event.preventDefault(); pasteGrade(event.shiftKey); }
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
      t: () => {
        toggleSide("details", true);
        const input = $("details").querySelector(".details-tags input");
        if (input) input.focus();
      },
      s: () => toggleOverlay("focus"),
      h: toggleHdr,
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
    else if (/^[6-9]$/.test(key)) setLabel(LABELS[Number(key) - 6]);
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

  let menuAt = { x: 0, y: 0 };
  function openMenu(x, y, items) {
    const menu = $("menu");
    menuAt = { x, y };
    menu.innerHTML = items.filter(Boolean).map((item, i) =>
      item === "-" ? "<hr>" : item.header ? `<div class="menu-header">${esc(item.header)}</div>`
        : `<button type="button" role="menuitem" data-item="${i}" class="${item.danger ? "danger" : ""}"><span>${esc(item.label)}</span>${item.key ? `<kbd>${item.key}</kbd>` : ""}</button>`).join("");
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
    const copiesOnly = list.every((p) => p.copyOf !== undefined);
    const here = placeOf(state.place);
    return [
      { header: one ? title(list[0]) : `${list.length} photos` },
      one && { label: "Open in Grade", key: "Enter", action: openInGrade },
      { label: "Put on left in compare", key: "[", action: () => chooseSide("left") },
      { label: "Put on right in compare", key: "]", action: () => chooseSide("right") },
      "-",
      { label: "Pick", key: "P", action: () => setFlag("pick") },
      { label: rejected ? "Unmark" : "Reject", key: rejected ? "U" : "X", action: () => setFlag(rejected ? null : "reject") },
      "-",
      one && { label: "Copy grade", key: "Ctrl+C", action: copyGrade },
      { label: "Paste grade", key: "Ctrl+V", action: () => pasteGrade(false) },
      { label: "Paste grade, choosing what…", key: "Ctrl+Shift+V", action: () => pasteGrade(true) },
      list.some((p) => p.before) && { label: "Restore previous grade", action: restoreGrade },
      list.some((p) => p.session) && { label: "Revert to last session…", action: () => revert("session") },
      list.some((p) => p.edited) && { label: "Revert to original…", action: () => revert("original") },
      list.length > 1 && { label: "Link grades…", action: linkPhotos },
      list.some((p) => p.link) && { label: "Unlink", action: unlinkPhotos },
      { label: "Apply look preset…", action: openLooks },
      { label: one ? "Create virtual copy…" : "Create virtual copies…", action: createCopies },
      one && copiesOnly && { label: "Rename copy…", action: () => renameCopy(list[0]) },
      "-",
      { label: "Add to album…", action: () => openMenu(menuAt.x, menuAt.y, albumMenu(list)) },
      here && here.icon === "album" && { label: `Remove from ${here.label}`, action: () => removeFromAlbum(here, list) },
      { label: "Create HDR previews", action: () => makeHdr(list) },
      { label: "Export project…", action: () => exportProject(one ? title(list[0]) : `${list.length} photos`, list) },
      { label: "Export…", key: "Ctrl+Shift+E", action: openExport },
      "-",
      one && !copiesOnly && { label: "Rename…", action: () => renamePhoto(list[0]) },
      !copiesOnly && { label: "Move to folder…", action: () => askMove(list) },
      { label: "Show in Explorer" },
      "-",
      copiesOnly ? { label: one ? "Remove virtual copy…" : `Remove ${list.length} virtual copies…`, key: "Del", danger: true, action: () => confirmDelete(list) }
        : { label: one ? "Delete photo…" : `Delete ${list.length} photos…`, key: "Del", danger: true, action: () => confirmDelete(list) },
    ];
  }

  function placeMenu(place) {
    const top = PLACES.includes(place);
    const rejected = inPlace(place).filter((p) => p.flag === "reject");
    const deleteRejected = rejected.length && { label: `Delete ${rejected.length} rejected…`, danger: true, action: () => confirmDelete(rejected, place) };
    if (place.offline) return [{ header: place.label }, { label: "Locate…" }, "-", { label: "Unpin", action: () => unpin(place) }];
    if (place.icon === "project") return [{ header: place.label }, { label: "Show in Explorer" }, { label: "Relink photos…", action: () => openRelink(place) }, { label: "Export project…", action: () => exportProject(place.label, inPlace(place)) }, "-", { label: "Remove from list", action: () => unpin(place) }];
    if (place.icon === "album") return [{ header: place.label }, { label: "Rename…", action: () => renameAlbum(place) }, { label: "Create HDR previews", action: () => makeHdr(inPlace(place)) }, { label: "Export project…", action: () => exportProject(place.label, inPlace(place)) }, "-", { label: "Delete album (photos stay)", action: () => unpin(place) }];
    if (place.icon === "smart") return [{ header: place.label }, { label: "Edit rules and name…", action: () => openRules(place) }, "-", { label: "Delete smart album", action: () => unpin(place) }];
    if (place.note) return [{ header: place.label }, { label: "Pin this folder", action: () => { delete place.note; place.icon = "folder"; renderNav(); toast(`${place.label} pinned.`); } }, { label: "Show in Explorer" }, "-", { label: "Close", action: () => unpin(place) }];
    return [
      { header: place.label },
      top ? { label: "Re-scan", action: () => startIndexing(Math.max(40, inPlace(place).length * 60)) } : { label: "Pin as its own entry" },
      { label: "New folder inside…", action: () => newFolder(place) },
      { label: top ? "Rename label…" : "Rename folder…", action: () => renameFolder(place, top) },
      !top && { label: "Move folder…", action: () => moveFolder(place) },
      { label: "Show in Explorer" },
      "-",
      { label: "Create HDR previews", action: () => makeHdr(inPlace(place)) },
      { label: "Export project…", action: () => exportProject(place.label, inPlace(place)) },
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

  // ---------- copy a grade, paste chosen parts of it ----------
  // One mechanism for copy and paste, sync and look presets: a tick list of
  // what to bring across. Names follow the Control Panel on the Grade stage.

  const PARTS = [
    { id: "tone", label: "Tone", items: ["Tone", "Highlight Compression", "Exposure Bands", "Lift, Gamma, Gain", "Curves"] },
    { id: "color", label: "Color", items: ["Color", "Color Grading", "Black and White"] },
    { id: "look", label: "Look", items: ["Film Look", "Vignette"] },
    { id: "detail", label: "Detail", items: ["Detail", "Denoise"] },
    { id: "raw", label: "RAW development", items: ["Highlight Reconstruction"], outside: true, rawOnly: true },
    { id: "lens", label: "Lens corrections", items: ["Distortion", "Chromatic aberration", "Vignetting"], outside: true, off: true, rawOnly: true },
    { id: "crop", label: "Crop and geometry", items: ["Crop & Rotate", "Perspective"], outside: true, off: true },
    { id: "local", label: "Local adjustments and masks", items: ["Local Adjustments", "Masks"], outside: true, off: true },
  ];
  const partKeys = (part) => part.items.map((_, i) => `${part.id}.${i}`);
  // Off by default: things that do not carry cleanly from one frame to another.
  const clip = { source: null, ticks: new Set(PARTS.filter((part) => !part.off).flatMap(partKeys)), sides: { hdr: true, sdr: true }, open: new Set(), targets: [] };
  // Which settings the copied photo actually changed (pretend, but steady per photo).
  const isMod = (key) => clip.source && ((clip.source.id * 7 + key.length * 13 + key.charCodeAt(key.length - 1) * 5) % 5 < 2 || key === "tone.0");

  function copyGrade() {
    const list = targets();
    if (list.length !== 1) return toast("Select one photo to copy its grade.");
    if (!list[0].edited) return toast(`${list[0].name} has no grade yet. Nothing to copy.`);
    clip.source = list[0];
    toast(`Grade copied from ${clip.source.name}. Ctrl+V pastes it; Ctrl+Shift+V lets you choose what.`);
  }

  function chosenLabels() {
    return PARTS.filter((part) => partKeys(part).some((k) => clip.ticks.has(k)))
      .map((part) => (partKeys(part).every((k) => clip.ticks.has(k)) ? part.label : `${part.label} (part)`));
  }

  // Settings that cannot apply to some targets are skipped, and the app says which.
  function skippedNote(list) {
    const notRaw = list.filter((p) => p.kind !== "RAW");
    const rawParts = PARTS.filter((part) => part.rawOnly && partKeys(part).some((k) => clip.ticks.has(k))).map((part) => part.label);
    return notRaw.length && rawParts.length
      ? `\n${notRaw.length} of them ${notRaw.length === 1 ? "is not a RAW file" : "are not RAW files"}: ${rawParts.join(" and ")} will be skipped for ${notRaw.length === 1 ? "it" : "them"}.` : "";
  }

  function pasteGrade(choose) {
    if (!clip.source) return toast("Copy a grade first: select an edited photo and press Ctrl+C.");
    const list = withLinked(targets()).filter((p) => p !== clip.source);
    if (!list.length) return toast("Select the photos to paste onto.");
    clip.targets = list;
    if (choose) return openPaste();
    // Plain paste repeats the last choices, after saying how many photos change.
    const n = list.length;
    const labels = chosenLabels();
    const listed = labels.length > 1 ? labels.slice(0, -1).join(", ") + (labels.length > 2 ? "," : "") + " and " + labels[labels.length - 1] : labels[0];
    $("confirm-title").textContent = `Paste Grade From ${clip.source.name}`;
    $("confirm-message").textContent = (labels.length ? `Paste ${listed} settings` : "Nothing is ticked to paste") +
      (n > 1 ? ` onto ${n} photos.` : ".") + skippedNote(list).replace("\n", "\n\n");
    $("confirm-actions").innerHTML = `<button type="button" data-answer="choose">Choose what to paste…</button><button type="button" data-answer="no">Cancel</button><button type="button" class="button-primary lib-confirm-go" data-answer="yes">Paste</button>`;
    $("confirm").onclick = (event) => {
      const answer = event.target.dataset && event.target.dataset.answer;
      if (!answer) return;
      $("confirm").close();
      if (answer === "choose") openPaste();
      if (answer === "yes") doPaste();
    };
    $("confirm").showModal();
    $("confirm").querySelector("[data-answer=yes]").focus();
  }

  function renderPaste() {
    const n = clip.targets.length;
    $("paste-title").textContent = `Paste Grade From ${clip.source.name}`;
    $("paste-sub").textContent = `Onto ${n === 1 ? clip.targets[0].name : `${n} photos`}. Tick what to bring across.`;
    document.querySelectorAll("#paste [data-side]").forEach((box) => { box.checked = clip.sides[box.dataset.side]; });
    const partRow = (part) => {
      const keys = partKeys(part);
      const on = keys.filter((k) => clip.ticks.has(k)).length;
      const mods = keys.filter(isMod).length;
      const open = clip.open.has(part.id);
      return `<label class="paste-row"><button type="button" class="twist${open ? " open" : ""}" data-twist="${part.id}" aria-label="Show the settings in ${part.label}">${icon("twist", "")}</button>
          <input type="checkbox" data-part="${part.id}" ${on === keys.length ? "checked" : ""} data-some="${on > 0 && on < keys.length}">
          <span class="name strong">${part.label}</span><span class="state${mods ? " mod" : ""}">${mods ? mods + " Mod" : "default"}</span></label>` +
        (open ? keys.map((k, i) => `<label class="paste-row child"><input type="checkbox" data-key="${k}" ${clip.ticks.has(k) ? "checked" : ""}>
          <span class="name">${part.items[i]}</span><span class="state${isMod(k) ? " mod" : ""}">${isMod(k) ? "Mod" : "default"}</span></label>`).join("") : "");
    };
    $("paste-list").innerHTML = `<div class="paste-kicker">Grade</div>` + PARTS.filter((part) => !part.outside).map(partRow).join("") +
      `<div class="paste-kicker">Outside the grade · off unless ticked, because they rarely suit another frame</div>` + PARTS.filter((part) => part.outside).map(partRow).join("");
    $("paste-list").querySelectorAll("[data-some=true]").forEach((box) => { box.indeterminate = true; });
    const sides = clip.sides.hdr && clip.sides.sdr ? "" : clip.sides.hdr ? "\nHDR grade only: the SDR grade of each photo is left alone." : clip.sides.sdr ? "\nSDR grade only: the HDR grade of each photo is left alone." : "";
    const nothing = !clip.ticks.size || (!clip.sides.hdr && !clip.sides.sdr);
    $("paste-notes").textContent = nothing ? "Nothing is ticked."
      : `${n} ${n === 1 ? "photo" : "photos"} will change and be saved straight away. ${n === 1 ? "It keeps" : "Each keeps"} its previous grade, so this can be taken back.` + sides + skippedNote(clip.targets);
    $("paste-go").textContent = n === 1 ? "Paste" : `Paste onto ${n} photos`;
    $("paste-go").disabled = nothing;
  }

  function openPaste() {
    renderPaste();
    $("paste").showModal();
  }

  // Every library command that rewrites grades goes through here: each photo
  // keeps its previous grade, the change is saved at once, and it is one undo.
  function changeGrades(list, apply, what, done) {
    const entry = { pasted: list.map((p) => ({ p, edited: p.edited, before: p.before, look: p.look })), what };
    state.undo.push(entry);
    list.forEach((p) => {
      // The grade a photo had at the start of this run of the app, for Revert to last session.
      if (!p.session) p.session = { look: p.look, edited: p.edited };
      p.before = { look: p.look, edited: p.edited };
      p.edited = true;
      apply(p);
    });
    // The photo open in Grade takes the change as ordinary unsaved work.
    const open = grade.photo && list.includes(grade.photo) && !autosaveOn();
    if (open) { grade.draft = grade.photo.look; Object.assign(grade.photo, grade.photo.before); grade.dirty = true; renderGrade(); }
    computeShown();
    renderGrid(false);
    refresh();
    toast(`${done} ${plural(list.length, "photo")} and saved. Ctrl+Z undoes it.` + (open ? " The photo open in Grade has it as unsaved work." : ""));
    return entry;
  }

  function doPaste() {
    const source = clip.source;
    changeGrades(clip.targets, (p) => { p.look = source.look; }, "paste", "Grade pasted onto");
  }

  // Restoring is itself kept as a previous grade, so it can be taken back.
  function restoreGrade() {
    const list = targets().filter((p) => p.before);
    list.forEach((p) => {
      const now = { look: p.look, edited: p.edited };
      Object.assign(p, p.before);
      p.before = now;
    });
    computeShown();
    renderGrid(false);
    refresh();
    toast(`Previous grade restored on ${plural(list.length, "photo")}.`);
  }

  $("paste").addEventListener("click", (event) => {
    const twist = event.target.closest("[data-twist]");
    const pick = event.target.closest("[data-pick]");
    if (twist) {
      event.preventDefault();
      clip.open.has(twist.dataset.twist) ? clip.open.delete(twist.dataset.twist) : clip.open.add(twist.dataset.twist);
    } else if (pick) {
      const every = PARTS.flatMap(partKeys);
      clip.ticks = new Set(pick.dataset.pick === "all" ? every : pick.dataset.pick === "mod" ? every.filter(isMod) : []);
    } else if (event.target.id === "paste-cancel") return $("paste").close();
    else if (event.target.id === "paste-preset") return saveLook();
    else if (event.target.id === "paste-go") { $("paste").close(); return doPaste(); }
    else return;
    renderPaste();
  });
  $("paste").addEventListener("change", (event) => {
    const t = event.target;
    if (t.dataset.side) clip.sides[t.dataset.side] = t.checked;
    else if (t.dataset.part) partKeys(PARTS.find((part) => part.id === t.dataset.part)).forEach((k) => (t.checked ? clip.ticks.add(k) : clip.ticks.delete(k)));
    else if (t.dataset.key) t.checked ? clip.ticks.add(t.dataset.key) : clip.ticks.delete(t.dataset.key);
    else return;
    renderPaste();
  });

  // ---------- batch export with recipes ----------
  // A recipe is one deliverable: format, size, naming pattern, sub-folder and
  // metadata. One run can tick several, and makes one file per photo for each.
  // Formats and presets are the ones on the Export stage today.

  // Every setting below is one that the Export stage has today, with the same
  // names and choices. Only the file name pattern and sub-folder are new.
  const FORMATS = { "AVIF + gain map": "avif", "JPEG Ultra HDR": "jpg", "JPEG XL HDR": "jxl", "JPEG XL (SDR)": "jxl", "PNG (SDR)": "png", "JPEG (SDR)": "jpg" };
  const PRESETS = ["Web Default", "Web Optimized", "Maximum Fidelity"];
  const PRESET_QUALITY = { "Web Default": 85, "Web Optimized": 75, "Maximum Fidelity": 100 };
  const CHROMA = ["4:2:0", "4:2:2", "4:4:4"];
  // The advanced settings each format has on the Export stage.
  const ADVANCED = {
    "AVIF + gain map": [["bitDepth", "Bit Depth", ["8-bit", "10-bit", "12-bit"], "10-bit"], ["chroma", "Chroma Subsampling", CHROMA, "4:2:0"], ["gainQuality", "Gain-map Quality", "range", 85], ["gainScale", "Gain-map Resolution", ["Half", "Full"], "Half"]],
    "JPEG Ultra HDR": [["gainQuality", "Gain-map Quality", "range", 100], ["gainScale", "Gain-map Resolution", ["Full", "Half"], "Full"], ["chroma", "Primary JPEG Chroma", CHROMA, "4:2:0"]],
    "JPEG XL HDR": [["precision", "Precision", ["10-bit integer", "12-bit integer", "16-bit integer", "16-bit float", "32-bit float"], "12-bit integer"]],
    "JPEG XL (SDR)": [["precision", "Precision", ["10-bit integer", "12-bit integer", "16-bit integer", "16-bit float", "32-bit float"], "12-bit integer"]],
    "PNG (SDR)": [["bitDepth", "Bit Depth", ["8-bit", "16-bit"], "8-bit"]],
    "JPEG (SDR)": [["chroma", "Chroma Subsampling", CHROMA, "4:2:0"]],
  };
  const TOKENS = ["{name}", "{date}", "{seq}", "{rating}", "{recipe}"];
  const newRecipe = (over) => Object.assign({
    name: "New recipe", format: "JPEG Ultra HDR", preset: "Web Default", quality: 85, dithering: "Auto", metadata: "None",
    resize: "Long edge", longEdge: 2048, width: 2048, height: 2048, noEnlarge: true, sharpening: "Off",
    pattern: "{name}", folder: "", advanced: false, on: true,
  }, over);
  const recipes = [
    newRecipe({ name: "HDR for web", format: "AVIF + gain map", longEdge: 2560, pattern: "{name}_HDR", folder: "HDR", metadata: "Copyright only", sharpening: "Subtle" }),
    newRecipe({ name: "SDR for clients", format: "JPEG (SDR)", longEdge: 2048, folder: "SDR", metadata: "Copyright only", sharpening: "Standard" }),
    newRecipe({ name: "Full-size archive", format: "JPEG XL HDR", preset: "Maximum Fidelity", quality: 100, resize: "Original cropped size", pattern: "{date}_{name}", folder: "Archive", metadata: "All except location", on: false }),
  ];
  const run = { list: [], recipe: 0, jobs: [], at: 0, timer: null, finished: false };

  const exportName = (recipe, p, n) => recipe.pattern
    .replaceAll("{name}", p.name.replace(/\.[^.]+$/, "") + (p.copyOf === undefined ? "" : "_" + p.copyName.replace(/\s+/g, "-"))).replaceAll("{date}", "2026-09-12").replaceAll("{seq}", String(n + 1).padStart(3, "0"))
    .replaceAll("{rating}", p.stars + "star").replaceAll("{recipe}", recipe.name.replace(/\s+/g, "-")) + "." + FORMATS[recipe.format];
  const sizeText = (r) => (r.resize === "Long edge" ? `${r.longEdge || "?"} px long edge` : r.resize === "Fit within dimensions" ? `fit ${r.width || "?"} × ${r.height || "?"} px` : "original size");
  const recipeLine = (r) => `${r.format} · ${r.preset} · Q${r.quality}<br>${sizeText(r)} · ${r.folder ? "\\" + r.folder : "no sub-folder"}`;

  function renderRecipes() {
    $("export-recipes").innerHTML = recipes.map((r, i) => `<label class="recipe-row${i === run.recipe ? " selected" : ""}" data-recipe="${i}">
      <input type="checkbox" data-recipe-on="${i}" ${r.on ? "checked" : ""}><span><strong>${r.name || "Untitled recipe"}</strong><small>${recipeLine(r)}</small></span></label>`).join("");
    const on = recipes.filter((r) => r.on);
    const n = run.list.length;
    const files = n * on.length;
    const ungraded = run.list.filter((p) => !p.edited).length;
    $("export-title").textContent = `Export ${n === 1 ? title(run.list[0]) : `${n} photos`}`;
    $("export-notes").textContent = !on.length ? "No recipe is ticked."
      : `${n} ${n === 1 ? "photo" : "photos"} × ${on.length} ${on.length === 1 ? "recipe" : "recipes"} = ${files} ${files === 1 ? "file" : "files"}, about ${Math.max(1, Math.round(files * 0.2))} min. Runs in the background; you can keep working.` +
        (ungraded ? `\n${ungraded} of them ${ungraded === 1 ? "has" : "have"} no grade and will be exported with the default look.` : "");
    $("export-go").textContent = files === 1 ? "Export 1 file" : `Export ${files} files`;
    $("export-go").disabled = !files;
    const r = recipes[run.recipe];
    const example = $("export-editor").querySelector(".recipe-example");
    if (example && r) example.textContent = `${$("export-folder").value}\\${r.folder ? r.folder + "\\" : ""}${exportName(r, run.list[0], 0)}`;
    const preset = $("export-editor").querySelector('[data-field="preset"]');
    if (preset && r) preset.value = r.preset;
  }

  function renderEditor() {
    const r = recipes[run.recipe];
    if (!r) { $("export-editor").innerHTML = `<p class="helper">No recipes yet. Add one to begin.</p>`; return renderRecipes(); }
    const select = (field, options) => `<select data-field="${field}">${options.map((o) => `<option ${String(r[field]) === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    const field = (label, control, cls) => `<label class="lib-export-field${cls ? " " + cls : ""}"><span>${label}</span>${control}</label>`;
    const range = (name, label) => `<div class="lib-export-field opt-slider"><label class="opt-row"><span>${label}</span><output>${r[name]}</output></label><input type="range" min="1" max="100" value="${r[name]}" data-field="${name}" data-number></div>`;
    const number = (name, label) => field(label, `<input type="text" inputmode="numeric" class="mono" data-field="${name}" data-number value="${r[name]}" spellcheck="false">`);
    ADVANCED[r.format].forEach(([name, , , fallback]) => { if (r[name] === undefined) r[name] = fallback; });
    const advanced = ADVANCED[r.format].map(([name, label, options]) => (options === "range" ? range(name, label) : field(label, select(name, options)))).join("") +
      field("Dithering", select("dithering", ["Auto", "Off", "Subtle"])) +
      field("Source Metadata", select("metadata", ["None", "Copyright only", "All except location", "All including location"]));
    const size = r.resize === "Long edge" ? number("longEdge", "Long edge (px)") + `<span></span>`
      : r.resize === "Fit within dimensions" ? number("width", "Width (px)") + number("height", "Height (px)") : "";
    $("export-editor").innerHTML = `
      ${field("Recipe name", `<input type="text" data-field="name" value="${r.name}">`, "wide")}
      <div class="paste-kicker wide">Format</div>
      ${field("Format", select("format", Object.keys(FORMATS)))}
      ${field("Preset", select("preset", [...PRESETS, ...(r.preset === "Custom" ? ["Custom"] : [])]))}
      <div class="paste-kicker wide">Encoding</div>
      ${range("quality", "Quality")}<span></span>
      <button type="button" class="lib-export-advanced wide" id="export-advanced">${icon("twist", r.advanced ? "twist open" : "twist")}Advanced export settings</button>
      ${r.advanced ? advanced : ""}
      <div class="paste-kicker wide">Output Size &amp; Sharpening</div>
      ${field("Resize", select("resize", ["Original cropped size", "Long edge", "Fit within dimensions"]))}
      ${field("Output Sharpening", select("sharpening", ["Off", "Subtle", "Standard", "Strong"]))}
      ${size}
      <label class="lib-export-field wide opt-check"><input type="checkbox" data-field="noEnlarge" ${r.noEnlarge ? "checked" : ""}> Prevent enlargement</label>
      <div class="paste-kicker wide">Destination</div>
      ${field("File name pattern", `<input type="text" class="mono" data-field="pattern" value="${r.pattern}" spellcheck="false">`, "wide")}
      <div class="lib-export-field wide"><div class="recipe-tokens">${TOKENS.map((t) => `<button type="button" data-token="${t}">${t}</button>`).join("")}</div></div>
      ${field("Sub-folder inside the export folder (optional)", `<input type="text" data-field="folder" value="${r.folder}" spellcheck="false">`, "wide")}
      <div class="lib-export-field wide"><span>Example</span><span class="recipe-example"></span></div>
      <button type="button" class="recipe-remove" id="export-remove">Delete this recipe</button>`;
    renderRecipes();
  }

  function openExport() {
    const list = targets();
    if (!list.length) return toast("Select the photos to export.");
    if (run.timer) return openResults();
    run.list = list;
    renderEditor();
    $("export").showModal();
  }

  $("export").addEventListener("click", (event) => {
    const row = event.target.closest("[data-recipe]");
    const token = event.target.closest("[data-token]");
    if (token) {
      const input = $("export-editor").querySelector('[data-field="pattern"]');
      input.value += token.dataset.token;
      recipes[run.recipe].pattern = input.value;
      return renderRecipes();
    }
    if (row && !event.target.matches("input")) { event.preventDefault(); run.recipe = Number(row.dataset.recipe); return renderEditor(); }
    if (event.target.id === "export-new") {
      recipes.push(newRecipe({}));
      run.recipe = recipes.length - 1;
      return renderEditor();
    }
    if (event.target.closest("#export-advanced")) { recipes[run.recipe].advanced = !recipes[run.recipe].advanced; return renderEditor(); }
    if (event.target.id === "export-remove") { recipes.splice(run.recipe, 1); run.recipe = Math.max(0, run.recipe - 1); return renderEditor(); }
    if (event.target.id === "export-browse") return toast("Opens the same folder picker as Add folder.");
    if (event.target.id === "export-cancel") return $("export").close();
    if (event.target.id === "export-go") { $("export").close(); startExport(); }
  });
  $("export").addEventListener("input", (event) => {
    const t = event.target;
    const r = recipes[run.recipe];
    if (t.dataset.recipeOn) recipes[Number(t.dataset.recipeOn)].on = t.checked;
    else if (t.dataset.field) {
      const name = t.dataset.field;
      // Sizes are typed: keep digits only, any whole number of pixels.
      if (t.type === "text" && t.dataset.number !== undefined) t.value = t.value.replace(/\D/g, "").slice(0, 6);
      r[name] = t.type === "checkbox" ? t.checked : t.dataset.number !== undefined ? Number(t.value) : t.value;
      if (t.type === "range") t.previousElementSibling.querySelector("output").textContent = t.value;
      // As on the Export stage: a preset sets the encoding; changing the encoding by hand makes it Custom.
      if (name === "preset" && PRESET_QUALITY[r.preset]) { r.quality = PRESET_QUALITY[r.preset]; return renderEditor(); }
      const encoding = name === "quality" || ADVANCED[r.format].some(([n]) => n === name) || name === "dithering" || name === "metadata";
      if (encoding && r.preset !== "Custom") { r.preset = "Custom"; if (t.type !== "range") return renderEditor(); const box = $("export-editor").querySelector('[data-field="preset"]'); if (![...box.options].some((o) => o.value === "Custom")) box.add(new Option("Custom")); }
      if (name === "format") { ADVANCED[r.format].forEach(([n, , , fallback]) => { r[n] = fallback; }); return renderEditor(); }
      if (name === "resize") return renderEditor();
    }
    renderRecipes();
  });

  // The queue: runs in the background, shows in the status line, and keeps a per-file list.
  function startExport() {
    const on = recipes.filter((r) => r.on);
    run.jobs = run.list.flatMap((p, n) => on.map((r) => ({ file: `${r.folder ? r.folder + "\\" : ""}${exportName(r, p, n)}`, recipe: r.name, photo: p,
      state: "waiting" })));
    run.at = 0;
    run.finished = false;
    clearInterval(run.timer);
    run.timer = setInterval(() => {
      while (run.jobs[run.at] && run.jobs[run.at].state === "skipped") run.at++;
      if (run.jobs[run.at]) { run.jobs[run.at].state = "done"; run.jobs[run.at].photo.exported = true; run.at++; }
      if (run.at >= run.jobs.length) finishExport(false);
      refresh();
      if ($("results").open) renderResults();
    }, 700);
    toast(`Exporting ${run.jobs.length} files in the background. Progress is in the bottom bar.`);
    refresh();
  }

  function finishExport(cancelled) {
    clearInterval(run.timer);
    run.timer = null;
    run.finished = true;
    if (cancelled) run.jobs.forEach((j) => { if (j.state === "waiting") j.state = "cancelled"; });
    const made = run.jobs.filter((j) => j.state === "done").length;
    const skipped = run.jobs.filter((j) => j.state === "skipped").length;
    toast(cancelled ? `Export cancelled. ${made} files were finished and kept.` : `Export finished: ${made} files${skipped ? `, ${skipped} skipped` : ""}. Click the bottom bar for the list.`);
  }

  function exportStatus() {
    if (!run.jobs.length) return "";
    const done = run.jobs.filter((j) => j.state !== "waiting").length;
    const left = Math.max(1, Math.round((run.jobs.length - done) * 0.2));
    const text = run.timer ? `Exporting ${Math.min(done + 1, run.jobs.length)} of ${run.jobs.length} · about ${left} min left`
      : `Export ${run.jobs.some((j) => j.state === "cancelled") ? "cancelled" : "finished"} · ${run.jobs.filter((j) => j.state === "done").length} files`;
    return `<button type="button" class="export-progress" id="export-progress" style="--done:${(done / run.jobs.length) * 100}%" title="Show the list of files"><i></i>${text}</button>`;
  }

  function renderResults() {
    const made = run.jobs.filter((j) => j.state === "done").length;
    const words = { done: "done", waiting: "waiting", skipped: "skipped · HDR recipe, SDR-only photo", cancelled: "cancelled" };
    $("results-title").textContent = run.timer ? `Exporting ${run.jobs.length} files` : "Export results";
    $("results-sub").textContent = `${made} done · ${run.jobs.filter((j) => j.state === "skipped").length} skipped · to ${$("export-folder").value}`;
    $("results-list").innerHTML = run.jobs.map((j, i) => {
      const working = run.timer && i === run.at && j.state === "waiting";
      return `<div class="result-row ${working ? "working" : j.state}"><span class="file">${j.file}</span><span class="state">${working ? "exporting…" : words[j.state]}</span></div>`;
    }).join("");
    $("results-stop").hidden = !run.timer;
  }
  function openResults() {
    renderResults();
    if (!$("results").open) $("results").showModal();
  }
  $("status").addEventListener("click", (event) => { if (event.target.closest("#export-progress")) openResults(); });
  $("results").addEventListener("click", (event) => {
    if (event.target.id === "results-close") $("results").close();
    if (event.target.id === "results-explorer") toast("Opens the export folder in Explorer.");
    if (event.target.id === "results-stop") { finishExport(true); refresh(); renderResults(); }
  });

  // ---------- delete, always behind a confirmation ----------

  function afterRemoval(gone) {
    if (gone.includes(grade.photo)) Object.assign(grade, { photo: null, dirty: false, draft: null });
    state.sel.clear();
    state.active = state.anchor = null;
    if (state.view !== "grid") state.view = "grid";
    computeShown();
    renderNav();
    renderGrid(false);
    refresh();
  }

  // Removing a virtual copy is the smaller action: one grade goes, the photo stays.
  function confirmRemoveCopies(list) {
    const one = list.length === 1;
    askUser({
      title: one ? `Remove Virtual Copy “${list[0].copyName}”?` : `Remove ${list.length} Virtual Copies?`,
      message: (one ? `This removes one grade of ${list[0].name}, with its own marks and tags.` : `This removes ${list.length} grades, each with its own marks and tags.`) +
        ` The ${one ? "photo itself stays, with its other grades" : "photos themselves stay, with their other grades"}. Nothing is deleted from disk.`,
      buttons: [["no", "Cancel"], ["yes", one ? "Remove copy" : "Remove copies", "button-danger"]],
    }, (answer) => {
      if (answer !== "yes") return;
      const entries = list.map((p) => ({ p, at: photos.indexOf(p) })).sort((a, b) => a.at - b.at);
      state.undo.push({ back: () => entries.forEach(({ p, at }) => photos.splice(at, 0, p)), text: `Brought back ${plural(list.length, "virtual copy", "virtual copies")}` });
      list.forEach((p) => photos.splice(photos.indexOf(p), 1));
      afterRemoval(list);
      toast(`${plural(list.length, "virtual copy", "virtual copies")} removed. Ctrl+Z brings ${one ? "it" : "them"} back.`);
    });
  }

  function confirmDelete(picked, fromPlace) {
    if (!picked.length) return;
    const list = picked.filter((p) => p.copyOf === undefined);
    if (!list.length) return confirmRemoveCopies(picked);
    // A photo takes its virtual copies with it.
    const attached = photos.filter((c) => c.copyOf !== undefined && list.some((o) => o.id === c.copyOf));
    const loose = picked.filter((p) => p.copyOf !== undefined && !attached.includes(p));
    const all = [...list, ...attached, ...loose];
    const n = list.length;
    const what = n === 1 ? "photo" : "photos";
    const copies = attached.length;
    const graded = list.filter((p) => p.edited).length;
    const place = fromPlace || placeOf(state.place);
    const bin = place.id !== "card";
    const extras = [graded ? `${graded === n && n > 1 ? "their" : graded === 1 && n === 1 ? "its" : graded} saved grade${graded === 1 ? "" : "s"}` : "", copies ? `${copies} virtual ${copies === 1 ? "copy" : "copies"}` : ""].filter(Boolean);
    $("confirm-title").textContent = `Delete ${n === 1 ? list[0].name : `${n} photos`}?`;
    $("confirm-message").textContent =
      `${n === 1 ? "This photo" : `These ${n} photos`} will be deleted from disk` +
      (extras.length ? `, along with ${extras.join(" and ")}` : "") + ". Ratings and tags go with " + (n === 1 ? "it" : "them") + "." +
      (loose.length ? ` The ${plural(loose.length, "selected virtual copy", "selected virtual copies")} of other photos ${loose.length === 1 ? "is" : "are"} removed too; those photos stay.` : "") +
      (all.includes(grade.photo) ? " One of these is open in Grade and will be closed." : "") + "\n\n" +
      (bin ? `${n === 1 ? "It goes" : "They go"} to the Recycle Bin and can be restored from there.`
        : `${place.label} has no Recycle Bin. ${n === 1 ? "It" : "They"} will be gone for good.`);
    $("confirm-actions").innerHTML = `<button type="button" data-answer="no">Cancel</button><button type="button" class="button-danger" data-answer="yes">${bin ? "Move to Recycle Bin" : "Delete for good"}</button>`;
    $("confirm").onclick = (event) => {
      const answer = event.target.dataset && event.target.dataset.answer;
      if (!answer) return;
      $("confirm").close();
      if (answer !== "yes") return;
      if (bin) state.undo.push({ deleted: all.map((p) => ({ p, at: photos.indexOf(p) })).sort((a, b) => a.at - b.at) });
      all.forEach((p) => photos.splice(photos.indexOf(p), 1));
      afterRemoval(all);
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
    if (pin) startIndexing(nodes.reduce((sum, n) => sum + total(n), 0));
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

  // ---------- virtual copies: create, rename ----------

  function createCopies() {
    const list = targets();
    if (!list.length) return;
    const one = list.length === 1;
    askUser({
      title: one ? `Create Virtual Copy of ${list[0].name}` : `Create ${list.length} Virtual Copies`,
      message: "A virtual copy is another grade of the same photo. No second image file is made. The copy is kept in the settings file beside the photo, so it travels with it.",
      fields: [{ name: "from", label: "Start from", options: ["The current grade", "A clean start"] }].concat(one ? [{ name: "name", label: "Name (optional)", placeholder: "For example Black and white" }] : []),
      buttons: [["no", "Cancel"], ["yes", one ? "Create copy" : `Create ${list.length} copies`, GO]],
    }, (answer, v) => {
      if (answer !== "yes") return;
      const made = list.map((p) => makeCopy(p, one ? v.name : "", v.from !== "The current grade"));
      state.undo.push({ back: () => made.forEach((c) => photos.splice(photos.indexOf(c), 1)), text: `Removed ${plural(made.length, "new virtual copy", "new virtual copies")} again` });
      computeShown();
      renderGrid(false);
      state.sel = new Set(made.map((c) => c.id));
      state.active = state.anchor = made[made.length - 1].id;
      refresh();
      toast(`${plural(made.length, "virtual copy", "virtual copies")} created beside ${one ? "the original" : "their originals"}. Ctrl+Z undoes it.`);
    });
  }

  function renameCopy(p) {
    askUser({ title: "Rename Virtual Copy", fields: [{ name: "name", label: "Name", value: p.copyName }], buttons: [["no", "Cancel"], ["yes", "Rename", GO]] },
      (answer, v) => { if (answer === "yes" && v.name) { p.copyName = v.name; renderGrid(false); refresh(); } });
  }

  // ---------- albums ----------
  // An album is a hand-picked set. Photos stay where they are on disk, and a
  // photo can be in several albums.

  const albums = () => PLACES.filter((p) => p.icon === "album");

  function newAlbum(list) {
    askUser({
      title: "New Album",
      message: (list.length ? `Starts with the ${plural(list.length, "selected photo")}. ` : "") + "An album is a hand-picked set. Photos stay where they are on disk, and one photo can be in several albums.",
      fields: [{ name: "name", label: "Name", placeholder: "Album name" }],
      buttons: [["no", "Cancel"], ["yes", "Create album", GO]],
    }, (answer, v) => {
      if (answer !== "yes") return;
      const place = { id: "album-" + Date.now(), icon: "album", label: v.name || "Untitled album", ids: new Set(list.map((p) => p.id)) };
      const at = PLACES.findIndex((p) => p.rules);
      PLACES.splice(at < 0 ? PLACES.length : at, 0, place);
      if (!list.length) return goTo(place.id);
      renderNav();
      refresh();
      toast(`Album “${place.label}” created with ${plural(list.length, "photo")}.`);
    });
  }

  function renameAlbum(place) {
    askUser({ title: "Rename Album", fields: [{ name: "name", label: "Name", value: place.label }], buttons: [["no", "Cancel"], ["yes", "Rename", GO]] },
      (answer, v) => { if (answer === "yes" && v.name) { place.label = v.name; renderNav(); renderGrid(false); refresh(); } });
  }

  function addToAlbum(place, list) {
    const fresh = list.filter((p) => !place.ids.has(p.id));
    const already = list.length - fresh.length;
    if (!fresh.length) return toast(`${list.length === 1 ? "That photo is" : "Those photos are"} already in ${place.label}.`);
    fresh.forEach((p) => place.ids.add(p.id));
    state.undo.push({ back: () => fresh.forEach((p) => place.ids.delete(p.id)), text: `Took ${plural(fresh.length, "photo")} out of ${place.label} again` });
    renderNav();
    refresh();
    toast(`${plural(fresh.length, "photo")} added to ${place.label}.` + (already ? ` ${already} already there.` : "") + " Ctrl+Z undoes it.");
  }

  function removeFromAlbum(place, list) {
    list.forEach((p) => place.ids.delete(p.id));
    state.undo.push({ back: () => list.forEach((p) => place.ids.add(p.id)), text: `Put ${plural(list.length, "photo")} back in ${place.label}` });
    afterRemoval([]);
    toast(`${plural(list.length, "photo")} removed from ${place.label}. Nothing was deleted from disk. Ctrl+Z undoes it.`);
  }

  function albumMenu(list) {
    return [
      { header: `Add ${list.length === 1 ? title(list[0]) : `${list.length} photos`} to` },
      ...albums().map((a) => ({ label: a.label, key: list.every((p) => a.ids.has(p.id)) ? "already in" : "", action: () => addToAlbum(a, list) })),
      albums().length ? "-" : null,
      { label: "New album…", action: () => newAlbum(list) },
    ];
  }

  // Drag photos onto an album to add them, or onto a folder to move them there.
  let dragging = null;
  const canDrop = (place) => !!place && (place.icon === "album" || ((place.icon === "folder" || place.icon === "card") && !place.offline && place.id !== state.place));
  const clearDrop = () => $("nav").querySelectorAll(".drop").forEach((row) => row.classList.remove("drop"));
  document.addEventListener("dragstart", (event) => {
    const cell = event.target instanceof Element && event.target.closest("#grid .cell, #filmstrip .cell");
    if (!cell) return;
    const id = Number(cell.dataset.id);
    if (!state.sel.has(id)) select(id);
    dragging = targets();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", plural(dragging.length, "photo"));
  });
  document.addEventListener("dragend", () => { dragging = null; clearDrop(); });
  $("nav").addEventListener("dragover", (event) => {
    const row = event.target.closest(".nav-row");
    const place = row && placeOf(row.dataset.place);
    clearDrop();
    if (!dragging || !canDrop(place)) return;
    event.preventDefault();
    row.classList.add("drop");
  });
  $("nav").addEventListener("drop", (event) => {
    const row = event.target.closest(".nav-row");
    const place = row && placeOf(row.dataset.place);
    if (!dragging || !canDrop(place)) return;
    event.preventDefault();
    if (place.icon === "album") addToAlbum(place, dragging); else movePhotos(dragging, place);
  });

  // ---------- smart albums ----------
  // A smart album is a saved filter: the same rules the filter bar uses, kept
  // under a name. It covers the whole library unless folders are unticked.

  const ruleEdit = { place: null, rules: null };
  const freshRule = (used) => {
    const field = Object.keys(FIELDS).find((k) => !used.includes(k)) || "rating";
    return { field, op: FIELDS[field].ops[0][0], value: FIELDS[field].values ? FIELDS[field].values[field === "rating" ? 3 : 0] : "" };
  };

  // The filter bar as it stands now, written as rules.
  function filterAsRules() {
    const f = state.filters;
    const list = [];
    if (f.minStars) list.push({ field: "rating", op: "gte", value: String(f.minStars) });
    if (f.picked) list.push({ field: "pick", op: "is", value: "Picked" });
    if (f.unmarked) list.push({ field: "pick", op: "is", value: "Unmarked" }, { field: "rating", op: "is", value: "0" });
    if (f.hideRejected) list.push({ field: "pick", op: "not", value: "Rejected" });
    if (f.edited) list.push({ field: "state", op: "is", value: "Edited" });
    if (f.rawOnly) list.push({ field: "type", op: "is", value: "RAW" });
    if (f.labels.size === 1) list.push({ field: "label", op: "is", value: cap([...f.labels][0]) });
    else if (f.labels.size) ["None", ...LABELS.map(cap)].filter((l) => !f.labels.has(l.toLowerCase())).forEach((l) => list.push({ field: "label", op: "not", value: l }));
    const text = f.text.trim().toLowerCase();
    if (text) list.push(allTags().has(text) ? { field: "tag", op: "is", value: text } : { field: "name", op: "is", value: text });
    f.rules.forEach((rule) => list.push(Object.assign({}, rule)));
    const here = placeOf(state.place);
    const top = here && topFolders().find((t) => t === here || (t.children || []).includes(here));
    if (!list.length) list.push(freshRule([]));
    return { mode: "all", folders: top ? [top.id] : null, list };
  }

  function openRules(place, start) {
    ruleEdit.place = place;
    ruleEdit.rules = JSON.parse(JSON.stringify(place ? place.rules : start || { mode: "all", folders: null, list: [freshRule([])] }));
    $("rules-name").value = place ? place.label : "";
    renderRules();
    $("rules").showModal();
    $("rules-name").focus();
  }

  function renderRules() {
    const r = ruleEdit.rules;
    $("rules-title").textContent = ruleEdit.place ? "Edit Smart Album" : "New Smart Album";
    $("rules-save").textContent = ruleEdit.place ? "Save" : "Create smart album";
    document.querySelectorAll("#rules-mode [data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === r.mode));
    const options = (list, chosen) => list.map(([value, text]) => `<option value="${esc(value)}" ${value === chosen ? "selected" : ""}>${esc(text)}</option>`).join("");
    $("rules-list").innerHTML = r.list.map((rule, i) => {
      const f = FIELDS[rule.field];
      const value = f.values ? `<select data-r="value">${options(f.values.map((v) => [v, v]), rule.value)}</select>`
        : `<input type="text" data-r="value" value="${esc(rule.value)}" ${rule.field === "tag" ? 'list="rules-tags" placeholder="A tag"' : f.number ? 'inputmode="numeric" placeholder="A number"' : 'placeholder="Some text"'} spellcheck="false">`;
      return `<div class="rule-row" data-rule="${i}"><select data-r="field">${options(Object.keys(FIELDS).map((k) => [k, FIELDS[k].label]), rule.field)}</select>
        <select data-r="op">${options(f.ops, rule.op)}</select>${value}<button type="button" data-r="remove" title="Remove this rule" aria-label="Remove this rule">×</button></div>`;
    }).join("") + `<datalist id="rules-tags">${[...allTags().keys()].sort().map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`;
    $("rules-folders").innerHTML = topFolders().map((f) => `<label class="opt-check"><input type="checkbox" data-folder="${f.id}" ${!r.folders || r.folders.includes(f.id) ? "checked" : ""}> ${esc(f.label)}</label>`).join("") +
      `<span class="helper">All ticked means everywhere in the library, including folders pinned later.</span>`;
    renderRuleNotes();
  }

  function renderRuleNotes() {
    const r = ruleEdit.rules;
    const live = r.list.filter((rule) => String(rule.value).trim() !== "");
    const n = photos.filter((p) => matches(p, r)).length;
    $("rules-notes").textContent = !live.length ? "Add at least one rule." : r.folders && !r.folders.length ? "No folder is ticked, so nothing can match."
      : `${plural(n, "photo")} ${n === 1 ? "matches" : "match"} now.` + (live.length < r.list.length ? " A rule with nothing filled in is ignored." : "") +
        (jobs.some((job) => job.name === "Indexing") ? " Indexing is still running, so more may turn up." : "");
    $("rules-save").disabled = !live.length;
  }

  $("rules").addEventListener("input", (event) => {
    const t = event.target;
    const r = ruleEdit.rules;
    if (t.dataset.folder) {
      const ticked = [...$("rules-folders").querySelectorAll("[data-folder]")].filter((box) => box.checked).map((box) => box.dataset.folder);
      r.folders = ticked.length === topFolders().length ? null : ticked;
    } else if (t.dataset.r) {
      const rule = r.list[Number(t.closest("[data-rule]").dataset.rule)];
      if (t.dataset.r === "field") {
        Object.assign(rule, { field: t.value, op: FIELDS[t.value].ops[0][0], value: FIELDS[t.value].values ? FIELDS[t.value].values[0] : "" });
        return renderRules();
      }
      rule[t.dataset.r] = t.value;
    }
    renderRuleNotes();
  });
  $("rules").addEventListener("click", (event) => {
    const r = ruleEdit.rules;
    const mode = event.target.closest("[data-mode]");
    if (mode) r.mode = mode.dataset.mode;
    else if (event.target.dataset.r === "remove") r.list.splice(Number(event.target.closest("[data-rule]").dataset.rule), 1);
    else if (event.target.id === "rules-add") r.list.push(freshRule(r.list.map((rule) => rule.field)));
    else if (event.target.id === "rules-cancel") return $("rules").close();
    else if (event.target.id === "rules-save") {
      const name = $("rules-name").value.trim() || "Untitled smart album";
      let place = ruleEdit.place;
      if (place) Object.assign(place, { label: name, rules: r });
      else PLACES.push(place = { id: "smart-" + Date.now(), icon: "smart", label: name, rules: r });
      $("rules").close();
      state.place = null;
      return goTo(place.id);
    } else return;
    renderRules();
  });

  // ---------- look presets ----------
  // A look is a selective copy saved under a name: the same tick list and the
  // same rules as copy and paste. A look only touches the groups it contains.

  const LOOKS = [
    { folder: "My looks", name: "Langkawi beach", parts: ["Tone", "Color", "Look", "Detail"], css: "saturate(1.3) contrast(1.08) brightness(1.04)", fav: true },
    { folder: "My looks", name: "Hotel interiors", parts: ["Tone", "Color"], css: "brightness(1.1) contrast(.95) saturate(.92)" },
    { folder: "Starter set", name: "Clean contrast", parts: ["Tone"], css: "contrast(1.14) saturate(1.05)", builtin: true },
    { folder: "Starter set", name: "Warm evening", parts: ["Tone", "Color"], css: "sepia(.28) saturate(1.25) contrast(1.05)", builtin: true, fav: true },
    { folder: "Starter set", name: "Cool shade", parts: ["Color"], css: "hue-rotate(-12deg) saturate(.9) brightness(1.03)", builtin: true },
    { folder: "Starter set", name: "Soft matte", parts: ["Tone", "Look"], css: "contrast(.86) brightness(1.08) saturate(.85)", builtin: true },
    { folder: "Starter set", name: "Faded colour film", parts: ["Color", "Look"], css: "sepia(.18) contrast(.92) saturate(.8) brightness(1.05)", builtin: true },
    { folder: "Starter set", name: "Black and white", parts: ["Color"], css: "grayscale(1) contrast(1.15)", builtin: true },
  ];
  const looksUi = { at: 0, targets: [] };

  // Preview on hover: one photo, redrawn with the look under the pointer.
  function showLook(look) {
    $("looks-image").src = large(looksUi.targets[0]);
    $("looks-image").style.filter = look.css;
  }

  function renderLooks() {
    const n = looksUi.targets.length;
    const look = LOOKS[looksUi.at];
    const folders = [...new Set(LOOKS.map((l) => l.folder))];
    const groups = [["Favourites", LOOKS.filter((l) => l.fav)], ...folders.map((folder) => [folder, LOOKS.filter((l) => l.folder === folder)])];
    $("looks-list").innerHTML = groups.filter(([, list]) => list.length).map(([name, list]) => `<div class="paste-kicker">${esc(name)}</div>` + list.map((l) => {
      const i = LOOKS.indexOf(l);
      return `<div class="recipe-row look-row${i === looksUi.at ? " selected" : ""}" data-look="${i}"><button type="button" class="look-fav${l.fav ? " on" : ""}" data-fav="${i}" title="${l.fav ? "Remove from favourites" : "Add to favourites"}" aria-label="Favourite">★</button>
        <span><strong>${esc(l.name)}</strong><small>${l.parts.join(" · ")}</small></span></div>`;
    }).join("")).join("");
    $("looks-title").textContent = `Apply Look Preset to ${n === 1 ? title(looksUi.targets[0]) : `${n} photos`}`;
    showLook(look);
    $("looks-about").innerHTML = `<p class="looks-name">${esc(look.name)}</p><p>Changes ${look.parts.join(", ")}. Everything else on each photo stays as it is, including crop, lens corrections and local adjustments.</p>
      <div class="looks-manage">` + (look.builtin
        ? `<span class="helper">Built-in look. To make your own version, apply it, adjust the photo in Grade, then save that grade as a look.</span>`
        : `<button type="button" data-look-do="rename">Rename…</button><button type="button" data-look-do="update">Update from copied grade</button><button type="button" data-look-do="export">Export…</button><button type="button" data-look-do="delete">Delete</button>`) + `</div>`;
    $("looks-notes").textContent = `${plural(n, "photo")} will change and be saved straight away. ${n === 1 ? "It keeps" : "Each keeps"} its previous grade, so this can be taken back.` +
      (looksUi.linked ? `\nThat includes ${plural(looksUi.linked, "photo")} linked to the selection.` : "") +
      (n > 1 ? `\nThe preview shows ${title(looksUi.targets[0])}.` : "");
    $("looks-go").textContent = n === 1 ? "Apply" : `Apply to ${n} photos`;
  }

  function openLooks() {
    const list = targets();
    if (!list.length) return toast("Select the photos to apply a look to.");
    looksUi.targets = withLinked(list);
    looksUi.linked = looksUi.targets.length - list.length;
    renderLooks();
    $("looks").showModal();
  }

  $("looks-list").addEventListener("mouseover", (event) => {
    const row = event.target.closest("[data-look]");
    if (row) showLook(LOOKS[Number(row.dataset.look)]);
  });
  $("looks-list").addEventListener("mouseleave", () => showLook(LOOKS[looksUi.at]));
  $("looks").addEventListener("click", (event) => {
    const fav = event.target.closest("[data-fav]");
    const row = event.target.closest("[data-look]");
    const act = event.target.dataset.lookDo;
    const look = LOOKS[looksUi.at];
    if (fav) LOOKS[Number(fav.dataset.fav)].fav = !LOOKS[Number(fav.dataset.fav)].fav;
    else if (row) looksUi.at = Number(row.dataset.look);
    else if (act === "rename") return askUser({ title: "Rename Look", fields: [{ name: "name", label: "Name", value: look.name }], buttons: [["no", "Cancel"], ["yes", "Rename", GO]] },
      (answer, v) => { if (answer === "yes" && v.name) { look.name = v.name; renderLooks(); } });
    else if (act === "update") {
      if (!clip.source) return toast("Copy a grade first (Ctrl+C on an edited photo). The look then takes its settings.");
      look.css = clip.source.look || look.css;
      toast(`“${look.name}” now holds the grade copied from ${title(clip.source)}. Photos that already use it are not changed.`);
    } else if (act === "export") return toast("Saves this look as a small file you can keep or send to someone.");
    else if (act === "delete") return askUser({ title: `Delete Look “${look.name}”?`, message: "Photos that used this look keep their grades. Only the saved look is removed.", buttons: [["no", "Cancel"], ["yes", "Delete look", "button-danger"]] },
      (answer) => { if (answer === "yes") { LOOKS.splice(looksUi.at, 1); looksUi.at = 0; renderLooks(); } });
    else if (event.target.id === "looks-import") return toast("Reads look files saved from here or from another machine.");
    else if (event.target.id === "looks-cancel") return $("looks").close();
    else if (event.target.id === "looks-go") {
      $("looks").close();
      return changeGrades(looksUi.targets, (p) => { p.look = look.css; }, `look “${look.name}”`, `“${look.name}” applied to`);
    } else return;
    renderLooks();
  });

  // From the paste window: the copied grade and the ticks, saved under a name.
  function saveLook() {
    const parts = chosenLabels().map((label) => label.replace(" (part)", ""));
    if (!parts.length) return toast("Tick what the look should contain first.");
    askUser({
      title: "Save as Look Preset",
      message: `Saves the ticked settings from ${title(clip.source)}: ${parts.join(", ")}. The look can then be applied to any photo or selection.`,
      fields: [{ name: "name", label: "Name", placeholder: "Look name" }, { name: "folder", label: "Folder", value: "My looks" }],
      buttons: [["no", "Cancel"], ["yes", "Save look", GO]],
    }, (answer, v) => {
      if (answer !== "yes") return;
      LOOKS.unshift({ folder: v.folder || "My looks", name: v.name || "Untitled look", parts, css: clip.source.look || "contrast(1.1) saturate(1.12)" });
      toast(`Look “${LOOKS[0].name}” saved. Apply it with right-click, Apply look preset.`);
    });
  }

  // ---------- background work ----------
  // Indexing, HDR previews and moves between drives run in the background and
  // show in the bottom bar. Click one to pause or cancel it.

  const jobs = [];
  function startJob(job) {
    Object.assign(job, { done: 0, paused: false });
    jobs.push(job);
    job.timer = setInterval(() => {
      if (job.paused) return;
      if (job.step) job.step(job.done);
      job.done = Math.min(job.total, job.done + (job.by || 1));
      if (job.done >= job.total) return endJob(job, false);
      renderStatus();
    }, job.rate || 450);
    renderStatus();
    return job;
  }
  function endJob(job, cancelled) {
    clearInterval(job.timer);
    jobs.splice(jobs.indexOf(job), 1);
    if (job.finish) job.finish(cancelled);
    renderStatus();
  }
  function jobsStatus() {
    return jobs.map((job, i) => `<button type="button" class="export-progress" data-job="${i}" style="--done:${(job.done / job.total) * 100}%" title="Click to pause or cancel"><i></i>${job.paused ? "Paused · " : ""}${job.name} · ${job.done.toLocaleString()} of ${job.total.toLocaleString()}</button>`).join("");
  }
  $("status").addEventListener("click", (event) => {
    const button = event.target.closest("[data-job]");
    const job = button && jobs[Number(button.dataset.job)];
    if (!job) return;
    const at = button.getBoundingClientRect();
    openMenu(at.left, at.top - 96, [{ header: job.name }, { label: job.paused ? "Resume" : "Pause", action: () => { job.paused = !job.paused; renderStatus(); } }, { label: "Cancel", action: () => endJob(job, true) }]);
  });

  // A folder that background work is using: the change waits, or the work is stopped cleanly.
  function whenFree(what, proceed) {
    if (!jobs.length) return proceed();
    const job = jobs[0];
    askUser({ title: "This Folder Is Busy", message: `${job.name} is still working here. ${cap(what)} can wait until it finishes, or you can stop that work now. Nothing is left half done either way.`,
      buttons: [["no", "Cancel"], ["wait", "Do it when finished"], ["stop", "Stop it and continue", GO]] }, (answer) => {
      if (answer === "stop") { [...jobs].forEach((j) => endJob(j, true)); proceed(); }
      if (answer === "wait") { const finish = job.finish; job.finish = (cancelled) => { if (finish) finish(cancelled); proceed(); }; toast(`${cap(what)} will happen when ${job.name.toLowerCase()} finishes.`); }
    });
  }

  function startIndexing(total) {
    if (jobs.some((job) => job.name === "Indexing")) return;
    startJob({ name: "Indexing", total, by: Math.max(1, Math.ceil(total / 60)), rate: 280, finish: (cancelled) => toast(cancelled ? "Indexing stopped. It carries on the next time the folder is opened." : `Indexing finished: ${total.toLocaleString()} photos.`) });
  }

  // ---------- HDR previews ----------
  // The grid is SDR unless HDR is switched on. Previews are made in the
  // background and each thumbnail switches to HDR as its preview is ready.

  function makeHdr(list, quiet) {
    const todo = list.filter((p) => !p.hdr && !p.hdrQueued);
    if (!todo.length) return quiet ? null : toast("These photos already have HDR previews.");
    todo.forEach((p) => { p.hdrQueued = true; });
    startJob({ name: "HDR previews", total: todo.length, rate: 420,
      step: (i) => { Object.assign(todo[i], { hdr: true, hdrQueued: false }); refresh(); },
      finish: (cancelled) => { todo.forEach((p) => { p.hdrQueued = false; }); refresh(); toast(cancelled ? "Stopped. The HDR previews already made are kept." : `HDR previews ready for ${plural(todo.length, "photo")}.`); } });
    toast(`Making HDR previews for ${plural(todo.length, "photo")} in the background.` + (app.dataset.hdr === "on" ? "" : " Press H to see them in the grid."));
  }

  function toggleHdr() {
    const on = app.dataset.hdr !== "on";
    app.dataset.hdr = on ? "on" : "off";
    $("hdr-button").setAttribute("aria-pressed", on);
    if (on) makeHdr(state.shown, true);
    refresh();
  }
  $("hdr-button").addEventListener("click", () => openOptions("hdr", $("hdr-button")));

  // ---------- reverts ----------

  function revert(kind) {
    const picked = withLinked(targets());
    const list = picked.filter((p) => (kind === "session" ? p.session : p.edited));
    if (!list.length) return;
    const n = list.length;
    const original = kind === "original";
    askUser({
      title: original ? `Revert ${n === 1 ? title(list[0]) : `${n} Photos`} to Original?` : `Revert ${n === 1 ? title(list[0]) : `${n} Photos`} to Last Session?`,
      message: (original ? `All adjustments are cleared on ${plural(n, "photo")}.` : `${plural(n, "photo")} ${n === 1 ? "goes" : "go"} back to the grade ${n === 1 ? "it" : "they"} had when HDR Finisher was started today.`) +
        ` ${n === 1 ? "It keeps" : "Each keeps"} its previous grade, so this can be taken back. Marks and tags are not touched.`,
      buttons: [["no", "Cancel"], ["yes", "Revert", GO]],
    }, (answer) => {
      if (answer !== "yes") return;
      changeGrades(list, (p) => Object.assign(p, original ? { look: "", edited: false } : p.session), original ? "revert to original" : "revert to last session", original ? "Reverted to original:" : "Reverted to last session:");
    });
  }

  // ---------- linked photos (sync) ----------
  // Linked photos share one grade. A change to any one of them, in Grade or by
  // a paste, a look or a revert, reaches all of them.

  let linkSerial = 1;
  const mates = (p) => (p.link ? photos.filter((o) => o.link === p.link) : [p]);
  const withLinked = (list) => [...new Set(list.flatMap(mates))];
  const linksNow = () => photos.map((p) => ({ p, link: p.link }));
  const tidyLinks = () => photos.forEach((p) => { if (p.link && mates(p).length < 2) p.link = undefined; });

  function linkPhotos() {
    const list = withLinked(targets());
    if (list.length < 2) return toast("Select two or more photos to link.");
    const lead = list.includes(byId(state.active)) ? byId(state.active) : list[0];
    askUser({
      title: `Link ${list.length} Photos`,
      message: "Linked photos share one grade. From now on a change to any one of them reaches all of them: an edit in Grade, a paste, a look or a revert.\n\nCrop, lens corrections and local adjustments are never linked. Each photo keeps its previous grade, so this can be taken back.",
      fields: [{ name: "from", label: "Start all of them from the grade of", options: list.map(title), value: title(lead) }],
      buttons: [["no", "Cancel"], ["yes", "Link", GO]],
    }, (answer, v) => {
      if (answer !== "yes") return;
      const source = list.find((p) => title(p) === v.from) || lead;
      const links = linksNow();
      const id = linkSerial++;
      list.forEach((p) => { p.link = id; });
      tidyLinks();
      const entry = changeGrades(list.filter((p) => p !== source), (p) => Object.assign(p, { look: source.look, edited: source.edited }), "link", `Linked. Grade of ${source.name} applied to`);
      entry.also = () => links.forEach(({ p, link }) => { p.link = link; });
    });
  }

  function unlinkPhotos() {
    const list = targets().filter((p) => p.link);
    const links = linksNow();
    list.forEach((p) => { p.link = undefined; });
    tidyLinks();
    state.undo.push({ back: () => links.forEach(({ p, link }) => { p.link = link; }), text: `Linked ${plural(list.length, "photo")} again` });
    refresh();
    toast(`${plural(list.length, "photo")} unlinked. Each keeps the grade it has now. Ctrl+Z undoes it.`);
  }

  // ---------- file and folder controls ----------
  // These change files on disk. Everything attached travels: the settings
  // file, so grades, marks, tags and virtual copies. Clashes stop and ask.

  const nameParts = (name) => { const dot = name.lastIndexOf("."); return [name.slice(0, dot), name.slice(dot)]; };

  function renamePhoto(p, typed) {
    const [base, ending] = nameParts(p.name);
    askUser({ title: `Rename ${p.name}`, message: `The ending ${ending} stays. The grade, marks, tags and virtual copies stay attached.`, fields: [{ name: "name", label: "New name", value: typed || base }], buttons: [["no", "Cancel"], ["yes", "Rename", GO]] }, (answer, v) => {
      const name = v.name + ending;
      if (answer !== "yes" || !v.name || name === p.name) return;
      if (state.shown.some((o) => o !== p && o.copyOf === undefined && o.name.toLowerCase() === name.toLowerCase())) {
        return askUser({ title: "That Name Is Taken", message: `A file called ${name} is already in this folder. Nothing was renamed.`, buttons: [["no", "Cancel"], ["yes", "Choose another name", GO]] },
          (again) => { if (again === "yes") renamePhoto(p, v.name); });
      }
      const all = [p, ...copiesOf(p)];
      const old = p.name;
      all.forEach((x) => { x.name = name; });
      state.undo.push({ back: () => all.forEach((x) => { x.name = old; }), text: `Renamed ${name} back to ${old}` });
      renderGrid(false);
      refresh();
      toast(`Renamed to ${name}. Ctrl+Z undoes it.`);
    });
  }

  const folderChoices = () => flatPlaces().filter((f) => (f.icon === "folder" || f.icon === "card") && !f.offline)
    .map((f) => ({ place: f, path: (PLACES.find((t) => (t.children || []).includes(f)) || { label: "" }).label + (PLACES.includes(f) ? "" : " › ") + f.label }));

  function askMove(list) {
    const choices = folderChoices().filter((c) => c.place.id !== state.place);
    const n = list.filter((p) => p.copyOf === undefined).length || list.length;
    askUser({ title: n === 1 ? `Move ${list[0].name}` : `Move ${n} Photos`, message: "The files are moved on disk. Grades, marks, tags and virtual copies go with them, and albums keep them.",
      fields: [{ name: "to", label: "Move to", options: choices.map((c) => c.path) }], buttons: [["no", "Cancel"], ["yes", "Move", GO]] },
    (answer, v) => { if (answer === "yes") movePhotos(list, choices.find((c) => c.path === v.to).place); });
  }

  function movePhotos(picked, dest) {
    const direct = (p) => inFolder(p, dest) && !(dest.children || []).some((c) => inFolder(p, c));
    const roots = [...new Set(picked.map((p) => (p.copyOf === undefined ? p : byId(p.copyOf))))].filter((p) => !direct(p));
    if (!roots.length) return toast(`Already in ${dest.label}.`);
    const onCard = (p) => PLACES.some((f) => f.icon === "card" && inFolder(p, f));
    const far = (dest.icon === "card") !== roots.some(onCard);
    const go = (skip, numbered) => {
      const moving = roots.filter((p) => p !== skip);
      const before = moving.flatMap((p) => [p, ...copiesOf(p)]).map((p) => ({ p, folder: p.folder, name: p.name }));
      if (numbered) { const [base, ending] = nameParts(numbered.name); [numbered, ...copiesOf(numbered)].forEach((x) => { x.name = `${base} (2)${ending}`; }); }
      const land = (p) => [p, ...copiesOf(p)].forEach((x) => { x.folder = dest.id; });
      const done = (cancelled) => {
        state.undo.push({ back: () => before.forEach(({ p, folder, name }) => { p.folder = folder; p.name = name; }), text: `Moved ${plural(moving.length, "photo")} back` });
        afterRemoval([]);
        const moved = moving.filter(direct).length;
        toast(`${plural(moved, "photo")} moved to ${dest.label}.` + (skip ? " 1 skipped: its name was already taken." : "") + (cancelled ? ` ${moving.length - moved} not moved; they are still in the old place.` : "") + " Ctrl+Z undoes the move.");
      };
      if (!far) { moving.forEach(land); return done(false); }
      // Another drive: copy, check the copy, and only then remove the original.
      startJob({ name: `Moving to ${dest.label}`, total: moving.length, rate: 700, step: (i) => { land(moving[i]); computeShown(); renderNav(); renderGrid(false); refresh(); }, finish: done });
      toast(`Moving ${plural(moving.length, "photo")} to another drive. Each is copied and checked before the original is removed.`);
    };
    if (!$("opt-clash").checked) return go(null, null);
    $("opt-clash").checked = false;
    const clash = roots[0];
    askUser({
      title: "A File With This Name Is Already There",
      message: `${dest.label} already holds a file called ${clash.name}. Nothing has been moved or overwritten.` + (roots.length > 1 ? `\n\nThe other ${plural(roots.length - 1, "photo")} can move as normal.` : ""),
      buttons: [["cancel", "Cancel move"], ["skip", roots.length > 1 ? "Skip this one" : "Leave it"], ["both", "Keep both", GO]],
    }, (answer) => {
      if (answer === "both") go(null, clash);
      if (answer === "skip" && roots.length > 1) go(clash, null);
    });
  }

  function newFolder(place) {
    askUser({ title: `New Folder in ${place.label}`, message: "Creates the folder on disk.", fields: [{ name: "name", label: "Name", placeholder: "Folder name" }], buttons: [["no", "Cancel"], ["yes", "Create folder", GO]] }, (answer, v) => {
      if (answer !== "yes" || !v.name) return;
      if ((place.children || []).some((c) => c.label.toLowerCase() === v.name.toLowerCase())) return toast(`${place.label} already has a folder called ${v.name}. Nothing was created.`);
      if (!place.children) Object.assign(place, { children: [], ownScenes: place.scenes || [] });
      place.children.push({ id: "folder-" + Date.now(), icon: "folder", label: v.name, scenes: [] });
      place.open = true;
      renderNav();
      toast(`Folder ${v.name} created in ${place.label}. Drag photos onto it to move them there.`);
    });
  }

  function renameFolder(place, labelOnly) {
    whenFree("the rename", () => askUser({
      title: labelOnly ? "Rename Label" : `Rename Folder ${place.label}`,
      message: labelOnly ? "Changes only the name shown in this list. The folder on disk keeps its name." : "Renames the folder on disk. The photos in it keep their grades, marks, albums and previews, and nothing is indexed again.",
      fields: [{ name: "name", label: "Name", value: place.label }], buttons: [["no", "Cancel"], ["yes", "Rename", GO]],
    }, (answer, v) => {
      if (answer !== "yes" || !v.name || v.name === place.label) return;
      const parent = PLACES.find((t) => (t.children || []).includes(place));
      if (!labelOnly && parent.children.some((c) => c !== place && c.label.toLowerCase() === v.name.toLowerCase())) return toast(`${parent.label} already has a folder called ${v.name}. Nothing was renamed.`);
      const old = place.label;
      place.label = v.name;
      state.undo.push({ back: () => { place.label = old; }, text: `Renamed ${v.name} back to ${old}` });
      renderNav();
      renderGrid(false);
      refresh();
    }));
  }

  function moveFolder(place) {
    const parent = PLACES.find((t) => (t.children || []).includes(place));
    const others = topFolders().filter((t) => t !== parent);
    if (!others.length) return toast("Pin another folder first, so there is somewhere to move this one.");
    whenFree("the move", () => askUser({
      title: `Move Folder ${place.label}`, message: `Moves the folder and everything in it on disk: ${plural(inPlace(place).length, "photo")} with their grades, marks and virtual copies. Albums keep them.`,
      fields: [{ name: "to", label: "Move into", options: others.map((t) => t.label) }], buttons: [["no", "Cancel"], ["yes", "Move folder", GO]],
    }, (answer, v) => {
      if (answer !== "yes") return;
      const dest = others.find((t) => t.label === v.to);
      if ((dest.children || []).some((c) => c.label.toLowerCase() === place.label.toLowerCase())) return toast(`${dest.label} already has a folder called ${place.label}. Nothing was moved.`);
      if (!dest.children) Object.assign(dest, { children: [], ownScenes: dest.scenes || [] });
      const at = parent.children.indexOf(place);
      parent.children.splice(at, 1);
      dest.children.push(place);
      dest.open = true;
      state.undo.push({ back: () => { dest.children.splice(dest.children.indexOf(place), 1); parent.children.splice(at, 0, place); }, text: `Moved ${place.label} back to ${parent.label}` });
      computeShown();
      renderNav();
      renderGrid(false);
      refresh();
      toast(`${place.label} moved into ${dest.label}. Ctrl+Z moves it back.`);
    }));
  }

  // ---------- projects: export, open, relink ----------

  function exportProject(what, list) {
    const n = list.filter((p) => p.copyOf === undefined).length || list.length;
    const withPhotos = `Grades and source photos (${plural(n, "photo")}, about ${(n * 0.06).toFixed(1)} GB)`;
    askUser({
      title: `Export Project From ${what}`,
      message: "A project is a folder that can be handed to someone else or moved to another machine. Exporting makes a copy: afterwards the project and your library can drift apart.",
      fields: [{ name: "name", label: "Project name", value: what.replace(/\.[^.]+$/, "") }, { name: "where", label: "Save in", value: "D:\\Projects" },
        { name: "include", label: "Include", options: ["Grades only (small; the receiver needs the photos)", withPhotos] },
        { name: "copies", label: "Virtual copies", options: ["All virtual copies", "Only the main grade of each photo"] },
        { name: "extras", label: "Also include", options: ["The export recipes and looks these photos use", "Nothing else"] },
        { name: "pack", label: "Save as", options: ["A project folder", "One file, for sending"] }],
      buttons: [["no", "Cancel"], ["yes", "Export project", GO]],
    }, (answer, v) => {
      if (answer !== "yes") return;
      startJob({ name: "Exporting project", total: n, rate: v.include === withPhotos ? 500 : 120, finish: (cancelled) => toast(cancelled ? "Project export cancelled. The unfinished project folder was removed." : `Project “${v.name}” exported to ${v.where}.`) });
    });
  }

  // Stands in for opening a project folder someone sent, with no photos in it.
  function openProject() {
    const name = "Riverside Wedding";
    if (PLACES.some((f) => f.label === name)) return toast("In the app this opens a file picker. The sample project is already open.");
    const all = inPlace(placeOf("trip-2")).filter((p) => p.copyOf === undefined);
    if (all.length < 3) return toast("In the app this opens a file picker for a project folder.");
    const missing = all.slice(-2);
    const found = all.slice(0, -2);
    askUser({
      title: `Open Project “${name}”`,
      message: `This project holds ${all.length} grades and no photos. ${found.length} of the photos are already in your library, matched by ID and checked by content. ${missing.length} were not found.\n\nMerge puts each grade beside its photo as a new virtual copy; nothing of yours is overwritten. Keep separate leaves the project as its own small library.`,
      fields: [{ name: "how", label: "The grades", options: ["Merge into my library", "Keep separate"] }, { name: "album", label: "After a merge", options: ["Make an album of these photos", "No album"] }],
      buttons: [["no", "Cancel"], ["yes", "Open project", GO]],
    }, (answer, v) => {
      if (answer !== "yes") return;
      const merge = v.how === "Merge into my library";
      const place = { id: "project-" + Date.now(), icon: "project", label: name, ids: new Set((merge ? missing : all).map((p) => p.id)), missing: new Set(missing.map((p) => p.id)) };
      PLACES.splice(PLACES.findIndex((f) => f.heading === "Albums"), 0, place);
      if (merge) {
        const made = found.map((p) => Object.assign(makeCopy(p, name), { look: "sepia(.2) contrast(1.1) saturate(1.15)", edited: true }));
        const album = v.album === "No album" ? null : { id: "album-" + Date.now(), icon: "album", label: name, ids: new Set(made.map((c) => c.id)) };
        if (album) PLACES.splice(PLACES.findIndex((f) => f.rules) < 0 ? PLACES.length : PLACES.findIndex((f) => f.rules), 0, album);
        state.undo.push({ back: () => { made.forEach((c) => photos.splice(photos.indexOf(c), 1)); [place, album].forEach((x) => { if (x) PLACES.splice(PLACES.indexOf(x), 1); }); if (!placeOf(state.place)) state.place = "trip-2"; }, text: `Took the merged project “${name}” out again` });
      }
      state.place = null;
      goTo(place.id);
      toast(merge ? `${plural(found.length, "grade")} merged as virtual copies. ${missing.length} are waiting for their photos here: right-click the project to relink.`
        : `Project opened. ${missing.length} of its photos are missing: right-click the project to relink. You can keep working on the rest.`);
    });
  }

  const relink = { place: null, rows: [] };
  function openRelink(place) {
    if (!place.missing || !place.missing.size) return toast(`Nothing is missing in ${place.label}.`);
    relink.place = place;
    relink.rows = [...place.missing].map((id) => ({ p: byId(id), state: "missing" })).filter((row) => row.p);
    renderRelink();
    $("relink").showModal();
  }
  function renderRelink() {
    const words = { missing: "Missing", found: "Found, content matches", differs: "Name matches, content differs", forced: "Will be used although the content differs", hand: "Chosen by hand" };
    $("relink-title").textContent = `Relink Photos in ${relink.place.label}`;
    $("relink-list").innerHTML = relink.rows.map((row, i) => `<div class="result-row relink-row ${row.state}"><span class="file">${esc(row.p.name)}${row.where ? `<small>${esc(row.where)}</small>` : ""}</span><span class="state">${words[row.state]}</span>
      ${row.state === "differs" ? `<button type="button" data-relink-use="${i}">Use anyway</button>` : ""}<button type="button" data-relink-pick="${i}">Choose file…</button></div>`).join("");
    const ready = relink.rows.filter((row) => row.state !== "missing" && row.state !== "differs").length;
    const left = relink.rows.length - ready;
    $("relink-notes").textContent = `${plural(relink.rows.length, "photo")} missing. ${ready} ready to relink` + (left ? `, ${left} still to find. You can relink what is found and keep working with the rest offline.` : ".");
    $("relink-go").textContent = ready ? `Relink ${ready}` : "Relink";
    $("relink-go").disabled = !ready;
  }
  $("relink").addEventListener("click", (event) => {
    const t = event.target;
    if (t.id === "relink-close") return $("relink").close();
    if (t.id === "relink-browse") return toast("Opens the same folder picker as Add folder.");
    if (t.id === "relink-search") {
      // The pretend search finds the first by name and content, the second by name only.
      relink.rows.filter((row) => row.state === "missing").forEach((row, i) => Object.assign(row, { state: i ? "differs" : "found", where: `${$("relink-folder").value}\\2025\\${row.p.name}` }));
    } else if (t.dataset.relinkUse) relink.rows[Number(t.dataset.relinkUse)].state = "forced";
    else if (t.dataset.relinkPick) Object.assign(relink.rows[Number(t.dataset.relinkPick)], { state: "hand", where: `D:\\Photos\\Recovered\\${relink.rows[Number(t.dataset.relinkPick)].p.name}` });
    else if (t.id === "relink-go") {
      const ready = relink.rows.filter((row) => row.state !== "missing" && row.state !== "differs");
      ready.forEach((row) => relink.place.missing.delete(row.p.id));
      $("relink").close();
      renderNav();
      refresh();
      return toast(`${plural(ready.length, "photo")} relinked.` + (relink.place.missing.size ? ` ${relink.place.missing.size} still missing.` : " Nothing is missing now."));
    } else return;
    renderRelink();
  });

  // ---------- library settings ----------

  const prefs = { cacheGb: 20, previewEdge: "2560", indexing: true, processor: "Low", battery: true, skip: [] };
  try { Object.assign(prefs, JSON.parse(recall("prefs", "{}"))); } catch (e) { /* defaults */ }

  function renderSettings() {
    const field = (label, control) => `<label class="lib-export-field"><span>${label}</span>${control}</label>`;
    const pick = (name, options) => `<select data-pref="${name}">${options.map((o) => `<option ${String(prefs[name]) === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    const toggle = (label, attr, on, note) => `<label class="opt-row"><span>${label}${note ? `<small>${note}</small>` : ""}</span><input type="checkbox" class="opt-switch" ${attr} ${on ? "checked" : ""}></label>`;
    $("settings-body").innerHTML = `
      <div class="paste-kicker">Saving</div>
      ${toggle("Autosave grades", "data-pref-autosave", autosaveOn(), "Off: Grade asks Save, Don't save or Cancel when you switch photos. Marks and tags always save at once.")}
      <div class="paste-kicker">Previews and cache</div>
      <div class="settings-pair">
        ${field("Cache size limit (GB) *", `<input type="text" inputmode="numeric" class="mono" data-pref="cacheGb" value="${prefs.cacheGb}">`)}
        ${field("HDR preview size, long edge *", pick("previewEdge", ["1920", "2560", "3840"]))}
      </div>
      <div class="settings-use"><i style="--done:${Math.min(100, (6.2 / prefs.cacheGb) * 100)}%"></i><span>6.2 GB of ${prefs.cacheGb} GB used. When full, the previews not looked at for longest are removed, a batch at a time.</span></div>
      <div class="settings-pair">
        ${field("Cache location", `<span class="lib-export-path"><input type="text" value="C:\\Users\\You\\AppData\\Local\\HDR Finisher\\Cache" spellcheck="false"><button type="button" data-settings-do="move">Change…</button></span>`)}
        ${field("Brightness limit in the HDR grid (nits)", `<input type="text" inputmode="numeric" class="mono" data-pref-cap value="${hdr.cap}">`)}
      </div>
      <button type="button" class="text-button" data-settings-do="clear">Clear the cache…</button>
      <div class="paste-kicker">Background indexing</div>
      ${toggle("Index pinned folders and projects in the background", 'data-pref="indexing"', prefs.indexing, "Off: a folder is read only when you open it, and searches and smart albums cover only what has been opened.")}
      <div class="settings-pair">
        ${field("Processor use", pick("processor", ["Low", "Medium", "High"]))}
        <label class="opt-check settings-check"><input type="checkbox" data-pref="battery" ${prefs.battery ? "checked" : ""}> Pause on battery power</label>
      </div>
      <div class="lib-export-field"><span>Leave these pinned folders out</span>
        <div class="rules-folders">${PLACES.filter((f) => f.icon === "folder").map((f) => `<label class="opt-check"><input type="checkbox" data-pref-skip="${f.id}" ${prefs.skip.includes(f.id) ? "checked" : ""}> ${esc(f.label)}</label>`).join("")}</div></div>
      <p class="helper">Indexing always gives way to grading and exporting, and uses the graphics card only when it is idle.</p>`;
  }
  $("settings-button").addEventListener("click", () => { renderSettings(); $("settings").showModal(); });
  $("settings").addEventListener("input", (event) => {
    const t = event.target;
    if (t.dataset.prefAutosave !== undefined) return $("autosave").click();
    if (t.dataset.prefCap !== undefined) { hdr.cap = Math.max(100, Number(t.value.replace(/\D/g, "")) || 1000); remember("hdr-cap", hdr.cap); return refresh(); }
    if (t.dataset.prefSkip) prefs.skip = [...$("settings").querySelectorAll("[data-pref-skip]")].filter((box) => box.checked).map((box) => box.dataset.prefSkip);
    else if (t.dataset.pref) prefs[t.dataset.pref] = t.type === "checkbox" ? t.checked : t.dataset.pref === "cacheGb" ? Math.max(1, Number(t.value.replace(/\D/g, "")) || 20) : t.value;
    else return;
    remember("prefs", JSON.stringify(prefs));
  });
  $("settings").addEventListener("click", (event) => {
    const act = event.target.dataset.settingsDo;
    if (event.target.id === "settings-close") return $("settings").close();
    if (act === "move") return toast("Moves the cache to another drive. Previews already made move with it.");
    if (act === "clear") askUser({ title: "Clear the Cache?", message: "Removes all thumbnails, previews and focus and exposure maps (6.2 GB). No photo, grade, mark or tag is touched. Everything is made again as you browse.", buttons: [["no", "Cancel"], ["yes", "Clear cache", "button-danger"]] },
      (answer) => { if (answer === "yes") { photos.forEach((p) => { p.hdr = false; }); refresh(); toast("Cache cleared."); } });
  });

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
  // Tiles: every photo sits on its own quiet tile, so its marks have a home.
  function setTiles(tiles) {
    app.dataset.tiles = tiles;
    remember("tiles", tiles);
    document.querySelectorAll("button[data-tiles]").forEach((b) => b.classList.toggle("on", b.dataset.tiles === tiles));
  }
  $("mock-strip").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.fit) setFit(b.dataset.fit);
    if (b.dataset.tiles) setTiles(b.dataset.tiles);
    if (b.id === "keys-button") $("keys").hidden = !$("keys").hidden;
    if (b.id === "mock-edit") pretendEdit();
    b.blur();
  });
  $("opt-names").addEventListener("change", () => { app.dataset.names = $("opt-names").checked ? "on" : "off"; });
  document.querySelectorAll(".mock-check input").forEach((box) => box.addEventListener("change", () => box.blur()));

  // ---------- start ----------

  // The address can ask for a starting state, for example
  // index.html?place=trip&view=single&details=collapsed&nav=collapsed&filter=on
  app.appendChild($("toast"));
  const ask = new URLSearchParams(location.search);
  setFit(ask.get("fit") || recall("fit", "contain"));
  setTiles(ask.get("tiles") || recall("tiles", "on"));
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
  if (ask.has("export")) openExport();
  if (ask.has("results")) { run.list = targets(); startExport(); run.jobs.slice(0, 5).forEach((j) => { if (j.state === "waiting") j.state = "done"; }); run.at = 5; clearInterval(run.timer); refresh(); openResults(); }
  if (ask.has("paste")) {
    clip.source = photos.find((p) => p.edited);
    clip.targets = targets().filter((p) => p !== clip.source);
    clip.open.add("tone");
    openPaste();
  }
  if (ask.has("menu")) openMenu(900, 300, photoMenu());
  if (ask.has("allfacts")) { state.allFacts = true; refresh(); }
  if (ask.has("looks")) openLooks();
  if (ask.has("settings")) $("settings-button").click();
  if (ask.has("hdr")) toggleHdr();
  if (ask.has("project")) openProject();
  if (ask.has("tags")) openTags();
  if (ask.has("rules")) openRules(placeOf("smart"));
  if (ask.has("copy")) createCopies();
  if (ask.has("unsaved")) { $("autosave").click(); openInGrade(); pretendEdit(); setStage("library"); select(state.shown[1].id); openInGrade(); }
  if (ask.get("view") === "single") setView("single");
  if (ask.get("view") === "compare") setView("compare");
  if (ask.get("zoom") === "on") setZoom(true, 0.5, 0.45);
  if (ask.get("view") === "grade") openInGrade();
  if (ask.get("view") === "review") { state.review = true; $("review").hidden = false; refresh(); }
})();
