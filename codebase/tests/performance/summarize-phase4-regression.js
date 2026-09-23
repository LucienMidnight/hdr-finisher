const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../../output/performance');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const delta = (step, key) => step.cacheAfter?.[key] - step.cacheBefore?.[key] || 0;
const summarize = (step) => ({
  preference: step.preference,
  name: step.name,
  immediateStatus: step.immediate?.status,
  previousEdge: step.immediate?.accepted,
  requiredEdge: step.immediate?.required,
  coarseEdge: step.states?.find((state) => state.coarse)?.edge || null,
  firstCurrentMs: step.firstCurrentMs,
  exactMs: step.exactMs,
  accepted: step.accepted,
  transportRoute: step.route || step.stages?.filter((stage) => stage.stage === 'proxy-request')
    .at(-1)?.route || null,
  sourceMip: {
    coldBuilds: delta(step, 'cold_builds'),
    buildMs: Math.round(delta(step, 'build_ms_total')),
    memoryHits: delta(step, 'memory_hits'),
    diskHits: delta(step, 'disk_hits'),
    memoryEvictions: delta(step, 'memory_evictions'),
    diskEvictions: delta(step, 'disk_evictions'),
  },
  proxyStages: step.stages?.filter((stage) => stage.stage === 'proxy-request')
    .map(({ longEdge, route, durationMs, timeToFirstTileMs, chunkCount, bytes }) =>
      ({ longEdge, route, durationMs, timeToFirstTileMs, chunkCount, bytes })) || [],
});
const current42 = read('phase4-regression-final-42mp.json');
const current4200 = read('phase4-regression-final-4200.json');
const cold42 = read('phase4-regression-42mp-clean.json');
const before = read('phase4-regression-before-browser.json');
const phase3 = read('phase3-manual-baseline-42mp.json');
const phase3Edit = read('phase3-manual-adjustments-4200.json');
const roi = read('phase4-regression-roi-parity.json');
const exportParity = read('phase4-regression-export-parity.json');
const report = {
  fixture: 'deterministic noisy TIFF; Edge/WebGPU; same Windows workstation',
  electron: 'Runner failed before page startup: DevTools WebSocket ECONNRESET',
  phase3Commit: '55455e6',
  phase3: phase3.steps.map(({ name, tier, ms, edge, status }) => ({ name, tier, ms, edge, status })),
  phase3Adjustments: phase3Edit.steps.filter((step) => step.name.includes('exposure'))
    .map(({ name, tier, ms, edge }) => ({ name, tier, ms, edge })),
  before: before.steps.filter((step) => step.preference === 'responsive' && step.name === 'out-50')
    .map(summarize),
  cold42: cold42.steps.filter((step) => step.preference === 'responsive'
    && ['out-50', 'out-35', 'native-100', 'warm-50'].includes(step.name)).map(summarize),
  repaired42: current42.steps.map(summarize),
  repaired4200: current4200.steps.map(summarize),
  roiSpatialSweep: roi.spatialSweep.map((entry) => entry.comparison),
  exportCases: exportParity.scenarios.map((entry) => ({
    name: entry.id,
    exportCorrect: entry.assertions.exportCorrectness.ok,
    peakNits: entry.assertions.exportCorrectness.decodedPeakNits,
  })),
};
fs.writeFileSync(path.join(root, 'phase4-regression-summary.json'), JSON.stringify(report, null, 2) + '\n');
