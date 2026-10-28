/* Warm 24 MP CPU repair-to-presented-frame feasibility check. Disposable profile. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
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
  await page.evaluate(async()=>{state.gpuPreview.available=false;await applyRenderingMode('cpu');applyPreviewResolution('auto');});
  const ready=()=>page.waitForFunction(()=>viewerState().status==='ready'&&state.acceptedPresentation?.transport!=='WebGPU',null,{timeout:180000});
  await ready();
  const samples=[]; // First pass warms each mode/view; report passes 1 and 2.
  for(const view of (process.env.HDR_RETOUCH_CPU_VIEWS||'fit,native').split(',')){
   await page.evaluate(view=>view==='native'?setCustomZoom(100):setZoomMode('fit'),view);await ready();
   for(const mode of ['inpaint','clone','heal']){
    for(let pass=0;pass<3;pass++){
     await page.evaluate(async()=>{if(state.editDocument.repairs.length)await commitRetouch([]);});await ready();
     const result=await page.evaluate(async({mode,pass,view})=>{
      retouchUI.mode=mode;retouchUI.source={x:.49,y:.5};
      document.getElementById('retouch-size').value='12';
      document.getElementById('retouch-method').value='original-detail';
      document.getElementById('retouch-feather').value='71';
      const recipe=retouchRecipe([{x:.5,y:.5,pressure:1}]);recipe.settings.seed+=pass;
      const started=performance.now();
      const applied=await commitRetouch([{id:crypto.randomUUID(),name:'Timing spot',enabled:true,recipe}]);
      const acknowledgedMs=performance.now()-started;
      if(!applied)throw Error(document.getElementById('retouch-status').textContent);
      while(viewerState().status!=='ready'){
       if(performance.now()-started>180000)throw Error('CPU frame was not presented');
       await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return {mode,view,pass,acknowledgedMs,presentedMs:performance.now()-started,presentation:state.acceptedPresentation};
     },{mode,pass,view});
     samples.push(result);console.log(JSON.stringify(result));
     const folder=path.resolve('output/retouch-cpu-fallback');fs.mkdirSync(folder,{recursive:true});
     fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({source:[6000,4000],targetMs:2000,samples},null,2));
    }
   }
  }
  assert(samples.every(s=>s.presentation.transport!=='WebGPU'),'CPU fallback never presented');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
