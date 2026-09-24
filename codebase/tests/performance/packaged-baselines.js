// Phase 0 packaged baselines -- the 42.4 MP fixture at Fit, 100%, 200%, and a
// representative pan.
//
//   node tests/performance/packaged-baselines.js --url http://127.0.0.1:8765
//   node tests/run-in-electron.js tests/performance/packaged-baselines.js
//
// For each view state this records, after a real exposure change: the frame
// that follows the input, the first presentation at the edit's generation, the
// stable presentation (tier, processed edge, processed pixels), the
// coordinator's queue and dispatch latency, the planned peak GPU bytes, long
// tasks, JS heap, and the source bytes the render pulled. At 200% it also pans
// and samples the retained frame to prove the pan left a painted frame.
//
// This is a baseline, not a budget: nothing here fails on a threshold. The
// numbers are what the Phase 0 tolerance and Fit-filtering decisions read.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const WIDTH = 7968;
const HEIGHT = 5320;
const ZOOM_STATES = [
  { id: "fit", apply: () => setZoomMode("fit") },
  { id: "100", apply: () => setCustomZoom(100) },
  { id: "200", apply: () => setCustomZoom(200) },
  // §8.4 requires 400% as well as 200%; the packaged surface is the reference
  // setup, so the extreme zoom is recorded here rather than in a note.
  { id: "400", apply: () => setCustomZoom(400) },
];

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

