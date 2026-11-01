/* Finished pixels through the grid (640) and Single (2560) render entry points.
 * Run with run-in-electron.js, --phase=before|after --edge=640|2560.
 * Each invocation needs a fresh test- profile. Sources are reusable fixture copies.
 */
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),arg=(k,d)=>process.argv.find(a=>a.startsWith('--'+k+'='))?.split('=')[1]??d;
const phase=arg('phase','after'),edge=Number(arg('edge',640));
if(!['before','after','retry-before','retry-after'].includes(phase)||![640,2560].includes(edge))throw Error('Invalid capture phase/edge');
const folder=path.join(root,'output/test-photos/library-mixed-v1-run'),out=path.join(root,'output/library-freeze-pixels',phase,String(edge));
fs.mkdirSync(out,{recursive:true});
const photos=fs.readdirSync(folder).filter(n=>!n.endsWith('.hdrf')&&!n.startsWith('.')).map(n=>path.join(folder,n));
const only=process.env.HDR_FINISHER_PIXEL_ONLY;
const report=process.argv.includes('--resume')?JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8')):{phase,edge,view:edge===640?'grid':'single',rows:[]};
if(report.phase!==phase||report.edge!==edge)throw Error('Resume phase/edge mismatch');
const completed=new Set(report.rows.map(row=>row.name));
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
 await page.evaluate(()=>activateWorkflowTab('import'));
 const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibraryPictures);
 await lib.evaluate(async()=>{await fetch('/api/library/memory-setting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bytes:4e9})});});
 for(const [index,photo] of photos.entries()){
  if(completed.has(path.basename(photo))||only&&!only.split('|').includes(path.basename(photo)))continue;
  console.log('CAPTURE',phase,edge,index,path.basename(photo));
  const row=await lib.evaluate(async({photo,edge})=>{
   const w=window,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
   const record={name:photo.replaceAll('\\','/').split('/').pop(),photo};
   let canvas,gpu,original,captured,refusal;
   const watch=setInterval(()=>{const job=HDRLibraryGrants.snapshot().jobs.find(j=>j.path===photo&&j.reason==='needs more memory'&&j.estimate>4e9);if(job){refusal='Needs more memory: '+job.estimate;controller.abort();}},250);
   try{
    HDRLibraryScenes.viewport([photo],[]);
    const meta=await HDRLibraryScenes.load(photo,edge,controller.signal,0,false,null,{viewportDemand:true});
    record.width=meta.width;record.height=meta.height;record.route=meta.route;record.actual_edge=meta.edge;record.lanes={};
    gpu=await HDRLibraryPictures.initialize();original=gpu.renderTo;
    gpu.renderTo=async function(target,...args){const result=await original.call(this,target,...args);captured=await this.analyzeScope(target,{width:args[9].width,height:args[9].height,tier:'picture',raw:true});return result;};
    canvas=document.createElement('canvas');canvas.id=edge===640?'fixture-grid-picture':'fixture-single-picture';document.body.append(canvas);
    for(const lane of ['sdr','hdr']){
     captured=null;await HDRLibraryPictures.show(meta,canvas,controller.signal,()=>true,lane==='hdr');
     if(!captured?.halves)throw Error('No finished pixels');
     const bytes=new Uint8Array(captured.halves.buffer);let binary='';
     for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
     record.lanes[lane]=btoa(binary);
    }
   }catch(error){record.error=refusal||String(error.message||error);}
   finally{clearTimeout(timer);clearInterval(watch);HDRLibraryScenes.viewport([],[]);if(gpu&&original)gpu.renderTo=original;canvas?.remove();}
   return record;
  },{photo,edge});
  if(row.lanes){for(const [lane,b64] of Object.entries(row.lanes)){const file=index+'-'+lane+'.f16';fs.writeFileSync(path.join(out,file),Buffer.from(b64,'base64'));row.lanes[lane]=file;}}
  report.rows.push(row);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));
 }
 report.complete=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
