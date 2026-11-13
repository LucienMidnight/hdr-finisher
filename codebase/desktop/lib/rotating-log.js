const fs = require('node:fs');
const path = require('node:path');
const {Writable} = require('node:stream');
const MAX_BYTES = 20 * 1024 * 1024;
const BACKUPS = 2;

// Main-process single writer. Each append closes its handle before any rename.
function create(logPath, {maxBytes = MAX_BYTES, backups = BACKUPS} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(backups) || backups < 0) throw Error('Invalid log bounds');
  fs.mkdirSync(path.dirname(logPath), {recursive:true});
  // Remove surplus numbered backups when a log's allowance is reduced.
  for (const name of fs.readdirSync(path.dirname(logPath))) {
    const prefix = path.basename(logPath) + '.';
    const suffix = name.startsWith(prefix) ? name.slice(prefix.length) : '';
    if (/^[1-9][0-9]*$/.test(suffix) && Number(suffix) > backups)
      fs.rmSync(path.join(path.dirname(logPath), name), {force:true});
  }
  // Bound pre-existing logs too, reading only their tail (never a multi-GB file).
  for (let i = 0; i <= backups; i++) {
    const file = i ? `${logPath}.${i}` : logPath;
    if (!fs.existsSync(file) || fs.statSync(file).size <= maxBytes) continue;
    const fd = fs.openSync(file, 'r');
    const tail = Buffer.alloc(maxBytes);
    try { fs.readSync(fd, tail, 0, maxBytes, fs.fstatSync(fd).size-maxBytes); }
    finally { fs.closeSync(fd); }
    fs.writeFileSync(file, tail);
  }
  let size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  function rotate() {
    if (backups) {
      fs.rmSync(`${logPath}.${backups}`, {force:true});
      for (let i = backups-1; i >= 1; i--) {
        if (fs.existsSync(`${logPath}.${i}`)) fs.renameSync(`${logPath}.${i}`, `${logPath}.${i+1}`);
      }
      if (fs.existsSync(logPath)) fs.renameSync(logPath, `${logPath}.1`);
    } else fs.rmSync(logPath, {force:true});
    size = 0;
  }
  function append(data) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (bytes.length <= maxBytes && size + bytes.length > maxBytes) rotate();
    for (let offset = 0; offset < bytes.length;) {
      if (size === maxBytes) rotate();
      const end = Math.min(bytes.length, offset + maxBytes-size);
      fs.appendFileSync(logPath, bytes.subarray(offset, end));
      size += end-offset;
      offset = end;
    }
  }
  const stream = new Writable({write(chunk, encoding, done) {
    // Serialize asynchronous backend appends without holding a handle during
    // rotation. The caller's backpressure limit still bounds queued diagnostics.
    try {
      if (chunk.length <= maxBytes && size + chunk.length > maxBytes) rotate();
    } catch (error) { return done(error); }
    let offset = 0;
    function next() {
      try {
        if (offset === chunk.length) return done();
        if (size === maxBytes) rotate();
        const end = Math.min(chunk.length, offset + maxBytes-size);
        fs.appendFile(logPath, chunk.subarray(offset, end), error => {
          if (error) return done(error);
          size += end-offset;
          offset = end;
          next();
        });
      } catch (error) { done(error); }
    }
    next();
  }});
  // Disk failures must not crash the main process or break crash dialogs.
  stream.on('error', error => console.error('Could not write diagnostics:', error.message));
  return {append, stream};
}
module.exports = {create, MAX_BYTES, BACKUPS};
