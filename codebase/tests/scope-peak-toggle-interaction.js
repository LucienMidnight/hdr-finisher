const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8000');
    await page.waitForFunction(() => state.gpuPreview?.available, null, { timeout: 120000 });
    const response = await page.request.post(`${process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8000'}/api/session`, {
      multipart: { file: { name: 'hdr_headroom.tiff', mimeType: 'image/tiff', buffer: fs.readFileSync(path.join(__dirname, 'fixtures/hdr_headroom.tiff')) } },
    });
    assert.ok(response.ok());
    const { session } = await response.json();
    await page.evaluate(session => activateDesktopSession(session, ''), session);
    await page.waitForFunction(() => viewerState().status === 'ready' && !state.gpuDraftInFlight
      && !state.previewScheduler.frameInFlight && !state.gpuScopeRequestInFlight && !state.scopeRequestInFlight
      && !state.pendingGpuScopeRequest && !pendingHighlightAnchors.size && !exactHighlightAnchorInflight.size, null, { timeout: 120000 });
    await page.evaluate(() => {
      state.previewScheduler.cancel(); clearTimeout(state.refreshTimer);
      window.peakToggleCalls = 0;
      const measure = measureExactScopePeak;
      measureExactScopePeak = (...args) => { window.peakToggleCalls++; return measure(...args); };
    });
    for (const checked of [true, false, true]) {
      const before = await page.evaluate(() => ({ generation: state.scopeGeneration, calls: window.peakToggleCalls }));
      await page.evaluate(on => { els.scopeExactPeak.checked = on; els.scopeExactPeak.dispatchEvent(new Event('change')); }, checked);
      await page.waitForFunction(old => state.scopeGeneration > old && !state.gpuScopeRequestInFlight
        && !state.scopeRequestInFlight && state.lastScope?.tier === 'settled' && !els.scopeFreshness.classList.contains('updating'), before.generation, { timeout: 30000 });
      const result = await page.evaluate(() => ({ calls: window.peakToggleCalls, label: state.lastScope.stats[0].label }));
      assert.equal(result.calls > before.calls, checked, 'Only the enabled toggle requests bounded editing peak measurement');
      if (!checked) assert.equal(result.label, 'Peak (preview)');
    }
    await page.evaluate(async () => {
      invalidatePreview(state.currentView, { markDirty: false });
      await refreshScopes(scopeLongEdge('settled'), { tier: 'settled' });
      if (els.scopeFreshness.textContent !== 'Updating') throw new Error('Expected scopes to wait for replacement preview');
      await renderGpuDraft(state.currentView, { longEdge: requiredProcessingLongEdge() });
    });
    await page.waitForFunction(() => !state.scopeAwaitingPresentation && !state.gpuScopeRequestInFlight
      && !els.scopeFreshness.classList.contains('updating') && els.scopeFreshness.textContent === 'Settled', null, { timeout: 30000 });
    assert.deepEqual(errors, []);
    console.log('PASS: Peak estimate on/off/on settles, controls editing measurement, and resumes after preview replacement.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
