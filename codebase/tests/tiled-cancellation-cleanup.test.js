const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../frontend/webgpu-preview.js'), 'utf8');
const begin = source.indexOf('      let encodeError = null;', source.indexOf('async encodeTiledGeneration'));
const end = source.indexOf('      if (validationError) {', begin);

function encoding({ cancelled = false, throws = false } = {}) {
  let scopes = 0, released = 0, freed = 0, submissions = 0;
  const renderer = {
    device: {
      pushErrorScope: () => scopes++, popErrorScope: async () => { scopes--; return null; },
      createCommandEncoder: () => { if (throws) throw Error('encode failure'); return { finish: () => ({}) }; },
      queue: { submit: () => submissions++ },
    },
    recordStage: () => {}, recordSubmission: () => {},
  };
  const peakTarget = { busy: true };
  const context = vm.createContext({ renderer, cancelled, peakTarget,
    lane: 'hdr', longEdge: 1600, options: {}, measureOnly: true,
    presentation: { release: () => released++ }, presentationTarget: null,
    localBuffers: [{ buffer: { destroy: () => freed++ } }],
    denoiseParamBuffers: [{ destroy: () => freed++ }],
    detailResultView: {}, clarityFrame: null, plan: { tiles: [] }, foregroundTiles: [],
  });
  const run = vm.runInContext(`(async function() { ${source.slice(begin, end)} return { rendered: true }; }).call(renderer)`, context);
  return { run, peakTarget, counts: () => ({ scopes, released, freed, submissions }) };
}

test('Cancellation closes validation scope, releases peak target and temporary buffers', async () => {
  const f = encoding({ cancelled: true });
  assert.equal((await f.run).rendered, false);
  assert.deepEqual(f.counts(), { scopes: 0, released: 1, freed: 2, submissions: 0 });
  assert.equal(f.peakTarget.busy, false);
});

test('An encoder exception receives the same cleanup and still propagates', async () => {
  const f = encoding({ throws: true });
  await assert.rejects(f.run, /encode failure/);
  assert.deepEqual(f.counts(), { scopes: 0, released: 1, freed: 2, submissions: 0 });
  assert.equal(f.peakTarget.busy, false);
});

test('Success balances the scope and keeps the peak reserved for readback', async () => {
  const f = encoding(); assert.equal((await f.run).rendered, true);
  assert.deepEqual(f.counts(), { scopes: 0, released: 1, freed: 2, submissions: 1 });
  assert.equal(f.peakTarget.busy, true);
});

const trimStart = source.indexOf('    scheduleTileCacheTrim()');
const trimEnd = source.indexOf('    /** Encode', trimStart);
test('Cache trim waits for submitted work and overlapping active renders', async () => {
  let drain, release, trimmed = 0;
  const Preview = vm.runInNewContext(`(class { ${source.slice(trimStart, trimEnd)} })`);
  const preview = new Preview();
  preview.device = { queue: { onSubmittedWorkDone: () => new Promise(resolve => { drain = resolve; }) } };
  preview.destroyAfterActiveRenders = callback => { release = callback; };
  preview.trimDetailBandTiles = preview.trimMaskTiles = () => trimmed++;
  preview.scheduleTileCacheTrim(); assert.equal(trimmed, 0); assert.equal(release, undefined);
  drain(); await Promise.resolve(); assert.equal(trimmed, 0); assert.equal(typeof release, 'function');
  release(); await preview.pendingCacheTrim; assert.equal(trimmed, 2);
});

test('Device replacement does not trim the replacement device caches', async () => {
  let drain, trimmed = 0;
  const Preview = vm.runInNewContext(`(class { ${source.slice(trimStart, trimEnd)} })`);
  const preview = new Preview();
  preview.device = { queue: { onSubmittedWorkDone: () => new Promise(resolve => { drain = resolve; }) } };
  preview.destroyAfterActiveRenders = callback => callback();
  preview.trimDetailBandTiles = preview.trimMaskTiles = () => trimmed++;
  preview.scheduleTileCacheTrim(); preview.device = {}; drain(); await preview.pendingCacheTrim;
  assert.equal(trimmed, 0);
});
