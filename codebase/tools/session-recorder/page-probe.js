// Injected into every app window by record.js. It only watches: long main-thread
// tasks, slow input responses, dropped frames, memory and the F9 marker key.
// Events wait in window.__hdrRecorder until record.js collects them.
(() => {
  if (window.__hdrRecorder) return;
  const queue = [];
  const push = (event) => { queue.push({ t: performance.timeOrigin + performance.now(), ...event }); if (queue.length > 5000) queue.shift(); };
  const describe = (node) => {
    if (!node || !node.tagName) return null;
    const label = node.getAttribute?.("aria-label") || node.getAttribute?.("title") || node.textContent?.trim().slice(0, 40) || "";
    return `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}${label ? " \"" + label + "\"" : ""}`;
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) push({ kind: "long-task", ms: Math.round(entry.duration) });
    }).observe({ type: "longtask", buffered: false });
  } catch {}
  try {
    // Input that took over 100 ms from the key or click to the next paint.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        push({ kind: "slow-input", ms: Math.round(entry.duration), input: entry.name,
          waitMs: Math.round(entry.processingStart - entry.startTime),
          target: describe(entry.target) });
      }
    }).observe({ type: "event", durationThreshold: 104, buffered: false });
  } catch {}
  // Frame gaps while the window is visible: a gap over 100 ms is a visible hitch.
  let last = performance.now();
  const frame = (now) => {
    if (document.visibilityState === "visible" && now - last > 100) push({ kind: "frame-gap", ms: Math.round(now - last) });
    last = now; requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => { last = performance.now(); });
  setInterval(() => {
    const memory = performance.memory;
    if (memory) push({ kind: "memory", usedMB: Math.round(memory.usedJSHeapSize / 1048576) });
  }, 5000);
  // F9 marks "that felt slow" (the app does not use F9).
  window.addEventListener("keydown", (event) => {
    if (event.key !== "F9" || event.repeat) return;
    push({ kind: "marker" });
    const note = document.createElement("div");
    note.textContent = "Marked";
    note.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:6px 12px;border-radius:6px;background:#e0a100;color:#000;font:600 13px system-ui;pointer-events:none";
    document.body.appendChild(note); setTimeout(() => note.remove(), 900);
  }, true);
  window.__hdrRecorder = { drain: () => queue.splice(0, queue.length) };
})();
