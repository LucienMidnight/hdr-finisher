// Reuse shared RAWs in a fresh Electron profile; never copy or alter originals.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output','test-photos','badminton-42mp');
const focus=process.argv.includes('--focus'),label=process.env.EXPOSURE_CULLING_LABEL||'exposure-culling';
assert.match(label,/^[a-z0-9-]+$/i);
(async()=>{const browser=await chromium.launch({headless:true});try{
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
 const observations=[];
 let t=Date.now();await page.keyboard.press('e');await ready('exposure');observations.push({action:'E',ms:Date.now()-t});
 for(let i=0;i<3;i++){t=Date.now();await page.keyboard.press('ArrowRight');await ready('exposure');observations.push({action:'next',ms:Date.now()-t});}
 assert.equal(await frame.locator('.is-developed').count(),0);assert.deepEqual(errors,[]);
 const traceIds=requests.filter(r=>r.kind==='exposure').map(r=>r.trace);
 const log=fs.readFileSync(path.join(global.HDRFinisherElectronTestHarness.userDataDirectory,'logs','backend.log'),'utf8').split('\n').filter(l=>traceIds.some(id=>id&&l.includes(id)));
 const result={focus,observations,requests,log};fs.writeFileSync(path.join(root,'output',label+'.json'),JSON.stringify(result,null,2));
 console.log('EXPOSURE_CULLING '+JSON.stringify({focus,observations}));
 console.log('PASS: cold RAW Exposure, Single/filmstrip navigation, no development or page errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
