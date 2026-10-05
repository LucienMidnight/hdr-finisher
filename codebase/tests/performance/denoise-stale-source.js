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

async function redrawErrors(page, viewport = false) {
  return page.evaluate(async (useViewport) => {
    const deadline = performance.now() + 120000;
    while (state.gpuDraftInFlight || state.previewScheduler?.frameInFlight
      || state.scopeRequestInFlight || state.gpuScopeRequestInFlight
      || state.pendingScopeRequest || state.pendingGpuScopeRequest
      || pendingHighlightAnchors.size || exactHighlightAnchorInflight.size
      || state.denoiseInputQueue?.busy) {
      if (performance.now() > deadline) throw new Error("Automatic setup work did not settle");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    state.previewScheduler.cancel();
    window.clearTimeout(state.refreshTimer);
    state.renderCoordinator.cancelCatchUp(state.currentView);
    state.renderCoordinator.cancelPan(state.currentView);
    const device = state.gpuPreview.device;
    device.pushErrorScope("validation");
    const rendered = await renderGpuDraft(state.currentView, { tier: "settled",
      longEdge: state.acceptedPresentation.processedLongEdge, viewport: useViewport });
    await device.queue.onSubmittedWorkDone();
    const error = await device.popErrorScope();
    return { rendered: Boolean(rendered), error: error?.message || null,
      execution: state.acceptedPresentation?.execution,
      selected: state.gpuPreview.denoiseSourceSelector?.selected };
  }, viewport);
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
    // Adaptive viewport Tiled keeps a model and has no original texture.
    // Exercise the still-reachable Direct selector explicitly before eviction;
    // both Direct and current viewport redraws below must survive the freed copy.
    const prepared = await redrawErrors(page, false);
    if (!prepared.rendered || prepared.error || prepared.execution !== "direct") {
      failures.push(`Direct selector setup did not run: ${JSON.stringify(prepared)}`);
    }
    await page.evaluate(() => setDenoiseEnabled(false));
    await idle(page);

    // Replace the native copy the way the cache does: evict (frees the
    // texture once no render holds it) and let the next render reload it.
    const replaced = await page.evaluate(async () => {
      const preview = state.gpuPreview;
      const selector = preview.denoiseSourceSelector;
      if (!selector?.original) return { error: "no denoise selector" };
      const key = selector.identity;
      if (preview.proxies.get(key) !== selector.original) return { error: "selector copy is not resident" };
      window.__evictedDenoiseOriginal = selector.original;
      preview.evictGpuCacheEntry("source-proxy", key);
      await preview.device.queue.onSubmittedWorkDone();
      return { key: key.split(":")[2], selectorHeldCopy: selector.original === window.__evictedDenoiseOriginal, evicted: !preview.proxies.has(key) };
    });
    if (replaced.error || !replaced.evicted || !replaced.selectorHeldCopy) failures.push(replaced.error || "Source was not evicted");

    const off = await redrawErrors(page);
    if (!off.rendered || off.error) failures.push(`denoise off after replacement: ${JSON.stringify(off)}`);
    const adopted = await page.evaluate(() => {
      const preview = state.gpuPreview, selector = preview.denoiseSourceSelector;
      return Boolean(selector?.original && selector.original !== window.__evictedDenoiseOriginal
        && selector.original === preview.proxies.get(selector.identity));
    });
    if (!adopted) failures.push("Direct selector did not adopt the reloaded live copy");
    const offViewport = await redrawErrors(page, true);
    if (!offViewport.rendered || offViewport.error || offViewport.execution !== "tiled") {
      failures.push(`viewport denoise off after replacement: ${JSON.stringify(offViewport)}`);
    }
    await page.evaluate(() => setDenoiseEnabled(true));
    await idle(page);
    const onViewport = await redrawErrors(page, true);
    if (!onViewport.rendered || onViewport.error || onViewport.execution !== "tiled"
      || onViewport.selected !== "resolved") {
      failures.push(`viewport denoise on after replacement: ${JSON.stringify(onViewport)}`);
    }
    const on = await redrawErrors(page);
    if (!on.rendered || on.error) failures.push(`denoise on after replacement: ${JSON.stringify(on)}`);

    if (off.execution !== "direct" || on.execution !== "direct") failures.push("Original Direct redraw coverage did not run");
    console.log(JSON.stringify({ prepared, replaced, adopted, off, offViewport, onViewport, on }, null, 2));
    if (failures.length) throw new Error(`Stale source test failed:\n  ${failures.join("\n  ")}`);
    console.log("Denoise stale source test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
