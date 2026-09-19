// Phase 4 exit gate 1: Direct and Tiled pointwise results meet parity
// thresholds, and a tiled frame is never presented as a mixed generation.
//
// Both paths render into the same canvas, so this captures the presented pixels
// after each and compares them directly. That is the strongest available form
// of the gate: it compares what the viewer actually sees, not an intermediate.
//
//   node tests/tiled-direct-parity.js --url http://127.0.0.1:8000 \
//     --input local-test-media/inputs/<file>

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

// The presented surface is 8-bit per channel, so an exact match is the
// expectation. A tolerance of 1 covers only last-bit rounding between two
// encodings of the same value; anything structural fails loudly.
const MAX_CHANNEL_DELTA = 1;
const MAX_DIFFERING_FRACTION = 0.0005;

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const input = argument("--input", null);
  const tileSizes = (argument("--tile-sizes", "256,512") || "").split(",").map(Number).filter(Boolean);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    if (input) {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) throw new Error(`Input does not exist: ${resolved}`);
      await page.setInputFiles("#file-input", resolved);
    } else {
      await page.getByRole("button", { name: "Load test pattern" }).click();
    }
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });

    // Exercise a non-neutral grade so parity is tested on real tone mapping,
    // not on an identity transform that any implementation would match.
    await page.evaluate(() => {
      state.adjustments.hdr.exposure = 0.85;
      state.adjustments.hdr.contrast = 18;
      state.adjustments.hdr.saturation = 12;
      state.adjustments.hdr.white_balance_kelvin = 5200;
    });

    const results = [];
    for (const tileSize of tileSizes) {
      let comparison = await page.evaluate(async (size) => {
        const canvas = els.previewCanvas;
        const longEdge = previewTargetLongEdge();

        const direct = await window.HDRFinisherPerformance.renderGpuTier(longEdge);
        if (!direct) return { error: "direct render failed" };
        return { staged: "direct", width: canvas.width, height: canvas.height };
      }, tileSize);
      if (comparison.error) throw new Error(`tileSize ${tileSize}: ${comparison.error}`);

      // drawImage() cannot read back a WebGPU canvas in headless Chromium, so
      // the presented frame is captured as an element screenshot and decoded
      // into pixels. This compares what the compositor actually shows.
      await page.waitForTimeout(250);
      const directShot = (await page.locator("#preview-canvas").screenshot()).toString("base64");

      const tiledResult = await page.evaluate(async (size) => {
        const result = await window.HDRFinisherPerformance.renderTiledTier(previewTargetLongEdge(), { tileSize: size });
        if (!result?.rendered) return { error: `tiled render refused: ${(result?.refusals || []).join(", ")}` };
        return { metrics: result.metrics };
      }, tileSize);
      if (tiledResult.error) throw new Error(`tileSize ${tileSize}: ${tiledResult.error}`);
      await page.waitForTimeout(250);
      const tiledShot = (await page.locator("#preview-canvas").screenshot()).toString("base64");

      comparison = await page.evaluate(async ({ a, b }) => {
        const decode = async (base64) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
          const surface = document.createElement("canvas");
          surface.width = bitmap.width;
          surface.height = bitmap.height;
          const context = surface.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const directImage = await decode(a);
        const tiledImage = await decode(b);
        if (directImage.width !== tiledImage.width || directImage.height !== tiledImage.height) {
          return { error: "captured sizes differ" };
        }
        const directPixels = directImage.data;
        const tiledPixels = tiledImage.data;
        let differing = 0;
        let maxDelta = 0;
        let worst = null;
        for (let index = 0; index < directPixels.length; index += 4) {
          let pixelDelta = 0;
          for (let channel = 0; channel < 3; channel += 1) {
            const delta = Math.abs(directPixels[index + channel] - tiledPixels[index + channel]);
            if (delta > pixelDelta) pixelDelta = delta;
          }
          if (pixelDelta > maxDelta) {
            maxDelta = pixelDelta;
            worst = { pixel: index / 4, direct: directPixels[index], tiled: tiledPixels[index] };
          }
          if (pixelDelta > 0) differing += 1;
        }
        return {
          width: directImage.width,
          height: directImage.height,
          samples: directPixels.length / 4,
          differing,
          maxDelta,
          worst,
        };
      }, { a: directShot, b: tiledShot });
      comparison.metrics = tiledResult.metrics;

      if (comparison.error) throw new Error(`tileSize ${tileSize}: ${comparison.error}`);
      const fraction = comparison.differing / comparison.samples;
      const passed = comparison.maxDelta <= MAX_CHANNEL_DELTA && fraction <= MAX_DIFFERING_FRACTION;
      results.push({ tileSize, ...comparison, differingFraction: fraction, passed });
      console.log(
        `tileSize ${String(tileSize).padStart(4)}  ${comparison.width}x${comparison.height}  `
        + `tiles ${String(comparison.metrics.tileCount).padStart(4)}  submissions ${comparison.metrics.submissions}  `
        + `maxDelta ${comparison.maxDelta}  differing ${comparison.differing}/${comparison.samples} `
        + `(${(fraction * 100).toFixed(4)}%)  ${passed ? "PASS" : "FAIL"}`,
      );
    }

    // A refusal must be explicit rather than a silent fallback to Direct.
    const refusal = await page.evaluate(async () => {
      state.adjustments.hdr.vignette.amount = 40;
      const result = await window.HDRFinisherPerformance.renderTiledTier(previewTargetLongEdge());
      state.adjustments.hdr.vignette.amount = 0;
      return result;
    });
    if (refusal.rendered || !refusal.refusals.includes("vignette")) {
      throw new Error(`Vignette should keep a graph off the tiled path: ${JSON.stringify(refusal)}`);
    }
    console.log(`refusal check: vignette -> ${JSON.stringify(refusal.refusals)}  PASS`);

    // One submission per generation is what makes replacement atomic.
    const atomic = results.every((entry) => entry.metrics.submissions === 1);
    if (!atomic) throw new Error("A tiled generation used more than one submission, so replacement is not atomic");
    console.log("atomic assembly: every generation submitted exactly once  PASS");

    const failures = results.filter((entry) => !entry.passed);
    if (failures.length) throw new Error(`Direct/Tiled parity failed for tile sizes: ${failures.map((entry) => entry.tileSize).join(", ")}`);
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Direct/Tiled pointwise parity passed.");
  } finally {
    await browser.close();
  }
})();
