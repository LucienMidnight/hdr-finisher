/**
 * Phase 5 item 5: inactive-lane work waits for true idle, and an explicit
 * comparison gesture still gets the lane.
 *
 * `requestIdleCallback` only reports a gap in the browser's event loop, so the
 * pre-Phase-5 scheduler started the other lane's whole-frame proxy upload
 * whenever the loop paused -- including the gap between a settled frame and
 * the refinement that follows it. The app now re-asks "is the editor idle?"
 * when the idle callback fires and retries later if it is not, and the
 * single-frame comparison control stays usable while a lane is unprepared:
 * clicking or holding it starts the load at foreground priority instead of
 * leaving the gesture inert.
 *
 * What this asserts:
 *
 *   1. A busy editor defers inactive work, and the gate is consulted (the
 *      counter would stay at zero if the predicate were never reached).
 *   2. The single-frame control is enabled while the comparison lane is
 *      unprepared, and the unprepared state stays observable.
 *   3. Holding compare on an unprepared lane starts the preload rather than
 *      peeking instantly.
 *   4. The peek completes when the explicit preload lands, and releasing the
 *      hold returns to the authored preview.
 *
 * Usage: node tests/performance/phase5-inactive-lane.js --url http://127.0.0.1:8799
 */
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });

    const deferred = await page.evaluate(async () => {
      const before = state.previewScheduler.snapshot().inactiveDeferred;
      let calls = 0;
      await new Promise((resolve) => {
        state.previewScheduler.scheduleInactive("sdr", state.previewGeneration.sdr,
          () => { calls += 1; return false; });
        setTimeout(resolve, 900);
      });
      return { before, after: state.previewScheduler.snapshot().inactiveDeferred, calls };
    });
    assert(deferred.after > deferred.before,
      `A busy editor must defer inactive work: ${JSON.stringify(deferred)}`);
    assert(deferred.calls >= 1, `The idle gate must be consulted: ${JSON.stringify(deferred)}`);
    console.log(`idle gate      deferred ${deferred.after - deferred.before}x, gate consulted ${deferred.calls}x  PASS`);

    const compare = await page.evaluate(async () => {
      switch (state.currentView) {
        case "hdr": state.gpuPreparedLane.sdr = false; state.previewCache.sdr = null; break;
        default: state.gpuPreparedLane.hdr = false; state.previewCache.hdr = null; break;
      }
      renderCompareStatus();
      const buttonState = {
        disabled: els.compareButton.disabled,
        prepared: els.compareButton.dataset.prepared,
      };
      const other = state.currentView === "hdr" ? "sdr" : "hdr";
      // Force the preload to take long enough to observe the pending branch,
      // as a cold lane at source resolution would.
      const originalLoad = state.gpuPreview.loadProxy.bind(state.gpuPreview);
      state.gpuPreview.loadProxy = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return originalLoad(...args);
      };
      beginCompareHold();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const pending = state.comparePendingPeek;
      const peekedEarly = state.comparePeekActive;
      let peekedLate = false;
      for (let attempt = 0; attempt < 40 && !peekedLate; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        peekedLate = state.comparePeekActive;
      }
      state.gpuPreview.loadProxy = originalLoad;
      const preparedAfter = state.gpuPreparedLane[other];
      await endCompareHold();
      for (let attempt = 0; attempt < 40 && state.comparePeekActive; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { buttonState, pending, peekedEarly, peekedLate, preparedAfter,
        peekActiveAfterRelease: state.comparePeekActive };
    });
    assert(compare.buttonState.disabled === false,
      `The compare control must stay usable while the lane is unprepared: ${JSON.stringify(compare)}`);
    assert(compare.buttonState.prepared === "false",
      `The unprepared state must stay observable: ${JSON.stringify(compare)}`);
    assert(compare.pending === true && compare.peekedEarly === false,
      `A held compare on an unprepared lane must start the preload, not peek instantly: ${JSON.stringify(compare)}`);
    assert(compare.preparedAfter === true && compare.peekedLate === true,
      `The peek must complete when the explicit preload lands: ${JSON.stringify(compare)}`);
    assert(compare.peekActiveAfterRelease === false,
      `Releasing the hold must return to the authored preview: ${JSON.stringify(compare)}`);
    console.log("compare intent  control usable, preload deferred, peek completed on landing, released  PASS");

    assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Inactive-lane work waits for true idle, and explicit comparison intent still gets the lane.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
