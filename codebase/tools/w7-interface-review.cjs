// Focused real-app review. Run through run-in-electron.js and gpu-run-lock.py.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/w7-interface');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(), results=[];page.on('pageerror',error=>console.error('Renderer:',error.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.HDRTooltips && window.HDRApplicationShell);
 if(process.argv.includes('--pictures-only')){
  await page.evaluate(folder=>openMediaBrowser('source',folder),require('./lib/visual-test-photos.cjs')());
  await page.locator('#picker-list .directory-browser-entry.supported[data-path$=".jpg" i]').first().click();
  await page.locator('#picker-preview').waitFor({state:'visible'});
  await page.locator('#picker-view-grid').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#picker-list img')].filter(img=>img.complete&&img.naturalWidth>0).length>=2);
  await page.locator('#folder-picker').screenshot({path:path.join(out,'open-image-grid.png')});
  await page.locator('#picker-view-list').click();await page.locator('#folder-picker').screenshot({path:path.join(out,'open-image-list.png')});
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  await page.locator('#picker-view-grid').click();await page.waitForFunction(()=>[...document.querySelectorAll('#picker-list img')].filter(img=>img.complete&&img.naturalWidth>0).length>=2);
  const bounds=await page.locator('#folder-picker').evaluate(t=>{const r=t.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};});assert.ok(bounds.left>=0&&bounds.top>=0&&bounds.right<=1101&&bounds.bottom<=721,JSON.stringify(bounds));
  await page.locator('#folder-picker').screenshot({path:path.join(out,'open-image-grid-minimum.png')});await cdp.detach();
  console.log('Settled thumbnail/preview captures and 1100x720 bounds passed');return;
 }

 const lib=await (await page.locator('#library-frame').elementHandle()).contentFrame();
 await lib.waitForFunction(()=>window.HDRTooltips && window.HDRLibrary);
 assert.equal(await page.evaluate(()=>JSON.parse(document.documentElement.dataset.accent).preset),'purple');
 assert.equal(await lib.evaluate(()=>JSON.parse(document.documentElement.dataset.accent).preset),'purple');
 const checkTooltip=async(target,selector,name)=>{
  const control=target.locator(selector),tip=target.locator('#bounded-help-tooltip');
  await target.evaluate(selector=>{const t=document.querySelector(selector);window.tipStart=null;window.tipShown=null;const observer=new MutationObserver(()=>{const tip=document.querySelector('#bounded-help-tooltip');if(tip&&!tip.hidden){window.tipShown=performance.now()-window.tipStart;observer.disconnect();}});observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden']});t.addEventListener('pointerover',()=>window.tipStart=performance.now(),{once:true});},selector);
  await control.hover();await page.waitForTimeout(2200);assert.equal(await tip.isVisible(),false,name+' early');
  await tip.waitFor({state:'visible'});const elapsed=await target.evaluate(()=>window.tipShown);
  assert.ok(elapsed>=2400 && elapsed<=2900,name+' delay '+elapsed);
  const bounds=await tip.evaluate(t=>{const r=t.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};});
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1,JSON.stringify(bounds));
  assert.equal(await control.getAttribute('title'),null);
  assert.equal(await tip.evaluate(t=>t.matches(':popover-open')),true);
  assert.ok((await control.getAttribute('aria-describedby')).includes('bounded-help-tooltip'));
  await (target.screenshot ? target : page).screenshot({path:path.join(out,name+'-tooltip.png')});
  await control.dispatchEvent('pointerdown');assert.equal(await tip.isVisible(),false,name+' click dismissal');
  // A neighbour must also wait; keyboard focus uses exactly the same delay.
  await target.evaluate(selector=>{document.documentElement.dataset.inputModality='keyboard';document.querySelector(selector).focus();},selector);
  await target.locator('body').press('Tab');
  await target.evaluate(selector=>document.querySelector(selector).focus(),selector);
  await page.waitForTimeout(2200);assert.equal(await tip.isVisible(),false,name+' focus early');
  await tip.waitFor({state:'visible'});await target.locator('body').press('Escape');assert.equal(await tip.isVisible(),false,name+' Escape');
  await target.evaluate(()=>document.activeElement.blur());
  results.push({name,elapsed,bounds});
 };
 await page.evaluate(()=>activateWorkflowTab('grade'));
 if(process.argv.includes('--rendition-only')){
  await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'w7-tooltip.tiff',{type:'image/tiff'}));});
  await page.waitForFunction(()=>state.session&&!state.importInProgress);
  await checkTooltip(page,'#view-hdr','rendition');
  assert.equal(await page.locator('#view-hdr').getAttribute('aria-describedby'),'hdr-controls-tooltip');
  console.log('Rendition explanatory hover/focus, timing and accessible description passed',results);return;
 }
 await checkTooltip(page,'#source-rail-expand','main');
 for(const id of ['settings-open','help-open'])assert.equal(await page.evaluate(id=>HDRTooltips.textFor(document.getElementById(id)),id),'');
 await page.evaluate(()=>{
  for(const id of ['overlay-toggle','photo-frame-toggle']){
   const b=document.getElementById(id),name=b.textContent.trim();
   const expected=parseFloat(getComputedStyle(b).fontSize)===0?name:'';
   if(HDRTooltips.textFor(b)!==expected)throw Error(id+' responsive name');
  }
  const box=document.createElement('div');box.style.width='40px';box.style.overflow='hidden';box.style.whiteSpace='nowrap';box.textContent='Complete metadata value';box.dataset.nativeTooltip=box.textContent;document.body.append(box);
  if(HDRTooltips.textFor(box)!==box.textContent)throw Error('Clipped metadata lost');box.style.width='1000px';if(HDRTooltips.textFor(box)!=='')throw Error('Unclipped metadata repeated');box.remove();
 });
 await page.evaluate(()=>activateWorkflowTab('import'));
 await checkTooltip(lib,'#grid-view','library-iframe');
 assert.equal(await lib.evaluate(()=>HDRTooltips.textFor(document.getElementById('filter-button'))),'Ctrl+F');
 for(const theme of ['modern-dark','default-light','studio-gray']){
  await page.evaluate(theme=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${theme}"]`).click();},theme);
  assert.equal(await page.locator('[data-accent-preset="purple"]').getAttribute('aria-pressed'),'true');
  await page.locator('#settings-dialog').screenshot({path:path.join(out,theme+'-settings.png')});
  if(theme==='modern-dark'){
   await page.evaluate(()=>{const b=document.createElement('button');b.id='w7-dialog-icon';b.setAttribute('aria-label','Dialog test action');b.textContent='+';document.querySelector('#settings-dialog').append(b);});
   await checkTooltip(page,'#w7-dialog-icon','dialog');
   await page.evaluate(()=>document.getElementById('w7-dialog-icon').remove());
  }
  await page.locator('#settings-close').click();
  assert.equal(await lib.evaluate(()=>JSON.parse(document.documentElement.dataset.accent).preset),'purple');
 }
 await page.evaluate(()=>{HDRApplicationShell.openSettings('appearance');document.querySelector('[data-accent-preset="burnt-orange"]').click();});
 await page.locator('#settings-close').click();await page.reload();
 await page.waitForFunction(()=>window.HDRApplicationShell&&JSON.parse(document.documentElement.dataset.accent||'null')?.preset==='burnt-orange');
 await page.evaluate(()=>{HDRApplicationShell.openSettings('appearance');document.querySelector('[data-accent-preset="purple"]').click();});await page.locator('#settings-close').click();
 const folder=require('./lib/visual-test-photos.cjs')();
 const currentLib=await (await page.locator('#library-frame').elementHandle()).contentFrame();
 await currentLib.waitForFunction(()=>window.HDRLibrary&&document.body.dataset.libraryReady==='true');
 await currentLib.locator('#add-folder').click();await currentLib.locator('#picker-path').fill(folder);await currentLib.locator('#picker-go').click();await currentLib.locator('#picker-list .directory-browser-entry').first().waitFor().catch(async error=>{console.error('Folder picker:',await currentLib.locator('#folder-picker').innerText());throw error;});
 assert.equal(await currentLib.locator('#picker-list').getAttribute('aria-multiselectable'),'true');
 await currentLib.locator('#picker-view-list').click();assert.equal(await currentLib.locator('#folder-picker').getAttribute('data-view'),'list');await currentLib.locator('#picker-cancel').click();
 await page.evaluate(folder=>openMediaBrowser('source',folder),folder);await page.locator('#picker-list .directory-browser-entry').first().waitFor();
 assert.equal(await page.locator('#picker-list').getAttribute('aria-multiselectable'),'false');assert.equal(await page.locator('#picker-pin').isDisabled(),true);
 await page.locator('#picker-list .directory-browser-entry.supported[data-path$=".jpg" i]').first().click();
 assert.equal(await page.locator('#picker-pin').isEnabled(),true);
 await page.locator('#picker-view-grid').click();await page.locator('#folder-picker').screenshot({path:path.join(out,'open-image-grid.png')});
 await page.locator('#picker-view-list').click();await page.locator('#folder-picker').screenshot({path:path.join(out,'open-image-list.png')});await page.locator('#picker-pin').click();
 await page.waitForFunction(()=>state.session&&!state.importInProgress&&document.body.dataset.workflow==='grade',null,{timeout:60000});
 for(const mode of ['project_open','project_save','export_directory']){
  await page.evaluate(({mode,folder})=>openMediaBrowser(mode,folder),{mode,folder});assert.equal(await page.locator('#directory-browser').isVisible(),true);
  assert.equal(await page.locator('#directory-browser-filename-row').isVisible(),mode==='project_save');await page.locator('#directory-browser-cancel').click();
 }
 await page.evaluate(()=>activateWorkflowTab('import'));
 const popped=page.context().waitForEvent('page');await currentLib.locator('#popout-library').click();const popout=await popped;
 await popout.waitForFunction(()=>window.HDRTooltips&&window.HDRLibrary);await checkTooltip(popout,'#grid-view','library-popout');
 assert.equal(await popout.evaluate(()=>JSON.parse(document.documentElement.dataset.accent).preset),'purple');await popout.screenshot({path:path.join(out,'library-popout.png')});await popout.close();
 await page.goto(new URL('/static/media-browser-standalone.html',process.env.HDR_FINISHER_URL).href);await page.locator('#folder-picker').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>JSON.parse(document.documentElement.dataset.accent).preset),'purple');await page.locator('#folder-picker').screenshot({path:path.join(out,'standalone-open-image.png')});
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({machine:'MacBook Neo, 8 GB',timingAllowance:'2.4–2.9 s around 2.5 s; scheduling tolerance only',results,source:'single image opened through existing Grade flow',otherModes:'folder, project open/save, export destination opened'},null,2));console.log('W7 interface checks passed',results);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
