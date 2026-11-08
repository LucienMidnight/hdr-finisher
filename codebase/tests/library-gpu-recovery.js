/* Forced Library GPU out-of-memory and device loss: the photos still finish. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-gpu-recovery',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const oomPhoto=path.join(folder,'oom.png'),lostPhoto=path.join(folder,'lost.png');
fs.copyFileSync(path.join(root,'tests/fixtures/library_photo.png'),oomPhoto);
fs.copyFileSync(path.join(root,'tests/fixtures/library_photo.png'),lostPhoto);
// Optional reusable real-photo copy; never use an original for this check.
const unsupportedPhoto=process.env.HDR_LIBRARY_UNSUPPORTED_PHOTO || path.join(folder,'unsupported.png');
if(!process.env.HDR_LIBRARY_UNSUPPORTED_PHOTO)fs.copyFileSync(oomPhoto,unsupportedPhoto);
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 page.setDefaultTimeout(30000); await page.addInitScript(() => localStorage.setItem("hdr-finisher:library-show-all-files", "true"));
    await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
 const result=await page.locator('#library-frame').evaluate(async(element,{oomPhoto,lostPhoto,unsupportedPhoto,realSource})=>{
  const w=element.contentWindow,original=w.HDRLibraryRGB,requests=[],events=[];
  const originalFetch=w.fetch.bind(w);
  w.fetch=(url,options)=>{
   requests.push({url:String(url),body:typeof options?.body==='string'?options.body:null});
   if(!realSource && url==='/api/library/live-scene' && options?.body){
    const request=JSON.parse(options.body);
    if(request.path===unsupportedPhoto && request.gpu)return Promise.resolve(new w.Response(null,{status:204,headers:{'X-Library-Fallback':'Synthetic unsupported source adapter'}}));
   }
   return originalFetch(url,options);
  };
  const log=w.HDRLibraryStopwatch;
  w.HDRLibraryStopwatch=(stage,fields)=>{events.push({stage,...fields});log(stage,fields);};
  let oomAttempts=0,lostAttempts=0;
  w.HDRLibraryRGB={...original,develop:async args=>{
   const which=args.meta.path===oomPhoto?'oom':'lost';
   if(which==='oom'){
    oomAttempts++;
    if(oomAttempts<=2){
     // Force the next allocation check to see an out-of-memory error.
     const device=args.context.baseDevice,pop=device.popErrorScope.bind(device);let injected=false;
     device.popErrorScope=async()=>{const actual=await pop();if(!injected){injected=true;return Object.assign(Error('Forced Library allocation failure'),{forced:true});}return actual;};
     try{return await original.develop(args);}finally{device.popErrorScope=pop;}
    }
   }else{
    lostAttempts++;
    if(lostAttempts<=2){const device=args.context.baseDevice;device.destroy();await device.lost;await new Promise(resolve=>setTimeout(resolve,0));}
   }
   return original.develop(args);
  }};
  const dump=()=>({events:events.slice(-30),stages:w.HDRLibraryScenes.snapshot(),grants:w.HDRLibraryGrants.snapshot()});
  const withTimeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>{w.__diagDump=dump();reject(Error('timed out: '+label));},ms))]);
  try{
   const oomValue=await withTimeout(w.HDRLibraryScenes.load(oomPhoto,640,undefined,10,null,{develop:true}),120000,'oom load');
   const lostValue=await withTimeout(w.HDRLibraryScenes.load(lostPhoto,640,undefined,10,null,{develop:true}),120000,'lost load');
   const started=performance.now();
   const unsupportedValue=await withTimeout(w.HDRLibraryScenes.load(unsupportedPhoto,640,undefined,10,null,{develop:true}),30000,'unsupported source CPU fallback');
   const cpuPrepareMs=performance.now()-started;
   const store=await originalFetch('/api/library/live-store/'+unsupportedValue.key,{method:'POST'});
   if(!store.ok)throw Error('CPU picture store failed: '+store.status);
   const reopened=await w.HDRLibraryScenes.load(unsupportedPhoto,640,undefined,10,null,{cachedOnly:true});
   const errors=(await (await originalFetch('/api/library/health')).json()).picture_errors||{};
   return {oomEdge:oomValue.edge,lostEdge:lostValue.edge,unsupportedEdge:unsupportedValue.edge,reopenedKey:reopened?.key,unsupportedKey:unsupportedValue.key,cpuPrepareMs,oomAttempts,lostAttempts,requests,events,errors,remaining:w.HDRLibraryGrants.snapshot()};
  }finally{w.HDRLibraryRGB=original;w.fetch=originalFetch;}
 },{oomPhoto,lostPhoto,unsupportedPhoto,realSource:!!process.env.HDR_LIBRARY_UNSUPPORTED_PHOTO}).catch(async error=>{
  let dump=null;
  try{dump=await page.locator('#library-frame').evaluate(element=>element.contentWindow.__diagDump||null);}catch{}
  fs.writeFileSync(path.join(folder,'failure.json'),JSON.stringify({error:error.message,dump,pageErrors},null,2));
  throw error;
 });
 fs.writeFileSync(path.join(folder,'recovery.json'),JSON.stringify(result,null,2));
 const parsed=result.requests.map(r=>{let body=null;try{body=r.body?JSON.parse(r.body):null;}catch{}return {url:r.url,body};});
 const cpuCalls=target=>parsed.filter(r=>r.url==='/api/library/live-scene'&&r.body?.gpu===false&&r.body?.path===target).length;
 assert.equal(result.unsupportedEdge,640,'Unsupported GPU source finishes on CPU');
 assert.equal(result.reopenedKey,result.unsupportedKey,'CPU picture reopens from cache');
 assert.equal(cpuCalls(unsupportedPhoto),1,'One CPU development, including cached reopen');
 assert.equal(result.oomEdge,640,'The out-of-memory photo finishes');
 assert.equal(result.lostEdge,640,'The device-loss photo finishes');
 assert.equal(result.oomAttempts,1,'Out of memory without competing GPU work goes straight to the CPU');
 assert.equal(result.lostAttempts,2,'Device loss requeues once and reruns');
 assert.equal(cpuCalls(oomPhoto),1,'The photo takes the visible CPU route');
 assert.equal(cpuCalls(lostPhoto),1,'A second device loss takes the visible CPU route');
 assert.equal(parsed.filter(r=>r.url==='/api/library/development-error').length,0,'No broken-photo record is written');
 assert.equal(result.remaining.jobs.length,0,'No grant is left waiting');
 assert.equal(Object.keys(result.errors).length,0,'Neither photo is listed as damaged');
 assert.equal(pageErrors.length,0,'No page errors');
 console.log(JSON.stringify({oomAttempts:result.oomAttempts,lostAttempts:result.lostAttempts,cpuFallback:true,cpuPrepareMs:result.cpuPrepareMs,passed:true}));
}finally{try { await browser.close(); } finally { fs.rmSync(folder,{recursive:true,force:true}); }}})().catch(error=>{console.error(error);process.exitCode=1;});
