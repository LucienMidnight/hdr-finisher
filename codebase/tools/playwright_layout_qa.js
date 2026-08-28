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
      const viewerBar = box(".viewer-bar");
      const viewerLane = box(".viewer-lane");
      const viewerTools = box(".viewer-tools");
      const sourceHeader = box(".source-rail .rail-title-row");
      const sourceCollapse = box("#source-rail-expand");
      const comparisonButtons = [...document.querySelectorAll(".compare-mode-button")].map((button) => button.getBoundingClientRect());
      const zoomRange = document.querySelector(".zoom-control .range-shell")?.getBoundingClientRect();
      const dockBar = document.querySelector(".dock-bar");
      const scopeHeading = document.querySelector(".dock-panel-title");
      const zoomSlider = document.querySelector("#zoom-slider");
      const productName = document.querySelector(".product-name");
      const productMark = document.querySelector(".product-mark");
      const productNameStyle = productName ? getComputedStyle(productName) : null;
      const directControls = ["#compare-button", "#zoom-readout", "#zoom-fit", "#zoom-actual", "#overlay-toggle", "#preview-toggle"].map(box);
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
        viewerBar,
        viewerLane,
        viewerTools,
        viewerMenusVisible: visible("#overlay-toggle") && visible("#preview-toggle"),
        viewerMenuLabelsFit: ["#overlay-toggle", "#preview-toggle"].every((selector) => {
          const control = document.querySelector(selector);
          return control && control.scrollWidth <= control.clientWidth && control.scrollHeight <= control.clientHeight;
        }),
        directControlsFit: directControls.every((rect) => rect && rect.x >= viewer.x && rect.right <= viewer.right),
        viewerToolbarContained: viewerTools && viewerBar
          && viewerTools.x >= viewerBar.x
          && viewerTools.right <= viewerBar.right
          && document.querySelector(".viewer-tools").scrollWidth <= document.querySelector(".viewer-tools").clientWidth,
        viewerToolbarSingleRow: Math.abs(viewerBar.height - 54) <= 0.5
          && viewerLane && viewerLane.width > 0
          && Math.abs((viewerTools.y + viewerTools.height / 2) - (viewerLane.y + viewerLane.height / 2)) <= 0.5,
        viewerControlGeometryStable: comparisonButtons.length === 5
          && comparisonButtons.every((rect) => rect.width === 22 && rect.height === 26)
          && zoomRange?.width === 60,
        metadataCollapseCentered: sourceHeader && sourceCollapse
          && Math.abs((sourceCollapse.x + sourceCollapse.width / 2) - (sourceHeader.x + sourceHeader.width / 2)) <= 0.5
          && Math.abs((sourceCollapse.y + sourceCollapse.height / 2) - (sourceHeader.y + sourceHeader.height / 2)) <= 0.5,
        dockBarFits: dockBar.scrollWidth <= dockBar.clientWidth,
        scopeHeadingFits: scopeHeading.scrollWidth <= scopeHeading.clientWidth,
        disabledZoomSolid: Boolean(zoomSlider?.disabled) && getComputedStyle(zoomSlider).opacity === "1",
        productName: productName?.textContent.trim(),
        productNameFont: productNameStyle?.fontFamily || "",
        productNameTransform: productNameStyle?.textTransform || "",
        productNameHeightMatchesMark: Boolean(productName && productMark
          && Math.abs(productName.getBoundingClientRect().height - productMark.getBoundingClientRect().height) <= 0.5),
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    await page.locator("#source-rail-expand").click();
    const sourceOpen = await page.evaluate(() => {
      const header = document.querySelector(".source-rail .rail-title-row")?.getBoundingClientRect();
      const button = document.getElementById("source-rail-expand")?.getBoundingClientRect();
      return {
        expanded: document.getElementById("source-rail-expand")?.getAttribute("aria-expanded"),
        overlay: document.querySelector(".app-shell")?.classList.contains("source-overlay-open"),
        width: document.querySelector(".source-rail")?.getBoundingClientRect().width,
        workspaceX: document.querySelector(".workspace-main")?.getBoundingClientRect().x,
        chevronCentered: Boolean(header && button
          && Math.abs((button.top + button.height / 2) - (header.top + header.height / 2)) <= 0.5),
        chevronRightInset: header && button ? header.right - button.right : null,
      };
    });
    await page.keyboard.press("Escape");
    const sourceClosed = await page.evaluate(() => ({
      expanded: document.getElementById("source-rail-expand")?.getAttribute("aria-expanded"),
      focus: document.activeElement?.id,
    }));

    await page.locator("#overlay-toggle").click();
    await page.locator("#overlay-mode").selectOption("zebra");
    const overlayOpen = await page.evaluate(() => ({
      expanded: document.getElementById("overlay-toggle")?.getAttribute("aria-expanded"),
      visible: !document.getElementById("overlay-popover")?.classList.contains("hidden"),
      label: document.getElementById("overlay-toggle")?.textContent.trim(),
      active: document.getElementById("overlay-toggle")?.classList.contains("overlay-enabled"),
      pressed: document.getElementById("overlay-toggle")?.getAttribute("aria-pressed"),
      singleLine: document.getElementById("overlay-toggle")?.getBoundingClientRect().height <= 26,
      anchorGap: document.getElementById("overlay-popover")?.getBoundingClientRect().top
        - document.getElementById("overlay-toggle")?.getBoundingClientRect().bottom,
      anchorRightError: Math.abs(document.getElementById("overlay-popover")?.getBoundingClientRect().right
        - document.getElementById("overlay-toggle")?.getBoundingClientRect().right),
    }));
    await page.keyboard.press("Escape");
    const overlayClosed = await page.evaluate(() => ({
      expanded: document.getElementById("overlay-toggle")?.getAttribute("aria-expanded"),
      focus: document.activeElement?.id,
    }));
    await page.locator("#preview-toggle").click();
    const previewOpen = await page.evaluate(() => ({
      expanded: document.getElementById("preview-toggle")?.getAttribute("aria-expanded"),
      visible: !document.getElementById("preview-popover")?.classList.contains("hidden"),
      overlayClosed: document.getElementById("overlay-popover")?.classList.contains("hidden"),
      anchorGap: document.getElementById("preview-popover")?.getBoundingClientRect().top
        - document.getElementById("preview-toggle")?.getBoundingClientRect().bottom,
      anchorRightError: Math.abs(document.getElementById("preview-popover")?.getBoundingClientRect().right
        - document.getElementById("preview-toggle")?.getBoundingClientRect().right),
    }));
    await page.keyboard.press("Escape");
    const previewClosed = await page.evaluate(() => ({
      expanded: document.getElementById("preview-toggle")?.getAttribute("aria-expanded"),
      focus: document.activeElement?.id,
    }));

    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => document.getElementById("badge")?.classList.contains("hdr-true"));
    await page.waitForFunction(() => document.getElementById("metadata-current-preview-size")?.textContent.includes("·"));
    const previewMetadata = await page.evaluate(() => {
      const value = document.getElementById("metadata-current-preview-size");
      const badge = document.getElementById("badge");
      const accentProbe = document.createElement("span");
      accentProbe.style.color = "var(--accent-strong)";
      document.body.append(accentProbe);
      const accentStrong = getComputedStyle(accentProbe).color;
      accentProbe.remove();
      return {
        text: value?.textContent || "",
        label: value?.previousElementSibling?.textContent || "",
        followsSourceSize: value?.previousElementSibling?.previousElementSibling?.previousElementSibling?.textContent === "Size",
        trueHdrUsesAccent: badge?.classList.contains("hdr-true")
          && getComputedStyle(badge).color === accentStrong,
      };
    });

    if (viewport.width === 1100) {
      await page.locator("#source-rail-expand").click();
      await page.screenshot({
        path: path.join(path.dirname(screenshotBase), "viewer-hdr-badge-purple.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    }

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
      metadataCollapseCentered: initial.metadataCollapseCentered,
      metadataOverlay: sourceOpen.expanded === "true" && sourceOpen.overlay && sourceOpen.width === 268
        && sourceOpen.workspaceX === initial.workspace.x && sourceOpen.chevronCentered
        && Math.abs(sourceOpen.chevronRightInset - 12) <= 0.5
        && sourceClosed.expanded === "false" && sourceClosed.focus === "source-rail-expand",
      controlPanelVisible: initial.grade.width >= 300,
      scopesVisible: !initial.dockCollapsed && initial.histogram.width > 0 && initial.histogram.height > 0,
      scopesCollapsible: dockCollapsed === "false" && dockReopened === "true",
      scopeChromeFits: initial.dockBarFits && initial.scopeHeadingFits,
      viewerControlsFit: initial.viewerMenusVisible && initial.viewerMenuLabelsFit && initial.directControlsFit && initial.viewerToolbarContained,
      viewerToolbarSingleRow: initial.viewerToolbarSingleRow,
      viewerControlGeometryStable: initial.viewerControlGeometryStable,
      disabledZoomSolid: initial.disabledZoomSolid,
      productLockup: initial.productName === "HDR FINISHER"
        && initial.productNameFont.includes("Gabarito")
        && initial.productNameTransform === "uppercase"
        && initial.productNameHeightMatchesMark,
      viewerMenusAccessible: overlayOpen.expanded === "true" && overlayOpen.visible
        && overlayOpen.label === "Overlays" && overlayOpen.active && overlayOpen.pressed === "true" && overlayOpen.singleLine
        && Math.abs(overlayOpen.anchorGap - 6) <= 0.5 && overlayOpen.anchorRightError <= 0.5
        && overlayClosed.expanded === "false" && overlayClosed.focus === "overlay-toggle"
        && previewOpen.expanded === "true" && previewOpen.visible && previewOpen.overlayClosed
        && Math.abs(previewOpen.anchorGap - 6) <= 0.5 && previewOpen.anchorRightError <= 0.5
        && previewClosed.expanded === "false" && previewClosed.focus === "preview-toggle",
      previewSizeInMetadata: previewMetadata.label === "Current Preview Size"
        && previewMetadata.followsSourceSize && previewMetadata.trueHdrUsesAccent
        && /\dK · (?:\d+ × \d+|Waiting|Refining…)/.test(previewMetadata.text),
      interpretationGateFits: gate.contained && gate.noInternalOverflow && gate.actionsVisible,
      noHorizontalOverflow: initial.horizontalOverflow <= 0,
      noBrowserErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    return { viewport, ok: Object.values(checks).every(Boolean), checks, initial, sourceOpen, overlayOpen, previewOpen, previewMetadata, gate, screenshot, consoleErrors, pageErrors };
  } finally {
    await page.close();
  }
}

async function desktopViewportCheck(browser, url, viewport, screenshotBase) {
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
    const metrics = await page.evaluate(() => {
      const grade = document.querySelector(".grade-rail");
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const viewer = rect(".viewer-panel");
      const viewerBar = rect(".viewer-bar");
      const viewerLane = rect(".viewer-lane");
      const viewerTools = rect(".viewer-tools");
      return {
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        gradeWidth: grade?.getBoundingClientRect().width || 0,
        gradeInternalOverflow: Math.max(0, (grade?.scrollWidth || 0) - (grade?.clientWidth || 0)),
        viewerWidth: viewer?.width || 0,
        viewerHeaderHeight: viewerBar?.height || 0,
        viewerToolbarContained: Boolean(viewerTools && viewerBar
          && viewerTools.left >= viewerBar.left
          && viewerTools.right <= viewerBar.right
          && document.querySelector(".viewer-tools").scrollWidth <= document.querySelector(".viewer-tools").clientWidth),
        viewerToolbarResponsive: Math.abs((viewerBar?.height || 0) - 54) <= 0.5
          && viewerTools && viewerLane && viewerLane.width > 0
          && Math.abs((viewerTools.top + viewerTools.height / 2) - (viewerLane.top + viewerLane.height / 2)) <= 0.5,
        viewerToolbarCenterError: viewerTools && viewerLane && viewerBar
          ? Math.abs((viewerTools.left + viewerTools.width / 2) - (viewerLane.right + (viewerBar.right - viewerLane.right) / 2))
          : Infinity,
        fontFamiliesLoaded: {
          sourceSans: document.fonts.check('12px "Source Sans 3"'),
          gabarito: document.fonts.check('12px "Gabarito"'),
          spaceMono: document.fonts.check('12px "Space Mono"'),
        },
      };
    });
    const ext = path.extname(screenshotBase) || ".png";
    const screenshot = screenshotBase.slice(0, -ext.length) + `-${viewport.width}x${viewport.height}${ext}`;
    await page.screenshot({ path: screenshot, fullPage: true });
    const checks = {
      noHorizontalOverflow: metrics.horizontalOverflow <= 0,
      controlPanelWidth: metrics.gradeWidth === 320,
      controlPanelContentFits: metrics.gradeInternalOverflow <= 0,
      viewerToolbarContained: metrics.viewerToolbarContained,
      viewerToolbarResponsive: metrics.viewerToolbarResponsive,
      viewerToolbarCentered: metrics.viewerToolbarCenterError <= 0.75,
      fontFamiliesLoaded: Object.values(metrics.fontFamiliesLoaded).every(Boolean),
      noBrowserErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    return { viewport, ok: Object.values(checks).every(Boolean), checks, metrics, screenshot, consoleErrors, pageErrors };
  } finally {
    await page.close();
  }
}

async function toolbarResizeStabilityCheck(browser, url) {
  const page = await browser.newPage({ viewport: { width: 2000, height: 720 }, deviceScaleFactor: 1 });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const samples = [];
    for (const width of [2000, 1700, 1500, 1499, 1415, 1400, 1399, 1280, 1120, 1100]) {
      await page.setViewportSize({ width, height: 720 });
      await page.waitForTimeout(40);
      samples.push(await page.evaluate((sampleWidth) => {
        const bar = document.querySelector(".viewer-bar")?.getBoundingClientRect();
        const lane = document.querySelector(".viewer-lane")?.getBoundingClientRect();
        const compare = document.querySelector("#compare-button")?.getBoundingClientRect();
        const zoomReadout = document.querySelector("#zoom-readout")?.getBoundingClientRect();
        const zoomRange = document.querySelector(".zoom-control .range-shell")?.getBoundingClientRect();
        const overlay = document.querySelector("#overlay-toggle")?.getBoundingClientRect();
        const preview = document.querySelector("#preview-toggle")?.getBoundingClientRect();
        const sourceHeader = document.querySelector(".source-rail .rail-title-row")?.getBoundingClientRect();
        const sourceCollapse = document.querySelector("#source-rail-expand")?.getBoundingClientRect();
        const sourceCollapsed = document.querySelector(".source-rail")?.classList.contains("collapsed");
        return {
          width: sampleWidth,
          barHeight: bar?.height || 0,
          laneVisible: Boolean(lane?.width),
          compareWidth: compare?.width || 0,
          zoomRangeWidth: zoomRange?.width || 0,
          toolsCenterError: bar && lane && overlay
            ? Math.abs(((compare?.left || 0) + ((preview?.right || 0) - (compare?.left || 0)) / 2) - (lane.right + (bar.right - lane.right) / 2))
            : Infinity,
          singleRow: Boolean(bar && lane && compare && overlay && preview
            && Math.abs((compare.top + compare.height / 2) - (lane.top + lane.height / 2)) <= 0.5
            && Math.abs((preview.top + preview.height / 2) - (lane.top + lane.height / 2)) <= 0.5),
          overlayLabel: document.querySelector("#overlay-toggle")?.textContent.trim(),
          previewVisible: Boolean(preview?.width),
          menuLabelsFit: ["#overlay-toggle", "#preview-toggle"].every((selector) => {
            const control = document.querySelector(selector);
            return control && control.scrollWidth <= control.clientWidth && control.scrollHeight <= control.clientHeight;
          }),
          metadataCentered: !sourceCollapsed || Boolean(sourceHeader && sourceCollapse
            && Math.abs((sourceCollapse.left + sourceCollapse.width / 2) - (sourceHeader.left + sourceHeader.width / 2)) <= 0.5
            && Math.abs((sourceCollapse.top + sourceCollapse.height / 2) - (sourceHeader.top + sourceHeader.height / 2)) <= 0.5),
        };
      }, width));
    }
    const stable = samples.every((sample) => sample.barHeight === 54
      && sample.laneVisible
      && sample.compareWidth === 22
      && sample.zoomRangeWidth >= 60
      && sample.singleRow
      && sample.toolsCenterError <= 0.75
      && sample.overlayLabel === "Overlays"
      && sample.previewVisible
      && sample.menuLabelsFit
      && sample.metadataCentered);
    return { ok: stable, samples };
  } finally {
    await page.close();
  }
}

async function accessibilityMediaCheck(browser, url, screenshotBase) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();
    await page.locator('[data-local-tool="brush"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#local-adjustment-list > li").length > 0);
    const parentSlider = page.locator("#local-exposure");
    await parentSlider.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(80);
    const metrics = await page.evaluate(() => {
      const selectedTool = document.querySelector('.local-tool-strip button[aria-pressed="true"]');
      const track = document.querySelector("#local-exposure")?.closest(".range-shell")?.querySelector(".slider-track");
      const compactShells = [...document.querySelectorAll(".slider-group-tile .compact-subrail .range-shell")]
        .filter((shell) => shell.getBoundingClientRect().height > 0);
      const checkbox = document.querySelector('.checkbox-row > input[type="checkbox"], .film-module-toggle > input[type="checkbox"], .film-map-toggle > input[type="checkbox"]');
      const selectedStyle = selectedTool ? getComputedStyle(selectedTool) : null;
      const trackStyle = track ? getComputedStyle(track) : null;
      const sliderStyle = getComputedStyle(document.querySelector("#local-exposure"));
      return {
        forcedColors: matchMedia("(forced-colors: active)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        selectedToolPressed: selectedTool?.getAttribute("aria-pressed") === "true",
        selectedToolStructured: selectedStyle?.borderTopStyle !== "none" && Number.parseFloat(selectedStyle?.borderTopWidth || "0") >= 1,
        activeElementId: document.activeElement?.id || "",
        sliderOutlineStyle: sliderStyle.outlineStyle,
        sliderOutlineWidth: sliderStyle.outlineWidth,
        trackOutlineStyle: trackStyle?.outlineStyle || "",
        sliderFocusUsesSystemOutline: document.activeElement?.id === "local-exposure"
          && trackStyle?.outlineStyle === "none"
          && sliderStyle.outlineStyle !== "none"
          && Number.parseFloat(sliderStyle.outlineWidth || "0") >= 1,
        compactHitTargetHeights: compactShells.map((shell) => shell.getBoundingClientRect().height),
        compactHitTargets: compactShells.length >= 5 && compactShells.every((shell) => shell.getBoundingClientRect().height >= 24),
        reducedToggleMotion: !checkbox || getComputedStyle(checkbox).transitionDuration.split(",").every((duration) => Number.parseFloat(duration) === 0),
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    const ext = path.extname(screenshotBase) || ".png";
    const screenshot = screenshotBase.slice(0, -ext.length) + `-forced-colors-reduced-motion${ext}`;
    await page.locator(".grade-rail").screenshot({ path: screenshot });
    const checks = {
      mediaQueriesActive: metrics.forcedColors && metrics.reducedMotion,
      selectedToolStructured: metrics.selectedToolPressed && metrics.selectedToolStructured,
      sliderFocusUsesSystemOutline: metrics.sliderFocusUsesSystemOutline,
      compactHitTargets: metrics.compactHitTargets,
      reducedToggleMotion: metrics.reducedToggleMotion,
      noHorizontalOverflow: metrics.horizontalOverflow <= 0,
      noBrowserErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    return { ok: Object.values(checks).every(Boolean), checks, metrics, screenshot, consoleErrors, pageErrors };
  } finally {
    await page.close();
  }
}

async function densityViewportCheck(browser, url, deviceScaleFactor, screenshotBase) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const metrics = await page.evaluate(() => ({
      devicePixelRatio,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      gradeWidth: document.querySelector(".grade-rail")?.getBoundingClientRect().width || 0,
      fontsLoaded: ["Source Sans 3", "Gabarito", "Space Mono"].every((family) => document.fonts.check(`12px "${family}"`)),
    }));
    const suffix = String(deviceScaleFactor).replace(".", "-");
    const ext = path.extname(screenshotBase) || ".png";
    const screenshot = screenshotBase.slice(0, -ext.length) + `-density-${suffix}${ext}`;
    await page.screenshot({ path: screenshot, fullPage: true });
    const checks = {
      requestedDensity: Math.abs(metrics.devicePixelRatio - deviceScaleFactor) < 0.01,
      noHorizontalOverflow: metrics.horizontalOverflow <= 0,
      controlPanelWidth: metrics.gradeWidth === 320,
      fontsLoaded: metrics.fontsLoaded,
    };
    return { deviceScaleFactor, ok: Object.values(checks).every(Boolean), checks, metrics, screenshot };
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
    await page.locator("#scope-mode").selectOption("technical");
    await page.reload({ waitUntil: "networkidle" });
    const tabReset = await page.evaluate(() => ({
      activeTab: document.getElementById("scope-mode")?.value,
      technicalVisible: !document.getElementById("technical-view")?.classList.contains("hidden"),
      storedPreferences: Object.keys(localStorage).filter((key) => key.startsWith("hdr-finisher")),
    }));
    await page.locator("#scope-mode").selectOption("histogram");
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
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 2560, height: 1440 }]) {
      viewportMatrix.push(await desktopViewportCheck(browser, url, viewport, screenshot));
    }
    const toolbarResizeStability = await toolbarResizeStabilityCheck(browser, url);
    const accessibilityMedia = await accessibilityMediaCheck(browser, url, screenshot);
    const densityMatrix = [];
    for (const deviceScaleFactor of [1.25, 1.5]) {
      densityMatrix.push(await densityViewportCheck(browser, url, deviceScaleFactor, screenshot));
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
      await page.keyboard.down("Control");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 20 });
      await page.mouse.up();
      await page.keyboard.up("Control");
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
      toolbarResizeStability: toolbarResizeStability.ok,
      accessibilityMedia: accessibilityMedia.ok,
      densityMatrix: densityMatrix.every((entry) => entry.ok),
    };
    const result = { ok: Object.values(checks).every(Boolean), url, viewport: { ...wideViewport, deviceScaleFactor: 1 }, viewportMatrix, toolbarResizeStability, accessibilityMedia, densityMatrix, initial, adjusted, fresh, tabReset, reset, collapsedHeight, collapsedState, reopenedHeight, sliderCheck, checks, consoleErrors, pageErrors, screenshot };
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
