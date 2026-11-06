const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/ui-polish/round-5');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 const cdp=await page.context().newCDPSession(page);
 for(const size of [{width:2560,height:1440},{width:1100,height:720}]){
 await cdp.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
 for(const theme of ['default-dark','default-light','studio-gray']){
 await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
 for(const [i,workflow] of ['import','grade','proof','export'].entries()){
 await page.locator(`[data-workflow-tab="${workflow}"]`).click();
 assert.equal(await page.locator(`[data-workflow-tab="${workflow}"]`).getAttribute('aria-selected'),'true');
 const geometry=await page.evaluate(()=>{const r=e=>{const x=e.getBoundingClientRect();return {left:x.left,right:x.right,top:x.top,bottom:x.bottom,height:x.height,width:x.width};};return {bar:r(document.querySelector('.top-bar')),menu:r(document.querySelector('.unified-menu-button')),autosave:r(document.querySelector('.grade-autosave')),tabs:[...document.querySelectorAll('.workflow-tab')].map(e=>({rect:r(e),badge:r(e.firstElementChild),number:e.firstElementChild.textContent,font:getComputedStyle(e).fontFamily,border:getComputedStyle(e).borderBottomWidth,after:getComputedStyle(e,'::after').content,tabIndex:e.tabIndex,selected:e.getAttribute('aria-selected')}))};});
 for(const [n,t] of geometry.tabs.entries()){
 assert.equal(t.number,String(n+1));assert.equal(t.badge.width,20);assert.equal(t.badge.height,20);assert.equal(t.border,'0px');assert.match(t.font,/Sofia Sans Semi Condensed/);
 assert.ok(Math.abs((t.rect.top+t.rect.bottom-t.badge.top-t.badge.bottom)/2)<1);
 assert.ok(t.rect.left>=geometry.menu.right&&t.rect.right<=geometry.autosave.left,JSON.stringify(geometry));
 assert.equal(t.tabIndex,n===i?0:-1);assert.equal(t.selected,String(n===i));
 }
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('.top-bar').screenshot({path:path.join(out,`${theme}-${size.width}-${workflow}.png`)});
 checks.push(`${theme}/${size.width}/${workflow}: click, ARIA/focus target, font, badge size/centering, no underline, no overlap`);
 }
 }
 }
 // Exercise existing arrow navigation and focus, and the menu/Escape route.
 await page.locator('[data-workflow-tab="import"]').click();await page.locator('[data-workflow-tab="import"]').focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('[data-workflow-tab="grade"]').getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('[data-workflow-tab="grade"]').evaluate(e=>document.activeElement===e),true);
 await page.keyboard.press('Tab');assert.equal(await page.locator('.workflow-tab').evaluateAll(es=>es.includes(document.activeElement)),false);
 await page.locator('.unified-menu-button').click();assert.equal(await page.locator('.window-menu-trigger').first().isVisible(),true);await page.keyboard.press('Escape');
 // Check the renderer's macOS traffic-light reservation at minimum width.
 await page.evaluate(()=>document.documentElement.classList.add('native-application-menu'));
 const mac=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return {logo:r('.product-lockup').right,tabs:r('.workflow-tabs').left,reserve:getComputedStyle(document.querySelector('.product-lockup')).paddingLeft};});
 assert.equal(mac.reserve,'74px');assert.ok(mac.logo<=mac.tabs,JSON.stringify(mac));
 await page.locator('.top-bar').screenshot({path:path.join(out,'mac-inset-layout-1100.png')});
 await page.evaluate(()=>document.documentElement.classList.remove('native-application-menu'));
 checks.push('Arrow navigation, Tab exit, menu/Escape and simulated macOS inset containment pass; native macOS remains manual.');
 assert.deepEqual(errors,[]);await cdp.detach();
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors},null,2));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Round 5 workflow steps</title><style>body{background:#292929;color:#eee;font:16px system-ui}img{max-width:100%;height:auto}figure{margin:16px}</style><h1>Round 5 workflow steps</h1>'+fs.readdirSync(out).filter(f=>f.endsWith('.png')).map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));
 console.log('Round 5 review passed:',out);
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
