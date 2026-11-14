const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { chromium } = require('playwright');
const { machineSettings } = require('../tools/lib/platform.cjs');
const { photosPath } = require('../tests/helpers/photos-root.cjs');

const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const photoFolder = machineSettings().sharedTestPhotos;
const input = path.resolve(option('--input', path.join(photoFolder, 'DSC00264.ARW')));
const output = path.resolve(option('--output', 'output/denoise-100-repro/current.json'));
const gradePath = option('--grade', null);
const report = { machine: { platform: process.platform, cpu: os.cpus()[0].model, ramBytes: os.totalmem(), window: machineSettings().windowSize },
  date: new Date().toISOString(), rows: [], errors: [], console: [] };

async function snapshot(page) {
  return page.evaluate(() => ({
    generation: state.previewGeneration, accepted: state.acceptedPresentation,
    viewer: viewerState(), refusal: state.lastGpuDraftRefusal,
    rendererRefusal: state.gpuPreview?.lastRenderRefusal,
    coordinator: state.renderCoordinator?.snapshot(), scheduler: state.previewScheduler?.metrics,
    denoise: state.denoiseRuntime, gpu: state.gpuPreview?.diagnosticsSnapshot(),
    pendingAnchors: [...pendingHighlightAnchors.keys()], anchorsInflight: [...exactHighlightAnchorInflight.keys()],
    editsPending: state.globalEditSyncPending, cpuFallbacks: state.cpuFallbacks,
    exposure: state.adjustments.hdr.exposure,
  }));
}

