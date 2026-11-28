const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { declaration, declarations } = require('./frontend-source.js');

test('first GPU picture defers CPU scopes, while an accepted CPU picture retains fallback', async () => {
  let cpu = 0;
  const state = { session: { session_id: 'photo' }, currentView: 'hdr', activeWorkflow: 'grade',
    scopeGeneration: 0, scopeMode: 'histogram', acceptedPresentation: null, previewGeneration: { hdr: 1 } };
  const ctx = vm.createContext({ state, document: { hidden: false },
    window: { HDRWholeImagePreviewPipe: { edgeFor: (_, edge) => edge } },
    els: { previewCanvas: { style: { display: 'none' } } },
    geometryDraftActive: () => false, scopePresentationMatches: () => true, scopeWaitingForWholePicture: () => false, localsBypassed: () => false, activeScopeRegion: () => null,
    gpuScopeEligible: () => false, gpuPreviewEligible: () => true, markScopeUpdating() {},
    enqueueScopeRequest: request => { cpu++; request.resolve(true); },
    geometrySignature: () => '{}', gradeSourceIdentity: () => 'source', microGrainPreviewKey: () => null,
    cancelGpuScopeRequests() {}, cpuMicroPreviewSelected: () => false, microGrainPreviewRequest: () => null,
  });
  vm.runInContext(declarations('scopePresentationIdentity', 'scopePresentationMatches'), ctx);
  vm.runInContext(declaration('refreshScopes'), ctx);
  assert.equal(await ctx.refreshScopes(), false);
  assert.equal(cpu, 0);
  assert.equal(state.scopeAwaitingPresentation.sessionId, 'photo');
  state.acceptedPresentation = { transport: 'PNG', lane: 'hdr' };
  assert.equal(await ctx.refreshScopes(), true);
  assert.equal(cpu, 1);
});

test('new GPU scope cancels obsolete CPU work and drops queued older scopes', async () => {
  const events = [];
  const state = {
    scopeRequestInFlight: { generation: 1, controller: { abort: () => events.push('abort') } },
    pendingScopeRequest: { generation: 2, resolve: value => events.push(value) },
  };
  const ctx = vm.createContext({ state, runQueuedGpuScopeRequest: request => { events.push(request.generation); request.resolve(true); } });
  vm.runInContext(declaration('enqueueGpuScopeRequest'), ctx);
  assert.equal(await ctx.enqueueGpuScopeRequest({ generation: 3 }), true);
  assert.deepEqual(events, ['abort', false, 3]);
  assert.equal(state.pendingScopeRequest, null);
});

test('an older GPU request cannot cancel newer CPU scope fallback', async () => {
  const state = { scopeRequestInFlight: { generation: 5, controller: { abort() { throw Error('cancelled current fallback'); } } },
    pendingScopeRequest: { generation: 6, resolve() { throw Error('dropped current fallback'); } } };
  const ctx = vm.createContext({ state, runQueuedGpuScopeRequest: request => request.resolve(true) });
  vm.runInContext(declaration('enqueueGpuScopeRequest'), ctx);
  assert.equal(await ctx.enqueueGpuScopeRequest({ generation: 4 }), true);
  assert.equal(state.pendingScopeRequest.generation, 6);
});

test('cancelled CPU work cannot mark a replacement GPU scope fresh', async () => {
  let cleared = false;
  const state = { activeWorkflow: 'grade', session: { session_id: 'photo' }, currentView: 'hdr',
    scopeGeneration: 1, scopeMode: 'histogram', gpuScopeRequestInFlight: { generation: 2 } };
  const ctx = vm.createContext({ state, AbortController, document: { hidden: false },
    markScopeUpdating() {}, els: { scopeFreshness: { classList: { remove() { cleared = true; } } } },
    geometryDraftActive: () => false, scopePresentationMatches: () => true, scopeWaitingForWholePicture: () => false,
    scopeDisplayPeakNits: () => 1000,
    fetch: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))),
  });
  vm.runInContext(declarations('restoreScopeFreshnessIfIdle', 'runScopeRequest'), ctx);
  let resolved;
  const work = ctx.runScopeRequest({ sessionId: 'photo', lane: 'hdr', mode: 'histogram',
    generation: 1, resolution: { bins: 256, columns: 256 }, resolve: value => { resolved = value; } });
  state.scopeRequestInFlight.controller.abort();
  assert.equal(await work, false);
  assert.equal(resolved, false);
  assert.equal(cleared, false);
  assert.equal(state.scopeRequestInFlight, null);
});

test('a detached CPU scope cannot dispatch work queued behind its replacement', async () => {
  const state = { activeWorkflow: 'grade', session: { session_id: 'old' }, currentView: 'hdr',
    scopeGeneration: 1, scopeMode: 'histogram' };
  const fetches = [];
  const ctx = vm.createContext({ state, AbortController, document: { hidden: false },
    markScopeUpdating() {}, restoreScopeFreshnessIfIdle() {}, els: { scopeNote: {} },
    geometryDraftActive: () => false, scopePresentationMatches: () => true,
    scopeWaitingForWholePicture: () => false, scopeDisplayPeakNits: () => 1000,
    fetch: (url, { signal, body }) => new Promise((resolve, reject) => {
      fetches.push({ signal, resolve, reject, generation: JSON.parse(body).generation });
    }),
  });
  vm.runInContext(declarations('enqueueScopeRequest', 'runScopeRequest'), ctx);
  const request = (sessionId, generation) => new Promise(resolve => ctx.enqueueScopeRequest({
    sessionId, lane: 'hdr', mode: 'histogram', generation, resolution: { bins: 256, columns: 256 }, resolve,
  }));
  const old = request('old', 1);
  // Source replacement aborts and detaches the old work before launching the
  // new source. Abort does not settle the old request synchronously.
  state.scopeRequestInFlight.controller.abort();
  state.scopeRequestInFlight = null;
  state.session = { session_id: 'new' };
  state.scopeGeneration = 2;
  const replacement = request('new', 2);
  state.scopeGeneration = 3;
  const newest = request('new', 3);
  fetches[0].reject(fetches[0].signal.reason);
  assert.equal(await old, false);
  assert.deepEqual(fetches.map(x => x.generation), [1, 2]);
  assert.equal(state.scopeRequestInFlight.generation, 2);

  fetches[1].reject(fetches[1].signal.reason);
  assert.equal(await replacement, false);
  assert.deepEqual(fetches.map(x => x.generation), [1, 2, 3]);
  fetches[2].resolve({ ok: false, status: 503 });
  assert.equal(await newest, false);
  assert.equal(state.scopeRequestInFlight, null);
});
