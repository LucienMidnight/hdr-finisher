/* Read-only photo folder; disposable Electron profile. Native thumbnail timing and memory budgets.
 * Cold baseline: ef4326c, unchanged driver, 2560x1440, D:\Photos\HDR Test Images,
 * disposable profile, 2026-10-17: 80 measured cells, median 925 ms / p90 7478 ms.
 * Includes folder-open/start-up work (unlike Claude's post-first-screen script).
 * An external observer captured pass one's measurements before the old app's missing
 * HDRLibraryThumbnailPool API stopped the driver. Cold limits add Steve's agreed 15%;
 * revisit limits remain p90 100 ms / max 300 ms.
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const output = path.resolve(__dirname,'../output/library-thumbnail-scroll');fs.mkdirSync(output,{recursive:true});
const coldLimits = {median:925 * 1.15, p90:7478 * 1.15};
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
  await frame.locator('#thumbnail-size').evaluate((e,size)=>{e.value=size;e.dispatchEvent(new Event('input',{bubbles:true}));},Number(process.env.SCROLL_SIZE || 360));
  if (process.env.SCROLL_VISIBLE_ONLY) {
   await frame.evaluate(()=>{
    window.previewMeasurements=[];
    const original=window.HDRLibraryStopwatch;
    window.HDRLibraryStopwatch=(stage,details)=>{if(['camera_preview_shown','picture_shown'].includes(stage)) previewMeasurements.push({stage,...details});original(stage,details);};
   });
   await frame.evaluate(folder=>HDRLibrary.browse(folder),folder);
   const paths=await frame.evaluate(()=>{
    const bounds=document.querySelector('#library-grid').getBoundingClientRect();
    return [...document.querySelectorAll('#grid-space .library-cell')].filter(cell=>{const r=cell.getBoundingClientRect();return r.bottom>bounds.top && r.top<bounds.bottom;}).map(cell=>cell.dataset.path);
   });
   let complete=true;
   try {await frame.waitForFunction(paths=>paths.every(path=>[...document.querySelectorAll('#grid-space .library-cell')].some(cell=>cell.dataset.path===path && cell.querySelector('img')?.dataset.pictureKey)),paths,{timeout:60000});}
   catch {complete=false;}
   const metrics=await frame.evaluate(paths=>{
    const events=previewMeasurements.filter(e=>paths.includes(e.path));
    const first=new Map(),real=new Map();
    for(const e of events){if(!first.has(e.path))first.set(e.path,e.duration_ms);if(e.stage==='picture_shown'&&!real.has(e.path))real.set(e.path,e.duration_ms);}
    const p90=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?a[Math.floor((a.length-1)*.9)]:null;};
    return {visible:paths.length,camera_previews:events.filter(e=>e.stage==='camera_preview_shown').length,first: first.size,real:real.size,first_p90_ms:p90(first.values()),real_p90_ms:p90(real.values())};
   },paths);
   console.log(JSON.stringify({complete,...metrics}));
   fs.writeFileSync(path.join(output,'visible-results.json'),JSON.stringify({complete,...metrics},null,2));
   assert.ok(complete,'Visible real thumbnails must reach the persistent cache');
   assert.deepEqual(errors,[]);
   return;
  }
  await frame.evaluate(()=>{
   window.scrollMeasurements=[];let starts=new WeakMap();window.resetScrollMeasurements=()=>{scrollMeasurements.length=0;starts=new WeakMap();};
   const observer=new MutationObserver(records=>{for(const r of records){
    if(r.type==='childList') for(const n of r.addedNodes) if(n.classList?.contains('library-cell')) starts.set(n,performance.now());
    if(r.type==='attributes') {const cell=r.target.closest('.library-cell');if(cell?.closest('#grid-space')&&starts.has(cell)) {scrollMeasurements.push({path:cell.dataset.path,ms:performance.now()-starts.get(cell)});starts.delete(cell);}}
   }});
   observer.observe(document.querySelector('#grid-space'),{childList:true,subtree:true,attributes:true,attributeFilter:['data-picture-key']});
  });
  const results=[];let warmRequestStart=0;
  for(let pass=0;pass<3;pass++) {
   await frame.evaluate(()=>resetScrollMeasurements());
   if(pass===0) {await frame.evaluate(folder=>HDRLibrary.browse(folder),folder);await page.waitForTimeout(8000);}
   if(pass===1) {
    // Cache production now consumes GPU-finished pictures. Visit each screen
    // and let its real images reach the cache rather than asking the CPU to
    // re-decode the whole folder. This also keeps requests below the API cap.
    const warmGrid=frame.locator('#library-grid');
    const dimensions=await warmGrid.evaluate(g=>({height:g.scrollHeight-g.clientHeight,step:Math.max(100,g.clientHeight*.8)}));
    for(let y=0;y<dimensions.height+dimensions.step;y+=dimensions.step) {
     await warmGrid.evaluate((g,y)=>{g.scrollTop=y;},Math.min(y,dimensions.height));
     await frame.waitForFunction(()=>{
      const grid=document.querySelector('#library-grid'),bounds=grid.getBoundingClientRect();
      return [...document.querySelectorAll('#grid-space .library-cell')].filter(cell=>{const r=cell.getBoundingClientRect();return r.bottom>bounds.top && r.top<bounds.bottom;})
       .every(cell=>{const img=cell.querySelector('img');return img?.dataset.pictureKey && img.complete && !img.hidden;});
     },null,{timeout:90000});
    }
    await frame.evaluate(()=>resetScrollMeasurements());
    warmRequestStart=requests.length;
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
  assert.ok(requests.length > 0, 'Request tracking must observe real Library traffic');
  assert.equal(requests.slice(warmRequestStart).filter(r=>/\/api\/library\/(picture|pixels|kept-pixels)\b/.test(r.url)).length,0,'Warm grid makes no scene-pixel requests or GPU draws');
  await page.waitForTimeout(300);const count=requests.length;
  await frame.locator('#hdr-button').click();await frame.locator('#hdr-button').click();await page.waitForTimeout(200);
  assert.equal(requests.length,count,'HDR toggle uses the same decoded gain-map file');
  assert.deepEqual(errors,[]);
  assert.ok(results[0].median<=coldLimits.median,`Cold median ${results[0].median} >${coldLimits.median}ms`);
  assert.ok(results[0].p90<=coldLimits.p90,`Cold p90 ${results[0].p90} >${coldLimits.p90}ms`);
  for(const result of results.slice(1)){assert.ok(result.p90<=100,`Warm p90 ${result.p90} >100ms`);assert.ok(result.max<=300,`Warm max ${result.max} >300ms`);}
  console.log('PASS: three scroll passes, native gain-map reuse on warm visits, bounded decoded pool.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
