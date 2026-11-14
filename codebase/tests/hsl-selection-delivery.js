// Shared colour selection on a real photo: full-size GPU and forced-CPU export of a
// copy of Balanced Rock with Steve's Global HSL (or --local hue-mask) settings.
// The photo's GPU/CPU gap is measured with HSL neutral first; the active edit may add at
// most 0.15 mean / 0.5 p99 to it. Also the 1000-nit HDR ceiling on every file and that
// full-size Proof is the delivered file.
// node tests/run-in-electron.js tests/hsl-selection-delivery.js [--local]
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');const {execFileSync}=require('node:child_process');
const {photosPath}=require('./helpers/photos-root.cjs');
const local=process.argv.includes('--local'),keep=process.argv.includes('--keep');
const python=require('../tools/lib/platform.cjs').pythonExecutable(),env={...process.env,PYTHONPATH:path.resolve(__dirname,'../backend')};
const settled=()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.lane===state.currentView
 &&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hsl-selection-delivery-'));
 const original=photosPath('D:/Photos/Play_Raw/Balanced Rock in Arches Nat Park - LaurentFromSF/IMG_0114.CR2');
 const photos=path.resolve('output/test-photos');fs.mkdirSync(photos,{recursive:true});
 const photo=path.join(photos,'IMG_0114.CR2');if(!fs.existsSync(photo))fs.copyFileSync(original,photo);
 const browser=await chromium.launch(),page=await browser.newPage(),base=process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765';
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const api=async(route,data)=>{const r=await page.request.post(new URL(route,base).href,{data,timeout:900000});assert.ok(r.ok(),await r.text());return r.json();};
 try{
  await page.goto(base);await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:30000});
  const session=await page.evaluate(async photo=>{const grant=await desktop.grantSourcePath(photo);const c=await projectIo.createImportJob(fetch,{grant:grant.grant});let job=c.payload;
   while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
   if(job.state!=='ready')throw Error(JSON.stringify(job));const s=(await projectIo.fetchSession(fetch,job.session_id)).payload.session;await activateDesktopSession(s,'');activateWorkflowTab('grade');return s;},photo);
  await page.waitForFunction(settled,null,{timeout:300000});
  // The RAW route's GPU/CPU gap exists with HSL neutral on this photo, so HSL is
  // judged by what it adds: active agreement within neutral + (0.15 mean, 0.5 p99).
  const deliver=async(tag)=>{const dir=path.join(root,tag);fs.mkdirSync(dir);const timings={};
   for(const forced of [false,true]){
    await api('/api/delivery/preferences',{force_cpu:forced});const file=path.join(dir,forced?'cpu.jpg':'gpu.jpg');
    await global.HDRFinisherElectronTestHarness.selectExportPath(file);
    const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'hsl.jpg'}));
    const settings={format:'jpeg_ultrahdr',quality:95,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:95,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'original',sharpening:'off'}};
    const t=Date.now();const exported=await api(`/api/session/${session.session_id}/export`,{...settings,output_path:file,path_grant:grant.grant});
    timings[forced?'cpu_export_s':'gpu_export_s']=(Date.now()-t)/1000;
    assert.ok(exported.accepted);assert.equal(exported.renderer,forced?'cpu':'gpu',JSON.stringify(exported));
    const proof=await api(`/api/session/${session.session_id}/proof/artifact`,{...settings,full_size:true});assert.equal(proof.renderer,exported.renderer);
    const bytes=await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.jpg`,base).href);assert.ok(bytes.ok());
    const proofBytes=await bytes.body();
    if(!fs.readFileSync(file).equals(proofBytes)){fs.writeFileSync(file.replace(/\.jpg$/,'-proof.jpg'),proofBytes);
     if(keep)console.log('proof differs',file);else assert.fail('Proof equals delivered bytes');}
   }
   const result=JSON.parse(execFileSync(python,[path.join(__dirname,'helpers/gpu_delivery_fixture.py'),'compare',dir],{env,encoding:'utf8'}));
   result.cpu_peak_nits=JSON.parse(execFileSync(python,['-c','import sys,json;from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling;print(json.dumps(check_decoded_hdr_ceiling(sys.argv[1],"jpeg_ultrahdr",1000)))',path.join(dir,'cpu.jpg')],{env,encoding:'utf8'}));
   console.log(tag,JSON.stringify({...result,...timings}));
   /* Both read-only helper calls enforce the shared encoding allowance. */return result;};
  const configure=active=>page.evaluate(async ({local,active})=>{
   for(const lane of ['hdr','sdr']){const b=state.adjustments[lane];b.highlight_section_enabled=true;b.highlight_compression_mode='peak_fit';
    if(lane==='hdr'){b.highlight_compression_target_nits=1000;b.highlight_compression_start_nits=400;}
    if(!local){const r=b.hsl.channels.find(c=>c.id==='yellow').recipe;r.ranges[0].width=15;r.ranges[0].feather=21;r.luminance=active?.8:0;r.uniformity=0;r.opacity=1;r.edge=3;r.edge_feather=6;r.edge_detail=75;b.hsl_section_enabled=true;}}
   state.globalEditDirty=true;await syncGlobalEditState();
   if(local&&active){setGradeMode('local');await assignToolToPending('hue_range');
    Object.assign(selectedMaskLeaf(),{hue_center:109,hue_width:24,hue_smoothness:41,saturation_floor:.04,edge:3,edge_feather:6,edge_detail:75});
    selectedLocal().sdr_grade.exposure=1.05;selectedLocal().hdr_grade.exposure=1.05;
    if(!await commitSelectedLocal({maskContent:true}))throw Error('Local mask commit failed');setGradeMode('global');}
   state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
  },{local,active});
  await configure(false);const off=await deliver('neutral');
  await configure(true);const on=await deliver(local?'local':'global');
  for(const lane of ['hdr','sdr']){
   assert.ok(on[lane].mean<=off[lane].mean+.15&&on[lane].p99<=off[lane].p99+.5,
    `${lane}: HSL adds a GPU/CPU difference ${JSON.stringify({off:off[lane],on:on[lane]})}`);
  }
  assert.deepEqual(errors,[]);console.log('PASS');
 }finally{await api('/api/delivery/preferences',{force_cpu:false}).catch(()=>{});await browser.close();if(keep)console.log('kept',root);else fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
