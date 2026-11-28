const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const page of ["index.html", "photo-library.html", "gpu-delivery.html"]) {
  test(`${page} samples the same bounded monotone curves`, () => {
    const root = path.join(__dirname, "../frontend");
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const context = vm.createContext({});
    context.window = context;
    for (const [, script] of html.matchAll(/<script src="\/static\/([^"?]+\.js)/g)) {
      if (["gpu-delivery-curves.js", "curve-editor.js"].includes(script)) {
        vm.runInContext(fs.readFileSync(path.join(root, script), "utf8"), context);
      }
    }
    const curve = [[0, 0], [.5, 1], [1, 0]];
    assert.deepEqual(JSON.parse(JSON.stringify(context.sampleCurvePoints(curve, 5))),
      [[0, 0], [.25, .625], [.5, 1], [.75, .625], [1, 0]]);
    assert.equal(context.sampleCurvePoints(curve, 1024, .25)[0][1], .625);
    const neutral = context.sampleCurvePoints([[0, 0], [1, 1]], 1024);
    assert.ok(neutral.every(([x, y]) => Math.abs(x - y) < 1e-14));
    assert.ok(context.sampleCurvePoints(curve, 1024).every(([, y]) => y >= 0 && y <= 1));
  });
}

test("Exposure Bands retains the exact linear and smoothed curve samples for a dense edit", () => {
  const context = vm.createContext({ clamp: (x, min, max) => Math.min(max, Math.max(min, x)),
    TONE_EQUALIZER_MIN_TARGET_STEP: .001 });
  vm.runInContext(fs.readFileSync(require.resolve("../frontend/tone-equalizer.js"), "utf8"), context);
  const nodes = Array.from({ length: 16 }, (_, i) => ({ input_ev: -6 + i * .8, adjustment_ev: (i % 4 - 2) / 8 }));
  const inputs = [-8, -1.08, -.2, 4.32, 7];
  const expected = [
    [-.25, .018749999999999822, .03125000000000022, -.13750000000000018, .125],
    [-.25, .02202604166666644, .03862847222222243, -.1390416666666674, .125],
    [-.25, .02530208333333328, .04600694444444467, -.14058333333333373, .125],
  ];
  for (const [index, smoothing] of [0, .5, 1].entries()) {
    assert.deepEqual(inputs.map(context.prepareToneEqualizerSampler(nodes, smoothing)), expected[index]);
  }
});

test("Exposure Bands keeps the latest slider value immediately and paints once before release", () => {
  const frames = new Map();
  let nextFrame = 0, draws = 0, sliderValue = 0;
  const nodes = [{ input_ev: -6, adjustment_ev: 0 }, { input_ev: 0, adjustment_ev: 0 }, { input_ev: 6, adjustment_ev: 0 }];
  const context = vm.createContext({
    state: { currentView: "hdr", adjustments: { hdr: { tone_equalizer_nodes: nodes } } },
    clamp: (x, min, max) => Math.min(max, Math.max(min, x)),
    TONE_EQUALIZER_MIN_TARGET_STEP: .001, TONE_EQUALIZER_MAX_ADJUSTMENT_EV: 2,
    requestAnimationFrame: cb => { frames.set(++nextFrame, cb); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    resizeCanvasSurface: () => { draws++; return null; },
    invalidatePreview() {}, debouncePreview() {},
  });
  vm.runInContext(fs.readFileSync(require.resolve("../frontend/tone-equalizer.js"), "utf8"), context);
  context.toneEqualizerUi = () => ({ editor: {} });
  context.syncToneEqualizerControls = lane => { sliderValue = context.state.adjustments[lane].tone_equalizer_nodes[1].adjustment_ev; };
  context.setToneEqualizerBand(1, .25);
  context.setToneEqualizerBand(1, .75);
  assert.equal(sliderValue, .75);
  assert.equal(frames.size, 1);
  assert.equal(draws, 0);
  context.flushToneEqualizerDraw("hdr");
  assert.equal(draws, 1);
  assert.equal(frames.size, 0);
});
