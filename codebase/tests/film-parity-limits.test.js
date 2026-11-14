const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessParity, limitsFor } = require('./helpers/film-parity-limits.cjs');
const { createColourComparator } = require('./helpers/parity-colour.cjs');

test('strict byte cases fail mean drift and keep the existing p99.9 gate', () => {
  const result = assessParity({ context: '1520px hdr glimmerglass', mean: .101, p999: 1 });
  assert.equal(result.passed, false);
  assert.match(result.message, /1520px hdr glimmerglass out of sync: added byte mean/);
  assert.match(result.message, /exceeds 0.1 by/);
  assert.equal(assessParity({ mean: .1, p999: 2 }).passed, true);
  assert.equal(assessParity({ mean: .01, p999: 3 }).passed, false);
});

test('perceptual gates fail either metric independently, even if strict bytes pass', () => {
  const limits = { mean: .25, p999: 1.2 };
  const base = { context: 'sdr Velvia physical chain', mean: .01, p999: 1, limits };
  assert.equal(assessParity({ ...base, colour: { mean: .25, p999: 1.2 } }).passed, true);
  for (const colour of [{ mean: .251, p999: 1 }, { mean: .2, p999: 1.201 }, { mean: NaN, p999: 1 }]) {
    const result = assessParity({ ...base, colour });
    assert.equal(result.passed, false);
    assert.match(result.message, /sdr Velvia physical chain out of sync/);
  }
  assert.equal(assessParity({ ...base, colour: { mean: .1, p999: 1 }, p999: 3 }).passed, false);
  assert.equal(assessParity({ ...base, limits: {}, colour: { mean: .1, p999: 1 } }).passed, false);
  const drift = assessParity({ ...base, colour: { metric: 'Delta E 2000', mean: .251, p999: 1 } });
  assert.match(drift.message, /Delta E 2000 mean 0.251 exceeds 0.25 by 0.001/);
  for (const value of [NaN, Infinity, undefined, -1]) {
    const invalid = assessParity({ ...base, colour: { mean: value, p999: 1 } });
    assert.equal(invalid.passed, false);
    assert.match(invalid.message, /missing, negative or non-finite/);
  }
});

test('a new case, real-file diagnostic and extreme HDR cannot inherit an exception', () => {
  assert.equal(limitsFor('lens', 1520, 'hdr', 'new filter'), null);
  assert.equal(limitsFor('film', 1200, 'hdr', 'Velvia physical chain'), null);
  assert.equal(limitsFor('film', 1200, 'sdr', 'Velvia no grain'), null);
  assert.equal(limitsFor('film', 1200, 'sdr', 'Velvia physical chain', { extremeHdr: true }), null);
  assert.equal(limitsFor('film', 1200, 'sdr', 'Velvia physical chain', { inputPath: 'photo.tiff' }), null);
});

test('finished RGBA comparator measures full colour and rejects incomplete coverage', async () => {
  const comparator = createColourComparator();
  const result = bytes => ({ size: [2, 1, 2, 1], captured: {
    gpu: Buffer.from(bytes).toString('base64'), cpu: Buffer.from([100, 150, 200, 255, 0, 0, 0, 255]).toString('base64'),
  } });
  try {
    const identical = await comparator.compare(result([100, 150, 200, 255, 0, 0, 0, 255]));
    assert.equal(identical.metric, 'Delta E 2000');
    assert.equal(identical.mean, 0);
    assert.equal(identical.p999, 0);
    const changed = await comparator.compare(result([100, 150, 200, 255, 255, 255, 255, 255]));
    assert.ok(changed.mean > 40 && changed.p999 > 90);
    await assert.rejects(comparator.compare(result([100, 150, 200, 0, 0, 0, 0, 255])), /opaque/);
    await assert.rejects(comparator.compare(result([0, 0, 0, 255])), /Incomplete gpu/);
  } finally { comparator.close(); }
});

test('only the 60 measured lens cases receive perceptual limits', () => {
  const { LENS_PERCEPTUAL_CASES, LENS_PERCEPTUAL_LIMITS } = require('./helpers/film-parity-limits.cjs');
  const strictHighStrength = new Set([
    '1520/hdr/glimmerglass 2 0.25 35mm',
    '1520/hdr/glimmerglass 2 0.25 super8',
    '1520/hdr/cinebloom 2 0.25 35mm',
    '2400/hdr/glimmerglass 2 0.25 super8',
  ]);
  const measured = [];
  for (const edge of [1520, 2400]) for (const lane of ['hdr', 'sdr'])
    for (const family of ['glimmerglass', 'black_pro_mist', 'pro_mist', 'cinebloom'])
      for (const strength of [.125, 2]) for (const size of [.25, 4]) for (const format of ['35mm', 'super8']) {
        const label = `${family} ${strength} ${size} ${format}`;
        const key = `${edge}/${lane}/${label}`;
        const expected = strength === 2 && !strictHighStrength.has(key);
        assert.equal(limitsFor('lens', edge, lane, label), expected ? LENS_PERCEPTUAL_LIMITS[lane] : null, key);
        if (expected) measured.push(key);
      }
  assert.equal(measured.length, 60);
  assert.deepEqual([...LENS_PERCEPTUAL_CASES].sort(), measured.sort());
  assert.equal(limitsFor('lens', 1200, 'sdr', 'pro_mist 2 4 35mm'), null);
  assert.equal(limitsFor('lens', 1520, 'sdr', 'pro_mist 2 4 35mm', { extremeHdr: true }), null);
  assert.equal(limitsFor('lens', 1520, 'sdr', 'pro_mist 2 4 35mm', { inputPath: 'photo.tiff' }), null);
});

test('Steve 2026-11-14 drift caps and the original byte gates are pinned', () => {
  const { STRICT_BYTE_LIMITS, LENS_PERCEPTUAL_LIMITS, VELVIA_SDR_PERCEPTUAL_LIMITS } = require('./helpers/film-parity-limits.cjs');
  assert.deepEqual(STRICT_BYTE_LIMITS, { mean: .1, p999: 2 });
  assert.deepEqual(LENS_PERCEPTUAL_LIMITS, { hdr: { mean: .161, p999: 1.155 }, sdr: { mean: .248, p999: 1.202 } });
  assert.deepEqual(VELVIA_SDR_PERCEPTUAL_LIMITS, { sdr: { mean: .125, p999: 1.065 } });
  assert.equal(limitsFor('film', 1200, 'sdr', 'Velvia physical chain'), VELVIA_SDR_PERCEPTUAL_LIMITS.sdr);
});
