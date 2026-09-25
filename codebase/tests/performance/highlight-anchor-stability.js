// Highlight-compression shoulder stability while dragging (owner report
// 2026-09-25: the zoomed preview flipped between an HDR and an SDR-looking
// picture).
//
//   node tests/run-in-electron.js tests/performance/highlight-anchor-stability.js
//
// On the 42.4 MP fixture with Highlight compression in Peak fit (maximum
// measurement), at 200% zoom, with Denoise off and then on, drags Exposure
// with real pointer strokes and records the shoulder anchor (params[75]) of
// every render the app uploads. The anchor legitimately scales with exposure
// (x 2^EV), so each frame's anchor is normalised by 2^exposure; a jump in the
// normalised anchor between consecutive frames is the shoulder changing shape
// under the user, which is what reads as flashing.
//
// Pass:
//   - no consecutive frames differ by more than MAX_STEP_STOPS in the
//     normalised anchor, and
//   - the resting frame after each stroke uses a real measurement of its own
//     source and grade (within 1%), not an estimate.
//
// The ceiling is not tested here; highlight-ceiling.js does that.

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
const outputPath = path.resolve(option("--output", "output/performance/highlight-anchor-stability.json"));
const MAX_STEP_STOPS = 0.1;

async function idle(page) {
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
  await page.waitForTimeout(900);
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
}

async function stroke(page, deltaX) {
  const control = page.locator('[data-path="hdr.exposure"]').first();
  const box = await control.boundingBox();
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    await page.mouse.move(x + (deltaX * step) / 14, y);
    await page.waitForTimeout(18);
  }
  await page.mouse.up();
}

