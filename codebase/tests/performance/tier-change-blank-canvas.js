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

async function compositorSample(page) {
  const visible = await page.evaluate(() => ({
    canvas: document.getElementById("preview-canvas")?.style.display !== "none",
    image: document.getElementById("preview-image")?.style.display !== "none",
    status: viewerState().status,
  }));
  if (!visible.canvas && !visible.image) return { kind: "nothing-displayed", peak: 0, ...visible };
  const selector = visible.canvas ? "#preview-canvas" : "#preview-image";
  const box = await page.locator(selector).boundingBox();
  if (!box || !(box.width > 0 && box.height > 0)) {
    return { kind: "nothing-displayed", peak: 0, ...visible };
  }
  // Clip a screenshot of the page compositor. An element screenshot can read
  // the canvas resource directly and miss the black frame actually composited
  // into the viewer, which is the defect this harness exists to catch.
  const png = await page.screenshot({ clip: box });
  const peak = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let value = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      value = Math.max(value, pixels[index], pixels[index + 1], pixels[index + 2]);
    }
    return value;
  }, `data:image/png;base64,${png.toString("base64")}`);
  return { kind: peak <= BLANK_LEVEL ? "blank" : "painted", peak, ...visible };
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
      const select = document.querySelector("#settings-preview-resolution");
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

    const samples = [await compositorSample(page)];
    let transitionFinished = false;
    const transition = page.evaluate(async () => {
      const startedAt = performance.now();

      const select = document.querySelector("#settings-preview-resolution");
      select.value = "full";
      select.dispatchEvent(new Event("change", { bubbles: true }));

      const deadline = startedAt + 900000;
      while (performance.now() < deadline) {
        if (viewerState().status === "ready" && state.acceptedPresentation?.exact === true
          && state.acceptedPresentation?.requestedTier === "full") break;
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return {
        elapsedMs: performance.now() - startedAt,
        execution: state.acceptedPresentation?.execution || null,
        transport: state.acceptedPresentation?.transport || null,
        cpuFallbacks: JSON.parse(JSON.stringify(state.cpuFallbacks)),
        refusals: { ...state.gpuDraftRefusals },
        lastRenderRefusal: state.gpuPreview?.lastRenderRefusal?.reason || null,
      };
    }).finally(() => { transitionFinished = true; });
    while (!transitionFinished) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
      samples.push(await compositorSample(page));
    }
    const result = await transition;
    samples.push(await compositorSample(page));
    result.total = samples.length;
    result.blank = samples.filter((entry) => entry.kind === "blank").length;
    result.nothing = samples.filter((entry) => entry.kind === "nothing-displayed").length;
    result.painted = samples.filter((entry) => entry.kind === "painted").length;
    result.firstBlankAt = samples.findIndex((entry) => entry.kind === "blank");
    result.transitionBlank = samples.filter((entry) => entry.kind === "blank" && entry.status !== "ready").length;
    result.finalCompositorPeak = samples.at(-1)?.peak || 0;

    console.log(
      "tier change 4K -> Full in " + Math.round(result.elapsedMs) + " ms, exec "
      + result.execution,
    );
    console.log(
      "  samples " + result.total
      + " | painted " + result.painted
      + " | blank " + result.blank
      + " | nothing displayed " + result.nothing
      + " | compositor samples " + result.total,
    );

    console.log("  transport " + result.transport
      + " | cpu fallbacks " + JSON.stringify(result.cpuFallbacks)
      + " | /preview requests " + backend.length);
    console.log("  refusals " + JSON.stringify(result.refusals)
      + " | last renderer refusal: " + result.lastRenderRefusal);

    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));

    assert(result.painted > 0,
      "No sample ever showed a painted frame, so the sampler is not working: "
      + JSON.stringify(result));
    assert(result.execution === "tiled",
      "Full did not tile, so the path under test was not exercised: "
      + JSON.stringify(result));

    // drawImage cannot reliably read a WebGPU canvas after compositor handoff,
    // so every sample above is a Chromium compositor screenshot instead.
    assert(result.transitionBlank === 0 && result.nothing === 0,
      "The viewer went blank across the tier change: " + result.transitionBlank
      + " black and " + result.nothing + " nothing-displayed of " + result.total
      + " samples over " + Math.round(result.elapsedMs) + " ms, first at sample "
      + result.firstBlankAt + ". Global gate 11.1 requires Full to remain visibly "
      + "progressing.");
    assert(result.finalCompositorPeak > BLANK_LEVEL,
      "The compositor presented a black canvas after Full became Ready: peak "
      + result.finalCompositorPeak + ".");

    console.log("The viewer stays painted across a tier change.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
