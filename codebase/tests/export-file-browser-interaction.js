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
  page.on("response", async (response) => {
    if (response.status() === 422) browserErrors.push(`${response.url()}: ${await response.text()}`);
  });

  const outputDirectory = path.resolve("output", "export-file-browser-interaction");
  const runId = Date.now();
  fs.mkdirSync(outputDirectory, { recursive: true });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const rootPaths = await page.evaluate(() => ({
      windows: splitOutputPath("D:\\root-project.hdrfinisher").directory,
      posix: splitOutputPath("/root-project.hdrfinisher").directory,
    }));
    if (rootPaths.windows !== "D:\\" || rootPaths.posix !== "/") {
      throw new Error(`Drive-root path split regressed: ${JSON.stringify(rootPaths)}`);
    }
    const reservedNameRejected = await page.evaluate(() => {
      try { sanitizeProjectFilename("CON"); return false; } catch { return true; }
    });
    if (!reservedNameRejected) throw new Error("Windows reserved project filenames were not rejected.");

    // Open the shared import action; the Library now owns the start screen.
    const fixtureDirectory = path.join(outputDirectory, `source-${runId}`);
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    const fixture = path.join(fixtureDirectory, "hdr_headroom.tiff");
    fs.copyFileSync(path.resolve("tests", "fixtures", "hdr_headroom.tiff"), fixture);
    let chooser = null;
    if (await page.evaluate(() => Boolean(desktop))) {
      await page.evaluate(() => { void requestSourceImport(); });
      await page.locator("#directory-browser").waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.getElementById('directory-browser-go')?.disabled);
      await page.locator("#directory-browser-path").fill(path.dirname(fixture));
      await page.locator("#directory-browser-path").press("Enter");
      await page.locator(".directory-browser-entry", { hasText: "hdr_headroom.tiff" }).click();
      await page.locator("#directory-browser-select").click();
      await page.locator("#directory-browser").waitFor({ state: "hidden" });
    } else {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.evaluate(() => { void requestSourceImport(); });
      chooser = await chooserPromise;
      await chooser.setFiles(fixture);
    }
    // Wait for import completion, then review the source on the Grade screen.
    await page.waitForFunction(() => Boolean(state.session) && !state.importInProgress, null, { timeout: 120000 });
    await page.locator('[data-workflow-tab="grade"]').click();
    if (await page.evaluate(() => Boolean(state.session?.analysis?.needs_color_override))) {
      await page.locator("#accept-interpretation").click();
    }
    await page.locator('[data-path="hdr.exposure"]').evaluate((control) => {
      control.value = "0.2";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Batch export deliberately uses the saved grade; finish this edit first.
    await page.evaluate(async () => {
      await state.editCommandQueue;
      await syncGlobalEditState();
      if (!await HDRGradeSaving.save()) throw new Error("Could not save the disposable export photo.");
    });
    await page.locator('[data-workflow-tab="export"]').click();
    await page.locator("#batch-run").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll("#batch-grid .batch-photo").length === 1);
    const chooseDirectory = async (directory) => {
      if (await page.evaluate(() => Boolean(desktop))) {
        if (!global.HDRFinisherElectronTestHarness?.selectExportDirectory) throw new Error("Desktop folder selection needs the Electron test harness.");
        await global.HDRFinisherElectronTestHarness.selectExportDirectory(directory);
        await page.locator("#batch-directory").locator("xpath=ancestor::section").getByRole("button", { name: "Choose folder…", exact: true }).click();
      } else await page.locator("#batch-directory").fill(directory);
      await page.waitForFunction(directory => document.getElementById("batch-directory")?.value === directory, directory);
    };

    const exports = [];
    for (const testCase of [
      { format: "sdr_jpeg", extension: ".jpg" },
      { format: "sdr_png", extension: ".png" },
      { format: "sdr_jpegxl", extension: ".jxl" },
      { format: "jpeg_ultrahdr", extension: ".jpg" },
    ]) {
      const filename = `edge-${testCase.format}-${runId}`;
      // A new folder makes the visible update prove the asynchronous picker finished.
      const destination = path.join(outputDirectory, `${testCase.format}-${runId}`);
      fs.mkdirSync(destination, { recursive: true });
      const expectedOutput = path.join(destination, `${filename}${testCase.extension}`);
      await page.locator("#export-format").selectOption(testCase.format);
      if (testCase.format === "sdr_jpeg") {
        if (!await page.locator("#jpeg-advanced-settings").evaluate(details => details.open)) await page.locator("#jpeg-advanced-settings > summary").click();
        await page.locator("#jpeg-chroma-subsampling").selectOption("422");
      }
      await page.locator("#batch-pattern").fill(filename);
      await chooseDirectory(destination);
      const exportResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/batch-export" && response.request().method() === "POST", { timeout: 120000 });
      await page.locator("#batch-run").click();
      const response = await exportResponsePromise;
      const accepted = await response.json();
      if (response.status() !== 200 || !accepted.id) throw new Error(`Batch export was not accepted: ${JSON.stringify(accepted)}`);
      await page.waitForFunction(id => {
        const job = batchExport.activity();
        return job?.id === id && ["finished", "failed", "cancelled"].includes(job.state);
      }, accepted.id, { timeout: 120000 });
      const payload = await page.evaluate(() => batchExport.activity());
      exports.push({
        format: testCase.format,
        status: response.status(),
        payload,
        displayedPath: await page.locator("#batch-results").textContent(),
        chromaSubsampling: testCase.format === "sdr_jpeg" ? await page.locator("#jpeg-chroma-subsampling").inputValue() : null,
        outputExists: fs.existsSync(expectedOutput),
        outputBytes: fs.existsSync(expectedOutput) ? fs.statSync(expectedOutput).size : 0,
      });
    }

    const result = {
      fileChooserMultiple: chooser ? chooser.isMultiple() : null,
      selectedDirectory: await page.locator("#batch-directory").inputValue(),
      exports,
      browserErrors,
    };
    if (exports.some((entry) => entry.status !== 200 || entry.payload.state !== "finished" || entry.payload.completed !== 1
      || entry.payload.results.length !== 1 || entry.payload.results[0].outcome !== "exported"
      || !entry.displayedPath.includes(entry.payload.results[0].output_path) || !entry.outputExists || entry.outputBytes === 0)
      || exports.find((entry) => entry.format === "sdr_jpeg")?.chromaSubsampling !== "422"
      || browserErrors.length) {
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
