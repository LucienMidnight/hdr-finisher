/* One real D:\Photos profile on a disposable Library snapshot. */
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path");
(async()=>{
 const folder=process.env.HDR_LIBRARY_LARGE_FOLDER,profile=process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
 if(!folder || !profile || !path.basename(profile).startsWith("hdr-large-folder-profile-"))throw Error("A disposable Library profile with source writes disabled is required.");
 const browser=await chromium.launch(),page=await browser.newPage();
 const out=path.resolve(__dirname,"../../output/library-viewport-batch");fs.mkdirSync(out,{recursive:true});
 const result={folder,profile,errors:[],events:[]};page.on("pageerror",error=>result.errors.push(error.message));
 try{
  await page.goto(new URL("/library",process.env.HDR_FINISHER_URL).href,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.HDRLibrary && document.body.dataset.libraryReady==="true");
  await page.evaluate(()=>{window.profileEvents=[];const original=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(stage,fields)=>{profileEvents.push({stage,at:performance.now(),...fields});original(stage,fields);};});
  const opened=Date.now();await page.evaluate(folder=>{void HDRLibrary.browse(folder);},folder);
  await page.waitForFunction(folder=>profileEvents.some(e=>e.stage==="folder_listed"&&e.path===folder),folder,{timeout:90000});
  result.indexed_ms=Date.now()-opened;
  const log=fs.readFileSync(path.join(profile,"logs/backend.log"),"utf8");
  const opens=[...log.matchAll(/\[library\] folder_open_all_rows (.*)/g)].map(m=>JSON.parse(m[1]));
  result.backend_open=opens.findLast(e=>e.folder===folder);
  if(!result.backend_open || result.backend_open.rows<150000)throw Error("Log does not confirm the requested large folder");
  await page.evaluate(folder=>{
    if(HDRLibrary.getSnapshot().path!==folder)throw Error("Folder changed before jump");
    const grid=document.getElementById("library-grid");
    window.bottomProfile={jump:performance.now(),paths:[],best:{},finished:{}};
    grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event("scroll"));
    const sample=()=>{
      const data=bottomProfile,bounds=grid.getBoundingClientRect();
      const cells=[...document.querySelectorAll("#grid-space .library-cell")].filter(cell=>{const r=cell.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom;});
      if(!data.paths.length && cells.length)data.paths=cells.map(c=>c.dataset.path);
      for(const cell of cells){
        if(!data.paths.includes(cell.dataset.path))continue;
        const shown=[...cell.querySelectorAll("img,canvas")].filter(p=>!p.hidden&&getComputedStyle(p).visibility!=="hidden"&&(p.tagName==="IMG"?p.complete&&p.naturalWidth>0:p.dataset.pictureKey));
        const elapsed=performance.now()-data.jump;
        if(shown.length)data.best[cell.dataset.path]??=elapsed;
        if(shown.some(p=>p.tagName==="CANVAS"||p.dataset.preview==="false"))data.finished[cell.dataset.path]??=elapsed;
      }
      if(!data.stop)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  },folder);
  // Collect disk completion even if the picture target is missed.
  await page.waitForFunction(()=>Object.keys(bottomProfile.best).length>=25,null,{timeout:90000}).catch(e=>result.picture_failure=e.message);
  result.bottom=await page.evaluate(()=>bottomProfile);
  result.events=await page.evaluate(()=>profileEvents);
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify(result,null,2));
  await page.screenshot({path:path.join(out,"bottom.png")});
  await page.waitForFunction(folder=>profileEvents.some(e=>e.stage==="folder_complete"&&e.path===folder),folder,{timeout:300000}).catch(e=>result.disk_failure=e.message);
  result.bottom=await page.evaluate(()=>{bottomProfile.stop=true;return bottomProfile;});
  const times=Object.values(result.bottom.best).sort((a,b)=>a-b),finished=Object.values(result.bottom.finished).sort((a,b)=>a-b);
  Object.assign(result,{bottom_first_picture_ms:times[0]??null,bottom_25th_picture_ms:times[24]??null,bottom_first_thumbnail_ms:finished[0]??null,bottom_25th_thumbnail_ms:finished[24]??null});
  result.events=await page.evaluate(()=>profileEvents);
  result.scrolls=result.events.filter(e=>e.stage==="grid_scroll_settled"&&e.path===folder);
  result.disk_finished_ms=result.events.find(e=>e.stage==="folder_complete"&&e.path===folder)?.duration_ms??null;
  result.final_folder=await page.evaluate(()=>HDRLibrary.getSnapshot().path);
  if(result.final_folder!==folder)throw Error("Folder changed during measurement; invalid profile");
 }catch(error){result.failure=error.message;process.exitCode=1;}
 finally{
  result.events=await page.evaluate(()=>window.profileEvents||[]).catch(()=>result.events);
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify(result,null,2));
  const {events,bottom,...brief}=result;console.log(JSON.stringify(brief));
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
