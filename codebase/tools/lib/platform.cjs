'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { CODEBASE, machineSettings } = require('./machine-settings.cjs');
function pythonExecutable() {
  return process.env.HDR_FINISHER_PYTHON || path.join(CODEBASE, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}
function electronExecutable() { return require(path.join(CODEBASE, 'desktop/node_modules/electron')); }
function packagedExecutable() {
  if (process.env.HDR_FINISHER_PACKAGED_EXECUTABLE) return process.env.HDR_FINISHER_PACKAGED_EXECUTABLE;
  const dist = path.join(CODEBASE, 'dist-electron');
  if (process.platform === 'win32') return path.join(dist, 'win-unpacked/HDR Finisher.exe');
  if (process.platform === 'darwin') return path.join(dist, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'HDR Finisher.app/Contents/MacOS/HDR Finisher');
  return path.join(dist, 'linux-unpacked/hdr-finisher');
}
function stopTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch { /* already exited */ }
  } else {
    const report = require('../../tests/release/process-tree.cjs').stopProcessTree([{ pid }]);
    if (report.survivors.length) throw Error(`Process tree did not stop: ${JSON.stringify(report)}`);
  }
}
// Keep the established Windows sampler; POSIX uses the existing app observer.
function memorySampler(pid, options = {}) {
  if (process.platform === 'win32') return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(CODEBASE, 'tests/performance/sample-process-memory.ps1'), '-RootProcessId', String(pid)], options);
  return spawn(pythonExecutable(), [path.join(CODEBASE, 'tools/sample-process-memory.py'), String(pid)], options);
}
function removeTestFolder(target, base) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(target).includes('test-')) throw Error(`Unsafe cleanup: ${target}`);
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
}
module.exports = { pythonExecutable, electronExecutable, packagedExecutable, stopTree, memorySampler, removeTestFolder, machineSettings };
