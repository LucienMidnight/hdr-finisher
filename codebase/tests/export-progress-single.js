// Single-photo export shows the export's real progress in the status bar:
// a numeric bar that never goes back and the stage labels, not a timer.
//   node tests/run-in-electron.js tests/export-progress-single.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const reusePhoto = require('./helpers/reuse-test-photo.cjs');

const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'output/export-progress-single');
const STAGES = ['Developing RAW', 'Denoising', 'Rendering HDR', 'Rendering SDR', 'Encoding', 'Finishing'];

(async () => {
  fs.mkdirSync(folder, {recursive: true});
  const photo = reusePhoto(reusePhoto.source('IMG_0790.CR2'), path.join(folder, 'IMG_0790.CR2'));
  const output = path.join(folder, 'single-progress.avif');
  fs.rmSync(output, {force: true});
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, {waitUntil: 'networkidle'});
    await page.setInputFiles('#file-input', photo);
    await page.waitForFunction(() => state.session && viewerState().status === 'ready', null, {timeout: 300000});
    await page.evaluate(() => {
      activateWorkflowTab('export');
      els.exportFormat.value = 'avif_gain_map';
      els.exportFormat.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await global.HDRFinisherElectronTestHarness.selectExportPath(output);
    const started = Date.now();
    // What the Export button runs; not awaited, so the bar can be sampled.
    await page.evaluate(() => { exportCurrentSession(); });
    const samples = [];
    for (;;) {
      const entry = await page.evaluate(() => {
        const value = window.HDRStatus?.get('export');
        return value && {severity: value.severity, progress: value.progress, message: value.message};
      });
      if (entry) samples.push({t: (Date.now() - started) / 1000, ...entry});
      if (entry && ['success', 'error', 'attention'].includes(entry.severity)) break;
      if (Date.now() - started > 300000) throw Error('Export did not finish in 5 minutes');
      await page.waitForTimeout(150);
    }
    const final = samples.at(-1);
    const numeric = samples.filter(row => row.severity === 'progress' && Number.isFinite(row.progress));
    const labels = [...new Set(numeric.map(row => STAGES.find(stage => row.message.startsWith(stage))).filter(Boolean))];
    const report = {seconds: final.t, final, numericUpdates: numeric.length, labels,
      firstProgress: numeric[0] ?? null, lastProgress: numeric.at(-1) ?? null};
    console.log(JSON.stringify(report));
    assert.notEqual(final.severity, 'error', final.message);
    assert.ok(fs.statSync(output).size > 0);
    assert.ok(numeric.length >= 3, 'The status bar showed a numeric export bar');
    assert.ok(numeric.every((row, index) => !index || row.progress >= numeric[index - 1].progress), 'Progress went back');
    assert.ok(labels.length >= 2, `Stage labels shown: ${labels}`);
    assert.ok(!labels.includes('Developing RAW'), 'The photo was already developed in Grade');
    assert.ok(!samples.some(row => /Still working locally|large sources can take/.test(row.message)), 'Old timer text');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fs.rmSync(output, {force: true});
    reusePhoto.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
