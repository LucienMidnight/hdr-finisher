/**
 * Summarize Viewport-Bounded GPU Preview baseline runs (PRD section 6).
 *
 *   node tests/performance/summarize-viewport-baseline.js --out <summary.json> <report.json> [...]
 *
 * Accepts reports from zoom-after-edit-review.js and
 * heavy-project-long-session.js. Operations are grouped by name with the
 * cycle number removed, and every figure is reported with its sample count.
 * Nothing is judged here: the section 6 targets are printed beside the numbers.
 *
 * Two clocks are kept apart for every operation:
 *   exact   from the action to the exact picture being presented
 *   stable  from the action until the picture and the scopes are settled
 * Drags add: first feedback after the first input, and release to exact.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : null;
const files = args.filter((value, index) => index !== outIndex && index !== outIndex + 1);

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  return { n: sorted.length, min: Math.round(sorted[0]), median: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(sorted.at(-1)) };
}

const groups = new Map();
for (const file of files) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fixture = path.basename(report.project || file).replace(/\.hdrfinisher$/, '');
  const zoom = report.zoom ? ` @${report.zoom}%` : '';
  for (const operation of report.operations || []) {
    const name = operation.name.replace(/^\d+\s+/, '').replace(/\s+\d+(?= (right|6 s|nothing))/, '');
    const key = `${fixture} | ${name}${/zoom/.test(name) && zoom && !/zoom (100|Fit)$/.test(name) ? zoom : ''}`;
    if (!groups.has(key)) groups.set(key, { fixture, operation: name, exact: [], stable: [], firstFeedback: [], releaseToExact: [], runs: new Set() });
    const group = groups.get(key);
    group.runs.add(path.basename(file));
    group.stable.push(operation.totalMs);
    group.exact.push(operation.observation?.releaseToExactMs);
    if (operation.drag) {
      group.firstFeedback.push(operation.drag.inputToFirstFrameMs);
      group.releaseToExact.push(operation.drag.releaseToExactMs);
    }
  }
}

const rows = [...groups.entries()].map(([key, group]) => ({
  key,
  fixture: group.fixture,
  operation: group.operation,
  runs: group.runs.size,
  actionToExactMs: stats(group.exact),
  actionToStableMs: stats(group.stable),
  dragFirstFeedbackMs: stats(group.firstFeedback),
  dragReleaseToExactMs: stats(group.releaseToExact),
}));

const show = (value) => (value ? `n=${value.n} median ${value.median} p95 ${value.p95} max ${value.max}` : '-');
for (const row of rows) {
  console.log(`${row.key}\n    exact: ${show(row.actionToExactMs)} | stable: ${show(row.actionToStableMs)}`
    + (row.dragFirstFeedbackMs ? `\n    drag first feedback: ${show(row.dragFirstFeedbackMs)} | release to exact: ${show(row.dragReleaseToExactMs)}` : ''));
}
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    unit: 'milliseconds',
    targets: {
      'zoom to 100% or 200%, any time': 300, 'brush stroke or feather release': 100,
      'slider: first feedback': 'one frame', 'slider: settled after release': 100, match: 2000,
      'first 30 seconds: any single wait after import': 1000,
    },
    files: files.map((file) => path.basename(file)),
    rows,
  }, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}
