// Regression driver for the abandoned-stream connection-pool exhaustion.
//
//   node tests/transport-pool-exhaustion.js --url http://127.0.0.1:8799
//   node tests/run-in-electron.js tests/transport-pool-exhaustion.js --packaged
//
// Between roughly 40% and 100% zoom a whole-frame proxy response is served by
// the streaming route. Superseding one of those loads used to leave its reader
// pending: the stream was never cancelled, its HTTP/1.1 connection stayed open,
// and six of them exhausted the browser's per-origin pool. After that every
// request -- including the next edit command -- queued with no error, so the
// preview stopped and the sliders did nothing while the CPU stayed idle. The
// owner hit this by zooming in and out a few times.
//
// The driver reproduces the burst, then requires two things: a cheap request
// from the page must still answer promptly, and the viewer must converge to the
// exact frame for the final zoom. Both fail on a build that abandons streams.

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
const outputPath = path.resolve(option("--output", "output/performance/transport-pool-exhaustion.json"));
const zoomChanges = Math.max(6, Number(option("--zooms", "12")));

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    await page.evaluate(() => setCustomZoom(60));
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    // The burst: each zoom supersedes the streaming proxy load of the previous
    // one while it is still arriving.
    const zooms = [];
    for (let index = 0; index < zoomChanges; index += 1) {
      const percent = 45 + ((index * 7) % 40);
      zooms.push(percent);
      await page.evaluate((value) => setCustomZoom(value), percent);
      await page.waitForTimeout(220);
    }

    // The pool probe: a cheap request on the same origin. With abandoned
    // streams holding every connection this never answers.
    const probe = await page.evaluate(async () => {
      const started = performance.now();
      const sessionId = state.session?.session_id;
      const outcome = await Promise.race([
        fetch(`/api/session/${sessionId}`).then((response) => ({ settled: true, status: response.status })),
        new Promise((resolve) => setTimeout(() => resolve({ settled: false }), 5000)),
      ]);
      return { ...outcome, elapsedMs: Math.round(performance.now() - started) };
    });
    assert(probe.settled,
      `A cheap request never answered after ${zoomChanges} superseded zooms (${probe.elapsedMs} ms): the connection pool is exhausted.`);

    const started = Date.now();
    let observed = null;
    while (Date.now() - started < 90000) {
      await page.waitForTimeout(500);
      observed = await page.evaluate(() => {
        const viewer = viewerState();
        return {
          status: viewer.status,
          detail: viewer.detail ?? null,
          exact: state.acceptedPresentation?.exact === true,
          processedLongEdge: state.acceptedPresentation?.processedLongEdge ?? null,
          requiredEdge: requiredProcessingLongEdge(),
          zoom: state.zoomPercent,
        };
      });
      if (observed.status === "ready" && observed.exact
        && observed.processedLongEdge === observed.requiredEdge) break;
    }
    assert(observed && observed.status === "ready" && observed.exact
      && observed.processedLongEdge === observed.requiredEdge,
    `The viewer never converged after the zoom burst: ${JSON.stringify(observed)}`);
    assert(pageErrors.length === 0, `Page errors occurred: ${pageErrors.join(" | ")}`);

    const report = {
      recordedAt: new Date().toISOString(),
      zoomChanges,
      zooms,
      poolProbe: probe,
      convergedMs: Date.now() - started,
      finalState: observed,
      pageErrors,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
