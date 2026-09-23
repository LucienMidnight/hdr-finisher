// Phase 2 work item 9 -- legacy-versus-ROI parity over the visible region.
//
//   node tests/performance/roi-parity.js --url http://127.0.0.1:8765
//   node tests/performance/roi-parity.js --url http://127.0.0.1:8765 --denoise
//   node tests/performance/roi-parity.js --url http://127.0.0.1:8765 --denoise --input <file>
//
// Renders the same edit twice at the refinement tier: once whole frame (the
// legacy route) and once limited to the visible region (the ROI route), with a
// newer generation between them so the ROI pass re-renders the region instead
// of reusing the legacy pass's accepted tiles. The visible region is read back
// from the retained presentation target after each pass and compared pointwise
// through `HDRViewportRequest.compareWithLegacy`.
//
// `--denoise` enables Denoise reconstruction through the real controls before
// the A/B. Denoise is a separate analysis pipeline whose ROI route reconstructs
// tile by tile from cached evidence, so this is the scenario where the two
// routes could legitimately diverge; the counter snapshot in the summary shows
// the analysis and resolve work actually ran. Without `--input` the Denoise run
// uses the noisy generated source, because a smooth fixture gives the
// reconstruction nothing to do.
//
// The Phase 0 per-module tolerance sign-off is still outstanding, so this run
// records the raw maximum absolute difference and judges it against the
// smallest non-trivial epsilon an 8-bit presentation can represent (1/255).
// That provisional judgement is evidence for the sign-off, not the sign-off.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const ZOOM_PERCENT = 300;
const PROVISIONAL_TOLERANCE = 1 / 255;
const DENOISE_SOURCE_WIDTH = 2400;
const DENOISE_SOURCE_HEIGHT = 1600;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

// A representative film-look graph for the tolerance run: grain, halation,
// bloom, image structure (softness and microcontrast). These are the modules
// whose identity the Phase 0 tolerance table has to cover; Denoise is a
// separate analysis pipeline and is exercised by its own scenarios.
const FILM_LOOK_SETTINGS = [
  ["current.film_look.grain_amount", 40],
  ["current.film_look.grain_size", 60],
  ["current.film_look.halation_amount", 35],
  ["current.film_look.bloom_amount", 25],
  ["current.film_look.image_softness", 15],
  ["current.film_look.microcontrast", 20],
];

