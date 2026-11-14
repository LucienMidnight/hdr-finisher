const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');

(async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-finisher-test-p1a-files-'));
  const photo=path.join(folder,'photo.png');
  const original=fs.readFileSync(path.join(__dirname,'fixtures/library_photo.png'));
  fs.writeFileSync(photo,original);
  let browser;
  try {
    browser=await chromium.launch();
    const page=await browser.newPage();
    await page.goto(new URL('/library',process.env.HDR_FINISHER_URL).href);
    await page.waitForFunction(()=>window.HDRLibrary&&typeof HDRLibraryGPU==='function');
    assert.equal(await page.evaluate(()=>document.hidden),false,'A hidden window is not drawing-gap evidence');
    const setup=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.id='p1a-retained-picture';canvas.width=32;canvas.height=32;document.body.prepend(canvas);
      const gpu=new HDRLibraryGPU(canvas);
      gpu.requestPreviewDevice=options=>gpu.adapter.requestDevice(options);
      if(!await gpu.initialize())throw Error(gpu.detail);
      if(gpu.adapterInfo.fallback)throw Error('A hardware GPU is required');
      const context=canvas.getContext('webgpu');
      const surface=gpu.configureSurface(canvas,context,false);
      const encoder=gpu.device.createCommandEncoder();
      const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:.6,g:.2,b:.1,a:1},loadOp:'clear',storeOp:'store'}]});
      pass.end();gpu.device.queue.submit([encoder.finish()]);await gpu.device.queue.onSubmittedWorkDone();
      const create=gpu.device.createRenderPipelineAsync.bind(gpu.device);
      const state={gpu,format:surface.format,compiled:0,synchronous:0,finished:false};
      const gate=new Promise(resolve=>{state.release=resolve;});
      gpu.device.createRenderPipeline=()=>{state.synchronous++;throw Error('Duplicate synchronous compilation');};
      gpu.device.createRenderPipelineAsync=descriptor=>{state.compiled++;return create(descriptor).then(async pipeline=>{await gate;return pipeline;});};
      window.p1aPipeline=state;
      return {adapter:gpu.adapterInfo.description};
    });
    const canvas=page.locator('#p1a-retained-picture');
    const before=await canvas.screenshot();
    await page.evaluate(()=>{
      const state=window.p1aPipeline;
      state.background=state.gpu.prepareLibraryPipelines(state.format,['base']);
      state.foreground=state.gpu.prepareLibraryPipelines(state.format,['base']).then(()=>{state.finished=true;});
    });
    await page.waitForFunction(()=>window.p1aPipeline.compiled===1);
    const pending=await canvas.screenshot();
    assert.deepEqual(pending,before,'The accepted picture stays on screen during preparation');
    const prepared=await page.evaluate(async()=>{
      const state=window.p1aPipeline;
      if(state.finished)throw Error('The pending foreground draw did not wait');
      state.release();await Promise.all([state.background,state.foreground]);
      const pipeline=state.gpu.pipelineFor(state.format).base;
      const result={compiled:state.compiled,synchronous:state.synchronous,prepared:!!pipeline};
      clearInterval(state.gpu.deliveryActivityTimer);state.gpu.device.destroy();document.getElementById('p1a-retained-picture').remove();
      return result;
    });
    assert.deepEqual(prepared,{compiled:1,synchronous:0,prepared:true});
    const files=await page.evaluate(async photo=>{
      const result=[];
      for(const action of ['rename','move','delete']){
        const response=await fetch('/api/library/file-command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,paths:[photo],name:'renamed',destination:photo.replace(/[/\\][^/\\]+$/,'')})});
        result.push({action,status:response.status,body:await response.json()});
      }
      return result;
    },photo);
    for(const result of files){
      if(['win32','darwin'].includes(process.platform)){assert.equal(result.status,200);assert.equal(typeof result.body.token,'string','File commands are previews, never executed here');}
      else {assert.equal(result.status,400);assert.match(result.body.detail,/Windows and macOS only/);}
    }
    assert.deepEqual(fs.readFileSync(photo),original);
    assert.deepEqual(fs.readdirSync(folder),['photo.png']);
    console.log(JSON.stringify({pipeline:prepared,retainedPicture:true,adapter:setup.adapter,fileCommands:files}));
  } finally {
    if(browser)await browser.close();
    fs.rmSync(folder,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
