const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/ui-polish');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
 await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'ui-polish.tiff',{type:'image/tiff'}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
 const after=process.argv.includes('--after'),prefix=after?'after':'before';
 const shot=async(name,locator)=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);await (locator||page).screenshot({path:path.join(out,`${prefix}-${name}.png`)});};
 if(after){
  await page.keyboard.press('F10');assert.equal(await page.locator('.window-menu-bar').isVisible(),true);
  await page.locator('.window-menu-trigger').first().click();await page.locator('[data-desktop-command="recent-projects"]').click();
  await page.locator('#recent-projects-dialog').waitFor({state:'visible'});await page.locator('#recent-projects-close').click();
  await page.keyboard.press('Alt');assert.equal(await page.locator('.window-menu-bar').isVisible(),true);await page.keyboard.press('Escape');
  assert.equal(await page.locator('.window-menu-bar').isVisible(),false);
  await page.evaluate(async folder=>{const lib=document.querySelector('#library-frame').contentWindow;
   await lib.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});await lib.HDRLibrary.refreshPins();
   const key='hdr-finisher:library-show-all-files';lib.localStorage.setItem(key,'true');lib.dispatchEvent(new lib.StorageEvent('storage',{key,newValue:'true'}));await lib.HDRLibrary.browse(folder);
  },path.resolve(__dirname,'../output/test-photos/v1-visual-sources'));
 }
 for(const theme of (process.argv.includes('--checks-only')?[]:['default-dark','default-light','studio-gray'])){
  await page.evaluate(()=>HDRApplicationShell.openSettings('appearance'));await page.locator(`[data-theme-option="${theme}"]`).click();await page.locator('#settings-close').click();
  if(!process.argv.includes('--wheel-only'))for(const workflow of ['import','grade','export']){await page.evaluate(w=>activateWorkflowTab(w),workflow);await shot(`${theme}-${workflow}`);}
  if(!after)continue;
  await page.evaluate(()=>{activateWorkflowTab('grade');setGradeMode('global');});
  const open=async group=>{await page.evaluate(name=>{for(const p of document.querySelectorAll('.control-group:not(.collapsed)'))if(p.dataset.group!==name)p.querySelector('.group-toggle')?.click();const p=document.querySelector(`[data-group="${name}"]`);if(p?.classList.contains('collapsed'))p.querySelector('.group-toggle').click();},group);};
  await open('color-grading');const host=page.locator('.grading-wheels');await host.scrollIntoViewIfNeeded();
  await page.evaluate(()=>{state.adjustments.hdr.color_grading.shadows={hue:42,saturation:27,luminance_ev:.15};syncControlsFromState();});
  await page.locator('[data-wheel-range="midtones"]').click();await page.locator('[data-wheel-range="shadows"]').click();
  assert.equal(await page.locator('[data-path="current.color_grading.shadows.hue"]').inputValue(),'42');
  assert.equal(await page.locator('.grading-wheel:visible').count(),1);await shot(`${theme}-wheel`,host);
  await page.locator('.grading-wheel:visible .color-wheel-pad').dblclick();
  assert.deepEqual(await page.evaluate(()=>state.adjustments.hdr.color_grading.shadows),{hue:0,saturation:0,luminance_ev:0});
  if(process.argv.includes('--wheel-only'))continue;
  for(const [group,id] of [['curves','curve-editor'],['hdr-equalizer','tone-equalizer-editor'],['hdr-highlights','highlight-compression-graph']]){await open(group);const graph=page.locator('#'+id);await graph.scrollIntoViewIfNeeded();await shot(`${theme}-${id}`,graph);}
  await page.evaluate(()=>switchLane('sdr'));
  for(const [group,id] of [['sdr-equalizer','sdr-tone-equalizer-editor'],['sdr-highlights','sdr-highlight-compression-graph']]){await open(group);const graph=page.locator('#'+id);await graph.scrollIntoViewIfNeeded();await shot(`${theme}-${id}`,graph);}
  await page.evaluate(()=>switchLane('hdr'));
  for(const type of ['histogram','waveform','vectorscope']){await page.locator('#scope-mode').selectOption(type);await page.waitForTimeout(900);await shot(`${theme}-${type}`,page.locator('#histogram'));}
  await page.setViewportSize({width:1100,height:720});
  for(const workflow of ['import','grade','export']){await page.evaluate(w=>activateWorkflowTab(w),workflow);await shot(`${theme}-minimum-${workflow}`);}
  await page.setViewportSize({width:2560,height:1440});
 }
 if(after&&!process.argv.includes('--wheel-only')){
  await page.evaluate(async folder=>{await batchExport.open([folder+'/Review-1.png']);},path.resolve(__dirname,'../output/test-photos/v1-visual-sources'));
  await page.waitForFunction(()=>document.querySelector('#batch-count').textContent.startsWith('1 photo '));
  assert.ok(!(await page.locator('#batch-summary').textContent()).includes('1 photos'));
  await shot('export-one-photo');
  await page.setViewportSize({width:1100,height:720});
  for(const workflow of ['import','grade','export']){await page.evaluate(w=>activateWorkflowTab(w),workflow);await shot(`minimum-${workflow}`);}
  await page.evaluate(()=>activateWorkflowTab('grade'));await page.waitForTimeout(250);
  const geometry=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bar:[...document.querySelectorAll('.top-bar .workflow-tab,.top-bar .window-control,.grade-autosave')].map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent||e.getAttribute('aria-label'),left:r.left,right:r.right};})}));
  const dock=await page.evaluate(()=>{const r=document.querySelector('#scope-view'),box=r.getBoundingClientRect();return [...r.querySelectorAll('*')].map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {id:e.id,cls:e.className,w:b.width,left:b.left-box.left,right:b.right-box.left,scroll:e.scrollWidth,grid:s.gridTemplateColumns};});});console.log(JSON.stringify({dock}));
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({menu:'F10, Alt, Escape and File Recent projects passed',wheel:'range retention, one visible wheel and selected reset passed',geometry,overflow:await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.clientWidth>0&&e.scrollWidth>e.clientWidth+2&&getComputedStyle(e).overflowX==='auto'&&getComputedStyle(e).visibility==='visible').map(e=>({id:e.id,cls:e.className,width:e.clientWidth,scroll:e.scrollWidth}))),errors},null,2));assert.deepEqual(errors,[]);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:2,mobile:false});
  await page.evaluate(()=>{activateWorkflowTab('grade');drawHistogram(state.lastScope);});
  await shot('high-dpi-scope',page.locator('#histogram'));
  await cdp.detach();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
