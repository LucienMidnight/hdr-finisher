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
    await page.locator("#grade-mode-retouch").click();
    assert.equal(await page.locator("#retouch-method").inputValue(), "original-detail");
    assert.equal(await page.locator("#retouch-feather").inputValue(), "71");
    assert.equal(await page.locator("#retouch-texture").inputValue(), "100");
    assert.equal(await page.locator("#retouch-hardness").inputValue(), "10");
    // Cursor changes size without another pointermove.
    await page.locator("#retouch-brush").click();
    const cursorPoint = await page.evaluate(() => { const r=activePreviewElement().getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}; });
    await page.mouse.move(cursorPoint.x,cursorPoint.y);
    const cursorWidth = () => page.evaluate(() => {
      const c=els.localMaskOverlay,ctx=c.getContext("2d"),p=ctx.getImageData(0,0,c.width,c.height).data;
      let lo=c.width,hi=-1;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(p[(y*c.width+x)*4+3]){lo=Math.min(lo,x);hi=Math.max(hi,x);}
      return hi-lo;
    });
    await page.locator("#retouch-size").fill("20");
    await page.waitForTimeout(80);
    const smallCursor = await cursorWidth();
    await page.locator("#retouch-size").fill("100");
    await page.waitForTimeout(80);
    assert(await cursorWidth()>smallCursor*3,"brush cursor did not resize on input");
    // A brush larger than the old cap must remain usable.
    await page.locator("#retouch-size").fill("100");
    await page.locator("#retouch-brush").click();
    assert.equal(await page.locator("#retouch-size").inputValue(), "100", "larger brush size was not retained");
    await page.screenshot({ path: path.join(output, "before.png") });
    const beforePixel = await centerPixel(page);
    const rect = await page.evaluate(() => { const r = activePreviewElement().getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; });
    const initialRevision = await page.evaluate(() => state.editRevision);
    // Clicking the photo directly from the input must also work, before blur/change.
    await page.locator("#retouch-size").fill("100");
    await page.mouse.click(rect.x, rect.y);
    await page.waitForFunction(() => state.editDocument?.repairs?.length === 1 && !retouchUI.busy, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => state.editRevision), initialRevision+1, "one gesture must be one history edit");
    assert.equal(await page.evaluate(() => state.editDocument.repairs[0].recipe.radius_px), 50, "larger brush size did not reach the repair engine");
    const paintedRecipe = await page.evaluate(() => state.editDocument.repairs[0].recipe);
    assert.equal(paintedRecipe.method, "original-detail");
    assert.equal(paintedRecipe.edge_feather, .71);
    assert.equal(paintedRecipe.texture_amount, 1);
    const original = await page.evaluate(() => JSON.stringify(state.editDocument.repairs));
    await page.waitForFunction(() => state.gpuPreview?.lastPresentedFrame, null, { timeout: 60000 });
    await page.evaluate(() => { retouchUI.active=false; renderLocalMaskOverlay(); });
    const afterPixel = await centerPixel(page);
    assert(afterPixel[0] > beforePixel[0], `GPU preview kept the dark dust: ${beforePixel} -> ${afterPixel}`);
    await page.screenshot({ path: path.join(output, "after.png") });
    // Bounded cache refresh must show the same pixels as loading the source afresh.
    await page.evaluate(async () => {
      state.gpuPreview.resetSession(state.session.session_id);
      await renderGpuDraft(state.currentView, {longEdge:settledProxyLongEdge(),tier:"settled"});
    });
    assert.deepEqual(await centerPixel(page), afterPixel, "bounded source refresh differs from a full reload");
    await page.evaluate(() => { retouchUI.active=true; renderLocalMaskOverlay(); });
    assert.equal(await page.evaluate(() => state.editDocument.local_adjustments.length), 0, "repair must not create a grade mask");
    assert.equal(await page.evaluate(() => state.repairSourceGeneration), 1);
    assert.equal(await page.evaluate(() => queueEditCommand("undo")), true);
    assert.equal(await page.evaluate(() => state.editDocument.repairs.length), 0);
    assert.equal(await page.evaluate(() => queueEditCommand("redo")), true);
    assert.equal(await page.evaluate(() => JSON.stringify(state.editDocument.repairs)), original);
    await page.getByRole("button", { name: "Retry Spot 1", exact: true }).click();
    await page.waitForFunction(() => !retouchUI.busy);
    assert.equal(await page.evaluate(() => state.editDocument.repairs[0].recipe.settings.seed), 20261022);
    await page.getByRole("button", { name: "Hide Spot 1", exact: true }).click();
    await page.waitForFunction(() => !retouchUI.busy && !state.editDocument.repairs[0].enabled);
    await page.getByRole("button", { name: "Show Spot 1", exact: true }).click();
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs[0].enabled);
    await page.locator("#retouch-list button").last().click();
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs.length === 0);
    // A dragged stroke must survive all samples and publish once on release.
    await page.locator("#retouch-size").fill("14");
    const strokeRevision = await page.evaluate(() => state.editRevision);
    await page.mouse.move(rect.x-12, rect.y);
    await page.mouse.down();
    await page.mouse.move(rect.x+12, rect.y, {steps:12});
    assert(await page.evaluate(() => retouchUI.points?.length > 2), "drag did not collect brush points");
    await page.mouse.up();
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs.length === 1);
    assert.equal(await page.evaluate(() => state.editRevision), strokeRevision+1);
    assert(await page.evaluate(() => state.editDocument.repairs[0].recipe.points.length > 2), "painted stroke was lost");
    await page.waitForFunction(() => state.gpuPreview?.lastPresentedFrame);
    await page.evaluate(() => {retouchUI.active=false;renderLocalMaskOverlay();});
    assert((await centerPixel(page))[0] > beforePixel[0], "painted stroke did not repair preview pixels");
    await page.evaluate(() => {retouchUI.active=true;renderLocalMaskOverlay();});
    await page.locator("#retouch-list button").last().click();
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs.length === 0);
    // Search/seed/solver controls are automatic, while a larger brush is usable.
    assert.equal(await page.locator("#retouch-search, #retouch-seed, #retouch-patch, #retouch-iterations").count(), 0);
    await page.locator("#retouch-size").fill("256");
    await page.mouse.click(rect.x, rect.y);
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs.length === 1, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => state.editDocument.repairs[0].recipe.radius_px), 128);
    await page.getByRole("button", { name: "Remove Spot 1", exact: true }).click();
    await page.waitForFunction(() => !retouchUI.busy && state.editDocument.repairs.length === 0);
    // Compare all prototypes on one repair; Apply preserves the seed and ROI.
    await page.locator("#retouch-size").fill("100");
    await page.mouse.click(rect.x,rect.y);
    await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs.length===1);
    // Selecting a saved repair restores its settings, independent of new choices.
    await page.locator("#retouch-method").selectOption("edge-feather");
    await page.locator("#retouch-feather").fill("20");
    await page.locator("#retouch-list .local-adjustment-select").first().click();
    assert.equal(await page.locator("#retouch-method").inputValue(),"original-detail");
    assert.equal(await page.locator("#retouch-feather").inputValue(),"71");
    assert.equal(await page.locator("#retouch-texture").inputValue(),"100");
    const comparisonSeed=await page.evaluate(()=>state.editDocument.repairs[0].recipe.settings.seed);
    const comparisonROI=await page.evaluate(()=>state.editDocument.repairs[0].recipe.search_rect);
    for(const method of ["edge-feather","original-detail","donor-detail"]){
      await page.locator("#retouch-method").selectOption(method);
      assert(await page.locator("#retouch-feather").isVisible());
      assert(!(await page.locator("#retouch-hardness").isVisible()));
      await page.locator("#retouch-feather").fill("40");
      if(method!=="edge-feather")await page.locator("#retouch-texture").fill("65");
      await page.locator("#retouch-apply").click();
      await page.waitForFunction(m=>!retouchUI.busy&&state.editDocument.repairs[0].recipe.method===m,method);
      const recipe=await page.evaluate(()=>state.editDocument.repairs[0].recipe);
      assert.equal(recipe.settings.seed,comparisonSeed,"Apply changed the donor seed");
      assert.deepEqual(recipe.search_rect,comparisonROI,"Apply changed search region");
      assert.equal(recipe.edge_feather,.4);
      if(method!=="edge-feather")assert.equal(recipe.texture_amount,.65);
      await page.waitForFunction(()=>state.gpuPreview.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView]);
      await page.evaluate(()=>{retouchUI.active=false;renderLocalMaskOverlay();});
      const shown=await centerPixel(page);
      await page.evaluate(async()=>{state.gpuPreview.resetSession(state.session.session_id);await renderGpuDraft(state.currentView,{longEdge:settledProxyLongEdge(),tier:"settled"});});
      assert.deepEqual(await centerPixel(page),shown,`${method} bounded refresh differs from full reload`);
      await page.screenshot({path:path.join(output,`${method}.png`)});
      await page.evaluate(()=>{retouchUI.active=true;renderLocalMaskOverlay();});
    }
    await page.evaluate(()=>queueEditCommand("undo"));
    assert.equal(await page.evaluate(()=>state.editDocument.repairs[0].recipe.method),"original-detail");
    await page.evaluate(()=>queueEditCommand("redo"));
    assert.equal(await page.evaluate(()=>state.editDocument.repairs[0].recipe.method),"donor-detail");
    await page.getByRole("button",{name:"Remove Spot 1",exact:true}).click();
    await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs.length===0);
    await page.locator("#retouch-method").selectOption("standard");
    assert(await page.locator("#retouch-hardness").isVisible());
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
    console.log("PASS: Inpaint click and painted stroke, bounded source/full reload agreement, undo/redo, retry, enable/remove and cancellation; synthetic screenshots saved.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
