// The Highlight compression output ceiling holds whatever the shoulder anchor.
//
//   node tests/run-in-electron.js tests/performance/highlight-ceiling.js
//
// Owner requirement (2026-09-25): with Highlight compression set to a 1000 nit
// maximum, no output may pass 1000 nits, no matter what. The Peak fit shoulder
// is shaped around a measured highlight anchor; the ceiling is a separate
// per-channel clip in the BT.2020 delivery signal after it. This proves the
// ceiling does not depend on the anchor by forcing the anchor 10,000x too high,
// correct, and 1,000x too low, and reading every presented pixel back.
//
// The fixture is exposed +2.5 EV so most highlights sit well above 1000 nits.
// Each case renders through the Tiled route (whose retained presentation
// target can be read back exactly), decodes the display encoding to the
// BT.2020 delivery signal, and compares every channel of every pixel with the
// target. Direct uses the same fragment function (applyOutputHighlights) and
// so the same clip; it cannot be read back here and is not claimed separately.
// The display transform's own headroom clamp is lifted for the readback so it
// cannot hide a breach. A Highlight-compression-off control must exceed the
// target, proving the check can see one.

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
const outputPath = path.resolve(option("--output", "output/performance/highlight-ceiling.json"));
const TARGET_NITS = 1000;
// Half-float storage of the presented value: 11 significant bits.
const TOLERANCE = 1 / 1024;

async function idle(page) {
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const failures = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", option("--input", "") ? path.resolve(option("--input", "")) : ensureLargeNoisySource(1600, 1068));
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 900000 });
    await idle(page);
    await page.evaluate(() => {
      applyExecutionOverride("tiled");
      const preview = state.gpuPreview;
      const inner = preview.uploadParamsAndCurves.bind(preview);
      preview.uploadParamsAndCurves = (lane, adjustments, curveSampler, params) => {
        if (window.__ceilingCase) {
          // Lift the display headroom clamp so it cannot hide a breach, and
          // force the shoulder anchor this case asks for.
          params[17] = 1e6;
          if (params[74] === 1) params[75] *= window.__ceilingCase.anchorFactor;
          window.__ceilingParams = { p73: params[73], p74: params[74], p75: params[75], p110: params[110], p16: params[16], p138: params[138], p139: params[139] };
        }
        return inner(lane, adjustments, curveSampler, params);
      };
    });
    await idle(page);

    const cases = [];
    for (const handling of ["smooth_rolloff", "path_to_white", "luminance"]) {
      for (const anchorFactor of [1e4, 1, 1e-3]) cases.push({ handling, anchorFactor, compression: true });
    }
    // Clarity at its strongest runs before the shoulder and moves bright edges
    // up; the ceiling still has to hold over its whole-frame map in tiles.
    for (const anchorFactor of [1, 1e-3]) cases.push({ handling: "smooth_rolloff", anchorFactor, compression: true, clarity: true });
    cases.push({ handling: "smooth_rolloff", anchorFactor: 1, compression: false });

    const rows = [];
    for (const entry of cases) {
      const row = await page.evaluate(async ({ handling, anchorFactor, compression, clarity = false, targetNits }) => {
        window.__ceilingCase = { anchorFactor };
        state.adjustments.hdr.detail_section_enabled = true;
        Object.assign(state.adjustments.hdr.detail, { clarity_amount: clarity ? 100 : 0, clarity_radius_percent: 3 });
        Object.assign(state.adjustments.hdr, {
          exposure: 2.5,
          highlight_section_enabled: compression,
          highlight_compression_mode: "peak_fit",
          highlight_compression_peak_measurement: "maximum",
          highlight_compression_target_nits: targetNits,
          highlight_compression_color_handling: handling,
        });
        const frame = state.session.source;
        const longEdge = Math.max(frame.width, frame.height);
        const rendered = await renderGpuDraft(state.currentView, { tier: "settled", longEdge });
        const used = window.__ceilingParams;
        const region = await state.gpuPreview.readPresentationRegion(frame.width, frame.height, 0, 0);
        window.__ceilingCase = null;
        if (!rendered || !region) return { error: `rendered=${Boolean(rendered)} region=${Boolean(region)}` };
        const decode = (value) => {
          const magnitude = Math.abs(value);
          const linear = magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4;
          return Math.sign(value) * linear;
        };
        // Linear Display P3 (D65) to linear BT.2020.
        const m = [
          [0.753833, 0.198597, 0.047570],
          [0.045744, 0.941777, 0.012479],
          [-0.001210, 0.017602, 0.983609],
        ];
        const toScene = 0.18 * used.p139 / used.p138;
        let maxChannel = 0;
        let over = 0;
        const values = region.values;
        for (let index = 0; index < values.length; index += 4) {
          const r = decode(values[index]) * toScene;
          const g = decode(values[index + 1]) * toScene;
          const b = decode(values[index + 2]) * toScene;
          for (const row of m) {
            const channel = row[0] * r + row[1] * g + row[2] * b;
            if (channel > maxChannel) maxChannel = channel;
            if (channel > used.p73 * (1 + 1 / 1024)) over += 1;
          }
        }
        return {
          handling, anchorFactor, compression, clarity,
          hdrSurface: used.p16 > 0.5,
          anchor: used.p75,
          targetScene: used.p73,
          maxNits: maxChannel * used.p138 / 0.18,
          overChannels: over,
          pixels: values.length / 4,
        };
      }, { ...entry, targetNits: TARGET_NITS });
      rows.push(row);
      await idle(page);
    }

    for (const row of rows) {
      if (row.error) { failures.push(`${JSON.stringify(row)}`); continue; }
      if (!row.hdrSurface) { failures.push("the canvas is not an HDR surface; the ceiling cannot be read back"); continue; }
      const breached = row.maxNits > TARGET_NITS * (1 + TOLERANCE);
      if (row.compression && breached) failures.push(`${row.handling} anchor x${row.anchorFactor}${row.clarity ? " with clarity" : ""}: ${row.maxNits.toFixed(2)} nits > ${TARGET_NITS} (${row.overChannels} channels over)`);
      if (!row.compression && !breached) failures.push(`control: compression off never exceeded ${TARGET_NITS} nits (max ${row.maxNits.toFixed(1)}); the check cannot see a breach`);
    }
    const report = { recordedAt: new Date().toISOString(), targetNits: TARGET_NITS, tolerance: TOLERANCE, rows, failures, pageErrors };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    for (const row of rows) {
      if (row.error) { console.log(row.error); continue; }
      console.log(`${row.compression ? "compression on " : "compression OFF"} ${row.handling.padEnd(15)} anchor x${String(row.anchorFactor).padEnd(6)} (${row.anchor.toExponential(2)})${row.clarity ? "  clarity +100 at 3%" : ""}  max ${row.maxNits.toFixed(2)} nits  channels over ${row.overChannels} of ${row.pixels * 3}`);
    }
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join("; ")}`);
    if (failures.length) throw new Error(`Highlight ceiling test failed:\n  ${failures.join("\n  ")}`);
    console.log("Highlight ceiling test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
