// Denoise zoomed in: only what is on screen is loaded and reconstructed.
//
//   node tests/run-in-electron.js tests/denoise-zoomed-region.js
//
// Zoomed in on a large frame the viewer fetches a region of the source, not the
// frame. Adaptive Denoise used to need the whole frame anyway -- seconds of
// loading on a 42 MP picture, repeated after every rotate or crop -- and its
// bypass did nothing until the view moved, because the tiles on screen did not
// know Denoise had changed. This proves, at 100% on a frame that large:
//
//   - Denoise draws from the region: the pass that puts it on screen reads a
//     region source, and no whole-frame reconstruction is made;
//   - the bypass takes effect at once, and turning it back on restores the
//     same pixels;
//   - the region's reconstruction is the whole frame's, to within a rounding
//     step of the source transport;
//   - a geometry change costs no whole-frame load either.

const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

// Big enough that 100% takes the tiled route and fetches a region.
const WIDTH = 7968;
const HEIGHT = 5320;
// Denoising the fixture moves well over this share of a noisy view; a bypass
// that does nothing moves none of it.
const MIN_DIFFERING_FRACTION = 0.005;
// Allow a cold upload and slower fallback, with room to report and stop
// before the release runner's 15-minute process deadline.
// Don't make the wait itself depend on the animation frames it is observing.
const WAIT_OPTIONS = { polling: 100, timeout: 120_000 };
const ATTEMPT_MS = 360_000;
const DIAGNOSTIC_MS = 5_000;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function previewSettled(diagnostics) {
  const lane = state.currentView;
  const viewer = viewerState();
  const coordinator = state.renderCoordinator?.state(lane);
  const accepted = state.acceptedPresentation;
  const runtime = state.denoiseRuntime?.[lane];
  const required = requiredProcessingLongEdge();
  const unmet = [];
  if (viewer.status !== "ready") unmet.push("viewer Ready");
  if (state.gpuDraftInFlight) unmet.push("GPU draft complete");
  if (state.zoomRefinementTimer) unmet.push("zoom refinement timer clear");
  if (coordinator?.panTimerPending || coordinator?.inFlight || coordinator?.pending) unmet.push("render coordinator idle");
  if (accepted?.processedLongEdge !== required) unmet.push("accepted picture at required size");
  if (!["ready", "error", "off"].includes(runtime?.status)) unmet.push("Denoise settled");
  if (!diagnostics) return viewer.status === "unavailable" || unmet.length === 0;

  const scheduler = state.previewScheduler;
  return {
    unmet,
    sessionReady: Boolean(state.session?.session_id),
    viewer,
    gpuAvailable: state.gpuPreview?.available,
    gpuDraftInFlightTier: state.gpuDraftInFlightTier,
    zoom: { mode: state.zoomMode, percent: state.zoomPercent },
    required,
    accepted: accepted && {
      generation: accepted.generation, processedLongEdge: accepted.processedLongEdge,
      execution: accepted.execution, coarse: accepted.coarse,
    },
    coordinator: coordinator && {
      inFlight: coordinator.inFlight, pending: coordinator.pending,
      panTimerPending: coordinator.panTimerPending, lastRefusal: coordinator.lastRefusal,
    },
    denoise: runtime && { status: runtime.status, error: runtime.error },
    scheduler: scheduler && {
      frame: scheduler.frame !== null, frameInFlight: scheduler.frameInFlight, framePending: scheduler.framePending,
    },
    watchdog: window.HDRFinisherPerformance?.previewWatchdog?.(),
    gpuFailures: state.gpuFailurePolicy?.snapshot?.().records?.slice(-5),
    visibility: document.visibilityState,
  };
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  let browser;
  let page;
  let phase = "generate or locate fixture";
  const pageErrors = [];
  const failedResponses = [];
  const startedAt = Date.now();
  const diagnose = async (write) => {
    const prefix = `[diagnostic +${Math.round((Date.now() - startedAt) / 1000)}s] ${phase}`;
    if (failedResponses.length) write(`${prefix} recent failed requests: ${JSON.stringify(failedResponses)}`);
    if (pageErrors.length) write(`${prefix} recent page errors: ${JSON.stringify(pageErrors.slice(-5))}`);
    if (!page) return;
    let timer;
    try {
      const value = await Promise.race([
        page.evaluate(previewSettled, true),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("renderer did not answer in 5 s")), DIAGNOSTIC_MS);
        }),
      ]);
      write(`${prefix}: ${JSON.stringify(value)}`);
    } catch (error) {
      write(`${prefix}: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  };
  console.log(`[denoise zoom] starting fixture and app (attempt limit ${ATTEMPT_MS / 1000} s)`);
  const heartbeat = setInterval(() => void diagnose(console.log), 60_000);
  // Some calls (notably an evaluation waiting on the GPU) have no
  // Playwright deadline. Keep this timer in Node, outside the renderer.
  const deadline = setTimeout(() => {
    process.exitCode = 1;
    clearInterval(heartbeat);
    console.error(`[denoise zoom] attempt timed out after ${ATTEMPT_MS / 1000} s during ${phase}`);
    void diagnose(console.error).finally(() => process.exit(1));
  }, ATTEMPT_MS);
  // A viewer that reports Unavailable stays so until new input. Fail with its
  // reason instead of waiting the whole deadline out for Ready.
  const assertNotUnavailable = async () => {
    const viewer = await page.evaluate(() => viewerState());
    assert(viewer.status !== "unavailable", `${phase}: the viewer is Unavailable: ${JSON.stringify(viewer)}`);
  };

  try {
    const source = ensureLargeNoisySource(WIDTH, HEIGHT);
    phase = "open app";
    browser = await chromium.launch({
      headless: true,
      channel: argument("--channel", "msedge"),
      args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.ok()) return;
      const url = new URL(response.url());
      const endpoint = url.pathname.match(/^\/api\/session\/[^/]+\/(.+)$/)?.[1];
      if (!endpoint) return;
      failedResponses.push({
        endpoint, method: response.request().method(), status: response.status(),
        edge: url.searchParams.get("long_edge"), revision: url.searchParams.get("edit_revision"),
      });
      if (failedResponses.length > 12) failedResponses.shift();
    });
    await page.goto(url, { waitUntil: "networkidle" });
    phase = "upload source";
    await page.setInputFiles("#file-input", source);
    phase = "wait for session";
    await page.waitForFunction(() => state.session?.session_id, null, WAIT_OPTIONS);
    phase = "wait for WebGPU";
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, WAIT_OPTIONS);
    phase = "first picture";
    await page.waitForFunction(() => ["ready", "unavailable"].includes(viewerState().status), null, WAIT_OPTIONS);
    await assertNotUnavailable();

    const settle = async () => {
      const step = phase;
      phase = `${step} / settle`;
      await page.waitForTimeout(100);
      await page.waitForFunction(previewSettled, false, WAIT_OPTIONS);
      await assertNotUnavailable();
      phase = `${step} / GPU queue`;
      await page.evaluate(async () => state.gpuPreview.waitForSubmittedWork());
      await page.waitForTimeout(700);
      phase = step;
    };
    // A fixed patch of the viewer's picture, clear of the status rows at its
    // top and the navigator in its corner. A fixed size, because the viewer's
    // own box changes with the panels around it and the captures are compared
    // pixel for pixel.
    const capture = async () => {
      const frame = await page.locator("#dropzone").boundingBox();
      const clip = { x: Math.round(frame.x) + 60, y: Math.round(frame.y) + 110, width: 400, height: 170 };
      assert(clip.x + clip.width < frame.x + frame.width * 0.75 && clip.y + clip.height < frame.y + frame.height * 0.7,
        `The viewer is too small for the comparison patch: ${JSON.stringify(frame)}`);
      return (await page.screenshot({ clip })).toString("base64");
    };
    const difference = (left, right) => page.evaluate(async ([a, b]) => {
      const pixels = async (encoded) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [x, y] = [await pixels(a), await pixels(b)];
      let max = 0;
      let differing = 0;
      for (let index = 0; index < x.length; index += 4) {
        const delta = Math.max(
          Math.abs(x[index] - y[index]), Math.abs(x[index + 1] - y[index + 1]), Math.abs(x[index + 2] - y[index + 2]),
        );
        if (delta > 0) differing += 1;
        if (delta > max) max = delta;
      }
      return { max, fraction: differing / (x.length / 4) };
    }, [left, right]);
    await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    const stageCount = () => page.evaluate(() => window.HDRFinisherPerformance.gpuSnapshot().stages?.length || 0);
    // `since` is a stage count: the tiled passes after it that reconstructed
    // Denoise, in order. The first is the one that put Denoise on screen; a
    // later whole-frame catch-up fills in the rest of the picture and may load
    // the frame for that, as it does with Denoise off.
    const sources = (since = 0) => page.evaluate((from) => {
      const denoise = state.gpuPreview.diagnosticsSnapshot().denoise;
      const passes = (window.HDRFinisherPerformance.gpuSnapshot().stages || []).slice(from)
        .filter((stage) => stage.stage === "tiled-render" && stage.denoiseTileResolves > 0);
      return {
        execution: state.acceptedPresentation?.execution,
        selected: denoise.selectedSource,
        status: state.denoiseRuntime[state.currentView].status,
        error: state.denoiseRuntime[state.currentView].error,
        wholeFrame: state.gpuPreview.proxies.has(denoise.identity),
        resolvedResident: denoise.resolvedResident,
        firstDenoisePass: passes.length ? { route: passes[0].sourceRoute, catchUp: passes[0].roiCatchUp } : null,
      };
    }, since);
    const toggle = async () => {
      await page.evaluate(() => document.querySelector("#denoise-bypass").click());
      await settle();
    };

    phase = "Denoise on at Fit";
    await page.evaluate(() => {
      const group = document.querySelector(".denoise-group .group-toggle");
      if (group.getAttribute("aria-expanded") !== "true") group.click();
      const amount = document.querySelector("#denoise-amount");
      amount.value = "1";
      amount.dispatchEvent(new Event("input", { bubbles: true }));
      amount.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Denoise goes on at Fit, as it does in use, so the zoom is what has to
    // bring it to the screen at full size.
    await toggle();
    assert(await page.evaluate(() => state.denoiseRuntime[state.currentView].status) === "ready",
      "Denoise did not become ready at Fit.");
    // With no masks the viewer fills in the rest of the frame behind a
    // zoomed view, loading the whole source for it. Held off here, so that
    // what is compared below was drawn from a region and nothing else.
    await page.evaluate(() => { state.renderCoordinator.canCatchUp = () => false; });

    let mark = await stageCount();
    phase = "zoom to 100%";
    await page.click("#zoom-actual");
    await settle();
    // The fixture is darkest, and noisiest to the eye, towards the top-left;
    // far enough in that the view has source on every side of it.
    phase = "pan at 100%";
    await page.evaluate(() => {
      els.dropzone.scrollLeft = 300;
      els.dropzone.scrollTop = 200;
      els.dropzone.dispatchEvent(new Event("scroll"));
    });
    await settle();
    let now = await sources(mark);
    assert(now.status === "ready", `Denoise did not become ready zoomed in: ${now.error}`);
    assert(now.execution === "tiled", `100% on a ${WIDTH}px frame was not tiled: ${now.execution}`);
    assert(now.firstDenoisePass?.route === "region" && !now.firstDenoisePass.catchUp,
      `Denoise did not reach the screen from a region of the source: ${JSON.stringify(now.firstDenoisePass)}`);
    assert(!now.wholeFrame, "Denoise loaded the whole frame's source to draw a zoomed-in view.");
    assert(!now.resolvedResident, "Denoise filled a whole-frame reconstruction for a tiled view.");
    const denoised = await capture();

    // The bypass, with the view left exactly where it is: what it shows must
    // be what a fresh draw with Denoise off shows.
    phase = "Denoise bypassed at 100%";
    await toggle();
    const bypassedView = await capture();
    phase = "fresh draw with Denoise off";
    await page.evaluate(() => {
      invalidatePreview(state.currentView, { markDirty: false });
      debouncePreview(state.currentView);
    });
    await settle();
    const plain = await capture();
    const bypassed = await difference(plain, bypassedView);
    assert(bypassed.max === 0,
      `The bypass left Denoise on screen zoomed in: ${(bypassed.fraction * 100).toFixed(2)}% still differs.`);
    const effect = await difference(plain, denoised);
    assert(effect.fraction > MIN_DIFFERING_FRACTION,
      `Denoise changed ${(effect.fraction * 100).toFixed(2)}% of the zoomed view.`);
    phase = "Denoise back on at 100%";
    await toggle();
    const restored = await difference(denoised, await capture());
    assert(restored.max === 0, `Turning Denoise back on did not restore the picture: max delta ${restored.max}.`);
    assert(!(await sources()).wholeFrame, "The whole frame was loaded before the reference pass asked for it.");

    // The reference: the same view with the whole frame's source loaded.
    phase = "whole-frame reference";
    await page.evaluate(async () => {
      const lane = state.currentView;
      await state.gpuPreview.loadProxy(
        state.session.session_id, lane, refinementProxyLongEdge(),
        JSON.stringify(state.adjustments.shared.geometry || {}), state.editRevision,
        "source", {},
      );
      invalidatePreview(lane, { markDirty: false });
      debouncePreview(lane);
    });
    await settle();
    now = await sources();
    assert(now.wholeFrame, "The reference pass did not have the whole frame loaded.");
    const parity = await difference(denoised, await capture());
    assert(parity.max <= 1,
      `Denoise from a region differs from the whole frame: max delta ${parity.max}, ${(parity.fraction * 100).toFixed(3)}%.`);

    // A geometry change: back at 100%, Denoise is on screen from a region again.
    phase = "zoom to Fit";
    await page.click("#zoom-fit");
    await settle();
    phase = "straighten at Fit";
    await page.evaluate(() => commitAdjustmentValue("shared.geometry.straighten_angle", 2, { manual: true }));
    await settle();
    mark = await stageCount();
    phase = "zoom to 100% after straighten";
    await page.click("#zoom-actual");
    await settle();
    now = await sources(mark);
    assert(now.status === "ready" && now.selected === "resolved",
      `Denoise was not ready after a straighten: ${JSON.stringify(now)}`);
    assert(now.execution === "tiled" && now.firstDenoisePass?.route === "region" && !now.firstDenoisePass.catchUp,
      `After a straighten Denoise did not reach the screen from a region: ${JSON.stringify(now)}`);
    assert(!now.resolvedResident, "A straighten made Denoise fill a whole-frame reconstruction.");

    assert(!pageErrors.length, "Page errors: " + pageErrors.join("; "));
    console.log(`Denoise zoomed in: region only, ${(effect.fraction * 100).toFixed(1)}% of the view denoised, `
      + `bypass exact, region equals whole frame to ${parity.max} level(s), region again after a straighten.`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`[denoise zoom] failed during ${phase}:`, error);
    await diagnose(console.error);
  } finally {
    clearInterval(heartbeat);
    phase = "close app";
    try {
      await browser?.close();
    } finally {
      clearTimeout(deadline);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
