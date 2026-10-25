/* Result coverage for the independent Library document and Grade renderer.
 * Only disposable RAW/sidecar copies are opened. Standard Grade proxy transport
 * reads the same scene, isolating finishing from RAW development differences.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async({page,folder})=>{
 const root=path.resolve(__dirname,'../..'),reports=[];
 const source=process.env.HDR_FINISHER_FILM_PHOTOS || 'D:/Photos/2026/20261017 badminton';
 const photos=['DSC07202','DSC07217','DSC07178'].map(name=>{
  const file=path.join(folder,name+'.ARW');
  for(const suffix of ['', '.hdrf'])fs.copyFileSync(path.join(source,name+'.ARW'+suffix),file+suffix);
  const grade=JSON.parse(fs.readFileSync(file+'.hdrf','utf8')).grade;
  for(const lane of ['sdr','hdr']){
   const branch=grade.global_adjustments[lane],film=branch.film_look;
   assert.notEqual(branch.film_look_section_enabled,false);
   assert.equal(film.film_stock,'kodak_portra_400');
   assert.equal(film.grain_amount,24);assert.equal(film.grain_size,30);
   assert.ok(film.halation_enabled!==false&&film.halation_amount>0);
  }
  return file;
 });
 for(const photo of photos)for(const edge of [640,2560])for(const lane of ['sdr','hdr']){
  console.log('Film Look pixels:',path.basename(photo),edge,lane);
  const row=await page.locator('#library-frame').evaluate(async(el,{photo,edge,lane})=>{
   const w=el.contentWindow,p=w.parent,meta=await w.HDRLibraryScenes.load(photo,edge),
    factory=w.HDRLibraryPictures,gpu=await factory.initialize();
   if(!p.__filmReference){
    const surface=p.document.createElement('canvas');
    const reference=new p.HDRWebGPUPreview(surface);
    if(!await reference.initialize())throw Error('Grade GPU unavailable');
    clearInterval(reference.deliveryActivityTimer);reference.deliveryActivityTimer=null;
    p.__filmReference=reference;
   }
   const reference=p.__filmReference;let canvas=w.document.createElement('canvas');const gradeCanvas=p.document.createElement('canvas');
   const encode=async(renderer,c)=>{
    const capture=await renderer.analyzeScope(c,{width:meta.width,height:meta.height,tier:'picture',raw:true});
    if(!capture?.halves)throw Error('No finished pixel readback');
    const bytes=new Uint8Array(capture.halves.buffer);let binary='';
    for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return w.btoa(binary);
   };
   // fullscreen prevents asynchronous scene publication interfering with timings.
   meta.fullscreen=true;
   const captureLibrary=async(factory,renderer,c)=>{
    // Library releases its scene in show's finally; read inside renderTo,
    // before resetSession clears the scope source (as the parent driver does).
    const render=renderer.renderTo;let pixels;
    renderer.renderTo=async function(target,...args){
     const result=await render.call(this,target,...args);
     if(result?.rendered||result?.execution==='direct')pixels=await encode(this,target);
     return result;
    };
    try{await factory.show(meta,c,new w.AbortController().signal,()=>true,lane==='hdr');}
    finally{renderer.renderTo=render;}
    if(!pixels)throw Error('Library did not render finished pixels');
    return pixels;
   };
   const actual=await captureLibrary(factory,gpu,canvas),adjustments=structuredClone(meta.adjustments);
   adjustments.hdr.highlight_compression_target_nits=1000;
   reference.resetSession(meta.key);
   const denoise=meta.denoise?.[lane];
   if(denoise?.enabled&&!await reference.analyzeDenoiseProxy(meta.key,lane,adjustments,edge,0,'source',denoise.controls))throw Error('Grade Denoise failed');
   const result=await reference.renderTo(gradeCanvas,meta.key,lane,adjustments,p.sampleCurvePoints,edge,meta.locals||[],0,null,meta.white,
    {width:meta.width,height:meta.height},{scopeAnalysis:true,isCurrent:()=>true});
   if(!result?.rendered&&result?.execution!=='direct')throw Error('Grade render refused: '+JSON.stringify(result));
   await reference.waitForSubmittedWork();
   const expected=await encode(reference,gradeCanvas);
   let quick;
   if(edge===640){
    const q=await w.HDRLibraryQuickPictures.initialize();
    canvas.remove();canvas=w.document.createElement('canvas');
    quick=await captureLibrary(w.HDRLibraryQuickPictures,q,canvas);
   }
   // Reproduce only the previous missing-module condition, keeping edits intact.
   // Warm both variants, then alternate three paired samples; exclude readback.
   const timing=[];
   if(edge===2560&&photo.includes('DSC07202')){
    const stocks=w.HDRFilmStocks;
    try{
     for(let repeat=-1;repeat<3;repeat++)for(const mode of (repeat%2?['fixed','previous']:['previous','fixed'])){
      w.HDRFilmStocks=mode==='fixed'?stocks:undefined;
      const started=performance.now();
      await factory.show(meta,canvas,new w.AbortController().signal,()=>true,lane==='hdr');
      if(repeat>=0)timing.push({mode,ms:performance.now()-started});
     }
    }finally{w.HDRFilmStocks=stocks;}
   }
   const response=await w.fetch('/api/library/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo})});
   const camera=await response.json();
   reference.resetSession(null);canvas.remove();gradeCanvas.remove();
   return {photo,edge,lane,width:meta.width,height:meta.height,actual,expected,quick,timing,camera:{route:camera.route,width:camera.width,height:camera.height}};
  },{photo,edge,lane});
  const file=path.join(folder,'film-pixels.json');fs.writeFileSync(file,JSON.stringify(row));
  const output=execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'library_film_compare.py'),file],{cwd:root,encoding:'utf8',maxBuffer:1<<20});
  const report=JSON.parse(output.trim().split('\n').at(-1));reports.push(report);console.log(JSON.stringify(report));
  assert.ok(report.checks.every(c=>c.passed),JSON.stringify(report));
  assert.equal(report.camera.route,'camera-preview-placeholder');
 }
 fs.writeFileSync(path.join(folder,'film-results.json'),JSON.stringify(reports,null,2));
};