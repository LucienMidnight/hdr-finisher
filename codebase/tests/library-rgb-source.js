/* Compare live finished pixels with Grade's numerical renderer before any file codec. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-rgb-source',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const photographic='D:/Photos/Play_Raw/Zebras Crossing - thekman/darktable_exported/DSC_3931_01.jpg';
const jpeg=path.join(folder,'photo.jpg'),png=path.join(folder,'photo.png');
fs.copyFileSync(photographic,jpeg);
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',"from PIL import Image;import sys;Image.open(sys.argv[1]).save(sys.argv[2])",jpeg,png]);
let sources=[jpeg,png];const photos=[...sources];
if(process.argv.includes('--ultrahdr')){
 const hdr=path.join(folder,'ultrahdr.jpg');
 fs.copyFileSync("D:/Photos/Play_Raw/Hawai'ian Fire Dancers - Challenge the Darkside - LaurentFromSF/IMG_0790_finished.jpg",hdr);
 sources=process.argv.includes('--measure')?[hdr]:[];photos.splice(0,photos.length,hdr);
}
if(process.argv.includes('--codecs')){
 const cases=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/helpers/library_codec_samples.py'),folder],{cwd:root,encoding:'utf8'}));
 sources=cases.sources;photos.push(...cases.photos);
}
const isoRoute=process.argv.includes('--iso-blocked');
if(isoRoute){
 photos.length=0;sources=[];
 for(const [name,original] of [['reference.avif',path.join(root,'samples/hdr_reference.avif')],
   ['urbanscape.avif','D:/Photos/Play_Raw/HDR exercise on urbanscape/5M071612_finished.avif']]){
  const target=path.join(folder,name);fs.copyFileSync(original,target);photos.push(target);
 }
 const reversed=path.join(folder,'hdr-base.avif');
 execFileSync(path.join(root,'bin/avifgainmaputil.exe'),['swapbase',photos[0],reversed,'-q','100','--qgain-map','100','-s','10']);
 photos.push(reversed);
}
const edited=path.join(folder,isoRoute?'edited.avif':'edited.png');fs.copyFileSync(isoRoute?photos[1]:png,edited);photos.push(edited);
let editedTiff=null,layeredExr=null,bt709Tiff=null,whiteExr=null;
if(process.argv.includes('--precision')){
 editedTiff=path.join(folder,'edited-16bit.tif');photos.push(editedTiff);
 execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`import sys,numpy as np,tifffile
from PIL import Image,ImageCms
profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
a=np.asarray(Image.open(sys.argv[1])).astype(np.uint16)*257
tifffile.imwrite(sys.argv[2],a,photometric='rgb',extratags=[(34675,'B',len(profile),profile,False),(274,'H',1,6,False)])`,jpeg,editedTiff]);
 layeredExr=path.join(folder,'signed-layer.exr');photos.push(layeredExr);
 execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`import sys,numpy as np,OpenEXR,Imath
from PIL import Image
a=np.asarray(Image.open(sys.argv[1]).resize((192,128))).astype(np.float32)/255*4-.5
h=OpenEXR.Header(192,128);names=['Combined.R','Combined.G','Combined.B']
h['channels']={n:Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)) for n in names}
h['dataWindow']=Imath.Box2i(Imath.V2i(-10,3),Imath.V2i(181,130));h['colorInteropID']=b'lin_rec2020_scene'
f=OpenEXR.OutputFile(sys.argv[2],h);f.writePixels({n:a[...,i].tobytes() for i,n in enumerate(names)});f.close()`,jpeg,layeredExr]);
 bt709Tiff=path.join(folder,'bt709.tif');fs.copyFileSync(editedTiff,bt709Tiff);photos.push(bt709Tiff);
 whiteExr=path.join(folder,'white100.exr');fs.copyFileSync(layeredExr,whiteExr);photos.push(whiteExr);
}
for(const target of [edited,editedTiff,layeredExr,bt709Tiff,whiteExr].filter(Boolean))execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import sys,json
from pathlib import Path
sys.path.insert(0,'backend')
from hdr_finisher.sessions import SessionStore
from hdr_finisher.models import LocalAdjustment,SourceInterpretationOverride
p=Path(sys.argv[1])
override=SourceInterpretationOverride(transfer_function='BT.709') if p.stem=='bt709' else SourceInterpretationOverride(linear_reference='diffuse_white_1_0') if p.stem=='white100' else SourceInterpretationOverride()
session=SessionStore().prepare_session(p,owns_source_path=False,interpretation_override=override,hdr_reference_white_nits=100 if p.stem=='white100' else 203)
a=session.edit_document().model_dump(mode='json');b=json.loads(json.dumps(a))
b['global_adjustments']['hdr']['exposure']=.6
b['global_adjustments']['sdr']['exposure']=.3
b['global_adjustments']['shared']['geometry']['rotation']=90
local=LocalAdjustment();local.hdr_grade.exposure=.25;local.sdr_grade.exposure=.15
b['local_adjustments']=[local.model_dump(mode='json')]
b['denoise']['hdr']['enabled']=True
p.with_name(p.name+'.hdrf').write_text(json.dumps({'format':'HDR Finisher Photo','schema_version':1,'photo_id':'live-test','marks':{},'albums':[],'grade':b,'grade_default':a}),encoding='utf8')
`,target],{cwd:root});
const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
const cpuScene=process.argv.includes('--cpu-reference');
if(only){photos.splice(0,photos.length,...photos.filter(photo=>path.basename(photo)===only));sources=[];}
// Protocol chosen before comparisons: matched photographic source set,
// three cold-scene repeats per route, alternating order; OS cache uncontrolled.
const comparisons=[];
for(let repeat=0;repeat<3;repeat++)for(const source of sources)for(const mode of (repeat%2?['gpu','cpu']:['cpu','gpu'])){
 const format=path.extname(source).slice(1),file=path.join(folder,`${mode}-${repeat}.${format}`);
 fs.copyFileSync(source,file);comparisons.push({file,mode,repeat,format});
}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log(m.text());});await page.goto(process.env.HDR_FINISHER_URL);
 const result=await page.locator('#library-frame').evaluate(async(element,{photos,cpuScene,isoRoute})=>{
  const w=element.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),original=gpu.renderTo,rows=[];
  if(cpuScene)w.localStorage.setItem("library-gpu-raw","off");
  let captured;
  // Force one mid-preparation broker preemption. It must yield and retry,
  // retaining the decoded RGB source rather than asking for CPU development.
  const originalFetch=w.fetch.bind(w);let leases=0,yielded=false;const fallbackReasons=[];
  w.fetch=async(url,options)=>{
   const response=await originalFetch(url,options);
   if(isoRoute&&response.status===204&&String(url).includes('/api/library/live-scene'))fallbackReasons.push(response.headers.get('X-Library-Fallback'));
   if(String(url).includes('/api/delivery/gpu/raw-budget/')&&options?.method==='POST'&&!JSON.parse(options.body).release&&++leases===15){
    yielded=true;const value=await response.json();return new w.Response(JSON.stringify({...value,preempt:true}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   return response;
  };
  gpu.renderTo=async function(canvas,...args){const result=await original.call(this,canvas,...args);captured=await this.analyzeScope(canvas,{width:args[9].width,height:args[9].height,tier:'picture',raw:true});return result;};
  const location=(await(await w.fetch('/api/library/cache-settings')).json()).location;
  for(const photo of photos){
   const begun=performance.now();
   const [meta,large]=await Promise.all([w.HDRLibraryScenes.load(photo,640),w.HDRLibraryScenes.load(photo,2560)]),lanes={};
   if(cpuScene||isoRoute ? meta.renderer!=='cpu' : (meta.renderer!=='gpu'||!meta.rgb_adapter||large.has_reference!==meta.has_reference)) throw Error('RGB GPU source/rendition not used: '+JSON.stringify(meta));
   const prepareMs=performance.now()-begun;
   const native=await w.HDRLibraryScenes.load(photo,100000);
   const again=await w.HDRLibraryScenes.load(photo,100000);
   if(native.source_key!==again.source_key||!again.cache_hit)throw Error('Native scene did not reuse');
   if(meta.gpu_memory_peak_bytes>meta.source_width*meta.source_height*44+64*1024*1024)throw Error('Memory reservation exceeded');
   for(const lane of ['hdr','sdr']){
    const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
    await w.HDRLibraryPictures.show(meta,canvas,new w.AbortController().signal,()=>true,lane==='hdr');
    if(!captured)throw Error('No live pixel capture');
    const bytes=new Uint8Array(captured.halves.buffer);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    lanes[lane]=w.btoa(binary);canvas.remove();
   }
   rows.push({photo,meta,large,native,prepareMs,lanes});
  }
  gpu.renderTo=original;w.fetch=originalFetch;if(!yielded&&!cpuScene&&!isoRoute)throw Error("Preemption was not exercised");
  if(isoRoute&&(!fallbackReasons.length||fallbackReasons.some(reason=>!reason?.includes("Gain-map AVIF"))))throw Error("ISO fallback reason missing: "+JSON.stringify(fallbackReasons));
  return {location,rows,yielded,fallbackReasons};
 },{photos,cpuScene,isoRoute});
 if(isoRoute)console.log("ISO preparation retained explicit CPU fallback; GPU finished drawing is not GPU reconstruction.");
 if(!cpuScene&&!isoRoute)console.log("RGB source preemption yielded and resumed without CPU fallback.");
 const timing=await page.locator('#library-frame').evaluate(async(element,cases)=>{
  const w=element.contentWindow,rows=[];
  for(const item of cases){
   if(item.mode==='cpu')w.localStorage.setItem('library-gpu-raw','off');else w.localStorage.removeItem('library-gpu-raw');
   const started=performance.now();
   const [small,large]=await Promise.all([w.HDRLibraryScenes.load(item.file,640),w.HDRLibraryScenes.load(item.file,2560)]);
   const elapsed=performance.now()-started;
   if(small.renderer!==item.mode||large.renderer!==item.mode)throw Error('Wrong measured route');
   const again=await w.HDRLibraryScenes.load(item.file,640);
   if(!again.cache_hit||again.source_key!==small.source_key)throw Error('Cached reopen redeveloped');
   rows.push({...item,ms:elapsed,stages:small.source_timings_ms});
  }
  w.localStorage.removeItem('library-gpu-raw');return rows;
 },comparisons);
 fs.writeFileSync(path.join(folder,'timing.json'),JSON.stringify(timing,null,2));
 for(const format of sources.map(source=>path.extname(source).slice(1))){
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const cpu=median(timing.filter(r=>r.format===format&&r.mode==='cpu').map(r=>r.ms));
  const gpu=median(timing.filter(r=>r.format===format&&r.mode==='gpu').map(r=>r.ms));
  console.log(JSON.stringify({format,cpuMedianMs:cpu,gpuMedianMs:gpu,improvementPercent:(cpu-gpu)/cpu*100}));
 }
 const file=path.join(folder,'pixels.json');fs.writeFileSync(file,JSON.stringify(result));
 const output=execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/helpers/library_rgb_compare.py'),file],{cwd:root,encoding:'utf8',maxBuffer:1<<24});
 const report=JSON.parse(output.trim().split('\n').at(-1));console.log(JSON.stringify(report));
 for(const row of report)for(const check of row.checks)assert.ok(check.passed,JSON.stringify({photo:row.photo,...check}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
