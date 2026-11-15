const assert=(condition,message)=>{if(!condition)throw Error(message);};
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {ensureLargeNoisySource}=require('./large-noisy-tiff.js');
(async()=>{
 const source=ensureLargeNoisySource(1500,1000),browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();page.on('response',async response=>{if(response.status()>=500)console.log('HTTP '+response.status()+' '+response.url()+' '+(await response.text()).slice(0,700));});await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#library-frame')?.contentWindow?.HDRLibraryPictures);
    await page.evaluate(()=>activateWorkflowTab('import'));
    const libraryReuse=await page.locator('#library-frame').evaluate(async(el,sourcePath)=>{
      const w=el.contentWindow,canvas=w.document.createElement('canvas');w.document.body.append(canvas);
      const meta=await w.HDRLibraryScenes.load(sourcePath,640,undefined,10,null,{develop:true});
      await meta.directScene?.store();
      const stored=await w.fetch('/api/library/live-store/'+meta.key,{method:'POST'});
      if(!stored.ok)throw Error('Test scene publication failed: '+stored.status);
      meta.denoise={hdr:{enabled:false},sdr:{enabled:true,controls:{amount:.5,luminance:.5,color_noise:.5}}};
      const gpu=await w.HDRLibraryPictures.initialize();
      const draw=async()=>{const start=w.performance.now();await w.HDRLibraryPictures.show(meta,canvas,new AbortController().signal,()=>true,false);return w.performance.now()-start;};
      const pixels=async()=>new Uint8Array((await gpu.analyzeScope(canvas,{width:canvas.width,height:canvas.height,tier:'picture',raw:'rgba',snapshot:true,transient:true})).body);
      try {
        gpu.reuseDenoiseSetup=false;
        const firstMs=await draw(),beforeRepeatMs=await draw();
        gpu.reuseDenoiseSetup=true;
        const selector=gpu.denoiseSourceSelector,scratch=selector.cache.adaptiveScratch;
        const before=await pixels(),repeatMs=await draw(),after=await pixels();
        const reused=gpu.denoiseSourceSelector===selector&&selector.cache.adaptiveScratch===scratch;
        const identical=before.length===after.length&&before.every((v,i)=>v===after[i]);
        gpu.resetSession(meta.key+'-finishing-control');
        meta.denoise.sdr.controls.amount=.9;const controlMs=await draw(),changed=await pixels();
        return {firstMs,beforeRepeatMs,repeatMs,controlMs,reused,identical,controlReused:gpu.denoiseSourceSelector===selector,
          controlChanged:changed.some((v,i)=>v!==after[i])};
      } finally {canvas.getContext('webgpu')?.unconfigure();canvas.width=canvas.height=0;canvas.remove();}
    },source);
    console.log('Library Denoise redraw: '+JSON.stringify(libraryReuse));
    assert(libraryReuse.reused&&libraryReuse.identical&&libraryReuse.controlReused&&libraryReuse.controlChanged,'Library setup reuse or control-only update failed');
  fs.mkdirSync('output/w2-denoise',{recursive:true});fs.writeFileSync('output/w2-denoise/library-redraw.json',JSON.stringify(libraryReuse,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
