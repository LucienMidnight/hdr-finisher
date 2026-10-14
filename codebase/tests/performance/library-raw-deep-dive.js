/* M9 isolated measurement: CPU LibRaw, GPU conversion kept resident; no shipped changes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/library-raw-deep-dive');
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2));
(async()=>{const log=fs.openSync(path.join(out,'service.log'),'w');
 const service=spawn(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'library-raw-deep-dive.py'),'serve'],{cwd:root,env:{...process.env,M9_THREADS:'12'},stdio:['ignore',log,log],windowsHide:true});let browser;
 try {const deadline=Date.now()+90000;while(true){try{if((await fetch('http://127.0.0.1:8809/health')).ok)break;}catch{}assert.equal(service.exitCode,null);assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const cdp=await page.context().newCDPSession(page);await cdp.send('Page.setBypassCSP',{enabled:true});await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});const lib=page.frame({url:/\/library(?:\?|$)/});assert.ok(lib);await cdp.send('Browser.grantPermissions',{origin:new URL(page.url()).origin,permissions:['localNetworkAccess']});
  const setup=await lib.evaluate(async()=>{
   window.trialApi=async(route,body)=>{const r=await fetch('http://127.0.0.1:8809/'+route,{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
   const inherited=window.fetch.bind(window);
   window.fetch=(input,options)=>{const u=new URL(String(input),location.href);if(u.pathname.startsWith('/api/library/pixels/'))return inherited('http://127.0.0.1:8809/pixels?key='+u.pathname.split('/').at(-1)+'&lane='+u.searchParams.get('lane'),options);return inherited(input,options);};
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
    const device=trialGpu.device,t=performance.now(),res=await fetch('http://127.0.0.1:8809/raw?key='+meta.key),body=await res.arrayBuffer();
    const raw=device.createBuffer({size:Math.ceil(body.byteLength/4)*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(raw,0,body);const upload_ms=performance.now()-t;
    const w=meta.width,h=meta.height;
    const mid=device.createBuffer({size:w*meta.raw_height*16,usage:GPUBufferUsage.STORAGE});const params=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bytes=new ArrayBuffer(80);new Uint32Array(bytes).set([meta.raw_width,meta.raw_height,0,0,w,h,0,0]);new Float32Array(bytes,32).set(meta.matrix.flatMap((r,i)=>[...r,meta.threshold[i]]));device.queue.writeBuffer(params,0,bytes);
    const texture=device.createTexture({size:[w,h],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
    const b1=device.createBindGroup({layout:trialHP.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:raw}},{binding:1,resource:{buffer:mid}},{binding:2,resource:{buffer:params}}]});
    const b2=device.createBindGroup({layout:trialVP.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:mid}},{binding:1,resource:texture.createView()},{binding:2,resource:{buffer:params}}]});
    const start=performance.now();const encoder=device.createCommandEncoder();let pass=encoder.beginComputePass();pass.setPipeline(trialHP);pass.setBindGroup(0,b1);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(meta.raw_height/8));pass.end();pass=encoder.beginComputePass();pass.setPipeline(trialVP);pass.setBindGroup(1,b2);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();const compute_ms=performance.now()-start;
    const key=meta.key;
    for(const lane of ['hdr','sdr']) trialGpu.proxies.set(key+':'+lane,{texture,width:w,height:h,sessionId:key,lane,longEdge:meta.edge,workingSpace:'ACEScg',pixelFormat:'rgba16float',geometrySignature:'{}',sourceIdentity:'source',identity:key+':'+lane,byteSize:w*h*8,bindGroups:new Map()});
    raw.destroy();mid.destroy();params.destroy();return {meta,upload_ms,compute_ms,raw_bytes:body.byteLength};
   };
  });

 const api=(route,body)=>lib.evaluate(({route,body})=>trialApi(route,body),{route,body});
 const coexistOnly=process.argv.includes('--coexist-only');const browseOnly=process.argv.includes('--browse-only')||coexistOnly;
 const results=browseOnly?JSON.parse(fs.readFileSync(path.join(out,'gpu.json'),'utf8')):{setup,method:'Windows unbuffered reads; normal priority 12 native threads; 2160x1440 fit; GPU texture stays resident; two RAFs after queue completion are compositor opportunity, not panel scanout',rows:[],comparisons:[],complete:false};
 // Initialize shaders and first draw before measured samples.
 await lib.evaluate(async()=>{let m=await trialApi('prepare',{index:0,route:'gpu',key:'warm'});trialGpu.resetSession(m.key);await trialConvert(m);await trialShow(m,false,trialCanvas,false);});
 if(!browseOnly)for(let repeat=0;repeat<2;repeat++)for(let index=0;index<6;index++)for(const route of ['cpu','gpu']){
 const row=await lib.evaluate(async({index,route,repeat})=>{const t=performance.now();const meta=await trialApi('prepare',{index,route,key:route+index+'-'+repeat});const ready=performance.now();trialGpu.resetSession(meta.key);let conversion=null;if(route==='gpu')conversion=await trialConvert(meta);const draw=await trialShow(meta,false,trialCanvas,false);return {index,route,repeat,meta,conversion,draw,end_to_end_ms:performance.now()-t,page_prepare_ms:ready-t};},{index,route,repeat});results.rows.push(row);write('gpu.json',results);await api('release',{});console.log('M9 drawn',repeat,index,route,row.end_to_end_ms.toFixed(1));
 }
 if(!browseOnly)for(let index=0;index<6;index++){
 const candidate=await api('prepare',{index,route:'gpu',key:'compare'+index});const base=await api('baseline',{index,key:'baseline'+index,edge:candidate.edge});
 const diff=await lib.evaluate(async({candidate,base})=>{const result={};for(const hdr of [false,true]){const a=await trialRead(base,hdr);trialGpu.resetSession(candidate.key);await trialConvert(candidate);const br=await trialShow(candidate,hdr,trialCanvas,false);const ba=await trialGpu.analyzeScope(trialCanvas,{width:candidate.width,height:candidate.height,tier:"picture",raw:true});const b={r:br,a:ba};result[hdr?'hdr':'sdr']=trialDiff(a.a,b.a,hdr);}return result;},{candidate,base});results.comparisons.push({index,path:candidate.path,...diff});write('gpu.json',results);
 await lib.evaluate(async({candidate,base})=>{trialCanvas.style.visibility='hidden';window.box=document.createElement('div');box.style.cssText='position:fixed;inset:0;background:#111;z-index:10000;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:28px minmax(0,1fr) 28px minmax(0,1fr)';document.body.append(box);for(const hdr of [false,true]){for(const label of ['Today Library','M9 GPU resident']){const d=document.createElement('div');d.textContent=(hdr?'HDR':'SDR')+' | '+label;d.style.cssText='color:white;text-align:center;font:16px sans-serif';box.append(d);}for(const meta of [base,candidate]){const c=document.createElement('canvas');c.style.cssText='width:100%;height:100%;min-width:0;min-height:0;object-fit:contain';box.append(c);trialGpu.resetSession(meta.key);if(meta===candidate)await trialConvert(meta);await trialShow(meta,hdr,c,false);}}},{candidate,base});await page.screenshot({path:path.join(out,'comparison-'+index+'.png')});await lib.evaluate(()=>{box.remove();trialCanvas.style.visibility='visible';});await api('release',{});console.log('comparison',index);
 }

 if(browseOnly){
 const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
 const gradePath=manifest.paths[1];await page.evaluate(async source=>{const selection=await desktop.grantSourcePath(source);await openDesktopSelection({kind:'source',...selection});},gradePath);
 await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==='ready',null,{timeout:180000});
 results.grade_before=await page.evaluate(()=>HDRFinisherPerformance.gpuSnapshot());
 const gradeStep=async value=>{const before=await page.evaluate(()=>state.acceptedPresentation.generation);const t=Date.now();await page.evaluate(value=>{const c=document.querySelector('#hdr-exposure');c.value=String(value);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));},value);await page.waitForFunction(before=>state.acceptedPresentation?.generation>before&&state.acceptedPresentation.exact&&viewerState().status==='ready',before,{timeout:30000});return Date.now()-t;};
 results.grade_idle_ms=await gradeStep(.1);results.background=[];
 for(const lanes of [1,2,3]){
 const batchPromise=lib.evaluate(async lanes=>{
 await trialApi('start',{lanes,indices:[0,1,2,3,4,5],batch:true});const t=performance.now(),done=new Set(),rows=[];let fg;
 let fgReady=null,fgPresented=null;
 const foreground=(async()=>{await new Promise(r=>setTimeout(r,200));const start=performance.now();const m=await trialApi('prepare',{index:6,route:'gpu',key:'fg'+lanes});fgReady={meta:m,at:start};return fgReady;})();
 let maxLate=0,last=performance.now();const ticker=setInterval(()=>{const now=performance.now();maxLate=Math.max(maxLate,now-last-16);last=now;},16);
 while(done.size<6||!fgPresented){if(fgReady&&!fgPresented){trialGpu.resetSession(fgReady.meta.key);await trialConvert(fgReady.meta);const draw=await trialShow(fgReady.meta,false,trialCanvas,false);fgPresented={end_to_end_ms:performance.now()-fgReady.at,draw};}const status=await trialApi('status',{});for(const m of status.ready){if(done.has(m.index))continue;done.add(m.index);trialGpu.resetSession(m.key);const c=await trialConvert(m);const draw=await trialShow(m,false,trialCanvas,false);rows.push({index:m.index,meta:m,conversion:c,draw,finished_ms:performance.now()-t});}await new Promise(r=>setTimeout(r,10));}
 const wall=Math.max(...rows.map(r=>r.finished_ms));fg=await foreground;clearInterval(ticker);
 return {lanes,rows,wall_ms:wall,photos_per_second:6000/wall,foreground_prepare_ms:fg.meta.prepare_ms,foreground_cpu_ready_ms:fg.meta.prepare_ms,max_timer_lateness_ms:maxLate,foreground_draw:fgPresented.draw,foreground_end_to_end_ms:fgPresented.end_to_end_ms};
 },lanes);await new Promise(r=>setTimeout(r,300));const grade_ms=await gradeStep(.1+lanes*.1);const r=await batchPromise;r.grade_preview_ms=grade_ms;results.background.push(r);write('gpu.json',results);console.log('background',lanes,r.photos_per_second);
 }
 results.grade_after=await page.evaluate(()=>({snapshot:HDRFinisherPerformance.gpuSnapshot(),status:viewerState().status,exact:state.acceptedPresentation?.exact}));
 if(!coexistOnly){results.browse=[];
 for(const interval of [500,250,100]){
 const r=await lib.evaluate(async({interval,count})=>{
 const indices=Array.from({length:count},(_,i)=>i);await trialApi('start',{lanes:2,indices});const t=performance.now(),frames=new Map(),selected=[],errors=[];let stop=false;let current=0;
 const painter=(async()=>{while(!stop){try{const status=await trialApi('status',{});for(const m of status.ready.sort((a,b)=>Math.abs(a.index-current)-Math.abs(b.index-current))){if(frames.has(m.index))continue;trialGpu.resetSession(m.key);await trialConvert(m);const c=document.createElement('canvas');c.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:black;z-index:10001;visibility:hidden';document.body.append(c);await trialShow(m,false,c,false);frames.set(m.index,{canvas:c,at:performance.now()});if(m.index===current){for(const f of frames.values())f.canvas.style.visibility='hidden';c.style.visibility='visible';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));frames.get(m.index).screen_at=performance.now();}if(frames.size>10){const old=[...frames.keys()].find(i=>i<current-1);if(old!==undefined){frames.get(old).canvas.remove();frames.delete(old);}}}await new Promise(r=>setTimeout(r,10));}catch(e){errors.push(String(e));break;}}})();
 for(let i=0;i<count;i++){const deadline=t+i*interval;await new Promise(r=>setTimeout(r,Math.max(0,deadline-performance.now())));current=i;const at=performance.now();selected.push({index:i,selected_ms:at-t,lateness_ms:at-deadline,sharp_when_reached:frames.has(i)});if(frames.has(i)){for(const f of frames.values())f.canvas.style.visibility='hidden';frames.get(i).canvas.style.visibility='visible';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));frames.get(i).screen_at=performance.now();}await trialApi('select',{index:i});}
 const landed=t+selected.at(-1).selected_ms;const timeout=performance.now()+20000;while(!frames.get(count-1)?.screen_at&&!errors.length&&performance.now()<timeout)await new Promise(r=>setTimeout(r,10));
 const wait=frames.get(count-1)?.screen_at?Math.max(0,frames.get(count-1).screen_at-landed):null;stop=true;await painter;for(const f of frames.values())f.canvas.remove();return {interval,count,rows:selected,sharp_ready_at_selection:selected.filter(r=>r.sharp_when_reached).length,final_wait_ms:wait,max_selection_lateness_ms:Math.max(...selected.map(r=>r.lateness_ms)),errors};
 },{interval,count:manifest.paths.length});results.browse.push(r);write('gpu.json',results);console.log('browse',interval,r.sharp_ready_at_selection,r.final_wait_ms);
 }
 }
 }
 results.complete=true;write('gpu.json',results);
 }finally{if(browser)await browser.close().catch(()=>{});if(service.exitCode===null)try{execFileSync('taskkill',['/PID',String(service.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}fs.closeSync(log);}
})().catch(e=>{console.error(e);process.exitCode=1;});
