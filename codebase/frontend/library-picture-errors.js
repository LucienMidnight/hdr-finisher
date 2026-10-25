/* One remembered error and recovery dialog shared by tiles and Activity. */
window.HDRLibraryPictureErrors = Object.freeze({
  create({api, changed, status}) {
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
      const newer = [...records.values()].filter(record => record.time > checkedAt);
      records.clear();
      for (const value of [...values, ...newer]) { records.set(value.path, value); previous.delete(value.path); }
      notify();
      if (previous.size) changed([...previous]);
    }
    async function show(record) {
      if (opened) return;
      record = records.get(record.path) || record;
      opened = true;
      const origin = document.activeElement;
      const dialog = make("dialog", "", "application-dialog library-ask library-picture-error-dialog");
      dialog.setAttribute("aria-label", "Library preview error");
      const header = make("div", "", "application-dialog-header"), words = make("div", "");
      words.append(make("h2", record.path.split(/[\\/]/).at(-1)), make("p", record.reason)); header.append(words);
      const body = make("div", "", "library-ask-body");
      body.append(make("p", "This photo was skipped so other previews can finish. The error is remembered for future visits."),
        make("p", "Revert to original removes this photo’s grade, including source settings and repairs. The original photo, ratings, tags and album membership are kept. Its previous grade is retained."));
      const details = make("details", ""); details.append(make("summary", "Error details"), make("pre", record.details || record.reason));
      const feedback = make("p", ""); feedback.setAttribute("role", "status"); body.append(details, feedback);
      const actions = make("div", "", "app-dialog-actions"), buttons = [];
      let busy = false;
      const close = make("button", "Close", "button-secondary"); close.type = "button"; close.addEventListener("click", () => dialog.close());
      actions.append(close); buttons.push(close);
      for (const [action, label] of [["retry", "Try again"], ["ignore", "Ignore error"], ["original", "Revert to original"]]) {
        const button = make("button", label, action === "original" ? "button-danger" : "button-secondary"); button.type = "button";
        button.addEventListener("click", async () => {
          if (busy) return;
          busy = true; buttons.forEach(item => item.disabled = true); feedback.textContent = "Saving choice…";
          try {
            const result = await api("/api/library/picture-error", {path:record.path, revision:record.revision, action});
            if (action === "ignore") remember(result.error);
            else { records.delete(record.path); notify(); await changed([record.path], result, true); }
            status(action === "ignore" ? "Error remembered. This photo stays skipped." : "Photo queued for a new preview.");
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
      let tag = cell.element.querySelector(".library-picture-error");
      cell.element.classList.toggle("picture-failed", !!record);
      if (!record) { tag?.remove(); return; }
      cell.element.classList.remove("loading");
      if (!tag) {
        tag = make("button", "", "library-picture-error"); tag.type = "button";
        tag.addEventListener("click", event => { event.stopPropagation(); void show(records.get(cell.photo.path)); });
        tag.addEventListener("dblclick", event => event.stopPropagation());
        cell.element.querySelector(".picture-frame").append(tag);
      }
      tag.textContent = record.ignored ? "Error · ignored" : "Error";
      tag.title = record.reason;
      tag.setAttribute("aria-label", `${cell.photo.name}: ${record.reason} Review error`);
    }
    return Object.freeze({remember, update, show, paint, get:path => records.get(path)});
  }
});
