/* Opt-in profiling, not a regression sweep. Run via tests/run-in-electron.js:
 * tools/profile_cold_picture.js --manifest <JSON array of {kind,path}>.
 * Uses copied originals and the runner's disposable app profile. Both renderers
 * are warmed by actual draws before each phase; each format runs twice.
 * Baseline disables original stand-ins and sends the old Blob transport.
 * Retain hashes, not screenshots/whole response metadata, across photo runs.
 */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),{chromium}=require(path.join(root,'node_modules/playwright'));
const out=path.join(root,'output/cold-first-picture');fs.mkdirSync(out,{recursive:true});const run=path.join(out,String(Date.now()));fs.mkdirSync(run);
const manifest=process.argv[process.argv.indexOf('--manifest')+1];
if(!process.argv.includes('--manifest'))throw Error('Supply --manifest <JSON array of {kind,path}>; input files are copied.');
const samples=JSON.parse(fs.readFileSync(manifest)).filter(x=>['JPEG','PNG','TIFF','HEIC','JXL'].includes(x.kind));
const rows=[];
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();
 for(const phase of ['before','after']){
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});await page.evaluate(()=>activateWorkflowTab('import'));
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
  await lib.evaluate(phase=>{
   const scenes=HDRLibraryScenes;window.HDRLibraryScenes={...scenes,load:(p,e,s,priority=10,...rest)=>priority>=10?Promise.reject(new DOMException('Profile keeps grid cold','AbortError')):scenes.load(p,e,s,priority,...rest)};
   window.HDRLibraryProfile=true;window.coldEvents=[];window.coldResponses=[];
   const log=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(stage,fields)=>{coldEvents.push({stage,at:performance.now(),...fields});log(stage,fields);};
   const fetch0=fetch;window.fetch=async(...args)=>{const start=performance.now();const url=String(args[0]);
    if(phase==='before'&&url.includes('/live-developed')&&args[1]?.body instanceof ArrayBuffer)args[1]={...args[1],body:new Blob([args[1].body])};
    const r=await fetch0(...args);
    if(url.includes('/live-')||url.includes('/preview')||url.includes('/raw-budget/')){
     const entry={url,start,headersMs:performance.now()-start,status:r.status};coldResponses.push(entry);
     if(r.headers.get('content-type')?.includes('application/json'))r.clone().json().then(value=>entry.meta={route:value.route,renderer:value.renderer,width:value.width,height:value.height,source_timings_ms:value.source_timings_ms}).catch(()=>{});
    }return r;};
  },phase);
  if(phase==='before')await page.route('**/api/library/preview',r=>r.fulfill({status:204}));else await page.unroute('**/api/library/preview');
  // Warm both renderers AND their actual draw/measurement pipelines, on a copy.
  const warm=path.join(run,phase+'-warm.png');fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),warm);
  await lib.evaluate(async p=>{for(const [edge,pictures] of [[640,HDRLibraryQuickPictures],[2560,HDRLibraryPictures]]){
   const meta=await HDRLibraryScenes.load(p,edge,undefined,0);meta.fullscreen=true;
   const canvas=document.createElement('canvas');document.body.append(canvas);await pictures.show(meta,canvas,new AbortController().signal,()=>true,true);await(await pictures.initialize()).waitForSubmittedWork();canvas.remove();
  }},warm);
  for(let repeat=0;repeat<2;repeat++)for(const sample of samples){
   const folder=path.join(run,`${phase}-${sample.kind}-${repeat}`);fs.mkdirSync(folder);const photo=path.join(folder,path.basename(sample.path));fs.copyFileSync(sample.path,photo);
   await lib.evaluate(phase=>{coldEvents=[];coldResponses=[];});
   await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
   await lib.locator('.library-cell').first().click();
   await lib.locator('#single-view').click();
   await lib.waitForFunction(p=>coldEvents.some(e=>e.stage==='picture_navigation_to_present'&&e.path===p&&e.sharp_draw),photo,{timeout:120000});
   await lib.waitForFunction(()=>coldEvents.some(e=>e.stage==='picture_store'&&e.success),null,{timeout:60000});
   const result=await lib.evaluate(()=>({events:coldEvents,responses:coldResponses,pixels:document.querySelector('#single-picture').toDataURL()}));
   const presents=result.events.filter(e=>e.stage==='picture_navigation_to_present'&&e.path===photo);
   result.pixelHash=crypto.createHash('sha256').update(result.pixels).digest('hex');delete result.pixels;
   const row={phase,kind:sample.kind,repeat,path:photo,firstMs:presents[0]?.duration_ms,sharpMs:presents.find(e=>e.sharp_draw)?.duration_ms,...result};rows.push(row);
   fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify({phase,kind:sample.kind,repeat,firstMs:row.firstMs,sharpMs:row.sharpMs}));
   await lib.locator('#grid-view').click();
  }
 }
 for(const kind of samples.map(s=>s.kind)){
  const same=rows.filter(r=>r.kind===kind);assert.ok(same.every(r=>r.pixelHash===same[0].pixelHash),kind+' sharp displayed pixels changed');
 }
 console.log('PASS: all five formats, twice per phase; sharp canvas pixels exactly unchanged.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
