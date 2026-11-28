'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { impacts, MEMORY, PROBES, recipeHash, stats, validateRun } = require('../tools/audit-summary.cjs');

const driver = path.resolve(__dirname, '../tools/audit-summary.cjs');
const hash = 'a'.repeat(64);
const probe = PROBES[0];
const filename = 'module-impact-typical-fit.json';

function step(state, feedback, settle, peak) {
  return { step: probe, kind: 'probe', state, processedLongEdge: 1408, route: 'gpu-direct', fallbacks: [],
    signature: state, memory_mb: { ...Object.fromEntries(MEMORY.map(key => [key, null])), footprint_peak: peak },
    first_feedback_ms: stats([feedback]), settle_ms: stats([settle]), drained_ms: stats([20_000]),
    skipped: null, errors: [] };
}

function fixture() {
  const recipe = { strength: .8 };
  return { schema: 'module-impact-v1', audit: '2026-11-28-mac',
    driver: { path: 'tests/performance/grade-module-impact.js', sha256: hash },
    machine: { name: 'MacBook Neo', platform: 'darwin', chip: 'A18 Pro', ramGiB: 8, window: '1408x794',
      dpr: 2, powerSource: 'ac', powerMode: 'default', gpuAdapter: 'Apple' },
    app: { version: '0.9.4', commit: '1234', dirty: false },
    photo: { role: 'typical', file: 'IMG_7723.CR3', sha256: hash, megapixels: 24.2 },
    zoom: 'fit', previewResolution: 'auto', samples: 1, warmups: 0, denoiseProbeMethod: 'clean_grain',
    startedAt: '2026-11-28T00:00:00Z', durationSec: 1,
    modules: [{ module: 'film', lane: 'hdr', recipe, recipeHash: recipeHash(recipe), offMethod: 'eye',
      alternation: 'interleaved', pixelsChanged: true, loadAverage: [0, 0, 0], denoiseRebuilds: 0,
      status: 'complete', errors: [], steps: [step('on', 141, 1010, 901), step('off', 100, 800, 600)], impact: [] }],
    noise: { baseline_start: {}, baseline_middle: {}, baseline_end: {}, spread_pct: 0 } };
}

function finding(id, category = 'bug') {
  return { schema: 'findings-v1', id, audit: '2026-11-28-mac', commit: '1234', area: 'repo', module: null,
    file: 'codebase/example.js', line: 1, symbol: null, category, severity: 'low', confidence: 'confirmed',
    summary: 'Example finding', evidence: 'Trace', felt_impact: null, output_change: false, strict_area: false,
    proposed_fix: 'Example fix', check: 'Example check', status: 'open', patch: null, fix_commit: null, notes: null };
}

function dirs(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-summary-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = ['run', 'prior', 'write'].map(name => path.join(root, name));
  for (const dir of dirs) fs.mkdirSync(dir);
  return dirs;
}
const writeJson = (dir, name, ...rows) => fs.writeFileSync(path.join(dir, name), rows.map(x => JSON.stringify(x) + '\n').join(''));
const cli = (...args) => spawnSync(process.execPath, [driver, ...args], { encoding: 'utf8' });

test('calculates paired deltas and applies strict thresholds without flagging drain time', () => {
  const run = fixture(), [m] = run.modules;
  assert.deepEqual(impacts(m, run), [{ probe, first_feedback_delta_ms: 41, first_feedback_delta_pct: 41,
    settle_delta_ms: 210, settle_delta_pct: 26.25, footprint_delta_mb: 301, flags: ['impact', 'slow', 'memory'] }]);
  m.steps[0] = step('on', 130, 900, 900);
  assert.deepEqual(impacts(m, run)[0].flags, []);
  m.steps[0].whole_wait_ms = stats([10001]);
  assert.deepEqual(impacts(m, run)[0].flags, ['slow']);
  run.noise.baseline_start[probe] = { first_feedback_ms: 100, settle_ms: 800 };
  run.noise.baseline_end[probe] = { first_feedback_ms: 145, settle_ms: 925 };
  assert.deepEqual(impacts(m, run)[0].flags, ['noise', 'slow']);
  m.steps[0] = step('on', 115, 820, 900);
  m.pixelsChanged = false;
  assert.deepEqual(impacts(m, run)[0], { probe, first_feedback_delta_ms: null, first_feedback_delta_pct: null,
    settle_delta_ms: null, settle_delta_pct: null, footprint_delta_mb: null, flags: ['no_op'] });
  m.steps[1].skipped = 'self-reference';
  assert.deepEqual(impacts(m, run), []);
});

