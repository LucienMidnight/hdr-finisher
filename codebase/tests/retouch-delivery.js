/* Real GPU repair publication, Proof/export identity and explicit CPU fallback. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const folder=path.resolve('output/retouch-delivery');fs.mkdirSync(folder,{recursive:true});
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),base=process.env.HDR_FINISHER_URL;
  const api=async(route,data)=>{const r=await page.request.post(new URL(route,base).href,{data,timeout:240000});assert(r.ok(),await r.text());return r.json();};
  await page.goto(base,{waitUntil:'networkidle'});
  const photo=path.join(folder,'fixture.png');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=256;c.height=192;const g=c.getContext('2d');const p=g.createLinearGradient(0,0,256,192);p.addColorStop(0,'#91b6d4');p.addColorStop(1,'#d6cbb4');g.fillStyle=p;g.fillRect(0,0,256,192);g.fillStyle='#888';g.fillRect(126,94,4,4);return c.toDataURL().split(',')[1];});fs.writeFileSync(photo,Buffer.from(png,'base64'));
  await page.evaluate(async photo=>{await openDesktopSelection({kind:'source',...await desktop.grantSourcePath(photo)});},photo);
  await page.waitForFunction(()=>state.session&&!state.importInProgress&&viewerState().status==='ready');
  const id=await page.evaluate(()=>state.session.session_id),results=[];
  const settings={format:'jpeg_ultrahdr',quality:95,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:95,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'original',sharpening:'off'}};
  for(const forced of [false,true])for(const mode of ['inpaint','clone','heal']){
   await api('/api/delivery/preferences',{force_cpu:forced});
   const routes=await page.evaluate(async({mode,forced})=>{
    const w=state.session.source.width,h=state.session.source.height;
    const applied=await commitRetouch([{id:crypto.randomUUID(),name:'Delivery spot',enabled:true,recipe:{
     mode,method:'original-detail',source_size:[w,h],search_rect:[80,48,176,144],points:[{x:.5,y:.5}],
     source_point:mode==='inpaint'?null:{x:.25,y:.5},radius_px:6,settings:{seed:20261028+(forced?1:0)}
    }}]);if(!applied)throw Error(document.getElementById('retouch-status').textContent);renderRetouchControls();return state.session.repair_rendering;
   },{mode,forced});
   assert.equal(routes[0].renderer,forced?'cpu':'gpu');
   if(forced)assert.match(await page.evaluate(()=>status.get('retouch-route')?.message||''),/CPU fallback.*Delivery spot/);
   const file=path.join(folder,`${mode}-${forced?'cpu':'gpu'}.jpg`);fs.rmSync(file,{force:true});
   await global.HDRFinisherElectronTestHarness.selectExportPath(file);
   const grant=await page.evaluate(()=>hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'repair.jpg'}));
   const exported=await api(`/api/session/${id}/export`,{...settings,output_path:file,path_grant:grant.grant});
   const proof=await api(`/api/session/${id}/proof/artifact`,{...settings,full_size:true});
   assert(exported.accepted);assert.equal(proof.renderer,exported.renderer);
   const bytes=await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.jpg`,base).href);
   assert(fs.readFileSync(file).equals(await bytes.body()),'Full Proof equals exported file');
   for(const record of [exported,proof])if(forced)assert.match(record.fallback_reason,/Retouch CPU fallback.*Delivery spot/);
   // Reusing a CPU patch with GPU finishing must still disclose its repair route.
   if(forced){await api('/api/delivery/preferences',{force_cpu:false});
    const mixed=await api(`/api/session/${id}/proof/artifact`,{...settings,quality:94,full_size:true});
    assert.equal(mixed.renderer,'gpu');
    assert.match(mixed.fallback_reason,/Retouch CPU fallback/);
   }
   await api('/api/delivery/preferences',{force_cpu:forced});
   await page.waitForFunction(()=>HDRGradeSaving.ready());await page.evaluate(()=>HDRGradeSaving.save());
   const grantDirectory=await page.evaluate(photo=>desktop.defaultBatchExportDirectory(photo),photo);
   let batch=await api('/api/batch-export',{paths:[photo],directory:folder,path_grant:grantDirectory.grant,
    preset:{name:'Repair validation',versions:[{name:mode+(forced?'CPU':'GPU'),settings,pattern:'{version}'}]}});
   while(!['finished','failed','cancelled'].includes(batch.state)){
    await new Promise(r=>setTimeout(r,100));const r=await page.request.get(new URL('/api/batch-export/'+batch.id,base).href);batch=await r.json();
   }
   assert.equal(batch.results[0].renderer,forced?'cpu':'gpu',JSON.stringify(batch));
   if(forced)assert.match(batch.results[0].fallback_reason,/Retouch CPU fallback/);
   fs.rmSync(batch.results[0].output_path,{force:true});
   results.push({mode,forced,batch:batch.results,routes,renderer:exported.renderer,proofIdentical:true,fallback:exported.fallback_reason});
   fs.rmSync(file,{force:true});console.log(JSON.stringify(results.at(-1)));
  }
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();for(const name of ['fixture.png','fixture.png.hdrf'])fs.rmSync(path.join(folder,name),{force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
