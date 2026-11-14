const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/ui-polish/round-3');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'round3.tiff',{type:'image/tiff'}));});
await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
const crop=async(name,loc)=>{await loc.scrollIntoViewIfNeeded();await loc.screenshot({path:path.join(out,name+'.png')});};
for(const theme of ['modern-dark','default-light','studio-gray']){
await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
await page.evaluate(()=>{activateWorkflowTab('grade');setGradeMode('global');revealSourceRail();const g=document.querySelector('[data-group="color-grading"]');if(g.classList.contains('collapsed'))g.querySelector('.group-toggle').click();});
await crop(theme+'-mode-and-rendition',page.locator('#grade-workflow-panel > .grade-header'));
await crop(theme+'-rendition',page.locator('.lane-switch'));
await crop(theme+'-wheel-ranges',page.locator('.color-grading-group'));
await crop(theme+'-top-bar',page.locator('.top-bar'));
for(const selector of ['.rail-title-row .panel-title','.control-title-row .panel-title','#preview-window-title','.dock-panel-title']){const loc=page.locator(selector).first();if(!await loc.isVisible())continue;await page.mouse.move(700,60);const before=await loc.boundingBox();await loc.hover();assert.deepEqual(await loc.boundingBox(),before,selector);assert.equal(await loc.evaluate(e=>getComputedStyle(e).textTransform),'none');}
await crop(theme+'-metadata',page.locator('.rail-title-row'));
assert.equal(await page.locator('.workflow-tab > span').first().evaluate(e=>getComputedStyle(e).fontSize),'21px');
for(const [sel,h] of [['.control-mode-switch',30],['.lane-switch',25],['.wheel-range-tabs',21]]){const loc=page.locator(sel+' > button').first();assert.equal(await loc.evaluate(e=>e.getBoundingClientRect().height),h);assert.equal(await loc.evaluate(e=>getComputedStyle(e).borderBottomWidth),'0px');}
await page.locator('.unified-menu-button').click();assert.equal(await page.locator('.window-menu-bar').isVisible(),true);await page.keyboard.press('Escape');
await page.evaluate(()=>activateWorkflowTab('import'));await crop(theme+'-library-titles',page.frameLocator('#library-frame').locator('.library-nav'));
await page.evaluate(()=>activateWorkflowTab('export'));await crop(theme+'-export-title',page.locator('.batch-preset-rail .workflow-rail-header'));
}
await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{activateWorkflowTab('grade');revealSourceRail();});assert.equal(await page.evaluate(()=>innerWidth),1440,'narrow viewport applied');const title=page.locator('.rail-title-row .panel-title');await page.mouse.move(700,60);const before=await title.boundingBox();await title.hover();assert.deepEqual(await title.boundingBox(),before,'narrow hover');await crop('narrow-metadata-hover',page.locator('.rail-title-row'));assert.deepEqual(errors,[]);
fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({passed:'Three themes: tab heights, no panel underlines, workflow numbers, title casing/stable hover, menu open/Escape; narrow Metadata hover; no page errors'},null,2));
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>UI polish round 3</title><style>body{background:#292929;color:#eee;font:16px system-ui}figure{margin:16px}img{max-width:100%;height:auto}</style><h1>UI polish round 3</h1>'+fs.readdirSync(out).filter(f=>f.endsWith('.png')).map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));console.log('Round 3 checks passed:',out);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
