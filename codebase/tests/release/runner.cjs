const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { stopProcessTree, describe } = require('./process-tree.cjs');
const { photosPath } = require('../helpers/photos-root.cjs');
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'output/release-checks');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
const cleanLog = text => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
function inventory(root = ROOT) {
  return ['tests', 'tests/performance', 'desktop/tests'].flatMap(dir =>
    fs.readdirSync(path.join(root, dir)).filter(name => (/\.[cm]?js$/.test(name) && !name.endsWith('.test.js')) || (/\.(py|ps1)$/.test(name) && !name.startsWith('test_') && !['conftest.py', 'frontend_source.py'].includes(name)))
      .map(name => `${dir}/${name}`)).sort();
}
function validate(list, root = ROOT) {
  const seen = new Set();
  for (const row of list.drivers) {
    if (seen.has(row.path)) throw Error(`Duplicate driver: ${row.path}`);
    seen.add(row.path);
    if (!fs.existsSync(path.join(root, row.path))) throw Error(`Listed file missing: ${row.path}`);
    if (!['core', 'area', 'full', 'diagnostic'].includes(row.tier)) throw Error(`Invalid tier: ${row.path}`);
    if (!row.areas.length || row.areas.some(area => !list.areas.includes(area))) throw Error(`Invalid area: ${row.path}`);
    if (!['electron', 'native', 'node', 'packaged', 'python', 'powershell', 'helper'].includes(row.launch.method)) throw Error(`Invalid launch: ${row.path}`);
    if (row.launch.method === 'helper' && !row.launch.via?.length) throw Error(`Helper needs a parent: ${row.path}`);
  }
  for (const file of inventory(root)) if (!seen.has(file)) throw Error(`Unlisted driver: ${file}`);
  for (const row of list.drivers) for (const parent of row.launch.via || []) {
    const target = list.drivers.find(item => item.path === parent);
    if (!target || target.launch.method === 'helper') throw Error(`Invalid helper parent: ${row.path}: ${parent}`);
  }
}
function changedAreas(files, list) {
  const areas = new Set(), unmapped = [];
  for (const file of files) {
    const matches = list.sourceAreas.filter(rule => new RegExp(rule.pattern).test(file));
    if (!matches.length) unmapped.push(file);
    for (const rule of matches) for (const area of rule.areas) areas.add(area);
  }
  if (unmapped.some(file => /^codebase\/(frontend|backend|desktop)\//.test(file))) list.areas.forEach(area => areas.add(area));
  return { areas: [...areas].sort(), unmapped };
}
function select(list, mode, value, changed = []) {
  const mapping = changedAreas(changed, list);
  if (mode === 'area' && !list.areas.includes(value)) throw Error(`Unknown area: ${value}`);
  if (mode === 'tier' && !['core', 'area', 'full', 'diagnostic'].includes(value)) throw Error(`Unknown tier: ${value}`);
  if (mode === 'tier' && value === 'diagnostic') throw Error('Diagnostics run only by explicit --driver, never as a tier sweep.');
  let rows = list.drivers.filter(row => {
    if (mode === 'driver') return row.path === value;
    if (row.launch.method === 'helper' || row.tier === 'diagnostic') return false;
    if (mode === 'release') return row.tier === 'core' || (row.tier === 'area' && row.areas.some(area => mapping.areas.includes(area)));
    if (mode === 'area') return row.tier !== 'full' && row.areas.includes(value);
    if (mode === 'tier') return row.tier === value;
    return mode === 'full';
  });
  if (mode === 'driver' && !rows.length) throw Error(`Unknown driver: ${value}`);
  if (mode === 'driver' && rows[0].launch.method === 'helper') rows = rows[0].launch.via.map(file => list.drivers.find(row => row.path === file));
  return { rows, ...mapping };
}
function command(row, out, list) {
  const vars = { output: out, root: ROOT, project: photosPath(list.protectedProjects[2]), electron: path.join(ROOT, 'desktop/node_modules/electron/dist/electron.exe') };
  const expand = text => String(text).replace(/\{(output|root|project|electron)\}/g, (_, key) => vars[key]);
  const method = row.launch.method;
  const args = ['node', 'python', 'powershell'].includes(method) ? [] : [method === 'native' ? 'tests/run-native-electron.js' : 'tests/run-in-electron.js'];
  if (row.launch.nodeTest) args.push('--test');
  if (method === 'powershell') args.push('-NoProfile', '-File');
  args.push(row.path);
  if (method === 'packaged') args.push('--packaged');
  args.push(...(row.launch.args || []).map(expand).map(photosPath));
  return { executable: method === 'python' ? path.join(ROOT, '.venv/Scripts/python.exe') : method === 'powershell' ? 'powershell.exe' : process.execPath, args, env: Object.fromEntries(Object.entries(row.launch.env || {}).map(([key, value]) => [key, expand(value)])) };
}
// Historical results supply estimates only; never count them as current passes.
function history(output = OUTPUT, root = ROOT) {
  const records = [];
  for (const folder of ['prerelease-0.9-2026-10-09', 'prerelease-0.9.1-2026-10-16']) {
    const file = path.join(root, 'output/performance/review', folder, 'results.json');
    if (!fs.existsSync(file)) continue;
    for (const row of read(file)) {
      if (row.command?.some(arg => ['--case', '--ui-only'].includes(arg))) continue;
      const attempt = (row.attempts || [row]).filter(a => Number.isFinite(a.durationSeconds)).at(-1);
      if (attempt) records.push({ driver: row.driver, ...attempt, source: folder });
    }
  }
  const file = path.join(output, 'history.jsonl');
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)) records.push(JSON.parse(line));
  return records;
}
function knownMessage(log, known, driver) {
  const failures = known.failures.filter(f => f.driver === driver && f.messages.every(m => log.includes(m)));
  if (!failures.length) return false;
  // A combined driver may also report a different failure (notably Film's UI
  // follow-up). Every error header must be covered before suppressing a retry.
  const errors = log.split('\n').filter(line => /^(?:[\w.]+: )?(?:\w*Error(?: \[[^\]]+\])?:|.*Timeout \d+ms exceeded\.)/.test(line));
  return errors.length > 0 && errors.every(line => failures.some(f => f.messages.some(m => m.includes(line.trim()))));
}
function unfinishedSelection(list, previous, additional = []) {
  const paths = [...new Set([...previous.drivers.filter(file => !previous.results[file]?.classification), ...additional])];
  const rows = paths.map(file => {
    const row = list.drivers.find(row => row.path === file);
    if (!row || row.launch.method === 'helper' || row.tier === 'diagnostic') throw Error(`Unfinished driver missing or not runnable: ${file}`);
    return row;
  });
  return {rows, areas:[], unmapped:[]};
}
function estimate(rows, records, known = {failures:[]}) {
  let seconds = 0, retrySeconds = 0;
  const unknown = [], evidence = [];
  for (const row of rows) {
    const prior = records.filter(record => record.driver === row.path && !record.interrupted).at(-1);
    if (!prior) { unknown.push(row.path); continue; }
    seconds += prior.durationSeconds;
    const recordedKnown = prior.log && fs.existsSync(prior.log) && knownMessage(cleanLog(fs.readFileSync(prior.log, 'utf8')), known, row.path);
    if (prior.exitCode !== 0 && !recordedKnown) retrySeconds += prior.durationSeconds;
    evidence.push({ driver: row.path, seconds: prior.durationSeconds, source: prior.source || 'runner history' });
  }
  return { seconds, retrySeconds, unknown, evidence };
}
function classify(attempts, known, driver) {
  if (attempts[0]?.exitCode === 0) return 'passed';
  if (attempts.at(-1)?.exitCode === 0) return 'flaky';
  if (attempts.some(a => a.timedOut)) return 'new';
  const logs = attempts.map(attempt => cleanLog(fs.readFileSync(attempt.log, 'utf8')));
  return logs.every(log => knownMessage(log, known, driver)) ? 'known' : 'new';
}
function hashProjects(projects) {
  return projects.map(photosPath).map(file => ({ file: path.resolve(ROOT, file), hash: digest(fs.readFileSync(path.resolve(ROOT, file))) }));
}
function checkProjects(before) {
  for (const item of before) if (!fs.existsSync(item.file) || digest(fs.readFileSync(item.file)) !== item.hash) throw Error(`STOP: protected project changed: ${item.file}`);
}
function write(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}
const DLL_INIT_FAILED = 3221225794;
function launchFailed(code) { return Number.isInteger(code) && (code >>> 0) === DLL_INIT_FAILED; }
function attemptTimeout(driver, records) {
  const prior = records.filter(r => r.driver === driver && r.exitCode === 0
    && !r.interrupted && !r.timedOut && !r.partial && !r.error
    && Number.isFinite(r.durationSeconds) && r.durationSeconds >= 1).at(-1);
  return prior ? Math.max(300000, prior.durationSeconds * 3000) : 900000;
}
// Synchronous so exit/signal handlers can also enforce the shutdown boundary.
// Throws only when an Electron process is still alive, because only then is
// the next GPU driver unsafe. Other survivors are reported, not fatal.
function stopTree(child, { group = process.platform !== 'win32', waitMs = 20000, deps } = {}) {
  if (!child?.pid) return null;
  if (group) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
  const report = stopProcessTree([{ pid: child.pid }], { waitMs, deps });
  return enforceShutdown(report, `process tree ${child.pid}`);
}
function enforceShutdown(report, what) {
  for (const note of report.notes) console.error(`[runner] shutdown note: ${note}`);
  if (report.blocking.length) throw Error(`STOP: shutdown verification failed: Electron still running after ${what} was stopped: ${describe(report.blocking)}; no further GPU work is safe.`);
  const others = report.survivors.filter(item => !report.blocking.includes(item));
  if (others.length) console.error(`[runner] SHUTDOWN WARNING: non-Electron processes outlived ${what}: ${describe(others)}`);
  return report;
}
// Launchers print one line per Electron main process they started. After the
// driver exits, the runner checks those trees itself, independent of the
// driver's own result.
const ELECTRON_MARKER = /^\[runner\] electron-main (\{.*\})\s*$/gm;
function electronRoots(logText) {
  const roots = [];
  for (const match of cleanLog(logText).matchAll(ELECTRON_MARKER)) {
    try { const root = JSON.parse(match[1]); if (Number.isInteger(root.pid)) roots.push(root); } catch { /* partial line */ }
  }
  return roots;
}
function verifyElectronGone(logText, { waitMs = 60000, deps } = {}) {
  const roots = electronRoots(logText);
  if (!roots.length) return null;
  return stopProcessTree(roots, { waitMs, deps });
}
async function runInvocations(invocation, variants, fd, hooks, deadline, attemptDeadline, kill = stopTree) {
  const results = [];
  for (const [index, variant] of variants.entries()) {
    if (hooks.stopped()) break;
    fs.writeSync(fd, `\n[runner] ${index ? `follow-up invocation ${index}` : 'primary invocation'}: ${JSON.stringify(variant)}\n`);
    if (Date.now() >= attemptDeadline) {
      fs.writeSync(fd, 'TIMEOUT: attempt deadline exhausted before invocation\n');
      console.log('TIMEOUT: attempt deadline exhausted before invocation');
      results.push({ exitCode: null, timedOut: true }); break;
    }
    const result = await new Promise((resolve, reject) => {
      const child = spawn(invocation.executable, variant, { cwd: ROOT, env: { ...process.env, ...invocation.env, HDR_FINISHER_ELECTRON_WINDOW_SIZE: '2560x1440' }, stdio: ['ignore', fd, fd], windowsHide: true, detached: process.platform !== 'win32' });
      hooks.child(child);
      let launchError, timedOut = false, cleanupError;
      const expires = Math.min(deadline, attemptDeadline);
      const timer = setTimeout(() => {
        if (deadline <= attemptDeadline) hooks.cap();
        else {
          timedOut = true;
          const message = `TIMEOUT: attempt deadline reached (PID ${child.pid})`;
          console.log(message); fs.writeSync(fd, message + '\n');
        }
        try { kill(child); } catch (error) { cleanupError = error; reject(error); }
        // close can itself be held open by a descendant's inherited handles.
        closeTimer = setTimeout(() => reject(Error('STOP: child close was not verified after tree-kill')), 5000);
      }, Math.max(1, expires - Date.now()));
      let closeTimer;
      child.on('error', error => { launchError = error.message; });
      child.on('close', (code, signal) => {
        clearTimeout(timer); clearTimeout(closeTimer);
        if (cleanupError) return;
        resolve({ exitCode: timedOut ? null : code, signal, ...(timedOut ? {timedOut: true} : {}), ...(launchError ? { error: launchError } : {}) });
      });
    });
    hooks.child(null); results.push(result);
    if (result.timedOut || result.exitCode === 86 || launchFailed(result.exitCode)) break;
  }
  return results;
}
async function execute(row, state, out, list, hooks, deadline, known) {
  const attempts = state.results[row.path]?.attempts || [];
  state.results[row.path] = { attempts };
  while (attempts.length < 2 && !attempts.some(a => a.exitCode === 0)) {
    if (hooks.stopped() || Date.now() >= deadline) return false;
    const log = path.join(out, 'logs', `${row.path.replace(/[\\/]/g, '__')}.${attempts.length + 1}.${Date.now()}.log`);
    const fd = fs.openSync(log, 'w'), invocation = command(row, out, list), started = Date.now();
    state.activeAttempt = {driver: row.path, log, startedAt: started};
    write(path.join(out, 'state.json'), state);
    console.log(`Running ${row.path}${attempts.length ? ' (one retry)' : ''}`);
    let results;
    try {
      const variants = [invocation.args, ...(row.launch.followupArgs || []).map(args => command({ ...row, launch: { ...row.launch, args } }, out, list).args)];
      results = await runInvocations(invocation, variants, fd, hooks, deadline, started + attemptTimeout(row.path, history()));
    } finally { fs.closeSync(fd); }
    const result = results.find(result => result.timedOut) || results.find(result => result.exitCode !== 0) || results.at(-1) || { exitCode: null };
    checkProjects(state.fixtures);
    if (git('rev-parse', 'HEAD') !== state.revision) throw Error('STOP: HEAD moved during the run; results cover different revisions.');
    const record = { ...result, log, durationSeconds: (Date.now() - started) / 1000, interrupted: hooks.stopped(), command: invocation.args };
    fs.appendFileSync(path.join(OUTPUT, 'history.jsonl'), JSON.stringify({ driver: row.path, revision: state.revision, run: out, ...record }) + '\n');
    delete state.activeAttempt;
    if (hooks.stopped()) { state.interruptedAttempt = { driver: row.path, ...record }; return false; }
    attempts.push(record);
    write(path.join(out, 'state.json'), state);
    // The driver's own result is recorded above; shutdown is checked separately.
    const report = verifyElectronGone(fs.readFileSync(log, 'utf8'));
    if (report) {
      const lines = [...report.notes.map(note => `[runner] shutdown note: ${note}`),
        ...(report.survivors.length ? [`[runner] SHUTDOWN CHECK: still running after the driver exited: ${describe(report.survivors)}`] : [])];
      if (lines.length) { fs.appendFileSync(log, lines.join('\n') + '\n'); console.log(lines.join('\n')); }
    }
    if (results.some(r => r.exitCode === 86) || report?.blocking.length) {
      state.results[row.path].classification = classify(attempts, known, row.path);
      write(path.join(out, 'state.json'), state);
      throw Error(report?.blocking.length
        ? `STOP: shutdown verification failed: Electron still running after ${row.path}: ${describe(report.blocking)}; no further GPU work is safe.`
        : 'STOP: Electron shutdown could not be verified (the launch returned no process handle); no further GPU work is safe.');
    }
    if (results.some(r => launchFailed(r.exitCode))) throw Error('STOP: driver launch failed with STATUS_DLL_INIT_FAILED (3221225794); the parent console/session may have ended. Restore the session before resuming.');
    if (!record.timedOut && record.exitCode !== 0 && knownMessage(cleanLog(fs.readFileSync(log, 'utf8')), known, row.path)) break;
  }
  return true;
}
function parse(args) {
  const modes = ['release', 'area', 'tier', 'full', 'driver'];
  const options = { mode: 'release', plan: false };
  let selected = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, '');
    if (modes.includes(name)) {
      if (selected) throw Error('Choose one selection mode.');
      selected = true; options.mode = name;
      if (['area', 'tier', 'driver'].includes(name)) { options.value = args[++i]; if (!options.value || options.value.startsWith('--')) throw Error(`Missing value for --${name}`); }
    } else if (name === 'plan') options.plan = true;
    else if (['unfinished-from', 'also-driver'].includes(name)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Error(`Missing value for --${name}`);
      if (name === 'unfinished-from') options.unfinishedFrom = value;
      else (options.alsoDrivers ||= []).push(value);
    }
    else if (name === 'fresh') options.fresh = true;
    else if (name === 'approved-release-minutes') { options.approvedReleaseMinutes = Number(args[++i]); if (!Number.isFinite(options.approvedReleaseMinutes) || options.approvedReleaseMinutes <= 0) throw Error('--approved-release-minutes needs a positive number'); }
    else if (name === 'limit-minutes') { options.limitMinutes = Number(args[++i]); if (!Number.isFinite(options.limitMinutes) || options.limitMinutes <= 0) throw Error('--limit-minutes needs a positive number'); }
    else if (name === 'stop-after') { options.stopAfter = Number(args[++i]); if (!Number.isInteger(options.stopAfter) || options.stopAfter < 1) throw Error('--stop-after needs a positive driver count'); }
    else throw Error(`Unknown option: ${args[i]}`);
  }
  if (options.approvedReleaseMinutes && options.mode !== 'release') throw Error('--approved-release-minutes requires a release selection');
  if (options.alsoDrivers && !options.unfinishedFrom) throw Error('--also-driver requires --unfinished-from');
  if (options.unfinishedFrom && options.mode !== 'full') throw Error('--unfinished-from requires explicit --full selection');
  return options;
}
async function main(args = process.argv.slice(2)) {
  const options = parse(args), list = read(path.join(__dirname, 'drivers.json'));
  validate(list);
  const known = read(path.join(__dirname, 'known-failures.json')), revision = git('rev-parse', 'HEAD');
  let base, changed = [];
  if (options.mode === 'release') {
    try { base = git('describe', '--tags', '--match', 'v*', '--abbrev=0', 'HEAD'); }
    catch { throw Error('No reachable v* release tag; add a release tag before selecting changes.'); }
    changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  }
  const previous = options.unfinishedFrom ? read(path.resolve(ROOT, options.unfinishedFrom, 'state.json')) : null;
  if (previous) {
    git('merge-base', '--is-ancestor', previous.revision, revision);
    checkProjects(previous.fixtures);
    console.log(`Unfinished selection from ${previous.revision}; completed results are NOT carried forward.`);
  }
  const selection = previous ? unfinishedSelection(list, previous, options.alsoDrivers) : select(list, options.mode, options.value, changed);
  const timing = estimate(selection.rows, history(), known);
  const minutes = (timing.seconds + timing.retrySeconds) / 60;
  const policyMinutes = options.mode === 'full' ? Infinity : options.mode === 'release' ? (options.approvedReleaseMinutes || 75) : 30;
  console.log(`${options.mode}${options.value ? ` ${options.value}` : ''}: ${selection.rows.length} drivers at ${revision.slice(0, 12)}${base ? `; changes since ${base}` : ''}`);
  if (base) console.log(`Changed areas: ${selection.areas.join(', ') || 'none'}`);
  for (const file of selection.unmapped) console.log(`Unmapped changed file: ${file}`);
  console.log(`History estimate: ${minutes.toFixed(1)} minutes (includes ${(timing.retrySeconds / 60).toFixed(1)} for previously failing drivers' retries).${timing.unknown.length ? ` INCOMPLETE: no history for ${timing.unknown.length} drivers; no guessed times.` : ''}`);
  for (const file of timing.unknown) console.log(`No timing history: ${file}`);
  if (options.approvedReleaseMinutes) console.log(`Explicitly approved release cap: ${policyMinutes} minutes (including resumed work).`);
  if (options.mode === 'release' && minutes > policyMinutes) console.log(`STOP: the release estimate exceeds the ${policyMinutes}-minute cap. Ask Steve before running.`);
  else if (options.mode === 'release' && minutes > 45) console.log(`Estimate exceeds the 45-minute target; the ${policyMinutes}-minute release cap still applies.`);
  for (const row of selection.rows) console.log(`  ${row.path} [${row.tier}; ${row.launch.method}] ${JSON.stringify(command(row, '<run-output>', list).args)}${row.launch.followupArgs ? `; then ${JSON.stringify(row.launch.followupArgs)}` : ''}${row.launch.requires ? `; requires: ${row.launch.requires}` : ''}`);
  if (options.plan) return { ...selection, timing };
  if (minutes > Math.min(options.limitMinutes || Infinity, policyMinutes)) throw Error('Estimated slow-test time exceeds the approved limit. Stop and ask Steve.');
  if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Commit tracked-file changes before running.');
  if (!selection.rows.length) throw Error('No drivers selected.');
  for (const row of selection.rows) if (row.launch.requires) throw Error(`Manual diagnostic invocation required for ${row.path}: ${row.launch.requires}`);
  fs.mkdirSync(OUTPUT, { recursive: true });
  const key = digest(JSON.stringify({ revision, mode: options.mode, value: options.value, rows: selection.rows, unfinishedFrom: options.unfinishedFrom, fixtures: list.protectedProjects, known })).slice(0, 20);
  const pointer = path.join(OUTPUT, `${key}.json`);
  let out = !options.fresh && fs.existsSync(pointer) ? read(pointer).directory : null;
  let state = out && fs.existsSync(path.join(out, 'state.json')) ? read(path.join(out, 'state.json')) : null;
  if (!state) {
    out = path.join(OUTPUT, `${new Date().toISOString().replace(/[:.]/g, '-')}-${key}`);
    fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
    state = { revision, base, mode: options.mode, value: options.value, drivers: selection.rows.map(row => row.path), fixtures: hashProjects(list.protectedProjects), results: {}, elapsedMs: 0, completed: false };
    write(pointer, { directory: out }); write(path.join(out, 'plan.json'), { options, ...selection, timing }); write(path.join(out, 'state.json'), state);
  }
  checkProjects(state.fixtures);
  console.log(`${state.completed ? 'Completed run' : 'Run/resume'}: ${out}`);
  const lock = path.join(OUTPUT, 'active.lock');
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch {
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (owner.unsafe) throw Error('Previous shutdown was not verified; inspect and remove the active.lock only after all old driver processes are gone.');
    const pid = typeof owner === 'number' ? owner : owner.pid;
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw Error(`Another release runner owns the GPU (PID ${pid}).`);
    if (owner.childPid) {
      let childAlive = true;
      try { process.kill(owner.childPid, 0); } catch (error) { if (error.code === 'ESRCH') childAlive = false; }
      if (childAlive) throw Error(`Previous driver still running (PID ${owner.childPid}); wait for it to exit before resuming.`);
    }
    fs.unlinkSync(lock); fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  }
  const started = Date.now(), previousElapsed = state.elapsedMs;
  const capMs = Math.min(policyMinutes, options.limitMinutes || Infinity) * 60000;
  const deadline = started + capMs - previousElapsed;
  let active = null, stopped = false, capReached = false, fatal;
  const checkpoint = setInterval(() => { state.elapsedMs = previousElapsed + Date.now() - started; write(path.join(out, 'state.json'), state); }, 1000);
  const onSignal = () => { stopped = true; try { stopTree(active); } catch (error) { fatal = error.message; console.error(fatal); } };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  let ran = 0;
  try {
    for (const row of selection.rows) {
      if (state.results[row.path]?.classification) continue;
      if (stopped || Date.now() >= deadline) { capReached ||= Date.now() >= deadline; break; }
      const complete = await execute(row, state, out, list, { stopped: () => stopped, child: child => { active = child; fs.writeFileSync(lock, JSON.stringify({pid: process.pid, childPid: child?.pid || null})); }, cap: () => { stopped = true; capReached = true; } }, deadline, known);
      if (!complete) break;
      state.results[row.path].classification = classify(state.results[row.path].attempts, known, row.path);
      state.elapsedMs = previousElapsed + Date.now() - started; write(path.join(out, 'state.json'), state);
      if (options.stopAfter && ++ran >= options.stopAfter) { stopped = true; break; }
    }
    checkProjects(state.fixtures);
    if (git('rev-parse', 'HEAD') !== revision) throw Error('STOP: HEAD moved during the run.');
    if (git('status', '--porcelain', '--untracked-files=no')) throw Error('STOP: tracked files changed during the run.');
  } catch (error) { fatal = error.message; }
  finally {
    clearInterval(checkpoint);
    let unsafe = false;
    try { stopTree(active); } catch (error) { fatal = `STOP: shutdown verification failed: ${error.message}`; unsafe = true; }
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    state.elapsedMs = previousElapsed + Date.now() - started;
    state.completed = !fatal && state.drivers.every(file => state.results[file]?.classification);
    state.fatal = fatal || null; write(path.join(out, 'state.json'), state);
    // Preserve ownership evidence if shutdown could not be confirmed.
    if (unsafe || fatal && /tree-kill|verif|shutdown|close was not/.test(fatal)) fs.writeFileSync(lock, JSON.stringify({pid:process.pid, childPid:active?.pid || null, unsafe:true}));
    else fs.unlinkSync(lock);
  }
  const counts = { passed: 0, flaky: 0, known: 0, new: 0, unfinished: 0 };
  for (const file of state.drivers) counts[state.results[file]?.classification || 'unfinished']++;
  const verdict = fatal ? 'STOPPED: safety check failed' : capReached ? 'STOPPED: time cap reached; ask Steve' : counts.unfinished ? 'INTERRUPTED: rerun the same command to resume' : counts.new || counts.known ? 'NOT READY' : counts.flaky ? 'PASS WITH FLAKY CHECKS' : 'PASS';
  const lines = [verdict, `Revision ${revision}; ${Object.entries(counts).map(([key, count]) => `${count} ${key}`).join(', ')}; ${(state.elapsedMs / 60000).toFixed(1)} minutes.`];
  for (const file of state.drivers) {
    const result = state.results[file];
    if (!result || result.classification === 'passed') continue;
    const last = result.attempts.at(-1);
    const message = last ? cleanLog(fs.readFileSync(last.log, 'utf8')).split('\n').find(line => /Error|Timeout|FAIL/.test(line)) : '';
    lines.push(`${result.classification || 'unfinished'}: ${file}${message ? `: ${message.slice(0, 320)}` : ''}`);
  }
  if (fatal) lines.push(fatal);
  fs.writeFileSync(path.join(out, 'summary.txt'), lines.join('\n') + '\n');
  write(path.join(out, 'summary.json'), { verdict, counts, revision, elapsedMs: state.elapsedMs, fixtures: state.fixtures, fatal });
  console.log(lines.join('\n'));
  process.exitCode = fatal || counts.new || counts.known ? 1 : counts.unfinished ? 130 : 0;
  return { out, state, counts };
}
module.exports = { attemptTimeout, launchFailed, stopTree, enforceShutdown, electronRoots, verifyElectronGone, runInvocations, inventory, validate, changedAreas, select, command, history, estimate, classify, knownMessage, unfinishedSelection, hashProjects, checkProjects, parse, main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
