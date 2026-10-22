const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
async function centerPixel(page) {
  const png = await page.locator("#preview-canvas").screenshot();
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width=image.width; canvas.height=image.height;
    const context=canvas.getContext("2d"); context.drawImage(image, 0, 0);
    return [...context.getImageData(Math.floor(image.width/2), Math.floor(image.height/2), 1, 1).data];
  }, png.toString("base64"));
}
(async () => {
  const output = path.resolve("output/retouch-interaction");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const data = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 384;
      const ctx = canvas.getContext("2d"), gradient = ctx.createLinearGradient(0, 0, 512, 384);
      gradient.addColorStop(0, "#aac6df"); gradient.addColorStop(1, "#729ac1");
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 384);
      ctx.fillStyle = "#556b80"; ctx.beginPath(); ctx.arc(256, 192, 4, 0, Math.PI*2); ctx.fill();
      return canvas.toDataURL().split(",")[1];
    });
    await page.locator("#file-input").setInputFiles({ name: "synthetic-dust.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") });
    await page.waitForFunction(() => state.session && !state.importInProgress && document.body.dataset.workflow === "grade", null, { timeout: 120000 });
    await page.waitForFunction(() => state.gpuPreview?.available && state.gpuPreview?.lastPresentedFrame, null, { timeout: 60000 });
    await page.locator("#grade-mode-local").click();
    await page.locator("#retouch-size").fill("14");
    await page.locator("#retouch-iterations").fill("2");
    await page.locator("#retouch-brush").click();
    await page.screenshot({ path: path.join(output, "before.png") });
    const beforePixel = await centerPixel(page);
    const rect = await page.evaluate(() => { const r = activePreviewElement().getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; });
    const initialRevision = await page.evaluate(() => state.editRevision);
    await page.mouse.click(rect.x, rect.y);
    await page.waitForFunction(() => state.editDocument?.repairs?.length === 1 && !retouchUI.busy, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => state.editRevision), initialRevision+1, "one gesture must be one history edit");
    const original = await page.evaluate(() => JSON.stringify(state.editDocument.repairs));
    await page.waitForFunction(() => state.gpuPreview?.lastPresentedFrame, null, { timeout: 60000 });
    await page.evaluate(() => { retouchUI.active=false; renderLocalMaskOverlay(); });
    const afterPixel = await centerPixel(page);
    assert(afterPixel[0] > beforePixel[0], `GPU preview kept the dark dust: ${beforePixel} -> ${afterPixel}`);
    await page.screenshot({ path: path.join(output, "after.png") });
    await page.evaluate(() => { retouchUI.active=true; renderLocalMaskOverlay(); });
    assert.equal(await page.evaluate(() => state.editDocument.local_adjustments.length), 0, "repair must not create a grade mask");
    assert.equal(await page.evaluate(() => state.repairSourceGeneration), 1);
    assert.equal(await page.evaluate(() => queueEditCommand("undo")), true);
    assert.equal(await page.evaluate(() => state.editDocument.repairs.length), 0);
    assert.equal(await page.evaluate(() => queueEditCommand("redo")), true);
    assert.equal(await page.evaluate(() => JSON.stringify(state.editDocument.repairs)), original);
    await page.locator("#retouch-retry").click();
    await page.waitForFunction(() => !retouchUI.busy);
    assert.equal(await page.evaluate(() => state.editDocument.repairs[0].recipe.settings.seed), 20261022);
    await page.locator('#retouch-list input[type="checkbox"]').uncheck();
    await page.waitForFunction(() => !retouchUI.busy && !state.editDocument.repairs[0].enabled);
    await page.locator('#retouch-list input[type="checkbox"]').check();
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs[0].enabled);
    await page.locator("#retouch-list button").last().click();
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs.length === 0);
    // Delay the edit in transport until Cancel has reached the backend first.
    let release, entered;
    const hold = new Promise(resolve => { release=resolve; });
    const intercepted = new Promise(resolve => { entered=resolve; });
    await page.route("**/edit-commands", async route => { entered(); await hold; await route.continue(); });
    await page.mouse.click(rect.x, rect.y);
    await intercepted;
    const cancelled = page.waitForResponse(response => response.url().endsWith("/retouch/cancel"));
    await page.locator("#retouch-cancel").click();
    assert((await cancelled).ok()); release();
    await page.waitForFunction(() => !retouchUI.busy);
    assert.equal(await page.evaluate(() => state.editDocument.repairs.length), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: actual Inpaint gesture, source refresh, undo/redo, retry, enable/remove; synthetic screenshots saved.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
