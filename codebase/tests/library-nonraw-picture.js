/* Slow non-RAW fitted pictures survive pause, navigation and repeat waiters. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const out=path.resolve(__dirname,'../output/library-nonraw-picture');fs.mkdirSync(out,{recursive:true});
const folder=fs.mkdtempSync(path.join(out,'photos-'));
fs.copyFileSync('D:/Photos/Play_Raw/HDR exercise on urbanscape/5M071612_finished.avif',path.join(folder,'slow.avif'));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  await page.evaluate(()=>activateWorkflowTab('import'));
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
  await lib.waitForSelector('#grid-space canvas[data-picture-key]');
  let paused=false,pending=0;
  const control=paused=>page.evaluate(paused=>fetch('/api/library-worker/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'manual',paused})}),paused);
  await page.route('**/api/library/picture',async route=>{
   const b=route.request().postDataJSON();
   if(b.edge>=1280&&!paused){
    paused=true;const response=page.request.post(route.request().url(),{data:b});
    await page.waitForTimeout(300);await control(true);
    const answer=await response;assert.equal(answer.status(),202);pending++;
    await route.fulfill({response:answer});await control(false);return;
   }
   await route.continue();
  });
  await lib.locator('.library-cell').first().click();await lib.locator('#single-view').click();
  await lib.waitForFunction(()=>Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280,null,{timeout:60000});
  assert.equal(pending,1,'Backend paused while the same photo remained selected');
  const fullKey=await lib.locator('#single-picture').getAttribute('data-picture-key');
  await page.keyboard.press('f');await lib.waitForFunction(()=>HDRLibrary.getSnapshot().review);
  await lib.waitForFunction(()=>Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280);
  assert.equal(await lib.locator('#single-picture').getAttribute('data-picture-key'),fullKey);
  await page.unroute('**/api/library/picture');
  assert.deepEqual(errors,[]);
  console.log('PASS: real slow AVIF replaces grid seed in Single, survives pause while selected, and displays full size in fullscreen.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
