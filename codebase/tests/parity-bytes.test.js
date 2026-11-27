const assert = require('node:assert/strict');
const {test} = require('node:test');
const {summarizeByteParity} = require('./helpers/parity-bytes.cjs');

test('byte histogram preserves the former sorted full-frame parity calculation exactly', () => {
  let seed = 937;
  const randomByte = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
  for (const length of [1, 999, 1000, 2880000]) {
    const pixels = Uint8Array.from({length}, randomByte);
    const off = Uint8Array.from({length}, randomByte);
    const added = Array.from(pixels, (v,i) => Math.max(0,v-off[i])/255);
    const mean = added.reduce((a,b)=>a+b,0)/length;
    added.sort((a,b)=>a-b);
    const absolute = Array.from(pixels).sort((a,b)=>a-b);
    assert.deepEqual(summarizeByteParity(pixels,off), {
      mean, p999:added[Math.floor(length*.999)], maximum:added.at(-1),
      absoluteMean:pixels.reduce((a,b)=>a+b,0)/length,
      absoluteP999:absolute[Math.floor(length*.999)],
    });
  }
});

test('byte parity requires complete, matching frames', () => {
  assert.throws(()=>summarizeByteParity([],[]), /Mismatched/);
  assert.throws(()=>summarizeByteParity([1],[1,2]), /Mismatched/);
});
