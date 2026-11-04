// Explicit quick-check mode only. Grade writes only to a reusable test copy.
const fs=require('node:fs'),path=require('node:path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run({app,window,frame,config,stage}) {
 const main=code=>window.webContents.executeJavaScript(code),lib=code=>frame.executeJavaScript(code);
 const wait=async(fn,label,ms=45000)=>{stage(label);const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label);await sleep(50);}};
 const {ipcMain,BrowserWindow}=require('electron');
 const jobs=[];let current;
 const privateBytes=contents=>(app.getAppMetrics().find(row=>row.pid===contents.getOSProcessId())?.memory.privateBytes??0)*1024;
 const persist=()=>fs.writeFileSync(path.join(config.pixelReviewOut,'delivery-jobs.json'),JSON.stringify(jobs,null,2));
 const idle=(event,value)=>{
  if(!event.sender.getURL().includes('/gpu-delivery.html'))return;
  if(!value){current={started:Date.now(),before:privateBytes(event.sender),peak:0};jobs.push(current);}
  else if(current){current.ended=Date.now();current.end=privateBytes(event.sender);current=null;persist();}
 };
 ipcMain.on('desktop:delivery-memory-idle',idle);
 const sampling=setInterval(()=>{const hidden=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/gpu-delivery.html'));
  if(!hidden)return;const bytes=privateBytes(hidden.webContents),now=Date.now();
  for(const job of jobs){if(!job.ended)job.peak=Math.max(job.peak,bytes);
   else if(!job.after2s&&now-job.ended>=2000){job.after2s=bytes;job.after2s_ms=now-job.ended;persist();}}
 },25);
 const collections=[],errors=[],relay=require('./memory-pressure.cjs'),original=relay.notifyChromiumPressure;
 relay.notifyChromiumPressure=async(contents,...args)=>{
  if(!contents.getURL().includes('/gpu-delivery.html'))return original(contents,...args);
  const sample=()=>app.getAppMetrics().find(row=>row.pid===contents.getOSProcessId())?.memory;
  const before=sample(),started=Date.now();
  try{return await original(contents,...args);}finally{
   await sleep(100);collections.push({started,before,after:sample(),duration_ms:Date.now()-started});
   fs.writeFileSync(path.join(config.pixelReviewOut,'delivery-collections.json'),JSON.stringify(collections,null,2));
  }
 };
 window.show();window.focus();
 try{
  await lib(`void HDRLibrary.browse(${JSON.stringify(config.folder)})`);
  await wait(()=>lib(`!!document.querySelector('#grid-space .library-cell canvas[data-picture-key]:not([hidden])')`),'test-copy grid');
  const photo=await lib(`HDRLibrary.getSnapshot().paths.find(p=>/DSC07061.ARW$/i.test(p))`);
  if(!photo||!photo.replaceAll('\\','/').includes('/output/test-photos/'))throw Error('Grade requires reusable test copy');
  await main(`(async()=>{await openDesktopSelection({kind:'source',...await hdrFinisherDesktop.grantSourcePath(${JSON.stringify(photo)}),fromLibrary:true});})()`);
  await wait(()=>main(`HDRGradeSaving.ready()&&!document.body.classList.contains('grade-opening')`),'Grade ready');
  // A zoom-region Grade picture uses the real finishing-redraw hand-off.
  await wait(()=>require('electron').BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('/gpu-delivery.html')),'hidden worker ready');
  await sleep(1500);
  await main(`(()=>{const c=document.getElementById('raw-highlight-method');c.value='edge_colour_v1';c.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(()=>jobs.some(job=>job.ended),'large Grade job completed',30000);
  await wait(()=>jobs.every(job=>job.after2s),'two-second delivery memory',10000);
  const hiddenAfterJob=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/gpu-delivery.html'));
  await hiddenAfterJob.webContents.takeHeapSnapshot(path.join(config.pixelReviewOut,'delivery-after-job.heapsnapshot'));
  await wait(()=>main(`HDRGradeSaving.ready()&&!state.importJob`),'Grade redevelopment ready');
  await main(`setZoomMode('actual')`);await sleep(1000);
  await lib(`window.thumbnailHandoffs=[];const original=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(s,f)=>{if(s==='grade_picture_handoff')thumbnailHandoffs.push(f);original(s,f);};true`);
  await main(`(()=>{const c=document.getElementById('hdr-exposure');c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:991}));c.value=String(Number(c.value)+.25);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:991}));})()`);
  await wait(()=>lib(`thumbnailHandoffs.length>0`),'Grade picture hand-off',60000);
  const handoffs=await lib('thumbnailHandoffs');
  await wait(()=>collections.length>0,'delivery idle collection',10000);
  await main(`document.querySelector('[data-workflow-tab="import"]').click()`);
  const hidden=require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/gpu-delivery.html'));
  await relay.notifyChromiumPressure(hidden.webContents,'moderate');
  await hidden.webContents.takeHeapSnapshot(path.join(config.pixelReviewOut,'delivery.heapsnapshot'));
  // Originals are browsed only, never opened in Grade or given write commands.
  const browseAt=Date.now();
  await lib(`window.thumbnailEvents=[];const before=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(s,f)=>{thumbnailEvents.push({stage:s,...f});before(s,f);};void HDRLibrary.browse('D:/Photos/HDR Test Images/DXO_PL_exported')`);
  await wait(()=>lib(`HDRLibrary.getSnapshot().paths.some(p=>/optical-corr-only.dng$/i.test(p))&&[...document.querySelectorAll('#grid-space .library-cell')].filter(c=>/optical-corr-only.dng$/i.test(c.dataset.path)).every(c=>c.querySelector('canvas[data-picture-key]:not([hidden])'))`),'DxO grid pictures',20000);
  const dxo=await lib(`({paths:HDRLibrary.getSnapshot().paths.filter(p=>/optical-corr-only.dng$/i.test(p)),visible:[...document.querySelectorAll('#grid-space .library-cell')].filter(c=>/optical-corr-only.dng$/i.test(c.dataset.path)).map(c=>({path:c.dataset.path,camera:c.querySelector('canvas[data-camera-preview="true"]')!==null})),events:thumbnailEvents})`);
  if(!dxo.visible.length||dxo.visible.some(row=>!row.camera))errors.push('Missing DxO camera pictures');
  return {stage:'done',visible_files:dxo.paths,errors,collections,handoffs,dxo,browseAt,scenario_ms:Date.now()-config.appStartedAt,events:[],probe:{}};
 }finally{clearInterval(sampling);ipcMain.removeListener('desktop:delivery-memory-idle',idle);persist();relay.notifyChromiumPressure=original;}
}
module.exports={run};
