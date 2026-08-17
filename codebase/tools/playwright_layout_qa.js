const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function shellMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { width: box.width, height: box.height, x: box.x, y: box.y } : null;
    };
    const gradeTrack = document.querySelector('[data-path="hdr.exposure"]')?.getBoundingClientRect();
    const gradeRail = document.querySelector(".grade-rail")?.getBoundingClientRect();
    return {
      source: rect(".source-rail"),
      grade: rect(".grade-rail"),
      dock: rect("#analysis-dock"),
      gradeTrackWidth: gradeTrack?.width || Math.max(0, (gradeRail?.width || 0) - 140),
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      storedPreferences: Object.keys(localStorage).filter((key) => key.startsWith("hdr-finisher")),
    };
  });
}

async function compactViewportCheck(browser, url, viewport, screenshotBase) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator(".app-shell").waitFor();
    const initial = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } : null;
      };
      const visible = (selector) => {
        const element = document.querySelector(selector);
        return Boolean(element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().width > 0);
      };
      const viewer = box(".viewer-panel");
      const dockBar = document.querySelector(".dock-bar");
      const scopeHeading = document.querySelector(".scope-heading");
      const directControls = ["#compare-button", "#zoom-readout", "#zoom-fit", "#zoom-actual", "#viewer-options-toggle"].map(box);
      return {
        compact: document.querySelector(".app-shell")?.classList.contains("compact-workspace"),
        sourceCollapsed: document.querySelector(".source-rail")?.classList.contains("collapsed"),
        source: box(".source-rail"),
        workspace: box(".workspace-main"),
        grade: box(".grade-rail"),
        dock: box("#analysis-dock"),
        dockCollapsed: document.querySelector("#analysis-dock")?.classList.contains("collapsed"),
        histogram: box("#histogram"),
        viewer,
        viewerOptionsVisible: visible("#viewer-options-toggle"),
        directControlsFit: directControls.every((rect) => rect && rect.x >= viewer.x && rect.right <= viewer.right),
        dockBarFits: dockBar.scrollWidth <= dockBar.clientWidth,
        scopeHeadingFits: scopeHeading.scrollWidth <= scopeHeading.clientWidth,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    await page.locator("#source-rail-expand").click();
    const sourceOpen = await page.evaluate(() => ({
      expanded: document.getElementById("source-rail-expand")?.getAttribute("aria-expanded"),
      overlay: document.querySelector(".app-shell")?.classList.contains("source-overlay-open"),
      width: document.querySelector(".source-rail")?.getBoundingClientRect().width,
      workspaceX: document.querySelector(".workspace-main")?.getBoundingClientRect().x,
    }));
    await page.keyboard.press("Escape");
    const sourceClosed = await page.evaluate(() => ({
      expanded: document.getElementById("source-rail-expand")?.getAttribute("aria-expanded"),
      focus: document.activeElement?.id,
    }));

    await page.locator("#viewer-options-toggle").click();
    const optionsOpen = await page.evaluate(() => ({
      expanded: document.getElementById("viewer-options-toggle")?.getAttribute("aria-expanded"),
      visible: getComputedStyle(document.getElementById("viewer-options-popover")).display !== "none",
    }));
    await page.keyboard.press("Escape");
    const optionsClosed = await page.evaluate(() => ({
      expanded: document.getElementById("viewer-options-toggle")?.getAttribute("aria-expanded"),
      focus: document.activeElement?.id,
    }));

    const gate = await page.evaluate(() => {
      const element = document.getElementById("interpretation-gate");
      element.classList.remove("hidden");
      const viewer = document.querySelector(".viewer-panel").getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
      return {
        contained: rect.left >= viewer.left && rect.right <= viewer.right,
        noInternalOverflow: element.scrollWidth <= element.clientWidth,
        actionsVisible: buttons.length === 2 && buttons.every((button) => button.width > 0 && button.left >= rect.left && button.right <= rect.right),
      };
    });

    await page.locator("#dock-collapse").click();
    const dockCollapsed = await page.locator("#dock-collapse").getAttribute("aria-expanded");
    await page.locator("#dock-collapse").click();
    const dockReopened = await page.locator("#dock-collapse").getAttribute("aria-expanded");

    const ext = path.extname(screenshotBase) || ".png";
    const screenshot = screenshotBase.slice(0, -ext.length) + `-${viewport.width}x${viewport.height}${ext}`;
    await page.screenshot({ path: screenshot, fullPage: true });
    const checks = {
      compactMode: initial.compact,
      metadataCollapsed: initial.sourceCollapsed && initial.source.width === 44,
      metadataOverlay: sourceOpen.expanded === "true" && sourceOpen.overlay && sourceOpen.width === 268 && sourceOpen.workspaceX === initial.workspace.x && sourceClosed.expanded === "false" && sourceClosed.focus === "source-rail-expand",
      controlPanelVisible: initial.grade.width >= 300,
      scopesVisible: !initial.dockCollapsed && initial.histogram.width > 0 && initial.histogram.height > 0,
      scopesCollapsible: dockCollapsed === "false" && dockReopened === "true",
      scopeChromeFits: initial.dockBarFits && initial.scopeHeadingFits,
      viewerControlsFit: initial.viewerOptionsVisible && initial.directControlsFit,
      viewerOptionsAccessible: optionsOpen.expanded === "true" && optionsOpen.visible && optionsClosed.expanded === "false" && optionsClosed.focus === "viewer-options-toggle",
      interpretationGateFits: gate.contained && gate.noInternalOverflow && gate.actionsVisible,
      noHorizontalOverflow: initial.horizontalOverflow <= 0,
      noBrowserErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    return { viewport, ok: Object.values(checks).every(Boolean), checks, initial, sourceOpen, gate, screenshot, consoleErrors, pageErrors };
  } finally {
    await page.close();
  }
}

