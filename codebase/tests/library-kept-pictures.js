/* Slice 3 Stage A: one real window, disposable originals and app profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-kept-pictures");
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
    await page.evaluate(()=>fetch('/api/library-worker/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'delayed-picture-check',paused:true})}));
    const started = Date.now();
    await page.evaluate(() => HDRGradeSaving.save());
    const saveMs = Date.now() - started;
    await open(photos[1]); // Production must not hold the next-photo gate.
    const nextMs = Date.now() - started - saveMs;
    await page.evaluate(() => activateWorkflowTab("import"));
    const frame = page.frameLocator("#library-frame");
    await page.locator("#library-frame").evaluate((element, folder) => element.contentWindow.HDRLibrary.browse(folder), folder);
    await written(photos[0]);
    await frame.locator('.library-cell .library-edited').first().waitFor();
    assert.equal(await frame.locator('.library-cell canvas[data-kept="true"]').count(),0);
    await page.evaluate(()=>fetch('/api/library-worker/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'delayed-picture-check',paused:false})}));
    await frame.locator('.library-cell canvas[data-kept="true"]').first().waitFor({ timeout: 60000 });
    const readyMs = Date.now() - started;
    const transport = await page.locator("#library-frame").evaluate(async (element, paths) => {
      const win=element.contentWindow;
      const entries=await Promise.all(paths.map(path=>win.fetch('/api/library/picture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,edge:512,quality:'quick'})}).then(r=>r.json())));
      const canvas=win.document.createElement('canvas');win.document.body.append(canvas);
      const measure=async meta=>{const times=[];for(let i=0;i<20;i++){const t=performance.now();await win.HDRLibraryPictures.show(meta,canvas,new win.AbortController().signal,()=>true,false);times.push(performance.now()-t);}return {firstMs:Math.round(times[0]),next19MeanMs:Math.round(times.slice(1).reduce((a,b)=>a+b,0)/19)};};
      const edited=await measure(entries[0]),unedited=await measure(entries[1]);canvas.remove();return {edited,unedited};
    },photos);
    const edited = frame.locator('.library-cell').filter({ has: frame.locator('.library-edited') }).first();
    assert.equal(await edited.locator('canvas').getAttribute('data-kept'), 'true');
    await edited.click();await frame.locator('#single-view').click();
    await frame.locator('#single-picture[data-kept="true"]').waitFor();
    await frame.locator('#zoom-button').click();
    assert.equal(await frame.locator('#native-picture').isHidden(),true);
    await frame.locator('#picture-settings').click();
    await frame.locator('dialog[open]').waitFor();
    assert.equal(await frame.locator('dialog[open] input,dialog[open] select').count(),2);
    await frame.locator('dialog[open]').press('Escape');
    await frame.locator('#hdr-button').click();
    await page.waitForTimeout(2200);
    assert.deepEqual(fs.readFileSync(photos[0]), original);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ saveMs,nextMs,readyMs,transport, checks:'cropped saved gain-map, next photo, edited mark, enlarged zoom, two controls, HDR switch' }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
