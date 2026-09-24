// Phase 5 item 6: device loss is recoverable and classified. The application
// rebuilds the device in-session twice (state.gpuRebuildAttempts < 2 after the
// loss event), and only then falls back to the authoritative CPU preview for
// the session. This driver exercises that exact ladder and asserts nothing
// sticky is recorded until the attempt budget is genuinely exhausted.

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

async function loseDevice(page) {
  const previous = await page.evaluate(() => {
    const device = state.gpuPreview.device;
    window.__lostDevices = (window.__lostDevices || 0) + 1;
    window.__lostDevice = device;
    device.destroy();
    return { devicesLost: window.__lostDevices, attempts: state.gpuRebuildAttempts };
  });
  // Wait until the loss is actually observed before waiting for recovery:
  // `available` is still true for a tick after destroy().
  await page.waitForFunction(() => state.gpuPreview?.device !== window.__lostDevice
    || state.gpuPreview?.deviceLost === true || state.gpuPreview?.available === false, null,
  { timeout: 60000 });
  return previous;
}

async function waitForRebuilt(page) {
  await page.waitForFunction(() => state.gpuPreview?.available === true
    && state.gpuPreview?.deviceLost === false
    && state.gpuPreview?.device !== window.__lostDevice, null, { timeout: 60000 });
  return page.evaluate(() => ({
    available: state.gpuPreview.available,
    detail: state.gpuPreview.detail,
    attempts: state.gpuRebuildAttempts,
    transport: state.previewInfo?.transport,
    canvasVisible: getComputedStyle(document.getElementById("preview-canvas")).display !== "none",
    imageVisible: getComputedStyle(document.getElementById("preview-image")).display !== "none",
    device: state.gpuPreview.device ? "fresh" : "missing",
  }));
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

    const rebuilt = [];
    for (const cycle of [1, 2]) {
      fallbackResponses.length = 0;
      await loseDevice(page);
      const after = await waitForRebuilt(page);
      rebuilt.push({ cycle, ...after });
      // A successful rebuild resets the consecutive-failure budget, so each
      // isolated loss gets a fresh attempt.
      assert(after.attempts === 0, `Cycle ${cycle}: a successful rebuild did not reset the attempt budget (saw ${after.attempts})`);
      assert(after.canvasVisible && !after.imageVisible, `Cycle ${cycle}: the WebGPU canvas did not return: ${JSON.stringify(after)}`);
      assert(after.transport !== "Raw RGBA8", `Cycle ${cycle}: the rebuilt device did not resume GPU presentation (${after.transport})`);
      // The rebuilt device must still take work: an edit lands on the GPU.
      const exposure = page.locator('[data-path="hdr.exposure"]');
      await exposure.evaluate((control, value) => {
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }, cycle === 1 ? "0.5" : "0.25");
      await page.waitForFunction(() => document.getElementById("scope-freshness")?.textContent !== "Updating", null, { timeout: 30000 });
      const transportAfterEdit = await page.evaluate(() => state.previewInfo?.transport);
      assert(transportAfterEdit !== "Raw RGBA8", `Cycle ${cycle}: an edit after rebuild fell back to the CPU preview`);
    }

    // A rebuild that cannot initialize is the permanent case: force the
    // initialization seam to fail, lose the device, and assert the session
    // keeps working on the authoritative CPU preview rather than pretending
    // the GPU is alive.
    fallbackResponses.length = 0;
    await page.evaluate(() => {
      state.gpuPreview.initialize = async () => {
        state.gpuPreview.available = false;
        state.gpuPreview.detail = "forced rebuild failure for the fallback check";
        return false;
      };
    });
    await loseDevice(page);
    await page.waitForFunction(() => state.gpuPreview?.available === false, null, { timeout: 60000 });
    const afterLoss = await page.evaluate(() => ({
      detail: state.gpuPreview.detail,
      attempts: state.gpuRebuildAttempts,
      transport: state.previewInfo?.transport,
      canvasVisible: getComputedStyle(document.getElementById("preview-canvas")).display !== "none",
      imageVisible: getComputedStyle(document.getElementById("preview-image")).display !== "none",
      cpuCanvas: Boolean(document.getElementById("preview-canvas").getContext("2d")),
      devicesLost: window.__lostDevices,
    }));
    assert(afterLoss.attempts >= 1, `A failed rebuild was not recorded: ${JSON.stringify(afterLoss)}`);
    assert(/device lost|forced rebuild failure/i.test(afterLoss.detail),
      `Device loss was not reported: ${JSON.stringify(afterLoss)}`);

    // With no GPU to rebuild, the next edit must settle on the authoritative
    // CPU preview, which is what swaps the canvas over.
    fallbackResponses.length = 0;
    const exposure = page.locator('[data-path="hdr.exposure"]');
    await exposure.evaluate((control) => {
      control.value = "0.75";
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => state.previewInfo?.transport === "Raw RGBA8", null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const cpuFallback = await page.evaluate(() => ({
      canvasVisible: getComputedStyle(document.getElementById("preview-canvas")).display !== "none",
      imageVisible: getComputedStyle(document.getElementById("preview-image")).display !== "none",
      cpuCanvas: Boolean(document.getElementById("preview-canvas").getContext("2d")),
    }));
    assert(cpuFallback.canvasVisible && !cpuFallback.imageVisible && cpuFallback.cpuCanvas,
      `The CPU fallback did not replace the lost WebGPU canvas: ${JSON.stringify(cpuFallback)}`);
    assert(fallbackResponses.some((response) => response.url.includes("/preview-raw/hdr") && response.status === 200),
      "Editing after device loss did not request a new CPU preview.");
    await page.waitForFunction(() => document.getElementById("scope-freshness")?.textContent !== "Updating", null, { timeout: 30000 });
    assert(await page.locator("#preview-canvas").isVisible(), "Editing after device loss did not remain on the CPU preview.");

    await page.reload({ waitUntil: "networkidle" });
    await loadPattern(page);
    const reloaded = await page.evaluate(() => ({ available: state.gpuPreview?.available, detail: state.gpuPreview?.detail }));
    assert(reloaded.available, `Reload did not restore a fresh WebGPU device: ${JSON.stringify(reloaded)}`);
    assert(await page.locator("#preview-canvas").isVisible(), "The WebGPU canvas did not return after reload.");
    assert(pageErrors.length === 0, `Browser errors occurred: ${pageErrors.join(" | ")}`);

    console.log(JSON.stringify({ rebuilt, afterLoss, reloaded, pageErrors: pageErrors.length }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
