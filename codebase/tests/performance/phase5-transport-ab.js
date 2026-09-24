// Phase 5 item 4: measure the candidate pixel transports for one above-budget
// native frame on the same session. Each candidate starts from a cleared
// renderer and a Fit frame, zooms to 100% under Precise (exact native first),
// and records the source-transport stage plus the backend mip counters.
//
//   strips  - per-strip source-tile requests through the staging ring
//   stream  - one chunked /proxy-stream response through the staging ring
//   single  - one prebuilt /proxy response through the staging ring

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { ensureLargeNoisySource } = require('../large-noisy-tiff.js');

const output = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : path.join(__dirname, '../../output/performance/phase5-transport-ab.json');
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 7968);
const height = Number(process.argv.includes('--height') ? process.argv[process.argv.indexOf('--height') + 1] : 5320);
const repeats = Number(process.argv.includes('--repeats') ? process.argv[process.argv.indexOf('--repeats') + 1] : 3);
const modes = ['strips', 'stream', 'single'];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799', { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('#file-input', ensureLargeNoisySource(width, height));
    await page.waitForFunction(() => state.session?.session_id && viewerState().status === 'ready', null,
      { timeout: 600000 });
    await page.waitForFunction(() => !state.gpuDraftInFlight && state.gpuPreview?.available, null,
      { timeout: 600000 });
    await page.evaluate(() => {
      const control = document.querySelector('#preview-latency');
      control.value = 'precise';
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    const runs = Object.fromEntries(modes.map((mode) => [mode, []]));
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (const mode of modes) {
        const run = await page.evaluate(async (transport) => {
          const api = window.HDRFinisherPerformance;
          const sessionId = state.session.session_id;
          api.setSourceTransport(transport);
          // A parked Fit frame is the retained state every candidate starts
          // from; then the renderer cache is cleared so the native arrival is
          // a real fetch, not a warm texture hit.
          setZoomMode('fit');
          await new Promise((resolve) => {
            const timer = setInterval(() => {
              if (viewerState().status === 'ready' && !state.gpuDraftInFlight) {
                clearInterval(timer);
                resolve();
              }
            }, 10);
          });
          state.gpuPreview.resetSession(sessionId);
          await new Promise((resolve) => setTimeout(resolve, 100));
          const before = await (await fetch(`/api/session/${sessionId}/diagnostics`)).json();
          const started = window.performance.now();
          setCustomZoom(100);
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 600000;
            const timer = setInterval(() => {
              if (viewerState().status === 'ready'
                && state.acceptedPresentation?.processedLongEdge === requiredProcessingLongEdge()) {
                clearInterval(timer);
                resolve();
              } else if (Date.now() > deadline) {
                clearInterval(timer);
                reject(new Error(`${transport}: native exact never arrived`));
              }
            }, 10);
          });
          const elapsedMs = window.performance.now() - started;
          const gpu = api.gpuSnapshot();
          const after = await (await fetch(`/api/session/${sessionId}/diagnostics`)).json();
          return {
            transport,
            elapsedMs,
            sourceTransport: gpu?.resources?.sourceTransport || null,
            sourceRoute: api.tiledExecutionMetrics()?.sourceRoute || null,
            accepted: state.acceptedPresentation
              ? { edge: state.acceptedPresentation.processedLongEdge,
                execution: state.acceptedPresentation.execution,
                transport: state.acceptedPresentation.transport }
              : null,
            stages: (gpu?.stages || []).filter((stage) => String(stage.kind || stage.name || '')
              .includes('proxy-request')).slice(-4),
            cacheBefore: before.render_cache.source_mip,
            cacheAfter: after.render_cache.source_mip,
          };
        }, mode);
        runs[mode].push(run);
        const metrics = run.sourceTransport || {};
        console.log(`${run.transport} run ${repeat + 1}: ${Math.round(run.elapsedMs)}ms total, `
          + `transport ${Math.round(metrics.totalMs || 0)}ms, first row ${Math.round(metrics.timeToFirstTileMs || 0)}ms, `
          + `${metrics.chunkCount || 0} chunks, ${Math.round((metrics.transferredBytes || 0) / 1e6)} MB`);
        assert.equal(run.accepted?.edge, Math.max(width, height), `${mode}: native edge was not reached`);
        assert.equal(metrics.route, mode === 'strips' ? 'tiled' : 'streamed',
          `${mode}: unexpected transport route ${metrics.route}`);
      }
    }

    const summary = {};
    for (const mode of modes) {
      summary[mode] = {
        runs: runs[mode].length,
        wallMs: runs[mode].map((run) => Math.round(run.elapsedMs)),
        transportMs: runs[mode].map((run) => Math.round(run.sourceTransport?.totalMs || 0)),
        firstRowMs: runs[mode].map((run) => Math.round(run.sourceTransport?.timeToFirstTileMs || 0)),
        transferredBytes: runs[mode][0].sourceTransport?.transferredBytes || 0,
        medianWallMs: Math.round(median(runs[mode].map((run) => run.elapsedMs))),
        medianTransportMs: Math.round(median(runs[mode].map((run) => run.sourceTransport?.totalMs || 0))),
        medianFirstRowMs: Math.round(median(runs[mode].map((run) => run.sourceTransport?.timeToFirstTileMs || 0))),
      };
    }
    console.log(JSON.stringify(summary, null, 2));

    const stripsMedian = summary.strips.medianTransportMs;
    const best = modes
      .filter((mode) => mode !== 'strips')
      .sort((a, b) => summary[a].medianTransportMs - summary[b].medianTransportMs)[0];
    const improvement = 1 - summary[best].medianTransportMs / stripsMedian;
    console.log(`selection candidate: ${best} at ${(improvement * 100).toFixed(1)}% transport-stage reduction`);

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({
      fixture: `${width}x${height} deterministic noisy TIFF`,
      preference: 'precise',
      repeats,
      summary,
      runs,
    }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
