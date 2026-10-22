/* Real clipped photographs: Grade first frame, Library completion and delivery.
 * Work only on disposable copies; never save owner photos/projects.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),python=path.join(root,'.venv/Scripts/python.exe');
const folder=path.join(root,'output/edge-colour-raw',String(Date.now()));fs.mkdirSync(folder,{recursive:true});
const samples=['D:/Photos/HDR Test Images/DSC00264.ARW','D:/Photos/Play_Raw/Sunset on ferry -silicoid/IMG_3129.CR2'];
const photos=samples.filter(p=>fs.existsSync(p)).map(p=>{const copy=path.join(folder,path.basename(p));fs.copyFileSync(p,copy);return copy;});
assert.equal(photos.length,2,'Both requested clipped-highlight photos must be available');
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage(),rows=[];
 try{
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.waitForFunction(()=>window.HDRFinisherPerformance?.gpuSnapshot?.()?.available,{timeout:120000});
  await page.evaluate(()=>{window.__edgeFrames=[];window.addEventListener('hdrfinisher:preview-presented',e=>__edgeFrames.push({at:performance.now(),...e.detail}));});
  for(const photo of photos){
   const row={photo};
   for(const cpu of [true,false]){
    await page.request.post(new URL('/api/delivery/preferences',process.env.HDR_FINISHER_URL).href,{data:{force_cpu:cpu}});
    const result=await page.evaluate(async({photo,cpu})=>{
     const start=performance.now();__edgeFrames.length=0;
     const grant=await desktop.grantSourcePath(photo);
     const created=await projectIo.createImportJob(fetch,{grant:grant.grant,rawImportSettings:{highlight_reconstruction:{enabled:true,method:'edge_colour_v1',edge_colour_expand_percent:.5}}});
     let job=created.payload;if(!created.response.ok)throw Error(JSON.stringify(job));
     while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,100));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
     if(job.state!=='ready')throw Error(JSON.stringify(job));
     const session=(await projectIo.fetchSession(fetch,job.session_id)).payload.session;
     await activateDesktopSession(session,'');
     return {start,session,job};
    },{photo,cpu});
    await page.waitForFunction(()=>__edgeFrames.some(e=>e.generation===state.previewGeneration[state.currentView]&&e.lane===state.currentView)&&state.acceptedPresentation?.exact&&viewerState().status==='ready',null,{timeout:180000});
    const timing=await page.evaluate(start=>({firstFrameMs:__edgeFrames.find(e=>e.generation===state.previewGeneration[state.currentView]&&e.lane===state.currentView).at-start,exactMs:performance.now()-start}),result.start);
    const proxy=await page.request.get(new URL(`/api/session/${result.session.session_id}/proxy/hdr?long_edge=2560&format=rgba32f`,process.env.HDR_FINISHER_URL).href);
    assert.ok(proxy.ok(),await proxy.text().catch(()=>''));
    const name=path.basename(photo)+(cpu?'.cpu':'.gpu');
    fs.writeFileSync(path.join(folder,name+'.bin'),await proxy.body());
    const record={...timing,backendMs:result.job.elapsed_ms,phaseHistory:result.job.phase_history,session:result.session,proxy:proxy.headers(),file:name+'.bin'};
    row[cpu?'cpu':'gpu']=record;
    fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({folder,rows:[...rows,row]},null,2));
    if(cpu)continue;
    const diagnostic=JSON.stringify(result.session.metadata.extra.raw_development);
    assert.ok(diagnostic.includes("'renderer': 'gpu'"),`Grade must use GPU reconstruction: ${diagnostic}`);
    const id=result.session.session_id;
    const saved=await page.evaluate(async id=>{
     for(const action of ['attach','capture','save']){const r=await fetch('/api/library/grade/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});if(!r.ok)throw Error(await r.text());}
     return true;
    },id);assert.ok(saved);
    await page.evaluate(()=>activateWorkflowTab('import'));
    const library=page.frame({url:/\/library(?:\?|$)/});assert.ok(library);
    row.library=await library.evaluate(async({photo,folder})=>{
     await HDRLibrary.browse(folder);const start=performance.now();
     const meta=await HDRLibraryGpuRaw.liveScene(photo,2560);
     if(!meta||meta.renderer!=='gpu'||!meta.edge_colour?.applied)throw Error('Library silently used CPU: '+JSON.stringify(meta));
     return {ms:performance.now()-start,meta,location:(await(await fetch('/api/library/cache-settings')).json()).location};
    },{photo,folder});
    const libraryProxy=await page.request.get(new URL('/api/library/live-pixels/'+row.library.meta.key,process.env.HDR_FINISHER_URL).href);
    assert.ok(libraryProxy.ok());
    row.library.proxy=libraryProxy.headers();row.library.file=path.basename(photo)+'.library.bin';
    fs.writeFileSync(path.join(folder,row.library.file),await libraryProxy.body());
    fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({folder,rows:[...rows,row]},null,2));
    await page.evaluate(()=>activateWorkflowTab('grade'));
    const deliveryDoc=structuredClone(result.session.edit_document);
    deliveryDoc.global_adjustments.hdr.highlight_section_enabled=true;
    const edited=await page.request.put(new URL(`/api/session/${id}/edit-state?expected_revision=${result.session.edit_revision}`,process.env.HDR_FINISHER_URL).href,{data:deliveryDoc});
    assert.ok(edited.ok(),await edited.text());
    // Proof and export share the same selected source and the same paired GPU
    // render. A modest delivery size keeps this focused source-change check short.
    const target=path.join(folder,path.basename(photo)+'.jpg');
    await global.HDRFinisherElectronTestHarness.selectExportPath(target);
    const grant=await page.evaluate(()=>hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'edge.jpg'}));
    const settings={format:'jpeg_ultrahdr',quality:95,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:95,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'long_edge',long_edge:1024,sharpening:'off'}};
    const exported=await page.request.post(new URL(`/api/session/${id}/export`,process.env.HDR_FINISHER_URL).href,{data:{...settings,output_path:target,path_grant:grant.grant},timeout:240000});
    row.export=await exported.json();assert.ok(exported.ok()&&row.export.accepted,JSON.stringify(row.export));
    const proof=await page.request.post(new URL(`/api/session/${id}/proof/artifact`,process.env.HDR_FINISHER_URL).href,{data:{...settings,full_size:true},timeout:240000});
    row.proof=await proof.json();assert.ok(proof.ok(),JSON.stringify(row.proof));
    const encoded=await page.request.get(new URL(row.proof.url,process.env.HDR_FINISHER_URL).href);
    fs.writeFileSync(target+'.proof.jpg',await encoded.body());
    assert.equal(row.proof.renderer,row.export.renderer);
    assert.deepEqual(fs.readFileSync(target),fs.readFileSync(target+'.proof.jpg'),'Proof and export use the same encoded picture');
   }
   rows.push(row);fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({folder,rows},null,2));
   console.log(JSON.stringify({photo:path.basename(photo),cpuFirstFrameMs:row.cpu.firstFrameMs,gpuFirstFrameMs:row.gpu.firstFrameMs,libraryMs:row.library.ms,delivery:row.export.renderer}));
  }
  console.log(execFileSync(python,[path.join(__dirname,'helpers/edge_colour_raw_compare.py'),path.join(folder,'results.json')],{encoding:'utf8',maxBuffer:1<<24}));
  console.log('Results: '+folder);
 }finally{await page.request.post(new URL('/api/delivery/preferences',process.env.HDR_FINISHER_URL).href,{data:{force_cpu:false}}).catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
