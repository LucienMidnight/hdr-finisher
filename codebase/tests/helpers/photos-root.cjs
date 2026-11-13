'use strict';
/**
 * Steve's photos live in D:/Photos on the Windows PC, and drivers name their
 * sources there. On another machine (the MacBook) the same folders sit under a
 * different root. One setting moves the whole root instead of each path:
 *
 *   HDR_FINISHER_PHOTOS_ROOT=/path/to/Photos
 *
 * When it is not set, a `Photos` folder beside the repository (next to `ai`)
 * is used if D:/Photos does not exist. Paths outside D:/Photos are unchanged.
 */
const fs = require('node:fs');
const path = require('node:path');

const PC_ROOT = /^D:[\\/]+Photos(?=[\\/]|$)/i;
const BESIDE_REPOSITORY = path.resolve(__dirname, '..', '..', '..', '..', 'Photos');

function photosRoot() {
  if (process.env.HDR_FINISHER_PHOTOS_ROOT) return process.env.HDR_FINISHER_PHOTOS_ROOT;
  if (process.platform !== 'win32' && fs.existsSync(BESIDE_REPOSITORY)) return BESIDE_REPOSITORY;
  return null;
}

/** The local path for a D:/Photos path (either slash direction). */
function photosPath(file, root = photosRoot()) {
  if (!root || typeof file !== 'string' || !PC_ROOT.test(file)) return file;
  return path.join(root, ...file.replace(PC_ROOT, '').split(/[\\/]+/).filter(Boolean));
}

module.exports = { photosPath, photosRoot };
