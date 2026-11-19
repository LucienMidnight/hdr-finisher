const {chromium}=require("playwright");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{execFileSync}=require("node:child_process");
const { createHash } = require("node:crypto");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"hdr-gpu-smoke-"));
const python=require('../tools/lib/platform.cjs').pythonExecutable();
const helper=path.join(__dirname,"helpers/gpu_delivery_fixture.py");
const env={...process.env,PYTHONPATH:path.resolve(__dirname,"../backend")};
async function authoredSdr(page, api) {
  const assert = require("node:assert/strict");
  const fixture = path.join(root,"authored.jpg");
  execFileSync(python,[helper,"make-authored",path.join(root,"fixture.tiff"),fixture],{env});
  const upload = await page.request.post(api("/api/session"),{multipart:{file:{name:"authored.jpg",mimeType:"image/jpeg",buffer:fs.readFileSync(fixture)}}});
  assert.ok(upload.ok(),await upload.text());
  const {session} = await upload.json();
  await page.evaluate(async session => {
    await activateDesktopSession(session, "");
    await switchLane("sdr");
  },session);
  await page.waitForFunction(()=>state.currentView === "sdr" && previewIdleNow() && state.gpuPreview?.available);
  assert.equal(await page.evaluate(()=>gradeSourceIdentity("sdr")),"authored-sdr");
  const settings = {format:"jpeg_ultrahdr",quality:95,jpeg_chroma_subsampling:"444",
    jpeg_gain_map_quality:95,jpeg_gain_map_scale:"full",dithering:"off",guarantee_hdr_peak:true};
  const route = part => api(`/api/session/${session.session_id}/${part}`);
  await page.request.post(api("/api/delivery/preferences"),{data:{force_cpu:true}});
  for (const name of ["off","on"]) {
    if (name === "on") {
      await page.evaluate(async ()=>{
        state.denoise.sdr.controls.amount = 1;
        state.denoise.sdr.controls.luminance = 1;
        await setDenoiseEnabled(true);
        applyExecutionOverride("tiled");
      });
      await page.waitForFunction(()=>state.acceptedPresentation?.lane === "sdr"
        && state.acceptedPresentation.transport === "WebGPU" && state.acceptedPresentation.execution === "tiled"
        && state.denoiseRuntime.sdr.status === "ready" && previewIdleNow());
      const grade = await page.evaluate(async ()=>{
        const gpu=state.gpuPreview, target=gpu.presentationTarget;
        return {...await gpu.readPresentationRegion(target.width,target.height),format:target.format};
      });
      fs.writeFileSync(path.join(root,"grade.json"),JSON.stringify(grade));
    }
    const target = path.join(root,`${name}.jpg`);
    await global.HDRFinisherElectronTestHarness.selectExportPath(target);
    const grant = await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:"jpg",suggestedName:"authored.jpg"}));
    const response = await page.request.post(route("export"),{data:{...settings,output_path:target,path_grant:grant.grant}});
    const result = await response.json();
    assert.equal(result.renderer,"cpu",JSON.stringify(result));
    if (name === "on") {
      const proofResponse = await page.request.post(route("proof/artifact"),{data:{...settings,full_size:true}});
      const proof = await proofResponse.json();
      assert.ok(proofResponse.ok(),JSON.stringify(proof));
      assert.equal(proof.renderer,"cpu");
      assert.equal(proof.sha256,createHash("sha256").update(fs.readFileSync(target)).digest("hex"));
    }
  }
  const agreement = execFileSync(python,[helper,"compare-authored",root],{env,encoding:"utf8"});
  console.log("Authored SDR Grade versus CPU export and byte-identical Proof",agreement.trim());

  const authoredProxy = await page.evaluate(()=>[...state.gpuPreview.proxies.values()].find(proxy=>
    proxy.lane === "sdr" && proxy.sourceIdentity === "authored-sdr")?.workingSpace);
  assert.equal(authoredProxy,"linear-srgb");
  const switched = await page.evaluate(async ()=>{
    const confirm = window.HDRDialogs.confirm;
    window.HDRDialogs.confirm = async ()=>true;
    try { return await setSdrMatch(); }
    finally { window.HDRDialogs.confirm = confirm; }
  });
  assert.equal(switched,true,await page.evaluate(()=>status.get("match")?.message));
  const waitForSdr = ()=>page.waitForFunction(()=>state.acceptedPresentation?.lane === "sdr"
    && state.acceptedPresentation.transport === "WebGPU" && state.acceptedPresentation.exact
    && state.acceptedPresentation.generation === state.previewGeneration.sdr && previewIdleNow());
  await waitForSdr();
  const matched = await page.evaluate(()=>({
    identity:gradeSourceIdentity("sdr"),
    space:[...state.gpuPreview.proxies.values()].find(proxy=>proxy.lane === "sdr" && proxy.sourceIdentity === "generated-sdr")?.workingSpace,
  }));
  assert.deepEqual(matched,{identity:"generated-sdr",space:"acescg"});
  assert.equal(await page.evaluate(()=>queueEditCommand("undo")),true);
  await waitForSdr();
  assert.equal(await page.evaluate(()=>gradeSourceIdentity("sdr")),"authored-sdr");
  assert.match(await page.evaluate(()=>state.gpuPreview.denoiseSourceSelector.identity),/:authored-sdr$/);
  console.log("Authored Match/Undo: linear sRGB → ACEScg → authored linear sRGB");

  await page.evaluate(()=>commitDenoiseControl("method","fine_grain"));
  await page.waitForFunction(()=>state.gpuPreview.denoiseSourceSelector?.cache?.grain?.token && previewIdleNow());
  const fallback = await page.evaluate(async ()=>{
    const gpu = state.gpuPreview, render = gpu.renderTo;
    let attempts = 0;
    gpu.renderTo = function(canvas, session, lane, ...args) {
      if (lane === "sdr" && (canvas === els.previewCanvas || canvas === els.previewDenoiseDetail)) {
        attempts++;
        throw new GPUValidationError("Injected Grade Denoise validation failure");
      }
      return render.call(this,canvas,session,lane,...args);
    };
    try {
      await recalculateDenoise("sdr",{force:true});
      return {attempts,renderer:state.acceptedPresentation.renderer,
        transport:state.acceptedPresentation.transport, status:state.denoiseRuntime.sdr.status};
    } finally { gpu.renderTo = render; }
  });
  assert.equal(fallback.attempts,1,JSON.stringify(fallback));
  assert.notEqual(fallback.transport,"WebGPU");
  assert.equal(fallback.status,"error");
  console.log("Grade validation failure: one GPU attempt, then CPU",JSON.stringify(fallback));
}

