/* GPU setup must overlap a visible photo request, using the existing renderer. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output/library-picture-startup');
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, 'photos-'));
fs.copyFileSync(path.join(root, 'tests/fixtures/sdr_gradient.png'), path.join(folder, 'first.png'));
(async () => {
  const browser = await chromium.launch({ headless: true });
  let release;
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => window.HDRLibrary);
    await library.evaluate(() => {
      const pictures = HDRLibraryPictures;
      window.trialSetupStarted = false;
      window.HDRLibraryPictures = { ...pictures, initialize: () => {
        window.trialSetupStarted = true;
        return pictures.initialize();
      } };
    });
    const gate = new Promise(resolve => { release = resolve; });
    let pictureRequested = false;
    await page.route('**/api/library/picture', async route => {
      pictureRequested = true;
      await gate;
      await route.continue();
    });
    await library.evaluate(folder => HDRLibrary.browse(folder), folder);
    await library.waitForFunction(() => window.trialSetupStarted);
    assert.ok(pictureRequested, 'The same visible picture request is in flight');
    assert.equal(await library.locator('#grid-space canvas[data-picture-key]').count(), 0);
    release();
    await library.locator('#grid-space canvas[data-picture-key]').first().waitFor({ timeout: 60000 });
    assert.equal(await library.locator('#grid-space canvas').first().getAttribute('data-rendition'), 'sdr');
    assert.deepEqual(errors, []);
    console.log('PASS: GPU initialization overlaps visible photo preparation; normal SDR picture arrives after the request.');
  } finally { release?.(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });