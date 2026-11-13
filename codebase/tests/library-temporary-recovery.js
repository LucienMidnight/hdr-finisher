/* Test-only faults enter the actual upload timeout and edge-colour rejection. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),label=process.argv.includes('--baseline')?'baseline':'fixed';
const both=process.argv.includes('--both-invalid');
const output=path.join(root,'output/batch3g',both?'both-invalid':label);fs.mkdirSync(output,{recursive:true});
const photos=['DSC03819','DSC00264'].map(n=>path.join(root,'output/test-photos/library-mixed-v1-run',n+'.ARW'));
for(const photo of photos)assert.ok(fs.existsSync(photo),photo);
const {execFileSync}=require('node:child_process');
const recipe=JSON.parse(execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(),['-c',`import json,sys
from pathlib import Path
from hdr_finisher.models import EditDocument,SourceReference,SourceLuminanceDescriptor
from hdr_finisher.library_marks import LibraryMarks
p=Path(sys.argv[1])
d=EditDocument(hdr_reference_white_nits=203,source=SourceReference(filename=p.name,luminance=SourceLuminanceDescriptor(luminance_semantics="scene_relative",transfer_function="linear")))
d.source.raw_import_settings.highlight_reconstruction.method='edge_colour_v1'
print(json.dumps(dict(path=str(LibraryMarks._sidecar(p)),document=dict(format='HDR Finisher Photo',schema_version=1,photo_id='batch3f-test',grade=d.model_dump(mode='json')))))`,photos[1]],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'backend')},encoding:'utf8'}));
const originalRecipe=fs.existsSync(recipe.path)?fs.readFileSync(recipe.path):null;
fs.writeFileSync(recipe.path,JSON.stringify(recipe.document));
let cacheSettingsPath,originalCacheSettings;
const temporaryCache=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'hdr-recovery-cache-'));
(async()=>{let browser,request,cacheSettings;try{browser=await chromium.launch();
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
 request=page.request;
 const settingsResponse=await request.get(new URL('/api/library/cache-settings',page.url()).href);assert.ok(settingsResponse.ok());cacheSettings=await settingsResponse.json();
 // The Electron runner uses a fresh profile whose default cache is its Cache child.
 assert.equal(path.basename(cacheSettings.location),'Cache','Use a disposable default-cache profile');
 cacheSettingsPath=path.join(path.dirname(cacheSettings.location),'library-cache-settings.json');
 originalCacheSettings=fs.existsSync(cacheSettingsPath)?fs.readFileSync(cacheSettingsPath):null;
 const switched=await request.post(new URL('/api/library/cache-settings',page.url()).href,{data:{location:temporaryCache}});assert.ok(switched.ok(),'Temporary cache must be selected');
 await page.evaluate(()=>activateWorkflowTab('import'));
 const result=await page.locator('#library-frame').evaluate(async(el,{photos,both})=>{
  const w=el.contentWindow,events=[],results=[],originalLog=w.HDRLibraryStopwatch,upload=w.HDRLibraryUpload,edge=w.HDREdgeColour;
  w.HDRLibraryStopwatch=(stage,fields)=>{events.push({stage,...fields});originalLog(stage,fields);};
  const check=async(name,task)=>{try{results.push({name,passed:true,...await task()});}catch(error){results.push({name,passed:false,error:error.message});}};
  const show=async(meta)=>{
   const canvas=w.document.createElement('canvas');canvas.style.cssText='position:fixed;top:60px;right:20px;width:480px;height:320px;z-index:100';w.document.body.append(canvas);
   await w.HDRLibraryPictures.show(meta,canvas,new w.AbortController().signal,()=>true,false);
   if(!canvas.width||!canvas.height)throw Error('No picture on the canvas');
   return {width:canvas.width,height:canvas.height};
  };
  try{
   let timedOut=false;
   w.HDRLibraryUpload={...upload,send:async(url,options)=>{
    if(String(url)==='/api/library/live-developed'&&!timedOut){
     timedOut=true;
     // Exercise the real worker timer, rather than throwing a copied error.
     return upload.send(url,{...options,timeoutMs:0});
    }
    return upload.send(url,options);
   }};
   await check('save-timeout',async()=>{
    const value=await w.HDRLibraryScenes.load(photos[0],640,undefined,0,null,{develop:true});
    if(!timedOut)throw Error('Timeout injection was not reached');
    if(!events.some(e=>e.stage==='picture_preparation_retry'&&e.path===photos[0]))throw Error('No fresh preparation after timeout');
    return {key:value.key,shown:await show(value)};
   });
   w.HDRLibraryUpload=upload;
   let injected=0,scans=0;
   w.HDREdgeColour={...edge,reconstruct:args=>edge.reconstruct({...args,read:async(buffer,bytes)=>{
    const actual=await args.read(buffer,bytes);
    if(bytes===16&&++scans%2===0&&injected<(both?2:1)){injected++;const value=actual.slice(0);new Uint32Array(value)[1]=141;return value;}
    return actual;
   }})};
   await check('invalid-gpu-pixels',async()=>{
    const value=await w.HDRLibraryScenes.load(photos[1],640,undefined,0,null,{develop:true});
    if(!injected)throw Error('Output scan injection was not reached');
    const cpu=events.some(e=>e.stage==='picture_source_cpu_completed'&&e.path===photos[1]);
    // GPU failure rule (master PRD, November 6): a rejected GPU result takes
    // the CPU route at once, with no second GPU attempt.
    if(!cpu)throw Error('A rejected GPU result must take the CPU route');
    if(injected!==1||events.some(e=>e.stage==='picture_development_gpu_retry'&&e.path===photos[1]))throw Error('Rejected GPU result was retried on the GPU');
    return {key:value.key,shown:await show(value),scans};
   });
   w.HDREdgeColour=edge;
   const health=await (await w.fetch('/api/library/health')).json();
   return {results,events,errors:health.picture_errors,grants:w.HDRLibraryGrants.snapshot()};
  }finally{w.HDRLibraryUpload=upload;w.HDREdgeColour=edge;w.HDRLibraryStopwatch=originalLog;}
 },{photos,both});
 fs.writeFileSync(path.join(output,label+'-faults.json'),JSON.stringify(result,null,2));
 await page.screenshot({path:path.join(output,label+'-faults.png')});
 console.log(JSON.stringify({label,results:result.results}));
 assert.ok(result.results.every(r=>r.passed),'Every forced-fault scenario must recover');
 assert.equal(result.errors.filter(e=>!e.grade_warning).length,0,'No durable failure');
 assert.equal(result.grants.jobs.length,0,'No stranded grant');
}finally{try{if(cacheSettingsPath){if(originalCacheSettings)fs.writeFileSync(cacheSettingsPath,originalCacheSettings);else fs.rmSync(cacheSettingsPath,{force:true});}}finally{if(browser)await browser.close();// The backend holds its SQLite ledger until the Electron runner shuts down.
 process.once('exit',()=>fs.rmSync(temporaryCache,{recursive:true,force:true,maxRetries:10,retryDelay:100}));}if(originalRecipe)fs.writeFileSync(recipe.path,originalRecipe);else fs.rmSync(recipe.path,{force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
