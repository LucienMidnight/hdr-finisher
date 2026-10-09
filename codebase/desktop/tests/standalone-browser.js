const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const desktop = path.resolve(__dirname, "..");
  const output = path.resolve(desktop, "../output/standalone-browser");
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, "profile-"));
  const env = { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile, HDR_FINISHER_DEV_LIBRARY_BROWSER: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [desktop], cwd: desktop, env, timeout: 90000 });
  const errors = [];
  try {
    await until(() => app.windows().length === 2);
    const library = app.windows().find((page) => page.url().includes("media-browser-standalone"));
    const main = app.windows().find((page) => page !== library);
    assert.ok(library && main);
    for (const page of [main, library]) page.on("pageerror", (error) => errors.push(error.message));
    await main.waitForSelector("#empty-import-button");
    await library.waitForSelector("#directory-browser[open]");
    assert.deepEqual(await library.evaluate(() => [...document.scripts].map((s) => new URL(s.src).pathname)),
      ["/static/media-browser.js", "/static/media-browser-standalone.js"]);
    assert.equal(await library.evaluate(() => typeof state), "undefined");
    assert.equal(await library.evaluate(() => typeof els), "undefined");
    assert.equal(await library.evaluate(() => hdrFinisherDesktop.getPreferences().then(() => false, () => true)), true);
    assert.equal(await main.evaluate(() => hdrFinisherDesktop.openSourceInMain("invalid").then(() => false, () => true)), true);
    const folder = path.resolve(desktop, "../tests/fixtures");
    await library.evaluate((folder) => standaloneMediaBrowser.loadMediaDirectory(folder), folder);
    const row = library.locator(".directory-browser-entry", { hasText: "sdr_gradient.png" });
    await row.click();
    await library.locator("#directory-browser-preview").waitFor({ state: "visible", timeout: 30000 });
    assert.ok(await library.evaluate(() => document.getElementById("directory-browser-preview").naturalWidth > 0));
    // A second instance inside the editor retains its export and project callbacks.
    await main.evaluate((folder) => openMediaBrowser("export_directory", folder), folder);
    await main.locator("#directory-browser-select").click();
    assert.equal(await main.locator("#export-directory").inputValue(), folder);
    await main.evaluate((folder) => { window.projectChoice = chooseProjectPath("project_save", folder, "F4 check.hdrfinisher"); }, folder);
    await main.locator("#directory-browser-select").click();
    const project = await main.evaluate(() => window.projectChoice);
    assert.ok(project.path.endsWith("F4 check.hdrfinisher") && project.grant);
    assert.equal(fs.existsSync(project.path), false); // Selecting a destination does not write a project.
    await library.locator("#directory-browser-select").click();
    await main.waitForFunction(() => state.session?.source?.filename === "sdr_gradient.png", null, { timeout: 60000 });
    assert.equal(await library.locator("#directory-browser").isVisible(), true);
    const session = await main.evaluate(() => state.session.session_id);
    await main.evaluate(async () => {
      state.documentDirty = true;
      await desktop.setDocumentState({ dirty: true, displayName: state.session.source.filename });
    });
    await app.evaluate(({ dialog }) => {
      globalThis.browserPromptCount = 0;
      globalThis.browserPromptResponse = 2;
      dialog.showMessageBox = async () => { globalThis.browserPromptCount++; return { response: globalThis.browserPromptResponse }; };
    });
    await library.locator("#directory-browser-select").click();
    await until(() => app.evaluate(() => globalThis.browserPromptCount === 1));
    assert.equal(await main.evaluate(() => state.session.session_id), session);
    await app.evaluate(() => { globalThis.browserPromptResponse = 1; });
    await library.locator("#directory-browser-select").click();
    await main.waitForFunction((old) => state.session?.session_id !== old, session, { timeout: 60000 });
    assert.equal(await app.evaluate(() => globalThis.browserPromptCount), 2);
    await main.evaluate(async () => { state.documentDirty = false; await syncDesktopDocumentState(); });
    await library.locator("#directory-browser-close").click();
    await until(() => app.windows().length === 1);
    assert.equal((await main.request.get(`${new URL(main.url()).origin}/health`)).ok(), true);
    assert.deepEqual(errors, []);
    console.log("PASS: standalone folders and real thumbnail, no editor globals/scripts, editor export/project selection, source handoff with Cancel/Discard gate, independent close.");
  } finally { await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

async function until(check) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Condition did not become true.");
}
