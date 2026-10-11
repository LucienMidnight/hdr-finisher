/* Culling controls call backend commands; they never write settings themselves. */
(() => {
  "use strict";
  const labels = ["red", "orange", "green", "blue"];
  const empty = () => ({ rating: 0, pick: "unmarked", label: "", tags: [] });
  function create(options) {
    let commands = Promise.resolve(), draft = "", tagRequest = null, tagTimer = null, undoAvailable = false;
    const targets = () => options.photos().filter(photo => options.selection().has(photo.path));
    const marks = photo => photo.marks || empty();
    function enqueue(route, body, strict = false) {
      // One command at a time. A strict caller (tags, albums) gets the result or the error.
      const task = commands.then(async () => {
        options.status("Saving marks…");
        const result = await options.api(route, body);
        const byPath = new Map(result.photos.map(row => [row.path, row]));
        for (const photo of options.photos()) { const row = byPath.get(photo.path); if (row) Object.assign(photo, row); }
        undoAvailable = result.undo_available;
        if (result.session) parent.postMessage({type:"hdr-library",action:"grade-replaced",session:result.session},location.origin);
        options.updated(result);
        const verb = route === "/api/library/undo" ? "Undid the change on" : body?.change?.rating !== undefined ? "Rated"
          : body?.change?.pick === "pick" ? "Picked" : body?.change?.pick === "reject" ? "Rejected" : "Updated";
        const message = result.warnings[0] || (result.photos.length ? `${verb} ${result.photos.length.toLocaleString()} photos` : "No marks changed.");
        if (options.confirm) options.confirm(message, result.undo_available); else options.status(message);
        return result;
      });
      commands = task.catch(error => { if (!strict) options.status(error.message); });
      return strict ? task : commands;
    }
    const named = label => { const name = options.labelName?.(label); return name ? `${name} · ${label} label` : `${label} label`; };
    function change(patch) {
      const paths = targets().map(photo => photo.path);
      if (paths.length) return enqueue("/api/library/marks", { paths, change: patch });
      return commands;
    }
    const COPY_ICON = "M8 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2";
    const EDITED_ICON = "M4 6h8 M16 6h4 M4 12h2 M10 12h10 M4 18h10 M18 18h2 M14 4v4 M8 10v4 M16 16v4";
    function icon(path) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path"); line.setAttribute("d", path); svg.append(line); return svg;
    }
    function strip(photo) {
      const value = marks(photo), root = document.createElement("span"); root.className = "library-marks";
      const stars = document.createElement("span"); stars.className = "library-stars"; stars.textContent = "★".repeat(value.rating);
      if (value.rating) stars.setAttribute("aria-label", `${value.rating} stars`);
      root.append(stars);
      if(photo.copy_id || photo.copy_count) {
        const copy = document.createElement("span"); copy.className = "library-copy";
        if (photo.copy_id) copy.append(icon(COPY_ICON)); else copy.textContent = `+${photo.copy_count}`;
        copy.title = photo.copy_id ? `Virtual copy: ${photo.copy_name}` : `Has ${photo.copy_count} virtual ${photo.copy_count === 1 ? "copy" : "copies"}`;
        copy.setAttribute("aria-label", copy.title); root.append(copy);
      }
      if (photo.edited) {
        const mark = document.createElement("span"); mark.className = "library-edited"; mark.append(icon(EDITED_ICON));
        mark.title = photo.pictureCurrent ? "Saved grade" : "This photo has a saved grade, but its Library picture is not current. Open it in Grade and save to update the picture.";
        mark.setAttribute("aria-label", mark.title); root.append(mark);
      }
      if (value.pick !== "unmarked") {
        const flag = document.createElement("span"); flag.className = `library-flag ${value.pick}`;
        flag.textContent = value.pick === "pick" ? "⚑" : "×"; flag.setAttribute("aria-label", value.pick === "pick" ? "Picked" : "Rejected"); root.append(flag);
      }
      if (value.label) {
        const dot = document.createElement("span"); dot.className = "library-label-dot";
        dot.style.background = `var(--label-${value.label})`; dot.title = named(value.label); dot.setAttribute("aria-label", named(value.label)); root.append(dot);
      }
      return root;
    }
    function button(text, label, patch) {
      const element = document.createElement("button"); element.type = "button"; element.textContent = text;
      element.setAttribute("aria-label", label); element.title = label; element.className = "text-button";
      element.addEventListener("click", () => change(patch)); return element;
    }
    function details(root) {
      tagRequest?.abort(); clearTimeout(tagTimer);
      const list = targets();
      if (!list.length) return;
      const section = document.createElement("section"); section.className = "library-culling";
      const count = document.createElement("p"); count.textContent = list.length === 1 ? "Marks" : `${list.length.toLocaleString()} photos selected`; section.append(count);
      const rating = document.createElement("div"); rating.className = "library-rating-controls"; rating.setAttribute("aria-label", "Star rating");
      rating.append(button("0", "Clear rating · 0", { rating: 0 }));
      for (let value = 1; value <= 5; value++) {
        const star = button("★", `${value} stars · ${value}`, { rating: value });
        star.classList.toggle("on", list.every(photo => marks(photo).rating >= value));
        star.setAttribute("aria-pressed", String(list.every(photo => marks(photo).rating === value))); rating.append(star);
      }
      section.append(rating);
      const flags = document.createElement("div"); flags.className = "library-pick-controls";
      for (const [text, value, key] of [["Pick", "pick", "P"], ["Reject", "reject", "X"], ["Clear", "unmarked", "U"]]) {
        const control = button(text, `${text} · ${key}`, { pick: value });
        control.setAttribute("aria-pressed", String(list.every(photo => marks(photo).pick === value))); flags.append(control);
      }
      section.append(flags);
      const colours = document.createElement("div"); colours.className = "library-label-controls";
      labels.forEach((label, i) => {
        const control = button("", `${named(label)} · ${i + 6}`, { label, toggle_label: true });
        const dot = document.createElement("span"); dot.className = "library-label-dot"; dot.style.background = `var(--label-${label})`; control.append(dot);
        control.setAttribute("aria-pressed", String(list.every(photo => marks(photo).label === label))); colours.append(control);
      });
      section.append(colours);
      const heading = document.createElement("p"); heading.textContent = "Tags"; section.append(heading);
      const chips = document.createElement("div"); chips.className = "library-tag-chips";
      const allTags = new Map();
      list.forEach(photo => marks(photo).tags.forEach(tag => { const key = tag.toLocaleLowerCase(); const value = allTags.get(key) || { tag, count: 0 }; value.count++; allTags.set(key, value); }));
      for (const { tag, count } of allTags.values()) {
        const chip = document.createElement("span"); chip.className = `library-tag-chip${count < list.length ? " partial" : ""}`;
        chip.append(button(tag, count < list.length ? `Add ${tag} to all selected photos` : tag, { add_tag: tag }), button("×", `Remove tag ${tag}`, { remove_tag: tag })); chips.append(chip);
      }
      section.append(chips);
      const input = document.createElement("input"); input.id = "library-tag-input"; input.type = "text"; input.value = draft; input.placeholder = "Add tag…"; input.autocomplete = "off";
      input.setAttribute("aria-label", "Add tag · T"); input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false"); input.setAttribute("aria-controls", "library-tag-suggestions");
      const suggestions = document.createElement("div"); suggestions.id = "library-tag-suggestions"; suggestions.setAttribute("role", "listbox");
      let index = -1;
      const commit = tag => { if (!tag.trim()) return; draft = ""; void change({ add_tag: tag }).then(() => document.getElementById("library-tag-input")?.focus()); };
      input.addEventListener("input", () => {
        draft = input.value; clearTimeout(tagTimer); tagRequest?.abort(); tagRequest = new AbortController(); const controller = tagRequest;
        tagTimer = setTimeout(async () => {
          try {
            const result = await options.api(`/api/library/tags?q=${encodeURIComponent(draft)}`, undefined, controller.signal);
            if (!input.isConnected || controller.signal.aborted) return;
            index = -1; suggestions.replaceChildren();
            result.tags.forEach(({ tag, count }, i) => {
              const item = document.createElement("button"); item.type = "button"; item.className = "text-button"; item.id = `library-tag-suggestion-${i}`; item.setAttribute("role", "option"); item.setAttribute("aria-selected", "false"); item.dataset.tag = tag; item.textContent = `${tag} (${count})`;
              item.addEventListener("click", () => commit(tag)); suggestions.append(item);
            });
            input.setAttribute("aria-expanded", String(result.tags.length > 0));
          } catch (error) { if (error.name !== "AbortError") options.status(error.message); }
        }, 150);
      });
      input.addEventListener("keydown", event => {
        const items = [...suggestions.children];
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); index = Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
          items.forEach((item, i) => item.setAttribute("aria-selected", String(i === index)));
          if (items[index]) input.setAttribute("aria-activedescendant", items[index].id);
        } else if (event.key === "Enter") { event.preventDefault(); commit(items[index]?.dataset.tag || input.value); }
        else if (event.key === "Escape") { suggestions.replaceChildren(); input.setAttribute("aria-expanded", "false"); input.blur(); }
      });
      section.append(input, suggestions);
      const databaseOnly = list.filter(photo => photo.storage === "database").length;
      if (databaseOnly) { const note = document.createElement("p"); note.className = "library-storage-warning"; note.textContent = `${databaseOnly} photos: settings files are waiting to be written. Marks are safe in the library.`; section.append(note); }
      const undo = document.createElement("button"); undo.type = "button"; undo.className = "text-button"; undo.textContent = "Undo last change · Ctrl+Z"; undo.disabled = !undoAvailable;
      undo.addEventListener("click", () => enqueue("/api/library/undo", {})); section.append(undo); root.append(section);
    }
    function shortcut(key) {
      if (/^[0-5]$/.test(key)) void change({ rating: Number(key) });
      else if (/^[6-9]$/.test(key)) void change({ label: labels[Number(key) - 6], toggle_label: true });
      else if (["p", "x", "u"].includes(key)) void change({ pick: { p: "pick", x: "reject", u: "unmarked" }[key] });
      else return false;
      return true;
    }
    return Object.freeze({ details, strip, shortcut, undo: () => enqueue("/api/library/undo", {}), run: (route, body) => enqueue(route, body, true),
      undoAvailable: () => undoAvailable, setUndo: value => { undoAvailable = value; }, settled: () => commands });
  }
  window.HDRLibraryCulling = Object.freeze({ create });
})();
