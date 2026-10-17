/* The only bridge from the independent Library page into editor state. */
(() => {
  const frame = document.getElementById("library-frame");
  let reviewQueue = Promise.resolve(), restoreWindow = false, detached = false, openRequest = 0;
  async function openDrop(file) {
    await reviewQueue;
    const selection = desktop ? await desktop.resolveDroppedFile(file) : null;
    if (selection) await openDesktopSelection(selection);
    else await importByteFile(file);
  }
  let commandState = { selected: 0, copied: false };
  async function preparePaste(paths) {
    const item = window.HDRGradeSaving?.item();
    if (!item || !paths.includes(item)) return true;
    return (await window.HDRGradeSaving.leave("pasting a grade")) !== false;
  }
  function updateCommands(next = commandState) {
    commandState = { selected: Number(next.selected) || 0, copied: Boolean(next.copied) };
    const active = state.activeWorkflow === "import";
    for (const button of document.querySelectorAll("[data-desktop-command]")) {
      const command = button.dataset.desktopCommand;
      if (["copy-grade", "paste-grade", "paste-grade-choose", "quick-export"].includes(command)) {
        button.disabled = !active || !commandState.selected || (command === "copy-grade" && commandState.selected !== 1)
          || (command.startsWith("paste-grade") && !commandState.copied);
      }
    }
    desktop?.setLibraryCommandState?.({ ...commandState, active });
  }
  function dispatch(command) {
    if (state.activeWorkflow !== "import") return false;
    if (detached) desktop?.sendLibraryCommand?.(command);
    else send("command", { command });
    return true;
  }
  async function libraryAction(message) {
    if (message.action === "command-state") updateCommands(message);
    else if (message.action === "grade-replaced") await window.HDRGradeSaving.refresh(message.session);
    else if (message.action === "quick-export") await window.batchExport?.quick(message.paths || message.ids || []);
    else if (message.action === "export-selection") await window.batchExport?.open(message.paths || message.ids || [], { fromLibrary: true });
  }
  window.HDRLibraryHost = Object.freeze({ isDetached: () => detached, openDrop, preparePaste, dispatch });
  const away = document.createElement("div"); away.className = "library-away"; away.hidden = true;
  away.innerHTML = '<p>Library is open in its own window.</p><button class="button-secondary">Show Library</button>';
  frame.after(away); away.querySelector("button").addEventListener("click", () => desktop?.focusLibrary());
  desktop?.onLibraryWindowChanged(message => {
    if (message.action === "prepare-paste") {
      preparePaste(message.paths).then(allowed => desktop.completeLibraryPaste(message.requestId, allowed))
        .catch(() => desktop.completeLibraryPaste(message.requestId, false));
    } else if (["command-state", "grade-replaced", "quick-export", "export-selection"].includes(message.action)) {
      libraryAction(message).catch(error => showUploadError(error.message));
    } else if (message.action === "docked") {
      detached = false; away.hidden = true; frame.hidden = false;
      send("restore", { state: message.state }); activateWorkflowTab("import"); sync();
    } else if (message.action === "choose-source") requestSourceImport();
  });
  const send = (action, detail = {}) => frame.contentWindow?.postMessage({ type: "hdr-library-host", action, ...detail }, location.origin);
  function sync() {
    updateCommands();
    const active = state.activeWorkflow === "import" && !detached;
    away.hidden = !detached || state.activeWorkflow !== "import";
    if (detached && state.activeWorkflow === "import") desktop?.focusLibrary();
    for (const element of document.querySelectorAll(".app-shell > .source-rail, .app-shell > .source-splitter, .app-shell > .workspace-main, .app-shell > .grade-rail, .app-shell > .grade-splitter")) element.inert = active || Boolean(state.gradeOpen && element.matches(".source-rail, .grade-rail"));
    send("theme", { theme: document.documentElement.dataset.theme });
    send("active", { enabled: active });
    if (active) frame.contentWindow?.focus();
    // Leaving the Library must take keyboard focus back, or editor shortcuts
    // keep going to the hidden Library page.
    else if (document.activeElement === frame) frame.blur();
  }
  new MutationObserver(() => send("theme", { theme: document.documentElement.dataset.theme })).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
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
    else if (["command-state", "grade-replaced", "quick-export", "export-selection"].includes(message.action)) libraryAction(message).catch(error => showUploadError(error.message));
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
      const request = ++openRequest;
      // Use the existing grant and leave-photo gate, including Cancel/Save/Discard.
      (async () => {
        await reviewQueue;
        if (request !== openRequest) return;
        if (!desktop) throw new Error("Opening a library path in Grade requires the desktop app.");
        const selection = await desktop.grantSourcePath(message.path);
        if (request !== openRequest) return;
        await openDesktopSelection({ kind: "source", ...selection, itemKey: message.itemKey, fromLibrary: true, clickedAt: message.clickedAt, isCurrent: () => request === openRequest });
      })().catch((error) => showUploadError(error.message));
    }
  });
  window.addEventListener("hdrfinisher:workflowchange", sync);
})();
