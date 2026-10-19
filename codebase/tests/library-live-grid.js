/* Live unedited cells: stored scene reuse, no JPEG publication and GPU recovery. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-live-grid',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const sources=['DSC07060','DSC07061','DSC07072'].map(n=>'D:/test-photos-delete-later/'+n+'.ARW');
for(const source of [...sources,path.join(root,'tests/fixtures/sdr_gradient.png')])fs.copyFileSync(source,path.join(folder,path.basename(source)));
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.evaluate(()=>activateWorkflowTab('import'));
  const library=page.locator('#library-frame');
  await library.evaluate(element=>{
   const w=element.contentWindow,fetch=w.fetch.bind(w);w.__liveRequests=[];
   w.fetch=(url,options)=>{w.__liveRequests.push({url:String(url),body:typeof options?.body==='string'?options.body:null});return fetch(url,options);};
  });
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
  assert.deepEqual(errors,[],'No page errors');
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({coldMs,...report},null,2));
  console.log(JSON.stringify({coldMs,reuse:report.rows.map(r=>({name:r.name,ms:r.reuseMs})),residentBytes:report.memory.resident.totalBytes,gpuRecovery:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
