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
    page.setDefaultTimeout(30000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    const written = async photo => {
      const deadline=Date.now()+30000;
      while(Date.now()<deadline) {
        const saved=await page.evaluate(photo=>fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})}).then(r=>r.json()),photo);
        if(saved.photos[0]?.storage==='sidecar') return;
        await page.waitForTimeout(100);
      }
      throw new Error('Settings writer did not finish within 30 seconds.');
    };
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
      console.log("Grade revert",label);
      await page.locator('#grade-revert-menu').click();
      await page.locator('.grade-revert-popover:not([hidden])').waitFor();
      const response = page.waitForResponse(r => r.url().endsWith('/api/library/grade-reverts') && JSON.parse(r.request().postData()).target !== null);
      await page.locator('.grade-revert-popover button').filter({hasText:new RegExp('^'+label+'$')}).click();
      assert.equal((await response).status(),200);
      await page.locator('.grade-revert-popover').waitFor({state:'hidden'});
      const value={'Revert to original':0,'Restore previous grade':2,'Revert to last session':0}[label];
      await page.waitForFunction(value=>state.adjustments.hdr.exposure===value,value,{timeout:15000});
    };
    await revert('Revert to original');
    assert.equal(await page.evaluate(()=>state.adjustments.hdr.exposure),0);
    assert.equal(await page.evaluate(()=>state.documentDirty),true);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,.75);
    await revert('Restore previous grade');
    assert.equal(await page.evaluate(()=>state.adjustments.hdr.exposure),2);
    await page.locator('#grade-revert-saved').click();
    await page.waitForFunction(()=>state.adjustments.hdr.exposure===.75 && !state.documentDirty,null,{timeout:15000});
    await revert('Revert to last session');
    assert.equal(await page.evaluate(()=>state.adjustments.hdr.exposure),0);
    await page.evaluate(()=>HDRGradeSaving.save());
    console.log("open next");
    await open(photos[1]);
    await page.evaluate(()=>activateWorkflowTab('import'));
    const frame=page.frameLocator('#library-frame');
    await page.locator('#library-frame').evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
    await frame.locator('.library-cell').first().waitFor();
    await page.evaluate(photo=>fetch('/api/library/marks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo],change:{rating:4,add_tag:'Keep'}})}),photos[0]);
    await frame.locator('.library-cell').first().click({button:'right'});
    await frame.locator('button').filter({hasText:/^Restore previous grade…$/}).click();
    await frame.locator('dialog[open]').waitFor();
    assert.match(await frame.locator('dialog[open]').innerText(),/1 photo goes back to its previous grade.*Marks and tags are not touched/s);
    const libraryRevert = page.waitForResponse(r=>r.url().endsWith('/api/library/grade-reverts') && JSON.parse(r.request().postData()).target==='previous');
    await frame.locator('dialog[open] button').filter({hasText:/^Restore$/}).click();
    assert.equal((await libraryRevert).status(),200);
    await written(photos[0]);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,.75);
    assert.equal(read(photos[0]).marks.rating,4);
    const undo=page.waitForResponse(r=>r.url().endsWith('/api/library/undo'));
    await frame.locator('#library-grid').press('Control+z');
    assert.equal((await undo).status(),200); await written(photos[0]);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,0);
    assert.equal(read(photos[0]).marks.rating,4);
    assert.deepEqual(fs.readFileSync(photos[0]),original);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({checks:'four Grade reverts, unsaved open result, saved file unchanged, counted Library confirmation, one Undo, marks kept'}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
