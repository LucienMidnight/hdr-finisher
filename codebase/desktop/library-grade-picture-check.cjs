const fs=require('node:fs'),path=require('node:path');
async function run({window,frame,config,stage}) {
 const started=Date.now();
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const main=code=>window.webContents.executeJavaScript(code);
 const lib=code=>frame.executeJavaScript(code);
 const wait=async(fn,label,ms=45000)=>{stage(label);const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label+' '+JSON.stringify(await lib('HDRLibrary.getSnapshot()')));await sleep(40);}};
 // Keep the real API's two selected fixture rows, without duplicating RAW files.
 const filter=`(()=>{const original=window.fetch;window.fetch=async(url,options)=>{const response=await original(url,options);if(!String(url).endsWith('/api/library/folder-stream'))return response;let pending='';const newline=String.fromCharCode(10);const body=response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({transform(chunk,controller){const lines=(pending+chunk).split(newline);pending=lines.pop();for(const line of lines){if(!line)continue;const packet=JSON.parse(line);if(packet.columns){packet.photos=packet.values.map(values=>Object.fromEntries(packet.columns.map((key,i)=>[key,values[i]])));delete packet.columns;delete packet.values;}if(packet.photos)packet.photos=packet.photos.filter(p=>['DSC03819.ARW','DSC00264.ARW'].some(name=>p.path.toUpperCase().endsWith(name)));packet.ordered=false;controller.enqueue(JSON.stringify(packet)+newline);}}})).pipeThrough(new TextEncoderStream());return new Response(body,{status:response.status,headers:response.headers});};})()`;
 await lib(filter);
 const out=config.pixelReviewOut;fs.mkdirSync(out,{recursive:true});
 await lib(`document.getElementById('thumbnail-size').value=180;document.getElementById('thumbnail-size').dispatchEvent(new Event('input'));window.handoffEvents=[];const original=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(s,f)=>{if(s==='grade_picture_handoff')handoffEvents.push(f);original(s,f);};void HDRLibrary.browse(${JSON.stringify(config.folder)})`);
 await wait(()=>lib(`HDRLibrary.getSnapshot().paths.some(p=>/DSC03819.ARW$/i.test(p))&&HDRLibrary.getSnapshot().paths.some(p=>/DSC00264.ARW$/i.test(p))&&[...document.querySelectorAll('#grid-space .library-cell')].filter(c=>/DSC03819|DSC00264/.test(c.dataset.path)).every(c=>c.querySelector('canvas[data-picture-key]:not([hidden])'))`),'initial grid');
 const photos=await lib(`HDRLibrary.getSnapshot().paths.filter(p=>[${JSON.stringify(config.folder+'/DSC03819.ARW')},${JSON.stringify(config.folder+'/DSC00264.ARW')}].some(q=>q.toLowerCase()===p.replaceAll(String.fromCharCode(92),'/').toLowerCase())).sort().reverse()`);
 if(photos.length!==2)throw Error('Requires reusable DSC03819 and DSC00264 copies');
 await lib(`if(HDRLibrary.getSnapshot().hdr!==${!config.gradeHandoffSdr})document.getElementById('hdr-button').click();true`);
 const lane=config.gradeHandoffSdr?'sdr':'hdr';
 const rows=[];
 let target=window, evaluate=lib;
 async function capture(photo,name,container="grid-space"){
  const box=await evaluate(`(()=>{const c=[...document.querySelectorAll('#${container} .library-cell')].find(c=>c.dataset.path===${JSON.stringify(photo)});c.scrollIntoView({block:'nearest'});const r=c.querySelector('.picture-frame').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  if(target===window){const offset=await main(`(()=>{const r=document.getElementById('library-frame').getBoundingClientRect();return {x:r.x,y:r.y};})()`);box.x+=offset.x;box.y+=offset.y;}
  await sleep(100);
  const image=await target.webContents.capturePage({x:Math.ceil(box.x+box.width*.15),y:Math.ceil(box.y+box.height*.15),width:Math.floor(box.width*.7),height:Math.floor(box.height*.7)});
  fs.writeFileSync(path.join(out,name+'.png'),image.toPNG());return image.toBitmap();
 }
 async function screenCrop(name){
  const box=await evaluate(`(()=>{const r=document.getElementById('single-stage').getBoundingClientRect();return {x:r.x+r.width/2-128,y:r.y+r.height/2-128,width:256,height:256};})()`);
  if(target===window){const offset=await main(`(()=>{const r=document.getElementById('library-frame').getBoundingClientRect();return {x:r.x,y:r.y};})()`);box.x+=offset.x;box.y+=offset.y;}
  for(const k of Object.keys(box))box[k]=Math.round(box[k]);await sleep(100);const image=await target.webContents.capturePage(box);fs.writeFileSync(path.join(out,name+'.png'),image.toPNG());return image.toBitmap();
 }
 async function edit(photo,label,popout=false){
  await main(`activateWorkflowTab('import')`);
  const before=await capture(photo,label+'-before');
  await evaluate(`(()=>{const c=[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path===${JSON.stringify(photo)});c.click();document.getElementById('single-view').click();})()`);
  await wait(()=>evaluate(`[...document.querySelectorAll('#film-space .library-cell')].some(c=>c.dataset.path===${JSON.stringify(photo)}&&c.querySelector('canvas[data-picture-key]:not([hidden])'))`),label+' filmstrip');
  const filmBefore=await capture(photo,label+'-film-before','film-space');
  const screenBefore=await screenCrop(label+'-screen-before');
  await evaluate(`(()=>{const c=[...document.querySelectorAll('#film-space .library-cell')].find(c=>c.dataset.path===${JSON.stringify(photo)});c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);
  await wait(()=>main(`HDRGradeSaving.ready()&&state.session?.source.filename===${JSON.stringify(path.basename(photo))}&&!state.gpuDraftInFlight&&state.gpuPreview?.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView]`),label+' Grade Fit',60000);
  await main(`switchLane('${lane}')`);
  await main(`if(state.zoomMode!=='fit')setZoomMode('fit');true`);
  await main(`(()=>{const c=document.getElementById('settings-execution-override');c.value='tiled';c.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await main(`refreshPreview()`);
  await wait(()=>main(`!state.gpuDraftInFlight&&!state.gpuScopeRequestInFlight&&state.gpuPreview.lastPresentedFrame?.execution==='tiled'&&state.gpuPreview.lastPresentedFrame.applicationGeneration===state.previewGeneration[state.currentView]`),label+' tiled settled');
  const grade=await main(`({width:state.session.source.width,height:state.session.source.height,execution:state.gpuPreview.lastPresentedFrame.execution,zoom:state.zoomMode,snapshot:HDRGradeLibraryPictures.getSnapshot()})`);
  const count=await evaluate('handoffEvents.length');
  await main(`(()=>{const c=document.getElementById('${lane}-exposure');c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:991}));c.value=String(Number(c.value)+1);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:991}));})()`);
  await wait(()=>evaluate(`handoffEvents.length>${count}`),label+' publication');
  const handoff=await evaluate('handoffEvents.at(-1)');grade.after=await main(`({execution:state.gpuPreview.lastPresentedFrame?.execution,previewResolution:state.previewResolution,override:state.gpuPreview.executionOverride,snapshot:HDRGradeLibraryPictures.getSnapshot()})`);
  await main(`activateWorkflowTab('import')`);
  await sleep(150);
  const filmAfter=await capture(photo,label+'-film-after','film-space');
  const stored=await evaluate(`(async()=>{const canvas=document.createElement('canvas');const stage=document.getElementById('single-stage');canvas.id='grade-stored-review';canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:99';stage.append(canvas);try{let meta=null;const end=Date.now()+15000;while(!meta&&Date.now()<end){meta=await HDRLibraryScreenPreviews.load({path:${JSON.stringify(photo)}},canvas,new AbortController().signal,()=>true,${!config.gradeHandoffSdr});if(!meta)await new Promise(r=>setTimeout(r,100));}if(!meta)throw Error('Saved Grade screen picture missing');return {meta,width:canvas.width,height:canvas.height};}catch(error){canvas.remove();throw error;}})()`);
  const screenAfter=await screenCrop(label+'-stored-after');await evaluate(`document.getElementById('grade-stored-review').remove();true`);
  let screenChanged=0;for(let i=0;i<Math.min(screenBefore.length,screenAfter.length);i+=4)if(Math.abs(screenBefore[i]-screenAfter[i])+Math.abs(screenBefore[i+1]-screenAfter[i+1])+Math.abs(screenBefore[i+2]-screenAfter[i+2])>9)screenChanged++;
  await evaluate(`document.getElementById('grid-view').click();true`);
  const after=await capture(photo,label+'-after');
  let filmChanged=0;for(let i=0;i<Math.min(filmBefore.length,filmAfter.length);i+=4)if(Math.abs(filmBefore[i]-filmAfter[i])+Math.abs(filmBefore[i+1]-filmAfter[i+1])+Math.abs(filmBefore[i+2]-filmAfter[i+2])>9)filmChanged++;
  let changed=0,total=0;for(let i=0;i<Math.min(before.length,after.length);i+=4){for(let j=0;j<3;j++)total+=Math.abs(before[i+j]-after[i+j]);if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>9)changed++;}
  rows.push({label,photo,grade,handoff,stored,screen_pixels:screenBefore.length/4,screen_changed_pixels:screenChanged,film_pixels:filmBefore.length/4,film_changed_pixels:filmChanged,pixels:before.length/4,changed_pixels:changed,mean_channel_change:total/(before.length/4*3)});fs.writeFileSync(path.join(out,'pixels.json'),JSON.stringify(rows,null,2));
 }
 if(!config.gradeHandoffPopout){await edit(photos[0],'first');await edit(photos[1],'second');}
 let videoMemory=null;
 if(config.gradeHandoffPopout){
 stage('pop out');await lib(`document.getElementById('popout-library').click()`);
 await wait(()=>{target=require('electron').BrowserWindow.getAllWindows().find(w=>w!==window&&/\/library(?:\?|$)/.test(w.webContents.getURL()));return !!target;},'detached window');
 window.setBounds({x:0,y:0,width:1200,height:1000});target.setBounds({x:1220,y:0,width:1200,height:1000});
 evaluate=code=>target.webContents.executeJavaScript(code);
 await evaluate(filter);await evaluate(`if(HDRLibrary.getSnapshot().hdr!==${!config.gradeHandoffSdr})document.getElementById('hdr-button').click();void HDRLibrary.browse(${JSON.stringify(config.folder)});true`);
 await wait(()=>evaluate(`document.body.dataset.libraryReady==='true'&&HDRLibrary.getSnapshot().visible>0&&[...document.querySelectorAll('#grid-space .library-cell')].every(c=>c.querySelector('canvas[data-picture-key]:not([hidden])'))`),'detached ready');
 await evaluate(`window.handoffEvents=[];const original=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(s,f)=>{if(s==='grade_picture_handoff')handoffEvents.push(f);original(s,f);};true`);
 videoMemory=await evaluate('hdrFinisherDesktop.videoMemory()');
 await edit(photos[1],'popout',true);
 }
 const errors=rows.flatMap(r=>[...(r.screen_changed_pixels>r.screen_pixels*.05?[]:[r.label+': stored screen pixels did not change']),...(r.film_changed_pixels>r.film_pixels*.05?[]:[r.label+': filmstrip pixels did not change']),...(r.changed_pixels>r.pixels*.05?[]:[r.label+': visible pixels did not change']),...(r.grade.after.execution==='tiled'?[]:[r.label+': Grade did not use tiled Fit']),...(r.handoff.route.startsWith('Grade picture')?[]:[r.label+': '+r.handoff.route]),...(r.handoff.available_to_picture_ms!==null&&r.handoff.available_to_picture_ms<=500?[]:[r.label+': missed 500 ms'])]);
 return {stage:'done',visible_files:photos,scenario_ms:Date.now()-started,grade_handoff:{rows,videoMemory},errors,events:[],probe:{},pixelReview:out};
}
module.exports={run};
