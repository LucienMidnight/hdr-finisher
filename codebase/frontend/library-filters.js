/* The Library bar produces ordinary rules: any tick within a field, all fields together. */
(() => {
  "use strict";
  const { make, showMenu } = HDRLibraryDialogs, query = HDRLibraryQuery;
  const fixed = new Set(["search", "rating", "pick", "label"]);
  const groups = { File: ["type", "state", "copy", "tag"], "Shot with": ["camera", "lens", "iso", "focal_length", "aperture", "shutter"], When: ["date"] };
  function create(options) {
    const panel = make("div", "library-filter-panel"); panel.id = "library-filter-panel"; panel.hidden = true; panel.setAttribute("role", "dialog"); document.body.append(panel);
    const rules = () => (options.filters().rules ||= []), find = id => rules().find(rule => rule.field === id);
    let origin = options.addButton;
    const close = (focus = false) => { panel.hidden = true; panel.replaceChildren(); if (focus) origin?.focus(); };
    function changed() { render(); options.changed(); }
    function set(id, rule) { const list = rules(), at = list.findIndex(item => item.field === id); if (at >= 0) list.splice(at, 1); if (rule) list.push(rule); options.filters().any = false; changed(); }
    const button = (text, label, run) => { const b = make("button", "tool-button", text); b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.addEventListener("click", run); return b; };
    const search = document.getElementById("filter-search"), comparison = document.getElementById("filter-rating-op");
    search.addEventListener("input", () => set("search", search.value.trim() ? {field:"search",op:"contains",value:search.value.trim()} : null));
    comparison.addEventListener("change", () => { const rule = find("rating"); if (rule) set("rating", {...rule,op:comparison.value}); });
    for (let value = 0; value <= 5; value++) {
      const b = button(value ? "★" : "0", value ? `${value} stars` : "Unrated", () => { const active = find("rating"); set("rating", active && Number(active.value) === value ? null : {field:"rating",op:value ? comparison.value : "is",value}); }); b.dataset.rating = value; document.getElementById("filter-rating").append(b);
    }
    for (const [id, choices] of [["pick", [["pick","Picked","⚑"],["unmarked","Unmarked","⚐"],["reject","Rejected","×"]]], ["label", [["red","Red"],["orange","Orange"],["green","Green"],["blue","Blue"],["","No label","∅"]]]]) {
      for (const [value, label, text] of choices) {
        const b = button(text || "", label, () => { const selected = new Set(find(id)?.values || []); selected.has(value) ? selected.delete(value) : selected.add(value); set(id, selected.size ? {field:id,op:"in",values:[...selected],labels:[...selected].map(value => choices.find(([v]) => v === value)[1])} : null); });
        b.dataset.value = value;
        if (id === "label" && value) { const dot = make("span", "library-label-dot"); dot.style.background = `var(--label-${value})`; b.append(dot); }
        document.getElementById(`filter-${id}`).append(b);
      }
    }
    function render() {
      search.value = find("search")?.value || "";
      const rating = find("rating"); comparison.value = rating?.op || "at-least"; comparison.disabled = !!rating && Number(rating.value) === 0;
      for (const b of document.querySelectorAll("#filter-rating button")) { const on = !!rating && Number(rating.value) === Number(b.dataset.rating); b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", !!rating && Number(b.dataset.rating) > 0 && Number(b.dataset.rating) <= Number(rating.value)); }
      for (const id of ["pick", "label"]) for (const b of document.querySelectorAll(`#filter-${id} button`)) b.setAttribute("aria-pressed", String(!!find(id)?.values?.includes(b.dataset.value)));
      options.bar.replaceChildren(...rules().filter(rule => !fixed.has(rule.field)).map(rule => {
        const wrap = make("span", "library-rule-chip");
        const edit = button(query.describe(rule), `Edit ${query.FIELDS[rule.field]?.label || "filter"}`, () => open(rule.field, edit)); edit.title = query.describe(rule);
        const remove = button("×", `Remove ${query.FIELDS[rule.field]?.label || "filter"} filter`, () => { set(rule.field, null); options.addButton.focus(); }); wrap.append(edit, remove); return wrap;
      }));
    }
    function open(id, anchor = options.addButton) {
      origin = anchor; const field = query.FIELDS[id], current = find(id);
      panel.replaceChildren(make("div", "library-filter-head", field.label)); panel.setAttribute("aria-label", `Filter by ${field.label}`);
      const form = make("form", "library-filter-range"), go = make("button", "button-primary", "Apply"); go.type = "submit";
      if (id === "state" || id === "copy") {
        const yes = id === "state" ? "edited" : "virtual copy", no = id === "state" ? "not edited" : "original";
        const input = make("select"); input.setAttribute("aria-label", field.label); input.append(new Option("Yes", yes), new Option("No", no)); input.value = current?.value || yes; form.append(input);
        form.addEventListener("submit", event => { event.preventDefault(); const value = input.value; close(); set(id, {field:id,op:"is",value,label:value === yes ? "Yes" : "No"}); options.addButton.focus(); });
      } else if (field.kind === "choice") {
        const found = query.values(options.photos(), id), selected = new Set(current?.values || (current ? [current.value] : []));
        for (const [index, value] of (current?.values || []).entries()) if (!found.some(item => item.value === value)) found.push({value,label:current.labels?.[index] || value,count:0});
        const list = make("div", "library-filter-values"), boxes = [];
        for (const item of found) {
          const row = make("label", "library-filter-value"), box = make("input"); row.dataset.value = item.value; box.type = "checkbox"; box.value = item.value; box.checked = selected.has(item.value); box.setAttribute("aria-label", item.label); boxes.push(box);
          row.append(box, make("span", "", item.label), make("span", "library-count", item.count.toLocaleString())); list.append(row);
        }
        if (id === "type") { const raw = button("RAW", "Select all RAW file types", () => { for (const box of boxes) box.checked = query.rawTypes.has(box.value.toUpperCase()); }); raw.disabled = !found.some(item => query.rawTypes.has(item.value.toUpperCase())); form.append(raw); }
        form.append(list);
        if (!found.length) form.append(make("p", "library-filter-note", "No values here."));
        form.addEventListener("submit", event => { event.preventDefault(); const chosen = found.filter((_, i) => boxes[i].checked); close(); set(id, chosen.length ? {field:id,op:"in",values:chosen.map(item => item.value),labels:chosen.map(item => item.label)} : null); origin.isConnected ? origin.focus() : options.addButton.focus(); });
      } else {
        const date = field.kind === "date", ends = {};
        const found = date ? [] : query.values(options.photos(), id).filter(item => item.raw != null);
        for (const key of ["from", "to"]) {
          const input = make(date ? "input" : "select"); if (date) input.type = "date";
          else input.append(new Option("No limit", ""), ...found.map(item => new Option(item.label, item.raw)));
          if (!date && current?.[key] != null && current[key] !== "" && !found.some(item => String(item.raw) === String(current[key]))) input.append(new Option(query.format[id]?.(Number(current[key])) || String(current[key]), current[key]));
          input.value = current?.[key] ?? ""; input.setAttribute("aria-label", `${key === "from" ? "From" : "To"} ${field.label}`); const label = make("label"); label.append(make("span", "", key === "from" ? "From" : "To"), input); form.append(label); ends[key] = input;
        }
        if (date) {
          const local = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          for (const text of ["Today", "Last 7 days", "This month", "This year"]) form.append(button(text, text, () => { const now = new Date(), start = new Date(now); if (text === "Last 7 days") start.setDate(start.getDate()-6); if (text === "This month") start.setDate(1); if (text === "This year") start.setMonth(0,1); ends.from.value = local(start); ends.to.value = local(now); }));
        }
        form.addEventListener("submit", event => { event.preventDefault(); let from = ends.from.value, to = ends.to.value; if (from && to && (date ? from > to : Number(from) > Number(to))) [from,to] = [to,from]; close(); set(id, from || to ? {field:id,op:"range",from,to} : null); origin.isConnected ? origin.focus() : options.addButton.focus(); });
      }
      form.append(go); panel.append(form); panel.hidden = false;
      const bounds = anchor.getBoundingClientRect(); panel.style.left = `${Math.max(0, Math.min(bounds.left, innerWidth-panel.offsetWidth))}px`; panel.style.top = `${Math.max(0, Math.min(bounds.bottom, innerHeight-panel.offsetHeight))}px`; panel.querySelector("input,select,button")?.focus();
    }
    let closeOnClick = false;
    options.addButton.addEventListener("pointerdown", () => { closeOnClick = !panel.hidden || HDRLibraryDialogs.menuOpen() && document.getElementById("library-folder-menu").getAttribute("aria-label") === "Filter by"; }, true);
    options.addButton.addEventListener("click", event => { close(); if (closeOnClick) { closeOnClick = false; HDRLibraryDialogs.closeMenu(); return; } showMenu(event, Object.entries(groups).flatMap(([header, ids]) => [{header}, ...ids.map(id => ({label:query.FIELDS[id].label,run:()=>open(id)}))]), {label:"Filter by",anchor:options.addButton}); });
    document.addEventListener("pointerdown", event => { if (!panel.hidden && !panel.contains(event.target) && !origin?.contains(event.target) && !HDRLibraryDialogs.menuOpen()) close(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); close(true); } });
    window.addEventListener("resize", () => close()); render();
    return Object.freeze({render,close});
  }
  window.HDRLibraryFilters = Object.freeze({create});
})();
