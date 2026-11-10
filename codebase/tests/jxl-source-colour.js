/* Focused real-Electron JXL source test. No Proof/export, grades or timing sweep.
 * node tests/run-in-electron.js tests/jxl-source-colour.js
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),python=path.join(root,'.venv/Scripts/python.exe');
const folder=path.join(root,'output/test-photos/jxl-fixes'),review=path.join(root,'output/review/jxl-fixes');
const helper=path.join(__dirname,'helpers/jxl_source_colour.py');
const run=(...args)=>execFileSync(python,[helper,...args],{cwd:root,encoding:'utf8',maxBuffer:32<<20});
(async()=>{
 let browser,scratch;const summary={passed:false};
 fs.mkdirSync(review,{recursive:true});
 try{
  browser=await chromium.launch();
  const fixtures=JSON.parse(run('prepare',folder));summary.real_sha256=fixtures.real_sha256;
  scratch=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'hdr-jxl-colour-'));
  const page=await browser.newPage();
  page.setDefaultTimeout(30000);await page.goto(process.env.HDR_FINISHER_URL);
  await page.evaluate(()=>activateWorkflowTab('grade'));
  summary.grade=await page.evaluate(async photo=>{
   const grant=await desktop.grantSourcePath(photo);
   const created=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=created.payload;
   if(!created.response.ok)throw Error(JSON.stringify(job));
   const deadline=performance.now()+60000;
   while(!['ready','error','cancelled'].includes(job.state)){
    if(performance.now()>deadline)throw Error('JXL import timeout');
    await new Promise(r=>setTimeout(r,100));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;
   }
   if(job.state!=='ready')throw Error(JSON.stringify(job));
   const session=(await projectIo.fetchSession(fetch,job.session_id)).payload.session;
   if(session.analysis.needs_color_override!==false)throw Error('JXL interpretation gate remained');
   await activateDesktopSession(session,'');if(els.interpretationColorSpace.value!=='linear_p3'||els.interpretationTransfer.value!=='pq')throw Error('Source controls lost P3/PQ');return {needs_color_override:session.analysis.needs_color_override,source:session.source};
  },fixtures.photos[0]);
  await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==='ready'&&state.acceptedPresentation.transport==='WebGPU',null,{timeout:60000});
  summary.grade.presentation=await page.evaluate(()=>({exact:state.acceptedPresentation.exact,status:viewerState().status,transport:state.acceptedPresentation.transport,execution:state.acceptedPresentation.execution}));
  const full=path.join(scratch,'grade.png');fs.writeFileSync(full,await page.screenshot());
  execFileSync(python,['-c','from PIL import Image;import sys; im=Image.open(sys.argv[1]);im.thumbnail((1280,720));im.save(sys.argv[2])',full,path.join(review,'grade.png')]);
  await page.evaluate(()=>activateWorkflowTab('import'));
  const frame=page.locator('#library-frame');
  const result=await frame.evaluate(async(element,photos)=>{
   const w=element.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),original=gpu.renderTo,rows=[];
   let captured;
   gpu.renderTo=async function(canvas,...args){const value=await original.call(this,canvas,...args);captured=await this.analyzeScope(canvas,{width:args[9].width,height:args[9].height,tier:'picture',raw:true});return value;};
   try{
    for(const photo of photos){
     const controller=new w.AbortController(),timer=setTimeout(()=>controller.abort(),45000);
     let meta;
     try{meta=await w.HDRLibraryScenes.load(photo,640,controller.signal,10,null,{develop:true});}finally{clearTimeout(timer);}
     if(meta.renderer!=='gpu'||!meta.rgb_adapter)throw Error('JXL did not use RGB GPU route: '+JSON.stringify(meta));
     const lanes={};
     for(const lane of ['hdr','sdr']){
      captured=null;const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
      try{
       await w.HDRLibraryPictures.show(meta,canvas,controller.signal,()=>true,lane==='hdr');
       if(!captured)throw Error('No actual GPU finished pixels');
       const bytes=new Uint8Array(captured.halves.buffer,captured.halves.byteOffset,captured.halves.byteLength);let binary='';
       for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
       lanes[lane]=w.btoa(binary);
      }finally{canvas.remove();}
     }
     await meta.directScene?.store();rows.push({photo,meta,lanes});
    }
    return {rows};
   }finally{gpu.renderTo=original;w.HDRLibraryGpuRaw.releaseNative();}
  },fixtures.photos);
  const pixels=path.join(scratch,'pixels.json');fs.writeFileSync(pixels,JSON.stringify(result));
  summary.library=JSON.parse(run('compare',pixels));
  for(const row of summary.library)for(const check of row.checks)assert.ok(check.passed,JSON.stringify({photo:row.photo,...check}));
  // Real sidebar handlers, no synthetic menu invocation and no preference toggles.
  const library=page.frame({url:/\/library(?:\?|$)/});assert.ok(library);
  await frame.evaluate(async (el,folder)=>{const w=el.contentWindow;const r=await w.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});if(!r.ok)throw Error('Pin failed');await w.HDRLibrary.refreshPins();},folder);
  await library.locator('.library-nav').evaluate(el=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:300})));
  assert.ok(await library.locator('#library-folder-menu').getByText('Show all files',{exact:true}).isVisible());
  await page.keyboard.press('Escape');summary.sidebarBlank=true;
  const row=library.locator('.library-folder-row').first();
  if(await row.count()){
   await row.click({button:'right'});assert.ok(await library.locator('#library-folder-menu').getByText('Show all files',{exact:true}).isVisible());
   await page.keyboard.press('Escape');summary.sidebarFolder=true;
  }else summary.sidebarFolder='No pinned folder in disposable profile';
  summary.passed=true;
 }catch(error){summary.error=error.stack;throw error;}
 finally{
  fs.writeFileSync(path.join(review,'summary.json'),JSON.stringify(summary,null,2));
  if(scratch)fs.rmSync(scratch,{recursive:true,force:true});
  if(browser)await browser.close();
 }
 console.log(JSON.stringify(summary));
})().catch(error=>{console.error(error);process.exitCode=1;});
