/* Opt-in profiling, not a regression sweep. Run with bounded debug upload metadata:
 * node --require ./tools/profile_cold_picture_network.cjs tests/run-in-electron.js
 * tools/profile_cold_picture.js --manifest <JSON array of {kind,path}>.
 * Uses copied originals and the runner's disposable app profile. Both renderers
 * are warmed by actual draws before each photo; each format runs twice.
 * Baseline selects the preceding backend-acceptance path; both phases keep original stand-ins.
 * Retain hashes, not screenshots/whole response metadata, across photo runs.
 */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),{chromium}=require(path.join(root,'node_modules/playwright'));
const out=path.join(root,'../output/cold-nonraw-sharp');fs.mkdirSync(out,{recursive:true});const resume=process.argv.includes('--resume')?process.argv[process.argv.indexOf('--resume')+1]:null;const run=resume?path.resolve(resume):path.join(out,String(Date.now()));fs.mkdirSync(run,{recursive:true});
const manifest=process.argv[process.argv.indexOf('--manifest')+1];
if(!process.argv.includes('--manifest'))throw Error('Supply --manifest <JSON array of {kind,path}>; input files are copied.');
const samples=JSON.parse(fs.readFileSync(manifest)).filter(x=>['JPEG','PNG','TIFF','HEIC','JXL'].includes(x.kind));
const rows=resume?JSON.parse(fs.readFileSync(path.join(run,'results.json'))).filter(r=>r.stored&&r.finished?.hdr&&r.finished?.sdr&&!r.error):[];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const originals=resume&&fs.existsSync(path.join(run,'input-hashes.json'))?JSON.parse(fs.readFileSync(path.join(run,'input-hashes.json'))):samples.map(s=>({path:s.path,sha256:hash(s.path)}));
for(const original of originals)assert.equal(hash(original.path),original.sha256,'Experiment input changed before resume');fs.writeFileSync(path.join(run,'input-hashes.json'),JSON.stringify(originals,null,2));
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();
 for(const phase of ['before','after'])for(let repeat=0;repeat<2;repeat++)for(const sample of samples){
  if(rows.some(r=>r.phase===phase&&r.kind===sample.kind&&r.repeat===repeat))continue;
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.evaluate(()=>activateWorkflowTab('import'));
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
  await lib.evaluate(phase=>{
   const scenes=HDRLibraryScenes;window.HDRLibraryScenes={...scenes,load:(p,e,s,priority=10,...rest)=>priority>=10?Promise.reject(new DOMException('Profile keeps grid cold','AbortError')):scenes.load(p,e,s,priority,...rest)};
   window.HDRLibraryProfile=true;window.HDRLibraryProfileLegacy=phase==='before';window.coldEvents=[];window.coldResponses=[];
   const log=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(stage,fields)=>{coldEvents.push({stage,at:performance.now(),...fields});log(stage,fields);};
   const fetch0=fetch;window.fetch=async(...args)=>{const start=performance.now();const url=String(args[0]);
    const r=await fetch0(...args);
    if(url.includes('/live-')||url.includes('/preview')||url.includes('/raw-budget/')){
     const entry={url,start,headersMs:performance.now()-start,backendPixelsMs:r.headers.get("X-Library-Pixels-Ms"),backendPixelQueueMs:r.headers.get("X-Library-Pixels-Queue-Ms"),status:r.status};coldResponses.push(entry);
     if(r.headers.get('content-type')?.includes('application/json'))r.clone().json().then(value=>entry.meta={route:value.route,renderer:value.renderer,width:value.width,height:value.height,source_timings_ms:value.source_timings_ms}).catch(()=>{});
    }return r;};
  },phase);
  // Warm both renderers AND their actual draw/measurement pipelines, on a copy.
  const warm=path.join(run,phase+'-'+sample.kind+'-'+repeat+'-warm.png');fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),warm);
  await lib.evaluate(async p=>{for(const [edge,pictures] of [[640,HDRLibraryQuickPictures],[2560,HDRLibraryPictures]]){
   const meta=await HDRLibraryScenes.load(p,edge,undefined,0);meta.fullscreen=true;
   const canvas=document.createElement('canvas');document.body.append(canvas);await pictures.show(meta,canvas,new AbortController().signal,()=>true,true);await(await pictures.initialize()).waitForSubmittedWork();canvas.remove();
  }},warm);
   let row;try{
   const folder=path.join(run,`${phase}-${sample.kind}-${repeat}-${Date.now()}`);fs.mkdirSync(folder);const photo=path.join(folder,path.basename(sample.path));fs.copyFileSync(sample.path,photo);
   await lib.evaluate(()=>{coldEvents=[];coldResponses=[];});
   await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
   await lib.locator('.library-cell').first().click();
   await lib.locator('#single-view').click();
   await lib.waitForFunction(p=>coldEvents.some(e=>e.stage==='picture_navigation_to_present'&&e.path===p&&e.sharp_draw),photo,{timeout:120000});
   const result=await lib.evaluate(()=>({events:coldEvents,responses:coldResponses,pixels:document.querySelector('#single-picture').toDataURL()}));
   const presents=result.events.filter(e=>e.stage==='picture_navigation_to_present'&&e.path===photo&&e.view==='single');
   const navigationAt=result.events.find(e=>e.stage==='navigation'&&e.path===photo&&e.view==='single').at;
   result.pixelHash=crypto.createHash('sha256').update(result.pixels).digest('hex');delete result.pixels;
   row={phase,kind:sample.kind,repeat,path:photo,firstMs:presents[0]?.at-navigationAt,sharpMs:presents.find(e=>e.sharp_draw)?.at-navigationAt,...result};rows.push(row);
   fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify({phase,kind:sample.kind,repeat,firstMs:row.firstMs,sharpMs:row.sharpMs}));
   // Timings survive a later store/capture failure. Keep each photo's finished
   // HDR and authored SDR pixels before monitor encoding, not a canvas screenshot.
   Object.assign(row,await lib.evaluate(()=>({events:coldEvents,responses:coldResponses})));
   row.finished={};
   for(const lane of ['hdr','sdr']){
    const data=await lib.evaluate(async ({photo,lane})=>{
     const meta=await HDRLibraryScenes.load(photo,2560,undefined,0);meta.fullscreen=true;
     const factory=HDRLibraryPictures,gpu=await factory.initialize(),canvas=document.createElement('canvas');
     const original=gpu.renderTo;let capture;
     gpu.renderTo=async function(target,...args){const result=await original.call(this,target,...args);
      if(result?.rendered || result?.execution==='direct')capture=await this.analyzeScope(target,{width:meta.width,height:meta.height,tier:'picture',raw:true});return result;};
     try{await factory.show(meta,canvas,new AbortController().signal,()=>true,lane==='hdr');}finally{gpu.renderTo=original;canvas.remove();}
     if(!capture?.halves)throw Error('Missing finished '+lane+' pixels');
     const bytes=new Uint8Array(capture.halves.buffer);let data='';for(let n=0;n<bytes.length;n+=16384)data+=String.fromCharCode(...bytes.subarray(n,n+16384));
     return btoa(data);
    },{photo,lane});
    const bytes=Buffer.from(data,'base64');fs.writeFileSync(path.join(run,`${phase}-${sample.kind}-${repeat}-${lane}.f16`),bytes);
    row.finished[lane]=crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(rows,null,2));
   }
   await lib.waitForFunction(()=>coldEvents.some(e=>e.stage==='picture_store'&&e.success),null,{timeout:60000});
   Object.assign(row,await lib.evaluate(()=>({events:coldEvents,responses:coldResponses})));
   row.stored=true;fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(rows,null,2));
   console.log(JSON.stringify({phase,kind:sample.kind,repeat,finished:row.finished,stored:true}));
   await lib.locator('#grid-view').click();
   }catch(error){if(!row){row={phase,kind:sample.kind,repeat};rows.push(row);}row.error=error.stack;fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(rows,null,2));console.error(JSON.stringify({phase,kind:sample.kind,repeat,error:error.message}));await lib.locator('#grid-view').click().catch(()=>{});}
 }
 assert.equal(rows.length,samples.length*4);assert.ok(rows.every(r=>!r.error),'A sample failed; see incremental results.json');
 for(const kind of samples.map(s=>s.kind)){
  const same=rows.filter(r=>r.kind===kind);for(const lane of ['hdr','sdr'])assert.ok(same.every(r=>r.finished?.[lane]===same[0].finished?.[lane]),kind+' finished '+lane+' pixels changed');
 }
 for(const original of originals)assert.equal(hash(original.path),original.sha256,'Copied experiment input changed');
 for(const row of rows){assert.equal(hash(row.path),originals.find(o=>o.path===samples.find(s=>s.kind===row.kind).path).sha256,'Profile photo changed');assert.ok(!fs.existsSync(row.path+'.hdrf'),'Unexpected photo sidecar');}
 fs.writeFileSync(path.join(run,'input-hashes.json'),JSON.stringify(originals,null,2));
 console.log('PASS: all five formats, twice per phase; finished HDR and SDR pixels exactly unchanged.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
