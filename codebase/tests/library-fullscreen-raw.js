const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'), output=path.join(root,'output/library-fullscreen-raw');
fs.mkdirSync(output,{recursive:true});
const graded=process.env.HDR_FINISHER_GRADED_TRIAL==='1', cold=process.env.HDR_FINISHER_COLD_TRIAL==='1';
const corpus=JSON.parse(fs.readFileSync(path.join(root,'output/library-measurements/corpus.json'),'utf8'));
const source=corpus.rows.find(row=>!row.error&&!row.excluded&&row.path.endsWith('DSC04761.ARW')&&fs.existsSync(row.path))?.path;
if(!source)throw Error('RAW test corpus is unavailable');
const folder=fs.mkdtempSync(path.join(output,'photos-'));
const portrait=corpus.rows.find(row=>!row.error&&!row.excluded&&row.path.endsWith('DSC06615_DxO-optical-corr-only.dng')&&fs.existsSync(row.path))?.path;
if(!portrait)throw Error('Portrait RAW test corpus is unavailable');
const trialSources=cold ? ['DSC07165','DSC07166','DSC07168'].map(name=>path.join('D:/Photos/2026/20261017 badminton',name+'.ARW')) : graded ? ['DSC07178','DSC07253','DSC07254'].map(name=>path.join('D:/Photos/2026/20261017 badminton',name+'.ARW')) : [source,source,portrait];
for(let i=0;i<3;i++) {
 const target=path.join(folder,`photo-${i}.${i===2&&!graded&&!cold?'dng':'ARW'}`);
 fs.copyFileSync(trialSources[i],target);
 if(graded||(cold&&fs.existsSync(trialSources[i]+'.hdrf')))fs.copyFileSync(trialSources[i]+'.hdrf',target+'.hdrf');
}
const initialFiles=fs.readdirSync(folder).sort();
const beforeFiles=Object.fromEntries(initialFiles.map(name=>[name,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(folder,name))).digest('hex')]));
(async()=>{
 const browser=await chromium.launch({headless:true});let lib;
 try {
  const page=await browser.newPage(), errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>!!window.HDRLibrary);
  await lib.evaluate(()=>{
   const record=window.HDRLibraryStopwatch;
   window.part0bEvents=[];
   window.HDRLibraryStopwatch=(stage,fields)=>{window.part0bEvents.push({stage,...fields});record(stage,fields);};
  });
  if(process.env.HDR_FINISHER_PART0E_TRIAL==='1') {
    await require('./helpers/library-part0e')({page,lib,folder,output});
    assert.deepEqual(errors,[]);
    return;
  }
  if(cold) {
    await require('./helpers/library-cold-fullscreen')({page,lib,folder,output});
    assert.deepEqual(errors,[]);
    assert.deepEqual(fs.readdirSync(folder).sort(),initialFiles);
    for(const name of initialFiles)assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(folder,name))).digest('hex'),beforeFiles[name],name+' unchanged');
    console.log('PASS: cold fullscreen and 200 ms passed selections; copied photos and sidecars unchanged.');
    return;
  }
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
    // Observe cancellation immediately while the artificial delay is pending.
    pending.catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,100));
    if(canvas.width!==before[0]||canvas.height!==before[1])throw Error('Visible photo resized while pixels were loading');
    window.libraryShapeChecks++;
    return pending;
   };
  });
  // Hold the actual draw so the previous fullscreen image cannot hide a flash.
  await page.keyboard.press('Escape');
  await lib.locator('.library-cell').filter({hasText:'photo-0.ARW'}).click();
  await lib.evaluate(()=>{
   const cell=[...document.querySelectorAll('#grid-space .library-cell')].find(cell=>cell.dataset.path.endsWith('photo-0.ARW'));
   for(const canvas of cell.querySelectorAll('canvas')) delete canvas.dataset.picturePath;
   const pictures=HDRLibraryPictures;
   window.fullscreenDrawStarted=false;
   const gate=new Promise(resolve=>{window.releaseFullscreenDraw=resolve;});
   window.HDRLibraryPictures={...pictures,show:async(...args)=>{
    if(args[0].edge>=1280) {window.fullscreenDrawStarted=true;await gate;}
    return pictures.show(...args);
   }};
   window.restoreFullscreenPictures=()=>{window.HDRLibraryPictures=pictures;};
  });
  await page.keyboard.press('f');
  await lib.waitForFunction(()=>window.fullscreenDrawStarted);
  assert.equal(await lib.locator('#single-picture').isVisible(),false,'Previous photo stays hidden while selected photo drawing waits');
  await lib.waitForFunction(()=>[...document.querySelectorAll('canvas[data-stand-in="true"]')].some(canvas=>!canvas.hidden&&canvas.dataset.picturePath?.endsWith('photo-0.ARW')));
  assert.ok((await lib.locator('#single-caption').textContent()).includes('photo-0.ARW'),'Caption immediately follows selection');
  await lib.evaluate(()=>window.releaseFullscreenDraw());
  await lib.waitForFunction(()=>document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-0.ARW'));
  assert.equal(await lib.locator('#single-picture').isVisible(),true,'Selected photo becomes visible after drawing');
  await lib.evaluate(()=>window.restoreFullscreenPictures());
  await page.keyboard.press('ArrowRight');
  await lib.waitForFunction(()=>document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-1.ARW'));
  console.log('PASS: Grid selection then F hides previous fullscreen pixels during delayed drawing.');
  const shapes=new Set();
  for(const [key,name] of [['ArrowRight',graded?'photo-2.ARW':'photo-2.dng'],['ArrowLeft','photo-1.ARW'],['ArrowLeft','photo-0.ARW'],['ArrowRight','photo-1.ARW']]) {
   const start=Date.now();await page.keyboard.press(key);
   await lib.waitForFunction(name=>document.querySelector('#single-picture').dataset.picturePath?.endsWith(name),name,{timeout:30000});
   const first=Date.now()-start;
   await lib.waitForFunction(name=>document.querySelector('#single-picture').dataset.picturePath?.endsWith(name)&&Number(document.querySelector('#single-picture').dataset.pictureEdge)>=1280,name,{timeout:90000});
   shapes.add(await lib.evaluate(()=>{const c=document.querySelector('#single-picture');return c.width>c.height?'landscape':'portrait';}));
   console.log(name,`first picture ${first}ms; full preview ${Date.now()-start}ms`);
  }
  if(!graded)assert.equal(shapes.size,2,'Navigation covers landscape and portrait');
  for(let i=0;i<10;i++){
   await page.keyboard.press(i%2?'ArrowLeft':'ArrowRight');
   await page.waitForTimeout(30);
   const wrong=await lib.evaluate(()=>{
    const name=document.querySelector('#single-caption').textContent;
    return [...document.querySelectorAll('#single-stage canvas[data-picture-path]')]
     .some(canvas=>!canvas.hidden&&canvas.style.visibility!=='hidden'&&!name.includes(canvas.dataset.picturePath.split(/[\\/]/).pop()));
   });
   assert.equal(wrong,false,'Rapid navigation never displays another photo');
  }
  await lib.waitForFunction(()=>!document.querySelector('#single-picture').hidden&&document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-1.ARW'),null,{timeout:30000});
  await page.waitForTimeout(250);
  fs.writeFileSync(path.join(output,graded?'part0c-events.json':'part0b-events.json'),JSON.stringify(await lib.evaluate(()=>window.part0bEvents),null,2));
  console.log('PASS: ten rapid direction changes retain the correct photo and finish sharp after stopping.');
  assert.ok(await lib.evaluate(()=>window.libraryShapeChecks)>0,'Checked shape during pixel loading');
  assert.deepEqual(errors,[]);
  assert.deepEqual(fs.readdirSync(folder).sort(),initialFiles,'Read-only browsing creates no settings files');
  for(const name of initialFiles)assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(folder,name))).digest('hex'),beforeFiles[name],name+' unchanged');
  console.log('PASS: fullscreen back/forward on disposable camera RAW copies; originals untouched.');
 } finally {
  if((graded||cold) && lib)fs.writeFileSync(path.join(output,cold?'part0d-events.json':'part0c-events.json'),JSON.stringify(await lib.evaluate(()=>window.part0bEvents).catch(()=>[]),null,2));
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
