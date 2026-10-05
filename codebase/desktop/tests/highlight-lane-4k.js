const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const project = process.env.HDR_FINISHER_TEST_PROJECT || "C:\\Users\\Steve\\Desktop\\_DSC2743.hdrfinisher";

function presentation(page, predicate, timeout = 180000) {
  return page.evaluate(({ source, timeout }) => new Promise((resolve, reject) => {
    const matches = Function("detail", `return (${source})(detail)`);
    const startedAt = performance.now();
    const timer = setTimeout(() => {
      window.removeEventListener("hdrfinisher:preview-presented", receive);
      reject(new Error("Timed out waiting for preview presentation"));
    }, timeout);
    function receive(event) {
      if (!matches(event.detail)) return;
      clearTimeout(timer);
      window.removeEventListener("hdrfinisher:preview-presented", receive);
      resolve({ ...event.detail, elapsedMs: performance.now() - startedAt });
    }
    window.addEventListener("hdrfinisher:preview-presented", receive);
  }), { source: predicate.toString(), timeout });
}

(async () => {
  assert.ok(fs.existsSync(project), `Missing project: ${project}`);
  const output = path.resolve(__dirname, "../output/highlight-lane-4k");
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, "profile-"));
  fs.writeFileSync(path.join(userData, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    renderingMode: "auto",
    updates: { checkAutomatically: false },
  }));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [project],
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.waitForFunction(() => typeof state !== "undefined" && state.session?.session_id && state.acceptedPresentation, null, { timeout: 180000 });
    await page.waitForTimeout(3000);
    const gpuStartup = await page.evaluate(() => ({
      available: state.gpuPreview?.available,
      detail: state.gpuPreview?.detail,
      navigatorGpu: Boolean(navigator.gpu),
    }));
    assert.equal(gpuStartup.available, true, `WebGPU startup failed: ${JSON.stringify(gpuStartup)}`);
    await page.evaluate(() => applyPreviewResolution("1024"));
    await page.waitForFunction(() => state.acceptedPresentation?.lane === state.currentView
      && state.acceptedPresentation?.generation === state.previewGeneration[state.currentView], null, { timeout: 120000 });

    await page.evaluate(() => {
      state.currentView = "hdr";
      state.adjustments.hdr.highlight_section_enabled = false;
      invalidatePreview("hdr");
    });
    const enablePromise = presentation(page, (detail) => detail.lane === "hdr");
    await page.evaluate(() => {
      Object.assign(state.adjustments.hdr, {
        highlight_section_enabled: true,
        highlight_compression_mode: "peak_fit",
        highlight_compression_peak_measurement: "maximum",
        highlight_compression_target_nits: 1000,
      });
      invalidatePreview("hdr");
      debouncePreview("hdr");
    });
    const enableCompression = await enablePromise;
    const compressionState = await page.evaluate(() => ({
      eligible: gpuPreviewEligible("hdr"),
      accepted: state.acceptedPresentation,
    }));

    const fourKPromise = presentation(page, (detail) => detail.lane === "hdr" && detail.longEdge >= 4096);
    await page.evaluate(() => applyPreviewResolution("4096"));
    const fourK = await fourKPromise;
    const fourKState = await page.evaluate(() => ({
      selected: state.previewResolution,
      accepted: state.acceptedPresentation,
      canvas: { width: els.previewCanvas.width, height: els.previewCanvas.height },
    }));

    const firstSdrPromise = presentation(page, (detail) => detail.lane === "sdr");
    await page.locator('[data-kind="sdr"]').click();
    const firstSdr = await firstSdrPromise;
    const firstSdrRefinedPromise = presentation(page, (detail) => detail.lane === "sdr" && detail.longEdge >= 4096);
    const firstSdrRefined = await firstSdrRefinedPromise;
    const returnHdrPromise = presentation(page, (detail) => detail.lane === "hdr");
    await page.locator('[data-kind="hdr"]').click();
    const returnHdr = await returnHdrPromise;

    assert.equal(compressionState.eligible, true, "Highlight Compression must remain WebGPU eligible");
    assert.equal(compressionState.accepted.transport, "WebGPU", "Highlight Compression presented a CPU/backend frame");
    assert.equal(fourKState.selected, "4096");
    assert.ok(fourKState.accepted.processedLongEdge >= 4096, "The accepted Grade presentation was not 4K");
    // Processing remains 4K; the visible backing surface follows the accepted
    // viewport-sized output rather than allocating a whole 4K picture.
    assert.equal(fourKState.accepted.transport, "WebGPU");
    assert.equal(fourKState.accepted.exact, true);
    assert.equal(fourKState.accepted.requestedTier, "4096");
    assert.deepEqual(fourKState.canvas, {
      width: fourKState.accepted.width, height: fourKState.accepted.height,
    }, "Canvas backing dimensions disagree with the accepted output");
    assert.ok(fourKState.canvas.width > 0 && fourKState.canvas.height > 0,
      "The accepted canvas has no pixels");
    const box = await page.locator("#preview-canvas").boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, "The returned HDR canvas is not visible");
    const screenshot = await page.screenshot({ clip: box });
    const paintedPeak = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 32, 32);
      return Math.max(...context.getImageData(0, 0, 32, 32).data.filter((_, index) => index % 4 !== 3));
    }, `data:image/png;base64,${screenshot.toString("base64")}`);
    assert.ok(paintedPeak > 0, "The returned HDR compositor frame is blank");
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ enableCompression, compressionState, fourK, fourKState, firstSdr, firstSdrRefined, returnHdr }, null, 2));
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    if (!app.process().killed) app.process().kill();
  }
  // Electron's development sidecar can keep an inherited pipe alive on
  // Windows after the application process exits. Assertions have completed.
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
