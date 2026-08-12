const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

async function editValue(locator, value, { keyboardOnly = false } = {}) {
  if (keyboardOnly) {
    await locator.focus();
    await locator.press("Enter");
  } else {
    await locator.dblclick();
  }
  await locator.fill(String(value));
  await locator.press("Enter");
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const failedApiResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 400 && response.status() !== 409) {
      failedApiResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.click("#test-pattern-button");
    await page.waitForFunction(() => document.body.dataset.workflow === "grade");
    for (const groupName of ["hdr-tone", "hdr-highlights", "hdr-equalizer", "hdr-color"]) {
      const group = page.locator(`[data-group="${groupName}"]`);
      if (await group.evaluate((element) => element.classList.contains("collapsed"))) {
        await group.locator(".group-toggle").click();
      }
    }

    const gradeReadouts = page.locator('#grade-workflow-panel [data-value-path]');
    const editableReadouts = page.locator('#grade-workflow-panel [data-value-path].editable-value');
    if (await gradeReadouts.count() !== await editableReadouts.count()) {
      throw new Error("Every grading readout should be editable.");
    }

    const compressionStart = page.locator('[data-value-path="hdr.highlight_compression_start_nits"]');
    if ((await compressionStart.textContent()).trim() !== "400 nit") {
      throw new Error("The test pattern should begin at a 400-nit compression start.");
    }
    await editValue(compressionStart, 100);
    if ((await compressionStart.textContent()).trim() !== "100 nit") {
      throw new Error("Double-click numeric entry did not set Compression Start to 100 nit.");
    }

    const modeSelect = page.locator('[data-path="hdr.highlight_compression_mode"]');
    await modeSelect.selectOption("soft_ceiling");
    const softnessSlider = page.locator('[data-path="hdr.highlight_compression_softness"]');
    await softnessSlider.focus();
    await softnessSlider.press("ArrowRight");
    const softnessState = await page.evaluate(() => window.HDRFinisherPerformance.authoringState().adjustments.hdr.highlight_compression_softness);
    if (softnessState !== 0.5) throw new Error(`Expected a half-percent Softness step, received ${softnessState}.`);
    if ((await page.locator('[data-value-path="hdr.highlight_compression_softness"]').textContent()).trim() !== "0.5%") {
      throw new Error("The Softness readout should display half-percent slider values.");
    }

    await modeSelect.selectOption("peak_fit");
    await page.waitForFunction(() => document.querySelector("#highlight-compression-summary")?.textContent.includes("Peak Fit maps"));
    const highlightSection = page.locator('[data-group="hdr-highlights"]');
    if (await highlightSection.count() !== 1) {
      throw new Error("Highlight Compression should be its own main control section.");
    }
    const highlightBypass = highlightSection.locator('[data-section-path="hdr.highlight_section_enabled"]');
    await highlightBypass.click();
    const bypassedHighlightState = await page.evaluate(() => window.HDRFinisherPerformance.authoringState().adjustments.hdr.highlight_section_enabled);
    if (bypassedHighlightState !== false) {
      throw new Error("Highlight Compression bypass should be independent from Tone.");
    }
    await highlightBypass.click();
    if (await page.locator('[data-control-path="hdr.highlight_compression_peak_detail"]').isHidden()) {
      throw new Error("Peak Fit should expose Highlight Detail.");
    }
    if (!await page.locator('[data-control-path="hdr.highlight_compression_softness"]').isHidden()) {
      throw new Error("Peak Fit should hide the Soft Ceiling-only Softness control.");
    }
    await page.locator(".highlight-compression-advanced > summary").click();
    const highlightColor = page.locator('[data-path="hdr.highlight_compression_color_handling"]');
    if (await highlightColor.inputValue() !== "preserve_color") {
      throw new Error("Peak Fit should default to preserving highlight color.");
    }
    await highlightColor.selectOption("path_to_white");
    const highlightColorState = await page.evaluate(() => window.HDRFinisherPerformance.authoringState().adjustments.hdr.highlight_compression_color_handling);
    if (highlightColorState !== "path_to_white") {
      throw new Error(`Expected path-to-white highlight handling, received ${highlightColorState}.`);
    }
    await page.waitForFunction(() => document.querySelector("#highlight-compression-summary")?.textContent.includes("fade toward white"));

    const exposure = page.locator('[data-value-path="hdr.exposure"]');
    await editValue(exposure, 6, { keyboardOnly: true });
    const exposureSlider = page.locator('[data-path="hdr.exposure"]');
    const exposureState = await page.evaluate(() => window.HDRFinisherPerformance.authoringState().adjustments.hdr.exposure);
    if (exposureState !== 6) throw new Error(`Expected stored HDR exposure 6, received ${exposureState}.`);
    if (await exposureSlider.inputValue() !== await exposureSlider.getAttribute("max")) {
      throw new Error("An out-of-slider manual value should pin the slider to its maximum.");
    }
    if (!await exposureSlider.locator("xpath=..").evaluate((shell) => shell.classList.contains("manual-overflow"))) {
      throw new Error("An out-of-slider manual value should mark the range shell.");
    }

    const saturation = page.locator('[data-value-path="hdr.saturation"]');
    await editValue(saturation, 125);
    const saturationState = await page.evaluate(() => window.HDRFinisherPerformance.authoringState().adjustments.hdr.saturation);
    if (saturationState !== 1.25) throw new Error(`Expected +125% to store as 1.25, received ${saturationState}.`);

    const target = page.locator('[data-value-path="hdr.highlight_compression_target_nits"]');
    await editValue(target, 12000);
    if ((await target.textContent()).trim() !== "10000 nit") {
      throw new Error("Target Peak should clamp typed values to the 10,000-nit PQ ceiling.");
    }

    if (!await page.locator("#tone-equalizer-band-output").evaluate((element) => element.classList.contains("editable-value"))) {
      throw new Error("The selected Exposure Band value should be directly editable.");
    }
    if (!await page.locator("#tone-equalizer-radius").evaluate((element) => element.classList.contains("editable-value"))) {
      throw new Error("Exposure Band influence should be directly editable.");
    }

    await page.waitForTimeout(500);
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    if (failedApiResponses.length) throw new Error(`API failures: ${failedApiResponses.join(" | ")}`);
    console.log("Grading direct-value entry browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
