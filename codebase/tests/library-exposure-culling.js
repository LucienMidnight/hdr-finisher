// Reuse shared RAWs in a fresh Electron profile; never copy or alter originals.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output','test-photos','badminton-42mp');
const pace=process.argv.includes('--paced')?1000:0;
const focus=process.argv.includes('--focus'),label=process.env.EXPOSURE_CULLING_LABEL||'exposure-culling';
assert.match(label,/^[a-z0-9-]+$/i);
(async()=>{const browser=await chromium.launch({headless:true});let memoryTimer;try{
 const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/library/overlay-map'))requests.push({...r.postDataJSON(),trace:r.headers()['x-library-request'],at:Date.now()});});
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.evaluate(()=>activateWorkflowTab('import'));
 const host=page.locator('#library-frame'),frame=page.frameLocator('#library-frame');
 await host.evaluate((e,p)=>e.contentWindow.HDRLibrary.browse(p),folder);
 await frame.locator('.library-cell[data-path] canvas[data-picture-key^="original:"]').first().waitFor({timeout:120000});
 await frame.locator('.library-cell[data-path]').first().click();await frame.locator('#single-view').click();
 await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.querySelector('#single-picture[data-camera-preview="true"]:not([hidden])'),null,{timeout:120000});
 const ready=kind=>page.waitForFunction(kind=>{const w=document.querySelector('#library-frame').contentWindow,s=w.HDRLibrary.getSnapshot(),p=w.document.querySelector('#single-picture:not([hidden])'),m=s.overlays.maps.find(m=>m.path===s.selected&&m.kind===kind&&m.ready),l=w.document.querySelector(`#single-stage .library-source-overlay[data-kind="${kind}"][data-key]:not([hidden])`);return p?.dataset.picturePath===s.selected&&m&&l?.dataset.key===m.key;},kind,{timeout:120000,polling:'raf'});
 if(focus){await page.keyboard.press('s');await ready('focus');}
 const memorySamples=[];let sampling=false;
 const harness=global.HDRFinisherElectronTestHarness;
 memoryTimer=setInterval(async()=>{if(sampling)return;sampling=true;try{const r=await harness.fetch('/api/library/health');if(r.ok)memorySamples.push((await r.json()).grants);}catch{}finally{sampling=false;}},200);
 const observations=[];
 let t=Date.now();await page.keyboard.press('e');await ready('exposure');observations.push({action:'E',ms:Date.now()-t});
 if(process.argv.includes('--cancel')){
  t=Date.now();for(let i=0;i<8;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);}
  await ready('exposure');observations.push({action:'eight fast flips and recovery',ms:Date.now()-t});
 }else for(let i=0;i<3;i++){if(pace)await page.waitForTimeout(pace);t=Date.now();await page.keyboard.press('ArrowRight');await ready('exposure');observations.push({action:'next',ms:Date.now()-t});}
 assert.equal(await frame.locator('.is-developed').count(),0);assert.deepEqual(errors,[]);
 if(process.argv.includes('--canon'))for(const name of ['IMG_0114.CR2','IMG_3129.CR2']){
  const response=await harness.fetch('/api/library/overlay-map',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path.join(root,'output','test-photos',name),kind:'exposure',quality:'half',priority:30})});
  assert.equal(response.status,200);const map=await response.json();assert.ok(map.camera_frame&&map.key);assert.ok(map.width<=512&&map.height<=512);
  const png=await harness.fetch('/api/library/overlay-pixels/'+map.key);assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/png');
 }
 clearInterval(memoryTimer);
 const traceIds=requests.filter(r=>r.kind==='exposure').map(r=>r.trace);
 const lines=fs.readFileSync(path.join(harness.userDataDirectory,'logs','backend.log'),'utf8').split('\n');
 const log=lines.filter(l=>traceIds.some(id=>id&&l.includes(id)));
 const totals=lines.flatMap(line=>{try{const j=JSON.parse(line.slice(line.indexOf('{')));return typeof j.measured_total_bytes==='number'?[j.measured_total_bytes]:[];}catch{return [];}});
 const jobs=memorySamples.flat(),ceiling=jobs[0]?.ceiling,peak=totals.length?Math.max(...totals):null;
 assert.ok(peak&&ceiling,'memory measurement and live reservations must be available');
 assert.ok(jobs.some(j=>j.kind==='exposure'),'Sony RAW must use the diagnostic reservation');
 assert.ok(peak<=ceiling*1.1,`whole-app memory ${peak} exceeds protected limit ${ceiling*1.1}`);
 const result={focus,pace,observations,memory:{peak,ceiling,samples:memorySamples.length},requests,log};fs.writeFileSync(path.join(root,'output',label+'.json'),JSON.stringify(result,null,2));
 console.log('EXPOSURE_CULLING '+JSON.stringify({focus,pace,observations,memory:{peak,ceiling}}));
 console.log('PASS: cold RAW Exposure, Single/filmstrip navigation, no development or page errors.');
}finally{clearInterval(memoryTimer);await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
