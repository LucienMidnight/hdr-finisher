// NEXT-01 #4 -- a zoomed-in Denoise drag reconstructs only what is on
// screen; release uses current controls and a subsequent whole-frame view
// must equal a fresh reconstruction, without stale pixels offscreen.
//
//   node tests/run-in-electron.js tests/performance/denoise-drag-region.js
//
// Negative controls:
//   - during the drag every reconstruction is a region, none is whole-frame
//     (a whole-frame one per step was the GPU heat at 200%)
//   - the subsequent Full/Fit result equals a fresh whole-frame
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

    const region = await page.evaluate(() => {
      if (state.acceptedPresentation?.execution !== "tiled") return null;
      return state.gpuPreview.tiledExecutionMetrics?.viewport || liveDenoiseRegion();
    });
    assert(region && region.width * region.height < WIDTH * HEIGHT,
      `At 200% the live region should be part of the frame, got ${JSON.stringify(region)}.`);

    await page.evaluate(async (steps) => {
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      state.gpuPreview.performanceMetrics.stages = [];
      // Adaptive Tiled encodes reconstruction in the viewer's shared encoder;
      // that route has no standalone denoise-resolve ready stage. Observe actual
      // successful encodes too, preserving the original renderer promise.
      window.__dragDenoiseResolves = [];
      window.__dragOriginalResolve = state.gpuPreview.resolveDenoiseProxy;
      state.gpuPreview.resolveDenoiseProxy = function (controls, options = {}) {
        const region = options.region
          ? `${options.region.x},${options.region.y},${options.region.width},${options.region.height}` : "whole";
        const pending = window.__dragOriginalResolve.call(this, controls, options);
        pending.then((value) => {
          if (value?.encoded) window.__dragDenoiseResolves.push(region);
        }, () => {});
        return pending;
      };
      const control = document.getElementById("denoise-amount");
      control.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1, isPrimary: true }));
      for (let step = 1; step <= steps; step += 1) {
        control.value = String(0.5 + 0.4 * step / steps);
        control.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }, STEPS);
    // Let the queued reconstructions finish while still "dragging".
    await page.waitForFunction(() => !state.denoiseInputQueue?.busy
      && !state.gpuDraftInFlight && !state.previewScheduler?.frameInFlight, null, { timeout: 120000 });
    const during = await page.evaluate(async () => {
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      state.gpuPreview.resolveDenoiseProxy = window.__dragOriginalResolve;
      return state.gpuPreview.performanceMetrics.stages
        .filter((entry) => entry.stage === "denoise-resolve" && entry.state === "ready")
        .map((entry) => entry.region).concat(window.__dragDenoiseResolves);
    });
    assert(during.length > 0, "The drag reconstructed nothing.");
    assert(during.every((value) => value !== "whole"),
      `A zoomed-in drag ran ${during.filter((value) => value === "whole").length} whole-frame reconstructions: ${JSON.stringify(during)}`);
    assert(during.every((value) => {
      const rect = String(value).split(",").map(Number);
      return rect.length === 4 && rect.every(Number.isFinite) && rect[2] > 0
        && rect[3] > 0 && rect[2] * rect[3] < WIDTH * HEIGHT;
    }), `Reconstruction regions did not exercise bounded work: ${JSON.stringify(during)}`);
    assert(await page.evaluate(() => Boolean(state.denoiseWholeFrameStale)), "The drag did not mark the whole frame out of date.");

    await page.evaluate(() => {
      const control = document.getElementById("denoise-amount");
      control.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await idle(page);

    const releasedState = await page.evaluate(() => ({
      stale: Boolean(state.denoiseWholeFrameStale),
      amount: state.gpuPreview.denoiseSourceSelector?.controls?.amount,
      execution: state.acceptedPresentation?.execution,
      exact: state.acceptedPresentation?.exact,
    }));
    assert(!releasedState.stale && releasedState.exact && releasedState.execution === "tiled",
      `The released viewport did not settle: ${JSON.stringify(releasedState)}`);
    assert(Math.abs(releasedState.amount - 0.9) < 1e-6,
      `The released viewport controls are stale: ${JSON.stringify(releasedState)}`);

    // Adaptive viewport rendering does not keep a whole reconstruction. Exercise
    // the next whole-frame view before taking the original exhaustive readback:
    // it must reconstruct with the released controls, not revive an old frame.
    await page.evaluate(() => {
      const select = document.querySelector("#settings-preview-resolution");
      select.value = "full";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      setZoomMode("fit");
    });
    await idle(page);
    await page.waitForFunction(() => state.acceptedPresentation?.requestedTier === "full"
      && state.acceptedPresentation?.execution === "direct"
      && state.gpuPreview.denoiseSourceSelector?.original
      && state.gpuPreview.denoiseSourceSelector?.resolved, null, { timeout: 300000 });

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
    console.log(`Denoise drag region test passed (${during.length} region reconstructions; released ${JSON.stringify(releasedState)}; subsequent Full/Fit ${result.total} values, ${result.differing} differences).`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
