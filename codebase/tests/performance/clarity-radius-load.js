// How much work a Clarity Radius costs the tiled preview.
//
// Renders a 24 MP frame tiled at the Full tier with global Clarity on and
// reports, per radius: the work each generation does relative to the picture
// (processed pixels / output pixels, which is the halo's overdraw), and the
// wall time to a finished frame for an upstream edit (Exposure, which rebuilds
// Clarity's map) and for a Radius tick (which only re-blurs it).
//
//   node tests/run-in-electron.js tests/performance/clarity-radius-load.js

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/clarity-radius-load.json"));
const WIDTH = Number(option("--width", 6000));
const HEIGHT = Number(option("--height", 4000));
const RADII = [0.75, 3.0];
const REPEATS = 4;

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", ensureLargeNoisySource(WIDTH, HEIGHT));
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 900000 });
    await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
    if (args.includes("--denoise")) {
      // Denoise feeds Clarity's map, so an upstream edit reconstructs the map's
      // regions as well as the tiles. Analyse once, at the size tiled renders.
      await page.evaluate(async () => {
        const group = document.querySelector(".denoise-group .group-toggle");
        if (group.getAttribute("aria-expanded") !== "true") group.click();
        if (!state.denoise[state.currentView].enabled) await setDenoiseEnabled(true);
      });
      await page.waitForFunction(
        () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status), null, { timeout: 900000 },
      );
      await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
    }
    await page.evaluate(() => {
      applyExecutionOverride("tiled");
      state.previewScheduler?.cancel();
    });

    const rows = [];
    for (const radius of RADII) {
      const row = await page.evaluate(async ({ radius, repeats }) => {
        const frame = state.session.source;
        // Denoise's evidence belongs to the frame it analysed; a tiled render
        // at another size renders undenoised, so measure at that size.
        const analysed = state.gpuPreview.denoiseSourceSelector?.original;
        const longEdge = analysed && state.denoise[state.currentView].enabled
          ? Math.max(analysed.width, analysed.height)
          : Math.max(frame.width, frame.height);
        state.adjustments.hdr.detail_section_enabled = true;
        Object.assign(state.adjustments.hdr.detail, {
          texture_amount: 0, clarity_amount: 60, clarity_radius_percent: radius, sharpen_amount: 0,
        });
        const timed = async () => {
          const started = performance.now();
          const result = await window.HDRFinisherPerformance.renderTiledTier(longEdge, {});
          await state.gpuPreview.device.queue.onSubmittedWorkDone();
          return { ms: performance.now() - started, metrics: result?.metrics || {} };
        };
        await timed();
        const upstream = [];
        const radiusTicks = [];
        for (let index = 0; index < repeats; index += 1) {
          state.adjustments.hdr.exposure = 0.1 * (index + 1);
          upstream.push(await timed());
          state.adjustments.hdr.detail.clarity_radius_percent = radius - 0.05 * ((index % 2) + 1);
          radiusTicks.push(await timed());
        }
        state.adjustments.hdr.exposure = 0;
        const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const last = upstream.at(-1).metrics;
        return {
          radius,
          size: `${last.width}x${last.height}`,
          halo: last.halo,
          overdraw: last.processedPixels / last.outputPixels,
          upstreamMs: median(upstream.map((entry) => entry.ms)),
          radiusTickMs: median(radiusTicks.map((entry) => entry.ms)),
          upstreamMapRegions: last.clarityMapChunks ?? null,
          radiusTickMapRegions: radiusTicks.at(-1).metrics.clarityMapChunks ?? null,
          upstreamDenoiseResolves: last.denoiseTileResolves ?? null,
          radiusTickDenoiseResolves: radiusTicks.at(-1).metrics.denoiseTileResolves ?? null,
          tiles: last.tileCount,
        };
      }, { radius, repeats: REPEATS });
      rows.push(row);
      console.log(
        `radius ${String(row.radius).padEnd(4)}%  ${row.size}  halo ${String(row.halo).padStart(4)}  `
        + `work ${row.overdraw.toFixed(2)}x picture  exposure edit ${row.upstreamMs.toFixed(0)} ms  `
        + `radius tick ${row.radiusTickMs.toFixed(0)} ms`
        + (row.upstreamMapRegions === null ? "" : `  map regions filled: edit ${row.upstreamMapRegions}, tick ${row.radiusTickMapRegions}`)
        + (row.upstreamDenoiseResolves ? `  denoise passes (${row.tiles} tiles): edit ${row.upstreamDenoiseResolves}, tick ${row.radiusTickDenoiseResolves}` : ""),
      );
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ recordedAt: new Date().toISOString(), rows }, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
