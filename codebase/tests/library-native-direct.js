/* GPU-first native transport: finished pixels, reuse, release and CPU fallback. */
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(root,'output/hdr-native-direct-'));
const rgb=path.join(folder,'authored.png'),cropped=path.join(folder,'cropped.png');
(async()=>{
 let browser;
 try{
  execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(),['-c',`
from PIL import Image
import numpy as np,sys
y,x=np.mgrid[:1800,:3200]
a=np.stack([(x%256),(y%256),((x+y)%256)],axis=2).astype('uint8')
Image.fromarray(a).save(sys.argv[1]);Image.fromarray(a).save(sys.argv[2])
sys.path.insert(0,'backend')
import json
from pathlib import Path
from hdr_finisher.sessions import SessionStore
p=Path(sys.argv[2]);session=SessionStore().prepare_session(p,owns_source_path=False)
a=session.edit_document().model_dump(mode='json');b=json.loads(json.dumps(a))
b['global_adjustments']['shared']['geometry']['crop']={'x':.13,'y':.07,'width':.7,'height':.8}
b['global_adjustments']['hdr']['exposure']=.3;b['global_adjustments']['sdr']['exposure']=-.2
p.with_name(p.name+'.hdrf').write_text(json.dumps({'format':'HDR Finisher Photo','schema_version':1,'photo_id':'native-crop','marks':{},'albums':[],'grade':b,'grade_default':a}),encoding='utf8')
`,rgb,cropped],{cwd:root});
  browser=await chromium.launch();
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
  const frame=page.locator('#library-frame'),rows=[];
  assert.ok(await frame.evaluate(async el=>{
   const w=el.contentWindow,{device}=await w.HDRLibraryGpuRaw.shared.gpu();
   const buffers=[0,1,1].map(value=>{const b=device.createBuffer({size:1024,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,new Float32Array(256).fill(value));return b;});
   const picture={planes:buffers.map(gpuBuffer=>({gpuBuffer,device,byteLength:1024}))};
   try{
    let rejected=false;try{await w.HDRLibraryGpuRaw.checkNativePlanes(picture);}catch(e){rejected=e.emptyChannel&&e.gpuMemory;}
    device.queue.writeBuffer(buffers[0],0,new Float32Array(256).fill(.18));
    await w.HDRLibraryGpuRaw.checkNativePlanes(picture);return rejected;
   }finally{buffers.forEach(b=>b.destroy());}
  }),'Empty RAW channel is rejected before first draw; valid channels pass');
  for(const photo of [rgb,cropped]){
   const result=await frame.evaluate(async(el,photo)=>{
    const w=el.contentWindow,signal=new AbortController().signal;
    const meta=await w.HDRLibraryScenes.load(photo,100000,signal,0);
    if(!meta.directScene?.native)throw Error('Native direct route not selected');
    const gpu=await w.HDRLibraryPictures.initialize(),render=gpu.renderTo,requests=[];
    const originalFetch=w.fetch;w.fetch=(url,...args)=>{requests.push(String(url));return originalFetch.call(w,url,...args);};
    let pixels;
    gpu.renderTo=async function(canvas,...args){
     const result=await render.call(this,canvas,...args),r=args.at(-1)?.viewport;
     if(r&&result?.rendered){pixels=await this.readPresentationRegion(64,64,r.x+96,r.y+96);
      Object.assign(pixels,{format:this.presentationTarget.format,hdrSurface:this.surfaceKeys.get(canvas)?.includes(':extended:'),white:meta.white});}
     return result;
    };
    const draw=async(m,hdr,x=256)=>{
     const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
     try{await w.HDRLibraryPictures.show({...m,fullscreen:true,viewport:{x,y:256,width:512,height:384}},canvas,signal,()=>true,hdr);return pixels;}
     finally{canvas.getContext('webgpu')?.unconfigure();canvas.remove();}
    };
    try{
     const pairs=[];
     // A backend store deliberately held until after both first draws proves
     // that neither lane asks for backend scene pixels or waits on storage.
     const actualStore=meta.directScene.store;
     meta.directScene.store=()=>{throw Error('Store reached before first draw');};
     for(const hdr of [false,true])pairs.push({lane:hdr?'hdr':'sdr',direct:await draw(meta,hdr)});
     const firstRequests=[...requests];
     meta.directScene.store=actualStore;
     await actualStore();
     // Pan and return to the same scene without a development or a disk read.
     requests.length=0;await draw(meta,false,512);await draw(meta,false);
     const panRequests=[...requests];
     for(const pair of pairs)pair.backend=await draw({...meta,directScene:null},pair.lane==='hdr');
     const held=w.HDRLibraryGpuRaw.nativeBytes();
     if(photo.endsWith('cropped.png'))await w.HDRLibraryGpuRaw.reclaimDecoded(Infinity);
     else await originalFetch.call(w,'/api/delivery/gpu/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'native-handover-test',active:true,bytes:0,budget:gpu.memoryBudgetBytes()})});
     const deadline=performance.now()+2000;
     while(w.HDRLibraryGpuRaw.nativeBytes()&&performance.now()<deadline)await new Promise(r=>setTimeout(r,20));
     const released=w.HDRLibraryGpuRaw.nativeBytes();
     await originalFetch.call(w,'/api/delivery/gpu/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'native-handover-test',active:false,bytes:0,budget:gpu.memoryBudgetBytes()})});
     return {photo,pairs,firstRequests,panRequests,held,released};
    }finally{gpu.renderTo=render;w.fetch=originalFetch;w.HDRLibraryGpuRaw.releaseNative();}
   },photo);
   assert.ok(result.held>0);assert.equal(result.released,0,'Grade activity releases retained GPU planes');
   const pixelFetch=url=>/live-pixels|source-(tile|proxy|stream)|live-scene|live-developed|native-upload/.test(url);
   assert.deepEqual(result.firstRequests.filter(pixelFetch),[],'First draw does not upload, store or read backend pixels');
   assert.deepEqual(result.panRequests.filter(pixelFetch),[],'Pan and rezoom use only retained GPU planes');
   rows.push(result);
  }
  const cpuPhoto=path.join(folder,'cpu.png');fs.copyFileSync(rgb,cpuPhoto);
  const cpu=await frame.evaluate(async(el,photo)=>{
   const w=el.contentWindow,signal=new AbortController().signal;
   w.localStorage.setItem('library-gpu-raw','off');
   try{
    const meta=await w.HDRLibraryScenes.load(photo,100000,signal,0);
    if(meta.directScene)throw Error('CPU fallback retained a GPU development');
    const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
    try{await w.HDRLibraryPictures.show({...meta,fullscreen:true,viewport:{x:256,y:256,width:512,height:384}},canvas,signal,()=>true,false);return true;}
    finally{canvas.getContext('webgpu')?.unconfigure();canvas.remove();}
   }finally{w.localStorage.removeItem('library-gpu-raw');}
  },cpuPhoto);assert.ok(cpu,'CPU fallback displays native detail');
  const input=path.join(folder,'pixels.json');fs.writeFileSync(input,JSON.stringify(rows));
  const metrics=JSON.parse(execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(),['-c',`
import sys,json,numpy as np,colour
sys.path.insert(0,'backend')
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.color import acescg_to_linear_bt2020
rows=json.load(open(sys.argv[1]));out=[]
for row in rows:
 for pair in row['pairs']:
  def rgb(name):
   p=pair[name];v=np.array(p['values'],dtype=np.float32).reshape(p['height'],p['width'],4)[...,:3]
   if p['format'].startswith('bgra'):v=v[...,::-1]
   magnitude=np.abs(v);linear=np.sign(v)*np.where(magnitude<=.04045,magnitude/12.92,((magnitude+.055)/1.055)**2.4)
   if p['hdrSurface']:
    linear=colour.RGB_to_RGB(linear,colour.RGB_COLOURSPACES['Display P3'],colour.RGB_COLOURSPACES['ACEScg'],chromatic_adaptation_transform='Bradford')*.18*203/p['white']
   return linear
  first,second=rgb('direct'),rgb('backend')
  lane='hdr' if pair['direct']['hdrSurface'] else 'sdr'
  metric=compare_finished_pixels(first,second,lane)
  assert metric.passed,(row['photo'],pair['lane'],metric)
  if lane=='hdr':assert acescg_to_linear_bt2020(first).max()*pair['direct']['white']/.18<=1000.5
  out.append(dict(photo=row['photo'],lane=pair['lane'],mean=metric.mean,p999=metric.p999))
print(json.dumps(out))
`,input],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONWARNINGS:'ignore'}}));
  assert.deepEqual(errors,[]);console.log(JSON.stringify(metrics));
 }finally{try{await browser?.close();}finally{
  assert.equal(path.dirname(path.resolve(folder)),path.join(root,'output'));
  fs.rmSync(folder,{recursive:true,force:true});
 }}
})().catch(error=>{console.error(error);process.exitCode=1;});
