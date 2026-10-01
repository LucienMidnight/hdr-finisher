/**
 * What does the scope panel report as Peak? Measurement only; never saves.
 *
 *   node tests/run-in-electron.js tests/performance/peak-readout-review.js \
 *     --project <file.hdrfinisher> --output output/performance/review/<run>/peak-readout.json
 *
 * Reads the HDR Peak figure and its label at Fit and at 100%, with the Exact
 * Peak option off and on. Compare the figures with the export's own peak from
 * preview-export-compare.js (PRD section 4.3). This driver changes no
 * measurement code; it only reads what the panel shows.
 */
const path = require('path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/review/peak-readout.json'));

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const report = { ...c.manifest(project), readings: [], errors: [], status: 'running' };
  page.on('pageerror', (error) => report.errors.push(String(error)));
  const settled = async () => {
    await c.stable(page);
    await page.waitForFunction(() => pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0,
      null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    await c.stable(page);
  };
  const read = async (label) => {
    const reading = await page.evaluate((at) => {
      const row = [...document.querySelectorAll('#scope-stats dt')]
        .map((term) => ({ label: term.textContent.trim(), value: term.nextElementSibling?.textContent.trim() }))
        .find((entry) => /^Peak/.test(entry.label));
      const cached = exactScopePeakCache.get(exactScopePeakKey('hdr'));
      return {
        at,
        panel: row || null,
        exactPeakOption: document.querySelector('#scope-exact-peak')?.checked ?? null,
        zoom: state.zoomMode === 'fit' ? 'fit' : state.zoomPercent,
        processedLongEdge: state.acceptedPresentation?.processedLongEdge ?? null,
        execution: state.acceptedPresentation?.execution ?? null,
        measured: cached ? { nits: cached.peak / 0.18 * projectReferenceWhiteNits(), longEdge: cached.longEdge, exact: cached.exact } : null,
      };
    }, label);
    report.readings.push(reading);
    console.log(JSON.stringify(reading));
  };
  try {
    await c.open(page, project, false);
    await settled();
    await read('Fit, as opened');
    await page.locator('#scope-exact-peak').check();
    await settled();
    await read('Fit, Exact Peak on');
    await page.evaluate(() => setCustomZoom(100));
    await settled();
    await read('100%, Exact Peak on');
    await page.locator('#scope-exact-peak').uncheck();
    await settled();
    await read('100%, Exact Peak off');
    await page.evaluate(() => applyExecutionOverride('tiled'));
    await page.waitForFunction(() => state.acceptedPresentation?.execution === 'tiled', null, { timeout: 180000 });
    await settled();
    await read('100%, Exact Peak off, tiled route forced');
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed';
    report.failure = String(error.stack || error);
    throw error;
  } finally {
    c.write(output, report);
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
