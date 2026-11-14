// Test-only bridge: full finished pixels, no baseline subtraction or sampling.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function createColourComparator() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'test-parity-colour-'));
  const child = spawn(require('../../tools/lib/platform.cjs').pythonExecutable(),
    ['-u', path.join(__dirname, 'parity_colour.py')], {
      env: { ...process.env, PYTHONPATH: [path.resolve(__dirname, '../../backend'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
  let pending, stopped;
  const fail = error => { stopped = error; if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; } };
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`Perceptual comparator exited (${code})`)));
  child.stdin.on('error', fail);
  createInterface({ input: child.stdout }).on('line', line => {
    if (!pending) return;
    const { resolve, reject, timer } = pending;
    clearTimeout(timer);
    pending = null;
    try {
      const result = JSON.parse(line);
      if (result.error) throw new Error(result.error);
      if (![result.mean, result.p999].every(Number.isFinite)) throw new Error('Non-finite perceptual result');
      resolve(result);
    } catch (error) { reject(error); }
  });
  return {
    async compare(result) {
      if (stopped) throw stopped;
      if (pending) throw new Error('Perceptual comparisons must be serial');
      if (!result.captured) throw new Error('Missing finished parity pixels');
      const [width, height, cpuWidth, cpuHeight] = result.size;
      if (width !== cpuWidth || height !== cpuHeight || width <= 0 || height <= 0) throw new Error('Parity dimensions differ');
      for (const kind of ['gpu', 'cpu']) {
        const bytes = Buffer.from(result.captured[kind], 'base64');
        if (bytes.length !== width * height * 4) throw new Error(`Incomplete ${kind} parity frame`);
        fs.writeFileSync(path.join(directory, `${kind}.rgba`), bytes);
      }
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { fail(new Error('Perceptual comparison exceeded 120 seconds')); child.kill(); }, 120000);
          pending = { resolve, reject, timer };
          child.stdin.write(JSON.stringify({ directory, width, height }) + '\n');
        });
      } finally {
        for (const kind of ['gpu', 'cpu']) fs.rmSync(path.join(directory, `${kind}.rgba`), { force: true });
      }
    },
    close() { child.stdin.end(); child.kill(); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}
module.exports = { createColourComparator };
