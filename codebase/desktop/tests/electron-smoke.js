const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

async function main() {
  const desktopDirectory = path.resolve(__dirname, "..");
  const codebase = path.resolve(desktopDirectory, "..");
  const packaged = process.argv.includes("--packaged");
  const sourcePath = path.join(codebase, "tests", "fixtures", "sdr_gradient.png");
  const outputDirectory = path.join(codebase, "output", "electron-smoke");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const projectPath = path.join(outputDirectory, "electron-smoke.hdrfinisher");
  const exportPath = path.join(outputDirectory, "electron-smoke.png");
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finisher-smoke-"));
  fs.rmSync(projectPath, { force: true });
  fs.rmSync(exportPath, { force: true });

  const executablePath = packaged
    ? path.join(codebase, "dist-electron", "win-unpacked", "HDR Finisher.exe")
    : electronExecutable;
  const launchArgs = packaged ? [] : ["."];
  launchArgs.push("--in-process-gpu", "--disable-gpu");
  const electronApp = await electron.launch({
    executablePath,
    args: launchArgs,
    cwd: desktopDirectory,
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userDataPath, HDR_FINISHER_DISABLE_GPU: "1" },
  });
  try {
    const window = await electronApp.firstWindow();
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    assert.equal(await window.title(), "HDR Finisher");
    assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), "Untitled — HDR Finisher");
    assert.equal(await window.evaluate(() => typeof window.require), "undefined");
    const environment = await window.evaluate(() => window.hdrFinisherDesktop.environment());
    assert.equal(environment.apiVersion, 1);
    assert.equal(environment.packaged, packaged);

    const backendOrigin = new URL(window.url()).origin;
    const unauthorized = await fetch(`${backendOrigin}/api/capabilities`);
    assert.equal(unauthorized.status, 401);
    assert.equal(await window.evaluate(() => fetch("/api/capabilities").then((response) => response.status)), 200);

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, sourcePath);
    await window.evaluate(async () => {
      const selection = await window.hdrFinisherDesktop.openSource();
      await openDesktopSelection({ kind: "source", ...selection });
    });
    await window.waitForFunction(() => document.querySelector("#session-name")?.textContent.includes("sdr_gradient.png"));

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, projectPath);
    await window.evaluate(() => saveProjectToPath({ saveAs: true }));
    await window.waitForFunction(() => document.querySelector("#badge")?.textContent.includes("Project saved"));
    assert.equal(fs.existsSync(projectPath), true);
    assert.match(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), /electron-smoke\.hdrfinisher/);

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, exportPath);
    await window.evaluate(async () => {
      const choice = document.querySelector('input[name="export-format-choice"][value="sdr_png"]');
      choice.checked = true;
      choice.dispatchEvent(new Event("change", { bubbles: true }));
      await exportCurrentSession();
    });
    await window.waitForFunction(() => document.querySelector("#export-result-path")?.textContent.endsWith("electron-smoke.png"));
    assert.equal(fs.existsSync(exportPath), true);
    assert.ok(fs.statSync(exportPath).size > 0);

    const nativeTitle = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
    process.stdout.write(JSON.stringify({ environment, projectPath, exportPath, title: nativeTitle }) + "\n");
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
