/* One opt-in real-folder timing profile; requires a prepared disposable DB.
 * The profile setup disables all settings writes and source-folder cleanup.
 */
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path"),{execFileSync}=require("node:child_process");
(async()=>{
 const folder=process.env.HDR_LIBRARY_LARGE_FOLDER,profile=process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
 if(!folder || !profile || !path.basename(profile).startsWith("hdr-large-folder-profile-"))throw Error("Prepare a disposable hdr-large-folder-profile-* Library profile with settings writes disabled, and opt in with HDR_LIBRARY_LARGE_FOLDER.");
 const browser=await chromium.launch();
 const page=await browser.newPage();
 const errors=[];page.on("pageerror",error=>errors.push(error.message));
 const out=path.resolve(__dirname,"../../output/library-large-folder-open");
 const logPath=path.join(profile,"logs/backend.log");
 let timer,peak=0;
 try {
  await page.goto(new URL("/library",process.env.HDR_FINISHER_URL).href,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.HDRLibrary);
  await page.evaluate(()=>{
   window.folderEvents=[];const original=HDRLibraryStopwatch;
   window.HDRLibraryStopwatch=(stage,fields)=>{if(stage.startsWith("folder_"))folderEvents.push({stage,...fields});original(stage,fields);};
  });
  const log=fs.readFileSync(logPath,"utf8"),match=log.match(/backend_process_started (.*)/);
  const pid=JSON.parse(match[1]).pid;
  const sample=()=>{try {const bytes=Number(execFileSync("powershell.exe",["-NoProfile","-Command",`$child=Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}' | Where-Object Name -eq 'python.exe' | Select-Object -First 1; if($child){(Get-Process -Id $child.ProcessId).PeakWorkingSet64}else{(Get-Process -Id ${pid}).PeakWorkingSet64}`],{encoding:"utf8",windowsHide:true}));peak=Math.max(peak,bytes);}catch{}};
  sample();const baseline=peak;timer=setInterval(sample,2000);
  const started=Date.now();
  await page.evaluate(folder=>{void HDRLibrary.browse(folder);},folder);
  await page.waitForFunction(()=>folderEvents.some(e=>e.stage==="folder_first_rows"),null,{timeout:30000});
  console.log("first rows",await page.evaluate(()=>folderEvents.find(e=>e.stage==="folder_first_rows")));
  await page.waitForFunction(()=>folderEvents.some(e=>e.stage==="folder_first_thumbnail"),null,{timeout:90000});
  console.log("first thumbnail",await page.evaluate(()=>folderEvents.find(e=>e.stage==="folder_first_thumbnail")));
  await page.screenshot({path:path.join(out,"first-screen.png")});
  await page.waitForFunction(()=>folderEvents.some(e=>e.stage==="folder_complete"),null,{timeout:600000});
  sample();
  const result={folder,profile,elapsed_ms:Date.now()-started,baseline_bytes:baseline,peak_backend_bytes:peak,
   events:await page.evaluate(()=>folderEvents),errors};
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  await page.goto(new URL("/",process.env.HDR_FINISHER_URL).href,{waitUntil:"domcontentloaded"});
 }finally{clearInterval(timer);await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
