const readline = require('node:readline');

// Only completed startup work extends the idle deadline. Heartbeats, arbitrary
// stderr and repeated phase names must not keep a wedged backend alive forever.
function waitForBackend(child, { write = () => {}, onProgress = () => {}, idleMs = 90000, totalMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now(), seen = new Set();
    let lastProgress = started, phase = 'Python runtime', settled = false;
    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });
    const finish = (error, record) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      child.removeListener('error', failed);
      child.removeListener('exit', exited);
      // Keep stdout draining after readiness, but no longer parse it.
      stdout.removeListener('line', line);
      stderr.removeListener('line', progress);
      error ? reject(error) : resolve(record);
    };
    const failed = error => finish(error);
    const exited = (code, signal) => finish(Error(`Backend exited during ${phase} (code ${code}, signal ${signal}).`));
    const progress = text => {
      const match = /^HDR_FINISHER_PROGRESS (.+)$/.exec(text);
      if (!match) return;
      try {
        const record = JSON.parse(match[1]);
        if (typeof record.phase !== 'string' || seen.has(record.phase)) return;
        seen.add(record.phase); phase = record.phase;
        lastProgress = Date.now(); onProgress(phase, lastProgress - started);
      } catch { /* ordinary diagnostic output */ }
    };
    const line = text => {
      write(text); progress(text);
      if (!text.startsWith('HDR_FINISHER_READY ')) return;
      try { finish(null, JSON.parse(text.slice('HDR_FINISHER_READY '.length))); }
      catch (error) { finish(error); }
    };
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - lastProgress >= idleMs || now - started >= totalMs)
        finish(Error(`Backend startup stalled at ${phase}: ${now - started} ms elapsed, ${now - lastProgress} ms without progress.`));
    }, Math.min(1000, idleMs, totalMs));
    stdout.on('line', line);
    stderr.on('line', progress);
    child.once('error', failed); child.once('exit', exited);
  });
}
module.exports = { waitForBackend };
