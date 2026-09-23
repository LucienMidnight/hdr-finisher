const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const urlIndex = process.argv.indexOf("--url");
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : "http://127.0.0.1:8799";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"] });
  try {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url, { waitUntil: "networkidle" });
      await page.setInputFiles("#file-input", ensureLargeNoisySource(2400, 1600));
      await page.waitForFunction(() => state.gpuPreview?.available && viewerState().status === "ready", null,
        { timeout: 120000 });
      await page.evaluate(() => applyPreviewResolution("1024"));
      await page.waitForFunction(() => state.acceptedPresentation?.processedLongEdge === 1024, null,
        { timeout: 120000 });
      await page.evaluate(() => setZoomMode("actual"));
      await page.waitForFunction(() => state.acceptedPresentation?.processedLongEdge === 2400
        && state.acceptedPresentation?.exact === true, null, { timeout: 120000 });
      await page.waitForFunction(() => document.getElementById("navigation-thumb-image").naturalWidth > 0,
        null, { timeout: 120000 });
      const result = await page.evaluate(() => {
        const canvas = document.getElementById("preview-canvas");
        const rect = canvas.getBoundingClientRect();
        return { dpr: window.devicePixelRatio, backingWidth: canvas.width,
          cssWidth: rect.width, sourceWidth: state.session.source.width,
          processedLongEdge: state.acceptedPresentation.processedLongEdge,
          viewport: window.HDRFinisherPerformance.tiledExecutionMetrics()?.viewportRequested,
          execution: state.acceptedPresentation.execution,
          navigationEdge: Math.max(els.navigationThumbImage.naturalWidth, els.navigationThumbImage.naturalHeight),
          navigationVisible: !els.navigationThumb.classList.contains("hidden") };
      });
      assert.equal(errors.length, 0, errors.join(" | "));
      assert.equal(result.processedLongEdge, 2400);
      assert.ok(Math.abs(result.cssWidth * result.dpr - result.sourceWidth) <= 1, JSON.stringify(result));
      assert.ok(Math.abs(result.backingWidth - result.cssWidth * result.dpr) <= 1, JSON.stringify(result));
      assert.equal(result.viewport, true);
      assert.ok(result.navigationVisible && result.navigationEdge <= 512, JSON.stringify(result));
      await page.evaluate(() => setCustomZoom(300));
      const beforePan = await page.evaluate(() => els.dropzone.scrollLeft);
      const navigatorBox = await page.locator("#navigation-thumb-image").boundingBox();
      await page.mouse.click(navigatorBox.x + navigatorBox.width * 0.9,
        navigatorBox.y + navigatorBox.height * 0.5);
      const afterPan = await page.evaluate(() => els.dropzone.scrollLeft);
      assert.ok(afterPan > beforePan, `Navigation thumbnail did not pan: ${beforePan} -> ${afterPan}`);
      console.log(JSON.stringify(result));
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
