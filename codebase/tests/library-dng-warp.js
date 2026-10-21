/* Focused DNG Library route: real finished pixels, geometry and matched mixed folders. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-dng-warp',String(Date.now()));fs.mkdirSync(folder,{recursive:true});
// Locate private fixture without depending on its containing subfolder.
function locate(dir,name){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){const found=locate(file,name);if(found)return found;}else if(entry.name===name)return file;}}
const runs=[];
const repeats=process.argv.includes('--measure')?3:1;
const selected=process.argv.find(arg=>arg.startsWith('--sample='))?.slice(9);
const samples=process.argv.includes('--geometry-only')?[]:selected?[selected]:['DJI_0071.DNG','DSC06885_DxO-neutral.dng','DJI_0071-2-HDR.dng'];
for(const sample of samples)for(let repeat=0;repeat<repeats;repeat++)for(const mode of (repeat%2?['gpu','cpu']:['cpu','gpu'])){
 const dir=path.join(folder,`${sample}-${repeat}-${mode}`);fs.mkdirSync(dir);
 for(const [name,src] of [[sample,locate(path.join(root,'local-test-media/inputs/linear-dng'),sample)],['small.png',path.join(root,'tests/fixtures/sdr_gradient.png')]])fs.copyFileSync(src,path.join(dir,name));
 runs.push({dir,mode,repeat,sample});
}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
 const frame=page.frameLocator('#library-frame'),button=frame.locator('#hdr-button');
 await button.click();const clicked=await button.getAttribute('aria-pressed');await page.keyboard.press('h');
 assert.notEqual(await button.getAttribute('aria-pressed'),clicked);
 assert.equal(await button.evaluate(b=>b.matches(':focus-visible')),false,'H must not leave an extra focus ring');
 await page.keyboard.down('h');const held=await button.getAttribute('aria-pressed');await page.keyboard.down('h');assert.equal(await button.getAttribute('aria-pressed'),held);await page.keyboard.up('h');
 await page.keyboard.press('Tab');await button.focus();assert.equal(await button.evaluate(b=>b.matches(':focus-visible')),true,'normal keyboard focus remains visible');await button.evaluate(b=>b.blur());
 console.log('H shortcut matches click; keyboard focus retained');
 const probes=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/helpers/library_dng_geometry.py')],{cwd:root,encoding:'utf8',maxBuffer:1<<24}));
 const geometry=await page.locator('#library-frame').evaluate(async(element,probes)=>{
  const w=element.contentWindow;let worst=0;
  for(const probe of probes){const data=Uint8Array.from(w.atob(probe.input),c=>c.charCodeAt(0));if(probe.meta.dng_support)probe.meta.dng_support=new Float32Array(probe.meta.dng_support);
   const result=await w.HDRLibraryRGB.develop({mosaic:data,meta:probe.meta,edges:[100000]});
   for(let c=0;c<3;c++){const actual=new Float32Array(result.reduced[100000].planes[c]);
    for(let i=0;i<actual.length;i++)worst=Math.max(worst,Math.abs(actual[i]-probe.expected[c][i]));}
  }
  if(worst>=.0001)throw Error('Synthetic warp/edge error exceeds 0.0001: '+worst);
  const probe=probes.find(p=>p.meta.dng_gain_maps?.length),data=Uint8Array.from(w.atob(probe.input),c=>c.charCodeAt(0));
  let submissions=0,cancelled=false;
  try{await w.HDRLibraryRGB.develop({mosaic:data,meta:probe.meta,edges:[100000],beforeSubmit:async()=>{if(++submissions===4)throw Error('test cancellation');}});}catch(error){cancelled=error.message==='test cancellation';}
  if(!cancelled)throw Error('DNG work did not respect a submission cancellation');
  let bounded=false;try{await w.HDRLibraryRGB.develop({mosaic:data,meta:probe.meta,memoryBudget:64});}catch(error){bounded=error.message.includes('budget');}
  if(!bounded)throw Error('DNG work exceeded its reservation');
  await w.HDRLibraryRGB.develop({mosaic:data,meta:probe.meta,edges:[100000]});
  return {cases:probes.length,worst,cancellation:cancelled,budget:bounded};
 },probes);console.log('Geometry',JSON.stringify(geometry));
 const rows=[];
 for(const run of runs){
  console.log('Starting',run.mode,run.repeat);
  const result=await page.locator('#library-frame').evaluate(async(element,run)=>{
   const w=element.contentWindow;if(run.mode==='cpu')w.localStorage.setItem('library-gpu-raw','off');else w.localStorage.removeItem('library-gpu-raw');
   const fetch=w.fetch.bind(w),seen=[];w.fetch=async(...args)=>{const response=await fetch(...args);if(String(args[0]).includes('/live-scene')&&response.status===204)seen.push(response.headers.get('X-Library-Fallback'));return response;};
   const begun=performance.now();await w.HDRLibrary.browse(run.dir);
   let first=null,finished=null,activity=false,ticks=0,panelNamed=false;
   const activityButton=w.document.querySelector("#index-status");if(w.document.querySelector("#library-activity").hidden)activityButton.click();
   const interval=setInterval(()=>{ticks++;if(w.document.querySelector("#library-activity").textContent.includes(run.sample))panelNamed=true;const jobs=w.HDRLibraryScenes.snapshot();if(Object.values(jobs).some(q=>q.jobs.some(j=>j.path.endsWith(run.sample))))activity=true;},25);
   try{
    while(performance.now()-begun<240000){
     const canvases=[...w.document.querySelectorAll('#grid-space .library-cell canvas[data-picture-key]')].filter(c=>!c.hidden);
     const pictures=[...w.document.querySelectorAll('#grid-space .library-cell img')].filter(i=>!i.hidden&&i.src);
     if(first===null&&(canvases.length||pictures.length))first=performance.now()-begun;
     if(canvases.length===2){finished=performance.now()-begun;break;}
     await new Promise(r=>setTimeout(r,25));
    }
   }finally{clearInterval(interval);w.fetch=fetch;}
   if(finished===null)throw Error('Mixed folder did not finish: '+seen.join(';'));
   const photo=run.dir+'/'+run.sample;const meta=await w.HDRLibraryScenes.load(photo,640);const large=await w.HDRLibraryScenes.load(photo,2560);
   if(meta.renderer!==run.mode)throw Error('Wrong DNG route: '+JSON.stringify({renderer:meta.renderer,seen}));
   if(!activity||!panelNamed||ticks<3)throw Error('No responsive named Activity while source ran');
   const gpu=await w.HDRLibraryPictures.initialize(),render=gpu.renderTo,lanes={};let captured;
   gpu.renderTo=async function(canvas,...args){const value=await render.call(this,canvas,...args);captured=await this.analyzeScope(canvas,{width:args[9].width,height:args[9].height,tier:'picture',raw:true});return value;};
   try{for(const lane of ['hdr','sdr']){const canvas=w.document.createElement('canvas');w.document.body.append(canvas);await w.HDRLibraryPictures.show(meta,canvas,new w.AbortController().signal,()=>true,lane==='hdr');const bytes=new Uint8Array(captured.halves.buffer);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));lanes[lane]=w.btoa(binary);canvas.remove();}}
   finally{gpu.renderTo=render;}
   return {photo,meta,large,lanes,firstMs:first,finishedMs:finished,activity,panelNamed,ticks};
  },run);
  rows.push({...run,...result});fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({rows}));console.log(JSON.stringify({...run,firstMs:result.firstMs,finishedMs:result.finishedMs,stages:result.meta.source_timings_ms}));
 }
 const file=path.join(folder,'results.json');fs.writeFileSync(file,JSON.stringify({rows}));
 console.log('Evidence:',file);
 if(!rows.length)return;
 const report=execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/helpers/library_dng_compare.py'),file],{cwd:root,encoding:'utf8',timeout:300000,maxBuffer:1<<24});console.log(report);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
