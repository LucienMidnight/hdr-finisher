/**
 * The scope's peak is the number a delivery decision is made on.
 *
 * Everything else a scope draws is read for shape. The peak is read for a
 * pass/fail against a ceiling -- "is this under 1000 nits" -- so it is the one
 * number that has to be exactly right, and wrong in no direction at all.
 *
 * It used to be a maximum over the preview proxy, and a proxy is a Lanczos
 * downsample: an isolated specular is averaged with its neighbours before the
 * scope ever sees it. That reads *low*, which is the dangerous direction,
 * because it says a delivery is under its ceiling when it is not. On the
 * committed 42 MP frame the three scope profiles under-report the peak by
 * 13.6%, 11.3% and 5.0%.
 *
 * What this asserts:
 *
 *   1. The peak accumulated across tiles equals the peak Direct measures over
 *      the same picture, exactly. A maximum is decomposable, so tiling it
 *      costs nothing -- the answer is exact, not merely closer.
 *   2. It does not depend on the tile size.
 *   3. The measurement pass disturbs nothing: not the canvas the viewer is
 *      looking at, not the scope source, not the tiled diagnostics.
 *   4. With the preference off, the scope says so -- "Peak (preview)" -- rather
 *      than presenting a lower bound as though it were the answer.
 *   5. With `--input`, that the measured peak is genuinely higher than the
 *      proxy's on a real photograph. Without it the built-in pattern is flat
 *      enough in its highlights that downsampling costs nothing, so that one
 *      claim is skipped rather than asserted vacuously.
 *
 * Usage: node tests/scope-exact-peak.js --url http://127.0.0.1:8000
 *        node tests/scope-exact-peak.js --input local-test-media/inputs/<file>.exr
 */
