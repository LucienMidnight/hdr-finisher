// Read-only diagnostic: GPU native/reduced Fit versus actual full/half export.
// Run through tests/run-in-electron.js at 2560x1440. Uses generated media and
// a disposable app profile; results go to ignored output/phase3-grain/.
// Deliberately reports a mismatch without changing a pinned parity tolerance.
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
tifffile.imwrite(sys.argv[1],rgb,photometric='rgb')`, path.join(work,'fixture.tiff')]);
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
  const r=await page.request.post(`${base}/api/session`,{multipart:{file:{name:'fixture.tiff',mimeType:'image/tiff',buffer:fs.readFileSync(path.join(work,'fixture.tiff'))}}});
  if(!r.ok())throw Error(await r.text());
  const {session}=await r.json();
  await page.evaluate(async s=>{
   await activateDesktopSession(s,'');await switchLane('sdr');
   state.adjustments.sdr.film_look_section_enabled=true;
   Object.assign(state.adjustments.sdr.film_look,{film_stock:'kodak_portra_400',grain_amount:100,grain_size:50,grain_film_format:'35mm',grain_chroma:40});
   await window.HDRFilmStocks.request('kodak_portra_400');
   state.globalEditDirty=true;await syncGlobalEditState();
  },session);
  fs.writeFileSync(path.join(work,'recipe.json'),JSON.stringify(await page.evaluate(()=>state.adjustments)));
  const fitEdge=await page.evaluate(()=>{state.zoomMode='fit';state.previewResolutionOverride=false;return requiredProcessingLongEdge();});
  const edges=[...new Set([2400,fitEdge,1200])];
  fs.writeFileSync(path.join(work,'capture-sizes.json'),JSON.stringify({edges,fitEdge}));
  console.log(`Normal Fit processing edge: ${fitEdge}`);
  for(const edge of edges){
   const result=await page.evaluate(async edge=>{
    state.previewScheduler?.cancel();
    while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
    state.zoomMode=edge===2400?'custom':'fit';state.zoomPercent=edge===2400?100:50;
    state.previewResolutionOverride=false;
    if(!await renderGpuDraft('sdr',{longEdge:edge}))throw Error('render failed');
    await state.gpuPreview.device.queue.onSubmittedWorkDone();
    return {width:els.previewCanvas.width,height:els.previewCanvas.height,url:els.previewCanvas.toDataURL('image/png')};
   },edge);
   fs.writeFileSync(path.join(work,`gpu-${edge}.png`),Buffer.from(result.url.split(',')[1],'base64'));
   console.log(`GPU ${edge}: ${result.width}x${result.height}`);
  }
 }finally{await browser.close();}
 console.log(execFileSync(python,[path.join(__dirname,'film-grain-size-reference.py')],{encoding:'utf8',maxBuffer:4*1024*1024}));
})().catch(e=>{console.error(e);process.exitCode=1;});
