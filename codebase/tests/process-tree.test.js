'use strict';
// Shutdown verification and test-profile safety, with fake processes only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { treeOf, stopProcessTree } = require('./release/process-tree.cjs');
const { shutdownLines } = require('./launcher-shutdown.cjs');
const { profileProblem } = require('./test-profile.cjs');
const runner = require('./release/runner.cjs');

// A fake process table. `stubborn` processes ignore the first N kills;
// `immortal` ones never exit. `spawnOnKill` starts a child when killed.
function world(rows) {
  let clock = 0;
  const table = rows.map(row => ({ ...row }));
  const kills = [];
  return {
    table, kills,
    deps: {
      list: () => table.filter(row => !row.dead).map(({ pid, ppid, name, created }) => ({ pid, ppid, name, created })),
      alive: pid => table.some(row => row.pid === pid && !row.dead),
      kill: pid => {
        kills.push(pid);
        const row = table.find(item => item.pid === pid && !item.dead);
        if (!row) return;
        if (row.spawnOnKill) { table.push(row.spawnOnKill); delete row.spawnOnKill; }
        if (row.immortal) return;
        if (row.stubborn) { row.stubborn--; return; }
        if (row.exitAfterMs) { row.dieAt ??= clock + row.exitAfterMs; return; }
        row.dead = true;
      },
      sleep: ms => {
        clock += ms;
        for (const row of table) if (row.dieAt !== undefined && clock >= row.dieAt) row.dead = true;
      },
      now: () => clock,
    },
  };
}
const electron = (pid, ppid, created, extra = {}) => ({ pid, ppid, created, name: 'electron.exe', ...extra });

test('a stale parent ID does not pull an older unrelated process into the tree', () => {
  const rows = [
    electron(100, 1, 10000),
    electron(101, 100, 10100),
    { pid: 555, ppid: 100, created: 1000, name: 'explorer.exe' }, // its parent died long ago
  ];
  assert.deepEqual(treeOf(rows, [{ pid: 100 }]).map(row => row.pid), [100, 101]);
});

test('an unrelated process with a stale parent ID is neither killed nor a survivor', () => {
  const w = world([electron(100, 1, 10000), electron(101, 100, 10100),
    { pid: 555, ppid: 100, created: 1000, name: 'explorer.exe', immortal: true }]);
  const report = stopProcessTree([{ pid: 100 }], { deps: w.deps });
  assert.deepEqual(report.survivors, []);
  assert.equal(w.kills.includes(555), false);
});

test('the Electron main process is killed before its GPU process', () => {
  const w = world([electron(100, 1, 10000), electron(101, 100, 10100), { pid: 102, ppid: 100, created: 10200, name: 'python.exe' }]);
  stopProcessTree([{ pid: 100 }], { deps: w.deps });
  assert.equal(w.kills[0], 100);
});

test('a GPU process started during shutdown is found and killed', () => {
  const w = world([electron(100, 1, 10000, { spawnOnKill: electron(103, 100, 10500) }), electron(101, 100, 10100)]);
  const report = stopProcessTree([{ pid: 100 }], { deps: w.deps });
  assert.ok(w.kills.includes(103));
  assert.deepEqual(report.survivors, []);
});

test('a slow-exiting backend gets the full wait instead of failing at five seconds', () => {
  const w = world([electron(100, 1, 10000), { pid: 102, ppid: 100, created: 10200, name: 'python.exe', exitAfterMs: 12000 }]);
  const report = stopProcessTree([{ pid: 100 }], { deps: w.deps, waitMs: 20000 });
  assert.deepEqual(report.survivors, []);
});

test('a process that ignores the first kill is killed again', () => {
  const w = world([electron(100, 1, 10000), electron(101, 100, 10100, { stubborn: 1 })]);
  const report = stopProcessTree([{ pid: 100 }], { deps: w.deps, waitMs: 2000 });
  assert.deepEqual(report.survivors, []);
});

test('a surviving Electron GPU process blocks; a surviving helper only warns', () => {
  const w = world([electron(100, 1, 10000), electron(101, 100, 10100, { immortal: true }),
    { pid: 102, ppid: 100, created: 10200, name: 'python.exe', immortal: true }]);
  const report = stopProcessTree([{ pid: 100 }], { deps: w.deps, waitMs: 1000 });
  assert.deepEqual(report.survivors.map(row => row.pid).sort(), [101, 102]);
  assert.deepEqual(report.blocking.map(row => row.pid), [101]);
  assert.throws(() => runner.enforceShutdown(report, 'test tree'), /Electron still running.*PID 101/);
  const quiet = { ...report, blocking: [], survivors: [report.survivors.find(row => row.pid === 102)] };
  assert.doesNotThrow(() => runner.enforceShutdown(quiet, 'test tree'));
});

