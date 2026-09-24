// Regression driver for the lost-wake-up stall the owner hit while adding a
// luma-range local at a magnified zoom.
//
//   node tests/zoom-refinement-stall.js --url http://127.0.0.1:8799
//   node tests/run-in-electron.js tests/zoom-refinement-stall.js --packaged
//
// Two parts, because the organic defect is a race and a control has to fail
// without the fix every time:
//
//   1. The reported burst: add a luma local, then supersede it with a zoom and
//      a grade. This is the user path; the driver records whether it converges
//      and how many watchdog re-arms it needed.
//   2. The injected lost wake-up: retire the scheduler for a change that needs
//      a new pass and drop the follow-up that would have scheduled it. Nothing
//      is left queued, in flight, or pending, which is exactly the state the
//      packaged stall was observed in. Without the watchdog the viewer stays in
//      "Preparing" until the next input; the driver therefore requires it to
//      converge on its own, with at least one re-arm, within the timeout.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/zoom-refinement-stall.json"));
const convergeTimeoutMs = Math.max(5000, Number(option("--timeout", "20000")));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const readViewer = (page) => page.evaluate(() => {
  const viewer = viewerState();
  return {
    status: viewer.status,
    detail: viewer.detail ?? null,
    exact: state.acceptedPresentation?.exact === true,
    processedLongEdge: state.acceptedPresentation?.processedLongEdge ?? null,
    requiredEdge: requiredProcessingLongEdge(),
    rearms: window.HDRFinisherPerformance.previewWatchdog().rearms,
    schedulerCurrent: state.previewScheduler?.current
      ? state.previewScheduler.current.imageGeneration
      : null,
  };
});

async function waitForConvergence(page, timeoutMs) {
  const started = Date.now();
  let observed = null;
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(500);
    observed = await readViewer(page);
    if (observed.status === "ready" && observed.exact
      && observed.processedLongEdge === observed.requiredEdge) {
      return { converged: true, convergedMs: Date.now() - started, observed };
    }
  }
  return { converged: false, convergedMs: Date.now() - started, observed };
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: option("--channel", "msedge") });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(ensureLargeNoisySource(7968, 5320));
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 300000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });
    await page.evaluate(() => setCustomZoom(183));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    // Part 1: the reported burst.
    const rearmsBeforeBurst = (await readViewer(page)).rearms;
    await page.evaluate(() => activateWorkflowTab("grade"));
    await page.locator("#grade-mode-local").click();
    await page.locator("#local-add-adjustment").click();
    await page.locator('[data-local-tool="luminance_range"]').click();
    await page.waitForTimeout(250);
    await page.evaluate(() => setCustomZoom(200));
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const control = document.querySelector('[data-path="hdr.exposure"]');
      control.value = "0.4";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => setCustomZoom(183));
    const burst = await waitForConvergence(page, convergeTimeoutMs);
    const burstRearms = burst.observed ? burst.observed.rearms - rearmsBeforeBurst : 0;
    assert(burst.converged,
      `The reported burst never converged: ${JSON.stringify(burst.observed)}`);
    console.log(`[stall] burst converged in ${burst.convergedMs}ms with ${burstRearms} re-arms`);

    // Part 2: prove the safety net is what recovers a dropped wake-up. The
    // tier change needs a pass at a new edge and schedules exactly one; the
    // cancel drops that pass with nothing queued, which is the observed stall
    // state. With the watchdog disabled it must stay stalled, and with it
    // enabled it must converge on its own.
    await page.evaluate(() => window.HDRFinisherPerformance.previewWatchdogEnable(false));
    const stalled = await page.evaluate(() => {
      // 2048 is a legal tier and a different edge than the display tier the
      // viewer is holding, so "ready" is genuinely out of reach without work.
      applyPreviewResolution("2048", { schedule: true });
      state.previewScheduler?.cancel();
      window.clearTimeout(state.previewScheduler?.settleTimer);
      if (state.previewScheduler) state.previewScheduler.settleTimer = null;
      return {
        status: viewerState().status,
        requiredEdge: requiredProcessingLongEdge(),
        schedulerCurrent: state.previewScheduler?.current
          ? state.previewScheduler.current.imageGeneration
          : null,
      };
    });
    assert(stalled.status !== "ready" && stalled.schedulerCurrent === null,
      `The injected state is not a stall: ${JSON.stringify(stalled)}`);
    // The injection schedules once (and that schedule resets the watchdog
    // budget), so the baseline is read after it, not before.
    const rearmsAtInjection = (await readViewer(page)).rearms;
    const withoutWatchdog = await waitForConvergence(page, 6000);
    assert(!withoutWatchdog.converged,
      `The viewer converged with the watchdog disabled (${withoutWatchdog.convergedMs}ms); the injection is not a stall: ${JSON.stringify(withoutWatchdog.observed)}`);
    await page.evaluate(() => window.HDRFinisherPerformance.previewWatchdogEnable(true));
    const recovery = await waitForConvergence(page, convergeTimeoutMs);
    assert(recovery.converged,
      `The injected lost wake-up never converged: ${JSON.stringify(recovery.observed)}`);
    const reArmsUsed = recovery.observed.rearms - rearmsAtInjection;
    assert(reArmsUsed > 0,
      `The viewer converged without a re-arm (${reArmsUsed}); the safety net is not doing the work.`);
    assert(pageErrors.length === 0, `Page errors occurred: ${pageErrors.join(" | ")}`);

    const report = {
      recordedAt: new Date().toISOString(),
      burst: { converged: burst.converged, convergedMs: burst.convergedMs, reArmsUsed: burstRearms },
      injectedStall: {
        stalledStatus: stalled.status,
        requiredEdge: stalled.requiredEdge,
        withoutWatchdogConverged: withoutWatchdog.converged,
        withoutWatchdogMs: withoutWatchdog.convergedMs,
        convergedMs: recovery.convergedMs,
        reArmsUsed,
        finalState: recovery.observed,
      },
      pageErrors,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