async function applyFilmLook(page) {
  await page.evaluate((entries) => {
    for (const [path, value] of entries) {
      const control = document.querySelector(`[data-path="${path}"]`);
      if (!control) throw new Error(`Missing control ${path}`);
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, FILM_LOOK_SETTINGS);
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
  // Return the state the render was asked for, not the values the driver meant
  // to set: the parity claim is about this graph, so the graph is verified.
  return page.evaluate((entries) => {
    const applied = {};
    for (const [path] of entries) {
      const key = path.split(".").pop();
      const look = state.adjustments[state.currentView].film_look || {};
      applied[key] = look[key] ?? null;
    }
    return applied;
  }, FILM_LOOK_SETTINGS);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const denoise = flag("--denoise");
  const film = flag("--film");
  const input = argument("--input", null);
  const suffix = `${denoise ? "-denoise" : ""}${film ? "-film" : ""}`;
  const output = argument("--output", path.join("output", "performance", `roi-parity${suffix}.json`));
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const waitReady = () => page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

  const denoiseCounters = () => page.evaluate(() => {
    const snapshot = state.gpuPreview.diagnosticsSnapshot();
    return {
      status: state.denoiseRuntime[state.currentView]?.status ?? null,
      enabled: Boolean(state.denoise?.[state.currentView]?.enabled),
      selector: {
        selectedSource: snapshot.denoise.selectedSource,
        resolvedResident: snapshot.denoise.resolvedResident,
        cacheReady: snapshot.denoise.cacheReady,
        identity: snapshot.denoise.identity,
        controls: snapshot.denoise.controls,
      },
      counters: {
        analysisCalls: snapshot.denoise.analysisCalls,
        analysisDispatches: snapshot.denoise.analysisDispatches,
        analysisTiles: snapshot.denoise.analysisTiles,
        resolveCalls: snapshot.denoise.resolveCalls,
        resolveDispatches: snapshot.denoise.resolveDispatches,
        resolveTiles: snapshot.denoise.resolveTiles,
        atomicSwaps: snapshot.denoise.atomicSwaps,
        toggles: snapshot.denoise.toggles,
        evidenceBytes: snapshot.denoise.evidenceBytes,
      },
    };
  });

  // The real control delegates to this same async action but a DOM dispatch
  // cannot expose its promise; awaiting the action directly is what keeps the
  // A/B from racing the analysis it starts (the pattern full-tier-denoise.js
  // already uses).
  const enableDenoise = async () => {
    await page.evaluate(async () => {
      const group = document.querySelector(".denoise-group .group-toggle");
      if (group.getAttribute("aria-expanded") !== "true") group.click();
      const amount = document.querySelector("#denoise-amount");
      amount.value = "1";
      amount.dispatchEvent(new Event("input", { bubbles: true }));
      amount.dispatchEvent(new Event("change", { bubbles: true }));
      if (state.denoise[state.currentView].enabled !== true) {
        await setDenoiseEnabled(true);
      }
    });
    await page.waitForFunction(
      () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
      null, { timeout: 900000 },
    );
    const status = await page.evaluate(() => state.denoiseRuntime[state.currentView].status);
    assert(status === "ready", `Denoise did not reach ready: ${status}`);
    await page.evaluate(async () => { await state.gpuPreview.waitForSubmittedWork(); });
    await waitReady();
  };

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    let source;
    if (input) {
      await page.setInputFiles("#file-input", input);
      source = { kind: "file", path: input };
    } else if (denoise) {
      const noisy = ensureLargeNoisySource(DENOISE_SOURCE_WIDTH, DENOISE_SOURCE_HEIGHT);
      await page.setInputFiles("#file-input", noisy);
      source = { kind: "generated-noisy", path: noisy, width: DENOISE_SOURCE_WIDTH, height: DENOISE_SOURCE_HEIGHT };
    } else {
      await page.getByRole("button", { name: "Load test pattern" }).click();
      source = { kind: "test-pattern" };
    }
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 300000 });
    // A file source without color metadata raises the interpretation gate; the
    // test pattern and the generated 8-bit noisy TIFF do not.
    await page.waitForTimeout(500);
    if (await page.locator("#interpretation-gate").isVisible().catch(() => false)) {
      await page.click("#accept-interpretation");
    }
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await waitReady();
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await waitReady();

    await page.evaluate((percent) => setCustomZoom(percent), ZOOM_PERCENT);
    await waitReady();
    const enabled = await page.evaluate(() => window.HDRFinisherPerformance.setRoiPreviewMode("refinement"));
    assert(enabled === "refinement", `The ROI mode did not enable: ${enabled}`);
    await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());
    const filmLook = film ? await applyFilmLook(page) : null;
    if (film) {
      for (const [path, value] of FILM_LOOK_SETTINGS) {
        const key = path.split(".").pop();
        assert(Number(filmLook[key]) === Number(value),
          `Film look ${path} is ${filmLook[key]}, wanted ${value}: ${JSON.stringify(filmLook)}`);
      }
    }
    await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());
    const denoiseBefore = denoise ? await denoiseCounters() : null;
    if (denoise) {
      await enableDenoise();
      await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());
    }
    const denoiseReady = denoise ? await denoiseCounters() : null;

    const outcome = await page.evaluate(async (tolerance) => {
      const parity = await window.HDRFinisherPerformance.roiParity({ tolerance });
      const metrics = window.HDRFinisherPerformance.tiledExecutionMetrics();
      const coordinator = window.HDRFinisherPerformance.renderCoordinator();
      return { parity, metrics, coordinator };
    }, 0);
    const denoiseAfter = denoise ? await denoiseCounters() : null;

    assert(outcome.parity?.ok, `The parity run did not complete: ${JSON.stringify(outcome.parity)}`);
    const comparison = outcome.parity.comparison;
    assert(comparison, "The parity run produced no comparison");
    assert(comparison.comparedPixels > 0, `The comparison covered no pixels: ${JSON.stringify(comparison)}`);
    assert(
      outcome.parity.legacy.pixels.width === outcome.parity.roi.pixels.width
        && outcome.parity.legacy.pixels.height === outcome.parity.roi.pixels.height,
      `The two readbacks differ in size: ${JSON.stringify(outcome.parity)}`,
    );
    // The ROI pass under test must have re-rendered the region rather than
    // reusing the legacy pass's tiles: fresh generation, real foreground work,
    // a viewport, and a retained frame.
    assert(
      outcome.metrics?.viewportRequested === true,
      `The ROI pass did not request a viewport: ${JSON.stringify(outcome.metrics)}`,
    );
    assert(
      outcome.metrics?.foregroundTiles > 0,
      `The ROI pass did no foreground work, so nothing was compared: ${JSON.stringify(outcome.metrics)}`,
    );
    if (denoise) {
      // The run only proves anything if the analysis pipeline was active and
      // the parity passes resolved from it rather than from the enable-time
      // render: the counters are cumulative, so "after" must exceed "ready".
      assert(denoiseReady?.selector.selectedSource === "resolved",
        `Denoise never selected its resolved source: ${JSON.stringify(denoiseReady)}`);
      assert(denoiseReady?.counters.analysisDispatches > 0 && denoiseReady?.counters.analysisTiles > 0,
        `Denoise analysis never dispatched: ${JSON.stringify(denoiseReady)}`);
      assert(denoiseAfter?.counters.resolveDispatches > denoiseReady?.counters.resolveDispatches,
        `The parity passes did not resolve Denoise from the cache: ${JSON.stringify({ ready: denoiseReady?.counters, after: denoiseAfter?.counters })}`);
      assert(denoiseAfter?.counters.resolveTiles > denoiseReady?.counters.resolveTiles,
        `The parity passes resolved no Denoise tiles: ${JSON.stringify({ ready: denoiseReady?.counters, after: denoiseAfter?.counters })}`);
    }

    const summary = {
      url,
      zoomPercent: ZOOM_PERCENT,
      source,
      filmLook,
      denoise: denoise ? {
        settings: denoiseReady?.selector.controls ?? null,
        identity: denoiseReady?.selector.identity ?? null,
        before: denoiseBefore,
        ready: denoiseReady,
        after: denoiseAfter,
      } : null,
      longEdge: outcome.parity.longEdge,
      visible: outcome.parity.visible,
      legacy: outcome.parity.legacy,
      roi: outcome.parity.roi,
      comparison: {
        comparedPixels: comparison.comparedPixels,
        maxAbsDifference: comparison.maxAbsDifference,
        tolerance: comparison.tolerance,
        withinTolerance: comparison.withinTolerance,
      },
      provisional: {
        tolerance: PROVISIONAL_TOLERANCE,
        within: comparison.maxAbsDifference <= PROVISIONAL_TOLERANCE,
        note: "Phase 0 per-module tolerance sign-off is outstanding; 1/255 is an 8-bit epsilon, not an approved tolerance.",
      },
      roiMetrics: {
        viewportRequested: outcome.metrics?.viewportRequested ?? null,
        foregroundTiles: outcome.metrics?.foregroundTiles ?? null,
        reusedTiles: outcome.metrics?.reusedTiles ?? null,
        skippedTiles: outcome.metrics?.skippedTiles ?? null,
        retainedFrame: outcome.metrics?.retainedFrame ?? null,
      },
      coordinator: {
        generations: outcome.coordinator?.lanes?.hdr?.generations ?? null,
        inFlight: outcome.coordinator?.lanes?.hdr?.inFlight ?? null,
        pending: outcome.coordinator?.lanes?.hdr?.pending ?? null,
        catchUpTimerPending: outcome.coordinator?.lanes?.hdr?.catchUpTimerPending ?? null,
        metrics: outcome.coordinator?.metrics ?? null,
      },
      pageErrors,
    };
    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
