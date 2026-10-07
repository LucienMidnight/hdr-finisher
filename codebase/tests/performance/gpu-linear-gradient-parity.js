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
      const setupDeadline = performance.now() + 120000;
      while (state.gpuDraftInFlight || pendingHighlightAnchors.size || exactHighlightAnchorInflight.size) {
        if (performance.now() > setupDeadline) throw new Error("Gradient parity setup did not settle");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      state.previewScheduler?.cancel();
      window.HDRFinisherPerformance.cancelRoiCatchUp();
      const gpu = state.gpuPreview;
      const edge = 1024;
      const renderAndRead = async (analytic) => {
        gpu.gpuAnalyticMasksEnabled = analytic;
        // Both mask routes store their tiles under the same key.
        for (const entry of gpu.maskTiles.values()) entry.texture.destroy();
        gpu.maskTiles.clear();
        // Forcing the route schedules an ordinary Fit redraw, which can land
        // after this render and leave its smaller frame on screen. Render
        // again until the frame read back is the one that was asked for.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const result = await window.HDRFinisherPerformance.renderTiledTier(edge);
          if (!result?.rendered) throw new Error(`Tiled render refused: ${JSON.stringify(result?.refusals)}`);
          await gpu.device.queue.onSubmittedWorkDone();
          const capture = await gpu.readPresentationRegion(result.width, result.height);
          if (capture?.width !== result.width || capture.height !== result.height) continue;
          const mask = await gpu.readLocalMaskRegion("analytic-gradient-parity", 0, 0, result.width, result.height);
          if (mask.error || mask.coveredPixels !== result.width * result.height) continue;
          return { values: Array.from(capture.values), width: capture.width, height: capture.height,
            mask: Array.from(mask.values), maskSources: mask.sources };
        }
        throw new Error("The tiled frame did not stay on screen long enough to read");
      };
      const cpu = await renderAndRead(false);
      const analytic = await renderAndRead(true);
      if (cpu.width !== analytic.width || cpu.height !== analytic.height) {
        throw new Error(`Frames differ in size: ${cpu.width}x${cpu.height} against ${analytic.width}x${analytic.height}`);
      }
      // Reported, not gated: how far apart the two masks themselves are.
      let maxMaskLevels = 0;
      for (let index = 0; index < cpu.mask.length; index += 1) {
        maxMaskLevels = Math.max(maxMaskLevels, Math.abs(cpu.mask[index] - analytic.mask[index]) * 255);
      }
      let maxDelta = 0;
      let differing = 0;
      for (let index = 0; index < cpu.values.length; index += 1) {
        const delta = Math.abs(cpu.values[index] - analytic.values[index]);
        if (delta) differing += 1;
        maxDelta = Math.max(maxDelta, delta);
      }
      return { width: cpu.width, height: cpu.height, maxDelta, differing, maxMaskLevels,
        maskSources: [cpu.maskSources, analytic.maskSources],
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
