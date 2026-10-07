const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { frontendSource } = require('./frontend-source.js');
const source = frontendSource('webgpu-preview.js');
const begin = source.indexOf('      let encodeError = null;', source.indexOf('async encodeTiledGeneration'));
const end = source.indexOf('      if (validationError) {', begin);

function encoding({ cancelled = false, throws = false } = {}) {
  let scopes = 0, released = 0, freed = 0, submissions = 0;
  const dropped = [];
  const renderer = {
    // Denoised tiles whose fill never reached the queue are forgotten.
    dropDenoiseTiles: (keys) => dropped.push(...keys),
    device: {
      pushErrorScope: () => scopes++, popErrorScope: async () => { scopes--; return null; },
      createCommandEncoder: () => { if (throws) throw Error('encode failure'); return { finish: () => ({}) }; },
      queue: { submit: () => submissions++ },
    },
    recordStage: () => {}, recordSubmission: () => {},
  };
  const peakTarget = { busy: true };
  const context = vm.createContext({ renderer, cancelled, peakTarget,
    lane: 'hdr', longEdge: 1600, options: {}, measureOnly: true, regionOnly: false,
    presentation: { release: () => released++ }, presentationTarget: null,
    localBuffers: [{ buffer: { destroy: () => freed++ } }],
    denoiseParamBuffers: [{ destroy: () => freed++ }],
    denoiseTilesUnsubmitted: ['unwritten'], denoiseTilesCreated: ['unwritten'], denoiseTilesUsed: [],
    denoiseTileKey: () => null, denoiseSource: null, denoiseControls: {}, noiseView: false,
    detailResultView: {}, clarityFrame: null, plan: { tiles: [] }, foregroundTiles: [],
  });
  const run = vm.runInContext(`(async function() { ${source.slice(begin, end)} return { rendered: true }; }).call(renderer)`, context);
  return { run, peakTarget, dropped, counts: () => ({ scopes, released, freed, submissions }) };
}

test('Cancellation closes validation scope, releases peak target and temporary buffers', async () => {
  const f = encoding({ cancelled: true });
  assert.equal((await f.run).rendered, false);
  assert.deepEqual(f.counts(), { scopes: 0, released: 1, freed: 2, submissions: 0 });
  assert.equal(f.peakTarget.busy, false);
  assert.deepEqual(f.dropped, ['unwritten']);
});

test('An encoder exception receives the same cleanup and still propagates', async () => {
  const f = encoding({ throws: true });
  await assert.rejects(f.run, /encode failure/);
  assert.deepEqual(f.counts(), { scopes: 0, released: 1, freed: 2, submissions: 0 });
  assert.equal(f.peakTarget.busy, false);
  assert.deepEqual(f.dropped, ['unwritten']);
});

test('Success balances the scope and keeps the peak reserved for readback', async () => {
  const f = encoding(); assert.equal((await f.run).rendered, true);
  assert.deepEqual(f.counts(), { scopes: 0, released: 1, freed: 2, submissions: 1 });
  assert.equal(f.peakTarget.busy, true);
  // The final submission wrote every tile, so none is forgotten.
  assert.deepEqual(f.dropped, []);
});

const trimStart = source.indexOf('    scheduleTileCacheTrim()');
const trimEnd = source.indexOf('    /** Encode', trimStart);
test('Cache trim waits for submitted work and overlapping active renders', async () => {
  let drain, release, trimmed = 0;
  const Preview = vm.runInNewContext(`(class { ${source.slice(trimStart, trimEnd)} })`);
  const preview = new Preview();
  preview.device = { queue: { onSubmittedWorkDone: () => new Promise(resolve => { drain = resolve; }) } };
  preview.destroyAfterActiveRenders = callback => { release = callback; };
  preview.trimDetailBandTiles = preview.trimMaskTiles = preview.trimDenoiseTiles = () => trimmed++;
  preview.scheduleTileCacheTrim(); assert.equal(trimmed, 0); assert.equal(drain, undefined);
  release(); assert.equal(trimmed, 0); assert.equal(typeof drain, 'function');
  drain(); await preview.pendingCacheTrim; assert.equal(trimmed, 3);
});

