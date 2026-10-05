/**
 * Editing Peak is a bounded estimate. CPU export and full-size Proof remain
 * the exact delivery references; this driver does not certify delivery.
 *
 * Preserve exhaustive Direct/tile parity as an independent arithmetic guard,
 * then check the editing estimate's native patch budget and truthful labels.
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
 *   4. Automatic bounded measurement says "Peak (estimate)"; a refusal says
 *      "Peak (preview)". Neither is presented as an exact delivery answer.
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

      const longEdge = requiredProcessingLongEdge();
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
      // Observe the actual renderer result, including its conservative pixel
      // bound. Return the original promise unchanged and restore the method.
      const renderer = state.gpuPreview;
      const originalMeasure = renderer.measureEditingPeak;
      const measurements = [];
      renderer.measureEditingPeak = function (...args) {
        const pending = originalMeasure.apply(this, args);
        pending.then((value) => measurements.push(value?.metrics || null), () => {});
        return pending;
      };
      let measured;
      try {
        measured = await window.HDRFinisherPerformance.measureExactPeak({ force: true });
      } finally {
        renderer.measureEditingPeak = originalMeasure;
      }
      const after = {
        width: els.previewCanvas.width,
        height: els.previewCanvas.height,
        scopeSource: state.gpuPreview.scopeSources.has(els.previewCanvas),
        metrics: JSON.stringify(state.gpuPreview.tiledExecutionMetrics || null),
      };

      // 4 -- automatic estimate disclosure, including the legacy flag and a
      // reachable refusal. The old preference no longer controls GPU estimation.
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
      // Make the bounded analysis refuse, as it can for an over-budget graph.
      // Keep a positive fallback-label guard rather than assuming the legacy
      // flag disables an automatically measured GPU scope.
      exactScopePeakCache.clear();
      renderer.measureEditingPeak = async () => ({
        rendered: false, refusals: ["test: bounded measurement unavailable"],
      });
      let panelRefused;
      try {
        panelRefused = await readPanel(false);
      } finally {
        renderer.measureEditingPeak = originalMeasure;
        exactScopePeakCache.clear();
      }

      return {
        longEdge, nativeEdge, directPeak, tiled, measured, measurements, before, after, panelOn, panelOff, panelRefused,
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

    assert(Number.isFinite(result.measured?.peak) && result.measured?.exact === false
      && result.measured?.bounded === true,
      `The bounded estimate did not complete truthfully: ${JSON.stringify(result.measured)}`);
    assert(result.measurements.length === 1 && result.measurements[0]?.bounded === true
      && result.measurements[0].processedBound > 0
      && result.measurements[0].processedBound <= 4194304,
      `Editing Peak did not exercise the unchanged patch budget: ${JSON.stringify(result.measurements)}`);
    assert(result.measured.longEdge === result.nativeEdge,
      `The measurement ran at ${result.measured.longEdge}, not native ${result.nativeEdge}`);
    console.log(`bounded measurement ${result.measured.longEdge} native long edge, ${result.measured.tiles} patches, `
      + `${result.measurements[0].processedBound}/4194304 pixels, `
      + `${Math.round(result.measured.durationMs)} ms  PASS`);

    assert(result.checkboxDefault === false, "The exact-peak preference must default to off during authoring");
    assert(result.panelOn.applied && result.panelOn.exact === false && result.panelOn.label === "Peak (estimate)"
      && result.panelOn.measuredLongEdge === result.nativeEdge,
      `The panel did not disclose its native-patch estimate: ${JSON.stringify(result.panelOn)}`);
    assert(result.panelOff.applied && result.panelOff.exact === false && result.panelOff.label === "Peak (estimate)",
      `Automatic estimation changed with the legacy flag: ${JSON.stringify(result.panelOff)}`);
    assert(result.panelRefused.applied && result.panelRefused.exact === false
      && result.panelRefused.label === "Peak (preview)",
      `The panel did not disclose the refused measurement fallback: ${JSON.stringify(result.panelRefused)}`);
    console.log(`panel disclosure    on -> "${result.panelOn.label}" at ${result.panelOn.measuredLongEdge}, `
      + `legacy off -> "${result.panelOff.label}", refused -> "${result.panelRefused.label}"  PASS`);

    if (input) {
      const gain = result.panelOn.peakValue - result.panelRefused.peakValue;
      assert(gain > 0,
        `On this real photograph the native-patch estimate should exceed the proxy's, but it did not: `
        + `${result.panelOn.peakValue} vs ${result.panelRefused.peakValue}`);
      console.log(`under-report        proxy ${result.panelRefused.peakValue.toFixed(1)} nit vs estimate `
        + `${result.panelOn.peakValue.toFixed(1)} nit  ->  the proxy reads `
        + `${(gain / result.panelOn.peakValue * 100).toFixed(2)}% low  PASS`);
    } else {
      console.log("under-report        skipped: the built-in pattern's highlights are flat enough "
        + "that downsampling costs nothing. Re-run with --input for this one.");
    }

    assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Direct/tile exhaustive maxima agree; editing Peak stays bounded and labelled as an estimate.");
  } finally {
    await browser.close();
  }
})();
