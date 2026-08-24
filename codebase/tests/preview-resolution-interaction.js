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
    const expected = [["1024", "1K"], ["2048", "2K"], ["4096", "4K"]];
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

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Preview resolution selector and 4K ceiling browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
