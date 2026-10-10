/* Switched-off quick-open instrument; run only through run-in-electron.js.
 * Counts a frame after GPU completion and two animation frames. This is a
 * compositor opportunity, not a hardware scanout timestamp. No pixel file IPC.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/library-quick-open-trial');
fs.mkdirSync(out,{recursive:true});
const opt=(n,d)=>{const i=process.argv.indexOf(n);return i<0?d:process.argv[i+1];};
const mode=opt('--mode','pilot');
const write=(n,d)=>fs.writeFileSync(path.join(out,n+'.json'),JSON.stringify(d,null,2));
(async()=>{
 const log=fs.openSync(path.join(out,'service-'+mode+'.log'),'w');
 const service=spawn(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'photo-library-quick-open-trial.py')],{cwd:root,stdio:['ignore',log,log],windowsHide:true});
 let stopping=false;
 service.on('exit',(code,signal)=>{if(!stopping&&code!==null&&code!==0)console.error('Trial helper exit: '+code+' '+signal);});
 let browser;
 try {
  const deadline=Date.now()+60000;
  while(true){try{if((await fetch('http://127.0.0.1:8801/health')).ok)break;}catch{}
   assert.equal(service.exitCode,null);assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Page.setBypassCSP',{enabled:true});
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  await cdp.send('Browser.grantPermissions',{origin:new URL(page.url()).origin,permissions:['localNetworkAccess']});
  const corpus=await (await fetch('http://127.0.0.1:8801/paths')).json();
  const adapter=await page.evaluate(async()=>{
   const original=window.fetch.bind(window);
   window.fetch=(input,options)=>{
    const url=new URL(String(input),location.href);
    if(url.pathname.startsWith('/api/session/quick-')){
     url.searchParams.set('lane',url.pathname.split('/').at(-1).includes('sdr')?'sdr':'hdr');
     url.searchParams.set('key',url.pathname.split('/')[3].replace('quick-',''));
     return original('http://127.0.0.1:8801/proxy'+url.search,options);
    }return original(input,options);
   };
   window.quickCanvas=document.createElement('canvas');
   quickCanvas.style.cssText='position:fixed;inset:30px;width:calc(100% - 60px);height:calc(100% - 60px);object-fit:contain;background:black;z-index:9999';
   document.body.append(quickCanvas);
   window.quickGpu=new HDRWebGPUPreview(quickCanvas);await quickGpu.initialize();quickGpu.setSourceTransport('single');
   window.quickApi=async(route,body)=>{
    const r=await fetch('http://127.0.0.1:8801/'+route,{method:'POST',body:JSON.stringify(body)});
    if(!r.ok)throw new Error(await r.text());return r.json();
   };
   // Test-only source conversion; existing Grade/Proof shaders remain untouched.
   const colorModule=quickGpu.device.createShaderModule({code:`
    struct Params {r0:vec4f,r1:vec4f,r2:vec4f};
    @group(0) @binding(0) var source:texture_2d<f32>;
    @group(0) @binding(1) var destination:texture_storage_2d<rgba16float,write>;
    @group(0) @binding(2) var<uniform> p:Params;
    @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
     let size=textureDimensions(source);if(any(id.xy>=size)){return;}
     var rgb=textureLoad(source,vec2i(id.xy),0).rgb;
     if(p.r0.w>0.5){rgb=select(pow(max((rgb+vec3f(.055))/1.055,vec3f(0)),vec3f(2.4)),rgb/12.92,rgb<=vec3f(.04045));}
     rgb=vec3f(dot(p.r0.xyz,rgb),dot(p.r1.xyz,rgb),dot(p.r2.xyz,rgb));
     let lo=min(rgb.r,min(rgb.g,rgb.b));let hi=max(rgb.r,max(rgb.g,rgb.b));
     if(lo<0){rgb=select(vec3f(0),hi*(rgb-vec3f(lo))/max(hi-lo,1e-20),hi>0);}
     textureStore(destination,vec2i(id.xy),vec4f(rgb,1));
    }`});
   window.quickColorPipeline=await quickGpu.device.createComputePipelineAsync({layout:'auto',compute:{module:colorModule,entryPoint:'main'}});
   window.quickShow=async(meta,lane='sdr',canvas=quickCanvas)=>{
    const start=performance.now(),id='quick-'+meta.key;
    quickGpu.resetSession(id);window.quickConverted?.destroy();window.quickConverted=null;
    const geometry=JSON.stringify(meta.adjustments.shared?.geometry||{});
    const upload=performance.now();
    const proxy=await quickGpu.loadProxy(id,lane,meta.edge,geometry,0,'source');await quickGpu.waitForSubmittedWork();
    const upload_ms=performance.now()-upload,colorStart=performance.now();
    if(meta.matrix && !(lane==='sdr'&&meta.has_reference)){
     const device=quickGpu.device;
     const destination=device.createTexture({size:[proxy.width,proxy.height],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
     const params=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
     device.queue.writeBuffer(params,0,new Float32Array(meta.matrix.flatMap((row,i)=>[...row,i===0&&meta.eotf?1:0])));
     const bind=device.createBindGroup({layout:quickColorPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:proxy.texture.createView()},{binding:1,resource:destination.createView()},{binding:2,resource:{buffer:params}}]});
     const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(quickColorPipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(proxy.width/8),Math.ceil(proxy.height/8));pass.end();device.queue.submit([encoder.finish()]);
     await quickGpu.waitForSubmittedWork();params.destroy();proxy.texture.destroy();proxy.texture=destination;window.quickConverted=destination;
    }
    const gpu_color_ms=performance.now()-colorStart,draw=performance.now();
    const result=await quickGpu.renderTo(canvas,id,lane,meta.adjustments,sampleCurvePoints,meta.edge,[],0,null,meta.white,
     {width:meta.width,height:meta.height},{scopeAnalysis:true});
    assertTrial(result?.execution==='direct','Expected direct presentation');
    await quickGpu.waitForSubmittedWork();const draw_ms=performance.now()-draw;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {upload_ms,gpu_color_ms,draw_ms,present_wait_ms:performance.now()-draw-draw_ms,screen_ms:performance.now()-start,
     surface:quickGpu.lastPresentedFrame?.format};
   };
   window.assertTrial=(ok,message)=>{if(!ok)throw new Error(message);};
   return quickGpu.adapterInfo;
  });
  assert.ok(adapter&&!adapter.fallback);console.log('Quick-open GPU: '+JSON.stringify(adapter));
  const api=(route,body)=>page.evaluate(({route,body})=>quickApi(route,body),{route,body});
  let serial=0;
  async function single(index,edge,lane,kind='quick',keep=mode==='compare'){
   return page.evaluate(async request=>{
    const start=performance.now(),meta=await quickApi('open',request),ready=performance.now();
    const frame=await quickShow(meta,request.lane);
    const end_to_end_ms=performance.now()-start;
    const prefetched=await quickShow(meta,request.lane);
    if(!request.keep)await quickApi('release',{});
    return {...meta,...frame,open_wall_ms:ready-start,end_to_end_ms,lane:request.lane,prefetched};
   },{index,edge,lane,kind,keep,key:'single'+serial++});
  }
  async function batch(indices,workers,edge,lane,prefetched=false,kind='quick',grid=false){
   const key='batch'+serial++;
   return page.evaluate(async request=>{
    const start=performance.now();
    await quickApi('start',request);
    if(request.prefetched)await quickApi('wait',{});
    const showStart=performance.now(),rows=[];
    let container;
    if(request.grid){quickCanvas.style.visibility='hidden';container=document.createElement('div');container.style.cssText='position:fixed;inset:0;display:grid;grid-template-columns:repeat(6,1fr);background:black;z-index:10000';document.body.append(container);}
    for(let n=0;n<request.indices.length;n++){
     const opened=performance.now(),meta=await quickApi('next',{key:request.key+n});
     let canvas=quickCanvas;
     if(container){canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%;object-fit:contain';container.append(canvas);}
     const frame=await quickShow(meta,request.lane,canvas);
     rows.push({...meta,...frame,show_request_ms:performance.now()-opened,presented_ms:performance.now()-showStart});
     await quickApi('release',{});
    }
    const elapsed_ms=performance.now()-showStart;
    if(container){container.remove();quickCanvas.style.visibility='visible';}
    return {...request,rows,elapsed_ms,including_prefetch_ms:performance.now()-start,photos_per_second:rows.length/(elapsed_ms/1000),first_ms:rows[0].presented_ms};
   },{indices,workers,edge,lane,prefetched,kind,grid,key});
  }
  if(mode==='pilot'){
   const rows=[];for(const index of [corpus.ten[1],corpus.ten[0],corpus.ten[3],corpus.ten[7],corpus.ten[8],corpus.ten[9]])rows.push(await single(index,1600,'sdr'));
   write('pilot',{adapter,rows});console.log(rows.map(r=>({name:path.basename(r.path),route:r.route,total:r.end_to_end_ms,stages:r.stages})));
  }else if(mode==='measure'){
   const results={adapter,disk:'warm',grade:'import defaults plus persisted +0.25 EV fixture',presentation:'GPU completion plus two RAF; compositor opportunity, not scanout',singles:[],batches:[],prefetched:[]};
   for(const lane of ['sdr','hdr']){
    for(const index of corpus.all)results.singles.push(await single(index,1600,lane));
    for(const workers of [1,4,6])for(const [set,indices] of [['camera',corpus.camera],['all',corpus.all]]){
     const r=await batch(indices,workers,1600,lane);results.batches.push({set,...r});write('measure',results);
     console.log(`${lane} ${set} ${workers}: ${r.photos_per_second.toFixed(2)} photos/s`);
    }
    results.prefetched.push(...results.singles.filter(r=>r.lane===lane).map(r=>({index:r.index,path:r.path,lane,...r.prefetched})));
   }
   results.smaller=await batch(corpus.camera,6,960,'sdr');
   results.grid=await batch(corpus.grid,6,256,'sdr',false,'quick',true);
   // A fast JPEG placeholder is measured separately; replacements are quick singles.
   results.placeholder=[];for(const index of corpus.camera)results.placeholder.push(await single(index,1600,'sdr','embedded'));
   results.complete=true;write('measure',results);
   console.log('Grid first/all ms: '+results.grid.first_ms.toFixed(1)+' / '+results.grid.elapsed_ms.toFixed(1));
  }else if(mode==='compare'){
   const rows=fs.existsSync(path.join(out,'compare.json'))?JSON.parse(fs.readFileSync(path.join(out,'compare.json'),'utf8')).rows:[];
   for(const index of corpus.ten){
    if(rows.some(r=>r.index===index&&fs.existsSync(path.join(out,r.image))))continue;
    const quick=await single(index,1600,'sdr');
    const hdr=await single(index,1600,'hdr');
    const prefetched={};
    for(const lane of ['sdr','hdr'])prefetched[lane]=await page.evaluate(async({meta,lane})=>quickShow(meta,lane),{meta:quick,lane});
    const full=await api('reference',{index,edge:1600,key:'f'+index});
    const diff=await page.evaluate(async({quick,full})=>{
     quickCanvas.style.visibility='hidden';
     const box=document.createElement('div');box.style.cssText='position:fixed;inset:0;background:#151515;z-index:10000;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:34px 1fr 34px 1fr';
     const values={};
     for(const lane of ['sdr','hdr']){
      const pics=[];
      for(const [label,meta] of [['Grade',full],['Quick',quick]]){
       const title=document.createElement('div');title.textContent=label+'  -  '+lane.toUpperCase()+'  -  '+meta.path.split(/[\\/]/).at(-1);title.style.cssText='color:white;padding:6px;font:16px sans-serif';box.append(title);
      }
      for(const meta of [full,quick]){
       const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%;object-fit:contain;min-height:0';box.append(canvas);document.body.append(box);
       await quickShow(meta,lane,canvas);
       const pixels=await quickGpu.analyzeScope(canvas,{width:meta.width,height:meta.height,tier:'picture',raw:true});
       pics.push(pixels);
      }
      // Difference uses same-size nearest sample when full/half aspect differs.
      const decode=h=>{const s=(h&0x8000)?-1:1,e=(h>>10)&31,m=h&1023;return s*(e===0?2**-14*m/1024:e===31?(m?NaN:Infinity):2**(e-15)*(1+m/1024));};
      const code=x=>255*(x<=.0031308?12.92*Math.max(0,x):1.055*Math.min(1,x)**(1/2.4)-.055);
      let sum=0,ref=0;const errors=[];
      for(let y=0;y<pics[0].height;y++)for(let x=0;x<pics[0].width;x++)for(let c=0;c<3;c++){
       const a=decode(pics[0].halves[(y*pics[0].width+x)*3+c]);
       const qx=Math.min(pics[1].width-1,Math.floor(x*pics[1].width/pics[0].width)),qy=Math.min(pics[1].height-1,Math.floor(y*pics[1].height/pics[0].height));
       const b=decode(pics[1].halves[(qy*pics[1].width+qx)*3+c]);
       const d=lane==='sdr'?Math.abs(Math.round(code(a))-Math.round(code(b))):Math.abs(a-b);sum+=d;ref+=Math.abs(a);if(lane==='sdr')errors.push(d);
      }
      if(lane==='sdr'){errors.sort((a,b)=>a-b);values.sdr_code_mae=sum/errors.length;values.sdr_code_p99=errors[Math.ceil(errors.length*.99)-1];}
      else values.hdr_relative_mae=sum/Math.max(ref,1e-10);
     }
     window.quickComparisonBox=box;return values;
    },{quick,full});
    const filename=String(index).padStart(2,'0')+'-'+path.basename(quick.path)+'.png';
    await page.screenshot({path:path.join(out,filename)});
    await page.evaluate(()=>{quickComparisonBox.remove();quickCanvas.style.visibility='visible';});
    rows.push({index,path:quick.path,quick,hdr,prefetched,full,difference:diff,image:filename});write('compare',{adapter,rows,complete:false});
    await api('release',{});console.log('Compared '+path.basename(quick.path));
   }
   write('compare',{adapter,rows,complete:true});
  }else if(mode==='interaction'){
   await page.evaluate(()=>{quickCanvas.style.visibility='hidden';});
   const gradeSource=corpus.paths.find(p=>path.basename(p)==='DSC00264.ARW');
   await page.evaluate(async source=>{const selection=await desktop.grantSourcePath(source);await openDesktopSelection({kind:'source',...selection});},gradeSource);
   await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==='ready',null,{timeout:120000});
   async function gestures(){
    const samples=[];
    await page.evaluate(()=>{window.quickGaps=[];window.quickLast=performance.now();window.quickRAF=true;
     function tick(now){if(!quickRAF)return;quickGaps.push(now-quickLast);quickLast=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
    for(let i=0;i<20;i++){
     const before=await page.evaluate(()=>state.acceptedPresentation.generation),start=performance.now();
     await page.evaluate(value=>{const c=document.querySelector('#hdr-exposure');c.value=String(value);c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));},.25+(i%5)*.1);
     await page.waitForFunction(previous=>state.acceptedPresentation?.generation>previous&&state.acceptedPresentation?.exact&&viewerState().status==='ready',before,{timeout:30000,polling:16});samples.push(performance.now()-start);
    }
    return {samples_ms:samples,gaps:await page.evaluate(()=>{quickRAF=false;return quickGaps;})};
   }
   const idle=await gestures();
   const job=page.evaluate(async indices=>{
    window.quickBusy=true;window.quickCompleted=0;const start=performance.now();
    try{for(let round=0;round<8;round++){
     await quickApi('start',{indices,workers:6,edge:1600});
     for(let n=0;n<indices.length;n++){const m=await quickApi('next',{key:'interaction'+round+'-'+n});await quickShow(m,'hdr');quickCompleted++;await quickApi('release',{});}
    }return {elapsed_ms:performance.now()-start,completed:quickCompleted};}finally{quickBusy=false;}
   },corpus.all);
   await page.waitForFunction(()=>window.quickBusy);const busy=await gestures();
   const overlap=await page.evaluate(()=>({active:quickBusy,completed:quickCompleted}));assert.ok(overlap.active,'Gestures must overlap opens');
   const batchResult=await job;write('interaction',{adapter,idle,busy,overlap,batch:batchResult,complete:true});
   await page.evaluate(()=>{state.documentDirty=false;syncDesktopDocumentState();});
   console.log('Grade idle/busy: '+JSON.stringify({idle:idle.samples_ms,busy:busy.samples_ms,overlap}));
  }else throw new Error('Unknown mode '+mode);
 }finally{
  stopping=true;
  if(browser)await browser.close();
  if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(service.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}else service.kill();
  fs.closeSync(log);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
