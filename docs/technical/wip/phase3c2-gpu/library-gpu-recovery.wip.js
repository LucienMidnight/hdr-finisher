const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/library-gpu-recovery');fs.mkdirSync(out,{recursive:true});
const mode=process.argv.includes('--lost')?'lost':'oom';
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
 const result=await page.locator('#library-frame').evaluate(async(element,{mode,photo})=>{
  const w=element.contentWindow,original=w.HDRLibraryRGB,requests=[],events=[];let attempts=0;
  const originalFetch=w.fetch.bind(w);w.fetch=(url,options)=>{if(String(url).endsWith('/live-scene'))requests.push(JSON.parse(options.body));return originalFetch(url,options);};
  const log=w.HDRLibraryStopwatch;w.HDRLibraryStopwatch=(stage,fields)=>{events.push({stage,...fields});log(stage,fields);};
  w.HDRLibraryRGB={...original,develop:async args=>{
   attempts++;
   if(mode==='lost'&&attempts===1){const device=args.context.baseDevice;device.destroy();await device.lost;await new Promise(r=>setTimeout(r,0));}
   if(mode==='oom'&&attempts<=2){
    const device=args.context.baseDevice,pop=device.popErrorScope.bind(device);let injected=false;
    device.popErrorScope=async()=>{const actual=await pop();if(!injected){injected=true;return new w.GPUOutOfMemoryError('Forced Library allocation failure');}return actual;};
    try{return await original.develop(args);}finally{device.popErrorScope=pop;}
   }
   return original.develop(args);
  }};
  try{
   const value=await w.HDRLibraryScenes.load(photo,640,undefined,10);
   const errors=await (await originalFetch('/api/library/errors')).json();
   return {attempts,edge:value.edge,requests,events,errors,remaining:w.HDRLibraryGrants.snapshot()};
  }finally{w.HDRLibraryRGB=original;w.fetch=originalFetch;}
 },{mode,photo:path.join(root,'tests/fixtures/sdr_gradient.png')});
 fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify(result,null,2));
 assert.equal(result.edge,640);assert.equal(result.attempts,2);
 assert.equal(result.requests.filter(r=>r.gpu===false).length,mode==='oom'?1:0);
 assert.equal(result.remaining.jobs.length,0);
 assert.ok(!JSON.stringify(result.errors).includes('Forced Library allocation failure'));
 console.log(JSON.stringify({mode,attempts:result.attempts,cpuFallback:mode==='oom',passed:true}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
