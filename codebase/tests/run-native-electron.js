/** Run a driver that owns its Electron launch, without starting a second app.
 * Supplies a disposable profile's requested window size and guarantees that
 * only the driver's own process tree is stopped. No owner profile is used.
 */
const fs = require('node:fs');
const path = require('node:path');
const { stopProcessTree } = require('./release/process-tree.cjs');
const { assertDisposableProfile } = require('./test-profile.cjs');
const { reportShutdown } = require('./launcher-shutdown.cjs');
process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE ||= require('../tools/lib/platform.cjs').machineSettings().windowSize;
const [driver, ...args] = process.argv.slice(2);
if (!driver) throw Error('usage: node tests/run-native-electron.js <driver.js> [arguments]');
const desktop = path.resolve(__dirname, '../desktop');
// pid -> start time (when known). Shutdown never throws or changes the exit
// code; problems are reported after the driver's result at exit, and the
// release runner re-checks the Electron tree before the next driver.
const trees = new Map();
const shutdown = { captured: [], survivors: [], blocking: [], notes: [] };
function stop(pid) {
  if (!trees.has(pid)) return;
  const report = stopProcessTree([{ pid, created: trees.get(pid) }]);
  trees.delete(pid);
  for (const key of Object.keys(shutdown)) shutdown[key].push(...report[key]);
}
function install(_electron) {
 const launch = _electron.launch.bind(_electron);
 _electron.launch = async options => {
  if (trees.size) throw Error('Native test attempted to overlap Electron apps');
  const env = { ...process.env, ...options.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!env.HDR_FINISHER_USER_DATA_DIR) throw Error('Native driver must provide a disposable profile');
  assertDisposableProfile(env.HDR_FINISHER_USER_DATA_DIR, 'HDR_FINISHER_USER_DATA_DIR');
  const size = env.HDR_FINISHER_ELECTRON_WINDOW_SIZE;
  if (size) {
    const [width, height] = size.split('x').map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw Error('Invalid test window size');
    fs.writeFileSync(path.join(env.HDR_FINISHER_USER_DATA_DIR, 'window-state.json'),
      JSON.stringify({ x: 0, y: 0, width, height }));
  }
  const launchArgs = [...(options.args || [])];
  // Two historical diagnostics passed only a project to development Electron.
  // A development binary needs the current desktop directory as its app path.
  if (/node_modules[\\/]electron[\\/]/i.test(options.executablePath || '')) {
    for (let index = 0; index < launchArgs.length; index++) {
      if (launchArgs[index] === '.') launchArgs[index] = desktop;
    }
    if (launchArgs.length && /\.hdrfinisher$/i.test(launchArgs[0])) launchArgs.unshift(desktop);
  }
  console.log('[runner] launch');
  let app;
  const timer = setTimeout(() => {
    console.error('[runner] STARTUP TIMEOUT: launch/window/setup exceeded 180000 ms');
    if (!app) {
      console.error('[runner] shutdown failed: launch returned no process handle; cannot verify Electron exited');
      process.exit(86);
    }
    try { for (const pid of [...trees.keys()]) stop(pid); } finally { process.exit(process.exitCode || 1); }
  }, 180000);
  try { app = await launch({ ...options, args: launchArgs, env, timeout: 180000 }); }
  catch (error) { clearTimeout(timer); throw error; }
  const evaluate = app.evaluate.bind(app);
  app.evaluate = async (...args) => {
    let timer;
    try {
      return await Promise.race([evaluate(...args), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('[runner] main-process evaluate timed out after 30000 ms')), 30000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const launcherPid = app.process()?.pid;
  if (launcherPid) trees.set(launcherPid, undefined);
  const { pid, started } = await app.evaluate(() => ({ pid: process.pid, started: Math.round(Date.now() - process.uptime() * 1000) }));
  trees.set(pid, started);
  console.log(`[runner] electron-main ${JSON.stringify({ pid, created: started })}`);
  // Keep the PID until OS shutdown is verified, even if DevTools disconnects.
  const close = app.close.bind(app);
  app.close = async () => {
    console.log('[runner] driver end (app.close)');
    let closeTimer;
    try {
      await Promise.race([close(), new Promise((_, reject) => {
        closeTimer = setTimeout(() => reject(Error('Electron graceful close exceeded 5000 ms')), 5000);
      })]);
    } catch (error) { console.error(`[runner] ${error.message}; forcing tree shutdown`); }
    finally {
      clearTimeout(closeTimer); clearTimeout(timer);
      stop(pid);
      if (launcherPid) stop(launcherPid);
    }
    setTimeout(() => { if (!trees.size) process.exit(process.exitCode || 0); }, 5000).unref();
  };
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog);
    const originalSync = dialog.showMessageBoxSync.bind(dialog);
    const isUnsaved = args => {
      const options = args.at(-1);
      return JSON.stringify(options?.buttons) === JSON.stringify(["Save", "Discard", "Cancel"]);
    };
    dialog.showMessageBox = async (...args) => isUnsaved(args)
      ? { response: 1, checkboxChecked: false } : original(...args);
    dialog.showMessageBoxSync = (...args) => isUnsaved(args) ? 1 : originalSync(...args);
  });
  // preview-diagnostic is an interactive recorder, with no natural end. A
  // bounded sample still runs its original startup, menu setup and recorder.
  if (/preview-diagnostic\.js$/.test(driver)) {
    const seconds = Number(process.env.HDR_FINISHER_DIAGNOSTIC_SECONDS || 60);
    setTimeout(() => { console.log(`Diagnostic sample complete (${seconds}s)`); stop(pid); }, seconds * 1000);
  }
  app.firstWindow = async options => {
    const page = await require('./electron-initial-load').waitForMainWindow(app, options);
    if (/^https?:/.test(page.url())) await require('./electron-initial-load').waitForInitialLoad(app, page);
    else await page.waitForLoadState('load');
    clearTimeout(timer);
    console.log('[runner] window ready');
    console.log('[runner] driver start');
    return page;
  };
  return app;
 };
}
// Desktop and browser tests have separate Playwright installations.
const implementations = new Set([
  require('playwright')._electron,
  require(require.resolve('playwright', { paths: [desktop] }))._electron,
]);
for (const implementation of implementations) install(implementation);
process.on('exit', code => {
  for (const pid of [...trees.keys()]) stop(pid);
  reportShutdown(code, shutdown.captured.length || shutdown.notes.length ? shutdown : null);
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { process.exit(130); });
process.argv = [process.argv[0], path.resolve(driver), ...args];
require(path.resolve(driver));
