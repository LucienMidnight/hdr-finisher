const crypto = require("crypto");
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

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function setControl(page, pathName, value) {
  await page.locator(`[data-path="${pathName}"]`).evaluate((control, nextValue) => {
    control.value = String(nextValue);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function captureDraftAndSettled(page, pathName, value) {
  await setControl(page, pathName, value);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-canvas")).display !== "none", null, { timeout: 30000 });
  const draft = await page.locator("#preview-canvas").screenshot();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("preview-image")).display !== "none", null, { timeout: 120000 });
  const settled = await page.locator("#preview-image").screenshot();
  return { draft: digest(draft), settled: digest(settled) };
}

async function main() {
  const input = process.argv[2];
  const url = process.argv[3] || "http://127.0.0.1:8000";
  if (!input) throw new Error("Usage: node tools/playwright_sdr_base_controls.js INPUT [URL]");

  const browser = await chromium.launch({ headless: true, executablePath: edgeExecutable() });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const browserErrors = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(input);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", null, { timeout: 30000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) await page.locator("#accept-interpretation").click();
    await page.locator("#view-sdr").click();
    await page.waitForFunction(() => document.body.dataset.activeLane === "sdr");
    await page.locator("#preview-image").waitFor({ state: "visible", timeout: 120000 });

    const baseline = await captureDraftAndSettled(page, "sdr.tone_contrast", 1);
    const cases = {
      toneContrast: await captureDraftAndSettled(page, "sdr.tone_contrast", 1.4),
      contrastSkew: await captureDraftAndSettled(page, "sdr.tone_skew", -0.8),
      toneMapper: await captureDraftAndSettled(page, "sdr.tone_mapper", "aces"),
    };
    const results = Object.fromEntries(Object.entries(cases).map(([name, hashes]) => [name, {
      draftChanged: hashes.draft !== baseline.draft,
      settledChanged: hashes.settled !== baseline.settled,
    }]));
    if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
    for (const [name, result] of Object.entries(results)) {
      if (!result.draftChanged || !result.settledChanged) {
        throw new Error(`${name} did not change both render paths: ${JSON.stringify(result)}`);
      }
    }
    console.log(JSON.stringify({ navigatorGpu: await page.evaluate(() => Boolean(navigator.gpu)), results }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
