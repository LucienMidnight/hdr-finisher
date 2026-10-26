/* One opt-in real-folder profile, using a disposable database and no source writes. */
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path");
(async()=>{
 const folder=process.env.HDR_LIBRARY_LARGE_FOLDER,profile=process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
 if(!folder || !profile || !path.basename(profile).startsWith("hdr-large-folder-profile-"))throw Error("Prepare a disposable hdr-large-folder-profile-* profile with settings writes and source cleanup disabled.");
 const browser=await chromium.launch(),page=await browser.newPage();
 const out=path.resolve(__dirname,"../../output/library-large-folder-followup");fs.mkdirSync(out,{recursive:true});
 const result={folder,profile,errors:[],events:[]};page.on("pageerror",error=>result.errors.push(error.message));
 try{
  await page.goto(new URL("/library",process.env.HDR_FINISHER_URL).href,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.HDRLibrary && document.body.dataset.libraryReady==="true");
  await page.evaluate(()=>{window.profileEvents=[];const original=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(stage,fields)=>{profileEvents.push({stage,...fields});original(stage,fields);};});
  const opened=Date.now();await page.evaluate(folder=>{void HDRLibrary.browse(folder);},folder);
  await page.waitForFunction(folder=>profileEvents.some(e=>e.stage==="folder_listed"&&e.path===folder),folder,{timeout:90000});
  result.indexed_ms=Date.now()-opened;
  const jumped=Date.now();
  await page.evaluate(()=>{const grid=document.getElementById("library-grid");grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event("scroll"));});
  const picture=page.waitForFunction(()=>{
    const grid=document.getElementById("library-grid").getBoundingClientRect();
    return [...document.querySelectorAll("#grid-space .library-cell")].some(cell=>{
      const r=cell.getBoundingClientRect();if(r.bottom<=grid.top||r.top>=grid.bottom)return false;
      return [...cell.querySelectorAll("img,canvas")].some(p=>!p.hidden&&getComputedStyle(p).visibility!=="hidden"&&(p.tagName==="IMG"?p.complete&&p.naturalWidth>0:p.dataset.pictureKey));
    });
  },null,{timeout:90000}).then(()=>{result.bottom_first_picture_ms=Date.now()-jumped;});
  await page.locator("#grid-space .library-cell").last().click({timeout:30000});
  const selected=Date.now();result.selected_path=await page.evaluate(()=>HDRLibrary.getSnapshot().selected);
  await page.waitForFunction(()=>HDRLibrary.getSnapshot().facts?.indexed,null,{timeout:30000});
  result.camera_details_ms=Date.now()-selected;
  if(!(await page.evaluate(folder=>HDRLibrary.getSnapshot().path===folder,folder)))throw Error("Folder changed during measurement; timings invalid");
  await picture;
  await page.screenshot({path:path.join(out,"bottom.png")});
  await page.waitForFunction(folder=>profileEvents.some(e=>e.stage==="folder_complete"&&e.path===folder),folder,{timeout:180000});
  result.disk_finished_ms=(await page.evaluate(()=>profileEvents.find(e=>e.stage==="folder_complete"))).duration_ms;
  result.snapshot=await page.evaluate(()=>{const {paths,...snapshot}=HDRLibrary.getSnapshot();return snapshot;});
 }catch(error){result.failure=error.message;process.exitCode=1;}
 finally{
  result.events=await page.evaluate(()=>window.profileEvents||[]).catch(()=>[]);
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
