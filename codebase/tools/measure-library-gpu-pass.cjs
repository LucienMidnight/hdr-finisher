// Longest single GPU submission in one Library development.
// Opens one file in Single with per-stage fences on, then reports each GPU
// stage's wall time and the largest one. Run through the electron runner:
//   node tests/run-in-electron.js tools/measure-library-gpu-pass.cjs [--file=name]
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules/playwright'));
const arg = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const folder = require('../tests/helpers/photos-root.cjs').photosPath('D:/Photos/HDR Test Images');
const file = arg('file', '_DSC6510-1.png');
const out = path.join(root, 'output/library-gpu-pass');
fs.mkdirSync(out, { recursive: true });
(async () => {
  let browser, page, lib;
  const report = { file, errors: [] };
  try {
    browser = await chromium.launch();
    page = await browser.newPage();
    page.on('pageerror', e => report.errors.push(String(e)));
    await page.goto(process.env.HDR_FINISHER_URL);
    lib = page.frame({ url: /\/library(?:\?|$)/ });
    await lib.waitForFunction(() => window.HDRLibrary && window.HDRLibraryScenes);
    await lib.evaluate(() => { window.HDRLibraryProfile = true; });
    await lib.evaluate(f => HDRLibrary.browse(f), folder.replaceAll('\\', '/'));
    const target = file;
    await lib.waitForFunction(t => [...document.querySelectorAll('#grid-space .library-cell')]
      .some(c => (c.dataset.path || '').endsWith(t)), target, { timeout: 120000 });
    await lib.evaluate(p => {
      const cell = [...document.querySelectorAll('#grid-space .library-cell')].find(c => (c.dataset.path || '').endsWith(p));
      cell.click();
      document.getElementById('single-view').click();
    }, target);
    await lib.waitForFunction(p => {
      const c = document.getElementById('single-picture');
      return !!c && !c.hidden && c.dataset.picturePath && c.dataset.picturePath.endsWith(p) && Number(c.dataset.pictureEdge) === 2560;
    }, target, { timeout: 120000 });
    await page.waitForTimeout(2500);
    const log = path.join(global.HDRFinisherElectronTestHarness.userDataDirectory, 'logs/backend.log');
    for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
      if (!line.startsWith('[library] picture_development ')) continue;
      const payload = JSON.parse(line.slice('[library] '.length).split(' ').slice(1).join(' '));
      if (path.basename(payload.path || '') !== file) continue;
      report.stagesMs = payload.gpu_stages_ms;
      report.gpuMs = payload.gpu_ms;
      report.developmentMs = payload.duration_ms;
    }
    const stages = report.stagesMs || {};
    report.longestStage = Object.entries(stages).sort((a, b) => b[1] - a[1])[0] || null;
    await page.screenshot({ path: path.join(out, 'picture.png') }).catch(() => {});
  } catch (error) {
    report.error = String(error.message || error);
  } finally {
    if (lib) fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    await browser?.close();
  }
})();
