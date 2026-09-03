const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available);

    const result = await page.evaluate(async () => {
      const renderer = state.gpuPreview;
      const device = renderer.device;
      const texture = device.createTexture({
        size: { width: 3, height: 1 },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const source = new Float32Array([
        10, 0.1, 0.1, 1,
        0.1, 10, 0.1, 1,
        0.1, 0.1, 10, 1,
      ]);
      device.queue.writeTexture({ texture }, source, { bytesPerRow: 3 * 16 }, { width: 3, height: 1 });
      const params = new Float32Array(160);
      params[2] = 0.7;
      params[8] = 0.5;
      params[9] = 0.1845;
      params[110] = 1;
      const measured = await renderer.measureToneAdjustedPeak(
        { texture, width: 3, height: 1 },
        params,
        "maximum",
        `saturated-test-${performance.now()}`,
      );
      const luma = ([r, g, b]) => 0.2722287 * r + 0.6740818 * g + 0.0536895 * b;
      const toneRgb = (pixel) => {
        let rgb = pixel.map((value) => value * 2 ** params[2]);
        const y = Math.max(luma(rgb), 0);
        const stops = Math.log2(Math.max(y, 1e-8) / params[9]);
        const target = params[9] * 2 ** Math.max(-32, Math.min(32, stops * 2 ** params[8]));
        rgb = rgb.map((value) => value * target / y);
        return rgb;
      };
      const tone = (pixel) => Math.max(...toneRgb(pixel));
      const expected = Math.max(tone([10, 0.1, 0.1]), tone([0.1, 10, 0.1]), tone([0.1, 0.1, 10]));
      params[110] = 2;
      const measuredSmooth = await renderer.measureToneAdjustedPeak(
        { texture, width: 3, height: 1 },
        params,
        "maximum",
        `saturated-bt2020-test-${performance.now()}`,
      );
      const toBt2020 = ([r, g, b]) => [
        1.0260187082 * r - 0.0221655448 * g - 0.0038531634 * b,
        -0.0017230808 * r + 1.0023190716 * g - 0.0005959908 * b,
        -0.0051099278 * r - 0.0216355504 * g + 1.0267454781 * b,
      ];
      const expectedSmooth = Math.max(
        ...toBt2020(toneRgb([10, 0.1, 0.1])),
        ...toBt2020(toneRgb([0.1, 10, 0.1])),
        ...toBt2020(toneRgb([0.1, 0.1, 10])),
      );
      const sdrParams = new Float32Array(160);
      sdrParams[0] = 0;
      sdrParams[1] = 0;
      sdrParams[2] = 0.7;
      sdrParams[110] = 2;
      sdrParams[159] = 1;
      const measuredSdrGenerated = await renderer.measureToneAdjustedPeak(
        { texture, width: 3, height: 1 },
        sdrParams,
        "maximum",
        `sdr-generated-saturated-test-${performance.now()}`,
      );
      const toSrgb = ([r, g, b]) => [
        1.7050509927 * r - 0.6217921207 * g - 0.0832588720 * b,
        -0.1302564175 * r + 1.1408047366 * g - 0.0105483191 * b,
        -0.0240033568 * r - 0.1289689761 * g + 1.1529723329 * b,
      ];
      const sdrScale = (100 / 203) / 0.18;
      const expectedSdrGenerated = Math.max(
        ...toSrgb([10 * 2 ** 0.7, 0.1 * 2 ** 0.7, 0.1 * 2 ** 0.7]).map((value) => value * sdrScale),
        ...toSrgb([0.1 * 2 ** 0.7, 10 * 2 ** 0.7, 0.1 * 2 ** 0.7]).map((value) => value * sdrScale),
        ...toSrgb([0.1 * 2 ** 0.7, 0.1 * 2 ** 0.7, 10 * 2 ** 0.7]).map((value) => value * sdrScale),
      );
      sdrParams[1] = 1;
      const measuredSdrAuthored = await renderer.measureToneAdjustedPeak(
        { texture, width: 3, height: 1 },
        sdrParams,
        "maximum",
        `sdr-authored-saturated-test-${performance.now()}`,
      );
      const expectedSdrAuthored = 10 * 2 ** 0.7;
      texture.destroy();

      Object.assign(state.adjustments.hdr, {
        highlight_section_enabled: true,
        highlight_compression_mode: "peak_fit",
        highlight_compression_peak_measurement: "maximum",
        highlight_compression_color_handling: "smooth_rolloff",
        highlight_compression_start_nits: 400,
        highlight_compression_target_nits: 1000,
        exposure: 0.7,
        contrast: 0.5,
      });
      invalidatePreview("hdr");
      renderer.peakReductionCache.clear();
      const originalMeasure = renderer.measureToneAdjustedPeak.bind(renderer);
      let reductions = 0;
      renderer.measureToneAdjustedPeak = async (...args) => {
        reductions += 1;
        return originalMeasure(...args);
      };
      const interactiveRendered = await renderGpuDraft("hdr", { longEdge: 512, tier: "interactive" });
      const interactiveReductions = reductions;
      const settledRendered = await renderGpuDraft("hdr", { longEdge: 512, tier: "settled" });
      const settledReductions = reductions;

      const low = await renderer.analyzeScope(els.previewCanvas, { width: 64, height: 32, tier: "settled" });
      const high = await renderer.analyzeScope(els.previewCanvas, { width: 256, height: 128, tier: "settled" });
      const lowPeak = Math.max(...low.cellPeaks);
      const highPeak = Math.max(...high.cellPeaks);
      const acceptedSourceSerial = state.acceptedPresentation?.sourceSerial;
      const acceptedGeneration = state.acceptedPresentation?.generation;
      state.adjustments.hdr.exposure = 0.71;
      invalidatePreview("hdr");
      await syncGlobalEditState();
      const staleScopeApplied = await refreshScopes(scopeLongEdge("interactive"), { tier: "interactive", lane: "hdr" });
      const staleScopeRetainedUpdating = els.scopeFreshness.classList.contains("updating");
      const refreshedRendered = await renderGpuDraft("hdr", { longEdge: 512, tier: "settled" });
      const currentScopeApplied = await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "hdr" });
      return {
        measured,
        expected,
        measuredSmooth,
        expectedSmooth,
        measuredSdrGenerated,
        expectedSdrGenerated,
        measuredSdrAuthored,
        expectedSdrAuthored,
        interactiveRendered,
        settledRendered,
        interactiveReductions,
        settledReductions,
        lowPeak,
        highPeak,
        sourceSerial: high.sourceSerial,
        acceptedSourceSerial,
        applicationGeneration: high.applicationGeneration,
        acceptedGeneration,
        staleScopeApplied,
        staleScopeRetainedUpdating,
        refreshedRendered,
        currentScopeApplied,
        replacementCurrent: state.acceptedPresentation?.generation === state.previewGeneration.hdr,
      };
    });

    assert(Math.abs(result.measured - result.expected) / result.expected < 0.00002,
      `Image-based saturated peak reduction diverged: ${JSON.stringify(result)}`);
    assert(Math.abs(result.measuredSmooth - result.expectedSmooth) / result.expectedSmooth < 0.00002,
      `Image-based BT.2020 peak reduction diverged: ${JSON.stringify(result)}`);
    assert(Math.abs(result.measuredSdrGenerated - result.expectedSdrGenerated) / result.expectedSdrGenerated < 0.00002,
      `Generated-SDR linear-sRGB peak reduction diverged: ${JSON.stringify(result)}`);
    assert(Math.abs(result.measuredSdrAuthored - result.expectedSdrAuthored) / result.expectedSdrAuthored < 0.00002,
      `Authored-SDR linear-sRGB peak reduction diverged: ${JSON.stringify(result)}`);
    assert(result.interactiveRendered && result.interactiveReductions === 0,
      `Interactive Peak Fit performed a blocking peak readback: ${JSON.stringify(result)}`);
    assert(result.settledRendered && result.settledReductions === 1,
      `Settled Peak Fit did not perform its exact proxy reduction: ${JSON.stringify(result)}`);
    assert(Math.abs(result.lowPeak - result.highPeak) / Math.max(result.highPeak, 1e-8) < 0.0001,
      `Settled scope peak changed with analysis resolution: ${JSON.stringify(result)}`);
    assert(result.sourceSerial === result.acceptedSourceSerial
      && result.applicationGeneration === result.acceptedGeneration,
    `Scope source identity does not match the accepted presentation: ${JSON.stringify(result)}`);
    assert(result.staleScopeApplied === false && result.staleScopeRetainedUpdating,
      `A stale WebGPU source was presented for a newer edit: ${JSON.stringify(result)}`);
    assert(result.replacementCurrent && result.currentScopeApplied,
      `The matching replacement preview/scope did not recover: ${JSON.stringify(result)}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
