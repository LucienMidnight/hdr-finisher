// Unit tests for the Phase 0 item 6 comparator.
//
// The A/B driver trusts these numbers to describe the two screenshots, so the
// arithmetic that produces them is tested directly: known offsets must land in
// the right metric, the 2x2 average must average, and "energy" must be zero on
// a flat field and positive on a striped one.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rgbaImage,
  compareRgba,
  cropRgba,
  halveRgba,
  lanczosResampleRgba,
  lumaEnergy,
  summarizePair,
} = require("./fit-filtering-compare.js");

function buildImage(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const [r, g, b] = pixel(x, y);
      data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = 255;
    }
  }
  return rgbaImage(width, height, data);
}

test("rgbaImage rejects wrong dimensions and byte counts", () => {
  assert.throws(() => rgbaImage(0, 4, new Uint8Array(0)), /positive integer/);
  assert.throws(() => rgbaImage(2, 2, new Uint8Array(8)), /expected 16 bytes/);
});

test("identical images compare to zero", () => {
  const image = buildImage(8, 6, (x, y) => [x * 3, y * 5, (x + y) * 2]);
  const metrics = compareRgba(image, image);
  assert.equal(metrics.comparedPixels, 48);
  assert.equal(metrics.maxAbs, 0);
  assert.equal(metrics.meanAbs, 0);
  assert.equal(metrics.p99Abs, 0);
  assert.equal(metrics.differingAbove1, 0);
  assert.equal(metrics.meanLumaDelta, 0);
});

test("a constant channel offset lands in every metric", () => {
  const base = buildImage(4, 3, () => [10, 20, 30]);
  const shifted = buildImage(4, 3, () => [10, 20, 40]);
  const metrics = compareRgba(base, shifted);
  assert.equal(metrics.maxAbs, 10);
  assert.equal(metrics.meanAbs, 10);
  assert.equal(metrics.p95Abs, 10);
  assert.equal(metrics.p99Abs, 10);
  assert.equal(metrics.differingAbove1, 12);
  assert.equal(metrics.differingAbove2, 12);
});

test("one- and two-level differences are counted at the right threshold", () => {
  const base = buildImage(4, 1, (x) => [x, x, x]);
  const one = buildImage(4, 1, (x) => [x + 1, x + 1, x + 1]);
  const two = buildImage(4, 1, (x) => [x + 2, x + 2, x + 2]);
  assert.equal(compareRgba(base, one).differingAbove1, 0);
  assert.equal(compareRgba(base, one).differingAbove2, 0);
  assert.equal(compareRgba(base, two).differingAbove1, 4);
  assert.equal(compareRgba(base, two).differingAbove2, 0);
});

test("the worst channel decides the pixel delta", () => {
  const base = buildImage(2, 1, () => [0, 0, 0]);
  const shifted = buildImage(2, 1, () => [3, 7, 1]);
  const metrics = compareRgba(base, shifted);
  assert.equal(metrics.maxAbs, 7);
  assert.equal(metrics.meanAbs, 7);
});

test("halving averages each 2x2 block and drops an odd edge", () => {
  const image = buildImage(3, 3, (x, y) => [x * 10 + y, 0, 0]);
  const half = halveRgba(image);
  assert.equal(half.width, 1);
  assert.equal(half.height, 1);
  const average = Math.round((0 + 10 + 1 + 11) / 4);
  assert.equal(half.data[0], average);
});

test("luma energy is zero on a flat field and positive on stripes", () => {
  const flat = buildImage(16, 4, () => [128, 128, 128]);
  assert.equal(lumaEnergy(flat), 0);
  const striped = buildImage(16, 4, (x) => (x % 2 === 0 ? [0, 0, 0] : [255, 255, 255]));
  assert.ok(lumaEnergy(striped) > 100, `expected strong energy, got ${lumaEnergy(striped)}`);
});

test("crop extracts the requested window", () => {
  const image = buildImage(4, 4, (x, y) => [x * 10 + y, 0, 0]);
  const crop = cropRgba(image, 1, 2, 2, 2);
  assert.equal(crop.width, 2);
  assert.equal(crop.height, 2);
  assert.equal(crop.data[0], 12);
  assert.equal(crop.data[4], 22);
  assert.equal(crop.data[8], 13);
});

test("summarizePair reports both scales and both energies", () => {
  const full = buildImage(8, 8, (x, y) => [(x * 16) % 256, (y * 16) % 256, 64]);
  const display = buildImage(8, 8, (x, y) => [(x * 16) % 256, (y * 16) % 256, 64]);
  const summary = summarizePair(full, display);
  assert.equal(summary.full.maxAbs, 0);
  assert.equal(summary.half.maxAbs, 0);
  assert.equal(summary.energy.ratio, 1);
  assert.equal(summary.halfEnergy.fullAtFit, summary.halfEnergy.displayScale);
});

test("summarizePair refuses mismatched sizes", () => {
  const a = buildImage(4, 4, () => [0, 0, 0]);
  const b = buildImage(4, 5, () => [0, 0, 0]);
  assert.throws(() => summarizePair(a, b), /differ in size/);
});

test("lanczos resample keeps a constant field constant", () => {
  const flat = buildImage(16, 12, () => [40, 80, 120]);
  const reduced = lanczosResampleRgba(flat, 5, 4);
  assert.equal(reduced.width, 5);
  assert.equal(reduced.height, 4);
  for (let index = 0; index < reduced.data.length; index += 4) {
    assert.equal(reduced.data[index], 40);
    assert.equal(reduced.data[index + 1], 80);
    assert.equal(reduced.data[index + 2], 120);
  }
});

test("lanczos resample at the same size is the identity", () => {
  const image = buildImage(8, 8, (x, y) => [x * 20, y * 20, (x + y) * 10]);
  const same = lanczosResampleRgba(image, 8, 8);
  assert.equal(compareRgba(image, same).maxAbs, 0);
});

test("a 4x downscale averages a sub-Nyquist checker instead of aliasing it", () => {
  // Period-2 stripes at the source are beyond the reduced image's Nyquist:
  // the only correct answer is the mean, not a lower-frequency pattern.
  const checker = buildImage(16, 16, (x, y) => {
    const on = (x + y) % 2 === 0;
    return on ? [255, 255, 255] : [0, 0, 0];
  });
  const reduced = lanczosResampleRgba(checker, 4, 4);
  for (let index = 0; index < reduced.data.length; index += 4) {
    assert.ok(Math.abs(reduced.data[index] - 128) <= 12, `expected ~128, got ${reduced.data[index]}`);
  }
});

test("lanczos resample preserves a monotone ramp", () => {
  const ramp = buildImage(32, 4, (x) => [x * 8, x * 8, x * 8]);
  const reduced = lanczosResampleRgba(ramp, 8, 1);
  for (let x = 1; x < reduced.width; x += 1) {
    assert.ok(reduced.data[x * 4] >= reduced.data[(x - 1) * 4], "ramp must not reverse");
  }
  // The first and last output centres sit one and a half source pixels inside
  // the ramp, so the ends land near, not on, the ramp's endpoints.
  assert.ok(reduced.data[0] <= 16, `left end near black, got ${reduced.data[0]}`);
  assert.ok(reduced.data[(reduced.width - 1) * 4] >= 232, `right end near white, got ${reduced.data[(reduced.width - 1) * 4]}`);
});
