/** Run a driver that owns its Electron launch, without starting a second app.
 * Supplies a disposable profile's requested window size and guarantees that
 * only the driver's own process tree is stopped. No owner profile is used.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const [driver, ...args] = process.argv.slice(2);
if (!driver) throw Error('usage: node tests/run-native-electron.js <driver.js> [arguments]');
const desktop = path.resolve(__dirname, '../desktop');
const trees = new Set();
function stop(pid) {
  if (!trees.delete(pid)) return;
  try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); }
  catch { /* driver may already have closed its app */ }
}
function install(_electron) {
 const launch = _electron.launch.bind(_electron);
 _electron.launch = async options => {
  if (trees.size) throw Error('Native test attempted to overlap Electron apps');
  const env = { ...process.env, ...options.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!env.HDR_FINISHER_USER_DATA_DIR) throw Error('Native driver must provide a disposable profile');
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
  const app = await launch({ ...options, args: launchArgs, env });
  const pid = await app.evaluate(() => process.pid);
  trees.add(pid);
  app.on('close', () => trees.delete(pid));
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
  return app;
 };
}
// Desktop and browser tests have separate Playwright installations.
const implementations = new Set([
  require('playwright')._electron,
  require(require.resolve('playwright', { paths: [desktop] }))._electron,
]);
for (const implementation of implementations) install(implementation);
process.on('exit', () => { for (const pid of [...trees]) stop(pid); });
process.argv = [process.argv[0], path.resolve(driver), ...args];
require(path.resolve(driver));
