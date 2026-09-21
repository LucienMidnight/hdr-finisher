// PERF-07 -- the viewer must not go blank when the tier changes.
//
// Reported from manual testing: switching to Full and dragging shows one black
// frame, then every later drag is clean. `renderTiledTo` resizes the canvas
// when the tier changes, which discards the presented frame, and then spends
// seconds measuring the highlight peak, resolving denoise and encoding tiles
// before a single submit puts anything back. No resize on the second drag
// means no clear, which is why it happens once.
//
//   node tests/performance/tier-change-blank-canvas.js --url http://127.0.0.1:8765
//
// This exists because the PERF-03 harness reported zero blank frames and was
// wrong twice over: it sampled `style.display`, so a canvas that is visible
// and cleared read as fine, and it dragged only after the tier had settled,
// so no resize ever happened during the measurement. This samples pixels, and
// it samples across the tier change.
//
// Global gate 11.1: Full "must remain cancellable, visibly progressing,
// memory-bounded, and nonblocking". A canvas that is black for the whole
// first Full render is not visibly progressing.

const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const WIDTH = 7968;
const HEIGHT = 5320;

// Sampling cadence across the tier change. Fine enough to catch a window of a
// few hundred milliseconds, coarse enough not to stall the render being
// measured.
const SAMPLE_INTERVAL_MS = 40;

// A frame counts as blank when every sampled pixel is at or below this, out of
// 255. The clear value is opaque black, so a real photograph has to be very
// dark indeed to reach it -- the fixture is a mid-grey gradient.
const BLANK_LEVEL = 4;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const source = ensureLargeNoisySource(WIDTH, HEIGHT);

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
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    // Settle at 4K first, so the tier change to Full is a real resize from one
    // presented frame to another. Starting cold would confuse "nothing has
    // been drawn yet" with "what was drawn has been thrown away".
    await page.evaluate(() => {
      const select = document.querySelector("#preview-resolution");
      select.value = "4096";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () => viewerState().status === "ready" && state.acceptedPresentation?.exact === true,
      null, { timeout: 900000 },
    );
    await page.waitForTimeout(2000);

    const backend = [];
    page.on("requestfinished", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/\/preview(?:-raw)?\/(?:hdr|sdr)$/.test(pathname)) backend.push(pathname);
    });
    await page.evaluate(() => {
      state.cpuFallbacks = { settle: [], refine: [] };
      state.gpuDraftRefusals = {};
    });

    const result = await page.evaluate(async ({ interval, blankLevel }) => {
      const canvas = document.getElementById("preview-canvas");
      const image = document.getElementById("preview-image");

      // Downsample into a tiny 2D canvas. Reading the presentation surface
      // directly would be far too expensive at 7968 px and would perturb the
      // very render being measured.
      const scratch = document.createElement("canvas");
      scratch.width = 12;
      scratch.height = 12;
      const context = scratch.getContext("2d", { willReadFrequently: true });

      const samples = [];
      const sample = () => {
        const canvasShown = canvas.style.display !== "none";
        const imageShown = image.style.display !== "none";
        if (!canvasShown && !imageShown) {
          samples.push({ kind: "nothing-displayed", peak: 0 });
          return;
        }
        const element = canvasShown ? canvas : image;
        const width = element instanceof HTMLCanvasElement ? element.width : element.naturalWidth;
        const height = element instanceof HTMLCanvasElement ? element.height : element.naturalHeight;
        if (!(width > 0 && height > 0)) {
          samples.push({ kind: "zero-sized", peak: 0 });
          return;
        }
        try {
          context.clearRect(0, 0, scratch.width, scratch.height);
          context.drawImage(element, 0, 0, scratch.width, scratch.height);
          const data = context.getImageData(0, 0, scratch.width, scratch.height).data;
          let peak = 0;
          for (let index = 0; index < data.length; index += 4) {
            peak = Math.max(peak, data[index], data[index + 1], data[index + 2]);
          }
          samples.push({ kind: peak <= blankLevel ? "blank" : "painted", peak });
        } catch (error) {
          // A tainted or unreadable surface is not evidence of blankness.
          samples.push({ kind: "unreadable", peak: null });
        }
      };

      sample();
      const timer = setInterval(sample, interval);
      const startedAt = performance.now();

      const select = document.querySelector("#preview-resolution");
      select.value = "full";
      select.dispatchEvent(new Event("change", { bubbles: true }));

      const deadline = startedAt + 900000;
      while (performance.now() < deadline) {
        if (viewerState().status === "ready" && state.acceptedPresentation?.exact === true
          && state.acceptedPresentation?.requestedTier === "full") break;
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      clearInterval(timer);
      sample();

      const elapsedMs = performance.now() - startedAt;
      const blank = samples.filter((entry) => entry.kind === "blank").length;
      const nothing = samples.filter((entry) => entry.kind === "nothing-displayed").length;
      const unreadable = samples.filter((entry) => entry.kind === "unreadable").length;
      return {
        elapsedMs,
        total: samples.length,
        blank,
        nothing,
        unreadable,
        painted: samples.filter((entry) => entry.kind === "painted").length,
        execution: state.acceptedPresentation?.execution || null,
        transport: state.acceptedPresentation?.transport || null,
        cpuFallbacks: JSON.parse(JSON.stringify(state.cpuFallbacks)),
        refusals: { ...state.gpuDraftRefusals },
        lastRenderRefusal: state.gpuPreview?.lastRenderRefusal?.reason || null,
        firstBlankAt: samples.findIndex((entry) => entry.kind === "blank"),
      };
    }, { interval: SAMPLE_INTERVAL_MS, blankLevel: BLANK_LEVEL });

    console.log(
      "tier change 4K -> Full in " + Math.round(result.elapsedMs) + " ms, exec "
      + result.execution,
    );
    console.log(
      "  samples " + result.total
      + " | painted " + result.painted
      + " | blank " + result.blank
      + " | nothing displayed " + result.nothing
      + " | unreadable " + result.unreadable,
    );

    console.log("  transport " + result.transport
      + " | cpu fallbacks " + JSON.stringify(result.cpuFallbacks)
      + " | /preview requests " + backend.length);
    console.log("  refusals " + JSON.stringify(result.refusals)
      + " | last renderer refusal: " + result.lastRenderRefusal);

    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));

    // The measurement has to have been able to see anything at all, or zero
    // blanks means only that nothing was read.
    assert(result.unreadable === 0,
      "The presentation surface could not be read, so this run proves nothing: "
      + JSON.stringify(result));
    assert(result.painted > 0,
      "No sample ever showed a painted frame, so the sampler is not working: "
      + JSON.stringify(result));
    assert(result.execution === "tiled",
      "Full did not tile, so the path under test was not exercised: "
      + JSON.stringify(result));

    assert(result.blank === 0 && result.nothing === 0,
      "The viewer went blank across the tier change: " + result.blank
      + " black and " + result.nothing + " nothing-displayed of " + result.total
      + " samples over " + Math.round(result.elapsedMs) + " ms, first at sample "
      + result.firstBlankAt + ". Global gate 11.1 requires Full to remain visibly "
      + "progressing.");

    console.log("The viewer stays painted across a tier change.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
