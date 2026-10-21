// A DOM-ready page may still belong to Electron's pending loadURL promise.
async function waitForInitialLoad(app, page) {
  await page.waitForURL(url => /^https?:$/.test(url.protocol), { waitUntil: "load", timeout: 180000 });
  await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL?.()?.includes("gpu-delivery.html")).webContents;
    if (contents.isLoadingMainFrame()) {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          contents.removeListener("did-finish-load", finish);
          contents.removeListener("did-fail-load", fail);
        };
        const finish = () => { cleanup(); resolve(); };
        const fail = (_event, code, description, _url, mainFrame) => {
          if (!mainFrame) return;
          cleanup(); reject(new Error(`Initial app load failed: ${description} (${code})`));
        };
        contents.once("did-finish-load", finish);
        contents.on("did-fail-load", fail);
      });
    }
    // Let the app's awaiting loadURL continuation finish before returning.
    await new Promise(resolve => setImmediate(resolve));
  });
}
module.exports = { waitForInitialLoad };
