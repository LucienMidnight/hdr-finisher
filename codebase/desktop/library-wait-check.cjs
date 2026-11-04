const fs=require('node:fs'),path=require('node:path');
async function run({window,frame,config,stage}) {
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),out=config.pixelReviewOut;
 let target=window,lib=code=>frame.executeJavaScript(code);
 const wait=async(code,timeout=45000)=>{const end=Date.now()+timeout;while(!await lib(code)){if(Date.now()>end)throw Error('Timed out: '+code);await sleep(30);}};
 await lib(`window.waitEvents=[];const old=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(stage,fields={})=>{waitEvents.push({stage,at:performance.now(),...fields});old(stage,fields)};void HDRLibrary.browse(${JSON.stringify(config.folder)});true`);
 await wait(`HDRLibrary.getSnapshot().paths.length>=2 && document.querySelector('#grid-space .library-cell')`);
 if(config.popout){
  await lib(`document.getElementById('popout-library').click();true`);
  let detached;const until=Date.now()+20000;
  while(!detached){detached=require('electron').BrowserWindow.getAllWindows().find(w=>w!==window&&/\/library(?:\?|$)/.test(w.webContents.getURL()));if(Date.now()>until)throw Error('No popout');await sleep(30);}
  target=detached;lib=code=>target.webContents.executeJavaScript(code);
  await wait(`document.body.dataset.libraryReady==='true'&&HDRLibrary.getSnapshot().paths.length>=2`);
  await lib(`window.waitEvents=[];const old=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(stage,fields={})=>{waitEvents.push({stage,at:performance.now(),...fields});old(stage,fields)};true`);
 }
 if(config.hdr)await lib(`if(!HDRLibrary.getSnapshot().hdr)document.getElementById('hdr-button').click();true`);
 if(config.idle)await wait(`HDRLibraryScenes.snapshot().sources.jobs.length===0 && document.querySelector('#grid-space canvas[data-picture-key]')`);
 const photo=config.diagnosticPhoto||'DSC04375_DxO_clipped_target.tif';
 const choose=`(()=>{const cells=[...document.querySelectorAll('.library-cell')];const c=cells.find(c=>c.dataset.path.endsWith(${JSON.stringify(photo)}));if(!c)throw Error('Missing '+${JSON.stringify(photo)});c.click();document.getElementById('single-view').click();if(!document.querySelector('.library.review'))document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));})()`;
 if(config.idle)await wait(`[...document.querySelectorAll('#grid-space .library-cell')].some(c=>c.dataset.path.endsWith(${JSON.stringify(photo)})&&c.querySelector('canvas[data-picture-key]:not([hidden])'))`);
 const measures=[];
 for(let n=0;n<3;n++){
  if(n===2){await lib(`window.waitBackKey=HDRLibrary.getSnapshot().paths.at(-1)===HDRLibrary.getSnapshot().selected?'ArrowLeft':'ArrowRight';document.body.dispatchEvent(new KeyboardEvent('keydown',{key:waitBackKey,bubbles:true}));document.body.dispatchEvent(new KeyboardEvent('keyup',{key:waitBackKey,bubbles:true}));true`);await sleep(150);await lib(`const back=waitBackKey==='ArrowLeft'?'ArrowRight':'ArrowLeft';document.body.dispatchEvent(new KeyboardEvent('keydown',{key:back,bubbles:true}));document.body.dispatchEvent(new KeyboardEvent('keyup',{key:back,bubbles:true}));true`);}

  if(n===1){await lib(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.getElementById('grid-view').click();true`);await sleep(2100);}
  stage('wait capture '+n);const at=await lib('performance.now()');if(n<2)await lib(choose);
  const samples=[];let sharp=false;
  while(!sharp){
   const info=await lib(`(()=>{const s=HDRLibrary.getSnapshot(),c=document.getElementById('single-picture'),r=document.getElementById('single-stage').getBoundingClientRect();return {at:performance.now(),zoom:s.zoom,selected:s.selected,sharp:c.dataset.picturePath===s.selected&&!c.hidden&&Number(c.dataset.pictureEdge)===2560,standin:!!document.querySelector('#single-stage [data-stand-in]'),box:{x:r.x+r.width*.3,y:r.y+r.height*.3,width:r.width*.4,height:r.height*.4},surfaces:[...document.querySelectorAll('#single-stage canvas')].map(c=>({id:c.id,path:c.dataset.picturePath,hidden:c.hidden,w:c.width,h:c.height,style:c.style.cssText}))};})()`);
   const box=info.box;
   if(target===window){const offset=await window.webContents.executeJavaScript(`(()=>{const r=document.getElementById('library-frame').getBoundingClientRect();return {x:r.x,y:r.y}})()`);box.x+=offset.x;box.y+=offset.y;}
   for(const k of Object.keys(box))box[k]=Math.round(box[k]);
   const image=await target.webContents.capturePage(box),bitmap=image.toBitmap();let lit=0;for(let i=0;i<bitmap.length;i+=4)if(Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])-Math.min(bitmap[i],bitmap[i+1],bitmap[i+2])>12 || Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])>50)lit++;
   const pixels={at_ms:Math.round(info.at-at),standin:info.standin,sharp:info.sharp,zoom:info.zoom,lit_fraction:lit/(bitmap.length/4),surfaces:info.surfaces};samples.push(pixels);
   if((samples.length===1||info.standin)&&samples.length<5)fs.writeFileSync(path.join(out,`wait-${n}-${samples.length}.png`),image.toPNG());
   sharp=info.sharp;if(info.at-at>45000)throw Error('Sharp timeout');if(!sharp)await sleep(70);
  }
  measures.push({ms:samples.at(-1).at_ms,samples});await sleep(800);
 }
 fs.writeFileSync(path.join(out,'wait-check.json'),JSON.stringify({photo,measures},null,2));
 stage('compare pixels');
 await lib(`document.getElementById('compare-enabled').click();true`);
 const compareSamples=[];
 for(let n=0;n<15;n++){
  const panes=await lib(`[...document.querySelectorAll('.compare-stage')].map(s=>{const r=s.getBoundingClientRect();return {standin:!!s.querySelector('[data-stand-in]'),path:s.querySelector('canvas').dataset.picturePath,box:{x:r.x+r.width*.3,y:r.y+r.height*.3,width:r.width*.4,height:r.height*.4}}})`);
  for(const pane of panes){if(pane.box.width<1)continue;const box=pane.box;
   if(target===window){const offset=await window.webContents.executeJavaScript(`(()=>{const r=document.getElementById('library-frame').getBoundingClientRect();return {x:r.x,y:r.y}})()`);box.x+=offset.x;box.y+=offset.y;}
   for(const k of Object.keys(box))box[k]=Math.round(box[k]);
   const image=await target.webContents.capturePage(box),bitmap=image.toBitmap();let lit=0;for(let i=0;i<bitmap.length;i+=4)if(Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])>50)lit++;
   compareSamples.push({standin:pane.standin,path:pane.path,lit_fraction:lit/(bitmap.length/4)});
   if(n===0)fs.writeFileSync(path.join(out,`compare-${compareSamples.length}.png`),image.toPNG());
  }await sleep(80);
 }
 await lib(`document.getElementById('compare-enabled').click();true`);
 await wait(`!HDRLibrary.getSnapshot().compare.enabled && document.getElementById('single-picture').dataset.picturePath===HDRLibrary.getSnapshot().selected`);
 await lib(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.getElementById('grid-view').click();true`);
 await wait(`[...document.querySelectorAll('#grid-space .library-cell')].some(c=>c.dataset.path.endsWith(${JSON.stringify(photo)}))`);
 await lib(choose);
 await wait(`HDRLibrary.getSnapshot().selected.endsWith(${JSON.stringify(photo)}) && document.getElementById('single-picture').dataset.picturePath===HDRLibrary.getSnapshot().selected`);
 const deliberateAt=await lib('performance.now()');
 stage('detail refusal');
 await lib(`document.getElementById('zoom-button').click();true`);await sleep(5000);
 const events=await lib('waitEvents'),snapshot=await lib('HDRLibrary.getSnapshot()'),notice=await lib(`document.getElementById('library-status')?.textContent || document.querySelector('[role=status]')?.textContent || ''`);
 const errors=[];if(events.some(e=>e.stage==='picture_development_start'&&e.reason==='zoom detail'&&e.at<deliberateAt))errors.push('Detail started before explicit zoom');if(events.filter(e=>e.stage==='picture_development_start'&&e.reason==='zoom detail'&&e.at>=deliberateAt).length>1)errors.push('Repeated detail development');if(measures.some(m=>m.samples.some(s=>s.standin&&s.lit_fraction<.01))||compareSamples.some(s=>s.standin&&s.lit_fraction<.01))errors.push('Black pixels while stand-in exists');if(events.some(e=>e.stage==='picture_surface_fault'))errors.push('Hidden presentation');
 const result={stage:'done',errors,probe:{},events,wait_check:{photo,hdr:config.hdr,popout:config.popout,idle:config.idle,measures,compareSamples,snapshot,notice,deliberateAt},scenario_ms:events.length?events.at(-1).at-events[0].at:0};
 fs.writeFileSync(path.join(out,'wait-check.json'),JSON.stringify(result.wait_check,null,2));
 return result;
}
module.exports={run};
