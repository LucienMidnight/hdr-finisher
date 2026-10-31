/* Forced Library GPU out-of-memory and device loss: the photos still finish. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-gpu-recovery',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const oomPhoto=path.join(folder,'oom.png'),lostPhoto=path.join(folder,'lost.png');
fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),oomPhoto);
fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),lostPhoto);
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),pageErrors=[],diag=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 page.on('console',m=>{if(m.text().startsWith('[diag'))diag.push(m.text());});
 await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
 const result=await page.locator('#library-frame').evaluate(async(element,{oomPhoto,lostPhoto})=>{
  const w=element.contentWindow,original=w.HDRLibraryRGB,requests=[],events=[],trace=[];
  const mark=name=>{if(trace.length<600)trace.push(name+'@'+Math.round(performance.now()));};
  const originalFetch=w.fetch.bind(w);
  const engageFetch=(url,options)=>{const text=String(url);if(/(raw-budget|live-source|live-scene|live-plan|live-store|delivery|fallback-picture)/.test(text)){
    const label=text.replace(/^.*\/api\//,"").replace(/\/[0-9a-f-]{8,}/,"/…").slice(0,40);
    mark('fetch '+(options?.method||'GET')+' '+label+' start');
    const out=originalFetch(url,options);if(out?.then)out.then(r=>mark('fetch '+label+' -> '+r.status),e=>mark('fetch '+label+' fail '+(e?.message||e)));return out;}
    return originalFetch(url,options);};
  w.fetch=(url,options)=>{requests.push({url:String(url),body:typeof options?.body==='string'?options.body:null});return engageFetch(url,options);};
  const log=w.HDRLibraryStopwatch;
  w.HDRLibraryStopwatch=(stage,fields)=>{events.push({stage,...fields});log(stage,fields);};
  const gpuRaw=w.HDRLibraryGpuRaw;
  w.HDRLibraryGpuRaw={...gpuRaw,liveScene:(...args)=>{mark('liveScene');const out=gpuRaw.liveScene(...args);if(out?.then)out.then(()=>mark('liveScene done'),e=>mark('liveScene fail '+(e?.message||e)));return out;},
   forgetDirect:(...args)=>{mark('forgetDirect '+(args[0]?'one':'all'));return gpuRaw.forgetDirect(...args);}};
  const requestAdapter=w.navigator.gpu.requestAdapter.bind(w.navigator.gpu);
  w.navigator.gpu.requestAdapter=(...args)=>{mark('requestAdapter');return requestAdapter(...args).then(a=>{mark('adapter '+(a?"ok":"null"));return a;},e=>{mark('adapter fail '+e.message);throw e;});};
  const requestDevice=w.GPUAdapter.prototype.requestDevice;
  w.GPUAdapter.prototype.requestDevice=function(...args){mark('requestDevice');const out=requestDevice.apply(this,args);if(out?.then)out.then(()=>mark('device ok'),e=>mark('device fail '+(e?.message||e)));return out;};
  const createPipeline=w.GPUDevice.prototype.createComputePipelineAsync;
  w.GPUDevice.prototype.createComputePipelineAsync=function(...args){mark('createPipeline');const out=createPipeline.apply(this,args);if(out?.then)out.then(()=>mark('pipeline ok'),e=>mark('pipeline fail '+(e?.message||e)));return out;};
  let oomAttempts=0,lostAttempts=0;
  w.HDRLibraryRGB={...original,develop:async args=>{
   const which=args.meta.path===oomPhoto?'oom':'lost';
   if(which==='oom'){
    oomAttempts++;mark('develop oom '+oomAttempts);
    if(oomAttempts<=2){
     // Force the next allocation check to see an out-of-memory error.
     const device=args.context.baseDevice,pop=device.popErrorScope.bind(device);let injected=false;
     device.popErrorScope=async()=>{const actual=await pop();if(!injected){injected=true;return Object.assign(Error('Forced Library allocation failure'),{forced:true});}return actual;};
     try{const out=await original.develop(args);mark('develop ok oom');return out;}
     catch(e){mark('develop fail oom '+(e?.message||e));throw e;}
     finally{device.popErrorScope=pop;}
    }
   }else{
    lostAttempts++;mark('develop lost '+lostAttempts);
    if(lostAttempts<=2){mark('destroy');const device=args.context.baseDevice;device.destroy();await device.lost;mark('destroyed');await new Promise(resolve=>setTimeout(resolve,0));}
   }
   try{const out=await original.develop(args);mark('develop ok '+which);return out;}
   catch(e){mark('develop fail '+which+' '+(e?.message||e));throw e;}
  }};
  const dump=()=>({trace,events:events.slice(-30),stages:w.HDRLibraryScenes.snapshot(),grants:w.HDRLibraryGrants.snapshot(),memory:w.HDRLibraryRAM?.snapshot?.()});
  const withTimeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>{w.__diagDump=dump();reject(Error('timed out: '+label));},ms))]);
  try{
   const oomValue=await withTimeout(w.HDRLibraryScenes.load(oomPhoto,640,undefined,10),120000,'oom load');
   mark('oom done');
   const lostValue=await withTimeout(w.HDRLibraryScenes.load(lostPhoto,640,undefined,10),120000,'lost load');
   mark('lost done');
   const errors=(await (await originalFetch('/api/library/health')).json()).picture_errors||{};
   return {oomEdge:oomValue.edge,lostEdge:lostValue.edge,oomAttempts,lostAttempts,requests,events,trace,errors,remaining:w.HDRLibraryGrants.snapshot()};
  }finally{w.HDRLibraryRGB=original;w.fetch=originalFetch;w.HDRLibraryGpuRaw=gpuRaw;}
 },{oomPhoto,lostPhoto}).catch(async error=>{
  let dump=null;
  try{dump=await page.locator('#library-frame').evaluate(element=>element.contentWindow.__diagDump||null);}catch{}
  fs.writeFileSync(path.join(folder,'failure.json'),JSON.stringify({error:error.message,dump,pageErrors,diag},null,2));
  throw error;
 });
 fs.writeFileSync(path.join(folder,'recovery.json'),JSON.stringify(result,null,2));
 const parsed=result.requests.map(r=>{let body=null;try{body=r.body?JSON.parse(r.body):null;}catch{}return {url:r.url,body};});
 const cpuCalls=target=>parsed.filter(r=>r.url==='/api/library/live-scene'&&r.body?.gpu===false&&r.body?.path===target).length;
 assert.equal(result.oomEdge,640,'The out-of-memory photo finishes');
 assert.equal(result.lostEdge,640,'The device-loss photo finishes');
 assert.equal(result.oomAttempts,2,'Out of memory retries once on the GPU');
 assert.equal(result.lostAttempts,2,'Device loss requeues once and reruns');
 assert.equal(cpuCalls(oomPhoto),1,'After the retry the photo takes the visible CPU route');
 assert.equal(cpuCalls(lostPhoto),1,'A second device loss takes the visible CPU route');
 assert.equal(parsed.filter(r=>r.url==='/api/library/development-error').length,0,'No broken-photo record is written');
 assert.equal(result.remaining.jobs.length,0,'No grant is left waiting');
 assert.equal(Object.keys(result.errors).length,0,'Neither photo is listed as damaged');
 assert.equal(pageErrors.length,0,'No page errors');
 console.log(JSON.stringify({oomAttempts:result.oomAttempts,lostAttempts:result.lostAttempts,cpuFallback:true,passed:true}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
