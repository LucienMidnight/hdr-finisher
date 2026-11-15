// Execute the native handoff scenario against current or committed frontend
// code without changing the shared checkout. Playwright is Electron's real page.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
 const sidecars=new Map(['DSC04375.ARW','DSC00264.ARW'].map(name=>{
  const file=path.resolve('output/test-photos/library-live-grid',name+'.hdrf');return [file,fs.existsSync(file)?fs.readFileSync(file):null];
 }));
 const browser=await chromium.launch({headless:false});
 try{
  const page=await browser.newPage();
  if(process.argv.includes('--before')){
   const body=execFileSync('git',['show','97078dba:codebase/frontend/photo-library.js'],{encoding:'utf8'});
   await page.route('**/photo-library.js*',route=>route.fulfill({body,contentType:'application/javascript'}));
  }
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#library-frame')?.contentWindow?.HDRLibrary);
  await page.evaluate(()=>fetch('/api/library/memory-setting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bytes:4000000000})}));
  const frame=page.frames().find(f=>/\/library(?:\?|$)/.test(f.url()));
  const capturePage=async clip=>{
   const png=await page.screenshot({clip});
   const pixels=await page.evaluate(async encoded=>{
    const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(0,0,canvas.width,canvas.height).data];
   },png.toString('base64'));
   return {toPNG:()=>png,toBitmap:()=>Buffer.from(pixels)};
  };
  const window={webContents:{executeJavaScript:code=>page.evaluate(code),capturePage}};
  const out=path.resolve('output/w2-p2-'+(process.argv.includes('--before')?'before-ready':'after-ready'));
  const result=await require('../../desktop/library-grade-picture-check.cjs').run({window,
   frame:{executeJavaScript:code=>frame.evaluate(code)},stage:stage=>console.log(stage),
   config:{folder:path.resolve('output/test-photos/library-live-grid'),pixelReviewOut:out,gradeHandoffImmediate:true}});
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.grade_handoff.rows.map(r=>({photo:r.photo,returnMs:r.return_to_picture_ms,handoff:r.handoff})),null,2));
  if(result.errors.length)throw Error(result.errors.join('; '));
 }finally{await browser.close();for(const [file,body] of sidecars){if(body)fs.writeFileSync(file,body);else fs.rmSync(file,{force:true});}}
})().catch(error=>{console.error(error);process.exitCode=1;});