test('A render starting during queue drain requires another lifetime wait and drain', async () => {
  let trimmed = 0;
  const releases = [], drains = [];
  const Preview = vm.runInNewContext(`(class { ${source.slice(trimStart, trimEnd)} })`);
  const preview = new Preview();
  preview.device = { queue: { onSubmittedWorkDone: () => new Promise(resolve => drains.push(resolve)) } };
  preview.destroyAfterActiveRenders = callback => releases.push(callback);
  preview.trimDetailBandTiles = preview.trimMaskTiles = preview.trimDenoiseTiles = () => trimmed++;
  preview.scheduleTileCacheTrim(); releases[0]();
  preview.activeRenderCount = 1; drains[0](); await Promise.resolve();
  assert.equal(trimmed, 0); assert.equal(releases.length, 2); assert.equal(drains.length, 1);
  preview.activeRenderCount = 0; releases[1](); assert.equal(drains.length, 2);
  assert.equal(trimmed, 0); drains[1](); await preview.pendingCacheTrim; assert.equal(trimmed, 3);
});

test('Device replacement does not trim the replacement device caches', async () => {
  let drain, trimmed = 0;
  const Preview = vm.runInNewContext(`(class { ${source.slice(trimStart, trimEnd)} })`);
  const preview = new Preview();
  preview.device = { queue: { onSubmittedWorkDone: () => new Promise(resolve => { drain = resolve; }) } };
  preview.destroyAfterActiveRenders = callback => callback();
  preview.trimDetailBandTiles = preview.trimMaskTiles = preview.trimDenoiseTiles = () => trimmed++;
  preview.scheduleTileCacheTrim(); preview.device = {}; drain(); await preview.pendingCacheTrim;
  assert.equal(trimmed, 0);
});

test('Repeated trim requests share one device obligation and allow later trims', async () => {
  let trimmed = 0;
  const releases = [], drains = [];
  const Preview = vm.runInNewContext(`(class { ${source.slice(trimStart, trimEnd)} })`);
  const preview = new Preview();
  preview.device = { queue: { onSubmittedWorkDone: () => new Promise(resolve => drains.push(resolve)) } };
  preview.destroyAfterActiveRenders = callback => releases.push(callback);
  preview.trimDetailBandTiles = preview.trimMaskTiles = preview.trimDenoiseTiles = () => trimmed++;
  const first = preview.scheduleTileCacheTrim();
  for (let i = 0; i < 100; i++) assert.equal(preview.scheduleTileCacheTrim(), first);
  assert.equal(releases.length, 1);
  releases[0](); drains[0](); await first;
  assert.equal(trimmed, 3); assert.equal(preview.pendingCacheTrim, null);
  const next = preview.scheduleTileCacheTrim();
  assert.notEqual(next, first); assert.equal(releases.length, 2);
  releases[1](); drains[1](); await next;
  assert.equal(trimmed, 6);
});

test('Old trim completion cannot clear a replacement device obligation', async () => {
  const drains = [];
  const Preview = vm.runInNewContext(`(class { ${source.slice(trimStart, trimEnd)} })`);
  const preview = new Preview();
  const device = () => ({ queue: { onSubmittedWorkDone: () => new Promise(resolve => drains.push(resolve)) } });
  preview.device = device(); preview.destroyAfterActiveRenders = callback => callback();
  preview.trimDetailBandTiles = preview.trimMaskTiles = () => {};
  const old = preview.scheduleTileCacheTrim();
  preview.device = device(); const next = preview.scheduleTileCacheTrim();
  drains[0](); await old; assert.equal(preview.pendingCacheTrim, next);
  drains[1](); await next; assert.equal(preview.pendingCacheTrim, null);
});
