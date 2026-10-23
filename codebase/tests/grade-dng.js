/* Real DNG Grade import: headless hardware rendering, disposable photos and three-run medians. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{execFileSync,spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/grade-dng',String(Date.now()));fs.mkdirSync(folder,{recursive:true});
const originals=[process.env.HDR_DNG_LEICA||'D:/Photos/HDR Test Images/Leica-X2-L1021324.DNG',process.env.HDR_DNG_DJI||'D:/Photos/HDR Test Images/DJI Samples/DJI_0071-2.DNG'];
const fixture=require('./fixtures/dng-real-samples.json').leica_x2;
const originalHash=require('node:crypto').createHash('sha256').update(fs.readFileSync(originals[0])).digest('hex');assert.equal(originalHash,fixture.sha256,'Leica fixture identity');
const photos=originals.map(src=>{const dest=path.join(folder,path.basename(src));fs.copyFileSync(src,dest);return dest;});
const repeats=process.argv.includes('--measure')?3:1,rows=[];
let backend;
function stopBackend(){if(backend?.pid){const pid=backend.pid;backend=null;try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}}
process.once('exit',stopBackend);
(async()=>{
 { // Own the backend so cache isolation cannot depend on the caller's server.
  const net=require('node:net'),server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  process.env.HDR_FINISHER_URL='http://127.0.0.1:'+port;
  const log=fs.openSync(path.join(folder,'backend.log'),'w');
  backend=spawn(path.join(root,'.venv/Scripts/python.exe'),['-m','uvicorn','hdr_finisher.main:app','--host','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,env:{...process.env,PYTHONPATH:path.join(root,'backend'),HDR_FINISHER_APP_DATA_DIR:path.join(folder,'appdata'),HDR_FINISHER_SOURCE_CACHE_DISABLE:'1'},stdio:['ignore',log,log]});
  const deadline=Date.now()+30000;while(true){try{if((await fetch(process.env.HDR_FINISHER_URL+'/health')).ok)break;}catch{}if(Date.now()>deadline)throw Error('Backend startup timed out');await new Promise(r=>setTimeout(r,200));}
 }
 const startupDeadline=Date.now()+30000;while(true){try{if((await fetch(process.env.HDR_FINISHER_URL+'/health')).ok)break;}catch{}if(Date.now()>startupDeadline)throw Error('Backend startup timed out');await new Promise(r=>setTimeout(r,200));}
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
 const context=await browser.newContext({viewport:{width:2560,height:1440}});
 const worker=await context.newPage();
 const page=await context.newPage();page.on('pageerror',e=>console.error('PAGE',e.message));
 try{
  await worker.goto(process.env.HDR_FINISHER_URL+'/static/gpu-delivery.html');
  await page.goto(process.env.HDR_FINISHER_URL);await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
  await page.evaluate(()=>{window.__dngFrames=[];addEventListener('hdrfinisher:preview-presented',e=>__dngFrames.push({at:performance.now(),...e.detail}));});
  for(const photo of photos)for(let repeat=0;repeat<repeats;repeat++)for(const mode of (repeat%2?['gpu','cpu']:['cpu','gpu'])){
   console.log('START',path.basename(photo),repeat,mode);
   await page.request.post(new URL('/api/delivery/preferences',process.env.HDR_FINISHER_URL).href,{data:{force_cpu:mode==='cpu'}});
   const result=await page.evaluate(async({photo})=>{
    await activateWorkflowTab('grade');__dngFrames.length=0;const start=performance.now();
    const granted=await(await fetch('/api/desktop/grant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo,intent:'source-open'})})).json();
    const created=await projectIo.createImportJob(fetch,{grant:granted.grant});let job=created.payload;if(!created.response.ok)throw Error(JSON.stringify(job));
    const deadline=performance.now()+240000;
    while(!['ready','error','cancelled'].includes(job.state)){if(performance.now()>deadline)throw Error('Import timeout');await new Promise(r=>setTimeout(r,100));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
    if(job.state!=='ready')throw Error(JSON.stringify(job));
    const session=(await projectIo.fetchSession(fetch,job.session_id)).payload.session;await activateDesktopSession(session,'');return {start,session,job};
   },{photo});
   await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==='ready'&&__dngFrames.some(e=>e.generation===state.previewGeneration[state.currentView]&&e.lane===state.currentView),null,{timeout:180000});
   const timing=await page.evaluate(start=>({firstFrameMs:__dngFrames.find(e=>e.generation===state.previewGeneration[state.currentView]&&e.lane===state.currentView).at-start,exactMs:performance.now()-start}),result.start);
   const proxy=await page.request.get(new URL(`/api/session/${result.session.session_id}/proxy/hdr?long_edge=2560&format=rgba32f`,process.env.HDR_FINISHER_URL).href);assert.ok(proxy.ok());
   const file=`${path.basename(photo)}-${repeat}-${mode}.bin`;fs.writeFileSync(path.join(folder,file),await proxy.body());
   const diagnostic=JSON.stringify(result.session.metadata);
   if(mode==='gpu')assert.ok(diagnostic.includes("'renderer': 'gpu'"),'GPU DNG must execute: '+diagnostic);
   const row={photo,repeat,mode,...timing,job:result.job,session:result.session,proxy:proxy.headers(),file};rows.push(row);
   fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({folder,rows},null,2));console.log('DONE',path.basename(photo),repeat,mode,JSON.stringify(timing));
   await page.request.delete(new URL('/api/session/current',process.env.HDR_FINISHER_URL).href);
  }
  console.log(execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'helpers/grade_dng_compare.py'),path.join(folder,'results.json')],{encoding:'utf8',maxBuffer:1<<24}));
  console.log('Evidence:',folder);
 }finally{await page.request.post(new URL('/api/delivery/preferences',process.env.HDR_FINISHER_URL).href,{data:{force_cpu:false}}).catch(()=>{});await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(stopBackend);
