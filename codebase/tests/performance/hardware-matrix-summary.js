// Phase 5 item 7: merge the captured per-machine rows into a markdown table.
// Nothing is inferred: a machine that has not been captured is simply absent,
// and a capture that failed prints its recorded error instead of a status.

const fs = require('node:fs');
const path = require('node:path');

const directory = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : path.join(__dirname, '../../output/performance/hardware');

const files = fs.existsSync(directory)
  ? fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort()
  : [];

const columns = [
  'machine', 'class', 'webgpu', 'adapter', 'software', 'auto budget', 'calibration', 'native-100 exact',
  'warm-50 exact', 'peak drift', 'cpu fallback', 'status',
];

function row(record) {
  const steps = record.steps || [];
  const native = steps.find((step) => step.step === 'native-100');
  const warm = steps.find((step) => step.step === 'warm-50');
  const worstDrift = steps.reduce((max, step) => (step.drift === null ? max : Math.max(max, step.drift)), 0);
  const adapter = steps[0]?.adapter || null;
  const calibration = steps[0]?.calibration || null;
  return {
    machine: record.machine,
    class: record.class,
    webgpu: record.webgpuAvailable === true ? 'yes' : record.webgpuAvailable === false ? 'no' : 'unknown',
    adapter: adapter ? [adapter.vendor, adapter.architecture, adapter.device].filter(Boolean).join(' / ') : 'not measured',
    software: adapter ? (adapter.fallback ? 'yes' : 'no') : 'not measured',
    autoBudget: calibration?.budgetBytes ? `${(calibration.budgetBytes / (1024 ** 3)).toFixed(2)} GiB` : 'not measured',
    calibration: calibration?.source || 'not measured',
    nativeExact: native?.exactMs === undefined ? 'not measured' : `${Math.round(native.exactMs)} ms`,
    warmExact: warm?.exactMs === undefined ? 'not measured' : `${Math.round(warm.exactMs)} ms`,
    drift: steps.length ? `${(worstDrift * 100).toFixed(1)}%` : 'not measured',
    cpuFallback: record.checks?.cpuFallback
      ? `${record.checks.cpuFallback.transport} (${record.checks.cpuFallback.previewRawResponses} raw)`
      : (record.steps?.length ? 'not exercised' : 'not measured'),
    status: record.status + (record.error ? `: ${record.error}` : ''),
  };
}

const rows = files.map((name) => {
  const record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  return row(record);
});

function escape(value) {
  return String(value ?? 'not measured').replace(/\|/g, '\\|');
}

console.log('| ' + columns.join(' | ') + ' |');
console.log('| ' + columns.map(() => '---').join(' | ') + ' |');
for (const entry of rows) {
  console.log('| ' + [entry.machine, entry.class, entry.webgpu, entry.adapter, entry.software,
    entry.autoBudget, entry.calibration, entry.nativeExact, entry.warmExact, entry.drift,
    entry.cpuFallback, entry.status].map(escape).join(' | ') + ' |');
}
if (!rows.length) {
  console.log('| not captured yet | not reported | not measured | not measured | not measured | '
    + 'not measured | not measured | not measured | not measured | not measured | not measured | untested |');
}
