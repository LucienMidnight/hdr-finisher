const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(failAt = Infinity) {
  const resources = [], calls = [];
  const step = name => {
    calls.push(name);
    if (calls.length === failAt) throw Error(`Injected ${name}`);
  };
  const resource = properties => {
    const value = { ...properties, destroyed: 0,
      destroy() { this.destroyed++; },
      createView() { step('view'); return {}; },
    };
    resources.push(value);
    return value;
  };
  const pipeline = { getBindGroupLayout() { step('layout'); return {}; } };
  const pass = Object.fromEntries(['setPipeline', 'setBindGroup', 'dispatchWorkgroups',
    'setScissorRect', 'draw', 'end'].map(name => [name, () => step(name)]));
  const device = {
    limits: { maxBufferSize: 256 * 1024 * 1024 },
    queue: { writeBuffer() { step('write'); }, submit() { step('submit'); } },
    createTexture({ size }) { step('texture'); return resource({ width: size[0], height: size[1] }); },
    createBuffer({ size }) {
      step('buffer');
      return resource({ size, data: new ArrayBuffer(size),
        async mapAsync() { step('map'); },
        getMappedRange() { step('mapped range'); return this.data; },
        unmap() { step('unmap'); },
      });
    },
    createShaderModule() { step('module'); return { async getCompilationInfo() { step('compile'); return { messages: [] }; } }; },
    async createComputePipelineAsync() { step('compute pipeline'); return pipeline; },
    async createRenderPipelineAsync() { step('render pipeline'); return pipeline; },
    createBindGroup() { step('bind'); return {}; },
    createCommandEncoder() {
      step('encoder');
      return {
        beginComputePass() { step('compute pass'); return pass; },
        beginRenderPass() { step('render pass'); return pass; },
        copyTextureToBuffer({ origin = [0, 0] }, { buffer, bytesPerRow }, [width, count]) {
          step('copy');
          assert.equal(bytesPerRow % 256, 0);
          const data = new Float32Array(buffer.data);
          data.fill(-999); // Row padding must never reach the encoder.
          for (let y = 0; y < count; y++) for (let x = 0; x < width * 4; x++)
            data[y * bytesPerRow / 4 + x] = (origin[1] + y) * width * 4 + x;
        },
        finish() { step('finish'); return {}; },
      };
    },
  };
  const gpu = { device,
    async waitForSubmittedWork() { step('wait'); },
    createStorageBuffer(params) { return device.createBuffer({ size: params.byteLength }); },
    bindGraphResources() { step('graph bind'); return {}; },
  };
  const context = { window: { HDRGpuParamLayout: { indices: {} }, HDRWebGPUShaders: {} },
    GPUTextureUsage: {}, GPUBufferUsage: {}, GPUMapMode: { READ: 1 } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/gpu-delivery-finishing.js'), 'utf8'), context);
  const finishing = new context.window.HDRGpuDeliveryFinishing(gpu, async () => step('permit'));
  return { finishing, resources, calls };
}

const job = { params: [0], output: [3, 35], finishing: { sharpening: 'off' }, adjustments: { hdr: {} } };
const layout = { width: 5, height: 37, frame: 1, border: 0, colors: { hdr: [[0, 0, 0], [1, 1, 1]] } };
const paths = {
  async finish(f) { await f.initialize(); await f.finish(f.texture(3, 35), job, 'hdr'); },
  async finishResizedSharpenedFramed(f) {
    await f.initialize();
    await f.finish(f.texture(4, 38), { ...job, photo_output: [3, 35],
      finishing: { sharpening: 'standard' }, framing: layout }, 'hdr');
  },
  async compose(f) { await f.compose(f.texture(3, 35), layout, 'hdr'); },
  async finishRows(f) { await f.finishRows(f.texture(3, 35), job, 'hdr', async () => {}); },
  async read(f) { await f.read(f.texture(3, 135)); },
};

for (const [name, run] of Object.entries(paths)) {
  test(`${name}: job cleanup releases every allocation after failure at any setup or submission step`, async () => {
    const baseline = fixture();
    await run(baseline.finishing);
    baseline.finishing.destroy();
    for (let failAt = 1; failAt <= baseline.calls.length; failAt++) {
      const { finishing, resources } = fixture(failAt);
      await assert.rejects(run(finishing), /Injected/);
      finishing.destroy();
      finishing.destroy(); // The worker's catch and finally both call cleanup.
      assert.ok(resources.every(value => value.destroyed === 1), `${name}, step ${failAt}: leaked or double-destroyed allocation`);
    }
    assert.ok(baseline.resources.every(value => value.destroyed === 1));
  });
}

for (const streamed of [false, true]) {
  test(`readback preserves float samples across padded rows and a partial last strip (streamed=${streamed})`, async () => {
    const { finishing, resources } = fixture();
    const width = 3, height = 135, received = [];
    const send = async (row, count, pixels) => {
      assert.equal(pixels.length, width * count * 4);
      assert.equal(row * width * 4, received.length);
      received.push(...pixels);
    };
    const pixels = await finishing.read(finishing.texture(width, height), streamed ? send : undefined);
    const actual = streamed ? received : Array.from(pixels);
    assert.deepEqual(actual, Array.from({ length: width * height * 4 }, (_, i) => i));
    assert.ok(resources.every(value => value.destroyed === 1));
  });
}

test('encoder rejection releases the readback buffer and delivered texture', async () => {
  const { finishing, resources } = fixture();
  await assert.rejects(finishing.read(finishing.texture(3, 35), async () => { throw Error('encoder closed'); }), /encoder closed/);
  assert.ok(resources.every(value => value.destroyed === 1));
});

for(const sharpening of ['off','standard'])test(`framed admission charges photo scratch and the live canvas (${sharpening})`,()=>{
  const {finishing}=fixture(),F=finishing.constructor;
  const job={width:6000,height:4000,photo_output:[3000,2000],output:[7000,5000],
    framing:{},finishing:{sharpening},row_upload:true};
  const bytes=F.reservation(job),photo=3000*2000,canvas=7000*5000;
  assert.ok(bytes>=16*(photo+canvas),'composition textures');
  assert.ok(bytes>=photo*(sharpening==='off'?32:96),'photo finishing scratch');
  assert.ok(bytes>=16*(6000*4000+3000*4000+photo),'resize scratch');
  const old=Math.max(6000*4000*24,16*(6000*4000+7000*4000+canvas),
    canvas*(sharpening==='off'?32:96))+canvas*16+32*1024*1024;
  assert.ok(bytes<old,'canvas must not be processed as photo scratch');
});
