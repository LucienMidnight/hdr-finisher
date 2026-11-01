// Quick cold Library check on the locked mixed fixture (library-mixed-v1).
// Opens the folder like a person would, watches for a fixed time, reports.
// Works on older commits too: it only uses HDRLibrary.browse, the memory
// setting and the backend log's existing events.
//
//   set HDR_FINISHER_ELECTRON_TEST_USER_DATA=<empty temp folder>
//   node tests/run-in-electron.js tools/quick-library-check.cjs [--seconds=90] [--label=name]
const fs = require('node:fs'), path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { MemoryMonitor } = require('./library-memory-monitor.cjs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const seconds = Number(arg('seconds', 90)), label = arg('label', 'run');
// --single also measures opening one photo in Single and stepping forward.
// It uses only the Library API and DOM that older commits already have.
const singleMode = process.argv.includes('--single');
const singleSteps = Number(arg('steps', 10)), singlePace = Number(arg('pace', 1500));
const folder = path.join(root, 'output/test-photos/library-mixed-v1-run');
const out = path.join(root, 'output/quick-library-check', label);
fs.mkdirSync(out, { recursive: true });
execFileSync(path.join(root, '.venv/Scripts/python.exe'), [path.join(__dirname, 'library-mixed-fixture.py'), 'run-copy'], { stdio: 'inherit' });
const profile = process.env.HDR_FINISHER_USER_DATA_DIR || process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
const logPath = path.join(profile, 'logs/backend.log');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function analyse(text, openedAt) {
  const shown = new Map(), preview = new Map(), failed = new Map(), reclaims = [], memory = [], developed = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[library\] (\w+) (\{.*\})\s*$/);
    if (!m) continue;
    let d; try { d = JSON.parse(m[2]); } catch { continue; }
    const t = (d.time > 1e12 ? d.time / 1000 : d.time) - openedAt / 1000;
    if (t < 0) continue;
    const name = d.path ? path.basename(d.path) : null;
    if (m[1] === 'page_picture_shown' && name && !shown.has(name)) shown.set(name, t);
    if ((m[1] === 'page_picture_camera_preview_decoded' || m[1] === 'picture_camera_preview_ready') && name && !preview.has(name)) preview.set(name, t);
    if (m[1] === 'page_picture_work_failed' && name) failed.set(name, d.reason || d.error || '');
    if (m[1] === 'library_grant_reclaiming') reclaims.push([+t.toFixed(1), name]);
    if (m[1] === 'picture_live_developed') developed.push(t);
    if (m[1] === 'app_memory' && d.totalBytes) memory.push([t, d.totalBytes]);
  }
  const times = [...shown.values()].sort((a, b) => a - b);
  const at = n => times[n - 1] === undefined ? null : +times[n - 1].toFixed(1);
  const by = s => times.filter(x => x <= s).length;
  let gap = 0, last = 0;
  for (const x of times) { gap = Math.max(gap, x - last); last = x; }
  return {
    photos: 50, shown_by: { s15: by(15), s30: by(30), s60: by(60), s90: by(90), end: times.length },
    time_to: { first: at(1), ten: at(10), twenty: at(20), thirty: at(30), forty: at(40) },
    longest_gap_s: +gap.toFixed(1), developments: developed.length,
    camera_previews: preview.size, reclaims, peak_gb: +(Math.max(0, ...memory.map(x => x[1])) / 1e9).toFixed(3),
    failed: Object.fromEntries(failed), not_shown: fs.readdirSync(folder).filter(n => !n.endsWith('.hdrf') && !shown.has(n)),
  };
}

