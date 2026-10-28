const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const folder=path.resolve('output/retouch-review'),python=path.resolve('.venv/Scripts/python.exe');
const owner='D:/Photos/HDR Test Images/DSC04375.ARW',hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=[hash(owner),hash(owner+'.hdrf')];
(async()=>{const browser=await chromium.launch();try{
 execFileSync(python,['tests/helpers/retouch_photo_review.py','prepare',folder],{stdio:'inherit'});
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.addScriptTag({url:'/static/retouch-gpu.js'});
 await page.evaluate(async()=>{window.__repairGpu=new HDRWebGPUPreview(document.createElement('canvas'));if(!await __repairGpu.initialize())throw Error('GPU unavailable');});
 const results=[];
 for(const row of JSON.parse(fs.readFileSync(path.join(folder,'packets.json'),'utf8'))){
  results.push(await page.evaluate(async row=>{
   const body=Uint8Array.from(atob(row.body),c=>c.charCodeAt(0)).buffer;
   const result=await HDRRetouchGPU.run(__repairGpu.device,row.meta,body,async()=>{},512*1024*1024);
   let encoded='';for(const v of new Uint8Array(result.pixels))encoded+=String.fromCharCode(v);return btoa(encoded);
  },row));
 }
 fs.writeFileSync(path.join(folder,'gpu.json'),JSON.stringify(results));
 execFileSync(python,['tests/helpers/retouch_photo_review.py','finish',folder],{stdio:'inherit'});
}finally{assert.deepEqual([hash(owner),hash(owner+'.hdrf')],before);await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
