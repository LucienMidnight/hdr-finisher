// Disposable proposal probe; forces native processing through the existing Full override.
// Does not change product code or save the opened project.
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();
 const forceNative=!process.argv.includes('--proxy');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const arg=process.argv.indexOf('--project');
  if(arg<0)throw new Error('--project is required');
  await page.evaluate(async target=>openProjectFromPath(await desktop.grantProjectPath(target,'project-open')),process.argv[arg+1]);
  const settle=async()=>{
   await page.waitForTimeout(250);
   await page.waitForFunction(()=>state.session&&state.gpuPreview?.available&&viewerState().status==='ready'
    &&!state.gpuDraftInFlight&&!state.zoomRefinementTimer&&!state.renderCoordinator.state('hdr').inFlight
    &&!state.renderCoordinator.state('hdr').pending&&state.acceptedPresentation?.processedLongEdge===requiredProcessingLongEdge(),null,{timeout:180000});
   await page.evaluate(()=>state.gpuPreview.waitForSubmittedWork());
  };
  await settle();
  await page.evaluate(async()=>{
   state.renderCoordinator.canCatchUp=()=>false;
   activateWorkflowTab('grade');
   await state.gpuPreview.warmDenoiseModel(state.session.session_id,'hdr',Math.max(state.session.source.width,state.session.source.height));
   await setDenoiseEnabled(true);
   window.HDRFinisherPerformance.enableGpuInstrumentation(true);
   window.accuracyFrames=[];
   window.addEventListener('hdrfinisher:preview-presented',e=>accuracyFrames.push({at:performance.now(),...e.detail}));
  });
  await settle();const rows=[];
  for(const zoom of [50,75,25,50]){
   await page.evaluate(([z,native])=>{state.previewResolutionOverride=native;state.previewResolution='full';window.accuracyFrames.length=0;window.accuracyStart=performance.now();setCustomZoom(z);},[zoom,forceNative]);
   await settle();
   const row=await page.evaluate(()=>({zoom:state.zoomPercent,edge:state.acceptedPresentation.processedLongEdge,
    firstFrameMs:accuracyFrames.find(f=>f.at>=accuracyStart)?.at-accuracyStart,
    execution:state.acceptedPresentation.execution,denoise:state.denoiseRuntime.hdr.status}));
   await page.evaluate(async()=>{
    const control=document.querySelector('[data-path="hdr.exposure"]');window.accuracyFrames.length=0;window.accuracyStart=performance.now();
    control.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'mouse',buttons:1,isPrimary:true}));
    for(let i=0;i<60;i++){control.value=String(i/60);control.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,16));}
    window.accuracyEnd=performance.now();
    control.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true}));control.dispatchEvent(new Event('change',{bubbles:true}));
   });
   await settle();
   Object.assign(row,await page.evaluate(()=>({dragFirstFrameMs:accuracyFrames.find(f=>f.at>=accuracyStart)?.at-accuracyStart,
    framesDuringDrag:accuracyFrames.filter(f=>f.at>=accuracyStart&&f.at<=accuracyEnd).length,
    dragDurationMs:accuracyEnd-accuracyStart})));
   rows.push(row);console.log(JSON.stringify(row));
  }
  fs.mkdirSync('output/performance',{recursive:true});fs.writeFileSync(`output/performance/denoise-${forceNative?'native':'proxy'}-intermediate-probe.json`,JSON.stringify({forceNative,rows,errors},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