async function settled(page, timeout = 30000) {
  await page.waitForFunction(() => state.acceptedPresentation?.exact
    && state.acceptedPresentation.generation === state.previewGeneration[state.currentView]
    && state.acceptedPresentation.processedLongEdge === refinementProxyLongEdge()
    && viewerState().status === 'ready', null, { timeout });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function pictureHash(page) {
  const clip = await page.evaluate(() => {
    const box = els.dropzone.getBoundingClientRect();
    const width = Math.min(512, box.width - 32), height = Math.min(384, box.height - 32);
    return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
  });
  return crypto.createHash('sha256').update(await page.screenshot({ clip })).digest('hex');
}

(async () => {
  const relative = path.relative(photoFolder, input);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'Use only a shared test photo, never an original');
  fs.mkdirSync(photoFolder, { recursive: true });
  if (!fs.existsSync(input)) fs.copyFileSync(photosPath('D:/Photos/HDR Test Images/DSC00264.ARW'), input);
  const originalHash = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let folder;
  try {
    folder = fs.mkdtempSync(path.join(photoFolder, 'test-zoom-grade-'));
    const photo = path.join(folder, path.basename(input));
    fs.linkSync(input, photo);
    if (gradePath) fs.copyFileSync(path.resolve(gradePath), photo + '.hdrf');
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.console.push(message.text()); });
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { state.appPreferences.gradeAutosave = false; });
    await page.evaluate(async photo => {
      await openDesktopSelection({ kind: 'source', ...await desktop.grantSourcePath(photo) });
      activateWorkflowTab('grade');
      state.gpuPreview.setInstrumentationEnabled(true);
      document.querySelector('[data-group="hdr-tone"]').classList.remove('collapsed');
    }, photo);
    if (!gradePath) await page.evaluate(async () => {
      const adjustments = structuredClone(state.adjustments);
      Object.assign(adjustments.hdr.film_look, {
        stock_overrides: ['lens_filter', 'lens_size', 'stock_exposure', 'print_paper', 'print_exposure',
          'stock_print_warmth', 'stock_preflash', 'print_contrast', 'shadow_contrast', 'highlight_contrast'],
        stock_exposure: 0.79, stock_print_warmth: -30, stock_preflash: 50,
        print_exposure: 0.09, shadow_contrast: 26, print_contrast: -24,
        lens_filter: 'black_pro_mist', lens_strength: 0.5, lens_size: 1.53,
      });
      await queueEditCommand('set_global_adjustments', { adjustments });
    });
    await page.evaluate(() => switchLane('hdr'));
    await page.evaluate(async () => { if (state.denoise.hdr.enabled) await setDenoiseEnabled(false); });
    await settled(page, 90000);
    report.loaded = await page.evaluate(() => ({ film: state.adjustments.hdr.film_look, denoise: state.denoise, source: state.session.source }));
    assert.equal(report.loaded.film.lens_filter, 'black_pro_mist', 'The fixture must retain its spatial Film filter');
    if (gradePath) assert.deepEqual(report.loaded.film,
      JSON.parse(fs.readFileSync(path.resolve(gradePath), 'utf8')).grade.global_adjustments.hdr.film_look,
      'The copied stacked Film settings must survive activation unchanged');
    for (const zoom of ['fit', 100]) {
      await page.evaluate(zoom => zoom === 'fit' ? setZoomMode('fit') : setCustomZoom(zoom), zoom);
      try { await settled(page); } catch (error) { report.rows.push({ action: 'zoom', zoom, failure: error.message, state: await snapshot(page) }); }
      if (!process.argv.includes('--skip-picker')) await page.evaluate(() => {
        hslUI.panels[0].host.querySelector('[data-hsl-mode="pick"]').click();
      });
      let previousPicture = await pictureHash(page);
      for (const value of [0.5, -0.5]) {
        const previousExposure = await page.evaluate(() => state.adjustments.hdr.exposure);
        const started = Date.now();
        if (value > 0) {
          const control = page.locator('#hdr-exposure');
          await control.scrollIntoViewIfNeeded();
          const box = await control.boundingBox();
          if (zoom === 100) {
            const overlap = await page.evaluate(({ x, y }) => {
              const photo = activePreviewElement().getBoundingClientRect();
              const pane = els.previewPrimaryPane.getBoundingClientRect();
              const viewport = els.dropzone.getBoundingClientRect();
              return { photo: photo.toJSON(), pane: pane.toJSON(), viewport: viewport.toJSON(), x, y,
                insideCanvas: x >= photo.left && x < photo.right && y >= photo.top && y < photo.bottom,
                insideVisible: x >= Math.max(pane.left, viewport.left) && x < Math.min(pane.right, viewport.right)
                  && y >= Math.max(pane.top, viewport.top) && y < Math.min(pane.bottom, viewport.bottom) };
            }, { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 });
            report.overlap = overlap;
            assert.ok(overlap.insideCanvas && !overlap.insideVisible,
              '100% fixture must place Exposure inside the oversized canvas but outside the visible photo');
          }
          await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.5, { steps: 6 });
          await page.mouse.up();
        } else await page.evaluate(value => {
          const control = document.getElementById('hdr-exposure');
          control.value = String(value);
          control.dispatchEvent(new Event('input', { bubbles: true }));
          control.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        let failure = null;
        try { await settled(page); } catch (error) { failure = error.message; }
        const row = { action: 'exposure', zoom, value, ms: Date.now() - started, failure, state: await snapshot(page) };
        if (row.state.exposure === previousExposure) row.failure = 'Exposure input was swallowed or lost';
        const picture = await pictureHash(page);
        if (!row.failure && picture === previousPicture) row.failure = 'Exposure did not change the displayed photo';
        previousPicture = picture;
        report.rows.push(row);
        console.log(JSON.stringify({ ...row, state: { accepted: row.state.accepted, refusal: row.state.refusal, rendererRefusal: row.state.rendererRefusal } }));
        if (row.failure) break;
      }
    }
    if (!process.argv.includes('--skip-denoise')) {
      const started = Date.now();
      await page.evaluate(() => {
        window.__denoiseDone = false;
        void setDenoiseEnabled(true).finally(() => { window.__denoiseDone = true; });
      });
      await page.waitForTimeout(50);
      for (const value of [0.25, 0.5, 0.75]) {
        await page.evaluate(value => {
          const control = document.getElementById('hdr-exposure');
          control.value = String(value);
          control.dispatchEvent(new Event('input', { bubbles: true }));
          control.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        await page.waitForTimeout(20);
      }
      let failure = null;
      try {
        await settled(page, 60000);
        await page.waitForFunction(() => window.__denoiseDone, null, { timeout: 60000 });
        await settled(page);
      } catch (error) { failure = error.message; }
      const row = { action: 'denoise-and-exposure', zoom: 100, ms: Date.now() - started, failure, state: await snapshot(page) };
      report.rows.push(row);
      assert.equal(row.state.exposure, 0.75, 'The newest Exposure wins during Denoise');
      assert.equal(row.state.denoise.hdr.status, 'ready', 'Denoise must finish, not silently give up');
      assert.equal(row.state.gpu.denoise.selectedSource, 'resolved');
      assert.ok(row.state.gpu.denoise.resolveTiles > 0, 'The presented route must actually reconstruct Denoise');
      console.log(JSON.stringify({ action: row.action, ms: row.ms, failure, denoise: row.state.denoise }));
    }
    assert.ok(report.rows.every(row => !row.failure), 'Every edit and zoom must present the current exact frame');
    assert.deepEqual(report.errors, []);
  } finally {
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      const log = path.join(global.HDRFinisherElectronTestHarness.userDataDirectory, 'logs/backend.log');
      if (fs.existsSync(log)) fs.copyFileSync(log, output.replace(/\.json$/, '-backend.log'));
    } finally {
      try { await browser.close(); }
      finally { if (folder) fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 }); }
    }
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'), originalHash, 'The RAW stays unchanged');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
