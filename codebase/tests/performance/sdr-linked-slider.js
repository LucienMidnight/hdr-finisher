/* Whole action-to-exact-current-picture timing, both link states on the same Mac/source.
 * --before restores only the former eager pre-Film WGSL branch evaluation. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');const platform=require('../../tools/lib/platform.cjs');
const before=process.argv.includes('--before');
const output=path.resolve('output/performance/safe-link');fs.mkdirSync(output,{recursive:true});
const fixture=path.resolve('output/test-photos/safe-link-24mp.tiff');
if(!fs.existsSync(fixture))execFileSync(platform.pythonExecutable(),['-c',`import tifffile,numpy as np,sys
s=tifffile.imread('tests/fixtures/hdr_match_scene.tiff').astype(np.float32)
tifffile.imwrite(sys.argv[1],np.repeat(np.repeat(s,50,axis=0),47,axis=1),photometric='rgb')`,fixture]);
(async()=>{
 const browser=await chromium.launch();const report={date:new Date().toISOString(),before,rows:[],checks:[],revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:'24.064MP deterministic repeated HDR scene; normal slider input/change or HDR control commit while viewing linked SDR; exact current generation plus two animation frames; source preparation excluded; Film Portra 400 at 50%, grain/halation off. Before uses the former eager WGSL prefix, all other code/source identical.'};
 try{
  const [width,height]=platform.machineSettings().windowSize.split('x').map(Number);
  const page=await browser.newPage({viewport:{width,height}});
  if(before){
   const source=fs.readFileSync('frontend/webgpu-shaders.js','utf8');
   const old='      if (p[${GPU_PARAMS.HDR_LANE}] > 0.5) { return vec4f(renderHdrBase(source), 1.0); }\n      return vec4f(renderSdrBase(source), 1.0);';
   if(!source.includes(old))throw Error('Before branch is not available');
   await page.route('**/static/webgpu-shaders.js*',route=>route.fulfill({contentType:'application/javascript',body:source.replace(old,'      let output = select(renderSdrBase(source), renderHdrBase(source), p[${GPU_PARAMS.HDR_LANE}] > 0.5);\n      return vec4f(output, 1.0);')}));
  }
  await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');await page.waitForFunction(()=>state.gpuPreview?.available);
  await page.setInputFiles('#file-input',fixture);
  await page.waitForFunction(()=>state.session&&!state.importInProgress,null,{timeout:120000});
  const {resolveInterpretation}=require('../helpers/resolve-interpretation.js');await resolveInterpretation(page);
  const stable=async()=>{
   await page.waitForFunction(()=>{const a=state.acceptedPresentation;return a?.lane==='sdr'&&a.exact&&a.generation===state.previewGeneration.sdr&&!state.gpuDraftInFlight&&!state.globalEditSyncPending&&viewerState().status==='ready';},null,{timeout:45000});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  await page.evaluate(async()=>{
   for(const lane of ['hdr','sdr']){Object.assign(state.adjustments[lane].film_look,{film_stock:'kodak_portra_400',look_strength:50,grain_amount:0,halation_amount:0});}
   markGlobalEditDirty();await syncGlobalEditState();await switchLane('sdr');
   for(const group of ['sdr-tone','film-look'])document.querySelector(`[data-group="${group}"]`)?.classList.remove('collapsed');
  });await stable();
  report.conditions=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,source:state.session.source,previewResolution:state.previewResolution,processing:requiredProcessingLongEdge()}));
  const action=async(path,value)=>{
   const start=await page.evaluate(({path,value})=>{
    const t=performance.now();
    const control=document.querySelector(`[data-path="${path}"]`);
    if(control){control.value=String(value);control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));}
    else commitAdjustmentValue(path,value,{manual:true});
    return t;
   },{path,value});
   await stable();return page.evaluate(t=>performance.now()-t,start);
  };
  for(const linked of [false,true]){
   if(linked){
    const matched=await page.evaluate(()=>setSdrMatch());
    if(!matched||!await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr))throw Error('Performance photo did not safely link');
    await stable();
   }
   const measuredPath=linked?'hdr.exposure':'sdr.exposure';
   await action(measuredPath,.1);await action(measuredPath,0);
   const times=[];
   for(const value of [.2,0,.2,0])times.push(await action(measuredPath,value));
   report.rows.push({linked,path:measuredPath,ms:times,median:[...times].sort((a,b)=>a-b).slice(1,3).reduce((a,b)=>a+b)/2});
   if(linked&&!await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr))throw Error('Timing edit unexpectedly unlinked');
  }
 }finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(output,before?'controlled-before.json':'controlled-after.json'),JSON.stringify(report,null,2));await browser.close();}
 console.log(report.rows);
})().catch(e=>{console.error(e);process.exitCode=1;});
