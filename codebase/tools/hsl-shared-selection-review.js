// Real-app crops of the shared HSL selection on Balanced Rock (copy; never the original).
// Run from codebase: node tests/run-in-electron.js tools/hsl-shared-selection-review.js [--local] [--lanes sdr,hdr]
// Global: Yellow 15/21 deg, +0.80 EV. Local: hue 109, +/-24, smoothness 41, neutrals 4%,
// Local Exposure +1.05 EV (and --match: 15/21 to compare with Global).
// States per crop: off (HSL / local disabled), before (old per-pixel route), after (shared selection).
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const out=path.resolve('output/hsl-smoothing-built');fs.mkdirSync(out,{recursive:true});
const local=process.argv.includes('--local'),match=process.argv.includes('--match');
const lanes=(process.argv[process.argv.indexOf('--lanes')+1]||'sdr').split(',');
const zooms=[100,272,527],regions={bush:[.15,.60],flowers:[.62,.57]};
const scope=local?(match?'local15':'local'):'global';
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView
 &&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage();const log=[];try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
 await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 const photo=path.join(out,'IMG_0114.CR2');
 if(!fs.existsSync(photo))fs.copyFileSync('D:/Photos/Play_Raw/Balanced Rock in Arches Nat Park - LaurentFromSF/IMG_0114.CR2',photo);
 await page.evaluate(async photo=>{const grant=await desktop.grantSourcePath(photo);const c=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=c.payload;
  while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
  if(job.state!=='ready')throw Error(JSON.stringify(job));await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');activateWorkflowTab('grade');},photo);
 await page.waitForFunction(settled,null,{timeout:180000});
 if(local)await page.evaluate(async match=>{await syncGlobalEditState();setGradeMode('local');await assignToolToPending('hue_range');
  Object.assign(selectedMaskLeaf(),{hue_center:109,hue_width:match?15:24,hue_smoothness:match?21:41,saturation_floor:match?.02:.04});
  selectedLocal().sdr_grade.exposure=1.05;selectedLocal().hdr_grade.exposure=1.05;
  if(!await commitSelectedLocal({maskContent:true}))throw Error('Local mask commit failed');state.localShowMask=false;},match);
 else await page.evaluate(async()=>{for(const lane of ['sdr','hdr']){const b=state.adjustments[lane],r=b.hsl.channels.find(c=>c.id==='yellow').recipe;
  r.ranges[0].width=15;r.ranges[0].feather=21;r.luminance=.8;r.uniformity=0;r.opacity=1;b.hsl_section_enabled=true;}
  state.globalEditDirty=true;await syncGlobalEditState();});
 const setState=async(lane,mode)=>{await page.evaluate(async({lane,mode,local})=>{
   globalThis.HDRHslSharedSelection=mode!=='before';globalThis.HDRHueMaskSharedSelection=mode!=='before';
   if(local){selectedLocal().enabled=mode!=='off';await commitSelectedLocal();}
   else{state.adjustments[lane].hsl_section_enabled=mode!=='off';state.globalEditDirty=true;await syncGlobalEditState();}
   invalidatePreview(lane);await settlePreview(lane,{});},{lane,mode,local});
  await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(400);};
 for(const lane of lanes){
  await page.evaluate(async lane=>{await switchLane(lane);invalidatePreview(lane);await settlePreview(lane,{});},lane);
  for(const zoom of zooms){
   await page.evaluate(zoom=>setCustomZoom(zoom),zoom);await page.waitForFunction(settled,null,{timeout:180000});
   for(const [region,[x,y]] of Object.entries(regions)){
    await page.evaluate(([x,y])=>{const image=activePreviewElement().getBoundingClientRect(),view=els.dropzone.getBoundingClientRect();
     els.dropzone.scrollLeft+=image.left+x*image.width-(view.left+view.width/2);els.dropzone.scrollTop+=image.top+y*image.height-(view.top+view.height/2);},[x,y]);
    await page.waitForTimeout(300);
    for(const mode of ['off','before','after']){
     await setState(lane,mode);
     const clip=await page.evaluate(()=>{const v=els.dropzone.getBoundingClientRect(),i=activePreviewElement().getBoundingClientRect();
      const l=Math.max(v.left,i.left),t=Math.max(v.top,i.top),r=Math.min(v.right,i.right),b=Math.min(v.bottom,i.bottom);
      const cx=Math.round((l+r)/2),cy=Math.round((t+b)/2);return{x:cx-256,y:cy-256,width:512,height:512};});
     const name=`${scope}-${lane}-${region}-${zoom}-${mode}.png`;await page.screenshot({path:path.join(out,name),clip});
     const info=await page.evaluate(()=>({execution:state.acceptedPresentation?.execution||null,zoom:state.zoomPercent??null,hueMasks:[...state.gpuPreview.localMasks.values()].filter(e=>e.kind==='gpu-hue'&&!e.destroyed).map(e=>`${e.width}x${e.height}`),
      engines:[...(state.gpuPreview.hslSelectionEngines?.values()||[])].flatMap(o=>Object.entries(o).map(([k,e])=>`${k}:${e.capacity?.width}x${e.capacity?.height}`))}));
     log.push({name,...info});console.log(name,JSON.stringify(info));
    }
   }
  }
 }
}finally{fs.writeFileSync(path.join(out,`${scope}-log.json`),JSON.stringify(log,null,1));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
