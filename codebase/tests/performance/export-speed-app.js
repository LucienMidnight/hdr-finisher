// Real-app batch export of the Santorini export-speed recipe on the Sony test
// RAW, with the same photo open in Grade. Measures the whole wait, the
// whole-app physical footprint (macOS) or charged bytes, the progress the
// Export page and status bar show, and the memory-trim rounds the desktop
// logged during the export.
//   python tools/gpu-run-lock.py --label <who> -- node tests/run-in-electron.js tests/performance/export-speed-app.js
// Writes output/export-speed-app/result.json. The original RAW is only read.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const reusePhoto = require('../helpers/reuse-test-photo.cjs');

const root = path.resolve(__dirname, '../..');
const folder = path.join(root, 'output/export-speed-app');
const exports_ = path.join(folder, 'exported');
const harness = global.HDRFinisherElectronTestHarness;
const fixtures = path.join(root, 'tests/fixtures/export-speed');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function sampleMemory() {
  // The shared POSIX/Windows sampler, once a second, over the Electron tree.
  const python = path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const rootPid = Number(process.env.HDR_FINISHER_ELECTRON_MAIN_PID);
  const child = spawn(python, ['-u', '-c', `
import json, os, sys, time
from export_speed_profile import process_category, process_rows

root = int(sys.argv[1])
while True:
    try:
        rows = process_rows(root)
    except OSError:
        try:
            os.kill(root, 0)
        except OSError:
            break
        time.sleep(0.25)
        continue
    if not rows:
        break
    print(json.dumps([dict(row, category=process_category(row, root)) for row in rows]))
    time.sleep(1)
`, String(rootPid)], {cwd: path.join(root, 'tools')});
  const categoryPeaks = {electronGb: 0, backendGb: 0, workerGb: 0, encoderGb: 0};
  const state = {peak: 0, at: 0, peakProcesses: [], categoryPeaks, started: Date.now(), child};
  let buffer = '';
  child.stdout.on('data', chunk => {
    const lines = (buffer + chunk).split('\n');
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const processes = JSON.parse(line);
      const categories = {electronGb: 0, backendGb: 0, workerGb: 0, encoderGb: 0};
      let bytes = 0;
      for (const row of processes) {
        const memory = row.chargedBytes ?? row.workingSetBytes ?? 0;
        bytes += memory;
        const name = row.name.replaceAll('\\', '/').split('/').at(-1);
        let category = 'other';
        if (row.category === 'encoder') category = 'encoder';
        else if (row.category === 'python_worker') {
          category = row.parentPid === rootPid ? 'backend' : 'worker';
        } else if (row.pid === rootPid || /^(electron|hdr finisher|chrome_crashpad_handler)(?:[ ._-]|$)/i.test(name)) {
          category = 'electron';
        }
        row.category = category;
        if (category !== 'other') categories[`${category}Gb`] += memory;
      }
      for (const key of Object.keys(categories)) {
        categoryPeaks[key] = Math.max(categoryPeaks[key], categories[key]);
      }
      if (bytes > state.peak) {
        Object.assign(state, {peak: bytes, peakProcesses: processes, at: (Date.now() - state.started) / 1000});
      }
    }
  });
  return state;
}

function progressCheck(samples, wall) {
  const moving = samples.filter(row => Number.isFinite(row.progress));
  const gaps = [];
  for (let i = 1; i < moving.length; i++) {
    if (moving[i].progress !== moving[i - 1].progress && moving[i - 1].stage !== 'Encoding') gaps.push(moving[i].t - moving[i - 1].t);
  }
  const first5 = moving.find(row => row.progress >= 0.05)?.t ?? null;
  return {backwards: moving.some((row, i) => i && row.progress < moving[i - 1].progress),
    maxGapS: gaps.length ? Math.max(...gaps) : null, first5PercentS: first5, first5PercentShare: first5 === null ? null : first5 / wall,
    statusBarFollows: samples.filter(row => row.state === 'running' && row.statusProgress !== null)
      .every(row => Math.abs(row.statusProgress - row.progress) < 1e-6),
    stages: [...new Set(moving.map(row => row.stage).filter(Boolean))]};
}

