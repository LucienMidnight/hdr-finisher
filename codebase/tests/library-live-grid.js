/* Live unedited cells: stored scene reuse, no JPEG publication and GPU recovery. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-live-grid',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const sources=['DSC07060','DSC07061','DSC07072'].map(n=>'D:/test-photos-delete-later/'+n+'.ARW');
for(const source of [...sources,path.join(root,'tests/fixtures/sdr_gradient.png')])fs.copyFileSync(source,path.join(folder,path.basename(source)));
// The Library lists photos of at least 1 KB (file gate, October 30). The
// 111-byte gradient fixture keeps its pixels: trailing bytes after IEND make
// the disposable copy a listed photo.
const gradient=path.join(folder,'sdr_gradient.png'),gradientBytes=fs.statSync(gradient).size;
if(gradientBytes<1024)fs.appendFileSync(gradient,Buffer.alloc(1024-gradientBytes));
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.evaluate(()=>activateWorkflowTab('import'));
  const library=page.locator('#library-frame');
  await library.evaluate(element=>{
   const w=element.contentWindow,fetch=w.fetch.bind(w);w.__liveRequests=[];w.__developments=[];const gpuRaw=w.HDRLibraryGpuRaw;w.HDRLibraryGpuRaw={...gpuRaw,liveScene:(p,e,signal,importance,...rest)=>{const row={path:p,edge:e,priority:importance(),cancelled:false};signal?.addEventListener('abort',()=>row.cancelled=true,{once:true});w.__developments.push(row);return gpuRaw.liveScene(p,e,signal,importance,...rest);}};
   w.fetch=(url,options)=>{w.__liveRequests.push({url:String(url),body:typeof options?.body==='string'?options.body:null});return fetch(url,options);};
  });
  const detached=await library.evaluate(async(element,source)=>{
   const w=element.contentWindow,original=w.HDRLibraryGpuRaw;let starts=0,entered;
   const begun=new Promise(resolve=>entered=resolve);
   w.HDRLibraryGpuRaw={...original,liveScene:(...args)=>{starts++;entered();return original.liveScene(...args);}};
   try{
    const controller=new w.AbortController();
    const first=w.HDRLibraryScenes.load(source,640,controller.signal).catch(error=>error.name);
    await begun;controller.abort();
    const detachedResult=await first;
    const active=w.HDRLibraryScenes.snapshot().sources.active;
    const returned=await w.HDRLibraryScenes.load(source,2560,undefined,0);
    const small=await w.HDRLibraryScenes.load(source,640);
    const large=await w.HDRLibraryScenes.load(source,2560);
    return {starts,detachedResult,active,returnedEdge:returned.edge,smallCached:small.cache_hit,largeCached:large.cache_hit};
   }finally{w.HDRLibraryGpuRaw=original;}
  },path.join(folder,'DSC07060.ARW'));
  assert.equal(detached.detachedResult,'AbortError');assert.equal(detached.active,1);
  assert.equal(detached.starts,2,'Different resolutions develop independently; matching demand reuses preparation');
  assert.equal(detached.returnedEdge,2560);assert.ok(detached.smallCached&&detached.largeCached,'Each requested resolution is stored and reused');
  const start=Date.now();
  await library.evaluate((element,folder)=>element.contentWindow.HDRLibrary.browse(folder),folder);
  const settled=()=>page.waitForFunction(()=>{
   const d=document.querySelector('#library-frame').contentWindow.document;
   return [...d.querySelectorAll('#grid-space .library-cell canvas[data-picture-key]')].filter(c=>!c.hidden).length===4;
  },null,{timeout:120000});
  await settled();
  const coldMs=Date.now()-start;
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
  await library.evaluate(async element=>{
   const w=element.contentWindow,gpu=await w.HDRLibraryPictures.initialize();
   w.__requestAdapter=w.navigator.gpu.requestAdapter.bind(w.navigator.gpu);
   w.navigator.gpu.requestAdapter=async()=>null;gpu.device.destroy();
  });
  await page.waitForFunction(()=>{
   const d=document.querySelector('#library-frame').contentWindow.document;
   return [...d.querySelectorAll('#grid-space img[data-cpu-fallback="true"]')].filter(c=>!c.hidden).length===4;
  },null,{timeout:120000});
  const fallback=await library.evaluate(element=>{
   const w=element.contentWindow,requests=w.__liveRequests.filter(r=>r.url==='/api/library/fallback-picture');
   const paths=[...w.document.querySelectorAll('#grid-space .library-cell')].map(c=>c.dataset.path);
   return {paths,requested:requests.map(r=>JSON.parse(r.body).path)};
  });
  assert.deepEqual([...new Set(fallback.requested)].sort(),fallback.paths.sort(),'CPU files are only requested for visible cells');
  await library.evaluate(element=>{const w=element.contentWindow;w.navigator.gpu.requestAdapter=w.__requestAdapter;});
  await settled();
  const gridOnly=await library.evaluate(element=>element.contentWindow.__developments.slice(2));
  assert.ok(gridOnly.every(row=>row.edge===640),'Cold grid and recovery develop only 640');
  const beforeToggle=await library.evaluate(element=>element.contentWindow.__developments.length);
  await library.evaluate(element=>element.contentWindow.document.getElementById('hdr-button').click());
  await settled();
  await library.evaluate(element=>element.contentWindow.document.getElementById('hdr-button').click());
  await settled();
  assert.equal(await library.evaluate(element=>element.contentWindow.__developments.length),beforeToggle,'M20: changing HDR/SDR only redraws the existing scene');
  report.m20=true;
  const singleStarted=Date.now();
  await library.evaluate(element=>{
   const d=element.contentWindow.document;
   [...d.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path.endsWith('DSC07061.ARW')).click();
   d.getElementById('single-view').click();
  });
  await page.waitForFunction(()=>{
   const c=document.querySelector('#library-frame').contentWindow.document.getElementById('single-picture');
   return c.dataset.picturePath?.endsWith('DSC07061.ARW')&&Number(c.dataset.pictureEdge)===2560;
  },null,{timeout:60000});
  report.singleMs=Date.now()-singleStarted;
  await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.__developments.some(row=>row.edge===2560&&row.priority===50),null,{timeout:30000});
  report.neighboursSoon=true;
  await library.evaluate(element=>element.contentWindow.document.getElementById('grid-view').click());
  await new Promise(resolve=>setTimeout(resolve,1000));
  report.developments=await library.evaluate(element=>element.contentWindow.__developments);
  assert.deepEqual(errors,[],'No page errors');
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({coldMs,...report},null,2));
  console.log(JSON.stringify({coldMs,reuse:report.rows.map(r=>({name:r.name,ms:r.reuseMs})),residentBytes:report.memory.resident.totalBytes,gpuRecovery:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
