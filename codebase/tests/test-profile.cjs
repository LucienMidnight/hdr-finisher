'use strict';
/**
 * Test profiles must be disposable. The app gives a profile its own Library
 * cache only when the profile path contains "test-"
 * (backend/hdr_finisher/library_cache.py); any other profile writes into the
 * owner's real cache under %LOCALAPPDATA%\HDR Finisher\Cache.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function realProfiles() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [path.join(appData, 'hdr-finisher-desktop'), path.join(appData, 'HDR Finisher'), path.join(local, 'HDR Finisher')];
}

const normal = value => path.resolve(value).replace(/[\/]+$/, '').toLowerCase();
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep.toLowerCase()) || child.startsWith(parent + '/');

/** Reason the folder is not a disposable test profile, or null when it is. */
function profileProblem(directory, { real = realProfiles() } = {}) {
  if (!directory) return 'no profile folder was given';
  const resolved = normal(directory);
  if (real.some(item => inside(resolved, normal(item)))) return `${directory} is the owner's real application profile`;
  if (!resolved.includes('test-')) return `${directory} has no "test-" in its path, so the app would use the owner's real Library cache`;
  // A cache location stored in the profile must stay disposable as well.
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(directory, 'library-cache-settings.json'), 'utf8'));
    if (settings.location) {
      const location = normal(settings.location);
      if (real.some(item => inside(location, normal(item))) || !(inside(location, resolved) || location.includes('test-'))) {
        return `${directory} points its Library cache at ${settings.location}, which is not a test folder`;
      }
    }
  } catch { /* no saved cache settings */ }
  return null;
}

function assertDisposableProfile(directory, source = 'profile') {
  const problem = profileProblem(directory);
  if (problem) throw Error(`Refusing to launch with a non-disposable test profile (${source}): ${problem}. Name the folder with "test-", for example fs.mkdtempSync(path.join(dir, "test-profile-")).`);
  return directory;
}

module.exports = { realProfiles, profileProblem, assertDisposableProfile };
