const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { installGpuPassProbe } = require('./performance/gpu-pass-probe.cjs');

function fixture(failReadback = false) {
  const buffers = [], queries = [], descriptors = [], draws = [];
  class GPUQueue {
    submit(commands) { this.commands = commands; }
  }
  class GPUDevice {
    constructor() { this.features = new Set(['timestamp-query']); this.queue = new GPUQueue(); }
    createRenderPipeline(descriptor) { return { descriptor }; }
    createComputePipeline(descriptor) { return { descriptor }; }
    createQuerySet() {
      const query = { destroy() { this.destroyed = true; } }; queries.push(query); return query;
    }
    createBuffer() {
      const buffer = { data: new ArrayBuffer(4096),
        async mapAsync() { if (failReadback) throw Error('readback failed'); },
        getMappedRange() { return this.data; }, unmap() { this.unmapped = true; },
        destroy() { this.destroyed = true; } };
      buffers.push(buffer); return buffer;
    }
    createCommandEncoder() {
      const begin = descriptor => {
        descriptors.push(descriptor);
        return { setPipeline(pipeline) { this.pipeline = pipeline; }, draw(count) { draws.push(count); }, end() {} };
      };
      return { beginRenderPass: begin, beginComputePass: begin,
        resolveQuerySet(query, first, count, target) {
          new BigUint64Array(target.data).set(Array.from({ length: count }, (_, index) => BigInt(index + 1) * 1000000n));
        },
        copyBufferToBuffer(source, sourceOffset, target) { new Uint8Array(target.data).set(new Uint8Array(source.data)); },
        finish() { return {}; } };
    }
  }
  const context = { GPUDevice, GPUQueue, GPUBufferUsage: { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 },
    GPUMapMode: { READ: 1 }, performance, window: {}, BigUint64Array };
  vm.runInNewContext(`(${installGpuPassProbe.toString()})()`, context);
  return { device: new GPUDevice(), probe: context.window.__gpuPassProbe, buffers, queries, descriptors, draws };
}

test('GPU pass probe leaves disabled encoders untouched', () => {
  const { device, buffers } = fixture();
  const encoder = device.createCommandEncoder();
  device.queue.submit([encoder.finish()]);
  assert.equal(buffers.length, 0);
});

test('GPU pass probe preserves drawing and measures named passes', async () => {
  const { device, probe, buffers, queries, descriptors, draws } = fixture();
  const pipeline = device.createRenderPipeline({ fragment: { entryPoint: 'finishFragmentMain' } });
  probe.start();
  const encoder = device.createCommandEncoder();
  const attachments = [{ loadOp: 'load', storeOp: 'store' }];
  const pass = encoder.beginRenderPass({ colorAttachments: attachments });
  pass.setPipeline(pipeline); pass.draw(3); pass.end();
  device.queue.submit([encoder.finish()]);
  await probe.stop();
  assert.equal(descriptors[0].colorAttachments, attachments);
  assert.equal(descriptors[0].timestampWrites.beginningOfPassWriteIndex, 0);
  assert.equal(descriptors[0].timestampWrites.endOfPassWriteIndex, 1);
  assert.deepEqual(draws, [3]);
  assert.equal(probe.rows[0].passes[0].entryPoint, 'finishFragmentMain');
  assert.equal(probe.rows[0].passes[0].durationMs, 1);
  assert.ok(buffers.every(buffer => buffer.destroyed));
  assert.ok(queries.every(query => query.destroyed));
});

test('GPU pass probe reports failed readback and releases resources', async () => {
  const { device, probe, buffers, queries } = fixture(true);
  probe.start();
  const encoder = device.createCommandEncoder();
  encoder.beginComputePass().end();
  device.queue.submit([encoder.finish()]);
  await probe.stop();
  assert.equal(probe.errors.length, 1);
  assert.match(probe.errors[0], /readback failed/);
  assert.ok(buffers.every(buffer => buffer.destroyed));
  assert.ok(queries.every(query => query.destroyed));
});
