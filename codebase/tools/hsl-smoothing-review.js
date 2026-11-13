// Run from codebase: node tests/run-in-electron.js tools/hsl-smoothing-review.js --after
// Uses a disposable profile and a copy of the source; never edits the original photo.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const out=path.resolve('output/hsl-smooth');fs.mkdirSync(out,{recursive:true});
const tag=process.argv.includes('--after')?'after':'before';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage();try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
 await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 const photo=path.join(out,'IMG_0114.CR2');if(!fs.existsSync(photo))fs.copyFileSync(require('../tests/helpers/photos-root.cjs').photosPath('D:/Photos/Play_Raw/Balanced Rock in Arches Nat Park - LaurentFromSF/IMG_0114.CR2'),photo);
 await page.evaluate(async photo=>{const grant=await desktop.grantSourcePath(photo);const c=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=c.payload;while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}if(job.state!=='ready')throw Error(JSON.stringify(job));await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');activateWorkflowTab('grade');},photo);
 await page.waitForFunction(()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView&&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready',null,{timeout:180000});
 for(const lane of ['sdr','hdr']){
  await page.evaluate(async lane=>{await switchLane(lane);const branch=state.adjustments[lane];const r=branch.hsl.channels.find(c=>c.id==='yellow').recipe;r.ranges[0].width=15;r.ranges[0].feather=21;r.luminance=.8;r.uniformity=0;r.opacity=1;branch.hsl_section_enabled=true;state.globalEditDirty=true;await syncGlobalEditState();hslUI.panels[0].channel='yellow';document.querySelector('[data-group="hsl"]').classList.remove('collapsed');renderHslPanels();invalidatePreview(lane);await settlePreview(lane,{});},lane);
  for(const zoom of [100,272]){
   await page.evaluate(zoom=>setCustomZoom(zoom),zoom);
   await page.waitForFunction(()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView&&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready',null,{timeout:180000});
   for(const region of ['bush','flowers']){
    await page.evaluate(region=>{const image=activePreviewElement().getBoundingClientRect(),view=els.dropzone.getBoundingClientRect();const x=region==='bush'?.15:.62,y=.60;els.dropzone.scrollLeft+=image.left+x*image.width-(view.left+view.width/2);els.dropzone.scrollTop+=image.top+y*image.height-(view.top+view.height/2);},region);
    await page.waitForTimeout(500);
    for(const enabled of [true,false]){
     await page.evaluate(async({lane,enabled})=>{state.adjustments[lane].hsl_section_enabled=enabled;state.globalEditDirty=true;await syncGlobalEditState();invalidatePreview(lane);await settlePreview(lane,{});}, {lane,enabled});
     await page.waitForFunction(()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView&&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready',null,{timeout:180000});
     await page.screenshot({path:path.join(out,`part2-${tag}-${lane}-${zoom}-${region}-${enabled?'on':'bypass'}.png`)});
     console.log(lane,zoom,region,enabled?'on':'bypass');
    }
   }
  }
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
