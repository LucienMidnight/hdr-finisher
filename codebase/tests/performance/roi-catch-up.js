// Phase 2 work item 7 verification -- the deferred whole-frame catch-up that
// closes the ROI refinement seam.
//
//   node tests/performance/roi-catch-up.js --url http://127.0.0.1:8799
//
// The earlier attempt at this driver raced the app's own settle/refine cycle:
// it polled `tiledExecutionMetrics` while a later pass could overwrite it, and
// it could never see `roiCatchUp` true because the flag was not forwarded from
// sourceOptions to the encoder. This driver drives a real edit through the
// app's control path, waits for the ROI pass to arm the catch-up, waits for
// genuine idle, and then reads the renderer's own stage record of the catch-up
// pass -- a record no later render can overwrite.
//
// Asserts, for the catch-up pass itself:
//   - roiCatchUp true and viewportRequested false (it is a whole-frame pass)
//   - skippedTiles 0 and retainedFrame true (it drew into the accepted frame)
//   - the pass happened after the ROI pass armed the timer, not before
//   - the viewer settles Ready on the generation the edit produced
//
// Negative controls:
//   - no presentation may move the accepted generation past the edit
//   - the catch-up must not carry a viewport or skip a tile

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
  const output = argument("--output", path.join("output", "performance", "roi-catch-up.json"));
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
    // Tiled so the scheduler viewport and the catch-up are on the path even
    // for a small frame.
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });

    // A real visible region: at Fit there is nothing for the ROI pass to skip
    // and no seam for the catch-up to close.
    await page.evaluate((percent) => setCustomZoom(percent), ZOOM_PERCENT);
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    const setup = await page.evaluate(() => {
      window.HDRFinisherPerformance.setRoiPreviewMode("refinement");
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      return {
        mode: window.HDRFinisherPerformance.roiPreviewMode(),
        visible: window.HDRFinisherPerformance.visibleOutputRect(),
      };
    });
    assert(setup.mode === "refinement", `The ROI mode did not enable: ${setup.mode}`);
    assert(
      setup.visible && setup.visible.width > 0 && setup.visible.height > 0,
      `A magnified viewer reported no visible rect: ${JSON.stringify(setup.visible)}`,
    );

    // A real edit through the ordinary control path. The app's own
    // frame/settle/refinement cycle runs; only that cycle's ROI pass may arm
    // the catch-up this driver is about.
    const edit = await page.evaluate(() => {
      const input = document.getElementById("hdr-exposure");
      const before = state.previewGeneration.hdr;
      input.value = String(Math.min(4, Number(input.value) + 0.35));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { before, after: state.previewGeneration.hdr, value: input.value };
    });
    assert(edit.after > edit.before, `The edit did not advance the generation: ${JSON.stringify(edit)}`);

    // Waiting for the timer is waiting for the app's own ROI pass to present:
    // scheduleRoiCatchUp is only called after a viewport pass is accepted.
    await page.waitForFunction(
      () => window.HDRFinisherPerformance.roiCatchUpState().timerPending === true,
      null,
      { timeout: 300000 },
    );
    // The app may commit the edit through the backend and advance the
    // generation once more before the ROI pass presents, so the armed
    // generation -- not the optimistic one the input event returned -- is the
    // generation the catch-up must settle.
    const armed = await page.evaluate(() => ({
      at: performance.now(),
      generation: state.previewGeneration[state.currentView],
    }));
    const armedAt = armed.at;
    // Genuine idle: the settle/refine cycle owns the device until nothing is in
    // flight. The catch-up is the only work left after this.
    await page.waitForFunction(() => state.gpuDraftInFlight === null, null, { timeout: 300000 });

    const handle = await page.waitForFunction(({ since }) => {
      const stages = window.HDRFinisherPerformance.gpuSnapshot()?.stages || [];
      const entry = [...stages].reverse().find((stage) => (
        stage.stage === "tiled-render" && stage.roiCatchUp === true && stage.at > since
      ));
      return entry || null;
    }, { since: armedAt }, { timeout: 300000 });
    const catchUp = await handle.jsonValue();

    // The ROI pass that armed the timer must exist, and it must have carried
    // the viewport: the catch-up only exists to close that pass's seam.
    const roiPass = await page.evaluate(({ since }) => {
      const stages = window.HDRFinisherPerformance.gpuSnapshot()?.stages || [];
      return [...stages].reverse().find((stage) => (
        stage.stage === "tiled-render" && stage.viewportRequested === true && stage.at < since
      )) || null;
    }, { since: catchUp.at });

    // Everything the driver asserts about the catch-up pass itself.
    assert(catchUp.roiCatchUp === true, `The catch-up flag was lost: ${JSON.stringify(catchUp)}`);
    assert(
      catchUp.viewportRequested === false,
      `The catch-up was viewport-limited: ${JSON.stringify(catchUp)}`,
    );
    // `viewport` in the metrics is the effective visible set, which for a
    // whole-frame pass is the whole output; the request flag above is the
    // claim that matters.
    assert(
      !catchUp.viewport
        || (catchUp.viewport.x === 0 && catchUp.viewport.y === 0
          && catchUp.viewport.width === catchUp.width && catchUp.viewport.height === catchUp.height),
      `The catch-up effective viewport was not the whole frame: ${JSON.stringify(catchUp.viewport)}`,
    );
    assert(
      catchUp.skippedTiles === 0 && catchUp.foregroundTiles === catchUp.tileCount,
      `The catch-up skipped tiles: ${JSON.stringify(catchUp)}`,
    );
    assert(
      catchUp.retainedFrame === true,
      `The catch-up did not retain the accepted frame: ${JSON.stringify(catchUp)}`,
    );
    assert(catchUp.panPass !== true, `The catch-up was labelled a pan pass: ${JSON.stringify(catchUp)}`);
    assert(roiPass, "No ROI viewport pass preceded the catch-up");
    assert(roiPass.at < catchUp.at, `The catch-up preceded its ROI pass: ${roiPass.at} >= ${catchUp.at}`);

    const settled = await page.evaluate(() => ({
      viewer: viewerState(),
      accepted: state.acceptedPresentation
        ? {
          generation: state.acceptedPresentation.generation,
          execution: state.acceptedPresentation.execution,
          transport: state.acceptedPresentation.transport,
          exact: state.acceptedPresentation.exact,
        }
        : null,
      timerPending: window.HDRFinisherPerformance.roiCatchUpState().timerPending,
      inFlight: state.gpuDraftInFlight !== null,
      stages: (window.HDRFinisherPerformance.gpuSnapshot()?.stages || [])
        .filter((stage) => stage.stage === "tiled-render")
        .map((stage) => ({
          at: Math.round(stage.at),
          roiCatchUp: stage.roiCatchUp === true,
          viewportRequested: stage.viewportRequested === true,
          retainedFrame: stage.retainedFrame === true,
          foregroundTiles: stage.foregroundTiles,
          reusedTiles: stage.reusedTiles,
          skippedTiles: stage.skippedTiles,
          panPass: stage.panPass === true,
        })),
    }));
    assert(settled.timerPending === false, "The catch-up timer was still pending after the pass");
    assert(settled.inFlight === false, "A render was still in flight after the catch-up");
    assert(
      settled.accepted?.generation === armed.generation && armed.generation >= edit.after,
      `The accepted generation moved: ${JSON.stringify({ edit, armed, accepted: settled.accepted })}`,
    );
    assert(settled.accepted?.execution === "tiled", `The accepted frame was ${settled.accepted?.execution}`);
    assert(settled.viewer?.status === "ready", `The viewer did not settle Ready: ${JSON.stringify(settled.viewer)}`);

    const summary = {
      url,
      zoomPercent: ZOOM_PERCENT,
      edit,
      armed: { at: Math.round(armed.at), generation: armed.generation },
      roiPass: roiPass ? {
        at: Math.round(roiPass.at),
        foregroundTiles: roiPass.foregroundTiles,
        reusedTiles: roiPass.reusedTiles,
        skippedTiles: roiPass.skippedTiles,
        retainedFrame: roiPass.retainedFrame,
      } : null,
      catchUp: {
        at: Math.round(catchUp.at),
        roiCatchUp: catchUp.roiCatchUp,
        viewportRequested: catchUp.viewportRequested,
        viewport: catchUp.viewport,
        retainedFrame: catchUp.retainedFrame,
        tileCount: catchUp.tileCount,
        foregroundTiles: catchUp.foregroundTiles,
        reusedTiles: catchUp.reusedTiles,
        skippedTiles: catchUp.skippedTiles,
        durationMs: catchUp.durationMs,
      },
      accepted: settled.accepted,
      viewer: settled.viewer?.status,
      tiledStages: settled.stages,
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
