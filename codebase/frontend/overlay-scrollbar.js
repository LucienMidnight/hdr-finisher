/* A pointer-only thumb. The original scroller owns focus, wheel and keyboard input. */
(() => {
  const mounted = new WeakSet();

  function attach(scroller) {
    if (mounted.has(scroller)) return;
    mounted.add(scroller);
    const thumb = document.createElement("span");
    thumb.className = "overlay-scrollbar-thumb";
    thumb.setAttribute("aria-hidden", "true");
    scroller.append(thumb);

    let maxScroll = 0, travel = 0, inset = 0;
    let hover = false, drag = null, idle = 0, frame = 0;
    const active = (value) => thumb.toggleAttribute("data-active", Boolean(maxScroll && value));
    const position = () => {
      const top = scroller.scrollTop;
      thumb.style.insetBlockStart = `${top + inset + travel * Math.min(1, Math.max(0, top / maxScroll))}px`;
    };
    const keepVisible = () => {
      if (!maxScroll) return;
      clearTimeout(idle);
      active(true);
      if (!hover && !drag) {
        const delay = getComputedStyle(thumb).getPropertyValue("--overlay-scrollbar-idle-delay");
        idle = setTimeout(() => active(hover || drag), parseFloat(delay));
      }
    };
    function refresh() {
      frame = 0;
      // No stale thumb geometry may contribute to scrollHeight when content shrinks.
      thumb.hidden = true;
      const viewport = scroller.clientHeight;
      const content = scroller.scrollHeight;
      const style = getComputedStyle(scroller);
      maxScroll = style.overflowY === "auto" || style.overflowY === "scroll" ? content - viewport : 0;
      thumb.toggleAttribute("data-scrollable", maxScroll > 0);
      if (!maxScroll || !viewport) {
        maxScroll = 0;
        clearTimeout(idle);
        active(false);
        return;
      }
      inset = parseFloat(style.getPropertyValue("--space-3"));
      const track = Math.max(0, viewport - 2 * inset);
      const minimum = parseFloat(style.getPropertyValue("--panel-control-h"));
      const height = Math.min(track, Math.max(minimum, track * viewport / content));
      travel = track - height;
      thumb.style.blockSize = `${height}px`;
      position();
      thumb.hidden = false;
      hover = scroller.matches(":hover");
      if (hover || drag) keepVisible();
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
    const sized = new ResizeObserver(schedule);
    const children = new Set();
    const syncChildren = () => {
      for (const child of children) {
        if (child.parentElement === scroller) continue;
        sized.unobserve(child);
        children.delete(child);
      }
      for (const child of scroller.children) {
        if (child === thumb || children.has(child)) continue;
        sized.observe(child);
        children.add(child);
      }
      schedule();
    };
    sized.observe(scroller);
    new MutationObserver(syncChildren).observe(scroller, { childList: true });
    syncChildren();

    scroller.addEventListener("pointerenter", (event) => {
      hover = event.pointerType !== "touch";
      if (hover) keepVisible();
    });
    scroller.addEventListener("pointerleave", () => {
      if (!hover) return;
      hover = false;
      keepVisible();
    });
    scroller.addEventListener("scroll", () => {
      if (!maxScroll) { schedule(); return; }
      position();
      keepVisible();
    }, { passive: true });
    thumb.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !travel || drag) return;
      drag = { id: event.pointerId, y: event.clientY, top: scroller.scrollTop };
      thumb.setPointerCapture(event.pointerId);
      thumb.setAttribute("data-dragging", "");
      keepVisible();
      event.preventDefault();
    });
    thumb.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId || !travel) return;
      scroller.scrollTop = drag.top + (event.clientY - drag.y) * maxScroll / travel;
    });
    thumb.addEventListener("lostpointercapture", () => {
      drag = null;
      thumb.removeAttribute("data-dragging");
      hover = scroller.matches(":hover");
      keepVisible();
    });
  }

  globalThis.HDROverlayScrollbar = { attach };
  document.querySelectorAll("[data-overlay-scroll]").forEach(attach);
})();
