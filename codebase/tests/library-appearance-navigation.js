const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'output/library-appearance-navigation');
fs.mkdirSync(out, {recursive:true});
const folder = fs.mkdtempSync(path.join(out, 'photos-')), folders = [folder,path.join(folder,'Second'),path.join(folder,'Third')];
folders.slice(1).forEach(dir=>fs.mkdirSync(dir));
for(let i=0;i<6;i++) fs.copyFileSync(path.join(root,'tests/fixtures/library_photo.png'),path.join(folder,`photo-${i}.png`));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  // PNG test photos are listed only with "Show all files" on.
  await page.addInitScript(()=>localStorage.setItem('hdr-finisher:library-show-all-files','true'));
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const lib=page.frame({url:/\/library(?:\?|$)/}); await lib.waitForFunction(()=>!!window.HDRLibrary);
  await lib.evaluate(async paths=>{await fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths})});},folders);
  await lib.goto(lib.url()); await lib.waitForFunction(()=>!!window.HDRLibrary);
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder); await lib.waitForSelector('#grid-space canvas[data-picture-key]');
  await lib.locator('.library-cell').filter({hasText:'photo-4.png'}).click();
  const selected=await lib.evaluate(()=>HDRLibrary.getSnapshot().selected), requests=[];
  // Neighbour read-ahead was removed on November 3 (75f1de90); review shows the selected photo, then the next one.
  page.on('request',r=>{if(r.url().endsWith('/api/library/picture')){const b=r.postDataJSON();if(b.priority===0)requests.push(b);}});
  await page.keyboard.press('f');
  await lib.waitForFunction(p=>HDRLibrary.getSnapshot().review&&document.querySelector('#single-picture').dataset.picturePath===p&&Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280,selected);
  await page.waitForTimeout(800); assert.ok(requests.length<=2,`Foreground loads: ${requests.length}`);
  await page.keyboard.press('ArrowRight');
  await lib.waitForFunction(p=>document.querySelector('#single-picture').dataset.picturePath!==p&&document.querySelector('#single-picture').dataset.picturePath===HDRLibrary.getSnapshot().selected,selected);
  await lib.waitForFunction(()=>Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280);
  await page.keyboard.press('Escape'); await lib.waitForFunction(()=>!HDRLibrary.getSnapshot().review);
  console.log('PASS: fullscreen shows the selected photo at full preview, then the next one, without duplicate foreground loads.');
  // Grade filtering is the State rule since 5fb2ed69; all six photos are not edited.
  await lib.locator('#filter-button').click(); await lib.locator('#filter-add').click(); await lib.getByRole('menuitem',{name:'State',exact:true}).click();
  await lib.locator('#library-filter-panel').getByRole('checkbox',{name:'Not edited',exact:true}).check(); await lib.locator('#library-filter-panel').getByRole('button',{name:'Apply',exact:true}).click();
  await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===6); assert.equal(await lib.locator('#filter-button').getAttribute('aria-pressed'),'true');
  await lib.locator('#filter-clear').click(); assert.equal(await lib.locator('#filter-button').getAttribute('aria-pressed'),'false');
  await lib.locator('#filter-add').click(); assert.ok(await lib.locator('#library-folder-menu').isVisible());
  await lib.locator('#filter-add').click(); assert.ok(await lib.locator('#library-folder-menu').isHidden());
  console.log('PASS: grade filters, persistent highlight and dropdown toggle.');
  await lib.locator('[data-section="albums"] .section-toggle').click(); assert.ok(await lib.locator('#albums').isHidden());
  await lib.locator('[data-section="smart-albums"] .section-handle').dragTo(lib.locator('[data-section="folders"] .library-heading'),{targetPosition:{x:80,y:3}});
  assert.equal(await lib.locator('.library-nav-section').first().getAttribute('data-section'),'smart-albums');
  const pins=lib.locator('#folders > div');
  await pins.nth(2).locator('.library-drag-handle').dragTo(pins.nth(0).locator('.library-folder-row'),{targetPosition:{x:80,y:3}});
  await lib.waitForFunction(p=>document.querySelector('#folders .library-folder-row').dataset.path===p,folders[2]);
  await lib.goto(lib.url()); await lib.waitForFunction(()=>!!window.HDRLibrary);
  assert.equal(await lib.locator('.library-nav-section').first().getAttribute('data-section'),'smart-albums'); assert.ok(await lib.locator('#albums').isHidden());
  await lib.waitForFunction(p=>document.querySelector('#folders .library-folder-row')?.dataset.path===p,folders[2]);
  console.log('PASS: saved section order, pinned folder order and collapsed state.');
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder); await lib.waitForSelector('#grid-space canvas[data-picture-key]'); await lib.locator('.library-cell').first().click();
  assert.deepEqual((await lib.locator('#details .library-kicker').allTextContents()).slice(0,2),['File','Marks']);
  assert.equal(await lib.locator('#details .library-file-name').count(),1);
  for(const theme of ['modern-dark','default-light','studio-gray']) {
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme); await lib.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
   console.log(theme,await lib.evaluate(()=>({panel:getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),scrollbar:getComputedStyle(document.querySelector('#library-grid')).scrollbarColor})));
   await page.screenshot({path:path.join(out,theme+'.png')});
  }
  assert.ok(await page.locator('.product-logo').evaluate(img=>img.complete&&img.naturalWidth>0)); assert.deepEqual(errors,[]);
  console.log('PASS: File then Marks, all three token themes, SVG wordmark, no renderer errors.');
 } finally {await browser.close();fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
