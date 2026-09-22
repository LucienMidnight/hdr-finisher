// Phase 2 work item 8 verification -- the display-scale pan cache.
//
//   node tests/performance/roi-pan-cache.js --url http://127.0.0.1:8799
//
// A pan is a compositor operation and never waits on a render. What the pan
// cache adds is that the deferred refinement pass over the new visible region
// reuses every tile the retained frame already holds at the current
// generation:
//   - a pan that exposes a new strip renders only that strip, not the frame
//   - a pan back into a region refined for this generation renders nothing
//
// The generation boundary is drawn with the same diagnostic refinement pass
// the ROI scenario uses (so the ledger is partial by construction), and the
// pans themselves are real scroll events, so the deferred pan follow-up is the
// app's own path. Pass metrics come from the renderer's stage record, which a
// later render cannot overwrite.
//
// Negative controls:
//   - a pan pass may not process the whole frame or lose the retained frame
//   - a pan back may not process a single tile or submit more than the frame
//     copy

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

// 600% so the padded visible region is narrower than one tile: the ROI pass
// then accepts exactly one tile and panning to an end of the frame exposes a
// tile it never touched. At 300% the padding straddled a tile boundary and the
// refined region covered both ends' tiles.
const ZOOM_PERCENT = 600;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function watchPanTimer(page) {
  await page.evaluate(() => {
    window.__panTimerSeen = false;
    const poll = () => {
      if (window.HDRFinisherPerformance.roiPanState().timerPending) window.__panTimerSeen = true;
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

async function panTimerSeen(page) {
  return page.evaluate(() => window.__panTimerSeen === true);
}

async function waitForPanPass(page, since) {
  const handle = await page.waitForFunction(({ since: after }) => {
    const stages = window.HDRFinisherPerformance.gpuSnapshot()?.stages || [];
    const entry = [...stages].reverse().find((stage) => (
      stage.stage === "tiled-render" && stage.panPass === true && stage.at > after
    ));
    return entry || null;
  }, { since }, { timeout: 300000 });
  return handle.jsonValue();
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "roi-pan-cache.json"));
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

    // Full tier: the test pattern's own edge. At the default 1K tier the
    // output grid is only 2x2 tiles and any visible crop is wider than one
    // tile, so a pan could never expose a tile the ROI pass had not already
    // refined. At Full the grid is 3x2 and the cache has somewhere to miss.
    // The tier change round-trips through the shell preferences, which resets
    // the execution override, so the override is applied after it.
    await page.evaluate(() => {
      const select = document.getElementById("preview-resolution");
      select.value = "full";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    await page.evaluate((percent) => setCustomZoom(percent), ZOOM_PERCENT);
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    const setup = await page.evaluate(() => {
      window.HDRFinisherPerformance.setRoiPreviewMode("refinement");
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      return {
        mode: window.HDRFinisherPerformance.roiPreviewMode(),
        visible: window.HDRFinisherPerformance.visibleOutputRect(),
        resolution: state.previewResolution,
        override: state.executionOverride ?? null,
      };
    });
    assert(setup.mode === "refinement", `The ROI mode did not enable: ${setup.mode}`);
    assert(setup.resolution === "full", `The tier did not change: ${setup.resolution}`);
    assert(setup.override === "tiled", `The execution override was lost: ${setup.override}`);
    assert(
      setup.visible && setup.visible.width > 0 && setup.visible.height > 0,
      `A magnified viewer reported no visible rect: ${JSON.stringify(setup.visible)}`,
    );

    const renderRefinement = () => page.evaluate(async () => {
      const longEdge = previewTargetLongEdge();
      const rendered = await renderGpuDraft(state.currentView, { tier: "refinement", longEdge });
      return { rendered: Boolean(rendered), metrics: window.HDRFinisherPerformance.tiledExecutionMetrics() };
    });

    // The initial load already presented a whole-frame tiled frame at the
    // selected tier, which is the warm control: every tile is current at
    // generation 0 and the accepted frame is at the tier the viewer selected.
    const warm = await page.evaluate(() => {
      const metrics = window.HDRFinisherPerformance.tiledExecutionMetrics();
      return metrics
        ? {
          foregroundTiles: metrics.foregroundTiles,
          skippedTiles: metrics.skippedTiles,
          tileCount: metrics.tileCount,
          retainedFrame: metrics.retainedFrame,
        }
        : null;
    });
    assert(
      warm && warm.skippedTiles === 0 && warm.foregroundTiles === warm.tileCount,
      `The warm frame was not whole: ${JSON.stringify(warm)}`,
    );
    const acceptedBefore = await page.evaluate(() => ({
      exact: state.acceptedPresentation?.exact === true,
      processedLongEdge: state.acceptedPresentation?.processedLongEdge ?? null,
      targetLongEdge: previewTargetLongEdge(),
    }));
    assert(
      acceptedBefore.exact && acceptedBefore.processedLongEdge === acceptedBefore.targetLongEdge,
      `The accepted frame is not at the selected tier: ${JSON.stringify(acceptedBefore)}`,
    );
    // A new generation: the retained frame is still on screen, but no tile in
    // it is current for this generation. The ROI pass may only accept the
    // tiles it actually processes, which leaves the ledger partial -- exactly
    // the state a pan after an edit finds.
    const generation = await page.evaluate(() => {
      invalidatePreview(state.currentView, { markDirty: false });
      window.HDRFinisherPerformance.cancelRoiCatchUp();
      return state.previewGeneration[state.currentView];
    });
    const on = await renderRefinement();
    assert(on.metrics?.viewportRequested === true, `The ROI pass carried no viewport: ${JSON.stringify(on.metrics)}`);
    assert(on.metrics?.retainedFrame === true, `The ROI pass lost the retained frame: ${JSON.stringify(on.metrics)}`);
    assert(
      on.metrics.reusedTiles === 0 && on.metrics.foregroundTiles > 0
        && on.metrics.foregroundTiles < on.metrics.tileCount,
      `The fresh-generation ROI pass did not process only its region: ${JSON.stringify(on.metrics)}`,
    );
    assert(on.metrics.roi && on.metrics.tileSize > 0, `The ROI pass reported no padded region: ${JSON.stringify(on.metrics)}`);

    // Pan 1: scroll to the end of the frame the ROI pass did not refine, so a
    // strip that is not current for this generation is exposed. The direction
    // is chosen away from the refined region, which is deterministic whatever
    // the viewer's centring did.
    const scroll = await page.evaluate(() => ({
      left: els.dropzone.scrollLeft,
      max: Math.max(0, els.dropzone.scrollWidth - els.dropzone.clientWidth),
    }));
    const roiCenter = on.metrics.roi.x + on.metrics.roi.width / 2;
    const exposedScroll = roiCenter > on.metrics.width / 2 ? 0 : scroll.max;
    assert(
      exposedScroll !== scroll.left || scroll.max === 0,
      `The viewer had nowhere to pan: ${JSON.stringify({ scroll, roiCenter })}`,
    );

    await watchPanTimer(page);
    const pan1At = await page.evaluate((left) => {
      window.HDRFinisherPerformance.cancelRoiCatchUp();
      els.dropzone.scrollLeft = left;
      return performance.now();
    }, exposedScroll);
    const pan1 = await waitForPanPass(page, pan1At);
    assert(await panTimerSeen(page), "The scroll did not schedule the deferred pan follow-up");
    assert(pan1.panPass === true, `The pan pass was not labelled: ${JSON.stringify(pan1)}`);
    assert(
      pan1.viewportRequested === true && pan1.retainedFrame === true,
      `The pan pass did not use the retained frame: ${JSON.stringify(pan1)}`,
    );
    assert(
      pan1.foregroundTiles > 0 && pan1.foregroundTiles < pan1.tileCount,
      `The pan pass did not limit itself to the exposed strip: ${JSON.stringify(pan1)}`,
    );
    assert(
      pan1.reusedTiles + pan1.foregroundTiles === pan1.viewportTiles,
      `The pan pass partition is incomplete: ${JSON.stringify(pan1)}`,
    );
    assert(pan1.processedPixels > 0, `The pan pass processed no pixels: ${JSON.stringify(pan1)}`);
    const rescheduled = await page.evaluate(() => window.HDRFinisherPerformance.roiCatchUpState().timerPending);
    assert(rescheduled === true, "The pan pass did not reschedule the whole-frame catch-up");

    // Pan 2: back into the region the ROI pass refined for this generation. The
    // cache must answer every candidate, so nothing runs and nothing is
    // presented but the retained frame itself.
    await watchPanTimer(page);
    const pan2At = await page.evaluate((left) => {
      window.HDRFinisherPerformance.cancelRoiCatchUp();
      els.dropzone.scrollLeft = left;
      return performance.now();
    }, scroll.left);
    const pan2 = await waitForPanPass(page, pan2At);
    assert(await panTimerSeen(page), "The pan-back did not schedule the deferred pan follow-up");
    assert(
      pan2.viewportRequested === true && pan2.retainedFrame === true,
      `The pan-back did not use the retained frame: ${JSON.stringify(pan2)}`,
    );
    assert(
      pan2.foregroundTiles === 0 && pan2.reusedTiles > 0,
      `The pan-back did not answer from the cache: ${JSON.stringify(pan2)}`,
    );
    assert(
      pan2.viewportTiles === pan2.reusedTiles,
      `The pan-back partition is incomplete: ${JSON.stringify(pan2)}`,
    );
    assert(pan2.processedPixels === 0, `The pan-back processed pixels: ${JSON.stringify(pan2)}`);
    assert(pan2.submissions === 1, `The pan-back submitted more than the frame copy: ${JSON.stringify(pan2)}`);

    const settled = await page.evaluate(() => ({
      viewer: viewerState(),
      accepted: state.acceptedPresentation
        ? {
          generation: state.acceptedPresentation.generation,
          execution: state.acceptedPresentation.execution,
          exact: state.acceptedPresentation.exact,
        }
        : null,
      inFlight: state.gpuDraftInFlight !== null,
    }));
    assert(settled.accepted?.generation === generation, `The accepted generation moved: ${JSON.stringify(settled.accepted)}`);
    assert(settled.accepted?.execution === "tiled", `The accepted frame was ${settled.accepted?.execution}`);
    assert(settled.inFlight === false, "A render was still in flight after the pan-back");

    const summarize = (stage) => (stage ? {
      at: Math.round(stage.at),
      viewportRequested: stage.viewportRequested === true,
      retainedFrame: stage.retainedFrame === true,
      tileCount: stage.tileCount,
      viewportTiles: stage.viewportTiles,
      foregroundTiles: stage.foregroundTiles,
      reusedTiles: stage.reusedTiles,
      skippedTiles: stage.skippedTiles,
      processedPixels: stage.processedPixels,
      reusedPixels: stage.reusedPixels,
      outputPixels: stage.outputPixels,
      submissions: stage.submissions,
    } : null);

    const summary = {
      url,
      zoomPercent: ZOOM_PERCENT,
      generation,
      visible: setup.visible,
      scroll: { original: scroll.left, exposed: exposedScroll, max: scroll.max },
      warm: { foregroundTiles: warm?.foregroundTiles ?? null, skippedTiles: warm?.skippedTiles ?? null },
      on: summarize(on.metrics),
      pan1: summarize(pan1),
      pan2: summarize(pan2),
      accepted: settled.accepted,
      viewer: settled.viewer?.status,
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
