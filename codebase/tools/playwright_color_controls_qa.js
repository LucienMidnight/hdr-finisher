const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function setControl(page, pathName, value) {
  await page.locator(`[data-path="${pathName}"]`).evaluate((control, nextValue) => {
    control.value = String(nextValue);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function main() {
  const input = process.argv[2];
  const screenshot = process.argv[3] || path.join("output", "design-qa", "rgb-primaries-controls.png");
  if (!input) throw new Error("Usage: node tools/playwright_color_controls_qa.js INPUT [SCREENSHOT]");
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: edgeExecutable() });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
    const browserErrors = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto("http://127.0.0.1:8000", { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(input);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", null, { timeout: 30000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) await page.locator("#accept-interpretation").click();

    await setControl(page, "hdr.vibrance", 0.35);
    await setControl(page, "hdr.red_hue", 8);
    await setControl(page, "hdr.red_purity", 20);
    await setControl(page, "hdr.blue_purity", 30);
    await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-canvas")).display !== "none", null, { timeout: 30000 });

    await page.locator("#view-sdr").click();
    await page.waitForFunction(() => document.getElementById("view-sdr")?.classList.contains("active"), null, { timeout: 30000 });
    const linked = {
      status: await page.locator('[data-modified-count="sdr-color"]').textContent(),
      redHueDisabled: await page.locator('[data-path="sdr.red_hue"]').isDisabled(),
      saturationDisabled: await page.locator('[data-path="sdr.saturation"]').isDisabled(),
    };
    await page.locator('[data-path="sdr.match_hdr_color"]').uncheck();
    await setControl(page, "sdr.red_hue", -4);
    const manual = {
      redHueDisabled: await page.locator('[data-path="sdr.red_hue"]').isDisabled(),
      redHue: await page.locator('[data-path="sdr.red_hue"]').inputValue(),
    };
    await page.locator('[data-path="sdr.match_hdr_color"]').check();
    const relinked = {
      redHueDisabled: await page.locator('[data-path="sdr.red_hue"]').isDisabled(),
      retainedManualRedHue: await page.locator('[data-path="sdr.red_hue"]').inputValue(),
    };
    const exportRequests = [];
    let overwriteDialog = "";
    await page.route("**/api/session/*/export", async (route) => {
      const body = route.request().postDataJSON();
      exportRequests.push(body);
      if (!body.overwrite) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: { code: "overwrite_required", message: "A file named overwrite-qa.jpg already exists. Replace it?", output_path: body.output_path } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true, message: "QA export accepted", output_path: body.output_path }),
      });
    });
    page.once("dialog", async (dialog) => {
      overwriteDialog = dialog.message();
      await dialog.accept();
    });
    await page.locator("#export-button").click();
    const defaultExportDirectory = await page.locator("#export-directory").inputValue();
    await page.locator("#export-filename").fill("overwrite-qa");
    await page.locator("#export-confirm-button").click();
    await page.waitForFunction(() => document.getElementById("export-status")?.textContent === "QA export accepted", null, { timeout: 10000 });
    await page.locator("#export-close").click();
    await page.locator("#view-hdr").click();

    const group = page.locator('[data-group="hdr-color"]');
    await group.scrollIntoViewIfNeeded();
    await group.screenshot({ path: screenshot });
    const metrics = await group.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      labels: [...element.querySelectorAll("label")].map((label) => label.textContent.trim()),
      modified: element.querySelector('[data-modified-count="hdr-color"]')?.textContent,
      redTrack: getComputedStyle(element.querySelector(".primary-red-hue .slider-track")).backgroundImage,
    }));

    const bypass = group.locator(".section-bypass");
    await bypass.click();
    const retained = await page.locator('[data-path="hdr.red_hue"]').inputValue();
    const bypassed = await bypass.getAttribute("aria-pressed");
    await group.locator(".group-reset").click();
    const reset = {
      redHue: await page.locator('[data-path="hdr.red_hue"]').inputValue(),
      vibrance: await page.locator('[data-path="hdr.vibrance"]').inputValue(),
      enabled: await bypass.getAttribute("aria-pressed"),
    };

    const unexpectedBrowserErrors = browserErrors.filter((message) => !/status of 409 \(Conflict\)/.test(message));

    const result = {
      ok: unexpectedBrowserErrors.length === 0
        && metrics.scrollWidth <= metrics.clientWidth + 1
        && metrics.labels.includes("Saturation")
        && metrics.labels.some((label) => label.startsWith("Vibrance"))
        && metrics.labels.includes("Red Hue")
        && metrics.labels.includes("Tint Purity")
        && metrics.modified === "4 modified"
        && metrics.redTrack !== "none"
        && retained === "8"
        && bypassed === "false"
        && reset.redHue === "0"
        && reset.vibrance === "0"
        && reset.enabled === "true"
        && /Following HDR/.test(linked.status || "")
        && linked.redHueDisabled === true
        && linked.saturationDisabled === true
        && manual.redHueDisabled === false
        && manual.redHue === "-4"
        && relinked.redHueDisabled === true
        && relinked.retainedManualRedHue === "-4"
        && defaultExportDirectory.length > 0
        && exportRequests.length === 2
        && exportRequests[0].overwrite === false
        && exportRequests[1].overwrite === true
        && /cannot be undone/i.test(overwriteDialog),
      metrics,
      retained,
      bypassed,
      reset,
      linked,
      manual,
      relinked,
      defaultExportDirectory,
      exportRequests: exportRequests.map(({ overwrite, output_path }) => ({ overwrite, output_path })),
      overwriteDialog,
      browserErrors,
      unexpectedBrowserErrors,
      screenshot,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
