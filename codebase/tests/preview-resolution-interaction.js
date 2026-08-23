const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const selector = page.locator("#preview-resolution");
    const options = await selector.locator("option").evaluateAll((items) => items.map((item) => [item.value, item.textContent]));
    const expected = [["1024", "1K"], ["2048", "2K"], ["4096", "4K"], ["full", "Full"]];
    if (JSON.stringify(options) !== JSON.stringify(expected)) {
      throw new Error(`Preview resolution options were incorrect: ${JSON.stringify(options)}`);
    }

    await page.click("#test-pattern-button");
    await page.waitForFunction(() => document.body.dataset.workflow === "grade");
    await selector.selectOption("4096");
    await page.waitForFunction(() => window.HDRFinisherPerformance.authoringState().previewResolution === "4096");
    const fourK = await page.evaluate(() => window.HDRFinisherPerformance.authoringState());
    if (fourK.previewMaxDimension > 4096) {
      throw new Error(`4K preview target exceeded its hard dimension cap: ${JSON.stringify(fourK)}`);
    }

    await page.route("**/preview-preflight?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        allowed: false,
        reason: "Synthetic memory guard rejection.",
        width: 6000,
        height: 4000,
      }),
    }));
    await selector.selectOption("full");
    await page.waitForFunction(() => document.querySelector("#preview-resolution").value === "4096");
    const blockedStatus = await page.locator("#preview-quality-status").textContent();
    if (!blockedStatus.includes("Full blocked")) {
      throw new Error(`Full memory guard did not explain its 4K fallback: ${blockedStatus}`);
    }
    await page.unroute("**/preview-preflight?*");

    await selector.selectOption("full");
    await page.waitForFunction(() => window.HDRFinisherPerformance.authoringState().previewResolution === "full");
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Preview resolution selector and Full memory guard browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
