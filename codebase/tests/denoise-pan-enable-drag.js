// Isolated 42 MP regression for pan -> enable -> Exposure drag, and warmed zoom.
// node tests/run-in-electron.js tests/denoise-pan-enable-drag.js [--project <path>]
// The optional project is opened read-only and never saved. Only this runner's
// disposable application window is closed.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {ensureLargeNoisySource} = require('./large-noisy-tiff.js');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch();
 const page = await browser.newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.stack || e.message));
 const models=[]; page.on('request',r=>{if(r.url().includes('/denoise-model/'))models.push({url:r.url(),at:Date.now()});});
 page.on('response',r=>{if(r.url().includes('/denoise-model/'))models.push({response:r.url(),status:r.status(),at:Date.now()});});
 try {
  await page.goto(process.env.HDR_FINISHER_URL, {waitUntil:'networkidle'});
  const input = process.argv.indexOf('--project');
  if(input >= 0) await page.evaluate(async target => openProjectFromPath(await desktop.grantProjectPath(target,'project-open')), process.argv[input+1]);
  else await page.setInputFiles('#file-input', ensureLargeNoisySource(7968,5320));
  const settle = async () => {
   await page.waitForTimeout(500);
   await page.waitForFunction(() => viewerState().status === 'ready' && !state.gpuDraftInFlight && !state.zoomRefinementTimer && !state.renderCoordinator.state(state.currentView).inFlight && !state.renderCoordinator.state(state.currentView).pending, null, {timeout:300000});
   await page.evaluate(() => state.gpuPreview.waitForSubmittedWork());
  };
  await page.waitForFunction(() => state.session && state.gpuPreview?.available, null, {timeout:300000});
  await settle();
  await page.evaluate(() => {activateWorkflowTab('grade'); setCustomZoom(100);});
  await settle();
  await page.evaluate(() => {
   window.trace = [];
   const note = (type, data) => trace.push({at:performance.now(),type,...data});
   for (const name of ['analyzeDenoiseProxy','loadProxy','loadRegionProxy','render','resolveDenoiseProxy']) {
    const original = state.gpuPreview[name]; if (!original) continue;
    state.gpuPreview[name] = async function(...args) {
     note(name+' start', {edge:typeof args[2] === 'number' ? args[2] : null});
     try {const value = await original.apply(this,args); note(name+' end',{}); return value;} catch(e) {note(name+' error',{message:e.message}); throw e;}
    };
   }
   const original = recalculateDenoise;
   recalculateDenoise = async function(...args) {note('recalculate start',{options:args[1]}); const value = await original(...args); note('recalculate end',{value}); return value;};
   window.addEventListener('hdrfinisher:preview-presented', e => note('present',e.detail));
   window.HDRFinisherPerformance.enableGpuInstrumentation(true);
  });
  const results=[];
  for (const disableCatchUp of [false,true]) {
   if (disableCatchUp) await page.evaluate(() => state.renderCoordinator.canCatchUp = () => false);
   await page.evaluate(() => {trace.length=0; els.dropzone.scrollLeft += 250; els.dropzone.scrollTop += 180; els.dropzone.dispatchEvent(new Event('scroll')); void setDenoiseEnabled(true);});
   await page.waitForTimeout(30);
   await page.evaluate(async () => {
    const control=document.querySelector('[data-path="hdr.exposure"]');
    window.dragAt=performance.now(); trace.push({type:'drag',at:dragAt});
    control.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'mouse',buttons:1,isPrimary:true}));
    for(let i=0;i<60;i++) {control.value=String(i/60);control.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,16));}
    window.dragEnd=performance.now();
   });
   await page.waitForTimeout(3500);
   const result=await page.evaluate(() => ({trace,refusals:state.gpuDraftRefusals,dragAt,dragEnd}));
   const frames=result.trace.filter(x=>x.type==='present'&&x.at>result.dragAt&&x.at<=result.dragEnd);
   const firstFrameMs=frames[0]?.at-result.dragAt;
   assert(firstFrameMs < 1000, `First drag frame took ${firstFrameMs} ms (catch-up disabled: ${disableCatchUp}).`);
   assert(frames.length >= 10, `Only ${frames.length} frames were shown during 60 drag inputs.`);
   assert(result.trace.filter(x=>x.type==='analyzeDenoiseProxy start').length <= 1, 'Repeated denoise setup during one enable/drag.');
   results.push({disableCatchUp,firstFrameMs,framesDuringDrag:frames.length,trace:result.trace,refusals:result.refusals});
   console.log(JSON.stringify({disableCatchUp,firstFrameMs:result.trace.find(x=>x.type==='present'&&x.at>result.dragAt)?.at-result.dragAt,analyses:result.trace.filter(x=>x.type==='analyzeDenoiseProxy start').length,frames:result.trace.filter(x=>x.type==='present'&&x.at>result.dragAt).length}));
   await page.evaluate(() => {const c=document.querySelector('[data-path="hdr.exposure"]');c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true}));c.dispatchEvent(new Event('change',{bubbles:true}));});
   await settle();
   await page.evaluate(() => setDenoiseEnabled(false)); await settle();
  }
  // Fit setup starts the native model in the background. Waiting for that
  // model before the first subsequent zoom should leave only region rendering.
  await page.evaluate(() => setZoomMode('fit')); await settle();
  await page.evaluate(() => setDenoiseEnabled(true)); await settle();
  const warmed=await page.evaluate(() => state.gpuPreview.warmDenoiseModel(state.session.session_id,'hdr',Math.max(state.session.source.width,state.session.source.height)));
  assert(warmed, 'The native model warm-up did not complete successfully.');
  await page.evaluate(() => {trace.length=0;window.zoomAt=performance.now();setCustomZoom(100);});
  await settle();
  const zoom=await page.evaluate(() => {
   const edge=Math.max(state.session.source.width,state.session.source.height);
   const first=trace.find(x=>x.type==='present'&&x.longEdge===edge&&x.at>=zoomAt);
   return {firstFrameMs:first?.at-zoomAt,status:state.denoiseRuntime.hdr.status,processedLongEdge:state.acceptedPresentation.processedLongEdge,native:edge};
  });
  assert(zoom.firstFrameMs < 1000, `Warmed zoom took ${zoom.firstFrameMs} ms.`);
  assert.equal(zoom.status,'ready');assert.equal(zoom.processedLongEdge,zoom.native);
  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({warmedZoom:zoom}));
  results.push({warmedZoom:zoom});
  fs.mkdirSync('output/performance',{recursive:true});fs.writeFileSync('output/performance/denoise-pan-enable-drag.json',JSON.stringify(results,null,2));fs.writeFileSync('output/performance/denoise-model-requests.json',JSON.stringify(models,null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});