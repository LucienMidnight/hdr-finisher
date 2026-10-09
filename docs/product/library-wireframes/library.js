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
  };

  const remember = (key, value) => { try { localStorage.setItem("libmock-" + key, value); } catch (e) { /* fine */ } };
  const recall = (key, fallback) => { try { return localStorage.getItem("libmock-" + key) || fallback; } catch (e) { return fallback; } };

  const byId = (id) => photos.find((p) => p.id === id);
  const flatPlaces = () => PLACES.flatMap((p) => [p, ...(p.children || [])]).filter((p) => p.id);
  const placeOf = (id) => flatPlaces().find((p) => p.id === id);
  const inPlace = (place) => photos.filter((p) => (place.match ? place.match(p) : (place.scenes || []).includes(p.scene)));

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
        rows.push(`<div class="nav-heading"><span>${p.heading}</span>${p.add ? `<button type="button" class="nav-add" title="${p.add}" aria-label="${p.add}">${icon("plus")}</button>` : ""}</div>`);
      } else row(p, 0);
    });
    $("nav").innerHTML = rows.join("");
  }

  $("nav").addEventListener("click", (event) => {
    if (event.target.closest(".nav-add")) return toast("The Add folder picker comes in a later round.");
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

  function cellHtml(p) {
    return `<div class="cell" data-id="${p.id}"><div class="frame"><img src="photos/t/${String(p.id).padStart(3, "0")}.jpg" alt="" loading="lazy"></div>
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
    $("empty").innerHTML = total ? "<p>No photos match the filter.</p>" : "<p>No photos here yet.</p>";
    $("place-title").textContent = place.label;
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
      cell.querySelector(".marks").innerHTML = marksHtml(p);
    });
    app.dataset.view = state.view;
    $("grid").hidden = state.view !== "grid";
    $("single").hidden = state.view !== "single";
    document.querySelectorAll("[data-view-button]").forEach((b) => b.classList.toggle("active", b.dataset.viewButton === state.view));
    if (state.view === "single") renderSingle();
    if (state.review) renderReview();
    renderDetails();
    renderStatus();
    renderFilters();
  }

  function renderStatus() {
    const all = inPlace(placeOf(state.place));
    const count = (test) => all.filter(test).length;
    const parts = [`<b>${state.shown.length}</b> photos`];
    if (state.sel.size > 1) parts.push(`<b>${state.sel.size}</b> selected`);
    parts.push(`<b>${count((p) => p.flag === "pick")}</b> picked`, `<b>${count((p) => p.flag === "reject")}</b> rejected`);
    $("status").innerHTML = parts.map((t) => `<span>${t}</span>`).join("");
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
    select(Number(cell.dataset.id), event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "range" : "single");
  }
  $("grid").addEventListener("click", onCellClick);
  $("filmstrip").addEventListener("click", onCellClick);
  $("grid").addEventListener("dblclick", (event) => { if (event.target.closest(".cell")) openInGrade(); });
  $("single-stage").addEventListener("dblclick", openInGrade);

  // ---------- marks ----------

  function targets() {
    return [...state.sel].map(byId);
  }

  function mark(change, label) {
    const list = targets();
    if (!list.length) return;
    state.undo.push(list.map((p) => ({ p, stars: p.stars, flag: p.flag })));
    list.forEach(change);
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
    last.forEach(({ p, stars, flag }) => { p.stars = stars; p.flag = flag; });
    computeShown();
    renderGrid(false);
    refresh();
    toast(last.length > 1 ? `Undid marks on ${last.length} photos` : "Undid last mark");
  }

  // ---------- single photo and full-screen review ----------

  const large = (p) => `photos/${String(p.id).padStart(3, "0")}.jpg`;

  function show(img, p) {
    if (img.dataset.id === String(p.id)) return;
    img.dataset.id = p.id;
    if ($("opt-slow").checked) {
      // The small thumbnail first, the screen-sized preview a moment later.
      img.src = `photos/t/${String(p.id).padStart(3, "0")}.jpg`;
      img.style.width = "100%"; img.style.height = "100%";
      setTimeout(() => { if (img.dataset.id === String(p.id)) img.src = large(p); }, 160);
    } else {
      img.style.width = img.style.height = "";
      img.src = large(p);
    }
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
    $("single-caption").innerHTML = `<span>${p.name}</span><span class="stars">${"★".repeat(p.stars)}</span>${p.flag ? icon(p.flag === "pick" ? "flag" : "reject") : ""}<span>${index} / ${state.shown.length}</span>`;
  }

  function renderReview() {
    const p = current();
    if (!p) return;
    show($("review-image"), p);
    $("review-image").classList.toggle("rejected", p.flag === "reject");
    $("review-marks").innerHTML = `<span>${"★".repeat(p.stars)}</span>${p.flag ? icon(p.flag === "pick" ? "flag" : "reject") : ""}`;
  }

  function setView(view) {
    state.view = view;
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
    $("review").hidden = !on;
    if (on) {
      renderReview();
      if ($("review").requestFullscreen) $("review").requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) document.exitFullscreen();
    refresh();
  }
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

  function openInGrade() {
    const p = current();
    if (!p) return;
    if (state.review) setReview(false);
    $("grade-image").src = large(p);
    $("grade-name").textContent = p.name;
    const auto = $("autosave").getAttribute("aria-pressed") === "true";
    $("grade-note").textContent = auto
      ? "Stand-in for the Grade workspace. Autosave is on: changes save beside the photo, and switching photos never asks."
      : "Stand-in for the Grade workspace. Autosave is off: switching to another photo asks Save / Don't save / Cancel if this one has unsaved work.";
    setStage("grade");
  }

  document.querySelectorAll("[data-stage-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const stage = tab.dataset.stageTab;
    if (stage === "library") return setStage("library");
    if (stage === "grade") return openInGrade();
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
    const title = `<div class="details-title"><span class="panel-title">Details</span></div>`;
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
    $("details-button").setAttribute("aria-pressed", app.dataset.details === "on");
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

  document.querySelectorAll("[data-view-button]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.viewButton)));
  $("review-button").addEventListener("click", () => setReview(true));
  $("thumb-size").addEventListener("input", () => $("grid").style.setProperty("--thumb", $("thumb-size").value + "px"));
  $("popout").addEventListener("click", () => toast("Pop-out: the library moves to its own window and this window switches to Grade. Later round."));

  function toggleDetails() {
    app.dataset.details = app.dataset.details === "on" ? "off" : "on";
    renderFilters();
  }
  $("details-button").addEventListener("click", toggleDetails);

  let toastTimer;
  function toast(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2600);
  }

  // ---------- keyboard ----------

  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof Element && event.target.matches("input[type=text]");
    const key = event.key;
    if (key === "Escape") {
      if (typing) return event.target.blur();
      if (!$("keys").hidden) return ($("keys").hidden = true);
      if (state.review) return setReview(false);
      if (app.dataset.stage === "grade") return setStage("library");
      if (state.view === "single") return setView("grid");
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
      i: toggleDetails,
      p: () => setFlag("pick"),
      x: () => setFlag("reject"),
      u: () => setFlag(null),
    };
    const action = actions[key.length === 1 ? key.toLowerCase() : key];
    if (action) { event.preventDefault(); action(); } else if (/^[0-5]$/.test(key)) setStars(Number(key));
  });

  // ---------- mock-up controls ----------

  function setVariant(v) {
    app.dataset.variant = v;
    remember("variant", v);
    document.querySelectorAll("[data-variant]").forEach((b) => b.tagName === "BUTTON" && b.classList.toggle("on", b.dataset.variant === v));
    renderFilters();
  }
  function setFit(fit) {
    app.dataset.fit = fit;
    remember("fit", fit);
    document.querySelectorAll("button[data-fit]").forEach((b) => b.classList.toggle("on", b.dataset.fit === fit));
  }
  $("mock-strip").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.variant) setVariant(b.dataset.variant);
    if (b.dataset.fit) setFit(b.dataset.fit);
    if (b.id === "keys-button") $("keys").hidden = !$("keys").hidden;
    b.blur();
  });
  $("opt-names").addEventListener("change", () => { app.dataset.names = $("opt-names").checked ? "on" : "off"; });
  document.querySelectorAll(".mock-check input").forEach((box) => box.addEventListener("change", () => box.blur()));

  // ---------- start ----------

  // The address can ask for a starting state, for example
  // index.html?layout=b&place=trip&view=single&details=on&filter=on
  const ask = new URLSearchParams(location.search);
  setVariant(ask.get("layout") || recall("variant", "a"));
  setFit(ask.get("fit") || recall("fit", "contain"));
  if (placeOf(ask.get("place"))) state.place = ask.get("place");
  if (ask.get("details") === "on") app.dataset.details = "on";
  if (ask.get("filter") === "on") $("filterbar").hidden = false;
  if (ask.get("names") === "on") { $("opt-names").checked = true; app.dataset.names = "on"; }
  if (ask.has("view")) $("opt-slow").checked = false;
  computeShown();
  renderNav();
  renderGrid(true);
  refresh();
  if (ask.has("select")) ask.get("select").split(",").forEach((n, i) => select(state.shown[Number(n)].id, i ? "toggle" : "single"));
  if (ask.get("view") === "single") setView("single");
  if (ask.get("view") === "grade") openInGrade();
  if (ask.get("view") === "review") { state.review = true; $("review").hidden = false; refresh(); }
})();
