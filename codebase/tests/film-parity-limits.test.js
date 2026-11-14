const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessParity, limitsFor } = require('./helpers/film-parity-limits.cjs');
const { createColourComparator } = require('./helpers/parity-colour.cjs');

test('strict byte cases fail mean drift and keep the existing p99.9 gate', () => {
  const result = assessParity({ context: '1520px hdr glimmerglass', mean: .101, p999: 1 });
  assert.equal(result.passed, false);
  assert.match(result.message, /1520px hdr glimmerglass out of sync: added byte mean/);
  assert.match(result.message, /exceeds 0.1 levels by/);
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
