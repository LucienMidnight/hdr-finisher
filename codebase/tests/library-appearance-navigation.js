const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'output/library-appearance-navigation');
fs.mkdirSync(out, {recursive:true});
const folder = fs.mkdtempSync(path.join(out, 'photos-')), folders = [folder,path.join(folder,'Second'),path.join(folder,'Third')];
folders.slice(1).forEach(dir=>fs.mkdirSync(dir));
for(let i=0;i<6;i++) fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),path.join(folder,`photo-${i}.png`));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const lib=page.frame({url:/\/library(?:\?|$)/}); await lib.waitForFunction(()=>!!window.HDRLibrary);
  await lib.evaluate(async paths=>{await fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths})});},folders);
  await lib.goto(lib.url()); await lib.waitForFunction(()=>!!window.HDRLibrary);
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder); await lib.waitForSelector('#grid-space canvas[data-picture-key]');
  await lib.locator('.library-cell').filter({hasText:'photo-4.png'}).click();
  const selected=await lib.evaluate(()=>HDRLibrary.getSnapshot().selected), requests=[];
  let releaseAhead, aheadRequested=false;
  const aheadGate=new Promise(resolve=>{releaseAhead=resolve;});
  await page.route('**/api/library/picture', async route=>{
   const body=route.request().postDataJSON();
   if(body.path.endsWith('photo-5.png')&&body.priority===50&&body.edge>=1280){aheadRequested=true;await aheadGate;}
   await route.continue();
  });
  page.on('request',r=>{if(r.url().endsWith('/api/library/picture')){const b=r.postDataJSON();if(b.priority===0)requests.push(b);}});
  await page.keyboard.press('f');
  await lib.waitForFunction(p=>HDRLibrary.getSnapshot().review&&document.querySelector('#single-picture').dataset.picturePath===p&&Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280,selected);
  await page.waitForTimeout(800); assert.ok(requests.length<=2,`Foreground loads: ${requests.length}`);
  assert.ok(aheadRequested,'Neighbour read-ahead began while selected photo loaded');
  await page.keyboard.press('ArrowRight');
  await lib.waitForFunction(p=>document.querySelector('#single-picture').dataset.picturePath!==p&&document.querySelector('#single-picture').dataset.picturePath===HDRLibrary.getSnapshot().selected,selected);
  assert.ok(Number(await lib.locator('#single-picture').getAttribute('data-picture-edge'))<1280,'Cached grid picture appears while full preview is held');
  assert.equal(requests.filter(b=>b.path.endsWith('photo-5.png')).length,0,'Selecting the neighbour reuses its unfinished request');
  releaseAhead();
  await lib.waitForFunction(()=>Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280);
  await page.unroute('**/api/library/picture');
  await page.keyboard.press('Escape'); await lib.waitForFunction(()=>!HDRLibrary.getSnapshot().review);
  console.log('PASS: fullscreen arrow shows cached photo before delayed full preview, preserves neighbour request and avoids duplicate foreground loads.');
  await lib.locator('#filter-button').click(); await lib.locator('#filter-grade').selectOption('ungraded');
  await lib.locator('#filter-button').click(); assert.equal(await lib.locator('#filter-button').getAttribute('aria-pressed'),'true');
  assert.equal(await lib.evaluate(()=>HDRLibrary.getSnapshot().count),6);
  await lib.locator('#filter-button').click(); await lib.locator('#filter-grade').selectOption('graded'); await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===0);
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
  for(const theme of ['default-dark','default-light','studio-gray']) {
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme); await lib.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
   console.log(theme,await lib.evaluate(()=>({panel:getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),scrollbar:getComputedStyle(document.querySelector('#library-grid')).scrollbarColor})));
   await page.screenshot({path:path.join(out,theme+'.png')});
  }
  assert.ok(await page.locator('.product-logo').evaluate(img=>img.complete&&img.naturalWidth>0)); assert.deepEqual(errors,[]);
  console.log('PASS: File then Marks, all three token themes, SVG wordmark, no renderer errors.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
