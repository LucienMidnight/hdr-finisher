/**
 * The viewer tools around the picture: the Navigate window, the View menu's
 * Navigate Window and Preview Compares choices, Before / After, the Local
 * Adjustments eye, perspective guides under zoom, the Vignette scale sliders
 * and outline, and a crowded status bar.
 *
 *   node tests/run-in-electron.js tests/view-tools-interaction.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { encodeTiff } = require("./large-noisy-tiff.js");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function flatSource(width, height) {
  const target = path.join(os.tmpdir(), `hdr-finisher-flat-${width}x${height}.tiff`);
  if (!fs.existsSync(target)) fs.writeFileSync(target, encodeTiff(Buffer.alloc(width * height * 3, 128), width, height));
  return target;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ready(page) {
  await page.waitForFunction(() => viewerState().status === "ready" && !state.zoomRefinementTimer, null, { timeout: 120000 });
  await page.waitForTimeout(350);
}

async function load(page, source) {
  await page.setInputFiles("#file-input", source);
  await page.waitForFunction((name) => state.session?.session_id && els.sessionName.textContent.includes(name),
    path.basename(source), { timeout: 120000 });
  await ready(page);
}

async function command(page, name, payload) {
  await page.evaluate(([command, detail]) => document.dispatchEvent(
    new CustomEvent("hdr:desktop-command", { detail: { command, payload: detail } })), [name, payload]);
}

/** Where the Navigate window sits relative to the picture area, scroll bars excluded. */
async function navigatorBox(page) {
  return page.evaluate(() => {
    const thumb = els.navigationThumb.getBoundingClientRect();
    const frame = els.dropzone.getBoundingClientRect();
    const right = frame.left + els.dropzone.clientLeft + els.dropzone.clientWidth;
    const bottom = frame.top + els.dropzone.clientTop + els.dropzone.clientHeight;
    const image = els.navigationThumbImage.getBoundingClientRect();
    return {
      hidden: els.navigationThumb.classList.contains("hidden"),
      rightGap: right - thumb.right, bottomGap: bottom - thumb.bottom,
      leftGap: thumb.left - frame.left, topGap: thumb.top - frame.top,
      imageWidth: image.width, imageHeight: image.height,
      viewWidth: els.dropzone.clientWidth, viewHeight: els.dropzone.clientHeight,
    };
  });
}

async function waitForNavigator(page, shown) {
  await page.waitForFunction((want) => els.navigationThumb.classList.contains("hidden") !== want, shown, { timeout: 30000 });
}

/** The green level of the screen at a point of the picture, given as fractions of its width and height. */
async function levelAt(page, u, v) {
  const clip = await page.evaluate(([x, y]) => {
    const box = activePreviewElement().getBoundingClientRect();
    return { x: Math.round(box.left + box.width * x) - 1, y: Math.round(box.top + box.height * y) - 1, width: 3, height: 3 };
  }, [u, v]);
  const png = await page.screenshot({ clip });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(1, 1, 1, 1).data[1];
  }, png.toString("base64"));
}

