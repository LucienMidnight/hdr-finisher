const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const codebase = path.resolve(__dirname, "../..");
  const output = path.join(codebase, "output", "preview-menu");
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, "profile-"));
  fs.writeFileSync(path.join(userData, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1, renderingMode: "auto", updates: { checkAutomatically: false },
  }));
  const app = await electron.launch({
    executablePath: process.env.HDR_FINISHER_PACKAGED_EXECUTABLE,
    args: process.env.HDR_FINISHER_MENU_PROJECT ? [process.env.HDR_FINISHER_MENU_PROJECT] : [],
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userData },
  });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("Renderer error:", error.message));
    await page.waitForFunction(() => typeof state !== "undefined" && Boolean(state.previewScheduler));
    if (!process.env.HDR_FINISHER_MENU_PROJECT) {
      if (process.env.HDR_FINISHER_MENU_FIXTURE) await page.locator("#file-input").setInputFiles(process.env.HDR_FINISHER_MENU_FIXTURE);
      else await page.locator("#test-pattern-button").click();
    }
    await page.waitForFunction(() => Boolean(state.acceptedPresentation), null, { timeout: 60000 });
    const timings = [];
    // P5: the Preview response menu became one checkbox. The check is still
    // that the control reacts at once to a real click while previews refine.
    for (const value of [false, true, false, true, false]) {
      if (await page.locator("#preview-popover").isVisible()) await page.locator("#preview-close").click();
      await page.locator("#zoom-fit").click();
      const image = await page.evaluate(() => { const rect = activePreviewElement().getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; });
      await page.mouse.move(image.x, image.y);
      for (let zoom = 0; zoom < 20; zoom++) await page.mouse.wheel(0, zoom % 2 ? 160 : -160);
      const slider = await page.locator("#zoom-slider").boundingBox();
      await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2);
      await page.mouse.down();
      for (let zoom = 0; zoom < 20; zoom++) {
        await page.mouse.move(slider.x + slider.width * (zoom % 2 ? 0.6 : 0.3), slider.y + slider.height / 2);
      }
      await page.mouse.up();
      if (!await page.locator("#preview-popover").isVisible()) await page.locator("#preview-toggle").click();
      const started = Date.now();
      // A real click and change event, not a scripted value.
      if (await page.locator("#preview-faster-dragging").isChecked() !== value) {
        await page.locator("#preview-faster-dragging").click();
      }
      await page.waitForFunction((expected) => state.fasterDragging === expected, value, { timeout: 3000 });
      timings.push(Date.now() - started);
      assert.equal(await page.locator("#preview-popover").isVisible(), true);
      try {
        await page.waitForFunction(() => {
          const accepted = state.acceptedPresentation;
          return accepted?.generation === state.previewGeneration[state.currentView]
            && accepted.lane === state.currentView
            && (accepted.tier === "refinement" || !previewNeedsRefinement())
            && !document.querySelector("#preview-quality-status").textContent.includes("Refining");
        }, null, { timeout: 30000 });
      } finally {
        console.log(JSON.stringify(await page.evaluate(() => ({
          fasterDragging: state.fasterDragging, accepted: state.acceptedPresentation,
          target: previewTargetLongEdge(), quality: els.previewQualityStatus.textContent,
          generation: state.previewGeneration, geometryDraft: geometryDraftActive(),
          scheduler: { current: state.previewScheduler.current, interacting: state.previewScheduler.interacting,
            frameInFlight: state.previewScheduler.frameInFlight, scopeInFlight: state.previewScheduler.scopeInFlight },
          gpu: { available: state.gpuPreview.available, detail: state.gpuPreview.detail,
            activeRenders: state.gpuPreview.activeRenderCount, activeScopes: state.gpuPreview.activeScopeCount },
        }))));
      }
    }
    console.log(JSON.stringify({ result: "passed", toggleMilliseconds: timings,
      rendering: await page.evaluate(() => ({ mode: state.renderingMode, gpuAvailable: Boolean(state.gpuPreview?.available) })) }));
  } finally {
    // This isolated profile contains only the fixture loaded by this test.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