async function main() {
  const url = argValue("--url", "http://127.0.0.1:8000");
  const inputPath = argValue("--input");
  const screenshot = argValue("--screenshot", path.join("output", "design-qa", "layout-1600.png"));
  const resultPath = argValue("--result", path.join("output", "design-qa", "layout-qa.json"));
  const executablePath = edgeExecutable();
  const consoleErrors = [];
  const pageErrors = [];
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath: executablePath || undefined });
  try {
    const wideViewport = { width: 1600, height: 900 };
    const page = await browser.newPage({ viewport: wideViewport, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".app-shell").waitFor();

    const initial = await shellMetrics(page);
    await page.locator("#source-splitter").focus();
    await page.keyboard.press("ArrowRight");
    await page.locator("#grade-splitter").focus();
    await page.keyboard.press("ArrowRight");
    await page.locator("#dock-splitter").focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(180);
    const adjusted = await shellMetrics(page);

    await page.reload({ waitUntil: "networkidle" });
    const fresh = await shellMetrics(page);
    await page.locator('[data-dock-tab="technical"]').click();
    await page.reload({ waitUntil: "networkidle" });
    const tabReset = await page.evaluate(() => ({
      activeTab: document.querySelector(".dock-tab.active")?.dataset.dockTab,
      technicalVisible: !document.getElementById("technical-view")?.classList.contains("hidden"),
      storedPreferences: Object.keys(localStorage).filter((key) => key.startsWith("hdr-finisher")),
    }));
    await page.locator('[data-dock-tab="histogram"]').click();
    await page.locator("#source-splitter").dblclick();
    await page.locator("#grade-splitter").dblclick();
    await page.locator("#dock-splitter").dblclick();
    await page.waitForTimeout(180);
    const reset = await shellMetrics(page);

    const compactViewports = [
      { width: 1100, height: 720 },
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1406, height: 756 },
    ];
    const viewportMatrix = [];
    for (const viewport of compactViewports) {
      viewportMatrix.push(await compactViewportCheck(browser, url, viewport, screenshot));
    }

    await page.locator("#dock-collapse").click();
    const collapsedHeight = await page.locator("#analysis-dock").evaluate((dock) => dock.getBoundingClientRect().height);
    const collapsedState = await page.locator("#analysis-dock").evaluate((dock) => ({
      collapsed: dock.classList.contains("collapsed"),
      expanded: document.getElementById("dock-collapse")?.getAttribute("aria-expanded"),
    }));
    await page.locator("#dock-collapse").click();
    const reopenedHeight = await page.locator("#analysis-dock").evaluate((dock) => dock.getBoundingClientRect().height);

    let sliderCheck = null;
    if (inputPath) {
      await page.locator("#file-input").setInputFiles(inputPath);
      await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", { timeout: 30000 });
      const gate = page.locator("#interpretation-gate");
      if (await gate.isVisible()) await page.locator("#accept-interpretation").click();
      await page.locator("#preview-image").waitFor({ state: "visible", timeout: 120000 });
      await page.locator('[data-group="hdr-tone"] .group-toggle').click();
      const requests = [];
      page.on("request", (request) => {
        if (/\/(preview|scopes)\?/.test(request.url())) requests.push(request.url());
      });
      const slider = page.locator('[data-path="hdr.exposure"]');
      const box = await slider.boundingBox();
      if (!box) throw new Error("Exposure slider has no bounding box");
      await page.keyboard.down("Alt");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 20 });
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await page.waitForTimeout(180);
      sliderCheck = {
        value: Number(await slider.inputValue()),
        previewRequests: requests.length,
        modified: await slider.locator("xpath=ancestor::*[contains(@class,'control-row')][1]").evaluate((row) => row.classList.contains("modified")),
      };
    }

    await page.screenshot({ path: screenshot, fullPage: true });
    const checks = {
      noHorizontalOverflow: reset.horizontalOverflow <= 0,
      minimumTrackWidth: reset.gradeTrackWidth >= 180,
      keyboardResize: adjusted.source.width === initial.source.width + 8
        && adjusted.grade.width === initial.grade.width + 8
        && adjusted.dock.height === initial.dock.height + 8,
      freshStartupLayout: fresh.source.width === initial.source.width
        && fresh.grade.width === initial.grade.width
        && fresh.dock.height === initial.dock.height
        && fresh.storedPreferences.length === 0,
      tabReset: tabReset.activeTab === "histogram" && !tabReset.technicalVisible && tabReset.storedPreferences.length === 0,
      doubleClickReset: reset.source.width === 268 && reset.grade.width === 320 && reset.dock.height === 252,
      collapseToggle: collapsedState.collapsed && collapsedState.expanded === "false" && reopenedHeight === 252,
      precisionDrag: !sliderCheck || (Math.abs(sliderCheck.value) <= 0.2 && sliderCheck.value !== 0),
      previewCadence: !sliderCheck || sliderCheck.previewRequests <= 2,
      modifiedState: !sliderCheck || sliderCheck.modified,
      noBrowserErrors: consoleErrors.length === 0 && pageErrors.length === 0,
      viewportMatrix: viewportMatrix.every((entry) => entry.ok),
    };
    const result = { ok: Object.values(checks).every(Boolean), url, viewport: { ...wideViewport, deviceScaleFactor: 1 }, viewportMatrix, initial, adjusted, fresh, tabReset, reset, collapsedHeight, collapsedState, reopenedHeight, sliderCheck, checks, consoleErrors, pageErrors, screenshot };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