test('rejects wrong recipe hashes, timing statistics and p95 below ten samples', () => {
  const run = fixture(), [m] = run.modules;
  assert.equal(validateRun(run), run);
  m.steps[0].settle_ms.median = 0;
  assert.throws(() => validateRun(run), /settle_ms.median/);
  m.steps[0].settle_ms = { ...stats([1010]), p95: 1010 };
  assert.throws(() => validateRun(run), /settle_ms.p95/);
  m.steps[0].settle_ms = stats([1010]);
  m.recipe.strength = .4;
  assert.throws(() => validateRun(run), /recipeHash/);
});

test('validates actual module photos, and does not pair a reduced CPU sample with an exact sample', () => {
  const run = fixture(), [m] = run.modules;
  m.photo = { role: 'override', file: '_DSC7970.ARW', sha256: 'b'.repeat(64), megapixels: 33 };
  const [on] = m.steps;
  on.reducedSamples = [{ route: 'cpu-reduced', requestedLongEdge: 1408, actualLongEdge: 1024,
    reason: 'Denoise is using the CPU.', first_feedback_ms: null, settle_ms: 1700, drained_ms: 1900,
    whole_wait_ms: 1720, signature: on.signature, memory_mb: on.memory_mb }];
  on.processedLongEdge = 0;
  on.first_feedback_ms = on.settle_ms = on.drained_ms = stats([]);
  assert.equal(validateRun(run), run);
  assert.deepEqual(impacts(m, run), []);
  on.reducedSamples[0].actualLongEdge = 1408;
  assert.throws(() => validateRun(run), /actualLongEdge/);
  on.reducedSamples[0].actualLongEdge = 1024;
  m.photo.role = 'typical';
  assert.throws(() => validateRun(run), /modules\[0\]\.photo/);
  m.photo.role = 'override';
  m.photo.sha256 = 'invalid';
  assert.throws(() => validateRun(run), /photo.sha256/);
});

test('merges findings, replaces an older merged file, and emits grouped counts and impact flags', t => {
  const [run, , write] = dirs(t);
  writeJson(run, filename, fixture());
  writeJson(write, 'findings-R2.jsonl', finding('R2-10'), finding('R2-2', 'perf'));
  writeJson(write, 'findings-T.jsonl', finding('T-1', 'tidy'));
  writeJson(write, 'findings.jsonl', finding('R4-1'));
  const result = cli('--run', run, '--write', write);
  assert.equal(result.status, 0, result.stderr);
  const merged = fs.readFileSync(path.join(write, 'findings.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x).id);
  assert.deepEqual(merged, ['R2-2', 'R2-10', 'T-1']);
  const summary = fs.readFileSync(path.join(write, 'summary.md'), 'utf8');
  for (const expected of ['| package | R2 | 2 |', '| category | perf | 1 |', '| severity | low | 3 |',
    '| status | open | 3 |', 'First feedback Δ ms (%)', '### Flags', '- memory — film']) assert.ok(summary.includes(expected));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run, filename), 'utf8')).modules[0].impact, []);
});

test('findings-only validation is read-only and reports invalid fields with file and line', t => {
  const [run] = dirs(t);
  writeJson(run, 'findings-R2.jsonl', finding('R2-1'));
  assert.equal(cli('--run', run).status, 0);
  assert.deepEqual(fs.readdirSync(run), ['findings-R2.jsonl']);
  writeJson(run, 'findings-R2.jsonl', { ...finding('R2-1'), severity: 'urgent' });
  const invalid = cli('--run', run);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /findings-R2.jsonl: line 1.severity/);
});

test('reports only same-machine regressions above noise and refuses cross-machine inputs', t => {
  const [run, prior, write] = dirs(t);
  const before = fixture();
  before.modules[0].steps[0] = step('on', 100, 950, 900);
  writeJson(run, filename, fixture());
  writeJson(prior, filename, before);
  const result = cli('--run', run, '--compare', prior, '--write', write);
  assert.equal(result.status, 0, result.stderr);
  const summary = fs.readFileSync(path.join(write, 'summary.md'), 'utf8');
  assert.match(summary, /first_feedback_ms — 100.0 → 141.0/);
  assert.doesNotMatch(summary, /settle_ms —/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(write, filename), 'utf8')).modules[0].impact[0].flags.includes('regression'));
  before.machine.powerSource = 'battery';
  writeJson(prior, filename, before);
  const unmatched = cli('--run', run, '--compare', prior);
  assert.equal(unmatched.status, 0, unmatched.stderr);
  assert.match(unmatched.stdout, /No prior run matched/);
  before.machine.name = 'Another machine';
  writeJson(prior, filename, before);
  const refused = cli('--run', run, '--compare', prior);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Cross-machine comparison refused/);
});
