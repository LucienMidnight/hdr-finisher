/* Saved grades refresh the existing Library, including a RAW without bright peaks. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'library-saved-picture-refresh');
fs.mkdirSync(output, { recursive: true });
const raw = process.env.HDR_FINISHER_SAVED_PICTURE_RAW;
const source = raw || path.join(root, 'tests/fixtures/sdr_gradient.png');
const folder = fs.mkdtempSync(path.join(output, 'photos-')), photo = path.join(folder, path.basename(source));
fs.copyFileSync(source, photo);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original = hash(photo);
const savedGrade = raw ? JSON.parse(fs.readFileSync(source + '.hdrf', 'utf8')).grade : null;
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => window.HDRLibrary);
    await library.evaluate(folder => HDRLibrary.browse(folder), folder);
    const cell = library.locator('#grid-space .library-cell').first();
    await cell.locator('[data-picture-key]').waitFor();
    assert.equal(await cell.locator('.library-edited').count(), 0);
    for (const autosave of [true, false]) {
      const previousKey=await cell.locator('[data-picture-key]').getAttribute('data-picture-key');
      await cell.dblclick();
      await page.waitForFunction(() => HDRGradeSaving.active() && HDRGradeSaving.ready() && !state.gradeOpen);
      const button = page.locator('#grade-autosave');
      if ((await button.getAttribute('aria-pressed') === 'true') !== autosave) await button.click();
      await page.evaluate(async ({ grade, autosave }) => {
        const adjustments = structuredClone(state.adjustments);
        if(grade){
          for(const lane of ["hdr","sdr"]) HDRFilmCharacter.select(adjustments[lane].film_look,"kodak_portra_400");
          const denoise=structuredClone(state.denoise);
          for(const lane of ["hdr","sdr"]) denoise[lane].enabled=true;
          if(!await queueEditCommand("set_denoise_settings",{denoise}))throw new Error("Denoise edit rejected");
        }
        if (!grade) { adjustments.hdr.exposure = .75; adjustments.sdr.exposure = -.25; }
        else adjustments.hdr.exposure += .25; // Ensure even a neutral saved RAW grade creates an edit.
        if (!autosave) adjustments.hdr.exposure -= .01;
        if (!await queueEditCommand('set_global_adjustments', { adjustments })) throw new Error('The test grade edit was rejected.');
      }, { grade: savedGrade, autosave });
      const savedAt=Date.now();
      if (!autosave) assert.ok(await page.evaluate(() => HDRGradeSaving.save()));
      await page.waitForFunction(()=>!state.documentDirty && document.querySelector("#grade-save-state").textContent!=="Saving…");
      await page.evaluate(() => activateWorkflowTab('import'));
      let meta;
      while(!meta && Date.now()-savedAt<10000){
        meta=await library.evaluate(async ({photo,previousKey}) => {
        const picture=document.querySelector('#grid-space [data-picture-key]');
        if(!picture||picture.dataset.kept!=="true"||picture.dataset.pictureKey===previousKey)return false;
        const result=await fetch('/api/library/thumbnails',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo],edge:Number(picture.dataset.pictureEdge)||360,populate:false})}).then(r=>r.json());
        if(!result.ready.some(meta=>meta.kept&&meta.key===picture.dataset.pictureKey))return false;
        const meta=await fetch('/api/library/picture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo,edge:512,quality:'quick'})}).then(r=>r.json());
        if(!meta.kept)return false;
        return meta;
        }, {photo,previousKey});
        if(!meta)await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.ok(meta,"Latest saved-grade picture did not become ready");
      const elapsed=Date.now()-savedAt;
      console.log(JSON.stringify({saveToLibraryMs:elapsed,autosave,raw:!!raw}));
      assert.ok(elapsed<=5000,`Saved grade reached the Library in ${elapsed}ms; limit is 5000ms`);
      await cell.locator('.library-edited').first().waitFor();
      assert.ok(meta.kept);
      if (raw) assert.equal(meta.route, 'saved-gain-map');
      for (const lane of ['sdr','hdr']) {
        const canvas = cell.locator('[data-picture-key]');
        if (await canvas.getAttribute('data-rendition') !== lane) await library.locator('#hdr-button').click();
        await library.waitForFunction(lane => document.querySelector('#grid-space [data-kept="true"]')?.dataset.rendition === lane, lane);
        const transport = await library.evaluate(async ({key,lane}) => {
          const response=await fetch(`/api/library/kept-pixels/${key}?lane=${lane}`);
          return {ok:response.ok,bytes:(await response.arrayBuffer()).byteLength,width:Number(response.headers.get('X-Image-Width')),height:Number(response.headers.get('X-Image-Height')),stride:Number(response.headers.get('X-Bytes-Per-Row'))};
        }, {key:meta.key,lane});
        assert.ok(transport.ok && transport.width > 0 && transport.height > 0);
        assert.equal(transport.bytes,transport.stride*transport.height);
        await canvas.screenshot({path:path.join(output,`${autosave?'autosave':'explicit'}-${lane}.png`)});
      }
      await page.evaluate(photo=>batchExport.open([photo]),photo);
      let exportReady=false;const exportDeadline=Date.now()+10000;
      while(!exportReady&&Date.now()<exportDeadline){
        exportReady=await page.evaluate(async photo=>{
          const result=await fetch('/api/library/thumbnails',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo],edge:360,populate:false})}).then(r=>r.json());
          const img=document.querySelector('.batch-photo img');
          return result.ready.some(meta=>meta.kept&&img?.naturalWidth>0&&img.src.endsWith(meta.key));
        },photo);
        if(!exportReady)await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.ok(exportReady,"Export must show the current saved-grade thumbnail");
      const exportThumb=await page.locator('.batch-photo img').getAttribute('src');
      const exportKey=exportThumb.split('/').pop();
      assert.ok(exportKey.length===64);
      await page.screenshot({path:path.join(output,`${autosave?'autosave':'explicit'}-raw-export.png`)});
      await page.evaluate(()=>activateWorkflowTab('import'));
      assert.equal(hash(photo), original);
      if(autosave){
        // The agreed five-second budget is for an otherwise idle app. Let the
        // separate large picture settle before measuring the next save.
        let largeReady=false;const deadline=Date.now()+120000;
        while(!largeReady&&Date.now()<deadline){
          largeReady=await library.evaluate(async photo=>{const meta=await fetch('/api/library/picture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo,edge:1920,quality:'quick'})}).then(r=>r.json());return meta.kept&&meta.edge>512;},photo);
          if(!largeReady)await new Promise(resolve=>setTimeout(resolve,500));
        }
        assert.ok(largeReady,"Large saved picture did not finish before the next idle measurement");
      }
      console.log(`PASS: ${autosave?'Autosave':'explicit Save'} refreshes both views in the existing Library (${meta.route}).`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: original unchanged; no renderer errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });