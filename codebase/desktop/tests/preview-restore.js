const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "../..");
  const output = path.join(root, "output", "preview-menu");
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, "restore-"));
  const app = await electron.launch({
    executablePath: process.env.HDR_FINISHER_PACKAGED_EXECUTABLE,
    args: [process.env.HDR_FINISHER_MENU_PROJECT],
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userData },
  });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("Renderer error:", error.message));
    await page.waitForFunction(() => typeof state !== "undefined" && state.acceptedPresentation, null, { timeout: 90000 });
    if (process.env.HDR_FINISHER_TEST_SOURCE_PATCH === "1") {
      const source = fs.readFileSync(path.join(root, "frontend/app.js"), "utf8");
      const restore = source.slice(source.indexOf("async function showCachedPreview("), source.indexOf("function prepareInactivePreview("));
      await page.evaluate(`globalThis.showCachedPreview = (${restore}); void 0;`);
    }
    await page.evaluate(() => applyPreviewResolution("4096"));
    const waitRefined = () => page.waitForFunction(() => state.acceptedPresentation?.tier === "refinement"
      && state.acceptedPresentation.generation === state.previewGeneration[state.currentView]
      && state.acceptedPresentation.longEdge > 2000, null, { timeout: 15000 });
    await waitRefined();
    await page.locator('[data-compare-layout="side-horizontal"]').click();
    await page.evaluate(() => {
      const control = document.querySelector("#hdr-exposure");
      const group = control.closest(".control-group");
      if (group?.classList.contains("collapsed")) group.querySelector(".group-toggle").click();
    });
    const exposureBefore = await page.evaluate(() => state.adjustments.hdr.exposure);
    await page.locator("#hdr-exposure").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((previous) => state.adjustments.hdr.exposure !== previous, exposureBefore);
    await waitRefined();
    await page.locator("#compare-button").click();
    await page.waitForFunction(() => state.compareLayout === "single" && state.gpuPreview.activeRenderCount === 0);
    // A stale label alone is insufficient: assert the actual restored canvas.
    await waitRefined();
    assert.equal(await page.evaluate(() => Math.max(els.previewCanvas.width, els.previewCanvas.height) > 2000), true);
    console.log("Single-frame restoration preserves the selected 4K preview after exposure editing.");
    await page.evaluate(async () => { await preloadInactiveLane("sdr", state.previewGeneration.sdr); await peekOtherLane(); await restoreActiveLane(); });
    await waitRefined();
    console.log("Comparison peek restores the selected 4K preview.");
  } finally {
    const page = (await app.windows())[0];
    if (page) console.log(JSON.stringify(await page.evaluate(() => ({ target: state.previewResolution,
      accepted: state.acceptedPresentation, actual: [els.previewCanvas.width, els.previewCanvas.height],
      scheduler: { current: state.previewScheduler.current, interacting: state.previewScheduler.interacting,
        frameInFlight: state.previewScheduler.frameInFlight, scopeInFlight: state.previewScheduler.scopeInFlight },
      generation: state.previewGeneration, dirty: state.globalEditDirty })).catch(() => null)));
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
