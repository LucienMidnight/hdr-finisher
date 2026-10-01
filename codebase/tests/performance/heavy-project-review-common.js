/** Test-only observations; never changes product routing or saves a project. */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

async function stable(page, timeout = 180000) {
  await page.waitForFunction(() => {
    const a = state.acceptedPresentation;
    return viewerState().status === 'ready' && !state.gpuDraftInFlight
      && a?.lane === state.currentView && a.generation === state.previewGeneration[state.currentView]
      && a.exact && a.processedLongEdge === requiredProcessingLongEdge()
      && !document.querySelector('#scope-freshness')?.classList.contains('updating');
  }, null, { timeout });
}
async function open(page, project, manual = false) {
  await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot()?.available, null, { timeout: 180000 });
  await page.evaluate(() => {
    window.HDRFinisherPerformance.enableGpuInstrumentation(true);
    window.__review = { previews: [], scopes: [], inputs: [], pointers: [], changes: [], errors: [], settledScopes: [], edits: [] };
    const invalidate = invalidatePreview;
    invalidatePreview = function (...args) { const value = invalidate(...args); __review.edits.push({at:performance.now(),lane:args[0],generation:state.previewGeneration[args[0]]}); return value; };
    const scopeCallback = state.previewScheduler.callbacks.onScope;
    state.previewScheduler.callbacks.onScope = async task => {
      const value = await scopeCallback(task);
      if (task.tier === 'settled') __review.settledScopes.push({ at: performance.now(), ...task, returned: value });
      return value;
    };
    addEventListener('hdrfinisher:preview-presented', e => window.__review.previews.push({ at: performance.now(), ...e.detail, accepted: structuredClone(state.acceptedPresentation) }));
    addEventListener('hdrfinisher:scope-presented', e => window.__review.scopes.push({ at: performance.now(), ...e.detail, accepted: structuredClone(state.acceptedPresentation) }));
    for (const kind of ['input', 'change', 'pointerdown', 'pointermove', 'pointerup']) {
      document.addEventListener(kind, e => {
        const row = { at: performance.now(), kind, trusted: e.isTrusted, id: e.target.id, path: e.target.dataset?.path, value: e.target.value };
        const store = kind === 'input' ? 'inputs' : kind === 'change' ? 'changes' : 'pointers';
        window.__review[store].push(row);
      }, true);
    }
    const accept = acceptPresentation;
    acceptPresentation = function (...args) {
      const result = accept(...args);
      if (args[4] !== 'WebGPU') {
        const a = structuredClone(state.acceptedPresentation);
        requestAnimationFrame(() => {
          if (state.currentView === a.lane && state.acceptedPresentation?.generation === a.generation)
            window.__review.previews.push({ at: performance.now(), lane: a.lane, generation: a.generation, accepted: a, observation: 'CPU acceptance plus rAF' });
        });
      }
      return result;
    };
  });
  await page.evaluate(async target => { await openProjectFromPath(await desktop.grantProjectPath(target, 'project-open')); }, project);
  await stable(page);
  if (manual) for (const lane of ['hdr', 'sdr']) {
    await page.evaluate(x => switchLane(x), lane); await stable(page);
    await page.evaluate(async x => { commitAdjustmentValue(`${x}.highlight_compression_peak_measurement`, 'manual', { manual: true }); await settlePreview(x, {}); }, lane);
    await stable(page);
  }
}
async function reveal(page, selector) {
  await page.evaluate(s => {
    const control = document.querySelector(s); if (!control) throw Error(`Missing ${s}`);
    const ancestors = []; for (let el = control.parentElement; el; el = el.parentElement) ancestors.unshift(el);
    for (const el of ancestors) {
      if (el.classList.contains('collapsed')) el.querySelector(':scope > .control-group-header .group-toggle, :scope > .group-toggle')?.click();
      if (el.tagName === 'DETAILS') el.open = true;
    }
  }, selector);
  await page.locator(selector).first().scrollIntoViewIfNeeded();
}
async function mark(page) {
  return page.evaluate(() => ({ at: performance.now(), p: __review.previews.length, s: __review.scopes.length, i: __review.inputs.length, c: __review.changes.length, t: __review.pointers.length, e: __review.edits.length, gpuStage: HDRFinisherPerformance.gpuSnapshot().stages?.length || 0 }));
}
async function result(page, begin, releaseAt) {
  return page.evaluate(({ b, released }) => {
    const a = structuredClone(state.acceptedPresentation);
    const p = __review.previews.slice(b.p).filter(x => x.lane === a.lane);
    const exact = p.find(x => x.generation === a.generation && x.accepted?.exact);
    const s = __review.scopes.slice(b.s).filter(x => x.lane === a.lane);
    const currentScope = s.filter(x => (x.metric?.applicationGeneration ?? x.accepted?.generation) === a.generation).at(-1);
    const gpu = HDRFinisherPerformance.gpuSnapshot();
    const firstEdit = __review.edits.slice(b.e).find(x=>x.lane===a.lane);
    const firstEditAt = __review.inputs[b.i]?.at || firstEdit?.at;
    const firstFeedback = p.find(x=>x.at >= firstEditAt && firstEdit && x.generation >= firstEdit.generation);
    return { inputToFirstFrameMs: firstFeedback && firstEditAt ? firstFeedback.at - firstEditAt : null,
      firstEditGeneration: firstEdit?.generation, firstFeedbackGeneration: firstFeedback?.generation,
      gestureToFirstFrameMs: p[0] ? p[0].at - b.at : null,
      editCount: __review.edits.slice(b.e).filter(x=>x.lane===a.lane).length,
      releaseToExactMs: exact ? Math.max(0, exact.at - released) : null,
      releaseToScopesMs: currentScope ? Math.max(0, currentScope.at - released) : null,
      releaseToObservedStableMs: performance.now() - released,
      releaseToScopeCallbackCompleteMs: (() => { const x = __review.settledScopes.find(x => x.at >= released && x.lane === a.lane && x.applicationGeneration === a.generation); return x ? x.at - released : null; })(),
      dragDurationMs: released - b.at, framesDuringDrag: p.filter(x => x.at <= released).length,
      framesAfterRelease: p.filter(x => x.at > released).length,
      inputs: __review.inputs.slice(b.i), changes: __review.changes.slice(b.c),
      trustedPointers: __review.pointers.slice(b.t).filter(x => x.trusted).length,
      accepted: a, scope: currentScope || null, gpuRenders: gpu.renders?.slice(-8),
      stages: gpu.stages?.slice(b.gpuStage), refusal: state.lastGpuDraftRefusal,
      allocator: gpu.resources?.memory?.allocator, memory: gpu.resources?.memory,
      denoise: state.gpuPreview?.diagnosticsSnapshot?.().denoise };
  }, { b: begin, released: releaseAt });
}
async function drag(page, selector, direction = 1, duration = 500, options = {}) {
  if (selector.startsWith('current.')) selector = await page.evaluate(p => {
    const el = [...document.querySelectorAll('input[type="range"][data-path]')].find(x => resolveAdjustmentPath(x.dataset.path) === resolveAdjustmentPath(p));
    if (!el) throw Error(`Missing range ${p}`); return `input[type="range"][data-path="${el.dataset.path}"]`;
  }, selector);
  await reveal(page, selector); await stable(page);
  const box = await page.locator(selector).first().boundingBox();
  if (!box || box.width < 4) throw Error(`Not visible: ${selector}`);
  const valueBefore = await page.locator(selector).first().inputValue();
  const modelBefore = await page.locator(selector).first().evaluate(x => x.dataset.path ? getValueByPath(state.adjustments,x.dataset.path) : null);
  const bounds = await page.locator(selector).first().evaluate(x => ({ min: Number(x.min), max: Number(x.max), enhanced: Boolean(x.closest('.range-shell')), thumb: x.closest('.luma-nit-range,.gradient-luma-ramp') ? 13 : parseFloat(getComputedStyle(x,'::-webkit-slider-thumb').width) || 13, padding: parseFloat(getComputedStyle(x).paddingLeft) || 0 }));
  if (direction > 0 && Number(valueBefore) >= bounds.max || direction < 0 && Number(valueBefore) <= bounds.min) direction *= -1;
  const b = await mark(page);
  const startX = bounds.enhanced ? box.x + box.width / 2 : box.x + bounds.padding + bounds.thumb / 2 + (Number(valueBefore)-bounds.min)/(bounds.max-bounds.min)*(box.width-2*bounds.padding-bounds.thumb);
  // Fine mode keeps edits near the mature grade instead of jumping to track midpoint.
  await page.keyboard.down('Control');
  await page.mouse.move(startX, box.y + box.height / 2);
  await page.mouse.down();
  try {
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(startX + direction * box.width * .12 * step / 12, box.y + box.height / 2);
      await page.waitForTimeout(duration / 12);
    }
  } finally { await page.mouse.up(); await page.keyboard.up('Control'); }
  const released = await page.evaluate(b => __review.pointers.slice(b.t).filter(x => x.kind === 'pointerup').at(-1)?.at || performance.now(), b);
  if (!await page.evaluate(b => __review.inputs.length > b.i, b)) throw Error(`Native pointer did not reach a slider thumb: ${selector}`);
  let applyAt = null, draftPaintAt = null;
  if (options.apply) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    draftPaintAt = await page.evaluate(() => performance.now());
    applyAt = await page.evaluate(() => performance.now()); await page.locator(options.apply).click();
    await page.waitForFunction(() => !geometryDraftActive(), null, { timeout: 180000 });
  } else await page.waitForFunction(at => __review.settledScopes.some(x => x.at >= at && x.lane === state.currentView && x.applicationGeneration === state.previewGeneration[state.currentView]), released, { timeout: 180000 });
  await stable(page);
  const r = await result(page, b, released);
  r.valueBefore = valueBefore; r.valueAfter = await page.locator(selector).first().inputValue();
  r.modelBefore = modelBefore;
  r.modelAfter = await page.locator(selector).first().evaluate(x => x.dataset.path ? getValueByPath(state.adjustments,x.dataset.path) : null);
  if (applyAt !== null) { r.releaseToDraftPaintMs = draftPaintAt - released; r.applyToObservedStableMs = await page.evaluate(at => performance.now() - at, applyAt); }
  if (!r.trustedPointers || !r.inputs.length || r.valueBefore === r.valueAfter) throw Error(`No verified drag change: ${selector}`);
  return r;
}
function networkProbe(page) {
  const rows = []; const pending = new Map();
  page.on('request', request => {
    const u = new URL(request.url()); if (!u.pathname.startsWith('/api/')) return;
    const row = { path: u.pathname, query: u.search, method: request.method(), startedAt: Date.now() };
    pending.set(request, row); rows.push(row);
  });
  page.on('response', async response => {
    const row = pending.get(response.request()); if (!row) return;
    row.status = response.status(); row.headers = Object.fromEntries(Object.entries(await response.allHeaders()).filter(([k]) => /^x-(cpu|mask|sdr-match|image)/.test(k)));
  });
  page.on('requestfinished', request => { const r = pending.get(request); if (r) r.durationMs = Date.now() - r.startedAt; });
  page.on('requestfailed', request => { const r = pending.get(request); if (r) { r.durationMs = Date.now() - r.startedAt; r.failure = request.failure()?.errorText; } });
  return rows;
}
function sampler() {
  const rows = [], errors = []; let buffer = '';
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'sample-process-memory.ps1'), '-RootProcessId', process.env.HDR_FINISHER_ELECTRON_MAIN_PID], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); try { if (line) rows.push(JSON.parse(line)); } catch { errors.push(line); } } });
  child.stderr.on('data', chunk => errors.push(String(chunk))); child.on('error', e => errors.push(String(e)));
  return { rows, errors, stop: () => child.kill() };
}
function write(file, report) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2)); }
function manifest(project) {
  const sha = file => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sources = [process.argv[1], __filename, path.join(__dirname,'heavy-project-drag-review.js'), path.join(__dirname,'../run-in-electron.js'), path.join(__dirname,'../../frontend/app.js')];
  return { createdAt: new Date().toISOString(), project, projectSha256: sha(project), codeSha256: Object.fromEntries([...new Set(sources)].filter(fs.existsSync).map(file=>[path.relative(process.cwd(),file),sha(file)])), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), host: 'Electron disposable profile', measurementOnly: true };
}
module.exports = { stable, open, reveal, mark, result, drag, networkProbe, sampler, write, manifest };
