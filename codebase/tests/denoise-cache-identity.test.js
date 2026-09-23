// The renderer half of the cross-language denoise cache identity contract.
//
// `tests/fixtures/denoise-cache-identity.json` holds the literals, and
// `tests/test_denoise_tiles.py` asserts the CPU reference produces exactly the
// same strings. Either implementation drifting fails on its own side, which is
// the point: a CPU analysis and a GPU analysis of the same document have to
// agree on what is cached and on when it goes stale, and a shared fixture is
// what stops that agreement from being a coincidence.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function loadPreview() {
  const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "webgpu-preview.js"), "utf8");
  // The renderer's halo math is the declared processing-scale contract, which
  // the page loads as its own script. The harness mirrors that script set.
  const graphScaleSource = fs.readFileSync(path.join(__dirname, "..", "frontend", "graph-scale.js"), "utf8");
  const context = {
    window: {},
    document: {},
    navigator: {},
    performance: { now: () => 0 },
    console,
  };
  context.self = context.window;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(graphScaleSource, context);
  vm.runInContext(source, context);
  return context.window.HDRWebGPUPreview;
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "denoise-cache-identity.json"), "utf8"),
);

test("the renderer's denoise cache identity matches the pinned cross-language fixture", () => {
  const Preview = loadPreview();
  for (const item of fixture.cases) {
    const tile = item.tile
      ? { ...item.tile, key: `${item.tile.x},${item.tile.y},${item.tile.width},${item.tile.height}` }
      : null;
    assert.equal(
      Preview.denoiseCacheIdentity(item.sourceIdentity, item.settings, tile),
      item.expected,
      `case "${item.name}" does not match the fixture the CPU reference is also held to`,
    );
  }
});

test("live reconstruction controls are absent from the identity", () => {
  const Preview = loadPreview();
  const settings = {
    levels: 2, noiseThreshold: 3.0, lumaSigma: 0.035,
    chromaSigma: 0.035, lumaStrength: 1.0, chromaStrength: 1.25,
  };
  const baseline = Preview.denoiseCacheIdentity("source", settings);
  // Amount, Luminance, Color Noise and Detail Recovery are not parameters of
  // this function at all, so the identity cannot move when they do. Passing
  // them anyway must change nothing.
  const withControls = { ...settings, amount: 0.1, luminance: 0.9, colorNoise: 0.2, detailRecovery: 0.7 };
  assert.equal(Preview.denoiseCacheIdentity("source", withControls), baseline);
});

test("every locked analysis setting invalidates the identity", () => {
  const Preview = loadPreview();
  const settings = {
    levels: 2, noiseThreshold: 3.0, lumaSigma: 0.035,
    chromaSigma: 0.035, lumaStrength: 1.0, chromaStrength: 1.25,
  };
  const baseline = Preview.denoiseCacheIdentity("source", settings);
  const changes = {
    levels: 3,
    noiseThreshold: 4.0,
    lumaSigma: 0.05,
    chromaSigma: 0.05,
    lumaStrength: 1.5,
    chromaStrength: 1.5,
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.notEqual(
      Preview.denoiseCacheIdentity("source", { ...settings, [field]: value }),
      baseline,
      `${field} must invalidate the analysis cache`,
    );
  }
  assert.notEqual(Preview.denoiseCacheIdentity("other-source", settings), baseline);
});

test("denoise tiles land on the wavelet grid and cover the image exactly once", () => {
  const Preview = loadPreview();
  for (const levels of [1, 2, 3, 4]) {
    const alignment = 2 ** levels;
    const width = 201;
    const height = 149;
    const tiles = Preview.alignedDenoiseTiles(width, height, 48, levels);
    const covered = new Int32Array(width * height);
    for (const tile of tiles) {
      assert.equal(tile.x % alignment, 0, `${tile.key} is off the ${alignment}px grid`);
      assert.equal(tile.y % alignment, 0, `${tile.key} is off the ${alignment}px grid`);
      assert.ok(tile.width >= 2 && tile.height >= 2, `${tile.key} is too small to transform`);
      for (let y = tile.y; y < tile.y + tile.height; y += 1) {
        for (let x = tile.x; x < tile.x + tile.width; x += 1) covered[y * width + x] += 1;
      }
    }
    assert.ok(covered.every((value) => value === 1), `levels ${levels} did not cover every pixel exactly once`);
  }
});

test("a short trailing span is absorbed rather than left unanalysable", () => {
  const Preview = loadPreview();
  // 33 with a 16px step would leave a 1px column, which has no 2x2 block.
  const tiles = Preview.alignedDenoiseTiles(33, 16, 16, 2);
  assert.equal(tiles.length, 2);
  assert.deepEqual(tiles.map((tile) => [tile.x, tile.width]), [[0, 16], [16, 17]]);
});
