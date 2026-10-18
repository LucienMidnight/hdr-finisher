/* GPU RAW development prototype (WebGPU). Same maths as Grade's CPU import:
 * opposed-colour highlight repair, LibRaw 0.22.1 AHD demosaic, camera RGB to
 * ACEScg, import gamut projection, fixed calibration, full-source measurements
 * and Pillow-equivalent bilinear reduction. Prototype only: not product code. */
"use strict";

const COMMON = /* wgsl */ `
struct P {
  dims: vec4<u32>,        // w, h, flip, stride
  dims2: vec4<u32>,       // coarse w, coarse h, flipped out w, sample row width
  cfa_rgb: vec4<u32>,     // CFA position (row&1)*2+(col&1) -> 0 R, 1 G, 2 B
  cfa_raw: vec4<u32>,     // CFA position -> LibRaw raw channel 0..3
  raw_black: vec4<f32>,   // per raw channel
  raw_range: vec4<f32>,   // per raw channel, white - black
  wb: vec4<f32>,          // per RGB, green 1
  thr: vec4<f32>,         // per RGB clipping threshold after white balance
  chroma: vec4<f32>,      // per RGB opposed-colour residual
  inv_range: vec4<f32>,   // per RGB 1 / (white - black)
  m0: vec4<f32>, m1: vec4<f32>, m2: vec4<f32>,   // camera -> ACEScg rows
  x0: vec4<f32>, x1: vec4<f32>, x2: vec4<f32>,   // LibRaw xyz_cam rows (AHD Lab)
  b0: vec4<f32>, b1: vec4<f32>, b2: vec4<f32>,   // ACEScg -> BT.2020 rows
  misc: vec4<f32>,        // calibration gain
};
@group(0) @binding(0) var<uniform> p: P;
fn W() -> i32 { return i32(p.dims.x); }
fn H() -> i32 { return i32(p.dims.y); }
fn FC(r: i32, c: i32) -> u32 { return p.cfa_rgb[u32((r & 1) * 2 + (c & 1))]; }
fn RAWCH(r: i32, c: i32) -> u32 { return p.cfa_raw[u32((r & 1) * 2 + (c & 1))]; }
`;

const NORMALIZE = COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> mosaic: array<u32>;
@group(0) @binding(2) var<storage, read_write> norm: array<f32>;
@group(0) @binding(3) var<storage, read_write> ints: array<u32>;
@group(0) @binding(4) var<storage, read_write> clipbits: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> coarse: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> counts: array<atomic<u32>>;
var<workgroup> wgCount: array<atomic<u32>, 3>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (li < 3u) { atomicStore(&wgCount[li], 0u); }
  workgroupBarrier();
  let c = i32(g.x); let r = i32(g.y);
  if (c < W() && r < H()) {
    let i = u32(r * W() + c);
    let raw = f32((mosaic[i >> 1u] >> ((i & 1u) * 16u)) & 0xffffu);
    let ch = RAWCH(r, c); let rgb = FC(r, c);
    let black = p.raw_black[ch];
    var v = max(raw - black, 0.0) * (1.0 / p.raw_range[ch]);
    v = v * p.wb[rgb];
    norm[i] = v;
    ints[i] = u32(max(raw - black, 0.0));
    if (v >= p.thr[rgb]) {
      atomicOr(&clipbits[i >> 5u], 1u << (i & 31u));
      atomicOr(&coarse[u32(r / 3) * p.dims2.x + u32(c / 3)], 1u << rgb);
      atomicAdd(&wgCount[rgb], 1u);
    }
  }
  workgroupBarrier();
  if (li < 3u) { let n = atomicLoad(&wgCount[li]); if (n > 0u) { atomicAdd(&counts[li], n); } }
}`;

const DILATE = COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> coarse: array<u32>;
@group(0) @binding(2) var<storage, read_write> dilated: array<u32>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let cw = i32(p.dims2.x); let chh = i32(p.dims2.y);
  let x = i32(g.x); let y = i32(g.y);
  if (x >= cw || y >= chh) { return; }
  var bits = 0u;
  for (var dy = -3; dy <= 3; dy++) {
    for (var dx = -3; dx <= 3; dx++) {
      if (dy * dy + dx * dx > 13) { continue; }
      let yy = y + dy; let xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= chh || xx >= cw) { continue; }
      bits = bits | coarse[u32(yy * cw + xx)];
    }
  }
  dilated[u32(y * cw + x)] = bits;
}`;

