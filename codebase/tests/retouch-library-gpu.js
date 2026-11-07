/* A saved repaired RAW develops on the Library GPU, with one disposable copy. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const owner='D:/Photos/HDR Test Images/DSC04375.ARW',folder=path.resolve('output/test-photos'),copy=path.join(folder,'DSC04375.ARW');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=[hash(owner),hash(owner+'.hdrf')];fs.mkdirSync(folder,{recursive:true});
if(!fs.existsSync(copy))fs.copyFileSync(owner,copy);
fs.copyFileSync(owner+'.hdrf',copy+'.hdrf');
const breakdown=process.argv.includes('--breakdown'),plain=process.argv.includes('--plain'),savedCopy=fs.readFileSync(copy+'.hdrf');
(async()=>{
 if(plain){const doc=JSON.parse(savedCopy);doc.grade.repairs=[];fs.writeFileSync(copy+'.hdrf',JSON.stringify(doc));}
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const result=await page.locator('#library-frame').evaluate(async(el,{copy,folder,breakdown})=>{
   const w=el.contentWindow,events=[],original=w.HDRLibraryStopwatch;
   if(breakdown)w.HDRLibraryStopwatch=(stage,fields={})=>{events.push({stage,at:w.performance.now(),...fields});original(stage,fields);};
   // Scene hand-offs leave the window through the Library upload worker
   // (HDRLibraryUpload, 91a2cee8). Count the bytes handed to it before they
   // are transferred, and the backend's answer for each live-scene upload.
   const upload=w.HDRLibraryUpload,isScene=url=>new URL(url,w.location.href).pathname==='/api/library/live-developed';
   const sizeOf=body=>body instanceof w.ArrayBuffer||w.ArrayBuffer.isView(body)?body.byteLength:0;
   w.__retouchUpload={count:0,bytes:0,accepted:0,restore:()=>{w.HDRLibraryUpload=upload;delete w.__retouchUpload;}};
   w.HDRLibraryUpload=Object.freeze({...upload,
    send:async(url,options={})=>{
     if(!isScene(url))return upload.send(url,options);
     const bytes=sizeOf(options.body),answer=await upload.send(url,options);
     w.__retouchUpload.count++;w.__retouchUpload.bytes+=bytes;
     let parsed=null;try{parsed=JSON.parse(answer.text||'null');}catch{}
     if(answer.ok&&parsed&&typeof parsed==='object')w.__retouchUpload.accepted++;
     return answer;
    }});
   // Profile this source alone: browsing also starts unrelated grid work.
   if(!breakdown)await w.HDRLibrary.browse(folder);
   const setupAt=w.performance.now(),gpu=await w.HDRLibraryPictures.initialize(),rendererSetupMs=w.performance.now()-setupAt;
   const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
   const draw=async meta=>{await w.HDRLibraryPictures.show(meta,canvas,new AbortController().signal,()=>true,false);await new Promise(w.requestAnimationFrame);await new Promise(w.requestAnimationFrame);};
   const started=w.performance.now();
   const cold=await w.HDRLibraryGpuRaw.liveScene(copy,640);
   if(!cold||cold.renderer!=='gpu')throw Error('Repaired RAW used CPU: '+JSON.stringify(cold));
   const sourceMs=w.performance.now()-started;
   if(breakdown)cold.trace=w.HDRLibraryTrace.begin('grid',copy,started);
   const drawAt=w.performance.now();await draw(cold);const coldMs=w.performance.now()-started;
   if(breakdown){canvas.remove();return {coldMs,sourceMs,drawAndPresentMs:w.performance.now()-drawAt,rendererSetupMs,fetchMs:gpu.libraryFetchMs,uploadMs:gpu.libraryUploadMs,cold,events:events.filter(e=>e.at>=started).map(e=>({...e,at:e.at-started}))};}
   const again=performance.now(),warm=await w.HDRLibraryGpuRaw.liveScene(copy,640);
   await draw(warm);canvas.remove();return {coldMs,warmMs:performance.now()-again,cold,warm};
  },{copy,folder,breakdown});
  assert.equal(result.cold.renderer,'gpu');
  if(breakdown){const output=path.resolve('output/retouch-library');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'breakdown-'+(plain?'plain':'repaired')+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({plain,coldMs:result.coldMs,sourceMs:result.sourceMs,drawAndPresentMs:result.drawAndPresentMs}));return;}
  assert.equal(result.warm.key,result.cold.key);
  // Compare source development with the same disposable photo and saved grade,
  // omitting repairs only for the baseline. Never touch the owner sidecar.
  const saved=fs.readFileSync(copy+'.hdrf');
  try{
   const doc=JSON.parse(saved);doc.grade.repairs=[];fs.writeFileSync(copy+'.hdrf',JSON.stringify(doc));
   await page.request.post(new URL('/api/library/cache-clear',process.env.HDR_FINISHER_URL).href,{data:{}});
   result.withoutRepairs=await page.locator('#library-frame').evaluate(async(el,copy)=>{
    const w=el.contentWindow,started=performance.now();const plain=await w.HDRLibraryGpuRaw.liveScene(copy,640);
    const canvas=w.document.createElement('canvas');w.document.body.append(canvas);await w.HDRLibraryPictures.show(plain,canvas,new AbortController().signal,()=>true,false);await new Promise(w.requestAnimationFrame);await new Promise(w.requestAnimationFrame);canvas.remove();
    return {ms:performance.now()-started,meta:plain};
   },copy);
  }finally{fs.writeFileSync(copy+'.hdrf',saved);}
  const uploads=await page.locator('#library-frame').evaluate(el=>{const u=el.contentWindow.__retouchUpload;return {count:u.count,bytes:u.bytes,accepted:u.accepted};});
  assert.ok(uploads.count>0 && uploads.bytes>0,'Full scene upload did not go through the Library upload worker: '+JSON.stringify(uploads));
  assert.equal(uploads.accepted,uploads.count,'Backend did not accept every scene upload: '+JSON.stringify(uploads));
  console.log(JSON.stringify({uploads,coldMs:result.coldMs,warmMs:result.warmMs,withoutRepairsMs:result.withoutRepairs.ms}));
  const output=path.resolve('output/retouch-library');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
  console.log('retouch-library-gpu PASS');
 }finally{
  fs.writeFileSync(copy+'.hdrf',savedCopy);
  assert.deepEqual([hash(owner),hash(owner+'.hdrf')],before,'Owner files changed');
  await browser.close();
 }
})().catch(error=>{fs.writeFileSync(copy+'.hdrf',savedCopy);console.error(error);process.exitCode=1;});
