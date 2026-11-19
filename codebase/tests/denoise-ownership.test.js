const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { HDRLatestWorkQueue } = require('../frontend/latest-work-queue.js');
const { HDRRenderFailurePolicy } = require('../frontend/render-failure.js');
const { frontendSource } = require('./frontend-source.js');

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
  const context = vm.createContext({ state, els: {}, console, performance,
    window: { HDRLatestWorkQueue, setTimeout },
    refinementProxyLongEdge: () => 1024, geometrySignature: () => '',
    renderGpuDraft: async lane => { calls.renders.push(lane); },
    renderLaneChrome() {}, clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    debounceOverlayAndScopes: () => { calls.scopes++; },
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

test('Denoise off saves its own photo before a delayed redraw and photo switch', async () => {
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
  const context = vm.createContext({ window: {}, performance, console, fetch, DOMException, URLSearchParams,
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
  assert.equal(h.state.denoiseRuntime.hdr.status, 'preparing');
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

test('expired Grain tile is cancelled and the replacement can be read', async () => {
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
  const policy = new HDRRenderFailurePolicy();
  await assert.rejects(load(before), error => policy.record(error).kind === 'superseded');
  await assert.rejects(load(before), { name: 'AbortError' });
  assert.equal(requests.length, 1);
  assert.equal(destroyed, 1);
  assert.deepEqual(uploads, []);
  assert.equal((await load(after)).grainToken, 'new');
  assert.deepEqual(uploads, [64]);
});
