/* Activity reads the backend's library-wide health; file writing has no Cancel. */
(() => {
  "use strict";
  const count = value => Number(value || 0).toLocaleString();
  function writerText(writer) {
    if (!writer.waiting) return "Settings files up to date";
    if (writer.paused) return `Writing settings paused · ${count(writer.waiting)} waiting`;
    if (writer.busy) return `Writing settings waits while Grade is busy · ${count(writer.waiting)} waiting`;
    return `Writing settings: ${count(writer.done)} of ${count(writer.total)}`;
  }
  function indexText(index) {
    if (index.state === "failed") return "Indexing stopped · Re-scan to try again";
    if (index.state === "retrying") return "Indexing is waiting to try again";
    if (index.state === "off") return "Background indexing is off";
    if (index.paused) return "Indexing paused";
    if (index.state !== "indexing") return "Library index up to date";
    if (index.waiting) return "Indexing waits while Grade is busy";
    return index.total ? `Indexing ${index.folder} · ${count(index.done)} of ${count(index.total)}` : `Indexing ${index.folder} · reading folders`;
  }
  function summary(health) {
    const writer = health.writer, index = health.index, jobs = [];
    if (writer.waiting) jobs.push(writerText(writer));
    if (index.state === "indexing" || index.state === "retrying" || index.paused) jobs.push(indexText(index));
    const problems = writer.attention.reduce((sum, group) => sum + group.count, 0) + (health.conflicts || []).length;
    const extra = problems ? ` · Needs attention: ${count(problems)}` : index.state === "failed" || index.state === "retrying" || health.helper.failure || health.helper.recovering ? " · Needs attention" : "";
    return (jobs[0] || "Activity") + (jobs.length > 1 ? ` +${jobs.length - 1}` : "") + extra;
  }
  function create({ button, panel, api, status, onHealth }) {
    let health = null;
    const pending = new Set();
    const node = (tag, text, className) => { const item = document.createElement(tag); item.textContent = text; if (className) item.className = className; return item; };
    async function refresh() { update(await api("/api/library/health")); }
    function action(label, key, route, body) {
      const item = node("button", label, "text-button"); item.type = "button"; item.dataset.action = key;
      item.setAttribute("aria-disabled", String(pending.has(key)));
      item.addEventListener("click", async () => {
        if (pending.has(key)) return;
        pending.add(key); item.setAttribute("aria-disabled", "true"); item.setAttribute("aria-busy", "true");
        try { await api(route, body); await refresh(); }
        catch (error) { status(error.message); }
        finally { pending.delete(key); render(); }
      });
      return item;
    }
    function render() {
      if (!health || panel.hidden) return;
      const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.action : null;
      const writer = health.writer, index = health.index;
      panel.replaceChildren(node("h2", "Activity", "panel-title"));
      const writing = node("section", "", "library-activity-job");
      writing.append(node("p", writerText(writer)));
      if (writer.waiting) writing.append(action(writer.paused ? "Resume writing" : "Pause writing", "writer-pause", "/api/library/writer", { action: writer.paused ? "resume" : "pause" }));
      panel.append(writing);
      const indexing = node("section", "", "library-activity-job"); indexing.append(node("p", indexText(index)));
      if (index.state === "indexing" || index.state === "retrying" || index.paused) indexing.append(action(index.paused ? "Resume indexing" : "Pause indexing", "index-pause", "/api/library/index", { action: index.paused ? "resume" : "pause" }));
      const rescan = action("Re-scan pinned folders now", "index-rescan", "/api/library/index", { action: "rescan" }); rescan.disabled = index.enabled === false;
      indexing.append(rescan, action(index.enabled === false ? "Turn background indexing on" : "Turn background indexing off", "index-enable", "/api/library/index", { action: index.enabled === false ? "enable" : "disable" }));
      panel.append(indexing, node("h3", "Needs attention", "panel-title"));
      if (!writer.attention.length && !(health.conflicts || []).length && !health.helper.failure && !health.helper.recovering && index.state !== "failed" && index.state !== "retrying") panel.append(node("p", "Nothing needs attention."));
      for (const group of writer.attention) {
        const item = node("section", "", "library-activity-job");
        item.append(node("p", group.folder, "library-activity-folder"), node("p", `${count(group.count)} photos: ${group.explanation}. Marks are safe in the library; writing will retry automatically.`));
        if (group.reason === "unreadable") item.append(node("p", group.photos.map(path => path.split(/[\\/]/).at(-1)).join(", ")));
        item.append(action("Try again", `retry:${group.folder}:${group.reason}`, "/api/library/writer", { action: "retry", folder: group.folder, reason: group.reason })); panel.append(item);
      }
      for (const conflict of health.conflicts || []) {
        const item = node("section", "", "library-activity-job");
        item.append(node("p", conflict.folder, "library-activity-folder"), node("p", conflict.message));
        for (const file of conflict.files) item.append(node("p", file.split(/[\\/]/).at(-1)));
        panel.append(item);
      }
      if (health.helper.recovering) panel.append(node("p", "The Library helper is restarting. Saved marks are safe; browsing will resume automatically."));
      if (health.helper.failure) panel.append(node("p", "The Library helper stopped after repeated problems. Saved marks are safe; restart the app to browse again."));
      if (index.state === "retrying") panel.append(node("p", "Indexing could not finish. Saved marks are safe; it will try again automatically, or choose Re-scan now."));
      if (index.state === "failed") panel.append(node("p", "Indexing stopped. Saved marks are safe; choose Re-scan to try again."));
      if (focused) ([...panel.querySelectorAll("button")].find(item => item.dataset.action === focused) || button).focus();
    }
    function update(next) { health = next; button.hidden = false; button.textContent = summary(next); onHealth?.(next); render(); }
    function close() { panel.hidden = true; button.setAttribute("aria-expanded", "false"); }
    button.addEventListener("click", () => { panel.hidden = !panel.hidden; button.setAttribute("aria-expanded", String(!panel.hidden)); render(); if (!panel.hidden) panel.querySelector("button")?.focus(); });
    document.addEventListener("pointerdown", event => { if (!panel.contains(event.target) && !button.contains(event.target)) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden) { event.preventDefault(); event.stopPropagation(); close(); button.focus(); } });
    return Object.freeze({ refresh, update });
  }
  const exported = Object.freeze({ create, summary, writerText, indexText });
  if (typeof module !== "undefined") module.exports = exported;
  else window.HDRLibraryActivity = exported;
})();
