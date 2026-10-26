// Existing Denoise corpus: GPU noise measurement versus current CPU, finished pixels.
const fs=require("node:fs"),path=require("node:path"),{execFileSync}=require("node:child_process");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,"../output/gpu-denoise-measurement",String(Date.now()));fs.mkdirSync(root,{recursive:true});
const python=path.resolve(__dirname,"../.venv/Scripts/python.exe"),helper=path.join(__dirname,"helpers/denoise_measurement_fixture.py");
const env={...process.env,PYTHONPATH:[path.resolve(__dirname,"../backend"),path.resolve(__dirname,"..")].join(path.delimiter)};
(async()=>{
  execFileSync(python,[helper,"make",root],{env,stdio:"inherit"});
  const browser=await chromium.launch(),page=await browser.newPage(),base=process.env.HDR_FINISHER_URL;
  const api=route=>new URL(route,base).href,rows=[];
  try{
    await page.goto(base,{waitUntil:"networkidle"});
    await page.waitForFunction(()=>state.gpuPreview?.available,{timeout:120000});
    await page.evaluate(()=>{
      const original=HDRDenoiseMeasurement.measure;
      window.measurementCalls=[];window.measurementErrors=[];
      HDRDenoiseMeasurement.measure=async(...args)=>{try{const result=await original(...args);measurementCalls.push(result);return result;}catch(error){measurementErrors.push(error.message);throw error;}};
    });
    if(!process.argv.includes("--library-only"))for(const file of JSON.parse(fs.readFileSync(path.join(root,"corpus.json"),"utf8"))){
      const name=path.basename(file,".tiff");
      const caseIndex=process.argv.indexOf("--case");if(caseIndex>=0&&name!==process.argv[caseIndex+1])continue;
      const upload=await page.request.post(api("/api/session"),{multipart:{file:{name:path.basename(file),mimeType:"image/tiff",buffer:fs.readFileSync(file)}}});
      if(!upload.ok())throw Error(await upload.text());
      const session=(await upload.json()).session,id=session.session_id;
      const url=`/api/session/${id}/denoise-model/hdr?long_edge=640`;
      let start=Date.now();const cpuResponse=await page.request.get(api(url));if(!cpuResponse.ok())throw Error(await cpuResponse.text());const cpu=await cpuResponse.json(),cpu_ms=Date.now()-start;
      const source=await page.request.get(api(url.replace("denoise-model","denoise-measurement")+"&source=true"));
      if(!source.ok())throw Error(await source.text());const sourceFile=path.join(root,name+".bin");fs.writeFileSync(sourceFile,await source.body());
      const info=await page.evaluate(async url=>{
        const gpu=state.gpuPreview,before=measurementCalls.length,start=performance.now();
        const model=await gpu.fetchDenoiseModel(url),gpu_ms=performance.now()-start;
        if(measurementCalls.length!==before+1)throw Error("Measurement did not run on GPU: "+JSON.stringify(measurementErrors));
        const repeat=performance.now(),reused=await gpu.fetchDenoiseModel(url.replace("/hdr?","/sdr?"));
        if(JSON.stringify(model)!==JSON.stringify(reused))throw Error("Shared HDR/SDR pixels produced different models");
        if(measurementCalls.length!==before+1)throw Error("HDR/SDR switch remeasured the same source");
        return {gpu:model,gpu_ms,reuse_ms:performance.now()-repeat,compute_ms:measurementCalls.at(-1).duration_ms};
      },url);
      rows.push({name,cpu,cpu_ms,source:sourceFile,...info});console.log(JSON.stringify({name,cpu_ms,...info,gpu:undefined}));
    }
    fs.writeFileSync(path.join(root,"models.json"),JSON.stringify(rows));
    if(rows.length)execFileSync(python,[helper,"compare",root],{env,stdio:"inherit"});
    console.log("Results",path.join(root,"result.json"));
    if(!process.argv.includes("--case")&&!process.argv.includes("--library-only")){
      const original=process.env.HDR_DENOISE_RAW||"D:/test-photos-delete-later/DSC07060.ARW";
      const copy=path.join(root,path.basename(original));fs.copyFileSync(original,copy);
      const grant=await page.evaluate(file=>window.hdrFinisherDesktop.grantSourcePath(file),copy);
      const opened=await page.request.post(api("/api/desktop/session"),{data:{grant:grant.grant},timeout:240000});
      if(!opened.ok())throw Error(await opened.text());
      const session=(await opened.json()).session,edge=Math.max(session.source.width,session.source.height);
      if(session.source.width*session.source.height<40e6)throw Error("Grade timing RAW is not 42 MP");
      const modelURL=`/api/session/${session.session_id}/denoise-model/hdr?long_edge=${edge}`;
      const before=Date.now(),cpu=await page.request.get(api(modelURL),{timeout:240000});
      if(!cpu.ok())throw Error(await cpu.text());
      const cpu_ms=Date.now()-before;
      const result=await page.evaluate(async url=>{
        const calls=measurementCalls.length,start=performance.now();await state.gpuPreview.fetchDenoiseModel(url);
        if(measurementCalls.length!==calls+1)throw Error("42 MP Grade did not measure on GPU: "+JSON.stringify(measurementErrors));
        return {gpu_ms:performance.now()-start,compute_ms:measurementCalls.at(-1).duration_ms};
      },modelURL);
      const timing={width:session.source.width,height:session.source.height,cpu_ms,...result};
      fs.writeFileSync(path.join(root,"grade-42mp.json"),JSON.stringify(timing,null,2));console.log("Grade 42 MP",JSON.stringify(timing));
    }
    if(process.argv.includes("--library-only")){
      const original=process.env.HDR_DENOISE_RAW||"D:/test-photos-delete-later/DSC07060.ARW";
      const copy=path.join(root,path.basename(original));fs.copyFileSync(original,copy);
      execFileSync(python,["-c",`import sys,json
from pathlib import Path
from hdr_finisher.projects import validate_saved_document
p=Path(sys.argv[2]);original=json.loads(Path(sys.argv[1]+'.hdrf').read_text())
grade=validate_saved_document(original['grade']).model_dump(mode='json')
grade['source']['durable_path']=str(p)
data={'format':'HDR Finisher Photo','schema_version':1,'photo_id':'denoise-timing','marks':{},'albums':[],'grade':grade}
for lane in ('hdr','sdr'): data['grade']['denoise'][lane]['enabled']=True
p.with_name(p.name+'.hdrf').write_text(json.dumps(data))`,original,copy],{env});
      const result=await page.locator('#library-frame').evaluate(async(element,photo)=>{
        const w=element.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),rows=[];
        const original=w.HDRDenoiseMeasurement.measure;let calls=0;
        w.HDRDenoiseMeasurement.measure=async(...args)=>{calls++;return original(...args);};
        for(const edge of [640,2560]){
          const meta=await w.HDRLibraryScenes.load(photo,edge);
          if(!meta.denoise.hdr.enabled)throw Error("Library fixture lost saved Denoise");
          const url=`/api/session/${meta.key}/denoise-model/hdr?long_edge=${edge}`;
          let start=performance.now();const cpu=await w.fetch(url);if(!cpu.ok)throw Error(await cpu.text());await cpu.json();const cpu_ms=performance.now()-start;
          start=performance.now();await w.HDRLibraryPictures.prepareDenoise(meta,true);const gpu_ms=performance.now()-start;
          const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
          start=performance.now();await w.HDRLibraryPictures.show(meta,canvas,new w.AbortController().signal,()=>true,true);const draw_ms=performance.now()-start;
          start=performance.now();await w.HDRLibraryPictures.prepareDenoise(meta,false);const reuse_ms=performance.now()-start;
          rows.push({edge,cpu_ms,gpu_ms,draw_ms,reuse_ms});canvas.remove();
        }
        if(calls!==2)throw Error(`Library measured ${calls} times, expected once per size`);
        return rows;
      },copy);
      fs.writeFileSync(path.join(root,'library.json'),JSON.stringify(result,null,2));console.log('Library',JSON.stringify(result));
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
