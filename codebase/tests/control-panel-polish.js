const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const fs = require("node:fs"), path = require("node:path");
const { createLocalAdjustment } = require("./helpers/local-adjustments");
async function verifyToneHierarchy(page) {
 const review = path.resolve("output/review/tone-slider-hierarchy");
 const capture = process.argv.includes("--tone-review");
 const measurement = {};
 const measure = (panel) => panel.evaluate(element => {
  const box = node => node.getBoundingClientRect();
  const typography = node => {
   const {fontFamily, fontSize, fontWeight, fontVariantNumeric} = getComputedStyle(node);
   return [fontFamily, fontSize, fontWeight, fontVariantNumeric];
  };
  return [...element.querySelectorAll(".tone-primary")].map(row => {
   const label = row.querySelector("label"), output = row.querySelector("output");
   const rail = row.querySelector(".slider-track"), input = row.querySelector('input[type="range"]');
   return {
    label: label.textContent, x: box(rail).x, labelX: box(label).x, width: box(rail).width, trackHeight: box(rail).height,
    hitHeight: box(input).height, labelFont: typography(label), valueFont: typography(output),
    stacked: box(label).bottom <= box(rail).top,
   };
  });
 });
 const snapshot = async (panel, name) => {
  if (!capture) return;
  await panel.screenshot({path: path.join(review, name + ".png")});
 };
 const globalTone = lane => page.locator('[data-group="' + lane + '-tone"]');
 const localLight = page.locator('[data-local-grade-section="light"]');
 const heading = panel => panel.locator(".tone-range-heading").first();
 const change = (input, value) => input.evaluate((element, value) => {
  element.value = value;
  element.dispatchEvent(new Event("input", {bubbles: true}));
  element.dispatchEvent(new Event("change", {bubbles: true}));
 }, value);

 const hdr = globalTone("hdr");
 await page.locator("#grade-mode-global").click();
 if (await hdr.locator(".group-toggle").getAttribute("aria-expanded") === "false") await hdr.locator(".group-toggle").click();
 const trigger = heading(hdr);
 assert.equal(await trigger.getAttribute("aria-expanded"), "false", "Tone ranges should start closed.");
 const rangeId = await trigger.getAttribute("aria-controls");
 const range = page.locator("#" + rangeId);
 const width = range.locator('input[id$="-width"]');
 assert.equal(await range.isVisible(), false);
 await trigger.focus();
 assert.equal(await width.evaluate(input => { input.focus(); return document.activeElement === input; }), false,
  "A closed Range must not receive focus.");
 await page.keyboard.press("Enter");
 assert.equal(await trigger.getAttribute("aria-expanded"), "true");
 assert.equal(await range.isVisible(), true);
 assert.equal(await heading(globalTone("sdr")).getAttribute("aria-expanded"), "true");
 assert.equal(await heading(localLight).getAttribute("aria-expanded"), "true");
 assert.equal(await hdr.locator('.tone-range-heading[aria-expanded="true"]').count(), 1);
 for (const target of [hdr.locator("#hdr-shadows"), trigger, width]) {
  await target.hover();
  await page.waitForFunction(() => HDRTonePreview.selection()?.zone === "shadows" && !HDRTonePreview.selection()?.local);
 }
 const defaultSummary = await trigger.locator(".tone-range-summary").textContent();
 await change(hdr.locator("#hdr-shadows"), 10);
 await change(width, 6);
 assert.notEqual(await trigger.locator(".tone-range-summary").textContent(), defaultSummary);
 assert(await trigger.locator(".tone-range-name").evaluate(el => getComputedStyle(el, "::before").content !== "none"),
  "A changed Range needs a visible dot.");
 await hdr.locator("#hdr-shadows").dblclick();
 assert.equal(Number(await hdr.locator("#hdr-shadows").inputValue()), 0);
 assert.equal(Number(await width.inputValue()), 6, "Resetting a main slider must leave its Range alone.");
 await width.dblclick();
 assert.equal(Number(await width.inputValue()), 5);
 assert.equal(await trigger.locator(".tone-range-summary").textContent(), defaultSummary);
 assert.equal(await trigger.locator(".tone-range-name").evaluate(el => getComputedStyle(el, "::before").content), "none");
 await trigger.focus();
 await page.keyboard.press("Space");
 assert.equal(await trigger.getAttribute("aria-expanded"), "false");
 assert.equal(await range.isVisible(), false);
 assert.equal(await heading(globalTone("sdr")).getAttribute("aria-expanded"), "false");
 assert.equal(await heading(localLight).getAttribute("aria-expanded"), "false");

 await createLocalAdjustment(page, "linear_gradient");
 if (capture) fs.mkdirSync(review, {recursive: true});
 for (const theme of ["default-light", "modern-dark"]) {
  await page.evaluate(theme => {
   HDRApplicationShell.openSettings("appearance");
   document.querySelector('[data-theme-option="' + theme + '"]').click();
  }, theme);
  await page.locator("#settings-close").click();
  const rows = measurement[theme] = {};
  for (const [name, panel, lane] of [
   ["global-hdr-tone", hdr, "hdr"], ["global-sdr-tone", globalTone("sdr"), "sdr"], ["local-light", localLight, "hdr"],
  ]) {
   await page.evaluate(lane => switchLane(lane), lane);
   await page.locator(name === "local-light" ? "#grade-mode-local" : "#grade-mode-global").click();
   if (name !== "local-light" && await panel.locator(".group-toggle").getAttribute("aria-expanded") === "false") {
    await panel.locator(".group-toggle").click();
   }
   await page.evaluate(() => document.fonts.ready);
   assert(await panel.isVisible(), name + " must be visible before measuring.");
   rows[name] = await measure(panel);
   assert.equal(rows[name].length, name === "local-light" ? 7 : name === "global-sdr-tone" ? 9 : 8);
   if (name === "global-sdr-tone") {
    assert.deepEqual(rows[name].slice(0, 2).map(row => row.label), ["Exposure", "SDR exposure comp"]);
    const comp = panel.locator("#sdr-output-exposure");
    await change(comp, 1);
    assert.match(await panel.locator('output[data-value-path="sdr.output_exposure"]').innerText(), /^\+?1\.00 EV$/);
    await comp.dblclick();
    assert.equal(Number(await comp.inputValue()), 0);
   }
   await snapshot(panel, theme + "-" + name);
   const button = heading(panel);
   await button.click();
   if (name === "local-light") {
    await button.hover();
    await page.waitForFunction(() => HDRTonePreview.selection()?.zone === "shadows" && HDRTonePreview.selection()?.local);
   }
   const sliders = await panel.locator(".tone-range-body:visible").locator('input[type="range"]').evaluateAll(inputs =>
    inputs.map(input => ({
     x: input.getBoundingClientRect().x, trackHeight: input.closest(".range-shell").querySelector(".slider-track").getBoundingClientRect().height,
     width: input.getBoundingClientRect().width, hitHeight: input.getBoundingClientRect().height,
    })));
   assert.equal(sliders.length, 2);
   assert(sliders.every(row => row.trackHeight < rows[name][0].trackHeight && row.hitHeight === rows[name][0].hitHeight
    && row.x > rows[name][0].x && row.width < rows[name][0].width), JSON.stringify({name, sliders, primary: rows[name][0]}));
   assert.deepEqual(await measure(panel), rows[name], "Opening Range must not resize the main rails.");
   await snapshot(panel, theme + "-" + name + "-range-open");
   await button.click();
  }
  const reference = rows["global-hdr-tone"][0];
  for (const row of Object.values(rows).flat()) {
   assert(row.stacked, JSON.stringify(row));
   for (const dimension of ["x", "labelX", "width", "trackHeight", "hitHeight"]) {
    assert(Math.abs(row[dimension] - reference[dimension]) < 1, JSON.stringify({dimension, row, reference}));
   }
   assert.deepEqual(row.labelFont, reference.labelFont);
   assert.deepEqual(row.valueFont, reference.valueFont);
  }
 }
 if (capture) fs.writeFileSync(path.join(review, "computed-tone-hierarchy.json"), JSON.stringify(measurement, null, 2) + "\n");
 console.log("PASS: Global/Local Tone rail alignment, keyboard disclosure, live Range summary, reset isolation and zone preview in light/dark.");
}

