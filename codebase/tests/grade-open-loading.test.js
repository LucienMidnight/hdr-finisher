const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { declarations } = require('./frontend-source.js');
function harness() {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const panels = [0, 1].map(() => ({ inert: false, setAttribute() {}, removeAttribute() {} }));
  const events = [];
  const c = {
    performance, console, setTimeout, clearTimeout, URLSearchParams,
    location:{origin:'http://test'},HDRGradeOpening:{create:()=>({connect:async()=> 'renderer',acknowledge(){},retire(){},close(){},reset(){}})},
    addEventListener() {},
    state: { session: { session_id: 'old' }, editDocument: {}, documentDirty: true,
      importGeneration: 0, projectOpenGeneration: 0, byteUploadQueue: Promise.resolve(),
      activeWorkflow: 'import', gpuPreview: { resetSession() {} } },
    document: { querySelectorAll: () => panels }, els: { scopeFreshness: { classList: { remove() {} } } },
    fetch: async () => ({}),
    status: { post: e => events.push(e), clear() {} },
    HDRGradeSaving: { prepare: async () => null },
    projectIo: { createImportJob: () => pending, cancelImportJob: async () => {} },
    activateWorkflowTab: tab => { c.state.activeWorkflow = tab; },
    claimSessionReplacement: () => ++c.state.importGeneration,
    retireActiveSession() {}, clearPreviewImage: () => events.push('clear'), clearComparisonPreview() {},
    drawHistogram: () => events.push('clear-scopes'), renderSourceFilename: name => events.push(name),
    renderReadouts() {}, renderSessionChrome() {}, updateExportAvailability() {}, setIndeterminatePreviewMessage() {},
    setImportCancelVisible() {}, hidePreviewMessage() {}, showUploadError: error => events.push(error),
  };
  c.window = c;
  vm.createContext(c);
  const frontend = name => fs.readFileSync(path.join(__dirname, '../frontend', name), 'utf8');
  const { retireActiveSession, setImportCancelVisible, showUploadError } = c;
  for (const name of ['session-import.js', 'project-documents.js', 'scope-requests.js', 'zoom-navigation.js']) {
    vm.runInContext(frontend(name), c);
  }
  vm.runInContext(declarations('gradeSourceIdentity', 'microGrainPreviewKey', 'previewSourceCapacityRefused'), c);
  const realRetirement = c.retireActiveSession;
  Object.assign(c, { retireActiveSession, setImportCancelVisible, showUploadError });
  c.renderSourceFilename = name => events.push(name);
  return { c, panels, events, resolve, realRetirement };
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
test('RAW redevelopment keeps the current picture and releases GPU work before submitting the decode', async () => {
  const { c, panels, events, resolve } = harness();
  let allowRelease, releaseStarted, jobStarted;
  const release = new Promise(r => { allowRelease = r; });
  const retiring = new Promise(r => { releaseStarted = r; });
  const decoding = new Promise(r => { jobStarted = r; });
  const originalSession = c.state.session;
  const zoomWork = new AbortController();
  c.state.zoomRefinementTimer = setTimeout(() => zoomWork.abort(), 0);
  c.state.zoomScopeTimer = setTimeout(() => zoomWork.abort(), 0);
  const verifyGradeRecovery = trackGradeRecovery(c, events);
  const createImportJob = c.projectIo.createImportJob;
  c.state.activeWorkflow = 'grade';
  c.state.gpuPreview.releaseForSourceReplacement = () => {
    releaseStarted();
    return release;
  };
  c.projectIo.createImportJob = (...args) => {
    jobStarted();
    events.push('decode');
    return createImportJob(...args);
  };

  const opened = c.openStagedDesktopSource({ path: 'D:/photos/first.ARW', replaceSessionId: 'old' });
  await retiring;
  assert.equal(c.state.session, originalSession);
  assert.ok(panels.every(panel => panel.inert));
  assert.equal(events.includes('decode'), false);
  assert.equal(c.state.zoomRefinementTimer, 0);
  assert.equal(c.state.zoomScopeTimer, 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(zoomWork.signal.aborted, false);
  assert.equal(events.includes('clear'), false);

  allowRelease();
  await decoding;
  resolve({ response: { ok: false }, payload: { detail: 'Source is missing.' } });
  await opened;
  assert.equal(c.state.session, originalSession);
  assert.equal(events.includes('clear'), false);
  assert.ok(panels.every(panel => !panel.inert));
  await verifyGradeRecovery();
});

test('unchanged RAW Apply keeps the finished picture but publishes the usual save state and status', async () => {
  const { c, events } = harness();
  const editDocument = { local_adjustments: [], source: { durable_path: '/photos/a.ARW' }, hdr_reference_white_nits: 203 };
  const oldSession = { session_id: 'old', source: { suffix: '.arw', filename: 'a.ARW' }, edit_document: editDocument };
  const picture = { exact: true, sourceSerial: 123 };
  const runtime = { hdr: { status: 'ready' } };
  Object.assign(c.state, { session: oldSession, editDocument, editRevision: 8, documentDirty: false,
    activeWorkflow: 'grade', currentView: 'hdr', zoomMode: 'fit', compareLayout: 'single',
    acceptedPresentation: picture, denoiseRuntime: runtime });
  const viewport = { scrollLeft: 0, scrollTop: 0, scrollWidth: 100, clientWidth: 100, scrollHeight: 100, clientHeight: 100 };
  Object.assign(c.els, { dropzone: viewport, applyRawSettings: {}, rawSettingsPanel: { dataset: {} },
    lensMode: { value: 'auto' }, lensDistortion: { checked: true }, lensChromaticAberration: { checked: true },
    lensVignetting: { checked: true }, lensFocal: {}, lensAperture: {}, lensDistance: {} });
  const noOp = () => {};
  Object.assign(c, { desktop: { grantSourcePath: async file => ({ path: file, grant: 'file-token' }) },
    geometryDraftActive: () => false, holdingNativeDenoisePictureForFit: () => false,
    scopePresentationMatches: frame => frame === picture, viewerState: () => ({ status: 'ready' }),
    clamp: (value, lo, hi) => Math.max(lo, Math.min(hi, value)), applyZoomGeometry: noOp,
    applyNewSessionPreferences: noOp, loadDenoiseDocument: noOp, recordAcknowledgedLocals: noOp,
    renderSession: noOp, renderLocalAdjustments: noOp, seedExportFieldsFromSession: noOp,
    prepareInactivePreview: noOp, refreshOverlayAndScopesImmediately: noOp,
    syncDesktopDocumentState: () => events.push(['save', c.state.documentDirty, c.state.editRevision]),
    retireActiveSession: (_id, { retainPreview }) => assert.ok(retainPreview),
    renderGpuDraft: () => assert.fail('redrew the already exact preview') });
  c.state.gpuPreview.releaseForSourceReplacement = () => assert.fail('released GPU resources');
  c.state.gpuPreview.resetSession = () => assert.fail('reset GPU resources');
  c.HDRGradeSaving.hasGrade = () => false;
  c.HDRGradeSaving.activated = noOp;
  c.projectIo.createImportJob = () => assert.fail('started a new import');
  c.projectIo.reuseRawApply = async (_fetch, selection, revision) => {
    assert.equal(selection.grant, 'file-token');
    assert.equal(selection.rawImportSettings.lens.mode, 'auto');
    assert.equal(revision, 8);
    return { ...oldSession, dirty: true, edit_revision: 9 };
  };
  await c.applyRawImportSettings();
  assert.equal(c.state.acceptedPresentation, picture);
  assert.equal(c.state.denoiseRuntime, runtime);
  assert.deepEqual(events.find(e => e[0] === 'save'), ['save', true, 9]);
  assert.ok(events.some(e => e.id === 'import' && e.severity === 'success' && e.message === 'Source imported.'));
  assert.equal(c.els.applyRawSettings.disabled, false);
});

test('RAW reuse refusal or connection failure still releases the GPU and submits a redevelopment', async () => {
  for (const reject of [false, true]) {
    const { c, events, resolve } = harness();
    c.state.editRevision = 8;
    c.state.previewGeneration = {};
    c.suspendGradeInstruments = () => {};
    c.settlePreview = async () => {};
    c.refreshOverlayAndScopesImmediately = () => {};
    c.state.gpuPreview.releaseForSourceReplacement = async () => events.push('release');
    c.projectIo.reuseRawApply = async () => {
      events.push('check');
      if (reject) throw Error('Connection failed');
      return null;
    };
    const create = c.projectIo.createImportJob;
    c.projectIo.createImportJob = (...args) => { events.push('develop'); return create(...args); };
    resolve({ response: { ok: false }, payload: { detail: 'Import failed.' } });
    await c.openStagedDesktopSource({ path: '/photos/a.ARW', replaceSessionId: 'old', checkRawReuse: true });
    assert.deepEqual(events.filter(e => ['check', 'release', 'develop'].includes(e)), ['check', 'release', 'develop']);
  }
});

function trackGradeRecovery(c, events) {
  const originalSession = c.state.session;
  const accepted = { lane: 'sdr', generation: 7, geometrySignature: 'original', exact: true,
    sourceSerial: 42, transport: 'WebGPU' };
  Object.assign(c.state, { activeWorkflow: 'grade', currentView: 'sdr', previewGeneration: { sdr: 7 },
    acceptedPresentation: accepted, zoomMode: 'custom', zoomPercent: 78 });
  c.els.previewCanvas = { style: { display: 'block' } };
  c.geometrySignature = () => 'original';
  Object.assign(accepted, c.scopePresentationIdentity('sdr'));
  c.state.gpuPreview.available = true;
  c.state.gpuPreview.resetSession = sessionId => events.push(['gpu-source', sessionId]);
  c.suspendGradeInstruments = () => events.push('suspended');
  let finishSettle;
  const settled = new Promise(resolve => { finishSettle = resolve; });
  let request;
  c.settlePreview = async (lane, options) => {
    events.push(['settle', lane]);
    request = options;
    await settled;
    c.state.acceptedPresentation = { ...accepted, ...c.scopePresentationIdentity(lane), sourceSerial: 43 };
  };
  let instrumentsResumed;
  const resumed = new Promise(resolve => { instrumentsResumed = resolve; });
  c.refreshOverlayAndScopesImmediately = () => {
    events.push('instruments');
    instrumentsResumed(c.gpuScopeEligible('sdr'));
  };
  assert.equal(c.gpuScopeEligible('sdr'), true);
  return async () => {
    assert.equal(c.state.session, originalSession);
    assert.equal(c.state.rawRedevelopGeneration, null);
    assert.equal(c.state.acceptedPresentation.exact, false);
    assert.equal(c.gpuScopeEligible('sdr'), false);
    assert.deepEqual(events.filter(Array.isArray), [['gpu-source', 'old'], ['settle', 'sdr']]);
    assert.equal(request.applicationGeneration, 7);
    assert.equal(request.preservePicture, true);
    assert.equal(c.state.zoomPercent, 78);
    assert.equal(events.includes('clear'), false);
    assert.equal(events.includes('instruments'), false);
    finishSettle();
    assert.equal(await resumed, true);
  };
}

test('RAW redevelopment cancelled by the backend restores the retained Grade preview', async () => {
  const { c, panels, events, resolve } = harness();
  const verifyGradeRecovery = trackGradeRecovery(c, events);
  c.state.gpuPreview.releaseForSourceReplacement = async () => {};
  const opened = c.openStagedDesktopSource({ path: 'D:/photos/first.ARW', replaceSessionId: 'old' });
  resolve({ response: { ok: true }, payload: { job_id: 'raw', state: 'cancelled' } });
  await opened;
  assert.ok(panels.every(panel => !panel.inert));
  await verifyGradeRecovery();
});

test('cancelling a RAW redevelopment restores Grade only after the cancel request and only once', async () => {
  const { c, panels, events, resolve } = harness();
  const verifyGradeRecovery = trackGradeRecovery(c, events);
  c.state.gpuPreview.releaseForSourceReplacement = async () => {};
  let pollStarted, finishPoll, acknowledgeCancel;
  const polling = new Promise(resolve => { pollStarted = resolve; });
  const poll = new Promise(resolve => { finishPoll = resolve; });
  c.projectIo.pollImportJob = () => { pollStarted(); return poll; };
  const cancelAcknowledged = new Promise(resolve => { acknowledgeCancel = resolve; });
  c.projectIo.cancelImportJob = () => cancelAcknowledged;
  const opened = c.openStagedDesktopSource({ path: 'D:/photos/first.ARW', replaceSessionId: 'old' });
  resolve({ response: { ok: true }, payload: { job_id: 'raw', state: 'developing' } });
  await polling;
  const cancelled = c.cancelActiveImport();
  finishPoll({ response: { ok: true }, payload: { job_id: 'raw', state: 'cancelled' } });
  await opened;
  assert.equal(events.some(Array.isArray), false);
  assert.ok(panels.every(panel => panel.inert));
  acknowledgeCancel();
  await cancelled;
  assert.ok(panels.every(panel => !panel.inert));
  await verifyGradeRecovery();
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
    const contents = new EventEmitter();
    let loading = true; contents.isLoadingMainFrame = () => loading; contents.getURL = () => 'http://127.0.0.1/';
    let finished = false;
    const flight = waitForInitialLoad({ evaluate: (fn, argument) => fn({ BrowserWindow: { getAllWindows: () => [{ webContents: contents }] } }, argument) },
      { waitForURL: async () => {} }).then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    if (failed) {
      const rejection = assert.rejects(flight, /ERR_CONNECTION_REFUSED/);
      contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', '', true);
      await rejection;
    } else {
      contents.emit('did-finish-load');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(finished, false);
      loading = false; contents.emit('did-stop-loading'); await flight;
      assert.equal(finished, true);
    }
    assert.equal(contents.listenerCount('did-fail-load'), 0);
  }
});

async function activateAtZoom({
  replace = true, previousSize = [6000, 4000], size = [6000, 4000],
  pan = [800, 600], extent = [1600, 1200], rotation = 0, pictureVisible = true, geometryDraft = false,
  nativeDetail = false, cpuDetail = false, capacityRefusal = false,
} = {}) {
  const { c } = harness();
  const view = { scrollLeft: pan[0], scrollTop: pan[1], clientWidth: 1000, clientHeight: 700 };
  const geometry = { rotation };
  const session = {
    session_id: replace ? 'old' : 'new',
    source: { width: size[0], height: size[1] },
    adjustments: { shared: { geometry } },
    edit_document: { local_adjustments: [] },
  };
  Object.assign(c.state.session, { source: { width: previousSize[0], height: previousSize[1] } });
  Object.assign(c.state, { zoomMode: 'custom', zoomPercent: 78, adjustments: { shared: { geometry: {} } },
    denoise: { hdr: { enabled: true } } });
  c.els.dropzone = view;
  c.els.previewCanvas = { style: { display: 'block' }, hdrFrameRegion: nativeDetail ? { x: 10 } : null,
    hdrCpuMicroRegion: cpuDetail };
  c.els.chromeProofImage = { style: { display: 'none' } };
  const renders = [];
  const snapshot = () => [c.state.zoomMode, c.state.zoomPercent, view.scrollLeft, view.scrollTop];
  const noop = () => {};
  Object.assign(c, {
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    MIN_ZOOM_PERCENT: 1, MAX_ZOOM_PERCENT: 400,
    previewIsVisible: () => pictureVisible, geometryDraftActive: () => geometryDraft,
    collapseGradeModules: noop, loadDenoiseDocument: noop, recordAcknowledgedLocals: noop,
    invalidatePreview: noop, renderSession: noop, renderLocalAdjustments: noop, seedExportFieldsFromSession: noop,
    clearDenoiseDetail: () => { c.els.previewCanvas.hdrFrameRegion = null; },
    applyZoomGeometry: () => {
      if (c.holdingNativeDenoisePictureForFit()) return;
      view.scrollWidth = view.clientWidth + extent[0];
      view.scrollHeight = view.clientHeight + extent[1];
    },
    settledProxyLongEdge: () => c.state.zoomMode === 'custom' ? 4096 : 1280,
    renderGpuDraft: async (lane, { longEdge }) => {
      if (nativeDetail) {
        assert.equal(Boolean(c.els.previewCanvas.hdrFrameRegion), cpuDetail || c.state.zoomMode === 'custom');
      }
      renders.push(['gpu', longEdge, ...snapshot()]);
      if (capacityRefusal) c.state.lastGpuDraftRefusal = { reason: 'preview-source-capacity' };
      return false;
    },
    transientGpuRefusal: () => false,
    renderPreviewForLane: async (lane, display, longEdge) => renders.push(['cpu', longEdge, ...snapshot()]),
    refreshPreview: async () => renders.push(['fit', ...snapshot()]),
    requestAnimationFrame: noop, refreshOverlay: noop, refreshScopes: noop, scopeLongEdge: noop,
    prepareInactivePreview: noop, syncDesktopDocumentState: noop,
    HDRGradeSaving: { activated: noop },
  });
  await c.activateDesktopSession(session, 'grade.hdrfinisher', null, { replaceSessionId: 'old' });
  return renders;
}

test('same-photo RAW redevelopment preserves zoom and pan for the first GPU and CPU preview requests', async () => {
  assert.deepEqual(await activateAtZoom({ nativeDetail: true }), [
    ['gpu', 4096, 'custom', 78, 800, 600],
    ['cpu', 4096, 'custom', 78, 800, 600],
  ]);
});

test('opening a Grade session leaves the existing picture after a bounded source capacity refusal', async () => {
  assert.deepEqual(await activateAtZoom({ nativeDetail: true, capacityRefusal: true }), [
    ['gpu', 4096, 'custom', 78, 800, 600],
  ]);
});

test('same-photo RAW redevelopment clamps pan when the resized image has less room to scroll', async () => {
  assert.deepEqual(await activateAtZoom({ size: [2400, 1600], extent: [300, 0] }), [
    ['gpu', 4096, 'custom', 78, 300, 0],
    ['cpu', 4096, 'custom', 78, 300, 0],
  ]);
});

test('same-photo RAW redevelopment falls back to Fit if the old coordinates no longer apply', async () => {
  for (const options of [{ size: [4000, 6000] }, { rotation: 180 }, { pictureVisible: false }, { geometryDraft: true }]) {
    assert.deepEqual(await activateAtZoom({ ...options, nativeDetail: true }), [
      ['gpu', 1280, 'fit', 100, 0, 0],
      ['fit', 'fit', 100, 0, 0],
    ]);
  }
});

test('RAW redevelopment at Fit keeps the CPU Micro underlayer while recomputing geometry', async () => {
  assert.deepEqual(await activateAtZoom({ rotation: 180, nativeDetail: true, cpuDetail: true }), [
    ['gpu', 1280, 'fit', 100, 0, 0],
    ['fit', 'fit', 100, 0, 0],
  ]);
});

test('a different photo starts at Fit even when it has the same dimensions', async () => {
  const renders = await activateAtZoom({ replace: false });
  assert.deepEqual(renders.map(render => render.slice(0, -2)), [
    ['gpu', 1280, 'fit', 100],
    ['fit', 'fit', 100],
  ]);
});

test('retiring Grade stops a queued zoom refinement before it can run', async () => {
  const { c, realRetirement } = harness();
  const noop = () => {};
  Object.assign(c, {
    suspendGradeInstruments: noop, cancelRoiCatchUp: noop, cancelRoiPanRefinement: noop,
    clearNavigationThumbnail: noop, clearPreviewCache: noop,
    localComparisonMaskRequests: new Map(), localAuthoritativeMaskRequests: new Map(),
    localAuthoritativeMaskCache: new Map(), localComparisonMaskCache: new Map(),
    localComparisonCompositeCache: new Map(), localBrushMaskCanvasCache: new Map(),
    localMaskOverlayFrame: 0, pathMarchingAntFrame: 0,
  });
  c.state.localHiddenGizmoIds = new Set();
  let fired = false;
  c.state.zoomRefinementTimer = setTimeout(() => { fired = true; }, 0);
  c.state.zoomScopeTimer = setTimeout(() => { fired = true; }, 0);
  realRetirement();
  assert.equal(c.state.zoomRefinementTimer, 0);
  assert.equal(c.state.zoomScopeTimer, 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fired, false);
});
