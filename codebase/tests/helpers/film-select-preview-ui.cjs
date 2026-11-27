const assert=require('node:assert/strict');
module.exports=async function checkFilmSelectPreview(page) {
  const selector='#film-lens-filter';
  await page.evaluate(async()=>{
    await switchLane('hdr');
    commitAdjustmentValue('current.film_look.lens_filter','none');
    await syncGlobalEditState();
  });
  const original=await page.evaluate(()=>({revision:state.editRevision, adjustments:JSON.stringify(state.adjustments),
    dots:[...document.querySelectorAll('.film-stock-reset')].map(el=>[el.dataset.stockReset,el.hidden])}));
  const open=async()=>{await page.locator(selector).focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#film-lens-filter').matches(':open'));};
  const next=async()=>{await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>state.filmSelectDraft && state.adjustments.hdr.film_look.lens_filter!=='none');};
  const closed=()=>page.waitForFunction(()=>!state.filmSelectDraft && !document.querySelector('#film-lens-filter').matches(':open'));
  const committed=()=>page.evaluate(async()=>{await syncGlobalEditState();await state.editCommandQueue;return state.adjustments.hdr.film_look.lens_filter;});
  await open();await next();
  await page.evaluate(()=>{window.__filmSelectOldToken=state.renderCoordinator.createToken({lane:'hdr'},state.renderCoordinator.laneState('hdr'));});
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>window.__filmSelectOldToken.isCurrent()),false,'stale preview must not be accepted');
  const transient=await page.evaluate(()=>({revision:state.editRevision, saved:state.editDocument.global_adjustments.hdr.film_look.lens_filter,
    dots:[...document.querySelectorAll('.film-stock-reset')].map(el=>[el.dataset.stockReset,el.hidden])}));
  assert.equal(transient.revision,original.revision);assert.equal(transient.saved,'none');assert.deepEqual(transient.dots,original.dots);
  // Let normal settled-preview synchronization run: it still must not write a draft.
  await page.evaluate(()=>syncGlobalEditState());
  await page.keyboard.press('Escape');await closed();
  assert.equal(await page.evaluate(()=>JSON.stringify(state.adjustments)),original.adjustments);
  assert.equal(await page.evaluate(()=>state.editRevision),original.revision);
  await open();await next();await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await closed();await committed();
  assert.equal(await page.evaluate(()=>state.editRevision),original.revision,'committing original created an edit');
  await open();await next();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await closed();
  assert.equal(await committed(),'pro_mist');
  await page.evaluate(()=>queueEditCommand('undo'));
  assert.equal(await committed(),'none','one Undo must return to pre-open value');
  // Cancelling a preview must also preserve the redo branch.
  await open();await next();await page.keyboard.press('Escape');await closed();
  await page.evaluate(()=>queueEditCommand('redo'));
  assert.equal(await committed(),'pro_mist');
  await page.evaluate(()=>queueEditCommand('undo'));
  await open();await next();await page.locator('#film-output-note').click();await closed();
  assert.equal(await committed(),'black_pro_mist','ordinary outside close commits highlighted option');
  await page.evaluate(()=>queueEditCommand('undo'));
  await open();await page.locator('#film-lens-filter option[value="glimmerglass"]').click();await closed();
  assert.equal(await committed(),'glimmerglass','option click commits');
  await page.evaluate(()=>queueEditCommand('undo'));
  // Every Film select uses the same native picker binding, not just Lens.
  const paths=await page.locator('select[data-path^="current.film_look."]').evaluateAll(controls=>controls.map(c=>c.dataset.path));
  assert.ok(paths.includes('current.film_look.film_stock'));assert.ok(paths.includes('current.film_look.print_paper'));
  for(const path of paths.filter(path=>path!=='current.film_look.lens_filter')) {
    const select=page.locator(`select[data-path="${path}"]`);
    if(await select.isDisabled()) continue;
    const before=await page.evaluate(()=>({recipe:JSON.stringify(state.adjustments),revision:state.editRevision}));
    await select.focus();await page.keyboard.press('Space');
    const direction=await select.evaluate(el=>el.selectedIndex<el.options.length-1?'ArrowDown':'ArrowUp');
    await page.keyboard.press(direction);
    await page.waitForFunction(({path,before})=>{
      const key=path.split('.').at(-1);
      return state.filmSelectDraft && state.adjustments.hdr.film_look[key]!==JSON.parse(before).hdr.film_look[key];
    },{path,before:before.recipe});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!state.filmSelectDraft);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.adjustments)),before.recipe,path);
    assert.equal(await page.evaluate(()=>state.editRevision),before.revision,path);
  }

  console.log('Film dropdown: live native arrows, Escape, original no-op, single Undo, redo and committed-only indicators/history PASS');
};
