const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.waitForFunction(() => window.HDRWebGPUShaders);
    const result = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("This grain check needs a WebGPU adapter");
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: HDRWebGPUShaders.SHADER_SOURCE + `
        @group(0) @binding(20) var<storage, read_write> samples: array<u32>;
        @compute @workgroup_size(64)
        fn compareGrain(@builtin(global_invocation_id) worker: vec3u) {
          let index = worker.x;
          let point = vec2f(f32(index % 128u) / 128.0, f32(index / 128u) / 128.0)
            + vec2f(f32(index % 5u) * 1024.0 - 2048.0, f32(index % 7u) * 1024.0 - 3072.0);
          let layer = index % 4u;
          let signal = f32((index / 4u) % 32u) / 31.0;
          samples[index] = bitcast<u32>(grainLayerNoise(point, signal, layer * 17u + 1u,
            select(0.72, 0.86, layer == 3u), 0.12, select(0.72, 0.89, layer == 3u), 0.21));
        }
      ` });
      const { count, indices } = HDRGpuParamLayout;
      const params = new Float32Array(count);
      params[indices.GRAIN_SEED_LOW] = 46271;
      params[indices.GRAIN_SEED_HIGH] = 47167;
      const countSamples = 128 * 128;
      const bytes = countSamples * Uint32Array.BYTES_PER_ELEMENT;
      const settings = device.createBuffer({ size: params.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const samples = device.createBuffer({ size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      try {
        device.queue.writeBuffer(settings, 0, params);
        async function draw(pruneGrain) {
          const pipeline = await device.createComputePipelineAsync({ layout: "auto",
            compute: { module, entryPoint: "compareGrain", constants: { pruneGrain } } });
          const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 1, resource: { buffer: settings } },
            { binding: 20, resource: { buffer: samples } },
          ] });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.dispatchWorkgroups(countSamples / 64);
          pass.end();
          encoder.copyBufferToBuffer(samples, 0, readback, 0, bytes);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const output = new Uint32Array(readback.getMappedRange()).slice();
          readback.unmap();
          return output;
        }
        const unpruned = await draw(false);
        const pruned = await draw(true);
        return { countSamples, different: pruned.filter((sample, index) => sample !== unpruned[index]).length,
          distinct: new Set(unpruned).size };
      } finally {
        readback.destroy();
        samples.destroy();
        settings.destroy();
        device.destroy();
      }
    });
    assert.ok(result.distinct > 1000, "grain samples must not be constant");
    assert.equal(result.different, 0, "pruning must preserve every sample bit");
    console.log(`Pruned and unpruned WGSL matched at all ${result.countSamples} samples.`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
