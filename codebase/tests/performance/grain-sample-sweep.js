const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const output = path.resolve('output/performance/grain-samples');
const inputs = JSON.parse(fs.readFileSync(path.join(output, 'inputs.json')));
const report = fs.existsSync(path.join(output, 'measurements.json')) ? JSON.parse(fs.readFileSync(path.join(output, 'measurements.json'))) :
  { date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    conditions: 'Isolated production grain field, real-photo tone-mapped base; 256px central texture metrics; whole Fit frame / 1024px zoom viewport timing; no other grade passes.', groups: [] };
const sampleFunction = `
override benchmarkSamples: u32 = 16u;
fn filmGrainStops(rgb: vec3f, coordinate: vec2i, master: f32) -> vec3f {
  let scale = clamp(p[${require('../../frontend/gpu-param-layout.js').HDRGpuParamLayout.indices.SOURCE_PIXEL_SCALE}], 0.05, 1.0);
  if (scale >= 1.0) { return filmGrainSample(rgb, coordinate, master, vec2f(0.0), 1.0); }
  let referenceCount = min(4u, u32(ceil(1.0 / scale)));
  if (benchmarkSamples >= referenceCount * referenceCount) {
    var sum = vec3f(0.0);
    for (var row = 0u; row < referenceCount; row++) {
      for (var column = 0u; column < referenceCount; column++) {
        let offset = (vec2f(f32(column), f32(row)) + vec2f(0.5)) / f32(referenceCount) - vec2f(0.5 * scale);
        sum += filmGrainSample(rgb, coordinate, master, offset, scale);
      }
    }
    return sum / f32(referenceCount * referenceCount);
  }
  if (benchmarkSamples == 1u) { return filmGrainSample(rgb, coordinate, master, vec2f(0.0), scale); }
  let columns = select(select(2u, 3u, benchmarkSamples == 6u), 4u, benchmarkSamples >= 8u);
  let rows = benchmarkSamples / columns;
  var sum = vec3f(0.0);
  for (var row = 0u; row < rows; row++) {
    for (var column = 0u; column < columns; column++) {
      let offset = (vec2f(f32(column), f32(row)) + vec2f(0.5)) / vec2f(f32(columns), f32(rows)) - vec2f(0.5 * scale);
      sum += filmGrainSample(rgb, coordinate, master, offset, scale);
    }
  }
  return sum / f32(columns * rows);
}
`;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => state.gpuPreview?.available);
    await page.evaluate(async replacement => {
      const device = state.gpuPreview.device;
      const source = HDRWebGPUShaders.SHADER_SOURCE;
      const start = source.indexOf('    fn filmGrainStops(');
      const end = source.indexOf('    // Integer texel', start);
      const entry = `@fragment fn grainBenchmark(input: VertexOut) -> @location(0) vec4f {
        let coordinate = vec2i(input.position.xy);
        let rgb = textureLoad(sourceTexture, coordinate, 0).rgb;
        return vec4f(rgb * exp2(filmGrainStops(rgb, coordinate, 1.0)), 1.0);
      }`;
      const module = device.createShaderModule({ code: source.slice(0, start) + replacement + source.slice(end) + entry });
      const original = device.createShaderModule({ code: source + entry });
      window.__grainSweep = { pipelines: new Map(), reference: device.createRenderPipeline({ layout: 'auto',
        vertex: { module: original, entryPoint: 'vertexMain' }, fragment: { module: original, entryPoint: 'grainBenchmark', targets: [{ format: 'rgba16float' }] } }) };
      for (const samples of [1, 2, 4, 6, 8, 12, 16]) __grainSweep.pipelines.set(samples, device.createRenderPipeline({ layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: 'grainBenchmark', constants: { benchmarkSamples: samples }, targets: [{ format: 'rgba16float' }] } }));
    }, sampleFunction);
    for (const input of inputs) {
      if (report.groups.filter(group => group.file === input.file).length === 4) continue;
      await page.evaluate(input => {
        const device = state.gpuPreview.device;
        const source = device.createTexture({ size: [input.width, input.height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        const target = device.createTexture({ size: [input.width, input.height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        Object.assign(__grainSweep, { source, target, input });
      }, input);
      const descriptor = fs.openSync(path.join(output, input.file), 'r');
      try {
        for (let row = 0; row < input.height; row += 32) {
          const height = Math.min(32, input.height - row);
          const bytes = Buffer.alloc(input.width * height * 8);
          assert.equal(fs.readSync(descriptor, bytes, 0, bytes.length, row * input.width * 8), bytes.length);
          await page.evaluate(({ data, row, height }) => {
            const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
            state.gpuPreview.device.queue.writeTexture({ texture: __grainSweep.source, origin: [0, row] }, bytes,
              { bytesPerRow: __grainSweep.input.width * 8 }, [__grainSweep.input.width, height]);
          }, { data: bytes.toString('base64'), row, height });
        }
      } finally { fs.closeSync(descriptor); }
      for (const setting of [{ name: 'default', amount: 19.46, size: 19.60 }, { name: 'strong', amount: 80, size: 19.60 },
        { name: 'fine', amount: 80, size: 0 }, { name: 'coarse', amount: 80, size: 100 }]) {
        if (report.groups.some(group => group.file === input.file && group.setting === setting.name)) continue;
        const group = { ...input, setting: setting.name, amount: setting.amount, size: setting.size, captures: [] };
        for (const samples of [0, 1, 2, 4, 6, 8, 12, 16, -16]) {
          const result = await page.evaluate(async ({ input, setting, samples }) => {
            const device = state.gpuPreview.device;
            const indices = HDRGpuParamLayout.indices;
            const adjustments = structuredClone(state.adjustments);
            const film = adjustments[input.lane].film_look;
            Object.assign(film, { grain_enabled: true, grain_amount: samples === 0 ? 0 : setting.amount,
              grain_size: setting.size, grain_chroma: 40, grain_film_type: 'color_negative', grain_film_format: '35mm', look_strength: 100 });
            const params = buildParams(input.lane, adjustments, 'acescg', input.lane === 'hdr', 203, input.scale);
            params[indices.FRAME_WIDTH] = input.frame[0]; params[indices.FRAME_HEIGHT] = input.frame[1];
            params[indices.TILE_ORIGIN_X] = input.origin[0]; params[indices.TILE_ORIGIN_Y] = input.origin[1];
            const buffer = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(buffer, 0, params);
            const pipeline = samples === -16 ? __grainSweep.reference : __grainSweep.pipelines.get(samples || 1);
            const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
              { binding: 0, resource: __grainSweep.source.createView() }, { binding: 1, resource: { buffer } }] });
            const timestamp = device.features.has('timestamp-query');
            const query = timestamp ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
            const resolved = query ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
            const read = device.createBuffer({ size: 256 * 256 * 8 + 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
            const times = [];
            let pixels;
            for (let repeat = 0; repeat < 3; repeat++) {
              const encoder = device.createCommandEncoder();
              const pass = encoder.beginRenderPass({ colorAttachments: [{ view: __grainSweep.target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
                ...(query ? { timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}) });
              pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
              if (query) { encoder.resolveQuerySet(query, 0, 2, resolved, 0); encoder.copyBufferToBuffer(resolved, 0, read, 0, 16); }
              encoder.copyTextureToBuffer({ texture: __grainSweep.target, origin: [Math.floor((input.width - 256) / 2), Math.floor((input.height - 256) / 2)] },
                { buffer: read, offset: 256, bytesPerRow: 256 * 8 }, [256, 256]);
              const start = performance.now();
              device.queue.submit([encoder.finish()]);
              await read.mapAsync(GPUMapMode.READ);
              const mapped = read.getMappedRange();
              if (repeat > 0) times.push(query ? Number(new BigUint64Array(mapped, 0, 2)[1] - new BigUint64Array(mapped, 0, 2)[0]) / 1e6 : performance.now() - start);
              if (repeat === 2) {
                const bytes = new Uint8Array(mapped, 256);
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
                pixels = btoa(binary);
              }
              read.unmap();
            }
            read.destroy(); buffer.destroy(); query?.destroy(); resolved?.destroy();
            return { times, clock: query ? 'GPU timestamp' : 'queue+readback wall time', pixels };
          }, { input, setting, samples });
          const file = `${path.parse(input.photo).name}-${input.label}-${input.lane}-${setting.name}-${samples}.rgba16`;
          fs.writeFileSync(path.join(output, file), Buffer.from(result.pixels, 'base64'));
          if (samples === -16) {
            assert.deepEqual(fs.readFileSync(path.join(output, group.captures.at(-1).file)), Buffer.from(result.pixels, 'base64'), '16-sample benchmark differs from unmodified production grain');
            fs.unlinkSync(path.join(output, file));
          } else group.captures.push({ samples, timesMs: result.times, clock: result.clock, file });
        }
        report.groups.push(group);
        fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(report));
        console.log(`${input.photo} ${input.label} ${input.lane} ${setting.name}`);
      }
      await page.evaluate(() => { __grainSweep.source.destroy(); __grainSweep.target.destroy(); });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
