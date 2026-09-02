// One-off generator for the theme preview thumbnails shown in Settings > Appearance.
// Usage: node tools/generate-theme-previews.js [baseUrl]
const { chromium } = require("playwright");
const path = require("path");

const STORAGE_KEY = "hdr-finisher:application-preferences:v1";
const THEMES = ["default-dark", "default-light", "studio-gray"];
const outputDir = path.join(__dirname, "..", "frontend", "assets", "theme-previews");

async function main() {
  const baseUrl = process.argv[2] || "http://localhost:8000";
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  for (const theme of THEMES) {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(
      ({ storageKey, themeId }) => {
        const preferences = JSON.parse(localStorage.getItem(storageKey) || "{}");
        preferences.theme = themeId;
        localStorage.setItem(storageKey, JSON.stringify(preferences));
      },
      { storageKey: STORAGE_KEY, themeId: theme }
    );
    await page.reload({ waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator(".group-toggle", { hasText: "Tone" }).first().click();
    await page.waitForTimeout(400);

    const outputPath = path.join(outputDir, `${theme}.png`);
    await page.screenshot({ path: outputPath });
    console.log(`Saved ${outputPath}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
