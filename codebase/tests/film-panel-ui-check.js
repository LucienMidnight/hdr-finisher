const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function checkFilmPanel(page) {
 const group = page.locator('[data-group="film-look"]');
 const head = group.locator(':scope > .control-group-header .group-toggle');
 if (await head.getAttribute('aria-expanded') !== 'true') await head.click();
 const originalFilm=await page.evaluate(()=>JSON.stringify(state.adjustments[state.currentView].film_look));
 const stage = name => group.locator(`[data-film-section="${name}"] .film-stage-heading`);
 for (const name of ['camera','negative','development','print','scan']) {
  const button = stage(name);
  assert.equal(await button.getAttribute('aria-expanded'), name === 'negative' ? 'true' : 'false');
  await button.focus(); await page.keyboard.press('Enter');
  assert.equal(await button.getAttribute('aria-expanded'), name === 'negative' ? 'false' : 'true');
  await page.keyboard.press('Space');
  assert.equal(await button.getAttribute('aria-expanded'), name === 'negative' ? 'true' : 'false');
  if(name!=='negative')assert.equal(await group.locator(`[data-film-section="${name}"] .film-stage-body`).isVisible(),false);
 }
 assert.equal(await page.evaluate(()=>JSON.stringify(state.adjustments[state.currentView].film_look)),originalFilm,'folding changes processing');
 await stage('camera').click();
 await head.click(); await head.click();
 assert.equal(await stage('camera').getAttribute('aria-expanded'),'true');
 const choose = async id => {
  await page.evaluate(async id => {await switchLane('hdr');state.adjustments.hdr.film_look=HDRFilmCharacter.expand({film_stock:id,print_paper:'default'});syncControlsFromState();renderControlState();await syncGlobalEditState();},id);
 };
 await choose('none');
 assert.equal(await group.evaluate(el=>el.classList.contains('modified')),false);
 await choose('kodak_portra_400');
 assert.equal(await group.evaluate(el=>el.classList.contains('modified')),true);
 assert.equal(await group.locator('#film-look-state').innerText(),'');
 assert.equal(await group.locator('#film-lens-strength').isDisabled(),true);
 assert.equal(await group.locator('#film-lens-filter').getAttribute('aria-label'),'Lens Filter');
 assert.equal(await group.locator('[data-path="current.film_look.halation_enabled"]').getAttribute('aria-label'),'Halation');
 const format = group.locator('#film-grain-format');
 await format.selectOption('custom');
 assert.equal(await group.locator('[data-film-grain-custom]').isVisible(),true);
 await group.locator('[data-stock-reset="grain_film_format"]').click();
 assert.equal(await group.locator('[data-film-grain-custom]').isVisible(),false);
 // Equal-to-baseline is still deliberate, and dots must be reset buttons before names.
 await group.locator('[data-film-stage="Format"][data-film-recipe="1"]').click();
 assert.match(await group.locator('[data-film-section="camera"] .film-stage-mod').innerText(),/1 Mod/);
 assert.equal(await group.locator('[data-stock-reset="grain_film_format"]').isVisible(),true);
 await group.locator('[data-stock-reset="grain_film_format"]').click();
 assert.equal(await group.locator('[data-film-section="camera"] .film-stage-mod').innerText(),'');
 await stage('camera').click();
 const grain = group.locator('#film-grain-amount');
 await grain.evaluate(c=>{c.value='24';c.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await group.locator('[data-film-section="negative"] .film-stage-mod').innerText(),'1 Mod');
 assert.equal(await group.locator('[data-control-path="current.film_look.grain_amount"]').evaluate(e=>e.classList.contains('modified')),true);
 await grain.dblclick();
 assert.equal(await group.locator('[data-stock-reset="grain_amount"]').isVisible(),false);
 assert.equal(await group.locator('[data-control-path="current.film_look.grain_amount"] .film-stock-tag').isVisible(),true);
 await stage('development').click();
 await group.locator('[data-film-push="0"]').focus();await page.keyboard.press('ArrowRight');
 assert.equal(await group.locator('[data-film-push="1"]').getAttribute('aria-pressed'),'true');
 assert.equal(await group.locator('[data-film-section="development"] .film-stage-mod').innerText(),'1 Mod');
 await group.locator('[data-stock-reset="push_pull"]').click();
 assert.equal(await group.locator('[data-film-push="0"]').getAttribute('aria-pressed'),'true');
 await stage('development').click();
 await choose('fujifilm_velvia_100');
 await stage('print').click();
 assert.equal(await group.locator('[data-film-section="print"] .film-stage-summary').innerText(),'No print');
 for (const button of await group.locator('.film-print-controls button, .film-print-controls select, .film-print-controls input').all()) assert.equal(await button.isDisabled(),true);
 await stage('negative').click();
 await head.scrollIntoViewIfNeeded();
 const output = path.resolve(__dirname,'../../output');
 const capture = async name => {
  // Unclip the real rail only for a complete panel capture; restore every style afterwards.
  const previous = await group.evaluate(g => {
   const nodes=[];let node=g;
   while(node){nodes.push([node,node.getAttribute('style')]);node.style.setProperty('overflow','visible','important');node.style.setProperty('height','auto','important');node.style.setProperty('max-height','none','important');node=node.parentElement;}
   window.__filmCaptureStyles=nodes;
   document.querySelectorAll('.grade-header').forEach(n=>{nodes.push([n,n.getAttribute('style')]);n.style.position='static';});
   return true;
  });
  try { await group.screenshot({path:path.join(output,`film-look-phase6-${name}.png`)}); }
  finally { if(previous)await page.evaluate(()=>{for(const [n,style] of window.__filmCaptureStyles){if(style===null)n.removeAttribute('style');else n.setAttribute('style',style);}delete window.__filmCaptureStyles;}); }
 };

 await capture('slide');
 await stage('print').click();await stage('negative').click();
 await choose('kodak_portra_400');
 await head.scrollIntoViewIfNeeded();
 await capture('hdr');
 await page.evaluate(async()=>{await switchLane('sdr');matchHdrFilmLookToSdr();renderControlState();await syncGlobalEditState();});
 assert.equal(await group.locator('#film-look-match-hdr').isVisible(),true);
 assert.match(await group.locator('#film-output-note').innerText(),/SDR/);
 await head.scrollIntoViewIfNeeded();
 await capture('sdr');
 // Exercise the shared modal through pointer/keyboard and in-memory persistence only.
 await page.evaluate(()=>{
  window.__filmPanelShell=window.HDRApplicationShell;window.__filmPanelPresets=[];
  window.HDRApplicationShell={...window.HDRApplicationShell,listGradingPresets:async()=>window.__filmPanelPresets,saveGradingPreset:async p=>window.__filmPanelPresets.push({...p,id:'generated-panel-preset'}),deleteGradingPreset:async()=>{window.__filmPanelPresets=[];}};
  window.__filmPanelConfirm=window.HDRDialogs.confirm;window.HDRDialogs.confirm=async()=>true;
 });
 try {
  await group.locator('.group-preset').click();
  assert.equal(await page.locator('#group-preset-title').innerText(),'Adjustment Presets');
  await page.locator('#group-preset-list .built-in .button-secondary').first().click();
  await group.locator('.group-preset').click();
  await page.locator('#group-preset-name').fill('Generated panel check');
  await page.locator('#group-preset-save').click();
  const saved=page.locator('#group-preset-list .group-preset-row:not(.built-in)');
  await saved.waitFor();
  await saved.locator('.button-secondary').click();
  await group.locator('.group-preset').click();
  await saved.locator('.text-button').click();
  await page.waitForFunction(()=>window.__filmPanelPresets.length===0);
  await page.keyboard.press('Escape');
 } finally {
  await page.evaluate(()=>{window.HDRApplicationShell=window.__filmPanelShell;window.HDRDialogs.confirm=window.__filmPanelConfirm;});
 }
 // A 300px panel must keep every visible interactive target within its rail.
 await page.evaluate(()=>{document.querySelector('.grade-rail').style.width='300px';});
 assert.equal(Math.round(await page.locator('.grade-rail').evaluate(e=>e.getBoundingClientRect().width)),300);
 for (const name of ['camera','negative','development','print','scan']) {
  const button=stage(name);if(await button.getAttribute('aria-expanded')!=='true')await button.click();
 }
 const overflow=await group.evaluate(g=>{
  const bounds=g.getBoundingClientRect();
  return [...g.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length && !e.hidden).filter(e=>{const r=e.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1;}).map(e=>e.id||e.textContent);
 });
 assert.deepEqual(overflow,[],'controls overflow panel');
 console.log('Phase 6 panel: folding/session, summaries/Mod, equal edits, stock tags, dots/double-click, custom format, slide locks, SDR Match, shared preset apply/save/delete, keyboard and narrow layout PASS');
};
