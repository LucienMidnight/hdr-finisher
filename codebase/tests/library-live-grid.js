/* Live unedited cells: stored scene reuse, no JPEG publication and GPU recovery. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/test-photos/library-live-grid-driver'),resultFolder=path.join(root,'output/library-live-grid');
fs.mkdirSync(resultFolder,{recursive:true});
fs.mkdirSync(folder,{recursive:true});
const {source:approvedPhoto}=require('./helpers/reuse-test-photo.cjs');
const sources=['DSC00264','DSC04375','DSC06615'].map(n=>approvedPhoto(n+'.ARW'));
// The old shared folder can contain other checks' RAWs and sidecars.
// Reuse a dedicated set instead of copying the large inputs on every run.
const fixtures=[...sources,path.join(root,'tests/fixtures/sdr_gradient.png')];
const fixtureNames=fixtures.map(file=>path.basename(file)).sort();
const fixturePaths=fixtureNames.map(name=>path.join(folder,name));
for(const source of fixtures){
 const target=path.join(folder,path.basename(source));
 if(!fs.existsSync(target))fs.copyFileSync(source,target,fs.constants.COPYFILE_FICLONE|fs.constants.COPYFILE_EXCL);
}
assert.deepEqual(fs.readdirSync(folder).sort(),fixtureNames,'The live-grid driver needs its four unedited fixtures only');
// The Library lists photos of at least 1 KB (file gate, October 30). The
// 111-byte gradient fixture keeps its pixels: trailing bytes after IEND make
// the disposable copy a listed photo.
const gradient=path.join(folder,'sdr_gradient.png'),gradientBytes=fs.statSync(gradient).size;
if(gradientBytes<1024)fs.appendFileSync(gradient,Buffer.alloc(1024-gradientBytes));
const temporaryCache=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'hdr-live-grid-cache-'));
process.once('exit',()=>fs.rmSync(temporaryCache,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
let cacheSettingsPath,originalCacheSettings;
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("hdr-finisher:library-show-all-files", "true"));
  await page.goto(process.env.HDR_FINISHER_URL);
  const settings=await (await page.request.get(new URL('/api/library/cache-settings',page.url()).href)).json();
  assert.equal(path.basename(settings.location),'Cache','Use a disposable default-cache profile');
  cacheSettingsPath=path.join(path.dirname(settings.location),'library-cache-settings.json');
  originalCacheSettings=fs.existsSync(cacheSettingsPath)?fs.readFileSync(cacheSettingsPath):null;
  assert.ok((await page.request.post(new URL('/api/library/cache-settings',page.url()).href,{data:{location:temporaryCache}})).ok());
  await page.evaluate(()=>activateWorkflowTab('import'));
  const library=page.locator('#library-frame');
  await library.evaluate(element=>{
   const w=element.contentWindow,fetch=w.fetch.bind(w);w.__liveRequests=[];w.__developments=[];const gpuRaw=w.HDRLibraryGpuRaw;w.HDRLibraryGpuRaw={...gpuRaw,liveScene:(p,e,signal,importance,...rest)=>{const row={path:p,edge:e,priority:importance(),cancelled:false};signal?.addEventListener('abort',()=>row.cancelled=true,{once:true});w.__developments.push(row);return gpuRaw.liveScene(p,e,signal,importance,...rest).finally(()=>row.settled=true);}};
   w.fetch=(url,options)=>{w.__liveRequests.push({url:String(url),body:typeof options?.body==='string'?options.body:null});return fetch(url,options);};
  });
  const detached=await library.evaluate(async(element,source)=>{
   const w=element.contentWindow,original=w.HDRLibraryGpuRaw;let starts=0,entered;
   const begun=new Promise(resolve=>entered=resolve);
   w.HDRLibraryGpuRaw={...original,liveScene:(...args)=>{starts++;entered();return original.liveScene(...args);}};
   try{
    const controller=new w.AbortController();
    const first=w.HDRLibraryScenes.load(source,640,controller.signal,10,null,{develop:true}).catch(error=>error.name);
    await Promise.race([begun,first.then(()=>{throw Error('Development hook was not reached');}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Development hook timed out')),60000))]);controller.abort();
    const detachedResult=await first;
    const active=w.HDRLibraryScenes.snapshot().sources.active;
    await w.HDRLibraryScenes.load(source,640,undefined,10,null,{develop:true});
    const small=await w.HDRLibraryScenes.load(source,640,undefined,10,null,{develop:true});
    const returned=await w.HDRLibraryScenes.load(source,2560,undefined,0,null,{develop:true});
    const large=await w.HDRLibraryScenes.load(source,2560,undefined,10,null,{develop:true});
    return {starts,detachedResult,active,returnedEdge:returned.edge,smallCached:small.cache_hit,largeCached:large.cache_hit};
   }finally{w.HDRLibraryGpuRaw=original;}
  },path.join(folder,'DSC00264.ARW'));
  assert.equal(detached.detachedResult,'AbortError');assert.equal(detached.active,1);
  assert.equal(detached.starts,2,'Different resolutions develop independently; matching demand reuses preparation');
  assert.equal(detached.returnedEdge,2560);assert.ok(detached.smallCached&&detached.largeCached,'Each requested resolution is stored and reused');
  // Original files/camera pictures stay undeveloped until the explicit command.
  await library.evaluate(async(element,photos)=>{
    const w=element.contentWindow;
    for(const photo of photos)await w.HDRLibraryScenes.load(photo,640,undefined,10,null,{develop:true});
  },fixturePaths.slice(1));
  const waitForGrid=(phase,allowFallback=false)=>page.waitForFunction(({paths,allowFallback})=>{
   const d=document.querySelector('#library-frame').contentWindow.document;
   const cells=[...d.querySelectorAll('#grid-space .library-cell')];
   const actual=cells.map(cell=>cell.dataset.path.replaceAll('\\','/')).sort();
   const live='canvas[data-picture-key]:not([hidden])',cpu='img[data-cpu-fallback="true"]:not([hidden])';
   const hasFallback=cells.some(cell=>cell.querySelector(cpu));
   return actual.length===paths.length&&actual.every((photo,i)=>photo===paths[i])&&
     cells.every(cell=>cell.querySelector(allowFallback?live+','+cpu:live))&&
     hasFallback===allowFallback;
  },{paths:fixturePaths.map(photo=>photo.replaceAll('\\','/')),allowFallback},{timeout:120000}).catch(async error=>{
   const cells=await library.evaluate(element=>[...element.contentWindow.document.querySelectorAll('#grid-space .library-cell')].map(cell=>({
    path:cell.dataset.path.split(/[\\/]/).at(-1),pictures:[...cell.querySelectorAll('canvas,img')].map(p=>({tag:p.tagName,hidden:p.hidden,key:p.dataset.pictureKey||'',fallback:p.dataset.cpuFallback||'',src:!!p.src}))
   })));
   throw Error(phase+': '+error.message+' '+JSON.stringify(cells),{cause:error});
  });
  const start=performance.now();
  await library.evaluate((element,folder)=>element.contentWindow.HDRLibrary.browse(folder),folder);
  await waitForGrid('Initial live grid');
  const coldMs=performance.now()-start;
  const report=await library.evaluate(async element=>{
   const w=element.contentWindow,paths=[...w.document.querySelectorAll('#grid-space .library-cell')].map(c=>c.dataset.path),rows=[];
   for(const p of paths){const start=performance.now(),meta=await w.HDRLibraryScenes.load(p,640);rows.push({name:p.split(/[\\/]/).at(-1),cacheHit:meta.cache_hit,reuseMs:performance.now()-start,meta});}
   const requests=w.__liveRequests;
   return {rows,requests,memory:(await w.HDRLibraryPictures.initialize()).resourceMemorySnapshot()};
  });
  report.detached=detached;
  assert.ok(report.rows.every(r=>r.cacheHit),'Every source is stored and reused');
  assert.equal(report.requests.filter(r=>r.url.startsWith('/api/library/thumbnail/')).length,0,'Live cells never publish or read a finished thumbnail');
  assert.equal(report.requests.filter(r=>r.url==='/api/library/fallback-picture').length,0,'Usable GPU never makes CPU-finished pictures');
  // Hold hardware unavailable through the loss, then allow it back. Existing
  // CPU pictures must appear only for the visible cells and must not stick.
  const lossStarted=performance.now();
  await library.evaluate(async element=>{
   const w=element.contentWindow,gpu=await w.HDRLibraryPictures.initialize();
   w.__requestAdapter=w.navigator.gpu.requestAdapter.bind(w.navigator.gpu);
   w.navigator.gpu.requestAdapter=async()=>null;gpu.device.destroy();
  });
  // Camera and original pictures are drawn without the GPU (November 3) and
  // stay; only cells showing a developed scene need CPU files, visible ones only.
  await waitForGrid('CPU fallback after GPU loss',true);
  report.fallbackMs=performance.now()-lossStarted;
  const fallback=await library.evaluate(element=>{
   const w=element.contentWindow,requests=w.__liveRequests.filter(r=>r.url==='/api/library/fallback-picture');
   const shown=[...w.document.querySelectorAll('#grid-space .library-cell')].filter(c=>c.querySelector('img[data-cpu-fallback="true"]:not([hidden])')).map(c=>c.dataset.path);
   return {shown,requested:requests.map(r=>JSON.parse(r.body).path)};
  });
  assert.deepEqual([...new Set(fallback.requested)].sort(),fallback.shown.sort(),'CPU files are requested only for visible cells that need them');
  const recoveryStarted=performance.now();
  await library.evaluate(element=>{const w=element.contentWindow;w.navigator.gpu.requestAdapter=w.__requestAdapter;});
  await waitForGrid('Restored live grid');
  report.recoveryMs=performance.now()-recoveryStarted;
  const gridOnly=await library.evaluate(element=>element.contentWindow.__developments.slice(2));
  assert.ok(gridOnly.every(row=>row.edge===640),'Cold grid and recovery develop only 640');
  const beforeToggle=await library.evaluate(element=>element.contentWindow.__developments.length);
  await library.evaluate(element=>element.contentWindow.document.getElementById('hdr-button').click());
  await waitForGrid('First HDR/SDR switch');
  await library.evaluate(element=>element.contentWindow.document.getElementById('hdr-button').click());
  await waitForGrid('Second HDR/SDR switch');
  assert.equal(await library.evaluate(element=>element.contentWindow.__developments.length),beforeToggle,'M20: changing HDR/SDR only redraws the existing scene');
  report.m20=true;
  const singleStarted=performance.now();
  await library.evaluate(element=>{
   const d=element.contentWindow.document;
   [...d.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path.endsWith('DSC04375.ARW')).click();
   d.getElementById('single-view').click();
  });
  await page.waitForFunction(()=>{
   const c=document.querySelector('#library-frame').contentWindow.document.getElementById('single-picture');
   return c.dataset.picturePath?.endsWith('DSC04375.ARW')&&Number(c.dataset.pictureEdge)===2560;
  },null,{timeout:60000});
  report.singleMs=performance.now()-singleStarted;
  // Single develops only the selected photo; neighbour read-ahead was removed.
  const stepStarted=performance.now();
  await library.evaluate(element=>[...element.contentWindow.document.querySelectorAll('#film-space .library-cell')].find(c=>c.dataset.path.endsWith('DSC06615.ARW')).click());
  await page.waitForFunction(()=>{const c=document.querySelector('#library-frame').contentWindow.document.getElementById('single-picture');return c.dataset.picturePath?.endsWith('DSC06615.ARW')&&Number(c.dataset.pictureEdge)===2560;},null,{timeout:60000});
  report.neighbourStepMs=performance.now()-stepStarted;
  await library.evaluate(element=>element.contentWindow.document.getElementById('grid-view').click());
  await new Promise(resolve=>setTimeout(resolve,1000));
  report.developments=await library.evaluate(element=>element.contentWindow.__developments);
  assert.ok(report.developments.filter(row=>row.edge===2560).every(row=>row.settled||row.cancelled),'Leaving Single stops unfinished screen developments');
  report.neighboursStopped=true;
  assert.deepEqual(errors,[],'No page errors');
  fs.writeFileSync(path.join(resultFolder,'result.json'),JSON.stringify({coldMs,...report},null,2));
  console.log(JSON.stringify({coldMs,fallbackMs:report.fallbackMs,recoveryMs:report.recoveryMs,singleMs:report.singleMs,neighbourStepMs:report.neighbourStepMs,reuse:report.rows.map(r=>({name:r.name,ms:r.reuseMs})),residentBytes:report.memory.resident.totalBytes,gpuRecovery:true}));
 }finally{
  if(cacheSettingsPath){if(originalCacheSettings)fs.writeFileSync(cacheSettingsPath,originalCacheSettings);else fs.rmSync(cacheSettingsPath,{force:true});}
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
