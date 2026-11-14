// Review captures in the real Electron app, through tests/run-in-electron.js.
const {chromium}=require("playwright"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const out=path.resolve(__dirname,"../output/v1-visual-refinement");fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});
 const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(180);await page.screenshot({path:path.join(out,name+".png")});console.log("CAPTURE",name);};
 // A generated test source uses no original photo or project file.
 await page.evaluate(async()=>{const response=await fetch("/api/proof/test-pattern");if(!response.ok)throw Error(await response.text());await importByteFile(new File([await response.blob()],"visual-review.tiff",{type:"image/tiff"}));});
 await page.waitForFunction(()=>state.session && document.body.dataset.workflow==="grade");
 await page.evaluate(()=>document.fonts.ready);
 // Reuse six small generated review specimens; enable the existing Show all files choice.
 const fixture=require('./lib/visual-test-photos.cjs')();
 if(fs.existsSync(fixture)) await page.evaluate(async folder=>{const frame=document.querySelector("#library-frame");const lib=frame.contentWindow;
 await lib.fetch("/api/library/pins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paths:[folder]})});
 await lib.HDRLibrary.refreshPins();
 const key="hdr-finisher:library-show-all-files";lib.localStorage.setItem(key,"true");lib.dispatchEvent(new lib.StorageEvent("storage",{key,newValue:"true"}));
 await lib.HDRLibrary.browse(folder);},fixture);
 assert.equal(await page.evaluate(()=>document.fonts.check('14px "Afacad"')),true);
 const report={themes:[],errors};
 for(const theme of ["modern-dark","default-light","studio-gray"]){
  await page.evaluate(theme=>HDRApplicationShell.openSettings("appearance"),theme);
  await page.locator(`[data-theme-option="${theme}"]`).click();
  for(const preset of ["burnt-orange","blue-gray","coating-blue"]){await page.locator(`[data-accent-preset="${preset}"]`).click();await shot(`${theme}-settings-${preset}`);}
  await page.locator('[data-accent-preset="burnt-orange"]').click();
  const snapshot=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,accent:HDRApplicationShell.preferences().accent,panel:getComputedStyle(document.documentElement).getPropertyValue("--panel").trim(),font:getComputedStyle(document.body).fontFamily,gradeWidth:state.layout.gradeW}));report.themes.push(snapshot);
  await page.locator("#settings-close").click();
  await page.evaluate(()=>activateWorkflowTab("import"));await page.waitForFunction(()=>document.querySelector("#library-frame").contentWindow.HDRLibrary.getSnapshot().count===6);await page.waitForTimeout(1800);await shot(`${theme}-library`);
  if(process.argv.includes("--library-only")) continue;
  await page.evaluate(()=>activateWorkflowTab("grade"));
  for(const mode of ["global","local","retouch"]){await page.evaluate(mode=>setGradeMode(mode),mode);
   if(mode==="global")await page.evaluate(()=>{const group=document.querySelector('[data-group="hdr-tone"]');if(group?.classList.contains("collapsed"))group.querySelector(".group-toggle").click();});
   await shot(`${theme}-grade-${mode}`);
  }
  await page.evaluate(()=>{activateWorkflowTab("grade");setGradeMode("global");});
  const slider=page.locator('[data-path="hdr.exposure"]');await slider.scrollIntoViewIfNeeded();await slider.hover();
  await page.keyboard.down("Control");assert.equal(await slider.evaluate(e=>e.closest(".range-shell").dataset.modifier),"fine");assert.equal(await page.locator('.range-shell[data-modifier="fine"] .slider-tick').count(),41);await shot(`${theme}-slider-fine`);await page.keyboard.up("Control");
  await page.keyboard.down("Shift");assert.equal(await slider.evaluate(e=>e.closest(".range-shell").dataset.modifier),"snap");assert.ok(await page.locator('.range-shell[data-modifier="snap"] .slider-tick-label').count()>2);await shot(`${theme}-slider-snap`);await page.keyboard.up("Shift");
  await page.mouse.move(10,10);
  await page.evaluate(()=>activateWorkflowTab("proof"));await shot(`${theme}-proof`);
  await page.evaluate(()=>activateWorkflowTab("export"));await shot(`${theme}-export`);
 }
 // Exercise the Custom setting through the real Settings input and a reload.
 await page.evaluate(()=>HDRApplicationShell.openSettings("appearance"));
 await page.evaluate(()=>{const input=document.querySelector("#accent-custom-color");input.value="#4c9377";input.dispatchEvent(new Event("input",{bubbles:true}));});
 await page.waitForTimeout(350);
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});
 assert.deepEqual(await page.evaluate(()=>HDRApplicationShell.preferences().accent),{preset:"custom",color:"#4c9377"});
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue("--accent")),"#4c9377");
 assert.equal(await page.evaluate(()=>{const f=document.querySelector("#library-frame");return f.contentDocument.documentElement.style.getPropertyValue("--accent");}),"#4c9377");
 await page.evaluate(()=>HDRApplicationShell.openSettings("appearance"));
 await page.locator('[data-accent-preset="burnt-orange"]').click();await page.locator('[data-theme-option="modern-dark"]').click();await page.locator("#settings-close").click();
 report.customPersistence="passed in main window and embedded Library after reload";
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,"review.json"),JSON.stringify(report,null,2));console.log("Visual review checks passed");
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
