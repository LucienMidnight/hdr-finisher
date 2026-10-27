// Read-only real-photo review through the production GPU and CPU delivery paths.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve(__dirname,'../output/export-agreement'), sources=path.resolve(__dirname,'../output/sharpen-review');
 const browser=await chromium.launch(),page=await browser.newPage();
 const api=route=>new URL(route,process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765').href;
 try {
  await page.goto(api('/'));
  for(const stem of ['DSC07147','DSC07178']) {
   const upload=await page.request.post(api('/api/session'),{multipart:{file:{name:stem+'-crop.exr',mimeType:'image/x-exr',buffer:fs.readFileSync(path.join(sources,stem+'-crop.exr'))}}});
   if(!upload.ok())throw Error(await upload.text());
   const uploadedSession=(await upload.json()).session; const id=uploadedSession.session_id;
   for(const [variant,amount,radius,threshold] of [['off',0,.8,10],['working',80,.8,10],['strong',200,3,0]]) {
    const edit=await (await page.request.get(api(`/api/session/${id}/edit-state`))).json();
    const grade=edit.document.global_adjustments;
    grade.hdr.highlight_section_enabled=true;
    for(const lane of ['hdr','sdr'])Object.assign(grade[lane].detail,{sharpen_amount:amount,sharpen_radius_px:radius,sharpen_threshold:threshold});
    const changed=await page.request.put(api(`/api/session/${id}/edit-state?expected_revision=${edit.revision}`),{data:edit.document});
    if(!changed.ok())throw Error(await changed.text());
    // Read the actual retained GPU presentation at native size, both lanes.
    await page.evaluate(async ({session,document})=>{
      session.adjustments=document.global_adjustments;session.edit_document=document;
      await activateDesktopSession(session,'diagnostic-unsaved');
      setCustomZoom(100);applyExecutionOverride('tiled');
    },{session:uploadedSession,document:edit.document});
    for(const lane of ['hdr','sdr']) {
      await page.evaluate(lane=>switchLane(lane),lane);
      await page.waitForFunction(lane=>state.acceptedPresentation?.lane===lane && state.acceptedPresentation.exact
        && state.acceptedPresentation.execution==='tiled' && !state.gpuDraftInFlight,lane,{timeout:90000});
      await page.waitForTimeout(400);
      const capture=await page.evaluate(async()=>{
        const target=state.gpuPreview.presentationTarget;
        const rect=visibleOutputRect(els.previewCanvas.width,els.previewCanvas.height)
          || {x:0,y:0,width:target.width,height:target.height};
        const strip=await state.gpuPreview.readPresentationRegion(rect.width,rect.height,rect.x,rect.y);
        const values=Float32Array.from(strip.values);
        if(!String(target.format).includes('16float'))for(let i=0;i<values.length;i+=4){const b=values[i];values[i]=values[i+2];values[i+2]=b;}
        let binary='';const bytes=new Uint8Array(values.buffer);
        for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
        return {data:btoa(binary),rect,format:String(target.format),accepted:state.acceptedPresentation,
          white:projectReferenceWhiteNits(),width:state.session.source.width,height:state.session.source.height};
      });
      fs.writeFileSync(path.join(out,`${stem}-${variant}-${lane}-preview.f32`),Buffer.from(capture.data,'base64'));
      delete capture.data;fs.writeFileSync(path.join(out,`${stem}-${variant}-${lane}-preview.json`),JSON.stringify(capture,null,2));
    }
    for(const forced of [false,true]) {
     await page.request.post(api('/api/delivery/preferences'),{data:{force_cpu:forced}});
     const target=path.join(out,`${stem}-${variant}-${forced?'cpu':'gpu'}.jpg`);
     await global.HDRFinisherElectronTestHarness.selectExportPath(target);
     const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'review.jpg'}));
     const response=await page.request.post(api(`/api/session/${id}/export`),{data:{format:'jpeg_ultrahdr',quality:100,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:100,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_path:target,path_grant:grant.grant,output_finishing:{resize_mode:'original',sharpening:'off'}},timeout:240000});
     const result=await response.json();
     console.log(stem,variant,JSON.stringify(result));
     if(!response.ok()||!result.accepted||result.renderer!==(forced?'cpu':'gpu'))throw Error('Export renderer did not agree with request');
     if(variant==='off'){
       const proofResponse=await page.request.post(api(`/api/session/${id}/proof/artifact`),{data:{format:'jpeg_ultrahdr',quality:100,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:100,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,full_size:true,output_finishing:{resize_mode:'original',sharpening:'off'}},timeout:240000});
       const proof=await proofResponse.json();if(!proofResponse.ok())throw Error(JSON.stringify(proof));
       fs.writeFileSync(path.join(out,`${stem}-${forced?'cpu':'gpu'}-proof.jpg`),await (await page.request.get(api(proof.url))).body());
       fs.writeFileSync(path.join(out,`${stem}-${forced?'cpu':'gpu'}-proof.json`),JSON.stringify(proof,null,2));
     }
    }
   }
  }
 } finally {await page.request.post(api('/api/delivery/preferences'),{data:{force_cpu:false}}).catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
