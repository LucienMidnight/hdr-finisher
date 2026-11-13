/* Direct bounded Retouch GPU behavior, independent of publication and UI. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
(async()=>{
 const folder=path.resolve('output/retouch-gpu-validation');fs.mkdirSync(folder,{recursive:true});
 const input=path.join(folder,'input.json');
 execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(),['tests/retouch_gpu_cases.py',input],{cwd:process.cwd()});
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  await page.addScriptTag({url:'/static/retouch-gpu.js'});
  await page.evaluate(async()=>{window.__retouchGpu=new HDRWebGPUPreview(document.createElement('canvas'));if(!await __retouchGpu.initialize())throw Error('GPU unavailable');});
  const results=[];
  for(const c of JSON.parse(fs.readFileSync(input,'utf8'))){
   const result=await page.evaluate(async c=>{
    const decode=s=>Uint8Array.from(atob(s),ch=>ch.charCodeAt(0)).buffer;
    const started=performance.now();const output=await HDRRetouchGPU.run(__retouchGpu.device,c.meta,decode(c.body),async()=>{},512*1024*1024);
    const replay=await HDRRetouchGPU.run(__retouchGpu.device,c.meta,decode(c.body),async()=>{},512*1024*1024);
    const whole=await HDRRetouchGPU.run(__retouchGpu.device,c.reference,decode(c.whole),async()=>{},512*1024*1024);
    const identical=(left,right)=>new Uint8Array(left).every((v,i)=>v===new Uint8Array(right)[i]);
    if(!identical(output.pixels,replay.pixels))throw Error('GPU replay changed pixels');
    if(!identical(output.pixels,whole.pixels))throw Error('Bounded job differs from whole-photo GPU input');
    const values=new Float32Array(output.pixels),expected=new Float32Array(decode(c.cpu));
    let mean=0,max=0;for(let i=0;i<expected.length;i++){if(!Number.isFinite(values[i]))throw Error('Non-finite output');const d=Math.abs(values[i]-expected[i]);mean+=d;max=Math.max(max,d);}
    let differingDonors=0;for(let i=0;i<c.donors.length;i++)if(values[expected.length+i*2]!==c.donors[i][0]||values[expected.length+i*2+1]!==c.donors[i][1])differingDonors++;
    return {name:c.name,mean:mean/expected.length,max,differingDonors,donors:c.donors.length,deterministic:true,wholePhotoExact:true,ms:performance.now()-started};
   },c);
   results.push(result);console.log(JSON.stringify(result));
   // CPU/GPU repair differences are information for visual review, not a gate.
  }
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(results,null,2));
 }finally{fs.rmSync(input,{force:true});await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
