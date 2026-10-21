const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../frontend/library-gpu-raw.js');
const { quantile, reducedSize } = globalThis.HDRLibraryGpuRaw;

// numpy.quantile(values, q) with the default linear method, for comparison.
function numpyQuantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q, lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

test('robust peaks match numpy quantile and skip cropped-away samples', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const values = Array.from({ length: 20011 }, () => random() ** 3 * 4);
  const samples = new Float32Array(values.length * 3);
  values.forEach((v, i) => { samples[i * 3] = v; samples[i * 3 + 1] = v * 2; samples[i * 3 + 2] = -1; });
  const expected = numpyQuantile(Float32Array.from(values), 0.9999);
  assert.ok(Math.abs(quantile(samples, 0, 0.9999) - expected) <= 1e-6 * expected);
  assert.ok(Math.abs(quantile(samples, 1, 0.9999) - 2 * expected) <= 2e-6 * expected);
  assert.equal(quantile(samples, 2, 0.9999), 0, 'Only cropped-away samples: no measurement');
});

test('reduced sizes follow reduce_picture, including Python rounding and turned photos', () => {
  // 7968 x 5320 to 640: 427.3 rounds down. The GPU reduces in sensor
  // orientation, so a turned photo keeps the sensor-side size; the backend
  // turns the result into the 427 x 640 picture reduce_picture would make.
  assert.deepEqual(reducedSize({ width: 7968, height: 5320, flip: 0 }, 640), [427, 640]);
  assert.deepEqual(reducedSize({ width: 7968, height: 5320, flip: 6 }, 640), [427, 640]);
  assert.deepEqual(reducedSize({ width: 5320, height: 7968, flip: 5 }, 640), [640, 427]);
  // An exact half rounds to the even neighbour, as Python's round() does.
  assert.deepEqual(reducedSize({ width: 1280, height: 853, flip: 0 }, 640), [426, 640]);
  assert.deepEqual(reducedSize({ width: 1280, height: 855, flip: 0 }, 640), [428, 640]);
});
