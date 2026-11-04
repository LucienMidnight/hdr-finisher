/* One remembered error and recovery dialog shared by tiles and Activity. */
window.HDRLibraryPictureErrors = Object.freeze({
  create({api, changed, status, selection = () => []}) {
    const records = new Map();
    let opened = false, latestHealth = 0;
    const make = (tag, text, className) => {
      const node = document.createElement(tag); node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const notify = () => window.dispatchEvent(new Event("library-picture-errors-changed"));
    function remember(record) { records.set(record.path, record); notify(); }
    function update(values, checkedAt = 0) {
      if (!checkedAt || checkedAt < latestHealth) return;
      latestHealth = checkedAt;
      const previous = new Set(records.keys());
      const newer = [...records.values()].filter(record => record.timeout || record.time > checkedAt);
      records.clear();
      for (const value of [...values, ...newer]) { records.set(value.path, value); previous.delete(value.path); }
      notify();
      if (previous.size) changed([...previous]);
    }
    async function show(record) {
      if (opened) return;
      record = records.get(record.path) || record;
      if (record.timeout) {
        records.delete(record.path); notify();
        await changed([record.path], {}, true);
        status("Photo queued for a new preview.");
        return;
      }
      opened = true;
      const origin = document.activeElement;
      const warning = !!record.grade_warning;
      const selected = selection();
      const targets = warning && selected.includes(record.path) ? selected.map(path => records.get(path)).filter(item => item?.grade_warning) : [record];
      const dialog = make("dialog", "", "application-dialog library-ask library-picture-error-dialog");
      dialog.setAttribute("aria-label", "Library preview error");
      const header = make("div", "", "application-dialog-header"), words = make("div", "");
      words.append(make("h2", record.path.split("|copy|",1)[0].split(/[\\/]/).at(-1)), make("p", record.reason)); header.append(words);
      const body = make("div", "", "library-ask-body");
      body.append(make("p", warning ? "Showing every section this version can read. Nothing has been overwritten." + (targets.length > 1 ? " Your choice applies to " + targets.length + " selected photos with warnings." : "") : "This photo was skipped so other previews can finish. The error is remembered for future visits."),
        make("p", "Revert to original removes this photo’s grade, including source settings and repairs. The original photo, ratings, tags and album membership are kept. Its previous grade is retained."));
      if (warning) body.append(make("p", "Continue without them saves the readable sections and keeps the untouched grade as a backup. Leave as is changes no files."));
      const details = make("details", ""); details.append(make("summary", "Error details"), make("pre", record.details || record.reason));
      const feedback = make("p", ""); feedback.setAttribute("role", "status"); body.append(details, feedback);
      const actions = make("div", "", "app-dialog-actions"), buttons = [];
      let busy = false;
      const close = make("button", "Close", "button-secondary"); close.type = "button"; close.addEventListener("click", () => dialog.close());
      actions.append(close); buttons.push(close);
      const choices = warning ? [["leave", "Leave as is"], ["continue", "Continue without them"], ["original", "Revert to original"]] : [["retry", "Try again"], ["ignore", "Ignore error"], ["original", "Revert to original"]];
      if (warning && record.notice?.issues?.every(item => item.kind === "look")) choices.push(["dismiss", "Dismiss notice"]);
      for (const [action, label] of choices) {
        const button = make("button", label, action === "original" ? "button-danger" : "button-secondary"); button.type = "button";
        button.addEventListener("click", async () => {
          if (busy) return;
          busy = true; buttons.forEach(item => item.disabled = true); feedback.textContent = "Saving choice…";
          try {
            if (warning && action === "leave") { dialog.close(); return; }
            const result = warning
              ? await api("/api/library/grade-read-choices", {photos:targets.map(item => ({path:item.path,revision:item.revision})), action})
              : await api("/api/library/picture-error", {path:record.path, revision:record.revision, action});
            if (action === "ignore") remember(result.error);
            else if (action === "dismiss") { for (const item of targets) records.set(item.path, {...item, ignored:true}); notify(); }
            else { for (const item of targets) records.delete(item.path); notify(); await changed(targets.map(item=>item.path), result, true); }
            status(warning ? (action === "dismiss" ? "Notice dismissed. The saved grade is unchanged." : "Choice saved. The original grade is kept as a backup.") : action === "ignore" ? "Error remembered. This photo stays skipped." : "Photo queued for a new preview.");
            dialog.close();
          } catch (error) { feedback.textContent = error.message; }
          finally { busy = false; buttons.forEach(item => item.disabled = false); }
        });
        buttons.push(button); actions.append(button);
      }
      dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
      dialog.addEventListener("close", () => { opened = false; dialog.remove(); if (origin?.isConnected) origin.focus({preventScroll:true}); });
      dialog.append(header, body, actions); document.body.append(dialog); dialog.showModal(); close.focus();
    }
    function paint(cell) {
      const record = records.get(cell.photo.path);
      let tag = cell.element.querySelector(".library-picture-error:not(.library-memory-needed)");
      const hasPicture = !!cell.hasCameraPreview || !!cell.meta || !!cell.scene;
      const previewOnly = !!record && !record.grade_warning && !!cell.hasCameraPreview && !cell.meta && !cell.scene;
      cell.element.classList.toggle("picture-failed", !!record && !record.grade_warning && !hasPicture);
      if (previewOnly) { cell.element.title = record.reason; tag?.remove(); return; }
      if (!record) { tag?.remove(); return; }
      cell.element.classList.remove("loading");
      if (!tag) {
        tag = make("button", "", "library-picture-error"); tag.type = "button";
        tag.addEventListener("click", event => { event.stopPropagation(); void show(records.get(cell.photo.path)); });
        tag.addEventListener("dblclick", event => event.stopPropagation());
        cell.element.querySelector(".picture-frame").append(tag);
      }
      if (record.grade_warning && record.ignored) { tag.remove(); return; }
      tag.textContent = hasPicture && !record.grade_warning ? "Preview needs attention" : record.timeout ? "Took too long · Try again" : record.grade_warning ? "Grade needs attention" : record.ignored ? "Error · ignored" : `Failed · ${record.reason}`;
      tag.title = record.reason;
      tag.setAttribute("aria-label", `${cell.photo.name}: ${record.reason} Review error`);
    }
    async function failed(cell, current) {
      // A source refusal can beat JPEG extraction. Let the independent quick
      // request finish before deciding whether this cell has no picture.
      await cell.previewPromise;
      if (!current()) return;
      paint(cell);
      if (!cell.hasCameraPreview && !cell.meta && !cell.scene) cell.controller.abort();
    }
    return Object.freeze({remember, update, show, paint, failed, canPrepare:path => !records.has(path) || !!records.get(path).grade_warning || !!records.get(path).timeout, get:path => records.get(path)});
  }
});
