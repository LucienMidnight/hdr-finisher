/* "+ Filter" on the filter bar: rule chips built from the photos being looked at. */
(() => {
  "use strict";
  const { make, showMenu } = HDRLibraryDialogs, query = HDRLibraryQuery;
  function create(options) {
    const panel = make("div", "library-filter-panel"); panel.id = "library-filter-panel"; panel.hidden = true; panel.setAttribute("role", "dialog");
    document.body.append(panel);
    const rules = () => (options.filters().rules ||= []);
    const close = () => { panel.hidden = true; panel.replaceChildren(); };
    function changed() { render(); options.changed(); }
    function add(rule) { rules().push(rule); close(); changed(); options.addButton.focus(); }
    function render() {
      const list = options.filters().rules || [];
      options.bar.replaceChildren(...list.map((rule, index) => {
        const chip = make("button", "tool-button library-rule-chip", `${query.describe(rule)} ×`); chip.type = "button"; chip.title = "Click to remove this filter";
        chip.addEventListener("click", () => { rules().splice(index, 1); changed(); }); return chip;
      }));
      options.match.hidden = list.length < 2; options.match.value = options.filters().any ? "any" : "all";
    }
    function place() {
      const bounds = options.addButton.getBoundingClientRect();
      panel.style.left = `${Math.max(0, Math.min(bounds.left, innerWidth - panel.offsetWidth))}px`;
      panel.style.top = `${Math.max(0, Math.min(bounds.bottom, innerHeight - panel.offsetHeight))}px`;
    }
    function open(id) {
      const field = query.FIELDS[id];
      panel.replaceChildren(); panel.setAttribute("aria-label", `Filter by ${field.label}`);
      const head = make("div", "library-filter-head"); head.append(make("strong", "", field.label));
      const not = make("label", "library-filter-not"), box = make("input"); box.type = "checkbox"; box.id = "filter-rule-not";
      not.append(box, make("span", "", "is not")); head.append(not); panel.append(head);
      if (field.kind === "text") {
        const form = make("form", "library-filter-range"), input = make("input"), comparison = make("select"), go = make("button", "button-primary", "Add");
        input.setAttribute("aria-label", field.label); input.type = "text";
        comparison.setAttribute("aria-label", "Comparison"); comparison.append(...["contains", "is", "starts", "ends"].map(value => new Option(value, value)));
        go.type = "submit"; form.append(comparison, input, go); panel.append(form);
        form.addEventListener("submit", event => { event.preventDefault(); if (input.value.trim()) add({ field: id, op: comparison.value, value: input.value.trim(), not: box.checked }); });
      } else if (field.kind === "choice") {
        const found = query.values(options.photos(), id), list = make("div", "library-filter-values");
        for (const item of found) {
          const row = make("button", "library-filter-value"); row.type = "button"; row.dataset.value = item.value;
          row.append(make("span", "", item.label), make("span", "library-count", item.count.toLocaleString()));
          row.addEventListener("click", () => add({ field: id, value: item.value, label: item.label, not: box.checked })); list.append(row);
        }
        if (!found.length) list.append(make("p", "", "No photos here."));
        panel.append(list);
        if (options.reading()) panel.append(make("p", "library-filter-note", "Camera details are still being read, so more may turn up."));
      } else {
        const form = make("form", "library-filter-range"), from = make("input"), to = make("input"), go = make("button", "button-primary", "Add");
        const date = field.kind === "date";
        for (const [input, text] of [[from, "From"], [to, "To"]]) {
          input.type = date ? "date" : "number"; if (!date) { input.min = id === "rating" ? "0" : "1"; input.step = "1"; }
          input.setAttribute("aria-label", `${text} ${field.label}`); const label = make("label"); label.append(make("span", "", text), input); form.append(label);
        }
        go.type = "submit"; form.append(go);
        form.append(make("p", "library-filter-note", date ? "Leave one side empty for everything before or after a day." : "Leave one side empty for no limit. The same number in both is that ISO only."));
        form.addEventListener("submit", event => {
          event.preventDefault();
          if (!from.value && !to.value) return;
          const low = from.value && to.value && (date ? from.value > to.value : Number(from.value) > Number(to.value));
          add({ field: id, from: low ? to.value : from.value, to: low ? from.value : to.value, not: box.checked });
        });
        panel.append(form);
      }
      panel.hidden = false; place();
      (panel.querySelector(".library-filter-value, .library-filter-range input") || box).focus();
    }
    let closeOnClick = false;
    options.addButton.addEventListener("pointerdown", () => { closeOnClick = !panel.hidden || (HDRLibraryDialogs.menuOpen() && document.getElementById("library-folder-menu").getAttribute("aria-label") === "Filter by"); }, true);
    options.addButton.addEventListener("click", event => {
      close();
      if (closeOnClick) { closeOnClick = false; HDRLibraryDialogs.closeMenu(); return; }
      showMenu(event, Object.entries(query.FIELDS).map(([id, field]) => ({ label: field.label, run: () => open(id) })), { label: "Filter by", anchor: options.addButton });
    });
    options.match.addEventListener("change", () => { options.filters().any = options.match.value === "any"; changed(); });
    document.addEventListener("pointerdown", event => { if (!panel.hidden && !panel.contains(event.target) && !HDRLibraryDialogs.menuOpen()) close(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); close(); options.addButton.focus(); } });
    window.addEventListener("resize", close);
    return Object.freeze({ render, close });
  }
  window.HDRLibraryFilters = Object.freeze({ create });
})();
