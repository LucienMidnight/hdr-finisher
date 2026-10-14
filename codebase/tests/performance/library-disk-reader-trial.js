/* M10 uses the M9 renderer verbatim. Only test service and workloads differ. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
let source=fs.readFileSync(path.join(__dirname,'library-raw-deep-dive.js'),'utf8');
source=source.slice(0,source.indexOf(' const api=(route,body)'))
 .replaceAll('output/library-raw-deep-dive','output/library-disk-reader-trial')
 .replaceAll('library-raw-deep-dive.py','library-disk-reader-trial.py')
 .replaceAll('8809','8810');
source=source.replace('const setup=await lib.evaluate', "page.on('requestfailed',r=>console.error('request failed',r.url(),r.failure()));const setup=await lib.evaluate");
source+=String.raw`
 const api=(route,body)=>lib.evaluate(({route,body})=>trialApi(route,body),{route,body});
 const results=fs.existsSync(path.join(out,'gpu.json'))?JSON.parse(fs.readFileSync(path.join(out,'gpu.json'),'utf8')):{setup,method:'M9 GPU route verbatim; single unbuffered D: reader; 12 ahead, 40 RAW cache; two below-normal one-thread decoders, reserved normal-priority viewed lane; two RAF composition opportunity',background:[],viewed:[],browse:[],complete:false};
 await lib.evaluate(async()=>{let m=await trialApi('prepare',{index:0,route:'gpu',key:'warm'});trialGpu.resetSession(m.key);await trialConvert(m);await trialShow(m,false,trialCanvas,false);});
 // Per-job timestamps share the service monotonic clock; renderer durations
 // are joined through ready_at, rather than mixing clocks across processes.
 await lib.evaluate(()=>{
  window.drawM10=async m=>{const t=performance.now();trialGpu.resetSession(m.key);const conversion=await trialConvert(m);const draw=await trialShow(m,false,trialCanvas,false);return {meta:m,conversion,draw,handoff_draw_ms:performance.now()-t};};
 });
 for(const count of [7,30])for(let repeat=0;repeat<2;repeat++){
  const category=count===7?'background':'background_long';results[category]??=[];
  if(results[category].some(r=>r.repeat===repeat))continue;
  const r=await lib.evaluate(async({repeat,count})=>{
   const start=await trialApi('start',{indices:Array.from({length:count},(_,i)=>i),selected:-1,batch:true});const t=performance.now(),seen=new Set(),rows=[];let requested=false,fgAt=null,fg=null;
   while(rows.length<count){
    if(!requested&&performance.now()-t>=200){fgAt=performance.now();await trialApi('select',{index:6});requested=true;}
    let s=await trialApi('status',{});
    // Background batch continues after viewed priority is requested.
    for(const m of s.ready.sort((a,b)=>(b.index===6)-(a.index===6))){if(seen.has(m.index))continue;seen.add(m.index);const d=await drawM10(m);d.finished_ms=performance.now()-t;rows.push(d);if(m.index===6)fg={...d,end_to_end_ms:performance.now()-fgAt};}
    if(performance.now()-t>30000)throw Error('background timeout');await new Promise(r=>setTimeout(r,10));
   }
   return {repeat,rows,foreground:fg,wall_ms:Math.max(...rows.filter(r=>r.meta.index!==6).map(r=>r.finished_ms)),status:await trialApi('status',{})};
  },{repeat,count});r.photos_per_second=(count-1)*1000/r.wall_ms;results[category].push(r);write('gpu.json',results);console.log('M10',category,repeat,r.photos_per_second,r.foreground.end_to_end_ms);
 }
 for(const cached of [true,false])for(let repeat=0;repeat<2;repeat++)for(let index=0;index<6;index++){
  if(results.viewed.some(r=>r.cached===cached&&r.repeat===repeat&&r.index===index))continue;
  const r=await lib.evaluate(async({cached,repeat,index})=>{
   await trialApi('start',{indices:[6,7,8,9,10,11,12,13,14,15,16,17],selected:-1,prefill:cached?[index]:[]});
   await new Promise(r=>setTimeout(r,30));const t=performance.now();const selected=await trialApi('select',{index});let row;
   // Viewed changes priority; background requested above must still run.
   while(!row){const s=await trialApi('status',{});const m=s.ready.find(r=>r.index===index);if(m)row=await drawM10(m);else await new Promise(r=>setTimeout(r,5));if(performance.now()-t>15000)throw Error('viewed timeout');}
   return {cached,repeat,index,...row,end_to_end_ms:performance.now()-t,selected,status:await trialApi('status',{})};
  },{cached,repeat,index});results.viewed.push(r);write('gpu.json',results);console.log('M10 viewed',cached,repeat,index,r.end_to_end_ms.toFixed(1));
 }
 for(let repeat=0;repeat<2;repeat++)for(const scenario of [
  {name:'steady',interval:500,count:30}, {name:'fast',interval:250,count:30}, {name:'maximum',interval:100,count:30},
  {name:'burst',interval:100,count:8}, {name:'cold-jump',interval:100,count:1,jump:29}, {name:'cached-burst',interval:100,count:8,prefill:true}
 ]){
  if(results.browse.some(r=>r.repeat===repeat&&r.scenario.name===scenario.name))continue;
  const r=await lib.evaluate(async({scenario,repeat})=>{
   const indices=Array.from({length:30},(_,i)=>i);const start=await trialApi('start',{indices,selected:0,prefill:scenario.prefill?indices.slice(0,13):[]});
   const t=performance.now(),frames=new Map(),rows=[],draws=[],errors=[];let stop=false,current=0;
   const painter=(async()=>{while(!stop){try{
    const s=await trialApi('status',{});
    for(const m of s.ready.sort((a,b)=>Math.abs(a.index-current)-Math.abs(b.index-current))){
     if(frames.has(m.index)||m.index<current)continue;
     const begin=performance.now();trialGpu.resetSession(m.key);const conversion=await trialConvert(m);
     const c=document.createElement('canvas');c.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:black;z-index:10001;visibility:hidden';document.body.append(c);
     const draw=await trialShow(m,false,c,false);const d={index:m.index,meta:m,conversion,draw,handoff_draw_ms:performance.now()-begin,prepared_ms:performance.now()-t};draws.push(d);
     frames.set(m.index,{canvas:c,at:performance.now()});
     if(m.index===current){for(const f of frames.values())f.canvas.style.visibility='hidden';c.style.visibility='visible';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));frames.get(m.index).screen_at=performance.now();}
     for(const [i,f] of frames)if(i<current-1){f.canvas.remove();frames.delete(i);}
    }await new Promise(r=>setTimeout(r,5));
   }catch(e){errors.push(String(e));break;}}})();
   if(scenario.jump!==undefined)await new Promise(r=>setTimeout(r,35));
   for(let j=0;j<scenario.count;j++){
    const deadline=t+j*scenario.interval;await new Promise(r=>setTimeout(r,Math.max(0,deadline-performance.now())));
    const i=scenario.jump??j;current=i;const at=performance.now();const ready=frames.has(i);
    rows.push({index:i,selected_ms:at-t,lateness_ms:at-deadline,sharp_when_reached:ready});
    if(ready){for(const f of frames.values())f.canvas.style.visibility='hidden';frames.get(i).canvas.style.visibility='visible';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));frames.get(i).screen_at=performance.now();}
    const selection=await trialApi('select',{index:i});rows.at(-1).raw_cached=selection.raw_cached;
   }
   const last=rows.at(-1),landed=t+last.selected_ms,timeout=performance.now()+20000;
   while(!frames.get(last.index)?.screen_at&&!errors.length&&performance.now()<timeout)await new Promise(r=>setTimeout(r,5));
   const wait=frames.get(last.index)?.screen_at?Math.max(0,frames.get(last.index).screen_at-landed):null;
   stop=true;await painter;const status=await trialApi('status',{});for(const f of frames.values())f.canvas.remove();
   return {scenario,repeat,start,rows,draws,status,sharp_ready_at_selection:rows.filter(r=>r.sharp_when_reached).length,final_wait_ms:wait,max_selection_lateness_ms:Math.max(...rows.map(r=>r.lateness_ms)),errors};
  },{scenario,repeat});results.browse.push(r);write('gpu.json',results);console.log('M10 browse',repeat,scenario.name,r.sharp_ready_at_selection,r.final_wait_ms);
 }
 results.complete=true;write('gpu.json',results);
 }finally{if(browser)await browser.close().catch(()=>{});if(service.exitCode===null)try{execFileSync('taskkill',['/PID',String(service.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}fs.closeSync(log);}
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
const compiled=new Module(__filename,module);compiled.filename=__filename;compiled.paths=module.paths;compiled._compile(source,__filename);
