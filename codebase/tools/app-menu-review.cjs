// Application menu review: square panels, neutral highlight, shortcuts on the
// right, and submenus that stay open while the pointer crosses the panel gap.
// Run: node tests/run-in-electron.js tools/app-menu-review.cjs
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/review/app-menu');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('[data-desktop-command="open-source"]')?.dataset.shortcut);
 const box=sel=>page.locator(sel).first().evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
 const centre=async sel=>{const b=await box(sel);return [(b.left+b.right)/2,(b.top+b.bottom)/2];};
 for(const theme of ['default-dark','modern-dark','studio-gray','default-light']){
  await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);
  await page.locator('#settings-close').click();await page.mouse.move(900,700);
  await page.locator('.unified-menu-button').click();
  const file='.window-menu:nth-child(1)',view='.window-menu:nth-child(3)';
  await page.locator(file+' .window-menu-trigger').hover();
  const panel=await page.locator('.window-menu-bar').evaluate(e=>getComputedStyle(e).borderTopLeftRadius);assert.equal(panel,'0px',theme+' panel corners');
  const row=await page.locator(file+' .window-menu-trigger').evaluate(e=>getComputedStyle(e).borderTopLeftRadius);assert.notEqual(row,'0px',theme+' row corners');
  const bar=await box('.window-menu-bar'),pop=await box(file+' .window-menu-popover'),trig=await box(file+' .window-menu-trigger');
  assert.ok(pop.left>bar.right&&pop.left-bar.right<=6,theme+' File panel gap '+JSON.stringify({bar,pop}));
  const inset=await page.locator(file+' .window-menu-popover').evaluate(e=>{const s=getComputedStyle(e);return parseFloat(s.paddingTop)+parseFloat(s.borderTopWidth);});
  assert.ok(Math.abs((pop.top+inset)-trig.top)<=1.5,theme+' File panel level with its row');
  const shortcut=await page.locator('[data-desktop-command="open-source"]').evaluate(e=>getComputedStyle(e,'::after').content);
  assert.match(shortcut,/Ctrl\+O|⌘O/,theme+' Open image shortcut');
  await page.locator('[data-desktop-command="open-source"]').hover();
  await page.screenshot({path:path.join(out,theme+'-file.png'),clip:{x:0,y:0,width:620,height:480}});
  // View > Preview compares, then glide across the gap into the submenu.
  await page.locator(view+' .window-menu-trigger').hover();
  await page.locator(view+' .window-submenu-trigger').first().hover();
  await page.locator(view+' .window-submenu-popover').first().waitFor({state:'visible'});
  const [sx,sy]=await centre(view+' .window-submenu-trigger');
  const [tx,ty]=await centre(view+' .window-submenu-popover button:nth-child(2)');
  await page.mouse.move(sx,sy);await page.mouse.move(tx,ty,{steps:25});
  assert.equal(await page.locator(view+' .window-submenu-popover').first().isVisible(),true,theme+' submenu stays open across the gap');
  await page.screenshot({path:path.join(out,theme+'-view-submenu.png'),clip:{x:0,y:0,width:720,height:360}});
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  checks.push(theme+': square panels, rounded rows, aligned panels, shortcut labels, submenu gap');
 }
 await page.evaluate(()=>{HDRApplicationShell.openSettings('appearance');document.querySelector('[data-theme-option="default-dark"]').click();});
 await page.locator('#settings-close').click();
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Application menu review</title><style>body{background:#292929;color:#eee;font:16px system-ui}img{max-width:100%;height:auto}figure{margin:16px}</style><h1>Application menu review</h1>'+fs.readdirSync(out).filter(f=>f.endsWith('.png')).map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));
 console.log('Application menu review passed:',checks);
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
