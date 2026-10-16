const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
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
  const vars = { output: out, root: ROOT, project: list.protectedProjects[2], electron: path.join(ROOT, 'desktop/node_modules/electron/dist/electron.exe') };
  const expand = text => String(text).replace(/\{(output|root|project|electron)\}/g, (_, key) => vars[key]);
  const method = row.launch.method;
  const args = ['node', 'python', 'powershell'].includes(method) ? [] : [method === 'native' ? 'tests/run-native-electron.js' : 'tests/run-in-electron.js'];
  if (row.launch.nodeTest) args.push('--test');
  if (method === 'powershell') args.push('-NoProfile', '-File');
  args.push(row.path);
  if (method === 'packaged') args.push('--packaged');
  args.push(...(row.launch.args || []).map(expand));
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
function estimate(rows, records) {
  let seconds = 0, retrySeconds = 0;
  const unknown = [], evidence = [];
  for (const row of rows) {
    const prior = records.filter(record => record.driver === row.path && !record.interrupted).at(-1);
    if (!prior) { unknown.push(row.path); continue; }
    seconds += prior.durationSeconds;
    if (prior.exitCode !== 0) retrySeconds += prior.durationSeconds;
    evidence.push({ driver: row.path, seconds: prior.durationSeconds, source: prior.source || 'runner history' });
  }
  return { seconds, retrySeconds, unknown, evidence };
}
function classify(attempts, known, driver) {
  if (attempts[0]?.exitCode === 0) return 'passed';
  if (attempts.at(-1)?.exitCode === 0) return 'flaky';
  const logs = attempts.map(attempt => cleanLog(fs.readFileSync(attempt.log, 'utf8')));
  return known.failures.some(failure => failure.driver === driver && logs.every(log => failure.messages.every(message => log.includes(message)))) ? 'known' : 'new';
}
function hashProjects(projects) {
  return projects.map(file => ({ file: path.resolve(ROOT, file), hash: digest(fs.readFileSync(path.resolve(ROOT, file))) }));
}
function checkProjects(before) {
  for (const item of before) if (!fs.existsSync(item.file) || digest(fs.readFileSync(item.file)) !== item.hash) throw Error(`STOP: protected project changed: ${item.file}`);
}
function write(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}
function stopTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* already exited */ }
  } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ } }
}
async function execute(row, state, out, list, hooks, deadline) {
  const attempts = state.results[row.path]?.attempts || [];
  state.results[row.path] = { attempts };
  while (attempts.length < 2 && !attempts.some(a => a.exitCode === 0)) {
    if (hooks.stopped() || Date.now() >= deadline) return false;
    const log = path.join(out, 'logs', `${row.path.replace(/[\\/]/g, '__')}.${attempts.length + 1}.${Date.now()}.log`);
    const fd = fs.openSync(log, 'w'), invocation = command(row, out, list), started = Date.now();
    state.activeAttempt = {driver: row.path, log, startedAt: started};
    write(path.join(out, 'state.json'), state);
    console.log(`Running ${row.path}${attempts.length ? ' (one retry)' : ''}`);
    const results = [];
    for (const variant of [invocation.args, ...(row.launch.followupArgs || []).map(args => command({ ...row, launch: { ...row.launch, args } }, out, list).args)]) {
    if (hooks.stopped()) break;
    const result = await new Promise(resolve => {
      const child = spawn(invocation.executable, variant, { cwd: ROOT, env: { ...process.env, ...invocation.env, HDR_FINISHER_ELECTRON_WINDOW_SIZE: '2560x1440' }, stdio: ['ignore', fd, fd], windowsHide: true, detached: process.platform !== 'win32' });
      hooks.child(child);
      const timer = Number.isFinite(deadline) ? setTimeout(() => { hooks.cap(); stopTree(child); }, Math.max(1, deadline - Date.now())) : null;
      let launchError;
      child.on('error', error => { launchError = error.message; });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ exitCode: code, signal, ...(launchError ? { error: launchError } : {}) }); });
    });
    hooks.child(null); results.push(result);
    }
    fs.closeSync(fd);
    const result = results.find(result => result.exitCode !== 0) || results.at(-1) || { exitCode: null };
    checkProjects(state.fixtures);
    if (git('rev-parse', 'HEAD') !== state.revision) throw Error('STOP: HEAD moved during the run; results cover different revisions.');
    const record = { ...result, log, durationSeconds: (Date.now() - started) / 1000, interrupted: hooks.stopped(), command: invocation.args };
    fs.appendFileSync(path.join(OUTPUT, 'history.jsonl'), JSON.stringify({ driver: row.path, revision: state.revision, run: out, ...record }) + '\n');
    delete state.activeAttempt;
    if (hooks.stopped()) { state.interruptedAttempt = { driver: row.path, ...record }; return false; }
    attempts.push(record);
    write(path.join(out, 'state.json'), state);
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
    else if (name === 'fresh') options.fresh = true;
    else if (name === 'limit-minutes') { options.limitMinutes = Number(args[++i]); if (!Number.isFinite(options.limitMinutes) || options.limitMinutes <= 0) throw Error('--limit-minutes needs a positive number'); }
    else if (name === 'stop-after') { options.stopAfter = Number(args[++i]); if (!Number.isInteger(options.stopAfter) || options.stopAfter < 1) throw Error('--stop-after needs a positive driver count'); }
    else throw Error(`Unknown option: ${args[i]}`);
  }
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
  const selection = select(list, options.mode, options.value, changed), timing = estimate(selection.rows, history());
  const minutes = (timing.seconds + timing.retrySeconds) / 60;
  console.log(`${options.mode}${options.value ? ` ${options.value}` : ''}: ${selection.rows.length} drivers at ${revision.slice(0, 12)}${base ? `; changes since ${base}` : ''}`);
  if (base) console.log(`Changed areas: ${selection.areas.join(', ') || 'none'}`);
  for (const file of selection.unmapped) console.log(`Unmapped changed file: ${file}`);
  console.log(`History estimate: ${minutes.toFixed(1)} minutes (includes ${(timing.retrySeconds / 60).toFixed(1)} for previously failing drivers' retries).${timing.unknown.length ? ` INCOMPLETE: no history for ${timing.unknown.length} drivers; no guessed times.` : ''}`);
  for (const file of timing.unknown) console.log(`No timing history: ${file}`);
  if (options.mode === 'release' && minutes > 75) console.log('STOP: the release estimate exceeds the 75-minute cap. Ask Steve before running.');
  else if (options.mode === 'release' && minutes > 45) console.log('Estimate exceeds the 45-minute target; the 75-minute release cap still applies.');
  for (const row of selection.rows) console.log(`  ${row.path} [${row.tier}; ${row.launch.method}] ${JSON.stringify(command(row, '<run-output>', list).args)}${row.launch.followupArgs ? `; then ${JSON.stringify(row.launch.followupArgs)}` : ''}${row.launch.requires ? `; requires: ${row.launch.requires}` : ''}`);
  if (options.plan) return { ...selection, timing };
  if (minutes > Math.min(options.limitMinutes || Infinity, options.mode === 'full' ? Infinity : options.mode === 'release' ? 75 : 30)) throw Error('Estimated slow-test time exceeds the approved limit. Stop and ask Steve.');
  if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Commit tracked-file changes before running.');
  if (!selection.rows.length) throw Error('No drivers selected.');
  for (const row of selection.rows) if (row.launch.requires) throw Error(`Manual diagnostic invocation required for ${row.path}: ${row.launch.requires}`);
  fs.mkdirSync(OUTPUT, { recursive: true });
  const key = digest(JSON.stringify({ revision, mode: options.mode, value: options.value, rows: selection.rows, fixtures: list.protectedProjects, known })).slice(0, 20);
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
  const policyMinutes = options.mode === 'full' ? Infinity : options.mode === 'release' ? 75 : 30;
  const capMs = Math.min(policyMinutes, options.limitMinutes || Infinity) * 60000;
  const deadline = started + capMs - previousElapsed;
  let active = null, stopped = false, capReached = false, fatal;
  const checkpoint = setInterval(() => { state.elapsedMs = previousElapsed + Date.now() - started; write(path.join(out, 'state.json'), state); }, 1000);
  const onSignal = () => { stopped = true; stopTree(active); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  let ran = 0;
  try {
    for (const row of selection.rows) {
      if (state.results[row.path]?.classification) continue;
      if (stopped || Date.now() >= deadline) { capReached ||= Date.now() >= deadline; break; }
      const complete = await execute(row, state, out, list, { stopped: () => stopped, child: child => { active = child; fs.writeFileSync(lock, JSON.stringify({pid: process.pid, childPid: child?.pid || null})); }, cap: () => { stopped = true; capReached = true; } }, deadline);
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
    stopTree(active); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    state.elapsedMs = previousElapsed + Date.now() - started;
    state.completed = !fatal && state.drivers.every(file => state.results[file]?.classification);
    state.fatal = fatal || null; write(path.join(out, 'state.json'), state); fs.unlinkSync(lock);
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
module.exports = { inventory, validate, changedAreas, select, command, history, estimate, classify, hashProjects, checkProjects, parse, main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
