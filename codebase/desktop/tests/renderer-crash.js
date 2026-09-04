// Deliberately crashes only the renderer of an isolated source-test instance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function main() {
  const desktopDirectory = path.resolve(__dirname, "..");
  const root = path.resolve(desktopDirectory, "../output/renderer-crash-test");
  fs.mkdirSync(root, { recursive: true });
  const userData = fs.mkdtempSync(path.join(root, "user-data-"));
  fs.writeFileSync(path.join(userData, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1, updates: { checkAutomatically: false }, renderingMode: "cpu",
  }));
  const instance = await electron.launch({
    executablePath: process.env.HDR_FINISHER_TEST_ELECTRON || require("electron"),
    // Match electron-smoke.js: Chromium's sandbox cannot initialize inside
    // some nested test sandboxes. This affects only this disposable launch.
    args: ["--no-sandbox", "."],
    cwd: desktopDirectory,
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userData, HDR_FINISHER_DISABLE_GPU: "1" },
  });
  try {
    const runtime = await instance.evaluate(({ app }) => ({
      userData: app.getPath("userData"), appPath: app.getAppPath(),
    }));
    assert.equal(runtime.appPath, desktopDirectory);
    assert.equal(runtime.userData, userData, "the crash test must use its disposable profile");
    console.log(JSON.stringify({ runtime, requestedUserData: userData }));
    const page = await instance.firstWindow();
    await page.waitForSelector("#empty-import-button", { timeout: 60000 });
    // A crash during loadURL is a startup failure, handled by a different
    // dialog. Exercise the running-app failure after startup has settled.
    await page.waitForLoadState("networkidle");
    const backendUrl = new URL(page.url()).origin;
    await page.evaluate(() => window.hdrFinisherDesktop.setDocumentState({ dirty: true, displayName: "Crash test" }));
    await instance.evaluate(({ BrowserWindow, dialog, crashReporter }) => {
      globalThis.crashTestDialogs = [];
      dialog.showMessageBox = async (_window, options) => {
        globalThis.crashTestDialogs.push(options);
        return { response: 0 };
      };
      if (crashReporter.getUploadToServer()) throw new Error("Crash uploads must be disabled");
      BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();
    });
    const deadline = Date.now() + 15000;
    let observed;
    do {
      observed = await instance.evaluate(({ BrowserWindow }) => ({
        dialogs: globalThis.crashTestDialogs,
        windows: BrowserWindow.getAllWindows().length,
        crashed: BrowserWindow.getAllWindows()[0]?.webContents.isCrashed(),
      }));
      if (observed.dialogs.length) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(observed.crashed, true, JSON.stringify(observed));
    assert.equal(observed.windows, 1);
    assert.equal(observed.dialogs.length, 1);
    assert.deepEqual(observed.dialogs[0].buttons, ["Keep Open", "Open Logs", "Quit Without Saving"]);
    assert.equal((await (await fetch(`${backendUrl}/health`)).json()).status, "ok");
    const log = fs.readFileSync(path.join(runtime.userData, "logs/desktop.log"), "utf8");
    assert.match(log, /render-process-gone/);
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const afterClose = await instance.evaluate(() => globalThis.crashTestDialogs);
    assert.equal(afterClose.length, 2, "close should explain the failure again instead of offering a dead Save action");
    assert.equal(afterClose[1].title, "HDR Finisher interface stopped");
    console.log(JSON.stringify({ passed: true, userData, reason: JSON.parse(log.trim().split("\n").at(-1)).reason }));
  } finally {
    // Destroy this disposable test window so normal unsaved-close protection
    // cannot leave a test process waiting for user input.
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {});
    await instance.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
