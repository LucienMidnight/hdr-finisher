/* A saved repaired RAW develops on the Library GPU, with one disposable copy. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const owner='D:/Photos/HDR Test Images/DSC04375.ARW',folder=path.resolve('output/test-photos'),copy=path.join(folder,'DSC04375.ARW');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=[hash(owner),hash(owner+'.hdrf')];fs.mkdirSync(folder,{recursive:true});
if(!fs.existsSync(copy))fs.copyFileSync(owner,copy);
fs.copyFileSync(owner+'.hdrf',copy+'.hdrf');
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const result=await page.locator('#library-frame').evaluate(async(el,{copy,folder})=>{
   const w=el.contentWindow;await w.HDRLibrary.browse(folder);
   const gpu=await w.HDRLibraryPictures.initialize();
   const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
   const draw=async meta=>{await w.HDRLibraryPictures.show(meta,canvas,new AbortController().signal,()=>true,false);await new Promise(w.requestAnimationFrame);await new Promise(w.requestAnimationFrame);};
   const started=performance.now();
   const cold=await w.HDRLibraryGpuRaw.liveScene(copy,640);
   if(!cold||cold.renderer!=='gpu')throw Error('Repaired RAW used CPU: '+JSON.stringify(cold));
   await draw(cold);const coldMs=performance.now()-started;
   const again=performance.now(),warm=await w.HDRLibraryGpuRaw.liveScene(copy,640);
   await draw(warm);canvas.remove();return {coldMs,warmMs:performance.now()-again,cold,warm};
  },{copy,folder});
  assert.equal(result.cold.renderer,'gpu');assert.equal(result.warm.key,result.cold.key);
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
  console.log(JSON.stringify({coldMs:result.coldMs,warmMs:result.warmMs,withoutRepairsMs:result.withoutRepairs.ms}));
  const output=path.resolve('output/retouch-library');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
 }finally{
  assert.deepEqual([hash(owner),hash(owner+'.hdrf')],before,'Owner files changed');
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