async function setSlider(page, dataPath, value) {
  await page.evaluate(([target, next]) => {
    const control = document.querySelector(`input[data-path="${target}"]`);
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }, [dataPath, value]);
  await page.waitForTimeout(250);
  await ready(page);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const warnings = [];
  page.on("console", (message) => { if (["warning", "error"].includes(message.type())) warnings.push(message.text().slice(0, 300)); });
  const report = {};
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // --- Navigate window on a very wide line-scan strip -------------------
    await load(page, flatSource(12000, 300));
    await command(page, "navigation-window", { mode: "always" });
    await page.waitForFunction(() => state.navigationWindowMode === "always");
    await waitForNavigator(page, true);
    const strip = await navigatorBox(page);
    report.strip = strip;
    assert(Math.abs(strip.rightGap - 12) <= 1 && Math.abs(strip.bottomGap - 12) <= 1, "Navigate window is not anchored 12px inside the bottom-right corner.");
    assert(strip.leftGap >= 0 && strip.topGap >= 0, "Navigate window left the picture area for a wide strip.");
    assert(strip.imageHeight >= 27 && strip.imageWidth <= strip.viewWidth * 0.6 + 1, "A wide strip did not get a usable, bounded overview.");

    // --- Navigate window on an ordinary picture ---------------------------
    await load(page, flatSource(2400, 1600));
    await waitForNavigator(page, true);
    await command(page, "navigation-window", { mode: "auto" });
    await waitForNavigator(page, false);
    const fit = await page.evaluate(() => state.zoomPercent);
    // Closer than Fit but well under 100%: Auto must already show it.
    await page.evaluate((percent) => setCustomZoom(percent), Math.min(95, fit * 1.3));
    await ready(page);
    await waitForNavigator(page, true);
    report.belowActualSize = await page.evaluate(() => state.zoomPercent);
    assert(report.belowActualSize < 100 || fit >= 76, "The Auto check did not run below 100%.");
    await page.evaluate(() => setCustomZoom(300));
    await ready(page);
    const zoomed = await navigatorBox(page);
    report.zoomed = zoomed;
    assert(!zoomed.hidden && Math.abs(zoomed.rightGap - 12) <= 1 && Math.abs(zoomed.bottomGap - 12) <= 1, "Navigate window overlaps the scroll bars at 300%.");
    assert(zoomed.imageWidth <= 261 && zoomed.imageHeight <= 221, "Navigate window exceeded its size bounds.");
    await command(page, "navigation-window", { mode: "off" });
    await waitForNavigator(page, false);
    await command(page, "navigation-window", { mode: "auto" });

    // --- Perspective guides stay on the picture through a zoom -------------
    await page.evaluate(() => document.querySelector('.control-group[data-group="perspective"] .group-toggle').click());
    await page.locator("#perspective-vertical-tool").click();
    const guideOffset = () => page.evaluate(() => {
      const overlay = els.perspectiveEditorOverlay.getBoundingClientRect();
      const image = activePreviewElement().getBoundingClientRect();
      return Math.max(Math.abs(overlay.left - image.left), Math.abs(overlay.top - image.top),
        Math.abs(overlay.width - image.width), Math.abs(overlay.height - image.height));
    });
    for (const percent of [150, 60, 300]) {
      await page.evaluate((next) => setCustomZoom(next), percent);
      await page.waitForTimeout(150);
      const offset = await guideOffset();
      assert(offset <= 1, `Perspective guides drifted ${offset}px from the picture at ${percent}%.`);
    }
    assert(await page.locator("#perspective-apply-status").count() === 0, "The Perspective header still carries a status badge.");
    await page.locator("#perspective-cancel").click();
    await page.evaluate(() => setZoomMode("fit"));
    await ready(page);

    // --- Vignette scale and outline, on the SDR rendition ------------------
    await page.evaluate(() => switchLane("sdr"));
    await ready(page);
    await page.evaluate(() => document.querySelector(".vignette-group .group-toggle").click());
    const ungraded = await levelAt(page, 0.9, 0.5);
    await setSlider(page, "current.vignette.midpoint", 0);
    await setSlider(page, "current.vignette.feather", 100);
    await setSlider(page, "current.vignette.amount", -100);
    // The frame is 2400 x 1600, so 0.65 and 0.80 across are 0.45 and 0.90
    // vignette radii from the center; 0.14 down is 0.90 radii above it.
    const plain = { center: await levelAt(page, 0.5, 0.5), near: await levelAt(page, 0.65, 0.5),
      far: await levelAt(page, 0.8, 0.5), up: await levelAt(page, 0.5, 0.05) };
    await setSlider(page, "current.vignette.scale_x", 200);
    const wide = { far: await levelAt(page, 0.8, 0.5), up: await levelAt(page, 0.5, 0.05) };
    report.vignette = { ungraded, plain, wide };
    assert(plain.near < plain.center - 5 && plain.far < plain.near - 8, "The test vignette has no visible falloff to measure.");
    assert(Math.abs(wide.far - plain.near) <= 3, "Horizontal Scale 200% did not move the falloff to twice the distance.");
    assert(Math.abs(wide.up - plain.up) <= 2, "Horizontal Scale changed the vertical falloff.");
    await page.locator("#vignette-show-overlay").click();
    const outline = await page.evaluate(() => {
      const overlay = els.vignetteShapeOverlay.getBoundingClientRect();
      const image = activePreviewElement().getBoundingClientRect();
      const inner = els.vignetteShapeOverlay.querySelector(".vignette-shape-inner").getBBox();
      return { hidden: els.vignetteShapeOverlay.classList.contains("hidden"),
        offset: Math.max(Math.abs(overlay.left - image.left), Math.abs(overlay.width - image.width)),
        aspect: inner.width / inner.height, label: els.vignetteShowOverlay.textContent.trim() };
    });
    report.outline = outline;
    assert(!outline.hidden && outline.offset <= 1 && outline.label === "Hide overlay", "The Vignette outline did not appear over the picture.");
    assert(Math.abs(outline.aspect - 2) < 0.05, "The Vignette outline does not follow Horizontal Scale.");
    await page.locator("#vignette-show-overlay").click();

    // --- Before / After -----------------------------------------------------
    const after = await levelAt(page, 0.9, 0.5);
    await command(page, "compare-mode", { mode: "before" });
    await page.evaluate(() => beginCompareHold());
    await page.waitForFunction(() => els.previewStage.dataset.beforePeek === "true", null, { timeout: 30000 });
    await page.waitForTimeout(400);
    const before = await levelAt(page, 0.9, 0.5);
    await page.evaluate(() => endCompareHold());
    await page.waitForTimeout(300);
    const restored = await levelAt(page, 0.9, 0.5);
    report.beforeAfter = { after, before, restored };
    assert(before > after + 8, "Before did not show the picture without the vignette.");
    assert(Math.abs(before - ungraded) <= 1, "Before is not the picture as it was imported.");
    assert(Math.abs(restored - after) <= 1, "Releasing the peek did not return to the grade.");
    assert(await page.evaluate(() => viewerState().status === "ready"), "A Before peek disturbed the main preview.");
    await page.locator('[data-compare-layout="split-vertical"]').click();
    await page.waitForFunction(() => els.comparisonCanvas.style.display === "block", null, { timeout: 30000 });
    await page.waitForTimeout(400);
    const split = { labels: await page.evaluate(() => [els.comparisonLabelHdr.textContent, els.comparisonLabelSdr.textContent]),
      left: await levelAt(page, 0.1, 0.5), right: await levelAt(page, 0.9, 0.5) };
    report.split = split;
    assert(split.labels.join("/") === "BEFORE/AFTER", "Split labels do not read Before / After.");
    assert(split.left > split.right + 8, "The split does not show Before on the left and the grade on the right.");
    await page.locator('[data-compare-layout="single"]').click();
    await command(page, "compare-mode", { mode: "lanes" });
    assert(await page.evaluate(() => els.comparisonLabelHdr.textContent) === "HDR", "HDR / SDR labels did not return.");

    // --- Local Adjustments eye ----------------------------------------------
    const eye = page.locator("#local-adjustments-bypass");
    assert(await page.locator("#local-adjustment-count").count() === 0, "The Local Adjustments count is still shown.");
    await eye.click();
    assert(await page.evaluate(() => localsBypassed() && els.localAdjustmentGroup.classList.contains("bypassed")), "The eye did not switch Local Adjustments off.");
    await eye.click();
    assert(await page.evaluate(() => !localsBypassed()), "The eye did not switch Local Adjustments back on.");
    await ready(page);

    // --- Typed values ---------------------------------------------------------
    const typeInto = (selector, text) => page.evaluate(([target, value]) => {
      const output = document.querySelector(target);
      output.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      if (output.dataset.editing !== "true") return null;
      output.textContent = value;
      output.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return output.textContent.trim();
    }, [selector, text]);
    const typed = {
      sharpen: await typeInto('[data-value-path="current.detail.sharpen_amount"]', "150"),
      purity: await typeInto('[data-value-path="sdr.red_purity"]', "12.5"),
      // Beyond the slider's 2 EV, up to the 8 EV the grade can hold.
      exposure: await typeInto('[data-value-path="sdr.exposure"]', "5"),
      overlayOpacity: await typeInto('[data-value-path="shared.overlay_opacity"]', "37"),
      vignetteAmount: await typeInto('[data-value-path="current.vignette.amount"]', "-250"),
      // Last: typing in another module would cancel the Perspective draft.
      perspective: await typeInto("#perspective-rotate-value", "12.5"),
    };
    assert(typed.vignetteAmount === "-200%", "Vignette Amount cannot be typed to its -200% limit.");
    typed.stored = await page.evaluate(() => ({ sharpen: state.adjustments.sdr.detail.sharpen_amount,
      purity: state.adjustments.sdr.red_purity, exposure: state.adjustments.sdr.exposure,
      overlayOpacity: state.adjustments.shared.overlay_opacity, perspective: Number(els.perspectiveRotate.value) }));
    report.typed = typed;
    assert(typed.stored.sharpen === 150, "Sharpen cannot be typed up to its slider maximum of 200.");
    assert(typed.purity === "+12.5%" && typed.stored.purity === 12.5, "A typed Purity decimal is not shown as typed.");
    assert(typed.stored.exposure === 5, "Exposure cannot be typed beyond its slider.");
    assert(Math.abs(typed.stored.overlayOpacity - 0.37) < 1e-9, "A percentage readout was not typed as a percentage.");
    assert(typed.stored.perspective === 12.5, "The Perspective readout does not accept a typed value.");
    await page.locator("#perspective-cancel").click();
    await page.evaluate(() => {
      for (const [target, value] of [["sdr.detail.sharpen_amount", 0], ["sdr.red_purity", 0], ["sdr.exposure", 0], ["sdr.vignette.amount", -100]]) setValueByPath(state.adjustments, target, value);
      syncControlsFromState();
      invalidatePreview("sdr");
      debouncePreview("sdr");
    });
    await ready(page);

    // --- A crowded status bar ------------------------------------------------
    const crowded = await page.evaluate(() => {
      for (let index = 0; index < 14; index += 1) {
        HDRStatus.post({ id: `crowd-${index}`, severity: index === 13 ? "error" : "progress", message: `Background task number ${index} is running`, progress: "indeterminate" });
      }
      const dock = document.getElementById("viewer-status-dock").getBoundingClientRect();
      const shown = [...document.querySelectorAll("#application-status-entries > .status-entry")]
        .filter((entry) => getComputedStyle(entry).display !== "none");
      const result = {
        inside: shown.every((entry) => entry.getBoundingClientRect().right <= dock.right + 1 && entry.getBoundingClientRect().width >= 60),
        more: document.querySelector('[data-status-id="overflow"]')?.textContent || "",
        errorShown: shown.some((entry) => entry.dataset.statusId === "crowd-13"),
      };
      for (let index = 0; index < 14; index += 1) HDRStatus.clear(`crowd-${index}`);
      result.cleared = !document.querySelector('[data-status-id="overflow"]');
      return result;
    });
    report.crowded = crowded;
    assert(crowded.inside && /^\+\d+ more$/.test(crowded.more) && crowded.errorShown && crowded.cleared, "A crowded status bar did not fold gracefully.");

    // --- The View menu itself (Windows and Linux draw it in the page) -------
    if (await page.locator(".window-menu-bar").isVisible()) {
      await page.locator(".window-menu-trigger", { hasText: "View" }).click();
      await page.locator(".window-submenu-trigger", { hasText: "Navigate Window" }).hover();
      await page.locator('[data-navigation-window="always"]').click();
      await page.waitForFunction(() => state.navigationWindowMode === "always");
      assert(await page.locator('[data-navigation-window="always"]').getAttribute("aria-checked") === "true", "The menu does not tick the chosen Navigate Window mode.");
      await page.locator(".window-menu-trigger", { hasText: "View" }).click();
      await page.locator(".window-submenu-trigger", { hasText: "Preview Compares" }).hover();
      await page.locator('[data-compare-mode="before"]').click();
      assert(await page.evaluate(() => state.compareMode) === "before", "The menu did not choose Before / After.");
      await command(page, "compare-mode", { mode: "lanes" });
      await command(page, "navigation-window", { mode: "auto" });
      report.menu = "driven";
    } else report.menu = "native menu; not driven";

    console.log(JSON.stringify(report, null, 2));
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join("; ")}`);
    console.log("View tools interaction test passed.");
  } catch (error) {
    console.log(JSON.stringify(report, null, 2));
    if (warnings.length) console.error(`Console: ${warnings.slice(-8).join(" | ")}`);
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
