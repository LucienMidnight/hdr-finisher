const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const folder = fs.mkdtempSync(path.join(root, 'output', 'slice4-a-'));
const photo = path.join(folder, 'overlay.png');
fs.copyFileSync(path.join(root, 'tests', 'fixtures', 'sdr_gradient.png'), photo);
const original = fs.readFileSync(photo);
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, {waitUntil:'networkidle'});
    await page.evaluate(async photo => openDesktopSelection({kind:'source', ...await desktop.grantSourcePath(photo)}), photo);
    await page.waitForFunction(() => HDRGradeSaving.active() && state.acceptedPresentation?.exact, null, {timeout:60000});
    await page.locator('.top-actions #grade-autosave').click();
    await page.evaluate(async () => {
      const adjustments = structuredClone(state.editDocument.global_adjustments);
      Object.assign(adjustments.shared, {overlay_mode:'zebra',overlay_opacity:.8,overlay_threshold:300});
      const response = await fetch(`/api/session/${state.session.session_id}/edit-commands`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commands:[{expected_revision:state.editRevision,command_type:'set_global_adjustments',payload:{adjustments}}]})});
      if (!response.ok) throw new Error('Overlay command failed');
      const saved = await fetch(`/api/library/grade/${state.session.session_id}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save'})});
      if (!saved.ok) throw new Error('Grade save failed');
    });
    const deadline = Date.now()+30000;
    while (!fs.existsSync(photo+'.hdrf') && Date.now()<deadline) await page.waitForTimeout(200);
    const saved = JSON.parse(fs.readFileSync(photo+'.hdrf', 'utf8'));
    assert.equal(saved.grade.global_adjustments.shared.overlay_mode, 'zebra');

    await page.evaluate(() => activateWorkflowTab('import'));
    await page.locator('#library-frame').evaluate((element, folder) => element.contentWindow.HDRLibrary.browse(folder), folder);
    const frame = page.frameLocator('#library-frame');
    await frame.locator('.library-cell canvas').first().waitFor();
    assert.equal(await frame.locator('.library-edited').count(), 0);
    await page.evaluate(async photo => openDesktopSelection({kind:'source', ...await desktop.grantSourcePath(photo)}), photo);
    await page.evaluate(async () => {activateWorkflowTab('grade'); await refreshEditState();});
    await page.evaluate(async () => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = 1;
      await queueEditCommand('set_global_adjustments', {adjustments});
    });
    await page.waitForFunction(() => state.documentDirty);
    await page.evaluate(() => HDRGradeSaving.save());
    await page.waitForFunction(async photo => {
      const r = await fetch('/api/library/settings-status', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({paths:[photo]})}).then(r=>r.json());
      return r.photos[0]?.edited;
    }, photo);
    await page.evaluate(() => openGroupPresetDialog(document.querySelector('[data-group="sdr-highlights"]')));
    await page.locator('#group-preset-name').fill('Slice 4 highlights');
    await page.locator('#group-preset-save').click();
    await page.locator('#group-preset-list .group-preset-name').filter({hasText:'Slice 4 highlights'}).waitFor();
    const presets = await page.evaluate(() => desktop.listGradingPresets('sdr-highlights'));
    assert.equal(presets.length, 1);
    assert.equal(presets[0].name, 'Slice 4 highlights');
    assert.ok(Object.keys(presets[0].values).length);
    assert.deepEqual(fs.readFileSync(photo), original);
    assert.deepEqual(errors, []);
    console.log('PASS: overlay-only save stays Not edited in Library; a real edit is Edited; SDR Highlights presets save and list through the desktop panel.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
