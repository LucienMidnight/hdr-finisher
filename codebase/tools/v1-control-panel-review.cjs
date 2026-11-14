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
 for(const theme of ["modern-dark","default-light","studio-gray"]){
  await page.evaluate(()=>HDRApplicationShell.openSettings("appearance"));await page.locator(`[data-theme-option="${theme}"]`).click();await page.locator("#settings-close").click();
  await page.evaluate(async()=>{setGradeMode("global");await switchLane("hdr");});
  assert.equal(await page.locator("#sdr-match-entire-actions:visible").count(),0);
  const geometry=await page.evaluate(()=>[...document.querySelectorAll(".comparison-modes > button, .scope-region-toggle")].map(b=>{const r=b.getBoundingClientRect(),s=b.querySelector("svg").getBoundingClientRect();return {width:r.width,contained:s.left>=r.left&&s.right<=r.right};}));
  assert.ok(geometry.length&&geometry.every(b=>b.width>=30&&b.contained),JSON.stringify(geometry));
  assert.equal(await page.locator(".section-bypass").first().evaluate(e=>getComputedStyle(e).fontSize),"0px");
  await page.evaluate(()=>{state.adjustments.hdr.exposure=1;renderControlState();});
  assert.ok(await page.evaluate(()=>{const h=document.querySelector('[data-group="hdr-tone"] .control-group-header');const eye=h.querySelector(".section-bypass").getBoundingClientRect(),reset=h.querySelector(".group-reset").getBoundingClientRect();return Math.abs(eye.top-reset.top)<5;}));
  assert.equal(await page.locator("#source-settings-toggle span").first().textContent(),"Source interpretation");
  assert.equal(await page.locator("#source-settings-toggle span").first().evaluate(e=>getComputedStyle(e).textTransform),"none");
  assert.equal(await page.locator("#raw-settings-toggle span").first().textContent(),"Raw development");
  assert.equal(await page.locator("#raw-settings-toggle span").first().evaluate(e=>getComputedStyle(e).textTransform),"none");
  assert.equal(await page.locator("#raw-settings-toggle span").first().evaluate(e=>getComputedStyle(e).fontSize),"14.5px");
  for(const selector of [".panel-title"]){assert.ok(await page.locator(selector).evaluateAll(nodes=>nodes.every(e=>getComputedStyle(e).textTransform==="uppercase")));}
  assert.ok(await page.locator(".film-stage-name, .grading-wheel legend, .disclosure-trigger > span:first-child").evaluateAll(nodes=>nodes.every(e=>getComputedStyle(e).textTransform==="none")));
  const titles=await page.locator(".control-group-name").allTextContents();
  for(const title of ["Highlight reconstruction","Crop & rotate","Exposure bands","Highlight compression","Black & white","Film look"])assert.ok(titles.includes(title),title);
  const slider=page.locator('[data-path="hdr.contrast"]');
  await page.locator('[data-group="hdr-tone"] .group-toggle').click();
  await slider.click();assert.equal(await slider.evaluate(e=>getComputedStyle(e).outlineStyle),"none");
  await page.keyboard.press("Tab");await page.keyboard.press("Shift+Tab");
  assert.equal(await slider.evaluate(e=>getComputedStyle(e).outlineWidth),"2px");
  assert.equal(await slider.evaluate(e=>getComputedStyle(e).outlineColor),await slider.evaluate(e=>getComputedStyle(document.documentElement).getPropertyValue("--text").trim()).then(()=>page.evaluate(()=>{const e=document.createElement("span");e.style.color="var(--text)";document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;})));
  await page.locator('[data-group="hdr-tone"] .group-toggle').click();
  assert.ok(await page.evaluate(()=>document.querySelector("#zoom-readout").getBoundingClientRect().left>document.querySelector("#zoom-in").getBoundingClientRect().right));
  assert.equal(await page.locator(".zoom-control").evaluate(e=>getComputedStyle(e).boxShadow),"none");
  await shot(theme+"-global-hdr");
  await page.evaluate(()=>switchLane("sdr"));assert.equal(await page.locator("#sdr-match-entire-actions:visible").count(),1);await shot(theme+"-global-sdr");
  await page.evaluate(()=>setGradeMode("local"));assert.equal(await page.locator("#sdr-match-entire-actions:visible").count(),0);
  assert.ok(await page.evaluate(()=>document.querySelector("#control-mode-local .local-tool-strip").getBoundingClientRect().top<document.querySelector("#control-mode-local .local-stack-heading").getBoundingClientRect().top));await shot(theme+"-local");
  await page.evaluate(()=>setGradeMode("retouch"));assert.equal(await page.locator(".grade-folder-tabs:visible").count(),0);await shot(theme+"-retouch");
  await page.evaluate(()=>activateWorkflowTab("import"));await shot(theme+"-library");
  const icons=await page.evaluate(()=>[...document.querySelector("#library-frame").contentDocument.querySelectorAll(".library-icon-button")].map(b=>{const r=b.getBoundingClientRect(),s=b.querySelector("svg")?.getBoundingClientRect();return !s||(s.left>=r.left&&s.right<=r.right);}));assert.ok(icons.length&&icons.every(Boolean));
  await page.evaluate(()=>{activateWorkflowTab("export");setGradeMode("global");});
  await page.waitForFunction(()=>document.querySelector("#batch-view-grid"));
  // Exercise the actual preview switch even when the generated source has no Library item.
  await page.evaluate(()=>document.querySelector("#batch-view-preview").click());
  assert.equal(await page.locator(".batch-preview .batch-header:visible").count(),0);
  assert.equal(await page.locator("#viewer-status-dock .slider-key-legend:visible").count(),1);
  assert.equal(await page.locator("#batch-view-grid:visible").count(),1);
  await page.evaluate(()=>HDRStatus.post({id:"visual-error",severity:"error",message:"Review message"}));
  assert.ok(await page.evaluate(()=>{const e=document.querySelector('[data-status-id="visual-error"]'),text=e.querySelector(".status-entry-copy").getBoundingClientRect(),action=e.querySelector(".status-entry-actions").getBoundingClientRect();return action.left-text.right<=16&&getComputedStyle(document.querySelector("#viewer-status-dock")).borderTopWidth==="0px"&&getComputedStyle(e).boxShadow==="none";}));
  await shot(theme+"-export");
  await page.locator('[data-status-id="visual-error"] .status-entry-dismiss').click();
  assert.equal(await page.locator('[data-status-id="visual-error"]').count(),0);
  await page.locator("#batch-view-grid").click();assert.equal(await page.locator(".batch-header:visible").count(),1);
  await page.locator("#batch-view-preview").click();assert.equal(await page.locator(".batch-header:visible").count(),0);
  await page.evaluate(()=>activateWorkflowTab("grade"));
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,"review.json"),JSON.stringify({menuHover:"passed",iconContainment:"passed in all themes",panelModes:"passed",focus:"pointer hidden; Tab neutral",headings:"panel uppercase; modules sentence case",zoom:"compact with trailing percentage",export:"single toolbar, legend and working grid switch",status:"adjacent Dismiss, no rule/shadow",errors},null,2));console.log("Control Panel and menu checks passed");
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
