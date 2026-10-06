/** Phase 3 coverage audit: every static control and the mask edits, at 100%
 * zoom, across geometry states. Records the route each edit took and flags
 * any CPU picture, CPU scope, CPU mask or whole native source request.
 * Disposable session; never saves a project.
 *
 *   node tests/run-in-electron.js tests/performance/phase3-coverage-audit.js \
 *     --project <file.hdrfinisher> --output <report.json> [--controls all|representative]
 *     [--geometries saved,rotate,flip,straighten,perspective,both] [--lanes hdr,sdr]
 */
const path = require('node:path'), fs = require('node:fs');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');
const args = process.argv.slice(2), opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/review/phase3-coverage-audit.json'));
const controlSet = opt('--controls', 'all');
const lanes = opt('--lanes', 'hdr,sdr').split(',');
const GEOMETRIES = {
  saved: [],
  rotate: [['rotation', 90]],
  flip: [['flip_horizontal', true]],
  straighten: [['straighten_angle', 2]],
  perspective: [['perspective_vertical', 15]],
  both: [['straighten_angle', -3], ['perspective_horizontal', -10]],
};
const geometries = opt('--geometries', Object.keys(GEOMETRIES).join(',')).split(',');
// One control per module and processing family, as the control sweep uses.
const REPRESENTATIVES = ['current.exposure', 'current.contrast_pivot', 'current.lift', 'current.lift_range',
  'current.saturation', 'current.white_balance_kelvin', 'current.color_grading.highlights.hue',
  'current.color_grading.blending', 'current.black_and_white.reds', 'current.vignette.amount',
  'current.vignette.feather', 'current.film_look.look_strength', 'current.film_look.red_response',
  'current.detail.clarity_amount', 'current.detail.microcontrast', 'current.film_look.halation_radius',
  'current.film_look.halation_enabled', 'current.film_look.bloom_radius', 'current.film_look.bloom_enabled',
  'current.film_look.grain_amount', 'current.film_look.grain_enabled', 'current.film_look.grain_film_type',
  'hdr.tone_equalizer_smoothing', 'current.highlight_compression_softness',
  'current.highlight_compression_peak_detail'];

async function settle(page) {
  await page.waitForTimeout(60);
  await page.waitForFunction(() => pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0,
    null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const coordinator = state.renderCoordinator?.state(state.currentView);
    return !state.zoomRefinementTimer && !coordinator?.panTimerPending && !coordinator?.inFlight && !coordinator?.pending
      && state.acceptedPresentation?.geometrySignature === geometrySignature();
  }, null, { timeout: 120000 });
  await c.stable(page, 120000);
}

