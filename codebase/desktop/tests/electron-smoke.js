const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

async function presentedPreviewSnapshot(page) {
  await page.waitForFunction(() => [els.chromeProofImage, els.previewCanvas, els.previewImage].some((element) => {
    const rect = element.getBoundingClientRect();
    return getComputedStyle(element).display !== "none" && rect.width > 2 && rect.height > 2;
  }), null, { timeout: 30000 });
  return page.evaluate(() => {
    const element = [els.chromeProofImage, els.previewCanvas, els.previewImage].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return getComputedStyle(candidate).display !== "none" && rect.width > 2 && rect.height > 2;
    });
    const rect = element.getBoundingClientRect();
    const sourceWidth = element instanceof HTMLCanvasElement ? element.width : element.naturalWidth;
    const sourceHeight = element instanceof HTMLCanvasElement ? element.height : element.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(element, 0, 0, sourceWidth, sourceHeight);
    const sample = (x, y) => Array.from(context.getImageData(
      Math.round((sourceWidth - 1) * x), Math.round((sourceHeight - 1) * y), 1, 1,
    ).data.slice(0, 3));
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      corners: [sample(.08, .08), sample(.92, .08), sample(.92, .92), sample(.08, .92)],
    };
  });
}

function assertPresentedLike(actual, expected, label, colorTolerance = 35) {
  const dimensionTolerance = Math.max(3, Math.max(expected.width, expected.height) * .02);
  assert.ok(Math.abs(actual.width - expected.width) <= dimensionTolerance, `${label} width changed: ${JSON.stringify({ actual, expected })}`);
  assert.ok(Math.abs(actual.height - expected.height) <= dimensionTolerance, `${label} height changed: ${JSON.stringify({ actual, expected })}`);
  actual.corners.forEach((color, index) => {
    const distance = Math.max(...color.map((channel, channelIndex) => Math.abs(channel - expected.corners[index][channelIndex])));
    assert.ok(distance <= colorTolerance, `${label} corner ${index} changed orientation/color: ${JSON.stringify({ actual, expected, distance })}`);
  });
}

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
    await window.locator("#source-rail-expand").click();
    const compactMetadataOverlay = await window.evaluate(() => {
      const source = document.querySelector(".source-rail")?.getBoundingClientRect();
      const viewer = document.querySelector(".viewer-panel")?.getBoundingClientRect();
      const grade = document.querySelector(".grade-rail")?.getBoundingClientRect();
      const chrome = document.querySelector(".window-chrome")?.getBoundingClientRect();
      const toolbar = document.querySelector(".top-bar")?.getBoundingClientRect();
      return {
        sourceTop: source?.top,
        sourceBottom: source?.bottom,
        viewerTop: viewer?.top,
        gradeTop: grade?.top,
        expectedTop: (chrome?.height || 0) + (toolbar?.height || 0),
        viewportBottom: window.innerHeight,
      };
    });
    assert.ok(Math.abs(compactMetadataOverlay.sourceTop - compactMetadataOverlay.expectedTop) <= 0.5,
      `Compact Metadata overlay covered the Electron app toolbar: ${JSON.stringify(compactMetadataOverlay)}`);
    assert.ok(Math.abs(compactMetadataOverlay.sourceTop - compactMetadataOverlay.viewerTop) <= 0.5,
      `Compact Metadata overlay did not align with the viewer: ${JSON.stringify(compactMetadataOverlay)}`);
    assert.ok(Math.abs(compactMetadataOverlay.sourceTop - compactMetadataOverlay.gradeTop) <= 0.5,
      `Compact Metadata overlay did not align with the Control Panel: ${JSON.stringify(compactMetadataOverlay)}`);
    assert.ok(Math.abs(compactMetadataOverlay.sourceBottom - compactMetadataOverlay.viewportBottom) <= 0.5,
      `Compact Metadata overlay escaped the window bottom: ${JSON.stringify(compactMetadataOverlay)}`);
    await window.screenshot({ path: path.join(outputDirectory, "metadata-overlay-compact.png") });
    await window.keyboard.press("Escape");
    assert.equal(await window.title(), "HDR Finisher");
    const initialNativeTitle = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const deadline = Date.now() + 30000;
      let title = "";
      while (Date.now() < deadline) {
        title = BrowserWindow.getAllWindows()[0]?.getTitle() || "";
        if (title === "HDR Finisher") break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return title;
    });
    assert.equal(initialNativeTitle, "HDR Finisher");
    assert.equal(await window.locator(".window-chrome").isVisible(), true);
    const headerGeometry = await window.evaluate(() => ({
      heights: [".rail-title-row", ".viewer-bar", ".grade-header"].map((selector) => document.querySelector(selector)?.getBoundingClientRect().height),
      sourceCollapsed: document.querySelector(".source-rail")?.classList.contains("collapsed"),
      productNameHeight: document.querySelector(".product-name")?.getBoundingClientRect().height,
      productMarkHeight: document.querySelector(".product-mark")?.getBoundingClientRect().height,
    }));
    assert.deepEqual(headerGeometry.heights.slice(1), [54, 54]);
    if (!headerGeometry.sourceCollapsed) assert.equal(headerGeometry.heights[0], 54);
    assert.equal(headerGeometry.productNameHeight, headerGeometry.productMarkHeight);
    for (const [toggle, popover, screenshotName] of [
      ["#overlay-toggle", "#overlay-popover", "viewer-overlays-anchored.png"],
      ["#preview-toggle", "#preview-popover", "viewer-preview-anchored.png"],
    ]) {
      await window.locator(toggle).click();
      const anchorGeometry = await window.evaluate(([toggleSelector, popoverSelector]) => {
        const button = document.querySelector(toggleSelector)?.getBoundingClientRect();
        const panel = document.querySelector(popoverSelector)?.getBoundingClientRect();
        return {
          gap: panel?.top - button?.bottom,
          rightError: Math.abs(panel?.right - button?.right),
        };
      }, [toggle, popover]);
      assert.ok(Math.abs(anchorGeometry.gap - 6) <= 0.5, `Viewer popover was detached from its button: ${JSON.stringify(anchorGeometry)}`);
      assert.ok(anchorGeometry.rightError <= 0.5, `Viewer popover did not align to its button: ${JSON.stringify(anchorGeometry)}`);
      await window.screenshot({ path: path.join(outputDirectory, screenshotName) });
      await window.keyboard.press("Escape");
    }
    assert.equal(await window.locator(".top-actions").count(), 0);
    for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1600, 900], [1920, 1080]]) {
      await electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      await window.waitForTimeout(80);
      const layout = await window.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const source = document.querySelector(".source-rail");
        const sourceHeader = rect(".source-rail .rail-title-row");
        const sourceCollapse = rect("#source-rail-expand");
        const viewer = rect(".viewer-panel");
        const viewerBar = rect(".viewer-bar");
        const viewerLane = rect(".viewer-lane");
        const viewerTools = rect(".viewer-tools");
        return {
          viewport: [window.innerWidth, window.innerHeight],
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          chromeHeight: rect(".window-chrome")?.height,
          centerHeaderHeight: rect(".viewer-bar")?.height,
          centerWidth: viewer?.width,
          viewerToolbarFits: Boolean(viewerBar && viewerTools
            && viewerTools.left >= viewerBar.left
            && viewerTools.right <= viewerBar.right
            && document.querySelector(".viewer-tools").scrollWidth <= document.querySelector(".viewer-tools").clientWidth),
          viewerToolbarSingleRow: Boolean(viewerBar && viewerLane && viewerTools
            && Math.abs(viewerBar.height - 54) <= 0.5
            && viewerLane.width > 0
            && Math.abs((viewerTools.top + viewerTools.height / 2) - (viewerLane.top + viewerLane.height / 2)) <= 0.5),
          viewerToolbarCentered: Boolean(viewerBar && viewerLane && viewerTools
            && Math.abs((viewerTools.left + viewerTools.width / 2) - (viewerLane.right + (viewerBar.right - viewerLane.right) / 2)) <= 0.75),
          persistentViewerMenus: ["#overlay-toggle", "#preview-toggle"].every((selector) => {
            const control = rect(selector);
            return control && control.width > 0 && control.left >= viewerBar.left && control.right <= viewerBar.right;
          }),
          metadataCollapseCentered: Boolean(sourceHeader && sourceCollapse
            && Math.abs((sourceCollapse.top + sourceCollapse.height / 2) - (sourceHeader.top + sourceHeader.height / 2)) <= 0.5
            && (source?.classList.contains("collapsed")
              ? Math.abs((sourceCollapse.left + sourceCollapse.width / 2) - (sourceHeader.left + sourceHeader.width / 2)) <= 0.5
              : Math.abs(sourceHeader.right - sourceCollapse.right - 12) <= 0.5)),
          rightHeaderHeight: rect(".grade-header")?.height,
          leftHeaderHeight: source?.classList.contains("collapsed") ? null : rect(".rail-title-row")?.height,
          gradeBottom: rect(".grade-rail")?.bottom,
        };
      });
      assert.ok(layout.overflow <= 0, `Electron shell overflowed at ${width}x${height}: ${JSON.stringify(layout)}`);
      assert.equal(layout.chromeHeight, 30, `Custom chrome height changed at ${width}x${height}`);
      assert.equal(layout.viewerToolbarFits, true, `Viewer toolbar escaped beneath the Control Panel at ${width}x${height}: ${JSON.stringify(layout)}`);
      assert.equal(layout.viewerToolbarSingleRow, true, `Viewer toolbar changed rows at ${width}x${height}: ${JSON.stringify(layout)}`);
      assert.equal(layout.viewerToolbarCentered, true, `Viewer toolbar was not centered in the available header space at ${width}x${height}: ${JSON.stringify(layout)}`);
      assert.equal(layout.persistentViewerMenus, true, `Overlays or Preview disappeared at ${width}x${height}: ${JSON.stringify(layout)}`);
      assert.equal(layout.metadataCollapseCentered, true, `Metadata collapse control was not centered at ${width}x${height}: ${JSON.stringify(layout)}`);
      assert.equal(layout.centerHeaderHeight, 54, `Center header height changed at ${width}x${height}`);
      assert.equal(layout.rightHeaderHeight, 54, `Right header height changed at ${width}x${height}`);
      if (layout.leftHeaderHeight !== null) assert.equal(layout.leftHeaderHeight, 54, `Left header height changed at ${width}x${height}`);
      assert.ok(Math.abs(layout.gradeBottom - layout.viewport[1]) <= 1, `Right rail left a bottom shape/gap at ${width}x${height}: ${JSON.stringify(layout)}`);
    }
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 900));
    await window.waitForFunction(() => !document.querySelector(".app-shell")?.classList.contains("compact-workspace"));
    await window.screenshot({ path: path.join(outputDirectory, "custom-shell-full.png") });
    await window.screenshot({ path: path.join(outputDirectory, "custom-shell-top.png"), clip: { x: 0, y: 0, width: 1800, height: 138 } });
    await window.getByRole("button", { name: "File", exact: true }).click();
    await window.screenshot({ path: path.join(outputDirectory, "custom-shell-file-menu.png"), clip: { x: 0, y: 0, width: 520, height: 360 } });
    await window.keyboard.press("Escape");
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
    await window.waitForFunction(() => document.querySelector(".app-shell")?.classList.contains("compact-workspace"));
    assert.equal(await window.evaluate(() => typeof window.require), "undefined");
    const environment = await window.evaluate(() => window.hdrFinisherDesktop.environment());
    assert.equal(environment.apiVersion, 1);
    assert.equal(environment.packaged, packaged);
    const frontendSource = await window.evaluate(() => fetch("/static/app.js").then((response) => response.text()));
    assert.match(frontendSource, /Windows shell integrations and catalog applications/);
    assert.doesNotMatch(frontendSource, /That dropped file type is not supported by HDR Finisher/);

    await window.getByRole("button", { name: "File", exact: true }).click();
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
    assert.match(await window.locator(".shortcut-hardware-note").textContent(), /Ctrl.*10× finer.*Shift.*snap/i);
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

    await window.getByRole("button", { name: "Help", exact: true }).click();
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
    await window.evaluate(({ base64, name }) => {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      window.__electronSmokeSourceFile = new File([bytes], name, { type: "image/png" });
    }, { base64: fs.readFileSync(sourcePath).toString("base64"), name: path.basename(sourcePath) });
    await window.waitForFunction(() => document.querySelector("#session-name")?.textContent.includes("sdr_gradient.png"));
    checkpoint("uploaded source ready");
    const initialSessionId = await window.evaluate(() => state.session.session_id);
    await window.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(window.__electronSmokeSourceFile);
      document.querySelector(".rail-title-row").dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    });
    await window.waitForFunction((previousId) => state.session?.session_id !== previousId, initialSessionId);
    checkpoint("filesystem drop ready");

    // Geometry assertions need a clean edit-command queue. The preceding
    // upload/drop coverage intentionally replaces an active session and is a
    // separate desktop-import contract.
    await window.reload({ waitUntil: "domcontentloaded" });
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    await window.locator("#file-input").setInputFiles(sourcePath);
    await window.waitForFunction(() => document.querySelector("#session-name")?.textContent.includes("sdr_gradient.png"));
    const beforeRotation = await presentedPreviewSnapshot(window);
    checkpoint("rotation baseline captured");
    const rotationBaselineState = await window.evaluate(() => ({
      src: activePreviewElement() instanceof HTMLImageElement ? activePreviewElement().currentSrc : "canvas",
      generation: { ...state.previewGeneration },
    }));
    await window.evaluate(() => {
      els.rotateToolToggle.click();
      els.rotateRight.click();
    });
    await window.waitForTimeout(250);
    const duringRotation = await window.evaluate(() => {
      const preview = activePreviewElement();
      const rect = preview.getBoundingClientRect();
      return {
        rotation: state.adjustments.shared.geometry.rotation,
        transform: preview.style.getPropertyValue("--interactive-rotate-angle"),
        src: preview instanceof HTMLImageElement ? preview.currentSrc : "canvas",
        generation: { ...state.previewGeneration },
        width: rect.width,
        height: rect.height,
        draftOpen: Boolean(state.rotateDraftGeometry),
      };
    });
    checkpoint("rotation draft captured");
    assert.ok(
      Math.abs((duringRotation.width / duringRotation.height) - (beforeRotation.height / beforeRotation.width)) < .02,
      `Interactive clockwise rotation did not swap the presented aspect: ${JSON.stringify({ beforeRotation, duringRotation })}`,
    );
    assert.equal(duringRotation.rotation, 90);
    assert.equal(duringRotation.transform, "90deg");
    assert.equal(duringRotation.src, rotationBaselineState.src, "Rotate must not replace the preview while its draft is open");
    assert.deepEqual(duringRotation.generation, rotationBaselineState.generation, "Rotate must not schedule a settled preview before Apply");
    assert.equal(duringRotation.draftOpen, true);
    const rotateToCropCancel = await window.evaluate(() => {
      els.cropToolToggle.click();
      return {
        rotation: state.adjustments.shared.geometry.rotation,
        transform: activePreviewElement().style.getPropertyValue("--interactive-rotate-angle"),
        rotateDraftOpen: Boolean(state.rotateDraftGeometry),
        cropMode: state.cropMode,
        geometryTool: state.geometryTool,
      };
    });
    assert.deepEqual(rotateToCropCancel, {
      rotation: 0,
      transform: "",
      rotateDraftOpen: false,
      cropMode: true,
      geometryTool: "crop",
    }, "Leaving Rotate for Crop must cancel the draft");
    const cancelledRotation = await presentedPreviewSnapshot(window);
    assertPresentedLike(cancelledRotation, beforeRotation, "Cancelled Rotate -> Crop frame");
    checkpoint("rotate to crop cancellation ready");

    await window.evaluate(() => {
      closeCropMode(false);
      els.rotateToolToggle.click();
      els.rotateRight.click();
      els.rotateApply.click();
    });
    const appliedRotation = await window.evaluate(() => ({
      rotation: state.adjustments.shared.geometry.rotation,
      transform: activePreviewElement().style.getPropertyValue("--interactive-rotate-angle"),
      draftOpen: Boolean(state.rotateDraftGeometry),
      handoff: state.geometryTransformHandoffSignature,
    }));
    assert.equal(appliedRotation.rotation, 90);
    assert.equal(appliedRotation.transform, "90deg", "Apply must retain the visual draft until the committed frame presents");
    assert.equal(appliedRotation.draftOpen, false);
    assert.ok(appliedRotation.handoff, "Apply must track the committed preview handoff");
    await window.waitForFunction(() => state.geometryTransformHandoffSignature === null, null, { timeout: 30000 });
    const settledRotationPixels = await presentedPreviewSnapshot(window);
    checkpoint("rotation settled captured");
    const expectedClockwise = {
      width: settledRotationPixels.width,
      height: settledRotationPixels.height,
      corners: [beforeRotation.corners[3], beforeRotation.corners[0], beforeRotation.corners[1], beforeRotation.corners[2]],
    };
    assertPresentedLike(settledRotationPixels, expectedClockwise, "Applied clockwise rotation", 100);
    checkpoint("rotation apply ready");

    // Use a clean renderer/session for the slider case. The first case ends
    // deliberately inside Crop so its settled pixels can be observed without
    // a later UI action becoming part of the handoff assertion.
    await window.reload({ waitUntil: "domcontentloaded" });
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    await window.locator("#file-input").setInputFiles(sourcePath);
    await window.waitForFunction(() => document.querySelector("#session-name")?.textContent.includes("sdr_gradient.png"));

    const straightenBaseline = await window.evaluate(() => ({
      src: activePreviewElement() instanceof HTMLImageElement ? activePreviewElement().currentSrc : "canvas",
      generation: { ...state.previewGeneration },
    }));
    await window.evaluate(() => {
      els.rotateToolToggle.click();
      beginStraightenGesture();
      updateStraightenInteractive(11.7);
      updateStraightenInteractive(18.4);
    });
    await window.waitForTimeout(250);
    const straightenDuring = await window.evaluate(() => ({
      angle: state.adjustments.shared.geometry.straighten_angle,
      transform: activePreviewElement().style.getPropertyValue("--interactive-straighten-angle"),
      src: activePreviewElement() instanceof HTMLImageElement ? activePreviewElement().currentSrc : "canvas",
      generation: { ...state.previewGeneration },
      gestureActive: state.straightenGestureActive,
      draftOpen: Boolean(state.rotateDraftGeometry),
    }));
    checkpoint("straighten draft captured");
    assert.equal(straightenDuring.angle, 18.4);
    assert.equal(straightenDuring.transform, "-18.4deg");
    assert.equal(straightenDuring.src, straightenBaseline.src, "Pausing the held slider must not replace the preview");
    assert.deepEqual(straightenDuring.generation, straightenBaseline.generation, "The slider must not schedule a preview before Apply");
    assert.equal(straightenDuring.gestureActive, true);
    assert.equal(straightenDuring.draftOpen, true);
    await window.evaluate(() => finishStraightenGesture());
    await window.waitForTimeout(250);
    const straightenReleased = await window.evaluate(() => ({
      angle: state.adjustments.shared.geometry.straighten_angle,
      transform: activePreviewElement().style.getPropertyValue("--interactive-straighten-angle"),
      src: activePreviewElement() instanceof HTMLImageElement ? activePreviewElement().currentSrc : "canvas",
      generation: { ...state.previewGeneration },
      draftOpen: Boolean(state.rotateDraftGeometry),
    }));
    assert.deepEqual(straightenReleased, {
      angle: 18.4,
      transform: "-18.4deg",
      src: straightenBaseline.src,
      generation: straightenBaseline.generation,
      draftOpen: true,
    }, "Releasing the slider must leave the unchanged visual draft open");
    const straightenToCropCancel = await window.evaluate(() => {
      els.cropToolToggle.click();
      return {
        angle: state.adjustments.shared.geometry.straighten_angle,
        transform: activePreviewElement().style.getPropertyValue("--interactive-straighten-angle"),
        cropMode: state.cropMode,
        draftOpen: Boolean(state.rotateDraftGeometry),
      };
    });
    assert.deepEqual(straightenToCropCancel, { angle: 0, transform: "", cropMode: true, draftOpen: false });
    await window.evaluate(() => {
      closeCropMode(false);
      els.rotateToolToggle.click();
      beginStraightenGesture();
      updateStraightenInteractive(18.4);
      finishStraightenGesture();
      els.rotateApply.click();
    });
    const straightenApplied = await window.evaluate(() => ({
      angle: state.adjustments.shared.geometry.straighten_angle,
      transform: activePreviewElement().style.getPropertyValue("--interactive-straighten-angle"),
      draftOpen: Boolean(state.rotateDraftGeometry),
      handoff: state.geometryTransformHandoffSignature,
    }));
    assert.equal(straightenApplied.angle, 18.4);
    assert.equal(straightenApplied.transform, "-18.4deg");
    assert.equal(straightenApplied.draftOpen, false);
    assert.ok(straightenApplied.handoff, "Straighten must commit only when Apply is pressed");
    await window.waitForFunction(() => state.geometryTransformHandoffSignature === null, null, { timeout: 30000 });
    checkpoint("straighten slider cancellation ready");
    await window.reload({ waitUntil: "domcontentloaded" });
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });

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
    await window.keyboard.press("Control+i");
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
    assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), "HDR Finisher");
    await window.getByRole("button", { name: "File", exact: true }).click();
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
