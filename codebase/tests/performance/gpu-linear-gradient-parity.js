const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const urlIndex = process.argv.indexOf("--url");
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : "http://127.0.0.1:8799";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.gpuPreview?.available && viewerState().status === "ready", null,
      { timeout: 120000 });
    const comparison = await page.evaluate(async () => {
      const document = JSON.parse(JSON.stringify(state.editDocument));
      document.local_adjustments = [{
        id: "analytic-gradient-parity", name: "Analytic gradient", enabled: true, opacity: 1,
        mask: { operator: "leaf", enabled: true, inverted: false, children: [], leaf: {
          type: "linear_gradient", start: { x: 0.17, y: 0.29 }, end: { x: 0.83, y: 0.76 },
          gradient_midpoint_1: 0.31, gradient_midpoint_2: 0.69,
          gradient_fan: 0, gradient_luma_enabled: false, mask_opacity: 1,
        } },
        hdr_grade: { exposure: 1.25 }, sdr_grade: {},
      }];
      await queueEditCommand("replace_document", { document }, null, { refreshPreview: false });
      applyExecutionOverride("tiled");
      state.previewScheduler?.cancel();
      window.HDRFinisherPerformance.cancelRoiCatchUp();
      const gpu = state.gpuPreview;
      const edge = 1024;
      const renderAndRead = async (analytic) => {
        gpu.gpuAnalyticMasksEnabled = analytic;
        const result = await window.HDRFinisherPerformance.renderTiledTier(edge);
        if (!result?.rendered) throw new Error(`Tiled render refused: ${JSON.stringify(result?.refusals)}`);
        await gpu.device.queue.onSubmittedWorkDone();
        const capture = await gpu.readPresentationRegion(els.previewCanvas.width, els.previewCanvas.height);
        return { values: Array.from(capture.values), width: capture.width, height: capture.height };
      };
      const cpu = await renderAndRead(false);
      for (const entry of gpu.maskTiles.values()) entry.texture.destroy();
      gpu.maskTiles.clear();
      const analytic = await renderAndRead(true);
      let maxDelta = 0;
      let differing = 0;
      for (let index = 0; index < cpu.values.length; index += 1) {
        const delta = Math.abs(cpu.values[index] - analytic.values[index]);
        if (delta) differing += 1;
        maxDelta = Math.max(maxDelta, delta);
      }
      return { width: cpu.width, height: cpu.height, maxDelta, differing,
        samples: cpu.values.length, maskEvents: gpu.performanceMetrics.maskEvents || [] };
    });
    assert.equal(pageErrors.length, 0, pageErrors.join(" | "));
    assert.ok(comparison.maskEvents.some((event) => event.kind === "gpu-linear-gradient"));
    assert.ok(comparison.maxDelta <= 1 / 255 + 1e-12, JSON.stringify(comparison));
    console.log(JSON.stringify(comparison));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