const fs = require("fs");
const path = require("path");
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
  const input = argument("--input", null);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    const target = new URL(url);
    if (input) target.searchParams.set("engineeringFullPreview", "1");
    await page.goto(target.toString(), { waitUntil: "networkidle" });
    if (input) {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) throw new Error(`Input does not exist: ${resolved}`);
      await page.setInputFiles("#file-input", resolved);
    } else {
      await page.getByRole("button", { name: "Load test pattern" }).click();
    }
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    const result = await page.evaluate(async (hasInput) => {
      if (hasInput) applyGpuMemoryBudget(8);
      // A real grade, so the peak is a graded value and not the source's --
      // but a negative exposure, because the built-in pattern is synthetic and
      // a positive one drives it past the rgba16float ceiling, where every
      // measurement would agree at the clamp and prove nothing. Real content
      // is nowhere near it: the 42 MP frame peaks around 17 in these units
      // against a representable 65504.
      state.adjustments.hdr.exposure = hasInput ? 0.5 : -0.5;
      await new Promise((resolve) => setTimeout(resolve, 50));

      const longEdge = previewTargetLongEdge();
      const nativeEdge = previewTargetLongEdge("full");

      // 1 -- Direct's own exhaustive maximum over the displayed tier, as the
      // independent measurement to check the tiled accumulation against.
      await window.HDRFinisherPerformance.renderGpuTier(longEdge);
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      const analysis = await state.gpuPreview.analyzeScope(els.previewCanvas, {
        width: 256, height: 128, tier: "settled",
      });
      let directPeak = 0;
      for (const value of analysis.cellPeaks) if (value > directPeak) directPeak = value;

      // 2 -- the same picture, accumulated across tiles, at two tile sizes.
      const tiled = {};
      for (const tileSize of [256, 512]) {
        const rendered = await window.HDRFinisherPerformance.renderTiledTier(longEdge, { tileSize });
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        tiled[tileSize] = {
          rendered: rendered?.rendered,
          refusals: rendered?.refusals,
          peak: rendered?.metrics?.exactPeak,
          tiles: rendered?.metrics?.tileCount,
        };
      }

      // 3 -- a measurement pass must leave the presented state alone.
      await window.HDRFinisherPerformance.renderGpuTier(longEdge);
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      const before = {
        width: els.previewCanvas.width,
        height: els.previewCanvas.height,
        scopeSource: state.gpuPreview.scopeSources.has(els.previewCanvas),
        metrics: JSON.stringify(state.gpuPreview.tiledExecutionMetrics || null),
      };
      const measured = await window.HDRFinisherPerformance.measureExactPeak({ force: true });
      const after = {
        width: els.previewCanvas.width,
        height: els.previewCanvas.height,
        scopeSource: state.gpuPreview.scopeSources.has(els.previewCanvas),
        metrics: JSON.stringify(state.gpuPreview.tiledExecutionMetrics || null),
      };

      // 4 -- what the scope panel actually says, with the preference both ways.
      const readPanel = async (enabled) => {
        state.scopeExactPeak = enabled;
        if (els.scopeExactPeak) els.scopeExactPeak.checked = enabled;
        const applied = await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const payload = state.lastScope;
        return {
          applied,
          label: payload?.stats?.[0]?.label,
          peakValue: payload?.peak_value,
          exact: payload?.peak_exact,
          measuredLongEdge: payload?.peak_measured_long_edge,
        };
      };
      const panelOn = await readPanel(true);
      const panelOff = await readPanel(false);
      await readPanel(true);

      return {
        longEdge, nativeEdge, directPeak, tiled, measured, before, after, panelOn, panelOff,
        checkboxDefault: document.getElementById("scope-exact-peak")?.defaultChecked,
      };
    }, Boolean(input));

    // The finish texture is rgba16float, so a grade extreme enough to drive the
    // picture past 65504 working units would have every measurement agree at
    // the clamp and prove nothing. Real content is nowhere near it -- that is
    // about 74 million nits -- but a test that silently ran there would be
    // vacuous, so it fails loudly instead.
    assert(result.directPeak < 60000,
      `The grade saturates the half-float finish texture (peak ${result.directPeak}), `
      + "so no measurement below can be distinguished from any other");

    const sizes = Object.keys(result.tiled);
    for (const size of sizes) {
      const entry = result.tiled[size];
      assert(entry.rendered, `Tiled render at tile ${size} refused: ${JSON.stringify(entry.refusals)}`);
      assert(entry.peak === result.directPeak,
        `Tiled peak at tile ${size} (${entry.peak}) is not Direct's exhaustive maximum (${result.directPeak})`);
    }
    console.log(`accumulated peak    Direct ${result.directPeak}  `
      + sizes.map((size) => `tile ${size} ${result.tiled[size].peak} (${result.tiled[size].tiles} tiles)`).join("  ")
      + "  PASS");

    assert(result.before.width === result.after.width && result.before.height === result.after.height,
      `The measurement resized the viewer's canvas: ${JSON.stringify({ before: result.before, after: result.after })}`);
    assert(result.before.scopeSource === result.after.scopeSource,
      "The measurement dropped the scope source the presented generation owns");
    assert(result.before.metrics === result.after.metrics,
      "The measurement overwrote the diagnostics describing the presented generation");
    console.log(`isolation           canvas ${result.after.width}x${result.after.height} unchanged, `
      + `scope source retained, diagnostics untouched  PASS`);

    assert(result.measured?.peak !== null && result.measured?.exact === true,
      `The exact measurement did not complete: ${JSON.stringify(result.measured)}`);
    assert(result.measured.longEdge === result.nativeEdge,
      `The measurement ran at ${result.measured.longEdge}, not native ${result.nativeEdge}`);
    console.log(`native measurement  ${result.measured.longEdge} long edge, ${result.measured.tiles} tiles, `
      + `${Math.round(result.measured.durationMs)} ms  PASS`);

    assert(result.checkboxDefault === true, "The exact-peak preference does not default to on");
    assert(result.panelOn.exact === true && result.panelOn.label === "Peak",
      `The panel did not report an exact peak when enabled: ${JSON.stringify(result.panelOn)}`);
    assert(result.panelOff.exact === false && result.panelOff.label === "Peak (preview)",
      `The panel did not disclose a proxy peak when disabled: ${JSON.stringify(result.panelOff)}`);
    console.log(`panel disclosure    on -> "${result.panelOn.label}" at ${result.panelOn.measuredLongEdge}, `
      + `off -> "${result.panelOff.label}"  PASS`);

    if (input) {
      const gain = result.panelOn.peakValue - result.panelOff.peakValue;
      assert(gain > 0,
        `On a real photograph the exact peak should exceed the proxy's, but it did not: `
        + `${result.panelOn.peakValue} vs ${result.panelOff.peakValue}`);
      console.log(`under-report        proxy ${result.panelOff.peakValue.toFixed(1)} nit vs exact `
        + `${result.panelOn.peakValue.toFixed(1)} nit  ->  the proxy reads `
        + `${(gain / result.panelOn.peakValue * 100).toFixed(2)}% low  PASS`);
    } else {
      console.log("under-report        skipped: the built-in pattern's highlights are flat enough "
        + "that downsampling costs nothing. Re-run with --input for this one.");
    }

    assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join(" | ")}`);
    console.log("The scope's peak is an exact maximum of the finished picture at full resolution.");
  } finally {
    await browser.close();
  }
})();
