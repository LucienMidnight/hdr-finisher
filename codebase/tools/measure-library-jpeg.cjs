const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
 await page.evaluate(()=>activateWorkflowTab('import'));
 const frame=page.frame({url:/\/library(?:\?|$)/});await frame.waitForFunction(()=>window.HDRLibraryScenes);
 const result=await frame.evaluate(async path=>{
  const events=[],requests=[];const old=HDRLibraryStopwatch,fetch=window.fetch;
  window.HDRLibraryStopwatch=(name,value)=>{events.push({name,...value});return old(name,value);};
  window.fetch=async(...args)=>{const at=performance.now();const response=await fetch(...args);if(String(args[0]).includes('raw-budget'))requests.push(performance.now()-at);return response;};
  const meta=await HDRLibraryScenes.load(path,640,undefined,0);
  await meta.directScene?.store();HDRLibraryGpuRaw.forgetDirect();
  return {peakBytes:meta.gpu_memory_peak_bytes,events:events.filter(e=>/picture_development$/.test(e.name)),admissionCalls:requests.length,maxAdmissionMs:Math.max(...requests)};
 },process.argv[2] || 'D:/Photos/2024/02/_DSC3289_DxO.jpg');
 fs.writeFileSync('output/big-folder/'+(process.argv[2]?'raw':'jpeg')+'-isolated.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