test('a reused process ID is not mistaken for a survivor', () => {
  const w = world([electron(100, 1, 10000), electron(101, 100, 10100)]);
  w.deps.kill = pid => {
    const row = w.table.find(item => item.pid === pid && !item.dead);
    if (!row) return;
    row.dead = true;
    // Windows hands the GPU process's ID to a new, unrelated process.
    if (pid === 101) w.table.push({ pid: 101, ppid: 4, created: 50000, name: 'svchost.exe' });
  };
  const report = stopProcessTree([{ pid: 100 }], { deps: w.deps, waitMs: 500 });
  assert.deepEqual(report.survivors, []);
});

test('children of an Electron main process that already exited are still checked', () => {
  const w = world([electron(101, 100, 10100, { immortal: true })]);
  const report = stopProcessTree([{ pid: 100, created: 10000 }], { deps: w.deps, waitMs: 500 });
  assert.deepEqual(report.blocking.map(row => row.pid), [101]);
});

test('a late start-time estimate still matches the real Electron root; a later reused ID does not', () => {
  const rows = [electron(100, 1, 10000), electron(101, 100, 10100)];
  // process.uptime() can start counting seconds after the process was created.
  assert.deepEqual(treeOf(rows, [{ pid: 100, created: 15000 }]).map(row => row.pid), [100, 101]);
  const reused = treeOf([{ pid: 100, ppid: 4, created: 90000, name: 'svchost.exe' }], [{ pid: 100, created: 15000 }]);
  assert.equal(reused[0].gone, true);
});

test('a failed process listing falls back to the root instead of throwing', () => {
  const w = world([electron(100, 1, 10000)]);
  w.deps.list = () => { throw Error('powershell timed out'); };
  const report = stopProcessTree([{ pid: 100 }], { deps: w.deps });
  assert.deepEqual(report.survivors, []);
  assert.match(report.notes[0], /process list unavailable/);
});

test('the driver result comes first and a shutdown problem is a separate line', () => {
  const report = { captured: [], notes: [], survivors: [electron(101, 100, 1)], blocking: [electron(101, 100, 1)] };
  const passing = shutdownLines(0, report);
  assert.equal(passing[0], '[runner] driver result: passed (exit code 0)');
  assert.match(passing[1], /SHUTDOWN WARNING \(separate from the driver result\).*PID 101/);
  assert.equal(shutdownLines(3, report)[0], '[runner] driver result: failed (exit code 3)');
  assert.deepEqual(shutdownLines(0, { captured: [], notes: [], survivors: [], blocking: [] }), ['[runner] driver result: passed (exit code 0)']);
});

test('the runner re-checks every Electron tree a launcher reported', () => {
  const log = 'x\n[runner] electron-main {"pid":100,"created":10000}\n\u001b[0m[runner] electron-main {"pid":200,"created":20000}\r\nAssertionError: real failure\n';
  assert.deepEqual(runner.electronRoots(log).map(root => root.pid), [100, 200]);
  const w = world([electron(201, 200, 20100, { immortal: true })]);
  const report = runner.verifyElectronGone(log, { deps: w.deps, waitMs: 500 });
  assert.deepEqual(report.blocking.map(row => row.pid), [201]);
  assert.equal(runner.verifyElectronGone('no markers'), null);
});

test('only folders with "test-" outside the real profile count as disposable', t => {
  const real = [path.join('C:\\Users\\x\\AppData\\Roaming', 'hdr-finisher-desktop'), path.join('C:\\Users\\x\\AppData\\Local', 'HDR Finisher')];
  assert.match(profileProblem(path.join(os.tmpdir(), 'library-profile-abc'), { real }), /no "test-"/);
  assert.match(profileProblem(path.join(real[1], 'test-profile'), { real }), /real application profile/);
  assert.match(profileProblem(real[0], { real }), /real application profile/);
  assert.match(profileProblem('', { real }), /no profile folder/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-test-profile-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(profileProblem(dir, { real }), null);
  fs.writeFileSync(path.join(dir, 'library-cache-settings.json'), JSON.stringify({ location: path.join(real[1], 'Cache') }));
  assert.match(profileProblem(dir, { real }), /not a test folder/);
  fs.writeFileSync(path.join(dir, 'library-cache-settings.json'), JSON.stringify({ location: path.join(dir, 'Cache') }));
  assert.equal(profileProblem(dir, { real }), null);
});
