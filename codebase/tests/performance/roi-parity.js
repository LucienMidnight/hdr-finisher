// Phase 2 work item 9 -- legacy-versus-ROI parity over the visible region.
//
//   node tests/performance/roi-parity.js --url http://127.0.0.1:8765
//
// Renders the same edit twice at the refinement tier: once whole frame (the
// legacy route) and once limited to the visible region (the ROI route), with a
// newer generation between them so the ROI pass re-renders the region instead
// of reusing the legacy pass's accepted tiles. The visible region is read back
// from the retained presentation target after each pass and compared pointwise
// through `HDRViewportRequest.compareWithLegacy`.
//
// The Phase 0 per-module tolerance sign-off is still outstanding, so this run
// records the raw maximum absolute difference and judges it against the
// smallest non-trivial epsilon an 8-bit presentation can represent (1/255).
// That provisional judgement is evidence for the sign-off, not the sign-off.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ZOOM_PERCENT = 300;
const PROVISIONAL_TOLERANCE = 1 / 255;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "roi-parity.json"));
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
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 120000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    await page.evaluate((percent) => setCustomZoom(percent), ZOOM_PERCENT);
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    const enabled = await page.evaluate(() => window.HDRFinisherPerformance.setRoiPreviewMode("refinement"));
    assert(enabled === "refinement", `The ROI mode did not enable: ${enabled}`);
    await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());

    const outcome = await page.evaluate(async (tolerance) => {
      const parity = await window.HDRFinisherPerformance.roiParity({ tolerance });
      const metrics = window.HDRFinisherPerformance.tiledExecutionMetrics();
      const coordinator = window.HDRFinisherPerformance.renderCoordinator();
      return { parity, metrics, coordinator };
    }, 0);

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

    const summary = {
      url,
      zoomPercent: ZOOM_PERCENT,
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
