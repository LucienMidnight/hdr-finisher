/* Warm 24 MP CPU repair-to-presented-frame feasibility check. Disposable profile. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const gpu=process.env.HDR_RETOUCH_ROUTE==='gpu';
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765',{waitUntil:'networkidle'});
  const data=await page.evaluate(()=>{
   const c=document.createElement('canvas');c.width=6000;c.height=4000;
   const ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,6000,4000);
   g.addColorStop(0,'#aac6df');g.addColorStop(1,'#729ac1');ctx.fillStyle=g;ctx.fillRect(0,0,6000,4000);
   ctx.fillStyle='#556b80';ctx.beginPath();ctx.arc(3000,2000,4,0,Math.PI*2);ctx.fill();
   return c.toDataURL().split(',')[1];
  });
  await page.locator('#file-input').setInputFiles({name:'cpu-retouch-24mp.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await page.waitForFunction(()=>state.session&&!state.importInProgress,null,{timeout:120000});
  await page.evaluate(async gpu=>{if(!gpu){state.gpuPreview.available=false;await applyRenderingMode('cpu');}else await applyRenderingMode('gpu');applyPreviewResolution('auto');},gpu);
  await page.request.post(new URL('/api/delivery/preferences',process.env.HDR_FINISHER_URL).href,{data:{force_cpu:!gpu}});
  await page.locator('#grade-mode-retouch').click();
  await page.evaluate(()=>{
   window.__retouchValues=retouchValues;
   retouchValues=()=>({...__retouchValues(),seed:window.__retouchSeed||20261021});
   window.__commitRetouch=commitRetouch;
   commitRetouch=async records=>{const result=await __commitRetouch(records);window.__retouchAcknowledged=performance.now();return result;};
  });
  const ready=()=>page.waitForFunction(gpu=>viewerState().status==='ready'&&state.acceptedPresentation?.transport===(gpu?'WebGPU':'Raw RGBA8'),gpu,{timeout:180000});
  await ready();
  const samples=[]; // First pass warms each mode/view; report passes 1 and 2.
  for(const view of (process.env.HDR_RETOUCH_CPU_VIEWS||'fit,native').split(',')){
   await page.evaluate(view=>view==='native'?setCustomZoom(100):setZoomMode('fit'),view);await ready();
   for(const mode of ['inpaint','clone','heal']){
    for(let pass=0;pass<3;pass++){
     await page.evaluate(async()=>{if(state.editDocument.repairs.length)await commitRetouch([]);});await ready();
     const point=await page.evaluate(({mode,pass,view})=>{
      retouchUI.mode=mode;retouchUI.source={x:.49,y:.5};retouchUI.active=true;
      document.getElementById('retouch-size').value='12';
      document.getElementById('retouch-method').value='original-detail';
      document.getElementById('retouch-feather').value='71';
      window.__retouchSeed=20261021+pass+(view==='native'?100:0);
      renderRetouchControls();renderLocalMaskOverlay();
      const r=activePreviewElement().getBoundingClientRect(),z=els.dropzone.getBoundingClientRect();
      els.dropzone.scrollLeft+=r.left+r.width/2-z.left-z.width/2;
      els.dropzone.scrollTop+=r.top+r.height/2-z.top-z.height/2;
      const q=activePreviewElement().getBoundingClientRect();
      window.addEventListener('pointerdown',()=>window.__retouchStarted=performance.now(),{capture:true,once:true});
      return {x:q.left+q.width/2,y:q.top+q.height/2};
     },{mode,pass,view});
     await page.mouse.click(point.x,point.y);
     const result=await page.evaluate(async({mode,pass,view})=>{
      const started=__retouchStarted;
      while(retouchUI.busy||state.editDocument.repairs.length!==1||viewerState().status!=='ready'){
       if(performance.now()-started>180000)throw Error('Painted repair was not presented: '+document.getElementById('retouch-status').textContent);
       await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return {mode,view,pass,routes:state.session.repair_rendering,acknowledgedMs:__retouchAcknowledged-started,presentedMs:performance.now()-started,presentation:state.acceptedPresentation};
     },{mode,pass,view});
     samples.push(result);console.log(JSON.stringify(result));
     const folder=path.resolve(gpu?'output/retouch-gpu-latency':'output/retouch-cpu-fallback');fs.mkdirSync(folder,{recursive:true});
     fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({source:[6000,4000],targetMs:gpu?1000:{native:3000,fit:2000},samples},null,2));
    }
   }
  }
  assert(samples.every(s=>s.presentation.transport===(gpu?'WebGPU':'Raw RGBA8')),'Requested route never presented');
  if(gpu)assert(samples.every(s=>s.routes?.length&&s.routes.every(r=>r.renderer==='gpu')),'GPU repair fell back');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
