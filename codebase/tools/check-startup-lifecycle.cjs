// Run through gpu-run-lock.py. Empty-app launch/quit regression, not a GPU driver.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { installOwnedLaunches, stopOwnedLaunches } = require('../tests/owned-electron-launch.cjs');
installOwnedLaunches();
const { _electron } = require('playwright');
const { listProcesses, treeOf, stopProcessTree } = require('../tests/release/process-tree.cjs');
const desktop = path.resolve(__dirname, '../desktop');
const out = path.resolve(__dirname, process.env.HDR_STARTUP_OUTPUT || '../output/startup-lifecycle');
fs.mkdirSync(out, { recursive: true });
const samples = [];
async function run(index, failure = false) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-finisher-test-startup-'));
  let app, captured = [];
  const start = Date.now();
  try {
    const env = { ...process.env, HDR_FINISHER_TEST_MODE: '1', HDR_FINISHER_USER_DATA_DIR: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    if (failure) env.HDR_FINISHER_PYTHON = path.join(profile, 'missing-python.exe');
    app = await _electron.launch({ executablePath: require(path.join(desktop,'node_modules/electron')), args: [desktop], env, timeout: 150000 });
    const pid = app.process().pid;
    if (failure) {
      await new Promise(resolve => app.process().once('exit', resolve));
      if (app.process().exitCode !== 1) throw Error('Failure launch did not exit with code 1');
    } else {
      const page = await require("../tests/electron-initial-load").waitForMainWindow(app);
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/, { timeout: 150000 });
      const health = await page.evaluate(() => fetch('/health').then(r=>r.json()));
      if (health.status !== 'ok') throw Error('Unhealthy backend');
      captured = treeOf(listProcesses(), [{ pid, created: start }]);
      await app.close();
    }
    const report = stopProcessTree(captured);
    if (report.survivors.length || report.notes.length) throw Error(JSON.stringify(report));
    samples.push({ index, failure, elapsed_ms: Date.now() - start, processes: captured, survivors: report.survivors });
  } finally {
    stopOwnedLaunches();
    const logs = path.join(profile, 'logs/backend.log');
    if (fs.existsSync(logs)) fs.copyFileSync(logs, path.join(out, `${index}.log`));
    fs.writeFileSync(path.join(out,'report.json'), JSON.stringify(samples,null,2));
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:5});
  }
  console.log(JSON.stringify(samples.at(-1)));
}
(async () => {
  // Two independent busy workers keep moderate CPU activity throughout imports.
  const workers = Array.from({length:2},()=>new Worker('for(;;) Math.sqrt(Math.random())',{eval:true}));
  try {
    const count = Number(process.env.HDR_STARTUP_REPEATS || 10);
    for (let i=1;i<=count;i++) await run(i);
    // Missing executable must quit without needing a person to dismiss a modal.
    try { await run('missing-backend', true); }
    catch (error) {
      // Playwright may reject if the app exits before its debugger connects.
      const log = fs.readFileSync(path.join(out,'missing-backend.log'),'utf8');
      if (!log.includes('startup_failed') || !log.includes('ENOENT')) throw error;
      console.log('Missing-backend launch failed promptly with ENOENT; no modal wait.');
    }
  } finally { await Promise.all(workers.map(worker=>worker.terminate())); }
})().catch(error=>{console.error(error);process.exitCode=1});
