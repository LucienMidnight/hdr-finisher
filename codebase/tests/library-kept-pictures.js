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
const screenFolder=fs.mkdtempSync(path.join(output,'screen-photo-'));
const screenPhoto=path.join(screenFolder,'DSC07072.ARW');
fs.copyFileSync('D:/test-photos-delete-later/DSC07072.ARW',screenPhoto);
const oldGrade=fs.readFileSync('D:/test-photos-delete-later/DSC07072.ARW.hdrf');
const copiedGrade=JSON.parse(oldGrade);
for(const field of ['grade','grade_default']) if(copiedGrade[field]?.source) copiedGrade[field].source.durable_path=screenPhoto;
fs.writeFileSync(screenPhoto+'.hdrf',JSON.stringify(copiedGrade));
const copiedSidecar=fs.readFileSync(screenPhoto+'.hdrf');
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
    await page.evaluate(()=>fetch('/api/library-worker/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'manual',paused:true})}));
    const started = Date.now();
    await page.evaluate(() => HDRGradeSaving.save());
    const saveMs = Date.now() - started;
    await open(photos[1]); // Production must not hold the next-photo gate.
    const nextMs = Date.now() - started - saveMs;
    await page.evaluate(() => activateWorkflowTab("import"));
    const frame = page.frameLocator("#library-frame");
    const held=await page.request.post(new URL('/api/library/picture',process.env.HDR_FINISHER_URL).href,{data:{path:photos[0],edge:512,quality:'quick'}});
    assert.equal(held.status(),202,'Saved-picture production waits while the worker is paused');
    await page.evaluate(()=>fetch('/api/library-worker/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'manual',paused:false})}));
    await written(photos[0]);
    await page.locator("#library-frame").evaluate((element, folder) => element.contentWindow.HDRLibrary.browse(folder), folder);
    await frame.locator('.library-cell .library-edited').first().waitFor();
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
    await frame.locator('#more-button').click();await frame.locator('#picture-settings').click();
    await frame.locator('dialog[open]').waitFor();
    assert.equal(await frame.locator('dialog[open] input,dialog[open] select').count(),2);
    await frame.locator('dialog[open]').press('Escape');
    await frame.locator('#hdr-button').click();
    await page.waitForTimeout(2200);
    await frame.locator('#zoom-button').click();
    await frame.locator('#grid-view').click();
    await page.locator('#library-frame').evaluate((element,folder)=>element.contentWindow.HDRLibrary.browse(folder),screenFolder);
    await frame.locator('.library-cell canvas[data-kept="true"]').waitFor({timeout:180000});
    const screenMeta=await page.locator('#library-frame').evaluate(async(element,photo)=>{
      const win=element.contentWindow;
      const response=await win.fetch('/api/library/picture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo,edge:2560,quality:'quick'})});
      return response.json();
    },screenPhoto);
    const prefs=await page.request.get(new URL('/api/library/picture-settings',process.env.HDR_FINISHER_URL).href).then(r=>r.json());
    assert.equal(prefs.edited_resolution,'screen');
    assert.equal(screenMeta.edge,prefs.edited_edge);
    assert.equal(Math.max(screenMeta.width,screenMeta.height),prefs.edited_edge);
    assert.equal(screenMeta.kept,true);assert.equal(screenMeta.extension,'jpg');
    await frame.locator('.library-cell').first().click();await frame.locator('#single-view').click();
    const libraryFrame=page.frame({url:/\/library(?:\?|$)/});
    await libraryFrame.waitForFunction(({photo,key})=>{
      const canvas=document.querySelector('#single-picture');
      return canvas.dataset.picturePath===photo&&canvas.dataset.pictureKey===key&&canvas.dataset.kept==='true';
    },{photo:screenPhoto,key:screenMeta.key},{timeout:60000});
    await page.keyboard.press('f');
    await libraryFrame.waitForFunction(()=>HDRLibrary.getSnapshot().review);
    assert.equal(Number(await frame.locator('#single-picture').getAttribute('data-picture-edge')),prefs.edited_edge);
    const beforeKey=await frame.locator('#single-picture').getAttribute('data-picture-key');
    await page.keyboard.press('h');await page.waitForTimeout(800);
    await page.screenshot({path:path.join(output,'screen-edited-fullscreen.png')});
    assert.equal(await frame.locator('#single-picture').getAttribute('data-picture-key'),beforeKey,'One saved file serves SDR and HDR');
    assert.deepEqual(fs.readFileSync(screenPhoto+'.hdrf'),copiedSidecar,'Background rebuild does not re-save the grade');
    assert.deepEqual(fs.readFileSync('D:/test-photos-delete-later/DSC07072.ARW.hdrf'),oldGrade);
    fs.writeFileSync(path.join(output,'screen-picture-cost.json'),JSON.stringify({photo:'DSC07072.ARW',width:screenMeta.width,height:screenMeta.height,edge:screenMeta.edge,stored_bytes:screenMeta.stored_bytes,make_ms:screenMeta.make_ms},null,2));
    console.log('PASS: existing edited ARW remade without save, screen-sized in Single/fullscreen, one SDR/HDR JPEG;',JSON.stringify({width:screenMeta.width,height:screenMeta.height,stored_bytes:screenMeta.stored_bytes}));
    assert.deepEqual(fs.readFileSync(photos[0]), original);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ saveMs,nextMs,readyMs,transport, checks:'cropped saved gain-map, next photo, edited mark, enlarged zoom, two controls, HDR switch' }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
