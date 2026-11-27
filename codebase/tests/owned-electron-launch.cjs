'use strict';
const cp = require('node:child_process');
const { stopProcessTree } = require('./release/process-tree.cjs');
const roots = new Map();
let installed = false;
let lastReport;
function stopOwnedLaunches() {
  if (!roots.size) return lastReport;
  lastReport = stopProcessTree([...roots.values()]);
  for (const root of lastReport.captured) roots.set(root.pid, root);
  if (!lastReport.survivors.length) roots.clear();
  if (lastReport.survivors.length || lastReport.notes.length) process.exitCode = 86;
  return lastReport;
}
function installOwnedLaunches() {
  if (installed) return;
  installed = true;
  const spawn = cp.spawn;
  // Playwright does not return its handle until DevTools connects. Capture
  // the OS child synchronously instead, including launches that never connect.
  cp.spawn = function(command, args, options) {
    const child = spawn.apply(this, arguments);
    if (options?.env?.HDR_FINISHER_TEST_MODE === '1' && /electron|hdr finisher/i.test(String(command) + " " + (options.argv0 || "")) && child.pid)
      roots.set(child.pid, { pid: child.pid, created: Date.now() });
    return child;
  };
  process.on('exit', () => {
    const report = stopOwnedLaunches();
    if (report) console.error(`[owned-launch] ${JSON.stringify(report)}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => process.exit(130));
}
module.exports = { installOwnedLaunches, stopOwnedLaunches };
