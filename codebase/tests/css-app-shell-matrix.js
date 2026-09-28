const { chromium } = require("playwright");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const phase = process.env.CSS_MATRIX_PHASE || "capture";
const outputDirectory = path.resolve(__dirname, "../output/css-app-shell-matrix", phase);

const cases = [
  { name: "normal-1440", viewport: { width: 1440, height: 1000 } },
  { name: "wide-2200", viewport: { width: 2200, height: 1200 } },
  { name: "compact-1100", viewport: { width: 1100, height: 800 }, compact: true },
  { name: "desktop-1440", viewport: { width: 1440, height: 1000 }, desktop: true },
  { name: "native-menu-1440", viewport: { width: 1440, height: 1000 }, desktop: true, nativeMenu: true },
];

(async () => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const results = [];
  try {
    for (const item of cases) {
      const page = await browser.newPage({ viewport: item.viewport });
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.evaluate(({ compact, desktop, nativeMenu }) => {
        document.querySelector(".app-shell")?.classList.toggle("compact-workspace", Boolean(compact));
        document.documentElement.classList.toggle("desktop-shell", Boolean(desktop));
        document.documentElement.classList.toggle("native-application-menu", Boolean(nativeMenu));
        if (desktop && !nativeMenu) document.documentElement.style.setProperty("--window-chrome-h", "46px");
      }, item);
      const computed = await page.evaluate(() => {
        const shell = document.querySelector(".app-shell");
        const style = getComputedStyle(shell);
        const rect = shell.getBoundingClientRect();
        return {
          display: style.display,
          gridTemplateColumns: style.gridTemplateColumns,
          gridTemplateRows: style.gridTemplateRows,
          columnGap: style.columnGap,
          rowGap: style.rowGap,
          backgroundColor: style.backgroundColor,
          width: style.width,
          height: style.height,
          minWidth: style.minWidth,
          minHeight: style.minHeight,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      });
      const screenshot = await page.screenshot({ fullPage: false });
      const screenshotPath = path.join(outputDirectory, `${item.name}.png`);
      fs.writeFileSync(screenshotPath, screenshot);
      results.push({
        name: item.name,
        computed,
        screenshotSha256: crypto.createHash("sha256").update(screenshot).digest("hex"),
        pageErrors,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (results.some(({ pageErrors }) => pageErrors.length)) {
    throw new Error(`Browser errors: ${JSON.stringify(results)}`);
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
