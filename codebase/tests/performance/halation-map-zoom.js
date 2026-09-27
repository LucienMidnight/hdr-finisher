// NEXT-01 #1 -- does the Show halation map change with preview resolution?
//
//   node tests/run-in-electron.js tests/performance/halation-map-zoom.js [--input path]
//
// Turns the HDR halation map on and captures the viewer at several zooms,
// with how each frame was rendered (processing size, tiled or direct,
// region). Screenshots go to output/halation-map-zoom/ for inspection.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const input = path.resolve(argument("--input", "local-test-media/inputs/Darktable-highlight-reconstruction_DSC06451.exr"));
  const zooms = argument("--zooms", "fit,50,100,200").split(",");
  const outputDirectory = path.resolve(argument("--output", "output/halation-map-zoom"));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-webgpu"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const idle = async () => {
    await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight
      && state.acceptedPresentation?.exact === true, null, { timeout: 900000 });
    await page.evaluate(async () => state.gpuPreview.device.queue.onSubmittedWorkDone());
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 900000 });
  };
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", input);
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 900000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) {
      await page.click("#accept-interpretation");
      await gate.waitFor({ state: "hidden" });
    }
    await page.evaluate(() => {
      activateWorkflowTab("grade");
      Object.assign(state.adjustments.hdr.film_look, {
        look_strength: 100, halation_enabled: true, halation_amount: 40, halation_view_map: true,
        grain_enabled: false, grain_amount: 0,
      });
      invalidatePreview("hdr");
      debouncePreview("hdr");
    });
    await idle();
    const rows = [];
    const tiers = argument("--tiers", "display,4096,full").split(",");
    for (const lane of ["hdr", "sdr"]) {
      await page.evaluate((selected) => {
        Object.assign(state.adjustments[selected].film_look, {
          look_strength: 100, halation_enabled: true, halation_amount: 40, halation_view_map: true,
          grain_enabled: false, grain_amount: 0,
        });
        if (state.currentView !== selected) void switchLane(selected);
        invalidatePreview(selected);
        debouncePreview(selected);
      }, lane);
      await page.evaluate(() => setZoomMode("fit"));
      for (const tier of tiers) {
        await page.evaluate((value) => {
          const select = document.querySelector("#settings-preview-resolution");
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }, tier);
        await page.waitForFunction((value) => viewerState().status === "ready" && !state.gpuDraftInFlight
          && state.acceptedPresentation?.exact === true && state.acceptedPresentation?.requestedTier === value,
        tier, { timeout: 900000 });
        await idle();
        const info = await page.evaluate(() => {
          const accepted = state.acceptedPresentation || {};
          return { lane: state.currentView, processedLongEdge: accepted.processedLongEdge, execution: accepted.execution };
        });
        const file = path.join(outputDirectory, `${lane}-${tier}.png`);
        await page.locator("#preview-canvas").screenshot({ path: file });
        rows.push({ tier, ...info, file });
        console.log(JSON.stringify({ tier, ...info }));
      }
    }
    fs.writeFileSync(path.join(outputDirectory, "report.json"), JSON.stringify({ input, rows, errors }, null, 2));
    if (errors.length) console.log("page errors:", errors.join("; "));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
