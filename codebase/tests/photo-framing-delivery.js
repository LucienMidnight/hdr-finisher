const {chromium}=require("playwright");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{execFileSync}=require("node:child_process");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"hdr-framing-"));
const python=path.resolve(__dirname,"../.venv/Scripts/python.exe"),helper=path.join(__dirname,"helpers/gpu_delivery_fixture.py");
const env={...process.env,PYTHONPATH:path.resolve(__dirname,"../backend")};
(async()=>{
  execFileSync(python,[helper,"make",path.join(root,"fixture.tiff")],{env});
  const browser=await chromium.launch(),page=await browser.newPage();
  const base=process.env.HDR_FINISHER_URL||"http://127.0.0.1:8765",api=route=>new URL(route,base).href,errors=[];
  page.on("pageerror",e=>{errors.push(e.message);console.error("PAGE",e.message);});page.on("console",m=>{if(m.type()==="error")console.error("BROWSER",m.text());});
  const post=async(route,data)=>{const r=await page.request.post(api(route),{data,timeout:240000});const p=await r.json();assert(r.ok(),JSON.stringify(p));return p;};
  try{
    await page.goto(base);await page.setInputFiles("#file-input",path.join(root,"fixture.tiff"));
    await page.waitForFunction(()=>state.session?.session_id,null,{timeout:120000});
    await page.waitForTimeout(500);
    if(await page.locator("#interpretation-gate").isVisible().catch(()=>false))await page.click("#accept-interpretation");
    await page.waitForFunction(()=>viewerState().status==="ready",null,{timeout:120000});
    await page.click("#photo-frame-toggle");await page.check("#photo-framing-enabled");
    await page.waitForFunction(()=>state.editDocument?.framing?.enabled);
    await page.selectOption("#photo-frame-unit","px");await page.fill("#photo-frame-value","8");await page.locator("#photo-frame-value").press("Tab");
    await page.selectOption("#photo-border-unit","px");await page.fill("#photo-border-value","4");await page.locator("#photo-border-value").press("Tab");
    await page.waitForFunction(()=>state.editDocument?.framing?.border.value===4&&state.editDocument?.framing?.frame.value===8);
    const before=await page.evaluate(()=>({id:state.session.session_id,framing:state.editDocument.framing}));
    await page.locator("#photo-frame-value").press("Escape");
    assert.equal(await page.locator("#photo-frame-toggle").getAttribute("aria-expanded"),"false");
    await page.evaluate(async()=>{await queueEditCommand("undo");await queueEditCommand("redo");});
    assert.equal(await page.evaluate(()=>state.editDocument.framing.border.value),4);
    assert(await page.locator("svg[data-photo-framing]").first().isVisible());
    await page.screenshot({path:path.join(root,"framing-fit.png")});
    await page.evaluate(()=>setCustomZoom(100));
    const rect=await page.evaluate(()=>{const p=els.previewCanvas.getBoundingClientRect(),f=els.previewPrimaryPane.querySelector("svg[data-photo-framing]").getBoundingClientRect();return{photo:p.width,frame:f.width,dpr:devicePixelRatio};});
    assert(Math.abs((rect.frame-rect.photo)*rect.dpr-24)<1,JSON.stringify(rect));
    await page.evaluate(()=>setZoomMode("fit"));
    const formats={jpeg_ultrahdr:"jpg",avif_gain_map:"avif",jpegxl_hdr:"jxl",sdr_jpeg:"jpg",sdr_png:"png",sdr_jpegxl:"jxl"};
    for(const [format,extension]of Object.entries(formats))for(const forced of [false,true]){
      await post("/api/delivery/preferences",{force_cpu:forced});
      const target=path.join(root,`${format}-${forced?"cpu":"gpu"}.${extension}`);
      await global.HDRFinisherElectronTestHarness.selectExportPath(target);
      const grant=await page.evaluate(extension=>window.hdrFinisherDesktop.chooseExportPath({extension,suggestedName:"framed."+extension}),extension);
      const settings={format,quality:95,dithering:"off",jpeg_chroma_subsampling:"444",jpeg_gain_map_scale:"half",jpeg_gain_map_quality:95,avif_gain_map_scale:"half",output_finishing:{resize_mode:"long_edge",long_edge:90,sharpening:"standard"},export_with_frame:true};
      const result=await post(`/api/session/${before.id}/export`,{...settings,output_path:target,path_grant:grant.grant});
      assert(result.accepted,JSON.stringify(result));assert.equal(result.renderer,forced?"cpu":"gpu");
      if(!format.startsWith("sdr_")){
        const proof=await post(`/api/session/${before.id}/proof/artifact`,{...settings,full_size:true});
        assert.deepEqual([proof.width,proof.height],[90,66]);assert.equal(proof.renderer,result.renderer);
        assert.equal(proof.sha256,require("node:crypto").createHash("sha256").update(fs.readFileSync(target)).digest("hex"));
        const unframed=await post(`/api/session/${before.id}/proof/artifact`,{...settings,export_with_frame:false,full_size:true});
        assert.deepEqual([unframed.width,unframed.height],[90,60]);assert.notEqual(unframed.artifact_id,proof.artifact_id);
      }
      if(format==="jpeg_ultrahdr"){
        const naked=path.join(root,`unframed-${forced?"cpu":"gpu"}.jpg`);
        await global.HDRFinisherElectronTestHarness.selectExportPath(naked);
        const permission=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:"jpg",suggestedName:"unframed.jpg"}));
        const baseline=await post(`/api/session/${before.id}/export`,{...settings,output_finishing:{...settings.output_finishing,long_edge:72},export_with_frame:false,output_path:naked,path_grant:permission.grant});
        assert(baseline.accepted,JSON.stringify(baseline));
      }
      console.log(format,result.renderer,"framed delivery passed");
    }
    // Saved Library framing travels separately from the creative pixels.
    const folder=path.join(root,"library");fs.mkdirSync(folder);
    const photo=path.join(folder,"saved.tiff");fs.copyFileSync(path.join(root,"fixture.tiff"),photo);
    const document=await page.evaluate(()=>state.editDocument);
    fs.writeFileSync(photo+".hdrf",JSON.stringify({format:"HDR Finisher Photo",schema_version:1,photo_id:"framing-test",grade:document,marks:{},albums:[]}));
    await page.evaluate(()=>activateWorkflowTab("import",{focus:false}));
    const library=page.frame({url:/\/library(?:\?|$)/});
    await library.waitForFunction(()=>window.HDRLibrary);
    await library.evaluate(folder=>HDRLibrary.browse(folder),folder);
    await library.locator("#grid-space .library-cell").first().click();await library.click("#single-view");
    await library.waitForSelector("#single-stage > svg[data-photo-framing]",{state:"visible",timeout:120000});
    const box=await library.locator("#single-stage > svg[data-photo-framing]").getAttribute("viewBox");assert.equal(box,"0 0 120 88");
    await page.screenshot({path:path.join(root,"framing-library.png")});
    await library.click("#zoom-button");await library.waitForTimeout(300);
    assert(await library.locator("#single-stage > svg[data-photo-framing]").isVisible());
    assert.deepEqual(errors,[]);console.log("FRAMING_OUTPUT",root);
    console.log(execFileSync(python,[path.join(__dirname,"helpers/framing_delivery_check.py"),root],{env,encoding:"utf8"}));
  }finally{await post("/api/delivery/preferences",{force_cpu:false}).catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
