/** Profile repeated Fit <-> magnified zoom cycles and pans on a project, with
 * optional session edits. Splits each step into source, masks and scopes.
 * Disposable session; never saves a project.
 *
 *   node tests/run-in-electron.js tests/performance/zoom-cycle-profile.js --project <file> \
 *     [--geometry straighten_angle=2] [--shift-edge 0.005] [--set path=value,...] \
 *     [--zooms fit,100,fit,100,fit,85,fit,85] [--pans 2] [--output report.json]
 */
const path = require('node:path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');
const args = process.argv.slice(2), opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/review/zoom-cycle-profile.json'));
const zooms = opt('--zooms', 'fit,100,fit,100,fit,85,fit,85').split(',');
const pans = Number(opt('--pans', 2));

async function settle(page) {
  await page.waitForTimeout(60);
  await page.waitForFunction(() => pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0, null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const coordinator = state.renderCoordinator?.state(state.currentView);
    return !state.zoomRefinementTimer && !coordinator?.panTimerPending && !coordinator?.inFlight && !coordinator?.pending;
  }, null, { timeout: 180000 });
  await c.stable(page, 180000);
}

(async () => {
  const browser = await chromium.launch({ headless: false }), page = await browser.newPage();
  const report = { ...c.manifest(project), steps: [], errors: [] };
  page.on('pageerror', error => report.errors.push(String(error)));
  const network = c.networkProbe(page);
  try {
    await c.open(page, project, false);
    report.geometryEdits = opt('--geometry', '').split(',').filter(Boolean).map(entry => entry.split('='));
    report.sessionEdits = opt('--set', '').split(',').filter(Boolean).map(entry => entry.split('='));
    await page.evaluate(({ geometry, edits }) => {
      for (const [key, value] of geometry) commitAdjustmentValue(`shared.geometry.${key}`, Number(value), { manual: true });
      for (const [key, value] of edits) commitAdjustmentValue(key, value === 'true' ? true : value === 'false' ? false : Number.isNaN(Number(value)) ? value : Number(value), { manual: true });
    }, { geometry: report.geometryEdits, edits: report.sessionEdits });
    await settle(page);
    if (args.includes('--shift-edge')) {
      report.shiftEdge = Number(opt('--shift-edge', 0.005));
      report.shifted = await page.evaluate(async shift => {
        const changed = [];
        for (const saved of localAdjustments().filter(local => local.mask?.leaf?.type === 'brush')) {
          const local = structuredClone(saved); local.mask.leaf.mask_shift_edge = shift;
          if (!await queueEditCommand('update_local', { local }, local.id)) throw Error('Shift edit failed');
          changed.push({ feather: local.mask.leaf.mask_feather, strokes: local.mask.leaf.strokes.length });
        }
        return changed;
      }, report.shiftEdge);
      await settle(page);
    }
    report.source = await page.evaluate(() => ({ ...state.session.source, locals: localAdjustments().map(local => local.mask?.leaf?.type || local.mask?.operator) }));

    async function step(name, action) {
      const before = await c.mark(page), requestStart = network.length;
      const maskStart = await page.evaluate(() => state.gpuPreview.performanceMetrics.maskEvents?.length || 0);
      // Every size the picture is laid out at during the step: more than one
      // after the action itself means it was resized, and so moved, by itself.
      await page.evaluate(() => {
        const log = window.__layoutLog = { start: performance.now(), rows: [], stop: false };
        const sample = () => {
          const size = `${Math.round(parseFloat(els.previewCanvas.style.width))}x${Math.round(parseFloat(els.previewCanvas.style.height))}`;
          if (log.rows.at(-1)?.size !== size) log.rows.push({ ms: Math.round(performance.now() - log.start), size });
          if (!log.stop) requestAnimationFrame(sample);
        };
        sample();
      });
      await action();
      await settle(page);
      const layout = await page.evaluate(() => { window.__layoutLog.stop = true; return window.__layoutLog.rows; });
      const observation = await c.result(page, before, before.at);
      const detail = await page.evaluate(maskStart => {
        const events = (state.gpuPreview.performanceMetrics.maskEvents || []).slice(maskStart), kinds = {};
        for (const event of events) {
          const entry = kinds[event.kind] ||= { count: 0, ms: 0 };
          entry.count++; entry.ms += event.gpuPrepareMs || event.requestMs || event.encodeSubmitMs || 0;
        }
        for (const entry of Object.values(kinds)) entry.ms = Math.round(entry.ms);
        return { kinds, zoom: state.zoomPercent, mode: state.zoomMode, requiredEdge: requiredProcessingLongEdge(),
          accepted: { execution: state.acceptedPresentation?.execution, edge: state.acceptedPresentation?.processedLongEdge } };
      }, maskStart);
      const requests = network.slice(requestStart), group = {};
      for (const row of requests) {
        const key = row.path.replace(/[0-9a-f-]{32,}/g, 'ID').replace('/api/session/ID', '');
        const entry = group[key] ||= { count: 0, ms: 0, max: 0 };
        entry.count++; entry.ms += row.durationMs || 0; entry.max = Math.max(entry.max, row.durationMs || 0);
      }
      const stages = {};
      for (const stage of observation.stages || []) {
        const entry = stages[stage.stage] ||= { count: 0, ms: 0 };
        entry.count++; entry.ms += stage.durationMs || 0;
      }
      for (const entry of Object.values(stages)) entry.ms = Math.round(entry.ms);
      const refused = (observation.stages || []).filter(stage => /refused/.test(stage.stage));
      if (refused.length) console.log(`   REFUSED ${JSON.stringify(refused)}`);
      const row = { refused, name, exactMs: Math.round(observation.releaseToExactMs), scopesMs: Math.round(observation.releaseToScopesMs),
        stableMs: Math.round(observation.releaseToObservedStableMs), ...detail, layout, requests: group, stages,
        renders: (observation.gpuRenders || []).slice(-3).map(render => ({ edge: render.longEdge, proxyAwaitMs: Math.round(render.proxyAwaitMs), maskAwaitMs: Math.round(render.maskAwaitMs), gpuMs: Math.round(render.gpuMs || 0) })) };
      report.steps.push(row); c.write(output, report);
      console.log(`${name.padEnd(12)} exact ${String(row.exactMs).padStart(6)} ms  scopes ${String(row.scopesMs).padStart(6)}  stable ${String(row.stableMs).padStart(6)}  edge ${detail.requiredEdge}  ${detail.accepted.execution}`);
      console.log(`   layout ${layout.map(entry => `${entry.size}@${entry.ms}`).join(' -> ')}`);
      console.log(`   masks ${JSON.stringify(detail.kinds)}`);
      console.log(`   requests ${JSON.stringify(group)}`);
      console.log(`   renders ${JSON.stringify(row.renders)}`);
    }

    const editBetween = args.includes('--edit-between');
    let edits = 0;
    for (const zoom of zooms) {
      // An ordinary grade edit at Fit before each zoom in, as in real use.
      if (editBetween && zoom !== 'fit') await step('  edit at Fit', () => page.evaluate(count => {
        commitAdjustmentValue(`${state.currentView}.exposure`, Number(getValueByPath(state.adjustments, `${state.currentView}.exposure`)) + (count % 2 ? -0.05 : 0.05), { manual: true });
      }, edits++));
      await step(zoom === 'fit' ? 'Zoom Fit' : `Zoom ${zoom}%`, () => page.evaluate(zoom => zoom === 'fit' ? setZoomMode('fit') : setCustomZoom(Number(zoom)), zoom));
      if (zoom !== 'fit') for (let index = 0; index < pans; index++) {
        await step(`  pan ${index + 1}`, () => page.evaluate(index => {
          const pane = els.dropzone, dx = (index % 2 ? -1 : 1) * Math.round(pane.clientWidth * 0.6), dy = (index % 2 ? -1 : 1) * Math.round(pane.clientHeight * 0.6);
          pane.scrollLeft += dx; pane.scrollTop += dy; pane.dispatchEvent(new Event('scroll'));
        }, index));
      }
    }
  } catch (error) {
    report.failure = String(error.stack || error); console.error(report.failure); process.exitCode = 1;
  } finally { c.write(output, report); await browser.close(); }
})();
