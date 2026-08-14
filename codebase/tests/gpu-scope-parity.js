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
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ browser: await browser.version(), report, pageErrors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
