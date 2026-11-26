// Warm 24 MP Grade: delete saved Inpaint spots at 100% and Fit.
// The one-second budget covers the click through the accepted picture.
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
      const png=canvas.toDataURL().split(',')[1];
      canvas.width=canvas.height=1;
      return png;
    });
    await page.locator('#file-input').setInputFiles({name:'retouch-latency.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
    await page.waitForFunction(()=>state.session&&!state.importInProgress&&state.gpuPreview?.lastPresentedFrame,null,{timeout:120000});
    await page.locator('#grade-mode-retouch').click();
    async function accepted(){
      await page.waitForFunction(()=>state.acceptedPresentation?.exact
        && state.acceptedPresentation.generation===state.previewGeneration[state.currentView]
        && state.acceptedPresentation.processedLongEdge===requiredProcessingLongEdge()
        && state.gpuPreview.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView],
        null,{timeout:60000});
    }
    async function idle(){
      // A correct 100% image can come from a native viewport texture. A
      // whole-photo pan store is optional and may be declined on this Mac.
      await accepted();
      await page.evaluate(async()=>{await state.gpuPreview.denoiseModelWarm?.promise;});
      await page.waitForFunction(()=>!state.gpuDraftInFlight&&!state.gpuPreview.proxyInflight.size,null,{timeout:60000});
    }
    await idle();
    const point=await page.evaluate(()=>{const r=activePreviewElement().getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
    const output=path.resolve(process.env.HDR_FINISHER_RETOUCH_TIMING_OUTPUT || 'output/retouch-latency');fs.mkdirSync(output,{recursive:true});
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert(point.x>1&&point.y>1&&point.x<viewport.width-1&&point.y<viewport.height-1,'dust must be visible');
    async function sample(){
      return page.evaluate(async()=>{
        const response=await fetch(`/api/session/${state.session.session_id}/source-tile/hdr?
          long_edge=6000&format=rgba32f&x=3000&y=2000&width=1&height=1&edit_revision=${state.editRevision}`.replace(/\s/g,''));
        if(!response.ok) throw Error(`Native dust probe was refused: ${await response.text()}`);
        return Array.from(new Float32Array(await response.arrayBuffer()).slice(0,4));
      });
    }
    const before=await sample();
    const [initialEdit]=await Promise.all([
      page.waitForResponse(response=>response.url().endsWith('/edit-commands') && response.request().method()==='POST'),
      page.mouse.click(point.x,point.y),
    ]);
    assert(initialEdit.ok(),`Initial Inpaint was refused: ${await initialEdit.text()}`);
    await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs.length===1);
    await accepted();
    const after=await sample();
    assert(after[0]>before[0],`the native source retained the dust: ${before} -> ${after}`);
    await page.evaluate(()=>{
      window.retouchTimingStages=[];
      const gpu=state.gpuPreview,record=gpu.recordStage;
      gpu.recordStage=function(name,data){if(name==='repair-source-refresh')window.retouchTimingStages.push(data);return record.call(this,name,data);};
    });
    await page.locator("#retouch-size").fill("100");
    await page.locator("#retouch-method").selectOption("donor-detail");
    const fixture=await page.evaluate(async()=>{
      // Make the same saved spots in one setup transaction. Repeated forced
      // whole-source retry uploads aren't part of the delete timing.
      const repairs=[...state.editDocument.repairs];
      for(let i=1;i<12;i++){
        const points=[{x:(2700+(i%4)*200)/6000,y:(1700+Math.floor(i/4)*200)/4000,pressure:1}];
        repairs.push({id:crypto.randomUUID(),name:`Spot ${i+1}`,enabled:true,recipe:retouchRecipe(points,{earlier:repairs})});
      }
      retouchUI.selected=null;
      const applied=await commitRetouch(repairs);
      return {applied,error:document.getElementById('retouch-status').textContent};
    });
    assert(fixture.applied,`Could not prepare saved Inpaint spots: ${fixture.error}`);
    // The spots are already saved when this measurement starts. Set up at
    // Fit so temporary native pan storage doesn't compete with all 12 solves.
    await page.evaluate(()=>setCustomZoom(100));
    await idle();
    await page.getByRole("button",{name:"Spot 12",exact:false}).first().click();
    const removalSamples=[];
    const methods=await page.evaluate(()=>state.editDocument.repairs.slice(1).map(r=>[r.recipe.mode,r.recipe.method,r.recipe.radius_px]));
    assert.deepEqual(methods,Array.from({length:11},()=>['inpaint','donor-detail',50]));
    for(const name of ['Spot 12','Spot 11','Spot 10']){
      await idle();
      const count=await page.evaluate(()=>state.editDocument.repairs.length);
      const started=Date.now();
      await page.getByRole('button',{name:`Remove ${name}`,exact:true}).click();
      await page.waitForFunction(n=>!retouchUI.busy&&state.editDocument.repairs.length===n-1,count);
      await accepted();
      removalSamples.push({spotsBefore:count,presentedMs:Date.now()-started});
      console.log('multi-spot removal',JSON.stringify(removalSamples.at(-1)));
      if(name!=='Spot 10')await page.getByRole('button',{name: name==='Spot 12'?'Spot 11':'Spot 10',exact:false}).first().click();
    }
    await page.evaluate(()=>setZoomMode("fit"));
    await idle();
    for(const name of ['Spot 9','Spot 8','Spot 7']){
      await page.getByRole('button',{name,exact:false}).first().click();
      const count=await page.evaluate(()=>state.editDocument.repairs.length),started=Date.now();
      await page.getByRole('button',{name:`Remove ${name}`,exact:true}).click();
      await page.waitForFunction(n=>!retouchUI.busy&&state.editDocument.repairs.length===n-1,count);
      await accepted();
      removalSamples.push({view:'fit',spotsBefore:count,presentedMs:Date.now()-started});
      console.log('fit removal',JSON.stringify(removalSamples.at(-1)));
    }
    const stages=await page.evaluate(()=>window.retouchTimingStages);
    assert(stages.some(s=>s.textures>0&&s.bytes>0),'bounded refresh never executed');
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({source:[6000,4000],zoom:100,
      settings:{visibleDustCheckDiameter:12,multiSpotDiameter:100,multiSpotMethod:"donor-detail",patchRadius:3,iterations:6},targetMs:1000,
      scope:'Grade Inpaint: warm native and Fit views, deletion of saved spots. Startup and active denoise recomputation excluded.',before,after,removalSamples,stages},null,2));
    assert(removalSamples.every(s=>s.presentedMs<=1000),`removing a spot exceeded 1 second: ${JSON.stringify(removalSamples)}`);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