(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage();
  const liveGrants = new Map();
  page.on('websocket', ws => {
    if (!ws.url().endsWith('/api/library/grants')) return;
    ws.on('framereceived', event => { const v = JSON.parse(String(event.payload)); if (v.type === 'granted') liveGrants.set(v.id, v); });
    ws.on('framesent', event => { const v = JSON.parse(String(event.payload)); if (v.type === 'finish' || v.type === 'cancel') liveGrants.delete(v.id); });
  });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (/Memory controller|timeout/i.test(m.text())) errors.push(m.text()); });
  // Open one photo in Single, then step forward at a natural pace. Each
  // reading is from the key press (or the open click) until the 2560 picture
  // for that photo is on screen.
  const runSingle = async lib => {
    const selected = () => lib.evaluate(() => HDRLibrary.getSnapshot().selected || '');
    // Poll the shown surface ourselves so a slow step can report the canvas
    // state it was waiting on instead of only "timed out".
    const surface = () => lib.evaluate(() => {
      const c = document.getElementById('single-picture');
      if (!c) return { present: false };
      return { present: true, path: c.dataset.picturePath || '', edge: Number(c.dataset.pictureEdge) || 0, hidden: !!c.hidden };
    });
    const shown = async (path, timeout = 120000) => {
      const until = Date.now() + timeout, seen = new Map();
      for (;;) {
        let s;
        try { s = await surface(); } catch (error) { s = { present: false, error: error.message }; }
        const mark = `${s.path || ''}|${s.edge || 0}|${s.hidden ? 'hidden' : 'shown'}`;
        seen.set(mark, (seen.get(mark) || 0) + 1);
        if (s.present && !s.hidden && s.path === path && s.edge === 2560) return { surface: s, seen: [...seen].map(([k, v]) => `${k} x${v}`).slice(-6) };
        if (Date.now() > until) throw Object.assign(Error('Timed out waiting for surface'), { seen: [...seen].map(([k, v]) => `${k} x${v}`).slice(-8) });
        await sleep(50);
      }
    };
    await lib.waitForFunction(() => document.querySelector('#grid-space .library-cell canvas[data-picture-key]'), null, { timeout: 300000 });
    const watch = () => lib.evaluate(() => {
      window.__gaps = [];
      let last = performance.now();
      const tick = () => { const n = performance.now(); if (n - last > 120) window.__gaps.push(Math.round(n - last)); last = n; if (window.__gaps.length < 200) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const gaps = () => lib.evaluate(() => { const g = window.__gaps || []; return { longest: Math.max(0, ...g), top: [...g].sort((a, b) => b - a).slice(0, 3) }; });
    const nameOf = p => String(p).replaceAll('\\', '/').split('/').pop();
    const openedAt = Date.now();
    let at = Date.now();
    const first = await lib.evaluate(() => {
      const cell = document.querySelector('#grid-space .library-cell');
      cell.click();
      document.getElementById('single-view').click();
      return cell.dataset.path || '';
    });
    const openPath = await selected() || first;
    await shown(openPath);
    const openMs = Date.now() - at;
    console.log(`single open ${nameOf(openPath)} ${openMs} ms`);
    const steps = [];
    for (let i = 1; i <= singleSteps; i++) {
      const since = Date.now() - at;
      if (since < singlePace) await new Promise(r => setTimeout(r, singlePace - since));
      await watch();
      at = Date.now();
      let mark = Date.now();
      await lib.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
      const dispatchMs = Date.now() - mark; mark = Date.now();
      const path = await selected();
      const selectedMs = Date.now() - mark; mark = Date.now();
      try {
        const r = await shown(path);
        const g = await gaps().catch(() => ({}));
        steps.push({ index: i, name: nameOf(path), ms: Date.now() - at, dispatchMs, selectedMs, seen: r.seen, longestGapMs: g.longest, topGapsMs: g.top });
      }
      catch (error) { steps.push({ index: i, name: nameOf(path), ms: null, error: error.name, seen: error.seen }); }
      console.log(`single step ${i} ${nameOf(path)} ${steps.at(-1).ms} ms`);
    }
    await page.screenshot({ path: path.join(out, 'single.png') }).catch(() => {});
    const times = steps.map(s => s.ms).filter(v => typeof v === 'number');
    const sorted = [...times].sort((a, b) => a - b);
    return {
      first_photo: nameOf(openPath), open_ms: openMs, steps,
      step_mean_ms: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      step_median_ms: times.length ? sorted[Math.floor(sorted.length / 2)] : null,
      step_max_ms: times.length ? sorted.at(-1) : null,
      elapsed_ms: Date.now() - openedAt,
    };
  };
  await page.goto(process.env.HDR_FINISHER_URL); await page.evaluate(() => activateWorkflowTab('import'));
  const lib = page.frame({ url: /\/library(?:\?|$)/ }); await lib.waitForFunction(() => window.HDRLibrary);
  const set = await global.HDRFinisherElectronTestHarness.fetch('/api/library/memory-setting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bytes: 4e9 }) }).catch(e => ({ ok: false, status: String(e) }));
  if (!set.ok) errors.push('memory-setting: ' + set.status);
  // Cold means an empty, isolated disk cache: never Steve's real one.
  const cache = await (await global.HDRFinisherElectronTestHarness.fetch('/api/library/cache-settings')).json();
  if (!String(cache.location).toLowerCase().includes('test-') || !process.argv.includes('--warm') && fs.existsSync(path.join(cache.location, 'library-pictures')) && fs.readdirSync(path.join(cache.location, 'library-pictures')).length)
    throw Error('Not an empty isolated cache: ' + cache.location);
  await lib.evaluate(() => { const s = document.getElementById('thumbnail-size'); if (s) { s.value = 300; s.dispatchEvent(new Event('input')); } document.querySelector('[data-sort="name"]')?.click(); });
  const memory = new MemoryMonitor(4e9);
  const memoryPath = path.join(out, 'memory.jsonl'); fs.writeFileSync(memoryPath, '');
  let pending = '', observerError, sampleCount = 0;
  const sampleIntervals = []; let lastSampleAt;
  const observer = spawn(path.join(root, '.venv/Scripts/python.exe'), [path.join(__dirname, 'measure-library-processes.py'), process.env.HDR_FINISHER_ELECTRON_MAIN_PID, '.25'], {windowsHide:true});
  observer.on('error', e => { observerError = String(e); });
  observer.stderr.on('data', chunk => { observerError = String(chunk); });
  observer.stdout.on('data', chunk => {
    pending += chunk;
    let end; while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (!line) continue;
      const sample = JSON.parse(line); sampleCount++;
      if (lastSampleAt !== undefined) sampleIntervals.push(sample.at - lastSampleAt); lastSampleAt = sample.at;
      memory.sample(sample, [...liveGrants.values()]); fs.appendFileSync(memoryPath, line + '\n');
    }
  });
  const openedAt = Date.now();
  lib.evaluate(f => HDRLibrary.browse(f), folder.replaceAll('\\', '/')).catch(e => errors.push(String(e)));
  let single = null;
  if (singleMode) {
    single = await runSingle(lib);
  } else {
    for (let s = 10; s <= seconds; s += 10) {
      await sleep(10000);
      const r = analyse(fs.readFileSync(logPath, 'utf8'), openedAt);
      console.log(`${s}s shown ${r.shown_by.end}/50 peak ${r.peak_gb} GB reclaims ${r.reclaims.length}`);
    }
    await page.screenshot({ path: path.join(out, 'screen.png') }).catch(() => {});
  }
  const text = fs.readFileSync(logPath, 'utf8');
  fs.writeFileSync(path.join(out, 'backend.log'), text);
  if (!sampleCount || observerError) errors.push('Independent memory observer: ' + (observerError || 'no samples'));
  sampleIntervals.sort((a,b) => a-b);
  const report = { label, commit: execFileSync('git', ['-c', 'safe.directory=*', 'rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim(), seconds, single_mode: singleMode, errors, ...analyse(text, openedAt), single, independent_memory: {...memory.report(), samples: sampleCount, lastBytes: memory.last?.totalBytes, sampleIntervalMs: {requested: 250, median: sampleIntervals[Math.floor(sampleIntervals.length/2)], maximum: sampleIntervals.at(-1)}}, observerError };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  observer.kill();
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