const OPPOSED = /* wgsl */ `
fn cbrt0(x: f32) -> f32 { return select(0.0, pow(x, 1.0 / 3.0), x > 0.0); }
fn opposed(r: i32, c: i32, goal: u32) -> f32 {
  var s = vec3<f32>(0.0); var n = vec3<f32>(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let rr = r + dy; let cc = c + dx;
      if (rr < 0 || cc < 0 || rr >= H() || cc >= W()) { continue; }
      let k = FC(rr, cc);
      s[k] += max(norm[u32(rr * W() + cc)], 0.0); n[k] += 1.0;
    }
  }
  var a = vec3<f32>(0.0);
  for (var k = 0u; k < 3u; k++) { if (n[k] > 0.0) { a[k] = cbrt0(s[k] / n[k]); } }
  var m = 0.0;
  if (goal == 0u) { m = (a.y + a.z) * 0.5; } else if (goal == 1u) { m = (a.x + a.z) * 0.5; } else { m = (a.x + a.y) * 0.5; }
  return m * m * m;
}`;

const RESIDUAL = COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> norm: array<f32>;
@group(0) @binding(2) var<storage, read> dilated: array<u32>;
@group(0) @binding(3) var<storage, read_write> partials: array<f32>;
${OPPOSED}
var<workgroup> sums: array<f32, 768>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let c = i32(g.x); let r = i32(g.y);
  var value = vec3<f32>(0.0); var count = vec3<f32>(0.0);
  if (c < W() && r < H()) {
    let i = u32(r * W() + c); let rgb = FC(r, c); let v = norm[i];
    let near = (dilated[u32(r / 3) * p.dims2.x + u32(c / 3)] >> rgb) & 1u;
    if (near == 1u && v >= 0.2 * p.thr[rgb] && v < p.thr[rgb]) {
      value[rgb] = v - opposed(r, c, rgb); count[rgb] = 1.0;
    }
  }
  for (var k = 0u; k < 3u; k++) { sums[k * 256u + li] = value[k]; }
  workgroupBarrier();
  for (var step = 128u; step > 0u; step = step >> 1u) {
    if (li < step) { for (var k = 0u; k < 3u; k++) { sums[k * 256u + li] += sums[k * 256u + li + step]; } }
    workgroupBarrier();
  }
  let slot = (wg.y * nw.x + wg.x) * 6u;
  if (li == 0u) { for (var k = 0u; k < 3u; k++) { partials[slot + k] = sums[k * 256u]; } }
  workgroupBarrier();
  for (var k = 0u; k < 3u; k++) { sums[k * 256u + li] = count[k]; }
  workgroupBarrier();
  for (var step = 128u; step > 0u; step = step >> 1u) {
    if (li < step) { for (var k = 0u; k < 3u; k++) { sums[k * 256u + li] += sums[k * 256u + li + step]; } }
    workgroupBarrier();
  }
  if (li == 0u) { for (var k = 0u; k < 3u; k++) { partials[slot + 3u + k] = sums[k * 256u]; } }
}`;

const REPAIR = COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> norm: array<f32>;
@group(0) @binding(2) var<storage, read> clipbits: array<u32>;
@group(0) @binding(3) var<storage, read_write> ints: array<u32>;
${OPPOSED}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = i32(g.x); let r = i32(g.y);
  if (c >= W() || r >= H()) { return; }
  let i = u32(r * W() + c);
  if (((clipbits[i >> 5u] >> (i & 31u)) & 1u) == 0u) { return; }
  let rgb = FC(r, c); let ch = RAWCH(r, c);
  let v = norm[i];
  let repaired = max(v, opposed(r, c, rgb) + p.chroma[rgb]) / p.wb[rgb];
  let encoded = clamp(round(repaired * p.raw_range[ch] + p.raw_black[ch]), 0.0, 65535.0);
  ints[i] = u32(max(encoded - p.raw_black[ch], 0.0));
}`;

