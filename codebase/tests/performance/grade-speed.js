const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const output = path.resolve(option('--output', 'output/performance/p1b/current.json'));
const input = path.resolve(option('--input', 'output/test-photos/grade-24mp.tiff'));
const part = option('--part', 'all');
const report = { machine: process.platform === 'darwin' ? 'MacBook' : process.platform === 'win32' ? 'Windows PC' : process.platform,
  date: new Date().toISOString(), rows: [], errors: [] };

async function stable(page) {
  await page.waitForFunction(() => {
    const accepted = state.acceptedPresentation;
    const lane = state.currentView;
    return accepted?.exact && accepted.lane === lane && accepted.generation === state.previewGeneration[lane]
      && viewerState().status === 'ready' && !state.gpuDraftInFlight && !state.previewScheduler?.interacting
      && !state.denoiseInputQueue?.running && !state.globalEditSyncPending
      && !pendingHighlightAnchors.size && !exactHighlightAnchorInflight.size;
  }, null, { timeout: 90000 });
}

async function selection(page, label) {
  const row = await page.evaluate(async () => {
    const ui = hslUI.panels[0];
    const started = performance.now();
    ui.host.querySelector('[data-hsl-selection]').setAttribute('aria-pressed', 'true');
    await hslSelection(ui);
    const image = document.getElementById('hsl-selection-overlay');
    if (!image) throw Error('Selection was not drawn');
    await image.decode();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { ms: performance.now() - started, width: image.naturalWidth };
  });
  report.rows.push({ action: label, ...row });
  await page.evaluate(() => hslClearSelection());
}

async function drag(page, selector, low, high) {
  const moving = await page.evaluate(async ({ selector, low, high }) => {
    const frames = [];
    const listener = event => frames.push({ ...event.detail });
    window.addEventListener('hdrfinisher:preview-presented', listener);
    const control = document.querySelector(selector);
    const started = performance.now();
    state.previewScheduler.beginInteraction();
    for (let step = 0; step < 150; step++) {
      const fraction = low + (high - low) * step / 149;
      control.value = String(Number(control.min) + fraction * (Number(control.max) - Number(control.min)));
      control.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    const duration = performance.now() - started;
    state.previewScheduler.endInteraction();
    window.removeEventListener('hdrfinisher:preview-presented', listener);
    return { frames: frames.length, duration, fps: frames.length * 1000 / duration };
  }, { selector, low, high });
  await stable(page);
  const settled = await page.evaluate(() => {
    return { exact: state.acceptedPresentation.exact,
      approximate: state.acceptedPresentation.approximate,
      stages: state.gpuPreview.diagnosticsSnapshot().stages?.slice(-8),
      renders: state.gpuPreview.diagnosticsSnapshot().renders?.slice(-8),
      scheduler: state.previewScheduler.metrics };
  });
  assert.equal(settled.exact, true);
  report.rows.push({ action: selector, ...moving, settled });
  console.log(selector, moving);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.waitForFunction(() => state.gpuPreview?.available, null, { timeout: 30000 });
    if (process.argv.includes('--trace')) await page.evaluate(() => state.gpuPreview.setInstrumentationEnabled(true));
    await page.evaluate(async photo => {
      state.appPreferences.gradeAutosave = false;
      const grant = await desktop.grantSourcePath(photo);
      const created = await projectIo.createImportJob(fetch, { grant: grant.grant });
      let job = created.payload;
      if (!created.response.ok) throw Error(JSON.stringify(job));
      while (!['ready', 'error', 'cancelled'].includes(job.state)) {
        await new Promise(resolve => setTimeout(resolve, 150));
        job = (await projectIo.pollImportJob(fetch, job.job_id)).payload;
      }
      if (job.state !== 'ready') throw Error(JSON.stringify(job));
      await activateDesktopSession((await projectIo.fetchSession(fetch, job.session_id)).payload.session, '');
      activateWorkflowTab('grade');
    }, input);
    await stable(page);
    await page.evaluate(async () => {
      await switchLane('sdr');
      document.querySelector('[data-group="hsl"]').classList.remove('collapsed');
      hslUI.panels[0].channel = 'red';
      renderHslPanels();
    });
    await stable(page);
    if (part === 'all' || part === 'hsl') for (const zoom of ['fit', 100]) {
      await page.evaluate(zoom => zoom === 'fit' ? setZoomMode('fit') : setCustomZoom(zoom), zoom);
      await stable(page);
      for (let trial = 0; trial < 4; trial++) await selection(page, `sdr.selection.${zoom}.${trial ? 'warm' : 'cold'}`);
      await page.evaluate(() => { hslChannel(hslUI.panels[0]).recipe.edge_feather = 3; });
      await selection(page, `sdr.selection.${zoom}.range`);
    }
    if (part === 'all' || part === 'film') {
    await page.evaluate(() => {
      setZoomMode('fit');
      document.querySelector('[data-group="film-look"]').classList.remove('collapsed');
      const control = document.getElementById('film-stock');
      control.value = 'kodak_portra_400';
      control.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await stable(page);
    for (const selector of ['#film-stock-color', '#film-print_contrast', '#film-grain-amount']) {
      await drag(page, selector, 0.35, 0.65);
    }
    await page.evaluate(() => {
      const control = document.getElementById('film-lens-filter');
      control.value = 'black_pro_mist';
      control.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await stable(page);
    await drag(page, '#film-lens-strength', 0.15, 0.55);
    }
    if ((part === 'all' || part === 'denoise') && !process.argv.includes('--skip-denoise')) {
    await page.evaluate(async () => { await switchLane('hdr'); await setDenoiseEnabled(true); });
    await stable(page);
    for (let trial = 0; trial < 3; trial++) {
      await page.evaluate(async trial => {
        const control = document.getElementById('denoise-amount');
        control.value = String(0.4 + trial * 0.1);
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }, trial);
      await stable(page);
      const row = await page.evaluate(async trial => {
        const started = performance.now();
        const control = document.getElementById('hdr-exposure');
        control.value = String(0.1 + trial * 0.1);
        control.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => {
          const check = () => {
            const accepted = state.acceptedPresentation;
            if (accepted?.exact && accepted.generation === state.previewGeneration[state.currentView] && !state.gpuDraftInFlight) resolve();
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
        return { ms: performance.now() - started };
      }, trial);
      report.rows.push({ action: 'hdr.exposure-after-denoise', ...row });
      await stable(page);
    }
    }
  } catch (error) {
    report.errors.push(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    await browser.close();
  }
})();
