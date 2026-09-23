// Phase 0 work item 6 -- Fit filtering A/B: Full-at-Fit versus display-scale
// Fit, compared as screenshots on the six named content classes.
//
//   node tests/performance/fit-filtering-ab.js --url http://127.0.0.1:8765
//
// The question this run exists to answer: if Fit processes at the scale the
// screen can show (the sprint's display-scale contract) instead of at the
// source resolution, do grain, Detail, Denoise, halation, fine repeating
// detail and saturated highlights still look like the picture the author
// edited? The A/B holds the graph, the zoom (Fit) and the framed image fixed
// and changes only the processing tier:
//
//   full-at-fit   the selected tier is `full`, so the graph runs at the source
//                 resolution and the browser shows the downscaled result;
//   display-scale the selected tier is the one closest to the on-screen size,
//                 so the graph runs on a correctly filtered source at roughly
//                 display scale, which is what the display-scale contract
//                 (and the Phase 3 mip path) promises to render.
//
// Both branches are captured the way the user sees them -- a screenshot of the
// mounted canvas at Fit -- and compared with fit-filtering-compare.js. The raw
// PNGs are kept next to the JSON so a human can look at what the numbers
// describe.
//
// This driver does not need the Phase 3 mip cache: the tier proxy is already a
// correctly filtered (Lanczos, per channel, scene-linear) source, so the
// display-scale branch is the visual contract the cache must preserve. The
// cache changes how that filtered source is produced, not what it looks like.
//
// Denoise is included: its selector is bound to the tier's long edge, so each
// branch gets its own analysis at its own scale, exactly as the product would
// under the display-scale contract.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureFitFilteringFixture, BANDS, BAND_HEIGHT, WIDTH, HEIGHT } = require("./fit-filtering-fixture.js");
const { rgbaImage, compareRgba, cropRgba, lumaEnergy, summarizePair } = require("./fit-filtering-compare.js");

const ANALYSIS_WIDTH = 640;
const SETTLE_MS = 600;
const TIER_CANDIDATES = ["1024", "2048", "4096"];

// One scenario per named content class. `settings` are real UI controls; the
// driver resets every film-look and detail control to its HTML default before
// applying them, so scenarios cannot leak into each other.
const SCENARIOS = [
  {
    id: "grain",
    band: "smooth",
    settings: [
      ["current.film_look.grain_amount", 40],
      ["current.film_look.grain_size", 60],
    ],
  },
  {
    id: "detail",
    band: "texture",
    settings: [
      ["current.detail.texture_amount", 30],
      ["current.detail.clarity_amount", 40],
      ["current.detail.sharpen_amount", 30],
    ],
  },
  {
    id: "denoise",
    band: "noise",
    denoise: true,
    settings: [],
  },
  {
    id: "halation",
    band: "halation",
    settings: [
      ["current.film_look.halation_amount", 35],
      ["current.film_look.bloom_amount", 25],
    ],
  },
  {
    id: "fine-detail",
    band: "fine",
    settings: [],
  },
  {
    id: "highlights",
    band: "highlights",
    settings: [],
  },
];

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closestTier(displayLongEdge) {
  let best = TIER_CANDIDATES[0];
  let bestDistance = Infinity;
  for (const tier of TIER_CANDIDATES) {
    const distance = Math.abs(Math.log(Number(tier) / displayLongEdge));
    if (distance < bestDistance) { best = tier; bestDistance = distance; }
  }
  return best;
}

