const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { ensureLargeNoisySource } = require('../large-noisy-tiff.js');

const output = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : path.join(__dirname, '../../output/performance/phase4-regression-browser.json');
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 4200);
const height = Number(process.argv.includes('--height') ? process.argv[process.argv.indexOf('--height') + 1] : 2800);
const preferences = process.argv.includes('--preferences')
  ? process.argv[process.argv.indexOf('--preferences') + 1].split(',')
  : ['responsive', 'balanced', 'precise'];

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
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__regressionEvents = [];
      window.__regressionStates = [];
      window.__lastRegressionKey = '';
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      window.__regressionTimer = setInterval(() => {
        const accepted = state.acceptedPresentation;
        const key = `${accepted?.processedLongEdge}:${accepted?.generation}:${accepted?.coarse}:${viewerStatusLabel()}`;
        if (key === window.__lastRegressionKey) return;
        window.__lastRegressionKey = key;
        window.__regressionStates.push({ at: performance.now(), edge: accepted?.processedLongEdge,
          generation: accepted?.generation, coarse: accepted?.coarse, status: viewerStatusLabel() });
      }, 10);
      window.addEventListener('hdrfinisher:preview-presented', (event) => {
        window.__regressionEvents.push({ at: performance.now(), generation: event.detail.generation,
          edge: state.acceptedPresentation?.processedLongEdge, exact: state.acceptedPresentation?.exact,
          coarse: state.acceptedPresentation?.coarse, status: viewerStatusLabel() });
      });
    });
    const steps = [];
    for (const preference of preferences) {
      await page.evaluate((mode) => {
        const control = document.querySelector('#preview-latency');
        control.value = mode;
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }, preference);
      for (const [name, zoom] of [['out-50', 50], ['out-35', 35], ['native-100', 100], ['zoom-200', 200],
        ['fit', null], ['warm-50', 50], ['warm-100', 100]]) {
        const before = await page.evaluate(async () => {
          const id = state.session.session_id;
          return { cache: (await (await fetch(`/api/session/${id}/diagnostics`)).json()).render_cache.source_mip,
            eventCount: window.__regressionEvents.length, stateCount: window.__regressionStates.length };
        });
        const start = Date.now();
        const immediate = await page.evaluate((value) => {
          if (value === null) setZoomMode('fit'); else setCustomZoom(value);
          return { at: performance.now(), required: requiredProcessingLongEdge(), status: viewerStatusLabel(),
            accepted: state.acceptedPresentation?.processedLongEdge,
            decision: interactiveScaleDecision(), graph: previewGraphTimingKey() };
        }, zoom);
        await page.waitForFunction(() => viewerState().status === 'ready'
          && state.acceptedPresentation?.processedLongEdge === requiredProcessingLongEdge(), null,
        { timeout: 600000 });
        const after = await page.evaluate(async ({ eventCount, stateCount }) => {
          const id = state.session.session_id;
          return { at: performance.now(), cache: (await (await fetch(`/api/session/${id}/diagnostics`)).json()).render_cache.source_mip,
            events: window.__regressionEvents.slice(eventCount), accepted: state.acceptedPresentation,
            states: window.__regressionStates.slice(stateCount),
            route: window.HDRFinisherPerformance.tiledExecutionMetrics(),
            gpu: window.HDRFinisherPerformance.gpuSnapshot(), refusals: state.gpuDraftRefusals,
            lastRefusal: state.lastGpuDraftRefusal, fallbacks: state.cpuFallbacks,
            scheduler: window.HDRFinisherPerformance.snapshot() };
        }, before);
        const firstCurrent = after.states.find((entry) => entry.at >= immediate.at
          && entry.edge !== immediate.accepted && entry.generation === after.accepted.generation);
        steps.push({ preference, name, immediate, firstCurrentMs: firstCurrent
          ? Math.round(firstCurrent.at - immediate.at) : null,
          exactMs: Math.round(after.at - immediate.at), wallMs: Date.now() - start,
          events: after.events, states: after.states, cacheBefore: before.cache, cacheAfter: after.cache,
          accepted: { generation: after.accepted.generation, edge: after.accepted.processedLongEdge,
            execution: after.accepted.execution, transport: after.accepted.transport },
          route: after.route?.sourceRoute, stages: after.gpu?.stages?.slice(-20) || [],
          renders: after.gpu?.renders?.slice(-4) || [], refusals: after.refusals,
          lastRefusal: after.lastRefusal, fallbacks: after.fallbacks, scheduler: after.scheduler });
        console.log(`${preference} ${name}: ${steps.at(-1).exactMs}ms, ${steps.at(-1).firstCurrentMs}ms first`);
        if (immediate.required !== immediate.accepted) {
          assert.notEqual(immediate.status.slice(0, 5), 'Ready', `${preference} ${name}: stale scale said Ready`);
        }
        assert.equal(after.accepted.processedLongEdge, immediate.required,
          `${preference} ${name}: exact scale was not reached`);
      }
      // Warm pan at the native zoom the previous step left the viewer in. The
      // pan pass reuses the retained frame and refines only the exposed strip;
      // record how long the retained frame took to repaint, whether it left a
      // painted frame, and whether a pan follow-up dispatched.
      {
        const before = await page.evaluate(() => ({ stateCount: window.__regressionStates.length }));
        const pan = await page.evaluate(async () => {
          const scrollTopBefore = els.dropzone.scrollTop;
          els.dropzone.scrollTop = scrollTopBefore + 400;
          const scrolledAt = performance.now();
          await new Promise((resolve) => setTimeout(resolve, 350));
          const region = await state.gpuPreview?.readPresentationRegion?.(8, 8, 4, 4);
          const values = region?.values || [];
          let luma = 0;
          for (let index = 0; index + 3 < values.length; index += 4) {
            luma += (values[index] + values[index + 1] + values[index + 2]) / 3;
          }
          return { scrollTopBefore, scrollTopAfter: els.dropzone.scrollTop,
            settleMs: performance.now() - scrolledAt,
            centerLuma: luma / Math.max(1, Math.floor(values.length / 4)),
            viewer: viewerState().status, status: viewerStatusLabel(),
            coordinator: window.HDRFinisherPerformance.renderCoordinator() };
        });
        await page.waitForTimeout(600);
        const after = await page.evaluate((stateCount) => ({
          states: window.__regressionStates.slice(stateCount),
          coordinator: window.HDRFinisherPerformance.renderCoordinator(),
          gpu: window.HDRFinisherPerformance.gpuSnapshot(),
        }), before.stateCount);
        steps.push({ preference, name: 'pan', pan, states: after.states,
          coordinator: after.coordinator, stages: after.gpu?.stages?.slice(-12) || [] });
        console.log(`${preference} pan: settle ${Math.round(pan.settleMs)}ms, `
          + `luma ${pan.centerLuma.toFixed(3)}, ${pan.viewer}`);
      }
      for (const [name, selector, value] of [['exposure', '#hdr-exposure',
        preference === 'responsive' ? '0.25' : preference === 'balanced' ? '0.5' : '0.75'],
      ['detail', '#detail-texture', preference === 'responsive' ? '12' : preference === 'balanced' ? '18' : '24']]) {
        const before = await page.evaluate(() => ({ generation: state.previewGeneration.hdr,
          stateCount: window.__regressionStates.length }));
        const immediate = await page.evaluate(({ selector, value }) => {
          const control = document.querySelector(selector);
          control.value = value;
          control.dispatchEvent(new Event('input', { bubbles: true }));
          return { at: performance.now(), status: viewerStatusLabel(), generation: state.previewGeneration.hdr,
            required: requiredProcessingLongEdge() };
        }, { selector, value });
        await page.waitForFunction((oldGeneration) => state.previewGeneration.hdr > oldGeneration
          && viewerState().status === 'ready'
          && state.acceptedPresentation?.generation === state.previewGeneration.hdr, before.generation,
        { timeout: 600000 });
        const after = await page.evaluate((stateCount) => ({ at: performance.now(),
          states: window.__regressionStates.slice(stateCount), accepted: state.acceptedPresentation,
          gpu: window.HDRFinisherPerformance.gpuSnapshot() }), before.stateCount);
        const first = after.states.find((entry) => entry.generation >= immediate.generation
          && entry.generation > before.generation && entry.coarse);
        steps.push({ preference, name, immediate, firstCurrentMs: first
          ? Math.round(first.at - immediate.at) : null, exactMs: Math.round(after.at - immediate.at),
          states: after.states, accepted: { generation: after.accepted.generation,
            edge: after.accepted.processedLongEdge, transport: after.accepted.transport },
          stages: after.gpu?.stages?.slice(-20) || [] });
        console.log(`${preference} ${name}: ${steps.at(-1).exactMs}ms, ${steps.at(-1).firstCurrentMs}ms first`);
      }
    }
    // Evidence is written before the gates: a red gate must still leave the
    // run's data on disk for diagnosis.
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ fixture: `${width}x${height} deterministic noisy TIFF`, steps }, null, 2));
    if (preferences.includes('responsive')) {
      const cold = steps.find((step) => step.preference === 'responsive' && step.name === 'out-50');
      const warm = steps.find((step) => step.preference === 'responsive' && step.name === 'warm-50');
      const coldCoarse = cold?.states?.find((entry) => entry.coarse);
      const warmCoarse = warm?.states?.find((entry) => entry.coarse);
      assert.ok(coldCoarse, 'Responsive zoom never presented coarse pixels');
      // Phase 5 item 1 keeps a lane's source levels until the central budget
      // asks for them back, so a warm 50% can reuse the exact level it built
      // cold and present it without a coarse flash. The invariant is that warm
      // never rebuilds a source level and never invents a different coarse
      // edge; presenting exact immediately is the stronger outcome.
      if (warmCoarse) {
        assert.equal(warmCoarse.edge, coldCoarse.edge, 'Warm zoom changed the reusable coarse source level');
      } else {
        assert.ok(warm.states.every((entry) => !entry.coarse),
          'Warm zoom presented an unrecognised coarse frame');
      }
      assert.equal(warm.cacheAfter.cold_builds - warm.cacheBefore.cold_builds, 0,
        'Warm zoom rebuilt a source mip instead of reusing the cache');
    }
    if (preferences.includes('precise')) {
      assert.ok(steps.filter((step) => step.preference === 'precise')
        .every((entry) => !entry.states?.some((state) => state.coarse)),
      'Precise unexpectedly presented a coarse frame');
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