const GREEN = COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> ints: array<u32>;
@group(0) @binding(2) var<storage, read_write> gpack: array<u32>;
fn px(r: i32, c: i32) -> i32 { return i32(ints[u32(r * W() + c)]); }
fn ulim(x: i32, y: i32, z: i32) -> i32 { return clamp(x, min(y, z), max(y, z)); }
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = i32(g.x); let r = i32(g.y);
  if (c >= W() || r >= H()) { return; }
  let i = u32(r * W() + c);
  if (FC(r, c) == 1u) { let v = u32(px(r, c)); gpack[i] = v | (v << 16u); return; }
  if (r < 2 || c < 2 || r >= H() - 2 || c >= W() - 2) { gpack[i] = 0u; return; }
  let ctr = px(r, c);
  let L = px(r, c - 1); let R = px(r, c + 1);
  let gh = ulim(((L + ctr + R) * 2 - px(r, c - 2) - px(r, c + 2)) >> 2u, L, R);
  let U = px(r - 1, c); let D = px(r + 1, c);
  let gv = ulim(((U + ctr + D) * 2 - px(r - 2, c) - px(r + 2, c)) >> 2u, U, D);
  gpack[i] = u32(gh) | (u32(gv) << 16u);
}`;

const AHD_RGB = /* wgsl */ `
@group(0) @binding(1) var<storage, read> ints: array<u32>;
@group(0) @binding(2) var<storage, read> gpack: array<u32>;
fn px(r: i32, c: i32) -> i32 { return i32(ints[u32(r * W() + c)]); }
fn gd(r: i32, c: i32, d: u32) -> i32 { return i32((gpack[u32(r * W() + c)] >> (16u * d)) & 0xffffu); }
fn clip16(v: i32) -> i32 { return clamp(v, 0, 65535); }
// LibRaw ahd_interpolate_r_and_b_in_rgb: full camera RGB at (r, c) for direction d.
fn rgbd(r: i32, c: i32, d: u32) -> vec3<i32> {
  var out = vec3<i32>(0);
  let f = FC(r, c);
  if (f == 1u) {
    let cb = FC(r + 1, c); let t1 = 2u - cb; let G = px(r, c);
    out[t1] = clip16(G + ((px(r, c - 1) + px(r, c + 1) - gd(r, c - 1, d) - gd(r, c + 1, d)) >> 1u));
    out[cb] = clip16(G + ((px(r - 1, c) + px(r + 1, c) - gd(r - 1, c, d) - gd(r + 1, c, d)) >> 1u));
    out[1] = G;
  } else {
    let k = 2u - f; let g0 = gd(r, c, d);
    let s = px(r - 1, c - 1) + px(r - 1, c + 1) + px(r + 1, c - 1) + px(r + 1, c + 1)
          - gd(r - 1, c - 1, d) - gd(r - 1, c + 1, d) - gd(r + 1, c - 1, d) - gd(r + 1, c + 1, d);
    out[k] = clip16(g0 + ((s + 1) >> 2u));
    out[f] = px(r, c);
    out[1] = g0;
  }
  return out;
}
fn cbrt_lab(i: i32) -> f32 {
  let x = f32(i) / 65535.0;
  return select(7.787 * x + 16.0 / 116.0, pow(x, 1.0 / 3.0), x > 0.008856);
}
fn lab(v: vec3<i32>) -> vec3<i32> {
  let f = vec3<f32>(v);
  let x = cbrt_lab(clip16(i32(0.5 + dot(p.x0.xyz, f))));
  let y = cbrt_lab(clip16(i32(0.5 + dot(p.x1.xyz, f))));
  let z = cbrt_lab(clip16(i32(0.5 + dot(p.x2.xyz, f))));
  return vec3<i32>(i32(64.0 * (116.0 * y - 16.0)), i32(64.0 * 500.0 * (x - y)), i32(64.0 * 200.0 * (y - z)));
}`;

const HOMOGENEITY = COMMON + AHD_RGB + /* wgsl */ `
@group(0) @binding(3) var<storage, read_write> homo: array<u32>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = i32(g.x); let r = i32(g.y);
  if (c >= W() || r >= H()) { return; }
  let i = u32(r * W() + c);
  if (r < 4 || c < 4 || r >= H() - 4 || c >= W() - 4) { homo[i] = 0u; return; }
  var ld: array<array<u32, 4>, 2>; var ab: array<array<u32, 4>, 2>;
  let offs = array<vec2<i32>, 4>(vec2<i32>(0, -1), vec2<i32>(0, 1), vec2<i32>(-1, 0), vec2<i32>(1, 0));
  for (var d = 0u; d < 2u; d++) {
    let l0 = lab(rgbd(r, c, d));
    for (var k = 0u; k < 4u; k++) {
      let ln = lab(rgbd(r + offs[k].x, c + offs[k].y, d));
      ld[d][k] = u32(abs(l0.x - ln.x));
      let da = u32(abs(l0.y - ln.y)); let db = u32(abs(l0.z - ln.z));
      ab[d][k] = da * da + db * db;
    }
  }
  let leps = min(max(ld[0][0], ld[0][1]), max(ld[1][2], ld[1][3]));
  let abeps = min(max(ab[0][0], ab[0][1]), max(ab[1][2], ab[1][3]));
  var h = vec2<u32>(0u);
  for (var d = 0u; d < 2u; d++) {
    for (var k = 0u; k < 4u; k++) { if (ld[d][k] <= leps && ab[d][k] <= abeps) { h[d] += 1u; } }
  }
  homo[i] = h.x | (h.y << 8u);
}`;

const COMBINE = COMMON + AHD_RGB + /* wgsl */ `
@group(0) @binding(3) var<storage, read> homo: array<u32>;
@group(0) @binding(4) var<storage, read_write> outR: array<f32>;
@group(0) @binding(5) var<storage, read_write> outG: array<f32>;
@group(0) @binding(6) var<storage, read_write> outB: array<f32>;
@group(0) @binding(7) var<storage, read_write> peaks: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> samples: array<f32>;
var<workgroup> wgPeak: array<atomic<u32>, 3>;
fn border(r: i32, c: i32) -> vec3<i32> {
  var s = vec3<i32>(0); var n = vec3<i32>(0);
  for (var y = r - 1; y <= r + 1; y++) {
    for (var x = c - 1; x <= c + 1; x++) {
      if (y < 0 || x < 0 || y >= H() || x >= W()) { continue; }
      let f = FC(y, x); s[f] += px(y, x); n[f] += 1;
    }
  }
  var out = vec3<i32>(0); let own = FC(r, c);
  for (var k = 0u; k < 3u; k++) { if (k != own && n[k] > 0) { out[k] = s[k] / n[k]; } }
  out[own] = px(r, c);
  return out;
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (li < 3u) { atomicStore(&wgPeak[li], 0u); }
  workgroupBarrier();
  let c = i32(g.x); let r = i32(g.y);
  if (c < W() && r < H()) {
    var cam: vec3<i32>;
    if (r >= 5 && c >= 5 && r < H() - 5 && c < W() - 5) {
      var hm = vec2<u32>(0u);
      for (var y = r - 1; y <= r + 1; y++) {
        for (var x = c - 1; x <= c + 1; x++) {
          let h = homo[u32(y * W() + x)]; hm.x += h & 0xffu; hm.y += (h >> 8u) & 0xffu;
        }
      }
      if (hm.x != hm.y) { cam = rgbd(r, c, select(0u, 1u, hm.y > hm.x)); }
      else { cam = (rgbd(r, c, 0u) + rgbd(r, c, 1u)) >> vec3<u32>(1u); }
    } else { cam = border(r, c); }
    let camf = vec3<f32>(cam) * p.inv_range.xyz * p.wb.xyz;
    var aces = vec3<f32>(dot(p.m0.xyz, camf), dot(p.m1.xyz, camf), dot(p.m2.xyz, camf));
    let lo = min(aces.x, min(aces.y, aces.z)); let hi = max(aces.x, max(aces.y, aces.z));
    if (lo < 0.0) { aces = select(vec3<f32>(0.0), hi * (aces - lo) / (hi - lo), hi > 0.0); }
    aces = aces * p.misc.x;
    let i = u32(r * W() + c);
    outR[i] = aces.x; outG[i] = aces.y; outB[i] = aces.z;
    let top = max(aces.x, max(aces.y, aces.z));
    let luma = dot(vec3<f32>(0.2722287, 0.6740818, 0.0536895), aces);
    let bt = vec3<f32>(dot(p.b0.xyz, aces), dot(p.b1.xyz, aces), dot(p.b2.xyz, aces));
    let btop = max(bt.x, max(bt.y, bt.z));
    atomicMax(&wgPeak[0], bitcast<u32>(max(top, 0.0)));
    atomicMax(&wgPeak[1], bitcast<u32>(max(luma, 0.0)));
    atomicMax(&wgPeak[2], bitcast<u32>(max(btop, 0.0)));
    // The CPU samples every stride-th row and column of the turned picture.
    var fr = r; var fc = c; let flip = p.dims.z;
    if (flip == 3u) { fr = H() - 1 - r; fc = W() - 1 - c; }
    else if (flip == 6u) { fr = c; fc = H() - 1 - r; }
    else if (flip == 5u) { fr = W() - 1 - c; fc = r; }
    let st = i32(p.dims.w);
    if (fr % st == 0 && fc % st == 0) {
      let si = u32(fr / st) * p.dims2.w + u32(fc / st);
      samples[si * 3u] = max(luma, 0.0); samples[si * 3u + 1u] = max(top, 0.0); samples[si * 3u + 2u] = max(btop, 0.0);
    }
  }
  workgroupBarrier();
  if (li < 3u) { atomicMax(&peaks[li], atomicLoad(&wgPeak[li])); }
}`;

// Pillow ImagingResample (BILINEAR, 32-bit float): horizontal then vertical.
const REDUCE = /* wgsl */ `
struct R { size: vec4<u32> };  // in length along the axis, out length, rows/cols across, axis (0 h, 1 v)
@group(0) @binding(0) var<uniform> q: R;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let inLen = q.size.x; let outLen = q.size.y; let across = q.size.z;
  let o = g.x; let a = g.y;
  if (o >= outLen || a >= across) { return; }
  let scale = f32(inLen) / f32(outLen);
  let fs = max(scale, 1.0); let support = fs; let ss = 1.0 / fs;
  let center = (f32(o) + 0.5) * scale;
  let xmin = max(i32(center - support + 0.5), 0);
  let xmax = min(i32(center + support + 0.5), i32(inLen));
  var acc = 0.0; var ww = 0.0;
  for (var x = xmin; x < xmax; x++) {
    let t = abs((f32(x) - center + 0.5) * ss);
    let w = select(0.0, 1.0 - t, t < 1.0);
    var idx: u32;
    if (q.size.w == 0u) { idx = a * inLen + u32(x); } else { idx = u32(x) * across + a; }
    acc += w * src[idx]; ww += w;
  }
  var outIdx: u32;
  if (q.size.w == 0u) { outIdx = a * outLen + o; } else { outIdx = o * across + a; }
  dst[outIdx] = select(0.0, acc / ww, ww != 0.0);
}`;

async function developRaw({ mosaic, meta, syncStages = true }) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const device = await adapter.requestDevice({ requiredLimits: {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBuffersPerShaderStage: Math.min(10, adapter.limits.maxStorageBuffersPerShaderStage) } });
  const errors = [];
  device.addEventListener("uncapturederror", e => errors.push(e.error.message));
  const w = meta.width, h = meta.height, n = w * h;
  const cw = Math.ceil(w / 3), chh = Math.ceil(h / 3);
  const flipped = meta.flip === 5 || meta.flip === 6;
  const outW = flipped ? h : w, outH = flipped ? w : h;
  const st = meta.sample_stride, sw = Math.ceil(outW / st), sh = Math.ceil(outH / st);
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const make = bytes => device.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage });
  const timings = {}; let mark = performance.now();
  const stage = async name => { if (syncStages) await device.queue.onSubmittedWorkDone(); const now = performance.now(); timings[name] = (timings[name] || 0) + now - mark; mark = now; };

  const params = new ArrayBuffer(21 * 16);
  const u32 = new Uint32Array(params), f32 = new Float32Array(params);
  const setU = (slot, values) => values.forEach((v, k) => u32[slot * 4 + k] = v);
  const setF = (slot, values) => values.forEach((v, k) => f32[slot * 4 + k] = v);
  setU(0, [w, h, meta.flip, st]); setU(1, [cw, chh, outW, sw]);
  setU(2, meta.cfa_rgb); setU(3, meta.cfa_raw);
  setF(4, meta.raw_black); setF(5, meta.raw_white.map((v, k) => v - meta.raw_black[k]));
  setF(6, meta.wb); setF(7, meta.wb.map(v => v * meta.threshold)); setF(8, [0, 0, 0]);
  setF(9, meta.rgb_white.map((v, k) => Math.fround(1 / (v - meta.rgb_black[k]))));
  meta.camera_to_acescg.forEach((row, k) => setF(10 + k, row));
  meta.xyz_cam.forEach((row, k) => setF(13 + k, row));
  meta.acescg_to_bt2020.forEach((row, k) => setF(16 + k, row));
  setF(19, [meta.calibration_gain]);
  const uniform = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, params);

  const pipelines = {};
  const pipeline = (name, code) => pipelines[name] ||= device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
  for (const [name, code] of Object.entries({ NORMALIZE, DILATE, RESIDUAL, REPAIR, GREEN, HOMOGENEITY, COMBINE, REDUCE })) pipeline(name, code);
  await stage("compile");

  const mosaicBuf = make(n * 2);
  device.queue.writeBuffer(mosaicBuf, 0, mosaic.buffer, mosaic.byteOffset, Math.floor(mosaic.byteLength / 4) * 4);
  if (mosaic.byteLength % 4) { const tail = new Uint8Array(4); tail.set(mosaic.subarray(mosaic.byteLength - (mosaic.byteLength % 4))); device.queue.writeBuffer(mosaicBuf, mosaic.byteLength - (mosaic.byteLength % 4), tail); }
  await stage("upload");

  const norm = make(n * 4), ints = make(n * 4), clip = make(Math.ceil(n / 32) * 4);
  const coarse = make(cw * chh * 4), dilated = make(cw * chh * 4), counts = make(16);
  const wgX = Math.ceil(w / 16), wgY = Math.ceil(h / 16);
  const partials = make(wgX * wgY * 6 * 4);
  const run = (name, entries, x, y) => {
    const pipe = pipelines[name];
    const group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: entries.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const enc = device.createCommandEncoder(); const pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.dispatchWorkgroups(x, y); pass.end();
    device.queue.submit([enc.finish()]);
  };
  const read = async (buffer, bytes) => {
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(buffer, 0, staging, 0, bytes); device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ); const copy = staging.getMappedRange().slice(0); staging.destroy(); return copy;
  };

  run("NORMALIZE", [uniform, mosaicBuf, norm, ints, clip, coarse, counts], wgX, wgY);
  const clipped = new Uint32Array(await read(counts, 16)).slice(0, 3);
  let chroma = [0, 0, 0], residualCounts = [0, 0, 0];
  if (clipped.some(v => v > 0)) {
    run("DILATE", [uniform, coarse, dilated], Math.ceil(cw / 16), Math.ceil(chh / 16));
    run("RESIDUAL", [uniform, norm, dilated, partials], wgX, wgY);
    const sums = new Float32Array(await read(partials, wgX * wgY * 6 * 4));
    const total = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < sums.length; k += 6) for (let j = 0; j < 6; j++) total[j] += sums[k + j];
    residualCounts = total.slice(3);
    chroma = [0, 1, 2].map(k => total[3 + k] > 100 ? Math.fround(total[k] / total[3 + k]) : 0);
    setF(8, chroma); device.queue.writeBuffer(uniform, 0, params);
    run("REPAIR", [uniform, norm, clip, ints], wgX, wgY);
  }
  await stage("highlights");
  norm.destroy();

  const gpack = make(n * 4);
  run("GREEN", [uniform, ints, gpack], wgX, wgY);
  await stage("green");
  const homo = make(n * 4);
  run("HOMOGENEITY", [uniform, ints, gpack, homo], wgX, wgY);
  await stage("homogeneity");
  const planes = [make(n * 4), make(n * 4), make(n * 4)];
  const peaks = make(16), samples = make(sw * sh * 3 * 4);
  run("COMBINE", [uniform, ints, gpack, homo, ...planes, peaks, samples], wgX, wgY);
  await stage("combine_colour_measure");
  homo.destroy(); gpack.destroy();

  const reduced = {};
  for (const [edge, [rh, rw]] of Object.entries(meta.reduced_sizes_sensor)) {
    reduced[edge] = { height: rh, width: rw, planes: [] };
    for (const plane of planes) {
      const mid = make(h * rw * 4), out = make(rh * rw * 4);
      const pass = (src, dst, inLen, outLen, across, axis) => {
        const ub = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(ub, 0, new Uint32Array([inLen, outLen, across, axis]));
        run("REDUCE", [ub, src, dst], Math.ceil(outLen / 16), Math.ceil(across / 16));
      };
      pass(plane, mid, w, rw, h, 0);
      pass(mid, out, h, rh, rw, 1);
      reduced[edge].planes.push(out); reduced[edge].mid = mid;
    }
  }
  await stage("reduce");
  for (const edge of Object.keys(reduced)) {
    const r = reduced[edge];
    r.planes = await Promise.all(r.planes.map(b => read(b, r.height * r.width * 4)));
  }
  const peakBits = new Float32Array(await read(peaks, 16));
  const sampleData = new Float32Array(await read(samples, sw * sh * 3 * 4));
  await stage("readback");
  device.destroy();
  return { timings, errors, clipped: [...clipped], chroma, residualCounts,
    peaks: { peak: peakBits[0], peak_luma: peakBits[1], peak_bt2020: peakBits[2] },
    samples: sampleData, sampleShape: [sh, sw], reduced };
}
window.developRaw = developRaw;
