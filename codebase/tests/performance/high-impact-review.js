/** Focused automatic-anchor verification. Disposable session; never saves. */
const path = require('node:path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');
const { selectLocal } = require('./heavy-project-drag-review');
const args = process.argv.slice(2);
const opt = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/review/high-impact-review.json'));
async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const requests = c.networkProbe(page);
  const report = { ...c.manifest(project), anchorPolicy: 'Original automatic anchors', rows: [], errors: [] };
  report.brushRasterizerSha256 = require('node:crypto').createHash('sha256')
    .update(require('node:fs').readFileSync(path.join(__dirname, '../../backend/hdr_finisher/local_adjustments.py'))).digest('hex');
  page.on('pageerror', error => report.errors.push(String(error)));
  try {
    await c.open(page, project, false);
    for (const lane of ['hdr', 'sdr']) {
      await page.evaluate(lane => switchLane(lane), lane);
      await c.stable(page);
      await selectLocal(page, 'brush');
      for (let i = 0; i < 3; i++) {
        const index = requests.length;
        const observation = await c.drag(page, 'input[data-local-mask-param="mask_feather"]', i % 2 ? -1 : 1);
        const row = { lane, operation: 'brush feather', observation, requests: requests.slice(index) };
        report.rows.push(row); c.write(output, report);
        console.log(JSON.stringify({ lane, sample: i + 1, releaseToStableMs: observation.releaseToObservedStableMs,
          releaseToExactMs: observation.releaseToExactMs, requests: row.requests.length }));
      }
    }
    const start = Date.now(), index = requests.length;
    if (!await page.evaluate(() => setSdrMatch('match'))) throw Error('Match returned false');
    await c.stable(page);
    report.match = { totalMs: Date.now() - start, requests: requests.slice(index),
      presentation: await page.evaluate(() => state.acceptedPresentation) };
    console.log(JSON.stringify({ matchMs: report.match.totalMs,
      cpuPreviewRequests: report.match.requests.filter(x => /\/preview\/sdr$/.test(x.path)).length }));
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed'; report.failure = String(error.stack || error); throw error;
  } finally { c.write(output, report); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
