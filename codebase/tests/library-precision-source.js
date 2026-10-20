/* Compare live finished pixels with Grade's numerical renderer before any file codec. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-precision-source',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
// Matched protocol: the same real EXR and float TIFF, three fresh-scene
// repeats per route, alternating order, warm processes and uncontrolled OS cache.
const sources=[
 'D:/Photos/Play_Raw/Lakeland landscape in dry Summer/darktable_exported/A7R00619.exr',
 path.join(root,'local-test-media/inputs/linear-dng/lightroom-hdr/DJI_0072-Lightroom-reference.tif')
];
const photos=sources.map((source,i)=>{const file=path.join(folder,'photo'+i+path.extname(source));fs.copyFileSync(source,file);return file;});
const comparisons=[];
for(let repeat=0;repeat<3;repeat++)for(const source of sources)for(const mode of (repeat%2?['gpu','cpu']:['cpu','gpu'])){
 const format=path.extname(source).slice(1),file=path.join(folder,`${mode}-${repeat}.${format}`);
 fs.copyFileSync(source,file);comparisons.push({file,mode,repeat,format});
}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log(m.text());});await page.goto(process.env.HDR_FINISHER_URL);
 const result=await page.locator('#library-frame').evaluate(async(element,photos)=>{
  const w=element.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),original=gpu.renderTo,rows=[];
  let captured;
  // Force one mid-preparation broker preemption. It must yield and retry,
  // retaining the decoded RGB source rather than asking for CPU development.
  const originalFetch=w.fetch.bind(w);let leases=0,yielded=false;
  w.fetch=async(url,options)=>{
   const response=await originalFetch(url,options);
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
   if(meta.renderer!=='gpu'||!meta.rgb_adapter||large.has_reference) throw Error('RGB GPU source/rendition not used: '+JSON.stringify(meta));
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
  gpu.renderTo=original;w.fetch=originalFetch;if(!yielded)throw Error("Preemption was not exercised");return {location,rows,yielded};
 },photos);
 console.log("RGB source preemption yielded and resumed without CPU fallback.");
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
 for(const format of ['exr','tif']){
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
