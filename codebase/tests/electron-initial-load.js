// Renderer load can precede Electron's did-stop-loading notification.
async function waitForInitialLoad(app, page, { timeout = 180000 } = {}) {
  await page.waitForURL(url => /^https?:$/.test(url.protocol), { waitUntil: "load", timeout });
  await app.evaluate(async ({ BrowserWindow }, timeout) => {
    // The main window is the one on the app's own http page, not the hidden
    // GPU worker or the startup splash.
    const contents = BrowserWindow.getAllWindows().find(win => /^https?:/.test(win.webContents.getURL?.() || "") && !win.webContents.getURL().includes("gpu-delivery.html"))?.webContents;
    if (!contents) throw new Error("Initial app window disappeared.");
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        contents.removeListener("did-stop-loading", stopped);
        contents.removeListener("did-fail-load", failed);
        contents.removeListener("destroyed", destroyed);
      };
      const finish = error => { cleanup(); error ? reject(error) : resolve(); };
      const stopped = () => { if (!contents.isLoadingMainFrame()) finish(); };
      const failed = (_event, code, description, _url, mainFrame) => {
        if (mainFrame) finish(new Error(`Initial app load failed: ${description} (${code})`));
      };
      const destroyed = () => finish(new Error("Initial app window disappeared."));
      const timer = setTimeout(() => finish(new Error(`Initial app load did not stop within ${timeout} ms.`)), timeout);
      contents.on("did-stop-loading", stopped);
      contents.on("did-fail-load", failed);
      contents.on("destroyed", destroyed);
      // Register first, then check: a completed load needs no future event.
      stopped();
    });
    // Let the app's awaiting loadURL continuation finish, then wait for the
    // swap from the splash to the visible main window.
    await new Promise(resolve => setImmediate(resolve));
    const window = BrowserWindow.fromWebContents?.(contents);
    const shownBy = Date.now() + 25000;
    while (window && !window.isDestroyed() && !window.isVisible() && Date.now() < shownBy) await new Promise(resolve => setTimeout(resolve, 25));
  }, timeout);
}
async function waitForMainWindow(app, { timeout = 180000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = app.windows().find(candidate => /^(https?|file):/.test(candidate.url())
      && !candidate.url().includes("gpu-delivery.html")
      && !candidate.url().includes("/splash/splash.html"));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Initial app window did not appear within ${timeout} ms.`);
}

module.exports = { waitForInitialLoad, waitForMainWindow };
