/* Shared "Light" colour selection for Global HSL and the Local hue mask.
 * GPU route; backend/hdr_finisher/hsl_selection.py is the matching CPU reference.
 * Input: a fields texture the renderer fills from the HSL stage input (D65 linear
 * sRGB): (a/L, b/L, log2 L, 1). Output: rgba32float array layers, one coverage per
 * lane (four channels per layer). RGB is never altered here.
 * Distances are source pixels converted by the processing scale; the coarse grid
 * is anchored to the frame origin so tiles with enough halo match the whole frame.
 */
(function () {
  const CELL = 4, GUIDE = 4, SURROUND = 2, MIN_SCALE = .05, LANE_RANGES = 32;
  const round = v => Math.floor(v + .5);
  function geometry(scale = 1) {
    const s = Math.min(1, Math.max(MIN_SCALE, Number(scale) || 1));
    const cell = Math.max(1, round(CELL * s)), sigma = CELL * s / cell;
    const taps = Math.max(1, Math.ceil(4 * sigma));
    const guide = Math.max(1, round(GUIDE * s)), surround = Math.max(1, round(SURROUND * s));
    return { cell, sigma, taps, guide, surround, reach: cell * (taps + 2) + 2 * guide + surround + 2 };
  }
  const shader = `
@group(0) @binding(0) var fields: texture_2d<f32>;
@group(0) @binding(1) var coarse: texture_2d<f32>;
@group(0) @binding(2) var guideTex: texture_2d<f32>;
@group(0) @binding(3) var coefA: texture_2d<f32>;
@group(0) @binding(4) var coefB: texture_2d<f32>;
@group(0) @binding(5) var<storage,read> p: array<f32>;
@group(0) @binding(6) var<storage,read> ranges: array<vec4f>;
@group(0) @binding(7) var storeA: texture_storage_2d<rgba32float,write>;
@group(0) @binding(8) var storeB: texture_storage_2d<rgba32float,write>;
@group(0) @binding(9) var storeLayers: texture_storage_2d_array<rgba32float,write>;
// p: 0 width, 1 height, 2 coarse width, 3 coarse height, 4 origin x, 5 origin y,
// 6 cell, 7 sigma, 8 taps, 9 guide radius, 10 surround radius, 11 layer,
// 12..15 lane neutral floors, 16..19 lane range counts.
const EPSILON: f32 = .03;
fn region() -> vec2i { return vec2i(i32(p[0]), i32(p[1])); }
fn coarseSize() -> vec2i { return vec2i(i32(p[2]), i32(p[3])); }
fn cell() -> i32 { return i32(p[6]); }
fn origin() -> vec2i { return vec2i(i32(p[4]), i32(p[5])); }
fn firstCell() -> vec2i { return origin() / cell(); }
fn reflectIndex(v: i32, n: i32) -> i32 {
  let period = 2 * n; let q = ((v % period) + period) % period;
  return select(q, period - 1 - q, q >= n);
}
fn reflect2(xy: vec2i, n: vec2i) -> vec2i { return vec2i(reflectIndex(xy.x, n.x), reflectIndex(xy.y, n.y)); }
fn field(xy: vec2i) -> vec4f { return textureLoad(fields, reflect2(xy, region()), 0); }
fn guideAt(xy: vec2i) -> vec4f { return textureLoad(guideTex, reflect2(xy, region()), 0); }
fn coarseAt(xy: vec2i) -> vec4f { return textureLoad(coarse, clamp(xy, vec2i(0), coarseSize() - 1), 0); }
// Bilinear from cell centres in frame coordinates; outermost samples clamp.
fn interpolate(xy: vec2i) -> vec4f {
  let position = (vec2f(xy + origin()) + .5) / f32(cell()) - .5 - vec2f(firstCell());
  let base = vec2i(floor(position)); let f = position - floor(position);
  return mix(mix(coarseAt(base), coarseAt(base + vec2i(1, 0)), f.x),
             mix(coarseAt(base + vec2i(0, 1)), coarseAt(base + 1), f.x), f.y);
}
fn inside(xy: vec2i, size: vec2i) -> bool { return all(xy >= vec2i(0)) && all(xy < size); }

@compute @workgroup_size(8,8) fn reduce(@builtin(global_invocation_id) id: vec3u) {
  let xy = vec2i(id.xy); if (!inside(xy, coarseSize())) { return; }
  let c = cell(); let lo = max((firstCell() + xy) * c - origin(), vec2i(0));
  let hi = min((firstCell() + xy + 1) * c - origin(), region());
  var sum = vec2f(0.); var count = 0.;
  for (var y = lo.y; y < hi.y; y++) { for (var x = lo.x; x < hi.x; x++) {
    sum += textureLoad(fields, vec2i(x, y), 0).xy; count += 1.;
  } }
  textureStore(storeA, xy, vec4f(sum / max(count, 1.), 0., 1.));
}
fn blur(xy: vec2i, axis: vec2i) -> vec4f {
  var sum = vec4f(0.); var total = 0.; let taps = i32(p[8]);
  for (var i = -taps; i <= taps; i++) {
    let w = exp(-.5 * (f32(i) / p[7]) * (f32(i) / p[7]));
    sum += textureLoad(coarse, reflect2(xy + axis * i, coarseSize()), 0) * w; total += w;
  }
  return sum / total;
}
@compute @workgroup_size(8,8) fn horizontal(@builtin(global_invocation_id) id: vec3u) {
  let xy = vec2i(id.xy); if (!inside(xy, coarseSize())) { return; } textureStore(storeA, xy, blur(xy, vec2i(1, 0)));
}
@compute @workgroup_size(8,8) fn vertical(@builtin(global_invocation_id) id: vec3u) {
  let xy = vec2i(id.xy); if (!inside(xy, coarseSize())) { return; } textureStore(storeA, xy, blur(xy, vec2i(0, 1)));
}
// Range-independent: (log2 L, protection, box mean of log2 L, its box variance).
@compute @workgroup_size(8,8) fn guide(@builtin(global_invocation_id) id: vec3u) {
  let xy = vec2i(id.xy); if (!inside(xy, region())) { return; }
  let f = field(xy); let q = i32(p[10]); let g = i32(p[9]);
  var surround = 0.;
  for (var y = -q; y <= q; y++) { for (var x = -q; x <= q; x++) { surround += field(xy + vec2i(x, y)).z; } }
  surround /= f32((2 * q + 1) * (2 * q + 1));
  var mean = 0.; var square = 0.;
  for (var y = -g; y <= g; y++) { for (var x = -g; x <= g; x++) {
    let v = field(xy + vec2i(x, y)).z; mean += v; square += v * v;
  } }
  let n = f32((2 * g + 1) * (2 * g + 1)); mean /= n; square /= n;
  let contrast = f.z - surround;
  let mismatch = smoothstep(.04, .16, length(f.xy - interpolate(xy).xy));
  let protection = (1. - smoothstep(.07, .30, contrast)) * (1. - mismatch * smoothstep(.025, .12, abs(contrast)));
  textureStore(storeA, xy, vec4f(f.z, protection, mean, square - mean * mean));
}
fn qualifyLane(ab: vec2f, lane: u32) -> f32 {
  let count = u32(p[16u + lane]); if (count == 0u) { return 0.; }
  let h = degrees(atan2(ab.y, ab.x)); var inc = 0.; var exc = 0.;
  for (var j = 0u; j < count; j++) {
    let r = ranges[lane * ${LANE_RANGES}u + j];
    let delta = abs((h - r.x + 180.) - floor((h - r.x + 180.) / 360.) * 360. - 180.);
    let w = 1. - smoothstep(r.y, r.y + r.z, delta);
    if (r.w > .5) { exc = max(exc, w); } else { inc = max(inc, w); }
  }
  let floor_ = p[12u + lane];
  return inc * (1. - exc) * smoothstep(floor_, floor_ + .04, length(ab));
}
// Coarse resolution, four channels per texel.
@compute @workgroup_size(8,8) fn qualification(@builtin(global_invocation_id) id: vec3u) {
  let xy = vec2i(id.xy); if (!inside(xy, coarseSize())) { return; }
  let ab = textureLoad(coarse, xy, 0).xy;
  textureStore(storeA, xy, vec4f(qualifyLane(ab, 0u), qualifyLane(ab, 1u), qualifyLane(ab, 2u), qualifyLane(ab, 3u)));
}
// Guided filter with log2 L as the guide; coarse here is the qualified grid.
@compute @workgroup_size(8,8) fn coefficients(@builtin(global_invocation_id) id: vec3u) {
  let xy = vec2i(id.xy); if (!inside(xy, region())) { return; }
  let g = i32(p[9]); var mp = vec4f(0.); var mip = vec4f(0.);
  for (var y = -g; y <= g; y++) { for (var x = -g; x <= g; x++) {
    let t = reflect2(xy + vec2i(x, y), region());
    let v = interpolate(t); mp += v; mip += textureLoad(guideTex, t, 0).x * v;
  } }
  let n = f32((2 * g + 1) * (2 * g + 1)); mp /= n; mip /= n;
  let c = guideAt(xy);
  let a = (mip - c.z * mp) / max(c.w + EPSILON, EPSILON);
  textureStore(storeA, xy, a); textureStore(storeB, xy, mp - a * c.z);
}
@compute @workgroup_size(8,8) fn refinement(@builtin(global_invocation_id) id: vec3u) {
  let xy = vec2i(id.xy); if (!inside(xy, region())) { return; }
  let g = i32(p[9]); var ma = vec4f(0.); var mb = vec4f(0.);
  for (var y = -g; y <= g; y++) { for (var x = -g; x <= g; x++) {
    let t = reflect2(xy + vec2i(x, y), region());
    ma += textureLoad(coefA, t, 0); mb += textureLoad(coefB, t, 0);
  } }
  let n = f32((2 * g + 1) * (2 * g + 1)); let c = guideAt(xy);
  textureStore(storeLayers, xy, i32(p[11]), clamp((ma / n * c.x + mb / n) * c.y, vec4f(0.), vec4f(1.)));
}
`;
  class HslSelectionGpu {
    constructor(device, { onAllocate = null } = {}) {
      this.device = device; this.onAllocate = onAllocate;
      this.textures = {}; this.retired = []; this.capacity = null; this.preparedKey = null; this.selectedKey = null; this.serial = 0;
    }
    async initialize() {
      const module = this.device.createShaderModule({ label: "HSL selection", code: shader });
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === "error");
      if (errors.length) throw Error(errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join("\n"));
      const names = ["reduce", "horizontal", "vertical", "guide", "qualification", "coefficients", "refinement"];
      this.pipelines = Object.fromEntries(await Promise.all(names.map(async entry => [entry,
        await this.device.createComputePipelineAsync({ label: `HSL selection ${entry}`, layout: "auto", compute: { module, entryPoint: entry } })])));
      return this;
    }
    static geometry(scale) { return geometry(scale); }
    /** Another scratch/cache owner sharing these compiled pipelines. */
    fork() { const engine = new HslSelectionGpu(this.device, { onAllocate: this.onAllocate }); engine.pipelines = this.pipelines; return engine; }
    static bytesPerPixel(channels) { return 64 + 16 * Math.max(1, Math.ceil(channels / 4)); }
    /** Grow-only scratch: fields, guide, coefficients and the output layers. */
    ensure(width, height, layers, cellSize) {
      const cap = this.capacity;
      const cw = Math.ceil(width / cellSize) + 2, ch = Math.ceil(height / cellSize) + 2;
      if (cap && cap.width >= width && cap.height >= height && cap.layers >= layers && cap.cw >= cw && cap.ch >= ch) return;
      const next = { width: Math.max(width, cap?.width || 0), height: Math.max(height, cap?.height || 0),
        layers: Math.max(layers, cap?.layers || 0), cw: Math.max(cw, cap?.cw || 0), ch: Math.max(ch, cap?.ch || 0) };
      // Commands already encoded but not yet submitted may still use the old
      // textures, so they are retired, not destroyed, until dropRetired().
      this.retired.push(...Object.values(this.textures)); this.textures = {}; this.capacity = null; this.invalidate();
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
      const make = (label, w, h, extra = 0, depth = 1) => this.device.createTexture({ label, size: [w, h, depth], format: "rgba32float", usage: usage | extra });
      this.textures = {
        fields: make("HSL selection fields", next.width, next.height, GPUTextureUsage.RENDER_ATTACHMENT),
        guide: make("HSL selection guide", next.width, next.height),
        a: make("HSL selection coefficient a", next.width, next.height),
        b: make("HSL selection coefficient b", next.width, next.height),
        output: make("HSL selection", next.width, next.height, 0, next.layers),
        coarse: make("HSL coarse chroma", next.cw, next.ch),
        scratch: make("HSL coarse scratch", next.cw, next.ch),
        qualified: make("HSL qualified coarse", next.cw, next.ch),
      };
      this.capacity = next; this.preparedKey = null; this.selectedKey = null;
      this.onAllocate?.(next.width * next.height * (64 + 16 * next.layers) + next.cw * next.ch * 48, next);
    }
    fieldsView() { return this.textures.fields.createView(); }
    outputView() { return this.textures.output.createView({ dimension: "2d-array" }); }
    bytes() {
      const c = this.capacity; return c ? c.width * c.height * (64 + 16 * c.layers) + c.cw * c.ch * 48 : 0;
    }
    /** True when the fields for this key are already reduced into guide/coarse data. */
    isPrepared(key) { return key != null && key === this.preparedKey; }
    paramBuffer(values) {
      const buffer = this.device.createBuffer({ size: Math.max(16, values.byteLength), usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
      new Float32Array(buffer.getMappedRange()).set(values); buffer.unmap(); return buffer;
    }
    dispatch(encoder, entry, resources, width, height) {
      const pipeline = this.pipelines[entry], layout = pipeline.getBindGroupLayout(0);
      const pass = encoder.beginComputePass({ label: `HSL selection ${entry}` });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.device.createBindGroup({ layout, entries: Object.entries(resources)
        .map(([binding, resource]) => ({ binding: Number(binding), resource })) }));
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8)); pass.end();
    }
    /**
     * Encode preparation (when needed) and selection. The caller must already have
     * rendered the fields for `region` unless `isPrepared(prepareKey)`. `channels`
     * is [{ ranges: [{center,width,feather,subtract}], floor }]. Returns layer count.
     */
    encode(encoder, { width, height, originX = 0, originY = 0, scale = 1, channels, prepareKey = null, selectKey = null }) {
      if (!channels.length) throw Error("Selection needs at least one channel");
      if (channels.length > 16) throw Error("Selection supports at most 16 channels");
      const geo = geometry(scale), layers = Math.ceil(channels.length / 4);
      this.ensure(width, height, layers, geo.cell);
      const t = this.textures, view = texture => texture.createView();
      const first = [Math.floor(originX / geo.cell), Math.floor(originY / geo.cell)];
      const cw = Math.floor((originX + width - 1) / geo.cell) - first[0] + 1;
      const ch = Math.floor((originY + height - 1) / geo.cell) - first[1] + 1;
      const base = [width, height, cw, ch, originX, originY, geo.cell, geo.sigma, geo.taps, geo.guide, geo.surround, 0];
      const prepared = this.isPrepared(prepareKey);
      const selected = prepared && selectKey != null && selectKey === this.selectedKey;
      if (!prepared) {
        const params = { 5: { buffer: this.paramBuffer(new Float32Array([...base, 0, 0, 0, 0, 0, 0, 0, 0])) } };
        this.dispatch(encoder, "reduce", { 0: view(t.fields), ...params, 7: view(t.scratch) }, cw, ch);
        this.dispatch(encoder, "horizontal", { 1: view(t.scratch), ...params, 7: view(t.qualified) }, cw, ch);
        this.dispatch(encoder, "vertical", { 1: view(t.qualified), ...params, 7: view(t.coarse) }, cw, ch);
        this.dispatch(encoder, "guide", { 0: view(t.fields), 1: view(t.coarse), ...params, 7: view(t.guide) }, width, height);
        // Cached data counts only once the commands writing it are submitted.
        this.preparedKey = null; this.selectedKey = null; this.serial += 1;
      }
      if (selected) return { layers };
      this.selectedKey = null;
      for (let layer = 0; layer < layers; layer++) {
        const lanes = channels.slice(layer * 4, layer * 4 + 4);
        const values = new Float32Array(20);
        values.set(base); values[11] = layer;
        const packed = new Float32Array(4 * LANE_RANGES * 4);
        lanes.forEach((channel, lane) => {
          if (channel.ranges.length > LANE_RANGES) throw Error(`Selection is limited to ${LANE_RANGES} ranges`);
          values[12 + lane] = Number(channel.floor ?? .02); values[16 + lane] = channel.ranges.length;
          channel.ranges.forEach((r, j) => packed.set([r.center, r.width, r.feather, r.subtract ? 1 : 0], (lane * LANE_RANGES + j) * 4));
        });
        const params = { 5: { buffer: this.paramBuffer(values) } };
        this.dispatch(encoder, "qualification", { 1: view(t.coarse), ...params, 6: { buffer: this.paramBuffer(packed) }, 7: view(t.qualified) }, cw, ch);
        this.dispatch(encoder, "coefficients", { 1: view(t.qualified), 2: view(t.guide), ...params, 7: view(t.a), 8: view(t.b) }, width, height);
        this.dispatch(encoder, "refinement", { 2: view(t.guide), 3: view(t.a), 4: view(t.b), ...params,
          9: t.output.createView({ dimension: "2d-array" }) }, width, height);
      }
      return { layers, prepareKey: prepared ? undefined : prepareKey, selectKey };
    }
    /** Call after the encoder holding `token`'s commands has been submitted. */
    commit(token) {
      if (token?.prepareKey !== undefined) this.preparedKey = token.prepareKey;
      if (token?.selectKey !== undefined) this.selectedKey = token.selectKey;
    }
    /** Forget cached preparation; the next encode re-reads the fields. */
    invalidate() { this.preparedKey = null; this.selectedKey = null; }
    /** Destroy grown-out textures; call only once every encoder using them is submitted or dropped. */
    dropRetired() { for (const texture of this.retired) texture.destroy(); this.retired = []; }
    release() { for (const texture of Object.values(this.textures)) texture.destroy(); this.textures = {}; this.capacity = null; this.dropRetired(); this.invalidate(); }
    destroy() { this.release(); }
  }
  globalThis.HDRHslSelectionGpu = HslSelectionGpu;
  if (typeof module !== "undefined") module.exports = { HslSelectionGpu, geometry, shader };
})();
