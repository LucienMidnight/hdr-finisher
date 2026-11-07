/* GPU setup must overlap a visible photo request, using the existing renderer. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output/library-picture-startup');
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, 'photos-'));
fs.copyFileSync(path.join(root, 'tests/fixtures/library_photo.png'), path.join(folder, 'first.png'));
(async () => {
  const browser = await chromium.launch({ headless: true });
  let release;
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(30000); await page.addInitScript(() => localStorage.setItem("hdr-finisher:library-show-all-files", "true"));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => window.HDRLibrary);
    await library.evaluate(folder => HDRLibrary.browse(folder), folder);
    await library.locator('#grid-space canvas[data-picture-key]').first().waitFor({timeout:60000});
    await library.evaluate(() => {
      const pictures=HDRLibraryPictures,scenes=HDRLibraryScenes;
      window.trialSetupStarted=false;window.trialPictureRequested=false;
      const gate=new Promise(resolve=>window.trialRelease=resolve);
      window.HDRLibraryPictures={...pictures,prepareScreen:(...args)=>{
        window.trialSetupStarted=true;return pictures.prepareScreen(...args);
      }};
      window.HDRLibraryScenes={...scenes,load:async(...args)=>{
        if(args[1]===2560){window.trialPictureRequested=true;await gate;}
        return scenes.load(...args);
      }};
    });
    release=()=>library.evaluate(()=>window.trialRelease?.()).catch(()=>{});
    await library.locator('#single-view').click();
    await library.waitForFunction(()=>window.trialSetupStarted&&window.trialPictureRequested);
    assert.equal(await library.locator('#single-picture[data-picture-key]').count(),0);
    await release();
    await library.locator('#single-picture[data-picture-key]').waitFor({timeout:60000});
    assert.deepEqual(errors, []);
    console.log('PASS: GPU initialization overlaps visible photo preparation; normal SDR picture arrives after the request.');
  } finally { release?.(); try { await browser.close(); } finally { fs.rmSync(folder,{recursive:true,force:true}); } }
})().catch(error => { console.error(error); process.exitCode = 1; });