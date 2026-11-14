const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/ui-polish/round-6');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 await page.frameLocator('#library-frame').locator('#single-view').waitFor();
 await page.evaluate(async folder=>{const lib=document.querySelector('#library-frame').contentWindow;
 await lib.fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[folder]})});await lib.HDRLibrary.refreshPins();
 const key='hdr-finisher:library-show-all-files';lib.localStorage.setItem(key,'true');lib.dispatchEvent(new lib.StorageEvent('storage',{key,newValue:'true'}));await lib.HDRLibrary.browse(folder);
 },require('./lib/visual-test-photos.cjs')());
 await page.evaluate(async()=>{const r=await fetch('/api/proof/test-pattern');await importByteFile(new File([await r.blob()],'round6.tiff',{type:'image/tiff'}));});
 await page.waitForFunction(()=>state.session&&document.body.dataset.workflow==='grade');
 const cdp=await page.context().newCDPSession(page);
 const shot=async(name,loc)=>{await loc.evaluate(e=>e.ownerDocument.fonts.ready);await loc.screenshot({path:path.join(out,name+'.png')});};
 const contained=async(loc)=>loc.evaluate(e=>{const p=e.getBoundingClientRect();return {parent:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},children:[...e.querySelectorAll('button,input[type=range]')].filter(x=>x.getClientRects().length&&!x.closest('[hidden], .workflow-side-panel')).map(x=>{const r=x.getBoundingClientRect();return {id:x.id||x.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});
 const check=async(loc,label)=>{const g=await contained(loc);assert.ok(g.children.every(r=>r.left>=g.parent.left-1&&r.right<=g.parent.right+1&&r.top>=g.parent.top-1&&r.bottom<=g.parent.bottom+1),label+JSON.stringify(g));};
 for(const size of [{width:2560,height:1440},{width:1100,height:720}]){
 await cdp.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
 for(const theme of ['modern-dark','default-light','studio-gray']){
 const pre=theme+'-'+size.width;
 await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
 await page.evaluate(()=>activateWorkflowTab('import'));
 await page.mouse.move(800,500);await page.locator('.unified-menu-button').blur();
 const rest=await page.locator('.unified-menu-button').evaluate(e=>getComputedStyle(e).color);
 await shot(pre+'-menu-rest',page.locator('.product-lockup'));
 await page.locator('.unified-menu-button').hover();
 const hover=await page.locator('.unified-menu-button').evaluate(e=>getComputedStyle(e).color);assert.notEqual(rest,hover);
 await shot(pre+'-menu-hover',page.locator('.product-lockup'));
 await page.locator('.unified-menu-button').click();await page.locator('.window-menu-trigger').first().hover();
 assert.equal(await page.locator('.window-menu-popover').first().isVisible(),true);
 const menu=await page.locator('.window-menu-bar').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.querySelector('.window-menu-popover').getBoundingClientRect();return {right:r.right,left:p.left,top:r.top,bottom:p.bottom,width:innerWidth,height:innerHeight};});
 assert.ok(menu.left>=menu.right-6&&menu.bottom<=menu.height,JSON.stringify(menu));
 await page.screenshot({path:path.join(out,pre+'-menu.png'),clip:{x:0,y:0,width:Math.min(700,size.width),height:Math.min(620,size.height)}});
 await page.keyboard.press('Escape');
 for(const key of ['F10','Alt']){
 await page.keyboard.press(key);assert.equal(await page.locator('.window-menu-bar').isVisible(),true);
 await page.keyboard.press('ArrowDown');assert.equal(await page.locator('.window-menu-trigger').nth(1).evaluate(e=>document.activeElement===e),true);
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.window-menu-popover').nth(1).isVisible(),true);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('.window-menu-trigger').nth(1).evaluate(e=>document.activeElement===e),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.window-menu-bar').isVisible(),false);
 }
 const lib=page.frameLocator('#library-frame');
 for(const mode of ['grid','single']){
 await lib.locator('#'+mode+'-view').click();
 await check(lib.locator('.library-toolbar'),pre+' Library '+mode);
 const title=await lib.locator('.library-bar-title').evaluate(e=>e.getBoundingClientRect().width);assert.ok(title>=59);
 await shot(pre+'-library-'+mode,lib.locator('.library-toolbar'));
 if(size.width===1100)await page.screenshot({path:path.join(out,pre+'-library-'+mode+'-page.png')});
 }
 await lib.locator('#grid-view').click();await page.mouse.move(850,600);
 const adds=lib.locator('.library-heading > .text-button');assert.equal(await adds.first().evaluate(e=>getComputedStyle(e).opacity),'0');
 await shot(pre+'-sidebar-rest',lib.locator('.library-nav'));
 await lib.locator('.library-heading').first().hover();assert.equal(await adds.first().evaluate(e=>getComputedStyle(e).opacity),'1');
 await shot(pre+'-sidebar-hover',lib.locator('.library-nav'));
 await adds.first().focus();await page.mouse.move(850,600);assert.equal(await adds.first().evaluate(e=>getComputedStyle(e).opacity),'1');
 for(const workflow of ['grade','proof','export']){
 await page.evaluate(w=>activateWorkflowTab(w),workflow);
 await check(page.locator('.top-bar'),pre+' top');
 const toolbar=page.locator(workflow==='export'?'.batch-header':'.viewer-bar');
 await toolbar.waitFor();await check(toolbar,pre+' '+workflow);
 await shot(pre+'-'+workflow+'-toolbar',toolbar);
 await shot(pre+'-'+workflow+'-top',page.locator('.top-bar'));
 if(size.width===1100)await page.screenshot({path:path.join(out,pre+'-'+workflow+'-page.png')});
 if(workflow==='export'){
 const g=await page.locator('.batch-header').evaluate(e=>{const r=e.getBoundingClientRect(),t=e.querySelector('.batch-heading').getBoundingClientRect(),c=e.querySelector('.batch-tools').getBoundingClientRect();return {actual:(c.left+c.right)/2,expected:(t.right+parseFloat(getComputedStyle(e).columnGap)+r.right-parseFloat(getComputedStyle(e).paddingRight))/2,titleRight:t.right,controlsLeft:c.left};});
 assert.ok(g.controlsLeft>=g.titleRight&&Math.abs(g.actual-g.expected)<5,JSON.stringify(g));
 await page.locator('#batch-view-preview').click();await check(page.locator('.viewer-bar'),pre+' Export Single');
 await shot(pre+'-export-single-toolbar',page.locator('.viewer-bar'));
 if(size.width===1100)await page.screenshot({path:path.join(out,pre+'-export-single-page.png')});
 await page.locator('#batch-view-grid').click();
 }
 }
 await page.evaluate(()=>activateWorkflowTab('grade'));
 await page.locator('.zoom-control .range-shell').evaluate(e=>e.dataset.modified='true');
 const zoom=await page.locator('.zoom-control .slider-fill').evaluate(e=>getComputedStyle(e).backgroundImage);
 const thumb=await lib.locator('.library-size .slider-fill').evaluate(e=>getComputedStyle(e).backgroundImage);assert.equal(zoom,thumb);
 await shot(pre+'-zoom',page.locator('.zoom-control'));
 checks.push(pre+': menus, keyboard, hover, neutral sliders, toolbar containment, sidebar focus and Export centring pass');
 }
 }
 assert.deepEqual(errors,[]);await cdp.detach();
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors},null,2));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Round 6 UI review</title><style>body{background:#292929;color:#eee;font:16px system-ui}img{max-width:100%;height:auto}figure{margin:16px}</style><h1>Round 6 UI review</h1>'+fs.readdirSync(out).filter(f=>f.endsWith('.png')).map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));
 console.log('Round 6 review passed:',out);
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
