const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/ui-polish/round-2');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:"chrome"});const results=[];
try{for(const dpr of [1,2]){
 const context=await browser.newContext({viewport:{width:2560,height:1440},deviceScaleFactor:dpr});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8787',{waitUntil:'domcontentloaded',timeout:60000});
 await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'round2-review.tiff',{type:'image/tiff'}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
 await page.evaluate(()=>{setGradeMode('global');const g=document.querySelector('[data-group="color-grading"]');if(g.classList.contains('collapsed'))g.querySelector('.group-toggle').click();});
 await page.locator('.grading-wheels').scrollIntoViewIfNeeded();
 // Exercise actual reset and selected-range double-click handlers.
 await page.evaluate(()=>{for(const r of ['shadows','midtones','highlights'])state.adjustments.hdr.color_grading[r]={hue:42,saturation:27,luminance_ev:.15};Object.assign(state.adjustments.hdr.color_grading,{blending:70,balance:23});syncControlsFromState();renderControlState();});
 await page.locator('.grading-wheel:visible .color-wheel-pad').dblclick();
 assert.deepEqual(await page.evaluate(()=>state.adjustments.hdr.color_grading.shadows),{hue:0,saturation:0,luminance_ev:0});
 assert.equal(await page.evaluate(()=>state.adjustments.hdr.color_grading.midtones.hue),42);
 await page.locator('#color-grading-reset').click();
 assert.deepEqual(await page.evaluate(()=>state.adjustments.hdr.color_grading),{shadows:{hue:0,saturation:0,luminance_ev:0},midtones:{hue:0,saturation:0,luminance_ev:0},highlights:{hue:0,saturation:0,luminance_ev:0},blending:50,balance:0});
 assert.equal(await page.locator('.color-grading-group').evaluate(e=>e.classList.contains('modified')),false);
 const crop=async(name,loc,margin=6)=>{const b=await loc.boundingBox();assert.ok(b,name);await page.screenshot({path:path.join(out,`${name}-${dpr}x.png`),clip:{x:Math.max(0,b.x-margin),y:Math.max(0,b.y-margin),width:Math.min(b.width+margin*2,2560-Math.max(0,b.x-margin)),height:Math.min(b.height+margin*2,1440-Math.max(0,b.y-margin))}});};
 for(const theme of ['modern-dark','default-light','studio-gray']){
  await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);
  const select=page.locator('#settings-developed-badge');assert.equal(await select.inputValue(),'hover');
  await select.selectOption('always');await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.documentElement.dataset.developedBadge==='always');
  await page.locator('#settings-close').click();
  const lib=page.frameLocator('#library-frame');
  await page.evaluate(()=>{const doc=document.querySelector('#library-frame').contentDocument;const cell=doc.createElement('div');cell.id='badge-probe';cell.className='library-cell';cell.innerHTML='<span class="is-developed">Developed</span>';doc.body.append(cell);});
  assert.equal(await lib.locator('#badge-probe .is-developed').evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.evaluate(()=>HDRApplicationShell.openSettings('appearance'));await select.selectOption('hover');await page.locator('#settings-close').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#library-frame').contentDocument.querySelector('#badge-probe .is-developed')).opacity==='0');
  await page.evaluate(()=>document.querySelector('#library-frame').contentDocument.querySelector('#badge-probe').remove());
  await page.evaluate(()=>{state.adjustments.hdr.color_grading.shadows={hue:42,saturation:27,luminance_ev:.15};syncControlsFromState();renderControlState();});
  const group=page.locator('.color-grading-group');await group.scrollIntoViewIfNeeded();
  await crop(`${theme}-wheel`,group,0);
  const eye=group.locator('.section-bypass');await eye.click();
  await crop(`${theme}-eye`,eye,12);
  const geometry=await eye.evaluate(e=>{const a=getComputedStyle(e,'::before'),b=getComputedStyle(e,'::after');return {eyeTop:a.top,eyeLeft:a.left,strikeTop:b.top,strikeLeft:b.left};});
  assert.equal(geometry.eyeTop,geometry.strikeTop);assert.equal(geometry.eyeLeft,geometry.strikeLeft);
  results.push({theme,dpr,geometry});await eye.click();
  await page.evaluate(()=>revealSourceRail());
  for(const id of ['source-splitter','grade-splitter','dock-splitter']){
   const rail=page.locator('#'+id);if(!await rail.isVisible())continue;
   await page.mouse.move(700,70);await crop(`${theme}-${id}-rest`,rail,8);
   await rail.hover();await crop(`${theme}-${id}-hover`,rail,8);
   const orientation=await rail.getAttribute('aria-orientation');const b=await rail.boundingBox();assert.equal(orientation==='vertical'?b.width:b.height,1);
   const before=await page.evaluate(()=>({...state.layout}));await rail.focus();await page.keyboard.press(orientation==='vertical'?'ArrowRight':'ArrowUp');const after=await page.evaluate(()=>({...state.layout}));assert.notDeepEqual(after,before,id+' keyboard resize');
   await page.keyboard.press(orientation==='vertical'?'ArrowLeft':'ArrowDown');
   const box=await rail.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
   await page.mouse.move(x+(orientation==='vertical'?3:0),y+(orientation==='vertical'?0:3));
   const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.splitter')?.id,{x:x+(orientation==='vertical'?3:0),y:y+(orientation==='vertical'?0:3)});assert.equal(hit,id,'invisible grab target');
   const initial=await page.evaluate(()=>({...state.layout}));
   const delta=id==='source-splitter'?19:-19;await page.mouse.down();await page.mouse.move(x+(orientation==='vertical'?delta:0),y+(orientation==='vertical'?0:delta));await page.mouse.up();
   assert.notDeepEqual(await page.evaluate(()=>({...state.layout})),initial,id+' pointer resize');
   await rail.dblclick();assert.deepEqual(await page.evaluate(()=>({...state.layout})),await page.evaluate(()=>({...LAYOUT_DEFAULTS})),id+' double-click defaults');
  }
  await page.evaluate(()=>activateWorkflowTab('import'));
  for(const id of ['library-left-splitter','library-right-splitter']){
   const rail=lib.locator('#'+id);await page.mouse.move(700,70);await crop(`${theme}-${id}-rest`,rail,8);await rail.hover();await crop(`${theme}-${id}-hover`,rail,8);
   assert.equal((await rail.boundingBox()).width,1);
   const before=await rail.getAttribute('aria-valuenow');await rail.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(({id,before})=>document.querySelector('#library-frame').contentDocument.getElementById(id).getAttribute('aria-valuenow')!==before,{id,before});await page.keyboard.press('ArrowLeft');
   const b=await rail.boundingBox();await page.mouse.move(b.x+3,b.y+30);await page.mouse.down();await page.mouse.move(b.x+23,b.y+30);await page.mouse.up();
   assert.notEqual(await rail.getAttribute('aria-valuenow'),'250');await rail.dblclick();assert.equal(await rail.getAttribute('aria-valuenow'),'250');
  }
  await page.evaluate(()=>activateWorkflowTab('grade'));
  await page.evaluate(()=>openMediaBrowser('source'));
  const media=page.locator('.media-browser-preview-resizer');await media.waitFor({state:'visible'});
  await page.mouse.move(100,70);await crop(`${theme}-media-preview-rest`,media,8);await media.hover();await crop(`${theme}-media-preview-hover`,media,8);
  assert.equal((await media.boundingBox()).width,1);await page.evaluate(()=>closeExportDirectoryBrowser());
 }
 await page.evaluate(()=>HDRApplicationShell.openSettings('appearance'));
 await page.locator('#settings-developed-badge').selectOption('always');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('hdr-finisher:application-preferences:v1')).developedBadge==='always');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#library-frame').contentDocument.documentElement.dataset.developedBadge==='always');
 assert.deepEqual(errors,[]);await context.close();
}fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({passed:'module reset, selected reset, badge switching, keyboard and pointer rails, double-click defaults, invisible grab area, 1px tracks, centred eye strike, preference reload, no page errors',results},null,2));
const images=fs.readdirSync(out).filter(f=>f.endsWith('.png'));fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>UI polish round 2</title><style>body{background:#292929;color:#eee;font:16px system-ui}figure{display:inline-block;vertical-align:top;margin:12px}img{max-width:700px;max-height:800px}figcaption{max-width:600px}</style><h1>UI polish round 2</h1>'+images.map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));
console.log('Round 2 interaction checks and review crops passed:',out);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});


