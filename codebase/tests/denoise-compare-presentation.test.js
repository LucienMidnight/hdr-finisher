const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { declarations } = require('./frontend-source');

function fixture(lane = 'hdr', layout = 'side-horizontal', method = 'clean_grain') {
  const state = { session: { session_id: 'photo', source: {} }, currentView: lane === 'hdr' ? 'sdr' : 'hdr',
    compareMode: 'lanes', compareLayout: layout, previewGeneration: { hdr: 1, sdr: 1 },
    denoise: { [lane]: { enabled: true, controls: { method } } }, denoiseRuntime: {},
    previewCache: {}, adjustments: {}, gpuPreparedLane: {}, gpuPreview: {
      // The real renderer can return an original when its selector belongs to
      // the active lane. A successful GPU draw alone is not a denoised result.
      renderTo: async (...args) => { events.push('original GPU'); gpuOptions = args.at(-1); return true; },
    } };
  const events = [];
  let finish, gpuOptions;
  const image = { style: { display: 'none' } };
  const canvas = { style: { display: 'none' } };
  const context = vm.createContext({ state, console,
    els: { comparisonImage: image, comparisonCanvas: canvas, previewSecondaryPane: { dataset: {} } },
    gradeSourceIdentity: () => state.session?.session_id, geometrySignature: () => 'geometry',
    gpuPreviewEligible: () => true, settledProxyLongEdge: () => 1600,
    sampleCurvePoints() {}, localsBypassed: () => true, projectReferenceWhiteNits: () => 203,
    clearComparisonPreview() {}, applyZoomGeometry() {}, renderCompareStatus() {},
    decodePreviewImage: async () => {},
    renderPreviewForLane: async (requestedLane, display, edge, options) => {
      events.push(['backend', requestedLane, options.denoiseFallback]);
      await new Promise(resolve => { finish = resolve; });
      state.previewCache[requestedLane] = { generation: 1, geometrySignature: 'geometry', url: 'denoised' };
      return true;
    },
  });
  vm.runInContext(declarations('comparisonNeedsDenoise', 'applyComparisonUrl', 'renderComparisonPreview'), context);
  return { context, state, events, image, finish: () => finish(), gpuOptions: () => gpuOptions };
}

for (const lane of ['hdr', 'sdr']) {
  for (const layout of ['split-vertical', 'split-horizontal', 'side-horizontal', 'side-vertical']) {
    for (const method of ['standard', 'fine_grain', 'clean_grain', 'micro_grain']) {
      test(`${lane} ${method} ${layout} waits for and presents its denoised comparison`, async () => {
        const f = fixture(lane, layout, method);
        const pending = f.context.renderComparisonPreview(lane);
        assert.deepEqual(f.events, [['backend', lane, true]]);
        assert.equal(f.image.style.display, 'none');
        assert.equal(f.state.comparisonRenderedLane, undefined);
        f.finish();
        assert.equal(await pending, true);
        assert.equal(f.image.src, 'denoised');
        assert.equal(f.state.comparisonRenderedLane, lane);
        assert.equal(await f.context.renderComparisonPreview(lane), true);
        assert.equal(f.events.length, 1);
      });
    }
  }
}

for (const change of ['session', 'lane', 'generation', 'geometry', 'layout', 'mode']) {
  test(`late denoised comparison is discarded after ${change} changes`, async () => {
    const f = fixture();
    const pending = f.context.renderComparisonPreview('hdr');
    ({ session: () => f.state.session = { session_id: 'other' },
      lane: () => f.state.currentView = 'hdr', generation: () => f.state.previewGeneration.hdr++,
      geometry: () => f.context.geometrySignature = () => 'new',
      layout: () => f.state.compareLayout = 'single', mode: () => f.state.compareMode = 'before' })[change]();
    f.finish();
    assert.equal(await pending, false);
    assert.equal(f.image.style.display, 'none');
    assert.equal(f.state.comparisonRenderedLane, undefined);
  });
}

test('Denoise off explicitly selects the original GPU source', async () => {
  const f = fixture();
  f.state.denoise.hdr.enabled = false;
  assert.equal(await f.context.renderComparisonPreview('hdr'), true);
  assert.equal(f.gpuOptions().originalSource, true);
  assert.equal(f.gpuOptions().isCurrent(), true);
  assert.deepEqual(f.events, ['original GPU']);
});

test('a comparison decoded after leaving the layout cannot replace its image', async () => {
  const f = fixture();
  let finishDecode;
  f.context.decodePreviewImage = () => new Promise(resolve => { finishDecode = resolve; });
  const pending = f.context.renderComparisonPreview('hdr');
  f.finish();
  await new Promise(resolve => setImmediate(resolve));
  f.state.compareLayout = 'single';
  finishDecode();
  assert.equal(await pending, false);
  assert.equal(f.image.src, undefined);
});
