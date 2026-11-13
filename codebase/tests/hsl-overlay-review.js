const assert=require('node:assert/strict');
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const {photosPath}=require('./helpers/photos-root.cjs');
const out=path.resolve('output/hsl-smooth');fs.mkdirSync(out,{recursive:true});
const tag=process.argv.includes('--before')?'before':'after';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage();
try{
await page.addInitScript(() => localStorage.setItem('hdr-finisher:library-show-all-files','true'));
await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
const photo=require('./helpers/reuse-test-photo.cjs')(photosPath('D:/Photos/Play_Raw/Balanced Rock in Arches Nat Park - LaurentFromSF/IMG_0114.CR2'),path.join(out,'IMG_0114.CR2'));
await page.evaluate(async photo=>{
 state.appPreferences.gradeAutosave=false;
 const grant=await desktop.grantSourcePath(photo);
 const created=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=created.payload;if(!created.response.ok)throw Error(JSON.stringify(job));
 while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
 if(job.state!=='ready')throw Error(JSON.stringify(job));
 await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');activateWorkflowTab('grade');
},photo);
await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==='ready',null,{timeout:180000});
await page.evaluate(()=>{document.querySelector('[data-group="hsl"]').classList.remove('collapsed');hslUI.panels[0].channel='yellow';renderHslPanels();});
const samples=await page.evaluate(()=>[document.querySelector('[data-group="hsl"] .group-toggle'),document.getElementById('hdr-exposure'),document.getElementById('app-menu-button')].filter(Boolean).map(element=>{const box=element.getBoundingClientRect();return{x:Math.floor(box.left+box.width/2),y:Math.floor(box.top+box.height/2)};}).filter(point=>point.x>=0&&point.y>=0&&point.x<innerWidth&&point.y<innerHeight));
assert.ok(samples.length>=2,'Visible interface probes outside the photo');
const sample=()=>Promise.all(samples.map(p=>page.screenshot({clip:{...p,width:1,height:1}})));
const show=()=>page.evaluate(async()=>{const ui=hslUI.panels[0];ui.host.querySelector('[data-hsl-selection]').setAttribute('aria-pressed','true');await hslSelection(ui);});
for(const zoom of [113,'fit',100,75,125,'fit']){
 await page.evaluate(zoom=>{if(zoom==='fit')setZoomMode('fit');else setCustomZoom(zoom);},zoom);
 await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==='ready',null,{timeout:120000});
 if(!await page.locator('#hsl-selection-overlay').count())await show();
 await page.evaluate(()=>document.getElementById('hsl-selection-overlay').style.visibility='hidden');const off=await sample();
 await page.evaluate(()=>document.getElementById('hsl-selection-overlay').style.visibility='');
 await page.waitForFunction(()=>document.getElementById('hsl-selection-overlay')?.naturalWidth>0,null,{timeout:120000});
 if(tag==='after')assert.deepEqual(await sample(),off,'Panels, toolbar and scopes are unchanged');
 await page.screenshot({path:path.join(out,`${tag}-overlay-${zoom}.png`)});
 if(tag==='after'){
  const boxes=await page.evaluate(()=>{const a=activePreviewElement().getBoundingClientRect(),b=document.getElementById('hsl-selection-overlay').getBoundingClientRect();return ['left','top','width','height'].map(k=>Math.abs(a[k]-b[k]));});
  assert.ok(boxes.every(v=>v<1),'Overlay follows the photo');
 }
 console.log('OVERLAY',zoom,await page.evaluate(()=>{const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}};return {photo:r(activePreviewElement()),overlay:r(document.getElementById('hsl-selection-overlay'))};}));
}
if(tag==='after'){
 await page.evaluate(()=>{setCustomZoom(100);els.dropzone.scrollLeft+=137;els.dropzone.scrollTop+=181;});
 await page.waitForTimeout(100);
 const pan=await page.evaluate(()=>{const a=activePreviewElement().getBoundingClientRect(),b=document.getElementById('hsl-selection-overlay').getBoundingClientRect();return ['left','top','width','height'].map(k=>Math.abs(a[k]-b[k]));});assert.ok(pan.every(v=>v<1),'Active overlay follows pan');
 await page.evaluate(async()=>{await switchLane('sdr');setZoomMode('fit');});await show();
 await page.waitForFunction(()=>document.getElementById('hsl-selection-overlay')?.naturalWidth>0);
 await page.screenshot({path:path.join(out,'after-sdr-fit.png')});
 await page.evaluate(async()=>{await switchLane('hdr');setZoomMode('fit');});await show();
 await page.locator('[data-group="hsl"] .group-toggle').click();assert.equal(await page.locator('#hsl-selection-overlay').count(),0,'Collapse clears selection');
 await page.locator('[data-group="hsl"] .group-toggle').click();await show();
 await page.locator('[data-group="hdr-tone"] .group-toggle').click();assert.equal(await page.locator('#hsl-selection-overlay').count(),0,'Another section clears selection');
 await show();await page.evaluate(()=>setGradeMode('local'));assert.equal(await page.locator('#hsl-selection-overlay').count(),0);
 await page.evaluate(()=>setGradeMode('global'));await show();
 await page.evaluate(async()=>{
  setGradeMode('local');await assignToolToPending('luminance_range');
  // A changed range makes this an authored mask rather than a pending row.
  selectedMaskLeaf().full_start_ev=-7;if(!await commitSelectedLocal({maskContent:true}))throw Error("Luma fixture commit failed");
  state.localShowMask=true;
 });
 assert.equal(await page.evaluate(()=>Boolean(gpuLumaMaskOverlayOptions())),true,'Authored Luma overlay is available in Grade');
 await page.evaluate(()=>activateWorkflowTab('proof'));
 assert.equal(await page.evaluate(()=>gpuLumaMaskOverlayOptions()),null,'Luma overlay cannot enter Proof');
 assert.equal(await page.evaluate(()=>state.localShowMask),false,'Leaving Grade switches the Local overlay off');
 await page.evaluate(()=>{activateWorkflowTab('grade');setGradeMode('global');});await show();
 for(const workflow of ['proof','export']){
  await page.evaluate(w=>activateWorkflowTab(w),workflow);assert.equal(await page.locator('#hsl-selection-overlay').count(),0,workflow+' clears selection');
  await page.evaluate(()=>activateWorkflowTab('grade'));await show();
 }
}
await page.evaluate(()=>activateWorkflowTab('import'));await page.waitForTimeout(1200);
const library=page.frames().find(f=>/\/library(?:\?|$)/.test(f.url()));
const grid=path.join(out,'grid');fs.mkdirSync(grid,{recursive:true});for(let i=0;i<30;i++)fs.copyFileSync(path.resolve('tests/fixtures/library_photo.png'),path.join(grid,`picture-${i}.png`));
await library.evaluate(folder=>HDRLibrary.browse(folder),grid);
await library.waitForFunction(()=>document.querySelectorAll('#grid-space canvas[data-picture-key],#grid-space canvas[data-stand-in="true"],#grid-space img[data-cpu-fallback="true"]').length>0,null,{timeout:90000});
await page.waitForTimeout(500);
await page.screenshot({path:path.join(out,`${tag}-library.png`)});
if(tag==='after'){
 assert.equal(await page.locator('#hsl-selection-overlay').count(),0,'Leaving Grade removes overlay');
 const points=await page.evaluate(()=>[{x:innerWidth*.45,y:innerHeight*.55},{x:innerWidth*.65,y:innerHeight*.55},{x:innerWidth*.8,y:innerHeight*.75}].map(point=>({x:Math.floor(point.x),y:Math.floor(point.y)})));
 const grab=()=>Promise.all(points.map(p=>page.screenshot({clip:{...p,width:1,height:1}})));
 const returned=await grab();await page.evaluate(()=>hslClearSelection());assert.deepEqual(await grab(),returned,'Grid pixels have no leftover selection');
 console.log('PASS: photo alignment, panel/scope pixels, collapse, section, mode and Library cleanup');
}
console.log('LIBRARY overlay count',await page.locator('#hsl-selection-overlay').count());
}catch(error){console.error(error);throw error;}finally{await browser.close();fs.rmSync(path.join(out,'grid'),{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
