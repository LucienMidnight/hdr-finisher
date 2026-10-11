/* The only bridge from the independent Library page into editor state. */
(() => {
  const frame = document.getElementById("library-frame");
  let reviewQueue = Promise.resolve(), restoreWindow = false, detached = false;
  const away = document.createElement("div"); away.className = "library-away"; away.hidden = true;
  away.innerHTML = '<p>Library is open in its own window.</p><button class="button-secondary">Show Library</button>';
  frame.after(away); away.querySelector("button").addEventListener("click", () => desktop?.focusLibrary());
  desktop?.onLibraryWindowChanged(message => {
    if (message.action === "docked") {
      detached = false; away.hidden = true; frame.hidden = false;
      send("restore", { state: message.state }); activateWorkflowTab("import"); sync();
    } else if (message.action === "choose-source") requestSourceImport();
  });
  const send = (action, detail = {}) => frame.contentWindow?.postMessage({ type: "hdr-library-host", action, ...detail }, location.origin);
  function sync() {
    const active = state.activeWorkflow === "import" && !detached;
    away.hidden = !detached || state.activeWorkflow !== "import";
    if (detached && state.activeWorkflow === "import") desktop?.focusLibrary();
    for (const element of document.querySelectorAll(".app-shell > .source-rail, .app-shell > .source-splitter, .app-shell > .workspace-main, .app-shell > .grade-rail, .app-shell > .grade-splitter")) element.inert = active;
    send("active", { enabled: active });
    if (active) frame.contentWindow?.focus();
  }
  function review(enabled) {
    document.body.classList.toggle("library-review", enabled);
    reviewQueue = reviewQueue.catch(() => {}).then(async () => {
      if (!desktop) return;
      const windowState = await desktop.getWindowState();
      if (enabled && !windowState.fullscreen) {
        restoreWindow = true; await desktop.performWindowAction("fullscreen");
      } else if (!enabled && restoreWindow) {
        restoreWindow = false;
        if (windowState.fullscreen) await desktop.performWindowAction("fullscreen");
      }
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.type !== "hdr-library") return;
    const message = event.data;
    if (message.action === "ready") sync();
    else if (message.action === "review") review(Boolean(message.enabled));
    else if (message.action === "pop-out") {
      if (!desktop) { showUploadError("A separate Library window requires the desktop app."); return; }
      detached = true; frame.hidden = true; sync();
      reviewQueue.then(() => desktop.popOutLibrary(message.state)).then(() => {
        if (state.session) activateWorkflowTab("grade");
      }).catch(error => { detached = false; frame.hidden = false; sync(); showUploadError(error.message); });
    }
    else if (message.action === "choose-source") requestSourceImport();
    else if (message.action === "open-source" && typeof message.path === "string") {
      // Use the existing grant and leave-photo gate, including Cancel/Save/Discard.
      (async () => {
        await reviewQueue;
        if (!desktop) throw new Error("Opening a library path in Grade requires the desktop app.");
        const selection = await desktop.grantSourcePath(message.path);
        await openDesktopSelection({ kind: "source", ...selection });
      })().catch((error) => showUploadError(error.message));
    }
  });
  window.addEventListener("hdrfinisher:workflowchange", sync);
})();
