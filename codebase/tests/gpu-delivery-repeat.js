const reusePhoto=require('./helpers/reuse-test-photo.cjs');
// Independent renders of the saved release grade, with different admission room.
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {execFileSync,execFile}=require("node:child_process");
const execute=require("node:util").promisify(execFile);
const os=require("node:os");
const output=path.resolve(__dirname,"../output/gpu-delivery-repeat");
fs.mkdirSync(output,{recursive:true});
let scratch;
const original=process.env.HDR_CEILING_RAW||reusePhoto.source("DSC07060.ARW");
const source=reusePhoto(original,path.join(path.resolve(__dirname,"../output/gpu-delivery-ceiling"),path.basename(original)));
const python=path.resolve(__dirname,"../.venv/Scripts/python.exe");
const pythonEnv={...process.env,PYTHONPATH:path.resolve(__dirname,"../backend")};
const document=JSON.parse(execFileSync(python,["-c",
  "import sys,json;from pathlib import Path;from hdr_finisher.projects import validate_saved_document;print(validate_saved_document(json.loads(Path(sys.argv[1]).read_text())['grade']).model_dump_json())",
  process.env.HDR_CEILING_RAW?reusePhoto.source(original+".hdrf")
    :reusePhoto.savedGrade("DSC07060.ARW.hdrf","gpu-delivery-repeat")],{env:pythonEnv,encoding:"utf8"}));
document.source.durable_path=source;
assert.equal(document.global_adjustments.hdr.highlight_section_enabled,true);
const target=document.global_adjustments.hdr.highlight_compression_target_nits;
const harness=global.HDRFinisherElectronTestHarness;
(async()=>{
  scratch=fs.mkdtempSync(path.join(os.tmpdir(),"hdr-export-repeat-"));
  const browser=await chromium.launch();
  const page=await browser.newPage();
  const api=async(route,data,method="POST")=>{
    const response=await harness.fetch(route,{method,headers:{"Content-Type":"application/json"},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.ok(response.ok,await response.clone().text());return response.json();
  };
  let pressure;
  try{
    await page.goto(process.env.HDR_FINISHER_URL);
    const results=[];

    for(const iteration of process.argv.includes("--cpu")?[0,1,2]:[0,1]){
      // A fresh session forces a new render, rather than the delivery pair cache.
      const grant=await page.evaluate(file=>window.hdrFinisherDesktop.grantSourcePath(file),source);
    const opened=await api("/api/desktop/session",{grant:grant.grant,raw_import_settings:document.source.raw_import_settings});
    const id=opened.session.session_id;
    const state=await api(`/api/session/${id}/edit-state`,undefined,"GET");
    document.source=state.document.source;
    await api(`/api/session/${id}/edit-state?expected_revision=${state.revision}`,document,"PUT");
    // These are test admission caps, not changes to the app's memory budget.
    const budget=(iteration===0?3:2)*1024**3;
    const hold=()=>api("/api/delivery/gpu/activity",{id:"repeat-memory",active:false,bytes:0,budget});
    await hold();
    const available=await api("/api/delivery/gpu/permit",undefined,"GET");
    assert.ok(available.budget<=budget,"Memory cap is active");
    pressure=setInterval(()=>hold().catch(()=>{}),500);
    const force_cpu=iteration===2;
      await api("/api/delivery/preferences",{force_cpu});
      const renderer=force_cpu?"cpu":"gpu",file=path.join(scratch,renderer+iteration+".jpg");
      await harness.selectExportPath(file);
      const destination=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:"jpg",suggestedName:"ceiling.jpg"}));
      const settings={format:"jpeg_ultrahdr",quality:95,guarantee_hdr_peak:true,jpeg_chroma_subsampling:"444",
        jpeg_gain_map_quality:95,jpeg_gain_map_scale:"full",dithering:"off",
        output_finishing:{resize_mode:"long_edge",long_edge:4000,sharpening:"off"}};
      const start=Date.now();
      const exported=await api(`/api/session/${id}/export`,{...settings,output_path:file,path_grant:destination.grant});
      assert.ok(exported.accepted,JSON.stringify(exported));assert.equal(exported.renderer,renderer);
      const proof=await api(`/api/session/${id}/proof/artifact`,{...settings,full_size:true});
      assert.equal(proof.renderer,renderer);
      const response=await harness.fetch(`/api/proof/artifact/${proof.artifact_id}.jpg`);
      assert.ok(response.ok);const proofFile=path.join(scratch,renderer+iteration+"-proof.jpg");
      fs.writeFileSync(proofFile,Buffer.from(await response.arrayBuffer()));
      const byteIdentical=fs.readFileSync(file).equals(fs.readFileSync(proofFile));
      const decoded=await execute(python,["-c",
        "import sys,json;from pathlib import Path;from hdr_finisher.hdr_delivery import decoded_hdr_peak_nits;print(json.dumps([decoded_hdr_peak_nits(Path(p),'jpeg_ultrahdr') for p in sys.argv[1:]]))",
        file,proofFile],{env:pythonEnv,encoding:"utf8"});
      const peaks=JSON.parse(decoded.stdout);
      assert.ok(peaks.every(peak=>peak<=target),JSON.stringify({renderer,target,peaks}));
      results.push({renderer,budget,target,peaks,byteIdentical,seconds:(Date.now()-start)/1000,exported,proof});
      clearInterval(pressure);
      console.log(JSON.stringify({renderer,budget,target,peaks,byteIdentical}));
    }
    const compare=async(first,second)=>{
      if(fs.readFileSync(first).equals(fs.readFileSync(second)))return {byteIdentical:true,hdr:{mean:0,p999:0,passed:true},sdr:{mean:0,p999:0,passed:true}};
      const decoded=await execute(python,[path.join(__dirname,"helpers/export_repeat_compare.py"),first,second],{env:pythonEnv,encoding:"utf8"});
      return JSON.parse(decoded.stdout);
    };
    const repeat=await compare(path.join(scratch,"gpu0.jpg"),path.join(scratch,"gpu1.jpg"));
    const cpu=process.argv.includes("--cpu")
      ? await compare(path.join(scratch,"gpu1.jpg"),path.join(scratch,"cpu2.jpg")):null;
    fs.writeFileSync(path.join(output,"result.json"),JSON.stringify({results,repeat,cpu},null,2));
    console.log(JSON.stringify({repeat,cpu}));
    assert.ok(repeat.hdr.passed&&repeat.sdr.passed,"Repeated exports agree within delivery limits");
    // CPU agreement is reported with its unchanged limits; the accepted v1
    // JPEG encoding gap must not be mistaken for a repeatability regression.

    assert.ok(results.every(result=>result.byteIdentical),"Full-size Proof is the delivered file");
  }finally{
    clearInterval(pressure);
    fs.rmSync(scratch,{recursive:true,force:true});
    await api("/api/delivery/preferences",{force_cpu:false}).catch(()=>{});
    await browser.close();reusePhoto.cleanup();
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{reusePhoto.cleanup();if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
