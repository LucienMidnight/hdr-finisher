// Short, disposable cold-open measurement. Originals are only copied/read.
// node tests/run-in-electron.js tools/measure-library-cold-mixed.cjs [--jpeg|--probe|--aceh]
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {MemoryMonitor}=require('./library-memory-monitor.cjs');
const {chromium}=require('playwright');
const {hashProjects,checkProjects}=require('../tests/release/runner.cjs');
const root=path.resolve(__dirname,'..'),jpeg=process.argv.includes('--jpeg'),probe=process.argv.includes('--probe'),aceh=process.argv.includes('--aceh'),phase0=process.argv.includes('--phase0');
const scrollDiagnose=process.argv.includes('--scroll-diagnose'),hdrTest=process.argv.includes('--hdr-test');
const memoryLimit=Number(process.argv.find(x=>x.startsWith('--memory-gb='))?.split('=')[1]||4)*1e9;
const singleFile=process.argv.find(x=>x.startsWith('--single-file='))?.slice(14);
const allFolder=process.argv.find(x=>x.startsWith('--all-folder='))?.slice(13);
const outputName=process.argv.includes('--output-name')?process.argv[process.argv.indexOf('--output-name')+1]:null;
const out=path.join(root,'output/cold-mixed',outputName|| (jpeg?'jpeg':probe?'probe':aceh?'aceh':phase0?'phase0':'final'));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'memory.jsonl'),'');
const scratch=fs.mkdtempSync(path.join(root,'output/test-photos/cold-mixed-'));
let photos=allFolder||path.join(root,'output/test-photos',hdrTest?'hdr-test':phase0?'phase0':aceh?'aceh':scrollDiagnose?'scroll-back-mixed':'cold-mixed-photos'),background=path.join(scratch,'index');fs.mkdirSync(photos,{recursive:true});fs.mkdirSync(background);
let singleFileRestore;
if(singleFile){
 assert.ok(phase0,'Isolated-file diagnosis uses the reusable phase0 copies');
 const relative=fs.readdirSync(photos,{recursive:true}).find(n=>path.basename(n)===singleFile);
 assert.ok(relative,'The requested phase0 copy exists');
 const original=path.join(photos,relative);photos=path.join(scratch,'isolated');fs.mkdirSync(photos);
 singleFileRestore={original,temporary:path.join(photos,singleFile)};
 assert.ok(path.resolve(original).startsWith(path.resolve(root,'output/test-photos/phase0')+path.sep));
 fs.renameSync(original,singleFileRestore.temporary); // Move only the disposable copy; restore it in finally.
 if(fs.existsSync(original+'.hdrf')){fs.renameSync(original+'.hdrf',singleFileRestore.temporary+'.hdrf');singleFileRestore.sidecar=true;}
}
if(hdrTest){
 const original='D:/Photos/HDR Test Images';
 for(const name of fs.readdirSync(original,{recursive:true})){
  const src=path.join(original,name),dst=path.join(photos,name);
  if(fs.statSync(src).isDirectory())fs.mkdirSync(dst,{recursive:true});
  else if(!fs.existsSync(dst)){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}
 }
}
const source=hdrTest?photos:phase0?photos:aceh?'D:/Photos/2017/Aceh-Wedding/Pesta':'D:/Photos/2023/11';
let names=fs.readdirSync(source).filter(n=>/\.(heic|jpg|png|arw)$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
if(phase0||hdrTest)names=fs.readdirSync(photos,{recursive:true}).filter(n=>/\.(dng|jxl|raf|tiff?|jpg|jpeg|png|arw|avif|heic|cr3|orf|rw2|nef|exr|hdr|pfm)$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
let junk=[];
if(aceh){junk=fs.readdirSync(source).filter(n=>n.startsWith('._')).sort().slice(0,6);names=names.filter(n=>!n.startsWith('._')).slice(0,48);}
else if(phase0||hdrTest){}else if(scrollDiagnose){
 const groups=['ARW','HEIC','JPG','PNG'].map(ext=>names.filter(n=>n.toUpperCase().endsWith('.'+ext)));
 names=[];while(names.length<200&&groups.some(g=>g.length))for(const group of groups)if(group.length&&names.length<200)names.push(group.shift());
}else if(jpeg)names=['IMG_0267.JPG'];else{
 const chosen=probe ? [
  ...names.filter(n=>/\.ARW$/i.test(n)).slice(0,4),...names.filter(n=>/\.HEIC$/i.test(n)).slice(0,8),
  ...names.filter(n=>/\.JPG$/i.test(n)).slice(0,2),...names.filter(n=>/\.PNG$/i.test(n)).slice(0,2)
 ] : [...names.filter(n=>/\.ARW$/i.test(n)).slice(0,4),...names.filter(n=>/\.HEIC$/i.test(n)).slice(0,44),
  ...names.filter(n=>/\.JPG$/i.test(n)).slice(0,8),...names.filter(n=>/\.PNG$/i.test(n)).slice(0,4)];
 for(const ext of ['HEIC','JPG','PNG','ARW'])if(!chosen.some(n=>n.toUpperCase().endsWith('.'+ext)))chosen.push(names.find(n=>n.toUpperCase().endsWith('.'+ext)));
 if(!chosen.includes('IMG_0267.JPG'))chosen.push('IMG_0267.JPG');names=chosen;
}
for(const name of [...junk,...names])if(!fs.existsSync(path.join(photos,name)))fs.copyFileSync(path.join(source,name),path.join(photos,name));
// Small generated-fixture files keep an independent pinned index active;
// no second copies of Steve's real photos are made.
if(!hdrTest&&!jpeg&&!aceh&&!phase0&&!scrollDiagnose)for(let i=0;i<1200;i++)fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),path.join(background,`index-${String(i).padStart(4,'0')}.png`));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={mode:hdrTest?'hdr-test':scrollDiagnose?'scroll-diagnose':phase0?'phase0':jpeg?'IMG_0267':aceh?'aceh':'mixed',files:names,junk,errors:[],memoryRequests:[],screens:[],startedAt:new Date().toISOString()};
const before=hashProjects(require('../tests/release/drivers.json').protectedProjects);
(async()=>{
 let memoryViolation, browser,lib,observer,peak=0,pending='',poll,stopping=false,activePoll,diagnostics,gpuObserver;
 const memory=new MemoryMonitor(memoryLimit);
 const api=async(route,body,signal)=>{
  const response=await global.HDRFinisherElectronTestHarness.fetch('/api/library/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal});
  if(!response.ok)throw Error(`${route}: ${response.status} ${await response.text()}`);return response.json();
 };
 try{
  report.gpuMemory={scope:'whole card, including desktop and other applications',samples:0,peakBytes:0};
  gpuObserver=spawn('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits','-lms','250'],{windowsHide:true});
  let gpuPending='';gpuObserver.stdout.on('data',chunk=>{gpuPending+=chunk;let end;while((end=gpuPending.indexOf('\n'))>=0){const line=gpuPending.slice(0,end);gpuPending=gpuPending.slice(end+1);const bytes=Number(line.trim())*1024**2;if(Number.isFinite(bytes)&&bytes>0){report.gpuMemory.initialBytes??=bytes;report.gpuMemory.samples++;report.gpuMemory.peakBytes=Math.max(report.gpuMemory.peakBytes,bytes);}}});
  gpuObserver.on('error',error=>report.gpuMemory.error=String(error));
  browser=await chromium.launch();const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',msg=>{if(msg.text().includes('Memory controller:'))report.errors.push(msg.text());});
  report.grantEvents=[];const liveGrants=new Map();
  page.on('websocket',ws=>{if(!ws.url().endsWith('/api/library/grants'))return;
    ws.on('framereceived',event=>{const value=JSON.parse(String(event.payload));report.grantEvents.push({at:Date.now(),...value});if(value.type==='granted')liveGrants.set(value.id,value);});
    ws.on('framesent',event=>{const value=JSON.parse(String(event.payload));if(value.type==='finish'||value.type==='cancel')liveGrants.delete(value.id);});
  });
  report.channelFrames=[];report.httpRequests=[];page.on('websocket',ws=>ws.on('framesent',event=>{if(ws.url().endsWith('/api/library/grants'))report.channelFrames.push({at:Date.now(),...JSON.parse(String(event.payload))});}));page.on('request',r=>{if(r.url().includes('/api/library/'))report.httpRequests.push({at:Date.now(),url:r.url()});});
  await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
  lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
  await lib.evaluate(()=>{
   window.coldEvents=[];window.coldAllocations=[];
   const rgb=HDRLibraryRGB;window.HDRLibraryRGB={...rgb,develop:async args=>{
    const value=await rgb.develop(args);coldAllocations.push({path:args.meta.path,width:args.meta.width,height:args.meta.height,edges:args.edges,reserved:args.memoryBudget,peak:value.memory_peak_bytes});return value;
   }};
   const log=HDRLibraryStopwatch;
   window.HDRLibraryStopwatch=(stage,fields)=>{coldEvents.push({stage,at:performance.now(),...fields});log(stage,fields);};
   const slider=document.getElementById('thumbnail-size');slider.value=300;slider.dispatchEvent(new Event('input'));
   document.querySelector('[data-sort="name"]').click();
  });
  const requests=new Map();report.network=[];
  page.on('request',r=>{if(r.url().includes('/api/library/'))requests.set(r,Date.now());});
  const ended=r=>{if(requests.has(r)){report.network.push({url:r.url(),start:requests.get(r),end:Date.now(),failure:r.failure()?.errorText});requests.delete(r);}};
  page.on('requestfinished',ended);page.on('requestfailed',ended);
  observer=spawn(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'measure-library-processes.py'),process.env.HDR_FINISHER_ELECTRON_MAIN_PID],{windowsHide:true});
  observer.stdout.on('data',chunk=>{
   pending+=chunk;let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line)continue;
    const sample=JSON.parse(line);memory.sample(sample,[...liveGrants.values()]);
    peak=memory.peakBytes;memoryViolation=memory.violation;report.samples=(report.samples||0)+1;
    fs.appendFileSync(path.join(out,'memory.jsonl'),line+'\n');
   }
  });
  observer.stderr.on('data',chunk=>{report.observerError=String(chunk);});
  const sample=async()=>{
   if(activePoll||stopping)return;
   activePoll=(async()=>{const at=performance.now();try{const value=await api('memory',null,AbortSignal.timeout(2000));report.memoryRequests.push({ms:performance.now()-at,total:value.totalBytes});}
    catch(e){report.memoryRequests.push({ms:performance.now()-at,error:String(e)});}})().finally(()=>activePoll=null);
  };poll=setInterval(sample,500);await sample();
  if(process.argv.includes('--memory-detail'))try{
   const cdp=await page.context().newCDPSession(page);
   diagnostics=async()=>{
    await cdp.send('Tracing.start',{categories:'-*,disabled-by-default-memory-infra',transferMode:'ReturnAsStream'});
    report.nativeSampling=await cdp.send('Memory.getBrowserSamplingProfile').catch(error=>({error:String(error)}));
    report.rendererHeap=await cdp.send('Runtime.getHeapUsage');
    await cdp.send('Tracing.requestMemoryDump',{levelOfDetail:'detailed'});
    const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');const {stream}=await done;
    const tracePath=path.join(out,'memory-trace.json');fs.writeFileSync(tracePath,'');
    for(;;){const part=await cdp.send('IO.read',{handle:stream,size:1048576});fs.appendFileSync(tracePath,part.base64Encoded?Buffer.from(part.data,'base64'):part.data);if(part.eof)break;}
    await cdp.send('IO.close',{handle:stream});
    report.memoryTrace='memory-trace.json';
   };
  }catch(error){report.memoryDiagnosticError=String(error);}
  await api('memory-setting',{bytes:memoryLimit});
  report.memoryLimit=memoryLimit;
  const cacheSettings=await api('cache-settings');report.cacheSettings=cacheSettings;
  assert.ok(cacheSettings.location.toLowerCase().includes('test-'),'Test must use an isolated disk cache');
  await api('lock-metrics',{reset:true});
  if(!hdrTest&&!jpeg&&!aceh&&!phase0&&!scrollDiagnose)await api('pins',{paths:[background]});
  if(process.argv.includes('--settings-exercise'))await lib.evaluate(()=>{window.frameGaps=[];let last=performance.now();function tick(now){frameGaps.push(now-last);last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
  report.openedPerformance=await lib.evaluate(()=>performance.now());
  const opened=report.openedAt=Date.now();void lib.evaluate(folder=>HDRLibrary.browse(folder),photos.replaceAll('\\','/')).catch(e=>report.errors.push(String(e)));
  await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count>0,null,{timeout:20000});
  if(scrollDiagnose){
   await lib.waitForFunction(()=>!HDRLibrary.getSnapshot().reading);
   await lib.evaluate(()=>document.querySelector('[data-sort="name"]').click());
   await sleep(300);
  }
  for(let screen=0;screen<(singleFile?1:scrollDiagnose?3:phase0?3:jpeg||probe?1:2);screen++){
   if(screen){report.scrolledAt=Date.now();}if(screen)await lib.evaluate(()=>{const grid=document.getElementById('library-grid');grid.scrollTop+=grid.clientHeight;grid.dispatchEvent(new Event('scroll'));});
   await sleep(300);
   const visibleTargets=await lib.evaluate(()=>{
    const b=document.getElementById('library-grid').getBoundingClientRect();
    return [...document.querySelectorAll('#grid-space .library-cell')].filter(c=>{const r=c.getBoundingClientRect();return r.top<b.bottom&&r.bottom>b.top;}).map(c=>c.dataset.path);
   });
   const targets=await lib.evaluate(()=>{
    const bounds=document.getElementById('library-grid').getBoundingClientRect();
    return [...document.querySelectorAll('#grid-space .library-cell')].filter(c=>{const r=c.getBoundingClientRect();return r.top<bounds.bottom&&r.bottom>bounds.top;}).map(c=>c.dataset.path);
   });
   const started=Date.now();let cells,idleSince=null;
   while(Date.now()-started<(phase0?600000:probe?60000:120000)){
    if(memoryViolation){report.memoryViolation=memoryViolation;throw Error('STOP: '+memoryViolation.reason);}
    cells=await lib.evaluate(paths=>paths.map(p=>{const c=[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path===p);return {path:p,presented:!!c?.querySelector('canvas[data-picture-key]'),needsMemory:c?.querySelector('.library-memory-needed')?.textContent,error:c?.querySelector('.library-picture-error')?.title||c?.querySelector('.picture-failed')?.textContent};}),targets);
    if(cells.length&&cells.every(c=>c.presented||c.error||c.needsMemory))break;
    if(phase0){
     const jobs=(await lib.evaluate(()=>HDRLibraryGrants.snapshot())).jobs;
     if(jobs.some(j=>j.state==='running'))idleSince=null;else idleSince??=Date.now();
     if(idleSince&&Date.now()-idleSince>=5000&&process.argv.includes('--diagnose-gc')&&!report.idleCollection){
      const cdp=await page.context().newCDPSession(page);
      report.idleCollection={at:Date.now(),before:await api('memory')};
      await cdp.send('HeapProfiler.collectGarbage');
      report.idleCollection.heap=await cdp.send('Runtime.getHeapUsage');
      await cdp.detach();
     }
     if(idleSince&&Date.now()-idleSince>=30000){report.stalledGrants=jobs;break;}
    }
    await sleep(300);
   }
   report.screens.push({screen:screen+1,visibleTargets,elapsedSinceOpenMs:Date.now()-opened,cells});
   report.indexDuringScreens=await api('health',null,AbortSignal.timeout(2000)).catch(e=>({error:String(e)}));
   console.log(JSON.stringify({screen:screen+1,elapsedMs:Date.now()-opened,presented:cells.filter(c=>c.presented).length,total:cells.length,peakGB:peak/1e9}));
  }
  if(process.argv.includes('--resume-giants')){
   report.beforeRaise=await lib.evaluate(()=>HDRLibraryGrants.snapshot());
   report.beforeRaiseNotices=await lib.evaluate(()=>[...document.querySelectorAll('.library-memory-needed')].map(e=>e.textContent));
   await api('memory-setting',{bytes:16_000_000_000});
   report.observerRaised=true;memory.ceiling=16_000_000_000;
   report.raisedAt=Date.now();
   await lib.waitForFunction(()=>new Set(coldEvents.filter(e=>e.stage==='picture_navigation_to_present'&&e.picture_size==='thumbnail').map(e=>e.path)).size===HDRLibrary.getSnapshot().count,null,{timeout:90000});
   report.resumed=await lib.evaluate(()=>({notices:document.querySelectorAll('.library-memory-needed').length,grants:HDRLibraryGrants.snapshot()}));
  }
  if(process.argv.includes('--settings-exercise')){
   report.settingChanges=[];
   for(const bytes of [8_000_000_000,4_000_000_000]){
    const start=Date.now();await page.evaluate(()=>HDRApplicationShell.openSettings('performance'));
    await page.locator('#settings-app-memory').fill(String(bytes/1e9));await page.locator('#settings-app-memory').dispatchEvent('change');
    for(let i=0;i<40;i++){if((await api('memory-setting')).ceilingBytes===bytes)break;await sleep(50);}
    report.settingChanges.push({bytes,ms:Date.now()-start,value:await api('memory-setting')});await page.locator('#settings-close').click();await sleep(700);
   }
   report.frameGaps=await lib.evaluate(()=>frameGaps);report.maxFrameGapMs=Math.max(...report.frameGaps);
   await page.screenshot({path:path.join(out,'settings-browsing.png')});
  }
  if(scrollDiagnose){
   report.scrollBack=[];
   for(let step=0;step<4;step++){
    await lib.evaluate(()=>{const grid=document.getElementById('library-grid');grid.scrollTop+=grid.clientHeight;grid.dispatchEvent(new Event('scroll'));});
    await sleep(300);
   }
   for(const screen of [2,1,0]){
    const at=Date.now(),eventStart=await lib.evaluate(()=>coldEvents.length);
    const observation=await lib.evaluate(async screen=>{
     const grid=document.getElementById('library-grid');const began=performance.now();
     grid.scrollTop=screen*grid.clientHeight;grid.dispatchEvent(new Event('scroll'));
     const layout=HDRLibraryLayout.gridLayout(HDRLibrary.getSnapshot().count,grid.clientWidth,grid.clientHeight,grid.scrollTop,Number(document.getElementById('thumbnail-size').value));
     const targets=HDRLibrary.getSnapshot().paths.slice(layout.first,layout.last);
     const cells=new Map(targets.map(path=>[path,{path,firstDrawMs:null,finishedMs:null,everBlank:false}]));
     // Observe after the scroll handler has laid out the complete target screen.
     await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
     while(performance.now()-began<15000){
      const b=grid.getBoundingClientRect();let complete=true;
      for(const path of targets){
       const c=[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path===path);
       const finished=!!c?.querySelector('canvas[data-picture-key]:not([hidden])');
       const image=c?.querySelector('img');const preview=!!image&&!image.hidden&&image.style.visibility!=='hidden'&&image.naturalWidth>0;
       const row=cells.get(path);
       if(finished||preview)row.firstDrawMs??=performance.now()-began;else row.everBlank=true;
       if(finished)row.finishedMs??=performance.now()-began;else complete=false;
      }
      if(cells.size&&complete)break;
      await new Promise(requestAnimationFrame);
     }
     return {screen,began,ms:performance.now()-began,cells:[...cells.values()],ram:HDRLibraryRAM.snapshot()};
    },screen);
    observation.events=await lib.evaluate(start=>coldEvents.slice(start),eventStart);
    observation.requests=report.httpRequests.filter(r=>r.at>=at);report.scrollBack.push(observation);
    console.log(JSON.stringify({returnScreen:screen,ms:observation.ms,blank:observation.cells.filter(c=>c.everBlank).length}));
   }
  }
  if(process.argv.includes('--scroll-back')){
   report.returnAt=Date.now();report.returnPerformance=await lib.evaluate(()=>{window.returnAt=performance.now();const grid=document.getElementById('library-grid');grid.scrollTop=0;grid.dispatchEvent(new Event('scroll'));return window.returnAt;});
   await sleep(2500);
   report.returnCells=await lib.evaluate(()=>[...document.querySelectorAll('#grid-space .library-cell')].map(c=>({path:c.dataset.path,presented:!!c.querySelector('canvas[data-picture-key]')})));
  }
  // Observe ordinary cache trimming after development and saving have drained.
  // Thirty seconds is a measurement window, not a new production deadline.
  const settleStart=Date.now();
  for(;;){
   if(memoryViolation)throw Error('STOP: '+memoryViolation.reason);
   const grants=await lib.evaluate(()=>HDRLibraryGrants.snapshot());
   const running=grants.jobs.filter(g=>g.state==='running'||g.type==='granted');
   if(!running.length&&memory.last?.totalBytes<=memory.ceiling-600_000_000){report.settledAfterWork=true;break;}
   if(Date.now()-settleStart>=30000)break;
   await sleep(500);
  }
  report.settleObservedMs=Date.now()-settleStart;
  const coldCapture=await lib.evaluate(()=>({events:coldEvents,allocations:coldAllocations,snapshot:HDRLibrary.getSnapshot(),queue:HDRLibraryScenes.snapshot()}));
  Object.assign(report,coldCapture);
  if(hdrTest&&process.argv.includes('--warm-reopen')){
   await lib.evaluate(folder=>HDRLibrary.browse(folder),background.replaceAll('\\','/'));
   await lib.goto(lib.url());await lib.waitForFunction(()=>window.HDRLibrary);
   await lib.evaluate(()=>{
    window.warmEvents=[];const log=HDRLibraryStopwatch;
    window.HDRLibraryStopwatch=(stage,fields)=>{warmEvents.push({stage,at:performance.now(),...fields});log(stage,fields);};
    const slider=document.getElementById('thumbnail-size');slider.value=300;slider.dispatchEvent(new Event('input'));
   });
   const began=Date.now();
   await lib.evaluate(folder=>HDRLibrary.browse(folder),photos.replaceAll('\\','/'));
   await lib.waitForFunction(()=>{
    const b=document.getElementById('library-grid').getBoundingClientRect();
    const cells=[...document.querySelectorAll('#grid-space .library-cell')].filter(c=>{const r=c.getBoundingClientRect();return r.top<b.bottom&&r.bottom>b.top;});
    return cells.length&&cells.every(c=>c.querySelector('canvas[data-picture-key]'));
   },null,{timeout:120000});
   report.warm={fullScreenMs:Date.now()-began,events:await lib.evaluate(()=>warmEvents)};
   const checks=report.warm.events.filter(e=>e.stage==='picture_cache_check');
   report.warm.cache={hits:checks.filter(e=>e.cache_hit).length,checks:checks.length};
  }
  report.grantsAtEnd=await lib.evaluate(()=>HDRLibraryGrants.snapshot());
  Object.assign(report,memory.report());
  if(diagnostics){await diagnostics().catch(error=>report.memoryDiagnosticError=String(error));diagnostics=null;}
  Object.assign(report,coldCapture);
  report.lock=await api('lock-metrics',{});
  await page.screenshot({path:path.join(out,'screen.png')});
  if(scrollDiagnose)for(const screen of report.scrollBack){
   assert.ok(screen.cells.length&&screen.cells.every(c=>c.finishedMs!==null&&c.finishedMs<500&&!c.everBlank),'Every returning cell must be drawn within 500 ms without a blank');
   assert.ok(!screen.events.some(e=>['picture_development','picture_source_transfer','picture_pixels_fetched'].includes(e.stage)),'Recent scroll-back must use memory without source or disk reads');
  }
  assert.ok(report.screens.every(s=>s.cells.length&&s.cells.every(c=>c.presented||c.needsMemory||c.error)),'Every target cell must have an outcome');
  assert.ok((report.allocations||[]).every(a=>a.peak<=a.reserved),'Actual GPU allocation must fit its reservation');
  assert.ok(!report.memoryRequests.some(r=>r.error),'Memory endpoint must not time out');
  assert.ok(report.samples>0&&!report.observerError,'Independent memory observer must work');
  assert.ok(!memory.violation,'Whole-app memory must respect ceiling + 10% and the system reserve');
  assert.ok(report.settledAfterWork,'Work must finish and whole-app memory settle below ceiling minus 600 MB');
  assert.deepEqual(report.errors,[]);
  if(aceh)assert.equal(report.snapshot.count,names.length,'AppleDouble ._ files must not be listed');
 }catch(e){report.error=String(e.stack||e);process.exitCode=1;
  if(lib)Object.assign(report,await lib.evaluate(()=>({events:coldEvents,allocations:coldAllocations,snapshot:HDRLibrary.getSnapshot(),queue:HDRLibraryScenes.snapshot()})).catch(()=>({})));
 }
 finally{
  stopping=true;clearInterval(poll);if(activePoll)await activePoll;
  observer?.kill();Object.assign(report,memory.report());
  checkProjects(before);report.protectedProjectsUnchanged=true;
  const log=path.join(global.HDRFinisherElectronTestHarness.userDataDirectory||process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA||'','logs/backend.log');if(fs.existsSync(log))fs.copyFileSync(log,path.join(out,'backend.log'));
  report.results=(report.screens||[]).flatMap(s=>s.cells.map(c=>({...c,screen:s.screen,requests:(report.events||[]).filter(e=>e.path===c.path&&e.stage==='picture_navigation_to_present'&&e.view==='grid').map(e=>({request:e.request,size:e.picture_size,ms:e.duration_ms})),failures:(report.events||[]).filter(e=>e.path===c.path&&/development_(failed|restart|outcome)$/.test(e.stage))})));
  const quick=(report.events||[]).filter(e=>e.stage==='picture_navigation_to_present'&&e.picture_size==='camera preview').map(e=>e.duration_ms).sort((a,b)=>a-b);report.quickMs={count:quick.length,p50:quick[Math.floor(quick.length*.5)],p95:quick[Math.floor(quick.length*.95)],max:quick.at(-1)};
  const visible=new Set(report.screens[0]?.visibleTargets || []);
  const quickEvents=(report.events||[]).filter(e=>e.stage==='picture_navigation_to_present'&&e.picture_size==='camera preview');
  const visibleQuick=quickEvents.filter(e=>visible.has(e.path));
  report.visibleQuick={targets:visible.size,count:new Set(visibleQuick.map(e=>e.path)).size,
    allOnScreenMs:Math.max(0,...visibleQuick.map(e=>e.at-report.openedPerformance)),
    complete:new Set(visibleQuick.map(e=>e.path)).size===visible.size,
    slowest:visibleQuick.sort((a,b)=>b.at-a.at).slice(0,1).map(e=>({path:e.path,fromOpenMs:e.at-report.openedPerformance,requestMs:e.duration_ms})),
    p95:visibleQuick.map(e=>e.duration_ms).sort((a,b)=>a-b)[Math.floor(visibleQuick.length*.95)]};
  const frames=report.channelFrames||[];report.grantAsks=frames.filter(f=>f.type==='ask').length;report.duplicateAsks=frames.filter(f=>f.type==='ask').length-new Set(frames.filter(f=>f.type==='ask').map(f=>f.id)).size;
  const norm=value=>String(value).replaceAll('\\','/').replace(/\/+/g,'/').toLowerCase();
  report.perFile=names.map(name=>{
    const full=norm(path.join(photos,name)),events=(report.events||[]).filter(e=>norm(e.path)===full);
    const finished=events.find(e=>e.stage==='picture_navigation_to_present'&&e.picture_size==='thumbnail');
    const quick=events.find(e=>e.stage==='picture_navigation_to_present'&&e.picture_size==='camera preview');
    const outcome=(report.screens||[]).flatMap(s=>s.cells).find(c=>norm(c.path)===full&&(c.needsMemory||c.error));
    return {file:name,status:finished?'finished':outcome?.needsMemory?'needs more memory':outcome?.error?'refused: '+outcome.error:quick?'quick preview only':'not finished before stop',
      finishedMs:finished?finished.at-report.openedPerformance:null,quickMs:quick?quick.at-report.openedPerformance:null};
  });
  fs.writeFileSync(path.join(out,'per-file-results.csv'),'file,status,finished_ms,quick_ms\n'+report.perFile.map(r=>[r.file,r.status,r.finishedMs??'',r.quickMs??''].join(',')).join('\n')+'\n');
  gpuObserver?.kill();
  for(const screen of report.scrollBack||[])for(const cell of screen.cells){
   const events=screen.events.filter(e=>e.path===cell.path);
   cell.route=events.some(e=>e.stage==='picture_development')?'redeveloped':events.some(e=>e.stage==='picture_pixels_fetched')?'disk scene redraw':events.some(e=>e.stage==='picture_source_transfer')?'source decoded again':cell.finishedMs!==null?'finished surface in memory':'redraw pending';
   const previous=(report.events||[]).filter(e=>e.path===cell.path&&e.stage==='picture_shown'&&e.at<screen.began).at(-1);
   cell.previouslyFinishedAt=previous?.at;
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'cell-timings.csv'),'screen,photo,finished_request,request_to_finished_ms,camera_preview_ms,presented,failure\n'+report.results.map(r=>{
   const finished=r.requests.filter(p=>p.size==='thumbnail').at(-1)||{};
   const camera=r.requests.find(p=>p.size==='camera preview');
   return [r.screen,path.basename(r.path),finished.request,finished.ms,camera?.ms||'',r.presented,r.error||''].join(',');
  }).join('\n')+'\n');
  console.log(JSON.stringify({error:report.error,peakBytes:peak,memoryRequests:report.memoryRequests.length,timeouts:report.memoryRequests.filter(r=>r.error).length}));
  await browser?.close();
  // Resolve and verify our own scratch target before recursive cleanup.
  if(singleFileRestore){assert.ok(!fs.existsSync(singleFileRestore.original));fs.renameSync(singleFileRestore.temporary,singleFileRestore.original);if(singleFileRestore.sidecar)fs.renameSync(singleFileRestore.temporary+'.hdrf',singleFileRestore.original+'.hdrf');}
  assert.ok(path.resolve(scratch).startsWith(path.resolve(root,'output/test-photos')+path.sep));fs.rmSync(scratch,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
