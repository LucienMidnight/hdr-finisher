// Renderer load can precede Electron's did-stop-loading notification.
async function waitForInitialLoad(app, page, { timeout = 180000 } = {}) {
  await page.waitForURL(url => /^https?:$/.test(url.protocol), { waitUntil: "load", timeout });
  await app.evaluate(async ({ BrowserWindow }, timeout) => {
    const contents = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL?.()?.includes("gpu-delivery.html"))?.webContents;
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
    // Let the app's awaiting loadURL continuation finish before returning.
    await new Promise(resolve => setImmediate(resolve));
  }, timeout);
}
module.exports = { waitForInitialLoad };
