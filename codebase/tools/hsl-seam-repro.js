// Reproduce Steve's horizontal line: Balanced Rock (copy), SDR, Yellow 15/21 Luminance -2 EV, 423% on the bush.
// Run from codebase: node tests/run-in-electron.js tools/hsl-seam-repro.js
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const out=path.resolve('output/hsl-seam');fs.mkdirSync(out,{recursive:true});
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView
 &&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage();try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
 await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 const photo=path.resolve('output/hsl-smoothing-built/IMG_0114.CR2');
 await page.evaluate(async photo=>{const grant=await desktop.grantSourcePath(photo);const c=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=c.payload;
  while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
  if(job.state!=='ready')throw Error(JSON.stringify(job));await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');activateWorkflowTab('grade');},photo);
 await page.waitForFunction(settled,null,{timeout:180000});
 await page.evaluate(async()=>{await switchLane('sdr');const b=state.adjustments.sdr,r=b.hsl.channels.find(c=>c.id==='yellow').recipe;
  r.ranges[0].width=15;r.ranges[0].feather=21;r.luminance=-2;r.uniformity=0;r.opacity=1;b.hsl_section_enabled=true;
  state.globalEditDirty=true;await syncGlobalEditState();});
 await page.evaluate(()=>setCustomZoom(423));await page.waitForFunction(settled,null,{timeout:180000});
 await page.evaluate(([x,y])=>{const image=activePreviewElement().getBoundingClientRect(),view=els.dropzone.getBoundingClientRect();
  els.dropzone.scrollLeft+=image.left+x*image.width-(view.left+view.width/2);els.dropzone.scrollTop+=image.top+y*image.height-(view.top+view.height/2);},[.37,.58]);
 await page.waitForTimeout(500);
 const clip=await page.evaluate(()=>{const r=els.dropzone.getBoundingClientRect();return{x:r.left,y:r.top,width:Math.floor(r.width)-20,height:Math.floor(r.height)-20};});
 for(const mode of ['on','off','before']){
  await page.evaluate(async mode=>{globalThis.HDRHslSharedSelection=mode!=='before';state.adjustments.sdr.hsl_section_enabled=mode!=='off';
   state.globalEditDirty=true;await syncGlobalEditState();invalidatePreview('sdr');await settlePreview('sdr',{});},mode);
  await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(600);
  await page.screenshot({path:path.join(out,`${mode}.png`),clip});
  const info=await page.evaluate(()=>({execution:state.acceptedPresentation?.execution,zoom:state.zoomPercent,
   stages:(state.gpuPreview.stageLog||state.gpuPreview.stages||[]).slice?.(-6)}));
  console.log(mode,JSON.stringify(info));
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
