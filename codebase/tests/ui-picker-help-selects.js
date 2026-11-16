// Run with tests/run-in-electron.js through tools/gpu-run-lock.py.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('output/review/picker-help-selects');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL);
 await page.waitForFunction(()=>window.HDRTooltips&&window.HDRApplicationShell);
 const support=await page.evaluate(()=>({base:CSS.supports('appearance','base-select'),picker:CSS.supports('selector(select::picker(select))'),ua:navigator.userAgent}));
 assert.ok(support.base&&support.picker,JSON.stringify(support));console.log('Customizable select support:',support);
 const tooltip=async(target,selector,name)=>{
  const control=target.locator(selector),tip=target.locator('#bounded-help-tooltip');
  await control.scrollIntoViewIfNeeded();
  assert.notEqual(await control.evaluate(e=>HDRTooltips.textFor(e)),'',name+' has eligible help');
  // A real OS pointer can leave this Electron window while Steve uses his Mac.
  // Deliver the hover event to the real control without moving his pointer.
  await control.dispatchEvent('pointerover');await page.waitForTimeout(2200);assert.equal(await tip.isVisible(),false);
  await tip.waitFor({state:'visible'});
  const geometry=await control.evaluate(e=>{const r=e.getBoundingClientRect(),t=document.getElementById('bounded-help-tooltip').getBoundingClientRect();return {distance:Math.min(Math.abs(t.top-r.bottom),Math.abs(r.top-t.bottom)),overlap:t.right>=r.left&&t.left<=r.right,bounded:t.left>=0&&t.top>=0&&t.right<=innerWidth&&t.bottom<=innerHeight};});
  assert.ok(geometry.distance<=8&&geometry.overlap&&geometry.bounded,JSON.stringify(geometry));
  assert.ok((await control.getAttribute('aria-describedby')).includes('bounded-help-tooltip'));
  await (target.screenshot?target:page).screenshot({path:path.join(out,name+'-tooltip.png')});await (target.keyboard||page.keyboard).press('Escape');assert.equal(await tip.isVisible(),false);checks.push({name,...geometry});
 };
 const popup=async(target,selector,name)=>{
  const select=target.locator(selector);await select.scrollIntoViewIfNeeded();
  assert.equal(await select.evaluate(e=>getComputedStyle(e).appearance),'base-select');
  await select.click();assert.equal(await select.evaluate(e=>e.matches(':open')),true);
  const bounds=await select.evaluate(e=>{const options=[...e.options].filter(o=>!o.disabled).map(o=>o.getBoundingClientRect()).filter(r=>r.width&&r.height);return {visible:options.some(r=>r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth),font:getComputedStyle(e.options[0]).fontFamily};});
  assert.ok(bounds.visible,JSON.stringify(bounds));assert.match(bounds.font,/Afacad/);
  const focus=await select.evaluate(e=>{
   const option=[...e.options].find(o=>o.matches(':focus, :focus-visible'));
   if(!option)return null;
   const token=document.createElement('span');token.style.color='var(--accent-strong)';e.after(token);
   const result={outline:getComputedStyle(option).outlineColor,accent:getComputedStyle(token).color};token.remove();return result;
  });
  if(focus)assert.equal(focus.outline,focus.accent,'Popup focus uses the app accent');
  await (target.screenshot?target:page).screenshot({path:path.join(out,name+'-select.png')});
  await (target.keyboard||page.keyboard).press('Escape');assert.equal(await select.evaluate(e=>e.matches(':open')),false);checks.push({name,...bounds});
 };
 const lib=await(await page.locator('#library-frame').elementHandle()).contentFrame();await lib.waitForFunction(()=>window.HDRTooltips&&window.HDRLibrary&&document.body.dataset.libraryReady==='true');
 await tooltip(lib,'#sort-dir','library');
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=240;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,400,240);g.addColorStop(0,'white');g.addColorStop(1,'black');x.fillStyle=g;x.fillRect(0,0,400,240);return c.toDataURL().split(',')[1];});
 await page.locator('#file-input').setInputFiles({name:'ui-check.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
 await page.waitForFunction(()=>state.session&&!state.importInProgress&&state.activeWorkflow==='grade',null,{timeout:120000});
 await page.evaluate(()=>document.querySelector('[data-group="hsl"]').classList.remove('collapsed'));
 const pick=page.locator('#hsl-global-panel [data-hsl-mode="pick"]');await pick.click();
 const cursor=await page.evaluate(()=>getComputedStyle(activePreviewElement()).cursor);assert.match(cursor,/data:image\/svg\+xml/);
 // Electron page captures omit the OS cursor. Save its exact SVG separately.
 const uri=cursor.match(/url\("?([^"\)]+)/)[1];fs.writeFileSync(path.join(out,'pipette.svg'),decodeURIComponent(uri.split(',')[1]));
 await page.screenshot({path:path.join(out,'hsl-pick-armed.png')});
 await page.evaluate(uri=>{
  const specimen=document.createElement('div');specimen.id='cursor-specimen';
  specimen.style.cssText='position:fixed;z-index:2147483647;left:100px;top:120px;padding:16px;background:var(--panel);color:var(--text);font:var(--font-size-md) var(--font-body)';
  specimen.textContent='Actual cursor artwork · OS cursor is omitted by page captures';
  for(const background of ['--text','--inverse']){
   const plate=document.createElement('div');plate.style.cssText=`background:var(${background});padding:16px;display:inline-block;margin:8px`;
   const image=new Image();image.src=uri;image.style.width='var(--compact-action-size)';image.style.height='var(--compact-action-size)';plate.append(image);specimen.append(plate);
  }
  document.body.append(specimen);
 },uri);
 await page.locator('#cursor-specimen img').evaluateAll(es=>Promise.all(es.map(e=>e.decode())));
 await page.locator('#cursor-specimen').screenshot({path:path.join(out,'pipette-artwork.png')});
 await page.locator('#cursor-specimen').evaluate(e=>e.remove());
 await page.keyboard.press('Escape');assert.doesNotMatch(await page.evaluate(()=>getComputedStyle(activePreviewElement()).cursor),/data:image/);
 await pick.click();await page.evaluate(()=>setGradeMode('local'));assert.doesNotMatch(await page.evaluate(()=>getComputedStyle(activePreviewElement()).cursor),/data:image/);
 await page.locator('[data-local-tool="hue_range"]').click();await page.waitForFunction(()=>selectedMaskLeaf()?.type==='hue_range');
 assert.match(await page.locator('#local-mask-overlay').evaluate(e=>getComputedStyle(e).cursor),/data:image/);
 await page.locator('[data-local-grade-section="hsl"] summary').click();
 await page.locator('#hsl-local-panel [data-hsl-mode="pick"]').click();
 assert.match(await page.evaluate(()=>getComputedStyle(activePreviewElement()).cursor),/data:image/);
 const softness=page.locator('#hsl-local-panel [data-hsl-key="feather"]');await softness.scrollIntoViewIfNeeded();
 assert.equal(await softness.evaluate(e=>HDRTooltips.textFor(e)),'');
 await page.screenshot({path:path.join(out,'local-softness-no-repeated-help.png')});
 await page.locator('#local-mask-overlay').focus();await page.keyboard.press('Escape');assert.doesNotMatch(await page.locator('#local-mask-overlay').evaluate(e=>getComputedStyle(e).cursor),/data:image/);
 await page.locator('#local-gizmo-toggle').click();assert.match(await page.locator('#local-mask-overlay').evaluate(e=>getComputedStyle(e).cursor),/data:image/);
 await page.evaluate(()=>activateWorkflowTab('proof'));assert.doesNotMatch(await page.locator('#local-mask-overlay').evaluate(e=>getComputedStyle(e).cursor),/data:image/);
 await page.evaluate(()=>{activateWorkflowTab('grade');setGradeMode('global');document.querySelector('[data-group="film-look"]').classList.remove('collapsed');});
 await popup(page,'#film-stock','grade');

 const scope=page.locator('.scope-header-controls select:visible').first();await popup(page,'#'+await scope.getAttribute('id'),'scopes');
 await page.evaluate(()=>{document.querySelector('[data-group="hdr-tone"]').classList.remove('collapsed');});
 const highlight='[data-control-path="hdr.highlights"] label';
 await tooltip(page,highlight,'highlights');
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:2,mobile:false});
 await tooltip(page,highlight,'highlights-minimum');await popup(page,'#film-stock','grade-minimum');await popup(page,'#'+await scope.getAttribute('id'),'scopes-minimum');
 await page.evaluate(()=>activateWorkflowTab('proof'));
 await tooltip(page,'[data-proof-lane="hdr"]','proof-minimum');
 await popup(page,'#chrome-proof-format','proof-minimum');
 await page.locator('#chrome-proof-format').evaluate(e=>{window.selectChanges=0;e.addEventListener('change',()=>window.selectChanges++);});
 const original=await page.locator('#chrome-proof-format').inputValue();
 await page.locator('#chrome-proof-format').focus();await page.keyboard.press('Space');await page.keyboard.press('End');await page.keyboard.press('Enter');
 assert.notEqual(await page.locator('#chrome-proof-format').inputValue(),original);
 assert.equal(await page.evaluate(()=>window.selectChanges),1);
 await page.evaluate(()=>activateWorkflowTab('export'));
 await popup(page,'#export-format','export-minimum');
 await tooltip(page,'#export-preset','export-minimum');
 await page.evaluate(()=>HDRApplicationShell.openSettings('performance'));
 await popup(page,'#settings-rendering-mode','dialog-minimum');
 await page.locator('#settings-close').click();
 await page.evaluate(()=>activateWorkflowTab('import'));await lib.locator('#filter-button').click();
 await popup(lib,'#filter-rating-op','library-minimum');
 const popped=page.context().waitForEvent('page');await lib.locator('#popout-library').click();const popout=await popped;
 await popout.waitForFunction(()=>window.HDRTooltips&&window.HDRLibrary&&document.body.dataset.libraryReady==='true');
 if(!await popout.locator('#library-filterbar').isVisible())await popout.locator('#filter-button').click();await popup(popout,'#filter-rating-op','library-popout');
 await tooltip(popout,'#filter-add','library-popout');
 for(const target of [page,lib,popout]){
  const unstyled=await target.evaluate(()=>[...document.querySelectorAll('select:not([multiple], [size])')].filter(e=>getComputedStyle(e).appearance!=='base-select').map(e=>e.id||e.outerHTML));
  assert.deepEqual(unstyled,[]);
 }
 await popout.close();
 await cdp.detach();
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({support,checks,errors,cursorCapture:'OS cursor omitted by Electron screenshot; pipette.svg is the actual cursor asset.'},null,2));
 assert.deepEqual(errors,[]);console.log('UI picker/help/select checks passed');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
