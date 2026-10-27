// Real app/device, stage sampling, authoring and finished GPU/CPU delivery.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hsl-app-'));
const python=path.resolve(__dirname,'../.venv/Scripts/python.exe');
const env={...process.env,PYTHONPATH:path.resolve(__dirname,'../backend')};
const run=(script,args=[])=>execFileSync(python,['-c',script,...args],{env,encoding:'utf8'});
(async()=>{
 run(`import numpy as np,tifffile,sys,colorsys
from hdr_finisher.hsl import from_lab
h,w=96,192
rng=np.random.default_rng(9)
lab=np.zeros((h,w,3),np.float32);lab[...,0]=.6
angle=np.radians(109+rng.normal(0,12,(h,96)))
lab[:,:96,1]=.065*np.cos(angle);lab[:,:96,2]=.065*np.sin(angle)
lab[:,97,0]=1.5;lab[:,97,1]=.14*np.cos(np.radians(109));lab[:,97,2]=.14*np.sin(np.radians(109))
rgb=from_lab(lab).astype(np.float32)
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
 await page.evaluate(async baseline=>{
   await syncGlobalEditState();setGradeMode('local');await assignToolToPending('hue_range');
   if(selectedMaskLeaf().hue_center!==null)throw Error('New hue selection must be empty');
   const leaf=selectedMaskLeaf(),local=selectedLocal();
   await finishLuminanceSampleGesture({localId:local.id,points:[{x:.25,y:.5}]});
   if(selectedMaskLeaf().hue_center==null||localAdjustments().length!==1)throw Error('Hue sampling failed');
   const g=selectedLocal();Object.assign(selectedMaskLeaf(),{hue_center:109,hue_width:24,hue_smoothness:41,saturation_floor:.04});g.hdr_grade.exposure=baseline?0:1.05;g.sdr_grade.exposure=baseline?0:1.05;await commitSelectedLocal();
   for(const lane of ['hdr','sdr']){
    const b=state.adjustments[lane];b.highlight_section_enabled=lane==='hdr';b.highlight_compression_mode='peak_fit';
    if(lane==='hdr'){b.highlight_compression_target_nits=1000;b.highlight_compression_start_nits=400;}
   }
   state.globalEditDirty=true;await syncGlobalEditState();
   for(const lane of ['hdr','sdr']){await switchLane(lane);invalidatePreview(lane);await settlePreview(lane,{});state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);if(!await renderGpuDraft(lane,{longEdge:256}))throw Error('GPU preview failed: '+JSON.stringify({refusal:state.lastGpuDraftRefusal,detail:state.gpuPreview.detail}));}
   state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
 },process.argv.includes('--baseline'));
  const delivery=page.context().pages().find(p=>p.url().includes('gpu-delivery.html'));
  assert.ok(delivery,'Hidden GPU delivery renderer');
  await delivery.evaluate(()=>{
    window.__finished=[];const read=HDRGpuDeliveryFinishing.prototype.read;
    HDRGpuDeliveryFinishing.prototype.read=async function(texture){const pixels=await read.call(this,texture);window.__finished.push(Array.from(pixels));return pixels;};
  });
  fs.writeFileSync(path.join(root,'document.json'),JSON.stringify(await page.evaluate(()=>state.editDocument)));
  for(const forced of [false,true]){
   await api('/api/delivery/preferences',{force_cpu:forced});const file=path.join(root,forced?'cpu.avif':'gpu.avif');
   await global.HDRFinisherElectronTestHarness.selectExportPath(file);
   const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'avif',suggestedName:'hue.avif'}));
   const settings={format:'avif_gain_map',quality:100,avif_bit_depth:12,avif_chroma_subsampling:'444',avif_gain_map_chroma_subsampling:'444',avif_gain_map_quality:100,avif_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'long_edge',long_edge:192,sharpening:'off'}};
   const exported=await api(`/api/session/${session.session_id}/export`,{...settings,output_path:file,path_grant:grant.grant});assert.ok(exported.accepted);assert.equal(exported.renderer,forced?'cpu':'gpu');
   const proof=await api(`/api/session/${session.session_id}/proof/artifact`,{...settings,full_size:true});assert.equal(proof.renderer,exported.renderer);
   const bytes=await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.avif`,base).href);assert.ok(bytes.ok());assert.ok(fs.readFileSync(file).equals(await bytes.body()),'Proof equals delivered bytes');
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
  const result=JSON.parse(run(`import json,sys
from pathlib import Path
from hdr_finisher.loader import load_image
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
root=Path(sys.argv[1]);a=load_image(root/'gpu.avif');b=load_image(root/'cpu.avif')
result={}
for lane,index in [('hdr',0),('sdr',4)]:
 m=compare_finished_pixels(a[index],b[index],lane);result[lane]={'mean':m.mean,'p999':m.p999,'passed':m.passed}
result['peak_nits']=max(check_decoded_hdr_ceiling(root/(renderer+'.avif'),'avif_gain_map',1000) for renderer in ['gpu','cpu'])
print(json.dumps(result))`,[root]));
  fs.mkdirSync(path.resolve(__dirname,'../output/hue-mask-smooth'),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,'../output/hue-mask-smooth/gpu-delivery.json'),JSON.stringify(result,null,2));
  console.log('Finished hue mask delivery',JSON.stringify(result));
  assert.ok(result.hdr.passed&&result.sdr.passed,JSON.stringify(result));assert.ok(result.peak_nits<=1000);
  assert.deepEqual(errors,[]);console.log('Hue mask integration PASS');
 }finally{await api('/api/delivery/preferences',{force_cpu:false}).catch(()=>{});await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
