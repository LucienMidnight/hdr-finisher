/* Serial real-camera launch, six maps, save-to-picture and folder-check coverage.
 * Run through run-native-electron.js; uses only copied RAWs and its own profile.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/library-round1');
const packaged = process.argv.includes('--packaged');
const baseline = process.argv.includes('--baseline');
const mode = (packaged ? 'packaged' : 'development') + (baseline ? '-save-baseline' : '-approved');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, mode + '-profile-'));
const folder = fs.mkdtempSync(path.join(output, mode + '-photos-'));
const originals = path.join(root, 'output/library-slow-spots/development-final-photos-ZHfVZM');
const names = fs.readdirSync(originals).filter(n => /^DSC.*\.ARW$/i.test(n)).sort().slice(0, 6);
assert.equal(names.length, 6);
for (const name of names) fs.copyFileSync(path.join(originals, name), path.join(folder, name));
fs.writeFileSync(path.join(profile, 'pinned-folders.json'), JSON.stringify([folder]));
const hashes = new Map(names.map(name => [name, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex')]));

(async () => {
  const env = { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: packaged ? path.join(root, 'dist-electron/win-unpacked/HDR Finisher.exe') : require('../desktop/node_modules/electron'),
    args: packaged ? [] : [path.join(root, 'desktop')], env, timeout: 180000
  });
  let page;
  const errors = [];
  try {
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof activateWorkflowTab === 'function');
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => window.HDRLibrary);
    await library.waitForFunction(() => document.querySelectorAll('#grid-space canvas[data-picture-key]').length === 6, null, { timeout: 60000 });
    await library.locator('#library-grid').focus();
    await page.keyboard.press('e');
    // Request a folder check while the six map requests are in progress.
    await library.evaluate(folder => fetch('/api/library/checks', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [folder] }) }), folder);
    await library.waitForFunction(() => document.querySelectorAll('#grid-space .library-source-overlay[data-key]').length === 6, null, { timeout: 60000 });
    await page.keyboard.press('e');
    await library.waitForFunction(() => HDRLibrary.getSnapshot().indexing?.state === 'idle', null, { timeout: 60000 });
    const first = library.locator('.library-cell').filter({ has: library.locator('.name', { hasText: names[0] }) }).first();
    await first.dblclick();
    await page.waitForFunction(() => HDRGradeSaving.active() && state.activeWorkflow === 'grade', null, { timeout: 120000 });
    if (await page.locator('#grade-autosave').getAttribute('aria-pressed') === 'true') await page.locator('#grade-autosave').click();
    await page.evaluate(() => {
      window.saveTrace = [];
      const nativeFetch = window.fetch;
      window.fetch = async (...args) => {
        const entry = { url: String(args[0]), action: args[1]?.body, start: performance.timeOrigin + performance.now() };
        window.saveTrace.push(entry);
        try { return await nativeFetch(...args); }
        finally { entry.end = performance.timeOrigin + performance.now(); }
      };
      const nativeSync = syncGlobalEditState;
      syncGlobalEditState = async (...args) => {
        const entry = { stage: 'flush_globals', start: performance.timeOrigin + performance.now() };
        window.saveTrace.push(entry);
        try { return await nativeSync(...args); }
        finally { entry.end = performance.timeOrigin + performance.now(); }
      };
    });
    await page.evaluate(async () => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = .75; adjustments.sdr.exposure = -.25;
      await queueEditCommand('set_global_adjustments', { adjustments });
    });
    const saved = Date.now();
    const saveResult = await page.evaluate(async () => {
      const start = performance.timeOrigin + performance.now();
      const ok = await HDRGradeSaving.save();
      return { ok, start, end: performance.timeOrigin + performance.now() };
    });
    assert.ok(saveResult.ok);
    const saveAckMs = Date.now() - saved;
    await page.evaluate(() => activateWorkflowTab('import'));
    await first.locator('canvas[data-kept="true"]').waitFor({ timeout: 60000 });
    const saveToPictureMs = Date.now() - saved;
    await page.waitForTimeout(300); // Let the ordinary batched stopwatch flush.
    const logPath = path.join(profile, 'logs/backend.log');
    const log = fs.readFileSync(logPath, 'utf8');
    const events = log.split(/\r?\n/).flatMap(line => {
      const match = line.match(/\[library\] (\S+) (\{.*\})/);
      if (!match) return [];
      try { return [{ event: match[1], ...JSON.parse(match[2]) }]; } catch { return []; }
    });
    const start = events.find(e => e.event === 'app_start').time;
    const stages = ['app_ready', 'backend_process_started', 'helper_ready', 'backend_ready', 'window_created', 'page_loaded', 'page_ready', 'page_folder_listed', 'page_picture_requested', 'page_picture_answered', 'page_picture_drawn'];
    const timeline = Object.fromEntries(stages.map(stage => {
      const event = events.find(e => e.event === stage);
      assert.ok(event, 'Missing launch stage: ' + stage);
      return [stage, Math.round((event.time - start) * 1000)];
    }));
    if (!baseline) assert.ok(events.some(e => e.event === 'kept_picture_saved' && e.source_route === 'open-photo'));
    assert.deepEqual(errors, []);
    for (const name of names) assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex'), hashes.get(name));
    const saveTrace = await page.evaluate(() => window.saveTrace);
    const report = { mode, profile, folder, timeline, saveAckMs, saveToPictureMs, saveResult, saveTrace,
      timing: events.filter(e => /picture_renderer_setup|picture_drawn|picture_pipeline|picture_gpu_wait|picture_peak_analysis|picture_highlight_analysis|picture_decoded|picture_look_prepared|picture_decoder_import|picture_raw_processed|picture_source_reduced|helper_pause|helper_resume|grade_save|kept_/.test(e.event)), errors };
    fs.writeFileSync(path.join(output, mode + '.json'), JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(output, mode + '.png') });
    console.log(JSON.stringify({ mode, timeline, saveAckMs, pageSaveMs: saveResult.end-saveResult.start, saveToPictureMs, maps: 6 }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, mode + '-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
