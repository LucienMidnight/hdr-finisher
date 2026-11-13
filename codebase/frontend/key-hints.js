/* Status bar key hints. Library, Export and Proof show page keys. On Grade,
 * over the control panel the bar lists the slider keys;
 * over the photo it lists the keys of the tool in use. A tool registers a
 * function that returns [key, action] pairs for its current step, or null
 * when it is not in use. The most important pair comes first; pairs drop off
 * the end when the bar is too narrow. */
const keyHints = (() => {
  const sliderItems = [["Ctrl", "fine"], ["Shift", "snap"], ["Double-click", "reset"], ["Click value", "to type"]];
  const providers = [];
  let zone = "panel";
  let shown = "";
  let frame = 0;

  function legend() { return document.querySelector(".slider-key-legend"); }

  function toolItems() {
    if (zone !== "viewer") return null;
    for (const provider of providers) {
      let items = null;
      try { items = provider(); } catch { items = null; }
      if (items?.length) return items;
    }
    return null;
  }

  // The parent owns page hints, including Library's iframe workspace.
  function pageItems() {
    switch (document.body.dataset.workflow) {
      case "import": return [["Arrows", "browse"], ["Space", "grid/single"], ["Enter", "Grade"], ["Ctrl+Shift+E", "quick export"]];
      case "export": return [["Ctrl+A", "select all"], ["Space/Enter", "select photo"]];
      case "proof": return [["file.exportStandard", "export"], ["app.help", "help"]].map(([id, action]) => [window.HDRApplicationShell?.shortcutLabel(id), action]).filter(([key]) => key);
      default: return null;
    }
  }

  function render() {
    frame = 0;
    const node = legend();
    if (!node) return;
    const page = pageItems();
    const tool = page ? null : toolItems();
    const items = (page || tool || sliderItems).slice(0, 4);
    document.body.classList.toggle("tool-key-hints", Boolean(tool));
    const signature = JSON.stringify(items) + node.clientWidth + ":" + node.parentElement?.clientWidth;
    if (signature === shown) return;
    shown = signature;
    const fill = count => {
      node.replaceChildren();
      items.slice(0, count).forEach(([key, action], index) => {
        if (index) node.append(" · ");
        const bold = document.createElement("b");
        bold.textContent = key;
        node.append(bold, ` ${action}`);
      });
    };
    let count = items.length;
    fill(count);
    while (count > 1 && node.scrollWidth > node.clientWidth + 1) fill(--count);
  }

  function refresh() { if (!frame) frame = requestAnimationFrame(render); }

  function register(provider) { providers.push(provider); refresh(); }

  // The pointer's position picks the list. Gaps between areas keep the last one.
  document.addEventListener("pointermove", event => {
    const target = event.target instanceof Element ? event.target : null;
    const next = target?.closest(".viewport-frame") ? "viewer" : target?.closest(".panel") ? "panel" : zone;
    if (next !== zone) zone = next;
    refresh();
  }, { capture: true, passive: true });
  for (const type of ["keydown", "keyup", "pointerup"]) document.addEventListener(type, refresh, { capture: true, passive: true });
  window.addEventListener("resize", refresh);
  window.addEventListener("hdrfinisher:workflowchange", refresh);
  window.addEventListener("hdrfinisher:shortcutchange", refresh);
  if (typeof ResizeObserver === "function" && legend()) new ResizeObserver(refresh).observe(legend());

  return { register, refresh };
})();
