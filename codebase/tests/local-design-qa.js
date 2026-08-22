const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const referencePath = "C:/Users/Steve/AppData/Local/Temp/codex-clipboard-e2791fc9-4e41-426d-ab81-116c2754c290.png";
const sliderReferencePath = "C:/Users/Steve/AppData/Local/Temp/codex-clipboard-9f46a2af-2a47-4eef-b590-eb7123019565.png";
const groupReferencePath = "C:/Users/Steve/AppData/Local/Temp/codex-clipboard-dd5c664c-6026-4feb-8db9-d1b614267c42.png";
const outputDir = path.resolve(__dirname, "../output/local-design-qa");
const implementationPath = path.join(outputDir, "implementation.png");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
    await page.locator("#grade-mode-local").click();

    await page.locator('[data-local-tool="brush"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#local-adjustment-list > li").length === 1);

    const stackSurface = page.locator(".local-stack-surface");
    const singleBrushScrollbar = await stackSurface.evaluate((node) => ({
      overflowY: getComputedStyle(node).overflowY,
      gutter: getComputedStyle(node).scrollbarGutter,
      webkitWidth: getComputedStyle(node, "::-webkit-scrollbar").width,
    }));
    assert(singleBrushScrollbar.overflowY === "scroll", "The scrollbar is not persistent for a single brush adjustment.");
    assert(singleBrushScrollbar.gutter.includes("stable"), "The scrollbar gutter is not stable.");
    assert(singleBrushScrollbar.webkitWidth === "9px", "The persistent scrollbar width is not applied in Edge.");

    await page.locator('[data-local-tool="linear_gradient"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#local-adjustment-list > li").length === 2);
    const firstRowBox = await page.locator("#local-adjustment-list button[data-local-id]").nth(0).boundingBox();
    const secondRowBox = await page.locator("#local-adjustment-list button[data-local-id]").nth(1).boundingBox();
    assert(secondRowBox.y - (firstRowBox.y + firstRowBox.height) <= 1, "Adjustment rows stretched apart inside the fixed viewport.");

    const panelBox = await page.locator("#local-adjustments-panel").boundingBox();
    const headingBox = await page.locator(".local-section-heading").first().boundingBox();
    const actionsBox = await page.locator(".local-stack-secondary-actions").boundingBox();
    await page.screenshot({
      path: implementationPath,
      clip: {
        x: panelBox.x,
        y: headingBox.y,
        width: panelBox.width,
        height: actionsBox.y + actionsBox.height - headingBox.y,
      },
    });

    for (const tool of ["luminance_range", "path"]) {
      await page.locator(`[data-local-tool="${tool}"]`).click();
      await page.waitForTimeout(100);
    }
    await page.locator("#local-adjustment-list button[data-local-id]").first().click();

    const removeButton = page.locator("#local-delete");
    const initialSurfaceHeight = (await stackSurface.boundingBox()).height;
    await page.locator('[data-local-tool="brush"]').click();
    for (let index = 4; index < 8; index += 1) {
      const createResponse = page.waitForResponse((response) =>
        response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
      );
      await page.locator("#local-add-adjustment").click();
      await createResponse;
      await page.waitForFunction((count) => document.querySelectorAll("#local-adjustment-list > li").length === count, index + 1);
    }
    const scrollMetrics = await stackSurface.evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowY: getComputedStyle(node).overflowY }));
    assert(scrollMetrics.scrollHeight > scrollMetrics.clientHeight && scrollMetrics.overflowY === "scroll", "The adjustment list does not use an internal scrollbar.");
    const fixedRemoveY = (await removeButton.boundingBox()).y;
    for (let targetCount = 7; targetCount >= 4; targetCount -= 1) {
      await removeButton.click();
      await page.waitForFunction((count) => document.querySelectorAll("#local-adjustment-list > li").length === count, targetCount);
      const surfaceHeight = (await stackSurface.boundingBox()).height;
      const removeY = (await removeButton.boundingBox()).y;
      assert(Math.abs(surfaceHeight - initialSurfaceHeight) < 1, "The adjustment viewport changed height while removing items.");
      assert(Math.abs(removeY - fixedRemoveY) < 1, "The minus button moved while removing items.");
    }
    await page.locator("#local-adjustment-list button[data-local-id]").nth(1).click();

    assert(await page.getByText("Brush Controls", { exact: true }).isVisible(), "Brush Controls section is missing.");
    assert(await page.getByText("Mask Controls", { exact: true }).isVisible(), "Mask Controls section is missing.");
    const localHdrStyle = await page.locator('[data-local-lane="hdr"]').evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, radius: style.borderRadius, shadow: style.boxShadow };
    });
    const globalHdrStyle = await page.locator('#view-hdr').evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, radius: style.borderRadius, shadow: style.boxShadow };
    });
    assert(JSON.stringify(localHdrStyle) === JSON.stringify(globalHdrStyle), `Local rendition tabs do not match the global tabs: ${JSON.stringify({ localHdrStyle, globalHdrStyle })}`);
    const tabGeometry = await page.locator(".local-lane-folder").evaluate((folder) => {
      const tab = folder.querySelector('[data-local-lane="hdr"]');
      const controls = folder.querySelector(".local-grade-controls");
      const folderBox = folder.getBoundingClientRect();
      const tabBox = tab.getBoundingClientRect();
      const controlsBox = controls.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        folder: { x: folderBox.x, width: folderBox.width },
        tabBottom: tabBox.bottom,
        controls: { x: controlsBox.x, y: controlsBox.y, width: controlsBox.width },
        tokens: {
          rowHeight: rootStyle.getPropertyValue("--instrument-control-row-min-h").trim(),
          trackHeight: rootStyle.getPropertyValue("--instrument-slider-track-h").trim(),
          thumbWidth: rootStyle.getPropertyValue("--instrument-slider-thumb-w").trim(),
          tabRuleWidth: rootStyle.getPropertyValue("--instrument-tab-rule-w").trim(),
        },
      };
    });
    assert(Math.abs(tabGeometry.controls.x - tabGeometry.folder.x) < 1 && Math.abs(tabGeometry.controls.width - tabGeometry.folder.width) < 1, `Local tab boundary is not full width: ${JSON.stringify(tabGeometry)}`);
    assert(Math.abs(tabGeometry.controls.y - tabGeometry.tabBottom) < 1.1, `Local tab boundary is detached from the tabs: ${JSON.stringify(tabGeometry)}`);
    assert(JSON.stringify(tabGeometry.tokens) === JSON.stringify({ rowHeight: "36px", trackHeight: "2px", thumbWidth: "2px", tabRuleWidth: "1px" }), `Instrument component tokens are missing or changed: ${JSON.stringify(tabGeometry.tokens)}`);
    await page.locator('[data-local-lane="sdr"]').click();
    await page.waitForFunction(() => document.querySelector('[data-local-lane="sdr"]')?.getAttribute("aria-selected") === "true");
    assert(await page.locator('[data-local-lane="sdr"]').getAttribute("aria-selected") === "true", "SDR lane did not activate.");
    await page.locator('[data-local-lane="hdr"]').click();
    await page.waitForFunction(() => document.querySelector('[data-local-lane="hdr"]')?.getAttribute("aria-selected") === "true");

    const localGroup = page.locator("#local-adjustments-group");
    assert(await localGroup.getByText("Light Controls", { exact: true }).isVisible(), "Light Controls section is missing.");
    assert(await localGroup.getByText("Color Controls", { exact: true }).isVisible(), "Color Controls section is missing.");
    assert(await localGroup.getByText("Temperature", { exact: true }).isVisible(), "Color controls are hidden.");
    assert(await localGroup.getByText("Exposure", { exact: true }).isVisible(), "Light controls are hidden.");
    assert(await page.locator('[data-local-grade-tab]').count() === 0, "Nested Light/Color tabs are still rendered.");
    const lightSliderWidths = await page.locator('[data-local-grade-section="light"] [data-local-grade]').evaluateAll((controls) => controls.map((control) => ({ name: control.dataset.localGrade, width: control.getBoundingClientRect().width })));
    const referenceSliderWidth = lightSliderWidths.find((item) => item.name === "exposure").width;
    const lightLayoutDebug = await page.locator(".local-four-way").evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      display: getComputedStyle(node).display,
      columns: getComputedStyle(node).gridTemplateColumns,
      justifyItems: getComputedStyle(node).justifyItems,
      labelWidth: node.querySelector("label").getBoundingClientRect().width,
      labelColumns: getComputedStyle(node.querySelector("label")).gridTemplateColumns,
    }));
    assert(lightSliderWidths.every((item) => Math.abs(item.width - referenceSliderWidth) < 1), `Light slider widths are inconsistent: ${JSON.stringify({ lightSliderWidths, lightLayoutDebug })}`);
    const instrumentRows = await page.locator(".local-lane-folder .instrument-slider-control").evaluateAll((rows) => rows.map((row) => {
      const heading = row.querySelector(".control-heading") || row.querySelector(":scope > span");
      const shell = row.querySelector(":scope > .range-shell");
      const rowBox = row.getBoundingClientRect();
      const headingBox = heading?.getBoundingClientRect();
      const shellBox = shell?.getBoundingClientRect();
      return {
        fullWidth: Boolean(shellBox) && Math.abs(shellBox.x - rowBox.x) < 1 && Math.abs(shellBox.width - rowBox.width) < 1,
        stacked: Boolean(headingBox && shellBox) && shellBox.y >= headingBox.bottom - 0.5,
        ticks: shell?.querySelectorAll(".slider-ticks i").length || 0,
      };
    }));
    assert(instrumentRows.length > 10, "Shared instrument slider component is not applied throughout local controls.");
    assert(instrumentRows.every((row) => row.fullWidth && row.stacked && row.ticks === 9), `Local instrument slider geometry is inconsistent: ${JSON.stringify(instrumentRows)}`);

    const sliderPositions = await page.evaluate(async () => {
      const local = selectedLocal();
      const originalHdr = JSON.parse(JSON.stringify(local.hdr_grade));
      const originalSdr = JSON.parse(JSON.stringify(local.sdr_grade));
      Object.assign(local.hdr_grade, {
        exposure: 4,
        highlights: -1,
        midtones: 1,
        shadows: -0.5,
        blacks: 1.5,
        contrast: -1.5,
        white_balance_kelvin: 17650,
      });
      Object.assign(local.sdr_grade, {
        exposure: -4,
        highlights: 1.5,
        midtones: -1.5,
        shadows: 1,
        blacks: -1,
        contrast: 0.5,
        white_balance_kelvin: 3500,
      });
      const snapshot = (lane) => [...document.querySelectorAll(".local-grade-controls input[type=range]")].map((control) => {
        const minimum = Number(control.min);
        const maximum = Number(control.max);
        const expected = ((Number(control.value) - minimum) / (maximum - minimum)) * 100;
        const rendered = Number.parseFloat(control.closest(".range-shell").style.getPropertyValue("--pos"));
        return { lane, name: control.dataset.localGrade, expected, rendered };
      });
      const sdrSwitch = switchLane("sdr");
      const sdrPositions = snapshot("sdr");
      await sdrSwitch;
      const hdrSwitch = switchLane("hdr");
      const hdrPositions = snapshot("hdr");
      await hdrSwitch;
      local.hdr_grade = originalHdr;
      local.sdr_grade = originalSdr;
      renderLocalAdjustments();
      return [...sdrPositions, ...hdrPositions];
    });
    assert(
      sliderPositions.every(({ expected, rendered }) => Math.abs(expected - rendered) < 0.001),
      `Local slider visuals detached from their current values: ${JSON.stringify(sliderPositions)}`,
    );

    await localGroup.screenshot({ path: path.join(outputDir, "implementation-full.png") });
    const sliderImplementationPath = path.join(outputDir, "sliders-implementation.png");
    await page.locator(".local-lane-folder").screenshot({ path: sliderImplementationPath });
    const groupStyle = await page.locator(".control-group").nth(2).evaluate((node) => ({
      divider: getComputedStyle(node).borderTopWidth,
      dividerColor: getComputedStyle(node).borderTopColor,
      chevronWidth: getComputedStyle(node.querySelector(".group-toggle"), "::before").width,
      chevronHeight: getComputedStyle(node.querySelector(".group-toggle"), "::before").height,
      chevronMask: getComputedStyle(node.querySelector(".group-toggle"), "::before").webkitMaskImage,
    }));
    const expandedBorder = await page.locator("#local-adjustments-group").evaluate((node) => ({
      top: getComputedStyle(node).borderTopWidth,
      right: getComputedStyle(node).borderRightWidth,
      bottom: getComputedStyle(node).borderBottomWidth,
      left: getComputedStyle(node).borderLeftWidth,
      color: getComputedStyle(node).borderTopColor,
      internal: getComputedStyle(node.querySelector(":scope > .control-group-body")).borderTopWidth,
    }));
    assert(groupStyle.divider === "1px", "Internal top-level control group separators are not 1 px.");
    assert(expandedBorder.top === "3px" && expandedBorder.bottom === "3px" && expandedBorder.left === "0px" && expandedBorder.right === "0px", `Expanded panel boundaries should be 3 px at top/bottom with open sides: ${JSON.stringify(expandedBorder)}`);
    assert(expandedBorder.internal === "1px" && expandedBorder.color !== groupStyle.dividerColor, "External and internal panel borders are not visually differentiated.");
    assert(groupStyle.chevronWidth === "18px" && groupStyle.chevronHeight === "18px" && groupStyle.chevronMask !== "none", "Disclosure chevrons are not using the 18 px masked icon treatment.");
    const geometryGroup = page.locator('.control-group[data-group="geometry"]');
    if (await geometryGroup.locator(".group-toggle").getAttribute("aria-expanded") === "false") {
      await geometryGroup.locator(".group-toggle").click();
      await page.waitForFunction(() => document.querySelector('.control-group[data-group="geometry"] .group-toggle')?.getAttribute("aria-expanded") === "true");
    }
    const groupImplementationPath = path.join(outputDir, "groups-implementation.png");
    const railBox = await page.locator(".grade-rail").boundingBox();
    const localLaneBox = await page.locator(".local-lane-folder").boundingBox();
    const geometryBox = await geometryGroup.boundingBox();
    await page.screenshot({ path: groupImplementationPath, clip: { x: railBox.x, y: localLaneBox.y, width: railBox.width, height: geometryBox.y + geometryBox.height - localLaneBox.y } });
    const comparison = await browser.newPage({ viewport: { width: 1200, height: 1780 }, deviceScaleFactor: 1 });
    const reference = fs.readFileSync(referencePath).toString("base64");
    const implementation = fs.readFileSync(implementationPath).toString("base64");
    const sliderReference = fs.readFileSync(sliderReferencePath).toString("base64");
    const sliderImplementation = fs.readFileSync(sliderImplementationPath).toString("base64");
    const groupReference = fs.readFileSync(groupReferencePath).toString("base64");
    const groupImplementation = fs.readFileSync(groupImplementationPath).toString("base64");
    await comparison.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; color: #dce5e7; background: #0a0f11; font: 14px system-ui; }
        main { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
        figure { margin: 0; padding: 12px; border: 1px solid #344044; background: #111719; }
        figcaption { margin-bottom: 10px; color: #7edce2; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
        img { display: block; width: 100%; height: auto; }
      </style>
      <main>
        <figure><figcaption>Reference</figcaption><img src="data:image/png;base64,${reference}"></figure>
        <figure><figcaption>Implementation</figcaption><img src="data:image/png;base64,${implementation}"></figure>
        <figure><figcaption>Slider reference</figcaption><img src="data:image/png;base64,${sliderReference}"></figure>
        <figure><figcaption>Slider implementation</figcaption><img src="data:image/png;base64,${sliderImplementation}"></figure>
        <figure><figcaption>Group reference</figcaption><img src="data:image/png;base64,${groupReference}"></figure>
        <figure><figcaption>Group implementation</figcaption><img src="data:image/png;base64,${groupImplementation}"></figure>
      </main>
    `, { waitUntil: "load" });
    await comparison.screenshot({ path: path.join(outputDir, "comparison.png"), fullPage: true });
    await comparison.close();

    for (let targetCount = 3; targetCount >= 0; targetCount -= 1) {
      await removeButton.click();
      await page.waitForFunction((count) => document.querySelectorAll("#local-adjustment-list > li").length === count, targetCount);
      const removeY = (await removeButton.boundingBox()).y;
      assert(Math.abs(removeY - fixedRemoveY) < 1, "The minus button moved as the stack approached its empty state.");
    }
    assert(await removeButton.isDisabled(), "The static minus button should disable when the list is empty.");
    assert(!(await page.locator("#local-add-adjustment").isDisabled()), "The static plus button should remain available when the list is empty.");
    assert(Math.abs((await stackSurface.boundingBox()).height - initialSurfaceHeight) < 1, "The empty adjustment viewport did not keep its fixed height.");

    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
    process.stdout.write(JSON.stringify({ implementationPath, comparisonPath: path.join(outputDir, "comparison.png") }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
