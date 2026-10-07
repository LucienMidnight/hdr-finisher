const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function checkPerspectiveOwnership(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    state.previewScheduler.cancel();
    state.previewCache[state.currentView] = null;
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      const body = args[1]?.body && JSON.parse(args[1].body);
      if (/\/preview\/(hdr|sdr)$/.test(String(args[0])) && body && !body.transient_adjustments && response.ok) {
        window.fetch = original;
        const blob = await response.blob();
        response.blob = async () => {
          await new Promise((resolve) => { window.releaseOldPerspectiveFrame = resolve; });
          return blob;
        };
      }
      return response;
    };
    window.oldPerspectiveFrame = renderPreviewForLane(state.currentView, true, 768, { raw: false, showProgress: false });
  });
  await page.waitForFunction(() => Boolean(window.releaseOldPerspectiveFrame), null, { timeout: 60000 });
  const slider = page.locator("#perspective-horizontal");
  await slider.evaluate((control) => {
    control.value = "29";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => state.perspectiveGpuDraft
    && state.perspectiveDraftFrame?.signature === geometrySignature(), null, { timeout: 60000 });
  const draft = await page.locator("#preview-canvas").screenshot();
  await page.evaluate(async () => { window.releaseOldPerspectiveFrame(); await window.oldPerspectiveFrame; });
  assert.deepEqual(await page.locator("#preview-canvas").screenshot(), draft, "A late committed frame replaced the GPU draft");
  assert.equal(await page.evaluate(() => state.previewCache[state.currentView]), null, "Late frame contaminated the committed cache");
  const requests = [];
  const onRequest = (request) => { if (/\/preview(?:-raw)?\/(hdr|sdr)$/.test(request.url())) requests.push(request.url()); };
  page.on("request", onRequest);
  await page.evaluate(async () => {
    await refinePreview(state.currentView);
    await renderPreviewForLane(state.currentView, true, 768);
    await renderRawPreviewForLane(state.currentView, true, 768);
    await renderGpuDraft(state.currentView);
    await showCachedPreview(state.currentView);
  });
  page.off("request", onRequest);
  assert.equal(requests.length, 0, "Ordinary rendering ran while Perspective owned the draft");
  assert.deepEqual(await page.locator("#preview-canvas").screenshot(), draft);
  await page.locator("#perspective-cancel").click();
  await page.waitForFunction(() => state.acceptedPresentation?.geometrySignature === geometrySignature()
    && !state.perspectiveMode && state.acceptedPresentation?.exact, null, { timeout: 60000 });

  // Explicit CPU preview still works, and cancels without committing geometry.
  const original = await page.evaluate(() => ({ mode: state.renderingMode, revision: state.editRevision,
    geometry: structuredClone(state.adjustments.shared.geometry) }));
  await page.evaluate(() => { state.renderingMode = "cpu"; });
  await slider.evaluate((control) => {
    control.value = "-22";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => state.perspectivePreviewUrl && els.previewImage.src === state.perspectivePreviewUrl,
    null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => state.editRevision), original.revision);
  assert.equal(await page.evaluate(() => Boolean(state.perspectiveGpuDraft)), false);
  await page.evaluate((mode) => { state.renderingMode = mode; }, original.mode);
  await page.locator("#perspective-cancel").click();
  assert.deepEqual(await page.evaluate(() => state.adjustments.shared.geometry), original.geometry);
  console.log("Late-frame draft ownership, refinement isolation and CPU fallback passed.");
}

module.exports = { checkPerspectiveOwnership };
if (require.main === module) {
  (async () => {
    const browser = await chromium.launch({ headless: true, channel: "msedge" });
    try {
      const page = await browser.newPage();
      await page.goto(process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Load test pattern" }).click();
      await page.waitForFunction(() => state.acceptedPresentation?.exact, null, { timeout: 60000 });
      await page.locator('[data-group="perspective"] .group-toggle').click();
      await checkPerspectiveOwnership(page);
    } finally { await browser.close(); }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
