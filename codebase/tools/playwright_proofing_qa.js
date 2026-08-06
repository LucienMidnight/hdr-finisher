const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSER_PATH,
    process.env.PLAYWRIGHT_CHROME_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  const url = process.argv[2] || "http://127.0.0.1:8765";
  const input = process.argv[3] || path.join(__dirname, "..", "tests", "fixtures", "hdr_headroom.tiff");
  const output = process.argv[4] || path.join(__dirname, "..", "output", "proofing-qa");
  fs.mkdirSync(output, { recursive: true });
  const consoleErrors = [];
  const pageErrors = [];
  const executablePath = browserExecutable();
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1050 }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator("#file-input").setInputFiles(input);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", { timeout: 30000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) await page.locator("#accept-interpretation").click();
    await page.locator('[data-proof-mode="matrix"]').click();
    await page.locator(".matrix-tile").first().waitFor({ state: "visible", timeout: 120000 });
    await page.evaluate(() => refreshScopes(256));
    if (await page.locator(".matrix-tile").count() < 5) {
      throw new Error("A background scope refresh cleared the delivery proof.");
    }
    await page.screenshot({ path: path.join(output, "matrix.png"), fullPage: true });
    const matrix = await page.evaluate(() => ({
      mode: document.body.dataset.proofMode,
      tiles: document.querySelectorAll(".matrix-tile").length,
      warnings: document.querySelectorAll(".matrix-tile.above-headroom").length,
      telemetry: document.getElementById("display-telemetry")?.textContent,
      status: document.getElementById("matrix-status")?.textContent,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    await page.locator('[data-proof-mode="live"]').click();
    await page.locator("#live-proof-image").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#live-proof-image").evaluate((image) => image.decode());
    await page.screenshot({ path: path.join(output, "live.png"), fullPage: true });
    const live = await page.evaluate(() => ({
      mode: document.body.dataset.proofMode,
      userAgent: navigator.userAgent,
      liveNaturalWidth: document.getElementById("live-proof-image")?.naturalWidth,
      matrixNaturalWidth: document.getElementById("live-matrix-image")?.naturalWidth,
      compatibility: document.getElementById("live-compatibility")?.textContent,
      dynamicRangeLimitSupported: CSS.supports("dynamic-range-limit", "no-limit"),
    }));
    for (const variant of ["css-scale", "transform", "opacity", "transition"]) {
      await page.locator("#live-presentation").selectOption(variant);
      const applied = await page.locator("#live-proof-frame").getAttribute("data-presentation");
      if (applied !== variant) throw new Error(`Presentation variant did not apply: ${variant}`);
    }
    await page.locator("#test-pattern-button").click();
    await page.waitForFunction(
      () => document.getElementById("session-name")?.textContent === "hdr_delivery_proof_pattern.tiff",
      { timeout: 30000 },
    );
    const testPatternLoaded = await page.locator("#session-name").textContent();
    const result = { matrix, live, testPatternLoaded, consoleErrors, pageErrors };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
    if (consoleErrors.length || pageErrors.length || matrix.tiles < 5 || live.liveNaturalWidth < 1 || !testPatternLoaded) {
      throw new Error(JSON.stringify(result));
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
