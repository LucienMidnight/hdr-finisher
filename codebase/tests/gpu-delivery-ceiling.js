// Real saved RAW: opting in corrects DSC07060 for export and Proof.
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {execFileSync,execFile}=require("node:child_process");
const execute=require("node:util").promisify(execFile);
const output=path.resolve(__dirname,"../output/gpu-delivery-ceiling",String(Date.now()));
fs.mkdirSync(output,{recursive:true});
const original=process.env.HDR_CEILING_RAW||"D:/test-photos-delete-later/DSC07060.ARW";
const source=path.join(output,path.basename(original));
fs.copyFileSync(original,source);
const python=path.resolve(__dirname,"../.venv/Scripts/python.exe");
const pythonEnv={...process.env,PYTHONPATH:path.resolve(__dirname,"../backend")};
const document=JSON.parse(execFileSync(python,["-c",
  "import sys,json;from pathlib import Path;from hdr_finisher.projects import validate_saved_document;print(validate_saved_document(json.loads(Path(sys.argv[1]).read_text())['grade']).model_dump_json())",
  original+".hdrf"],{env:pythonEnv,encoding:"utf8"}));
document.source.durable_path=source;
assert.equal(document.global_adjustments.hdr.highlight_section_enabled,true);
const target=document.global_adjustments.hdr.highlight_compression_target_nits;
const harness=global.HDRFinisherElectronTestHarness;
(async()=>{
  const browser=await chromium.launch();
  const page=await browser.newPage();
  const api=async(route,data,method="POST")=>{
    const response=await harness.fetch(route,{method,headers:{"Content-Type":"application/json"},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    assert.ok(response.ok,await response.clone().text());return response.json();
  };
  try{
    await page.goto(process.env.HDR_FINISHER_URL);
    const grant=await page.evaluate(file=>window.hdrFinisherDesktop.grantSourcePath(file),source);
    const opened=await api("/api/desktop/session",{grant:grant.grant,raw_import_settings:document.source.raw_import_settings});
    const id=opened.session.session_id;
    const state=await api(`/api/session/${id}/edit-state`,undefined,"GET");
    await api(`/api/session/${id}/edit-state?expected_revision=${state.revision}`,document,"PUT");
    const results=[];
    for(const force_cpu of process.argv.includes("--cpu-only")?[true]:process.argv.includes("--gpu-only")?[false]:[false,true]){
      await api("/api/delivery/preferences",{force_cpu});
      const renderer=force_cpu?"cpu":"gpu",file=path.join(output,renderer+".jpg");
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
      assert.ok(response.ok);const proofFile=path.join(output,renderer+"-proof.jpg");
      fs.writeFileSync(proofFile,Buffer.from(await response.arrayBuffer()));
      assert.ok(fs.readFileSync(file).equals(fs.readFileSync(proofFile)),"Full-size Proof is the delivered file");
      const decoded=await execute(python,["-c",
        "import sys,json;from pathlib import Path;from hdr_finisher.hdr_delivery import decoded_hdr_peak_nits;print(json.dumps([decoded_hdr_peak_nits(Path(p),'jpeg_ultrahdr') for p in sys.argv[1:]]))",
        file,proofFile],{env:pythonEnv,encoding:"utf8"});
      const peaks=JSON.parse(decoded.stdout);
      assert.ok(peaks.every(peak=>peak<=target),JSON.stringify({renderer,target,peaks}));
      results.push({renderer,target,peaks,seconds:(Date.now()-start)/1000,exported,proof});
      console.log(JSON.stringify(results.at(-1)));
    }
    fs.writeFileSync(path.join(output,"result.json"),JSON.stringify(results,null,2));
  }finally{
    await api("/api/delivery/preferences",{force_cpu:false}).catch(()=>{});
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
