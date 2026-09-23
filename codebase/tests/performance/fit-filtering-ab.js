// Phase 0 work item 6 -- Fit filtering A/B, set up so the owner can judge it
// perceptually: "would the exported file look like this on my screen?"
//
//   node tests/performance/fit-filtering-ab.js --url http://127.0.0.1:8765
//
// The finishing-app contract is perceptual: when the user moves grain, Detail,
// halation or Denoise, the preview has to agree with the file they will export.
// The two branches of this A/B are therefore both *processed frames*, shown at
// the size the viewer actually displays (the canvas CSS box at Fit):
//
//   reference  the full-resolution render (tier `full`), read back from the
//              retained presentation target and downsampled with a correct
//              Lanczos-3 filter. This is what the exported file looks like on
//              this screen -- what the user should see.
//   preview    the display-scale render (the tier closest to the on-screen
//              size), read back at its own resolution and shown at the same
//              size. This is what the display-scale Fit path shows today.
//
// The two must look the same. Any difference is the graph behaving differently
// at processing scale, not a display artifact: both sides went through the same
// correct filter. The PNGs are saved as `<scenario>-reference.png`,
// `<scenario>-preview.png` and `<scenario>-difference.png` (difference x4) so
// the comparison can be eyeballed directly.
//
// The canvas screenshots from the earlier version of this driver are kept under
// `screen/` as secondary evidence only. They show what the browser does with a
// 4096-px canvas on an 889-px screen -- a crude downscale that aliases -- and
// they are *not* the reference; comparing against them is what made the first
// review set misleading.
//
// Denoise is included: its selector is bound to the tier's long edge, so each
// branch gets its own analysis at its own scale.
//
// Preview-versus-export parity is a separate test: the reference here is the
// renderer's own full-resolution frame, which assumes the preview and the
// export agree. That assumption is itself an open Phase 0 item.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureFitFilteringFixture, BANDS, BAND_HEIGHT, WIDTH, HEIGHT } = require("./fit-filtering-fixture.js");
const {
  rgbaImage,
  compareRgba,
  cropRgba,
  lanczosResampleRgba,
  lumaEnergy,
  summarizePair,
} = require("./fit-filtering-compare.js");

const SCREEN_ANALYSIS_WIDTH = 640;
const SETTLE_MS = 600;
const TIER_CANDIDATES = ["1024", "2048", "4096"];
const READBACK_STRIP_ROWS = 384;
// The film-look and detail state each scenario is expected to end up with,
// keyed by the control path suffix. Anything not named by a scenario must sit
// at its default, so a scenario cannot inherit the previous scenario's graph.
const TRACKED_DEFAULTS = {
  grain_amount: 0,
  grain_size: 50,
  halation_amount: 0,
  bloom_amount: 0,
  texture_amount: 0,
  clarity_amount: 0,
  sharpen_amount: 0,
};

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

function bandMetrics(reference, preview, band) {
  const y0 = Math.round(band.y * reference.height / HEIGHT);
  const y1 = Math.round((band.y + BAND_HEIGHT) * reference.height / HEIGHT);
  const referenceCrop = cropRgba(reference, 0, y0, reference.width, y1 - y0);
  const previewCrop = cropRgba(preview, 0, y0, preview.width, y1 - y0);
  return {
    y0,
    y1,
    ...compareRgba(referenceCrop, previewCrop),
    energy: {
      reference: lumaEnergy(referenceCrop),
      preview: lumaEnergy(previewCrop),
    },
  };
}

