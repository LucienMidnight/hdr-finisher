// Local mask tint must leave the picture when switching to the Global tab.
// Run from codebase: node tests/run-in-electron.js tools/mask-tint-global-tab.js
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const out=path.resolve('output/mask-tint-global');fs.mkdirSync(out,{recursive:true});
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
 await page.evaluate(async()=>{await syncGlobalEditState();setGradeMode('local');await assignToolToPending('hue_range');
  Object.assign(selectedMaskLeaf(),{hue_center:109,hue_width:24,hue_smoothness:41,saturation_floor:.04});
  selectedLocal().sdr_grade.exposure=1;selectedLocal().hdr_grade.exposure=1;
  if(!await commitSelectedLocal({maskContent:true}))throw Error('commit failed');
  state.localShowMask=true;invalidatePreview(state.currentView);await settlePreview(state.currentView,{});});
 await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(500);
 const clip=await page.evaluate(()=>{const r=activePreviewElement().getBoundingClientRect();return{x:r.left,y:r.top,width:Math.min(800,r.width),height:Math.min(800,r.height)};});
 const shot=async name=>{await page.screenshot({path:path.join(out,name),clip});};
 const tint=()=>page.evaluate(()=>Boolean(gpuLumaMaskOverlayOptions()));
 await shot('local-show-mask.png');const a=await tint();
 await page.evaluate(()=>setGradeMode('global'));
 await page.waitForTimeout(300);await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(500);
 await shot('global-tab.png');const b=await tint();
 await page.evaluate(()=>setGradeMode('local'));
 await page.waitForTimeout(300);await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(500);
 await shot('back-to-local.png');const c=await tint();
 console.log(JSON.stringify({tintInLocal:a,tintInGlobal:b,tintBackInLocal:c}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
