// Paired real-app timings on disposable RAW copies. Run through tests/run-in-electron.js.
// --photo <raw> --tag before|after [--local] [--lanes sdr,hdr] [--views fit,100,400]
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1];};
const source=arg('--photo',require('../tests/helpers/photos-root.cjs').photosPath('D:/Photos/HDR Test Images/IMG_0114.CR2')),local=process.argv.includes('--local'),tag=arg('--tag','before');
const out=path.resolve('output/hsl-performance');fs.mkdirSync(out,{recursive:true});
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView&&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
const navigationSettled=()=>{const a=state.acceptedPresentation,s=state.renderCoordinator?.state(state.currentView);
 return !state.zoomRefinementTimer&&!s?.panTimerPending&&!s?.inFlight&&!s?.pending&&a?.exact&&a.lane===state.currentView&&a.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';};
(async()=>{const browser=await chromium.launch(),page=await browser.newPage(),result={photo:path.basename(source),local,tag,notes:'One-second input bursts. Navigation records two-frame response then waits queued pan/zoom refinement and exact Ready; Local Show mask also awaits authoritative requests. --baseline restores pre-fix pacing and full-mask selection in the page.',rows:[]};
const save=()=>fs.writeFileSync(path.join(out,`${tag}-${local?'local':'global'}-${path.basename(source)}.json`),JSON.stringify(result,null,2));
try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 if(process.argv.includes('--baseline'))await page.evaluate(()=>{globalThis.HDRHueMaskRegionalSelection=false;pacedPreviewInteraction=lane=>Boolean(state.previewScheduler?.interacting&&state.denoise?.[lane]?.enabled);});
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
 if(process.argv.includes('--compare-region')){
  if(!local)throw Error('--compare-region needs --local');
  await page.evaluate(()=>{
   const p=state.gpuPreview,old=p.loadLocalMaskTiles;
   p.loadLocalMaskTiles=async function(...args){window.__hueBatch=args;return old.apply(this,args);};
   p.createMaskTexture=function(width,height){return this.device.createTexture({size:{width,height},format:'r16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});};
  });
  for(const lane of ['sdr','hdr'])for(const view of [100,400])for(const edge of [3,-3,.75]){
   await page.evaluate(async({lane,view,edge})=>{await switchLane(lane);Object.assign(selectedMaskLeaf(),{edge,edge_feather:8,edge_detail:75});await commitSelectedLocal({maskContent:true});setCustomZoom(view);invalidatePreview(lane);await settlePreview(lane,{});},{lane,view,edge});
   await page.waitForFunction(settled,null,{timeout:180000});
   await page.evaluate(async()=>{const image=activePreviewElement().getBoundingClientRect(),view=els.dropzone.getBoundingClientRect();
    els.dropzone.scrollLeft+=image.left+.37*image.width-(view.left+view.width/2);els.dropzone.scrollTop+=image.top+.58*image.height-(view.top+view.height/2);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   await page.waitForFunction(settled,null,{timeout:180000});
   const stats=await page.evaluate(async()=>{
    const p=state.gpuPreview,args=window.__hueBatch;if(!args)throw Error('No tiled hue batch');
    const batch=args[1],proxy=args[7];
    async function load(regional){globalThis.HDRHueMaskRegionalSelection=regional;const r=await p.loadLocalMaskTiles(...args);return r.entries.values().next().value;}
    const whole=await load(false),region=await load(true);
    const half=h=>{const sign=h&32768?-1:1,e=(h>>10)&31,m=h&1023;return sign*(e?Math.pow(2,e-15)*(1+m/1024):Math.pow(2,-14)*m/1024);};
    async function read(entry,rect){
     const x=Math.round((entry.frameRect?.[0]||0)*proxy.width),y=Math.round((entry.frameRect?.[1]||0)*proxy.height);
     const stride=Math.ceil(rect.width*2/256)*256,buffer=p.device.createBuffer({size:stride*rect.height,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
     const enc=p.device.createCommandEncoder();enc.copyTextureToBuffer({texture:entry.texture,origin:{x:rect.x-x,y:rect.y-y}},{buffer,bytesPerRow:stride},{width:rect.width,height:rect.height});p.device.queue.submit([enc.finish()]);await buffer.mapAsync(GPUMapMode.READ);
     const values=new Uint16Array(buffer.getMappedRange().slice(0));buffer.unmap();buffer.destroy();return {values,stride:stride/2};
    }
    const diff=[];let coverage=0;
    for(const tile of batch.tiles){const rect=tile.rect,a=await read(whole,rect),b=await read(region,rect);for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){const v=half(a.values[y*a.stride+x]);coverage+=v;diff.push(Math.abs(v-half(b.values[y*b.stride+x])));}}
    diff.sort((a,b)=>a-b);return {coverage:coverage/diff.length,mean:diff.reduce((a,b)=>a+b,0)/diff.length,p99:diff[Math.floor(diff.length*.99)],pixels:diff.length,full:[whole.width,whole.height],region:[region.width,region.height]};
   });
   result.rows.push({lane,view,edge,...stats});save();console.log('REGION',JSON.stringify(result.rows.at(-1)));
   if(!Number.isFinite(stats.mean)||stats.coverage<=0||stats.mean>1e-4||stats.p99>.002)throw Error('Regional coverage differs from full mask beyond existing tolerance');
  }
  return;
 }
 for(const lane of arg('--lanes','sdr,hdr').split(','))for(const view of arg('--views','fit,100,400').split(','))for(const edges of [false,true]){
  await page.evaluate(async({lane,view,edges,local})=>{hslClearSelection();state.localShowMask=false;await switchLane(lane);const r=local?selectedMaskLeaf():state.adjustments[lane].hsl.channels.find(c=>c.id==='yellow').recipe;
   Object.assign(r,{edge:edges?3:0,edge_feather:edges?8:0,edge_detail:edges?75:50});if(local)await commitSelectedLocal({maskContent:true});else{state.globalEditDirty=true;await syncGlobalEditState();}
   view==='fit'?setZoomMode('fit'):setCustomZoom(Number(view));invalidatePreview(lane);await settlePreview(lane,{});
  },{lane,view,edges,local});await page.waitForFunction(settled,null,{timeout:180000});
  const row={lane,view,edges,actions:{}};result.rows.push(row);
  await page.waitForFunction(navigationSettled,null,{timeout:180000});
  for(const action of (process.argv.includes('--only-navigation')?[]:['range','edge','feather','detail','luminance','exposure'])){
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
   if(action==='overlay'){if(local){document.getElementById('local-show-mask').click();await renderLocalMaskOverlay();await Promise.all([...localAuthoritativeMaskRequests.values()].map(v=>v.request));renderLocalMaskOverlay();}else{const ui=hslUI.panels[0];ui.host.querySelector('[data-hsl-selection]').setAttribute('aria-pressed','true');await hslSelection(ui);}}
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  },{action,view,local});await page.waitForFunction(settled,null,{timeout:180000});const response=Date.now()-t;await page.waitForFunction(navigationSettled,null,{timeout:180000});row.actions[action]={response_ms:response,settle_ms:Date.now()-t};}
  row.execution=await page.evaluate(()=>state.acceptedPresentation.execution);save();console.log('ROW',JSON.stringify(row));
 }
}finally{save();await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
