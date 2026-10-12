/* Saved grades refresh the existing Library, including a RAW without bright peaks. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'library-saved-picture-refresh');
fs.mkdirSync(output, { recursive: true });
const raw = process.env.HDR_FINISHER_SAVED_PICTURE_RAW;
const source = raw || path.join(root, 'tests/fixtures/sdr_gradient.png');
const folder = fs.mkdtempSync(path.join(output, 'photos-')), photo = path.join(folder, path.basename(source));
fs.copyFileSync(source, photo);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original = hash(photo);
const savedGrade = raw ? JSON.parse(fs.readFileSync(source + '.hdrf', 'utf8')).grade : null;
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
    let previousKey = await cell.locator('canvas').getAttribute('data-picture-key');
    for (const autosave of [true, false]) {
      await cell.dblclick();
      await page.waitForFunction(() => HDRGradeSaving.active());
      const button = page.locator('#grade-autosave');
      if ((await button.getAttribute('aria-pressed') === 'true') !== autosave) await button.click();
      await page.evaluate(async ({ grade, autosave }) => {
        const adjustments = structuredClone(grade?.global_adjustments || state.adjustments);
        if (!grade) { adjustments.hdr.exposure = .75; adjustments.sdr.exposure = -.25; }
        if (!autosave) adjustments.hdr.exposure -= .01;
        await queueEditCommand('set_global_adjustments', { adjustments });
      }, { grade: savedGrade, autosave });
      if (!autosave) assert.ok(await page.evaluate(() => HDRGradeSaving.save()));
      await page.evaluate(() => activateWorkflowTab('import'));
      await library.waitForFunction(old => {
        const canvas = document.querySelector('#grid-space canvas[data-kept="true"]');
        return canvas && canvas.dataset.pictureKey !== old;
      }, previousKey, { timeout: 60000 });
      await cell.locator('.library-edited').waitFor();
      const meta = await library.evaluate(photo => fetch('/api/library/picture', {
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo,edge:512,quality:'quick'})
      }).then(r=>r.json()), photo);
      assert.ok(meta.kept);
      if (raw) assert.equal(meta.route, 'saved-gain-map');
      previousKey = meta.key;
      for (const lane of ['sdr','hdr']) {
        const canvas = cell.locator('canvas');
        if (await canvas.getAttribute('data-rendition') !== lane) await library.locator('#hdr-button').click();
        await library.waitForFunction(lane => document.querySelector('#grid-space canvas[data-kept="true"]')?.dataset.rendition === lane, lane);
        const transport = await library.evaluate(async ({key,lane}) => {
          const response=await fetch(`/api/library/kept-pixels/${key}?lane=${lane}`);
          return {ok:response.ok,bytes:(await response.arrayBuffer()).byteLength,width:Number(response.headers.get('X-Image-Width')),height:Number(response.headers.get('X-Image-Height')),stride:Number(response.headers.get('X-Bytes-Per-Row'))};
        }, {key:meta.key,lane});
        assert.ok(transport.ok && transport.width > 0 && transport.height > 0);
        assert.equal(transport.bytes,transport.stride*transport.height);
        await canvas.screenshot({path:path.join(output,`${autosave?'autosave':'explicit'}-${lane}.png`)});
      }
      assert.equal(hash(photo), original);
      console.log(`PASS: ${autosave?'Autosave':'explicit Save'} refreshes both views in the existing Library (${meta.route}).`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: original unchanged; no renderer errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });