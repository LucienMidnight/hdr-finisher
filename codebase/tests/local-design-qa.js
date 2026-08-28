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
    const collapseMaterial = await page.evaluate(() => {
      const snapshot = (selector) => {
        const button = document.querySelector(selector);
        const style = getComputedStyle(button);
        const icon = getComputedStyle(button, "::before");
        const matrix = new DOMMatrixReadOnly(icon.transform);
        return {
          background: style.backgroundImage,
          shadow: style.boxShadow,
          border: style.borderTopWidth,
          width: style.width,
          height: style.height,
          transform: icon.transform,
          angle: Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI),
          text: button.textContent.trim(),
          label: button.getAttribute("aria-label"),
        };
      };
      return { metadata: snapshot("#source-rail-expand"), scopes: snapshot("#dock-collapse") };
    });
    assert(collapseMaterial.metadata.background.includes("linear-gradient") && collapseMaterial.metadata.background === collapseMaterial.scopes.background, `Panel collapse buttons do not share their gradient: ${JSON.stringify(collapseMaterial)}`);
    assert(collapseMaterial.metadata.shadow === collapseMaterial.scopes.shadow && collapseMaterial.metadata.shadow.includes("inset"), `Panel collapse buttons do not share their depth material: ${JSON.stringify(collapseMaterial)}`);
    assert([collapseMaterial.metadata, collapseMaterial.scopes].every((button) => button.border === "0px" && button.width === "28px" && button.height === "28px" && button.text === ""), `Panel collapse controls lost their shared icon-only geometry: ${JSON.stringify(collapseMaterial)}`);
    const metadataCollapseImplementationPath = path.join(outputDir, "metadata-collapse-implementation.png");
    const scopesCollapseImplementationPath = path.join(outputDir, "scopes-collapse-implementation.png");
    const metadataWasExpanded = await page.locator("#source-rail-expand").getAttribute("aria-expanded");
    if (metadataWasExpanded === "false") {
      await page.locator("#source-rail-expand").click();
      await page.waitForFunction(() => document.querySelector("#source-rail-expand")?.getAttribute("aria-expanded") === "true");
    }
    await page.locator(".source-rail .rail-title-row").screenshot({ path: metadataCollapseImplementationPath });
    if (metadataWasExpanded === "false") {
      await page.locator("#source-rail-expand").click();
      await page.waitForFunction(() => document.querySelector("#source-rail-expand")?.getAttribute("aria-expanded") === "false");
    }
    await page.locator(".dock-bar").screenshot({ path: scopesCollapseImplementationPath });
    await page.locator("#dock-collapse").click();
    await page.waitForTimeout(160);
    const collapsedScopeControl = await page.locator("#dock-collapse").evaluate((button) => ({
      expanded: button.getAttribute("aria-expanded"),
      label: button.getAttribute("aria-label"),
      transform: getComputedStyle(button, "::before").transform,
      angle: (() => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(button, "::before").transform);
        return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
      })(),
    }));
    assert(collapsedScopeControl.expanded === "false" && collapsedScopeControl.label === "Expand Scopes panel", `Collapsed Scopes control did not expose its expand action: ${JSON.stringify(collapsedScopeControl)}`);
    assert(collapseMaterial.scopes.angle === 90 && collapsedScopeControl.angle === -90, `Scopes chevron did not rotate from down to up: ${JSON.stringify({ open: collapseMaterial.scopes, collapsed: collapsedScopeControl })}`);
    await page.locator("#dock-collapse").click();
    assert(await page.locator("#dock-collapse").getAttribute("aria-expanded") === "true", "Scopes did not reopen from the shared chevron button.");
    const toggleStates = await page.locator("#lens-distortion").evaluate((control) => {
      const snapshot = () => {
        const style = getComputedStyle(control);
        const knob = getComputedStyle(control, "::before");
        return {
          background: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize,
          shadow: style.boxShadow,
          border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
          knob: { width: knob.width, height: knob.height, backgroundImage: knob.backgroundImage, zIndex: knob.zIndex },
        };
      };
      const original = control.checked;
      control.checked = false;
      const off = snapshot();
      control.checked = true;
      const on = snapshot();
      control.checked = original;
      return { off, on };
    });
    assert(toggleStates.on.background === "rgb(155, 123, 255)", `Checked toggle is not solid ultraviolet: ${JSON.stringify(toggleStates)}`);
    assert(toggleStates.off.background !== toggleStates.on.background, `Unchecked toggle is not neutral: ${JSON.stringify(toggleStates)}`);
    assert(toggleStates.on.backgroundImage.includes("linear-gradient") && toggleStates.off.backgroundImage.includes("linear-gradient"), `Toggle tracks are missing their material gradient: ${JSON.stringify(toggleStates)}`);
    assert([toggleStates.on.knob, toggleStates.off.knob].every((knob) => knob.width === "24px" && knob.height === "24px" && knob.backgroundImage.includes("radial-gradient") && knob.zIndex === "1"), `Toggle knob is not a full-height surface above the rail: ${JSON.stringify(toggleStates)}`);
    assert(toggleStates.on.shadow.includes("inset") && toggleStates.off.shadow.includes("inset"), `Toggle tracks are missing their recessed/lit depth: ${JSON.stringify(toggleStates)}`);
    assert([...toggleStates.on.border, ...toggleStates.off.border].every((value) => value === "0px"), `Toggle border remains visible: ${JSON.stringify(toggleStates)}`);
    const proofToggleSurface = await page.locator("#chrome-proof-toggle").evaluate((control) => {
      control.checked = true;
      const style = getComputedStyle(control);
      const result = { width: style.width, height: style.height, border: style.borderTopWidth, background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow };
      control.checked = false;
      return result;
    });
    assert(proofToggleSurface.width === "46px" && proofToggleSurface.height === "24px" && proofToggleSurface.border === "0px", `Proof switch did not use the shared borderless geometry: ${JSON.stringify(proofToggleSurface)}`);
    assert(proofToggleSurface.background === "rgb(155, 123, 255)" && proofToggleSurface.image.includes("linear-gradient") && proofToggleSurface.shadow.includes("inset"), `Proof switch did not use the illuminated depth material: ${JSON.stringify(proofToggleSurface)}`);
    const rawGroupWasHidden = await page.locator(".raw-development-group").evaluate((group) => ({
      hidden: group.hidden,
      hiddenClass: group.classList.contains("hidden"),
      panelHidden: group.querySelector(".disclosure-content").classList.contains("hidden"),
      expanded: group.querySelector(".disclosure-trigger").getAttribute("aria-expanded"),
    }));
    await page.locator(".raw-development-group").evaluate((group) => {
      group.hidden = false;
      group.classList.remove("hidden");
      group.querySelector(".disclosure-content").classList.remove("hidden");
      group.querySelector(".disclosure-trigger").setAttribute("aria-expanded", "true");
    });
    await page.locator(".raw-development-group").screenshot({ path: path.join(outputDir, "toggle-implementation.png") });
    await page.locator(".raw-development-group").evaluate((group, previous) => {
      group.hidden = previous.hidden;
      group.classList.toggle("hidden", previous.hiddenClass);
      group.querySelector(".disclosure-content").classList.toggle("hidden", previous.panelHidden);
      group.querySelector(".disclosure-trigger").setAttribute("aria-expanded", previous.expanded);
    }, rawGroupWasHidden);

    await page.locator("#view-hdr").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("#view-sdr")?.getAttribute("aria-selected") === "true");
    assert(await page.locator("#view-sdr").getAttribute("tabindex") === "0", "Global rendition segment did not move its roving tab stop.");
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("#view-hdr")?.getAttribute("aria-selected") === "true");

    await page.locator("#proof-preview-switch").evaluate((rail) => rail.classList.remove("hidden"));
    const expectedProofPreview = await page.locator("#proof-preview-switch").evaluate((rail) => {
      const buttons = [...rail.querySelectorAll("button")];
      const current = buttons.findIndex((button) => button.getAttribute("aria-pressed") === "true");
      return buttons[(current + 1) % buttons.length].dataset.proofPreview;
    });
    await page.locator('#proof-preview-switch button[aria-pressed="true"]').dispatchEvent("keydown", { key: "ArrowRight" });
    await page.waitForFunction((preview) => document.querySelector(`[data-proof-preview="${preview}"]`)?.getAttribute("aria-pressed") === "true", expectedProofPreview);
    const activeProof = page.locator(`[data-proof-preview="${expectedProofPreview}"]`);
    assert(await activeProof.getAttribute("tabindex") === "0", "Proof rendition segment did not move its roving tab stop.");
    await page.locator("#proof-preview-switch").evaluate((rail) => rail.classList.add("hidden"));

    await page.locator('[data-group="hdr-zones"] .group-toggle').click();
    const setRange = async (selector, value) => {
      await page.locator(selector).evaluate((control, next) => {
        control.value = String(next);
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    };
    await setRange("#hdr-lift", 0.1);
    await setRange("#hdr-lift-range", 6);
    await page.locator("#hdr-lift").dblclick();
    await page.waitForFunction(() => Number(document.querySelector("#hdr-lift")?.value) === 0);
    assert(Number(await page.locator("#hdr-lift-range").inputValue()) === 6, "Resetting the parent rail changed its compact child.");
    await page.locator("#hdr-lift-range").dblclick();
    await page.waitForFunction(() => Number(document.querySelector("#hdr-lift-range")?.value) === 4);
    assert(Number(await page.locator("#hdr-lift").inputValue()) === 0, "Resetting the compact child changed its parent rail.");
    await setRange("#hdr-lift", 0.1);
    await setRange("#hdr-lift-range", 6);
    await page.locator('[data-lane-panel="hdr"] [data-zone-hover="lift"]').focus();
    assert(await page.evaluate(() => state.scopeZoneOverlay?.zone === "lift" && state.scopeZoneOverlay?.lane === "hdr"), "Compact targeting controls did not expose their scope influence on focus.");
    await page.locator(".product-name").focus().catch(() => null);
    await page.locator('[data-lane-panel="hdr"] [data-zone-hover="lift"]').evaluate((target) => target.blur());
    await page.waitForFunction(() => state.scopeZoneOverlay === null);
    await page.locator('[data-reset-group="hdr-zones"]').click();
    await page.waitForFunction(() => Number(document.querySelector("#hdr-lift")?.value) === 0 && Number(document.querySelector("#hdr-lift-range")?.value) === 4);

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
    const gradientToggleSurface = await page.locator(".gradient-luma-toggle input").evaluate((control) => {
      const snapshot = () => {
        const style = getComputedStyle(control);
        return { width: style.width, height: style.height, border: style.borderTopWidth, background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow };
      };
      control.checked = false;
      const off = snapshot();
      control.checked = true;
      const on = snapshot();
      control.checked = false;
      return { off, on };
    });
    assert(gradientToggleSurface.on.width === "46px" && gradientToggleSurface.on.height === "24px", `Gradient Luma switch did not use the shared geometry: ${JSON.stringify(gradientToggleSurface)}`);
    assert(gradientToggleSurface.on.border === "0px" && gradientToggleSurface.on.background === "rgb(155, 123, 255)", `Gradient Luma switch did not use the borderless ultraviolet on state: ${JSON.stringify(gradientToggleSurface)}`);
    assert(gradientToggleSurface.off.shadow.includes("inset") && gradientToggleSurface.on.image.includes("linear-gradient"), `Gradient Luma switch lost its depth material: ${JSON.stringify(gradientToggleSurface)}`);
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

    await page.locator('[data-local-tool="luminance_range"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#local-adjustment-list > li").length === 3);
    const lumaLabelTypography = await page.locator(".luma-range-control").evaluate((control) => ({
      heading: getComputedStyle(control.querySelector(".luma-range-heading")).fontSize,
      headingOutput: getComputedStyle(control.querySelector(".luma-range-heading output")).fontSize,
      preset: getComputedStyle(control.querySelector(".luma-preset-button")).fontSize,
      endpoint: getComputedStyle(control.querySelector(".luma-nit-range-values output")).fontSize,
      scale: getComputedStyle(control.querySelector(".luma-range-scale")).fontSize,
    }));
    assert(
      JSON.stringify(lumaLabelTypography) === JSON.stringify({
        heading: "10.5px",
        headingOutput: "10px",
        preset: "9.5px",
        endpoint: "10px",
        scale: "9px",
      }),
      `Luma selector labels did not keep their increased type sizes: ${JSON.stringify(lumaLabelTypography)}`,
    );
    await page.locator(".local-mask-subpanel").first().screenshot({ path: path.join(outputDir, "luma-selector-implementation.png") });

    await page.locator('[data-local-tool="path"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#local-adjustment-list > li").length === 4);
    await page.locator("#local-adjustment-list button[data-local-id]").first().click();
    await page.evaluate(() => window.scrollTo(0, 0));

    const removeButton = page.locator("#local-delete");
    const removeRailY = async () => (await removeButton.boundingBox()).y
      + await page.locator(".grade-rail").evaluate((rail) => rail.scrollTop);
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
    const fixedRemoveY = await removeRailY();
    for (let targetCount = 7; targetCount >= 4; targetCount -= 1) {
      await removeButton.click();
      await page.waitForFunction((count) => document.querySelectorAll("#local-adjustment-list > li").length === count, targetCount);
      const surfaceHeight = (await stackSurface.boundingBox()).height;
      const removeY = await removeRailY();
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
          hitHeight: rootStyle.getPropertyValue("--instrument-slider-hit-h").trim(),
          trackHeight: rootStyle.getPropertyValue("--instrument-slider-track-h").trim(),
          thumbWidth: rootStyle.getPropertyValue("--instrument-slider-thumb-w").trim(),
          thumbHeight: rootStyle.getPropertyValue("--instrument-slider-thumb-h").trim(),
          compactTrackHeight: rootStyle.getPropertyValue("--instrument-compact-slider-track-h").trim(),
          compactThumbWidth: rootStyle.getPropertyValue("--instrument-compact-slider-thumb-w").trim(),
          compactThumbHeight: rootStyle.getPropertyValue("--instrument-compact-slider-thumb-h").trim(),
          tabRuleWidth: rootStyle.getPropertyValue("--instrument-tab-rule-w").trim(),
        },
      };
    });
    assert(Math.abs(tabGeometry.controls.x - tabGeometry.folder.x) < 1 && Math.abs(tabGeometry.controls.width - tabGeometry.folder.width) < 1, `Local tab boundary is not full width: ${JSON.stringify(tabGeometry)}`);
    assert(Math.abs(tabGeometry.controls.y - tabGeometry.tabBottom) <= 4.1, `Local tab boundary is detached from the recessed segment: ${JSON.stringify(tabGeometry)}`);
    assert(JSON.stringify(tabGeometry.tokens) === JSON.stringify({ rowHeight: "36px", hitHeight: "28px", trackHeight: "13px", thumbWidth: "9px", thumbHeight: "21px", compactTrackHeight: "7px", compactThumbWidth: "7px", compactThumbHeight: "15px", tabRuleWidth: "1px" }), `Instrument component tokens are missing or changed: ${JSON.stringify(tabGeometry.tokens)}`);
    await page.locator('[data-local-lane="hdr"]').focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('[data-local-lane="sdr"]')?.getAttribute("aria-selected") === "true");
    assert(await page.locator('[data-local-lane="sdr"]').getAttribute("aria-selected") === "true", "SDR lane did not activate.");
    assert(await page.locator('[data-local-lane="sdr"]').getAttribute("tabindex") === "0", "Local rendition segment did not move its roving tab stop.");
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector('[data-local-lane="hdr"]')?.getAttribute("aria-selected") === "true");

    const localGroup = page.locator("#local-adjustments-group");
    assert(await localGroup.getByText("Light · Local", { exact: true }).isVisible(), "Light · Local context is missing.");
    assert(await localGroup.getByText("Color · Local", { exact: true }).isVisible(), "Color · Local context is missing.");
    assert(await localGroup.getByText("Temperature", { exact: true }).isVisible(), "Color controls are hidden.");
    assert(await localGroup.getByText("Exposure", { exact: true }).isVisible(), "Light controls are hidden.");
    assert(await page.locator('[data-local-grade-tab]').count() === 0, "Nested Light/Color tabs are still rendered.");
    const lightSliderGeometry = await page.locator('[data-local-grade-section="light"] [data-local-grade]').evaluateAll((controls) => controls.map((control) => ({
      name: control.dataset.localGrade,
      width: control.getBoundingClientRect().width,
      compact: control.closest(".compact-subrail") !== null,
      nested: control.closest(".slider-group-tile") !== null,
    })));
    const exposureGeometry = lightSliderGeometry.find((item) => item.name === "exposure");
    const compactGeometry = lightSliderGeometry.filter((item) => item.compact);
    assert(exposureGeometry.nested && !exposureGeometry.compact, `Exposure is not the standard parent rail: ${JSON.stringify(lightSliderGeometry)}`);
    assert(compactGeometry.length === 5 && compactGeometry.every((item) => item.nested && item.width < exposureGeometry.width), `Light sub-rails are not compact and nested: ${JSON.stringify(lightSliderGeometry)}`);
    assert(new Set(compactGeometry.map((item) => Math.round(item.width))).size === 1, `Compact sub-rails are not aligned: ${JSON.stringify(lightSliderGeometry)}`);
    const instrumentRows = await page.locator(".local-lane-folder .instrument-slider-control").evaluateAll((rows) => rows.map((row) => {
      const heading = row.querySelector(".control-heading") || row.querySelector(":scope > span");
      const shell = row.querySelector(":scope > .range-shell");
      const rowBox = row.getBoundingClientRect();
      const headingBox = heading?.getBoundingClientRect();
      const shellBox = shell?.getBoundingClientRect();
      return {
        compact: row.classList.contains("compact-subrail"),
        nested: row.closest(".slider-group-tile") !== null,
        fullWidth: Boolean(shellBox) && Math.abs(shellBox.x - rowBox.x) < 1 && Math.abs(shellBox.width - rowBox.width) < 1,
        stacked: Boolean(headingBox && shellBox) && shellBox.y >= headingBox.bottom - 0.5,
        visualMarks: shell?.querySelectorAll(".slider-ticks, .home-tick, .center-tick").length || 0,
      };
    }));
    assert(instrumentRows.length > 10, "Shared instrument slider component is not applied throughout local controls.");
    assert(instrumentRows.filter((row) => !row.compact).every((row) => row.fullWidth && row.stacked), `Standard local slider geometry is inconsistent: ${JSON.stringify(instrumentRows)}`);
    assert(instrumentRows.filter((row) => row.compact).every((row) => row.nested && !row.fullWidth), `Compact local slider geometry is inconsistent: ${JSON.stringify(instrumentRows)}`);
    assert(instrumentRows.every((row) => row.visualMarks === 0), `Empty rails contain visual tick or home marks: ${JSON.stringify(instrumentRows)}`);

    const essentialContrast = await page.evaluate(() => {
      const parse = (value) => (value.match(/[\d.]+/g) || []).map(Number);
      const linear = (channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
      const ratio = (foreground, background) => {
        const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      const backgroundFor = (element) => {
        for (let node = element; node; node = node.parentElement) {
          const color = parse(getComputedStyle(node).backgroundColor);
          if (color.length >= 3 && (color[3] === undefined || color[3] >= 0.99)) return color;
        }
        return [11, 13, 15];
      };
      return [...document.querySelectorAll([
        ".product-name",
        ".grade-header .panel-title",
        ".local-tool-strip button",
        ".local-mask-subpanel-heading strong",
        ".local-grade-section .control-heading label",
        ".local-grade-section .control-heading output",
      ].join(","))]
        .filter((element) => element.getClientRects().length && element.textContent.trim())
        .map((element) => {
          const style = getComputedStyle(element);
          const foreground = parse(style.color);
          const background = backgroundFor(element);
          return { text: element.textContent.trim(), selector: element.className || element.tagName, ratio: ratio(foreground, background), foreground, background };
        });
    });
    assert(essentialContrast.length > 12, `Essential label contrast sample was unexpectedly small: ${JSON.stringify(essentialContrast)}`);
    assert(essentialContrast.every((sample) => sample.ratio >= 4.5), `Essential small-label contrast fell below 4.5:1: ${JSON.stringify(essentialContrast.filter((sample) => sample.ratio < 4.5))}`);

    const sliderSurface = await page.locator("#local-exposure").evaluate((control) => {
      const shell = control.closest(".range-shell");
      const track = shell.querySelector(".slider-track");
      const trackStyle = getComputedStyle(track);
      const controlBox = control.getBoundingClientRect();
      const trackBox = track.getBoundingClientRect();
      const rules = [...document.styleSheets].flatMap((sheet) => {
        try { return [...sheet.cssRules]; } catch { return []; }
      });
      const nativeTrackRule = rules.find((rule) => rule.selectorText?.includes('.instrument-slider-control > .range-shell input[type="range"]::-webkit-slider-runnable-track'));
      const nativeThumbRule = rules.filter((rule) => rule.selectorText === 'input[type="range"]::-webkit-slider-thumb').at(-1);
      return {
        trackBorder: trackStyle.borderTopWidth,
        trackBackground: trackStyle.backgroundImage,
        trackShadow: trackStyle.boxShadow,
        trackCenterDelta: Math.abs((trackBox.top + trackBox.height / 2) - (controlBox.top + controlBox.height / 2)),
        nativeTrack: nativeTrackRule ? {
          height: nativeTrackRule.style.height,
          background: nativeTrackRule.style.background,
          shadow: nativeTrackRule.style.boxShadow,
        } : null,
        nativeThumb: nativeThumbRule ? {
          height: nativeThumbRule.style.height,
          marginTop: nativeThumbRule.style.marginTop,
        } : null,
        controlOutline: getComputedStyle(control).outlineStyle,
      };
    });
    assert(sliderSurface.trackBorder === "0px" && sliderSurface.trackBackground.includes("linear-gradient") && sliderSurface.trackShadow.match(/inset/g)?.length >= 2, `Instrument rail is not a borderless chamfered recess: ${JSON.stringify(sliderSurface)}`);
    assert(
      sliderSurface.trackCenterDelta < 0.01
      && sliderSurface.nativeTrack?.height === "var(--instrument-slider-track-h)"
      && sliderSurface.nativeTrack?.background === "transparent"
      && sliderSurface.nativeTrack?.shadow === "none"
      && sliderSurface.nativeThumb?.height === "var(--instrument-slider-thumb-h)"
      && sliderSurface.nativeThumb?.marginTop === "calc((var(--instrument-slider-track-h) - var(--instrument-slider-thumb-h)) / 2)",
      `Native range geometry is drawing through the rail or shifting the thumb off center: ${JSON.stringify(sliderSurface)}`,
    );
    assert(sliderSurface.controlOutline === "none", `Instrument slider retains a colored input outline: ${JSON.stringify(sliderSurface)}`);

    const segmentSurface = await page.locator(".lane-switch").first().evaluate((rail) => {
      const selected = rail.querySelector("button.active, button[aria-selected='true'], button[aria-pressed='true']");
      const railStyle = getComputedStyle(rail);
      const selectedStyle = getComputedStyle(selected);
      return {
        railBackground: railStyle.backgroundImage,
        railShadow: railStyle.boxShadow,
        selectedBackground: selectedStyle.backgroundImage,
        selectedShadow: selectedStyle.boxShadow,
      };
    });
    assert(segmentSurface.railBackground.includes("linear-gradient") && segmentSurface.railShadow.includes("inset"), `Segment rail is missing its recessed gradient depth: ${JSON.stringify(segmentSurface)}`);
    assert(segmentSurface.selectedBackground.includes("linear-gradient") && segmentSurface.selectedShadow.includes("inset"), `Selected segment is missing its raised gradient and lit edge: ${JSON.stringify(segmentSurface)}`);

    const colorRailSurfaces = await page.evaluate(() => {
      const inspect = (selector) => {
        const input = document.querySelector(selector);
        const shell = input.closest(".range-shell");
        const track = getComputedStyle(shell.querySelector(".slider-track"));
        const fill = getComputedStyle(shell.querySelector(".slider-fill"));
        return {
          background: track.backgroundImage,
          shadow: track.boxShadow,
          fill: fill.backgroundColor,
        };
      };
      return {
        temperature: inspect("#hdr-wb"),
        tint: inspect("#hdr-tint"),
        redHue: inspect("#hdr-red-hue"),
        greenPurity: inspect("#hdr-green-purity"),
        blueHue: inspect("#hdr-blue-hue"),
        tintHue: inspect("#hdr-tint-hue"),
      };
    });
    assert(Object.values(colorRailSurfaces).every((surface) => (surface.background.match(/linear-gradient/g) || []).length >= 2 && surface.shadow.includes("inset")), `Color-bearing rails are missing spectrum or machined depth: ${JSON.stringify(colorRailSurfaces)}`);
    assert(Object.values(colorRailSurfaces).every((surface) => surface.fill === "rgba(0, 0, 0, 0)"), `Color-bearing rails are obscured by ordinary fills: ${JSON.stringify(colorRailSurfaces)}`);
    const semanticColorRailDirections = await page.evaluate(() => {
      const spectrum = (selector) => getComputedStyle(document.querySelector(selector).closest(".control-row")).getPropertyValue("--color-rail-spectrum").replace(/\s+/g, " ").trim();
      return { temperature: spectrum("#hdr-wb"), tint: spectrum("#hdr-tint") };
    });
    assert(
      semanticColorRailDirections.temperature.indexOf("#526fbd") < semanticColorRailDirections.temperature.indexOf("#cf7133"),
      `Temperature rail is not cool-left / warm-right: ${JSON.stringify(semanticColorRailDirections)}`,
    );
    assert(
      semanticColorRailDirections.tint.indexOf("#c56398") < semanticColorRailDirections.tint.indexOf("#3f8f62"),
      `Tint rail is not magenta-left / green-right: ${JSON.stringify(semanticColorRailDirections)}`,
    );

    const primaryActionSurface = await page.locator("#import-button").evaluate((button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundImage, shadow: style.boxShadow };
    });
    assert(primaryActionSurface.background.includes("linear-gradient"), `Primary action lost its material gradient: ${JSON.stringify(primaryActionSurface)}`);
    assert(!primaryActionSurface.shadow.includes("inset"), `Primary action retains a white inset edge: ${JSON.stringify(primaryActionSurface)}`);

    const groupedZoneGeometry = await page.locator('[data-group="hdr-zones"] .slider-group-tile').evaluateAll((tiles) => tiles.map((tile) => ({
      relationship: tile.querySelector(".slider-group-relationship")?.textContent.trim(),
      parentCount: tile.querySelectorAll(":scope > .slider-group-parent").length,
      childCount: tile.querySelectorAll(".compact-subrails .compact-subrail").length,
      strayCompact: tile.parentElement.querySelectorAll(":scope > .compact-subrail").length,
    })));
    assert(groupedZoneGeometry.length === 3, `HDR zone tiles are missing: ${JSON.stringify(groupedZoneGeometry)}`);
    assert(groupedZoneGeometry.every((tile) => tile.relationship === "Targeting" && tile.parentCount === 1 && tile.childCount === 2 && tile.strayCompact === 0), `HDR zone hierarchy is structurally incorrect: ${JSON.stringify(groupedZoneGeometry)}`);

    const compactComponentGeometry = await page.evaluate(() => {
      const inspect = (selector) => {
        const row = document.querySelector(selector);
        const input = row.querySelector('input[type="range"]');
        const track = row.querySelector(".slider-track");
        return {
          hitHeight: getComputedStyle(input).height,
          trackHeight: getComputedStyle(track).height,
          nested: Boolean(row.closest(".slider-group-tile")),
        };
      };
      return {
        local: inspect('.local-light-tile .compact-subrail'),
        global: inspect('[data-group="hdr-zones"] .compact-subrail'),
        allNested: [...document.querySelectorAll(".compact-subrail")].every((row) => row.closest(".slider-group-tile")),
        relationships: [...document.querySelectorAll(".slider-group-relationship")].map((node) => node.textContent.trim()),
      };
    });
    assert(compactComponentGeometry.local.hitHeight === "28px" && compactComponentGeometry.global.hitHeight === "28px", `Compact pointer targets are below contract: ${JSON.stringify(compactComponentGeometry)}`);
    assert(compactComponentGeometry.local.trackHeight === "7px" && compactComponentGeometry.global.trackHeight === "7px", `Global/local compact rails do not share visual geometry: ${JSON.stringify(compactComponentGeometry)}`);
    assert(compactComponentGeometry.allNested, `A compact rail escaped its grouping tile: ${JSON.stringify(compactComponentGeometry)}`);
    assert(compactComponentGeometry.relationships.includes("Tone distribution") && compactComponentGeometry.relationships.filter((label) => label === "Targeting").length === 6, `Relationship labels are missing or imply false coupling: ${JSON.stringify(compactComponentGeometry)}`);

    const siblingIsolation = await page.evaluate(() => {
      const local = selectedLocal();
      const grade = local[`${state.currentView}_grade`];
      const before = { highlights: grade.highlights, midtones: grade.midtones };
      const control = document.querySelector('[data-local-grade="highlights"]');
      control.value = String(Math.min(Number(control.max), before.highlights + 0.2));
      control.dispatchEvent(new Event("input", { bubbles: true }));
      const after = { highlights: grade.highlights, midtones: grade.midtones };
      grade.highlights = before.highlights;
      grade.midtones = before.midtones;
      renderLocalAdjustments();
      return { before, after };
    });
    assert(siblingIsolation.after.highlights !== siblingIsolation.before.highlights && siblingIsolation.after.midtones === siblingIsolation.before.midtones, `Editing a compact child changed its sibling: ${JSON.stringify(siblingIsolation)}`);

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
    const expandedBorder = await page.locator("#local-adjustments-group").evaluate((node) => {
      const body = node.querySelector(":scope > .control-group-body");
      const bodyStyle = getComputedStyle(body);
      const nodeBox = node.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      return {
        top: getComputedStyle(node).borderTopWidth,
        right: getComputedStyle(node).borderRightWidth,
        bottom: getComputedStyle(node).borderBottomWidth,
        left: getComputedStyle(node).borderLeftWidth,
        color: getComputedStyle(node).borderTopColor,
        internal: bodyStyle.borderTopWidth,
        bodyRadius: bodyStyle.borderRadius,
        bodyShadow: bodyStyle.boxShadow,
        bodyMarginInline: [bodyStyle.marginLeft, bodyStyle.marginRight],
        bodyFullBleed: Math.abs(bodyBox.x - nodeBox.x) < 1 && Math.abs(bodyBox.width - nodeBox.width) < 1,
        accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      };
    });
    assert(groupStyle.divider === "1px", "Internal top-level control group separators are not 1 px.");
    assert(expandedBorder.top === "1px" && expandedBorder.bottom === "1px" && expandedBorder.left === "0px" && expandedBorder.right === "0px", `Expanded panel boundaries should be one-pixel cues with open sides: ${JSON.stringify(expandedBorder)}`);
    assert(expandedBorder.internal === "0px" && expandedBorder.bodyRadius === "0px" && expandedBorder.bodyShadow === "none", `Expanded content still renders as an inset tile: ${JSON.stringify(expandedBorder)}`);
    assert(expandedBorder.bodyMarginInline.every((value) => value === "0px") && expandedBorder.bodyFullBleed, `Expanded content is not full bleed: ${JSON.stringify(expandedBorder)}`);
    assert(groupStyle.chevronWidth === "18px" && groupStyle.chevronHeight === "18px" && groupStyle.chevronMask !== "none", "Disclosure chevrons are not using the 18 px masked icon treatment.");
    const denoiseGroup = page.locator('.control-group[data-group="denoise"]');
    const denoiseHeader = denoiseGroup.locator(":scope > .control-group-header");
    const denoiseIndex = await denoiseHeader.evaluate((header) => {
      const headerBox = header.getBoundingClientRect();
      const toggleBox = header.querySelector(".group-toggle").getBoundingClientRect();
      const indexStyle = getComputedStyle(header, "::before");
      return {
        fontSize: indexStyle.fontSize,
        indexLeft: Number.parseFloat(indexStyle.left),
        indexWidth: Number.parseFloat(indexStyle.width),
        toggleLeft: toggleBox.left - headerBox.left,
        headerHeight: headerBox.height,
      };
    });
    assert(denoiseIndex.fontSize === "11px", `Control-group index did not gain the requested visual weight: ${JSON.stringify(denoiseIndex)}`);
    assert(denoiseIndex.toggleLeft <= denoiseIndex.indexLeft, `The disclosure hit target does not extend beneath its index: ${JSON.stringify(denoiseIndex)}`);
    const denoiseWasExpanded = await denoiseGroup.locator(".group-toggle").getAttribute("aria-expanded");
    await denoiseHeader.click({ position: { x: denoiseIndex.indexLeft + denoiseIndex.indexWidth / 2, y: denoiseIndex.headerHeight / 2 } });
    await page.waitForFunction((expanded) => document.querySelector('.control-group[data-group="denoise"] .group-toggle')?.getAttribute("aria-expanded") !== expanded, denoiseWasExpanded);
    await denoiseGroup.locator(".group-toggle").click();
    await page.waitForFunction((expanded) => document.querySelector('.control-group[data-group="denoise"] .group-toggle')?.getAttribute("aria-expanded") === expanded, denoiseWasExpanded);
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
    const colorGroup = page.locator('.control-group[data-group="hdr-color"]');
    if (await colorGroup.locator(".group-toggle").getAttribute("aria-expanded") === "false") {
      await colorGroup.locator(".group-toggle").click();
      await page.waitForFunction(() => document.querySelector('.control-group[data-group="hdr-color"] .group-toggle')?.getAttribute("aria-expanded") === "true");
    }
    await colorGroup.screenshot({ path: path.join(outputDir, "color-rails-implementation.png") });
    const comparison = await browser.newPage({ viewport: { width: 1200, height: 1780 }, deviceScaleFactor: 1 });
    const reference = fs.readFileSync(referencePath).toString("base64");
    const implementation = fs.readFileSync(implementationPath).toString("base64");
    const sliderReference = fs.readFileSync(sliderReferencePath).toString("base64");
    const sliderImplementation = fs.readFileSync(sliderImplementationPath).toString("base64");
    const groupReference = fs.readFileSync(groupReferencePath).toString("base64");
    const groupImplementation = fs.readFileSync(groupImplementationPath).toString("base64");
    const collapseReference = fs.readFileSync("C:/Users/Steve/AppData/Local/Temp/codex-clipboard-9b1a27fa-7b2d-414e-9359-6cfcdc148cda.png").toString("base64");
    const metadataCollapseImplementation = fs.readFileSync(metadataCollapseImplementationPath).toString("base64");
    const scopesCollapseImplementation = fs.readFileSync(scopesCollapseImplementationPath).toString("base64");
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
        <figure><figcaption>Collapse reference</figcaption><img src="data:image/png;base64,${collapseReference}"></figure>
        <figure><figcaption>Metadata collapse implementation</figcaption><img src="data:image/png;base64,${metadataCollapseImplementation}"></figure>
        <figure><figcaption>Scopes collapse implementation</figcaption><img src="data:image/png;base64,${scopesCollapseImplementation}"></figure>
      </main>
    `, { waitUntil: "load" });
    await comparison.screenshot({ path: path.join(outputDir, "comparison.png"), fullPage: true });
    await comparison.close();

    await page.evaluate(() => window.scrollTo(0, 0));
    for (let targetCount = 3; targetCount >= 0; targetCount -= 1) {
      await removeButton.click();
      await page.waitForFunction((count) => document.querySelectorAll("#local-adjustment-list > li").length === count, targetCount);
      const removeY = await removeRailY();
      assert(Math.abs(removeY - fixedRemoveY) < 1, `The minus button moved as the stack approached its empty state: ${JSON.stringify({ targetCount, fixedRemoveY, removeY, delta: removeY - fixedRemoveY })}`);
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
