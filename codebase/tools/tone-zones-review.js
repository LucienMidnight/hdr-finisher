// Review page for the Tone sliders (Blacks, Shadows, Midtones, Highlights) on real photos (copies only).
// Run from codebase: node tests/run-in-electron.js tools/tone-zones-review.js
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const out=path.resolve('output/tone-zones');fs.mkdirSync(out,{recursive:true});
const PHOTOS=[
 ['balanced-rock',require('../tests/helpers/photos-root.cjs').photosPath('D:/Photos/HDR Test Images/IMG_0114.CR2')],
 ['contre-jour',require('../tests/helpers/photos-root.cjs').photosPath("D:/Photos/HDR Test Images/IMG_0114.CR2")],
];
const STATES=[
 ['neutral',{}],
 ['blacks+60',{blacks:60}],['blacks-60',{blacks:-60}],
 ['shadows+60',{shadows:60}],['shadows-60',{shadows:-60}],
 ['midtones+60',{midtones:60}],['midtones-60',{midtones:-60}],
 ['highlights+60',{highlights:60}],['highlights-60',{highlights:-60}],
 ['shadows+60-narrow',{shadows:60,shadows_width:2}],['shadows+60-wide',{shadows:60,shadows_width:8}],
];
const NEUTRAL={blacks:0,shadows:0,midtones:0,highlights:0,shadows_center:-2.5,shadows_width:5,midtones_center:0,midtones_width:4,highlights_center:1.25,highlights_width:2.5};
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView
 &&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage();const rows=[];try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
 await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 for(const [name,original] of PHOTOS){
  const photo=path.join(out,name+path.extname(original));
  if(!fs.existsSync(photo))fs.copyFileSync(original,photo);
  await page.evaluate(async photo=>{const grant=await desktop.grantSourcePath(photo);const c=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=c.payload;
   while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
   if(job.state!=='ready')throw Error(JSON.stringify(job));await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');activateWorkflowTab('grade');},photo);
  await page.waitForFunction(settled,null,{timeout:180000});
  for(const lane of ['hdr','sdr']){
   await page.evaluate(async lane=>{await switchLane(lane);invalidatePreview(lane);await settlePreview(lane,{});},lane);
   await page.waitForFunction(settled,null,{timeout:180000});
   for(const [label,values] of STATES){
    await page.evaluate(async({lane,values,neutral})=>{Object.assign(state.adjustments[lane],neutral,values);
     state.globalEditDirty=true;await syncGlobalEditState();invalidatePreview(lane);await settlePreview(lane,{});},{lane,values,neutral:NEUTRAL});
    await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(400);
    const clip=await page.evaluate(()=>{const r=activePreviewElement().getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height};});
    const file=`${name}-${lane}-${label}.png`;await page.screenshot({path:path.join(out,file),clip});rows.push({name,lane,label,file});
   }
   // The scope band for Shadows while its slider is hovered.
   await page.evaluate(async({lane,neutral})=>{Object.assign(state.adjustments[lane],neutral,{shadows:60});state.globalEditDirty=true;await syncGlobalEditState();
    invalidatePreview(lane);await settlePreview(lane,{});
    const group=document.querySelector(`[data-group="${lane}-tone"]`);group.classList.remove('collapsed');group.querySelector('.group-toggle')?.setAttribute('aria-expanded','true');},{lane,neutral:NEUTRAL});
   await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(800);
   const tile=page.locator(`[data-lane-panel="${lane}"] [data-zone-hover="shadows"]`);
   await tile.scrollIntoViewIfNeeded();await tile.hover();await page.waitForTimeout(400);
   const scopeFile=`${name}-${lane}-scope-shadows-band.png`;
   await page.locator('#histogram').screenshot({path:path.join(out,scopeFile)});rows.push({name,lane,label:'scope band (Shadows hovered)',file:scopeFile});
   const panelFile=`${name}-${lane}-tone-panel.png`;
   await page.locator(`[data-group="${lane}-tone"]`).screenshot({path:path.join(out,panelFile)});rows.push({name,lane,label:'Tone panel',file:panelFile});
   await page.mouse.move(5,5);
  }
 }
}finally{
 const groups={};for(const r of rows)(groups[`${r.name} — ${r.lane.toUpperCase()}`]??=[]).push(r);
 const html=`<!doctype html><meta charset="utf-8"><title>Tone sliders review</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:24px}h2{margin-top:36px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}figure{margin:0}img{width:100%;background:#000}figcaption{padding:4px 0}</style>
<h1>Tone sliders: Blacks, Shadows, Midtones, Highlights</h1>
<p>Each slider at +60 and −60 (of ±100) with default Center and Width; Shadows +60 with a narrow (2 stops) and a wide (8 stops) Width; the scope band while Shadows is hovered; the new Tone panel. Copies of the photos, default grade otherwise.</p>
${Object.entries(groups).map(([title,items])=>`<h2>${title}</h2><div class="grid">${items.map(r=>`<figure><img src="${r.file}" loading="lazy"><figcaption>${r.label}</figcaption></figure>`).join('')}</div>`).join('')}`;
 fs.writeFileSync(path.join(out,'index.html'),html);await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
