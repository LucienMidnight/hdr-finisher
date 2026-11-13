'use strict';
/**
 * Steve's photos live in D:/Photos on the Windows PC, and drivers name their
 * sources there. On another machine (the MacBook) the same folders sit under a
 * different root. One setting moves the whole root instead of each path:
 *
 *   HDR_FINISHER_PHOTOS_ROOT=/path/to/Photos
 *
 * Otherwise the machine JSON supplies the root; its default is Photos beside
 * the main checkout on POSIX and D:/Photos on Windows. Agent worktrees use
 * the same JSON. Paths outside D:/Photos are unchanged.
 */
const path = require('node:path');

const PC_ROOT = /^D:[\\/]+Photos(?=[\\/]|$)/i;
const { machineSettings } = require('../../tools/lib/machine-settings.cjs');

function photosRoot() {
  return machineSettings().photosRoot;
}

/** The local path for a D:/Photos path (either slash direction). */
function photosPath(file, root = photosRoot()) {
  if (!root || typeof file !== 'string' || !PC_ROOT.test(file)) return file;
  return path.join(root, ...file.replace(PC_ROOT, '').split(/[\\/]+/).filter(Boolean));
}

module.exports = { photosPath, photosRoot };
