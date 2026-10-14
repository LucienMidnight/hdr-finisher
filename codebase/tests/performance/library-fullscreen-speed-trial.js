/* M7/M8 measurement only; run through tests/run-in-electron.js at 2560x1440.
 * GPU completion + two RAFs denotes a compositor opportunity, not scanout.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/library-fullscreen-speed-trial');
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2));
const cpu=JSON.parse(fs.readFileSync(path.join(out,'cpu.json'),'utf8'));
(async()=>{
 const log=fs.openSync(path.join(out,'service.log'),'w');
 const service=spawn(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'library-fullscreen-speed-trial.py'),'serve'],{cwd:root,stdio:['ignore',log,log],windowsHide:true});
 let browser;
 try{
  const deadline=Date.now()+120000;
  while(true){try{if((await fetch('http://127.0.0.1:8803/health')).ok)break;}catch{}assert.equal(service.exitCode,null);assert.ok(Date.now()<deadline,'Trial service failed to start');await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  page.on('console',m=>{if(m.type()==='error')console.error('browser:',m.text());});
  const cdp=await page.context().newCDPSession(page);await cdp.send('Page.setBypassCSP',{enabled:true});
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const lib=page.frame({url:/\/library(?:\?|$)/});assert.ok(lib,'Library iframe');
  await cdp.send('Browser.grantPermissions',{origin:new URL(page.url()).origin,permissions:['localNetworkAccess']});
  const setup=await lib.evaluate(async()=>{
   window.trialApi=async(route,body)=>{const r=await fetch('http://127.0.0.1:8803/'+route,{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
   const inherited=window.fetch.bind(window);
   window.fetch=(input,options)=>{const u=new URL(String(input),location.href);if(u.pathname.startsWith('/api/library/pixels/'))return inherited('http://127.0.0.1:8803/pixels?key='+u.pathname.split('/').at(-1)+'&lane='+u.searchParams.get('lane'),options);return inherited(input,options);};
   window.trialGpu=await HDRLibraryPictures.initialize();window.trialCanvas=document.createElement('canvas');
   trialCanvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:black;z-index:9999';document.body.append(trialCanvas);
   window.trialEvents=[];window.HDRLibraryStopwatch=(e,v)=>trialEvents.push({event:e,...v});
   window.trialShow=async(meta,hdr=false,canvas=trialCanvas,reset=true)=>{
    if(reset)trialGpu.resetSession(meta.key);
    trialEvents=[];const t=performance.now();const result=await HDRLibraryPictures.show(meta,canvas,new AbortController().signal,()=>true,hdr);
    assertGpu(result?.execution==='direct'||result?.rendered,'Library draw failed');const gpu_ms=performance.now()-t;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {gpu_ms,screen_ms:performance.now()-t,events:trialEvents,surface:trialGpu.lastPresentedFrame?.format};
   };
   window.assertGpu=(v,m)=>{if(!v)throw Error(m);};
   window.trialRead=async(meta,hdr=false,canvas=trialCanvas)=>{
    const r=await trialShow(meta,hdr,canvas);
    const a=await trialGpu.analyzeScope(canvas,{width:meta.width,height:meta.height,tier:'picture',raw:true});
    assertGpu(a?.halves,'Library scope readback unavailable');return {r,a};
   };
   window.halfValue=b=>{const s=b&32768?-1:1,e=(b>>10)&31,m=b&1023;return s*(e===0?m*2**-24:e===31?(m?NaN:Infinity):(1+m/1024)*2**(e-15));};
   window.trialDiff=(a,b,hdr)=>{
    assertGpu(a.width===b.width&&a.height===b.height,'Different capture dimensions');let sum=0,ref=0,max=0,n=0;const hist=new Uint32Array(256);
    const code=v=>Math.round(Math.min(1,Math.max(0,v<=.0031308?v*12.92:1.055*Math.max(0,v)**(1/2.4)-.055))*255);
    for(let i=0;i<a.halves.length;i++){let x=halfValue(a.halves[i]),y=halfValue(b.halves[i]);let d=hdr?Math.abs(x-y):Math.abs(code(x)-code(y));sum+=d;ref+=Math.abs(x);max=Math.max(max,d);if(!hdr)hist[d]++;n++;}
    let p99=0,total=0;for(let i=0;i<256;i++){total+=hist[i];if(total>=n*.99){p99=i;break;}}
    return hdr?{relative_mae:sum/Math.max(ref,1e-12),linear_max:max,samples:n}:{code_mae:sum/n,code_p99:p99,code_max:max,samples:n};
   };
   return {adapter:trialGpu.adapterInfo,limits:{maxTextureDimension2D:trialGpu.device.limits.maxTextureDimension2D,maxStorageBufferBindingSize:trialGpu.device.limits.maxStorageBufferBindingSize,maxBufferSize:trialGpu.device.limits.maxBufferSize}};
  });
  const fresh={...setup,method:'Library GPU shaders unchanged; GPU completion plus two RAFs; warm OS cache, disposable picture cache',handoff:[],storage_difference:[],cpu_difference:[],gpu:[],browse:[],complete:false};
  const results=process.argv.includes('--resume')&&fs.existsSync(path.join(out,'gpu.json'))?{...JSON.parse(fs.readFileSync(path.join(out,'gpu.json'),'utf8')),...setup}:fresh;
  const api=(route,body)=>lib.evaluate(({route,body})=>trialApi(route,body),{route,body});
  // Warm the renderer/pipelines separately; report initialization outside steady state.
  let warm=await api('prepare',{index:1,key:'warm',route:'current'});await lib.evaluate(meta=>trialShow(meta),warm);
  for(const index of cpu.indices){
   for(let repeat=0;repeat<2;repeat++){
    if(results.handoff.some(r=>r.index===index&&r.repeat===repeat))continue;
    const row=await lib.evaluate(async({index,repeat})=>{
     const diskStart=performance.now(),disk=await trialApi('prepare',{index,key:'disk'+index+'-'+repeat,route:'current',disk:true});const prepared=performance.now();const diskDraw=await trialShow(disk);const diskEnd=performance.now();
     const directStart=performance.now(),direct=await trialApi('prepare',{index,key:'direct'+index+'-'+repeat,route:'current'});const directPrepared=performance.now();const directDraw=await trialShow(direct);const directEnd=performance.now();
     const redraw=await trialShow(direct,false,trialCanvas,false);
     return {index,repeat,path:disk.path,decode_ms:disk.decode_ms,save_ms:disk.save_ms,disk:diskDraw,direct:directDraw,redraw,disk_end_to_end_ms:diskEnd-diskStart,direct_end_to_end_ms:directEnd-directStart,disk_prepare_ms:disk.prepare_ms,direct_prepare_ms:direct.prepare_ms,disk_after_decode_ms:disk.prepare_ms-disk.decode_ms+diskEnd-prepared,direct_after_decode_ms:direct.prepare_ms-direct.decode_ms+directEnd-directPrepared};
    },{index,repeat});results.handoff.push(row);write('gpu.json',results);
   }
   await api('release',{});console.log('handoff',index);
  }
  for(let index=0;index<cpu.matrix[0].rows.length;index++){
   if(cpu.matrix[0].rows[index].error)continue;
   const base=await api('variant',{index,key:'base'+index});
   for(const format of [...new Set(cpu.formats.map(r=>r.format))]){
    if(results.storage_difference.some(r=>r.index===index&&r.format===format))continue;
    const meta=await api('variant',{index,format,key:'variant'+index+format});
    const difference=await lib.evaluate(async({base,meta})=>{
     const values={};for(const hdr of [false,true]){const a=await trialRead(base,hdr),b=await trialRead(meta,hdr);values[hdr?'hdr':'sdr']=trialDiff(a.a,b.a,hdr);}return values;
    },{base,meta});results.storage_difference.push({index,path:base.path,format,...difference});write('gpu.json',results);
   }
   if(!results.cpu_difference.some(r=>r.index===index)){
   const fast=await api('prepare',{index:cpu.indices[index],key:'fastcompare'+index,route:'fast'});
   const d=await lib.evaluate(async({base,fast})=>{const v={};for(const hdr of [false,true]){const a=await trialRead(base,hdr),b=await trialRead(fast,hdr);v[hdr?'hdr':'sdr']=trialDiff(a.a,b.a,hdr);}return v;},{base,fast});results.cpu_difference.push({index,path:base.path,...d});}
   if([1,3,10].includes(index)&&!fs.existsSync(path.join(out,'comparison-'+index+'.png'))){
    const variant=await api('variant',{index,format:'half8-shuffle-zlib1',key:'side'+index});
    await lib.evaluate(async({base,variant})=>{
     trialCanvas.style.visibility='hidden';window.trialBox=document.createElement('div');trialBox.style.cssText='position:fixed;inset:0;background:#111;z-index:10000;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:30px minmax(0,1fr) 30px minmax(0,1fr)';document.body.append(trialBox);
     for(const hdr of [false,true]){for(const [label,meta] of [['Uncompressed',base],['8-bit half mantissa, shuffled deflate',variant]]){const s=document.createElement('div');s.textContent=(hdr?'HDR scene draw':'SDR draw')+' | '+label;s.style.cssText='color:white;text-align:center;font:16px sans-serif';trialBox.append(s);}for(const meta of [base,variant]){const c=document.createElement('canvas');c.style.cssText='width:100%;height:100%;min-width:0;min-height:0;object-fit:contain';trialBox.append(c);await trialShow(meta,hdr,c);}}
    },{base,variant});await page.screenshot({path:path.join(out,'comparison-'+index+'.png')});
    await lib.evaluate(()=>{trialBox.remove();trialCanvas.style.visibility='visible';});
   }
   await api('release',{});console.log('display differences',index);
  }
  if(!results.current_six){
   results.current_six=await lib.evaluate(async indices=>{
    await trialApi('start',{current:true});const start=performance.now(),waiting=new Set(indices),rows=[];
    for(const index of indices)await trialApi('enqueue',{index});
    while(waiting.size){for(const index of [...waiting]){const status=await trialApi('status',{index});if(!status.ready)continue;waiting.delete(index);const draw=await trialShow(status.meta);rows.push({index,path:status.meta.path,meta:status.meta,draw,finished_ms:performance.now()-start});}await new Promise(r=>setTimeout(r,5));}
    return {rows,wall_ms:performance.now()-start};
   },cpu.indices);write('gpu.json',results);await api('release',{});console.log('Current save/fetch/draw with six lanes done');
  }
  if(process.argv.includes('--current-only')){write('gpu.json',results);return;}
  // GPU shrink/colour uses the same separable widened triangular filter as
  // Pillow bilinear, with original integer camera transport (not half-float).
  await lib.evaluate(async()=>{
   const code=`struct P {src:vec4u,dst:vec4u,r0:vec4f,r1:vec4f,r2:vec4f};
    @group(0) @binding(0) var<storage,read> input:array<u32>;
    @group(0) @binding(1) var<storage,read_write> middle:array<vec4f>;
    @group(0) @binding(2) var<uniform> p:P;
    fn channel(i:u32)->f32 {let v=input[i/2];return f32(select(v&65535u,v>>16,(i&1u)==1u));}
    @compute @workgroup_size(8,8) fn horizontal(@builtin(global_invocation_id) id:vec3u){
     if(id.x>=p.dst.x||id.y>=p.src.y){return;}let scale=f32(p.src.x)/f32(p.dst.x);let support=max(1.,scale);let center=(f32(id.x)+.5)*scale;
     let first=max(0,i32(center-support+.5));let last=min(i32(p.src.x),i32(center+support+.5));var value=vec3f(0);var norm=0.;
     for(var x=first;x<last;x++){let weight=max(0.,1.-abs((f32(x)+.5-center)/support));let i=(id.y*p.src.x+u32(x))*3;value+=vec3f(channel(i),channel(i+1),channel(i+2))*weight;norm+=weight;}
     middle[id.y*p.dst.x+id.x]=vec4f(value/norm,1.);
    }
    @group(1) @binding(0) var<storage,read> temporary:array<vec4f>;
    @group(1) @binding(1) var destination:texture_storage_2d<rgba16float,write>;
    @group(1) @binding(2) var<uniform> q:P;
    @compute @workgroup_size(8,8) fn vertical(@builtin(global_invocation_id) id:vec3u){
     if(id.x>=q.dst.x||id.y>=q.dst.y){return;}let scale=f32(q.src.y)/f32(q.dst.y);let support=max(1.,scale);let center=(f32(id.y)+.5)*scale;
     let first=max(0,i32(center-support+.5));let last=min(i32(q.src.y),i32(center+support+.5));var value=vec3f(0);var norm=0.;
     for(var y=first;y<last;y++){let weight=max(0.,1.-abs((f32(y)+.5-center)/support));value+=temporary[u32(y)*q.dst.x+id.x].rgb*weight;norm+=weight;}
     let camera=value/norm/65535.;var rgb=vec3f(dot(q.r0.xyz,camera),dot(q.r1.xyz,camera),dot(q.r2.xyz,camera));
     let lo=min(rgb.r,min(rgb.g,rgb.b));let hi=max(rgb.r,max(rgb.g,rgb.b));if(lo<0){rgb=select(vec3f(0),hi*(rgb-vec3f(lo))/max(hi-lo,1e-20),hi>0);}
     if(any(camera>=vec3f(q.r0.w,q.r1.w,q.r2.w))){rgb=vec3f(max(rgb.r,max(rgb.g,rgb.b)));}
     textureStore(destination,vec2i(id.xy),vec4f(clamp(rgb,vec3f(0),vec3f(65504)),1));
    }`;
   const module=trialGpu.device.createShaderModule({code});window.trialHP=await trialGpu.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'horizontal'}});window.trialVP=await trialGpu.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'vertical'}});
   window.trialConvert=async(meta)=>{
    const device=trialGpu.device,t=performance.now(),res=await fetch('http://127.0.0.1:8803/raw?key='+meta.key),body=await res.arrayBuffer();
    const raw=device.createBuffer({size:Math.ceil(body.byteLength/4)*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(raw,0,body);const upload_ms=performance.now()-t;
    const w=Math.round(meta.raw_width*Math.min(2560,Math.max(meta.raw_width,meta.raw_height))/Math.max(meta.raw_width,meta.raw_height)),h=Math.round(meta.raw_height*Math.min(2560,Math.max(meta.raw_width,meta.raw_height))/Math.max(meta.raw_width,meta.raw_height));
    const mid=device.createBuffer({size:w*meta.raw_height*16,usage:GPUBufferUsage.STORAGE});const params=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bytes=new ArrayBuffer(80);new Uint32Array(bytes).set([meta.raw_width,meta.raw_height,0,0,w,h,0,0]);new Float32Array(bytes,32).set(meta.matrix.flatMap((r,i)=>[...r,meta.threshold[i]]));device.queue.writeBuffer(params,0,bytes);
    const texture=device.createTexture({size:[w,h],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
    const b1=device.createBindGroup({layout:trialHP.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:raw}},{binding:1,resource:{buffer:mid}},{binding:2,resource:{buffer:params}}]});
    const b2=device.createBindGroup({layout:trialVP.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:mid}},{binding:1,resource:texture.createView()},{binding:2,resource:{buffer:params}}]});
    const start=performance.now();const encoder=device.createCommandEncoder();let pass=encoder.beginComputePass();pass.setPipeline(trialHP);pass.setBindGroup(0,b1);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(meta.raw_height/8));pass.end();pass=encoder.beginComputePass();pass.setPipeline(trialVP);pass.setBindGroup(1,b2);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();const compute_ms=performance.now()-start;
    const row=Math.ceil(w*8/256)*256;const buffer=device.createBuffer({size:row*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=device.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer,bytesPerRow:row},{width:w,height:h});device.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);const padded=new Uint8Array(buffer.getMappedRange()),packed=new Uint8Array(w*h*8);for(let y=0;y<h;y++)packed.set(padded.subarray(y*row,y*row+w*8),y*w*8);buffer.unmap();const readback_ms=performance.now()-start-compute_ms;
    const r=await fetch('http://127.0.0.1:8803/gpu-result?key='+meta.key+'result&width='+w+'&height='+h+'&index='+meta.index,{method:'POST',body:packed});if(!r.ok)throw Error(await r.text());const result=await r.json();
    raw.destroy();mid.destroy();params.destroy();buffer.destroy();texture.destroy();return {meta:result,upload_ms,compute_ms,readback_ms,including_roundtrip_ms:performance.now()-t,raw_bytes:body.byteLength};
   };
  });
  for(const index of [0,1,2,4,5,6]){
   for(let repeat=0;repeat<2;repeat++){
    if(results.gpu.some(r=>r.index===index&&r.repeat===repeat))continue;
    const base=await api('prepare',{index,key:'gpuref'+index,route:'current'}),raw=await api('prepare',{index,key:'raw'+index,raw:true});raw.index=index;
    const result=await lib.evaluate(async({base,raw})=>{const converted=await trialConvert(raw);const values={};for(const hdr of [false,true]){const a=await trialRead(base,hdr),b=await trialRead(converted.meta,hdr);values[hdr?'hdr':'sdr']=trialDiff(a.a,b.a,hdr);}return {...converted,...values};},{base,raw});results.gpu.push({index,repeat,path:raw.path,raw_decode_ms:raw.decode_ms,...result});write('gpu.json',results);
   }
   await api('release',{});console.log('gpu shrink/colour',index);
  }
  results.gpu_six ||= [];
  for(let repeat=0;repeat<2;repeat++){
   if(results.gpu_six.filter(r=>r.repeat===repeat).length===6)continue;
   const rows=await lib.evaluate(async repeat=>{
    const indices=[0,1,2,4,5,6],started=performance.now();
    const jobs=indices.map(index=>trialApi('prepare',{index,key:'sixraw'+index,raw:true}).then(meta=>({...meta,index,ready_ms:performance.now()-started})));
    const rows=[];const remaining=new Map(jobs.map((p,i)=>[i,p.then(meta=>({i,meta}))]));
    while(remaining.size){const {i,meta}=await Promise.race(remaining.values());remaining.delete(i);const converted=await trialConvert(meta);const draw=await trialShow(converted.meta);rows.push({index:meta.index,repeat,path:meta.path,decode_ms:meta.decode_ms,ready_ms:meta.ready_ms,...converted,draw,finished_ms:performance.now()-started});}
    return rows;
   },repeat);results.gpu_six.push(...rows);await api('release',{});write('gpu.json',results);console.log('GPU with six decodes',repeat);
  }
  // End-to-end directional read-ahead. Twelve queued including active work;
  // six lanes, no initial prewarm; selections follow a monotonic fixed clock.
  for(const interval of [250,100]){
   if(results.browse.some(r=>r.interval===interval))continue;
   const row=await lib.evaluate(async interval=>{
    await trialApi('start',{});trialGpu.resetSession('browse-start');let next=0,current=0,stop=false;const frames=new Map(),rows=[],errors=[];
    trialCanvas.style.visibility='hidden';
    const enqueue=async i=>{for(;next<Math.min(30,i+13);next++)await trialApi('enqueue',{index:next});};
    await enqueue(0);const start=performance.now();
    const painter=(async()=>{
     while(!stop){
      for(let i=current;i<Math.min(next,current+10);i++){
       if(frames.has(i))continue;const status=await trialApi('status',{index:i});if(!status.ready)continue;
       const c=document.createElement('canvas');c.style.cssText=trialCanvas.style.cssText;c.style.visibility='hidden';document.body.append(c);
       try{const draw=await trialShow(status.meta,false,c);frames.set(i,{canvas:c,draw,at:performance.now()});if(i===current)c.style.visibility='visible';}catch(e){c.remove();errors.push(String(e));}
      }
      await new Promise(r=>setTimeout(r,5));
     }
    })();
    for(let i=0;i<30;i++){
     const target=start+i*interval;await new Promise(r=>setTimeout(r,Math.max(0,target-performance.now())));current=i;
     const selected=performance.now(),frame=frames.get(i);
     for(const [j,f] of frames){f.canvas.style.visibility=j===i?'visible':'hidden';if(j<i){f.canvas.remove();frames.delete(j);}}
     rows.push({index:i,selected_ms:selected-start,selection_lateness_ms:selected-target,sharp_when_reached:!!frame,prepared_at_ms:frame?frame.at-start:null});await trialApi('select',{index:i});await enqueue(i+1);
    }
    const landed=rows.at(-1).selected_ms+start;
    while(!frames.has(29)&&!errors.length)await new Promise(r=>setTimeout(r,10));
    const final_wait_ms=Math.max(0,(frames.get(29)?.at??performance.now())-landed);stop=true;await painter;
    for(const f of frames.values())f.canvas.remove();trialCanvas.style.visibility='visible';assertGpu(!errors.length,errors.join('; '));
    return {interval,rows,sharp_ready_at_selection:rows.filter(r=>r.sharp_when_reached).length,final_wait_ms,elapsed_ms:performance.now()-start};
   },interval);results.browse.push(row);write('gpu.json',results);console.log('browse',interval,row.sharp_ready_at_selection,row.final_wait_ms);
  }
  if(process.argv.includes('--browse-only')){results.complete=true;write('gpu.json',results);return;}
  // Allocate ten held picture textures while a real Grade preview is resident.
  const gradePath=cpu.paths[1];await page.evaluate(async source=>{const selection=await desktop.grantSourcePath(source);await openDesktopSelection({kind:'source',...selection});},gradePath);
  await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==='ready',null,{timeout:180000});
  results.grade=await page.evaluate(()=>HDRFinisherPerformance.gpuSnapshot());
  results.ram=await api('hold',{});
  const gpuMemory=()=>execFileSync('nvidia-smi',['--query-gpu=name,memory.total,memory.used,memory.free','--format=csv,noheader,nounits'],{windowsHide:true,encoding:'utf8'}).trim();
  results.vram_before=gpuMemory();
  results.memory=await lib.evaluate(async()=>{
   const d=trialGpu.device;d.pushErrorScope('out-of-memory');d.pushErrorScope('validation');const held=[];
   for(let i=0;i<10;i++){const texture=d.createTexture({size:[2560,1707],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});d.queue.writeTexture({texture},new Uint8Array(2560*1707*8),{bytesPerRow:2560*8},[2560,1707]);held.push(texture);}await d.queue.onSubmittedWorkDone();const validation=await d.popErrorScope(),oom=await d.popErrorScope();window.trialHeld=held;return {held_count:10,per_texture_bytes:2560*1707*8,total_texture_bytes:10*2560*1707*8,validation:validation?.message??null,oom:oom?.message??null,device_lost:null};
  });
  results.vram_after=gpuMemory();await lib.evaluate(()=>{for(const t of trialHeld)t.destroy();});
  results.complete=true;write('gpu.json',results);console.log('M7/M8 GPU trial complete');
 }finally{if(browser)await browser.close();if(service.exitCode===null)try{execFileSync('taskkill',['/PID',String(service.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}fs.closeSync(log);}
})().catch(e=>{console.error(e);process.exitCode=1;});
