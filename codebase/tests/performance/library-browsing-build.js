/* Real shipped Library UI, M10 sources/order, disposable D: copies only.
 * Run via run-in-electron.js; COLD_READS bypasses Windows cache, not drive firmware.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=process.env.HDR_LIBRARY_BROWSE_OUTPUT||path.join(root,'output/library-browsing-build');
fs.mkdirSync(out,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(process.env.HDR_LIBRARY_BROWSE_MANIFEST || path.join(root,'output/library-raw-deep-dive/manifest.json'),'utf8'));
function photos(name,count=30){
 if(process.argv.includes('--reuse-copies')) {
  const existing=fs.readdirSync(out).find(file=>file.startsWith(name+'-')&&fs.statSync(path.join(out,file)).isDirectory()&&fs.readdirSync(path.join(out,file)).length===count);
  if(existing)return path.join(out,existing);
 }
 const folder=fs.mkdtempSync(path.join(out,name+'-'));
 for(let i=0;i<count;i++)fs.copyFileSync(manifest.paths[i],path.join(folder,String(i).padStart(2,'0')+'-'+path.basename(manifest.paths[i])));
 return folder;
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>!!window.HDRLibrary);
  await lib.evaluate(()=>{
   window.browseEvents=[];const original=HDRLibraryStopwatch;
   window.HDRLibraryStopwatch=(stage,fields)=>{browseEvents.push({stage,at:performance.now(),...fields});original(stage,fields);};
   window.browseKey=key=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
  });
  const results={method:'Real Library navigation, M10 30-file camera order (18 distinct sources), fresh paths/caches; production Windows reader with unbuffered timing option; two RAFs are composition opportunity, not panel scanout.',grid:[],browse:[],errors};
  const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  async function open(folder){
   await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
   const snapshot=await lib.evaluate(()=>HDRLibrary.getSnapshot());
   if(snapshot.sort!=='name'||snapshot.descending){await lib.locator('#sort-button').click();await lib.locator('[data-sort="name"]').click();}
   await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===30);
  }
  // Full visible grid, before any user entry to Single. Includes selected-photo
  // read-ahead in the new build. The baseline uses the prior committed app.
  const gridFolder=process.env.HDR_LIBRARY_GRID_FOLDER||photos('grid');const gridStart=Date.now();await open(gridFolder);
  await lib.waitForFunction(()=>document.querySelectorAll('#grid-space canvas[data-picture-key]').length===30,null,{timeout:90000});
  results.grid.push({all_30_ms:Date.now()-gridStart});save();console.log('GRID',results.grid[0]);
  if(process.argv.includes('--grid-only')){assert.deepEqual(errors,[]);return;}
  results.options=await lib.evaluate(()=>fetch('/api/library/options').then(r=>r.json()));
  results.screen=await lib.evaluate(()=>({width:screen.width,height:screen.height,dpr:devicePixelRatio}));
  for(let repeat=0;repeat<1;repeat++)for(const scenario of process.argv.includes('--cache-only')?[]:[
   {name:'steady',interval:500,count:30}, {name:'fast',interval:250,count:30},
   {name:'maximum',interval:100,count:30}, {name:'burst',interval:100,count:8},
   {name:'cold-jump',interval:100,count:1,jump:29},
  ]){
   const folder=photos(scenario.name), opened=Date.now();await open(folder);
   // The user's grid selection starts preparation. Enter when its own thumbnail
   // appears, with no arbitrary wait to prefill the first dozen.
   await lib.waitForFunction(()=>document.querySelector('#grid-space canvas[data-picture-key]'),null,{timeout:30000});
   const gridHeadStart=Date.now()-opened;
   const r=await lib.evaluate(async({scenario,repeat,gridHeadStart})=>{
    const photos=HDRLibrary.getSnapshot().paths, rows=[],started=performance.now();
    browseEvents=[];browseKey('f');
    if(scenario.jump!==undefined) { await new Promise(r=>setTimeout(r,35));for(let i=0;i<scenario.jump;i++)browseKey('ArrowRight'); }
    for(let j=0;j<scenario.count;j++){
     const deadline=started+j*scenario.interval;
     await new Promise(r=>setTimeout(r,Math.max(0,deadline-performance.now())));
     const index=scenario.jump??j, target=photos[index];
     const ready=await fetch('/api/library/raw-ready').then(r=>r.json());
     const meta=ready.ready.find(m=>m.path===target);
     const sharp=!!meta&&HDRLibraryPictures.resident(meta.key);
     const at=performance.now();
     if(j>0)browseKey('ArrowRight');
     rows.push({index,path:target,selected_ms:at-started,lateness_ms:at-deadline,sharp_when_reached:sharp});
    }
    const last=rows.at(-1),landed=started+last.selected_ms;
    const current=()=>{const c=document.querySelector('#single-picture');return c.dataset.picturePath===last.path&&Number(c.dataset.pictureEdge)>=1280;};
    const timeout=performance.now()+20000;
    while(!current()&&performance.now()<timeout)await new Promise(r=>setTimeout(r,5));
    if(!current())throw Error('Stopped photo did not become sharp: '+last.path);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const wait=performance.now()-landed;
    const status=await fetch('/api/library/raw-ready').then(r=>r.json());
    const output={scenario,repeat,grid_head_start_ms:gridHeadStart,rows,
     sharp_ready_at_selection:rows.filter(r=>r.sharp_when_reached).length,final_wait_ms:wait,
     max_selection_lateness_ms:Math.max(...rows.map(r=>r.lateness_ms)),gpu:HDRLibraryPictures.snapshot(),
     status,events:browseEvents.slice()};
    browseKey('Escape');return output;
   },{scenario,repeat,gridHeadStart});
   results.browse.push(r);save();console.log('BROWSE',repeat,scenario.name,r.sharp_ready_at_selection,Math.round(r.final_wait_ms),'grid',gridHeadStart);
   assert.equal(fs.readdirSync(folder).length,30,'Browsing writes no settings beside sources');
  }
  // Explicit already-read condition: prepare the CPU transport without asking
  // the GPU to convert it. Then time real UI navigation and a recent return.
  await open(gridFolder);
  const target=await lib.evaluate(()=>HDRLibrary.getSnapshot().paths[20]);
  const response=await HDRFinisherElectronTestHarness.fetch('/api/library/picture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:target,edge:2560,quality:'quick',priority:50})});
  assert.equal(response.status,200,'Read-ahead transport setup');const meta=await response.json();
  results.cached=await lib.evaluate(async(meta)=>{
   const paths=HDRLibrary.getSnapshot().paths,target=paths[20];
   const alreadyGPU=HDRLibraryPictures.resident(meta.key);
   const wait=async(path)=>{
    const deadline=performance.now()+20000;
    while(performance.now()<deadline){const c=document.querySelector('#single-picture');if(c.dataset.picturePath===path&&Number(c.dataset.pictureEdge)>=1280){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return;}await new Promise(r=>setTimeout(r,5));}
    throw Error('Cache navigation did not settle');
   };
   browseKey('f');const start=performance.now();for(let i=0;i<20;i++)browseKey('ArrowRight');await wait(target);
   const readAheadStop=performance.now()-start;
   browseKey('ArrowRight');await wait(paths[21]);const back=performance.now();browseKey('ArrowLeft');await wait(target);
   return {already_decoded_stop_ms:readAheadStop,was_already_on_gpu:alreadyGPU,recent_back_ms:performance.now()-back};
  },meta);
  console.log('CACHE',results.cached);
  results.complete=true;save();assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
