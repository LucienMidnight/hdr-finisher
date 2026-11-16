const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => state.gpuPreview?.available);
    const results = await page.evaluate(async () => {
      const device = state.gpuPreview.device;
      const indices = HDRGpuParamLayout.indices;
      const original = `override legacyDraft: bool = false;
        fn filmGrainStops(rgb: vec3f, coordinate: vec2i, master: f32) -> vec3f {
          let scale = clamp(p[${indices.SOURCE_PIXEL_SCALE}], 0.05, 1.0);
          if (legacyDraft) { return filmGrainSample(rgb, coordinate, master, vec2f(0.0), scale); }
          if (scale >= 1.0) { return filmGrainSample(rgb, coordinate, master, vec2f(0.0), 1.0); }
          let count = min(4u, u32(ceil(1.0 / scale)));
          var sum = vec3f(0.0);
          for (var y = 0u; y < count; y++) {
            for (var x = 0u; x < count; x++) {
              let offset = (vec2f(f32(x), f32(y)) + vec2f(0.5)) / f32(count) - vec2f(0.5 * scale);
              sum += filmGrainSample(rgb, coordinate, master, offset, scale);
            }
          }
          return sum / f32(count * count);
        }
      `;
      const entry = `@fragment fn samplingTest(input: VertexOut) -> @location(0) vec4f {
        return vec4f(vec3f(.18, .3, .05) * exp2(filmGrainStops(vec3f(.18, .3, .05), vec2i(input.position.xy), 1.0)), 1.0);
      }`;
      const source = HDRWebGPUShaders.SHADER_SOURCE;
      const start = source.indexOf('    fn filmGrainStops(');
      const end = source.indexOf('    // Integer texel', start);
      const modules = [device.createShaderModule({ code: source + entry }),
        device.createShaderModule({ code: source.slice(0, start) + original + source.slice(end) + entry })];
      const pipeline = (module, constants) => device.createRenderPipeline({ layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: 'samplingTest', constants, targets: [{ format: 'rgba16float' }] } });
      const pipelines = [pipeline(modules[0], {}), pipeline(modules[1], {}),
        pipeline(modules[0], { grainSampleLimit: HDRWebGPUShaders.GRAIN_SAMPLE_COUNTS.draft }), pipeline(modules[1], { legacyDraft: true })];
      const target = device.createTexture({ size: [64, 64], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const input = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
      const buffer = device.createBuffer({ size: HDRGpuParamLayout.count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const read = device.createBuffer({ size: 64 * 64 * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const results = [];
      try {
        for (const lane of ['sdr', 'hdr']) for (const type of ['color_negative', 'black_and_white'])
          for (const scale of [.1285, .5, 1]) for (const size of [0, 19.6, 100]) {
            const adjustments = structuredClone(state.adjustments);
            Object.assign(adjustments[lane].film_look, { grain_enabled: true, grain_amount: 80, grain_size: size,
              grain_chroma: 40, grain_film_type: type, grain_film_format: '35mm' });
            const params = buildParams(lane, adjustments, 'acescg', lane === 'hdr', 203, scale);
            params[indices.FRAME_WIDTH] = 1024; params[indices.FRAME_HEIGHT] = 683;
            params[indices.TILE_ORIGIN_X] = 317; params[indices.TILE_ORIGIN_Y] = 249;
            device.queue.writeBuffer(buffer, 0, params);
            const captures = [];
            for (const pipeline of pipelines) {
              const encoder = device.createCommandEncoder();
              const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
              pass.setPipeline(pipeline);
              pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: input.createView() }, { binding: 1, resource: { buffer } }] }));
              pass.draw(3); pass.end();
              encoder.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: 512 }, [64, 64]);
              device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
              captures.push(new Uint8Array(read.getMappedRange()).slice()); read.unmap();
            }
            const equal = (left, right) => captures[left].every((byte, index) => byte === captures[right][index]);
            results.push({ lane, type, scale, size, settledExact: equal(0, 1), draftExact: equal(2, 3), differs: !equal(0, 2) });
          }
      } finally { target.destroy(); input.destroy(); buffer.destroy(); read.destroy(); }
      return results;
    });
    assert.equal(results.length, 36);
    for (const row of results) {
      assert.ok(row.settledExact, `settled pixels changed: ${JSON.stringify(row)}`);
      assert.ok(row.draftExact, `one-sample draft changed: ${JSON.stringify(row)}`);
      assert.equal(row.differs, row.scale < 1, `sampling route not exercised: ${JSON.stringify(row)}`);
    }
    const output = path.resolve('output/performance/grain-samples/shader-regression.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(results, null, 2));
    console.log(`PASS: ${results.length} settled/export grain fields and existing drafts are byte-identical; native bypass is exact.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
