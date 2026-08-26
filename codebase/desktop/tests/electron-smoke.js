const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

async function main() {
  const checkpoint = (label) => process.stdout.write(`[electron-smoke] ${label}\n`);
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
  const userDataPath = fs.mkdtempSync(path.join(outputDirectory, "user-data-"));
  fs.writeFileSync(path.join(userDataPath, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    defaultReferenceWhiteNits: 203,
    renderingMode: "auto",
    folders: { projectSave: outputDirectory, projectImport: outputDirectory, fileSave: "", fileImport: "", presetSave: "" },
    shortcuts: {},
    shortcutPresets: {},
    updates: { checkAutomatically: false, dismissedVersion: "" },
  }));
  fs.rmSync(projectPath, { force: true });
  fs.rmSync(exportPath, { force: true });

  const defaultPackagedExecutable = process.platform === "darwin"
    ? path.join(codebase, "dist-electron", "mac-arm64", "HDR Finisher.app", "Contents", "MacOS", "HDR Finisher")
    : path.join(codebase, "dist-electron", "win-unpacked", "HDR Finisher.exe");
  const packagedExecutable = process.env.HDR_FINISHER_PACKAGED_EXECUTABLE || defaultPackagedExecutable;
  const executablePath = packaged ? packagedExecutable : electronExecutable;
  // The smoke runner may execute inside a nested Windows/Linux sandbox where
  // Chromium's own process sandbox cannot initialize. This switch is confined
  // to test launches and is never applied by the packaged application itself.
  const launchArgs = packaged ? ["--no-sandbox"] : ["--no-sandbox", "."];
  const electronApp = await electron.launch({
    executablePath,
    args: launchArgs,
    cwd: desktopDirectory,
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userDataPath, HDR_FINISHER_DISABLE_GPU: "1" },
  });
  try {
    const window = await electronApp.firstWindow();
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    checkpoint("window ready");
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
    const initialNativeTitle = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const deadline = Date.now() + 30000;
      let title = "";
      while (Date.now() < deadline) {
        title = BrowserWindow.getAllWindows()[0]?.getTitle() || "";
        if (title === "Untitled — HDR Finisher") break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return title;
    });
    assert.equal(initialNativeTitle, "Untitled — HDR Finisher");
    assert.equal(await window.evaluate(() => typeof window.require), "undefined");
    const environment = await window.evaluate(() => window.hdrFinisherDesktop.environment());
    assert.equal(environment.apiVersion, 1);
    assert.equal(environment.packaged, packaged);
    const frontendSource = await window.evaluate(() => fetch("/static/app.js").then((response) => response.text()));
    assert.match(frontendSource, /Windows shell integrations and catalog applications/);
    assert.doesNotMatch(frontendSource, /That dropped file type is not supported by HDR Finisher/);

    await window.locator("#settings-open").click();
    await window.locator("#settings-dialog").waitFor({ state: "visible" });
    assert.equal(await window.locator(".top-actions #hdr-reference-white").count(), 0);
    await window.locator("#hdr-reference-white").selectOption("100");
    await window.waitForFunction(async () => (await window.hdrFinisherDesktop.getPreferences()).defaultReferenceWhiteNits === 100);
    await window.locator("#hdr-reference-white").selectOption("203");
    await window.waitForFunction(async () => (await window.hdrFinisherDesktop.getPreferences()).defaultReferenceWhiteNits === 203);
    assert.ok(await window.locator(".shortcut-row").count() > 100, "settings should expose application and continuous-control commands");
    await window.locator('[data-settings-tab="locations"]').click();
    const defaultPresetDirectory = await window.evaluate(() => window.hdrFinisherDesktop.getDefaultPresetDirectory());
    assert.equal(await window.locator("#settings-folder-presetSave").inputValue(), defaultPresetDirectory);
    assert.equal(fs.existsSync(path.join(defaultPresetDirectory, "Keyboard Shortcuts")), true);
    assert.equal(fs.existsSync(path.join(defaultPresetDirectory, "Grading")), true);
    await window.locator('[data-settings-tab="shortcuts"]').click();
    assert.equal(await window.locator(".shortcut-hardware-note strong").count(), 0);
    assert.match(await window.locator(".shortcut-hardware-note").textContent(), /Shift or Alt\/Option makes an adjustment 10× finer/);
    const analysisShortcut = window.locator(".shortcut-row").filter({ hasText: "Toggle analysis panel" }).first();
    assert.equal(await analysisShortcut.locator(".shortcut-record").textContent(), "Not assigned");
    const screenshotShortcutPrevented = await window.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "4",
        code: "Digit4",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(screenshotShortcutPrevented, false, "macOS screenshot shortcuts should pass through untouched");
    await window.locator("#shortcut-search").fill("hdr.exposure");
    const exposureIncrease = window.locator(".shortcut-row").filter({ hasText: "Increase Exposure" }).first();
    await exposureIncrease.locator(".shortcut-record").click();
    await window.keyboard.press("i");
    const savedPreferences = await window.evaluate(() => window.hdrFinisherDesktop.getPreferences());
    assert.equal(savedPreferences.shortcuts["control:hdr.exposure:increase"], "I");
    await window.locator("#settings-close").click();
    for (const modifier of ["Control", "Meta", "Alt", "Shift"]) {
      await window.keyboard.press(modifier);
      assert.equal(await window.locator("#directory-browser").getAttribute("open"), null, `${modifier} alone must not open Import`);
    }
    const shortcutModifierContract = await window.evaluate((platform) => {
      const dispatch = (options) => {
        const event = new KeyboardEvent("keydown", { key: ",", code: "Comma", bubbles: true, cancelable: true, ...options });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      return platform === "darwin"
        ? { primary: dispatch({ metaKey: true }), nonPrimary: dispatch({ ctrlKey: true }) }
        : { primary: dispatch({ ctrlKey: true }), nonPrimary: dispatch({ metaKey: true }) };
    }, environment.platform);
    assert.equal(shortcutModifierContract.primary, true, "the platform primary modifier should activate Mod shortcuts");
    assert.equal(shortcutModifierContract.nonPrimary, false, "the non-primary OS modifier must not impersonate Mod");
    await window.locator("#settings-dialog").waitFor({ state: "visible" });
    await window.locator("#settings-close").click();

    await window.locator("#help-open").click();
    await window.locator("#help-document h1").waitFor({ state: "visible" });
    assert.equal(await window.locator("#help-document h1").textContent(), "Five-Minute Quick Start");
    await window.locator("#help-search").fill("reference white");
    await window.waitForFunction(() => document.querySelector("#help-document h1")?.textContent.includes("result"));
    assert.ok(await window.locator(".help-search-result").count() > 0);
    await window.locator("#help-close").click();

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

    const referenceWhiteContract = await window.evaluate(() => ({
      selected: document.querySelector("#hdr-reference-white")?.value,
      bandAnchor: document.querySelector("#false-color-band-anchor")?.value,
      ceiling: document.querySelector("#false-color-ceiling")?.value,
      preflight: document.querySelector("#export-reference-white")?.textContent,
    }));
    assert.deepEqual(referenceWhiteContract, {
      selected: "203",
      bandAnchor: "project",
      ceiling: "1000",
      preflight: "HDR reference white: 203 nits",
    });

    await window.locator("#file-input").setInputFiles(sourcePath);
    await window.waitForFunction(() => document.querySelector("#session-name")?.textContent.includes("sdr_gradient.png"));
    checkpoint("uploaded source ready");
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
    checkpoint("filesystem drop ready");
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
    checkpoint("pathless drop ready");
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
    checkpoint("staged desktop open returned");
    await window.waitForFunction(
      (expectedName) => document.querySelector("#session-name")?.textContent.includes(expectedName),
      pathlessDropName,
      { timeout: 30000 },
    );
    checkpoint("staged desktop session visible");
    const importedExrMetadata = await window.evaluate(() => ({
      source: state.session.source,
      metadata: state.session.metadata,
    }));
    assert.equal(importedExrMetadata.source.suffix, ".exr");
    // Phase timings are deliberately per-run telemetry; the staged desktop
    // path should otherwise produce the same source and interpretation data.
    if (droppedExrMetadata.metadata?.extra) delete droppedExrMetadata.metadata.extra.import_timings_ms;
    if (importedExrMetadata.metadata?.extra) delete importedExrMetadata.metadata.extra.import_timings_ms;
    assert.deepEqual(importedExrMetadata, droppedExrMetadata);
    checkpoint("staged desktop metadata verified");
    const exposureBeforeShortcut = await window.locator("#hdr-exposure").inputValue();
    await window.keyboard.press("i");
    await window.waitForFunction(
      (previous) => Math.abs(Number(document.querySelector("#hdr-exposure")?.value) - (Number(previous) + 0.05)) < 1e-8,
      exposureBeforeShortcut,
    );
    await window.keyboard.press("Shift+i");
    const exposureAfterShortcuts = Number(exposureBeforeShortcut) + 0.055;
    await window.waitForFunction(
      (expected) => Math.abs(Number(document.querySelector("#hdr-exposure")?.value) - expected) < 1e-8,
      exposureAfterShortcuts,
    );
    assert.equal(await window.locator("#grade-modified-summary").textContent(), "");
    assert.equal(await window.locator('[data-modified-count="hdr-tone"]').textContent(), "");
    assert.ok((await window.locator('[data-group="hdr-tone"]').getAttribute("class")).includes("modified"));
    assert.equal(await window.locator('[data-group="hdr-tone"] .group-reset').isVisible(), true);
    await window.locator('[data-group="hdr-tone"] .group-preset').click();
    await window.locator("#group-preset-dialog").waitFor({ state: "visible" });
    await window.locator("#group-preset-name").fill("Smoke Tone Match");
    await window.locator("#group-preset-save").click();
    const savedToneRow = window.locator(".group-preset-row").filter({ hasText: "Smoke Tone Match" });
    await savedToneRow.waitFor({ state: "visible" });
    assert.equal(await savedToneRow.getByRole("button", { name: "Delete" }).isVisible(), true);
    const savedTonePresets = await window.evaluate(() => window.hdrFinisherDesktop.listGradingPresets("hdr-tone"));
    assert.equal(savedTonePresets.length, 1);
    assert.equal(savedTonePresets[0].recipeVersion, 1);
    assert.equal(savedTonePresets[0].values["hdr.exposure"], exposureAfterShortcuts);
    await window.locator("#group-preset-close").click();
    await window.evaluate(() => {
      commitAdjustmentValue("hdr.exposure", 1.25);
      commitAdjustmentValue("hdr.saturation", 0.4);
    });
    await window.locator('[data-group="hdr-tone"] .group-preset').click();
    await window.locator(".group-preset-row").filter({ hasText: "Smoke Tone Match" }).getByRole("button", { name: "Apply" }).click();
    assert.equal(Number(await window.locator("#hdr-exposure").inputValue()), exposureAfterShortcuts);
    assert.equal(Number(await window.locator("#hdr-saturation").inputValue()), 0.4, "a Tone preset must not alter Color controls");
    assert.equal(await window.locator("#film-reference-model").count(), 0);
    await window.locator('[data-group="film-look"] .group-preset').click();
    assert.equal(await window.locator(".group-preset-row.built-in").count(), 4);
    assert.equal(await window.locator(".group-preset-row.built-in").getByRole("button", { name: "Delete" }).count(), 0);
    const cleanCinemaRow = window.locator(".group-preset-row.built-in").filter({ hasText: "Clean Cinema" });
    assert.match(await cleanCinemaRow.textContent(), /Fine texture, restrained density/);
    await cleanCinemaRow.getByRole("button", { name: "Apply" }).click();
    const appliedFilmModel = await window.evaluate(() => state.adjustments.hdr.film_look);
    assert.equal(appliedFilmModel.reference_model, "custom");
    assert.equal(appliedFilmModel.print_strength, 42);
    assert.equal(appliedFilmModel.grain_amount, 14);
    assert.deepEqual(Object.keys(appliedFilmModel).sort(), Object.keys(await window.evaluate(() => defaultFilmLook())).sort());

    await window.evaluate(() => { saveProjectToPath({ saveAs: true }); });
    await window.locator("#directory-browser").waitFor({ state: "visible" });
    assert.equal(await window.locator("#directory-browser").getAttribute("data-mode"), "project_save");
    assert.equal(await window.locator("#directory-browser-filename").inputValue(), "blender_linear_rec2020.hdrfinisher");
    await window.locator("#directory-browser-filename").fill("electron-smoke.hdrfinisher");
    await window.locator("#directory-browser-select").click();
    await window.locator("#directory-browser").waitFor({ state: "hidden" });
    checkpoint("project save returned");
    await window.waitForFunction(() => document.querySelector("#badge")?.textContent.includes("Project saved"));
    checkpoint("project saved");
    assert.equal(fs.existsSync(projectPath), true);
    const savedProject = await window.evaluate(() => state.editDocument);
    assert.equal(savedProject.schema_version, 3);
    assert.equal(savedProject.hdr_reference_white_nits, 203);
    assert.equal(savedProject.global_adjustments.shared.false_color_band_anchor, "project");
    assert.equal(savedProject.global_adjustments.shared.false_color_ceiling_nits, 1000);
    assert.equal(Object.hasOwn(savedProject.global_adjustments.shared, "overlay_preset"), false);
    assert.match(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), /electron-smoke\.hdrfinisher/);
    await window.locator("#project-open").click();
    await window.locator("#directory-browser").waitFor({ state: "visible" });
    assert.equal(await window.locator("#directory-browser").getAttribute("data-mode"), "project_open");
    const savedProjectRow = window.locator(".directory-browser-entry.supported").filter({ hasText: "electron-smoke.hdrfinisher" });
    await savedProjectRow.waitFor({ state: "visible" });
    assert.equal(await savedProjectRow.count(), 1);
    await window.locator("#directory-browser-cancel").click();
    await window.locator("#directory-browser").waitFor({ state: "hidden" });

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, exportPath);
    await window.evaluate(async () => {
      const choice = document.querySelector("#export-format");
      choice.value = "sdr_png";
      choice.dispatchEvent(new Event("change", { bubbles: true }));
      await exportCurrentSession();
    });
    await window.waitForFunction(() => document.querySelector("#export-result-path")?.textContent.endsWith("electron-smoke.png"));
    checkpoint("export ready");
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
