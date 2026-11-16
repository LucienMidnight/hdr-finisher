/** Opt-in action-to-presentation diagnostic. Only opens the reusable test copy;
 * never saves it. --part baseline|ablate|profile, --input, --grade, --output. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');
const opt = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const input = path.resolve(opt('--input', 'output/test-photos/DSC01287.ARW'));
const grade = path.resolve(opt('--grade', input + '.hdrf'));
const output = path.resolve(opt('--output', 'output/performance/stacked-raw/before.json'));
const part = opt('--part', 'baseline');
const revision = opt('--revision', null);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  input, grade, hashes: [sha(input), sha(grade)], part, rows: [], errors: [] };
const processSnapshot = () => process.platform === 'win32' ? null : execFileSync('ps', ['-axo', 'pid,ppid,%cpu,rss,comm'], { encoding: 'utf8' });
report.processesStart = processSnapshot();

(async () => {
  if (!input.startsWith(path.resolve('output/test-photos') + path.sep)) throw Error('Use the shared test copy');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  if (revision) {
    report.revision = execFileSync('git', ['rev-parse', revision], { encoding: 'utf8' }).trim();
    report.assets = [];
    for (const file of ['preview-pipeline.js', 'webgpu-preview.js', 'webgpu-shaders.js']) {
      const body = execFileSync('git', ['show', `${report.revision}:codebase/frontend/${file}`], { maxBuffer: 4 * 1024 * 1024 });
      const asset = { file, sha256: crypto.createHash('sha256').update(body).digest('hex'), requests: 0 };
      report.assets.push(asset);
      await page.route(url => url.pathname.endsWith('/' + file), route => {
        asset.requests++;
        return route.fulfill({ body, contentType: 'application/javascript' });
      });
    }
  }
  const scopeRevision = opt('--scope-revision', null);
  if (scopeRevision) {
    report.scopeRevision = execFileSync('git', ['rev-parse', scopeRevision], { encoding: 'utf8' }).trim();
    const body = execFileSync('git', ['show', `${report.scopeRevision}:codebase/frontend/scope-analysis.js`], { maxBuffer: 1024 * 1024 });
    await page.route(url => url.pathname.endsWith('/scope-analysis.js'), route => route.fulfill({ body, contentType: 'application/javascript' }));
  }
  if (part === 'stages') await page.addInitScript(require('./gpu-pass-probe.cjs').installGpuPassProbe);
  const network = c.networkProbe(page);
  const memory = c.sampler();
  const systemRows = [], systemErrors = [];
  let systemBuffer = '';
  const systemSampler = require('node:child_process').spawn(require('../../tools/lib/platform.cjs').pythonExecutable(),
    [path.resolve('tools/measure-library-processes.py'), process.env.HDR_FINISHER_ELECTRON_MAIN_PID, '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  systemSampler.stdout.on('data', chunk => {
    systemBuffer += chunk;
    let newline;
    while ((newline = systemBuffer.indexOf('\n')) >= 0) {
      const line = systemBuffer.slice(0, newline); systemBuffer = systemBuffer.slice(newline + 1);
      try { systemRows.push(JSON.parse(line)); } catch { systemErrors.push(line); }
    }
  });
  systemSampler.stderr.on('data', chunk => systemErrors.push(String(chunk)));
  systemSampler.on('error', error => systemErrors.push(String(error)));
  const save = () => c.write(output, report);
  const settle = async (attempt = 0) => {
    await page.waitForTimeout(150);
    await page.waitForFunction(() => {
      const a = state.acceptedPresentation;
      return a?.exact && a.lane === state.currentView && a.generation === state.previewGeneration[state.currentView]
        && a.processedLongEdge === refinementProxyLongEdge() && viewerState().status === 'ready'
        && !state.gpuDraftInFlight && !state.globalEditSyncPending && !pendingHighlightAnchors.size && !exactHighlightAnchorInflight.size
        && !state.previewScheduler?.frameInFlight && !state.previewScheduler?.framePending && state.previewScheduler?.frame == null
        && !state.zoomRefinementTimer && !state.renderCoordinator?.state(state.currentView)?.panTimerPending
        && !state.renderCoordinator?.state(state.currentView)?.inFlight && !state.renderCoordinator?.state(state.currentView)?.pending;
    }, null, { timeout: 60000 });
    await page.evaluate(async () => { await state.gpuPreview.device.queue.onSubmittedWorkDone(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
    if (!await page.evaluate(() => state.acceptedPresentation?.exact && state.acceptedPresentation.generation === state.previewGeneration[state.currentView]
      && !state.gpuDraftInFlight && !state.previewScheduler?.frameInFlight && !pendingHighlightAnchors.size && !exactHighlightAnchorInflight.size)) {
      if (attempt >= 4) throw Error('The GPU fence was followed by another unsettled frame');
      return settle(attempt + 1);
    }
  };
  async function step(name, action) {
    const wallStartedAt = Date.now();
    const mark = await page.evaluate(() => ({ at: performance.now(), n: __lag.frames.length, s: state.gpuPreview.performanceMetrics.stages.length }));
    const n = network.length;
    let failure;
    try { await action(); await settle(); } catch (e) { failure = e.message; }
    const row = await page.evaluate(({ mark, name, failure }) => ({ name, failure, startedAt: mark.at, elapsedMs: performance.now() - mark.at,
      frames: __lag.frames.slice(mark.n).map(f => ({ ...f, ms: f.presentedAt - mark.at })),
      stages: state.gpuPreview.performanceMetrics.stages.filter(s => s.at >= mark.at),
      gpu: state.gpuPreview.diagnosticsSnapshot(), accepted: state.acceptedPresentation,
      viewer: viewerState(), scheduler: state.previewScheduler.metrics,
      requiredEdge: refinementProxyLongEdge(), zoom: state.zoomPercent, resolution: state.previewResolution,
      refusal: state.lastGpuDraftRefusal, releaseMs: __lag.releaseAt >= mark.at ? __lag.releaseAt - mark.at : null,
      inputs: __lag.inputs.filter(i => i.at >= mark.at).map(i => ({ ...i, ms: i.at - mark.at })),
    }), { mark, name, failure });
    row.requests = network.slice(n);
    row.wallStartedAt = wallStartedAt;
    report.rows.push(row); save();
    console.log(JSON.stringify({ name, failure, elapsedMs: row.elapsedMs, releaseMs: row.releaseMs,
      frames: row.frames.map(f => ({ ms: Math.round(f.ms), edge: f.longEdge, exact: f.accepted?.exact, execution: f.execution })),
      renders: row.gpu.renders?.slice(-3), accepted: row.accepted }));
    if (failure) throw Error(`${name}: ${failure}`);
  }
  page.on('pageerror', e => report.errors.push(e.message));
  try {
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => state.gpuPreview?.available, null, { timeout: 30000 });
    if (process.argv.includes('--before-zoom')) {
      // Controlled baseline: restore only the former scheduling methods in
      // this disposable renderer. Source, shaders, grade and budgets stay equal.
      const ref = 'ad829254';
      const old = file => execFileSync('git', ['show', `${ref}:codebase/frontend/${file}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      const zoom = old('zoom-navigation.js');
      const fn = zoom.slice(zoom.indexOf('function scheduleZoomRefinement('), zoom.indexOf('\nfunction shouldKeepHdrGpuSurface('));
      const session = await page.context().newCDPSession(page);
      const expression = `(() => { const current = HDRWebGPUPreview; ${old('webgpu-preview.js')}\nObject.getPrototypeOf(state.gpuPreview).encodeTiledGeneration = HDRWebGPUPreview.prototype.encodeTiledGeneration; window.HDRWebGPUPreview = current;
        const coordinator = HDRRenderCoordinator; ${old('render-coordinator.js')}\nfor (const name of ['notePan','armCatchUp']) Object.getPrototypeOf(state.renderCoordinator)[name] = HDRRenderCoordinator.prototype[name]; window.HDRRenderCoordinator = coordinator;
        scheduleZoomRefinement = ${fn}; })()`;
      const result = await session.send('Runtime.evaluate', { expression, allowUnsafeEvalBlockedByCSP: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      await session.detach(); report.beforeZoomRevision = ref;
    }
    await page.evaluate(() => {
      state.appPreferences.gradeAutosave = false;
      state.gpuPreview.setInstrumentationEnabled(true);
      window.__lag = { frames: [], inputs: [], releaseAt: 0 };
      const queue = state.gpuPreview.device.queue;
      const submit = queue.submit.bind(queue);
      queue.submit = commands => {
        submit(commands);
        if (__lag.encodingCatchup) __lag.catchupSubmittedAt = performance.now();
      };
      const encode = state.gpuPreview.encodeTiledGeneration;
      state.gpuPreview.encodeTiledGeneration = async function (...args) {
        const catchup = args.at(-1)?.roiCatchUp;
        if (catchup) __lag.encodingCatchup = true;
        try { return await encode.apply(this, args); }
        finally { if (catchup) __lag.encodingCatchup = false; }
      };
      addEventListener('hdrfinisher:preview-presented', e => {
        const row = { ...e.detail, accepted: structuredClone(state.acceptedPresentation) };
        __lag.frames.push(row);
        void state.gpuPreview.device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(() => {
          row.completedAt = performance.now(); row.currentAtCompletion = state.acceptedPresentation?.sourceSerial === row.sourceSerial;
        }));
      });
      document.addEventListener('input', e => __lag.inputs.push({ at: performance.now(), id: e.target.id, value: e.target.value }), true);
    });
    await step('open', () => page.evaluate(async input => {
      await openDesktopSelection({ kind: 'source', ...await desktop.grantSourcePath(input) });
      activateWorkflowTab('grade');
    }, input));
    report.conditions = await page.evaluate(() => ({ window: [innerWidth, innerHeight], dpr: devicePixelRatio,
      source: state.session.source, adjustments: state.adjustments, gpu: state.gpuPreview.detail,
      preferences: state.appPreferences, methods: Object.getOwnPropertyNames(Object.getPrototypeOf(state.gpuPreview)) }));
    const saved = JSON.parse(fs.readFileSync(grade, 'utf8')).grade.global_adjustments;
    if (JSON.stringify(report.conditions.adjustments.hdr.film_look) !== JSON.stringify(saved.hdr.film_look)) throw Error('Saved Film grade did not load unchanged');
    if (revision && report.assets.some(asset => !asset.requests)) throw Error('Revision asset was not intercepted');
    if (part === 'cadence') {
      await c.reveal(page, '#hdr-exposure'); await settle();
      for (let repeat = 0; repeat < 3; repeat++) await step(`display-paced Fit drag ${repeat}`, async () => {
        const bounds = await page.locator('#hdr-exposure').boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
        await page.evaluate(async () => {
          const control = document.querySelector('#hdr-exposure');
          const initial = Number(control.value), startedAt = performance.now();
          let index = 0;
          while (performance.now() - startedAt < 1500) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            control.value = String(initial + (index++ % 10) * 0.02);
            control.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        await page.mouse.up();
        await page.evaluate(() => { __lag.releaseAt = performance.now(); });
      });
    } else if (part === 'stages') {
      await c.reveal(page, '#hdr-exposure'); await settle();
      const session = await page.context().newCDPSession(page);
      await session.send('Profiler.enable'); await session.send('Profiler.start');
      await page.evaluate(() => {
        window.__stageCpu = [];
        state.gpuPreview.createGpuTimingResources = () => null;
        const build = buildGpuScopePayload;
        buildGpuScopePayload = function (...args) {
          const at = performance.now();
          window.__lastScopeAnalysis = { analysis: args[0], options: { ...args[1],
            channelMode: state.scopeChannelMode, referenceWhite: projectReferenceWhiteNits() } };
          try { return build.apply(this, args); }
          finally { __stageCpu.push({ stage: 'histogram-analysis', at, durationMs: performance.now() - at }); }
        };
        const draw = drawHistogram;
        drawHistogram = function (...args) {
          const at = performance.now();
          try { return draw.apply(this, args); }
          finally { __stageCpu.push({ stage: 'histogram-drawing', at, durationMs: performance.now() - at }); }
        };
        __gpuPassProbe.start();
      });
      await step('profile Fit drag', async () => {
        const bounds = await page.locator('#hdr-exposure').boundingBox();
        await page.keyboard.down('Control');
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
        for (let index = 1; index <= 20; index++) {
          await page.mouse.move(bounds.x + bounds.width / 2 + index * 1.5, bounds.y + bounds.height / 2);
          await page.waitForTimeout(25);
        }
        await page.mouse.up(); await page.keyboard.up('Control');
        await page.evaluate(() => { __lag.releaseAt = performance.now(); });
      });
      for (const zoom of [100, 50, 'fit']) await step(`profile zoom ${zoom}`, () => page.evaluate(zoom => zoom === 'fit' ? setZoomMode('fit') : setCustomZoom(zoom), zoom));
      report.cpuProfile = (await session.send('Profiler.stop')).profile;
      if (process.argv.includes('--scope-benchmark')) {
        const before = execFileSync('git', ['show', '4e84549e:codebase/frontend/scope-analysis.js'], { encoding: 'utf8' });
        const after = fs.readFileSync(path.resolve('frontend/scope-analysis.js'), 'utf8');
        const expression = `(() => {
          const saved = window.HDRScopeAnalysis;
          ${before}
          const beforeAnalysis = window.HDRScopeAnalysis;
          ${after}
          const afterAnalysis = window.HDRScopeAnalysis;
          window.HDRScopeAnalysis = saved;
          const {analysis, options} = __lastScopeAnalysis;
          const run = implementation => implementation.buildGpuScopePayload(analysis, options);
          if (JSON.stringify(run(beforeAnalysis)) !== JSON.stringify(run(afterAnalysis))) throw Error('Scope payload changed');
          for (let warm = 0; warm < 3; warm++) { run(beforeAnalysis); run(afterAnalysis); }
          const timings = {before: [], after: []};
          for (let repeat = 0; repeat < 9; repeat++) {
            for (const key of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
              const started = performance.now();
              run(key === 'before' ? beforeAnalysis : afterAnalysis);
              run(key === 'before' ? beforeAnalysis : afterAnalysis);
              timings[key].push((performance.now() - started) / 2);
            }
          }
          return {width: analysis.width, height: analysis.height, options, payloadEqual: true, timings};
        })()`;
        const benchmark = await session.send('Runtime.evaluate', { expression, allowUnsafeEvalBlockedByCSP: true, returnByValue: true });
        if (benchmark.exceptionDetails) throw Error(JSON.stringify(benchmark.exceptionDetails));
        report.scopeBenchmark = benchmark.result.value;
      }
      await session.detach();
      const probe = await page.evaluate(async () => {
        await __gpuPassProbe.stop();
        return { rows: __gpuPassProbe.rows, errors: __gpuPassProbe.errors, cpu: __stageCpu };
      });
      report.passTimings = probe.rows; report.passTimingErrors = probe.errors; report.cpuStages = probe.cpu;
      if (!probe.rows.length || probe.errors.length) throw Error('Named GPU pass timing was unavailable or failed');
      if (!probe.rows.length || probe.errors.length) throw Error(`GPU pass timestamps unavailable: ${JSON.stringify(probe.errors)}`);
    } else if (part === 'race') {
      for (let repeat = 0; repeat < 3; repeat++) {
        await page.evaluate(() => setZoomMode('fit')); await settle();
        await page.evaluate(() => { __lag.catchupSubmittedAt = 0; setCustomZoom(50); });
        await page.waitForFunction(() => state.renderCoordinator?.inFlight(state.currentView)?.request.roiCatchUp
          && __lag.catchupSubmittedAt > 0 && performance.now() - __lag.catchupSubmittedAt > 20, null, { timeout: 30000, polling: 5 });
        await step(`zoom during catch-up ${repeat}`, () => page.evaluate(() => setCustomZoom(100)));
        const clip = await page.evaluate(() => {
          const b = els.dropzone.getBoundingClientRect();
          return { x: Math.round(b.x + b.width / 2 - 160), y: Math.round(b.y + b.height / 2 - 100), width: 320, height: 200 };
        });
        const png = output.replace(/\.json$/, `-${repeat}.png`);
        await page.screenshot({ path: png, clip });
        report.rows.at(-1).screenshot = { path: png, sha256: sha(png) }; save();
      }
    } else if (part === 'probe' || part === 'tiers') {
      const original = report.conditions.adjustments;
      for (const variant of part === 'tiers' ? [] : ['saved', 'grain-off', 'halation-off', 'detail-off']) {
        await page.evaluate(async ({ original, variant }) => {
          await queueEditCommand('set_global_adjustments', { adjustments: structuredClone(original) });
          if (variant !== 'saved') commitAdjustmentValue(variant === 'grain-off' ? 'hdr.film_look.grain_enabled'
            : variant === 'halation-off' ? 'hdr.film_look.halation_enabled' : 'hdr.detail_section_enabled', false, { manual: true });
          setZoomMode('fit');
        }, { original, variant }); await settle();
        for (let i = 0; i < 3; i++) await step(`${variant} Fit exposure ${i}`, () => page.evaluate(i => commitAdjustmentValue('hdr.exposure', i % 2 ? -.1 : .1, { manual: true }), i));
        for (const z of [50, 100, 'fit']) await step(`${variant} zoom ${z}`, () => page.evaluate(z => z === 'fit' ? setZoomMode('fit') : setCustomZoom(z), z));
      }
      for (const edge of ['1024', '2048', '4096']) {
        await page.evaluate(async ({ original, edge }) => { setZoomMode('fit'); await queueEditCommand('set_global_adjustments', { adjustments: structuredClone(original) }); applyPreviewResolution(edge); }, { original, edge });
        await settle();
        for (let i = 0; i < 3; i++) await step(`${edge} exposure ${i}`, () => page.evaluate(i => commitAdjustmentValue('hdr.exposure', i % 2 ? -.1 : .1, { manual: true }), i));
      }
    } else if (part === 'raw') {
      for (const change of ['lens', 'reconstruction', 'restore']) {
        await step(`RAW ${change}`, () => page.evaluate(async change => {
          els.lensMode.value = change === 'lens' ? 'off' : 'auto';
          renderRawHighlightState({ enabled: change !== 'reconstruction' });
          await applyRawImportSettings();
        }, change));
        for (let i = 0; i < 3; i++) await step(`${change} exposure ${i}`, () => page.evaluate(i => commitAdjustmentValue('hdr.exposure', i % 2 ? -.1 : .1, { manual: true }), i));
      }
    } else if (part === 'profile') {
      const session = await page.context().newCDPSession(page);
      await session.send('Profiler.enable'); await session.send('Profiler.start');
      await step('profile-exposure', () => page.evaluate(() => commitAdjustmentValue('hdr.exposure', 0.1, { manual: true })));
      await step('profile-zoom', () => page.evaluate(() => setCustomZoom(100)));
      report.cpuProfile = (await session.send('Profiler.stop')).profile;
      await session.detach();
    } else if (part === 'baseline' || part === 'zoom' || part === 'comparison') {
      if (part === 'baseline' || part === 'comparison') {
      for (const selector of ['#hdr-exposure', '#hdr-whites']) {
        await c.reveal(page, selector); await settle();
        for (let repeat = 0; repeat < 3; repeat++) await step(`drag ${selector} ${repeat}`, async () => {
          const b = await page.locator(selector).boundingBox();
          await page.keyboard.down('Control');
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
          for (let i = 1; i <= 20; i++) { await page.mouse.move(b.x + b.width / 2 + (repeat % 2 ? -1 : 1) * i * 1.5, b.y + b.height / 2); await page.waitForTimeout(25); }
          await page.mouse.up(); await page.keyboard.up('Control');
          await page.evaluate(() => { __lag.releaseAt = performance.now(); });
        });
      }
      }
      for (const z of [50, 100, 50, 'fit', 100, 'fit']) {
        await step(`zoom ${z}`, () => page.evaluate(z => z === 'fit' ? setZoomMode('fit') : setCustomZoom(z), z));
        if (z !== 'fit' && part !== 'comparison') for (let pan = 0; pan < 2; pan++) await step(`pan ${z} ${pan}`, () => page.evaluate(pan => {
          els.dropzone.scrollLeft += (pan ? -1 : 1) * 240; els.dropzone.scrollTop += (pan ? -1 : 1) * 160;
          els.dropzone.dispatchEvent(new Event('scroll'));
        }, pan));
      }
      if (part !== 'comparison') for (const lane of ['sdr', 'hdr', 'sdr', 'hdr', 'sdr', 'hdr']) await step(`switch ${lane}`, () => page.evaluate(lane => switchLane(lane), lane));
    } else if (part === 'ablate') {
      const original = report.conditions.adjustments;
      const variants = { all: {}, grain: { 'hdr.film_look.grain_enabled': false }, halation: { 'hdr.film_look.halation_enabled': false },
        stock: { 'hdr.film_look.film_stock': 'none' }, detail: { 'hdr.detail_section_enabled': false },
        highlight: { 'hdr.highlight_section_enabled': false } };
      for (const edge of ['auto', '1024', '2048']) {
        await page.evaluate(edge => applyPreviewResolution(edge), edge); await settle();
        for (const [name, edits] of Object.entries(variants)) {
          await page.evaluate(async ({ original, edits }) => {
            await queueEditCommand('set_global_adjustments', { adjustments: structuredClone(original) });
            for (const [key, value] of Object.entries(edits)) commitAdjustmentValue(key, value, { manual: true });
          }, { original, edits }); await settle();
          for (let i = 0; i < 3; i++) await step(`${edge} without ${name} ${i}`, () => page.evaluate(i => commitAdjustmentValue('hdr.exposure', i % 2 ? -.1 : .1, { manual: true }), i));
        }
      }
    }
  } catch (error) { report.failure = String(error.stack || error); console.error(report.failure); process.exitCode = 1; }
  finally {
    report.system = systemRows; report.systemErrors = systemErrors; systemSampler.kill();
    report.processesEnd = processSnapshot();
    report.memory = memory.rows; report.memoryErrors = memory.errors; memory.stop();
    const backendLog = path.join(global.HDRFinisherElectronTestHarness.userDataDirectory, 'logs/backend.log');
    if (fs.existsSync(backendLog)) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(backendLog, output.replace(/\.json$/, '-backend.log')); }
    report.finalHashes = [sha(input), sha(grade)];
    if (JSON.stringify(report.finalHashes) !== JSON.stringify(report.hashes)) { report.failure = 'Test source or saved grade changed'; process.exitCode = 1; }
    save(); await browser.close();
  }
})();
