/* One real-photo disposable profile, prepare then restart; no quality study. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/stored-screen-profile');
const phase=process.env.HDR_FINISHER_STORED_PHASE||'prepare';
fs.mkdirSync(folder,{recursive:true});
const photo=path.join(folder,'DSC07202.ARW');
if(phase==='prepare'){
 fs.copyFileSync('D:/Photos/2026/20261017 badminton/DSC07202.ARW',photo);
 fs.copyFileSync('D:/Photos/2026/20261017 badminton/DSC07202.ARW.hdrf',photo+'.hdrf');
 // Only the disposable sidecar changes. Ensure a near-target compression case.
 const sidecar=JSON.parse(fs.readFileSync(photo+'.hdrf','utf8'));
 sidecar.grade.global_adjustments.hdr.highlight_section_enabled=true;
 sidecar.grade.global_adjustments.hdr.highlight_compression_mode='clip';
 sidecar.grade.global_adjustments.hdr.exposure=8;
 sidecar.grade.global_adjustments.hdr.film_look_section_enabled=false;
 fs.writeFileSync(photo+'.hdrf',JSON.stringify(sidecar));
 const disposable=path.join(folder,'test-profile/Cache/stored-screen-previews');
 if(fs.existsSync(disposable))for(const name of fs.readdirSync(disposable))if(name.endsWith('.json'))fs.unlinkSync(path.join(disposable,name));
}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
 page.on('console',msg=>{if(msg.text().includes('Stored screen'))console.log(msg.text());});
 const result=await page.locator('#library-frame').evaluate(async(el,{photo,phase})=>{
  const w=el.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),signal=new w.AbortController().signal;
  const next=()=>new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)));
  const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
  let baseline_ms,stored_ms,stored_next_ms;
  if(phase==='prepare'){
   const previews=w.HDRLibraryScreenPreviews;if(!previews)throw Error('Stored screen preview script not loaded');
   w.HDRLibraryScreenPreviews={...previews,capture:()=>{}};
   let meta=await w.HDRLibraryScenes.load(photo,2560,signal,0);meta.fullscreen=true;
   await w.HDRLibraryPictures.show(meta,canvas,signal,()=>true,false);
   await w.HDRLibraryScenes.save(meta,true);await new Promise(r=>setTimeout(r,200));
   const started=performance.now();
   meta=await w.HDRLibraryScenes.load(photo,2560,signal,0);meta.fullscreen=true;
   await w.HDRLibraryPictures.show(meta,canvas,signal,()=>true,false);await next();
   baseline_ms=performance.now()-started;
   w.HDRLibraryScreenPreviews=previews;
   // Preparation is outside the comparison with today's route.
   await w.HDRLibraryPictures.show(meta,canvas,signal,()=>true,false);
   // Same real photo, separately finished HDR rendition, compression on near target.
   await w.HDRLibraryPictures.show(meta,canvas,signal,()=>true,true);
  }else{
   // Restart has no ready window. Any accidental scene dependency must fail.
   w.HDRLibraryScenes={...w.HDRLibraryScenes,load:()=>{throw Error('Stored screen preview requested a scene');}};
   const started=performance.now();
   const meta=await w.HDRLibraryScreenPreviews.load({path:photo},canvas,signal,()=>true,false);
   if(!meta)throw Error('No stored screen preview after restart');await next();
   stored_ms=performance.now()-started;
   const nextStarted=performance.now();
   if(!await w.HDRLibraryScreenPreviews.load({path:photo},canvas,signal,()=>true,false))throw Error('Second stored screen preview missed');
   await next();stored_next_ms=performance.now()-nextStarted;
   const hdr=await w.HDRLibraryScreenPreviews.load({path:photo},canvas,signal,()=>true,true);
   if(!hdr)throw Error('No stored HDR screen preview after restart');
  }
  const settings=await(await w.fetch('/api/library/cache-settings')).json();
  return {phase,baseline_ms,stored_ms,stored_next_ms,location:settings.location,capture:w.HDRLibraryScreenPreviews.snapshot()};
 },{photo,phase});
 if(phase==='prepare'){
  console.log(JSON.stringify(result));
  const directory=path.join(result.location,'stored-screen-previews');
  const deadline=Date.now()+60000;
  while(Date.now()<deadline&&(!fs.existsSync(directory)||fs.readdirSync(directory).filter(x=>x.endsWith('.json')).length<2))await page.waitForTimeout(100);
  if(!fs.existsSync(directory))throw Error('No stored screen previews: '+JSON.stringify(await page.locator('#library-frame').evaluate(el=>el.contentWindow.HDRLibraryScreenPreviews.snapshot())));
  assert.equal(fs.readdirSync(directory).filter(x=>x.endsWith('.json')).length,2,'Both renditions stored');
  const check=execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import sys,json
from pathlib import Path
import numpy as np
sys.path.insert(0,'backend')
from hdr_finisher.library_screen_previews import StoredScreenPreviews
from colour.models import eotf_ST2084
directory=Path(sys.argv[1]);info=next(json.loads(p.read_text()) for p in directory.glob('*.json') if json.loads(p.read_text())['identity']['lane']=='hdr')
cache=StoredScreenPreviews(Path(sys.argv[2]));cache.directory if False else None
# Direct the disposable cache at the actual profile location.
cache.cache.preferences=lambda:{'location':str(directory.parent),'enabled':True}
_,body=cache.read(info['identity'])
a=np.frombuffer(body,dtype='<u2').reshape(info['height'],info['width'],4)[...,:3]
peak=float(np.max(eotf_ST2084(a.astype(np.float32)/65535)))
assert 900 < peak <= 1000,peak
print(json.dumps({'decoded_peak_nits':peak,'target_nits':1000}))
`,directory,folder],{cwd:root,encoding:'utf8',maxBuffer:1<<20});
  result.ceiling=JSON.parse(check.trim().split('\n').at(-1));
 }
 fs.writeFileSync(path.join(folder,phase+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
