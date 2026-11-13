'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const CODEBASE = path.resolve(__dirname, '../..');
function machineSettings(codebase = CODEBASE) {
  const repo = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: codebase, encoding: 'utf8', windowsHide: true }).trim());
  const file = path.resolve(process.env.HDR_FINISHER_MACHINE_SETTINGS || path.join(repo, '../hdr-finisher-machine.json'));
  const base = path.dirname(file);
  const result = {
    windowSize: process.platform === 'darwin' ? '1408x794' : '2560x1440',
    photosRoot: process.platform === 'win32' ? 'D:/Photos' : path.join(base, 'Photos'),
    testFixturesRoot: path.join(base, 'test-fixtures'),
    sharedTestPhotos: path.join(repo, 'codebase/output/test-photos'),
    sharedLocalTestMedia: path.join(repo, 'codebase/local-test-media'),
    lockFolder: path.dirname(repo), nativeToolsRoot: path.join(base, 'native-tools'),
    ...(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}),
  };
  if (process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE) result.windowSize = process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE;
  if (process.env.HDR_FINISHER_PHOTOS_ROOT) result.photosRoot = process.env.HDR_FINISHER_PHOTOS_ROOT;
  for (const key of Object.keys(result)) if (key !== 'windowSize') {
    const value = result[key].replace(/^~(?=[/\\]|$)/, os.homedir());
    result[key] = path.resolve(base, value);
  }
  if (!/^[1-9]\d*x[1-9]\d*$/.test(result.windowSize)) throw Error('windowSize must be WIDTHxHEIGHT');
  return { ...result, settingsFile: file, mainRepository: repo };
}
module.exports = { machineSettings, CODEBASE };
