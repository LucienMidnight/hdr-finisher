// Run through tests/run-in-electron.js at 2560x1440 with a fresh disposable
// profile. Only output/test-photos/20260214 is opened; copy originals there
// once for this task, then remove those copies and the test profile afterwards.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {hashProjects,checkProjects}=require('../tests/release/runner.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/jpeg-loop');
const photos=path.join(root,'output/test-photos/20260214').replaceAll('\\','/');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const before=hashProjects(require('../tests/release/drivers.json').protectedProjects);
 const browser=await chromium.launch();const report={errors:[]};
 try{
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
  await lib.evaluate(()=>{
   window.openEvidence=[];const log=HDRLibraryStopwatch;
   window.HDRLibraryStopwatch=(stage,fields)=>{openEvidence.push({stage,at:performance.now(),...fields});log(stage,fields);};
   const slider=document.getElementById('thumbnail-size');slider.value=240;slider.dispatchEvent(new Event('input'));
  });
  await lib.evaluate(folder=>HDRLibrary.browse(folder),photos);
  await lib.waitForFunction(()=>!HDRLibrary.getSnapshot().reading&&HDRLibrary.getSnapshot().count===18,null,{timeout:20000});
  await lib.waitForFunction(()=>document.querySelectorAll('#grid-space canvas[data-picture-key]').length===18||document.querySelectorAll('#grid-space .picture-failed').length>0,null,{timeout:60000}).catch(e=>report.waitError=String(e));
  await sleep(500);
  Object.assign(report,await lib.evaluate(()=>({snapshot:HDRLibrary.getSnapshot(),events:openEvidence,queue:HDRLibraryScenes.snapshot(),cells:[...document.querySelectorAll('#grid-space .library-cell')].map(c=>({path:c.dataset.path,presented:!!c.querySelector('canvas[data-picture-key]'),error:c.querySelector('.library-picture-error')?.title}))})));
  report.results=report.snapshot.paths.map(photo=>{
   const same=e=>e.path===photo;
   const requests=report.events.filter(e=>same(e)&&e.stage==='navigation'&&e.view==='grid');
   const presented=report.events.filter(e=>same(e)&&e.stage==='picture_navigation_to_present'&&e.view==='grid');
   const presents=presented.filter(e=>e.picture_size==='thumbnail');
   const placeholders=presented.filter(e=>e.picture_size==='camera preview');
   return {photo:photo.slice(photos.length+1),attempts:report.events.filter(e=>same(e)&&e.stage==='picture_development_admitted').length,requestToPresentationMs:presents.map(e=>({request:e.request,ms:e.duration_ms})),cameraPreviewMs:placeholders.map(e=>e.duration_ms),requests:requests.length,failures:report.events.filter(e=>same(e)&&/development_(failed|restart|outcome)$/.test(e.stage)).map(e=>({stage:e.stage,reason:e.reason}))};
  });
  console.log(JSON.stringify(report.results,null,2));
  await page.screenshot({path:path.join(out,'folder.png')});
  assert.equal(report.cells.filter(c=>c.presented).length,18,'All 18 grid cells must present');
  assert.ok(report.results.every(r=>r.attempts===1&&r.requestToPresentationMs.length===1&&!r.failures.length),'Every photo develops once without restarts');
  assert.deepEqual(report.errors,[]);
 }catch(e){report.error=String(e.stack||e);process.exitCode=1;}
 finally{
  checkProjects(before);report.protectedProjectsUnchanged=true;
  const log=path.join(process.env.HDR_FINISHER_USER_DATA_DIR||process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA||'','logs/backend.log');if(fs.existsSync(log))fs.copyFileSync(log,path.join(out,'backend.log'));
  fs.writeFileSync(path.join(out,'folder.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'cell-timings.csv'),'photo,development_attempts,camera_preview_ms,request_to_finished_presentation_ms,failures\n'+(report.results||[]).map(r=>[r.photo,r.attempts,r.cameraPreviewMs.map(v=>v.toFixed(1)).join(';'),r.requestToPresentationMs.map(v=>v.ms.toFixed(1)).join(';'),r.failures.map(e=>e.reason).join(';')].join(',')).join('\n')+'\n');
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
