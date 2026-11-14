const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/ui-polish/round-4');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 await page.evaluate(async folder=>{const lib=document.querySelector('#library-frame').contentWindow;
 await lib.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});await lib.HDRLibrary.refreshPins();
 const key='hdr-finisher:library-show-all-files';lib.localStorage.setItem(key,'true');lib.dispatchEvent(new lib.StorageEvent('storage',{key,newValue:'true'}));await lib.HDRLibrary.browse(folder);
 },require('./lib/visual-test-photos.cjs')());
 const cdp=await page.context().newCDPSession(page);
 const shot=async(name,loc)=>{await page.evaluate(()=>document.fonts.ready);await loc.screenshot({path:path.join(out,name+'.png')});};
 const font=async loc=>assert.match(await loc.evaluate(e=>getComputedStyle(e).fontFamily),/Sofia Sans Semi Condensed/);
 const themes=['default-dark','default-light','studio-gray'];
 for(const size of [{width:2560,height:1440},{width:1100,height:720}]){
 await cdp.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
 for(const theme of themes){
 const prefix=theme+'-'+size.width;
 await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
 await page.evaluate(()=>activateWorkflowTab('export'));await page.locator('#batch-run').waitFor();
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 assert.equal(await page.locator('#batch-run').isDisabled(),true);
 const geom=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),p=r('#batch-grid-panel'),h=r('.batch-header'),e=r('#batch-empty');return {actual:e.top+e.height/2,expected:(h.bottom+p.bottom)/2};});
 assert.ok(Math.abs(geom.actual-geom.expected)<=2,JSON.stringify(geom));
 await shot(prefix+'-export-empty',page.locator('#batch-grid-panel'));
 await shot(prefix+'-export-disabled',page.locator('.batch-export-footer'));
 await shot(prefix+'-top-bar',page.locator('.top-bar'));
 await font(page.locator('.workflow-tab').first());await font(page.locator('.workflow-tab > span').first());
 assert.equal(await page.locator('.workflow-tab > span').first().evaluate(e=>getComputedStyle(e).fontSize),'16px');
 await font(page.locator('#export-sheet .panel-title').first());
 const colors=await page.locator('#batch-run').evaluate(e=>({bg:getComputedStyle(e).backgroundImage,color:getComputedStyle(e).color}));
 const neutral=await page.locator('#batch-run').evaluate(e=>{const probe=document.createElement('div');probe.style.background='var(--plate-up)';e.append(probe);const bg=getComputedStyle(probe).backgroundImage;probe.remove();return bg;});
 assert.equal(colors.bg,neutral,'disabled button uses the neutral plate');
 for(const on of [true,false]){
 await page.locator('#export-with-frame').setChecked(on);await page.locator('#export-prevent-enlargement').setChecked(on);
 for(const id of ['export-with-frame','export-prevent-enlargement']){
 const style=await page.locator('#'+id).evaluate(e=>({border:getComputedStyle(e.parentElement).borderTopWidth,knob:getComputedStyle(e,'::before').backgroundImage}));
 assert.equal(style.border,'0px');if(on)assert.match(style.knob,/255, 255, 255/);
 }
 await shot(prefix+'-settings-'+(on?'on':'off'),page.locator('.batch-settings-scroll'));
 }
 const resize=await page.locator('#export-resize-mode').evaluate(e=>{const c=document.createElement('canvas').getContext('2d'),s=getComputedStyle(e);c.font=s.font;return {text:e.selectedOptions[0].textContent,need:c.measureText(e.selectedOptions[0].textContent).width+parseFloat(s.paddingLeft)+parseFloat(s.paddingRight),width:e.clientWidth};});
 assert.equal(resize.text,'Original (cropped)');assert.ok(resize.need<=resize.width,JSON.stringify(resize));
 await page.locator('.unified-menu-button').click();await page.locator('.window-menu-trigger').first().click();
 assert.equal(await page.locator('#project-open').textContent(),'Open project\u2026');
 await shot(prefix+'-file-menu',page.locator('.window-menu-popover').first());
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.evaluate(()=>activateWorkflowTab('import'));
 const lib=page.frameLocator('#library-frame');await lib.locator('.library-toolbar').waitFor();
 assert.equal(await lib.locator('#zoom-button').isVisible(),false);
 await shot(prefix+'-library-toolbar',lib.locator('.library-toolbar'));await shot(prefix+'-library-titles',lib.locator('.library-heading').first());
 await font(lib.locator('.panel-title').first());
 const bounds=await lib.locator('.library-toolbar').evaluate(e=>[...e.querySelectorAll('button')].filter(x=>x.getClientRects().length).map(x=>{const r=x.getBoundingClientRect(),p=e.getBoundingClientRect();return {id:x.id,left:r.left,right:r.right,width:innerWidth,top:r.top,bottom:r.bottom,parentBottom:p.bottom};}));
 assert.ok(bounds.every(b=>b.left>=0&&b.right<=b.width&&b.bottom<=b.parentBottom),JSON.stringify(bounds));
 await lib.locator('#single-view').click();assert.equal(await lib.locator('#zoom-button').isVisible(),true);await shot(prefix+'-library-single-toolbar',lib.locator('.library-toolbar'));await lib.locator('#grid-view').click();
 checks.push(prefix+': title fonts, workflow number size, centred empty state, switch materials/plain rows, resize label fit, hidden Grid/visible Single 100%, toolbar containment');
 }
 }
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:2560,height:1440,deviceScaleFactor:1,mobile:false});
 await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'round4.tiff',{type:'image/tiff'}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
 for(const size of [{width:2560,height:1440},{width:1100,height:720}]){
 await cdp.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
 for(const theme of themes){
 await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
 await page.evaluate(()=>{activateWorkflowTab('grade');revealSourceRail();});
 await shot(theme+'-'+size.width+'-grade-titles',page.locator('.control-title-row'));await shot(theme+'-'+size.width+'-grade-tabs',page.locator('#grade-workflow-panel > .grade-header'));
 await font(page.locator('.control-mode-switch > button').first());
 assert.match(await page.locator('.group-toggle').first().evaluate(e=>getComputedStyle(e).fontFamily),/Afacad/);
 const clipped=await page.locator('.panel-title:visible, .control-mode-switch > button:visible, .workflow-tab:visible').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect();return e.scrollWidth>e.clientWidth+1||r.left<0||r.right>innerWidth;}).map(e=>e.textContent));assert.deepEqual(clipped,[]);
 await page.evaluate(async photo=>batchExport.open([photo]),path.join(require('./lib/visual-test-photos.cjs')(),'IMG_6717.PNG'));
 await page.waitForFunction(()=>!document.querySelector('#batch-run').disabled);
 await shot(theme+'-'+size.width+'-export-enabled',page.locator('.batch-export-footer'));
 }
 }
 await cdp.detach();assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors},null,2));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>UI polish round 4</title><style>body{background:#292929;color:#eee;font:16px system-ui}figure{margin:16px}img{max-width:100%;height:auto}</style><h1>UI polish round 4</h1>'+fs.readdirSync(out).filter(f=>f.endsWith('.png')).map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));
 console.log('Round 4 review passed:',out);
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
