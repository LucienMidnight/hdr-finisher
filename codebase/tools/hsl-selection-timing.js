// Real-app timings for the shared HSL selection (copies of the photos; never the originals).
// node tests/run-in-electron.js tools/hsl-selection-timing.js <photo> [--local]
// Settled-render seconds at Fit and 100% for: HSL off, first preparation, a range
// change, an HSL slider change (selection reused), and the old per-pixel route.
// Then a 2 s mouse drag on the HSL Luminance (or Local Exposure) slider: frames shown.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const out=path.resolve('output/hsl-smoothing-built/timing');fs.mkdirSync(out,{recursive:true});
const source=process.argv.find(a=>/\.(arw|cr2|cr3|nef|dng)$/i.test(a)),local=process.argv.includes('--local');
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView
 &&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage(),result={photo:path.basename(source),local,views:{}};try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
 await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 const photo=path.join(out,path.basename(source));if(!fs.existsSync(photo))fs.copyFileSync(source,photo);
 await page.evaluate(async photo=>{const grant=await desktop.grantSourcePath(photo);const c=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=c.payload;
  while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
  if(job.state!=='ready')throw Error(JSON.stringify(job));await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');activateWorkflowTab('grade');await switchLane('sdr');},photo);
 await page.waitForFunction(settled,null,{timeout:300000});
 result.size=await page.evaluate(()=>state.session&&[state.session.width,state.session.height]);
 // One timed settle: apply a change, re-render, wait for the exact frame.
 const timed=async(change)=>page.evaluate(async({change,local})=>{
  const t=performance.now();
  const leaf=local?selectedMaskLeaf():null,b=state.adjustments.sdr,r=b.hsl.channels.find(c=>c.id==='yellow').recipe;
  ({shared:()=>{globalThis.HDRHslSharedSelection=true;globalThis.HDRHueMaskSharedSelection=true;},
    old:()=>{globalThis.HDRHslSharedSelection=false;globalThis.HDRHueMaskSharedSelection=false;},
    off:()=>{if(local)selectedLocal().enabled=false;else b.hsl_section_enabled=false;},
    on:()=>{if(local)selectedLocal().enabled=true;else b.hsl_section_enabled=true;},
    range:()=>{if(local)leaf.hue_width+=1;else r.ranges[0].width+=1;},
    slider:()=>{if(local)selectedLocal().sdr_grade.exposure+=.05;else r.luminance-=.05;},
    above:()=>{b.exposure=(b.exposure||0)+.05;}})[change]();
  if(local)await commitSelectedLocal({maskContent:change==='range'});else{state.globalEditDirty=true;await syncGlobalEditState();}
  invalidatePreview('sdr');await settlePreview('sdr',{});
  while(!(state.acceptedPresentation?.exact&&state.acceptedPresentation.generation===state.previewGeneration.sdr&&viewerState().status==='ready'))await new Promise(r=>setTimeout(r,10));
  return +((performance.now()-t)/1000).toFixed(3);},{change,local});
 if(local)await page.evaluate(async()=>{await syncGlobalEditState();setGradeMode('local');await assignToolToPending('hue_range');
  Object.assign(selectedMaskLeaf(),{hue_center:109,hue_width:24,hue_smoothness:41,saturation_floor:.04});selectedLocal().sdr_grade.exposure=1.05;
  if(!await commitSelectedLocal({maskContent:true}))throw Error('Local mask commit failed');state.localShowMask=false;});
 else await page.evaluate(async()=>{const b=state.adjustments.sdr,r=b.hsl.channels.find(c=>c.id==='yellow').recipe;
  r.ranges[0].width=15;r.ranges[0].feather=21;r.luminance=.8;r.uniformity=0;r.opacity=1;b.hsl_section_enabled=false;state.globalEditDirty=true;await syncGlobalEditState();});
 for(const view of ['fit',100]){
  await page.evaluate(view=>view==='fit'?setZoomMode('fit'):setCustomZoom(view),view);
  await page.waitForFunction(settled,null,{timeout:300000});
  const v={};
  await timed('shared');if(local)await timed('off');
  v.off_s=await timed('slider');                       // effect disabled: baseline settle
  v.first_preparation_s=await timed('on');            // selection built for this view
  v.range_change_s=[await timed('range'),await timed('range'),await timed('range')];
  v.slider_change_s=[await timed('slider'),await timed('slider'),await timed('slider')];
  v.upstream_change_s=await timed('above');
  await timed('old');
  v.old_range_change_s=[await timed('range'),await timed('range')];
  v.old_slider_change_s=[await timed('slider'),await timed('slider')];
  await timed('shared');
  v.execution=await page.evaluate(()=>state.acceptedPresentation?.execution);
  result.views[view]=v;console.log(view,JSON.stringify(v));
 }
 // Drag liveness at Fit: frames accepted during a 2 s drag on the real slider.
 await page.evaluate(()=>setZoomMode('fit'));await page.waitForFunction(settled,null,{timeout:300000});
 for(const route of ['shared','old']){
  await page.evaluate(route=>{globalThis.HDRHslSharedSelection=route==='shared';globalThis.HDRHueMaskSharedSelection=route==='shared';},route);
  const slider=local?page.locator('#local-exposure')
   :page.locator('#hsl-global-panel').getByRole('slider',{name:'HSL Luminance',exact:true});
  if(!local)await page.evaluate(()=>{document.querySelector('[data-group="hsl"]').classList.remove('collapsed');hslUI.panels[0].channel='yellow';renderHslPanels();});
  await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();if(!box)throw Error('Slider not visible');
  await page.evaluate(()=>{window.__frames=[];let last=null;window.__poll=setInterval(()=>{const a=state.acceptedPresentation;if(a&&a!==last){last=a;window.__frames.push(performance.now());}},5);});
  const y=box.y+box.height/2,x0=box.x+box.width*.55;await page.mouse.move(x0,y);await page.mouse.down();
  const t0=Date.now();let i=0;while(Date.now()-t0<2000){await page.mouse.move(x0+Math.sin(i++/6)*box.width*.25,y);await page.waitForTimeout(16);}
  await page.mouse.up();
  const frames=await page.evaluate(()=>{clearInterval(window.__poll);return window.__frames;});
  const gaps=frames.slice(1).map((t,j)=>t-frames[j]);
  result[`drag_${route}`]={frames:frames.length,frames_per_s:+(frames.length/2).toFixed(1),longest_gap_ms:Math.round(Math.max(0,...gaps))};
  console.log('drag',route,JSON.stringify(result[`drag_${route}`]));
  await page.waitForFunction(settled,null,{timeout:300000});
 }
}finally{fs.writeFileSync(path.join(out,`${local?'local':'global'}-${path.basename(source)}.json`),JSON.stringify(result,null,1));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
