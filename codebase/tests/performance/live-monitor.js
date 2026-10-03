/** Attach to a running HDR Finisher window started with
 * `electron . --remote-debugging-port=9333` and read what it has been doing.
 * Read-only: it records timings in the page and never edits or saves.
 *
 *   node tests/performance/live-monitor.js install        start recording
 *   node tests/performance/live-monitor.js dump [seconds] summarize the last N seconds (default 60)
 */
const { chromium } = require('playwright');
const [command = 'dump', value] = process.argv.slice(2);
const port = process.env.HDR_FINISHER_DEBUG_PORT || 9333;

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const page = browser.contexts().flatMap(context => context.pages()).find(candidate => /127\.0\.0\.1|localhost/.test(candidate.url()));
    if (!page) throw Error('No application window found');
    await page.evaluate(() => {
      if (window.__monitor) return;
      const monitor = window.__monitor = { requests: [], frames: [], scopes: [], longTasks: [], edits: [], zooms: [], errors: [], installedAt: performance.now() };
      const keep = (list, limit = 4000) => { if (list.length > limit) list.splice(0, list.length - limit); };
      window.HDRFinisherPerformance?.enableGpuInstrumentation(true);
      const original = window.fetch;
      window.fetch = async function (input, init) {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/')) return original.apply(this, arguments);
        const row = { at: performance.now(), path: url.pathname.replace(/[0-9a-f-]{32,}/g, 'ID').replace('/api/session/ID', ''),
          edge: url.searchParams.get('long_edge'), method: init?.method || 'GET' };
        monitor.requests.push(row); keep(monitor.requests);
        try {
          const response = await original.apply(this, arguments);
          row.status = response.status; row.headerMs = performance.now() - row.at;
          return response;
        } catch (error) { row.error = String(error?.name || error); row.headerMs = performance.now() - row.at; throw error; }
      };
      addEventListener('hdrfinisher:preview-presented', event => {
        const accepted = state.acceptedPresentation;
        monitor.frames.push({ at: performance.now(), lane: event.detail?.lane, generation: event.detail?.generation, exact: accepted?.exact,
          execution: accepted?.execution, edge: accepted?.processedLongEdge, transport: accepted?.transport, zoom: state.zoomMode === 'fit' ? 'fit' : state.zoomPercent });
        keep(monitor.frames);
      });
      addEventListener('hdrfinisher:scope-presented', event => { monitor.scopes.push({ at: performance.now(), tier: event.detail?.tier }); keep(monitor.scopes); });
      addEventListener('error', event => monitor.errors.push({ at: performance.now(), message: String(event.message) }));
      addEventListener('unhandledrejection', event => monitor.errors.push({ at: performance.now(), message: String(event.reason?.message || event.reason) }));
      const invalidate = invalidatePreview;
      invalidatePreview = function (...values) { monitor.edits.push({ at: performance.now(), lane: values[0] }); keep(monitor.edits); return invalidate(...values); };
      let zoom = null;
      setInterval(() => {
        const current = `${state.zoomMode}:${state.zoomPercent}:${els.dropzone.scrollLeft}:${els.dropzone.scrollTop}`;
        if (current !== zoom) { monitor.zooms.push({ at: performance.now(), mode: state.zoomMode, percent: state.zoomPercent, x: els.dropzone.scrollLeft, y: els.dropzone.scrollTop }); keep(monitor.zooms, 2000); zoom = current; }
      }, 50);
      try { new PerformanceObserver(list => { for (const entry of list.getEntries()) monitor.longTasks.push({ at: entry.startTime, ms: entry.duration }); keep(monitor.longTasks); }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
    });
    if (command === 'install') { console.log('Recording.'); return; }
    const seconds = Number(value) || 60;
    const data = await page.evaluate(seconds => {
      const monitor = window.__monitor, now = performance.now(), since = now - seconds * 1000;
      const recent = list => list.filter(row => row.at >= since).map(row => ({ ...row, at: Math.round(row.at - now) }));
      const gpu = window.HDRFinisherPerformance.gpuSnapshot();
      const metrics = state.gpuPreview.performanceMetrics || {};
      return { now, recordedSeconds: Math.round((now - monitor.installedAt) / 1000),
        session: { source: state.session?.source && { width: state.session.source.width, height: state.session.source.height, filename: state.session.source.filename },
          lane: state.currentView, zoom: state.zoomMode === 'fit' ? 'fit' : state.zoomPercent, requiredEdge: requiredProcessingLongEdge(),
          geometry: state.adjustments?.shared?.geometry, viewer: viewerState(), accepted: state.acceptedPresentation,
          locals: localAdjustments().map(local => ({ enabled: local.enabled, mask: local.mask?.operator === 'leaf' ? local.mask.leaf.type : local.mask?.operator,
            feather: local.mask?.leaf?.mask_feather, shift: local.mask?.leaf?.mask_shift_edge, strokes: local.mask?.leaf?.strokes?.length })),
          denoise: state.gpuPreview?.diagnosticsSnapshot?.().denoise, refusal: state.lastGpuDraftRefusal,
          cpuFallbacks: { settle: state.cpuFallbacks.settle.slice(-5), refine: state.cpuFallbacks.refine.slice(-5) } },
        requests: recent(monitor.requests), frames: recent(monitor.frames), scopes: recent(monitor.scopes), edits: recent(monitor.edits),
        zooms: recent(monitor.zooms), errors: recent(monitor.errors), longTasks: monitor.longTasks.filter(row => row.at >= since).map(row => ({ at: Math.round(row.at - now), ms: Math.round(row.ms) })),
        maskEvents: (metrics.maskEvents || []).slice(-400), stages: (metrics.stages || []).filter(row => row.at >= since).map(row => ({ stage: row.stage, at: Math.round(row.at - now), ms: Math.round(row.durationMs || 0), edge: row.longEdge, route: row.route, cacheHit: row.cacheHit })),
        renders: (gpu.renders || []).slice(-12), allocator: gpu.resources?.memory?.allocator };
    }, seconds);
    const fs = require('fs'), path = require('path');
    const file = path.resolve('output/performance/review/live-monitor', `dump-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2));
    const s = data.session;
    console.log(`Recorded ${data.recordedSeconds}s; last ${seconds}s. ${s.source?.filename} ${s.source?.width}x${s.source?.height}, lane ${s.lane}, zoom ${s.zoom}, edge ${s.requiredEdge}, viewer ${s.viewer?.status}`);
    console.log(`Geometry ${JSON.stringify(s.geometry)}`);
    console.log(`Locals ${JSON.stringify(s.locals)}`);
    console.log(`Denoise ${JSON.stringify({ selected: s.denoise?.selectedSource, ready: s.denoise?.cacheReady, controls: s.denoise?.controls })}`);
    console.log(`Accepted ${JSON.stringify({ exact: s.accepted?.exact, execution: s.accepted?.execution, edge: s.accepted?.processedLongEdge, transport: s.accepted?.transport, fallback: s.accepted?.fallbackReason })} refusal ${JSON.stringify(s.refusal)} fallbacks ${JSON.stringify(s.cpuFallbacks)}`);
    const groups = {};
    for (const row of data.requests) { const key = `${row.method} ${row.path}${row.edge ? ' @' + row.edge : ''}`; const entry = groups[key] ||= { count: 0, ms: 0, max: 0, errors: 0 }; entry.count++; entry.ms += row.headerMs || 0; entry.max = Math.max(entry.max, row.headerMs || 0); if (row.error || row.status >= 400) entry.errors++; }
    console.log('Requests:');
    for (const [key, entry] of Object.entries(groups).sort((a, b) => b[1].ms - a[1].ms).slice(0, 25)) console.log(`  ${key.padEnd(52)} n ${String(entry.count).padStart(4)}  total ${String(Math.round(entry.ms)).padStart(6)} ms  max ${String(Math.round(entry.max)).padStart(5)}  errors ${entry.errors}`);
    const kinds = {};
    for (const event of data.maskEvents) { const entry = kinds[`${event.kind}@${event.longEdge}`] ||= { count: 0, ms: 0, cpu: 0 }; entry.count++; entry.ms += event.gpuPrepareMs || event.requestMs || event.encodeSubmitMs || 0; if (event.cpuMaskRequest !== false) entry.cpu++; }
    console.log(`Mask events (last 400): ${Object.entries(kinds).map(([key, entry]) => `${key} x${entry.count} ${Math.round(entry.ms)}ms${entry.cpu ? ' CPU' : ''}`).join(' | ')}`);
    console.log(`Timeline (seconds before now): edits ${data.edits.length}, frames ${data.frames.length}, zoom/pan changes ${data.zooms.length}, long tasks ${data.longTasks.length} (max ${Math.max(0, ...data.longTasks.map(row => row.ms))} ms), errors ${data.errors.length}`);
    // Each zoom or pan change, and how long until the next exact frame.
    const moves = data.zooms.filter((row, index, list) => !index || row.at - list[index - 1].at > 300);
    for (const move of moves.slice(-25)) {
      const frame = data.frames.find(row => row.at >= move.at && row.exact);
      console.log(`  ${String((move.at / 1000).toFixed(1)).padStart(7)}s  ${move.mode === 'fit' ? 'fit' : move.percent + '%'} @${move.x},${move.y}  -> exact frame after ${frame ? frame.at - move.at : '—'} ms (${frame?.execution || ''} ${frame?.edge || ''})`);
    }
    for (const error of data.errors.slice(-5)) console.log(`  error ${error.at}: ${error.message}`);
    console.log(`Allocator ${JSON.stringify({ usedMiB: Math.round((data.allocator?.usedBytes || 0) / 1048576), budgetMiB: Math.round((data.allocator?.budgetBytes || 0) / 1048576), evictions: data.allocator?.evictions })}`);
    console.log(`Saved ${file}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(String(error.stack || error)); process.exitCode = 1; });
