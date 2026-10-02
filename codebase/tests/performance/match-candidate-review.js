/**
 * Press Match once in a disposable session and record what it cost and chose.
 * Never saves a project.
 *
 *   --renderer gpu     the page's GPU renders the candidates (the default in the app)
 *   --renderer cpu     the export pipeline renders them, as before phase 3
 *   --renderer verify  GPU candidates, each also rendered on the CPU; the
 *                      backend reports how far the two pictures differ. Its
 *                      timings are not Match timings.
 *
 * Isolation helpers for a verify run: --keep-types a,b (disable every local
 * whose mask is not one of these types; "none" disables all),
 * --set path=value,... (session edits), --reset-geometry.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/match-candidate-review.json'));
const renderer = opt('--renderer', 'gpu');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const report = { ...c.manifest(project), renderer, errors: [] };
  page.on('pageerror', (error) => report.errors.push(String(error)));
  try {
    const network = c.networkProbe(page);
    await c.open(page, project, false);
    const keepTypes = opt('--keep-types', null);
    if (keepTypes !== null) {
      await page.evaluate(async (types) => {
        for (const item of localAdjustments()) {
          if (types.includes(item.mask?.leaf?.type)) continue;
          const local = structuredClone(item);
          local.enabled = false;
          if (!await queueEditCommand('update_local', { local }, local.id)) throw Error('Session edit failed');
        }
      }, keepTypes.split(',').filter(Boolean));
      await c.stable(page);
    }
    const sets = opt('--set', '');
    if (sets) {
      await page.evaluate(async (entries) => {
        for (const entry of entries.split(',')) {
          const [name, value] = entry.split('=');
          commitAdjustmentValue(name, JSON.parse(value), { manual: true });
        }
        await settlePreview('hdr', {});
      }, sets);
      await c.stable(page);
    }
    if (args.includes('--reset-geometry')) {
      await page.evaluate(() => els.groupResets.find((button) => button.dataset.resetGroup === 'geometry').click());
      await c.stable(page);
      await page.waitForTimeout(1500);
      await c.stable(page);
    }
    report.enabledLocals = await page.evaluate(() => localAdjustments().filter((local) => local.enabled !== false).length);
    report.crop = await page.evaluate(() => state.adjustments.shared.geometry.crop);

    const firstRequest = network.length;
    const started = await page.evaluate(() => performance.now());
    report.ok = await page.evaluate((mode) => {
      state.sdrMatchCandidateRenderer = mode;
      return setSdrMatch('match');
    }, renderer);
    report.clickToReturnMs = await page.evaluate((from) => performance.now() - from, started);
    await c.stable(page);
    const row = network.slice(firstRequest).find((entry) => entry.path.endsWith('/sdr-match'));
    report.status = row?.status;
    report.timing = row?.headers?.['x-sdr-match-timing'] ? JSON.parse(row.headers['x-sdr-match-timing']) : null;
    report.candidateTimings = await page.evaluate(() => state.sdrMatchCandidateTimings || []);
    report.match = await page.evaluate(() => {
      const match = state.editDocument?.sdr_match || {};
      const sdr = state.adjustments.sdr;
      return {
        status: match.materialized_status,
        metrics: match.materialized_metrics,
        recipe: {
          exposure: sdr.exposure, contrast: sdr.contrast, saturation: sdr.saturation,
          highlightStart: sdr.highlight_compression_start_percent,
          highlightDetail: sdr.highlight_compression_peak_detail,
          highlightBias: sdr.highlight_compression_bias,
          toneNodes: (sdr.tone_equalizer_nodes || []).map((node) => node.adjustment_ev),
          redCurve: sdr.red_curve, greenCurve: sdr.green_curve, blueCurve: sdr.blue_curve,
          vignette: sdr.vignette?.amount,
        },
      };
    });
    // A whole-picture CPU grade after Match is what phase 3 removes.
    report.cpuRequestsAfterMatch = network.slice(firstRequest)
      .filter((entry) => /\/scopes$|\/preview\/(hdr|sdr)$/.test(entry.path))
      .map((entry) => ({ path: entry.path.split('/').slice(-2).join('/'), ms: entry.durationMs }));
    c.write(output, report);

    const timing = report.timing || {};
    const parity = timing.gpu_candidate_parity || [];
    console.log(JSON.stringify({
      renderer, used: timing.candidate_renderer || 'cpu', fallback: timing.gpu_candidate_fallback || null,
      requestMs: timing.request_total_ms, clickToReturnMs: Math.round(report.clickToReturnMs),
      gpuCandidates: timing.gpu_candidates, status: report.match.status, metrics: report.match.metrics,
      worstCandidateLumaDifference: parity.length ? Math.max(...parity.map((entry) => entry.luma_abs_max)) : undefined,
      cpuRequestsAfterMatch: report.cpuRequestsAfterMatch.length,
    }));
    assert.equal(report.ok, true, 'Match did not complete');
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    if (renderer !== 'cpu') assert.equal(timing.candidate_renderer, 'gpu', `GPU candidates fell back: ${timing.gpu_candidate_fallback}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
