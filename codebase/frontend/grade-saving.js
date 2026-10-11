/* Settings-file saving is independent of Grade's rendering and edit commands. */
(() => {
  let current = null, currentPath = null, currentName = null, readySession = null, loadedGrade = false, result = {}, busy = false, saving = false, lastChange = 0, lastToken = "", asking = false, conflictShown = false;
  const byId = id => document.getElementById(id);
  const autosave = () => state.appPreferences?.gradeAutosave !== false;
  async function command(action, detail = {}, id = current) {
    const response = await fetch(`/api/library/grade/${id}`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...detail }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(projectIo.responseErrorMessage(payload, "The grade could not be saved."));
    return payload;
  }
  function render() {
    const button = byId("grade-autosave");
    button.setAttribute("aria-pressed", String(autosave()));
    button.querySelector("span").textContent = autosave() ? "Autosave on" : "Autosave off";
    const visible = Boolean(current && state.session?.session_id === current);
    byId("grade-saving-controls").hidden = !visible;
    if (!visible) return;
    if (Object.hasOwn(result, "name")) currentName = result.name ? `${state.session.source.filename} · ${result.name}` : null;
    els.sessionName.textContent = currentName || state.session.source.filename;
    const dirty = state.documentDirty;
    const token = `${state.editRevision}:${state.globalEditGeneration}:${dirty}`;
    if (token !== lastToken) { lastToken = token; lastChange = performance.now(); }
    byId("grade-save-state").textContent = result.conflict ? "Saving paused — grade changed elsewhere"
      : result.reason ? "Waiting to write settings — grade kept safely in the Library"
      : saving || result.pending ? "Saving…" : dirty ? "Unsaved changes"
      : autosave() ? "All changes saved" : "No unsaved changes";
    byId("grade-save-now").hidden = byId("grade-revert-saved").hidden = autosave() || !dirty;
    byId("grade-resolve-conflict").hidden = !result.conflict;
    const dot = byId("grade-unsaved-dot");
    dot.hidden = !dirty && !result.conflict;
  }
  async function flush() {
    if (await (state.editCommandQueue || Promise.resolve(true)) === false || await syncGlobalEditState() === false)
      throw new Error("The latest edit could not be saved. Your grade remains open.");
  }
  async function load(grade, recovery = false) {
    const payload = await command("load", { document: grade, recovery });
    current = payload.session.session_id;
    loadedGrade = true;
    result = {};
    await activateDesktopSession(payload.session, "");
    state.documentDirty = recovery;
    syncDesktopDocumentState();
    render();
  }
  async function resolve() {
    if (asking) return false;
    asking = true;
    try {
      await flush();
      const checked = await command("check", { unsaved: state.documentDirty });
      result = checked;
      if (!result.conflict) return true;
      conflictShown = true;
      const name = currentName || state.session.source.filename;
      const choice = await window.HDRDialogs.choose(
        `The grade for ${name} changed elsewhere while you were working. Nothing was overwritten. Choose which grade to use; the other will be kept as the previous grade. Keep both brings the file's grade in as a virtual copy.`,
        [{ label: "Cancel", value: "cancel", cancel: true },
         { label: "Keep both", value: "both" }, { label: "Use the file's grade", value: "file" }, { label: "Keep my grade", value: "mine", primary: true }],
        { title: "Grade changed elsewhere" });
      result = await command("resolve", { choice: choice || "cancel", document: checked.external });
      if (!choice || choice === "cancel" || result.changed_again) return false;
      if (result.reload) await load(result.grade);
      else state.documentDirty = Boolean(result.dirty);
      conflictShown = false;
      return true;
    } finally { asking = false; render(); syncDesktopDocumentState(); }
  }
  let tickFlight = Promise.resolve(), revertFlight = Promise.resolve();
  async function save({ automatic = false } = {}) {
    if (!automatic) await revertFlight;
    if (busy && !saving && !automatic) await tickFlight;
    if (!current || busy) return false;
    busy = true; saving = true; render();
    try {
      await flush();
      const savedToken = `${state.editRevision}:${state.globalEditGeneration}`;
      result = await command("save");
      state.documentDirty = Boolean(result.dirty) || result.conflict || savedToken !== `${state.editRevision}:${state.globalEditGeneration}`;
      if (result.conflict && (!automatic || !conflictShown)) {
        busy = false;
        return await resolve();
      }
      return !result.conflict;
    } catch (error) {
      state.documentDirty = true;
      status.post({ id: "grade-save", severity: "error", message: error.message });
      return false;
    } finally { busy = false; saving = false; render(); syncDesktopDocumentState(); }
  }
  async function leave(actionLabel) {
    if (!current) return null;
    await flush();
    result = await command("check", { unsaved: state.documentDirty });
    if (result.conflict && !await resolve()) return false;
    const before = actionLabel.startsWith("opening ") ? actionLabel : actionLabel.includes("close") ? "closing the app" : actionLabel;
    let discarded = false;
    const allowed = await window.HDRPhotoTransition.leaveCurrentPhoto({ dirty: state.documentDirty,
      save: () => save(), choose: async () => {
        if (autosave()) return "save";
        const choice = await window.HDRDialogs.choose(
          `Save changes to ${currentName || state.session.source.filename} before ${before}?`,
          [{ label: "Cancel", value: "cancel", cancel: true }, { label: "Don't save", value: "discard" },
           { label: "Save", value: "save", primary: true }], { title: "Unsaved changes" });
        discarded = choice === "discard";
        return choice;
      } });
    if (allowed && discarded) await command("discard");
    return allowed;
  }
  async function open(session, itemKey = null) {
    readySession = null;
    const attached = await command("attach", { item_key: itemKey, initialize: true, default_white: Number(state.appPreferences?.defaultReferenceWhiteNits) === 100 ? 100 : 203 }, session.session_id);
    current = session.session_id; currentPath = attached.path; currentName = attached.name ? `${session.source.filename} · ${attached.name}` : null; result = { conflict: attached.conflict };
    conflictShown = false;
    loadedGrade = true;
    if (!attached.grade) {
      const fetched = await projectIo.fetchSession(fetch, session.session_id);
      session = fetched.payload.session;
    }
    if (attached.grade) {
      const payload = await command("load", { document: attached.grade, preserve_recovery: true });
      session = payload.session; current = session.session_id;
      // Loading a saved grade must not automatically apply an unsaved recovery.
      session.dirty = false;
    }
    if (attached.recovery) {
      const choice = await window.HDRDialogs.choose(
        `Unsaved work for ${session.source.filename} was kept after the app stopped. Restore it?`,
        [{ label: "Leave saved grade", value: "discard", cancel: true }, { label: "Restore unsaved work", value: "restore", primary: true }],
        { title: "Recover unsaved work" });
      if (choice === "restore") {
        const payload = await command("load", { document: attached.recovery, recovery: true });
        session = payload.session; current = session.session_id;
      } else await command("discard");
    }
    return session;
  }
  async function tick() {
    if (!current || readySession !== current || busy || asking || state.importInProgress || state.session?.session_id !== current) return;
    busy = true;
    try {
      result = await command("check", { unsaved: state.documentDirty });
      if (result.session) await refresh(result.session);
      if (result.reload) {
        await load(result.grade);
        status.post({ id: "grade-external", severity: "info", message: `The grade for ${state.session.source.filename} changed elsewhere. Grade now shows the file's grade.` });
      }
      render();
      if (result.conflict && !conflictShown) { busy = false; await resolve(); return; }
      if (!result.conflict && state.documentDirty && autosave() && performance.now() - lastChange >= 900) {
        busy = false; await save({ automatic: true });
      }
    } catch (error) {
      status.post({ id: "grade-save", severity: "error", message: error.message });
    } finally { busy = false; render(); }
  }
  function activated(session, projectPath) {
    readySession = session.session_id;
    if (projectPath || session.session_id !== current) { current = null; result = {}; }
    render();
  }
  async function saveProject() {
    const dirty = state.documentDirty;
    const saved = await saveProjectFileToPath({ saveAs: true });
    if (dirty) {
      await command("capture", { unsaved: true });
      state.documentDirty = true;
      syncDesktopDocumentState(); render();
    }
    return saved;
  }
  async function offerRecovery() {
    if (!desktop || state.session) return;
    const response = await fetch("/api/library/grade-recovery");
    const { photos = [] } = await response.json();
    if (!photos.length) return;
    const photo = photos[0];
    const choice = await window.HDRDialogs.choose(
      `Unsaved work for ${photo.path.split(/[/\\]/).pop()} was kept after the app stopped. Open the photo to review it?`,
      [{ label: "Later", value: "later", cancel: true }, { label: "Open photo", value: "open", primary: true }],
      { title: "Recover unsaved work" });
    if (choice === "open") await openDesktopSelection({ kind: "source", ...await desktop.grantSourcePath(photo.path.split("|copy|",1)[0]), itemKey: photo.path });
  }
  async function refresh(session) {
    if (!session) return;
    const workflow = state.activeWorkflow;
    current = session.session_id; readySession = null;
    await activateDesktopSession(session, "");
    if (workflow !== "grade") activateWorkflowTab(workflow);
    state.documentDirty = Boolean(session.dirty); result = {}; render(); syncDesktopDocumentState();
  }
  // The revert choices open as a menu under the button. The current grade is kept as the previous grade.
  const revertPopover = document.createElement("div");
  revertPopover.className = "window-menu-popover grade-revert-popover"; revertPopover.hidden = true;
  revertPopover.setAttribute("role", "menu"); revertPopover.setAttribute("aria-label", "Revert grade");
  document.body.append(revertPopover);
  let answerRevert = null;
  function closeRevert(value = null) {
    if (!answerRevert) return;
    revertPopover.hidden = true; byId("grade-revert-menu").setAttribute("aria-expanded", "false");
    const answer = answerRevert; answerRevert = null; answer(value);
  }
  function chooseRevert(choices) {
    return new Promise(resolve => {
      const origin = byId("grade-revert-menu"), bounds = origin.getBoundingClientRect();
      revertPopover.replaceChildren(...choices.map(([value, label]) => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.setAttribute("role", "menuitem");
        button.addEventListener("click", () => closeRevert(value)); return button;
      }));
      answerRevert = resolve; revertPopover.hidden = false; origin.setAttribute("aria-expanded", "true");
      revertPopover.style.left = `${Math.max(0, Math.min(bounds.left, innerWidth - revertPopover.offsetWidth))}px`;
      revertPopover.style.top = `${Math.max(0, Math.min(bounds.bottom + 2, innerHeight - revertPopover.offsetHeight))}px`;
      revertPopover.querySelector("button").focus({ preventScroll: true });
    });
  }
  document.addEventListener("pointerdown", event => { if (!revertPopover.contains(event.target)) closeRevert(); });
  window.addEventListener("blur", () => closeRevert());
  window.addEventListener("resize", () => closeRevert());
  revertPopover.addEventListener("keydown", event => {
    const items = [...revertPopover.querySelectorAll("button")], at = items.indexOf(document.activeElement);
    if (["Escape", "Tab"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); closeRevert(); }
    else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus({ preventScroll: true }); }
  });
  async function revertMenu(forced = null) {
    if (asking || saving) return;
    asking = true; byId("grade-revert-menu").disabled = true; byId("grade-revert-saved").disabled = true;
    try {
    if (busy) await tickFlight;
    await flush();
    const request = async target => {
      const response = await fetch("/api/library/grade-reverts", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({paths:[currentPath],target}) });
      const payload = await response.json();if (!response.ok) throw new Error(projectIo.responseErrorMessage(payload,"The grade could not be reverted."));return payload;
    };
    const {counts} = await request(null);
    const names = {previous:"Restore previous grade",saved:"Revert to last saved",session:"Revert to last session",original:"Revert to original"};
    const choices = Object.entries(names).filter(([key])=>counts[key]);
    if (!forced && !choices.length) { status.post({id:"grade-revert",severity:"info",message:"There is no earlier grade to go back to."}); return; }
    const choice = forced || await chooseRevert(choices);
    if (!choice) return;
    const result = await request(choice);await refresh(result.session);
    } finally { asking = false; byId("grade-revert-menu").disabled = false; byId("grade-revert-saved").disabled = false; }
  }
  byId("grade-revert-menu").addEventListener("click",()=>{ revertFlight = revertMenu().catch(error=>status.post({id:"grade-revert",severity:"error",message:error.message})); });
  window.HDRGradeSaving = { refresh, open, save, saveProject, leave, render, activated, resolve, offerRecovery,
    item: () => currentPath, ready: () => Boolean(current && readySession === current),
    active: () => Boolean(current && state.session?.session_id === current),
    hasGrade: id => id === current && loadedGrade, conflict: () => Boolean(result.conflict) };
  byId("grade-autosave").addEventListener("click", async () => {
    const enabled = !autosave();
    window.HDRApplicationShell.setGradeAutosave(enabled);
    if (enabled && current && state.documentDirty) await save();
    render();
  });
  byId("grade-save-now").addEventListener("click", () => save());
  byId("grade-resolve-conflict").addEventListener("click", () => resolve());
  byId("grade-revert-saved").addEventListener("click", async () => {
    try { revertFlight = revertMenu("saved"); await revertFlight; } catch (error) { status.post({id:"grade-revert",severity:"error",message:error.message}); }
  });
  // Scheduling only: an active control gesture pauses Library background work.
  let picturePauseTimer;
  const pausePictures = paused => fetch("/api/library-worker/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "grade-control", paused }) }).catch(() => {});
  document.addEventListener("pointerdown", event => {
    if (state.activeWorkflow === "grade" && event.target.closest("input,canvas,.instrument,.geometry-controls")) { clearTimeout(picturePauseTimer); void pausePictures(true); }
  }, true);
  for (const event of ["pointerup", "pointercancel", "blur"]) window.addEventListener(event, () => { clearTimeout(picturePauseTimer); picturePauseTimer = setTimeout(() => pausePictures(false), 300); });
  window.setInterval(() => { if (!busy && !asking) tickFlight = tick(); }, 500);
})();
