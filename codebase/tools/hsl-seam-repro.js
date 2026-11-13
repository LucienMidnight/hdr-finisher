// Reproduce Steve's horizontal line: Balanced Rock (copy), SDR, Yellow 15/21 Luminance -2 EV, 423% on the bush.
// Run from codebase: node tests/run-in-electron.js tools/hsl-seam-repro.js [--lum -2] [--tag name-]
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const review=process.argv.includes('--review');
const out=path.resolve(review?'output/hsl-edge-controls':'output/hsl-seam');const arg=(n,d)=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:d;};
const lum=Number(arg('--lum','-2')),tag=arg('--tag','');fs.mkdirSync(out,{recursive:true});
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView
 &&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
(async()=>{const browser=await chromium.launch(),page=await browser.newPage();try{
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
 await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
 const photo=path.join(out,'IMG_0114.CR2');
 if(!fs.existsSync(photo))fs.copyFileSync(require('../tests/helpers/photos-root.cjs').photosPath('D:/Photos/Play_Raw/Balanced Rock in Arches Nat Park - LaurentFromSF/IMG_0114.CR2'),photo);
 await page.evaluate(async photo=>{const grant=await desktop.grantSourcePath(photo);const c=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=c.payload;
  while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
  if(job.state!=='ready')throw Error(JSON.stringify(job));await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');activateWorkflowTab('grade');},photo);
 await page.waitForFunction(settled,null,{timeout:180000});
 await page.evaluate(async ({lum,edge,feather,detail})=>{await switchLane('sdr');const b=state.adjustments.sdr,r=b.hsl.channels.find(c=>c.id==='yellow').recipe;
  r.ranges[0].width=15;r.ranges[0].feather=21;r.luminance=lum;r.edge=edge;r.edge_feather=feather;r.edge_detail=detail;r.uniformity=0;r.opacity=1;b.hsl_section_enabled=true;
  state.globalEditDirty=true;await syncGlobalEditState();},{lum,edge:Number(arg('--edge','3')),feather:Number(arg('--feather','6')),detail:Number(arg('--detail','75'))});
 await page.evaluate(()=>setCustomZoom(423));await page.waitForFunction(settled,null,{timeout:180000});
 await page.evaluate(([x,y])=>{const image=activePreviewElement().getBoundingClientRect(),view=els.dropzone.getBoundingClientRect();
  els.dropzone.scrollLeft+=image.left+x*image.width-(view.left+view.width/2);els.dropzone.scrollTop+=image.top+y*image.height-(view.top+view.height/2);},[.37,.58]);
 await page.waitForTimeout(500);
 const clip=await page.evaluate(()=>{const r=els.dropzone.getBoundingClientRect();return{x:r.left,y:r.top,width:Math.floor(r.width)-20,height:Math.floor(r.height)-20};});
 if(review){
  const variants=[['off','HSL off',{}],['defaults','Defaults',{}],['shrink','Edge −3',{edge:-3}],['grow','Edge +3',{edge:3}],
   ['feather','Feather 6',{edge_feather:6}],['smooth','Edge detail 0',{edge_detail:0}],['tight','Edge detail 100',{edge_detail:100}]];
  const rows=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const ev of [-2,.8]) {
   for(const [id,label,controls] of variants){
    await page.evaluate(async ({ev,id,controls})=>{
     hslClearSelection();globalThis.HDRHslSharedSelection=true;
     const b=state.adjustments.sdr,r=b.hsl.channels.find(c=>c.id==='yellow').recipe;
     Object.assign(r,{luminance:ev,edge:0,edge_feather:0,edge_detail:50},controls);b.hsl_section_enabled=id!=='off';
     state.globalEditDirty=true;await syncGlobalEditState();invalidatePreview('sdr');await settlePreview('sdr',{});
    },{ev,id,controls});
    await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(200);
    const stem=`ev${ev}-${id}`;
    await page.screenshot({path:path.join(out,`${stem}.png`),clip});
    const info=await page.evaluate(()=>({execution:state.acceptedPresentation.execution,zoom:state.zoomPercent}));
    if(info.execution!=='tiled')throw Error('Expected tiled 423% view: '+JSON.stringify(info));
    if(id!=='off'){
     await page.evaluate(async()=>{const ui=hslUI.panels[0];ui.channel='yellow';renderHslPanels();
      ui.host.querySelector('[data-hsl-selection]').setAttribute('aria-pressed','true');await hslSelection(ui);});
     await page.waitForFunction(()=>document.getElementById('hsl-selection-overlay')?.naturalWidth>0,null,{timeout:120000});
     await page.screenshot({path:path.join(out,`${stem}-selection.png`),clip});
    }
    rows.push({ev,id,label,stem,...info});console.log('REVIEW',JSON.stringify(rows.at(-1)));
   }
  }
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({rows,errors},null,2));
  const section=ev=>`<h2>Luminance ${ev>0?'+':''}${ev} EV</h2><div class="grid">${rows.filter(r=>r.ev===ev).map(r=>
   `<article><h3>${r.label}</h3><a href="${r.stem}.png" target="_blank"><img src="${r.stem}.png" alt="${r.label}"></a>${r.id==='off'?'':`<p>Show selection</p><a href="${r.stem}-selection.png" target="_blank"><img src="${r.stem}-selection.png" alt="${r.label} selection"></a>`}</article>`).join('')}</div>`;
  fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>HSL edge controls</title><style>
   body{background:#181a1e;color:#eee;font:16px system-ui;margin:28px}h1{font-size:28px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}article{background:#252830;padding:14px;border-radius:8px}img{width:100%;height:auto}h3{margin:0 0 12px}p{color:#c5c9d2}a{color:#a5caff}
   </style><h1>HSL selection edge controls</h1><p>Balanced Rock copy · SDR · Yellow 15° / Softness 21° · bush at 423%. Each setting starts from defaults. Edge and Feather use source pixels. Default Edge detail is 50.</p>
   <p>The picture uses the app's tiled GPU preview. Show selection is the app's existing 1600-pixel selection overlay, enlarged at this zoom; it reflects these settings but is not an exact pixel view of the native tiled selection. Click an image for its full size.</p>${section(-2)}${section(.8)}`);
  return;
 }
 for(const mode of ['on','off','before']){
  await page.evaluate(async mode=>{globalThis.HDRHslSharedSelection=mode!=='before';state.adjustments.sdr.hsl_section_enabled=mode!=='off';
   state.globalEditDirty=true;await syncGlobalEditState();invalidatePreview('sdr');await settlePreview('sdr',{});},mode);
  await page.waitForFunction(settled,null,{timeout:180000});await page.waitForTimeout(600);
  await page.screenshot({path:path.join(out,`${tag}${mode}.png`),clip});
  const info=await page.evaluate(()=>({execution:state.acceptedPresentation?.execution,zoom:state.zoomPercent,
   stages:(state.gpuPreview.stageLog||state.gpuPreview.stages||[]).slice?.(-6)}));
  console.log(mode,JSON.stringify(info));
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
