/* Short read-only scroll reproduction. Uses the runner's disposable profile. */
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {hashProjects,checkProjects}=require('../tests/release/runner.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/badminton');
const crypto=require('node:crypto');
const photos='D:/Photos/2026/20261017 badminton';
const manifest=()=>Object.fromEntries(fs.readdirSync(photos).filter(n=>/\.hdrf$/i.test(n)).map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(photos,n))).digest('hex')]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const photoBefore=manifest();
 const before=hashProjects(require('../tests/release/drivers.json').protectedProjects);
 const report={events:[],errors:[],cells:[],peakBytes:0},browser=await chromium.launch();let observer;
 const record=()=>fs.writeFileSync(path.join(out,'scroll.json'),JSON.stringify(report,null,2));
 try{
  observer=spawn(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'measure-library-processes.py'),process.env.HDR_FINISHER_ELECTRON_MAIN_PID],{windowsHide:true});
  let buffer='';observer.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line){const s=JSON.parse(line);if(s.totalBytes>report.peakBytes){report.peakBytes=s.totalBytes;report.peakSample=s;}if(s.totalBytes>4e9)report.ceilingExceeded=true;}}});
  observer.stderr.on('data',b=>report.errors.push(String(b)));
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  report.network=[];const requests=new Map();
  page.on('request',r=>{if(r.url().includes('/api/library/'))requests.set(r,{url:r.url().split('/api/library/')[1],at:Date.now(),body:r.postData()?.slice(0,300)});});
  page.on('requestfailed',r=>{const v=requests.get(r);if(v){report.network.push({...v,ms:Date.now()-v.at,cancelled:true});requests.delete(r);}});
  page.on('requestfinished',r=>{const v=requests.get(r);if(v){report.network.push({...v,ms:Date.now()-v.at});requests.delete(r);}});
  await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);await sleep(1500);
  await lib.evaluate(()=>{
   document.querySelector('[data-sort="name"]').click();
   const slider=document.getElementById('thumbnail-size');slider.value=360;slider.dispatchEvent(new Event('input'));
   window.scrollEvidence=[];const log=window.HDRLibraryStopwatch;
   window.HDRLibraryStopwatch=(stage,fields)=>{scrollEvidence.push({stage,at:performance.now(),...fields});log(stage,fields);};
   window.cellEvidence=[];
   const seen=new WeakSet();new MutationObserver(()=>{
    for(const cell of document.querySelectorAll('#grid-space .library-cell'))if(!seen.has(cell)){
     seen.add(cell);cellEvidence.push({path:cell.dataset.path,at:performance.now()});
    }
   }).observe(document.getElementById('grid-space'),{childList:true});
  });
  await lib.evaluate(()=>HDRLibrary.browse('D:/Photos/2026/20261017 badminton'));
  await lib.waitForFunction(()=>!HDRLibrary.getSnapshot().reading&&HDRLibrary.getSnapshot().paths.some(p=>p.includes("DSC07200")));
  await lib.evaluate(()=>document.querySelector('[data-sort="name"]').click());report.initial=await lib.evaluate(()=>HDRLibrary.getSnapshot());await sleep(1000);
  for(const name of ['DSC07200','DSC07210','DSC07220','DSC07230','DSC07240','DSC07250','DSC07210','DSC07230']){
   if(report.ceilingExceeded)throw Error('Memory ceiling exceeded');
   await lib.evaluate(name=>{
    const s=HDRLibrary.getSnapshot(),i=s.paths.findIndex(p=>p.includes(name));
    if(i<0)throw Error("Missing scroll target "+name);const grid=document.getElementById('library-grid'),size=Number(document.getElementById('thumbnail-size').value);
    const layout=HDRLibraryLayout.gridLayout(s.count,grid.clientWidth,grid.clientHeight,grid.scrollTop,size);
    grid.scrollTop=layout.scrollFor(i);grid.dispatchEvent(new Event('scroll'));
   },name);
   await sleep(6000);
   report.cells.push(await lib.evaluate(()=>({at:performance.now(),queue:HDRLibraryScenes.snapshot(),cells:[...document.querySelectorAll('#grid-space .library-cell')].map(c=>({path:c.dataset.path,loading:c.classList.contains('loading'),finished:!!c.querySelector('canvas[data-picture-key]')}))})));
   console.log(name,report.peakBytes,report.cells.at(-1).cells.filter(c=>c.finished).length);record();
  }
  Object.assign(report,await lib.evaluate(()=>({events:scrollEvidence,requests:cellEvidence})));
  report.pendingNetwork=[...requests.values()];
 }catch(e){report.error=String(e.stack||e);process.exitCode=1;}
 finally{
  observer?.kill();checkProjects(before);report.protectedProjectsUnchanged=true;
  report.sidecarsUnchanged=JSON.stringify(photoBefore)===JSON.stringify(manifest());if(!report.sidecarsUnchanged)throw Error("Photo settings changed during read-only scroll");
  const log=path.join(process.env.HDR_FINISHER_USER_DATA_DIR||process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA||'','logs/backend.log');
  if(fs.existsSync(log))fs.copyFileSync(log,path.join(out,'backend.log'));
  record();await browser.close();
 }
})();
