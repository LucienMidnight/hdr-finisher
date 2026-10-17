/* Library selection reaches Export: menu availability, Open in Export and Quick export. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'library-export-menu');
fs.mkdirSync(output, {recursive:true});
const folder = fs.mkdtempSync(path.join(output, 'photos-'));
const photos = ['one.png','two.png','three.png'].map(name => path.join(folder,name));
for (const photo of photos) fs.copyFileSync(path.join(root,'tests','fixtures','sdr_gradient.png'),photo);
(async () => {
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page = await browser.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message)); page.setDefaultTimeout(30000);
    await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
    await page.evaluate(()=>activateWorkflowTab('import'));
    const iframe=page.locator('#library-frame'), frame=page.frameLocator('#library-frame');
    await iframe.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
    const cells=frame.locator('.library-cell');
    await page.waitForFunction(()=>document.getElementById('library-frame').contentDocument.querySelectorAll('.library-cell').length===3);
    const menu=page.locator('[data-desktop-command="quick-export"]');
    await cells.first().click();
    await page.waitForFunction(()=>!document.querySelector('[data-desktop-command="quick-export"]').disabled);
    await frame.locator('#library-grid').press('Control+a');
    await page.waitForTimeout(300);
    const afterAll=await menu.isDisabled();
    const selected=await iframe.evaluate(el=>el.contentWindow.HDRLibraryCommands.selection().length);
    console.log(JSON.stringify({afterSelectAllDisabled:afterAll,selected}));
    assert.equal(selected,3);assert.equal(afterAll,false,'menu after Ctrl+A');
    await cells.first().click({button:'right'});
    await frame.getByRole('menuitem',{name:'Open in Export',exact:true}).click();
    await page.waitForFunction(()=>document.body.dataset.workflow==='export');
    await page.waitForFunction(()=>document.querySelectorAll('.batch-photo').length===3);
    await page.locator('#batch-grid-panel').getByRole('button',{name:'Select all',exact:true}).click();
    assert.equal(await page.locator('.batch-photo input:checked').count(),3);
    assert.equal(await page.locator('#batch-run').isVisible(),true);
    assert.ok(await page.locator('#export-format option').count()>0,'format choices without a Grade photo');
    await page.screenshot({path:path.join(output,'export-from-library.png')});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({menuEnabled:true,openInExport:3,selectAll:3}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