(async () => {
 const browser = await chromium.launch(), page = await browser.newPage();
 const errors = []; page.on("pageerror", e => errors.push(e.message));
 const output = path.resolve("output/control-panel-polish"); fs.mkdirSync(output, {recursive:true});
 try {
  await page.goto(process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const data = await page.evaluate(() => {
   const c=document.createElement("canvas");c.width=192;c.height=128;
   const ctx=c.getContext("2d");ctx.fillStyle="#889aaf";ctx.fillRect(0,0,192,128);ctx.fillStyle="#222";ctx.fillRect(94,62,4,4);
   return c.toDataURL().split(",")[1];
  });
  await page.locator("#file-input").setInputFiles({name:"panel-check.png",mimeType:"image/png",buffer:Buffer.from(data,"base64")});
  await page.waitForFunction(()=>state.session&&!state.importInProgress&&document.body.dataset.workflow==="grade",null,{timeout:120000});
  await page.waitForFunction(()=>activePreviewElement()?.getBoundingClientRect().width>0,null,{timeout:10000});
  const chrome = await page.evaluate(() => {
   const header = document.querySelector('#grade-workflow-panel .control-title-row');
   const title = header.querySelector('.panel-title');
   const row = header.getBoundingClientRect(), text = title.getBoundingClientRect();
   return { contained: text.top >= row.top && text.bottom <= row.bottom, centreError: Math.abs((text.top + text.bottom - row.top - row.bottom) / 2), height: row.height };
  });
  assert.equal(chrome.height, 40);
  assert(chrome.contained, 'Control Panel title escapes its title row');
  assert(chrome.centreError <= 1, 'Control Panel title is not vertically centred');
  const initial=await page.evaluate(()=>{
   const group=document.querySelector('[data-group="film-look"]');
   const title=group.querySelector('.control-group-name'),raw=document.querySelector('#raw-settings-toggle > span');
   const a=getComputedStyle(title),b=getComputedStyle(raw);
   return {filmModified:group.classList.contains('modified'),title:[a.color,a.fontSize,a.textTransform],raw:[b.color,b.fontSize,b.textTransform],ev:formatControlValue('current.film_look.print_exposure',.14),hslModified:document.querySelector('[data-group="hsl"]').classList.contains('modified')};
  });
  console.log('Initial panel',initial);
  assert.equal(initial.filmModified,false,'neutral film must not appear edited');assert.equal(initial.hslModified,false,'neutral HSL must not appear edited');assert.deepEqual(initial.title,initial.raw);assert.equal(initial.ev,'+0.14 EV');
  await page.locator('[data-group="color-grading"] .group-toggle').click();
  await page.screenshot({path:path.join(output,'global.png')});
  const positions=await page.evaluate(()=>{
   const rail=document.querySelector('.grade-rail');rail.scrollTop=120;
   return {top:rail.scrollTop};
  });
  await page.evaluate(()=>switchLane('sdr'));
  assert.equal(await page.evaluate(()=>document.querySelector('.grade-rail').scrollTop),positions.top,'SDR tab changed control-panel scroll');
  await page.evaluate(()=>switchLane('hdr'));
  await page.locator('#grade-mode-local').click();
  await page.locator('[data-local-tool="brush"]').click();
  const local=await page.evaluate(()=>{
   const r=s=>document.querySelector(s).getBoundingClientRect();const list=r('#local-adjustment-list'),tools=r('#control-mode-local .local-tool-strip'),actions=r('#local-mask-actions'),icon=r('[data-local-tool="brush"] .local-tool-icon');
   return {listTop:list.top,list:list.bottom,toolBottom:tools.bottom,actions:actions.top,icon:[icon.width,icon.height],more:!!document.querySelector('.local-more-menu'),visible:getComputedStyle(document.querySelector('#local-mask-actions')).display};
  });
  // November 4 layout: New adjustment tools above the Masks list, mask actions below it.
  assert(local.listTop>=local.toolBottom&&local.actions>=local.list,`Local order: ${JSON.stringify(local)}`);assert.equal(local.icon[0],local.icon[1]);assert.equal(local.more,false);assert.notEqual(local.visible,'none');
  const compact=await page.evaluate(()=>{
   const surface=document.querySelector('#local-adjustments-panel > .local-stack-surface');
   const list=document.getElementById('local-adjustment-list'),style=getComputedStyle(surface);
   const short={gutter:surface.offsetWidth-surface.clientWidth,overflow:style.overflowY,track:getComputedStyle(surface,'::-webkit-scrollbar-track').backgroundColor};
   while(list.children.length<7){const row=list.firstElementChild.cloneNode(true);row.dataset.layoutFixture='true';list.append(row);}
   const rows=[...list.children].map(row=>row.getBoundingClientRect());
   return {short,height:surface.clientHeight,sixFit:rows[5].bottom<=surface.getBoundingClientRect().bottom,seventhBelow:rows[6].bottom>surface.getBoundingClientRect().bottom,heights:rows.map(r=>r.height),nested:getComputedStyle(list).overflowY,gutter:surface.offsetWidth-surface.clientWidth};
  });
  assert.equal(compact.height,204);assert(compact.sixFit&&compact.seventhBelow);assert(compact.heights.every(h=>h===34));
  assert.equal(compact.short.overflow,'scroll');assert(compact.short.gutter>1);assert.equal(compact.gutter,compact.short.gutter);
  assert.notEqual(compact.short.track,'rgba(0, 0, 0, 0)');assert.equal(compact.nested,'visible');
  await page.screenshot({path:path.join(output,'compact-local.png')});
  await page.evaluate(()=>document.querySelectorAll('[data-layout-fixture]').forEach(row=>row.remove()));
  await page.screenshot({path:path.join(output,'local.png')});
  await verifyToneHierarchy(page);
  await page.locator('#grade-mode-retouch').click();
  const railChrome = await page.locator(".grade-rail").evaluate(rail => {
    const header = rail.querySelector(".control-title-row");
    const rect = rail.getBoundingClientRect();
    const style = getComputedStyle(rail);
    return { edge: rect.right - header.getBoundingClientRect().right,
      rightBorder: parseFloat(style.borderRightWidth),
      gutter: rail.offsetWidth - rail.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) };
  });
  assert.equal(railChrome.gutter, 0, "Outer rail must not reserve a gutter");
  assert(Math.abs(railChrome.edge - railChrome.rightBorder) <= 1, "Grade title divider must reach the right edge");
  const tool=await page.evaluate(()=>`#retouch-mode-${retouchUI.mode}`);
  await page.locator(tool).click();assert.equal(await page.evaluate(()=>retouchUI.active),false);
  await page.locator(tool).click();assert.equal(await page.evaluate(()=>retouchUI.active),true);
  const point=await page.evaluate(()=>{const r=activePreviewElement().getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(point.x,point.y);
  await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs.length===1,null,{timeout:60000});
  await page.screenshot({path:path.join(output,'retouch.png')});
  const photo=path.resolve('tests/fixtures/sdr_gradient.png');
  await page.evaluate(async photo=>{await desktop.grantSourcePath(photo);await batchExport.open([photo],{fromLibrary:true});},photo);
  await page.locator('.batch-photo').click();
  assert.equal(await page.locator('.batch-photo').getAttribute('aria-selected'),'true');
  const outline=await page.locator('.batch-photo').evaluate(e=>{const c=getComputedStyle(e,'::after');return {above:[...e.querySelectorAll('img,canvas')].every(child=>Number(c.zIndex)>(Number(getComputedStyle(child).zIndex)||0)),border:parseFloat(c.borderTopWidth),pointer:c.pointerEvents};});
  assert(outline.above&&outline.border>0);assert.equal(outline.pointer,'none');
  // The preset name is edited in Save as / Rename dialogs (afffa1f4); measure the visible destination field.
  await page.waitForSelector('#batch-directory',{state:'visible'});
  await page.screenshot({path:path.join(output,'export.png')});
  assert.equal(await page.locator('.batch-preset-help').count(),0);
  const field=await page.locator('#batch-directory').evaluate(e=>({height:e.getBoundingClientRect().height,box:getComputedStyle(e).boxSizing}));assert(field.height>=34,`Export field: ${JSON.stringify(field)}`);assert.equal(field.box,'border-box');
  assert.deepEqual(errors,[]);console.log('PASS: default state, title spacing, full-bleed outer panel and unchanged boxed list, title tokens, EV readout, stable SDR scroll, local actions, round icons, retouch brush stroke and export fields');
 } catch(error) {
  console.error('Panel diagnostics',await page.evaluate(()=>({errors:typeof state==='undefined'?null:state.gpuPreview?.detail,workflow:document.body.dataset.workflow,retouch:typeof retouchUI==='undefined'?null:{active:retouchUI.active,busy:retouchUI.busy},status:document.querySelector('#retouch-status')?.textContent})).catch(()=>null),errors);
  await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
