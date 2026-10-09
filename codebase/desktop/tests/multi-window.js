const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const desktop = path.resolve(__dirname, "..");
  const output = path.resolve(desktop, "../output/multi-window");
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, "profile-"));
  const env = { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = async (secondary) => electron.launch({
    executablePath: require("electron"), args: [desktop], cwd: desktop,
    env: { ...env, HDR_FINISHER_DEV_LIBRARY_WINDOW: secondary ? "1" : "0" }, timeout: 90000,
  });
  const pages = async (app) => {
    await assertEventually(async () => app.windows().length === 2);
    const main = app.windows().find((page) => !page.url().includes("window-foundation"));
    const library = app.windows().find((page) => page.url().includes("window-foundation"));
    assert.ok(main && library);
    await main.waitForSelector("#empty-import-button", { timeout: 30000 });
    await library.waitForFunction(() => window.foundationDisplay?.currentDisplay);
    return { main, library };
  };
  let app;
  try {
    app = await launch(true);
    let { main, library } = await pages(app);
    assert.equal(new URL(main.url()).origin, new URL(library.url()).origin);
    assert.equal(await library.evaluate(() => typeof state), "undefined");
    assert.equal(await library.evaluate(() => hdrFinisherDesktop.getPreferences().then(() => false, () => true)), true);
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("window-foundation"));
      const area = screen.getPrimaryDisplay().workArea;
      window.setBounds({ x: area.x + 20, y: area.y + 20, width: 1120, height: 740 });
      return window.getNormalBounds();
    });
    // Every window's environment is selected from its own bounds.
    for (const page of [main, library]) {
      const id = await page.evaluate(async () => (await hdrFinisherDesktop.environment()).currentDisplay.id);
      const expected = await app.evaluate(({ BrowserWindow, screen }, url) =>
        screen.getDisplayMatching(BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url).getBounds()).id,
      page.url());
      assert.equal(String(id), String(expected));
    }
    const mainState = await main.evaluate(() => hdrFinisherDesktop.getWindowState());
    await library.evaluate(() => hdrFinisherDesktop.performWindowAction("toggle-maximize"));
    await library.waitForFunction(async () => (await hdrFinisherDesktop.getWindowState()).maximized);
    assert.deepEqual(await main.evaluate(() => hdrFinisherDesktop.getWindowState()), mainState);
    await library.evaluate(() => hdrFinisherDesktop.performWindowAction("toggle-maximize"));
    await library.waitForFunction(async () => !(await hdrFinisherDesktop.getWindowState()).maximized);
    await library.keyboard.press("F11");
    await library.waitForFunction(async () => (await hdrFinisherDesktop.getWindowState()).fullscreen);
    await library.keyboard.press("F11");
    await library.waitForFunction(async () => !(await hdrFinisherDesktop.getWindowState()).fullscreen);
    await library.evaluate(() => hdrFinisherDesktop.performWindowAction("close")).catch(() => {});
    await assertEventually(async () => app.windows().length === 1);
    assert.equal((await main.request.get(`${new URL(main.url()).origin}/health`)).ok(), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, "window-state-library.json"))), bounds);
    await app.close(); app = null;
    app = await launch(true);
    ({ main, library } = await pages(app));
    const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes("window-foundation")).getNormalBounds());
    assert.deepEqual(restored, bounds);
    // Cancel preserves both windows; Discard closes the app through main.
    await app.evaluate(({ dialog }) => {
      globalThis.foundationPromptCount = 0;
      dialog.showMessageBox = async () => {
        globalThis.foundationPromptCount += 1;
        return { response: globalThis.foundationPromptCount === 1 ? 2 : 1 };
      };
    });
    await main.evaluate(() => hdrFinisherDesktop.setDocumentState({ dirty: true, displayName: "F1 test" }));
    await main.evaluate(() => hdrFinisherDesktop.performWindowAction("close"));
    assert.equal(await app.evaluate(() => globalThis.foundationPromptCount), 1);
    assert.equal(app.windows().length, 2);
    const closed = app.waitForEvent("close");
    await main.evaluate(() => hdrFinisherDesktop.performWindowAction("close")).catch(() => {});
    await closed; app = null;
    app = await launch(false);
    const only = await app.firstWindow();
    await only.waitForSelector("#empty-import-button", { timeout: 30000 });
    assert.equal(app.windows().length, 1);
    console.log("PASS: second page, isolated IPC/display/window actions, independent close, saved bounds/relaunch, unsaved Cancel/Discard, main closes app, default one window.");
  } finally { if (app) await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

async function assertEventually(check) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Window condition did not become true.");
}
