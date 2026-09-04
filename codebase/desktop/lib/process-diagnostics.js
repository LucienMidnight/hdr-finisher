const fs = require("node:fs");
const path = require("node:path");

// Lives in the main process: a renderer cannot report its own fatal exit.
function installProcessDiagnostics({ app, crashReporter, dialog, shell, isShuttingDown, getDocumentState, onRendererGone, quit }) {
  const logPath = path.join(app.getPath("userData"), "logs", "desktop.log");
  function record(event, details = {}) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        pid: process.pid,
        uptimeSeconds: process.uptime(),
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron || null,
        event,
        ...details,
      })}\n`);
    } catch (error) {
      // Diagnostics must not turn an otherwise recoverable failure into a
      // main-process crash (for example, when the disk is full).
      console.error("Could not write desktop diagnostics:", error.message);
    }
  }

  try {
    // Local dumps only; no submit URL or network upload. Start before any
    // BrowserWindow so Crashpad can observe its renderer from creation.
    crashReporter.start({ uploadToServer: false });
  } catch (error) {
    record("crash-reporter-start-failed", { message: error.message });
  }
  record("desktop-started");
  app.on("child-process-gone", (_event, details) => {
    record("child-process-gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  function attachWindow(window) {
    let failure = null;
    let pendingDialog = null;
    async function showFailure() {
      if (!failure || window.isDestroyed() || isShuttingDown()) return;
      if (pendingDialog) return pendingDialog;
      const dirty = getDocumentState().dirty;
      const options = {
        type: "error",
        title: "HDR Finisher interface stopped",
        message: "The application interface stopped unexpectedly.",
        detail: `${dirty
          ? "There are unsaved changes. Keep the application open to preserve the running backend session. Saving through the interface is unavailable."
          : "The window can still move or minimize, but its editing controls are unavailable."}
\nFailure: ${failure.reason || "unknown"} (exit code ${failure.exitCode ?? "unknown"}).
\nDiagnostics: ${logPath}`,
        buttons: ["Keep Open", "Open Logs", dirty ? "Quit Without Saving" : "Quit"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      pendingDialog = (async () => {
        try {
          const { response } = await dialog.showMessageBox(window, options);
          if (window.isDestroyed() || isShuttingDown()) return;
          if (response === 1) shell.showItemInFolder(logPath);
          if (response === 2) await quit();
        } catch (error) {
          record("renderer-failure-dialog-error", { message: error.message });
        }
      })();
      try { await pendingDialog; } finally { pendingDialog = null; }
    }

    window.webContents.on("render-process-gone", (_event, details) => {
      record("render-process-gone", { reason: details.reason, exitCode: details.exitCode });
      if (isShuttingDown() || window.isDestroyed()) return;
      failure = { reason: details.reason, exitCode: details.exitCode };
      onRendererGone();
      // Do not reload or close automatically: the backend may still contain
      // unsaved edits and this shell does not yet support reconnecting them.
      void showFailure();
    });
    window.on("unresponsive", () => record("window-unresponsive"));
    window.on("responsive", () => record("window-responsive"));
    return { hasFailed: () => failure !== null, showFailure };
  }
  return { attachWindow, logPath };
}

module.exports = { installProcessDiagnostics };
