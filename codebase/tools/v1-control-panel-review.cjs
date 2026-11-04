const {chromium}=require("playwright"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const out=path.resolve(__dirname,"../output/v1-control-panel-fixes");fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});
 const triggers=page.locator(".window-menu-trigger");
 await triggers.nth(0).hover();assert.equal(await page.locator(".window-menu-popover:visible").count(),0);
 await triggers.nth(0).click();
 for(let i=1;i<await triggers.count();i++){await triggers.nth(i).hover();assert.equal(await triggers.nth(i).getAttribute("aria-expanded"),"true");assert.equal(await page.locator(".window-menu-popover:visible").count(),1);}
 await triggers.nth(0).hover();assert.equal(await triggers.nth(0).getAttribute("aria-expanded"),"true");
 await page.keyboard.press("Escape");assert.equal(await page.locator(".window-menu-popover:visible").count(),0);
 await triggers.nth(0).hover();assert.equal(await page.locator(".window-menu-popover:visible").count(),0);
 await page.evaluate(async()=>{const r=await fetch("/api/proof/test-pattern");await importByteFile(new File([await r.blob()],"panel-review.tiff",{type:"image/tiff"}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==="grade");
 const shot=async name=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);await page.screenshot({path:path.join(out,name+".png")});};
 for(const theme of ["default-dark","default-light","studio-gray"]){
  await page.evaluate(()=>HDRApplicationShell.openSettings("appearance"));await page.locator(`[data-theme-option="${theme}"]`).click();await page.locator("#settings-close").click();
  await page.evaluate(async()=>{setGradeMode("global");await switchLane("hdr");});
  assert.equal(await page.locator("#sdr-match-entire-actions:visible").count(),0);
  const geometry=await page.evaluate(()=>[...document.querySelectorAll(".comparison-modes > button, .scope-region-toggle")].map(b=>{const r=b.getBoundingClientRect(),s=b.querySelector("svg").getBoundingClientRect();return {width:r.width,contained:s.left>=r.left&&s.right<=r.right};}));
  assert.ok(geometry.length&&geometry.every(b=>b.width>=30&&b.contained),JSON.stringify(geometry));
  assert.equal(await page.locator(".section-bypass").first().evaluate(e=>getComputedStyle(e).fontSize),"0px");
  await page.evaluate(()=>{state.adjustments.hdr.exposure=1;renderControlState();});
  assert.ok(await page.evaluate(()=>{const h=document.querySelector('[data-group="hdr-tone"] .control-group-header');const eye=h.querySelector(".section-bypass").getBoundingClientRect(),reset=h.querySelector(".group-reset").getBoundingClientRect();return Math.abs(eye.top-reset.top)<5;}));
  await shot(theme+"-global-hdr");
  await page.evaluate(()=>switchLane("sdr"));assert.equal(await page.locator("#sdr-match-entire-actions:visible").count(),1);await shot(theme+"-global-sdr");
  await page.evaluate(()=>setGradeMode("local"));assert.equal(await page.locator("#sdr-match-entire-actions:visible").count(),0);
  assert.ok(await page.evaluate(()=>document.querySelector("#control-mode-local .local-tool-strip").getBoundingClientRect().top<document.querySelector("#control-mode-local .local-stack-heading").getBoundingClientRect().top));await shot(theme+"-local");
  await page.evaluate(()=>setGradeMode("retouch"));assert.equal(await page.locator(".grade-folder-tabs:visible").count(),0);await shot(theme+"-retouch");
  await page.evaluate(()=>activateWorkflowTab("import"));await shot(theme+"-library");
  const icons=await page.evaluate(()=>[...document.querySelector("#library-frame").contentDocument.querySelectorAll(".library-icon-button")].map(b=>{const r=b.getBoundingClientRect(),s=b.querySelector("svg")?.getBoundingClientRect();return !s||(s.left>=r.left&&s.right<=r.right);}));assert.ok(icons.length&&icons.every(Boolean));
  await page.evaluate(()=>activateWorkflowTab("grade"));
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,"review.json"),JSON.stringify({menuHover:"passed",iconContainment:"passed in all themes",panelModes:"passed",errors},null,2));console.log("Control Panel and menu checks passed");
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
