const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const out = path.resolve(__dirname, '../output/review/theme-settings');
fs.mkdirSync(out, {recursive:true});
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const page = await browser.newPage();
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(() => document.fonts.ready);
  const palettes = {};
  for (const theme of ['default-dark','modern-dark','default-light','studio-gray']) {
   await page.evaluate(() => HDRApplicationShell.openSettings('appearance'));
   await page.locator(`[data-theme-option="${theme}"]`).click();
   await page.waitForFunction(t => document.querySelector('#library-frame').contentDocument.documentElement.dataset.theme === t, theme);
   palettes[theme] = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--panel','--text','--muted','--border'].map(k => [k,style.getPropertyValue(k).trim()]));
   });
   if (theme === 'default-dark') {
    const ratios = await page.evaluate(() => {
     const style = getComputedStyle(document.documentElement);
     const token = k => style.getPropertyValue(k).trim();
     const luminance = hex => {
      const rgb = hex.match(/[0-9a-f]{2}/gi).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
      return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
     };
     // Every text role on every flat surface; on button plates, the text roles
     // the controls actually use (labels are --body at rest and --text on hover).
     const flat = ['--app','--panel','--raised','--input','--tooltip'];
     const pairs = [...flat.flatMap(s => ['--text','--body','--muted'].map(role => [role,s])),
      ['--body','--plate-up'],['--text','--plate-up'],['--text','--plate-up-hover'],['--text','--plate-down'],['--body','--plate-down']];
     return pairs.flatMap(([role,surface]) => token(surface).match(/#[0-9a-f]{6}/gi).map(bg => {
      const a=luminance(token(role)), b=luminance(bg);
      return {role,surface,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
     }));
    });
    for (const pair of ratios) assert.ok(pair.ratio >= 7, JSON.stringify(pair));
    console.log('Default Dark neutral text minimum contrast:',Math.min(...ratios.map(p => p.ratio)).toFixed(2)+':1');
   }
   assert.equal(await page.locator('.theme-option').count(),4);
   await page.locator('#settings-dialog').screenshot({path:path.join(out,theme+'-settings.png')});
   await page.locator('#settings-close').click();
   if (theme === 'default-dark' && process.argv.includes('--update-preview')) await page.screenshot({path:path.join(out,'default-dark-app.png')});
  }
  assert.notEqual(palettes['default-dark']['--panel'],palettes['modern-dark']['--panel']);
  assert.equal(palettes['modern-dark']['--panel'],'#121212');
  await page.evaluate(() => HDRApplicationShell.openSettings('appearance'));
  await page.locator('[data-theme-option="modern-dark"]').click();
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme),'modern-dark');
  for (const tab of ['general','performance','appearance','locations','shortcuts','updates','diagnostics']) {
   await page.evaluate(t => HDRApplicationShell.openSettings(t),tab);
   const sizes = await page.locator(`[data-settings-panel="${tab}"]`).evaluate(e => {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    return [...e.querySelectorAll('p,label,button,select,input,small,.theme-option-desc')].filter(visible).map(el => ({text:el.textContent.slice(0,35),size:parseFloat(getComputedStyle(el).fontSize)}));
   });
   for (const entry of sizes) assert.ok(entry.size >= 14.5, `${tab}: ${JSON.stringify(entry)}`);
   assert.equal(await page.locator('.settings-nav button').first().evaluate(e => getComputedStyle(e).fontSize),'16px');
   await page.locator('#settings-dialog').screenshot({path:path.join(out,tab+'.png')});
  }
  await page.locator('#settings-close').click();
  await page.locator('.unified-menu-button').click();
  const rect = await page.locator('.window-menu-bar').evaluate(e => {
   const r=e.getBoundingClientRect(), b=document.querySelector('.unified-menu-button').getBoundingClientRect(), s=getComputedStyle(e);
   return {left:r.left,iconLeft:b.left+4,border:s.borderLeftWidth};
  });
  assert.ok(Math.abs(rect.left-rect.iconLeft)<1,JSON.stringify(rect));
  assert.equal(rect.border,'2px');
  await page.locator('.window-menu-trigger').first().hover();
  assert.equal(await page.locator('.window-menu-popover').first().isVisible(),true);
  assert.equal(await page.locator('.window-menu-popover').first().evaluate(e=>getComputedStyle(e).borderLeftWidth),'2px');
  await page.screenshot({path:path.join(out,'menu.png'),clip:{x:0,y:0,width:600,height:550}});
  await page.keyboard.press('Escape');
  console.log('PASS four themes, Library sync, reload persistence, Settings type and menu alignment/borders');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
