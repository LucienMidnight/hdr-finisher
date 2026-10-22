import { MAX_RANGES, validateRecipe } from './engine.mjs';

export const shader = /* wgsl */`
@group(0) @binding(0) var<storage, read> source: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(2) var<storage, read> params: array<vec4f>;
@group(0) @binding(3) var<storage, read> masks: array<f32>;
fn cbrt3(x: vec3f) -> vec3f { return sign(x) * pow(abs(x), vec3f(1.0/3.0)); }
fn lab(rgb: vec3f) -> vec3f {
  let v = cbrt3(vec3f(dot(rgb, vec3f(.4122214708,.5363325363,.0514459929)), dot(rgb, vec3f(.2119034982,.6806995451,.1073969566)), dot(rgb, vec3f(.0883024619,.2817188376,.6299787005))));
  return vec3f(dot(v, vec3f(.2104542553,.793617785,-.0040720468)), dot(v, vec3f(1.9779984951,-2.428592205,.4505937099)), dot(v, vec3f(.0259040371,.7827717662,-.808675766)));
}
fn rgb(v: vec3f) -> vec3f {
  let t = vec3f(dot(v, vec3f(1,.3963377774,.2158037573)), dot(v, vec3f(1,-.1055613458,-.0638541728)), dot(v, vec3f(1,-.0894841775,-1.291485548)));
  let q = t*t*t;
  return vec3f(dot(q, vec3f(4.0767416621,-3.3077115913,.2309699292)), dot(q, vec3f(-1.2684380046,2.6097574011,-.3413193965)), dot(q, vec3f(-.0041960863,-.7034186147,1.707614701)));
}
fn delta(h: f32, c: f32) -> f32 { let v = (h-c+180.0)/360.0; return fract(v)*360.0-180.0; }
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&source)) { return; }
  let original = source[i]; let p = params[0]; let extra = params[1];
  if (all(p == vec4f(0)) || extra.y == 0.0 || masks[i] <= 0.0) { output[i] = original; return; }
  let v = lab(original.rgb); let C = length(v.yz); let h = degrees(atan2(v.z, v.y));
  var inc = 0.0; var exc = 0.0; var centerVector = vec2f(0);
  for (var j = 0u; j < u32(extra.x); j++) {
    let r = params[j+2u]; let w = 1.0-smoothstep(r.y,r.y+r.z,abs(delta(h,r.x)));
    if (r.w > 0.0) { exc = max(exc,w); }
    else { inc = max(inc,w); centerVector += w*vec2f(cos(radians(r.x)),sin(radians(r.x))); }
  }
  let weight = inc*(1.0-exc)*smoothstep(.02,.06,C/max(abs(v.x),1e-6))*clamp(masks[i],0.0,1.0)*extra.y;
  if (weight == 0.0) { output[i] = original; return; }
  var center = h;
  if (length(centerVector) > 1e-5) { center = degrees(atan2(centerVector.y,centerVector.x)); }
  let hue = radians(h+delta(center,h)*p.w/100.0+p.x);
  let gain = exp2(p.z/3.0); let chroma = C*(1.0+p.y/100.0)*gain;
  let changed = rgb(vec3f(v.x*gain,chroma*cos(hue),chroma*sin(hue)));
  output[i] = vec4f(mix(original.rgb,changed,weight),original.a);
}`;

// Owns its prototype device; app integration must instead use the app's device/cache.
export async function createGPU() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  let lost = false;
  device.lost.then(() => { lost = true; });
  try {
    const module = device.createShaderModule({ code: shader });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw Error(errors.map(e => e.message).join('\n'));
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    return {
      destroy: () => device.destroy(),
      async process(pixels, recipe, mask = null) {
        validateRecipe(recipe);
        if (lost) throw Error('Prototype GPU device lost');
        const count = pixels.length/4;
        if (!count || !Number.isInteger(count) || mask && mask.length !== count) throw Error('Invalid pixel/mask dimensions');
        if (pixels.byteLength > device.limits.maxStorageBufferBindingSize || Math.ceil(count/128) > device.limits.maxComputeWorkgroupsPerDimension) throw Error('Image exceeds prototype GPU limits');
        const buffers = [];
        const buffer = (size, usage, data) => {
          const b = device.createBuffer({ size, usage }); buffers.push(b);
          if (data) device.queue.writeBuffer(b, 0, data);
          return b;
        };
        device.pushErrorScope('validation');
        let scopePopped = false;
        try {
          const src = buffer(pixels.byteLength, GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST, pixels);
          const dst = buffer(pixels.byteLength, GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
          const packed = new Float32Array((MAX_RANGES+2)*4);
          packed.set([recipe.hue,recipe.saturation,recipe.luminance,recipe.uniformity,recipe.ranges.length,recipe.opacity,0,0]);
          recipe.ranges.forEach((r,i) => packed.set([r.center,r.width,r.feather,Number(r.subtract)],(i+2)*4));
          const par = buffer(packed.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,packed);
          const m = mask || new Float32Array(count).fill(1);
          const mb = buffer(m.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,m);
          const read = buffer(pixels.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
          const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [src,dst,par,mb].map((b,binding) => ({binding,resource:{buffer:b}})) });
          const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
          pass.setPipeline(pipeline); pass.setBindGroup(0,group); pass.dispatchWorkgroups(Math.ceil(count/128)); pass.end();
          encoder.copyBufferToBuffer(dst,0,read,0,pixels.byteLength); device.queue.submit([encoder.finish()]);
          const error = await device.popErrorScope(); scopePopped = true;
          if (error) throw Error(error.message);
          await read.mapAsync(GPUMapMode.READ);
          const result = new Float32Array(read.getMappedRange().slice(0)); read.unmap();
          if (lost) throw Error('Prototype GPU device lost');
          return result;
        } finally {
          if (!scopePopped) await device.popErrorScope();
          buffers.forEach(b => b.destroy());
        }
      }
    };
  } catch (e) { device.destroy(); throw e; }
}
