const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const fs = require("node:fs"), path = require("node:path");
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
   return {list:list.bottom,tools:tools.top,toolBottom:tools.bottom,actions:actions.top,icon:[icon.width,icon.height],more:!!document.querySelector('.local-more-menu'),visible:getComputedStyle(document.querySelector('#local-mask-actions')).display};
  });
  assert(local.tools>=local.list&&local.actions>=local.toolBottom);assert.equal(local.icon[0],local.icon[1]);assert.equal(local.more,false);assert.notEqual(local.visible,'none');
  await page.screenshot({path:path.join(output,'local.png')});
  await page.locator('#grade-mode-retouch').click();
  await page.locator('#retouch-brush-stop').click();assert.equal(await page.evaluate(()=>retouchUI.active),false);
  await page.locator('#retouch-brush').click();assert.equal(await page.evaluate(()=>retouchUI.active),true);
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
  await page.waitForSelector('#batch-preset-name');
  await page.screenshot({path:path.join(output,'export.png')});
  assert.equal(await page.locator('.batch-preset-help').count(),0);
  const field=await page.locator('#batch-preset-name').evaluate(e=>({height:e.getBoundingClientRect().height,box:getComputedStyle(e).boxSizing}));assert(field.height>=34);assert.equal(field.box,'border-box');
  assert.deepEqual(errors,[]);console.log('PASS: default state, title tokens, EV readout, stable SDR scroll, local actions, round icons, retouch brush stroke and export fields');
 } catch(error) {
  console.error('Panel diagnostics',await page.evaluate(()=>({errors:typeof state==='undefined'?null:state.gpuPreview?.detail,workflow:document.body.dataset.workflow,retouch:typeof retouchUI==='undefined'?null:{active:retouchUI.active,busy:retouchUI.busy},status:document.querySelector('#retouch-status')?.textContent})).catch(()=>null),errors);
  await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