function classify(rows) {
  const count = test => rows.filter(test).length;
  const edge = row => Number(new URLSearchParams(row.query).get('long_edge'));
  return {
    cpuPicture: count(row => /\/(preview|preview-raw)\/(hdr|sdr)$/.test(row.path)),
    cpuScopes: count(row => row.path.endsWith('/scopes')),
    cpuOverlay: count(row => /\/overlay\//.test(row.path)),
    cpuMask: count(row => /\/local-mask(-tiles?)?(\/|$)/.test(row.path) && !/bitmap-verdict(-raw)?$/.test(row.path)),
    wholeNativeSource: count(row => /\/proxy(-stream)?\//.test(row.path) && edge(row) > 3200),
    sourceLuminanceTiles: count(row => row.path.endsWith('/source-luminance')),
    // A superseded request is aborted by design; only real failures count.
    failed: count(row => (row.failure && row.failure !== 'net::ERR_ABORTED') || row.status >= 500),
    aborted: count(row => row.failure === 'net::ERR_ABORTED'),
    cpuMaskDetail: rows.filter(row => /\/local-mask(-tiles?)?(\/|$)/.test(row.path) && !/bitmap-verdict(-raw)?$/.test(row.path))
      .map(row => `${row.path.replace(/[0-9a-f-]{32,}/g, 'ID').replace('/api/session/ID', '')} long_edge=${edge(row) || ''} ${row.durationMs ?? '?'}ms`),
  };
}

(async () => {
  const browser = await chromium.launch({ headless: false }), page = await browser.newPage();
  const report = { ...c.manifest(project), schemaVersion: 1, controlSet, states: [], errors: [], status: 'running' };
  page.on('pageerror', error => report.errors.push(String(error)));
  const network = c.networkProbe(page);
  try {
    await c.open(page, project, false);
    await settle(page);
    const inventory = await page.evaluate(() => [...new Set([...document.querySelectorAll('input[data-path],select[data-path],button[data-path]')]
      .map(control => control.dataset.path))]
      .filter(path => !path.startsWith('shared.geometry.')));
    report.inventoryCount = inventory.length;
    const savedGeometry = await page.evaluate(() => structuredClone(state.adjustments.shared.geometry));
    const savedLocals = await page.evaluate(() => structuredClone(localAdjustments()));

    // One edit, its route, and the restore.
    async function row(stateReport, name, kind, apply, restore) {
      const entry = { name, kind };
      const requestStart = network.length, errorStart = report.errors.length;
      try {
        const before = await page.evaluate(() => ({ generation: state.previewGeneration[state.currentView],
          masks: state.gpuPreview.performanceMetrics.maskEvents?.length || 0,
          fallbacks: state.cpuFallbacks.settle.length + state.cpuFallbacks.refine.length, at: performance.now() }));
        entry.applied = await apply();
        await settle(page);
        Object.assign(entry, await page.evaluate(before => {
          const accepted = state.acceptedPresentation, events = (state.gpuPreview.performanceMetrics.maskEvents || []).slice(before.masks);
          const kinds = {};
          for (const event of events) kinds[event.kind] = (kinds[event.kind] || 0) + 1;
          return { ms: Math.round(performance.now() - before.at), generations: state.previewGeneration[state.currentView] - before.generation,
            transport: accepted?.transport, execution: accepted?.execution, exact: accepted?.exact, processedLongEdge: accepted?.processedLongEdge,
            maskKinds: kinds, cpuMaskEvents: events.filter(event => event.cpuMaskRequest !== false || /^cpu/.test(event.kind)).length,
            cpuFallbacks: state.cpuFallbacks.settle.length + state.cpuFallbacks.refine.length - before.fallbacks,
            refusal: state.lastGpuDraftRefusal?.reason || null };
        }, before));
        entry.requests = classify(network.slice(requestStart));
      } catch (error) { entry.error = String(error).slice(0, 400); }
      try { if (restore) { await restore(); await settle(page); } } catch (error) { entry.restoreError = String(error).slice(0, 400); }
      entry.pageErrors = report.errors.slice(errorStart);
      const r = entry.requests || {};
      entry.flags = [entry.error && 'error', entry.restoreError && 'restore-error', entry.pageErrors.length && 'page-error',
        r.cpuPicture && 'cpu-picture', r.cpuScopes && 'cpu-scopes', r.cpuMask && 'cpu-mask', r.wholeNativeSource && 'whole-native-source',
        r.failed && 'failed-request', entry.cpuFallbacks && 'cpu-fallback',
        !entry.error && entry.transport !== 'WebGPU' && 'not-webgpu', !entry.error && !entry.exact && 'not-exact'].filter(Boolean);
      stateReport.rows.push(entry);
      c.write(output, report);
      if (entry.flags.length) console.log(`  ! ${stateReport.name} ${name}: ${entry.flags.join(', ')}`);
    }

    const setControl = (controlPath, value) => page.evaluate(({ controlPath, value }) => {
      commitAdjustmentValue(controlPath, value, { manual: true }); return value; }, { controlPath, value });
    const updateLocal = local => page.evaluate(async local => {
      if (!await queueEditCommand('update_local', { local }, local.id)) throw Error('Local edit failed'); return true; }, local);

    for (const geometryName of geometries) {
      for (const lane of lanes) {
        const stateReport = { name: `${geometryName}/${lane}`, geometry: geometryName, lane, rows: [] };
        report.states.push(stateReport);
        // Geometry is set at Fit, outside the rows; then the view goes to 100%.
        await page.evaluate(() => setZoomMode('fit')); await settle(page);
        await page.evaluate(async lane => { if (state.currentView !== lane) await switchLane(lane); }, lane); await settle(page);
        await page.evaluate(({ saved, edits }) => {
          for (const key of ['rotation', 'flip_horizontal', 'flip_vertical', 'straighten_angle', 'perspective_horizontal', 'perspective_vertical', 'perspective_rotate']) {
            const wanted = (edits.find(([name]) => name === key) || [key, saved[key]])[1];
            if (state.adjustments.shared.geometry[key] !== wanted) commitAdjustmentValue(`shared.geometry.${key}`, wanted, { manual: true });
          }
        }, { saved: savedGeometry, edits: GEOMETRIES[geometryName] });
        await settle(page);
        await row(stateReport, 'Zoom to 100%', 'viewer', () => page.evaluate(() => { setZoomMode('actual'); return 'actual'; }));
        stateReport.frame = await page.evaluate(() => ({ accepted: structuredClone(state.acceptedPresentation), zoom: state.zoomPercent,
          geometry: structuredClone(state.adjustments.shared.geometry) }));

        const all = controlSet === 'all' && geometryName === 'saved';
        const paths = (all ? inventory : REPRESENTATIVES).filter(controlPath =>
          !(controlPath.startsWith('hdr.') && lane !== 'hdr') && !(controlPath.startsWith('sdr.') && lane !== 'sdr')
          && !(controlPath.startsWith('shared.') && lane !== 'hdr'));
        for (const controlPath of paths) {
          const plan = await page.evaluate(requested => {
            const resolved = resolveAdjustmentPath(requested);
            const control = [...document.querySelectorAll('[data-path]')].find(item => resolveAdjustmentPath(item.dataset.path) === resolved);
            if (!control) return null;
            const value = getValueByPath(state.adjustments, requested);
            let alternative;
            if (control.type === 'checkbox' || control.tagName === 'BUTTON') alternative = !value;
            else if (control.tagName === 'SELECT') alternative = [...control.options].map(item => item.value).find(item => item !== String(value));
            else {
              const current = Number(value), minimum = Number(control.min), maximum = Number(control.max), step = Number(control.step);
              const delta = Number.isFinite(minimum) && Number.isFinite(maximum) ? Math.max(Number.isFinite(step) && step > 0 ? step : 0, (maximum - minimum) / 20) : (step || 0.01);
              alternative = !Number.isFinite(maximum) || current + delta <= maximum ? current + delta : current - delta;
            }
            return { original: structuredClone(value), alternative };
          }, controlPath);
          if (!plan || plan.alternative === undefined) { stateReport.rows.push({ name: controlPath, kind: 'control', skipped: 'no control or alternative', flags: [] }); continue; }
          await row(stateReport, controlPath, 'control', () => setControl(controlPath, plan.alternative), () => setControl(controlPath, plan.original));
        }

        // Denoise has no data-path controls. Exercise it explicitly through
        // the same handlers as the UI, in the disposable session only.
        if (args.includes('--include-denoise')) {
          const original = await page.evaluate(() => structuredClone(state.denoise[state.currentView]));
          const configure = settings => page.evaluate(async settings => {
            await setDenoiseEnabled(false);
            state.denoise[state.currentView] = structuredClone(settings);
            markDenoiseAnalysisDirty();
            if (!await persistDenoiseSettings()) throw Error('Denoise settings did not persist');
            await setDenoiseEnabled(settings.enabled);
            if (settings.enabled && state.denoiseRuntime[state.currentView].status !== 'ready')
              throw Error(state.denoiseRuntime[state.currentView].error || 'Denoise is not ready');
          }, settings);
          for (const algorithm of ['adaptive-atrous-v1']) {
            const enabled = structuredClone(original);
            enabled.enabled = true;
            enabled.analysis.algorithm_version = algorithm;
            await row(stateReport, `Denoise ${algorithm}: enable`, 'denoise', () => configure(enabled));
            for (const key of ['amount', 'luminance', 'color_noise', 'detail_recovery',
              'finest_noise', 'fine_noise', 'medium_noise', 'coarse_noise']) {
              const value = enabled.controls[key] ?? 0.5;
              const alternative = value <= 0.9 ? value + 0.1 : value - 0.1;
              const edit = value => page.evaluate(async ({ key, value }) => {
                await updateLiveDenoiseControl(key, value);
                if (!await persistDenoiseSettings()) throw Error('Denoise control did not persist');
                if (state.denoiseRuntime[state.currentView].status !== 'ready')
                  throw Error(state.denoiseRuntime[state.currentView].error || 'Denoise is not ready');
              }, { key, value });
              await row(stateReport, `Denoise ${algorithm}: ${key}`, 'denoise', () => edit(alternative), () => edit(value));
            }
            const exposure = await page.evaluate(() => getValueByPath(state.adjustments, 'current.exposure'));
            await row(stateReport, `Denoise ${algorithm}: grade edit`, 'denoise',
              () => setControl('current.exposure', exposure + 0.1), () => setControl('current.exposure', exposure));
            await row(stateReport, `Denoise ${algorithm}: disable`, 'denoise', () => configure({ ...enabled, enabled: false }));
          }
          await configure(original);
          await settle(page);
        }

        // Mask edits on every saved local, then combinations.
        for (const saved of savedLocals) {
          const leaf = saved.mask?.operator === 'leaf' ? saved.mask.leaf : null;
          if (!leaf) continue;
          const edits = [['opacity', mask => { mask.leaf.mask_opacity = leaf.mask_opacity === 0.8 ? 0.6 : 0.8; }],
            ['invert', mask => { mask.inverted = !mask.inverted; }]];
          if (leaf.type === 'brush') edits.push(
            ['feather', mask => { mask.leaf.mask_feather = leaf.mask_feather === 0.02 ? 0.03 : 0.02; }],
            ['shift edge', mask => { mask.leaf.mask_shift_edge = leaf.mask_shift_edge === 0.005 ? -0.005 : 0.005; }],
            ['stroke', mask => { mask.leaf.strokes.push({ points: [{ x: .35, y: .45, pressure: .4 }, { x: .45, y: .55, pressure: .7 }], radius: .06, hardness: .5, flow: .7, opacity: .8, erase: false }); }],
            ['erase stroke', mask => { mask.leaf.strokes.push({ points: [{ x: .4, y: .5 }], radius: .03, hardness: .8, flow: 1, opacity: 1, erase: true }); }]);
          if (leaf.type === 'linear_gradient') edits.push(
            ['midpoint', mask => { mask.leaf.gradient_midpoint_1 = Math.max(0.05, leaf.gradient_midpoint_1 - 0.05); }],
            ['fan', mask => { mask.leaf.gradient_fan = leaf.gradient_fan ? 0 : 0.4; }],
            ['end point', mask => { mask.leaf.end = { x: Math.min(.95, leaf.end.x + .05), y: leaf.end.y }; }]);
          if (leaf.type === 'luminance_range') edits.push(
            ['feather', mask => { mask.leaf.mask_feather = leaf.mask_feather === 0.01 ? 0.02 : 0.01; }],
            ['range', mask => { mask.leaf.full_end_ev = leaf.full_end_ev - 0.25; }]);
          if (leaf.type === 'path') edits.push(['feather', mask => { mask.leaf.feather = leaf.feather ? 0 : 0.03; }]);
          for (const [label, edit] of edits) {
            const local = structuredClone(saved); edit(local.mask);
            await row(stateReport, `${leaf.type} ${saved.name || saved.id.slice(0, 6)}: ${label}`, 'mask', () => updateLocal(local), () => updateLocal(saved));
          }
          const grade = structuredClone(saved);
          grade[`${lane}_grade`].color_grading.balance = grade[`${lane}_grade`].color_grading.balance === 20 ? 10 : 20;
          await row(stateReport, `${leaf.type} ${saved.name || saved.id.slice(0, 6)}: grade`, 'local grade', () => updateLocal(grade), () => updateLocal(saved));
        }
        const luminance = savedLocals.find(local => local.mask?.operator === 'leaf' && local.mask.leaf?.type === 'luminance_range');
        for (const other of ['brush', 'linear_gradient', 'path'].map(type => savedLocals.find(local => local.mask?.operator === 'leaf' && local.mask.leaf?.type === type)).filter(Boolean)) {
          if (!luminance) break;
          for (const operator of ['union', 'intersect', 'subtract']) {
            const local = structuredClone(luminance);
            local.mask = { id: `audit-${operator}`, operator, enabled: true, inverted: false,
              children: [structuredClone(luminance.mask), { ...structuredClone(other.mask), id: `audit-${operator}-operand` }] };
            await row(stateReport, `combination: luminance ${operator} ${other.mask.leaf.type}`, 'mask', () => updateLocal(local), () => updateLocal(luminance));
          }
        }
        await row(stateReport, 'Pan', 'viewer', () => page.evaluate(() => {
          const scroller = els.dropzone;
          const before = { left: scroller.scrollLeft, top: scroller.scrollTop };
          const maxLeft = scroller.scrollWidth - scroller.clientWidth;
          const maxTop = scroller.scrollHeight - scroller.clientHeight;
          scroller.scrollLeft = before.left > maxLeft / 2 ? Math.max(0, before.left - 400) : Math.min(maxLeft, before.left + 400);
          scroller.scrollTop = before.top > maxTop / 2 ? Math.max(0, before.top - 300) : Math.min(maxTop, before.top + 300);
          scroller.dispatchEvent(new Event('scroll'));
          const after = { left: scroller.scrollLeft, top: scroller.scrollTop };
          if (after.left === before.left && after.top === before.top) throw Error('Audit pan did not move the viewport');
          return { before, after };
        }));
        const flagged = stateReport.rows.filter(entry => entry.flags?.length);
        stateReport.summary = { rows: stateReport.rows.length, flagged: flagged.length,
          byFlag: flagged.flatMap(entry => entry.flags).reduce((counts, flag) => ({ ...counts, [flag]: (counts[flag] || 0) + 1 }), {}) };
        console.log(`${stateReport.name}: ${stateReport.rows.length} rows, ${flagged.length} flagged ${JSON.stringify(stateReport.summary.byFlag)}`);
        c.write(output, report);
      }
    }
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed'; report.failure = String(error.stack || error);
    process.exitCode = 1;
  } finally {
    c.write(output, report);
    await browser.close();
  }
  console.log(`Coverage audit ${report.status}: ${report.states.reduce((sum, item) => sum + item.rows.length, 0)} rows, `
    + `${report.states.reduce((sum, item) => sum + item.rows.filter(entry => entry.flags?.length).length, 0)} flagged, ${report.errors.length} page errors`);
})();