// Stage logging for a driver whose waits are long enough that a stall is
// otherwise invisible; enabled with HDR_FINISHER_DRIVER_DEBUG=1.
function debug(...parts) {
  if (process.env.HDR_FINISHER_DRIVER_DEBUG === "1") {
    console.error(`[packaged-baselines] ${parts.join(" ")}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForReady(page, timeout = 300000) {
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout });
}

async function measureEdit(page) {
  return page.evaluate(async () => {
    const control = document.querySelector('[data-path="hdr.exposure"]');
    const next = Number(control.value) >= 0 ? -0.3 : 0.3;
    const generation = state.previewGeneration[state.currentView];
    const started = performance.now();
    let frameMs = null;
    let currentMs = null;
    let stableMs = null;
    let stableKey = null;
    let lastKey = null;
    let lastKeyAt = null;
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now() - started;
        if (frameMs === null) frameMs = now;
        const accepted = state.acceptedPresentation;
        const current = accepted && accepted.lane === state.currentView
          && accepted.generation === state.previewGeneration[state.currentView];
        if (current && currentMs === null) currentMs = now;
        if (current) {
          const key = `${accepted.processedLongEdge}:${accepted.execution}`;
          if (key !== lastKey) {
            lastKey = key;
            lastKeyAt = now;
          } else if (stableMs === null && now - lastKeyAt >= 250) {
            stableMs = lastKeyAt;
            stableKey = key;
          }
        }
        if ((stableMs !== null && now - started > 1500) || now > 60000) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const accepted = state.acceptedPresentation;
    const metrics = window.HDRFinisherPerformance.tiledExecutionMetrics();
    const coordinator = window.HDRFinisherPerformance.renderCoordinator();
    const plan = state.gpuPreview?.lastRenderPlan || null;
    return {
      generation,
      sliderToFrameMs: frameMs,
      timeToCurrentMs: currentMs,
      timeToStableMs: stableMs,
      stableKey,
      tier: accepted?.tier ?? null,
      requestedTier: accepted?.requestedTier ?? null,
      execution: accepted?.execution ?? null,
      processedLongEdge: accepted?.processedLongEdge ?? null,
      processedPixels: metrics?.processedPixels ?? null,
      submissions: metrics?.submissions ?? null,
      coordinatorMetrics: coordinator?.metrics ?? null,
      peakLogicalBytes: plan?.totals?.peakLogicalBytes ?? null,
      residentBytes: plan?.totals?.residentBytes ?? null,
      heapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      longTasks: window.__hdrLongTasks || [],
    };
  });
}

async function measurePan(page) {
  return page.evaluate(async () => {
    const before = els.dropzone.scrollTop;
    const accepted = state.acceptedPresentation;
    els.dropzone.scrollTop = before + 400;
    const scrolledAt = performance.now();
    // The pan is compositor-only. Give the app a beat, then sample the
    // retained frame to prove the pan left a painted frame, not a blank one.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const region = await state.gpuPreview?.readPresentationRegion?.(8, 8, 4, 4);
    const values = region?.values || [];
    let luma = 0;
    for (let index = 0; index + 3 < values.length; index += 4) {
      luma += (values[index] + values[index + 1] + values[index + 2]) / 3;
    }
    const samples = Math.max(1, Math.floor(values.length / 4));
    return {
      scrollTopBefore: before,
      scrollTopAfter: els.dropzone.scrollTop,
      panSettleMs: performance.now() - scrolledAt,
      centerLuma: luma / samples,
      acceptedGeneration: accepted?.generation ?? null,
      currentGeneration: state.previewGeneration[state.currentView],
      viewer: viewerState().status,
    };
  });
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "packaged-baselines.json"));
  const input = ensureLargeNoisySource(WIDTH, HEIGHT);
  // The §8 reference viewport is 2560x1440; it is requested here so the page
  // (or the Electron runner's real window) is sized to it before any state is
  // measured, and the size that actually measured is reported below.
  const viewportArgument = argument("--viewport", "1280x900").split("x").map(Number);
  const viewport = Number.isFinite(viewportArgument[0]) && Number.isFinite(viewportArgument[1])
    ? { width: viewportArgument[0], height: viewportArgument[1] }
    : { width: 1280, height: 900 };
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  const sourceResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", async (response) => {
    if (!/\/(proxy|preview|preview-raw|scopes)\//.test(response.url())) return;
    try {
      const headers = await response.allHeaders();
      sourceResponses.push({
        url: new URL(response.url()).pathname,
        status: response.status(),
        bytes: Number(headers["content-length"] || 0),
      });
    } catch { /* the response may be gone */ }
  });

  try {
    await page.addInitScript(() => {
      window.__hdrLongTasks = [];
      new PerformanceObserver((list) => {
        window.__hdrLongTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    debug("page loaded", url);
    await page.locator("#file-input").setInputFiles(input);
    debug("fixture attached", input);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 180000 });
    debug("session", await page.evaluate(() => state.session.session_id));
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 180000 });
    debug("webgpu available");
    await waitForReady(page);
    debug("ready");
    await page.evaluate(() => applyExecutionOverride("tiled"));
    await waitForReady(page);
    debug("tiled override ready");

    const states = [];
    for (const state of ZOOM_STATES) {
      const sourceStart = sourceResponses.length;
      debug("state", state.id, "start");
      await page.evaluate(state.apply);
      await waitForReady(page);
      const measured = await measureEdit(page);
      debug("state", state.id, "measured", JSON.stringify({
        currentMs: measured.timeToCurrentMs, stableMs: measured.timeToStableMs,
        edge: measured.processedLongEdge,
      }));
      states.push({
        zoom: state.id,
        ...measured,
        longTaskTotalMs: measured.longTasks.reduce((sum, value) => sum + value, 0),
        longTaskMaxMs: measured.longTasks.length ? Math.max(...measured.longTasks) : null,
        longTaskCount: measured.longTasks.length,
        sourceBytes: sourceResponses.slice(sourceStart).reduce((sum, entry) => sum + entry.bytes, 0),
        sourceRequests: sourceResponses.length - sourceStart,
        pan: state.id === "200" ? await measurePan(page) : null,
      });
      await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());
    }

    const summary = {
      url,
      // The §8 reference setup names a 2560x1440 viewport; the Electron window
      // is sized by the runner, so the viewport that actually measured is
      // recorded here rather than assumed from the requested size.
      environment: await page.evaluate(() => ({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
      })),
      powerMode: process.env.HDR_FINISHER_POWER_MODE || "unknown",
      requestedWindowSize: process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE || null,
      source: { width: WIDTH, height: HEIGHT, path: input },
      states,
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
