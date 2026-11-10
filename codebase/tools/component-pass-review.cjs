const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/component-pass');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'component-pass.tiff',{type:'image/tiff'}));});await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
const crop=async(name,loc)=>{await loc.scrollIntoViewIfNeeded();await loc.screenshot({path:path.join(out,name+'.png')});};
for(const theme of ['default-dark','modern-dark','default-light','studio-gray']){
await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();await page.evaluate(()=>{activateWorkflowTab('grade');setGradeMode('global');});const keep=['default-dark','default-light'].includes(theme);
if(keep){await crop(theme+'-workflow',page.locator('.workflow-tabs'));await crop(theme+'-tabs',page.locator('#grade-workflow-panel > .grade-header'));}
assert.notEqual(await page.locator('.control-mode-switch > button').first().evaluate(e=>getComputedStyle(e).boxShadow),'none');
for(const group of ['geometry','vignette','curves','hdr-equalizer','hdr-highlights','film-look']){const loc=page.locator(`[data-group="${group}"]`).first();assert.equal(await loc.count(),1,group);await loc.evaluate(e=>e.classList.remove('collapsed'));await loc.scrollIntoViewIfNeeded();await page.evaluate(()=>{drawCurveEditor();drawToneEqualizerEditor();renderHighlightCompressionControls();});if(keep)await crop(theme+'-'+group,loc);
if(group==='geometry'){assert.equal(await page.locator('#crop-tool-toggle').getAttribute('aria-label'),'Crop');assert.equal(await page.locator('#crop-tool-toggle').evaluate(e=>e.getBoundingClientRect().height),34);}
if(group==='curves'){const widths=await loc.locator('.channel-tabs > button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));assert.ok(Math.max(...widths)-Math.min(...widths)<1);}
await loc.evaluate(e=>e.classList.add('collapsed'));}
for(const mode of ['local','retouch']){await page.evaluate(m=>setGradeMode(m),mode);const well=page.locator(mode==='local'?'.local-stack-surface':'.repair-stack-surface').first();await well.scrollIntoViewIfNeeded();assert.equal(await well.evaluate(e=>getComputedStyle(e).overflowY),'scroll');if(keep)await crop(theme+'-'+mode,well);
if(mode==='local') {
await page.locator('[data-local-tool="brush"]').click();
await page.evaluate(()=>{const list=document.getElementById('local-adjustment-list');while(list.children.length<7){const row=list.firstElementChild.cloneNode(true);row.dataset.componentFixture='true';list.append(row)}});
const rows=await page.locator('#local-adjustment-list > li').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.ok(rows.every(h=>h===34));
if(keep)await crop(theme+'-local-filled',well);
await page.evaluate(()=>document.querySelectorAll('[data-component-fixture]').forEach(e=>e.remove()));
await page.keyboard.press('Escape');
}}
await page.evaluate(()=>activateWorkflowTab('import'));if(keep)await crop(theme+'-pinned',page.frameLocator('#library-frame').locator('.library-nav'));
}assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({passed:'Four themes: segment shadows, equal curve tab widths, crop naming and size, permanent list rails; two-theme captures; no page errors'},null,2));fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../../../../frontend/visual-tokens.css"><title>Component pass</title><style>body{background:var(--panel);color:var(--text);font:var(--font-size-lg) var(--font-body)}img{max-width:100%}figure{display:inline-block;vertical-align:top}</style><h1>Component pass review</h1>'+fs.readdirSync(out).filter(f=>f.endsWith('.png')).map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));console.log('Component pass passed',out);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
