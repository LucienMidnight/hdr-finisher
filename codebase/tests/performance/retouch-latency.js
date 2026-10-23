// Focused 24 MP warm-view timing: alternate ordinary full source reload with
// bounded repair refresh in the same app. No algorithm or quality settings change.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseUrl=process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765';
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.stack));
  try {
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    const data=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=6000;canvas.height=4000;
      const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,6000,4000);
      gradient.addColorStop(0,'#aac6df');gradient.addColorStop(1,'#729ac1');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,6000,4000);
      ctx.fillStyle='#556b80';ctx.beginPath();ctx.arc(3000,2000,4,0,Math.PI*2);ctx.fill();
      return canvas.toDataURL().split(',')[1];
    });
    await page.locator('#file-input').setInputFiles({name:'retouch-latency.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
    await page.waitForFunction(()=>state.session&&!state.importInProgress&&state.gpuPreview?.lastPresentedFrame,null,{timeout:120000});
    await page.locator('#grade-mode-retouch').click();await page.locator('#retouch-brush').click();
    await page.evaluate(()=>setCustomZoom(100));
    async function idle(){
      await page.waitForFunction(()=>[...state.gpuPreview.proxies.values()].some(p=>p.longEdge>=6000&&!p.region),null,{timeout:60000});
      await page.evaluate(async()=>{await state.gpuPreview.denoiseModelWarm?.promise;});
      await page.waitForFunction(()=>!state.gpuDraftInFlight&&!state.gpuPreview.proxyInflight.size,null,{timeout:60000});
    }
    await idle();
    const point=await page.evaluate(()=>{const r=activePreviewElement().getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
    const output=path.resolve('output/retouch-latency');fs.mkdirSync(output,{recursive:true});
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert(point.x>1&&point.y>1&&point.x<viewport.width-1&&point.y<viewport.height-1,'dust must be visible');
    async function sample(){
      // Page clipping does not scroll the large native canvas as locator screenshots do.
      const png=await page.screenshot({clip:{x:Math.floor(point.x)-1,y:Math.floor(point.y)-1,width:3,height:3}});
      return page.evaluate(async encoded=>{
        const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=3;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(1,1,1,1).data];
      },png.toString('base64'));
    }
    const before=await sample();await page.screenshot({path:path.join(output,'before.png')});
    await page.mouse.click(point.x,point.y);
    await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs.length===1);
    await page.waitForFunction(()=>state.gpuPreview.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView],null,{timeout:60000});
    await page.evaluate(()=>{retouchUI.active=false;renderLocalMaskOverlay();});
    const after=await sample();await page.screenshot({path:path.join(output,'after.png')});
    assert(after[0]>before[0],`native ROI retained the dust: ${before} -> ${after}`);
    await page.evaluate(()=>{retouchUI.active=true;renderLocalMaskOverlay();});
    await page.evaluate(()=>{window.originalRetouchTransport=window.HDRSourceTransport;window.retouchTimingStages=[];
      const gpu=state.gpuPreview,record=gpu.recordStage;
      gpu.recordStage=function(name,data){if(name==='repair-source-refresh')window.retouchTimingStages.push(data);return record.call(this,name,data);};});
    const samples=[];
    for(let pair=0;pair<3;pair++)for(const mode of ['full-reload','bounded-refresh']){
      await idle();
      await page.evaluate(mode=>{
        const original=window.originalRetouchTransport;
        window.HDRSourceTransport=mode==='bounded-refresh'?original:{...original,
          async refreshRepairs(renderer,{sessionId}){renderer.resetSession(sessionId);return false;}};
      },mode);
      const started=Date.now();
      await page.getByRole('button', {name:'Retry Spot 1',exact:true}).click();
      await page.waitForFunction(()=>!retouchUI.busy);
      const acknowledgedMs=Date.now()-started;
      await page.waitForFunction(()=>state.gpuPreview.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView],null,{timeout:60000});
      const presentedMs=Date.now()-started;
      samples.push({mode,acknowledgedMs,presentedMs});
      console.log(mode,JSON.stringify(samples.at(-1)));
    }
    await page.evaluate(()=>{window.HDRSourceTransport=window.originalRetouchTransport;});
    await page.locator("#retouch-size").fill("100");
    await page.locator("#retouch-method").selectOption("donor-detail");
    for(let i=1;i<12;i++){
      await page.evaluate(async i=>{
        const points=[{x:(2700+(i%4)*200)/6000,y:(1700+Math.floor(i/4)*200)/4000,pressure:1}];
        const records=state.editDocument.repairs;
        retouchUI.selected=null;
        await commitRetouch([...records,{id:crypto.randomUUID(),name:`Spot ${i+1}`,enabled:true,recipe:retouchRecipe(points)}]);
      },i);
    }
    await page.getByRole("button",{name:"Spot 12",exact:false}).first().click();
    const removalSamples=[];
    for(const name of ['Spot 12','Spot 11','Spot 10']){
      await idle();
      const count=await page.evaluate(()=>state.editDocument.repairs.length);
      const started=Date.now();
      await page.getByRole('button',{name:`Remove ${name}`,exact:true}).click();
      await page.waitForFunction(n=>!retouchUI.busy&&state.editDocument.repairs.length===n-1,count);
      await page.waitForFunction(()=>state.gpuPreview.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView],null,{timeout:60000});
      removalSamples.push({spotsBefore:count,presentedMs:Date.now()-started});
      console.log('multi-spot removal',JSON.stringify(removalSamples.at(-1)));
      if(name!=='Spot 10')await page.getByRole('button',{name: name==='Spot 12'?'Spot 11':'Spot 10',exact:false}).first().click();
    }
    await page.evaluate(()=>setZoomMode("fit"));
    await page.waitForFunction(()=>!state.gpuDraftInFlight&&state.gpuPreview.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView]);
    for(const name of ['Spot 9','Spot 8','Spot 7']){
      await page.getByRole('button',{name,exact:false}).first().click();
      const count=await page.evaluate(()=>state.editDocument.repairs.length),started=Date.now();
      await page.getByRole('button',{name:`Remove ${name}`,exact:true}).click();
      await page.waitForFunction(n=>!retouchUI.busy&&state.editDocument.repairs.length===n-1,count);
      await page.waitForFunction(()=>state.gpuPreview.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView],null,{timeout:60000});
      removalSamples.push({view:'fit',spotsBefore:count,presentedMs:Date.now()-started});
      console.log('fit removal',JSON.stringify(removalSamples.at(-1)));
    }
    assert(removalSamples.every(s=>s.presentedMs<=1000),`removing a spot exceeded 1 second: ${JSON.stringify(removalSamples)}`);
    assert.deepEqual(errors,[]);
    const stages=await page.evaluate(()=>{window.HDRSourceTransport=window.originalRetouchTransport;return window.retouchTimingStages;});
    assert(stages.some(s=>s.textures>0&&s.bytes>0),'bounded refresh never executed');
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({source:[6000,4000],zoom:100,
      settings:{retryDiameter:12,multiSpotDiameter:100,multiSpotMethod:"donor-detail",patchRadius:3,iterations:6},targetMs:1000,
      scope:'Warm native and fit views; startup/active denoise recomputation excluded.',before,after,samples,removalSamples,stages},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