async function runCase(page, label) {
  const rows = [];
  for (const deltaX of [60, -90, 40, -30]) {
    await page.evaluate(() => { window.__anchorLog = []; });
    await stroke(page, deltaX);
    await idle(page);
    const result = await page.evaluate(async () => {
      const log = window.__anchorLog.slice();
      const last = log.at(-1);
      // The truth for the resting frame: measure its own source and grade.
      let truth = null;
      if (last?.params) {
        const preview = state.gpuPreview;
        const proxy = [...preview.proxies.values()].find((entry) => entry.identity === last.identity) || null;
        const selector = preview.denoiseSourceSelector;
        const source = selector?.identity === last.identity && selector.selected === "resolved" && selector.resolved
          ? selector.resolved : proxy;
        if (source) {
          truth = await preview.measureToneAdjustedPeak(source, new Float32Array(last.params), "maximum", `stability-truth:${Math.random()}`);
          for (const key of [...preview.peakReductionCache.keys()]) if (String(key).startsWith("stability-truth:")) preview.peakReductionCache.delete(key);
        }
      }
      const cache = [...state.gpuPreview.peakReductionCache.entries()].map(([key, value]) => {
        const parts = JSON.parse(key);
        return `${String(parts[0]).split(":")[2]}/${parts[1]}/exp=${Number(parts[6]).toFixed(2)}=${value.toFixed(4)}`;
      });
      const recheck = (state.gpuPreview.performanceMetrics?.stages || []).filter((stage) => stage.stage === "highlight-anchor-recheck");
      return { log: log.map(({ params, ...entry }) => entry), truth, cache, recheck, last: state.gpuPreview.lastHighlightMeasurement?.hdr || null };
    });
    const normalised = result.log.map((entry) => Math.log2(entry.anchor / 2 ** entry.exposure));
    let worstStep = 0;
    for (let index = 1; index < normalised.length; index += 1) {
      worstStep = Math.max(worstStep, Math.abs(normalised[index] - normalised[index - 1]));
    }
    const resting = result.log.at(-1) || null;
    const restingError = resting && result.truth ? Math.abs(resting.anchor / result.truth - 1) : null;
    rows.push({
      label, deltaX, frames: result.log.length,
      worstStepStops: Number(worstStep.toFixed(4)),
      restingAnchor: resting?.anchor ?? null,
      restingTier: resting?.tier ?? null,
      truth: result.truth,
      restingError: restingError === null ? null : Number(restingError.toFixed(4)),
      anchors: result.log.map((entry) => Number(entry.anchor.toFixed(4))),
      cache: result.cache, recheck: result.recheck, last: result.last,
      exposures: result.log.map((entry) => Number(entry.exposure.toFixed(3))),
      shaderExposures: result.log.map((entry) => Number(entry.shaderExposure.toFixed(3))),
      contrast: [...new Set(result.log.map((entry) => entry.contrast))],
      lift: [...new Set(result.log.map((entry) => entry.lift))],
    });
  }
  return rows;
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const failures = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", option("--input", "") ? path.resolve(option("--input", "")) : ensureLargeNoisySource(7968, 5320));
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 900000 });
    await idle(page);
    await page.evaluate(() => {
      const select = document.getElementById("preview-latency");
      select.value = "precise";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      activateWorkflowTab("grade");
      const toggle = document.querySelector('section[data-group="hdr-tone"] .group-toggle');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      // Record the shoulder anchor of every render the app uploads.
      const preview = state.gpuPreview;
      const inner = preview.uploadParamsAndCurves.bind(preview);
      window.__anchorLog = [];
      preview.uploadParamsAndCurves = (lane, adjustments, curveSampler, params) => {
        if (lane === "hdr" && params[74] === 1) {
          window.__anchorLog.push({
            anchor: params[75],
            exposure: Number(adjustments.hdr.exposure) || 0,
            shaderExposure: params[2],
            contrast: params[8],
            lift: params[4],
            tier: state.gpuDraftInFlightTier,
            identity: preview.lastRenderIdentity || null,
            params: Array.from(params),
          });
        }
        return inner(lane, adjustments, curveSampler, params);
      };
      // The identity of the source each render uses, for the truth measurement.
      const innerAnchor = preview.highlightAnchorRequest.bind(preview);
      preview.highlightAnchorRequest = (lane, adjustments, proxy, params) => {
        preview.lastRenderIdentity = proxy.identity;
        return innerAnchor(lane, adjustments, proxy, params);
      };
    });
    await page.evaluate(() => setCustomZoom(200));
    await idle(page);

    // Denoise first (it persists settings), then the Peak fit shoulder.
    const enableShoulder = () => page.evaluate(() => {
      Object.assign(state.adjustments.hdr, {
        highlight_section_enabled: true,
        highlight_compression_mode: "peak_fit",
        highlight_compression_peak_measurement: "maximum",
        highlight_compression_target_nits: 1000,
      });
      // The rough estimate comes from the authored source peak. On a camera
      // RAW it can sit well below what the developed image measures (the
      // owner's file: estimate 3.79 against 4.5 measured), so the fixture's
      // exact figure is lowered 20% to exercise that gap.
      if (!window.__sourcePeakLowered) {
        state.adjustments.hdr.highlight_compression_source_peak_nits *= 0.8;
        window.__sourcePeakLowered = true;
      }
      invalidatePreview("hdr", { markDirty: false });
      debouncePreview("hdr");
    });
    await enableShoulder();
    await idle(page);
    const rows = [...await runCase(page, "denoise-off")];
    await page.evaluate(() => setDenoiseEnabled(true));
    await idle(page);
    await enableShoulder();
    await idle(page);
    const denoiseState = await page.evaluate(() => state.denoiseRuntime.hdr.status);
    rows.push(...await runCase(page, `denoise-${denoiseState}`));

    for (const row of rows) {
      if (row.worstStepStops > MAX_STEP_STOPS) failures.push(`${row.label} stroke ${row.deltaX}: shoulder jumped ${row.worstStepStops} stops between frames`);
      if (row.restingError === null || row.restingError > 0.01) failures.push(`${row.label} stroke ${row.deltaX}: resting anchor ${row.restingAnchor} vs measured ${row.truth}`);
    }
    const report = { recordedAt: new Date().toISOString(), maxStepStops: MAX_STEP_STOPS, rows, failures, pageErrors };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    for (const row of rows) {
      console.log(`${row.label.padEnd(14)} stroke ${String(row.deltaX).padStart(4)}  frames ${String(row.frames).padStart(3)}  worst step ${row.worstStepStops} stops  resting ${row.restingAnchor?.toFixed?.(3)} (${row.restingTier}) vs measured ${row.truth?.toFixed?.(3)}  err ${row.restingError}`);
    }
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join("; ")}`);
    if (failures.length) throw new Error(`Highlight anchor stability failed:\n  ${failures.join("\n  ")}`);
    console.log("Highlight anchor stability test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
