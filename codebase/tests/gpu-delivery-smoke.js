const {chromium}=require("playwright");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{execFileSync}=require("node:child_process");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"hdr-gpu-smoke-"));
const python=path.resolve(__dirname,"../.venv/Scripts/python.exe");
const helper=path.join(__dirname,"helpers/gpu_delivery_fixture.py");
const env={...process.env,PYTHONPATH:path.resolve(__dirname,"../backend")};
(async()=>{
  execFileSync(python,[helper,"make",path.join(root,"fixture.tiff")],{env});
  const browser=await chromium.launch();
  const page=await browser.newPage();
  const base=process.env.HDR_FINISHER_URL||"http://127.0.0.1:8765";
  const api=route=>new URL(route,base).href;
  try{
    await page.goto(process.env.HDR_FINISHER_URL||"http://127.0.0.1:8765");
    const upload=await page.request.post(api("/api/session"),{multipart:{file:{name:"fixture.tiff",mimeType:"image/tiff",buffer:fs.readFileSync(path.join(root,"fixture.tiff"))}}});
    if(!upload.ok())throw Error(await upload.text());
    console.log("fixture uploaded");
    const session=(await upload.json()).session;
    const edits=await page.request.get(api(`/api/session/${session.session_id}/edit-state`));
    const editState=await edits.json();
    editState.document.denoise.hdr.enabled=true;editState.document.denoise.sdr.enabled=true;
    const changed=await page.request.put(api(`/api/session/${session.session_id}/edit-state?expected_revision=${editState.revision}`),{data:editState.document});
    if(!changed.ok())throw Error(await changed.text());
    for(const forced of [false,true]){
      await page.request.post(api("/api/delivery/preferences"),{data:{force_cpu:forced}});
      const target=path.join(root,forced?"cpu.jpg":"gpu.jpg");
      await global.HDRFinisherElectronTestHarness.selectExportPath(target);
      const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:"jpg",suggestedName:"fixture.jpg"}));
      console.log("export requested",forced);
      const response=await page.request.post(api(`/api/session/${session.session_id}/export`),{data:{format:"jpeg_ultrahdr",quality:95,
        jpeg_chroma_subsampling:"444",jpeg_gain_map_quality:95,jpeg_gain_map_scale:"full",dithering:"off",guarantee_hdr_peak:true,
        output_path:target,path_grant:grant.grant,output_finishing:{resize_mode:"long_edge",long_edge:72,sharpening:"standard"}},timeout:240000});
      const result=await response.json();console.log(JSON.stringify(result));
      if(!result.accepted || result.renderer!==(forced?"cpu":"gpu"))throw Error(`Wrong renderer: ${JSON.stringify(result)}`);
      const proofResponse=await page.request.post(api(`/api/session/${session.session_id}/proof/artifact`),{data:{
        format:"jpeg_ultrahdr",quality:95,jpeg_chroma_subsampling:"444",jpeg_gain_map_quality:95,
        jpeg_gain_map_scale:"full",dithering:"off",guarantee_hdr_peak:true,full_size:true,
        output_finishing:{resize_mode:"long_edge",long_edge:72,sharpening:"standard"}},timeout:240000});
      const proof=await proofResponse.json();
      if(!proofResponse.ok()||proof.renderer!==result.renderer||proof.width!==72||proof.height!==48)
        throw Error(`Proof did not share delivery: ${JSON.stringify(proof)}`);
      console.log("Proof shares",proof.renderer,"delivery");
    }
    const result=JSON.parse(execFileSync(python,[helper,"compare",root],{env,encoding:"utf8"}));console.log(JSON.stringify(result));
    if(!result.hdr.passed||!result.sdr.passed)console.error("Existing stricter delivery p99.9 limit exceeded; recorded separately from Denoise measurement's agreed p99.");
    if(!result.hdr.denoise_passed||!result.sdr.denoise_passed)throw Error("Denoise delivery perceptual limits exceeded.");
  }finally{await page.request.post(api("/api/delivery/preferences"),{data:{force_cpu:false}}).catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
