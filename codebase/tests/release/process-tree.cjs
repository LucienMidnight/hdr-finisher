'use strict';
/**
 * Stop a test's process tree and check that it really exited.
 *
 * Shared by the release runner and the Electron launchers. Windows never
 * updates a process's parent ID, and process IDs are reused quickly, so a
 * plain parent-ID walk can pull in unrelated processes whose long-dead parent
 * had the same ID. Those were never killed and made shutdown look unverified.
 * Here a process belongs to the tree only if it started after its parent, and
 * a survivor counts only if its ID and start time still match.
 *
 * Electron's main process is killed first: if the GPU process dies first, the
 * main process can start a new one.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Electron itself (development or packaged). Any of these alive means the GPU
// may still be in use, so the next GPU driver must not start.
const ELECTRON_NAME = /^(electron|hdr finisher)(\.exe)?$/i;
// Allowed error between start times from different sources (CIM rounding,
// `ps` whole seconds, an uptime-based estimate).
const START_SLACK_MS = 2000;

const POWERSHELL_LIST = [
  'Get-CimInstance Win32_Process | ForEach-Object {',
  '[pscustomobject]@{p=$_.ProcessId;q=$_.ParentProcessId;n=$_.Name;',
  'c=$(if($_.CreationDate){[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}else{0})} }',
  '| ConvertTo-Json -Compress',
].join(' ');

function listProcesses() {
  if (process.platform === 'win32') {
    let text;
    // PowerShell start-up can be slow on a loaded machine; one more try.
    for (let attempt = 0; ; attempt++) {
      try {
        text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_LIST],
          { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
        break;
      } catch (error) { if (attempt) throw error; }
    }
    return [].concat(JSON.parse(text)).filter(Boolean)
      .map(row => ({ pid: row.p, ppid: row.q, name: String(row.n || ''), created: Number(row.c) || 0 }));
  }
  const now = Date.now();
  return execFileSync('ps', ['-eo', 'pid=,ppid=,etimes=,comm='], { encoding: 'utf8', timeout: 10000 })
    .trim().split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(m => ({ pid: +m[1], ppid: +m[2], created: now - m[3] * 1000, name: path.basename(m[4]) }));
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function terminate(pid) {
  // On Windows any kill signal is TerminateProcess.
  try { process.kill(pid, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

const DEFAULTS = { list: listProcesses, alive: isAlive, kill: terminate, sleep, now: () => Date.now() };

const sameStart = (a, b) => !a || !b || Math.abs(a - b) <= START_SLACK_MS;

/** Roots (by ID and, when known, start time) plus every later-started descendant. */
function treeOf(rows, roots) {
  const found = [];
  const seen = new Set();
  for (const root of roots) {
    if (!root?.pid || seen.has(root.pid)) continue;
    const row = rows.find(item => item.pid === root.pid);
    // A root's start time may be an estimate from inside the process, which
    // is never earlier than the real start. A reused ID always belongs to a
    // process that started later, so only a later start rules a row out.
    if (row && (!root.created || !row.created || row.created <= root.created + START_SLACK_MS)) {
      found.push({ ...row }); seen.add(row.pid);
    }
    else if (root.created) {
      // The root has exited; its children can still be found by parent ID and
      // start time.
      found.push({ pid: root.pid, ppid: null, name: root.name || '', created: root.created, gone: true });
      seen.add(root.pid);
    }
  }
  for (let index = 0; index < found.length; index++) {
    const parent = found[index];
    for (const row of rows) {
      if (row.ppid !== parent.pid || seen.has(row.pid) || row.pid === row.ppid) continue;
      if (parent.created && row.created && row.created + START_SLACK_MS < parent.created) continue;
      found.push({ ...row }); seen.add(row.pid);
    }
  }
  return found;
}

/**
 * Kill `roots` and their descendants, then wait up to `waitMs` for all of them
 * to exit. Never throws. Returns what survived; `blocking` holds surviving
 * Electron processes (or ones whose name could not be read).
 */
function stopProcessTree(roots, { waitMs = 20000, deps = {} } = {}) {
  const d = { ...DEFAULTS, ...deps };
  const notes = [];
  roots = roots.filter(root => root?.pid);
  const report = { captured: [], survivors: [], blocking: [], notes };
  if (!roots.length) return report;
  let listed = true;
  let captured;
  try { captured = treeOf(d.list(), roots); }
  catch (error) {
    listed = false;
    notes.push(`process list unavailable (${error.message.split('\n')[0]}); only the root processes were checked`);
    captured = roots.filter(root => d.alive(root.pid)).map(root => ({ pid: root.pid, name: root.name || '', created: root.created || 0 }));
  }
  const rootIds = new Set(roots.map(root => root.pid));
  const killAll = list => {
    // Roots first, so Electron cannot replace its GPU process.
    for (const item of [...list].sort((a, b) => rootIds.has(b.pid) - rootIds.has(a.pid))) {
      if (item.gone) continue;
      try { d.kill(item.pid); } catch (error) { notes.push(`kill ${item.pid} failed: ${error.code || error.message}`); }
    }
  };
  killAll(captured);
  // Catch anything the tree started while it was being killed.
  for (let round = 0; listed && round < 2; round++) {
    let extra;
    try { extra = treeOf(d.list(), captured).filter(row => !captured.some(item => item.pid === row.pid)); }
    catch { break; }
    if (!extra.length) break;
    captured.push(...extra); killAll(extra);
  }
  report.captured = captured.filter(item => !item.gone);
  const started = d.now();
  let pending = report.captured.filter(item => d.alive(item.pid));
  let rekilled = false;
  while (pending.length && d.now() - started < waitMs) {
    if (!rekilled && d.now() - started >= waitMs / 2) { rekilled = true; killAll(pending); }
    d.sleep(100);
    pending = pending.filter(item => d.alive(item.pid));
  }
  if (pending.length && listed) {
    // An ID that is alive again may belong to a new, unrelated process.
    try {
      const rows = d.list();
      pending = pending.filter(item => rows.some(row => row.pid === item.pid && sameStart(item.created, row.created)));
    } catch (error) { notes.push(`final process list unavailable (${error.message.split('\n')[0]})`); }
  }
  report.survivors = pending;
  report.blocking = pending.filter(item => !item.name || ELECTRON_NAME.test(item.name));
  return report;
}

const describe = list => list.map(item => `${item.name || 'unknown'} (PID ${item.pid})`).join(', ');

module.exports = { ELECTRON_NAME, listProcesses, treeOf, stopProcessTree, describe };
