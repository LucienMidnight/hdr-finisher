// Phase 2 ROI refinement -- the visible-region pass is opt-in, applies only to
// the refinement tier, and never limits interactive pan or zoom.
//
//   node tests/performance/roi-refinement.js --url http://127.0.0.1:8765
//
// The recommended behaviour: pan and zoom stay whole-frame (instant, no gaps),
// and the expensive refinement pass processes only the tiles the viewer can
// see while the retained target keeps the rest of the accepted frame.
//
// Negative controls:
//   - with the switch off, the refinement pass carries no viewport
//   - with the switch on and a magnified view, the refinement pass carries the
//     visible rect, retains the accepted frame, and skips offscreen tiles
//   - an interactive-tier pass carries no viewport even with the switch on

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ZOOM_PERCENT = 300;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "roi-refinement.json"));
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
    // Tiled so the scheduler viewport is on the path even for a small frame.
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    const renderRefinement = () => page.evaluate(async () => {
      const longEdge = Math.max(state.session.source.width, state.session.source.height);
      const rendered = await renderGpuDraft(state.currentView, { tier: "refinement", longEdge });
      return {
        rendered: Boolean(rendered),
        mode: state.roiPreviewMode,
        visible: window.HDRFinisherPerformance.visibleOutputRect(),
        metrics: window.HDRFinisherPerformance.tiledExecutionMetrics(),
      };
    });

    // Switch off (default): whole-frame refinement.
    const off = await renderRefinement();
    assert(off.mode === "fit", `The default ROI mode was ${off.mode}`);
    assert(
      off.metrics?.viewportRequested === false,
      `A refinement pass requested a viewport with the switch off: ${JSON.stringify(off.metrics)}`,
    );

    // Magnify so a real visible region exists.
    await page.evaluate((percent) => setCustomZoom(percent), ZOOM_PERCENT);
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    // Enable through the API for the measurement: a preference change schedules
    // the app's own render cycle, which races a diagnostic render and overwrites
    // the metrics under test. The user-facing select is verified at the end.
    const enabled = await page.evaluate(() => window.HDRFinisherPerformance.setRoiPreviewMode("refinement"));
    assert(enabled === "refinement", `The switch did not enable: ${enabled}`);
    const visibleRect = await page.evaluate(() => ({
      rect: window.HDRFinisherPerformance.visibleOutputRect(),
      canvasWidth: els.previewCanvas.width,
      canvasHeight: els.previewCanvas.height,
    }));
    assert(
      visibleRect.rect && visibleRect.rect.width > 0 && visibleRect.rect.height > 0,
      `A magnified viewer reported no visible rect: ${JSON.stringify(visibleRect)}`,
    );

    // The zoom-triggered settle may have presented at a different size, which
    // recreates the retained target so the first pass at this size must redraw
    // whole. In a window whose settle chose the same size, the target survives
    // and the same-generation cache correctly answers every candidate instead.
    // The fresh-generation pass below is the deterministic control either way.
    const onWarm = await renderRefinement();
    const warmRedrewWhole = onWarm.metrics?.retainedFrame === false && onWarm.metrics?.skippedTiles === 0;
    const warmAnsweredFromCache = onWarm.metrics?.retainedFrame === true
      && onWarm.metrics?.foregroundTiles === 0 && onWarm.metrics?.reusedTiles > 0;
    assert(
      warmRedrewWhole || warmAnsweredFromCache,
      `The first pass after the zoom neither redrew whole nor answered from the cache: ${JSON.stringify(onWarm.metrics)}`,
    );

    // A fresh generation: the retained frame is still on screen, but no tile in
    // it is current for the new generation, so this pass proves the foreground
    // restriction. At the same generation the pan cache would answer every tile
    // instead (the `cached` pass below).
    const generation = await page.evaluate(() => {
      invalidatePreview(state.currentView, { markDirty: false });
      window.HDRFinisherPerformance.cancelRoiCatchUp();
      return state.previewGeneration[state.currentView];
    });

    const on = await renderRefinement();
    assert(on.metrics?.viewportRequested === true, `The refinement pass did not request the visible rect: ${JSON.stringify(on.metrics)}`);
    // The measured rect may come from a later bitmap size (a settle pass can
    // swap 1280 for 1024), so compare the visible fraction of the frame.
    const fraction = (rect, width, height) => ({
      x: rect.x / width,
      y: rect.y / height,
      width: rect.width / width,
      height: rect.height / height,
    });
    const expected = fraction(visibleRect.rect, visibleRect.canvasWidth, visibleRect.canvasHeight);
    const actual = fraction(on.metrics.viewport, on.metrics.width, on.metrics.height);
    const close = (a, b) => Math.abs(a - b) < 0.02;
    assert(
      close(actual.x, expected.x) && close(actual.y, expected.y)
        && close(actual.width, expected.width) && close(actual.height, expected.height),
      `The viewport does not match the visible region: ${JSON.stringify({ actual, expected })}`,
    );
    assert(
      on.metrics.retainedFrame === true,
      `The ROI refinement did not retain the accepted frame: ${JSON.stringify(on.metrics)}`,
    );
    assert(
      on.metrics.skippedTiles > 0,
      `The ROI refinement processed every tile: ${JSON.stringify(on.metrics)}`,
    );
    assert(
      on.metrics.foregroundTiles < on.metrics.tileCount,
      `The ROI refinement did not restrict the foreground batch: ${JSON.stringify(on.metrics)}`,
    );
    assert(
      on.metrics.reusedTiles === 0,
      `A fresh generation reused a cached tile: ${JSON.stringify(on.metrics)}`,
    );

    // Same generation, same viewport: the display-scale pan cache holds every
    // candidate, so the pass processes nothing at all. This is the no-work
    // guarantee a pan back into a refined region relies on.
    await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());
    const cached = await renderRefinement();
    assert(
      cached.metrics?.viewportRequested === true && cached.metrics?.retainedFrame === true,
      `The cached pass did not keep the viewport and retained frame: ${JSON.stringify(cached.metrics)}`,
    );
    assert(
      cached.metrics.foregroundTiles === 0 && cached.metrics.reusedTiles > 0,
      `The cached pass did not answer from the pan cache: ${JSON.stringify(cached.metrics)}`,
    );
    assert(
      cached.metrics.reusedTiles + cached.metrics.foregroundTiles === cached.metrics.viewportTiles,
      `The cached pass partition is incomplete: ${JSON.stringify(cached.metrics)}`,
    );
    assert(cached.metrics.processedPixels === 0, `The cached pass processed pixels: ${JSON.stringify(cached.metrics)}`);

    // An interactive pass must stay whole frame even with the switch on. It may
    // refuse (the viewer is at another tier), in which case there is no new
    // presentation to inspect; the static contract test enforces the tier gate.
    await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());
    const interactive = await page.evaluate(async () => {
      const rendered = await renderGpuDraft(state.currentView, { tier: "interactive", longEdge: 512 });
      return {
        rendered: Boolean(rendered),
        metrics: window.HDRFinisherPerformance.tiledExecutionMetrics(),
      };
    });
    if (interactive.rendered) {
      assert(
        interactive.metrics?.viewportRequested === false,
        `An interactive pass was ROI-limited: ${JSON.stringify(interactive.metrics)}`,
      );
    }

    // The user-facing surface: the Settings select drives the same state. Done
    // last, because a preference change schedules the app's own render cycle.
    const selectDriven = await page.evaluate(() => {
      const select = document.getElementById("settings-roi-preview");
      const flip = (value) => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return state.roiPreviewMode;
      };
      const on = flip("refinement");
      const off = flip("fit");
      return { on, off };
    });
    assert(
      selectDriven.on === "refinement" && selectDriven.off === "fit",
      `The settings select did not drive the ROI mode: ${JSON.stringify(selectDriven)}`,
    );

    const summary = {
      url,
      zoomPercent: ZOOM_PERCENT,
      off: { mode: off.mode, viewportRequested: off.metrics?.viewportRequested ?? null },
      visibleRect,
      onWarm: {
        retainedFrame: onWarm.metrics?.retainedFrame ?? null,
        skippedTiles: onWarm.metrics?.skippedTiles ?? null,
        redrewWhole: warmRedrewWhole,
        answeredFromCache: warmAnsweredFromCache,
      },
      generation,
      on: {
        viewportRequested: on.metrics?.viewportRequested ?? null,
        viewport: on.metrics?.viewport ?? null,
        foregroundTiles: on.metrics?.foregroundTiles ?? null,
        reusedTiles: on.metrics?.reusedTiles ?? null,
        skippedTiles: on.metrics?.skippedTiles ?? null,
        retainedFrame: on.metrics?.retainedFrame ?? null,
      },
      cached: {
        viewportTiles: cached.metrics?.viewportTiles ?? null,
        foregroundTiles: cached.metrics?.foregroundTiles ?? null,
        reusedTiles: cached.metrics?.reusedTiles ?? null,
        processedPixels: cached.metrics?.processedPixels ?? null,
        retainedFrame: cached.metrics?.retainedFrame ?? null,
      },
      interactive: { rendered: interactive.rendered, viewportRequested: interactive.metrics?.viewportRequested ?? null },
      settingsSelect: selectDriven,
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
