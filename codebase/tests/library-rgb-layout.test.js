const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
require('../frontend/library-gpu-raw.js');

test('RGB clamp flag occupies lensc.z without aliasing DNG tile dimensions',()=>{
  // Exact pins are intentional: host writers and generated WGSL share P.
  const common=globalThis.HDRLibraryGpuRaw.shared.COMMON;
  const fields=[...common.matchAll(/(\w+):\s*vec4<[^>]+>/g)].map(m=>m[1]);
  assert.equal(fields.indexOf('lensc')*4,80);
  assert.equal(fields.indexOf('dispatch')*4,84);
  const rgb=fs.readFileSync(require.resolve('../frontend/library-rgb-gpu.js'),'utf8');
  assert.match(rgb,/if\(p\.lensc\.z>0\.0\)\{aces=max/);
  assert.match(rgb,/setF\(20, \[0, 0, meta\.colour\.clip_working_negative \? 1 : 0, \.18 \/ meta\.colour\.reference_white_nits\]\)/);
  assert.match(rgb,/f\.set\(\[box\.width,box\.height,0,0\],80\)/);
  assert.match(rgb,/u32\(p\.lensc\.x\)/);
});
