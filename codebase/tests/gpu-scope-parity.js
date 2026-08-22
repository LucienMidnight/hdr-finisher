const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available && els.previewCanvas.style.display !== "none", null, { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const comparisons = {};
      for (const mode of ["histogram", "waveform", "vectorscope"]) {
        state.scopeMode = mode;
        els.scopeMode.value = mode;
        let presented = false;
        for (let attempt = 0; attempt < 12 && !presented; attempt += 1) {
          presented = await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
          if (!presented) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!presented) throw new Error(`GPU ${mode} scope was not presented.`);
        const gpu = JSON.parse(JSON.stringify(state.lastScope));
        const bins = mode === "vectorscope" ? 128 : mode === "waveform" ? waveformRequestResolution("settled").bins : 256;
        const columns = mode === "vectorscope" ? 128 : mode === "waveform" ? waveformRequestResolution("settled").columns : 256;
        const response = await fetch(`/api/session/${state.session.session_id}/scopes?kind=${state.currentView}&mode=${mode}&long_edge=${settledProxyLongEdge()}&max_nits=${state.scopeMaxNits}&bins=${bins}&columns=${columns}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edit_revision: state.editRevision, include_locals: true, generation: 1, tier: "settled" }),
        });
        if (!response.ok) throw new Error(`CPU ${mode} scope failed with HTTP ${response.status}`);
        comparisons[mode] = { gpu, cpu: await response.json() };
      }
      return comparisons;
    });

    const report = {};
    for (const [mode, pair] of Object.entries(result)) {
      const peakRelative = Math.abs(pair.gpu.peak_value - pair.cpu.peak_value) / Math.max(1e-6, pair.cpu.peak_value);
      let distributionError = 0;
      if (mode === "histogram") {
        const errors = pair.gpu.channels.map((channel, index) => {
          const left = channel.bins;
          const right = pair.cpu.channels[index].bins;
          const leftTotal = left.reduce((sum, value) => sum + value, 0) || 1;
          const rightTotal = right.reduce((sum, value) => sum + value, 0) || 1;
          return left.reduce((sum, value, bin) => sum + Math.abs(value / leftTotal - right[bin] / rightTotal), 0) / left.length;
        });
        distributionError = Math.max(...errors);
      } else {
        const centroid = (grid) => {
          let total = 0; let x = 0; let y = 0;
          grid.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
            total += value; x += value * columnIndex; y += value * rowIndex;
          }));
          return [x / Math.max(1, total) / Math.max(1, grid[0].length - 1), y / Math.max(1, total) / Math.max(1, grid.length - 1)];
        };
        const gpuCentroid = centroid(pair.gpu.channels.at(-1).grid);
        const cpuCentroid = centroid(pair.cpu.channels.at(-1).grid);
        distributionError = Math.hypot(gpuCentroid[0] - cpuCentroid[0], gpuCentroid[1] - cpuCentroid[1]);
      }
      report[mode] = { peakRelative, distributionError };
      assert(peakRelative <= 0.03, `${mode} GPU peak differs from CPU by ${(peakRelative * 100).toFixed(2)}%.`);
      assert(distributionError <= 0.025, `${mode} GPU distribution differs from CPU by ${distributionError.toFixed(4)}.`);
    }

    const sdrBands = await page.evaluate(async () => {
      if (await syncGlobalEditState() === false) throw new Error("Pending HDR state did not synchronize before SDR parity.");
      state.currentView = "sdr";
      renderLaneChrome();
      state.adjustments.sdr.tone_equalizer_nodes = [
        { input_ev: -6, adjustment_ev: 0.35 },
        { input_ev: -3, adjustment_ev: 0.2 },
        { input_ev: 0, adjustment_ev: 0 },
        { input_ev: 3, adjustment_ev: -0.15 },
        { input_ev: 6, adjustment_ev: -0.3 },
      ];
      state.adjustments.sdr.tone_equalizer_smoothing = 0.75;
      invalidatePreview("sdr");
      if (await syncGlobalEditState() === false) throw new Error(`SDR Exposure Bands state did not synchronize: ${els.badge.textContent}`);
      if (!await renderGpuDraft("sdr", { longEdge: settledProxyLongEdge() })) {
        throw new Error("SDR Exposure Bands GPU draft did not render.");
      }
      state.scopeMode = "histogram";
      els.scopeMode.value = "histogram";
      let presented = false;
      for (let attempt = 0; attempt < 12 && !presented; attempt += 1) {
        presented = await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "sdr" });
        if (!presented) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!presented) throw new Error("GPU SDR Exposure Bands histogram was not presented.");
      const gpu = JSON.parse(JSON.stringify(state.lastScope));
      const response = await fetch(`/api/session/${state.session.session_id}/scopes?kind=sdr&mode=histogram&long_edge=${settledProxyLongEdge()}&max_nits=${state.scopeMaxNits}&bins=256&columns=256`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edit_revision: state.editRevision, include_locals: true, generation: 1, tier: "settled" }),
      });
      if (!response.ok) throw new Error(`CPU SDR Exposure Bands scope failed with HTTP ${response.status}`);
      return { gpu, cpu: await response.json() };
    });
    const sdrPeakRelative = Math.abs(sdrBands.gpu.peak_value - sdrBands.cpu.peak_value) / Math.max(1e-6, sdrBands.cpu.peak_value);
    const sdrDistributionError = Math.max(...sdrBands.gpu.channels.map((channel, index) => {
      const leftTotal = channel.bins.reduce((sum, value) => sum + value, 0) || 1;
      const right = sdrBands.cpu.channels[index].bins;
      const rightTotal = right.reduce((sum, value) => sum + value, 0) || 1;
      return channel.bins.reduce((sum, value, bin) => sum + Math.abs(value / leftTotal - right[bin] / rightTotal), 0) / channel.bins.length;
    }));
    report.sdrExposureBands = { peakRelative: sdrPeakRelative, distributionError: sdrDistributionError };
    assert(sdrPeakRelative <= 0.03, `SDR Exposure Bands GPU peak differs from CPU by ${(sdrPeakRelative * 100).toFixed(2)}%.`);
    assert(sdrDistributionError <= 0.025, `SDR Exposure Bands GPU distribution differs from CPU by ${sdrDistributionError.toFixed(4)}.`);

    const sdrToneMappers = await page.evaluate(async () => {
      const comparisons = {};
      const neutralBands = defaultAdjustments().sdr.tone_equalizer_nodes;
      state.adjustments.sdr.tone_equalizer_nodes = neutralBands;
      state.adjustments.sdr.highlight_recovery = 0;
      for (const mapper of ["filmic", "aces", "reinhard"]) {
        state.adjustments.sdr.tone_mapper = mapper;
        invalidatePreview("sdr");
        if (await syncGlobalEditState() === false) throw new Error(`${mapper} state did not synchronize.`);
        if (!await renderGpuDraft("sdr", { longEdge: settledProxyLongEdge() })) {
          throw new Error(`${mapper} GPU draft did not render.`);
        }
        let presented = false;
        for (let attempt = 0; attempt < 12 && !presented; attempt += 1) {
          presented = await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "sdr" });
          if (!presented) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!presented) throw new Error(`${mapper} GPU histogram was not presented.`);
        const gpu = JSON.parse(JSON.stringify(state.lastScope));
        const response = await fetch(`/api/session/${state.session.session_id}/scopes?kind=sdr&mode=histogram&long_edge=${settledProxyLongEdge()}&max_nits=${state.scopeMaxNits}&bins=256&columns=256`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edit_revision: state.editRevision, include_locals: true, generation: 1, tier: "settled" }),
        });
        if (!response.ok) throw new Error(`CPU ${mapper} histogram failed with HTTP ${response.status}`);
        comparisons[mapper] = { gpu, cpu: await response.json() };
      }
      return comparisons;
    });
    for (const [mapper, pair] of Object.entries(sdrToneMappers)) {
      const peakRelative = Math.abs(pair.gpu.peak_value - pair.cpu.peak_value) / Math.max(1e-6, pair.cpu.peak_value);
      const distributionError = Math.max(...pair.gpu.channels.map((channel, index) => {
        const leftTotal = channel.bins.reduce((sum, value) => sum + value, 0) || 1;
        const right = pair.cpu.channels[index].bins;
        const rightTotal = right.reduce((sum, value) => sum + value, 0) || 1;
        return channel.bins.reduce((sum, value, bin) => sum + Math.abs(value / leftTotal - right[bin] / rightTotal), 0) / channel.bins.length;
      }));
      report[`sdrToneMapper:${mapper}`] = { peakRelative, distributionError };
      assert(peakRelative <= 0.03, `${mapper} GPU peak differs from CPU by ${(peakRelative * 100).toFixed(2)}%.`);
      assert(distributionError <= 0.025, `${mapper} GPU distribution differs from CPU by ${distributionError.toFixed(4)}.`);
    }
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ browser: await browser.version(), report, pageErrors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
