const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { photosPath } = require('./helpers/photos-root.cjs');
const reusePhoto = require('./helpers/reuse-test-photo.cjs');

async function ready(page) {
  await page.waitForFunction(() => state.acceptedPresentation?.exact
    && viewerState().status === 'ready' && !state.gpuDraftInFlight
    && !state.globalEditDirty && !state.globalEditSyncPending, null, { timeout: 120000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  const samples = [];
  const results = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('response', async response => {
    if (/\/(hsl-sample|local-hue-sample)$/.test(response.url())) {
      try { samples.push({ status: response.status(), request: response.request().postDataJSON(), result: await response.json() }); } catch {}
    }
  });
  try {
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8765');
    await page.waitForFunction(() => state.gpuPreview?.available);
    const source = photosPath('D:/Photos/HDR Test Images/DSC00264.ARW');
    const photo = reusePhoto(source, path.resolve('output/hsl-h1/DSC00264.ARW'));
    await page.evaluate(async photo => {
      state.appPreferences.gradeAutosave = false;
      await openDesktopSelection({ kind: 'source', ...await desktop.grantSourcePath(photo) });
      activateWorkflowTab('grade');
      document.querySelector('[data-group="hsl"]').classList.remove('collapsed');
    }, photo);
    await ready(page);
    for (const lane of ['hdr', 'sdr']) {
      await page.evaluate(async lane => { setGradeMode('global'); await switchLane(lane); }, lane);
      await ready(page);
      const probe = await page.evaluate(async () => {
        const positions = [];
        for (let row = 1; row < 5; row++) for (let column = 1; column < 5; column++) positions.push({ x: column / 5, y: row / 5 });
        const sample = await hslFetchStage(hslUI.panels[0], positions);
        const colors = sample.samples.map(rgb => HDRHSL.describe(rgb));
        const index = colors.reduce((best, color, index) => color.relativeChroma > colors[best].relativeChroma ? index : best, 0);
        const box = activePreviewElement().getBoundingClientRect();
        return { hue: colors[index].hue, x: box.left + box.width * positions[index].x, y: box.top + box.height * positions[index].y };
      });
      const globalPanel = page.locator('#hsl-global-panel');
      await globalPanel.getByRole('button', { name: 'All channel', exact: true }).click();
      await globalPanel.getByRole('button', { name: 'Pick', exact: true }).click();
      const colorResponse = page.waitForResponse(response => response.url().endsWith('/hsl-sample'));
      await page.mouse.click(probe.x, probe.y);
      const color = await (await colorResponse).json();
      await page.waitForFunction(() => !hslUI.panels[0].sampling);
      const picked = await page.evaluate(() => ({ recipe: hslChannel(hslUI.panels[0]).recipe, kind: hslChannel(hslUI.panels[0]).kind, notice: hslUI.panels[0].host.querySelector('.hsl-notice').textContent }));
      assert.equal(picked.kind, 'custom');
      const expectedHue = require('../frontend/hsl-engine.js').describe(color.samples[0]).hue;
      assert.ok(Math.abs(picked.recipe.ranges[0].center - expectedHue) < 1e-6, 'The clicked pixel determines the picked hue');
      await globalPanel.getByRole('button', { name: 'Stop picking', exact: true }).click();
      await ready(page);
      const handle = globalPanel.locator('[data-hsl-handle="move"][tabindex]').first();
      await globalPanel.locator('svg').evaluate(element => element.scrollIntoView({ block: 'center' }));
      const handleBox = await handle.boundingBox();
      assert.ok(handleBox, 'Picked hue has a visible wheel gizmo');
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2 + 15, handleBox.y + handleBox.height / 2 + 15, { steps: 4 });
      await page.mouse.up();
      await ready(page);
      assert.notEqual(await page.evaluate(() => hslChannel(hslUI.panels[0]).recipe.ranges[0].center), expectedHue, 'Dragging the wheel updates the hue');
      const beforeCancel = await page.evaluate(() => JSON.stringify(hslChannel(hslUI.panels[0]).recipe));
      await globalPanel.getByRole('button', { name: 'Pick', exact: true }).click();
      await page.evaluate(() => {
        globalThis.h1Fetch = window.fetch;
        globalThis.h1SampleReceived = false;
        window.fetch = async (...args) => {
          const response = await globalThis.h1Fetch(...args);
          if (String(args[0]).endsWith('/hsl-sample')) {
            globalThis.h1SampleReceived = true;
            await new Promise(resolve => { globalThis.h1ReleaseSample = resolve; });
          }
          return response;
        };
      });
      await page.mouse.click(probe.x, probe.y);
      await page.waitForFunction(() => globalThis.h1SampleReceived);
      await globalPanel.getByRole('button', { name: 'Stop picking', exact: true }).click();
      await page.evaluate(() => { window.fetch = globalThis.h1Fetch; globalThis.h1ReleaseSample(); });
      await page.waitForFunction(() => !hslUI.panels[0].sampling);
      assert.equal(await page.evaluate(() => JSON.stringify(hslChannel(hslUI.panels[0]).recipe)), beforeCancel, 'Stop discards the delayed sample');
      await page.locator('#grade-mode-local').click();
      await page.locator('[data-local-tool="hue_range"]').click();
      await page.waitForFunction(() => selectedMaskLeaf()?.type === 'hue_range');
      assert.equal(await page.evaluate(() => getComputedStyle(els.localMaskOverlay).pointerEvents), 'auto');
      await page.mouse.move(probe.x, probe.y);
      await page.mouse.down();
      assert.equal(await page.evaluate(() => state.localPointerGesture?.type), 'luminance_sample');
      await page.mouse.move(probe.x + 12, probe.y, { steps: 4 });
      const gizmo = await page.evaluate(() => {
        renderLocalMaskOverlay();
        const canvas = els.localMaskOverlay;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return { points: state.localPointerGesture.points.length, drawn: pixels.some((value, index) => index % 4 === 3 && value > 0) };
      });
      assert.ok(gizmo.points > 1, 'Dragging adds sample points');
      assert.equal(gizmo.drawn, true, 'Sampling gizmo paints visible pixels');
      await page.mouse.up();
      await page.waitForFunction(() => selectedMaskLeaf()?.hue_center != null, null, { timeout: 15000 });
      await ready(page);
      const oldCenter = await page.evaluate(() => selectedMaskLeaf().hue_center);
      await page.evaluate(() => {
        globalThis.h1Fetch = window.fetch;
        globalThis.h1EditReceived = false;
        window.fetch = async (...args) => {
          const response = await globalThis.h1Fetch(...args);
          if (String(args[0]).endsWith('/edit-commands')) {
            globalThis.h1EditReceived = true;
            await new Promise(resolve => setTimeout(resolve, 600));
          }
          return response;
        };
        state.adjustments[state.currentView].tint = 1;
        state.globalEditDirty = true;
        globalThis.h1Save = syncGlobalEditState();
      });
      await page.waitForFunction(() => globalThis.h1EditReceived);
      const sampled = page.waitForResponse(response => response.url().endsWith('/local-hue-sample'));
      await page.mouse.click(probe.x, probe.y);
      await page.evaluate(() => globalThis.h1Save);
      assert.equal((await sampled).status(), 200);
      await page.waitForFunction(oldCenter => selectedMaskLeaf().hue_center !== oldCenter, oldCenter);
      await page.evaluate(() => { window.fetch = globalThis.h1Fetch; });
      await ready(page);
      assert.notEqual(await page.evaluate(() => selectedMaskLeaf().hue_center), oldCenter, 'Picking waits for the current upstream edit instead of losing the selection');
      const localPanel = page.locator('#hsl-local-panel');
      if (!await localPanel.isVisible()) await page.locator('[data-local-grade-section="hsl"] summary').click();
      await localPanel.getByRole('button', { name: 'Pick', exact: true }).click();
      const localResponse = page.waitForResponse(response => response.url().endsWith('/hsl-sample'));
      await page.mouse.click(probe.x, probe.y);
      const localColor = await (await localResponse).json();
      await page.waitForFunction(() => !hslUI.panels[1].sampling);
      assert.ok(Math.abs(await page.evaluate(() => selectedLocal()[`${state.currentView}_grade`].hsl.ranges[0].center)
        - require('../frontend/hsl-engine.js').describe(localColor.samples[0]).hue) < 1e-6);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !hslUI.picker);
      await ready(page);
      results.push({ lane, expectedHue, pickedHue: picked.recipe.ranges[0].center, gizmo,
        sampledHue: await page.evaluate(() => selectedMaskLeaf().hue_center) });
      console.log(`${lane}: photo hue, wheel drag, cancelled sample, Local hue drag/gizmo, save race and Local HSL passed`);
    }
    assert.deepEqual(errors, []);
    assert.ok(samples.every(sample => sample.status === 200), 'Every colour sampling request succeeds');
    fs.mkdirSync('output/hsl-h1', { recursive: true });
    fs.writeFileSync('output/hsl-h1/result.json', JSON.stringify({ machine: process.platform, results, sampleStatuses: samples.map(sample => sample.status) }, null, 2));
  } finally {
    await browser.close();
    reusePhoto.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
