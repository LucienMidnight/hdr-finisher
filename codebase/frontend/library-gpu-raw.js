/* Camera RAW development on the GPU (WebGPU), with the same maths as Grade's
 * CPU import: opposed-colour highlight repair, LibRaw 0.22.1 AHD demosaic,
 * camera RGB to ACEScg, import gamut projection, fixed calibration,
 * full-source measurements and Pillow-equivalent bilinear reduction.
 * The Library uses it for camera RAW grid thumbnails (backend:
 * library_gpu_raw.py); tools/gpu_raw_prototype compares it with the CPU. */
(function (root) {
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
    misc: vec4<f32>,        // calibration gain, lens flags, gain grid w, h
    lensc: vec4<f32>,       // lens coordinate grid w, h, offset in the lens buffer
    dispatch: vec4<u32>,    // row offset for bounded background submissions
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
  fn main(@builtin(global_invocation_id) g0: vec3<u32>, @builtin(local_invocation_index) li: u32) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
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
  fn main(@builtin(global_invocation_id) g0: vec3<u32>) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
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
  fn main(@builtin(global_invocation_id) g0: vec3<u32>, @builtin(local_invocation_index) li: u32,
          @builtin(workgroup_id) wg0: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
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
    let wg = wg0 + vec3<u32>(0u, p.dispatch.y / 16u, 0u);
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
  fn main(@builtin(global_invocation_id) g0: vec3<u32>) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
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
  fn main(@builtin(global_invocation_id) g0: vec3<u32>) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
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
  fn main(@builtin(global_invocation_id) g0: vec3<u32>) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
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

  // Turned picture <-> sensor coordinates, as LibRaw turns its output.
  const TURN = /* wgsl */ `
  fn flipped() -> bool { return p.dims.z == 5u || p.dims.z == 6u; }
  fn OW() -> i32 { return select(W(), H(), flipped()); }
  fn OH() -> i32 { return select(H(), W(), flipped()); }
  fn turned(r: i32, c: i32) -> vec2<i32> {
    let flip = p.dims.z;
    if (flip == 3u) { return vec2<i32>(H() - 1 - r, W() - 1 - c); }
    if (flip == 6u) { return vec2<i32>(c, H() - 1 - r); }
    if (flip == 5u) { return vec2<i32>(W() - 1 - c, r); }
    return vec2<i32>(r, c);
  }
  fn sensorOf(fr: i32, fc: i32) -> vec2<i32> {
    let flip = p.dims.z;
    if (flip == 3u) { return vec2<i32>(H() - 1 - fr, W() - 1 - fc); }
    if (flip == 6u) { return vec2<i32>(H() - 1 - fc, fr); }
    if (flip == 5u) { return vec2<i32>(fc, W() - 1 - fr); }
    return vec2<i32>(fr, fc);
  }`;

  // Grade's Lensfun correction over the turned picture, on even grids (point
  // k sits at k * (size - 1) / (grid - 1)): the vignetting gain, then exact
  // full-size per-channel source coordinates for distortion and colour
  // fringing. misc.y: 1 gain present, 2 coordinates present.
  const LENS = /* wgsl */ `
  @group(0) @binding(9) var<storage, read> lensGrid: array<f32>;
  fn hasGain() -> bool { return (u32(p.misc.y) & 1u) != 0u; }
  fn hasGeometry() -> bool { return (u32(p.misc.y) & 2u) != 0u; }
  // Component comp of a grid with width values per point, at turned (fr, fc).
  fn grid(base: i32, width: i32, comp: i32, fr: f32, fc: f32, gw: i32, gh: i32) -> f32 {
    let x = clamp(fc * f32(gw - 1) / f32(max(OW() - 1, 1)), 0.0, f32(gw - 1));
    let y = clamp(fr * f32(gh - 1) / f32(max(OH() - 1, 1)), 0.0, f32(gh - 1));
    let x0 = i32(floor(x)); let y0 = i32(floor(y)); let x1 = min(x0 + 1, gw - 1); let y1 = min(y0 + 1, gh - 1);
    let fx = x - f32(x0); let fy = y - f32(y0);
    let a = lensGrid[u32(base + (y0 * gw + x0) * width + comp)]; let b = lensGrid[u32(base + (y0 * gw + x1) * width + comp)];
    let c = lensGrid[u32(base + (y1 * gw + x0) * width + comp)]; let d = lensGrid[u32(base + (y1 * gw + x1) * width + comp)];
    return mix(mix(a, b, fx), mix(c, d, fx), fy);
  }
  fn gain(fr: f32, fc: f32) -> f32 { return grid(0, 1, 0, fr, fc, i32(p.misc.z), i32(p.misc.w)); }
  fn coordinate(comp: i32, fr: f32, fc: f32) -> f32 { return grid(i32(p.lensc.z), 6, comp, fr, fc, i32(p.lensc.x), i32(p.lensc.y)); }`;

  // After lens correction: the import gamut projection, the calibration, then
  // the full-source measurements Grade takes (exact peaks, strided sample).
  const FINISHING = /* wgsl */ `
  @group(0) @binding(4) var<storage, read_write> outR: array<f32>;
  @group(0) @binding(5) var<storage, read_write> outG: array<f32>;
  @group(0) @binding(6) var<storage, read_write> outB: array<f32>;
  @group(0) @binding(7) var<storage, read_write> peaks: array<atomic<u32>>;
  @group(0) @binding(8) var<storage, read_write> samples: array<f32>;
  var<workgroup> wgPeak: array<atomic<u32>, 3>;
  fn finish(value: vec3<f32>, r: i32, c: i32) {
    var aces = value;
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
    // Grade samples every stride-th row and column of the turned picture.
    let t = turned(r, c); let st = i32(p.dims.w);
    if (t.x % st == 0 && t.y % st == 0) {
      let si = u32(t.x / st) * p.dims2.w + u32(t.y / st);
      samples[si * 3u] = max(luma, 0.0); samples[si * 3u + 1u] = max(top, 0.0); samples[si * 3u + 2u] = max(btop, 0.0);
    }
  }`;

  const COMBINE = COMMON + AHD_RGB + TURN + LENS + FINISHING + /* wgsl */ `
  @group(0) @binding(3) var<storage, read> homo: array<u32>;
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
  fn main(@builtin(global_invocation_id) g0: vec3<u32>, @builtin(local_invocation_index) li: u32) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
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
      if (hasGain()) { let t = turned(r, c); aces = aces * gain(f32(t.x), f32(t.y)); }
      if (hasGeometry()) {
        // The lens remap reads neighbours: keep ACEScg for the next pass.
        let i = u32(r * W() + c); outR[i] = aces.x; outG[i] = aces.y; outB[i] = aces.z;
      } else { finish(aces, r, c); }
    }
    workgroupBarrier();
    if (li < 3u) { atomicMax(&peaks[li], atomicLoad(&wgPeak[li])); }
  }`;

  // raw_import._remap_bilinear_strips on the turned picture: per-channel
  // source coordinates, clamped to the frame, bilinear.
  const REMAP = COMMON + TURN + LENS + FINISHING + /* wgsl */ `
  @group(0) @binding(1) var<storage, read> inR: array<f32>;
  @group(0) @binding(2) var<storage, read> inG: array<f32>;
  @group(0) @binding(3) var<storage, read> inB: array<f32>;
  fn at(k: i32, fr: i32, fc: i32) -> f32 {
    let s = sensorOf(fr, fc); let i = u32(s.x * W() + s.y);
    if (k == 0) { return inR[i]; } else if (k == 1) { return inG[i]; }
    return inB[i];
  }
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) g0: vec3<u32>, @builtin(local_invocation_index) li: u32) {
    let g = g0 + vec3<u32>(0u, p.dispatch.y, 0u);
    if (li < 3u) { atomicStore(&wgPeak[li], 0u); }
    workgroupBarrier();
    let c = i32(g.x); let r = i32(g.y);
    if (c < W() && r < H()) {
      let t = turned(r, c);
      var value = vec3<f32>(0.0);
      for (var k = 0; k < 3; k++) {
        let x = clamp(coordinate(k * 2, f32(t.x), f32(t.y)), 0.0, f32(OW() - 1));
        let y = clamp(coordinate(k * 2 + 1, f32(t.x), f32(t.y)), 0.0, f32(OH() - 1));
        let x0 = i32(floor(x)); let y0 = i32(floor(y));
        let x1 = min(x0 + 1, OW() - 1); let y1 = min(y0 + 1, OH() - 1);
        let wx = x - f32(x0); let wy = y - f32(y0);
        let top = at(k, y0, x0) * (1.0 - wx) + at(k, y0, x1) * wx;
        let bottom = at(k, y1, x0) * (1.0 - wx) + at(k, y1, x1) * wx;
        value[k] = top * (1.0 - wy) + bottom * wy;
      }
      finish(value, r, c);
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

  // One device and one set of pipelines for the Library window; developments
  // run one at a time so a scrolled grid never holds several sources at once.
  let shared = null, queue = Promise.resolve();
  async function gpu(beforeNext = async () => {}) {
    if (shared) return shared;
    shared = (async () => {
      if (!navigator.gpu) throw new Error("WebGPU is unavailable.");
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("No WebGPU adapter.");
      if (adapter.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software rasterizer/i.test(
        [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.device, adapter.info?.description].join(" ")))
        throw new Error("No hardware GPU is available.");
      const device = await adapter.requestDevice({ requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBuffersPerShaderStage: Math.min(10, adapter.limits.maxStorageBuffersPerShaderStage) } });
      const errors = [];
      device.addEventListener("uncapturederror", event => errors.push(event.error.message));
      device.lost.then(() => { shared = null; });
      const pipelines = {};
      for (const [name, code] of Object.entries({ NORMALIZE, DILATE, RESIDUAL, REPAIR, GREEN, HOMOGENEITY, COMBINE, REMAP, REDUCE })) {
        await beforeNext();
        pipelines[name] = await device.createComputePipelineAsync({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
      }
      return { device, pipelines, errors };
    })();
    try { return await shared; } catch (error) { shared = null; throw error; }
  }

  // Python's round(): halves go to the even neighbour (Pillow sizes come from it).
  function pyRound(value) {
    const floor = Math.floor(value), diff = value - floor;
    if (diff > 0.5) return floor + 1;
    if (diff < 0.5) return floor;
    return floor % 2 === 0 ? floor : floor + 1;
  }
  // reduce_picture's size, in sensor orientation (a 90 degree turn swaps the axes).
  function reducedSize(meta, edge) {
    const turned = meta.flip === 5 || meta.flip === 6;
    const outH = turned ? meta.width : meta.height, outW = turned ? meta.height : meta.width;
    const scale = Math.min(1, edge / Math.max(outH, outW));
    const h = Math.max(1, pyRound(outH * scale)), w = Math.max(1, pyRound(outW * scale));
    return turned ? [w, h] : [h, w];
  }

  // numpy.quantile (linear) of one interleaved channel, by selection instead of a full sort.
  function select(values, k) {
    let left = 0, right = values.length - 1;
    while (right > left) {
      const pivot = values[(left + right) >> 1];
      let i = left, j = right;
      while (i <= j) {
        while (values[i] < pivot) i++;
        while (values[j] > pivot) j--;
        if (i <= j) { const t = values[i]; values[i] = values[j]; values[j] = t; i++; j--; }
      }
      if (k <= j) right = j; else if (k >= i) left = i; else break;
    }
    return values[k];
  }
  function quantile(samples, channel, q) {
    let n = 0; const values = new Float32Array(samples.length / 3);
    for (let i = 0; i < values.length; i++) { const v = samples[i * 3 + channel]; if (v >= 0) values[n++] = v; }
    if (!n) return 0;
    const kept = values.subarray(0, n);
    const position = (n - 1) * q, lo = Math.floor(position), hi = Math.ceil(position);
    const low = select(kept, lo);
    let high = low;
    if (hi !== lo) { high = Infinity; for (let i = lo + 1; i < n; i++) if (kept[i] < high) high = kept[i]; }
    return low + (high - low) * (position - lo);
  }

  async function developRaw({ mosaic, meta, lensData = null, edges = Object.keys(meta.reduced_sizes_sensor || {}).map(Number), syncStages = false, beforeSubmit = null, memoryBudget = Infinity }) {
    const { device, pipelines, errors } = await gpu();
    errors.length = 0;
    const w = meta.width, h = meta.height, n = w * h;
    const cw = Math.ceil(w / 3), chh = Math.ceil(h / 3);
    const turned = meta.flip === 5 || meta.flip === 6;
    const outW = turned ? h : w, outH = turned ? w : h;
    const st = meta.sample_stride, sw = Math.ceil(outW / st), sh = Math.ceil(outH / st);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const owned = new Set(); let liveBytes = 0, peakBytes = 0;
    const own = buffer => { owned.add(buffer); liveBytes += buffer.size; peakBytes = Math.max(peakBytes, liveBytes); return buffer; };
    const release = buffer => { if (owned.delete(buffer)) { liveBytes -= buffer.size; buffer.destroy(); } };
    const make = bytes => {
      const size = Math.max(4, Math.ceil(bytes / 4) * 4);
      if (liveBytes + size > memoryBudget) throw Error("GPU RAW development exceeds the reserved memory budget.");
      return own(device.createBuffer({ size, usage }));
    };
    const timings = {}; let mark = performance.now();
    const stage = async name => { if (syncStages) await device.queue.onSubmittedWorkDone(); const now = performance.now(); timings[name] = (timings[name] || 0) + now - mark; mark = now; };
    try {
      const params = new ArrayBuffer(22 * 16);
      const u32 = new Uint32Array(params), f32 = new Float32Array(params);
      const setU = (slot, values) => values.forEach((v, k) => { u32[slot * 4 + k] = v; });
      const setF = (slot, values) => values.forEach((v, k) => { f32[slot * 4 + k] = v; });
      setU(0, [w, h, meta.flip, st]); setU(1, [cw, chh, outW, sw]);
      setU(2, meta.cfa_rgb); setU(3, meta.cfa_raw);
      setF(4, meta.raw_black); setF(5, meta.raw_white.map((v, k) => v - meta.raw_black[k]));
      setF(6, meta.wb); setF(7, meta.wb.map(v => v * meta.threshold)); setF(8, [0, 0, 0]);
      setF(9, meta.rgb_white.map((v, k) => Math.fround(1 / (v - meta.rgb_black[k]))));
      meta.camera_to_acescg.forEach((row, k) => setF(10 + k, row));
      meta.xyz_cam.forEach((row, k) => setF(13 + k, row));
      meta.acescg_to_bt2020.forEach((row, k) => setF(16 + k, row));
      const lens = lensData && meta.lens_grid;
      const lensFlags = lens ? (lens.gain_width ? 1 : 0) | (lens.coordinate_width ? 2 : 0) : 0;
      setF(19, [meta.calibration_gain, lensFlags, lens?.gain_width || 2, lens?.gain_height || 2]);
      setF(20, [lens?.coordinate_width || 2, lens?.coordinate_height || 2, (lens?.gain_width || 0) * (lens?.gain_height || 0), 0]);
      const uniform = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      own(uniform);
      device.queue.writeBuffer(uniform, 0, params);

      const mosaicBuf = make(n * 2);
      const whole = Math.floor(mosaic.byteLength / 4) * 4;
      device.queue.writeBuffer(mosaicBuf, 0, mosaic.buffer, mosaic.byteOffset, whole);
      if (whole < mosaic.byteLength) { const tail = new Uint8Array(4); tail.set(mosaic.subarray(whole)); device.queue.writeBuffer(mosaicBuf, whole, tail); }
      await stage("upload");

      const norm = make(n * 4), ints = make(n * 4), clip = make(Math.ceil(n / 32) * 4);
      const coarse = make(cw * chh * 4), dilated = make(cw * chh * 4), counts = make(16);
      const wgX = Math.ceil(w / 16), wgY = Math.ceil(h / 16);
      const partials = make(wgX * wgY * 6 * 4);
      const run = async (name, entries, x, y) => {
        const pipe = pipelines[name];
        const group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: entries.map((buffer, binding) => ({ binding, resource: { buffer } })) });
        const band = beforeSubmit && name !== "REDUCE" ? 8 : y;
        for (let row = 0; row < y; row += band) {
          if (beforeSubmit) await beforeSubmit();
          if (name !== "REDUCE") device.queue.writeBuffer(uniform, 21 * 16, new Uint32Array([0, row * 16, 0, 0]));
          const encoder = device.createCommandEncoder(); const pass = encoder.beginComputePass();
          pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.dispatchWorkgroups(x, Math.min(band, y - row)); pass.end();
          device.queue.submit([encoder.finish()]);
          if (beforeSubmit) await device.queue.onSubmittedWorkDone();
        }
      };
      const read = async (buffer, bytes) => {
        const staging = own(device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
        const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes); device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ); const copy = staging.getMappedRange().slice(0); release(staging); return copy;
      };

      await run("NORMALIZE", [uniform, mosaicBuf, norm, ints, clip, coarse, counts], wgX, wgY);
      const clipped = new Uint32Array(await read(counts, 16)).slice(0, 3);
      let chroma = [0, 0, 0];
      if (clipped.some(v => v > 0)) {
        await run("DILATE", [uniform, coarse, dilated], Math.ceil(cw / 16), Math.ceil(chh / 16));
        await run("RESIDUAL", [uniform, norm, dilated, partials], wgX, wgY);
        const sums = new Float32Array(await read(partials, wgX * wgY * 6 * 4));
        const total = [0, 0, 0, 0, 0, 0];
        for (let k = 0; k < sums.length; k += 6) for (let j = 0; j < 6; j++) total[j] += sums[k + j];
        // raw_import keeps a correction only with more than 100 nearby samples.
        chroma = [0, 1, 2].map(k => total[3 + k] > 100 ? Math.fround(total[k] / total[3 + k]) : 0);
        setF(8, chroma); device.queue.writeBuffer(uniform, 0, params);
        await run("REPAIR", [uniform, norm, clip, ints], wgX, wgY);
      }
      await stage("highlights");
      await device.queue.onSubmittedWorkDone();
      for (const buffer of [mosaicBuf, norm, clip, coarse, dilated, counts, partials]) release(buffer);

      const gpack = make(n * 4);
      await run("GREEN", [uniform, ints, gpack], wgX, wgY);
      const homo = make(n * 4);
      await run("HOMOGENEITY", [uniform, ints, gpack, homo], wgX, wgY);
      await stage("demosaic");
      const planes = [make(n * 4), make(n * 4), make(n * 4)];
      const peaks = make(16), samples = make(sw * sh * 3 * 4);
      const grid = make(lens ? lensData.byteLength : 4);
      if (lens) device.queue.writeBuffer(grid, 0, lensData.buffer, lensData.byteOffset, lensData.byteLength);
      await run("COMBINE", [uniform, ints, gpack, homo, ...planes, peaks, samples, grid], wgX, wgY);
      await device.queue.onSubmittedWorkDone();
      for (const buffer of [ints, gpack, homo]) release(buffer);
      if (lensFlags & 2) {
        // Lens geometry reads neighbours, so it runs as its own pass.
        const corrected = [make(n * 4), make(n * 4), make(n * 4)];
        await run("REMAP", [uniform, ...planes, ...corrected, peaks, samples, grid], wgX, wgY);
        await stage("lens");
        await device.queue.onSubmittedWorkDone();
        for (const buffer of planes) release(buffer);
        planes.splice(0, 3, ...corrected);
      }
      await stage("combine_colour_measure");

      const reduced = {};
      for (const edge of edges) {
        const [rh, rw] = reducedSize(meta, edge);
        reduced[edge] = { height: rh, width: rw, planes: [] };
        for (const plane of planes) {
          const mid = make(h * rw * 4), out = make(rh * rw * 4);
          for (const [src, dst, inLen, outLen, across, axis] of [[plane, mid, w, rw, h, 0], [mid, out, h, rh, rw, 1]]) {
            const settings = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            own(settings);
            device.queue.writeBuffer(settings, 0, new Uint32Array([inLen, outLen, across, axis]));
            await run("REDUCE", [settings, src, dst], Math.ceil(outLen / 16), Math.ceil(across / 16));
          }
          await device.queue.onSubmittedWorkDone();
          release(mid);
          reduced[edge].planes.push(out);
        }
      }
      await stage("reduce");
      await device.queue.onSubmittedWorkDone();
      for (const buffer of planes) release(buffer);
      for (const edge of Object.keys(reduced)) {
        const r = reduced[edge];
        r.planes = await Promise.all(r.planes.map(buffer => read(buffer, r.height * r.width * 4)));
      }
      const peakValues = new Float32Array(await read(peaks, 16));
      const sampleData = new Float32Array(await read(samples, sw * sh * 3 * 4));
      await stage("readback");
      if (errors.length) throw new Error(errors.join("\n"));
      return { timings, memory_peak_bytes: peakBytes, errors: [...errors], clipped: [...clipped], chroma,
        peaks: { peak: peakValues[0], peak_luma: peakValues[1], peak_bt2020: peakValues[2] },
        samples: sampleData, sampleShape: [sh, sw], reduced };
    } finally {
      await device.queue.onSubmittedWorkDone().catch(() => {});
      for (const buffer of [...owned]) release(buffer);
    }
  }

  function serial(task) {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  }

  function enabled() {
    try { if (root.localStorage?.getItem("library-gpu-raw") === "off") return false; } catch { /* storage may be blocked */ }
    return !!root.navigator?.gpu;
  }

  const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });

  // A camera RAW grid thumbnail: the backend unpacks the sensor, this window
  // develops it on the GPU, the backend stores it where Grade's CPU development
  // would. Resolves null when the photo keeps the CPU route. An edited photo
  // (savedGradeOnly) answers with its saved-grade picture or a wait.
  async function develop(path, edge, signal, savedGradeOnly) {
    const begun = performance.now();
    let response;
    for (;;) {
      response = await fetch("/api/library/raw-sensor", { method: "POST", signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, edge, saved_grade_only: savedGradeOnly }) });
      if (response.status !== 202) break;
      await wait(150, signal);
    }
    if (response.status === 204) return null;
    if (!response.ok) { const error = new Error((await response.json().catch(() => ({}))).detail || "Library request failed."); error.status = response.status; throw error; }
    if ((response.headers.get("Content-Type") || "").includes("application/json")) return response.json();
    const body = await response.arrayBuffer();
    const sensorMs = performance.now() - begun;
    const length = new DataView(body).getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(body, 4, length)));
    const mosaic = new Uint8Array(body, 4 + length, meta.mosaic_bytes);
    const lensData = meta.lens_grid ? new Float32Array(body, 4 + length + meta.lens_offset, meta.lens_grid.floats) : null;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const started = performance.now();
    const developed = await serial(async () => {
      await gpu();
      const id = crypto.randomUUID(), bytes = meta.width * meta.height * 44 + 64 * 1024 * 1024;
      const url = `/api/delivery/gpu/raw-budget/${id}`;
      const lease = async release => {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        const response = await fetch(url, { method: "POST", signal,
          headers: {"Content-Type": "application/json"}, body: JSON.stringify({bytes, release}) });
        if (!response.ok) throw Error("GPU memory scheduler unavailable.");
        return response.json();
      };
      try {
        for (;;) {
          const value = await lease(false);
          if (value.fallback) throw Error(value.fallback);
          if (!value.granted || value.preempt) {
            if (value.granted) await lease(true);
            await wait(50, signal); continue;
          }
          const beforeSubmit = async () => {
            const status = await lease(false);
            if (!status.granted || status.preempt || status.fallback) { const error = Error("Yielding GPU RAW to shared work."); error.yieldRaw = true; throw error; }
          };
          try { return await developRaw({mosaic, meta, lensData, edges:[edge], beforeSubmit, memoryBudget:bytes}); }
          catch (error) { if (!error.yieldRaw) throw error; }
          // developRaw's finally has freed every buffer before Grade sees zero.
          await lease(true); await wait(50, signal);
        }
      } finally { await fetch(url, {method:"DELETE"}).catch(() => {}); }
    });
    const gpuMs = performance.now() - started;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const picture = developed.reduced[edge];
    const measured = performance.now();
    const robust = { luma: quantile(developed.samples, 0, 0.9999), channel: quantile(developed.samples, 1, 0.9999), bt2020: quantile(developed.samples, 2, 0.9999) };
    const quantileMs = performance.now() - measured;
    const header = { path: meta.path, identity: meta.identity, raw_import_settings: meta.raw_import_settings,
      edge, flip: meta.flip, height: picture.height, width: picture.width,
      source_width: meta.flip === 5 || meta.flip === 6 ? meta.height : meta.width, source_height: meta.flip === 5 || meta.flip === 6 ? meta.width : meta.height,
      peaks: developed.peaks, robust, lens_corrected: !!meta.lens_grid, raw_start_brightness: meta.raw_start_brightness, gpu_ms: Math.round(gpuMs),
      memory_peak_bytes: developed.memory_peak_bytes,
      timing_ms: { sensor: Math.round(sensorMs), gpu: Math.round(gpuMs), quantiles: Math.round(quantileMs) } };
    let text = new TextEncoder().encode(JSON.stringify(header));
    const padded = new Uint8Array(text.length + ((4 - ((4 + text.length) % 4)) % 4)).fill(32); padded.set(text); text = padded;
    const out = new Uint8Array(4 + text.length + picture.height * picture.width * 12);
    new DataView(out.buffer).setUint32(0, text.length, true); out.set(text, 4);
    picture.planes.forEach((plane, k) => out.set(new Uint8Array(plane), 4 + text.length + k * plane.byteLength));
    const stored = await fetch("/api/library/raw-developed", { method: "POST", signal, headers: { "Content-Type": "application/octet-stream" }, body: out });
    const result = await stored.json();
    if (!stored.ok) { const error = new Error(result.detail || "Library request failed."); error.status = stored.status; throw error; }
    return result;
  }

  // At most two photos in flight: their sensor transfers must never hold up
  // camera previews or other Library requests. Scrolled-past jobs are dropped.
  const LIMIT = 2, waiting = [], inflight = new Map();
  let running = 0;
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  function pump() {
    while (running < LIMIT && waiting.length) {
      const job = waiting.shift();
      if (job.signal.aborted) { job.reject(cancelled()); continue; }
      running++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  }
  // The grid and the filmstrip can ask for the same photo: they share one job,
  // which stops only when every asker has scrolled past it.
  function thumbnail(path, edge, signal, { savedGradeOnly = false } = {}) {
    root.HDRIdleWarmup?.touch();
    const key = `${path}|${edge}|${savedGradeOnly}`;
    let job = inflight.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, users: 0 };
      job.promise = new Promise((resolve, reject) => {
        waiting.push({ signal: controller.signal, resolve, reject, task: () => develop(path, edge, controller.signal, savedGradeOnly) });
        pump();
      }).finally(() => { if (inflight.get(key) === job) inflight.delete(key); });
      job.promise.catch(() => {});
      inflight.set(key, job);
    }
    job.users++;
    return new Promise((resolve, reject) => {
      const leave = () => { job.users--; if (job.users <= 0) job.controller.abort(); reject(cancelled()); };
      if (signal?.aborted) { leave(); return; }
      signal?.addEventListener("abort", leave, { once: true });
      job.promise.then(value => { signal?.removeEventListener("abort", leave); resolve(value); },
        error => { signal?.removeEventListener("abort", leave); reject(error); });
    });
  }

  const warmup = async beforeNext => { if (enabled()) await gpu(() => beforeNext(() => inflight.size > 0)); };
  const exported = Object.freeze({ developRaw, thumbnail, enabled, quantile, reducedSize, warmup });
  root.HDRLibraryGpuRaw = exported;
  root.developRaw = developRaw;
})(typeof window === "undefined" ? globalThis : window);
