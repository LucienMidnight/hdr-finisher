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

    await page.evaluate(async () => {
      const brush = newLocalAdjustment("brush");
      brush.name = "Tiled brush Detail";
      brush.mask.leaf.strokes = [{
        points: [{ x: 0.08, y: 0.25 }, { x: 0.48, y: 0.72 }],
        radius: 0.12, hardness: 0.45, flow: 1, opacity: 1, erase: false,
      }];
      brush.mask.leaf.mask_feather = 0.025;
      brush.hdr_grade.exposure = 0.35;
      Object.assign(brush.hdr_grade.detail, {
        texture_amount: 30, clarity_amount: 25, clarity_radius_percent: 0.9,
        sharpen_amount: 40, sharpen_radius_px: 0.9, sharpen_threshold: 12,
      });
      const pathLocal = newLocalAdjustment("path");
      pathLocal.name = "Tiled path Detail";
      const node = (x, y) => ({ x, y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" });
      pathLocal.mask.leaf.nodes = [node(0.35, 0.12), node(0.92, 0.2), node(0.8, 0.9), node(0.3, 0.78)];
      pathLocal.mask.leaf.feather = 0.03;
      pathLocal.hdr_grade.exposure = -0.2;
      Object.assign(pathLocal.hdr_grade.detail, {
        texture_amount: -20, clarity_amount: 40, clarity_radius_percent: 1.3,
        sharpen_amount: 25, sharpen_radius_px: 1.4, sharpen_threshold: 18,
      });
      if (!await queueEditCommand("create_local", { local: brush })) throw new Error("Could not create tiled Brush local");
      if (!await queueEditCommand("create_local", { local: pathLocal })) throw new Error("Could not create tiled Path local");
      await syncGlobalEditState();
    });

    // Each create_local bumps the edit revision and starts its own render, so
    // two are still settling when this returns. Calling renderGpuTier now would
    // be superseded mid-mask-load and refuse correctly, which would look like a
    // parity failure rather than the sequencing it is. Let the queue drain
    // first; the Phase 4 flow needed no such wait because it committed no edits.
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });
    await page.evaluate(async () => {
      if (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => false);
      state.previewScheduler?.cancel();
    });

    // The global grade is applied only now, and deliberately after the locals.
    // `state.adjustments` is uncommitted client state, and the document each
    // create_local returns replaces it, so a grade set before those commands is
    // silently discarded -- which would leave global Detail inactive and test
    // the locals alone. Exercise a non-neutral grade so parity is tested on
    // real tone mapping, not on an identity transform anything would match.
    await page.evaluate(() => {
      state.adjustments.hdr.exposure = 0.85;
      state.adjustments.hdr.contrast = 18;
      state.adjustments.hdr.saturation = 12;
      state.adjustments.hdr.white_balance_kelvin = 5200;
      Object.assign(state.adjustments.hdr.detail, {
        texture_amount: 35,
        clarity_amount: -25,
        clarity_radius_percent: 1.2,
        sharpen_amount: 55,
        sharpen_radius_px: 1.1,
        sharpen_threshold: 20,
      });
    });

    const results = [];
    // One parity pass at one tile size. `label` names the radius configuration
    // so the maximum-radius seam run is reported apart from the standard one.
    const parityPass = async (label, tileSize) => {
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
      if (comparison.error) throw new Error(`tileSize ${tileSize}: ${JSON.stringify(comparison)}`);

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
      results.push({ label, tileSize, ...comparison, differingFraction: fraction, passed });
      console.log(
        `${label.padEnd(14)} tileSize ${String(tileSize).padStart(4)}  ${comparison.width}x${comparison.height}  `
        + `tiles ${String(comparison.metrics.tileCount).padStart(4)}  halo ${String(comparison.metrics.halo).padStart(4)}  `
        + `submissions ${comparison.metrics.submissions}  `
        + `maxDelta ${comparison.maxDelta}  differing ${comparison.differing}/${comparison.samples} `
        + `(${(fraction * 100).toFixed(4)}%)  ${passed ? "PASS" : "FAIL"}`,
      );
      if (!passed) console.log(JSON.stringify({ worst: comparison.worst, differingCaptures }, null, 2));
    };

    for (const tileSize of tileSizes) await parityPass("standard", tileSize);

    // Maximum-radius seam evidence. Every Detail radius goes to the top of its
    // documented range (clarity 3.0%, sharpen 3.0px) on the global grade and on
    // both locals at once, which is the largest halo the scheduler can be asked
    // for. Running it at the smallest tile size makes the halo large relative
    // to the tile, so a halo that is even slightly short shows up as a seam at
    // every tile boundary rather than as a single edge case.
    await page.evaluate(async () => {
      const maxima = { clarity_radius_percent: 3.0, sharpen_radius_px: 3.0 };
      Object.assign(state.adjustments.hdr.detail, maxima, {
        texture_amount: 80, clarity_amount: 75, sharpen_amount: 100, sharpen_threshold: 0,
      });
      for (const local of state.editDocument.local_adjustments) {
        Object.assign(local.hdr_grade.detail, maxima, {
          texture_amount: 70, clarity_amount: 65, sharpen_amount: 95, sharpen_threshold: 0,
        });
      }
    });
    for (const tileSize of tileSizes) await parityPass("max-radius", tileSize);

    const seamRuns = results.filter((entry) => entry.label === "max-radius");
    if (!seamRuns.length || seamRuns.some((entry) => !entry.passed)) {
      throw new Error(`Maximum-radius Detail seams appeared: ${JSON.stringify(seamRuns.map((e) => ({
        tileSize: e.tileSize, maxDelta: e.maxDelta, differing: e.differing,
      })))}`);
    }
    console.log(`maximum-radius seams: ${seamRuns.map((e) => `tile ${e.tileSize} halo ${e.metrics.halo} maxDelta ${e.maxDelta}`).join("; ")}  PASS`);

    // Restore the standard radii so the Detail cache trace below measures
    // amount and threshold reuse against the configuration it was written for.
    await page.evaluate(async () => {
      Object.assign(state.adjustments.hdr.detail, {
        texture_amount: 35, clarity_amount: -25, clarity_radius_percent: 1.2,
        sharpen_amount: 55, sharpen_radius_px: 1.1, sharpen_threshold: 20,
      });
      for (const local of state.editDocument.local_adjustments) {
        Object.assign(local.hdr_grade.detail, {
          clarity_radius_percent: 0.9, sharpen_radius_px: 0.9,
        });
      }
    });

    // A refusal must be explicit rather than a silent fallback to Direct.
    // Phase 7 moved vignette onto the tiled path, so the refusal this asserts
    // is a module that phase has not reached yet: the spatial film effects,
    // whose quarter-resolution intermediates still have no tile contract.
    const refusal = await page.evaluate(async () => {
      const film = state.adjustments.hdr.film_look;
      const restore = { halation_amount: film.halation_amount, halation_radius: film.halation_radius };
      film.halation_amount = 60;
      film.halation_radius = 0.3;
      const result = await window.HDRFinisherPerformance.renderTiledTier(previewTargetLongEdge());
      Object.assign(film, restore);
      return result;
    });
    if (refusal.rendered || !refusal.refusals.includes("spatial film effects")) {
      throw new Error(`Halation should keep a graph off the tiled path: ${JSON.stringify(refusal)}`);
    }
    console.log(`refusal check: halation -> ${JSON.stringify(refusal.refusals)}  PASS`);

    // One submission per generation is what makes replacement atomic.
    const atomic = results.every((entry) => entry.metrics.submissions === 1);
    if (!atomic) throw new Error("A tiled generation used more than one submission, so replacement is not atomic");
    console.log("atomic assembly: every generation submitted exactly once  PASS");

    // Phase 5 Detail cache and local-stack invalidation trace.
    //
    // The stack here is global Detail followed by two locals that each carry
    // their own Detail, so every band the renderer can cache is exercised. The
    // steps are ordered so that each one changes exactly one thing:
    //
    //  1. warm-up          -- establishes the baseline; every band is a miss.
    //  2. repeat           -- nothing changed, so every band must be reused.
    //  3. last-local drag  -- amount and threshold on the LAST local. Nothing
    //                         upstream or downstream of any band changes, so
    //                         this is the pure form of the exit gate: no band
    //                         analysis at all.
    //  4. global drag      -- amount and threshold on the global. The global
    //                         bands must still be reused, but the local bands
    //                         below legitimately regenerate, because the global
    //                         Detail composite is their input. Asserting the
    //                         two scopes apart is what distinguishes correct
    //                         downstream invalidation from a broken cache.
    //  5. radius change    -- a global radius. Every band must regenerate.
    const cacheTrace = await page.evaluate(async (size) => {
      const render = async () => window.HDRFinisherPerformance.renderTiledTier(
        previewTargetLongEdge(), { tileSize: size },
      );
      const lastLocal = state.editDocument.local_adjustments.at(-1);
      const warmUp = await render();
      const repeat = await render();

      // Drag the last local's amount and threshold only. Its own band identity
      // excludes them, and nothing downstream reads its Detail bands.
      Object.assign(lastLocal.hdr_grade.detail, {
        texture_amount: -55, clarity_amount: 70, sharpen_amount: 80, sharpen_threshold: 60,
      });
      const localDrag = await render();

      Object.assign(state.adjustments.hdr.detail, {
        texture_amount: -45, clarity_amount: 60, sharpen_amount: 90, sharpen_threshold: 55,
      });
      const globalDrag = await render();

      state.adjustments.hdr.detail.clarity_radius_percent = 2.4;
      const radius = await render();
      return { warmUp, repeat, localDrag, globalDrag, radius };
    }, tileSizes.at(-1));

    for (const [label, step] of Object.entries(cacheTrace)) {
      if (!step?.rendered) throw new Error(`Detail cache trace step "${label}" did not render: ${JSON.stringify(step)}`);
    }
    const metrics = Object.fromEntries(Object.entries(cacheTrace).map(([key, step]) => [key, step.metrics]));
    const stacks = metrics.warmUp.detailBandStacks;
    const tiles = metrics.warmUp.tileCount;
    if (stacks !== 3) {
      throw new Error(`Expected global Detail plus two local Detail stacks, got ${stacks}. `
        + "A stack is missing, so the trace below would not prove what it claims.");
    }

    const expect = (label, actual, wanted) => {
      if (actual !== wanted) {
        throw new Error(`Detail cache trace, ${label}: expected ${wanted}, got ${actual}. `
          + `Full metrics: ${JSON.stringify(metrics, null, 2)}`);
      }
    };
    // The warm-up only has to leave every band of every stack resident. It is
    // not asserted to be all misses: the parity loop above already rendered
    // this exact configuration tiled, so these bands are legitimately still
    // cached, and demanding misses here would be asserting a cold cache that
    // the preceding steps have no reason to leave behind.
    expect("warm-up bands touched", metrics.warmUp.detailCacheHits + metrics.warmUp.detailCacheMisses, tiles * stacks);
    expect("warm-up analysis passes", metrics.warmUp.detailAnalysisPasses, metrics.warmUp.detailCacheMisses * 2);
    expect("identical repeat hits", metrics.repeat.detailCacheHits, tiles * stacks);
    expect("identical repeat analysis passes", metrics.repeat.detailAnalysisPasses, 0);

    // The exit gate: an amount/threshold drag with radii and input unchanged
    // performs no band analysis anywhere in the stack.
    expect("last-local amount/threshold drag hits", metrics.localDrag.detailCacheHits, tiles * stacks);
    expect("last-local amount/threshold drag analysis passes", metrics.localDrag.detailAnalysisPasses, 0);

    // The local-stack invalidation trace: global bands reused, locals rebuilt.
    expect("global amount/threshold drag, global bands reused", metrics.globalDrag.detailGlobalCacheHits, tiles);
    expect("global amount/threshold drag, global bands analysed", metrics.globalDrag.detailGlobalCacheMisses, 0);
    expect("global amount/threshold drag, downstream local bands rebuilt",
      metrics.globalDrag.detailLocalCacheMisses, tiles * (stacks - 1));
    expect("global amount/threshold drag, downstream local bands reused",
      metrics.globalDrag.detailLocalCacheHits, 0);

    expect("radius change misses", metrics.radius.detailCacheMisses, tiles * stacks);
    expect("radius change analysis passes", metrics.radius.detailAnalysisPasses, tiles * stacks * 2);

    console.log(
      `Detail cache (${tiles} tiles x ${stacks} band stacks):
`
      + `  warm-up            ${metrics.warmUp.detailCacheHits} hits / ${metrics.warmUp.detailCacheMisses} misses / ${metrics.warmUp.detailAnalysisPasses} analysis passes  PASS
`
      + `  identical repeat   ${metrics.repeat.detailCacheHits} hits / 0 analysis passes  PASS
`
      + `  local amount drag  ${metrics.localDrag.detailCacheHits} hits / 0 analysis passes  PASS
`
      + `  global amount drag global ${metrics.globalDrag.detailGlobalCacheHits} hits, local ${metrics.globalDrag.detailLocalCacheMisses} rebuilt  PASS
`
      + `  global radius      ${metrics.radius.detailCacheMisses} misses / ${metrics.radius.detailAnalysisPasses} analysis passes  PASS`,
    );

    const failures = results.filter((entry) => !entry.passed);
    if (failures.length) throw new Error(`Direct/Tiled parity failed for tile sizes: ${failures.map((entry) => entry.tileSize).join(", ")}`);
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Direct/Tiled pointwise, local-stack and Detail parity passed.");
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
