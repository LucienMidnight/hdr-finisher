const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const { photosRoot } = require('../../tests/helpers/photos-root.cjs');

const methods = ['standard', 'clean_grain', 'micro_grain'];

async function waitFor(action, description) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const result = await action();
    if (result) return result;
    await delay(50);
  }
  throw Error(`Timed out: ${description}`);
}

async function main() {
  const scratch = path.resolve(__dirname, '../../output/test-photos/denoise-library-clicks');
  const photo = path.join(scratch, 'IMG_0790.CR2');
  const sidecar = `${photo}.hdrf`;
  await fs.mkdir(scratch, { recursive: true });
  await fs.copyFile(path.join(photosRoot(), 'HDR Test Images', path.basename(photo)), photo, constants.COPYFILE_EXCL)
    .catch(error => { if (error.code !== 'EEXIST') throw error; });
  await fs.unlink(sidecar).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hdr-denoise-clicks-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['start', '--', `--remote-debugging-port=${port}`], {
    cwd: path.join(__dirname, '..'), env,
    stdio: ['ignore', 'ignore', 'inherit'], detached: process.platform !== 'win32', shell: process.platform === 'win32',
  });
  let browser;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    await waitFor(() => fetch(`${endpoint}/json/version`).then(result => result.ok).catch(() => false), 'Electron debugger');
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = await waitFor(() => context.pages().find(candidate => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(candidate.url())), 'main window');
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type())) console.warn('renderer:', message.text());
    });
    page.on('pageerror', error => console.warn('renderer:', error.message));
    const requests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!/\/(source-tile\/hdr|denoise-micro\/region)$/.test(url.pathname)) return;
      url.searchParams.delete('edit_revision');
      url.searchParams.delete('revision');
      requests.push({ type: url.pathname.split('/').slice(-2).join('/'), edge: url.searchParams.get('long_edge'), key: url.pathname + url.search + (request.postData() || '') });
    });
    await page.evaluate(() => {
      window.denoiseClickProbe = { frames: [], picks: [], intents: [], menuFrames: [] };
      const sampleMenu = () => {
        const method = document.querySelector('#denoise-method')?.value;
        if (method) window.denoiseClickProbe.menuFrames.push({ at: performance.now(), method });
        requestAnimationFrame(sampleMenu);
      };
      requestAnimationFrame(sampleMenu);
      window.addEventListener('hdrfinisher:preview-presented', ({ detail }) => {
        const selector = state.gpuPreview?.denoiseSourceSelector;
        window.denoiseClickProbe.frames.push({ ...detail, method: selector?.controls?.method || 'standard', selected: selector?.selected || 'original', microGpu: Boolean(selector?.cache?.grain?.micro) });
      });
      document.addEventListener('click', event => {
        if (event.isTrusted && event.target.closest('#denoise-bypass')) window.denoiseClickProbe.intents.push({ control: 'toggle', at: performance.now() });
      }, true);
      for (const name of ['input', 'change']) document.addEventListener(name, event => {
        if (event.target.id !== 'denoise-method') return;
        window.denoiseClickProbe.picks.push([name, event.target.value, event.isTrusted]);
        if (name === 'input' && event.isTrusted) window.denoiseClickProbe.intents.push({ control: 'method', at: performance.now() });
      }, true);
    });
    const library = page.frameLocator('#library-frame');
    await library.locator('body[data-library-ready="true"]').waitFor();
    await library.locator('body').evaluate((_, folder) => window.HDRLibrary.browse(folder), path.dirname(photo));
    const tile = library.locator('#grid-space .library-cell').filter({ hasText: path.basename(photo) });
    const tab = name => page.locator(`[data-workflow-tab="${name}"]`);
    const toggle = page.locator('#denoise-bypass');
    const menu = page.locator('#denoise-method');
    const snapshot = () => page.evaluate(() => ({
      time: performance.now(), menu: els.denoiseMethod.value, enabled: state.denoise.hdr.enabled,
      runtime: state.denoiseRuntime.hdr.status, microCpu: state.denoiseRuntime.hdr.microCpu,
      status: document.querySelector('#denoise-status')?.textContent,
      saved: document.querySelector('#grade-save-state').textContent,
      acknowledged: state.editDocument?.denoise?.hdr, generation: state.previewGeneration.hdr,
      presentation: state.acceptedPresentation, frame: window.denoiseClickProbe.frames.at(-1),
      intent: window.denoiseClickProbe.intents.at(-1), picks: window.denoiseClickProbe.picks.slice(-4),
      region: els.previewCanvas.hdrFrameRegion ?? null,
    }));
    async function open(previousSession) {
      await tile.dblclick();
      await page.waitForFunction(previous => HDRGradeSaving.ready() && state.activeWorkflow === 'grade' && !state.gradeOpen
        && state.session?.session_id !== previous && state.acceptedPresentation?.exact, previousSession, { timeout: 60000 });
      if (await menu.isHidden()) await page.locator('[data-group="denoise"] .group-toggle').click();
    }
    async function reopen(method) {
      const session = await page.evaluate(() => state.session.session_id);
      await tab('import').click();
      await page.evaluate(() => closePhotoInGrade());
      await open(session);
      assert.equal(await menu.inputValue(), method);
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      console.log('Restored saved grade', method, (await snapshot()).frame?.sessionId);
    }
    async function click(label, action, method, enabled) {
      const start = await page.evaluate(() => performance.now());
      const firstRequest = requests.length;
      await action();
      const immediate = await snapshot();
      assert.ok(immediate.intent?.at >= start, `No trusted UI event: ${label}`);
      assert.equal(immediate.menu, method, label);
      let result;
      try {
        result = await waitFor(async () => {
          const now = await snapshot();
          assert.equal(now.menu, method, `Menu reverted: ${label}`);
          const frame = now.frame?.presentedAt >= immediate.intent.at && now.frame.generation === now.generation ? now.frame : null;
          const currentPicture = now.presentation?.generation === now.generation && now.presentation.exact;
          if (now.menu !== method || now.enabled !== enabled || now.acknowledged?.controls.method !== method
            || now.acknowledged.enabled !== enabled || now.saved !== 'All changes saved' || !currentPicture) return false;
          if (!frame && now.presentation.transport !== 'CPU/backend' && !now.presentation.fallbackReason) return false;
          const disk = await fs.readFile(sidecar, 'utf8').then(JSON.parse).catch(() => null);
          if (disk?.grade?.denoise?.hdr?.controls?.method !== method || disk.grade.denoise.hdr.enabled !== enabled) return false;
          return { ...now, disk: { method, enabled }, pictureMs: frame ? Math.round(frame.presentedAt - immediate.intent.at) : null };
        }, label);
      } catch (error) {
        console.log(JSON.stringify({ label, immediate, final: await snapshot() }));
        throw error;
      }
      const box = await page.locator('#dropzone').boundingBox();
      const shot = await page.screenshot({ clip: { x: Math.round(box.x + box.width / 2 - 48), y: Math.round(box.y + box.height / 2 - 48), width: 96, height: 96 } });
      const pixels = createHash('sha256').update(shot).digest('hex').slice(0, 12);
      const menuFrames = await page.evaluate(from => [...new Set(window.denoiseClickProbe.menuFrames
        .filter(frame => frame.at >= from).map(frame => frame.method))], immediate.intent.at);
      assert.deepEqual(menuFrames, [method], `Menu changed after the trusted input: ${label}`);
      const requestCounts = Object.fromEntries(['source-tile/hdr', 'denoise-micro/region'].map(type => {
        const rows = requests.slice(firstRequest).filter(request => request.type === type);
        const edges = {};
        for (const { edge } of rows) if (edge) edges[edge] = (edges[edge] || 0) + 1;
        return [type, { total: rows.length, unique: new Set(rows.map(row => row.key)).size, edges }];
      }));
      console.log(JSON.stringify({ label, immediate: { menu: immediate.menu, status: immediate.status }, pixels, requests: requestCounts, ...result }));
      assert.notEqual(result.pictureMs, null, `Expected an exact WebGPU frame: ${label}`);
      assert.equal(result.frame.selected, enabled ? 'resolved' : 'original', label);
      if (enabled) assert.equal(result.frame.method, method, label);
      if (enabled && method === 'micro_grain') assert.ok(result.frame.microGpu, label);
      return pixels;
    }
    const pick = async method => {
      await menu.click({ timeout: 2500 });
      await menu.locator(`option[value="${method}"]`).click({ timeout: 2500 });
    };
    await open();
    console.log('Opened', JSON.stringify(await snapshot()));
    assert.equal(await fs.access(sidecar).then(() => true, () => false), false);
    await click('fresh Standard on', () => toggle.click(), 'standard', true);
    await reopen('standard');
    async function rapid(zoom) {
      await pick('micro_grain');
      assert.equal(await menu.inputValue(), 'micro_grain');
      await click(`${zoom} rapid Micro → Clean`, () => pick('clean_grain'), 'clean_grain', true);
    }
    if (process.env.HDR_DENOISE_RAPID_ONLY) {
      await rapid('Fit');
      return;
    }
    const pixelFailures = [];
    for (const zoom of ['Fit', '110%']) {
      if (zoom === '110%') {
        const input = page.locator('#zoom-readout');
        await input.fill(zoom);
        await input.press('Enter');
      }
      for (const method of methods) {
        if (await menu.inputValue() !== method) await click(`${zoom} select ${method}`, () => pick(method), method, true);
        const off = await click(`${zoom} ${method} off`, () => toggle.click(), method, false);
        const on = await click(`${zoom} ${method} on`, () => toggle.click(), method, true);
        if (off === on) pixelFailures.push(`${zoom} ${method}`);
      }
      for (const from of methods) {
        if (await menu.inputValue() !== from) await click(`${zoom} return to ${from}`, () => pick(from), from, true);
        for (const to of methods.slice(methods.indexOf(from) + 1)) {
          const toPixels = await click(`${zoom} ${from} → ${to}`, () => pick(to), to, true);
          const fromPixels = await click(`${zoom} ${to} → ${from}`, () => pick(from), from, true);
          if (toPixels === fromPixels) pixelFailures.push(`${zoom} ${from} ↔ ${to}`);
        }
      }
      await click(`${zoom} Standard before rapid picks`, () => pick('standard'), 'standard', true);
      await rapid(zoom);
      await click(`${zoom} select Micro for reopen`, () => pick('micro_grain'), 'micro_grain', true);
    }
    await reopen('micro_grain');
    assert.deepEqual(pixelFailures, [], 'Different Denoise settings must draw different visible pixels');
  } finally {
    await browser?.close();
    const exited = new Promise(resolve => app.once('exit', resolve));
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(app.pid), '/T']);
    else if (app.pid) { try { process.kill(-app.pid, 'SIGTERM'); } catch {} }
    await Promise.race([exited, delay(3000)]);
    if (process.env.HDR_DENOISE_CLICK_LOG) await fs.copyFile(path.join(profile, 'logs', 'backend.log'), process.env.HDR_DENOISE_CLICK_LOG).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
    await fs.unlink(sidecar).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
