// Paired real-app timings on disposable RAW copies. Run through tests/run-in-electron.js.
// --photo <raw> --tag before|after [--local] [--lanes sdr,hdr] [--views fit,100,400]
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1];};
const source=arg('--photo','D:/Photos/Play_Raw/Balanced Rock in Arches Nat Park - LaurentFromSF/IMG_0114.CR2'),local=process.argv.includes('--local'),tag=arg('--tag','before');
const out=path.resolve('output/hsl-performance');fs.mkdirSync(out,{recursive:true});
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView&&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage(),result={photo:path.basename(source),local,tag,notes:'One-second input bursts; pan includes a 250 ms observation floor, zoom and overlay include 50 ms. Local overlay measures redraw submission, not a separately awaited fresh mask. Do not treat these three as pure render latency.',rows:[]};
const save=()=>fs.writeFileSync(path.join(out,`${tag}-${local?'local':'global'}-${path.basename(source)}.json`),JSON.stringify(result,null,2));
try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 const copies=path.join(out,`${tag}-${local?'local':'global'}-copies`);fs.mkdirSync(copies,{recursive:true});const photo=path.join(copies,path.basename(source));if(!fs.existsSync(photo))fs.copyFileSync(source,photo);
 await page.evaluate(async photo=>{const g=await desktop.grantSourcePath(photo),c=await projectIo.createImportJob(fetch,{grant:g.grant});let j=c.payload;
 while(!['ready','error','cancelled'].includes(j.state)){await new Promise(r=>setTimeout(r,150));j=(await projectIo.pollImportJob(fetch,j.job_id)).payload;}
 if(j.state!=='ready')throw Error(JSON.stringify(j));await activateDesktopSession((await projectIo.fetchSession(fetch,j.session_id)).payload.session,'');activateWorkflowTab('grade');},photo);
 await page.waitForFunction(settled,null,{timeout:180000});result.size=await page.evaluate(()=>[state.session.source.width,state.session.source.height]);
 await page.evaluate(async local=>{
  window.__hslPasses={};const old=HDRHslSelectionGpu.prototype.dispatch;HDRHslSelectionGpu.prototype.dispatch=function(e,name,...args){window.__hslPasses[name]=(window.__hslPasses[name]||0)+1;return old.call(this,e,name,...args);};
  for(const lane of ['hdr','sdr']){const b=state.adjustments[lane],r=b.hsl.channels.find(c=>c.id==='yellow').recipe;r.ranges[0].width=15;r.ranges[0].feather=21;r.luminance=.8;b.hsl_section_enabled=!local;}
  state.globalEditDirty=true;await syncGlobalEditState();
  if(local){setGradeMode('local');await assignToolToPending('hue_range');Object.assign(selectedMaskLeaf(),{hue_center:109,hue_width:24,hue_smoothness:41,saturation_floor:.04});for(const lane of ['hdr','sdr'])selectedLocal()[`${lane}_grade`].exposure=1.05;await commitSelectedLocal({maskContent:true});}
  else{document.querySelector('[data-group="hsl"]').classList.remove('collapsed');hslUI.panels[0].channel='yellow';renderHslPanels();}
 },local);
 for(const lane of arg('--lanes','sdr,hdr').split(','))for(const view of arg('--views','fit,100,400').split(','))for(const edges of [false,true]){
  await page.evaluate(async({lane,view,edges,local})=>{hslClearSelection();state.localShowMask=false;await switchLane(lane);const r=local?selectedMaskLeaf():state.adjustments[lane].hsl.channels.find(c=>c.id==='yellow').recipe;
   Object.assign(r,{edge:edges?3:0,edge_feather:edges?8:0,edge_detail:edges?75:50});if(local)await commitSelectedLocal({maskContent:true});else{state.globalEditDirty=true;await syncGlobalEditState();}
   view==='fit'?setZoomMode('fit'):setCustomZoom(Number(view));invalidatePreview(lane);await settlePreview(lane,{});
  },{lane,view,edges,local});await page.waitForFunction(settled,null,{timeout:180000});
  const row={lane,view,edges,actions:{}};result.rows.push(row);
  for(const action of ['range','edge','feather','detail','luminance','exposure']){
   await page.evaluate(({local,edges})=>{const r=local?selectedMaskLeaf():state.adjustments[state.currentView].hsl.channels.find(c=>c.id==='yellow').recipe;Object.assign(r,{edge:edges?3:0,edge_feather:edges?8:0,edge_detail:edges?75:50});if(!local)hslSync(hslUI.panels[0]);else renderLocalAdjustments();},{local,edges});
   row.actions[action]=await page.evaluate(async({local,action})=>{
    const keys=local?{range:'hue_width',edge:'edge',feather:'edge_feather',detail:'edge_detail'}:{range:'width',edge:'edge',feather:'edge_feather',detail:'edge_detail',luminance:'luminance'};
    const selector=keys[action]?(local?`[data-local-mask-param="${keys[action]}"]`:`#hsl-global-panel [data-hsl-key="${keys[action]}"]`):local&&action==='luminance'?'#local-exposure':`#${state.currentView}-exposure`;
    const input=document.querySelector(selector);if(!input)throw Error('Missing '+selector);
    window.__hslPasses={};let frames=0,last=state.acceptedPresentation;const start=performance.now();
    const poll=setInterval(()=>{const a=state.acceptedPresentation;if(a!==last){last=a;frames++;}},4);
    const base=Number(input.value),delta=action==='detail'?5:action==='range'?2:['luminance','exposure'].includes(action)?.08:.5;
    input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));let inputs=0;
    while(performance.now()-start<1000){input.value=String(base+Math.sin(inputs++/5)*delta);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,16));}
    input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));clearInterval(poll);
    return {frames_per_s:frames,inputs,passes:{...window.__hslPasses}};
   },{local,action});await page.waitForFunction(settled,null,{timeout:180000});
   row.actions[action].settle_ms=await page.evaluate(async({local,action})=>{const start=performance.now(),lane=state.currentView,r=local?selectedMaskLeaf():state.adjustments[lane].hsl.channels.find(c=>c.id==='yellow').recipe;
    if(action==='range'){if(local)r.hue_width+=1;else r.ranges[0].width+=1;}else if(action==='luminance'){if(local)selectedLocal()[`${lane}_grade`].exposure+=.01;else r.luminance+=.01;}else if(action==='exposure')state.adjustments[lane].exposure+=.01;else r[{edge:'edge',feather:'edge_feather',detail:'edge_detail'}[action]]+=action==='detail'?1:.25;
    if(local&&action!=='exposure')await commitSelectedLocal({maskContent:action!=='luminance'});else{state.globalEditDirty=true;await syncGlobalEditState();}invalidatePreview(lane);await settlePreview(lane,{});return Math.round(performance.now()-start);
   },{local,action});await page.waitForFunction(settled,null,{timeout:180000});
  }
  for(const action of ['pan','zoom','overlay']){const t=Date.now();await page.evaluate(async({action,view,local})=>{
   if(action==='pan'){els.dropzone.scrollLeft+=73;els.dropzone.scrollTop+=51;}if(action==='zoom')setCustomZoom(view==='fit'?55:Number(view)+5);
   if(action==='overlay'){if(local){document.getElementById('local-show-mask').click();await renderLocalMaskOverlay();}else{const ui=hslUI.panels[0];ui.host.querySelector('[data-hsl-selection]').setAttribute('aria-pressed','true');await hslSelection(ui);}}
  },{action,view,local});await page.waitForTimeout(action==='pan'?250:50);await page.waitForFunction(settled,null,{timeout:180000});row.actions[action]={settle_ms:Date.now()-t};}
  row.execution=await page.evaluate(()=>state.acceptedPresentation.execution);save();console.log('ROW',JSON.stringify(row));
 }
}finally{save();await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
