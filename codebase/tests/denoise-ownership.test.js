const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const HDRGrainRoute = require("../frontend/grain-route");
const { HDRLatestWorkQueue } = require('../frontend/latest-work-queue.js');
const { frontendSource, declarations } = require('./frontend-source.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const calls = { saves: [], renders: [], scopes: 0, resolves: [] };
  const state = {
    session: { session_id: 'first' }, currentView: 'hdr', editRevision: 0,
    adjustments: { shared: { geometry: {} } },
    denoise: { hdr: { enabled: true, controls: {}, analysis: {} } },
    denoiseRuntime: { hdr: { generation: 0, status: 'ready', dirty: true } },
    gpuPreview: { available: true, diagnosticsSnapshot: () => ({ denoise: {} }),
      cancelDenoiseProcessing() {}, analyzeDenoiseProxy: async () => true,
      resolveDenoiseProxy: async controls => { calls.resolves.push(controls); return true; } },
  };
  const context = vm.createContext({ state, HDRGrainRoute, els: {}, console, performance, structuredClone, AbortController,
    window: { HDRLatestWorkQueue, setTimeout, clearTimeout },
    refinementProxyLongEdge: () => 1024, geometrySignature: () => '',
    renderGpuDraft: async lane => { calls.renders.push(lane); return true; },
    renderPreviewForLane: async () => true,
    renderLaneChrome() {}, invalidatePreview() {}, clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    debounceOverlayAndScopes: () => { calls.scopes++; }, markScopeUpdating() {}, restoreScopeFreshnessIfIdle() {},
    queueEditCommand: async (...args) => { calls.saves.push({ sessionId: state.session?.session_id, args }); return true; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/denoise-ui.js'), 'utf8'), context);
  function replace() {
    state.session = { session_id: 'second' };
    state.denoise = { hdr: { enabled: true, controls: {}, analysis: {} } };
    state.denoiseRuntime = { hdr: { generation: 0, status: 'ready', dirty: true } };
  }
  return { state, context, calls, replace };
}

test('Denoise off starts saving its own photo alongside a delayed redraw', async () => {
  const h = harness(), redraw = deferred();
  h.context.renderGpuDraft = () => redraw.promise;
  const pending = h.context.setDenoiseEnabled(false);
  h.replace();
  redraw.resolve();
  await pending;
  assert.equal(h.calls.saves.length, 1);
  assert.equal(h.calls.saves[0].sessionId, 'first');
  assert.equal(h.calls.saves[0].args[1].denoise.hdr.enabled, false);
});

test('a delayed Denoise save does not mirror a newer choice into linked SDR', async () => {
  const h = harness(), save = deferred();
  h.state.adjustments.sdr = { linked_to_hdr: true };
  h.state.denoise.hdr.controls.method = 'micro_grain';
  h.state.denoise.sdr = { enabled: true, controls: { method: 'standard' } };
  h.context.valuesEqual = (first, second) => JSON.stringify(first) === JSON.stringify(second);
  h.context.queueEditCommand = (command, payload) => {
    h.calls.saves.push(payload.denoise);
    return save.promise;
  };
  const pending = h.context.persistDenoiseSettings();
  h.state.denoise.hdr.controls.method = 'clean_grain';
  save.resolve(true);
  assert.equal(await pending, true);
  assert.equal(h.calls.saves[0].sdr.controls.method, 'micro_grain');
  assert.equal(h.state.denoise.sdr.controls.method, 'standard');
});

test('Denoise enable does not start analysis for a replacement photo after saving', async () => {
  const h = harness(), save = deferred();
  h.context.queueEditCommand = () => save.promise;
  let analyses = 0;
  h.state.gpuPreview.analyzeDenoiseProxy = async () => { analyses++; return true; };
  const pending = h.context.setDenoiseEnabled(true);
  h.replace();
  save.resolve(true);
  await pending;
  assert.equal(analyses, 0);
});

for (const fails of [false, true]) {
  test(`replaced Denoise analysis ignores stale ${fails ? 'failure' : 'success'}`, async () => {
    const h = harness(), analysis = deferred();
    h.state.gpuPreview.analyzeDenoiseProxy = () => analysis.promise;
    const oldRuntime = h.state.denoiseRuntime.hdr;
    const pending = h.context.recalculateDenoise();
    h.replace();
    if (fails) analysis.reject(new Error('old photo failure'));
    else analysis.resolve(true);
    assert.equal(await pending, false);
    assert.equal(oldRuntime.status, 'preparing');
    assert.equal(h.state.denoiseRuntime.hdr.status, 'ready');
    assert.deepEqual(h.calls.renders, []);
    assert.equal(h.calls.scopes, 0);
  });
}

test('queued Denoise slider work is discarded when its photo is replaced', async () => {
  const h = harness(), resolve = deferred();
  h.state.gpuPreview.resolveDenoiseProxy = controls => {
    h.calls.resolves.push(controls);
    return resolve.promise;
  };
  const first = h.context.updateLiveDenoiseControl('amount', 0.2);
  const second = h.context.updateLiveDenoiseControl('amount', 0.8);
  h.replace();
  resolve.resolve(true);
  await Promise.all([first, second]);
  assert.equal(h.calls.resolves.length, 1);
  assert.deepEqual(h.calls.renders, []);
  assert.equal(h.state.denoiseWholeFrameStale, undefined);
});

test('Denoise analysis and toggle still finish for their original photo', async () => {
  const h = harness();
  await h.context.setDenoiseEnabled(true);
  assert.equal(h.state.denoiseRuntime.hdr.status, 'ready');
  assert.deepEqual(h.calls.renders, ['hdr']);
  await h.context.setDenoiseEnabled(false);
  assert.equal(h.state.denoiseRuntime.hdr.status, 'off');
  assert.equal(h.calls.saves.length, 2);
});

test('Recalculate retries a failed save when enabling Denoise', async () => {
  const h = harness();
  let saves = 0;
  h.context.queueEditCommand = async () => {
    if (++saves === 1) throw Error('The save failed');
    return true;
  };
  await h.context.setDenoiseEnabled(true);
  assert.equal(h.state.denoiseRuntime.hdr.status, 'error');
  assert.match(h.state.denoiseRuntime.hdr.error, /try Recalculate/i);
  assert.equal(await h.context.recalculateDenoise('hdr', { force: true }), true);
  assert.equal(saves, 2);
  assert.equal(h.state.denoiseRuntime.hdr.status, 'ready');
});

test('Denoise enable retains its lane when the save spans a lane switch', async () => {
  const h = harness(), save = deferred();
  h.state.denoise.sdr = { enabled: true, controls: {}, analysis: {} };
  h.state.denoiseRuntime.sdr = { generation: 0, status: 'ready', dirty: true };
  h.context.queueEditCommand = () => save.promise;
  const lanes = [];
  h.state.gpuPreview.analyzeDenoiseProxy = async (_, lane) => { lanes.push(lane); return true; };
  const pending = h.context.setDenoiseEnabled(true);
  h.state.currentView = 'sdr';
  save.resolve(true);
  await pending;
  assert.deepEqual(lanes, ['hdr']);
});

test('replacing a document in the same session invalidates its old Denoise analysis', async () => {
  const h = harness(), analysis = deferred();
  h.state.gpuPreview.analyzeDenoiseProxy = () => analysis.promise;
  const pending = h.context.recalculateDenoise();
  h.replace();
  h.state.session.session_id = 'first';
  analysis.resolve(true);
  assert.equal(await pending, false);
  assert.deepEqual(h.calls.renders, []);
});

function renderer(fetch) {
  const context = vm.createContext({ window: {}, performance, console, fetch, AbortController, AbortSignal, DOMException, URLSearchParams,
    GPUTextureUsage: { TEXTURE_BINDING: 1, COPY_DST: 2 } });
  for (const file of ['webgpu-shaders.js', 'webgpu-preview.js']) {
    vm.runInContext(frontendSource(file), context);
  }
  return new context.window.HDRWebGPUPreview(null);
}

test('cold Grade Fit prepares Grain with the native noise measurement', async () => {
  const h = harness();
  const requests = [];
  h.state.session.source = { width: 5202, height: 3464 };
  h.state.denoise.hdr.controls.method = 'clean_grain';
  const gpu = h.state.gpuPreview = renderer(async (url, options) => {
    requests.push([url, options?.method]);
    return url.includes('/denoise-measurement/')
      ? Response.json({ a: 0, b: 0, c: 0 }) : new Response(null, { status: 409 });
  });
  gpu.available = true;
  gpu.sessionId = 'first';
  gpu.deferDenoiseWarm = true;
  assert.equal(await h.context.recalculateDenoise(), false);
  assert.equal(requests.length, 2);
  assert.match(requests[0][0], /denoise-measurement\/hdr\?long_edge=5202&/);
  assert.match(requests[1][0], /denoise-grain\/hdr\?long_edge=1024&/);
  assert.equal(requests[1][1], 'POST');
  assert.equal(h.state.denoiseRuntime.hdr.status, 'dirty');
  assert.equal(h.state.denoiseRuntime.hdr.error, '');
  assert.equal(h.state.denoiseRuntime.hdr.dirty, true);
  assert.deepEqual(h.calls.renders, []);
});

test('Grade shares a Grain recalculation across generated renditions and isolates an authored SDR base', async () => {
  const h = harness();
  h.state.denoise.hdr.controls.method = 'clean_grain';
  h.state.denoise.sdr = structuredClone(h.state.denoise.hdr);
  h.state.denoiseRuntime.sdr = { generation: 0 };
  h.state.adjustments.sdr = { use_authored_base: true };
  const calls = [];
  h.state.gpuPreview.analyzeDenoiseProxy = async (_, lane, _grade, _edge, _revision, _source, _controls, refresh) => {
    calls.push([lane, refresh]);
    return true;
  };
  const calculate = (lane, force = false) => h.context.recalculateDenoise(lane, { force, renderAfter: false });

  assert.equal(await calculate('hdr', true), true);
  assert.equal(await calculate('sdr'), true);
  h.state.editDocument = { source: { luminance: { sdr_rendition: 'authored' } } };
  assert.equal(await calculate('sdr'), true);
  assert.equal(await calculate('sdr', true), true);
  assert.equal(await calculate('hdr'), true);
  h.state.adjustments.sdr.use_authored_base = false;
  assert.equal(await calculate('sdr', true), true);
  assert.equal(await calculate('hdr'), true);
  h.replace();
  assert.equal(await calculate('hdr'), true);

  assert.deepEqual(calls, [
    ['hdr', 1], ['sdr', 1], ['sdr', 0], ['sdr', 1],
    ['hdr', 1], ['sdr', 2], ['hdr', 2], ['hdr', 0],
  ]);
});

test('expired Grain tiles are not user cancels and a fresh preparation can be read', async () => {
  const requests = [];
  const uploads = [];
  let destroyed = 0;
  const gpu = renderer(async url => {
    requests.push(url);
    return url.includes('/old?') ? new Response(null, { status: 409 }) : new Response(new Uint8Array(64));
  });
  gpu.device = {
    createTexture: () => ({ destroy: () => { destroyed++; } }),
    queue: { writeTexture: (_, body) => uploads.push(body.byteLength) },
  };
  gpu.denoiseTileBudget = () => 0;
  const before = { url: '/denoise-grain/hdr', token: 'old' };
  const after = { url: before.url, token: 'new' };
  const frame = { width: 2, height: 2 };
  const tile = { x: 0, y: 0, ...frame };
  const load = grain => gpu.preparedGrainTile(grain, tile, frame);
  const expired = error => error.grainPreparationReplaced && error.name !== 'AbortError';
  await assert.rejects(load(before), expired);
  await assert.rejects(load(before), expired);
  assert.equal(requests.length, 1);
  assert.equal(destroyed, 1);
  assert.deepEqual(uploads, []);
  assert.equal((await load(after)).grainToken, 'new');
  assert.deepEqual(uploads, [64]);
});

test('prepared Grain can warm a native viewport without allocating a GPU texture', async () => {
  const seen = [];
  const gpu = renderer(async url => {
    seen.push(new URLSearchParams(url.split('?')[1]));
    return new Response(null, { status: 204 });
  });
  const grain = { url: '/denoise-grain/hdr', token: 'viewport' };
  const region = { x: 1024, y: 512, width: 2048, height: 1024 };
  const result = await gpu.requestPreparedGrain(grain, region, { width: 7968, height: 5320 }, null, true);
  assert.equal(result.status, 204);
  assert.deepEqual(Object.fromEntries(seen[0]), {
    x: '1024', y: '512', width: '2048', height: '1024',
    frame_width: '7968', frame_height: '5320', warm_only: 'true',
  });
});

test('a stale edit revision retries against the latest edit without reporting an error', async () => {
  const h = harness(), first = deferred(), edit = deferred();
  h.state.editCommandQueue = edit.promise;
  const revisions = [];
  h.state.gpuPreview.analyzeDenoiseProxy = async (...args) => {
    revisions.push(args[4]);
    if (revisions.length === 1) {
      await first.promise;
      assert.equal(args.at(-1).isCurrent(), true);
      throw Object.assign(new Error('Stale Denoise revision dropped.'), { status: 409 });
    }
    return true;
  };
  const pending = h.context.recalculateDenoise('hdr', { renderAfter: false });
  first.resolve();
  await Promise.resolve();
  assert.equal(h.state.editRevision, 0);
  h.state.editRevision++;
  edit.resolve(true);
  assert.equal(await pending, true);
  assert.deepEqual(revisions, [0, 1]);
  assert.equal(h.state.denoiseRuntime.hdr.status, 'ready');
  assert.equal(h.state.denoiseRuntime.hdr.error, '');
});

test('source invalidation clears busy status and cancels the owning preparation', async () => {
  const h = harness(), result = deferred();
  let signal;
  h.state.gpuPreview.analyzeDenoiseProxy = async (...args) => {
    signal = args.at(-1).signal;
    return result.promise;
  };
  const pending = h.context.recalculateDenoise();
  assert.equal(h.state.denoiseRuntime.hdr.status, 'preparing');
  h.context.invalidateDenoisePreparation('hdr', { dirty: true });
  assert.equal(signal.aborted, true);
  assert.equal(h.state.denoiseRuntime.hdr.status, 'dirty');
  result.resolve(true);
  assert.equal(await pending, false);
  assert.deepEqual(h.calls.renders, []);
});

test('a rapid on-off-on and two slider releases prepare only the final saved controls', async () => {
  const h = harness();
  const settings = h.state.denoise.hdr;
  settings.controls.method = 'clean_grain';
  const controls = [];
  h.state.gpuPreview.analyzeDenoiseProxy = async (...args) => { controls.push(args[6]); return true; };
  const toggles = [h.context.setDenoiseEnabled(true), h.context.setDenoiseEnabled(false), h.context.setDenoiseEnabled(true)];
  const edits = [h.context.commitDenoiseControl('luminance', 0.3), h.context.commitDenoiseControl('luminance', 0.6)];
  await Promise.all([...toggles, ...edits]);
  assert.deepEqual(controls.map(value => value.luminance), [0.6]);
  assert.equal(h.state.denoiseRuntime.hdr.status, 'ready');
});

test('retained Micro Grain CPU fallback becomes ready again immediately on enable', async () => {
  const h = harness();
  h.state.denoise.hdr.controls.method = 'micro_grain';
  const runtime = h.state.denoiseRuntime.hdr;
  runtime.microBackup = HDRGrainRoute.microFallback(null, { grainReason: "gpu_unavailable" });
  await h.context.setDenoiseEnabled(true);
  assert.equal(runtime.status, 'ready');
  assert.equal(runtime.dirty, false);
});

test('new Denoise lanes default to Clean Grain while a saved method-less lane keeps Simple', () => {
  const h = harness();
  vm.runInContext(declarations('defaultDenoiseLane', 'defaultDenoiseDocument'), h.context);
  const settings = h.state.denoise;
  h.context.loadDenoiseDocument({ denoise: { hdr: { enabled: true, controls: { amount: 0.6 } } } });
  assert.equal(h.state.denoise.hdr.controls.method, 'standard');
  assert.equal(h.state.denoise.hdr.controls.amount, 0.6);
  assert.equal(h.state.denoise.sdr.controls.method, 'clean_grain');
  h.context.loadDenoiseDocument({});
  assert.equal(h.state.denoise.hdr.controls.method, 'clean_grain');
  assert.equal(h.state.denoise.hdr.enabled, false);
  assert.notEqual(h.state.denoise, settings);
});

test('Denoise sliders and Splotch Size stay editable through preparation and error', () => {
  const h = harness();
  vm.runInContext(declarations('defaultDenoiseLane', 'defaultDenoiseDocument'), h.context);
  const element = () => ({ classList: { toggle() {} }, setAttribute() {}, closest: element, querySelector: () => null });
  Object.assign(h.context.els, Object.fromEntries([
    'Bypass', 'Method', 'GrainControls', 'MicroControls', 'Amount', 'Detail', 'AdvancedToggle',
    'CleanControls', 'CleanFringes', 'ProtectEdges', 'SplotchSize', 'Luminance', 'Color', 'Finest', 'Fine', 'Medium', 'Coarse',
    'Evenness', 'Splotches', 'Recalculate', 'Status', 'AmountValue', 'LuminanceValue', 'ColorValue',
    'DetailValue', 'FinestValue', 'FineValue', 'MediumValue', 'CoarseValue', 'EvennessValue', 'SplotchesValue',
  ].map(name => ['denoise' + name, element()])), { denoiseMicroSliders: [] });
  Object.assign(h.context, { valuesEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    updateRangeVisual() {}, renderDenoiseNoiseViewControl() {} });
  h.state.denoise.hdr = { ...vm.runInContext("defaultDenoiseDocument().hdr", h.context), enabled: true };
  for (const status of ['preparing', 'recalculating', 'error']) {
    h.state.denoiseRuntime.hdr.status = status;
    h.context.renderDenoiseControls();
    assert.equal(h.context.els.denoiseAmount.disabled, false, status);
    assert.equal(h.context.els.denoiseSplotchSize.disabled, false, status);
    assert.equal(h.context.els.denoiseRecalculate.disabled, status !== 'error', status);
  }
  h.state.denoise.hdr.controls.clean_splotches = false;
  h.context.renderDenoiseControls();
  assert.equal(h.context.els.denoiseCleanFringes.checked, true);
  assert.equal(h.context.els.denoiseProtectEdges.checked, false);
  assert.equal(h.context.els.denoiseSplotchSize.disabled, true);
  assert.equal(h.context.els.denoiseProtectEdges.disabled, true);
  // An older grade saved with splotch cleanup off shows the slider at 0%.
  assert.equal(h.context.els.denoiseSplotches.value, '0');
  assert.equal(h.context.els.denoiseSplotches.disabled, false);
});

test('Reset from Simple prepares and draws the Clean Grain defaults', async () => {
  const h = harness();
  vm.runInContext(declarations('defaultDenoiseLane', 'defaultDenoiseDocument', 'resetControlGroup'), h.context);
  h.state.denoise.hdr.controls.method = 'standard';
  let method;
  h.state.gpuPreview.analyzeDenoiseProxy = async (...args) => { method = args[6].method; return true; };
  const originalCommit = h.context.commitDenoiseControl;
  let pending;
  h.context.commitDenoiseControl = (...args) => { pending = originalCommit(...args); };
  h.context.resetControlGroup('denoise');
  await pending;
  assert.equal(h.state.denoise.hdr.controls.method, 'clean_grain');
  assert.equal(method, 'clean_grain');
  assert.deepEqual(h.calls.renders, ['hdr']);
});
