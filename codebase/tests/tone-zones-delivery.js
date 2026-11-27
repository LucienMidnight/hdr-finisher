// Real app/device: five-control frozen-guide Tone in GPU
// preview and finished GPU/CPU delivery, Proof equality and the HDR ceiling.
// Also exercise headroom through contrast, colour wheels and Film Look (W3).
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const modeIndex=process.argv.indexOf('--highlight-mode');
const highlightMode=modeIndex<0?'peak_fit':process.argv[modeIndex+1];
assert.ok(['peak_fit','soft_ceiling','clip','fixed_cap'].includes(highlightMode));
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
 if(process.argv.includes('--layout')){
  const review=path.resolve(__dirname,'../output/n2-validation');fs.mkdirSync(review,{recursive:true});
  for(const [width,height] of [[1408,794],[1100,720]]){
   await browser.newPage({viewport:{width,height}});
   for(const lane of ['hdr','sdr']){
    await page.evaluate(async lane=>{await switchLane(lane);const group=document.querySelector(`[data-group="${lane}-tone"]`);if(group.classList.contains('collapsed'))group.querySelector('.group-toggle').click();},lane);
    const controls=await page.evaluate(lane=>Array.from(document.querySelectorAll(`[data-group="${lane}-tone"] input[data-path]`)).map(input=>({path:input.dataset.path,inside:input.closest('[data-group]').dataset.group})),lane);
    assert.deepEqual(controls.filter(control=>['blacks','shadows','midtones','highlights','whites'].includes(control.path.split('.')[1])).map(control=>control.path),['blacks','shadows','midtones','highlights','whites'].map(name=>`${lane}.${name}`));
    assert.ok(controls.every(control=>control.inside===`${lane}-tone`));
    for(const endpoint of ['blacks','whites']){
     const control=page.locator(`[data-path="${lane}.${endpoint}"]`);await control.scrollIntoViewIfNeeded();
     const box=await control.boundingBox();assert.ok(box&&box.width>0&&box.x>=0&&box.x+box.width<=width);
     await page.screenshot({path:path.join(review,`tone-${lane}-${width}x${height}-${endpoint}.png`)});
    }
   }
  }
  await browser.newPage({viewport:{width:1408,height:794}});
 }
 await page.evaluate(async (highlightMode)=>{
   await syncGlobalEditState();
   for(const lane of ['hdr','sdr']){
    Object.assign(state.adjustments[lane],{blacks:30,whites:65,shadows:70,midtones:-40,highlights:40,shadows_width:3.5,contrast:.2});
    Object.assign(state.adjustments[lane].color_grading,{balance:35,blending:80,shadows:{hue:210,saturation:15,luminance_ev:.1},highlights:{hue:120,saturation:20,luminance_ev:.2}});
    Object.assign(state.adjustments[lane].film_look,{film_stock:"none",print_exposure:.5,look_strength:50,grain_enabled:false,halation_enabled:false});
   }
   state.adjustments.sdr.output_exposure = .65;
   for(const lane of ['hdr','sdr']){
    const b=state.adjustments[lane];b.highlight_section_enabled=true;b.highlight_compression_mode=highlightMode;b.highlight_compression_softness=60;
    if(lane==='hdr'){b.highlight_compression_target_nits=1000;b.highlight_compression_start_nits=400;}
   }
   state.globalEditDirty=true;await syncGlobalEditState();
   for(const lane of ['hdr','sdr']){await switchLane(lane);invalidatePreview(lane);await settlePreview(lane,{});state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);if(!await renderGpuDraft(lane,{longEdge:256}))throw Error('GPU preview failed: '+JSON.stringify({refusal:state.lastGpuDraftRefusal,detail:state.gpuPreview.detail}));}
   state.previewScheduler?.cancel();while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
 },highlightMode);
  let delivery;
  const deliveryDeadline=Date.now()+20000;
  while(!(delivery=page.context().pages().find(p=>p.url().includes('gpu-delivery.html'))) && Date.now()<deliveryDeadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(delivery,'Hidden GPU delivery renderer');
  await delivery.waitForFunction(()=>typeof HDRGpuDeliveryFinishing==='function');
  await delivery.evaluate(()=>{
    window.__finished=[];const read=HDRGpuDeliveryFinishing.prototype.read;
    HDRGpuDeliveryFinishing.prototype.read=async function(texture,sendRows){
      if(!sendRows){
        const pixels=await read.call(this,texture);window.__finished.push(Array.from(pixels));return pixels;
      }
      const finished=new Float32Array(texture.width*texture.height*4);
      await read.call(this,texture,async (row,rows,pixels)=>{
        finished.set(pixels,row*texture.width*4);
        await sendRows(row,rows,pixels);
      });
      window.__finished.push(Array.from(finished));
    };
  });
  fs.writeFileSync(path.join(root,'document.json'),JSON.stringify(await page.evaluate(()=>state.editDocument)));
  for(const forced of [false,true]){
   await api('/api/delivery/preferences',{force_cpu:forced});const file=path.join(root,forced?'cpu.jpg':'gpu.jpg');
   await global.HDRFinisherElectronTestHarness.selectExportPath(file);
   const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'tone-zones.jpg'}));
   const settings={format:'jpeg_ultrahdr',quality:95,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:95,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'long_edge',long_edge:128,sharpening:'standard'}};
   const exported=await api(`/api/session/${session.session_id}/export`,{...settings,output_path:file,path_grant:grant.grant});assert.ok(exported.accepted);assert.equal(exported.renderer,forced?'cpu':'gpu');
   for(const full_size of [false,true]){
    const proof=await api(`/api/session/${session.session_id}/proof/artifact`,{...settings,full_size});assert.equal(proof.renderer,exported.renderer);
    const bytes=await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.jpg`,base).href);assert.ok(bytes.ok());assert.ok(fs.readFileSync(file).equals(await bytes.body()),`${full_size?'Full-size':'Reduced'} Proof equals delivered bytes`);
   }
  }
  const floats=await delivery.evaluate(()=>window.__finished.slice(0,2));
  fs.writeFileSync(path.join(root,'finished.json'),JSON.stringify(floats));
  console.log(run(`import json,sys,numpy as np
from pathlib import Path
from hdr_finisher.models import EditDocument,PreviewKind,OutputFinishingSettings
from hdr_finisher.loader import load_image
from hdr_finisher.adjustments import apply_adjustments,apply_hdr_output_highlight_compression,apply_sdr_output_highlight_compression
from hdr_finisher.finishing import apply_output_finishing
from hdr_finisher.delivery_colour import compare_finished_pixels
root=Path(sys.argv[1]);doc=EditDocument.model_validate_json((root/'document.json').read_text())
source=load_image(root/'hues.tiff')[0];actual=json.loads((root/'finished.json').read_text())
for i,lane in enumerate(['hdr','sdr']):
 expected=apply_adjustments(source,doc.global_adjustments,PreviewKind(lane),local_adjustments=doc.local_adjustments,include_output_highlight_compression=False)
 expected=apply_output_finishing(expected,OutputFinishingSettings(resize_mode="long_edge",long_edge=128,sharpening="standard"),PreviewKind(lane))
 expected=(apply_hdr_output_highlight_compression if lane=="hdr" else apply_sdr_output_highlight_compression)(expected,doc.global_adjustments)
 gpu=np.array(actual[i],np.float32).reshape(*expected.shape[:2],4)[...,:3]
 result=compare_finished_pixels(gpu,expected,lane);print(lane,result)
 assert result.passed,(lane,result)
`,[root]));
  const result=JSON.parse(execFileSync(python,[path.join(__dirname,'helpers/gpu_delivery_fixture.py'),'compare',root],{env,encoding:'utf8'}));
  console.log('Finished tone zones delivery',JSON.stringify(result));assert.ok(result.hdr.passed&&result.sdr.passed,JSON.stringify(result));
  assert.deepEqual(errors,[]);console.log('Tone zones integration PASS');
 }finally{await api('/api/delivery/preferences',{force_cpu:false}).catch(()=>{});await browser.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
