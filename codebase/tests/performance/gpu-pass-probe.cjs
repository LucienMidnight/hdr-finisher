function installGpuPassProbe() {
  const pipelines = new WeakMap();
  const commands = new WeakMap();
  const pending = new Set();
  const rows = [];
  const errors = [];
  let enabled = false;
  const devicePrototype = GPUDevice.prototype;
  for (const method of ['createRenderPipeline', 'createComputePipeline']) {
    const original = devicePrototype[method];
    devicePrototype[method] = function (descriptor) {
      const pipeline = original.call(this, descriptor);
      pipelines.set(pipeline, descriptor.fragment?.entryPoint || descriptor.compute?.entryPoint || descriptor.label || method);
      return pipeline;
    };
  }
  for (const method of ['createRenderPipelineAsync', 'createComputePipelineAsync']) {
    const original = devicePrototype[method];
    if (!original) continue;
    devicePrototype[method] = async function (descriptor) {
      const pipeline = await original.call(this, descriptor);
      pipelines.set(pipeline, descriptor.fragment?.entryPoint || descriptor.compute?.entryPoint || descriptor.label || method);
      return pipeline;
    };
  }
  const createEncoder = devicePrototype.createCommandEncoder;
  devicePrototype.createCommandEncoder = function (...args) {
    const encoder = createEncoder.apply(this, args);
    if (!enabled || !this.features.has('timestamp-query')) return encoder;
    const device = this;
    const querySet = device.createQuerySet({ type: 'timestamp', count: 512 });
    const resolve = device.createBuffer({ size: 4096, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size: 4096, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const passes = [];
    const record = { encodedAt: performance.now(), passes, querySet, resolve, read };
    for (const method of ['beginRenderPass', 'beginComputePass']) {
      const original = encoder[method].bind(encoder);
      encoder[method] = function (descriptor = {}) {
        if (passes.length >= 256) throw Error('GPU pass probe capacity exceeded');
        const index = passes.length * 2;
        const pass = original({ ...descriptor, timestampWrites: {
          querySet, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1,
        } });
        const row = { kind: method, entryPoint: 'unknown' };
        passes.push(row);
        const setPipeline = pass.setPipeline.bind(pass);
        pass.setPipeline = pipeline => { row.entryPoint = pipelines.get(pipeline) || 'unlabelled'; return setPipeline(pipeline); };
        return pass;
      };
    }
    const finish = encoder.finish.bind(encoder);
    encoder.finish = function (...finishArgs) {
      if (passes.length) {
        encoder.resolveQuerySet(querySet, 0, passes.length * 2, resolve, 0);
        encoder.copyBufferToBuffer(resolve, 0, read, 0, passes.length * 16);
      }
      const command = finish(...finishArgs);
      commands.set(command, record);
      return command;
    };
    return encoder;
  };
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (buffers) {
    const list = Array.from(buffers);
    const submittedAt = performance.now();
    const result = submit.call(this, list);
    for (const buffer of list) {
      const record = commands.get(buffer);
      if (!record) continue;
      const observation = (async () => {
        try {
          if (record.passes.length) {
            await record.read.mapAsync(GPUMapMode.READ);
            const timestamps = new BigUint64Array(record.read.getMappedRange());
            rows.push({ encodedAt: record.encodedAt, submittedAt, readbackReadyAt: performance.now(),
              passes: record.passes.map((pass, index) => ({ ...pass,
                startMs: Number(timestamps[index * 2]) / 1e6,
                durationMs: Number(timestamps[index * 2 + 1] - timestamps[index * 2]) / 1e6 })) });
            record.read.unmap();
          }
        } finally { record.read.destroy(); record.resolve.destroy(); record.querySet.destroy(); }
      })().catch(error => errors.push(String(error)));
      pending.add(observation);
      observation.finally(() => pending.delete(observation));
    }
    return result;
  };
  window.__gpuPassProbe = { rows, errors, start: () => { enabled = true; }, stop: async () => { enabled = false; await Promise.all(pending); } };
}

module.exports = { installGpuPassProbe };
