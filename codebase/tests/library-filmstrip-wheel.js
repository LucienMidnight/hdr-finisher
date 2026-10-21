/* The mouse wheel scrolls the Single view filmstrip sideways (Steve, October 18, 2026). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'library-filmstrip-wheel');
fs.mkdirSync(output, {recursive:true});
const folder = fs.mkdtempSync(path.join(output, 'photos-'));
for (let n = 1; n <= 30; n++) fs.copyFileSync(path.join(root,'tests','fixtures','sdr_gradient.png'), path.join(folder,`photo-${String(n).padStart(2,'0')}.png`));
(async () => {
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page = await browser.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message)); page.setDefaultTimeout(30000);
    await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
    await page.evaluate(()=>activateWorkflowTab('import'));
    const iframe=page.locator('#library-frame'), frame=page.frameLocator('#library-frame');
    await iframe.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
    await frame.locator('.library-cell').first().click();
    await frame.locator('#single-view').click();
    const film=frame.locator('#filmstrip');
    await film.waitFor();
    await page.waitForFunction(()=>{const f=document.getElementById('library-frame').contentDocument.getElementById('filmstrip');return f.scrollWidth>f.clientWidth;});
    assert.equal(await film.evaluate(el=>el.scrollLeft),0);
    await film.hover();
    await page.mouse.wheel(0,300);
    await page.waitForFunction(()=>document.getElementById('library-frame').contentDocument.getElementById('filmstrip').scrollLeft>0);
    const after=await film.evaluate(el=>el.scrollLeft);
    assert.ok(after>0,'a vertical wheel scrolls the filmstrip sideways');
    assert.equal(await iframe.evaluate(el=>el.contentWindow.HDRLibrary.getSnapshot().view),'single','the wheel did not leave Single view');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({filmstripScrolled:after}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
