// Pass/fail: native and reduced preview versus a full-resolution scan downsized.
// Run through tests/run-in-electron.js at 2560x1440. Uses generated media and
// a disposable app profile; results go to ignored output/phase3-grain/.
// Pins the visible strength tolerance independently of equal-size parity checks.
const path = require('path');
const fs = require('fs');
const {execFileSync} = require('child_process');
const codebase = path.resolve(__dirname, '../..');
const {chromium} = require(path.join(codebase, 'node_modules/playwright'));
const work = path.resolve(codebase, '../output/phase3-grain');
fs.mkdirSync(work, {recursive:true});
const python = path.join(codebase, '.venv/Scripts/python.exe');
execFileSync(python, ['-c', `import numpy as np, tifffile, sys
h,w=1600,2400
rgb=np.full((h,w,3),0.18,np.float32)
rgb[:h//2,w//2:]=[0.03,0.03,0.03]
rgb[h//2:,:w//2]=[0.7,0.32,0.08]
rgb[h//2:,w//2:]=[1.5,1.5,1.5]
tifffile.imwrite(sys.argv[1],rgb,photometric='rgb')
tifffile.imwrite(sys.argv[1].replace('fixture','flat'),np.full((h,w,3),0.18,np.float32),photometric='rgb')`, path.join(work,'fixture.tiff')]);
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage();
 await page.addInitScript(()=>{
  const inherited=window.matchMedia.bind(window);
  window.matchMedia=q=>{ const r=inherited(q);return q==='(dynamic-range: high)'?new Proxy(r,{get(t,k){if(k==='matches')return false;const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}}):r;};
 });
 try {
  const base=process.env.HDR_FINISHER_URL;
  await page.goto(base,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>state.gpuPreview?.available);
  const records=[];
  for(const fixture of ['fixture','flat']) {
   const r=await page.request.post(`${base}/api/session`,{multipart:{file:{name:`${fixture}.tiff`,mimeType:'image/tiff',buffer:fs.readFileSync(path.join(work,`${fixture}.tiff`))}}});
   if(!r.ok())throw Error(await r.text());
   const {session}=await r.json();
   await page.evaluate(async s=>{await activateDesktopSession(s,''); await window.HDRFilmStocks.request('kodak_portra_400');},session);
   for(const lane of ['sdr','hdr']) for(const format of ['35mm','super8']) {
    await page.evaluate(async ({lane,format})=>{
     await switchLane(lane);state.previewScheduler?.cancel();
     while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
     state.adjustments[lane].film_look_section_enabled=true;
     Object.assign(state.adjustments[lane].film_look,{film_stock:'kodak_portra_400',grain_amount:100,grain_size:50,grain_film_format:format,grain_chroma:40});
     state.globalEditDirty=true;await syncGlobalEditState();
    },{lane,format});
    const recipe=await page.evaluate(()=>state.adjustments);
    const fitEdge=await page.evaluate(()=>{state.zoomMode='fit';state.previewResolutionOverride=false;return requiredProcessingLongEdge();});
    const captures=[];
    for(const edge of [...new Set([2400,fitEdge,1200])]) for(const route of ['direct','tiled']) {
     const result=await page.evaluate(async ({edge,lane,route})=>{
      state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
      state.zoomMode=edge===2400?'custom':'fit';state.zoomPercent=edge===2400?100:50;
      state.previewResolutionOverride=false;state.gpuPreview.executionOverride=route;
      const start=performance.now();
      // Call the same renderer directly: app presentation schedules a Fit catch-up
      // which can replace the requested canvas before its PNG is captured.
      const rendered=await state.gpuPreview.render(state.session.session_id,lane,
       JSON.parse(JSON.stringify(state.adjustments)),sampleCurvePoints,edge,[],
       state.editRevision,null,projectReferenceWhiteNits(),
       {width:state.session.source.width,height:state.session.source.height},
       {isCurrent:()=>true});
      if(!rendered)throw Error('render failed');
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      return {width:els.previewCanvas.width,height:els.previewCanvas.height,ms:performance.now()-start,url:els.previewCanvas.toDataURL('image/png')};
     },{edge,lane,route});
     const file=`${fixture}-${lane}-${format}-${edge}-${route}.png`;
     fs.writeFileSync(path.join(work,file),Buffer.from(result.url.split(',')[1],'base64'));
     captures.push({edge,route,file,ms:result.ms});
     console.log(`${file}: ${Math.round(result.ms)}ms`);
    }
    records.push({fixture,lane,format,fitEdge,recipe,captures});
   }
  }
  fs.writeFileSync(path.join(work,'matrix.json'),JSON.stringify(records));
 }finally{await browser.close();}
 execFileSync(python,[path.join(__dirname,'film-grain-size-reference.py')],{stdio:'inherit'});
})().catch(e=>{console.error(e);process.exitCode=1;});
