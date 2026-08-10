const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const stage = document.getElementById("preview-stage");
    const primary = document.getElementById("preview-primary-pane");
    const secondary = document.getElementById("preview-secondary-pane");
    return {
      layout: stage.dataset.compareLayout,
      primaryLane: primary.dataset.lane,
      secondaryLane: secondary.dataset.lane,
      primary: box(primary),
      secondary: box(secondary),
      primaryClip: getComputedStyle(primary).clipPath,
      secondaryClip: getComputedStyle(secondary).clipPath,
      secondaryVisible: getComputedStyle(secondary).display !== "none",
      status: document.getElementById("compare-status").textContent,
      activeScope: document.getElementById("scope-kind-label").textContent,
    };
  });
}

async function main() {
  const url = argValue("--url", "http://127.0.0.1:8000");
  const inputPath = argValue("--input", path.join("tests", "fixtures", "sdr_gradient.png"));
  const screenshot = argValue("--screenshot", path.join("output", "design-qa", "comparison-layouts.png"));
  const resultPath = argValue("--result", path.join("output", "design-qa", "comparison-layout-qa.json"));
  const executablePath = edgeExecutable();
  const consoleErrors = [];
  const pageErrors = [];
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath: executablePath || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(inputPath);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", { timeout: 30000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) await page.locator("#accept-interpretation").click();
    await page.waitForFunction(() => {
      const image = document.getElementById("preview-image");
      const canvas = document.getElementById("preview-canvas");
      return getComputedStyle(image).display !== "none" || getComputedStyle(canvas).display !== "none";
    }, { timeout: 120000 });

    const metrics = {};
    for (const layout of ["split-vertical", "split-horizontal", "side-horizontal", "side-vertical"]) {
      await page.locator(`button[data-compare-layout="${layout}"]`).click();
      await page.waitForFunction(() => {
        const image = document.getElementById("comparison-image");
        const canvas = document.getElementById("comparison-canvas");
        return getComputedStyle(image).display !== "none" || getComputedStyle(canvas).display !== "none";
      }, { timeout: 120000 });
      metrics[layout] = await layoutMetrics(page);
    }

    await page.locator('[data-kind="sdr"]').click();
    await page.waitForFunction(() => document.getElementById("scope-kind-label")?.textContent === "SDR", { timeout: 120000 });
    metrics.sdrActive = await layoutMetrics(page);
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.locator('button[data-compare-layout="single"]').click();
    metrics.single = await layoutMetrics(page);
    await page.locator('button[data-compare-layout="single"]').click();
    await page.waitForFunction(() => document.getElementById("scope-kind-label")?.textContent === "HDR", { timeout: 120000 });
    metrics.singleSwitched = await layoutMetrics(page);

    const vertical = metrics["split-vertical"];
    const horizontal = metrics["split-horizontal"];
    const sideHorizontal = metrics["side-horizontal"];
    const sideVertical = metrics["side-vertical"];
    const checks = {
      verticalSplit: vertical.primaryClip !== "none" && vertical.secondaryClip !== "none",
      horizontalSplit: horizontal.primaryClip !== "none" && horizontal.secondaryClip !== "none",
      sideBySideHorizontal: Math.abs(sideHorizontal.primary.width - sideHorizontal.secondary.width) < 1
        && Math.abs(sideHorizontal.primary.x - sideHorizontal.secondary.x) >= sideHorizontal.primary.width - 1,
      sideBySideVertical: Math.abs(sideVertical.primary.height - sideVertical.secondary.height) < 1
        && Math.abs(sideVertical.primary.y - sideVertical.secondary.y) >= sideVertical.primary.height - 1,
      stableLaneOrder: [vertical, horizontal, sideHorizontal, sideVertical, metrics.sdrActive]
        .every((entry) => entry.primaryLane !== entry.secondaryLane),
      scopesFollowActiveLane: metrics.sdrActive.activeScope === "SDR"
        && metrics.sdrActive.status.includes("scopes: SDR")
        && metrics.sdrActive.primaryLane === "sdr",
      secondaryVisible: [vertical, horizontal, sideHorizontal, sideVertical, metrics.sdrActive]
        .every((entry) => entry.secondaryVisible),
      singleFrame: metrics.single.layout === "single" && !metrics.single.secondaryVisible,
      singleButtonSwitch: metrics.singleSwitched.activeScope === "HDR" && metrics.singleSwitched.primaryLane === "hdr",
      noBrowserErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    const result = { ok: Object.values(checks).every(Boolean), url, metrics, checks, consoleErrors, pageErrors, screenshot };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
