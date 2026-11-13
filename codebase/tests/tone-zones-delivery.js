// Real app/device: Tone sliders (Blacks, Shadows, Midtones, Highlights) in GPU
// preview and finished GPU/CPU delivery, Proof equality and the HDR ceiling.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tone-zones-'));
const python=require('../tools/lib/platform.cjs').pythonExecutable();
const env={...process.env,PYTHONPATH:path.resolve(__dirname,'../backend')};
const run=(script,args=[])=>execFileSync(python,['-c',script,...args],{env,encoding:'utf8'});
(async()=>{
 run(`import numpy as np,tifffile,sys,colorsys
h,w=64,192
# Columns: hues; rows: -10 to +4 stops around middle grey; left band neutral.
rgb=np.array([colorsys.hsv_to_rgb(x/w,.4,1) for x in range(w)],np.float32)[None,:,:]*(0.18*np.exp2(np.linspace(-10,4,h,dtype=np.float32)))[:,None,None]
rgb[:,:8]=(0.18*np.exp2(np.linspace(-10,4,h,dtype=np.float32)))[:,None,None]
tifffile.imwrite(sys.argv[1],rgb,photometric='rgb')`,[path.join(root,'hues.tiff')]);
 const browser=await chromium.launch(),page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log(m.type(),m.text());});
 const base=process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765';
 const api=async(route,data)=>{const r=await page.request.post(new URL(route,base).href,{data,timeout:240000});assert.ok(r.ok(),await r.text());return r.json();};
 try{
 await page.goto(base);await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:20000});
 const uploaded=await page.request.post(new URL('/api/session',base).href,{multipart:{file:{name:'hues.tiff',mimeType:'image/tiff',buffer:fs.readFileSync(path.join(root,'hues.tiff'))}}});
 assert.ok(uploaded.ok(),await uploaded.text());const {session}=await uploaded.json();
 await page.evaluate(s=>activateDesktopSession(s,''),session);
 await page.evaluate(async ()=>{
   await syncGlobalEditState();
   for(const lane of ['hdr','sdr']){
    Object.assign(state.adjustments[lane],{blacks:30,shadows:70,midtones:-40,highlights:40,shadows_width:3.5});
   }
   for(const lane of ['hdr','sdr']){
    const b=state.adjustments[lane];b.highlight_section_enabled=lane==='hdr';b.highlight_compression_mode='peak_fit';
    if(lane==='hdr'){b.highlight_compression_target_nits=1000;b.highlight_compression_start_nits=400;}
   }
   state.globalEditDirty=true;await syncGlobalEditState();
   for(const lane of ['hdr','sdr']){await switchLane(lane);invalidatePreview(lane);await settlePreview(lane,{});state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);if(!await renderGpuDraft(lane,{longEdge:256}))throw Error('GPU preview failed: '+JSON.stringify({refusal:state.lastGpuDraftRefusal,detail:state.gpuPreview.detail}));}
   state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
 });
  const delivery=page.context().pages().find(p=>p.url().includes('gpu-delivery.html'));
  assert.ok(delivery,'Hidden GPU delivery renderer');
  await delivery.evaluate(()=>{
    window.__finished=[];const read=HDRGpuDeliveryFinishing.prototype.read;
    HDRGpuDeliveryFinishing.prototype.read=async function(texture){const pixels=await read.call(this,texture);window.__finished.push(Array.from(pixels));return pixels;};
  });
  fs.writeFileSync(path.join(root,'document.json'),JSON.stringify(await page.evaluate(()=>state.editDocument)));
  for(const forced of [false,true]){
   await api('/api/delivery/preferences',{force_cpu:forced});const file=path.join(root,forced?'cpu.jpg':'gpu.jpg');
   await global.HDRFinisherElectronTestHarness.selectExportPath(file);
   const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'tone-zones.jpg'}));
   const settings={format:'jpeg_ultrahdr',quality:95,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:95,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'long_edge',long_edge:192,sharpening:'off'}};
   const exported=await api(`/api/session/${session.session_id}/export`,{...settings,output_path:file,path_grant:grant.grant});assert.ok(exported.accepted);assert.equal(exported.renderer,forced?'cpu':'gpu');
   const proof=await api(`/api/session/${session.session_id}/proof/artifact`,{...settings,full_size:true});assert.equal(proof.renderer,exported.renderer);
   const bytes=await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.jpg`,base).href);assert.ok(bytes.ok());assert.ok(fs.readFileSync(file).equals(await bytes.body()),'Proof equals delivered bytes');
  }
  const floats=await delivery.evaluate(()=>window.__finished.slice(0,2));
  fs.writeFileSync(path.join(root,'finished.json'),JSON.stringify(floats));
  console.log(run(`import json,sys,numpy as np
from pathlib import Path
from hdr_finisher.models import EditDocument,PreviewKind
from hdr_finisher.loader import load_image
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.delivery_colour import compare_finished_pixels
root=Path(sys.argv[1]);doc=EditDocument.model_validate_json((root/'document.json').read_text())
source=load_image(root/'hues.tiff')[0];actual=json.loads((root/'finished.json').read_text())
for i,lane in enumerate(['hdr','sdr']):
 expected=apply_adjustments(source,doc.global_adjustments,PreviewKind(lane),local_adjustments=doc.local_adjustments)
 gpu=np.array(actual[i],np.float32).reshape(*expected.shape[:2],4)[...,:3]
 result=compare_finished_pixels(gpu,expected,lane);print(lane,result)
 assert result.passed,(lane,result)
`,[root]));
  const result=JSON.parse(execFileSync(python,[path.join(__dirname,'helpers/gpu_delivery_fixture.py'),'compare',root],{env,encoding:'utf8'}));
  console.log('Finished tone zones delivery',JSON.stringify(result));/* JPEG differences are accepted for v1; the float rendering verdict above is strict. */assert.ok(result.peak_nits<=1000);
  assert.deepEqual(errors,[]);console.log('Tone zones integration PASS');
 }finally{await api('/api/delivery/preferences',{force_cpu:false}).catch(()=>{});await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
