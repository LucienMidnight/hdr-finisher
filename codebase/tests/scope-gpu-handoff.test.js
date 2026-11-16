const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { declaration } = require('./frontend-source.js');

test('first GPU picture defers CPU scopes, while an accepted CPU picture retains fallback', async () => {
  let cpu = 0;
  const state = { session: { session_id: 'photo' }, currentView: 'hdr', activeWorkflow: 'grade',
    scopeGeneration: 0, scopeMode: 'histogram', acceptedPresentation: null };
  const ctx = vm.createContext({ state, document: { hidden: false },
    window: { HDRWholeImagePreviewPipe: { edgeFor: (_, edge) => edge } },
    els: { previewCanvas: { style: { display: 'none' } } },
    geometryDraftActive: () => false, localsBypassed: () => false, activeScopeRegion: () => null,
    gpuScopeEligible: () => false, gpuPreviewEligible: () => true, markScopeUpdating() {},
    enqueueScopeRequest: request => { cpu++; request.resolve(true); },
  });
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
    gpuScopeRequestInFlight: { generation: 2 } };
  const ctx = vm.createContext({ state, AbortController, document: { hidden: false },
    markScopeUpdating() {}, els: { scopeFreshness: { classList: { remove() { cleared = true; } } } },
    fetch: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))),
  });
  vm.runInContext(declaration('runScopeRequest'), ctx);
  let resolved;
  const work = ctx.runScopeRequest({ sessionId: 'photo', lane: 'hdr', mode: 'histogram',
    generation: 1, resolution: { bins: 256, columns: 256 }, resolve: value => { resolved = value; } });
  state.scopeRequestInFlight.controller.abort();
  assert.equal(await work, false);
  assert.equal(resolved, false);
  assert.equal(cleared, false);
  assert.equal(state.scopeRequestInFlight, null);
});
