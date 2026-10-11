/* Tags and Labels window. Every change is a backend command and one undo step. */
(() => {
  "use strict";
  const { ask, make } = HDRLibraryDialogs;
  const labels = ["red", "orange", "green", "blue"];
  function create(options) {
    let dialog = null, tags = [], chosen = new Set(), anchor = -1, sort = "count", busy = false;
    const element = {};
    const shown = () => {
      const needle = element.search.value.trim().toLocaleLowerCase();
      const list = tags.filter(item => item.tag.toLocaleLowerCase().includes(needle));
      return sort === "name" ? [...list].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: "base", numeric: true })) : list;
    };
    const selected = () => tags.filter(item => chosen.has(item.tag));
    const photos = count => `${count.toLocaleString()} ${count === 1 ? "photo" : "photos"}`;
    function render() {
      const list = shown();
      element.list.replaceChildren(...list.map((item, index) => {
        const row = make("button", "library-tag-row"); row.type = "button"; row.setAttribute("role", "option"); row.dataset.tag = item.tag;
        row.setAttribute("aria-selected", String(chosen.has(item.tag)));
        row.append(make("span", "library-tag-name", item.tag), make("span", "library-tag-count", item.count.toLocaleString()));
        row.addEventListener("click", event => {
          if (event.shiftKey && anchor >= 0) { if (!event.ctrlKey) chosen.clear(); for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) chosen.add(list[i].tag); }
          else if (event.ctrlKey || event.metaKey) { chosen.has(item.tag) ? chosen.delete(item.tag) : chosen.add(item.tag); anchor = index; }
          else { chosen = new Set([item.tag]); anchor = index; }
          render();
        });
        row.addEventListener("dblclick", () => { chosen = new Set([item.tag]); show(); });
        return row;
      }));
      if (!list.length) element.list.append(make("p", "library-tag-empty", tags.length ? "No tag matches." : "No tags yet. Type one in the Details panel, or use New tag."));
      const picked = selected();
      element.show.disabled = element.rename.disabled = busy || picked.length !== 1;
      element.merge.disabled = busy || picked.length < 2; element.remove.disabled = busy || !picked.length;
      element.undo.disabled = busy || !options.undoAvailable();
      for (const name of ["name", "count"]) element[`sort-${name}`].setAttribute("aria-pressed", String(sort === name));
    }
    async function load() {
      const result = await options.api("/api/library/tags?all=true");
      tags = result.tags; chosen = new Set([...chosen].filter(tag => tags.some(item => item.tag === tag)));
      render();
    }
    function note(text) { element.note.textContent = text; }
    async function run(route, body, done) {
      busy = true; render();
      try {
        const result = await options.run(route, body);
        note(result.warnings.at(-1) || done(result)); return result;
      } finally { busy = false; await load().catch(error => note(error.message)); }
    }
    async function rename() {
      const [item] = selected();
      const answer = await ask({ title: "Rename Tag", message: `${item.tag} is on ${photos(item.count)}. Every one of them gets the new name.`, fields: [{ name: "name", label: "Tag name", value: item.tag }], confirm: "Rename" });
      if (!answer || answer.name === item.tag) return;
      try {
        await run("/api/library/tags/rename", { tag: item.tag, name: answer.name }, result => `Renamed on ${photos(result.changed)}.`);
      } catch (error) {
        if (error.status !== 409) throw error;
        // The name is taken: stop and ask before merging.
        const merge = await ask({ title: "Merge Tags?", message: `${error.message} Merging puts ${item.tag} and that tag together as one. Nothing has been changed yet.`, confirm: "Merge" });
        if (merge) await run("/api/library/tags/rename", { tag: item.tag, name: answer.name, merge: true }, result => `Merged on ${photos(result.changed)}.`);
      }
      chosen = new Set([answer.name]);
    }
    async function merge() {
      const picked = selected(), most = [...picked].sort((a, b) => b.count - a.count)[0];
      const answer = await ask({ title: "Merge Tags", message: `${picked.map(item => item.tag).join(", ")} become one tag on every photo that carries any of them.`, fields: [{ name: "into", label: "Name to keep", value: most.tag }], confirm: "Merge" });
      if (!answer) return;
      await run("/api/library/tags/merge", { tags: picked.map(item => item.tag), into: answer.into }, result => `Merged on ${photos(result.changed)}.`);
      chosen = new Set([answer.into]);
    }
    async function remove() {
      const picked = selected(), total = picked.reduce((sum, item) => sum + item.count, 0);
      const answer = await ask({ title: picked.length === 1 ? "Remove Tag" : "Remove Tags", message: `${picked.map(item => item.tag).join(", ")} will be taken off ${photos(total)} and off the list. The photos are not changed in any other way.`, confirm: "Remove" });
      if (answer) await run("/api/library/tags/remove", { tags: picked.map(item => item.tag) }, result => `Removed from ${photos(result.changed)}.`);
    }
    async function add() {
      const answer = await ask({ title: "New Tag", message: "The tag is added to the list, so it is offered as a suggestion before any photo carries it.", fields: [{ name: "name", label: "Tag name" }], confirm: "Add" });
      if (!answer) return;
      await run("/api/library/tags/create", { name: answer.name }, () => `${answer.name} added.`);
      chosen = new Set([answer.name]);
    }
    function show() {
      const [item] = selected(); if (!item) return;
      dialog.close(); options.showTag(item.tag);
    }
    const guarded = action => () => action().then(render).catch(error => note(error.message));
    function build() {
      dialog = make("dialog", "application-dialog library-tags"); dialog.id = "library-tags"; dialog.setAttribute("aria-labelledby", "library-tags-title");
      const header = make("div", "application-dialog-header"), words = make("div"), title = make("h2", "", "Tags and Labels"); title.id = "library-tags-title";
      words.append(title, make("p", "", "Changes here reach every photo in the library that carries the tag. Ctrl+Z takes the last one back.")); header.append(words);
      const tools = make("div", "library-tags-tools");
      element.search = make("input"); element.search.type = "search"; element.search.id = "library-tags-search"; element.search.placeholder = "Find a tag"; element.search.setAttribute("aria-label", "Find a tag");
      element.search.addEventListener("input", render);
      tools.append(element.search, make("span", "library-tags-sort", "Sort"));
      for (const [name, text] of [["name", "Name"], ["count", "Most used"]]) {
        const button = make("button", "text-button", text); button.type = "button"; element[`sort-${name}`] = button;
        button.addEventListener("click", () => { sort = name; render(); }); tools.append(button);
      }
      element.list = make("div", "library-tags-list"); element.list.id = "library-tags-list"; element.list.setAttribute("role", "listbox"); element.list.setAttribute("aria-multiselectable", "true"); element.list.setAttribute("aria-label", "Tags");
      const meanings = make("div", "library-label-names");
      meanings.append(make("p", "", "Colour labels can be given a meaning. It shows in tooltips; the colours and keys 6 to 9 stay the same."));
      labels.forEach((label, index) => {
        const row = make("label", "library-label-name"), dot = make("span", "library-label-dot"), input = make("input");
        dot.style.background = `var(--label-${label})`; input.type = "text"; input.maxLength = 60; input.dataset.label = label; input.placeholder = `${label[0].toUpperCase()}${label.slice(1)} · key ${index + 6}`;
        input.setAttribute("aria-label", `Meaning of the ${label} label`); element[`label-${label}`] = input;
        input.addEventListener("change", () => options.setLabelNames({ [label]: input.value }).then(() => note("Label meaning saved.")).catch(error => note(error.message)));
        row.append(dot, input); meanings.append(row);
      });
      element.note = make("p", "library-tags-note"); element.note.setAttribute("role", "status");
      const actions = make("div", "app-dialog-actions");
      const button = (key, text, action, className = "button-secondary") => { const item = make("button", className, text); item.type = "button"; item.id = `library-tags-${key}`; item.addEventListener("click", action); element[key] = item; return item; };
      const spacer = make("span", "library-spacer");
      actions.append(button("new", "New tag…", guarded(add)), button("show", "Show photos", show), button("rename", "Rename…", guarded(rename)), button("merge", "Merge…", guarded(merge)), button("remove", "Remove…", guarded(remove)),
        spacer, button("undo", "Undo", guarded(async () => { await options.undo(); note("Last change taken back."); await load(); })), button("close", "Close", () => dialog.close(), "button-primary"));
      dialog.append(header, tools, element.list, meanings, element.note, actions); document.body.append(dialog);
      dialog.addEventListener("keydown", event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.target.matches("input") && !element.undo.disabled) { event.preventDefault(); element.undo.click(); }
      });
    }
    async function open() {
      if (!dialog) build();
      chosen.clear(); anchor = -1; element.search.value = "";
      const names = options.labelNames();
      for (const label of labels) element[`label-${label}`].value = names[label] || "";
      note(options.indexing() ? "Indexing is still running, so more may turn up." : "");
      dialog.showModal(); element.search.focus();
      await load().catch(error => note(error.message));
    }
    return Object.freeze({ open, refresh: () => dialog?.open ? load() : Promise.resolve() });
  }
  window.HDRLibraryTags = Object.freeze({ create });
})();
