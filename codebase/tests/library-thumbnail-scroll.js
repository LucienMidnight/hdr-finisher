/* Read-only photo folder; disposable Electron profile. Native thumbnail timing and memory budgets. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const output = path.resolve(__dirname,'../output/library-thumbnail-scroll');fs.mkdirSync(output,{recursive:true});
const folder = process.env.SCROLL_FOLDER || 'D:\\Photos\\HDR Test Images';
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const page = await browser.newPage(), errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if (/\/api\/library\/(picture|pixels|kept-pixels|thumbnails|thumbnail)\b/.test(r.url())) requests.push({url:r.url(),time:Date.now()});});
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  await page.evaluate(()=>activateWorkflowTab('import'));
  const frame=page.frame({url:/\/library(?:\?|$)/});await frame.waitForFunction(()=>window.HDRLibrary);
  await frame.locator('#thumbnail-size').evaluate(e=>{e.value=360;e.dispatchEvent(new Event('input',{bubbles:true}));});
  await frame.evaluate(()=>{
   window.scrollMeasurements=[];let starts=new WeakMap();window.resetScrollMeasurements=()=>{scrollMeasurements.length=0;starts=new WeakMap();};
   const observer=new MutationObserver(records=>{for(const r of records){
    if(r.type==='childList') for(const n of r.addedNodes) if(n.classList?.contains('library-cell')) starts.set(n,performance.now());
    if(r.type==='attributes') {const cell=r.target.closest('.library-cell');if(cell?.closest('#grid-space')&&starts.has(cell)) {scrollMeasurements.push({path:cell.dataset.path,ms:performance.now()-starts.get(cell)});starts.delete(cell);}}
   }});
   observer.observe(document.querySelector('#grid-space'),{childList:true,subtree:true,attributes:true,attributeFilter:['data-picture-key']});
  });
  const results=[];
  for(let pass=0;pass<3;pass++) {
   await frame.evaluate(()=>resetScrollMeasurements());
   if(pass===0) {await frame.evaluate(folder=>HDRLibrary.browse(folder),folder);await page.waitForTimeout(8000);}
   if(pass===1) {
    const deadline=Date.now()+240000;let warmed=false;
    while(Date.now()<deadline) {
     const status=await frame.evaluate(async()=>{
      const paths=HDRLibrary.getSnapshot().paths;
      const edge=Number(document.querySelector('#grid-space img[data-picture-edge]')?.dataset.pictureEdge||360);
      const r=await fetch('/api/library/thumbnails',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths,edge,client:"scroll-driver-warmup",wanted:paths})});return r.json();
     });
     if(status.errors.length) throw new Error(JSON.stringify(status.errors));
     const saved=await frame.evaluate(async()=>{const r=await fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:HDRLibrary.getSnapshot().paths})});return r.json();});
     if(!status.pending.length && saved.photos.every(p=>!p.edited||p.pictureCurrent)) {warmed=true;break;}
     await page.waitForTimeout(500);
    }
    assert.ok(warmed,"All thumbnail and saved-grade files must finish before warm measurements");
    await frame.evaluate(()=>resetScrollMeasurements());
   }
   if(pass===2) await frame.evaluate(()=>{HDRLibraryThumbnailPool.clear();}); // Disk hits, with the recent pool emptied.
   const grid=frame.locator('#library-grid');
   const height=await grid.evaluate(g=>g.scrollHeight-g.clientHeight);
   for(const direction of [1,-1]) {
    for(let step=0;step<=Math.ceil(height/250);step++) {const y=direction>0?Math.min(height,step*250):Math.max(0,height-step*250);await grid.evaluate((g,y)=>{g.scrollTop=y;},y);await page.waitForTimeout(250);}
    await page.waitForTimeout(4000);
   }
   const measurements=await frame.evaluate(()=>scrollMeasurements), times=measurements.map(m=>m.ms).sort((a,b)=>a-b);
   assert.ok(times.length>0,'Scroll run must measure actual new cells');
   const q=f=>Math.round(times[Math.floor((times.length-1)*f)]);
   const pool=await frame.evaluate(()=>HDRLibraryThumbnailPool.snapshot());
   const result={pass:pass+1,cells:times.length,median:q(.5),p90:q(.9),max:q(1),pool,slow:measurements.filter(m=>m.ms>300)};results.push(result);console.log(JSON.stringify(result));
   assert.ok(pool.bytes<=256*1024**2,'Recent decoded pool stays within 256 MiB');
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
  assert.equal(requests.filter(r=>/\/api\/library\/(picture|pixels|kept-pixels)\b/.test(r.url())).length,0,'Grid makes no scene-pixel requests or GPU draws');
  await page.waitForTimeout(300);const count=requests.length;
  await frame.locator('#hdr-button').click();await frame.locator('#hdr-button').click();await page.waitForTimeout(200);
  assert.equal(requests.length,count,'HDR toggle uses the same decoded gain-map file');
  assert.deepEqual(errors,[]);
  assert.ok(results[0].median<=400,`Cold median ${results[0].median} >400ms`);
  assert.ok(results[0].p90<=3400,`Cold p90 ${results[0].p90} >3400ms`);
  for(const result of results.slice(1)){assert.ok(result.p90<=100,`Warm p90 ${result.p90} >100ms`);assert.ok(result.max<=300,`Warm max ${result.max} >300ms`);}
  console.log('PASS: three scroll passes, native gain-map reuse, no GPU draws, bounded decoded pool.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
