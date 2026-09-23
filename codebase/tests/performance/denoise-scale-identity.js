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
    const result = await page.evaluate(async () => {
      state.previewScheduler?.cancel();
      window.HDRFinisherPerformance.cancelRoiCatchUp();
      await setDenoiseEnabled(true);
      const renderAt = async (edge) => {
        const rendered = await window.HDRFinisherPerformance.renderGpuTier(edge);
        const denoise = state.gpuPreview.diagnosticsSnapshot().denoise;
        return { rendered, identity: denoise.identity, selected: denoise.selectedSource,
          analysisCalls: denoise.analysisCalls, processedLongEdge: state.acceptedPresentation?.processedLongEdge };
      };
      return [await renderAt(768), await renderAt(1024)];
    });
    assert.equal(pageErrors.length, 0, pageErrors.join(" | "));
    for (const [index, edge] of [768, 1024].entries()) {
      assert.ok(result[index].rendered, JSON.stringify(result));
      assert.ok(result[index].identity.includes(`:hdr:${edge}:`), JSON.stringify(result));
      assert.equal(result[index].selected, "resolved");
      assert.equal(result[index].processedLongEdge, edge);
    }
    assert.ok(result[1].analysisCalls > result[0].analysisCalls, JSON.stringify(result));
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
