const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'), output=path.join(root,'output/library-fullscreen-raw');
fs.mkdirSync(output,{recursive:true});
const corpus=JSON.parse(fs.readFileSync(path.join(root,'output/library-measurements/corpus.json'),'utf8'));
const source=corpus.rows.find(row=>!row.error&&!row.excluded&&row.path.endsWith('DSC04761.ARW')&&fs.existsSync(row.path))?.path;
if(!source)throw Error('RAW test corpus is unavailable');
const folder=fs.mkdtempSync(path.join(output,'photos-'));
const portrait=corpus.rows.find(row=>!row.error&&!row.excluded&&row.path.endsWith('DSC06615_DxO-optical-corr-only.dng')&&fs.existsSync(row.path))?.path;
if(!portrait)throw Error('Portrait RAW test corpus is unavailable');
for(let i=0;i<3;i++)fs.copyFileSync(i===2?portrait:source,path.join(folder,`photo-${i}.${i===2?'dng':'ARW'}`));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>!!window.HDRLibrary);
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
  // Each cell finished: a drawn picture or, for camera RAWs, its saved thumbnail.
  await lib.waitForFunction(()=>[...document.querySelectorAll('#grid-space .library-cell')].filter(cell=>cell.querySelector('canvas[data-picture-key],img[data-picture-key]')).length===3,null,{timeout:90000});
  await lib.locator('.library-cell').filter({hasText:'photo-1.ARW'}).click();await page.keyboard.press('f');
  await lib.waitForFunction(()=>document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-1.ARW')&&Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280,null,{timeout:90000});
  await lib.evaluate(async()=>{
   const gpu=await HDRLibraryPictures.initialize(), load=gpu.loadProxy.bind(gpu);
   window.libraryShapeChecks=0;
   gpu.loadProxy=async(...args)=>{
    const canvas=document.querySelector('#single-picture'), before=[canvas.width,canvas.height];
    const pending=load(...args);
    await new Promise(resolve=>setTimeout(resolve,100));
    if(canvas.width!==before[0]||canvas.height!==before[1])throw Error('Visible photo resized while pixels were loading');
    window.libraryShapeChecks++;
    return pending;
   };
  });
  const shapes=new Set();
  for(const [key,name] of [['ArrowRight','photo-2.dng'],['ArrowLeft','photo-1.ARW'],['ArrowLeft','photo-0.ARW'],['ArrowRight','photo-1.ARW']]) {
   const start=Date.now();await page.keyboard.press(key);
   await lib.waitForFunction(name=>document.querySelector('#single-picture').dataset.picturePath?.endsWith(name),name,{timeout:30000});
   const first=Date.now()-start;
   await lib.waitForFunction(name=>document.querySelector('#single-picture').dataset.picturePath?.endsWith(name)&&Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280,name,{timeout:90000});
   shapes.add(await lib.evaluate(()=>{const c=document.querySelector('#single-picture');return c.width>c.height?'landscape':'portrait';}));
   console.log(name,`first picture ${first}ms; full preview ${Date.now()-start}ms`);
  }
  assert.equal(shapes.size,2,'Navigation covers landscape and portrait');
  assert.ok(await lib.evaluate(()=>window.libraryShapeChecks)>0,'Checked shape during pixel loading');
  assert.deepEqual(errors,[]);
  assert.equal(fs.readdirSync(folder).length,3,'Read-only browsing creates no settings files');
  console.log('PASS: fullscreen back/forward on disposable camera RAW copies; originals untouched.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
