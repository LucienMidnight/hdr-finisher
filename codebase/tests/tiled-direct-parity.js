// Phase 4 exit gate 1: Direct and Tiled pointwise results meet parity
// thresholds, and a tiled frame is never presented as a mixed generation.
//
// Both paths render into the same canvas, so this captures the presented pixels
// after each and compares them directly. That is the strongest available form
// of the gate: it compares what the viewer actually sees, not an intermediate.
//
//   node tests/tiled-direct-parity.js --url http://127.0.0.1:8000 \
//     --input local-test-media/inputs/<file> [--native]

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
  const native = process.argv.includes("--native");
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
    const pageUrl = new URL(url);
    if (native) pageUrl.searchParams.set("engineeringFullPreview", "1");
    await page.goto(pageUrl.toString(), { waitUntil: "networkidle" });
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

    if (native) {
      await page.locator("#preview-resolution").evaluate((select) => {
        select.value = "full";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(() => state.acceptedPresentation?.requestedTier === "full"
        && state.acceptedPresentation?.exact === true
        && viewerState().status === "ready", null, { timeout: 600000 });
      await page.evaluate(async () => {
        if (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => false);
        state.previewScheduler?.cancel();
        applyGpuMemoryBudget(8);
      });
    }

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
        if (!direct) return {
          error: "direct render failed",
          lastRefusal: state.lastGpuDraftRefusal || null,
          lastRenderRefusal: state.gpuPreview?.lastRenderRefusal || null,
          diagnostics: state.gpuPreview?.diagnosticsSnapshot?.() || null,
        };
        if (state.acceptedPresentation?.execution !== "direct") return {
          error: `planner selected ${state.acceptedPresentation?.execution || "unknown"}, not direct`,
        };
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return { staged: "direct", width: canvas.width, height: canvas.height };
      }, tileSize);
      if (comparison.error) throw new Error(`tileSize ${tileSize}: ${comparison.error}`);

      if (native) {
        const dimensions = await page.locator("#preview-canvas").evaluate((canvas) => {
          canvas.style.setProperty("width", `${canvas.width}px`, "important");
          canvas.style.setProperty("height", `${canvas.height}px`, "important");
          canvas.style.setProperty("max-width", "none", "important");
          canvas.style.setProperty("max-height", "none", "important");
          canvas.style.setProperty("position", "absolute", "important");
          canvas.style.setProperty("inset", "0 auto auto 0", "important");
          canvas.style.setProperty("z-index", "2147483647", "important");
          canvas.style.setProperty("transform", "none", "important");
          canvas.style.setProperty("transform-origin", "0 0", "important");
          canvas.style.setProperty("object-fit", "fill", "important");
          document.body.append(canvas);
          for (const child of document.body.children) {
            if (child !== canvas) child.style.setProperty("display", "none", "important");
          }
          for (const root of [document.documentElement, document.body]) {
            root.style.setProperty("width", `${canvas.width}px`, "important");
            root.style.setProperty("height", `${canvas.height}px`, "important");
            root.style.setProperty("min-width", `${canvas.width}px`, "important");
            root.style.setProperty("min-height", `${canvas.height}px`, "important");
            root.style.setProperty("overflow", "visible", "important");
          }
          return { width: canvas.width, height: canvas.height };
        });
        assertNativeDimensions(dimensions);
      }

      // drawImage() cannot read back a WebGPU canvas in headless Chromium, so
      // the presented frame is captured from the compositor and decoded into
      // pixels. Native mode walks viewport-sized captures over the isolated
      // canvas because one image-sized screenshot exceeds default GPU buffers.
      await page.waitForTimeout(250);
      const directShot = native
        ? await captureCanvasTiles(page, comparison.width, comparison.height)
        : [{ data: (await page.locator("#preview-canvas").screenshot()).toString("base64"), x: 0, y: 0 }];

      const tiledResult = await page.evaluate(async (size) => {
        const result = await window.HDRFinisherPerformance.renderTiledTier(previewTargetLongEdge(), { tileSize: size });
        if (!result?.rendered) return {
          error: `tiled render refused: ${(result?.refusals || []).join(", ")}`,
          diagnostics: state.gpuPreview?.diagnosticsSnapshot?.() || null,
        };
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return { metrics: result.metrics };
      }, tileSize);
      if (tiledResult.error) throw new Error(`tileSize ${tileSize}: ${JSON.stringify(tiledResult)}`);
      await page.waitForTimeout(250);
      const tiledShot = native
        ? await captureCanvasTiles(page, comparison.width, comparison.height)
        : [{ data: (await page.locator("#preview-canvas").screenshot()).toString("base64"), x: 0, y: 0 }];

      const captures = [];
      for (let captureIndex = 0; captureIndex < directShot.length; captureIndex += 1) {
        captures.push(await page.evaluate(async ({ a, b }) => {
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
        }, { a: directShot[captureIndex].data, b: tiledShot[captureIndex].data }));
        captures[captureIndex].origin = { x: directShot[captureIndex].x, y: directShot[captureIndex].y };
      }
      const differingCaptures = captures
        .filter((capture) => capture.differing > 0)
        .map((capture) => ({ origin: capture.origin, differing: capture.differing, maxDelta: capture.maxDelta }));
      comparison = captures.reduce((total, capture) => ({
        width: native ? comparison.width : capture.width,
        height: native ? comparison.height : capture.height,
        samples: total.samples + capture.samples,
        differing: total.differing + capture.differing,
        maxDelta: Math.max(total.maxDelta, capture.maxDelta),
        worst: total.maxDelta >= capture.maxDelta ? total.worst : capture.worst,
        differingCaptures,
        error: total.error || capture.error,
      }), { samples: 0, differing: 0, maxDelta: 0, worst: null, error: null });
      comparison.metrics = tiledResult.metrics;

      if (comparison.error) throw new Error(`tileSize ${tileSize}: ${comparison.error}`);
      if (native) assertNativeDimensions(comparison);
      const fraction = comparison.differing / comparison.samples;
      const passed = comparison.maxDelta <= MAX_CHANNEL_DELTA && fraction <= MAX_DIFFERING_FRACTION;
      results.push({ tileSize, ...comparison, differingFraction: fraction, passed });
      console.log(
        `tileSize ${String(tileSize).padStart(4)}  ${comparison.width}x${comparison.height}  `
        + `tiles ${String(comparison.metrics.tileCount).padStart(4)}  submissions ${comparison.metrics.submissions}  `
        + `maxDelta ${comparison.maxDelta}  differing ${comparison.differing}/${comparison.samples} `
        + `(${(fraction * 100).toFixed(4)}%)  ${passed ? "PASS" : "FAIL"}`,
      );
      if (!passed) console.log(JSON.stringify({ worst: comparison.worst, differingCaptures }, null, 2));
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

function assertNativeDimensions(dimensions) {
  const pixels = Number(dimensions.width) * Number(dimensions.height);
  if (!(pixels >= 40_000_000)) {
    throw new Error(`Native parity capture is not a 42 MP-class frame: ${dimensions.width}x${dimensions.height}`);
  }
}

async function captureCanvasTiles(page, width, height, captureEdge = 1024) {
  const captures = [];
  for (let y = 0; y < height; y += captureEdge) {
    for (let x = 0; x < width; x += captureEdge) {
      const tileWidth = Math.min(captureEdge, width - x);
      const tileHeight = Math.min(captureEdge, height - y);
      await page.setViewportSize({ width: tileWidth, height: tileHeight });
      await page.evaluate(({ left, top }) => {
        window.scrollTo(left, top);
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, { left: x, top: y });
      captures.push({
        data: (await page.screenshot({ animations: "disabled" })).toString("base64"),
        x,
        y,
      });
    }
  }
  return captures;
}
