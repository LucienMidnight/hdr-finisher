// NEXT-01 #4 -- a zoomed-in Denoise drag reconstructs only what is on
// screen, and the whole frame is brought up to date on release.
//
//   node tests/run-in-electron.js tests/performance/denoise-drag-region.js
//
// Negative controls:
//   - during the drag every reconstruction is a region, none is whole-frame
//     (a whole-frame one per step was the GPU heat at 200%)
//   - after release the whole-frame result equals a fresh whole-frame
//     reconstruction with the final controls, so no stale area is left off
//     screen for a later pan or zoom-out to show

const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const WIDTH = 2400;
const HEIGHT = 1600;
const STEPS = 30;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function idle(page) {
  await page.waitForFunction(
    () => viewerState().status === "ready" && !state.gpuDraftInFlight && !state.denoiseInputQueue?.busy,
    null, { timeout: 300000 },
  );
  await page.waitForTimeout(500);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", ensureLargeNoisySource(WIDTH, HEIGHT));
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 300000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    await page.evaluate(() => {
      activateWorkflowTab("grade");
      const group = document.querySelector(".denoise-group .group-toggle");
      if (group.getAttribute("aria-expanded") !== "true") group.click();
      document.querySelector("#denoise-bypass").click();
    });
    await page.waitForFunction(() => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status), null, { timeout: 300000 });
    assert(await page.evaluate(() => state.denoiseRuntime[state.currentView].status) === "ready", "Denoise did not become ready.");
    await page.evaluate(() => setCustomZoom(200));
    await idle(page);

    const region = await page.evaluate(() => liveDenoiseRegion());
    assert(region && region.width * region.height < WIDTH * HEIGHT,
      `At 200% the live region should be part of the frame, got ${JSON.stringify(region)}.`);

    await page.evaluate(async (steps) => {
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      state.gpuPreview.performanceMetrics.stages = [];
      const control = document.getElementById("denoise-amount");
      control.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1, isPrimary: true }));
      for (let step = 1; step <= steps; step += 1) {
        control.value = String(0.5 + 0.4 * step / steps);
        control.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }, STEPS);
    // Let the queued reconstructions finish while still "dragging".
    await page.waitForFunction(() => !state.denoiseInputQueue?.busy, null, { timeout: 120000 });
    const during = await page.evaluate(() => state.gpuPreview.performanceMetrics.stages
      .filter((entry) => entry.stage === "denoise-resolve" && entry.state === "ready")
      .map((entry) => entry.region));
    assert(during.length > 0, "The drag reconstructed nothing.");
    assert(during.every((value) => value !== "whole"),
      `A zoomed-in drag ran ${during.filter((value) => value === "whole").length} whole-frame reconstructions: ${JSON.stringify(during)}`);
    assert(await page.evaluate(() => Boolean(state.denoiseWholeFrameStale)), "The drag did not mark the whole frame out of date.");

    await page.evaluate(() => {
      const control = document.getElementById("denoise-amount");
      control.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await idle(page);

    const result = await page.evaluate(async () => {
      const preview = state.gpuPreview;
      const selector = preview.denoiseSourceSelector;
      const { width, height } = selector.original;
      const released = await preview.readDenoiseResolvedRegion(width, height, 0, 0);
      await preview.resolveDenoiseProxy(denoiseRendererControls(state.denoise[state.currentView].controls));
      const fresh = await preview.readDenoiseResolvedRegion(width, height, 0, 0);
      let differing = 0;
      for (let index = 0; index < fresh.values.length; index += 1) {
        if (released.values[index] !== fresh.values[index]) differing += 1;
      }
      return {
        stale: Boolean(state.denoiseWholeFrameStale),
        amount: selector.controls.amount,
        differing,
        total: fresh.values.length,
      };
    });
    assert(!result.stale, "The whole frame is still marked out of date after release.");
    assert(Math.abs(result.amount - 0.9) < 1e-6, `The released amount is ${result.amount}, not 0.9.`);
    assert(result.differing === 0,
      `${result.differing} of ${result.total} values differ from a fresh whole-frame reconstruction after release.`);
    assert(!pageErrors.length, `Page errors: ${pageErrors.join("; ")}`);
    console.log(`Denoise drag region test passed (${during.length} region reconstructions during the drag).`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
