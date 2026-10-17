const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','library-thumbnail-colour');fs.mkdirSync(out,{recursive:true});
const fixture=path.join(out,'source.jpg'),python=path.join(root,'.venv','Scripts','python.exe');
execFileSync(python,['-c',`import sys;sys.path.insert(0,'backend')
import numpy as np
from pathlib import Path
from hdr_finisher.library_thumbnail_codec import encode
from hdr_finisher.color import linear_srgb_to_acescg
y,x=np.mgrid[0:128,0:360].astype(np.float32);x/=359;y/=127
sdr=np.stack((.02+.85*x,.03+.7*y,.04+.6*(1-x)*y),axis=-1)
rgb=sdr*3;rgb[:20,:40]=1;rgb[:20,40:80]=1000/203
Path(sys.argv[1]).write_bytes(encode(linear_srgb_to_acescg(rgb*.18),sdr))`,fixture],{cwd:root});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
 const frame=page.frame({url:/\/library(?:\?|$)/});await frame.waitForFunction(()=>window.HDRLibraryPictures);
 const source=fixture;
 const data=await frame.evaluate(async source=>{
  const post=async(route,body)=>{const r=await fetch('/api/library/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
  const meta=await post('picture',{path:source,edge:360,quality:'quick'});
  let thumbnail;for(let i=0;i<600;i++){const r=await post('thumbnails',{paths:[source],edge:360});if(r.errors.length)throw Error(JSON.stringify(r.errors));if(r.ready.length){thumbnail=r.ready[0];break;}await new Promise(r=>setTimeout(r,50));}
  const body=await (await fetch(thumbnail.url)).arrayBuffer();const base64=btoa(String.fromCharCode(...new Uint8Array(body)));
  const gpu=await HDRLibraryPictures.initialize(),results=[];
  for(const hdr of [true,false]) {
   const canvas=document.createElement('canvas');canvas.width=meta.width;canvas.height=meta.height;let texture,format;
   const context={configure(options){format=options.format;texture?.destroy();texture=gpu.device.createTexture({size:[canvas.width,canvas.height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});},getCurrentTexture(){return texture;}};
   canvas.getContext=()=>context;
   await HDRLibraryPictures.show(meta,canvas,new AbortController().signal,()=>true,hdr);
   const target=gpu.presentationTarget;gpu.presentationTarget={texture,format,width:meta.width,height:meta.height,valid:true};
   const read=await gpu.readPresentationRegion(meta.width,meta.height);gpu.presentationTarget=target;
   const params=gpu.scopeSources.get(canvas)?.params;const P=HDRGpuParamLayout.indices;results.push({hdr,format,parameters:params?Object.fromEntries(Object.keys(P).map(k=>[k,params[P[k]]])):null,...read});texture.destroy();
  }
  return {base64,results,meta};
 },source);
 await frame.evaluate(data=>{const img=new Image();img.id='thumbnail-colour-probe';img.src='data:image/jpeg;base64,'+data.base64;img.style.cssText='position:fixed;left:20px;top:20px;width:360px;height:128px;z-index:999999;dynamic-range-limit:no-limit';document.body.append(img);return img.decode();},data);
 const image=frame.locator('#thumbnail-colour-probe');await page.waitForTimeout(150);const hdrImage=await image.screenshot();
 await image.evaluate(img=>img.style.dynamicRangeLimit='standard');await page.waitForTimeout(150);const sdrImage=await image.screenshot();
 require('node:assert/strict').notDeepEqual(hdrImage,sdrImage,'Native thumbnail must consume its gain map on the HDR display');
 await image.evaluate(img=>img.remove());
 const result=path.join(out,'gpu-look.json');fs.writeFileSync(result,JSON.stringify(data));
 execFileSync(python,[path.join(__dirname,'helpers','library_thumbnail_colour.py'),result],{cwd:root,stdio:'inherit'});
 await page.evaluate(()=>HDRApplicationShell.openSettings());await page.locator('[data-settings-tab=performance]').click();
 await page.waitForFunction(()=>document.getElementById('library-cache-full_size-limit').value==='10');
 for(const [name,value] of [['thumbnail',5],['full_size',20],['saved_grade',1]]) {
  await page.locator('#library-cache-'+name+'-limit').selectOption(String(value));
  await page.waitForFunction(async ({name,value})=>{const r=await fetch('/api/library/cache-settings');return (await r.json())[name+'_limit_gb']===value;},{name,value});
 }
 await page.locator('#library-cache-enabled').uncheck();
 await page.waitForFunction(()=>document.getElementById('library-cache-state').textContent==='Disabled');
 console.log('PASS: GPU look, independent Settings controls, and Disabled switch.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
