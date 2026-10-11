/* Slice 3 Stage A: one real window, disposable originals and app profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-grade-reverts");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
const photos = ["first.png", "next.png"].map(name => path.join(folder, name));
for (const photo of photos) fs.copyFileSync(path.join(root, "tests", "fixtures", "sdr_gradient.png"), photo);
const original = fs.readFileSync(photos[0]);
const read = photo => JSON.parse(fs.readFileSync(photo + ".hdrf", "utf8"));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    const open = photo => page.evaluate(async photo => {
      await openDesktopSelection({ kind: "source", ...await desktop.grantSourcePath(photo) });
    }, photo);
    const edit = exposure => page.evaluate(async exposure => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = exposure;
      adjustments.sdr.exposure = -.25;
      adjustments.shared.geometry.crop = { x: .1, y: .1, width: .8, height: .8 };
      await queueEditCommand("set_global_adjustments", { adjustments });
    }, exposure);
    await open(photos[0]);
    await page.waitForFunction(() => window.HDRGradeSaving.active());
    await page.locator("#grade-autosave").click();
    await edit(.75);
    await page.evaluate(() => HDRGradeSaving.save());
    await page.waitForFunction(photo => fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})}).then(r=>r.json()).then(r=>r.photos[0]?.storage==='sidecar'),photos[0]);
    await edit(2);
    const revert = async label => {
      await page.locator('#grade-revert-menu').click();
      await page.locator('#app-dialog[open]').waitFor();
      await page.locator('#app-dialog-actions button').filter({hasText:new RegExp('^'+label+'$')}).click();
      await page.locator('#app-dialog[open]').waitFor({state:'hidden'});
      const value={'Revert to original':0,'Restore previous grade':2,'Revert to last session':0}[label];
      await page.waitForFunction(value=>state.adjustments.hdr.exposure===value,value);
    };
    await revert('Revert to original');
    assert.equal(await page.evaluate(()=>state.adjustments.hdr.exposure),0);
    assert.equal(await page.evaluate(()=>state.documentDirty),true);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,.75);
    await revert('Restore previous grade');
    assert.equal(await page.evaluate(()=>state.adjustments.hdr.exposure),2);
    await page.locator('#grade-revert-saved').click();
    await page.waitForFunction(()=>state.adjustments.hdr.exposure===.75 && !state.documentDirty);
    await revert('Revert to last session');
    assert.equal(await page.evaluate(()=>state.adjustments.hdr.exposure),0);
    await page.evaluate(()=>HDRGradeSaving.save());
    await open(photos[1]);
    await page.evaluate(()=>activateWorkflowTab('import'));
    const frame=page.frameLocator('#library-frame');
    await page.locator('#library-frame').evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
    await frame.locator('.library-cell').first().waitFor();
    await page.evaluate(photo=>fetch('/api/library/marks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo],change:{rating:4,add_tag:'Keep'}})}),photos[0]);
    await frame.locator('.library-cell').first().click({button:'right'});
    await frame.locator('button').filter({hasText:/^Restore previous grade$/}).click();
    await frame.locator('dialog[open]').waitFor();
    assert.match(await frame.locator('dialog[open]').innerText(),/1 photos.*previous grade/s);
    await frame.locator('dialog[open] button').filter({hasText:/^Revert$/}).click();
    await page.waitForFunction(photo=>fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})}).then(r=>r.json()).then(r=>r.photos[0]?.storage==='sidecar'),photos[0]);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,.75);
    assert.equal(read(photos[0]).marks.rating,4);
    await frame.locator('#library-grid').press('Control+z');
    await page.waitForTimeout(1000);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,0);
    assert.equal(read(photos[0]).marks.rating,4);
    assert.deepEqual(fs.readFileSync(photos[0]),original);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({checks:'four Grade reverts, unsaved open result, saved file unchanged, counted Library confirmation, one Undo, marks kept'}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
