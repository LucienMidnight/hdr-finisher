const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const urlIndex = process.argv.indexOf("--url");
const baseUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/409 \(Conflict\)/i.test(message.text())) browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const outputDirectory = path.resolve("output", "export-file-browser-interaction");
  const runId = Date.now();
  fs.mkdirSync(outputDirectory, { recursive: true });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#import-button").click();
    const chooser = await chooserPromise;
    await chooser.setFiles(path.resolve("tests", "fixtures", "hdr_headroom.tiff"));
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", null, { timeout: 120000 });
    if (await page.locator("#interpretation-gate").isVisible()) await page.locator("#accept-interpretation").click();

    await page.locator('[data-workflow-tab="grade"]').click();
    await page.locator('[data-path="hdr.exposure"]').evaluate((control) => {
      control.value = "0.2";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator('[data-workflow-tab="export"]').click();
    await page.locator("#export-directory").fill(outputDirectory);
    await page.locator("#export-directory-browse").click();
    await page.locator("#directory-browser").waitFor({ state: "visible" });
    await page.waitForFunction((directory) => document.getElementById("directory-browser-path")?.value === directory, outputDirectory);
    await page.locator("#directory-browser-select").click();
    await page.locator("#directory-browser").waitFor({ state: "hidden" });

    const exports = [];
    for (const testCase of [
      { format: "sdr_png", extension: ".png" },
      { format: "jpeg_ultrahdr", extension: ".jpg" },
    ]) {
      const filename = `edge-${testCase.format}-${runId}`;
      const expectedOutput = path.join(outputDirectory, `${filename}${testCase.extension}`);
      await page.locator(`[data-format-card="${testCase.format}"]`).click();
      await page.locator("#export-filename").fill(filename);
      const exportResponsePromise = page.waitForResponse((response) => response.url().includes("/export") && response.request().method() === "POST", { timeout: 120000 });
      await page.locator("#export-confirm-button").click();
      const response = await exportResponsePromise;
      const payload = await response.json();
      await page.waitForFunction(() => !document.getElementById("export-result")?.classList.contains("hidden"), null, { timeout: 120000 });
      exports.push({
        format: testCase.format,
        status: response.status(),
        payload,
        displayedPath: await page.locator("#export-result-path").textContent(),
        outputExists: fs.existsSync(expectedOutput),
        outputBytes: fs.existsSync(expectedOutput) ? fs.statSync(expectedOutput).size : 0,
      });
    }

    const result = {
      fileChooserMultiple: chooser.isMultiple(),
      selectedDirectory: await page.locator("#export-directory").inputValue(),
      exports,
      browserErrors,
    };
    if (exports.some((entry) => entry.status !== 200 || !entry.payload.accepted || !entry.outputExists || entry.outputBytes === 0) || browserErrors.length) {
      throw new Error(`Export/file-browser regression failed: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify(result));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
