const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const selector = page.locator("#preview-latency");
    const options = await selector.locator("option").evaluateAll((items) => items.map((item) => item.value));
    const expected = ["responsive", "balanced", "precise"];
    if (JSON.stringify(options) !== JSON.stringify(expected)) {
      throw new Error(`Preview response options were incorrect: ${JSON.stringify(options)}`);
    }

    await page.click("#test-pattern-button");
    await page.waitForFunction(() => document.body.dataset.workflow === "grade");
    await page.click("#zoom-actual");
    await page.waitForFunction(() => {
      const preview = activePreviewElement();
      const source = state.session?.source;
      if (!preview || !source || state.zoomMode !== "custom" || state.geometryPresentationPending) return false;
      return Math.abs(Number.parseFloat(preview.style.width) - source.width) <= 1
        && Math.abs(Number.parseFloat(preview.style.height) - source.height) <= 1;
    });
    const actualSize = await page.evaluate(() => {
      const preview = activePreviewElement();
      const source = state.session.source;
      return {
        cssWidth: Number.parseFloat(preview.style.width),
        cssHeight: Number.parseFloat(preview.style.height),
        sourceWidth: source.width,
        sourceHeight: source.height,
      };
    });
    if (Math.abs(actualSize.cssWidth - actualSize.sourceWidth) > 1 || Math.abs(actualSize.cssHeight - actualSize.sourceHeight) > 1) {
      throw new Error(`100% zoom was not one source pixel per CSS pixel: ${JSON.stringify(actualSize)}`);
    }
    await page.locator("#preview-toggle").click();
    await page.locator("#preview-popover").waitFor({ state: "visible" });
    const statusFitsPopover = await page.evaluate(() => {
      const popover = document.querySelector("#preview-popover");
      const status = document.querySelector("#preview-quality-status");
      const original = status.textContent;
      status.textContent = "Full unavailable — Bounded strip execution refused this graph. local adjustments, spatial film effects.";
      const popoverRect = popover.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      const fits = statusRect.left >= popoverRect.left
        && statusRect.right <= popoverRect.right
        && status.scrollWidth <= status.clientWidth;
      status.textContent = original;
      return { fits, popoverWidth: popoverRect.width, statusWidth: statusRect.width };
    });
    if (!statusFitsPopover.fits) {
      throw new Error(`A long Preview status overflowed its popover: ${JSON.stringify(statusFitsPopover)}`);
    }
    await selector.selectOption("precise");
    await page.waitForFunction(() => window.HDRFinisherPerformance.authoringState().previewPreference === "precise");
    await page.waitForFunction(() => state.acceptedPresentation?.generation === state.previewGeneration[state.currentView]
      && !previewNeedsRefinement(), null, { timeout: 120000 });
    const precise = await page.evaluate(() => window.HDRFinisherPerformance.authoringState());
    if (precise.previewResolution !== "auto") {
      throw new Error(`Precise response unexpectedly enabled a legacy tier: ${JSON.stringify(precise)}`);
    }
    const afterResponseChange = await page.evaluate(() => ({
      width: Number.parseFloat(activePreviewElement().style.width),
      height: Number.parseFloat(activePreviewElement().style.height),
    }));
    if (Math.abs(afterResponseChange.width - actualSize.sourceWidth) > 1 || Math.abs(afterResponseChange.height - actualSize.sourceHeight) > 1) {
      throw new Error(`Preview response changed 100% viewer geometry: ${JSON.stringify(afterResponseChange)}`);
    }
    await selector.selectOption("responsive");
    await page.waitForFunction(() => window.HDRFinisherPerformance.authoringState().previewPreference === "responsive");

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Preview response selector and native zoom geometry browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
