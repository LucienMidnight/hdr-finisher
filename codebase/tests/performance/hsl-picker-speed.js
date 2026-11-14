const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const { chromium } = require('playwright');
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const output = path.resolve(option('--output', 'output/performance/hsl-mac/current.json'));
const input = option('--input', 'output/test-photos/DSC00264.ARW');
const stacked = option('--stacked', null);
const report = { machine: process.platform, rows: [], requests: [], errors: [] };

async function ready(page) {
  await page.waitForFunction(() => state.acceptedPresentation?.exact && viewerState().status === 'ready'
    && state.acceptedPresentation.lane === state.currentView
    && state.acceptedPresentation.generation === state.previewGeneration[state.currentView]
    && !state.gpuDraftInFlight && !state.denoiseInputQueue?.running
    && !pendingHighlightAnchors.size && !exactHighlightAnchorInflight.size
    && !state.globalEditSyncPending && !state.globalEditDirty, null, { timeout: 90000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let folder;
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('response', async response => {
    if (!response.url().endsWith('/hsl-sample')) return;
    try {
      const result = await response.json();
      if (result.selection_overlay) result.selection_overlay = `[PNG ${result.selection_overlay.length} characters]`;
      report.requests.push({ status: response.status(), request: response.request().postDataJSON(), result });
    } catch (error) { report.errors.push(String(error)); }
  });
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.waitForFunction(() => state.gpuPreview?.available);
    if (process.argv.includes('--observe')) {
      const reference = option('--picker-ref', 'HEAD');
      const original = execFileSync('git', ['show', `${reference}:codebase/frontend/hsl-panel.js`], { encoding: 'utf8' });
      const functions = runInNewContext(original + '\n[hslPoint.toString(), hslPickStart.toString()]').join('\n');
      await page.evaluate(source => {
        document.removeEventListener('pointerdown', hslPickStart, true);
        (0, eval)(source);
        document.addEventListener('pointerdown', hslPickStart, true);
      }, functions);
      await page.evaluate(() => { globalThis.hslVisibleRect = () => null; });
      report.pickerReference = reference;
      report.selectionFullFrame = true;
    }
    const cached = path.resolve('output/test-photos', path.basename(input));
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    if (!fs.existsSync(cached)) fs.copyFileSync(path.resolve(input), cached, fs.constants.COPYFILE_EXCL);
    folder = fs.mkdtempSync(path.join(path.dirname(cached), 'test-hsl-grade-'));
    const grades = [['plain', null]];
    if (stacked) grades.push(['stacked', JSON.parse(fs.readFileSync(stacked)).grade]);
    for (const [name, saved] of grades) {
      const directory = path.join(folder, name);
      fs.mkdirSync(directory);
      const photo = path.join(directory, path.basename(cached));
      fs.linkSync(cached, photo);
      if (saved) fs.copyFileSync(stacked, photo + '.hdrf');
      await page.evaluate(async photo => {
        state.appPreferences.gradeAutosave = false;
        hslUI.picker = null;
        setZoomMode('fit');
        const choose = window.HDRDialogs.choose;
        window.HDRDialogs.choose = (message, choices, options) => options?.title === 'Unsaved changes'
          ? Promise.resolve('discard') : choose(message, choices, options);
        try { await openDesktopSelection({ kind: 'source', ...await desktop.grantSourcePath(photo) }); }
        finally { window.HDRDialogs.choose = choose; }
        activateWorkflowTab('grade');
        setGradeMode('global');
        document.querySelector('[data-group="hsl"]').classList.remove('collapsed');
        hslUI.panels[0].channel = 'red';
        renderHslPanels();
      }, photo);
      await ready(page);
      const grade = saved || await page.evaluate(() => structuredClone(state.editDocument));
      const loaded = await page.evaluate(() => ({ hdr: structuredClone(state.adjustments.hdr.film_look),
        sdr: structuredClone(state.adjustments.sdr.film_look), denoise: structuredClone(state.editDocument.denoise) }));
      assert.deepEqual(loaded.hdr, grade.global_adjustments.hdr.film_look, 'HDR Film must survive grade loading exactly');
      assert.deepEqual(loaded.sdr, grade.global_adjustments.sdr.film_look, 'SDR Film must survive grade loading exactly');
      assert.deepEqual(loaded.denoise, grade.denoise, 'Denoise settings must survive grade loading exactly');
      report.rows.push({ grade: name, loaded });
      for (const lane of ['hdr', 'sdr']) {
        await page.evaluate(async lane => { hslUI.picker = null; setZoomMode('fit'); await switchLane(lane); }, lane);
        await ready(page);
        for (const zoom of ['fit', 100]) {
          await page.evaluate(zoom => zoom === 'fit' ? setZoomMode('fit') : setCustomZoom(zoom), zoom);
          await ready(page);
          await page.evaluate(lane => {
            document.getElementById(`${lane}-exposure`).closest('.control-group').classList.remove('collapsed');
          }, lane);
          await page.locator(`#${lane}-exposure`).scrollIntoViewIfNeeded();
          const controlPoint = await page.evaluate(() => {
            const control = document.getElementById(`${state.currentView}-exposure`);
            const box = control.getBoundingClientRect();
            hslUI.picker = hslUI.panels[0];
            return { x: box.left + box.width / 2, y: box.top + box.height / 2, value: control.value };
          });
          await page.mouse.move(controlPoint.x, controlPoint.y);
          await page.mouse.down();
          const trap = await page.evaluate(() => {
            const intercepted = Boolean(hslUI.stroke);
            hslUI.stroke = null;hslUI.picker = null;
            return intercepted;
          });
          await page.mouse.up();
          await ready(page);
          assert.equal(await page.locator(`#${lane}-exposure`).inputValue(), controlPoint.value, 'Probe leaves the grade unchanged');
          report.rows.push({ grade: name, lane, zoom, controlIntercepted: trap });
          console.log('CONTROL', name, lane, zoom, { intercepted: trap });
          if (!process.argv.includes('--observe')) assert.equal(trap, false, 'Armed picker cannot intercept Exposure');
          for (let trial = 0; trial < 5; trial++) {
            if (trial === 4) await page.evaluate(() => { hslChannel(hslUI.panels[0]).recipe.edge_feather = 3; });
            const timing = await page.evaluate(async () => {
              const ui = hslUI.panels[0], start = performance.now();
              ui.host.querySelector('[data-hsl-selection]').setAttribute('aria-pressed', 'true');
              await hslSelection(ui);
              const image = document.getElementById('hsl-selection-overlay');
              if (!image) throw Error(ui.host.querySelector('.hsl-notice').textContent);
              await image.decode();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const ms = performance.now() - start;
              hslClearSelection();
              return { ms, dpr: devicePixelRatio, width: image.naturalWidth, height: image.naturalHeight, region: image.hslRegion };
            });
            report.rows.push({ grade: name, lane, zoom, trial, rangeEdit: trial === 4, ...timing,
              backend: report.requests.at(-1)?.result.timings_ms });
            console.log('SELECTION', report.rows.at(-1));
          }
          await page.evaluate(() => { hslUI.picker = hslUI.panels[0]; hslUI.picker.mode = 'pick'; });
          const pick = await page.evaluate(async () => {
            const photo = activePreviewElement().getBoundingClientRect(), pane = els.previewPrimaryPane.getBoundingClientRect();
            const viewport = els.dropzone.getBoundingClientRect();
            const left = Math.max(photo.left, pane.left, viewport.left), top = Math.max(photo.top, pane.top, viewport.top);
            const width = Math.min(photo.right, pane.right, viewport.right) - left;
            const height = Math.min(photo.bottom, pane.bottom, viewport.bottom) - top;
            const positions = [];
            for (let row = 1; row < 5; row++) for (let column = 1; column < 5; column++) positions.push({ x: left + width * column / 5, y: top + height * row / 5 });
            const points = positions.map(point => ({ x: (point.x-photo.left)/photo.width, y: (point.y-photo.top)/photo.height }));
            const sampled = await hslFetchStage(hslUI.panels[0], points);
            const colors = sampled.samples.map(rgb => HDRHSL.describe(rgb));
            const index = colors.reduce((best, color, index) => color.relativeChroma > colors[best].relativeChroma ? index : best, 0);
            return { point: positions[index], normalized: points[index], hue: colors[index].hue };
          });
          await page.evaluate(() => window.addEventListener('pointerdown', event => {
            const box = activePreviewElement().getBoundingClientRect();
            globalThis.hslTestPoint = { x: (event.clientX-box.left)/box.width, y: (event.clientY-box.top)/box.height };
          }, { capture: true, once: true }));
          await page.mouse.click(pick.point.x, pick.point.y);
          await page.waitForFunction(() => !hslUI.stroke && !hslUI.panels[0].sampling);
          report.rows.push({ grade: name, lane, zoom, picker: await page.evaluate(() => ({
            notice: hslUI.panels[0].host.querySelector('.hsl-notice').textContent,
            ranges: hslChannel(hslUI.panels[0]).recipe.ranges,
            identity: hslUI.identity
          })) });
          console.log('PICK', report.rows.at(-1));
          const picked = report.rows.at(-1).picker;
          if (!process.argv.includes('--observe')) {
            assert.match(picked.notice, /Colours selected/);
            const sample = report.requests.at(-1);
            assert.deepEqual(sample.request.points[0], await page.evaluate(() => globalThis.hslTestPoint), 'Pointer coordinates stay in normalized CSS points at 2x');
            const hue = require('../../frontend/hsl-engine.js').describe(sample.result.samples[0]).hue;
            assert.ok(Math.abs(picked.ranges.at(-1).center-hue) < 1e-6, 'Visible click applies the returned sampled hue');
          }
        }
      }
    }
    if (!process.argv.includes('--observe')) assert.deepEqual(report.errors, []);
  } finally {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    try { await browser.close(); }
    finally { if (folder) fs.rmSync(folder, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
