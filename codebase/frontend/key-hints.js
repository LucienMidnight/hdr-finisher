/* Status bar key hints. Over the control panel the bar lists the slider keys;
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

  function render() {
    frame = 0;
    const node = legend();
    if (!node) return;
    const tool = toolItems();
    const items = (tool || sliderItems).slice(0, 4);
    document.body.classList.toggle("tool-key-hints", Boolean(tool));
    const signature = JSON.stringify(items) + node.parentElement?.clientWidth;
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

  return { register, refresh };
})();
