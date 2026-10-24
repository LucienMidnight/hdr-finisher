const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const output = path.resolve(__dirname, "../output/panel-alignment");
  fs.mkdirSync(output, { recursive: true });
  const near = (a, b, label) => assert(Math.abs(a - b) <= 1, `${label}: ${a} vs ${b}`);
  const box = async (scope, selector) => scope.locator(selector).boundingBox();
  const drag = async (scope, selector, delta) => {
    // Frame bounding boxes are expressed in main-page coordinates.
    const rect = await box(scope, selector);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + 90);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + delta, rect.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  try {
    await page.goto(process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765", { waitUntil: "networkidle" });
    const frame = page.frameLocator("#library-frame");
    await frame.locator(".library-toolbar").waitFor();
    const toolbar = await box(frame, ".library-toolbar");
    for (const selector of [".library-nav .library-heading", ".library-details .library-heading"]) {
      const header = await frame.locator(selector).first().boundingBox();
      near(header.y, toolbar.y, `Library top ${selector}`);
      near(header.y + header.height, toolbar.y + toolbar.height, `Library bottom ${selector}`);
    }
    for (const [side, rail, delta] of [["left", ".library-nav", 35], ["right", ".library-details", -35]]) {
      const before = await box(frame, rail);
      await drag(frame, `#library-${side}-splitter`, delta);
      near((await box(frame, rail)).width, before.width + 35, `Library ${side} drag`);
      await frame.locator(`#collapse-${side}`).click();
      await frame.locator(`#collapse-${side}`).click();
      near((await box(frame, rail)).width, before.width + 35, `Library ${side} reopen`);
      await frame.locator(`#library-${side}-splitter`).press("Home");
      near((await box(frame, rail)).width, 200, `Library ${side} keyboard`);
    }
    await frame.locator("#place-title").click();
    await page.mouse.move(1000, 600);
    await page.screenshot({ path: path.join(output, "library.png") });
    for (const stage of ["grade", "proof", "export"]) {
      await page.locator(`[data-workflow-tab="${stage}"]`).click();
      await page.waitForTimeout(200);
      const viewer = await box(page, ".viewer-bar");
      const left = stage === "export" ? ".batch-preset-rail" : ".source-rail";
      const right = stage === "grade" ? ".grade-rail" : stage === "proof" ? "#proof-workflow-panel" : "#export-sheet";
      const title = stage === "grade" ? ".control-title-row" : stage === "proof" ? "#proof-workflow-panel .workflow-rail-header" : "#export-sheet .sheet-header";
      near((await box(page, left)).y, viewer.y, `${stage} left top`);
      near((await box(page, right)).y, viewer.y, `${stage} right top`);
      const header = await box(page, title);
      near(header.y + header.height, viewer.y + viewer.height, `${stage} header bottom`);
      for (const [splitter, rail, delta] of [["#source-splitter", left, 24], ["#grade-splitter", right, -24]]) {
        const before = await box(page, rail);
        await drag(page, splitter, delta);
        near((await box(page, rail)).width, before.width + 24, `${stage} ${rail} drag`);
        await page.locator(splitter).dblclick();
      }
      await page.screenshot({ path: path.join(output, `${stage}.png`) });
      if (stage === "proof") await page.locator("#source-rail-expand").click();
    }
    console.log("PASS: aligned panel tops and header borders; left/right drag resizing on all four pages; Library keyboard sizing and collapse restoration.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
