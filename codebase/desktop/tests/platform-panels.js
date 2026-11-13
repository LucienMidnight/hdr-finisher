const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hdrf-platform-test-user-data-"));
  fs.writeFileSync(path.join(profile, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1, updates: { checkAutomatically: false, dismissedVersion: "" },
  }));
  let app;
  try {
    app = await electron.launch({
      executablePath: require("electron"), args: ["."], cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile },
    });
    await app.evaluate(async ({ BrowserWindow }) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { clearInterval(interval); reject(new Error("Main window did not appear")); }, 60000);
        const interval = setInterval(() => {
          if (BrowserWindow.getAllWindows().some(window => window.isVisible()
            && /^https?:/.test(window.webContents.getURL()) && !window.webContents.getURL().includes("gpu-delivery.html"))) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve();
          }
        }, 50);
      });
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.body.dataset.ready === "true", null, { timeout: 60000 });
    await app.evaluate(({ shell }) => {
      global.platformPanelLinks = [];
      shell.openExternal = async url => { global.platformPanelLinks.push(url); };
    });
    await page.evaluate(() => window.HDRApplicationShell.openSettings("updates"));
    const releases = page.locator("#settings-open-releases");
    assert.equal(await releases.isVisible(), true);
    await releases.click();
    assert.deepEqual(await app.evaluate(() => global.platformPanelLinks), [
      "https://github.com/LucienMidnight/hdr-finisher/releases",
    ]);
    const geometry = await releases.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const panel = button.closest("[data-settings-panel]").getBoundingClientRect();
      return { inside: rect.left >= panel.left && rect.right <= panel.right,
        font: getComputedStyle(button).font,
        checkFont: getComputedStyle(document.getElementById("settings-check-updates")).font };
    });
    assert.equal(geometry.inside, true);
    assert.equal(geometry.font, geometry.checkFont);
    const warningStates = await page.evaluate(() => {
      const saved = { session: state.session, environment: state.desktopEnvironment };
      const states = [];
      try {
        state.desktopEnvironment = { ...state.desktopEnvironment, platform: "linux", nativeWayland: false };
        for (const session of [null, {}, null]) {
          state.session = session;
          renderPresentationCapability();
          states.push(els.hdrPresentationWarning.classList.contains("hidden"));
        }
      } finally {
        state.session = saved.session;
        state.desktopEnvironment = saved.environment;
        renderPresentationCapability();
      }
      return states;
    });
    assert.deepEqual(warningStates, [true, false, true]);
    console.log("PASS: Updates Releases action, panel fit and Linux photo-open warning lifecycle");
  } finally {
    if (app) await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