function saveDataUrl(dataUrl, filePath) {
  const comma = dataUrl.indexOf(",");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(dataUrl.slice(comma + 1), "base64"));
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const only = argument("--only", null);
  const output = argument("--output", path.join("output", "performance", "fit-filtering-ab.json"));
  const reviewDirectory = path.join(path.dirname(output), "fit-filtering");
  const screenDirectory = path.join(reviewDirectory, "screen");
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
  // tier change never starts a render of the previous scenario's graph. The
  // reset is unconditional and reports what it saw: a value-tracking guard once
  // silently skipped halation and bloom, which made three scenarios share one
  // graph while looking like a scale result.
  const applyScenario = async (scenario) => {
    const resetReport = await page.evaluate(async (definition) => {
      if (state.denoise?.[state.currentView]?.enabled) await setDenoiseEnabled(false);
      const report = [];
      for (const control of document.querySelectorAll(
        "[data-path^='current.film_look.'], [data-path^='current.detail.']",
      )) {
        const isCheckbox = control.type === "checkbox";
        const isSelect = control.tagName === "SELECT";
        const before = isCheckbox ? control.checked : control.value;
        if (isCheckbox) {
          control.checked = control.defaultChecked;
        } else if (isSelect) {
          // A select has no defaultValue; reset to the option the markup marks
          // selected, never to an empty value.
          const option = control.querySelector("option[selected]") ?? control.options[0];
          control.value = option ? option.value : "";
        } else {
          control.value = control.defaultValue;
        }
        control.dispatchEvent(new Event("input", { bubbles: true }));
        report.push({
          path: control.dataset.path,
          before,
          after: isCheckbox ? control.checked : control.value,
          connected: control.isConnected,
        });
      }
      for (const [controlPath, value] of definition.settings) {
        const control = document.querySelector(`[data-path="${controlPath}"]`);
        if (!control) throw new Error(`Missing control ${controlPath}`);
        control.value = String(value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (definition.denoise) await setDenoiseEnabled(true);
      return report;
    }, scenario);
    if (scenario.denoise) await waitDenoiseReady();
    return resetReport;
  };

  const captureScreen = async (scenarioId, branchId) => {
    const png = await page.locator("#preview-canvas").screenshot();
    const pngPath = path.join(screenDirectory, `${scenarioId}-${branchId}.png`);
    fs.mkdirSync(screenDirectory, { recursive: true });
    fs.writeFileSync(pngPath, png);
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
    }, { base64: png.toString("base64"), analysisWidth: SCREEN_ANALYSIS_WIDTH });
    return { pngPath, image: rgbaImage(reduced.width, reduced.height, Buffer.from(reduced.rgba, "base64")) };
  };

  const captureDiagnostics = () => page.evaluate(() => ({
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
    // The graph the render was asked for, so a scenario that silently failed
    // to apply cannot be mistaken for a scale difference.
    currentView: state.currentView,
    filmLook: (() => {
      const look = state.adjustments?.[state.currentView]?.film_look || {};
      return {
        grain_amount: look.grain_amount,
        grain_size: look.grain_size,
        halation_amount: look.halation_amount,
        halation_radius: look.halation_radius,
        bloom_amount: look.bloom_amount,
        bloom_radius: look.bloom_radius,
      };
    })(),
    detail: (() => {
      const detail = state.adjustments?.[state.currentView]?.detail || {};
      return {
        texture_amount: detail.texture_amount,
        clarity_amount: detail.clarity_amount,
        sharpen_amount: detail.sharpen_amount,
      };
    })(),
    lastRefusal: state.lastGpuDraftRefusal ?? null,
    canvas: { width: els.previewCanvas.width, height: els.previewCanvas.height },
    zoomMode: state.zoomMode,
    zoomPercent: state.zoomPercent,
    tiled: window.HDRFinisherPerformance?.tiledExecutionMetrics?.() ?? null,
  }));

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

    const display = await page.evaluate(() => {
      const rect = els.previewCanvas.getBoundingClientRect();
      const pane = els.dropzone.getBoundingClientRect();
      return {
        longEdge: displayedLongEdge(),
        dpr: window.devicePixelRatio || 1,
        pane: { width: Math.round(pane.width), height: Math.round(pane.height) },
        canvasBox: { width: Math.round(rect.width), height: Math.round(rect.height) },
        roiMode: window.HDRFinisherPerformance?.roiPreviewMode?.() ?? null,
      };
    });
    const displayTier = closestTier(display.longEdge);
    assert(Number(displayTier) < WIDTH,
      `The display tier ${displayTier} is not below the source, so the A/B has nothing to compare`);
    const tiers = { full: "full", display: displayTier, ratio: Number(displayTier) / display.longEdge };
    const target = { width: display.canvasBox.width, height: display.canvasBox.height };
    assert(target.width > 64 && target.height > 64, `The canvas box is too small to review: ${JSON.stringify(target)}`);

    const scenarios = [];
    for (const scenario of SCENARIOS.filter(
      (entry) => !only || only.split(",").includes(entry.id),
    )) {
      const band = BANDS.find((entry) => entry.id === scenario.band);
      assert(band, `Scenario ${scenario.id} names an unknown band ${scenario.band}`);
      const resetReport = await applyScenario(scenario);
      const branches = {};
      for (const [branchId, tier] of [["full", tiers.full], ["display", tiers.display]]) {
        await setTier(tier);
        if (scenario.denoise) await waitDenoiseReady();
        await settle();
        const diagnostics = await captureDiagnostics();
        // A scenario whose controls silently failed to reach the graph would
        // otherwise be recorded as a scale difference. Every tracked key must
        // hold the scenario's value, or its default when the scenario is silent.
        for (const [key, fallback] of Object.entries(TRACKED_DEFAULTS)) {
          const setting = scenario.settings.find(([controlPath]) => controlPath.endsWith(`.${key}`));
          const wanted = setting ? Number(setting[1]) : fallback;
          const snapshot = key in diagnostics.filmLook ? diagnostics.filmLook : diagnostics.detail;
          assert(Number(snapshot[key]) === wanted,
            `${scenario.id}/${branchId} ${key} is ${snapshot[key]}, wanted ${wanted}: `
            + JSON.stringify(diagnostics));
        }
        const expectedEdge = branchId === "full" ? WIDTH : Number(tiers.display);
        assert(diagnostics.processedLongEdge === expectedEdge,
          `${scenario.id}/${branchId} processed ${diagnostics.processedLongEdge}, wanted ${expectedEdge}`);
        assert(diagnostics.exact === true,
          `${scenario.id}/${branchId} was not an exact presentation: ${JSON.stringify(diagnostics)}`);
        // The route must be the tiled one both branches were pinned to: a
        // silent fallback to Direct would still render pixels, so the run
        // would look green while describing a different pipeline.
        assert(diagnostics.execution === "tiled",
          `${scenario.id}/${branchId} took the ${diagnostics.execution} route, not tiled: `
          + JSON.stringify(diagnostics));
        const screen = await captureScreen(scenario.id, branchId);
        const frame = await page.evaluate(
          ({ targetWidth, targetHeight, resamplerSource, stripRows }) => {
            const resample = new Function(`return (${resamplerSource})`)();
            const presentationTarget = state.gpuPreview.presentationTarget;
            if (!presentationTarget?.valid || !presentationTarget.texture) {
              throw new Error("no retained presentation target to read back");
            }
            const frameWidth = presentationTarget.width;
            const frameHeight = presentationTarget.height;
            const source = new Uint8ClampedArray(frameWidth * frameHeight * 4);
            return (async () => {
              for (let y0 = 0; y0 < frameHeight; y0 += stripRows) {
                const rows = Math.min(stripRows, frameHeight - y0);
                const region = await state.gpuPreview.readPresentationRegion(frameWidth, rows, 0, y0);
                if (!region?.values) throw new Error(`readback failed at row ${y0}`);
                const values = region.values;
                const base = y0 * frameWidth * 4;
                for (let index = 0; index < values.length; index += 1) {
                  source[base + index] = Math.round(Math.max(0, Math.min(1, values[index])) * 255);
                }
              }
              const resampled = resample(
                { width: frameWidth, height: frameHeight, data: source }, targetWidth, targetHeight,
              );
              const canvas = document.createElement("canvas");
              canvas.width = resampled.width;
              canvas.height = resampled.height;
              const context = canvas.getContext("2d", { willReadFrequently: true });
              const imageData = context.createImageData(resampled.width, resampled.height);
              imageData.data.set(resampled.data);
              context.putImageData(imageData, 0, 0);
              const bytes = resampled.data;
              let binary = "";
              const chunk = 0x8000;
              for (let index = 0; index < bytes.length; index += chunk) {
                binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
              }
              return {
                source: { width: frameWidth, height: frameHeight },
                width: resampled.width,
                height: resampled.height,
                rgba: btoa(binary),
                png: canvas.toDataURL("image/png"),
              };
            })();
          },
          { targetWidth: target.width, targetHeight: target.height, resamplerSource: lanczosResampleRgba.toString(), stripRows: READBACK_STRIP_ROWS },
        );
        branches[branchId] = { tier, diagnostics, screen, frame };
      }

      const referenceImage = rgbaImage(
        branches.full.frame.width, branches.full.frame.height, Buffer.from(branches.full.frame.rgba, "base64"),
      );
      const previewImage = rgbaImage(
        branches.display.frame.width, branches.display.frame.height, Buffer.from(branches.display.frame.rgba, "base64"),
      );
      const comparison = summarizePair(referenceImage, previewImage);
      const bands = Object.fromEntries(BANDS.map((entry) => [entry.id, bandMetrics(referenceImage, previewImage, entry)]));

      const differencePng = await page.evaluate(({ a, b, width, height }) => {
        const decode = (base64) => {
          const binary = atob(base64);
          const out = new Uint8ClampedArray(binary.length);
          for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
          return out;
        };
        const left = decode(a);
        const right = decode(b);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let index = 0; index < data.length; index += 4) {
          data[index] = Math.min(255, Math.abs(left[index] - right[index]) * 4);
          data[index + 1] = Math.min(255, Math.abs(left[index + 1] - right[index + 1]) * 4);
          data[index + 2] = Math.min(255, Math.abs(left[index + 2] - right[index + 2]) * 4);
          data[index + 3] = 255;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        const imageData = context.createImageData(width, height);
        imageData.data.set(data);
        context.putImageData(imageData, 0, 0);
        return canvas.toDataURL("image/png");
      }, { a: branches.full.frame.rgba, b: branches.display.frame.rgba, width: referenceImage.width, height: referenceImage.height });

      const referencePath = path.join(reviewDirectory, `${scenario.id}-reference.png`);
      const previewPath = path.join(reviewDirectory, `${scenario.id}-preview.png`);
      const differencePath = path.join(reviewDirectory, `${scenario.id}-difference.png`);
      saveDataUrl(branches.full.frame.png, referencePath);
      saveDataUrl(branches.display.frame.png, previewPath);
      saveDataUrl(differencePng, differencePath);

      // Secondary: the canvas screenshots from 15.22, which show the browser's
      // own downscale of each canvas. Kept for the record, not for judgement.
      const screenSizeDifference = Math.abs(branches.full.screen.image.width - branches.display.screen.image.width)
        + Math.abs(branches.full.screen.image.height - branches.display.screen.image.height);
      assert(screenSizeDifference <= 2,
        `${scenario.id} screen captures differ in size: ${JSON.stringify({
          full: [branches.full.screen.image.width, branches.full.screen.image.height],
          display: [branches.display.screen.image.width, branches.display.screen.image.height],
        })}`);
      const screenWidth = Math.min(branches.full.screen.image.width, branches.display.screen.image.width);
      const screenHeight = Math.min(branches.full.screen.image.height, branches.display.screen.image.height);
      const screenFull = screenWidth === branches.full.screen.image.width
        ? branches.full.screen.image : cropRgba(branches.full.screen.image, 0, 0, screenWidth, screenHeight);
      const screenDisplay = screenWidth === branches.display.screen.image.width
        ? branches.display.screen.image : cropRgba(branches.display.screen.image, 0, 0, screenWidth, screenHeight);

      scenarios.push({
        id: scenario.id,
        band: { id: band.id, label: band.label, y: band.y, height: BAND_HEIGHT },
        settings: Object.fromEntries(scenario.settings),
        denoise: Boolean(scenario.denoise),
        resetReport,
        branches: {
          full: {
            tier: branches.full.tier,
            diagnostics: branches.full.diagnostics,
            frame: branches.full.frame.source,
            png: path.relative(path.dirname(output), referencePath).replaceAll("\\", "/"),
            screenPng: path.relative(path.dirname(output), branches.full.screen.pngPath).replaceAll("\\", "/"),
          },
          display: {
            tier: branches.display.tier,
            diagnostics: branches.display.diagnostics,
            frame: branches.display.frame.source,
            png: path.relative(path.dirname(output), previewPath).replaceAll("\\", "/"),
            screenPng: path.relative(path.dirname(output), branches.display.screen.pngPath).replaceAll("\\", "/"),
          },
        },
        differencePng: path.relative(path.dirname(output), differencePath).replaceAll("\\", "/"),
        comparison,
        bands,
        screenComparison: summarizePair(screenFull, screenDisplay),
      });
      const focus = bands[band.id];
      console.log(
        scenario.id.padEnd(11),
        `reference ${branches.full.frame.source.width}px vs preview ${branches.display.frame.source.width}px`,
        `shown at ${referenceImage.width}x${referenceImage.height}`,
        `| focus ${band.id.padEnd(10)}`,
        `max ${String(focus.maxAbs).padStart(3)}`,
        `p99 ${String(focus.p99Abs).padStart(3)}`,
        `mean ${focus.meanAbs.toFixed(2).padStart(5)}`,
        `| energy ${focus.energy.preview.toFixed(1)} vs ${focus.energy.reference.toFixed(1)}`,
      );
    }

    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);
    const summary = {
      url,
      generatedAt: new Date().toISOString(),
      method: {
        question: "Does the display-scale Fit render look like the full-resolution render shown at screen size?",
        reference: "full-tier processed frame, read back and Lanczos-3 downsampled to the canvas CSS box",
        preview: "display-tier processed frame, read back and Lanczos-3 resampled to the same box",
        differenceImage: "absolute difference x4, saved beside the pair",
        screenComparison: "secondary: canvas screenshots as the browser displays them; not the reference",
        exportParity: "preview-versus-export parity is a separate open item; this assumes the renderer's full frame matches the export",
      },
      fixture: {
        path: fixture,
        width: WIDTH,
        height: HEIGHT,
        bandHeight: BAND_HEIGHT,
        note: "deterministic ACEScg scene-linear float TIFF, six content-class bands",
      },
      display: { ...display, tier: displayTier, ratio: tiers.ratio, reviewTarget: target },
      execution: "tiled",
      interpretationGated,
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
