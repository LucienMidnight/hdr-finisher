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


test('DNG reservation fits one-plane reduction without raising shared budgets',()=>{
 const meta={width:8000,height:6000,flip:0,dng_warp:{}};
 const bytes=HDRLibraryGpuRaw.rawBudget(meta);
 assert.ok(bytes<320*1024*1024);
 assert.ok(bytes>=8000*6000*4+6000*2560*4+1920*2560*8);
 assert.equal(HDRLibraryGpuRaw.rawBudget({...meta,dng_warp:undefined}),8000*6000*44+64*1024*1024);
});

test('DNG footprints enclose independent per-channel maps across off-centre and non-monotone warps',()=>{
 const {dngFootprint}=HDRLibraryGpuRaw.shared;
 const warp={width:8000,height:6000,center:[2700,3800],radius:6600,
  affine_x:[0,1,70],affine_y:[-1,0,5900],coefficients:[[1.2,-.4,.3,-.1,.06,-.05],[.8,.3,-.2,.1,-.04,.02],[1.1,-.2,.1,0,.03,.02]]};
 for(const [x,y,w,h] of [[0,0,512,1024],[3000,4500,900,700],[1000,1700,200,300]]){
  const box=dngFootprint(warp,x,y,w,h);
  for(let row=y;row<y+h;row+=17)for(let col=x;col<x+w;col+=19)for(const k of warp.coefficients){
   const X=(warp.affine_x[0]*col+warp.affine_x[1]*row+warp.affine_x[2]-warp.center[0])/warp.radius;
   const Y=(warp.affine_y[0]*col+warp.affine_y[1]*row+warp.affine_y[2]-warp.center[1])/warp.radius;
   const r=Math.min(X*X+Y*Y,1),rad=k[0]+k[1]*r+k[2]*r*r+k[3]*r*r*r;
   const sx=Math.max(0,Math.min(7999,warp.center[0]+warp.radius*(X*rad+2*k[4]*X*Y+k[5]*(r+2*X*X))));
   const sy=Math.max(0,Math.min(5999,warp.center[1]+warp.radius*(Y*rad+k[4]*(r+2*Y*Y)+2*k[5]*X*Y)));
   for(let tap=-1;tap<=2;tap++){
    const xx=Math.max(0,Math.min(7999,Math.floor(sx)+tap)),yy=Math.max(0,Math.min(5999,Math.floor(sy)+tap));
    assert.ok(xx>=box.left&&xx<box.left+box.width);assert.ok(yy>=box.top&&yy<box.top+box.height);
   }
  }
 }
});
