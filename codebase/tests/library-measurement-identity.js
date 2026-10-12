const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root,"output","library-measurement-identity");
fs.mkdirSync(output,{recursive:true});
const folder = fs.mkdtempSync(path.join(output,"photos-")), photo = path.join(folder,"untouched.png");
fs.copyFileSync(path.join(root,"tests","fixtures","sdr_gradient.png"),photo);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});
  await page.evaluate(async photo=>{await openDesktopSelection({kind:"source",...await desktop.grantSourcePath(photo)});},photo);
  await page.waitForFunction(()=>window.HDRGradeSaving.active() && state.acceptedPresentation?.exact,null,{timeout:60000});
  await page.evaluate(()=>HDRGradeSaving.save());
  await page.waitForFunction(()=>document.getElementById("grade-save-state").textContent.includes("saved"));
  await page.waitForFunction(async photo=> (await (await fetch("/api/library/settings-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paths:[photo]})})).json()).photos.length,photo);
  const status=await page.evaluate(async photo=> (await (await fetch("/api/library/settings-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paths:[photo]})})).json()).photos[0],photo);
  assert.equal(status.edited,false); assert.equal(status.pictureCurrent,false);
  await page.evaluate(async()=>{const adjustments=structuredClone(state.adjustments);adjustments.hdr.exposure=.7;await queueEditCommand("set_global_adjustments",{adjustments});});
  await page.evaluate(()=>HDRGradeSaving.save());
  await page.waitForFunction(async photo=> (await (await fetch("/api/library/settings-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paths:[photo]})})).json()).photos[0]?.edited,photo);
  console.log("PASS: untouched Grade save stays Not edited without a kept picture; exposure edit counts.");
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
