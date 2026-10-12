/* First saved grade must refresh an already-open Library, without re-browsing. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'library-saved-picture-refresh');
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, 'photos-')), photo = path.join(folder, 'first.png');
fs.copyFileSync(path.join(root, 'tests/fixtures/sdr_gradient.png'), photo);
const original = fs.readFileSync(photo);
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => window.HDRLibrary);
    await library.evaluate(folder => HDRLibrary.browse(folder), folder);
    const cell = library.locator('#grid-space .library-cell').first();
    await cell.locator('canvas[data-picture-key]').waitFor();
    assert.equal(await cell.locator('.library-edited').count(), 0);
    await cell.dblclick();
    await page.waitForFunction(() => HDRGradeSaving.active());
    await page.locator('#grade-autosave').click();
    await page.evaluate(async () => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = .75;
      adjustments.sdr.exposure = -.25;
      await queueEditCommand('set_global_adjustments', { adjustments });
    });
    assert.ok(await page.evaluate(() => HDRGradeSaving.save()));
    await page.evaluate(() => activateWorkflowTab('import'));
    // No browse or frame reload: this is the page that last saw an unedited photo.
    await library.locator('#grid-space canvas[data-kept="true"]').waitFor({ timeout: 60000 });
    await library.locator('#grid-space .library-edited').waitFor();
    assert.deepEqual(fs.readFileSync(photo), original);
    assert.equal(JSON.parse(fs.readFileSync(photo + '.hdrf', 'utf8')).grade.global_adjustments.hdr.exposure, .75);
    assert.deepEqual(errors, []);
    console.log('PASS: first saved grade replaces the default picture in the existing Library; original unchanged.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });