// Read-only real-photo review through the production GPU and CPU delivery paths.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve(__dirname,'../output/sharpen-review');
 const browser=await chromium.launch(),page=await browser.newPage();
 const api=route=>new URL(route,process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765').href;
 try {
  await page.goto(api('/'));
  for(const stem of ['DSC07147','DSC07178']) {
   const upload=await page.request.post(api('/api/session'),{multipart:{file:{name:stem+'-crop.exr',mimeType:'image/x-exr',buffer:fs.readFileSync(path.join(out,stem+'-crop.exr'))}}});
   if(!upload.ok())throw Error(await upload.text());
   const id=(await upload.json()).session.session_id;
   for(const [variant,amount,radius,threshold] of [['off',0,.8,10],['working',80,.8,10],['strong',200,3,0]]) {
    const edit=await (await page.request.get(api(`/api/session/${id}/edit-state`))).json();
    const grade=edit.document.global_adjustments;
    grade.hdr.highlight_section_enabled=true;
    for(const lane of ['hdr','sdr'])Object.assign(grade[lane].detail,{sharpen_amount:amount,sharpen_radius_px:radius,sharpen_threshold:threshold});
    const changed=await page.request.put(api(`/api/session/${id}/edit-state?expected_revision=${edit.revision}`),{data:edit.document});
    if(!changed.ok())throw Error(await changed.text());
    for(const forced of [false,true]) {
     await page.request.post(api('/api/delivery/preferences'),{data:{force_cpu:forced}});
     const target=path.join(out,`${stem}-${variant}-${forced?'cpu':'gpu'}.jpg`);
     await global.HDRFinisherElectronTestHarness.selectExportPath(target);
     const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'review.jpg'}));
     const response=await page.request.post(api(`/api/session/${id}/export`),{data:{format:'jpeg_ultrahdr',quality:100,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:100,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_path:target,path_grant:grant.grant,output_finishing:{resize_mode:'original',sharpening:'off'}},timeout:240000});
     const result=await response.json();
     console.log(stem,variant,JSON.stringify(result));
     if(!response.ok()||!result.accepted||result.renderer!==(forced?'cpu':'gpu'))throw Error('Export renderer did not agree with request');
    }
   }
  }
 } finally {await page.request.post(api('/api/delivery/preferences'),{data:{force_cpu:false}}).catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
