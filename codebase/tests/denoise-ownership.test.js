const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { HDRLatestWorkQueue } = require('../frontend/latest-work-queue.js');

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