(async()=>{
  execFileSync(python,[helper,"make",path.join(root,"fixture.tiff"),"denoise"],{env});
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
    for (const method of ["standard", "fine_grain", "clean_grain"]) {
      const output = path.join(root, method);
      fs.mkdirSync(output);
      console.log("Denoise delivery", method);
      const edits=await page.request.get(api(`/api/session/${session.session_id}/edit-state`));
      const editState=await edits.json();
      for (const lane of ["hdr", "sdr"]) {
        editState.document.denoise[lane].enabled = true;
        editState.document.denoise[lane].controls.method = method;
      }
      // The clipped calibration fixture exceeds 1000 nits without an authored cap.
      editState.document.global_adjustments.hdr.highlight_section_enabled=true;
      const changed=await page.request.put(api(`/api/session/${session.session_id}/edit-state?expected_revision=${editState.revision}`),{data:editState.document});
      if(!changed.ok())throw Error(await changed.text());
      for(const forced of [false,true]){
        await page.request.post(api("/api/delivery/preferences"),{data:{force_cpu:forced}});
        const target=path.join(output,forced?"cpu.jpg":"gpu.jpg");
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
        const markedPath=path.join(output,forced?"cpu-marked.jpg":"gpu-marked.jpg");
        await global.HDRFinisherElectronTestHarness.selectExportPath(markedPath);
        const markedGrant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:"jpg",suggestedName:"marked.jpg"}));
        const watermark={mode:"rendition_test",text:"Test",size:15,opacity:1,position:"bottom_right"};
        const markedResponse=await page.request.post(api(`/api/session/${session.session_id}/export`),{data:{
          format:"jpeg_ultrahdr",output_path:markedPath,path_grant:markedGrant.grant,quality:95,dithering:"off",watermark,
          output_finishing:{resize_mode:"long_edge",long_edge:384,sharpening:"standard"}},timeout:240000});
        const marked=await markedResponse.json();
        if(!marked.accepted||marked.renderer!==result.renderer)throw Error(`Watermarked delivery failed: ${JSON.stringify(marked)}`);
        const markedProofResponse=await page.request.post(api(`/api/session/${session.session_id}/proof/artifact`),{data:{
          format:"jpeg_ultrahdr",quality:95,dithering:"off",full_size:true,watermark,
          output_finishing:{resize_mode:"long_edge",long_edge:384,sharpening:"standard"}},timeout:240000});
        const markedProof=await markedProofResponse.json();
        const sha=createHash("sha256").update(fs.readFileSync(markedPath)).digest("hex");
        if(!markedProofResponse.ok()||markedProof.sha256!==sha)throw Error("Watermarked full Proof differs from export");
        console.log("Watermark export/Proof identical",marked.renderer);

      }
      const result=JSON.parse(execFileSync(python,[helper,"compare",output],{env,encoding:"utf8"}));console.log(JSON.stringify(result));
      if(!result.hdr.passed||!result.sdr.passed)throw Error("Finished renderer agreement exceeds mean < 1 / P99.9 <= 3.");
      if(!result.hdr.denoise_passed||!result.sdr.denoise_passed)throw Error("Denoise delivery perceptual limits exceeded.");
    }
    await authoredSdr(page,api);
  }finally{await page.request.post(api("/api/delivery/preferences"),{data:{force_cpu:false}}).catch(()=>{});await browser.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
