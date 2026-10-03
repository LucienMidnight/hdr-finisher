/** Bounded peak diagnostics on a disposable edit state; never saves a project. */
const { chromium } = require('playwright');
const path = require('node:path');
const c = require('./heavy-project-review-common');
const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/editing-peak-diagnostic.json'));
const edits = opt('--set', '').split(',').filter(Boolean).map(item => {
  const [controlPath, raw] = item.split('=');
  return { path: controlPath, value: JSON.parse(raw) };
});
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const report = { ...c.manifest(project), edits };
  try {
    await c.open(page, project, false);
    if (args.includes('--without-locals')) {
      await page.evaluate(async () => {
        for (const existing of localAdjustments()) {
          const local = structuredClone(existing);
          local.enabled = false;
          if (!await queueEditCommand('update_local', { local }, local.id)) throw new Error('Could not disable diagnostic local');
        }
      });
      report.localsDisabled = true;
    }
    await page.evaluate(async edits => {
      for (const edit of edits) commitAdjustmentValue(edit.path, edit.value, { manual: true });
      await settlePreview('hdr', {});
    }, edits);
    await c.stable(page);
    report.measurement = await page.evaluate(async () => {
      const renderer = state.gpuPreview;
      const trace = {};
      const rank = renderer.rankEditingPeakCandidates;
      const halo = renderer.roiSourceHalo;
      renderer.rankEditingPeakCandidates = async function (...args) {
        const result = await rank.apply(this, args);
        trace.ranked = result;
        return result;
      };
      renderer.roiSourceHalo = function (...args) {
        const value = halo.apply(this, args);
        trace.halo = value;
        return value;
      };
      try {
        trace.result = await measureExactScopePeak({ lane: 'hdr', force: true });
        if (trace.ranked) trace.processedBound = trace.ranked.patches.reduce((sum, patch) =>
          sum + (patch.width + 2 * trace.halo) * (patch.height + 2 * trace.halo), 0);
        trace.budget = 4 * 1024 * 1024;
        return trace;
      } finally {
        renderer.rankEditingPeakCandidates = rank;
        renderer.roiSourceHalo = halo;
      }
    });
    report.projectUnchanged = c.manifest(project).projectSha256 === report.projectSha256;
    c.write(output, report);
    console.log(JSON.stringify({ result: report.measurement.result,
      halo: report.measurement.halo, processedBound: report.measurement.processedBound,
      budget: report.measurement.budget, projectUnchanged: report.projectUnchanged }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
