const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function harness() {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const panels = [0, 1].map(() => ({ inert: false, setAttribute() {}, removeAttribute() {} }));
  const events = [];
  const c = {
    performance, console, setTimeout, clearTimeout,
    state: { session: { session_id: 'old' }, editDocument: {}, documentDirty: true,
      importGeneration: 0, projectOpenGeneration: 0, byteUploadQueue: Promise.resolve(),
      activeWorkflow: 'import', gpuPreview: { resetSession() {} } },
    document: { querySelectorAll: () => panels }, els: {},
    fetch: async () => ({}),
    status: { post: e => events.push(e), clear() {} },
    HDRGradeSaving: { prepare: async () => null },
    projectIo: { createImportJob: () => pending, cancelImportJob: async () => {} },
    activateWorkflowTab: tab => { c.state.activeWorkflow = tab; },
    claimSessionReplacement: () => ++c.state.importGeneration,
    retireActiveSession() {}, clearPreviewImage: () => events.push('clear'), clearComparisonPreview() {},
    drawHistogram: () => events.push('clear-scopes'), renderSourceFilename: name => events.push(name),
    renderReadouts() {}, renderSessionChrome() {}, updateExportAvailability() {}, setIndeterminatePreviewMessage() {},
    setImportCancelVisible() {}, showUploadError: error => events.push(error),
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/project-documents.js'), 'utf8'), c);
  c.renderSourceFilename = name => events.push(name);
  return { c, panels, events, resolve };
}
test('Grade loads immediately with an empty preview and locked controls, then returns to Library on failure', async () => {
  const { c, panels, events, resolve } = harness();
  const flight = c.openStagedDesktopSource({ path: 'D:/photos/first.png', fromLibrary: true });
  assert.equal(c.state.activeWorkflow, 'grade');
  assert.equal(c.state.session, null);
  assert.ok(events.includes('clear'));
  assert.ok(events.includes('clear-scopes'));
  assert.ok(panels.every(p => p.inert));
  assert.match(events.find(e => e.id === 'import').message, /first.png/);
  resolve({ response: { ok: false }, payload: { detail: 'Source is missing.' } });
  await flight;
  assert.equal(c.state.activeWorkflow, 'import');
  assert.equal(c.state.gradeOpen, null);
  assert.equal(c.state.importInProgress, false);
  assert.ok(events.includes('Source is missing.'));
});
test('a superseded open cannot clear the newer loading state or report its failure', async () => {
  const { c, events, resolve } = harness();
  const flight = c.openStagedDesktopSource({ path: 'D:/photos/first.png', fromLibrary: true });
  await Promise.resolve(); await Promise.resolve();
  c.state.importGeneration++;
  const newer = { generation: c.state.importGeneration, name: 'next.png' };
  c.state.gradeOpen = newer;
  resolve({ response: { ok: false }, payload: { detail: 'Old failure' } });
  await flight;
  assert.equal(c.state.gradeOpen, newer);
  assert.equal(events.includes('Old failure'), false);
});
test('initial Electron page completion precedes runner actions', async () => {
  const { waitForInitialLoad } = require('./electron-initial-load');
  const events = [];
  await waitForInitialLoad({ evaluate: async () => events.push('main-load-complete') }, {
    waitForURL: async (predicate, options) => {
      assert.equal(predicate(new URL('about:blank')), false);
      assert.equal(predicate(new URL('http://127.0.0.1:1234/')), true);
      assert.equal(options.waitUntil, 'load');
      events.push('page-load-complete');
    },
  });
  assert.deepEqual(events, ['page-load-complete', 'main-load-complete']);
});
test('restoring recovery skips the saved-grade load and asks only once before decoding', async () => {
  const calls = [], saved = { version: 'saved' }, recovered = { version: 'recovered' };
  let questions = 0;
  const c = {
    document: {}, state: { appPreferences: {} },
    projectIo: { responseErrorMessage: () => 'error' },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      const payload = url.endsWith('open-settings') ? { recovery: true }
        : body.action === 'attach' ? { path: 'D:/photo.png', grade: saved, recovery: recovered }
        : { session: { session_id: 'recovered', source: { filename: 'photo.png' } } };
      return { ok: true, json: async () => payload };
    },
    HDRDialogs: { choose: async () => { questions++; return 'restore'; } },
  };
  c.window = c;
  vm.createContext(c);
  const source = fs.readFileSync(path.join(__dirname, '../frontend/grade-saving.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('  async function tick()')) +
    'window.HDRGradeSaving = { prepare, open }; })();', c);
  const choice = await c.HDRGradeSaving.prepare({ path: 'D:/photo.png' });
  const result = await c.HDRGradeSaving.open({ session_id: 'initial', source: { filename: 'photo.png' } }, null, () => true, choice);
  assert.equal(questions, 1);
  assert.equal(result.session_id, 'recovered');
  const loads = calls.filter(call => call.action === 'load');
  assert.equal(loads.length, 1);
  assert.deepEqual(loads[0].document, recovered);
  assert.equal(loads[0].recovery, true);
  assert.equal(loads[0].reuse_source, true);
});
test('Electron load barrier remains blocked until main-frame completion and rejects genuine load errors', async () => {
  const { EventEmitter } = require('node:events');
  const { waitForInitialLoad } = require('./electron-initial-load');
  for (const failed of [false, true]) {
    const contents = new EventEmitter(); contents.isLoadingMainFrame = () => true;
    let finished = false;
    const flight = waitForInitialLoad({ evaluate: fn => fn({ BrowserWindow: { getAllWindows: () => [{ webContents: contents }] } }) },
      { waitForURL: async () => {} }).then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    if (failed) {
      const rejection = assert.rejects(flight, /ERR_CONNECTION_REFUSED/);
      contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', '', true);
      await rejection;
    } else {
      contents.emit('did-finish-load'); await flight;
      assert.equal(finished, true);
    }
    assert.equal(contents.listenerCount('did-fail-load'), 0);
  }
});
