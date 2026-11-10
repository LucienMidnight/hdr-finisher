// Focus and Exposure on undeveloped RAW photos (camera previews), November 7, 2026.
// Uses hard links to the shared test RAWs: no copies, originals untouched.
// Set LIBRARY_RAW_OVERLAY_REVIEW=1 to write the review page crops.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),photos=path.join(root,'output','test-photos');
const review=process.env.LIBRARY_RAW_OVERLAY_REVIEW==='1'?path.join(root,'output','review','library-raw-overlays'):null;
const names=['DSC07060.ARW','IMG_0114.CR2','IMG_3129.CR2'];  // Sony landscape, Canon portrait, Canon landscape.
for(const name of names){assert.ok(fs.existsSync(path.join(photos,name)),`missing test photo ${name}`);assert.ok(!fs.existsSync(path.join(photos,name+'.hdrf')),`${name} is graded`);}
const folders=[];
function link(prefix,files){const folder=fs.mkdtempSync(path.join(root,'output',prefix));folders.push(folder);
  for(const [name,as] of files){try{fs.linkSync(path.join(photos,name),path.join(folder,as));}catch{fs.copyFileSync(path.join(photos,name),path.join(folder,as));}}return folder;}
(async()=>{const browser=await chromium.launch({headless:true});try{
  const a=link('raw-overlays-a-',names.map(n=>[n,n])),b=link('raw-overlays-b-',[['DSC07060.ARW','B07060.ARW'],['IMG_3129.CR2','B3129.CR2']]);
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.evaluate(()=>activateWorkflowTab('import'));
  const host=page.locator('#library-frame'),frame=page.frameLocator('#library-frame');
  const snapshot=()=>host.evaluate(e=>e.contentWindow.HDRLibrary.getSnapshot());
  const browse=async(folder,count)=>{await host.evaluate((e,p)=>e.contentWindow.HDRLibrary.browse(p),folder);
    await page.waitForFunction(n=>document.querySelector('#library-frame').contentDocument.querySelectorAll('.library-cell canvas[data-picture-key^="original:"]:not([hidden])').length>=n,count,{timeout:120000});};
  const timed=async(key,selector)=>{await frame.locator('#library-grid').focus();const start=Date.now();await page.keyboard.press(key);await frame.locator(selector).first().waitFor({timeout:120000});return Date.now()-start;};
  // Overlay box and shown picture's box must agree within one CSS pixel (both fitted with object-fit).
  const placement=layers=>layers.evaluateAll(list=>list.map(layer=>{
    const parent=layer.parentElement;
    const picture=parent.querySelector(':scope > #single-picture:not([hidden])')||parent.querySelector(':scope > canvas.compare-fit')||
      [...parent.querySelectorAll(':scope > canvas[data-picture-key]:not(.library-source-overlay)')].find(c=>!c.hidden&&c.offsetWidth>0&&getComputedStyle(c).visibility!=='hidden');
    const box=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),n=k=>parseFloat(s[k])||0;
      const left=r.left+n('borderLeftWidth')+n('paddingLeft'),top=r.top+n('borderTopWidth')+n('paddingTop');
      const w=r.width-n('borderLeftWidth')-n('borderRightWidth')-n('paddingLeft')-n('paddingRight'),h=r.height-n('borderTopWidth')-n('borderBottomWidth')-n('paddingTop')-n('paddingBottom');
      if(s.objectFit!=='contain')return [left,top,w,h];const k=Math.min(w/e.width,h/e.height);return [left+(w-e.width*k)/2,top+(h-e.height*k)/2,e.width*k,e.height*k];};
    const data=layer.getContext('2d').getImageData(0,0,layer.width,layer.height).data;let marked=0;for(let i=3;i<data.length;i+=4)if(data[i])marked++;
    return {kind:layer.dataset.kind,camera:layer.dataset.camera,key:layer.dataset.key,quality:layer.dataset.quality,path:parent.closest('[data-path]')?.dataset.path||picture?.dataset.picturePath,
      pictureKey:picture?.dataset.pictureKey,cameraPreview:picture?.dataset.cameraPreview,layer:box(layer),picture:picture?box(picture):null,marked};}));
  const checkPlacement=(rows,camera)=>{for(const row of rows){assert.ok(row.picture,`no shown picture for ${row.path}`);
    const gap=Math.max(...row.layer.map((v,i)=>Math.abs(v-row.picture[i])));assert.ok(gap<=1,`${row.kind} overlay is ${gap.toFixed(2)} CSS px off the picture for ${row.path}: ${row.layer} vs ${row.picture}`);
    assert.equal(row.camera,String(camera),`${row.kind} on ${row.path} camera=${row.camera}`);
    if(camera)assert.match(row.pictureKey,/^original:/,`${row.path} was developed`);else assert.match(row.pictureKey,/^live-/);}};
  const noneDeveloped=async()=>{assert.equal(await frame.locator('.library-cell .is-developed').count(),0,'a photo was developed');
    assert.equal(await frame.locator('.library-cell canvas[data-picture-key^="live-"]:not([hidden])').count(),0,'a tile shows a developed picture');};
  const unavailable=async()=>(await snapshot()).overlays.maps.filter(m=>m.unavailable).map(m=>`${m.kind} ${m.path}: ${m.unavailable}`);
  const shot=async(name,locator)=>{if(!review)return;fs.mkdirSync(review,{recursive:true});await page.mouse.move(0,0);
    const boxes=(await locator.evaluateAll(list=>list.map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];})));
    const offset=await host.boundingBox(),[l,t,r,b]=[0,1,2,3].map(i=>(i<2?Math.min:Math.max)(...boxes.map(box=>box[i])));
    await page.screenshot({path:path.join(review,name+'.png'),clip:{x:offset.x+l,y:offset.y+t,width:r-l,height:b-t}});};

  // B: single-view timing on an undeveloped RAW, then grid timing once developed (cold maps: new names).
  await browse(b,2);await frame.locator('.library-cell[data-path$="B07060.ARW"]').click();await frame.locator('#single-view').click();
  await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.querySelector('#single-picture[data-camera-preview="true"]:not([hidden])'),null,{timeout:120000});
  let start=Date.now();await page.keyboard.press('s');const singleLayer='#single-stage .library-source-overlay[data-kind="focus"][data-key]';
  await frame.locator(singleLayer).first().waitFor({timeout:120000});const singleHalf=Date.now()-start;
  await frame.locator(singleLayer+'[data-quality="full"]').first().waitFor({timeout:180000});const singleFull=Date.now()-start;
  checkPlacement(await placement(frame.locator(singleLayer)),true);await page.keyboard.press('s');await frame.locator('.library-source-overlay').first().waitFor({state:'detached'});
  await frame.locator('#grid-view').click();await frame.locator('.library-cell[data-path]').first().click();await page.keyboard.press('Control+a');
  await frame.locator('.library-cell[data-path]').first().click({button:'right'});await frame.getByRole('menuitem',{name:'Develop',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.querySelectorAll('.library-cell canvas[data-picture-key^="live-"]:not([hidden])').length>=2,null,{timeout:180000});
  const developedGrid=await timed('e','.library-cell .library-source-overlay[data-kind="exposure"][data-key]:visible');
  await frame.locator('.library-cell .library-source-overlay[data-kind="exposure"][data-key]').nth(1).waitFor({timeout:120000});
  console.log(`TIMING: single camera preview focus half ${singleHalf} ms, full ${singleFull} ms; grid developed exposure ${developedGrid} ms.`);
  checkPlacement(await placement(frame.locator('.library-cell .library-source-overlay[data-key]:visible')),false);await page.keyboard.press('e');await frame.locator('.library-source-overlay').first().waitFor({state:'detached'});

  // A: grid, three undeveloped RAWs, both overlays.
  await browse(a,3);await noneDeveloped();
  const cameraGrid=await timed('e','.library-cell .library-source-overlay[data-kind="exposure"][data-key]:visible');
  await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.querySelectorAll('.library-cell .library-source-overlay[data-kind="exposure"][data-key]:not([hidden])').length>=3,null,{timeout:120000}).catch(async e=>{console.log(await unavailable());throw e;});
  const cameraFocusGrid=await timed('s','.library-cell .library-source-overlay[data-kind="focus"][data-key]:visible');
  await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.querySelectorAll('.library-cell .library-source-overlay[data-kind="focus"][data-key]:not([hidden])').length>=3,null,{timeout:120000}).catch(async e=>{console.log(await unavailable());throw e;});
  console.log(`TIMING: grid camera preview exposure ${cameraGrid} ms, focus ${cameraFocusGrid} ms.`);
  let rows=await placement(frame.locator('.library-cell .library-source-overlay[data-key]:visible'));assert.equal(rows.length,6);checkPlacement(rows,true);
  for(const row of rows.filter(r=>r.kind==='focus'))assert.ok(row.marked>0,`no focus marks on ${row.path}`);
  assert.ok(rows.some(r=>r.kind==='exposure'&&r.marked>0),'no exposure marks on any photo');
  assert.deepEqual(await unavailable(),[]);await noneDeveloped();await shot('grid',frame.locator('.library-cell[data-path]'));
  const keys=Object.fromEntries(rows.map(r=>[r.path.split(/[\\/]/).pop()+'|'+r.kind,r.key]));

  // Single, filmstrip and compare views on the camera previews.
  for(const name of names){await frame.locator(`.library-cell[data-path$="${name}"]`).click();await frame.locator('#single-view').click();
    await page.waitForFunction(n=>{const c=document.querySelector('#library-frame').contentDocument.querySelector('#single-picture:not([hidden])');return c&&c.dataset.cameraPreview==='true'&&c.dataset.picturePath?.endsWith(n);},name,{timeout:120000});
    const layers=frame.locator('#single-stage .library-source-overlay[data-key]:visible');
    await frame.locator('#single-stage .library-source-overlay[data-kind="focus"][data-quality="full"]').first().waitFor({timeout:180000});
    await frame.locator('#single-stage .library-source-overlay[data-kind="exposure"][data-key]').first().waitFor({timeout:120000});
    rows=await placement(layers);assert.equal(rows.length,2);checkPlacement(rows,true);
    await frame.locator('#filmstrip .library-source-overlay[data-kind="focus"][data-key]').first().waitFor({timeout:120000});checkPlacement(await placement(frame.locator('#filmstrip .library-source-overlay[data-key]:visible')),true);
    await shot('single-'+name.split('.')[0],frame.locator('#single-stage'));await frame.locator('#grid-view').click();}
  await frame.locator(`.library-cell[data-path$="${names[0]}"]`).click();await page.keyboard.press('Control+a');await frame.locator('#single-view').click();await page.keyboard.press('[');
  await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.querySelectorAll('.compare-stage .library-source-overlay[data-kind="focus"][data-quality="full"]:not([hidden])').length>=2,null,{timeout:180000});
  checkPlacement(await placement(frame.locator('.compare-stage .library-source-overlay[data-key]:visible')),true);await page.keyboard.press('[');await frame.locator('#grid-view').click();await noneDeveloped();

  // Develop the portrait: Exposure reuses its source map; provisional camera Focus is replaced by RAW Focus.
  const portrait=frame.locator(`.library-cell[data-path$="${names[1]}"]`);await portrait.click();await portrait.click({button:'right'});await frame.getByRole('menuitem',{name:'Develop',exact:true}).click();
  await portrait.locator('canvas[data-picture-key^="live-"]:not([hidden])').waitFor({timeout:180000});
  await page.waitForFunction(n=>[...document.querySelector('#library-frame').contentDocument.querySelectorAll(`.library-cell[data-path$="${n}"] .library-source-overlay[data-key][data-camera="false"]:not([hidden])`)].length>=2,names[1],{timeout:120000});
  rows=await placement(portrait.locator('.library-source-overlay[data-key]:visible'));checkPlacement(rows,false);
  for(const row of rows){if(row.kind==='exposure')assert.equal(row.key,keys[names[1]+'|'+row.kind],'Exposure must reuse its sensor map');else{assert.notEqual(row.key,keys[names[1]+'|focus'],'camera Focus must not seed a developed picture');assert.ok(['half','full'].includes(row.quality));}}
  assert.deepEqual(errors,[]);
  console.log(`TIMING: first overlay after key press; grid camera preview exposure ${cameraGrid} ms, focus ${cameraFocusGrid} ms; grid developed exposure ${developedGrid} ms; single camera preview focus half ${singleHalf} ms, full ${singleFull} ms.`);
  // Review page: downscaled JPEG crops and one index, overwritten on each run.
  if(review)execFileSync(path.join(root,'.venv','Scripts','python.exe'),['-c',`import sys,html
from pathlib import Path
from PIL import Image
d=Path(sys.argv[1]);rows=[]
for p in sorted(d.glob('*.png')):
    i=Image.open(p).convert('RGB');i.thumbnail((1400,1400));i.save(p.with_suffix('.jpg'),quality=85);p.unlink();rows.append(p.stem)
body=''.join(f'<h2>{html.escape(r)}</h2><img src="{r}.jpg">' for r in rows)
(d/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>RAW overlays</title><style>body{background:#111;color:#ddd;font:14px sans-serif;margin:16px}img{max-width:100%}</style><h1>Focus and Exposure on undeveloped RAW camera previews</h1><p>Exposure (red/blue) and Focus (green) over the camera preview; nothing was developed. Sony A-series landscape, Canon portrait, Canon landscape.</p>'+body,encoding='utf-8')`,review],{stdio:'inherit'});
  console.log('PASS: Focus and Exposure on undeveloped Sony/Canon RAWs (landscape and portrait) in grid, filmstrip, single and compare, aligned to the camera preview within 1 CSS px, nothing developed; Develop reuses Exposure and replaces provisional Focus with the source map.');
}finally{await browser.close();for(const folder of folders)fs.rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:500});}})().catch(e=>{console.error(e);process.exitCode=1;});
