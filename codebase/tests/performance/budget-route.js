// Preview Responsiveness Tuning Sprint P2: Direct GPU is chosen when it
// should be, and a memory-setting change takes effect within one second.
//
//   node tests/run-in-electron.js tests/performance/budget-route.js [--packaged]
//
// On the 42.4 MP fixture with the memory setting on Auto:
//   1. Auto reports its source (detected card memory, or the 2 GiB fallback).
//   2. At Fit, 100% and 200% a settled edit presents through Direct, and the
//      Execution readout names the route the last plan actually chose.
//   3. Changing the limit to 1 GiB presents a new frame on the new route
//      (Tiled) within 1 s with no edit, and the readout matches the plan;
//      returning to Auto does the same back to Direct.
//
// Step 2 expects Direct only when the calibrated Auto budget can hold a native
// 42 MP graph; on a machine without a detected card it records the route and
// reports the fallback instead of failing.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/budget-route.json"));

async function waitForIdle(page, timeout = 300000) {
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout }).catch(() => null);
  await page.waitForTimeout(600);
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout }).catch(() => null);
}

async function settledEdit(page) {
  await page.evaluate(() => {
    const control = document.querySelector('[data-path="hdr.exposure"]');
    control.value = String(Number(control.value) >= 0 ? -0.2 : 0.2);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForIdle(page);
  return page.evaluate(() => ({
    zoom: state.zoomMode === "fit" ? "fit" : Math.round(state.zoomPercent),
    planMode: state.gpuPreview?.lastRenderPlan?.decision?.mode || null,
    admitted: state.gpuPreview?.lastRenderPlan?.decision?.admitted ?? null,
    peakMiB: Math.round((state.gpuPreview?.lastRenderPlan?.totals?.peakLogicalBytes || 0) / 1048576),
    budgetMiB: Math.round((state.gpuPreview?.lastRenderPlan?.budgetBytes || 0) / 1048576),
    execution: state.acceptedPresentation?.execution || null,
    readout: previewExecutionLabel(),
  }));
}

async function changeBudget(page, value) {
  return page.evaluate(async (setting) => {
    const before = state.acceptedPresentation?.sourceSerial ?? null;
    const startedAt = performance.now();
    const presented = new Promise((resolve) => {
      const listener = () => {
        window.removeEventListener("hdrfinisher:preview-presented", listener);
        resolve(performance.now() - startedAt);
      };
      window.addEventListener("hdrfinisher:preview-presented", listener);
      setTimeout(() => resolve(null), 3000);
    });
    applyGpuMemoryBudget(setting);
    const presentedMs = await presented;
    // The route is final once the viewer is ready again.
    const readyBy = performance.now() + 3000;
    while (viewerState().status !== "ready" && performance.now() < readyBy) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return {
      setting,
      presentedMs,
      readyMs: performance.now() - startedAt,
      newPresentation: (state.acceptedPresentation?.sourceSerial ?? null) !== before,
      planMode: state.gpuPreview?.lastRenderPlan?.decision?.mode || null,
      readout: previewExecutionLabel(),
    };
  }, value);
}

const readoutMatches = (row) => (row.planMode === "tiled" ? /^Tiled GPU/ : /^Direct GPU/).test(row.readout || "");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const failures = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", ensureLargeNoisySource(7968, 5320));
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 300000 });
    await waitForIdle(page, 900000);
    await page.evaluate(() => applyGpuMemoryBudget("auto"));
    await waitForIdle(page);
    const calibration = await page.evaluate(() => ({
      source: state.gpuPreview.gpuBudget?.source || null,
      budgetGiB: (state.gpuPreview.memoryBudgetBytes() / 1073741824),
      detectedGiB: state.gpuPreview.gpuBudget?.detectedBytes ? state.gpuPreview.gpuBudget.detectedBytes / 1073741824 : null,
      label: window.HDRGpuBudget.autoLabel?.(state.gpuPreview.gpuBudget) ?? null,
    }));
    const detectedCard = calibration.source === "detected-vram";

    const routes = [];
    for (const zoom of ["fit", 100, 200]) {
      await page.evaluate((value) => (value === "fit" ? setZoomMode("fit") : setCustomZoom(value)), zoom);
      await waitForIdle(page);
      const row = await settledEdit(page);
      routes.push(row);
      if (!readoutMatches(row)) failures.push(`readout "${row.readout}" does not match the ${row.planMode} plan at ${zoom}`);
      if (detectedCard && row.planMode !== "direct") failures.push(`expected Direct at ${zoom} on Auto, got ${row.planMode}`);
    }

    const lowered = await changeBudget(page, 1);
    const restored = await changeBudget(page, "auto");
    for (const [row, expected] of [[lowered, "tiled"], [restored, detectedCard ? "direct" : null]]) {
      if (!(row.presentedMs !== null && row.presentedMs <= 1000)) failures.push(`budget ${row.setting}: no new presentation within 1 s (${row.presentedMs})`);
      if (!row.newPresentation) failures.push(`budget ${row.setting}: the presentation did not change`);
      if (expected && row.planMode !== expected) failures.push(`budget ${row.setting}: expected ${expected}, got ${row.planMode}`);
      if (!readoutMatches(row)) failures.push(`budget ${row.setting}: readout "${row.readout}" does not match the ${row.planMode} plan`);
    }
    const report = { recordedAt: new Date().toISOString(), calibration, routes, budgetChanges: [lowered, restored], failures, pageErrors };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join("; ")}`);
    if (failures.length) throw new Error(`Budget route test failed:\n  ${failures.join("\n  ")}`);
    console.log("Budget route test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
