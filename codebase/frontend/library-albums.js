/* Albums in the Library's left panel. Photos stay where they are on disk. */
(() => {
  "use strict";
  const { ask, make, showMenu } = HDRLibraryDialogs;
  const DRAG = "application/x-hdr-library-photos";
  function create(options) {
    let albums = [], active = "";
    const root = options.root, same = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
    const photos = count => `${count.toLocaleString()} ${count === 1 ? "photo" : "photos"}`;
    const report = error => options.status(error.message);
    function render() {
      root.replaceChildren(...albums.map(album => {
        const row = make("div", "library-folder-row library-album-row"); row.dataset.album = album.name;
        row.classList.toggle("active", !!active && same(active, album.name));
        const name = make("button", "folder-name", album.name); name.type = "button"; name.title = `Album · ${photos(album.count)}`;
        name.addEventListener("click", () => options.open(album.name));
        const menu = event => showMenu(event, [
          { label: "Rename album…", run: () => rename(album) },
          { label: "Delete album…", run: () => remove(album) },
        ], { label: "Album actions", onError: report });
        row.addEventListener("contextmenu", menu);
        row.addEventListener("keydown", event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) menu(event); });
        // Thumbnails dragged from the grid or filmstrip join the album.
        row.addEventListener("dragover", event => { if (event.dataTransfer.types.includes(DRAG)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; row.classList.add("drop"); } });
        row.addEventListener("dragleave", () => row.classList.remove("drop"));
        row.addEventListener("drop", event => { event.preventDefault(); row.classList.remove("drop"); void add(album.name, options.selection()).catch(report); });
        row.append(name, make("span", "library-count", album.count.toLocaleString())); return row;
      }));
      if (!albums.length) root.append(make("p", "library-nav-empty", "No albums yet. Use + to make one."));
    }
    async function refresh() { albums = (await options.api("/api/library/albums")).albums; render(); }
    async function command(route, body, done) {
      try { const result = await options.run(route, body); options.status(result.warnings.at(-1) || done(result)); return result; }
      finally { await refresh(); }
    }
    async function newAlbum(paths = []) {
      const answer = await ask({ title: "New Album", message: paths.length ? `The album starts with the ${photos(paths.length)} selected. Photos stay where they are.` : "An album is a hand-picked set. Photos stay where they are.", fields: [{ name: "name", label: "Album name" }], confirm: "Create" });
      if (!answer) return;
      await command("/api/library/albums/create", { name: answer.name, paths }, () => paths.length ? `${photos(paths.length)} added to ${answer.name}.` : `Album ${answer.name} created.`);
    }
    const add = (name, paths) => paths.length ? command("/api/library/albums/add", { name, paths }, result => result.changed ? `${photos(result.changed)} added to ${name}.` : `Already in ${name}.`) : Promise.resolve();
    const take = (name, paths) => command("/api/library/albums/remove", { name, paths }, result => `${photos(result.changed)} removed from ${name}. The files are untouched.`);
    async function rename(album) {
      const answer = await ask({ title: "Rename Album", fields: [{ name: "name", label: "Album name", value: album.name }], confirm: "Rename" });
      if (!answer || answer.name === album.name) return;
      await command("/api/library/albums/rename", { name: album.name, new_name: answer.name }, () => `Album renamed to ${answer.name}.`);
      if (active && same(active, album.name)) options.open(answer.name);
    }
    async function remove(album) {
      const answer = await ask({ title: "Delete Album", message: `${album.name} is removed from the list. Its ${photos(album.count)} stay where they are; nothing is deleted from disk. Ctrl+Z brings the album back.`, confirm: "Delete album" });
      if (!answer) return;
      await command("/api/library/albums/delete", { name: album.name }, () => `Album ${album.name} deleted. Photos untouched.`);
      if (active && same(active, album.name)) options.closed();
    }
    function menuActions(paths) {
      // Entries for the photo right-click menu.
      const actions = albums.slice(0, 12).map(album => ({ label: `Add to ${album.name}`, run: () => add(album.name, paths) }));
      actions.push({ label: paths.length > 1 ? `New album from ${paths.length} photos…` : "New album from this photo…", run: () => newAlbum(paths) });
      if (active) actions.push({ separator: true }, { label: `Remove from ${active}`, run: () => take(active, paths) });
      return actions;
    }
    options.addButton.addEventListener("click", event => {
      const paths = options.selection();
      showMenu(event, [{ label: "New empty album…", run: () => newAlbum() },
        { label: paths.length ? `New album from ${photos(paths.length)} selected…` : "New album from selected photos…", disabled: !paths.length, run: () => newAlbum(paths) }],
        { label: "New album", anchor: options.addButton, onError: report });
    });
    return Object.freeze({ refresh, menuActions, setActive: name => { active = name || ""; render(); }, names: () => albums.map(album => album.name) });
  }
  window.HDRLibraryAlbums = Object.freeze({ create, DRAG });
})();
