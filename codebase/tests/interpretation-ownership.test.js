const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const requests = [], notices = [], renders = [];
  const state = { session: { session_id: 'first' }, importGeneration: 0, currentView: 'hdr' };
  const context = vm.createContext({ state, console,
    interpretationPayload: () => ({}),
    status: { post: value => notices.push(value) },
    setPreviewMessage() {}, setPreviewError: message => notices.push(message),
    fetch: () => { const request = deferred(); requests.push(request); return request.promise; },
    safeJson: response => response.json(),
    loadDenoiseDocument() {}, recordAcknowledgedLocals() {}, invalidatePreview() {},
    renderSession: () => renders.push(state.session.session_id), renderLocalAdjustments() {},
    renderGpuDraft: async () => true, settledProxyLongEdge: () => 1024,
    refreshOverlay() {}, refreshScopes() {}, scopeLongEdge: () => 1024,
    hidePreviewMessage() {}, prepareInactivePreview() {}, previewNeedsRefinement: () => false,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/session-import.js'), 'utf8'), context);
  context.interpretationPayload = () => ({});
  return { state, context, requests, notices, renders };
}

function reply(request, sessionId) {
  request.resolve({ ok: true, json: async () => ({ session: { session_id: sessionId, adjustments: {}, edit_document: {} } }) });
}

test('late interpretation success cannot reinstall a replaced photo', async () => {
  const h = harness();
  const pending = h.context.applyInterpretationOverride();
  h.state.session = { session_id: 'second' };
  reply(h.requests[0], 'first');
  await pending;
  assert.equal(h.state.session.session_id, 'second');
  assert.deepEqual(h.renders, []);
});

test('a new import invalidates interpretation even before it installs its session', async () => {
  const h = harness(), pending = h.context.applyInterpretationOverride();
  h.state.importGeneration++;
  reply(h.requests[0], 'first');
  await pending;
  assert.deepEqual(h.renders, []);
});

test('late interpretation failure cannot cover a replaced photo with an error', async () => {
  const h = harness(), pending = h.context.applyInterpretationOverride();
  h.state.session = { session_id: 'second' };
  h.requests[0].reject(new Error('old request failed'));
  await pending;
  assert.equal(h.notices.length, 1);
});

test('the latest interpretation request wins when replies arrive out of order', async () => {
  const h = harness(), old = h.context.applyInterpretationOverride();
  const latest = h.context.applyInterpretationOverride();
  reply(h.requests[1], 'latest');
  await latest;
  reply(h.requests[0], 'old');
  await old;
  assert.equal(h.state.session.session_id, 'latest');
  assert.deepEqual(h.renders, ['latest']);
  assert.equal(h.notices.at(-1).severity, 'success');
});
