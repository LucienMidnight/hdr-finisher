/* Click-to-first-frame stopwatch: real 42 MP copies and a disposable profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { _electron } = require('../desktop/node_modules/playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output/library-grade-open');
const packaged = process.argv.includes('--packaged');
const label = process.argv.includes('--after') ? 'after' : 'before';
const mode = (process.argv.includes('--bands') ? 'bands-' : '') + `${label}-${packaged ? 'packaged' : 'development'}`;
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, mode + '-profile-'));
const folder = fs.mkdtempSync(path.join(output, mode + '-photos-'));
const original = path.join(root, 'output/library-slow-spots/development-final-photos-ZHfVZM/DSC07060.ARW');
const names = ['saved.ARW', 'new-1.ARW', 'new-2.ARW', 'new-3.ARW'];
for (const name of names) fs.copyFileSync(original, path.join(folder, name));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHash = digest(original);
fs.writeFileSync(path.join(profile, 'pinned-folders.json'), JSON.stringify([folder]));
const parse = () => fs.readFileSync(path.join(profile, 'logs/backend.log'), 'utf8').split('[library] ').slice(1).flatMap(line => {
  const m = line.match(/^(\S+) (\{[^\r\n]*\})/);
  if (!m) return [];
  try { return [{ event: m[1], ...JSON.parse(m[2]) }]; } catch { return []; }
});
(async () => {
  const env = { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: packaged ? path.join(root, 'dist-electron/win-unpacked/HDR Finisher.exe') : require('../desktop/node_modules/electron'),
    args: packaged ? [] : [path.join(root, 'desktop')], env, timeout: 180000 });
  let page;
  const samples = [], errors = [];
  try {
    console.log('Waiting for initial page');
    setTimeout(() => console.log('Window URLs', app.windows().map(p => p.url())), 12000);
    page = app.windows()[0] || await app.waitForEvent('window');
    await page.waitForLoadState('load');
    console.log('Main page loaded');
    await app.evaluate(async () => { await new Promise(resolve => setImmediate(resolve)); });
    console.log('Initial page ready');
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof activateWorkflowTab === 'function');
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => window.HDRLibrary);
    console.log('Library ready');
    await library.waitForFunction(() => document.querySelectorAll('#grid-space canvas[data-picture-key]').length === 4, null, { timeout: 60000 });
    console.log('Pictures ready');
    const open = async name => {
      await page.evaluate(() => activateWorkflowTab('import'));
      const offset = parse().length;
      await library.locator('.library-cell').filter({ has: library.locator('.name', { hasText: name }) }).first().dblclick();
      await page.waitForFunction(name => !state.gradeOpen && state.activeWorkflow === 'grade' && state.session?.source.filename === name && HDRGradeSaving.active(), name, { timeout: 120000 });
      await page.waitForTimeout(300);
      const events = parse().slice(offset).filter(e => /grade_open/.test(e.event));
      const click = events.find(e => /grade_open_click$/.test(e.event));
      const frame = events.find(e => /grade_open_first_frame$/.test(e.event));
      assert.ok(click && frame, 'Stopwatch click and first frame required');
      assert.ok(await page.evaluate(() => state.session.source.width * state.session.source.height > 41000000));
      return { name, clickToFrameMs: (frame.time - click.time) * 1000, events };
    };
    // Prepare the saved grade outside the measured opens.
    await open('saved.ARW');
    await page.evaluate(async () => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = .75;
      await queueEditCommand('set_global_adjustments', { adjustments });
      const assertSave = await HDRGradeSaving.save();
      if (!assertSave) throw Error('Could not prepare saved grade');
    });
    for (let n = 0; n < 300 && !fs.existsSync(path.join(folder, 'saved.ARW.hdrf')); n++) await page.waitForTimeout(100);
    assert.ok(fs.existsSync(path.join(folder, 'saved.ARW.hdrf')));
    for (let run = 1; run <= 3; run++) {
      const name = `new-${run}.ARW`;
      assert.equal(fs.existsSync(path.join(folder, name + '.hdrf')), false);
      samples.push({ kind: 'never-opened', run, ...await open(name) });
      samples.push({ kind: 'saved', run, ...await open('saved.ARW') });
      assert.equal(await page.evaluate(() => state.adjustments.hdr.exposure), .75);
    }
    if (label === 'after') {
      await page.evaluate(() => activateWorkflowTab('import'));
      await library.locator('.library-cell').filter({ has: library.locator('.name', { hasText: 'new-1.ARW' }) }).first().dblclick();
      await page.waitForFunction(() => state.gradeOpen && state.activeImportJobId, null, { timeout: 10000 });
      const jobId = await page.evaluate(() => state.activeImportJobId);
      await page.evaluate(() => activateWorkflowTab('import'));
      await page.waitForFunction(() => state.activeWorkflow === 'import' && !state.gradeOpen);
      await page.waitForFunction(async id => {
        const job = await fetch('/api/import-jobs/' + id).then(r => r.json());
        return job.state === 'cancelled';
      }, jobId, { timeout: 15000 });
      // A fresh open after cancellation must restore the exact saved grade.
      await open('saved.ARW');
      assert.equal(await page.evaluate(() => state.adjustments.hdr.exposure), .75);
    }
    assert.deepEqual(errors, []);
    for (const name of names) assert.equal(digest(path.join(folder, name)), originalHash);
    fs.writeFileSync(path.join(output, mode + '.json'), JSON.stringify({ mode, profile, folder, samples, errors }, null, 2));
    console.log(JSON.stringify({ mode, samples: samples.map(({ kind, run, clickToFrameMs }) => ({ kind, run, clickToFrameMs })) }));
  } catch (e) {
    if (page) await page.screenshot({ path: path.join(output, mode + '-failure.png') }).catch(() => {});
    throw e;
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });