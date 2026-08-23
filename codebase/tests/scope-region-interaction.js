const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitForScope(page) {
  await page.waitForFunction(() => ["Settled", "Refined"].includes(document.querySelector("#scope-freshness")?.textContent), null, { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const outputDirectory = path.resolve(__dirname, "../output/scope-region");
  fs.mkdirSync(outputDirectory, { recursive: true });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await waitForScope(page);

    assert(await page.locator(".dock-tabs").count() === 0, "Redundant scope tabs are still present.");
    assert(await page.locator("#scope-mode option[value=technical]").count() === 1, "Technical is not available in the primary selector.");
    const header = await page.locator(".dock-bar").boundingBox();
    const collapse = await page.locator("#dock-collapse").boundingBox();
    assert(header && collapse && collapse.x + collapse.width > header.x + header.width - 20, "Collapse is not anchored at the far right of the scope header.");

    await page.locator("#scope-mode").selectOption("waveform");
    await waitForScope(page);
    await page.locator("#scope-region-toggle").click();
    const overlay = page.locator("#scope-region-overlay");
    await overlay.waitFor({ state: "visible" });
    const overlayBox = await overlay.boundingBox();
    assert(overlayBox && overlayBox.width > 100 && overlayBox.height > 100, "Scope Region overlay did not align to the visible preview.");

    await page.mouse.move(overlayBox.x + overlayBox.width * 0.25, overlayBox.y + overlayBox.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + overlayBox.width * 0.65, overlayBox.y + overlayBox.height * 0.72, { steps: 8 });
    await page.mouse.up();
    await waitForScope(page);
    let region = await page.evaluate(() => activeScopeRegion());
    assert(region && Math.abs(region.x - 0.25) < 0.03 && Math.abs(region.width - 0.4) < 0.03, "Drawn Scope Region was not normalized to the preview frame.");
    assert((await page.locator("#scope-region-badge").textContent()).includes("Region · 21%"), "Region coverage is not shown with the scope readings.");

    const beforeMove = { ...region };
    const box = await page.locator("#scope-region-box").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + overlayBox.width * 0.08, box.y + box.height / 2 + overlayBox.height * 0.06, { steps: 5 });
    await page.mouse.up();
    await waitForScope(page);
    region = await page.evaluate(() => activeScopeRegion());
    assert(region.x > beforeMove.x + 0.05 && region.y > beforeMove.y + 0.03, "Dragging inside the Scope Region did not move the whole box.");
    await page.locator(".viewer-panel").screenshot({ path: path.join(outputDirectory, "scope-region-viewer.png") });

    await page.keyboard.press("Shift+R");
    assert(await page.locator("#scope-region-toggle").getAttribute("aria-pressed") === "false", "Shift+R did not disable Scope Region.");
    assert(await overlay.isHidden(), "Disabled Scope Region overlay remains visible.");
    assert(await page.evaluate(() => Boolean(state.scopeRegion)), "Disabling Scope Region discarded the saved box.");
    await page.keyboard.press("Shift+R");
    await overlay.waitFor({ state: "visible" });
    await page.locator("#scope-region-box").focus();
    await page.keyboard.press("Delete");
    await waitForScope(page);
    assert(await page.evaluate(() => activeScopeRegion() === null), "Delete did not restore full-frame scope analysis.");
    assert(await page.locator("#scope-region-badge").isHidden(), "Region badge remained after clearing the box.");

    await page.locator("#scope-mode").selectOption("technical");
    assert(await page.locator("#technical-view").isVisible(), "Technical view did not open from the primary selector.");
    assert(await page.locator("#scope-channel-mode").isDisabled(), "Scope-only controls remained enabled in Technical view.");
    await page.locator("#scope-mode").selectOption("histogram");
    await waitForScope(page);
    assert(await page.locator("#scope-view").isVisible(), "Scope view did not return from Technical.");

    await page.locator("#analysis-dock").screenshot({ path: path.join(outputDirectory, "scope-header-and-region-status.png") });
    assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
    console.log(JSON.stringify({ ok: true, regionShortcut: "Shift+R", browserErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
