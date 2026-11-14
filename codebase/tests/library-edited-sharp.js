const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/batch5a');fs.mkdirSync(out,{recursive:true});
// Run before on the baseline, after on the changed tree, restart with the same test profile.
const phase=process.env.HDR_BATCH5A_PHASE||'after';
const profile=process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
if(profile && !/[\\/]test-[^\\/]+$/.test(profile))throw Error('Use a disposable test- profile (also isolates the Library cache).');
const reusePhoto=require('./helpers/reuse-test-photo.cjs');
const photos=['DSC00264.ARW','DSC_3931.NEF','DSC04375_DxO_clipped_target.tif'].map(name=>reusePhoto(reusePhoto.source(name),path.join(out,name))).filter(p=>!process.env.HDR_BATCH5A_PHOTO || p.endsWith(process.env.HDR_BATCH5A_PHOTO));
(async()=>{const backups=new Map();let browser;try{
 const template=JSON.parse(fs.readFileSync(reusePhoto.source('DSC00264.ARW.hdrf'),'utf8'));
 for(const photo of photos.filter(p=>/\.(ARW|NEF)$/.test(p))){
  const sidecar=photo+'.hdrf',bytes=fs.existsSync(sidecar)?fs.readFileSync(sidecar):null;backups.set(sidecar,bytes);
  const document=bytes?JSON.parse(bytes):{...template,source:{filename:path.basename(photo)}};
  document.grade=structuredClone(template.grade);document.grade.global_adjustments.hdr.exposure=.7;
  document.grade.source={...document.grade.source,filename:path.basename(photo),durable_path:photo,byte_size:fs.statSync(photo).size,fingerprint_sha256:require('crypto').createHash('sha256').update(fs.readFileSync(photo)).digest('hex'),raw_import_settings:{}};
  fs.writeFileSync(sidecar,JSON.stringify(document));
 }
 browser=await chromium.launch();const page=await browser.newPage();page.on('console',m=>console.log(m.text()));await page.goto(process.env.HDR_FINISHER_URL);
const result=await page.locator('#library-frame').evaluate(async(el,{photos,phase})=>{
 const w=el.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),rows=[];
 let captured;let captureMs=0;const render=gpu.renderTo;gpu.renderTo=async function(canvas,...args){const result=await render.call(this,canvas,...args);const captureAt=performance.now();captured=await this.analyzeScope(canvas,{width:args[9].width,height:args[9].height,tier:'picture',raw:true,snapshot:true});captureMs+=performance.now()-captureAt;return result;};
 const original=w.HDRLibraryScreenPreviews.capture;w.HDRLibraryScreenPreviews={...w.HDRLibraryScreenPreviews,capture:phase==='before'?()=>{}:original};
 for(const photo of photos){if(phase!=='restart'){await (await w.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo.replace(/[\\/][^\\/]+$/,'')]})})).json();await (await w.fetch('/api/library/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo.replace(/[\\/][^\\/]+$/,'')})})).json();}const canvas=w.document.createElement('canvas');w.document.body.append(canvas);const signal=w.AbortSignal.timeout(20000);
 captured=null;captureMs=0;const start=performance.now();let meta=await w.HDRLibraryScreenPreviews.load({path:photo},canvas,signal,()=>true,true);const cache_ms=performance.now()-start;if(phase!=='restart')meta=null;
 if(!meta && phase==='restart')throw Error('Restart stored preview missed: '+photo);if(!meta){meta=await w.HDRLibraryScenes.load(photo,2560,signal,0);meta.fullscreen=true;await w.HDRLibraryPictures.show(meta,canvas,signal,()=>true,true);}
 await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));const present_ms=performance.now()-start-captureMs;
 const pixels=captured;if((!pixels || !pixels.halves.some(value=>value>0)) && phase!=='restart')throw Error('No finished pixels for '+photo);
 let binary='';const bytes=new Uint8Array(pixels?.halves.buffer||new ArrayBuffer(0));for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
 w.HDRLibraryScenes.save(meta,true);if(phase!=='before'){await new Promise(r=>setTimeout(r,4000));const againAt=performance.now();const again=await w.HDRLibraryScreenPreviews.load({path:photo},canvas,signal,()=>true,true);rows.reopen=performance.now()-againAt;if(!again)throw Error('Stored preview missed: '+photo);}
 rows.push({photo,cache_ms,present_ms,width:meta.width,height:meta.height,route:meta.route,reopen_ms:rows.reopen,pixels:w.btoa(binary)});canvas.remove();
 }
 return rows;
},{photos,phase});
if(process.env.HDR_BATCH5A_PIXELS!=='1')for(const row of result)delete row.pixels;
fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify(result));console.log(JSON.stringify(result.map(({pixels,...row})=>row)));
}finally{try{await browser?.close();}finally{for(const [file,bytes] of backups)if(bytes)fs.writeFileSync(file,bytes);else fs.unlinkSync(file);}}})().catch(e=>{console.error(e);process.exitCode=1;});
