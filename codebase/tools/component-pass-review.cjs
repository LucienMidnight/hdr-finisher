const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/component-pass');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'component-pass.tiff',{type:'image/tiff'}));});await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
if(process.argv.includes('--graphs-only')) {
 await page.locator('#grade-splitter').press('End');await page.locator('#grade-splitter').press('Home');
 assert.equal(await page.evaluate(()=>state.layout.gradeW),328);
 assert.equal(await page.locator('#grade-splitter').getAttribute('aria-valuemin'),'328');
 const cdp=await page.context().newCDPSession(page),checks=[],shots=[];
 const shot=async(name,loc)=>{await loc.scrollIntoViewIfNeeded();await loc.screenshot({path:path.join(out,name+'.png')});shots.push(name+'.png');};
 const contained=async(selector)=>page.locator(selector).evaluate(e=>{
 const p=e.getBoundingClientRect();const children=[...e.querySelectorAll('button,input[type=range]')].filter(x=>x.getClientRects().length&&!x.closest('[hidden],.workflow-side-panel')).map(x=>{const r=x.getBoundingClientRect();return {id:x.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom}});
 return children.every(r=>r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1)&&children.every((a,i)=>children.slice(i+1).every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<1));});
 for(const theme of ['default-dark','default-light']) {
 await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
 for(const [size,width,appWidth] of [['minimum',328,1100],['normal',380,2560]]) {
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:appWidth,height:1440,deviceScaleFactor:1,mobile:false});
 await page.evaluate(w=>{state.layout.gradeW=w;applyLayoutState();setGradeMode('global');document.querySelectorAll('.control-group').forEach(e=>e.classList.add('collapsed'));for(const name of ['curves','hdr-equalizer'])document.querySelector(`[data-group="${name}"]`).classList.remove('collapsed');},width);
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.evaluate(()=>{drawCurveEditor();drawToneEqualizerEditor();});
 const geometry=await page.evaluate(()=>[...document.querySelectorAll('[data-group="hdr-equalizer"] .tone-equalizer-actions > *')].map(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);return {text:e.textContent,lines:range.getClientRects().length,left:r.left,right:r.right,parentRight:p.right,scroll:e.scrollWidth,client:e.clientWidth};}));
 assert.ok(geometry.every(x=>x.lines===1&&x.right<=x.parentRight+1&&x.scroll<=x.client+1),JSON.stringify(geometry));
 assert.equal(await contained('.top-bar'),true);assert.equal(await contained('.viewer-bar'),true);
 for(const id of ['curve-editor','tone-equalizer-editor'])assert.equal(await page.locator('#'+id).evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[3]),0,id+' gutter is transparent');
 const prefix='graphs-'+theme+'-'+size;
 await shot(prefix,page.locator('#grade-workflow-panel'));
 await page.evaluate(()=>{document.querySelector('[data-group="hdr-highlights"]').classList.remove('collapsed');renderHighlightCompressionControls();});
 await shot(prefix+'-compression',page.locator('[data-group="hdr-highlights"]'));
 assert.equal(await page.locator('#highlight-compression-graph').evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[3]),0);
 await page.locator('#view-sdr').click();
 await page.locator('[data-group="sdr-equalizer"]').evaluate(e=>e.classList.remove('collapsed'));
 await page.locator('[data-group="sdr-equalizer"]').scrollIntoViewIfNeeded();
 await page.evaluate(()=>drawToneEqualizerEditor());
 assert.equal(await page.locator('#sdr-tone-equalizer-editor').evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[3]),0);
 const sdr=await page.locator('[data-group="sdr-equalizer"] .tone-equalizer-actions').evaluate(row=>[...row.children].every(e=>{const r=document.createRange();r.selectNodeContents(e);return r.getClientRects().length===1&&e.getBoundingClientRect().right<=row.getBoundingClientRect().right+1;}));assert.ok(sdr,'SDR actions fit');
 await page.locator('#view-hdr').click();
 // Both rendition action rows obey the same layout at the minimum.
 await page.evaluate(()=>{document.querySelector('[data-group="hdr-highlights"]').classList.add('collapsed');});
 checks.push({theme,size,panelWidth:width,appWidth,actions:'one line and contained',gutters:'transparent',toolbar:'contained, no overlaps'});
 if(size==='minimum')await shot(prefix+'-toolbar',page.locator('.viewer-bar'));
 }
 await shot('graphs-'+theme+'-histogram',page.locator('#histogram'));
 }
 assert.deepEqual(errors,[]);await cdp.detach();
 fs.writeFileSync(path.join(out,'graph-checks.json'),JSON.stringify({checks,errors},null,2));
 const review=path.join(out,'index.html');let html=fs.existsSync(review)?fs.readFileSync(review,'utf8'): '<!doctype html><meta charset="utf-8"><title>Component review</title>';
 html=html.replace(/<section id="graph-followup">[\s\S]*?<\/section>/,'');
 html+='<section id="graph-followup"><h2>Grade graph follow-up</h2><p>328 px minimum (previously 320); 380 px normal. Default Dark and Default Light. Minimum-width toolbar at 1100 px. Transparent axis gutters, original Curves zone bands.</p>'+shots.map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join('')+'</section>';
 fs.writeFileSync(review,html);console.log('Graph follow-up passed',checks);return;
}
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
