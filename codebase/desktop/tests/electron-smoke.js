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
  const pathlessDropPath = process.env.HDR_FINISHER_DROP_FIXTURE
    || path.join(codebase, "tests", "fixtures", "blender_linear_rec2020.exr");
  const pathlessDropName = path.basename(pathlessDropPath);
  const outputDirectory = path.join(codebase, "output", "electron-smoke");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const projectPath = path.join(outputDirectory, "electron-smoke.hdrfinisher");
  const exportPath = path.join(outputDirectory, "electron-smoke.png");
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finisher-smoke-"));
  fs.rmSync(projectPath, { force: true });
  fs.rmSync(exportPath, { force: true });

  const defaultPackagedExecutable = process.platform === "darwin"
    ? path.join(codebase, "dist-electron", "mac-arm64", "HDR Finisher.app", "Contents", "MacOS", "HDR Finisher")
    : path.join(codebase, "dist-electron", "win-unpacked", "HDR Finisher.exe");
  const packagedExecutable = process.env.HDR_FINISHER_PACKAGED_EXECUTABLE || defaultPackagedExecutable;
  const executablePath = packaged ? packagedExecutable : electronExecutable;
  const launchArgs = packaged ? [] : ["."];
  const electronApp = await electron.launch({
    executablePath,
    args: launchArgs,
    cwd: desktopDirectory,
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userDataPath, HDR_FINISHER_DISABLE_GPU: "1" },
  });
  try {
    const window = await electronApp.firstWindow();
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
    await window.waitForFunction(() => document.querySelector(".app-shell")?.classList.contains("compact-workspace"));
    const compactLayout = await window.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      sourceCollapsed: document.querySelector(".source-rail")?.classList.contains("collapsed"),
      gradeWidth: document.querySelector(".grade-rail")?.getBoundingClientRect().width,
      dockCollapsed: document.querySelector("#analysis-dock")?.classList.contains("collapsed"),
    }));
    assert.ok(compactLayout.horizontalOverflow <= 0);
    assert.equal(compactLayout.sourceCollapsed, true);
    assert.ok(compactLayout.gradeWidth >= 300);
    assert.equal(compactLayout.dockCollapsed, false);
    assert.equal(await window.title(), "HDR Finisher");
    assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), "Untitled — HDR Finisher");
    assert.equal(await window.evaluate(() => typeof window.require), "undefined");
    const environment = await window.evaluate(() => window.hdrFinisherDesktop.environment());
    assert.equal(environment.apiVersion, 1);
    assert.equal(environment.packaged, packaged);
    const frontendSource = await window.evaluate(() => fetch("/static/app.js").then((response) => response.text()));
    assert.match(frontendSource, /Windows shell integrations and catalog applications/);
    assert.doesNotMatch(frontendSource, /That dropped file type is not supported by HDR Finisher/);

    const backendOrigin = new URL(window.url()).origin;
    const unauthorized = await fetch(`${backendOrigin}/api/capabilities`);
    assert.equal(unauthorized.status, 401);
    assert.equal(await window.evaluate(() => fetch("/api/capabilities").then((response) => response.status)), 200);
    const capabilities = await window.evaluate(() => fetch("/api/capabilities").then((response) => response.json()));
    if (packaged) {
      const capabilityMap = capabilities.capabilities;
      for (const key of ["avif_encoder", "avif_decoder", "avif_gain_map_tool", "ultrahdr_encoder", "ultrahdr_decoder"]) {
        assert.equal(capabilityMap[key]?.status, "available", `${key} should be bundled in the macOS package`);
      }
    }

    await window.locator("#file-input").setInputFiles(sourcePath);
    await window.waitForFunction(() => document.querySelector("#session-name")?.textContent.includes("sdr_gradient.png"));
    const initialSessionId = await window.evaluate(() => state.session.session_id);
    await window.evaluate(() => {
      const file = document.querySelector("#file-input").files[0];
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector(".rail-title-row").dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    });
    await window.waitForFunction((previousId) => state.session?.session_id !== previousId, initialSessionId);
    await window.evaluate(() => ejectCurrentSession());
    await window.waitForFunction(() => !state.session);

    await window.locator("#file-input").setInputFiles(pathlessDropPath);
    await window.evaluate(async () => {
      const selected = document.querySelector("#file-input").files[0];
      const pathlessFile = new File([await selected.arrayBuffer()], selected.name, { type: selected.type });
      const transfer = new DataTransfer();
      transfer.items.add(pathlessFile);
      document.querySelector(".rail-title-row").dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    });
    await window.waitForFunction(
      (expectedName) => document.querySelector("#session-name")?.textContent.includes(expectedName),
      pathlessDropName,
      { timeout: 120000 },
    );
    const droppedExrMetadata = await window.evaluate(() => ({
      source: state.session.source,
      metadata: state.session.metadata,
    }));
    await window.evaluate(() => ejectCurrentSession());
    await window.waitForFunction(() => !state.session);

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, pathlessDropPath);
    await window.evaluate(async () => {
      const selection = await window.hdrFinisherDesktop.openSource();
      await openDesktopSelection({ kind: "source", ...selection });
    });
    await window.waitForFunction((expectedName) => document.querySelector("#session-name")?.textContent.includes(expectedName), pathlessDropName);
    const importedExrMetadata = await window.evaluate(() => ({
      source: state.session.source,
      metadata: state.session.metadata,
    }));
    assert.equal(importedExrMetadata.source.suffix, ".exr");
    assert.deepEqual(importedExrMetadata, droppedExrMetadata);

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

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, exportPath);
    const confirmCount = await window.evaluate(async () => {
      let calls = 0;
      const originalConfirm = window.confirm;
      window.confirm = () => { calls += 1; return true; };
      try { await exportCurrentSession(); } finally { window.confirm = originalConfirm; }
      return calls;
    });
    assert.equal(confirmCount, 0, "native overwrite approval must not trigger a second frontend confirmation");

    await electronApp.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    const beforeCancel = fs.readFileSync(exportPath);
    await window.evaluate(() => exportCurrentSession());
    assert.deepEqual(fs.readFileSync(exportPath), beforeCancel);

    const nativeTitle = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
    process.stdout.write(JSON.stringify({ environment, projectPath, exportPath, title: nativeTitle, capabilities }) + "\n");
  } finally {
    if (process.platform === "darwin") {
      await electronApp.evaluate(({ app }) => app.quit());
    }
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