function bandMetrics(fullAtFit, displayScale, band) {
  const scale = fullAtFit.height / HEIGHT;
  const y0 = Math.round(band.y * scale);
  const y1 = Math.round((band.y + BAND_HEIGHT) * scale);
  const fullCrop = cropRgba(fullAtFit, 0, y0, fullAtFit.width, y1 - y0);
  const displayCrop = cropRgba(displayScale, 0, y0, displayScale.width, y1 - y0);
  return {
    y0,
    y1,
    ...compareRgba(fullCrop, displayCrop),
    energy: {
      fullAtFit: lumaEnergy(fullCrop),
      displayScale: lumaEnergy(displayCrop),
    },
  };
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "fit-filtering-ab.json"));
  const screenshotDirectory = path.join(path.dirname(output), "fit-filtering");
  const fixture = ensureFitFilteringFixture();
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const waitReady = () => page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

  const waitDenoiseReady = async () => {
    await page.waitForFunction(
      () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
      null, { timeout: 900000 },
    );
    const status = await page.evaluate(() => state.denoiseRuntime[state.currentView].status);
    assert(status === "ready", `Denoise did not reach ready: ${status}`);
  };

  const settle = async () => {
    await waitReady();
    await page.evaluate(async () => { await state.gpuPreview.waitForSubmittedWork(); });
    await page.evaluate(() => window.HDRFinisherPerformance?.cancelRoiCatchUp?.());
    await waitReady();
    await page.waitForTimeout(SETTLE_MS);
  };

  const setTier = async (tier) => {
    // Apply through the app function rather than dispatching a change event:
    // the select's listener persists the preference through the application
    // shell, and the shell's preference echo calls applyExecutionOverride with
    // its own (default) value, which would silently drop the forced route for
    // every tier after the first. Re-asserting it here keeps both branches on
    // the tiled route the packaged large-source path uses.
    await page.evaluate((value) => {
      applyExecutionOverride("tiled");
      applyPreviewResolution(value);
    }, tier);
    await waitReady();
  };

  // Reset every film-look and detail control to the value the markup ships
  // with, then apply this scenario's settings. Runs before a tier change so a
  // tier change never starts a render of the previous scenario's graph.
  const applyScenario = async (scenario) => {
    await page.evaluate(async (definition) => {
      if (state.denoise?.[state.currentView]?.enabled) await setDenoiseEnabled(false);
      for (const control of document.querySelectorAll(
        "[data-path^='current.film_look.'], [data-path^='current.detail.']",
      )) {
        if (control.defaultValue !== undefined && control.value !== control.defaultValue) {
          control.value = control.defaultValue;
          control.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      for (const [controlPath, value] of definition.settings) {
        const control = document.querySelector(`[data-path="${controlPath}"]`);
        if (!control) throw new Error(`Missing control ${controlPath}`);
        control.value = String(value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (definition.denoise) await setDenoiseEnabled(true);
    }, scenario);
    if (scenario.denoise) await waitDenoiseReady();
  };

  const capture = async (scenarioId, branchId) => {
    const png = await page.locator("#preview-canvas").screenshot();
    const pngPath = path.join(screenshotDirectory, `${scenarioId}-${branchId}.png`);
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    fs.writeFileSync(pngPath, png);
    const diagnostics = await page.evaluate(() => ({
      tier: normalizedPreviewResolution(),
      requestedTier: state.acceptedPresentation?.requestedTier ?? null,
      processedLongEdge: state.acceptedPresentation?.processedLongEdge
        ?? state.acceptedPresentation?.longEdge ?? null,
      execution: state.acceptedPresentation?.execution ?? null,
      executionOverride: state.executionOverride ?? null,
      exact: state.acceptedPresentation?.exact ?? null,
      roiMode: window.HDRFinisherPerformance?.roiPreviewMode?.() ?? null,
      denoiseEnabled: Boolean(state.denoise?.[state.currentView]?.enabled),
      denoiseStatus: state.denoiseRuntime?.[state.currentView]?.status ?? null,
      denoiseSelected: state.gpuPreview?.diagnosticsSnapshot?.().denoise?.selectedSource ?? null,
      denoiseCacheReady: state.gpuPreview?.diagnosticsSnapshot?.().denoise?.cacheReady ?? null,
      canvas: { width: els.previewCanvas.width, height: els.previewCanvas.height },
      zoomMode: state.zoomMode,
      zoomPercent: state.zoomPercent,
      tiled: window.HDRFinisherPerformance?.tiledExecutionMetrics?.() ?? null,
    }));
    // Decode the screenshot and reduce it to a bounded analysis size in the
    // page, then hand back raw RGBA as base64 so Node never needs a PNG
    // decoder. The reduction uses the browser's high-quality filter, so both
    // branches reach the comparator through the same path.
    const reduced = await page.evaluate(async ({ base64, analysisWidth }) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const width = Math.min(analysisWidth, bitmap.width);
      const height = Math.max(1, Math.round(bitmap.height * (width / bitmap.width)));
      const surface = document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      const context = surface.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      const bytes = context.getImageData(0, 0, width, height).data;
      let binary = "";
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
      }
      return { width, height, rgba: btoa(binary) };
    }, { base64: png.toString("base64"), analysisWidth: ANALYSIS_WIDTH });
    return {
      pngPath,
      diagnostics,
      image: rgbaImage(reduced.width, reduced.height, Buffer.from(reduced.rgba, "base64")),
    };
  };

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", fixture);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForTimeout(500);
    const interpretationGated = await page.locator("#interpretation-gate").isVisible().catch(() => false);
    if (interpretationGated) await page.click("#accept-interpretation");
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await waitReady();

    const sourceSize = await page.evaluate(() => [state.session.source.width, state.session.source.height]);
    assert(sourceSize[0] === WIDTH && sourceSize[1] === HEIGHT,
      `The fixture did not import at its own size: ${JSON.stringify(sourceSize)}`);

    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.evaluate(() => setZoomMode("fit"));
    await settle();

    const display = await page.evaluate(() => ({
      longEdge: displayedLongEdge(),
      dpr: window.devicePixelRatio || 1,
      dropzone: (() => {
        const rect = els.dropzone.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      })(),
      roiMode: window.HDRFinisherPerformance?.roiPreviewMode?.() ?? null,
    }));
    const displayTier = closestTier(display.longEdge);
    assert(Number(displayTier) < WIDTH,
      `The display tier ${displayTier} is not below the source, so the A/B has nothing to compare`);
    const tiers = {
      full: "full",
      display: displayTier,
      fullLongEdge: WIDTH,
      displayLongEdge: Number(displayTier),
      displayRatio: Number(displayTier) / display.longEdge,
    };

    const scenarios = [];
    for (const scenario of SCENARIOS) {
      const band = BANDS.find((entry) => entry.id === scenario.band);
      assert(band, `Scenario ${scenario.id} names an unknown band ${scenario.band}`);
      await applyScenario(scenario);
      const branches = {};
      for (const [branchId, tier] of [["full", tiers.full], ["display", tiers.display]]) {
        await setTier(tier);
        if (scenario.denoise) await waitDenoiseReady();
        await settle();
        const captured = await capture(scenario.id, branchId);
        const expectedEdge = branchId === "full" ? WIDTH : Number(tiers.display);
        assert(captured.diagnostics.processedLongEdge === expectedEdge,
          `${scenario.id}/${branchId} processed ${captured.diagnostics.processedLongEdge}, wanted ${expectedEdge}`);
        assert(captured.diagnostics.exact === true,
          `${scenario.id}/${branchId} was not an exact presentation: ${JSON.stringify(captured.diagnostics)}`);
        // The route must be the tiled one both branches were pinned to: a
        // silent fallback to Direct would still render pixels, so the run
        // would look green while describing a different pipeline.
        assert(captured.diagnostics.execution === "tiled",
          `${scenario.id}/${branchId} took the ${captured.diagnostics.execution} route, not tiled: `
          + JSON.stringify(captured.diagnostics));
        branches[branchId] = captured;
      }
      const sizeDifference = Math.abs(branches.full.image.width - branches.display.image.width)
        + Math.abs(branches.full.image.height - branches.display.image.height);
      assert(sizeDifference <= 2,
        `${scenario.id} branch screenshots differ in size: ${JSON.stringify({
          full: [branches.full.image.width, branches.full.image.height],
          display: [branches.display.image.width, branches.display.image.height],
        })}`);
      const width = Math.min(branches.full.image.width, branches.display.image.width);
      const height = Math.min(branches.full.image.height, branches.display.image.height);
      const fullImage = width === branches.full.image.width
        ? branches.full.image
        : cropRgba(branches.full.image, 0, 0, width, height);
      const displayImage = width === branches.display.image.width
        ? branches.display.image
        : cropRgba(branches.display.image, 0, 0, width, height);
      const comparison = summarizePair(fullImage, displayImage);
      const bands = Object.fromEntries(BANDS.map((entry) => [
        entry.id,
        bandMetrics(fullImage, displayImage, entry),
      ]));
      scenarios.push({
        id: scenario.id,
        band: { id: band.id, label: band.label, y: band.y, height: BAND_HEIGHT },
        settings: Object.fromEntries(scenario.settings),
        denoise: Boolean(scenario.denoise),
        branches: {
          full: {
            png: path.relative(path.dirname(output), branches.full.pngPath).replaceAll("\\", "/"),
            diagnostics: branches.full.diagnostics,
            capture: { width: branches.full.image.width, height: branches.full.image.height },
          },
          display: {
            png: path.relative(path.dirname(output), branches.display.pngPath).replaceAll("\\", "/"),
            diagnostics: branches.display.diagnostics,
            capture: { width: branches.display.image.width, height: branches.display.image.height },
          },
        },
        comparison,
        bands,
      });
      const focus = bands[band.id];
      console.log(
        scenario.id.padEnd(11),
        `tier ${String(tiers.full).padEnd(4)} -> ${String(tiers.display).padEnd(4)}`,
        `focus ${band.id.padEnd(10)}`,
        `max ${String(focus.maxAbs).padStart(3)}`,
        `p99 ${String(focus.p99Abs).padStart(3)}`,
        `mean ${focus.meanAbs.toFixed(2).padStart(5)}`,
        `energy ${focus.energy.displayScale.toFixed(1)}/${focus.energy.fullAtFit.toFixed(1)}`,
      );
    }

    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);
    const summary = {
      url,
      generatedAt: new Date().toISOString(),
      fixture: {
        path: fixture,
        width: WIDTH,
        height: HEIGHT,
        bandHeight: BAND_HEIGHT,
        note: "deterministic ACEScg scene-linear float TIFF, six content-class bands",
      },
      display: { ...display, tier: displayTier, ratio: tiers.displayRatio },
      execution: "tiled",
      interpretationGated,
      analysis: {
        width: ANALYSIS_WIDTH,
        note: "canvas screenshots reduced in-page with the browser's high-quality filter; metrics are 0-255 display units",
      },
      scenarios,
      pageErrors,
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Wrote ${output}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
