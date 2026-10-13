/* Saved layout belongs to the Library UI; dragging never moves files. */
(() => {
  "use strict";
  const KEY = "hdr-finisher:library-navigation";
  function create({ root, refresh }) {
    let saved = {}, dragging = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} };
    const sections = [...root.querySelectorAll(".library-nav-section")];
    for (const id of saved.sections || []) { const section = sections.find(item => item.dataset.section === id); if (section) root.append(section); }
    // Append newly added sections after the saved ones.
    for (const section of sections) if (!(saved.sections || []).includes(section.dataset.section)) root.append(section);
    function draggable(handle, target, kind, id, drop) {
      handle.addEventListener("dragstart", event => {
        event.stopPropagation(); dragging = { kind, id }; event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-hdr-library-navigation", kind);
      });
      handle.addEventListener("dragend", () => { dragging = null; root.querySelectorAll(".drag-target").forEach(item => item.classList.remove("drag-target")); });
      target.addEventListener("dragover", event => { if (dragging?.kind !== kind || dragging.id === id) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; target.classList.add("drag-target"); });
      target.addEventListener("dragleave", () => target.classList.remove("drag-target"));
      target.addEventListener("drop", event => {
        if (dragging?.kind !== kind || dragging.id === id) return;
        event.preventDefault(); event.stopPropagation(); target.classList.remove("drag-target");
        drop(dragging.id, event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2);
        dragging = null; persist();
      });
    }
    for (const section of sections) {
      const id = section.dataset.section, button = section.querySelector(".section-toggle"), body = document.getElementById(id);
      const toggle = () => { body.hidden = !!saved.closed?.[id]; button.setAttribute("aria-expanded", String(!body.hidden)); button.setAttribute("aria-label", `${body.hidden ? "Expand" : "Collapse"} ${section.querySelector(".panel-title").textContent}`); };
      toggle();
      button.addEventListener("click", () => { saved.closed ||= {}; saved.closed[id] = !body.hidden; toggle(); persist(); });
      draggable(section.querySelector(".section-handle"), section.querySelector(".library-heading"), "section", id, (source, after) => {
        const moved = sections.find(item => item.dataset.section === source);
        root.insertBefore(moved, after ? section.nextSibling : section);
        saved.sections = [...root.querySelectorAll(".library-nav-section")].map(item => item.dataset.section);
      });
    }
    function orderPins(pins) {
      const rank = new Map((saved.pins || []).map((path, index) => [path, index]));
      return [...pins].sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity));
    }
    function pinHandle(row, path) {
      const handle = document.createElement("button"); handle.className = "library-drag-handle"; handle.textContent = "⠿"; handle.draggable = true;
      handle.title = "Drag to reorder pinned folder"; handle.setAttribute("aria-label", `Reorder ${row.querySelector(".folder-name").textContent}`); row.append(handle);
      draggable(handle, row, "pin", path, (source, after) => {
        const order = [...document.getElementById("folders").children].map(item => item.querySelector(".library-folder-row").dataset.path).filter(item => item !== source);
        order.splice(order.indexOf(path) + Number(after), 0, source); saved.pins = order;
        void refresh();
      });
    }
    return Object.freeze({ orderPins, pinHandle });
  }
  window.HDRLibraryNavigation = Object.freeze({ create });
})();
