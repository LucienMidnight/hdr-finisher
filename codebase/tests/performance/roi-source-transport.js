// Phase 3 work item 2 -- ROI source routing and the warm-Fit transport gate.
//
//   node tests/performance/roi-source-transport.js --url http://127.0.0.1:8799
//
// Two claims are measured against the 4096x2304 fixture and the real app:
//
// 1. A cold magnified ROI pass at native scale fetches only its visible region from
//    the native mip. `tiledExecutionMetrics().sourceRoute` must be "region",
//    the region must be a fraction of the frame, the uploaded texture must be
//    a fraction of the frame's bytes, and the ROI output must still be
//    byte-equal to the whole-frame pass over the visible region.
//
// 2. A warm Fit pass at the display tier uploads only the display mip. The
//    uploaded texture bytes must match the mip, not the native frame, and the
//    backend's persistent source cache must answer the second pass without a
//    cold build or a byte generated.
//
// Raw evidence is written under output/performance/ (gitignored).

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureFitFilteringFixture, WIDTH, HEIGHT } = require("./fit-filtering-fixture.js");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function bytesForFrame(width, height, bytesPerPixel = 8) {
  return width * height * bytesPerPixel;
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const output = argument("--output", path.join("output", "performance", "roi-source-transport.json"));
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const waitReady = () => page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    const fixture = ensureFitFilteringFixture();
    await page.setInputFiles("#file-input", fixture);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForTimeout(500);
    if (await page.locator("#interpretation-gate").isVisible().catch(() => false)) {
      await page.click("#accept-interpretation");
    }
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 300000 });
    await waitReady();
    const sourceSize = await page.evaluate(() => [state.session.source.width, state.session.source.height]);
    assert(sourceSize[0] === WIDTH && sourceSize[1] === HEIGHT,
      `The fixture did not import at its own size: ${JSON.stringify(sourceSize)}`);

    // Native-scale ROI: tier Full, tiled, magnified zoom, refinement mode.
    await page.evaluate(() => {
      // Persist through the real controls: later ROI preference changes must
      // not restore Auto execution or an old processing tier.
      for (const [id, value] of [["settings-execution-override", "tiled"],
        ["settings-preview-resolution", "full"]]) {
        const control = document.getElementById(id);
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await waitReady();
    await page.evaluate(() => setCustomZoom(200));
    await waitReady();
    const roiMode = await page.evaluate(() => window.HDRFinisherPerformance.setRoiPreviewMode("refinement"));
    assert(roiMode === "refinement", `The ROI mode did not enable: ${roiMode}`);
    await page.evaluate(() => window.HDRFinisherPerformance.cancelRoiCatchUp());

    const roi = await page.evaluate(async () => {
      const deadline = performance.now() + 120000;
      while (state.gpuDraftInFlight || state.previewScheduler?.frameInFlight
        || state.scopeRequestInFlight || state.gpuScopeRequestInFlight
        || state.pendingScopeRequest || state.pendingGpuScopeRequest
        || pendingHighlightAnchors.size || exactHighlightAnchorInflight.size) {
        if (performance.now() > deadline) throw new Error("Automatic setup work did not settle");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      state.previewScheduler.cancel();
      window.clearTimeout(state.refreshTimer);
      state.renderCoordinator.cancelCatchUp(state.currentView);
      state.renderCoordinator.cancelPan(state.currentView);
      const renderer = state.gpuPreview;
      const original = renderer.renderTo;
      let coldRoi = false;
      const evicted = [];
      renderer.renderTo = function(...args) {
        const options = args[11];
        if (!coldRoi && args[0] === els.previewCanvas && options?.viewport) {
          coldRoi = true;
          // The reference pass necessarily loaded a whole source. Warm ROI
          // correctly reuses it; evict it here to measure the cold upload claim.
          for (const [key, proxy] of this.proxies) {
            if (!proxy.region && proxy.longEdge === Math.max(state.session.source.width, state.session.source.height)) {
              evicted.push(key);
              this.evictGpuCacheEntry("source-proxy", key);
            }
          }
        }
        return original.apply(this, args);
      };
      try {
        const parity = await window.HDRFinisherPerformance.roiParity({ tolerance: 0 });
        return { parity, coldRoi, evicted,
          metrics: window.HDRFinisherPerformance.tiledExecutionMetrics(),
          transport: renderer.sourceTransportMetrics || null };
      } finally { renderer.renderTo = original; }
    });
    assert(roi.coldRoi && roi.evicted.length > 0,
      `The cold ROI upload setup did not release the whole source: ${JSON.stringify(roi)}`);
    assert(roi.parity?.ok, `The ROI parity run did not complete: ${JSON.stringify(roi.parity)}`);
    assert(roi.parity.comparison?.comparedPixels > 0,
      `The comparison covered no pixels: ${JSON.stringify(roi.parity.comparison)}`);
    assert(roi.parity.comparison?.maxAbsDifference === 0,
      `The ROI output is not byte-equal to the whole-frame output: ${JSON.stringify(roi.parity.comparison)}`);
    assert(roi.metrics?.sourceRoute === "region",
      `The magnified ROI pass did not fetch a region: ${JSON.stringify(roi.metrics)}`);
    const region = roi.metrics.sourceRegion;
    assert(region && region.width * region.height < roi.metrics.outputPixels * 0.5,
      `The ROI region is not a fraction of the frame: ${JSON.stringify(region)}`);
    assert(roi.metrics.sourceTextureBytes < roi.metrics.sourceFrameBytes * 0.5,
      `The ROI pass uploaded too much source: ${JSON.stringify({
        uploaded: roi.metrics.sourceTextureBytes,
        frame: roi.metrics.sourceFrameBytes,
        region: roi.metrics.sourceRegion,
      })}`);
    assert(roi.metrics.sourceFrameBytes === bytesForFrame(WIDTH, HEIGHT),
      `The ROI pass did not process the native frame: ${JSON.stringify(roi.metrics)}`);

    // Warm Fit at the display tier. The first pass may build the mip; the
    // second must be answered from the persistent cache with no cold build and
    // no byte generated, and must upload only the mip.
    const displayTier = await page.evaluate(() => {
      const control = document.getElementById("settings-preview-resolution");
      control.value = "1024";
      control.dispatchEvent(new Event("change", { bubbles: true }));
      setZoomMode("fit");
      return true;
    });
    assert(displayTier === true, "The display tier could not be applied");
    await waitReady();
    const fit = await page.evaluate(async () => {
      const sessionId = state.session.session_id;
      const transportBefore = JSON.stringify(state.gpuPreview.sourceTransportMetrics || null);
      const before = await (await fetch(`/api/session/${sessionId}/diagnostics`)).json();
      const result = await window.HDRFinisherPerformance.renderTiledTier(1024);
      const after = await (await fetch(`/api/session/${sessionId}/diagnostics`)).json();
      return {
        result: result ? { rendered: result.rendered, refusals: result.refusals } : null,
        before,
        after,
        transportBefore,
        transport: state.gpuPreview.sourceTransportMetrics || null,
        metrics: window.HDRFinisherPerformance.tiledExecutionMetrics(),
      };
    });
    assert(fit.result?.rendered === true,
      `The warm Fit tiled pass did not render: ${JSON.stringify(fit)}`);
    assert(["whole-frame", "streamed"].includes(fit.metrics?.sourceRoute),
      `The Fit pass did not use the whole-frame route: ${JSON.stringify(fit.metrics)}`);
    const fitBytes = bytesForFrame(1024, Math.round(HEIGHT * 1024 / WIDTH));
    assert(fit.metrics.sourceTextureBytes === fitBytes,
      `The Fit pass did not use exactly the display mip: ${JSON.stringify({
        uploaded: fit.metrics.sourceTextureBytes, mip: fitBytes, metrics: fit.metrics,
      })}`);
    assert(fit.metrics.sourceTextureBytes < bytesForFrame(WIDTH, HEIGHT) * 0.1,
      `The Fit pass used a native-sized source: ${JSON.stringify(fit.metrics)}`);
    // Warm means the pass either never asked the backend again (the renderer
    // still holds the display mip) or the backend answered the display mip from
    // its persistent cache. What it must not do is read or generate the native
    // frame: no cold build, no generated bytes.
    const frontendCacheHit = fit.transportBefore === JSON.stringify(fit.transport || null);
    const backendServedTheMip = ["whole-frame", "streamed"].includes(fit.transport?.route)
      && fit.transport.width === 1024
      && fit.transport.transferredBytes === fitBytes;
    assert(frontendCacheHit || backendServedTheMip,
      `The warm Fit pass neither reused the held mip nor fetched it: ${JSON.stringify({
        transportBefore: fit.transportBefore, transport: fit.transport,
      })}`);
    const mipBefore = fit.before.render_cache.source_mip;
    const mipAfter = fit.after.render_cache.source_mip;
    assert(mipAfter.cold_builds === mipBefore.cold_builds,
      `The warm Fit pass built a mip: ${JSON.stringify({ before: mipBefore, after: mipAfter })}`);
    assert(mipAfter.bytes_generated === mipBefore.bytes_generated,
      `The warm Fit pass generated mip bytes: ${JSON.stringify({ before: mipBefore, after: mipAfter })}`);
    assert(mipAfter.native_passes >= mipBefore.native_passes,
      `The source cache counters went backwards: ${JSON.stringify({ before: mipBefore, after: mipAfter })}`);

    const summary = {
      url,
      fixture: { path: fixture, width: WIDTH, height: HEIGHT },
      roi: {
        zoomPercent: 200,
        tier: "full",
        coldSourceEvictions: roi.evicted.length,
        visible: roi.parity.visible,
        longEdge: roi.parity.longEdge,
        comparedPixels: roi.parity.comparison.comparedPixels,
        maxAbsDifference: roi.parity.comparison.maxAbsDifference,
        metrics: {
          sourceRoute: roi.metrics.sourceRoute,
          sourceRegion: roi.metrics.sourceRegion,
          sourceTextureBytes: roi.metrics.sourceTextureBytes,
          sourceFrameBytes: roi.metrics.sourceFrameBytes,
          uploadFraction: roi.metrics.sourceTextureBytes / roi.metrics.sourceFrameBytes,
          foregroundTiles: roi.metrics.foregroundTiles,
          retainedFrame: roi.metrics.retainedFrame,
        },
        transport: roi.transport,
      },
      fit: {
        tier: "1024",
        metrics: {
          sourceRoute: fit.metrics.sourceRoute,
          sourceTextureBytes: fit.metrics.sourceTextureBytes,
          sourceFrameBytes: fit.metrics.sourceFrameBytes,
          outputPixels: fit.metrics.outputPixels,
        },
        transport: fit.transport,
        sourceCache: { before: mipBefore, after: mipAfter },
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
