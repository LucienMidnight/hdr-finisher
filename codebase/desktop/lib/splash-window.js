const path = require("path");

// The startup splash: a small black window that opens straight away and shows
// real startup steps while the main window loads hidden behind it.
function createSplashWindow({ BrowserWindow, app, icon, isShuttingDown, onVisible }) {
  const window = new BrowserWindow({
    width: 600,
    height: 300,
    useContentSize: true,
    center: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#000000",
    title: "HDR Finisher",
    icon,
    webPreferences: {
      preload: path.join(__dirname, "..", "splash", "splash-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  const steps = [];
  let loaded = false;
  let closing = false;
  const send = (step) => {
    if (loaded && !window.isDestroyed()) window.webContents.send("splash:step", step);
  };
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-finish-load", () => {
    loaded = true;
    for (const step of steps) send(step);
  });
  window.once("ready-to-show", () => {
    if (window.isDestroyed() || closing) return;
    window.show();
    onVisible?.();
  });
  // Startup cannot be cancelled from the splash; a failed start closes it.
  window.on("close", (event) => {
    if (!closing && !isShuttingDown?.()) event.preventDefault();
  });
  void window.loadFile(path.join(__dirname, "..", "splash", "splash.html"), { query: { version: app.getVersion() } })
    .catch(() => {});
  return {
    window,
    isOpen: () => !window.isDestroyed(),
    step(text, progress, until = progress) {
      const step = { text, progress, until };
      steps.push(step);
      send(step);
    },
    close() {
      closing = true;
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

module.exports = { createSplashWindow };