(async () => {
  fs.rmSync(exports_, {recursive: true, force: true});
  fs.mkdirSync(exports_, {recursive: true});
  const photo = reusePhoto(reusePhoto.source('_DSC7970.ARW'), path.join(folder, '_DSC7970.ARW'));
  // Profile A: the Santorini recipe, saved as this copy's grade.
  const recipe = JSON.parse(fs.readFileSync(path.join(fixtures, 'santorini-2026-0068-grade.json'), 'utf8')).grade;
  // Only the source reference changes: this copy's name, size and fingerprint.
  const source = {...recipe.source, filename: path.basename(photo), fingerprint_sha256: sha256(photo),
    byte_size: fs.statSync(photo).size, durable_path: null};
  fs.writeFileSync(photo + '.hdrf', JSON.stringify({format: 'HDR Finisher Photo', schema_version: 1,
    photo_id: crypto.randomUUID().replaceAll('-', ''), source: {filename: path.basename(photo)}, contains_source_pixels: false,
    marks: {rating: 0, pick: 'unmarked', label: '', tags: []}, grade: {...recipe, source}}));
  const preset = JSON.parse(fs.readFileSync(path.join(fixtures, 'play-raw-export-preset.json'), 'utf8'));
  const browser = await chromium.launch();
  const memory = sampleMemory();
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, {waitUntil: 'networkidle'});
    const saved = await harness.fetch('/api/export-presets', {method: 'POST', body: JSON.stringify(preset),
      headers: {'Content-Type': 'application/json'}});
    assert.ok(saved.ok, await saved.text());
    // Grade holds the same photo while the batch exports its saved grade.
    await page.setInputFiles('#file-input', photo);
    await page.waitForFunction(() => state.session && viewerState().status === 'ready', null, {timeout: 300000});
    await page.evaluate(() => activateWorkflowTab('grade'));
    await page.waitForTimeout(3000);
    await page.evaluate(id => localStorage.setItem('last-export-preset', id), preset.id);
    await page.evaluate(photo => batchExport.open([photo], {fromLibrary: false}), photo);
    await harness.selectExportDirectory(exports_);
    await page.evaluate(() => { document.getElementById('batch-directory').value = ''; });
    const logPath = path.join(harness.userDataDirectory, 'logs/backend.log');
    const logStart = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    const started = Date.now();
    await page.evaluate(() => document.getElementById('batch-run').click());
    const samples = [];
    for (;;) {
      const row = await page.evaluate(() => {
        const job = batchExport.activity(), entry = window.HDRStatus?.get('batch-export');
        return job && {state: job.state, progress: job.progress, stage: job.stage, eta: job.estimated_seconds,
          results: job.results, statusProgress: entry?.severity === 'progress' ? entry.progress / 100 : null,
          statusMessage: entry?.message ?? null, meter: document.getElementById('batch-meter')?.value ?? null};
      });
      if (row) samples.push({t: (Date.now() - started) / 1000, ...row, results: undefined});
      if (row && ['finished', 'failed', 'cancelled'].includes(row.state)) { samples.at(-1).results = row.results; break; }
      if (Date.now() - started > 900000) throw Error('Export did not finish in 15 minutes');
      await page.waitForTimeout(250);
    }
    const wall = (Date.now() - started) / 1000;
    await page.waitForTimeout(12000);  // One more cool-down: a repeat round would land here.
    const job = samples.at(-1);
    assert.equal(job.state, 'finished', JSON.stringify(job));
    const output = job.results[0].output_path;
    // Every desktop memory event from the click to the end of the extra cool-down.
    const lines = fs.readFileSync(logPath, 'utf8').slice(logStart).split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const memoryEvents = lines.filter(record => ['cache_trim_requested', 'cache_trim_paused', 'cache_trim_resumed'].includes(record.event)
      || (record.event === 'action_started' && record.area === 'memory'))
      .map(record => ({event: record.event, reason: record.reason, level: record.pressure_level, system: record.system_pressure,
        cacheMb: record.cache_bytes === undefined ? undefined : Math.round(record.cache_bytes / 1e6),
        gradeMb: record.grade_bytes === undefined ? undefined : Math.round(record.grade_bytes / 1e6),
        t: Math.round((record.time * 1000 - started) / 100) / 10}));
    const result = {wallSeconds: wall, wholeAppPeakGb: Math.round(memory.peak / 1e6) / 1000, peakAtSeconds: memory.at,
      peakProcesses: memory.peakProcesses,
      categoryPeaksGb: Object.fromEntries(Object.entries(memory.categoryPeaks)
        .map(([category, bytes]) => [category, Math.round(bytes / 1e6) / 1000])),
      sha256: sha256(output), renderer: job.results[0].renderer, fallbackReason: job.results[0].fallback_reason,
      progress: progressCheck(samples, wall), memoryEvents,
      trimRounds: memoryEvents.filter(event => event.event === 'cache_trim_requested').length,
      gradeGrainReclaims: memoryEvents.filter(event => event.event === 'action_started').length,
      errors, samples: samples.filter((row, index) => index % 8 === 0 || index === samples.length - 1)};
    fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({...result, samples: undefined}, null, 1));
    assert.deepEqual(errors, []);
    assert.ok(!result.progress.backwards, 'Progress went backwards');
  } finally {
    memory.child.kill();
    await browser.close();
    fs.rmSync(exports_, {recursive: true, force: true});
    reusePhoto.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
