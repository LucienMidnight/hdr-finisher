const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {resolveInterpretation}=require('./helpers/resolve-interpretation.js');
(async()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'test-linked-delivery-'));
 const browser=await chromium.launch(); let page,base;
 const python=require('../tools/lib/platform.cjs').pythonExecutable();
 const env={...process.env,PYTHONPATH:path.resolve('backend')};
 const report={checks:[]};
 try{
  page=await browser.newPage(); await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');base=new URL(page.url()).origin;
  await page.waitForFunction(()=>state.gpuPreview?.available);
  const response=await page.request.post(`${base}/api/session`,{multipart:{file:{name:'linked.tiff',mimeType:'image/tiff',buffer:fs.readFileSync('tests/fixtures/hdr_match_scene.tiff')}}});
  assert(response.ok(),await response.text());const {session}=await response.json();
  await page.evaluate(s=>activateDesktopSession(s,''),session);await resolveInterpretation(page);
  const post=async(route,data)=>{const r=await page.request.post(`${base}${route}`,{data,timeout:120000});assert(r.ok(),await r.text());return r.json();};
  await page.evaluate(async()=>{
   state.adjustments.hdr.film_look.film_stock='kodak_portra_400';state.adjustments.hdr.film_look.look_strength=50;
   state.adjustments.hdr.highlight_section_enabled=true;state.adjustments.hdr.highlight_compression_mode='fixed_cap';
   markGlobalEditDirty();if(!await syncGlobalEditState())throw Error('global preparation');
   const local=newLocalAdjustment('linear_gradient');local.name='HDR window';local.hdr_grade.exposure=.05;local.sdr_grade.exposure=.05;
   if(!await queueEditCommand('create_local',{local}))throw Error('local preparation');state.selectedLocalId=local.id;
   // Whole Match intentionally materializes independent editable SDR now.
   // Seed a linked recipe in the disposable session to exercise the linked
   // renderer and editing/history without depending on the removed entry point.
   state.adjustments.sdr.linked_to_hdr=true;markGlobalEditDirty();
   if(!await syncGlobalEditState())throw Error('linked recipe preparation');
   await switchLane('sdr');
  });
  assert.equal(await page.evaluate(()=>state.editDocument.global_adjustments.sdr.linked_to_hdr),true);
  await page.waitForFunction(()=>state.acceptedPresentation?.lane==='sdr'&&state.acceptedPresentation.exact&&state.acceptedPresentation.generation===state.previewGeneration.sdr);
  assert.match(await page.locator('#sdr-match-entire-status').innerText(),/Linked to HDR/);
  const visibleStatus=await page.locator('#sdr-match-entire-status').evaluate(e=>({clip:getComputedStyle(e).clipPath,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));
  assert.equal(visibleStatus.clip,'none');assert(visibleStatus.width>10&&visibleStatus.height>10);
  assert(await page.locator('#sdr-unlink').isVisible());report.checks.push('linked recipe presents');
  await page.evaluate(async()=>{commitAdjustmentValue('hdr.exposure',.1,{manual:true});await syncGlobalEditState();});
  assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),true);
  await page.waitForFunction(()=>state.acceptedPresentation?.lane==='sdr'&&state.acceptedPresentation.exact&&state.acceptedPresentation.generation===state.previewGeneration.sdr);
  report.checks.push('HDR edit updates current SDR presentation');
  await page.locator('#sdr-unlink').click();await page.evaluate(()=>syncGlobalEditState());
  assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),false);
  assert.equal(await page.evaluate(()=>queueEditCommand('undo')),true);assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),true);
  assert.equal(await page.evaluate(()=>queueEditCommand('redo')),true);assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),false);
  await page.evaluate(()=>queueEditCommand('undo'));report.checks.push('Unlink Undo and Redo');
  await page.evaluate(async()=>{commitAdjustmentValue('sdr.contrast',.1,{manual:true});await syncGlobalEditState();});
  assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),false);
  await page.evaluate(()=>queueEditCommand('undo'));assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),true);
  report.checks.push('SDR Tone edit unlinks in one Undo');
  await page.evaluate(async()=>{commitAdjustmentValue('hdr.contrast',.12,{manual:true});if(!state.globalEditDirty)throw Error('Expected pending HDR global edit');setGradeMode('local');const local=selectedLocal();local.sdr_grade.exposure+=.1;scheduleLocalPreview();await commitSelectedLocal();});
  assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),false);
  await page.evaluate(()=>queueEditCommand('undo'));assert.equal(await page.evaluate(()=>state.adjustments.sdr.linked_to_hdr),true);
  assert.equal(await page.evaluate(()=>state.adjustments.hdr.contrast),.12);
  report.checks.push('SDR local edit and unlink share one Undo while an HDR global edit is pending');
  await page.evaluate(()=>setGradeMode('global'));
  // The seeded grade also contains an independent SDR local. Whole Match
  // still asks before replacing authored locals, and cancel is a no-op.
  const revision=await page.evaluate(()=>state.editRevision);
  await page.locator('#sdr-match-entire').click();await page.locator('#app-dialog[open]').waitFor();
  assert.match(await page.locator('#app-dialog-message').innerText(),/individually matched or edited/);
  await page.locator('#app-dialog-actions button').filter({hasText:'Cancel'}).click();
  assert.equal(await page.evaluate(()=>state.editRevision),revision);report.checks.push('authored SDR local overwrite confirmation retained');
  const renderer=page.context().pages().find(p=>p.url().includes('gpu-delivery.html'));assert(renderer);
  await renderer.waitForFunction(()=>typeof HDRGpuDeliveryFinishing==='function');
  await renderer.evaluate(()=>{window.__linkedFinished=[];const read=HDRGpuDeliveryFinishing.prototype.read;HDRGpuDeliveryFinishing.prototype.read=async function(t){const p=await read.call(this,t);window.__linkedFinished.push({width:t.width,height:t.height,pixels:Array.from(p)});return p;};});
  const settings={format:'jpeg_ultrahdr',quality:95,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:95,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'original',sharpening:'off'}};
  const doc=await page.evaluate(()=>state.editDocument);fs.writeFileSync(path.join(scratch,'document.json'),JSON.stringify(doc));
  for(const forceCpu of [false,true]){
   await post('/api/delivery/preferences',{force_cpu:forceCpu});const file=path.join(scratch,forceCpu?'cpu.jpg':'gpu.jpg');
   await global.HDRFinisherElectronTestHarness.selectExportPath(file);
   const grant=await page.evaluate(()=>hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'linked.jpg'}));
   const exported=await post(`/api/session/${session.session_id}/export`,{...settings,output_path:file,path_grant:grant.grant});
   assert(exported.accepted);assert.equal(exported.renderer,forceCpu?'cpu':'gpu');
   for(const full_size of [false,true]){
    const proof=await post(`/api/session/${session.session_id}/proof/artifact`,{...settings,full_size});
    assert.equal(proof.renderer,exported.renderer);
    const bytes=await page.request.get(`${base}/api/proof/artifact/${proof.artifact_id}.jpg`);assert(bytes.ok());
    assert(fs.readFileSync(file).equals(await bytes.body()),'Proof equals delivered bytes');
   }
  }
  fs.writeFileSync(path.join(scratch,'finished.json'),JSON.stringify(await renderer.evaluate(()=>window.__linkedFinished.slice(0,2))));
  fs.copyFileSync('tests/fixtures/hdr_match_scene.tiff',path.join(scratch,'diagnostic-source.tiff'));
  report.delivery=JSON.parse(execFileSync(python,['tests/helpers/local_delivery_diagnostics.py',scratch,path.join(scratch,'floats.npz')],{env,encoding:'utf8'}));
  for(const lane of ['hdr','sdr'])assert.equal(report.delivery[lane].float_gpu_cpu.passed,true,JSON.stringify(report.delivery));
  report.checks.push('linked GPU/CPU finished export agreement','reduced/full Proof byte equality, GPU and CPU');
  await post('/api/delivery/preferences',{force_cpu:false});
  const output='output/review/safe-link';fs.mkdirSync(output,{recursive:true});
  for(const [width,height] of [[1408,794],[1100,720]]){
   await browser.newPage({viewport:{width,height}});await page.locator('#sdr-match-entire-actions').scrollIntoViewIfNeeded();
   const box=await page.locator('#sdr-match-entire-actions').boundingBox();assert(box.x>=0&&box.x+box.width<=width);
   await page.locator('#sdr-match-entire-actions').screenshot({path:path.join(output,`link-${width}.png`)});
  }
  report.passed=true;
 }finally{
  fs.mkdirSync('output/review/safe-link',{recursive:true});fs.writeFileSync('output/review/safe-link/interaction.json',JSON.stringify(report,null,2));
  if(page&&base)await page.request.post(`${base}/api/delivery/preferences`,{data:{force_cpu:false}}).catch(()=>{});
  await browser.close();fs.rmSync(scratch,{recursive:true,force:true});
 }
 console.log(report);
})().catch(e=>{console.error(e);process.exitCode=1;});
