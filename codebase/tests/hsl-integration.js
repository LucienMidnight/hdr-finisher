// Real app/device, stage sampling, authoring and finished GPU/CPU delivery.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hsl-app-'));
const python=path.resolve(__dirname,'../.venv/Scripts/python.exe');
const env={...process.env,PYTHONPATH:path.resolve(__dirname,'../backend')};
const run=(script,args=[])=>execFileSync(python,['-c',script,...args],{env,encoding:'utf8'});
(async()=>{
 run(`import numpy as np,tifffile,sys,colorsys
h,w=64,192
rgb=np.array([colorsys.hsv_to_rgb(x/w,.25,1) for x in range(w)],np.float32)[None,:,:]*np.exp2(np.linspace(-5,1,h,dtype=np.float32))[:,None,None]
tifffile.imwrite(sys.argv[1],rgb,photometric='rgb')`,[path.join(root,'hues.tiff')]);
 const browser=await chromium.launch(),page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page error:',e.stack);});
 page.on('console',m=>{if(m.type()==='error')console.error('Browser:',m.text());});
 const base=process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765';
 const api=async(route,data)=>{const r=await page.request.post(new URL(route,base).href,{data,timeout:240000});assert.ok(r.ok(),await r.text());return r.json();};
 try{
  await page.goto(base);await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:10000}).catch(async e=>{console.error(await page.evaluate(()=>({gpu:state.gpuPreview?.detail,ready:document.body.dataset.ready})));throw e;});
  console.log('App GPU initialized');
  const probe=await page.evaluate(async()=>{
   const renderer=state.gpuPreview,d=renderer.device,e=HDRHSL,n=192;renderer.ensureStorageBuffers(HDRGpuParamLayout.count*4,4);
   const settings=e.defaultSettings();settings.channels[1].recipe.hue=35;settings.channels[1].recipe.saturation=25;settings.channels[4].recipe.luminance=.4;
   const params=new Float32Array(HDRGpuParamLayout.count);e.pack(params,settings);
   const pixels=new Float32Array(n*4),expected=[];
   for(let i=0;i<n;i++){const h=i/n*2*Math.PI,rgb=e.fromLab([.65,.13*Math.cos(h),.13*Math.sin(h)]);pixels.set([...rgb,1],i*4);expected.push(...e.applyChannels(rgb,settings.channels));}
   const source=d.createTexture({size:[n,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   const target=d.createTexture({size:[n,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const dummy=renderer.createMaskTexture(1,1),buffer=d.createBuffer({size:params.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),read=d.createBuffer({size:n*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{
    const module=d.createShaderModule({code:HDRWebGPUShaders.SHADER_SOURCE+'\n@fragment fn hslProbe(input: VertexOut)->@location(0) vec4f { return vec4f(applyHsl(textureLoad(sourceTexture,vec2i(input.position.xy),0).rgb,false),1); }'});
    const pipeline=d.createRenderPipeline({layout:renderer.pipelineLayout,vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint:'hslProbe',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
    d.queue.writeTexture({texture:source},pixels,{bytesPerRow:n*16},[n,1]);d.queue.writeBuffer(buffer,0,params);
    const group=renderer.bindGraphResources(source.createView(),dummy.createView(),{buffer},dummy.createView());
    const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:n*16},[n,1]);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
    const actual=new Float32Array(read.getMappedRange()),diff=[];for(let i=0;i<n;i++){const a=e.toLab([...actual.slice(i*4,i*4+3)]),b=e.toLab(expected.slice(i*3,i*3+3));diff.push(Math.hypot(...a.map((v,c)=>v-b[c])));}read.unmap();diff.sort((a,b)=>a-b);
    // Neutral is the exact identity, independently of colour-space arithmetic.
    e.pack(params,e.defaultSettings());d.queue.writeBuffer(buffer,0,params);
    const neutralEncoder=d.createCommandEncoder(),neutralPass=neutralEncoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});neutralPass.setPipeline(pipeline);neutralPass.setBindGroup(0,group);neutralPass.draw(3);neutralPass.end();neutralEncoder.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:n*16},[n,1]);d.queue.submit([neutralEncoder.finish()]);await read.mapAsync(GPUMapMode.READ);const neutral=new Float32Array(read.getMappedRange()),exact=neutral.every((v,i)=>v===pixels[i]);read.unmap();
    return {mean:diff.reduce((a,b)=>a+b)/diff.length,p99:diff[Math.floor(n*.99)],neutralExact:exact};
   }finally{[source,target,dummy,buffer,read].forEach(r=>r.destroy());}
  });console.log('HSL stage probe',probe);
  // Existing prototype engineering limits; finished delivery below uses the
  // app's unchanged ΔE2000 / ΔITP limits instead.
  assert.ok(probe.mean<.002&&probe.p99<.01);assert.ok(probe.neutralExact);
  if(process.argv.includes('--probe-only'))return;
  const uploaded=await page.request.post(new URL('/api/session',base).href,{multipart:{file:{name:'hues.tiff',mimeType:'image/tiff',buffer:fs.readFileSync(path.join(root,'hues.tiff'))}}});
  assert.ok(uploaded.ok(),await uploaded.text());const {session}=await uploaded.json();
  await page.evaluate(s=>activateDesktopSession(s,''),session);
  if(!process.argv.includes('--delivery-only')){
  await page.locator('[data-group="hsl"] .group-toggle').click();
  const panel=page.locator('#hsl-global-panel');
  await panel.getByRole('button',{name:'All channel',exact:true}).click();
  await panel.getByRole('button',{name:'Pick',exact:true}).click();
  const pick=async(x,y)=>{
   const box=await page.evaluate(()=>{const r=activePreviewElement().getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
   await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
   await page.waitForFunction(()=>!hslUI.panels[0].sampling);
  };
  await pick(.12,.6);
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).kind),'custom');
  await panel.getByRole('button',{name:'Add',exact:true}).click();await pick(.5,.6);
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.ranges.length),2);
  await panel.getByRole('button',{name:'Subtract',exact:true}).click();await pick(.12,.6);
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.ranges[2].subtract),true);
  await panel.getByRole('button',{name:'Stop picking',exact:true}).click();
  await panel.getByRole('checkbox',{name:'Show selection',exact:true}).check();
  await page.waitForFunction(()=>document.getElementById('hsl-selection-overlay')?.complete&&document.getElementById('hsl-selection-overlay')?.naturalWidth>0);
  await panel.getByRole('checkbox',{name:'Show selection',exact:true}).uncheck();
  assert.equal(await page.locator('#hsl-selection-overlay').count(),0);
  const handle=panel.locator('[data-hsl-handle="move"][data-range="1"][tabindex]');
  const before=await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.ranges[1].center);
  await handle.focus();await page.keyboard.press('Shift+ArrowRight');
  assert.ok(Math.abs(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.ranges[1].center)-before-5)<1e-5);
  await page.evaluate(()=>syncGlobalEditState());await handle.scrollIntoViewIfNeeded();
  const box=await handle.boundingBox();assert.ok(box,"Wheel handle remains visible after acknowledgement");await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2+8,{steps:4});await page.mouse.up();
  await panel.locator('[data-hsl-handle="move"][data-range="2"][tabindex]').click({button:'right'});
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.ranges.length),2);
  const slider=panel.getByRole('slider',{name:'HSL Hue',exact:true});await slider.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Tab');
  await page.evaluate(()=>syncGlobalEditState());
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.hue),1);
  await page.evaluate(()=>queueEditCommand('undo'));
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.hue),0);
  await page.evaluate(()=>queueEditCommand('redo'));
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.hue),1);
  await page.locator('[data-group="hsl"] .group-preset').click();await page.locator('#group-preset-name').fill('HSL test');await page.locator('#group-preset-save').click();
  await page.waitForFunction(()=>els.groupPresetStatus.textContent.includes('Saved'));
  await page.evaluate(()=>closeGroupPresetDialog());
  await panel.getByRole('button',{name:'Red channel',exact:true}).click();
  assert.equal(await page.evaluate(()=>hslChannel(hslUI.panels[0]).recipe.hue),0);
  await page.locator('[data-group="hsl"] .group-preset').click();await page.locator('.group-preset-row').filter({hasText:'HSL test'}).getByRole('button',{name:'Apply',exact:true}).click();
  assert.equal(await page.evaluate(()=>state.adjustments.hdr.hsl.channels.find(c=>c.kind==='custom').recipe.hue),1);
  await page.evaluate(async()=>{await syncGlobalEditState();await assignToolToPending('linear_gradient');});
  await page.locator('[data-local-grade-section="hsl"] .local-grade-section-toggle').click().catch(()=>{});
  const local=page.locator('#hsl-local-panel');
  await local.getByRole('button',{name:'Orange quick start',exact:true}).click();
  await local.getByRole('button',{name:'Add',exact:true}).click();await local.getByRole('button',{name:'Green quick start',exact:true}).click();
  assert.equal(await page.evaluate(()=>selectedLocal().hdr_grade.hsl.ranges.length),2);
  await local.getByRole('button',{name:'Stop picking',exact:true}).click();
  await page.evaluate(async()=>{
   const g=selectedLocal().hdr_grade;g.hsl.hue=-15;g.hsl.saturation=20;await commitSelectedLocal({refreshPreview:false});setGradeMode('global');
   for(const lane of ['hdr','sdr']){
    const b=state.adjustments[lane];b.hsl.channels[1].recipe.hue=35;b.hsl.channels[1].recipe.saturation=25;b.hsl.channels[4].recipe.luminance=.4;
    b.highlight_section_enabled=true;b.highlight_compression_mode='peak_fit';
   }
   state.globalEditDirty=true;if(!await syncGlobalEditState())throw Error('HSL sync failed');
   for(const lane of ['hdr','sdr']){await switchLane(lane);invalidatePreview(lane);await settlePreview(lane,{});if(!await renderGpuDraft(lane,{longEdge:256}))throw Error('GPU preview failed');}
  });
  console.log('HSL picker, wheel, channels, presets, local grade and GPU preview pass');
  }
  await page.evaluate(async neutral=>{
   for(const lane of ['hdr','sdr']){
    const b=state.adjustments[lane];b.hsl.channels[1].recipe.hue=35;b.hsl.channels[1].recipe.saturation=25;b.hsl.channels[4].recipe.luminance=.4;
    b.hsl_section_enabled=!neutral;
    b.highlight_section_enabled=true;b.highlight_compression_mode='peak_fit';
    if(lane==='hdr'){b.highlight_compression_target_nits=1000;b.highlight_compression_start_nits=400;}
   }
   for(const local of localAdjustments())for(const lane of ['hdr','sdr'])local[`${lane}_grade`].hsl_section_enabled=!neutral;
   state.globalEditDirty=true;await syncGlobalEditState();state.previewScheduler?.cancel();
   while(state.gpuDraftInFlight)await state.gpuDraftInFlight.catch(()=>null);
  },process.argv.includes('--neutral'));
  for(const forced of [false,true]){
   await api('/api/delivery/preferences',{force_cpu:forced});const file=path.join(root,forced?'cpu.jpg':'gpu.jpg');
   await global.HDRFinisherElectronTestHarness.selectExportPath(file);
   const grant=await page.evaluate(()=>window.hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'hsl.jpg'}));
   const settings={format:'jpeg_ultrahdr',quality:95,jpeg_chroma_subsampling:'444',jpeg_gain_map_quality:95,jpeg_gain_map_scale:'full',dithering:'off',guarantee_hdr_peak:true,output_finishing:{resize_mode:'long_edge',long_edge:192,sharpening:'off'}};
   const exported=await api(`/api/session/${session.session_id}/export`,{...settings,output_path:file,path_grant:grant.grant});assert.ok(exported.accepted);assert.equal(exported.renderer,forced?'cpu':'gpu');
   const proof=await api(`/api/session/${session.session_id}/proof/artifact`,{...settings,full_size:true});assert.equal(proof.renderer,exported.renderer);
   const bytes=await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.jpg`,base).href);assert.ok(bytes.ok());assert.ok(fs.readFileSync(file).equals(await bytes.body()),'Proof equals delivered bytes');
  }
  const result=JSON.parse(execFileSync(python,[path.join(__dirname,'helpers/gpu_delivery_fixture.py'),'compare',root],{env,encoding:'utf8'}));
  console.log('Finished HSL delivery',JSON.stringify(result));assert.ok(result.hdr.passed&&result.sdr.passed,'Existing perceptual colour limits');assert.ok(result.peak_nits<=1000);
  assert.deepEqual(errors,[]);console.log('HSL app integration PASS');
 }finally{await api('/api/delivery/preferences',{force_cpu:false}).catch(()=>{});await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
