// A replaced source copy never leaves the preview drawing from freed memory
// (owner report 2026-09-25: black preview, app still "Ready").
//
//   node tests/run-in-electron.js tests/performance/denoise-stale-source.js
//
// Denoise on, then off, at native zoom; then the source cache replaces the
// native copy (the old texture is freed, as a same-key reload or an eviction
// followed by a reload does). A redraw, and a denoise rebuild after turning it
// back on, must submit without a GPU validation error. Before the fix the
// denoise selector kept the freed copy and every frame was rejected ("Destroyed
// texture ... used in a submit"), which presents black.

const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");

async function idle(page) {
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
  await page.waitForTimeout(500);
}

async function redrawErrors(page) {
  return page.evaluate(async () => {
    const device = state.gpuPreview.device;
    device.pushErrorScope("validation");
    const rendered = await renderGpuDraft(state.currentView, { tier: "settled", longEdge: state.acceptedPresentation.processedLongEdge });
    await device.queue.onSubmittedWorkDone();
    const error = await device.popErrorScope();
    return { rendered: Boolean(rendered), error: error?.message || null };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const failures = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", option("--input", "") ? path.resolve(option("--input", "")) : ensureLargeNoisySource(4200, 2800));
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 900000 });
    await idle(page);
    await page.evaluate(() => setCustomZoom(200));
    await idle(page);
    await page.evaluate(() => setDenoiseEnabled(true));
    await idle(page);
    await page.evaluate(() => setDenoiseEnabled(false));
    await idle(page);

    // Replace the native copy the way the cache does: evict (frees the
    // texture once no render holds it) and let the next render reload it.
    const replaced = await page.evaluate(async () => {
      const preview = state.gpuPreview;
      const selector = preview.denoiseSourceSelector;
      if (!selector?.original) return { error: "no denoise selector" };
      const key = selector.identity;
      preview.evictGpuCacheEntry("source-proxy", key);
      await preview.device.queue.onSubmittedWorkDone();
      return { key: key.split(":")[2], selectorHeldCopy: true };
    });
    if (replaced.error) failures.push(replaced.error);

    const off = await redrawErrors(page);
    if (!off.rendered || off.error) failures.push(`denoise off after replacement: ${JSON.stringify(off)}`);
    await page.evaluate(() => setDenoiseEnabled(true));
    await idle(page);
    const on = await redrawErrors(page);
    if (!on.rendered || on.error) failures.push(`denoise on after replacement: ${JSON.stringify(on)}`);

    console.log(JSON.stringify({ replaced, off, on }, null, 2));
    if (failures.length) throw new Error(`Stale source test failed:\n  ${failures.join("\n  ")}`);
    console.log("Denoise stale source test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
