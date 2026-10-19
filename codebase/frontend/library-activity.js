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
  function checkText(index) {
    const checks = index.checks, running = checks?.running;
    if (!running?.requested && !running?.changed && !checks?.requested?.length) return "";
    if (index.waiting || index.checkWaiting) return "Checking folders waits while Grade is busy";
    return `Checking for new photos${running ? " · " + running.path.split(/[\\/]/).at(-1) : ""}`;
  }
  function summary(health) {
    const writer = health.writer, index = health.index, jobs = [];
    if (writer.waiting) jobs.push(writerText(writer));
    if (checkText(index)) jobs.push(checkText(index));
    if (index.state === "indexing" || index.state === "retrying" || index.paused) jobs.push(indexText(index));
    if (health.file_commands?.jobs?.length) jobs.unshift(`File commands: ${health.file_commands.jobs[0].done} of ${health.file_commands.jobs[0].total}`);
    const problems = (health.file_commands?.attention?.length || 0) + writer.attention.reduce((sum, group) => sum + group.count, 0) + (health.conflicts || []).length + (index.checks?.folders || []).filter(folder => folder.failure || folder.warnings?.length).length;
    const extra = problems ? ` · Needs attention: ${count(problems)}` : index.state === "failed" || index.state === "retrying" || health.helper.failure || health.helper.recovering ? " · Needs attention" : "";
    return (jobs[0] || "Activity") + (jobs.length > 1 ? ` +${jobs.length - 1}` : "") + extra;
  }
  function create({ button, panel, api, status, onHealth }) {
    let health = null, exports = null;
    const pending = new Set();
    const node = (tag, text, className) => { const item = document.createElement(tag); item.textContent = text; if (className) item.className = className; return item; };
    async function refresh() {
      const values = await Promise.allSettled([api("/api/library/health"), api("/api/batch-export")]);
      if (values[1].status === "fulfilled") exports = values[1].value;
      if (values[0].status === "fulfilled") update(values[0].value);
    }
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
      if (health.helper.pending || health.helper.manual_paused) {
        const section = node("section", "", "library-activity-job");
        section.append(node("p", `Reading Library scenes${health.helper.paused ? " · Paused" : ""}`));
        section.append(action(health.helper.manual_paused ? "Resume reading" : "Pause reading", "scenes-pause", "/api/library/scene-work", {action:health.helper.manual_paused ? "resume" : "pause"}));
        panel.append(section);
      }
      for (const job of exports?.jobs || (exports?.id ? [exports] : [])) {
        const section = node("section", "", "library-activity-job");
        const time = job.estimated_seconds ? ` · about ${Math.ceil(job.estimated_seconds / 60)} min left` : "";
        section.append(node("p", `Export: ${count(job.completed)} of ${count(job.total)} · ${job.state}${time}`));
        if (["running", "queued", "paused"].includes(job.state)) section.append(
          action(job.state === "paused" ? "Resume export" : "Pause export", `export-pause:${job.id}`, `/api/batch-export/${job.id}`, {action:job.state === "paused" ? "resume" : "pause"}),
          action("Cancel export", `export-cancel:${job.id}`, `/api/batch-export/${job.id}`, {action:"cancel"}));
        for (const result of job.results || []) section.append(node("p", `${result.output_path || result.path || result.file || result.photo || result.item_key || "Photo"}${result.version ? " "+result.version : ""}: ${result.outcome || result.status}${result.reason ? " · " + result.reason : ""}`));
        if (job.directory) { const reveal = node("button", "Show in Explorer", "text-button"); reveal.addEventListener("click", () => {
          const host = parent !== window ? parent : window;
          if (host.batchExport?.reveal) host.batchExport.reveal(job.directory);
          else host.hdrFinisherDesktop?.revealPath?.(job.directory);
        }); section.append(reveal); }
        panel.append(section);
      }
      const writing = node("section", "", "library-activity-job");
      writing.append(node("p", writerText(writer)));
      if (writer.waiting) writing.append(action(writer.paused ? "Resume writing" : "Pause writing", "writer-pause", "/api/library/writer", { action: writer.paused ? "resume" : "pause" }));
      panel.append(writing);
      if (checkText(index)) panel.append(node("p", checkText(index)));
      const indexing = node("section", "", "library-activity-job"); indexing.append(node("p", indexText(index)));
      if (index.state === "indexing" || index.state === "retrying" || index.paused) indexing.append(action(index.paused ? "Resume indexing" : "Pause indexing", "index-pause", "/api/library/index", { action: index.paused ? "resume" : "pause" }));
      const rescan = action("Re-scan pinned folders now", "index-rescan", "/api/library/index", { action: "rescan" }); rescan.disabled = index.enabled === false;
      indexing.append(rescan, action(index.enabled === false ? "Turn background indexing on" : "Turn background indexing off", "index-enable", "/api/library/index", { action: index.enabled === false ? "enable" : "disable" }));
      for(const job of health.file_commands?.jobs || []) {
        const section=node("section","","library-activity-job");section.append(node("p",`${job.action}: ${job.done} of ${job.total}`),action(job.paused?"Resume command":"Pause command",`file-pause:${job.id}`,"/api/library/file-jobs",{id:job.id,action:job.paused?"resume":"pause"}),action("Cancel remaining",`file-cancel:${job.id}`,"/api/library/file-jobs",{id:job.id,action:"cancel"}));panel.append(section);
      }
      panel.append(indexing, node("h3", "Needs attention", "panel-title"));
      for(const item of health.file_commands?.attention || []) {const section=node("section","","library-activity-job");section.append(node("p",item.message),node("p",`Recorded photo and settings locations: ${(item.locations || [item.old,item.new]).join(" · ")}`),action("Try again",`file-retry:${item.id}`,"/api/library/file-jobs",{id:item.id,action:"resume"}));panel.append(section);}
      if (!(health.file_commands?.attention?.length) && !writer.attention.length && !(health.conflicts || []).length && !health.helper.failure && !health.helper.recovering && index.state !== "failed" && index.state !== "retrying" && !(index.checks?.folders || []).some(folder => folder.failure || folder.warnings?.length)) panel.append(node("p", "Nothing needs attention."));
      for (const group of writer.attention) {
        const item = node("section", "", "library-activity-job");
        if (group.reason === "grade_conflict") {
          item.append(node("p", group.folder, "library-activity-folder"),
            node("p", `${group.photos.map(path => path.split(/[\\/]/).at(-1)).join(", ")}: grade changed elsewhere. Saving is paused. Both grades are kept safely; resolve the choice in Grade.`));
          panel.append(item); continue;
        }
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
      for (const folder of index.checks?.folders || []) {
        for (const warning of folder.warnings || []) panel.append(node("p", warning));
        if (folder.failure) panel.append(node("p", `${folder.path}: ${folder.offline ? "Folder is not connected; photos and marks are kept" : "Folder check could not finish; it will try again"}`));
      }
      if (health.helper.recovering) panel.append(node("p", "The Library helper is restarting. Saved marks are safe; browsing will resume automatically."));
      if (health.helper.failure) panel.append(node("p", "The Library helper stopped after repeated problems. Saved marks are safe; restart the app to browse again."));
      if (index.state === "retrying") panel.append(node("p", "Indexing could not finish. Saved marks are safe; it will try again automatically, or choose Re-scan now."));
      if (index.state === "failed") panel.append(node("p", "Indexing stopped. Saved marks are safe; choose Re-scan to try again."));
      if (focused) ([...panel.querySelectorAll("button")].find(item => item.dataset.action === focused) || button).focus();
    }
    function update(next) { health = next; button.hidden = false; button.textContent = (exports?.jobs?.some(job => ["running", "paused", "queued"].includes(job.state)) ? "Export · " : "") + summary(next); onHealth?.(next); render(); }
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
