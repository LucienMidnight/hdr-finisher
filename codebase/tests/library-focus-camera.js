// Fresh-profile RAW culling: reuse shared photos, never copy or modify them.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const folder=process.env.LIBRARY_FOCUS_CAMERA_FOLDER||path.join(root,'output','test-photos','badminton-42mp');
assert.ok(fs.existsSync(folder),'Reuse badminton-42mp, or set LIBRARY_FOCUS_CAMERA_FOLDER; this driver never copies RAWs.');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[],requests=[],responses=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/library/overlay-map'))requests.push({...r.postDataJSON(),at:Date.now()});});
 page.on('response',async r=>{if(r.url().endsWith('/api/library/overlay-map')){try{responses.push({request:r.request().postDataJSON(),map:await r.json(),at:Date.now()});}catch{}}});
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.evaluate(()=>activateWorkflowTab('import'));
 const host=page.locator('#library-frame'),frame=page.frameLocator('#library-frame');
 await host.evaluate((e,p)=>e.contentWindow.HDRLibrary.browse(p),folder);
 await frame.locator('.library-cell[data-path] canvas[data-picture-key^="original:"]').first().waitFor({timeout:120000});
 const expected=fs.readdirSync(folder).filter(n=>/\.(arw|cr2|cr3|nef|nrw|raf|rw2|orf|dng)$/i.test(n)).length;assert.ok(expected>=10,'need ten RAWs for navigation');
 if(!process.env.LIBRARY_FOCUS_CAMERA_EARLY)await page.waitForFunction(n=>{const s=document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot();return s.paths.length>=n&&!s.reading;},expected,{timeout:120000});
 await frame.locator('.library-cell[data-path]').first().click();await frame.locator('#single-view').click();
 await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.querySelector('#single-picture[data-camera-preview="true"]:not([hidden])'),null,{timeout:120000});
 const ready=()=>page.waitForFunction(()=>{const w=document.querySelector('#library-frame').contentWindow,s=w.HDRLibrary.getSnapshot(),d=w.document,p=d.querySelector('#single-picture:not([hidden])'),l=d.querySelector('#single-stage .library-source-overlay[data-kind="focus"][data-key]:not([hidden])');return p?.dataset.picturePath===s.selected&&l?.dataset.quality==='camera'&&s.overlays.maps.some(m=>m.path===s.selected&&m.kind==='focus'&&m.quality==='camera'&&m.ready);},null,{timeout:30000,polling:'raf'});
 const profile=global.HDRFinisherElectronTestHarness?.userDataDirectory;
 assert.ok(profile,'run through run-in-electron.js for a fresh isolated profile');
 const mapsIn=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?mapsIn(path.join(dir,e.name)):e.name.endsWith('.map.npz')?[e.name]:[]);
 assert.deepEqual(mapsIn(profile),[],'camera maps must not exist before S');
 const timings=[];
 const selected=()=>host.evaluate(e=>e.contentWindow.HDRLibrary.getSnapshot().selected);
 let start=Date.now();await page.keyboard.press('s');await ready();timings.push({action:'S',ms:Date.now()-start,photo:path.basename(await selected())});
 for(let i=0;i<6;i++){await page.waitForTimeout(160);start=Date.now();await page.keyboard.press('ArrowRight');await ready();timings.push({action:'next',ms:Date.now()-start,photo:path.basename(await selected())});}
 await page.keyboard.press('f');
 for(let i=0;i<3;i++){await page.waitForTimeout(160);start=Date.now();await page.keyboard.press('ArrowRight');await ready();timings.push({action:'fullscreen next',ms:Date.now()-start,photo:path.basename(await selected())});}
 assert.equal(new Set(timings.map(r=>r.photo)).size,10,'each navigation must show a different photo');
 const snap=await host.evaluate(e=>e.contentWindow.HDRLibrary.getSnapshot()),last=snap.selected;
 const firstCamera=responses.filter(r=>r.request.quality==='camera'&&r.map.key);
 const nativeBeforePause=requests.filter(r=>r.quality==='full'&&!r.cache_only);
 console.log('CAMERA_COLD_CULLING '+JSON.stringify({timings,cameraMaps:firstCamera.map(r=>({path:path.basename(r.request.path),cache:!!r.map.cache_hit,make_ms:r.map.make_ms})),nativeBeforePause}));
 assert.equal(nativeBeforePause.length,0,'rapid navigation should not start native refinement');
 assert.ok(firstCamera.length>=2,'must generate uncached maps in a fresh profile');
 // API revalidates the published cache even after a cold build; cache_hit is not a coldness signal.
 const currentCamera=responses.find(r=>r.request.path===last&&r.request.quality==='camera'&&r.map.key);
 await frame.locator('#single-stage .library-source-overlay[data-kind="focus"][data-quality="full"]').waitFor({timeout:120000});
 const refinement=requests.find(r=>r.path===last&&r.quality==='full'&&!r.cache_only);
 assert.ok(refinement&&currentCamera&&refinement.at-currentCamera.at>=900,'native refinement must wait for dwell after quick map');
 assert.equal(await frame.locator('.is-developed').count(),0,'Focus must not develop a photo');
 assert.deepEqual(errors,[]);
 console.log('PASS: cold camera maps, filmstrip/fullscreen navigation cancellation, delayed native refinement, no development.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
