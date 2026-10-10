/* The only bridge from the independent Library page into editor state. */
(() => {
  const frame = document.getElementById("library-frame");
  let reviewQueue = Promise.resolve(), restoreWindow = false;
  const send = (action, detail = {}) => frame.contentWindow?.postMessage({ type: "hdr-library-host", action, ...detail }, location.origin);
  function sync() {
    const active = state.activeWorkflow === "import";
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
