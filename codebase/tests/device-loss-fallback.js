const { chromium } = require("playwright");

const urlIndex = process.argv.indexOf("--url");
const baseUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadPattern(page) {
  await page.getByRole("button", { name: "Load test pattern" }).click();
  await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const fallbackResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/preview-raw/") || response.url().includes("/scopes?")) {
      fallbackResponses.push({ url: response.url(), status: response.status() });
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await loadPattern(page);
    assert(await page.evaluate(() => Boolean(state.gpuPreview?.available)), "WebGPU was unavailable before the device-loss test.");
    assert(await page.locator("#preview-canvas").isVisible(), "The WebGPU canvas was not visible before device loss.");

    fallbackResponses.length = 0;
    await page.evaluate(() => state.gpuPreview.device.destroy());
    await page.waitForFunction(() => state.gpuPreview?.available === false);
    await page.waitForFunction(() => state.previewInfo?.transport === "Raw RGBA8", null, { timeout: 60000 });
    await page.locator("#preview-canvas").waitFor({ state: "visible", timeout: 60000 });
    const afterLoss = await page.evaluate(() => ({
      detail: state.gpuPreview.detail,
      displayDetail: state.displayInfo.gpu,
      canvasVisible: getComputedStyle(document.getElementById("preview-canvas")).display !== "none",
      imageVisible: getComputedStyle(document.getElementById("preview-image")).display !== "none",
      transport: state.previewInfo?.transport,
      cpuCanvas: Boolean(document.getElementById("preview-canvas").getContext("2d")),
    }));
    assert(/device lost/i.test(afterLoss.detail), `Device loss was not reported: ${JSON.stringify(afterLoss)}`);
    assert(afterLoss.canvasVisible && !afterLoss.imageVisible && afterLoss.cpuCanvas, `The CPU fallback did not replace the lost WebGPU canvas: ${JSON.stringify(afterLoss)}`);
    assert(fallbackResponses.some((response) => response.url.includes("/preview-raw/") && response.status === 200), "Device loss did not request an authoritative CPU preview.");

    fallbackResponses.length = 0;
    const exposure = page.locator('[data-path="hdr.exposure"]');
    await exposure.evaluate((control) => {
      control.value = "0.5";
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(1200);
    assert(fallbackResponses.some((response) => response.url.includes("/preview-raw/hdr") && response.status === 200), "Editing after device loss did not request a new CPU preview.");
    await page.waitForFunction(() => document.getElementById("scope-freshness")?.textContent !== "Updating", null, { timeout: 30000 });
    assert(await page.locator("#preview-canvas").isVisible(), "Editing after device loss did not remain on the CPU preview.");

    await page.reload({ waitUntil: "networkidle" });
    await loadPattern(page);
    const reloaded = await page.evaluate(() => ({ available: state.gpuPreview?.available, detail: state.gpuPreview?.detail }));
    assert(reloaded.available, `Reload did not restore a fresh WebGPU device: ${JSON.stringify(reloaded)}`);
    assert(await page.locator("#preview-canvas").isVisible(), "The WebGPU canvas did not return after reload.");
    assert(pageErrors.length === 0, `Browser errors occurred: ${pageErrors.join(" | ")}`);

    console.log(JSON.stringify({ afterLoss, fallbackResponses: fallbackResponses.length, reloaded }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
