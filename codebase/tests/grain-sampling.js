const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => state.gpuPreview?.available);
    const results = await page.evaluate(async () => {
      const device = state.gpuPreview.device;
      const module = device.createShaderModule({ code: HDRWebGPUShaders.SHADER_SOURCE + `
        @group(0) @binding(20) var<storage, read_write> samples: array<vec2f>;
        @compute @workgroup_size(64)
        fn testFootprint(@builtin(global_invocation_id) worker: vec3u) {
          let index = worker.x;
          let full = vec2f(f32(index % 32u) + 54.0, f32((index / 32u) % 32u) + 123.0);
          let pitches = array<f32, 5>(0.105, 0.399, 0.77, 1.479, 4.9);
          let pitch = pitches[index / 1024u];
          let signal = f32(index % 255u) / 254.0;
          let coarse = grainLayerNoise(full + 0.5, pitch, 0.25, signal, 123u, false);
          var fine = 0.0;
          for (var y = 0u; y < 4u; y++) {
            for (var x = 0u; x < 4u; x++) {
              let centre = full * 4.0 + vec2f(f32(x), f32(y)) + 0.5;
              fine += grainLayerNoise(centre, pitch * 4.0, 1.0, signal, 123u, false);
            }
          }
          samples[index] = vec2f(coarse, fine / 16.0);
        }
      ` });
      const failures = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (failures.length) throw new Error(failures.map(e => e.message).join('\n'));
      const pipeline = await device.createComputePipelineAsync({ layout: 'auto',
        compute: { module, entryPoint: 'testFootprint' } });
      const { count, indices } = HDRGpuParamLayout;
      const pixels = 5 * 1024;
      const bytes = pixels * 8;
      const params = new Float32Array(count);
      params[indices.GRAIN_SEED_LOW] = 46271;
      params[indices.GRAIN_SEED_HIGH] = 47167;
      const settings = device.createBuffer({ size: params.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const out = device.createBuffer({ size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      try {
        device.queue.writeBuffer(settings, 0, params);
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 1, resource: { buffer: settings } },
          { binding: 20, resource: { buffer: out } },
        ] });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(pixels / 64); pass.end();
        encoder.copyBufferToBuffer(out, 0, read, 0, bytes);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const values = new Float32Array(read.getMappedRange());
        return Array.from({ length: 5 }, (_, band) => {
          let max = 0, energy = 0;
          for (let i = band * 2048; i < (band + 1) * 2048; i += 2) {
            max = Math.max(max, Math.abs(values[i] - values[i + 1]));
            energy += values[i] ** 2;
          }
          return { band, max, rms: Math.sqrt(energy / 1024) };
        });
      } finally { read.destroy(); out.destroy(); settings.destroy(); }
    });
    for (const row of results) {
      assert.ok(row.rms > .10 && row.max < .001, JSON.stringify(row));
    }
    console.log('PASS: the GPU averages the same grain field at five pixel footprints', results);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
