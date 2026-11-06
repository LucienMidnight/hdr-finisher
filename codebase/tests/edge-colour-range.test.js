// Edge colour's range check: corrupted input near the f32 maximum is rejected
// as invalid pixels (so Grade retries the GPU, then uses the CPU), not turned
// into a range check that cannot compile.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

globalThis.GPUBufferUsage = {UNIFORM: 1, COPY_DST: 2, STORAGE: 4, COPY_SRC: 8, MAP_READ: 16};
require(path.join(__dirname, "../frontend/highlight-edge-colour.js"));

function fakeDevice(shaders) {
  const pass = {setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {}};
  return {
    createBuffer: () => ({destroy() {}}),
    createShaderModule: ({code}) => { shaders.push(code); return {}; },
    createComputePipelineAsync: async () => ({getBindGroupLayout: () => ({})}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({beginComputePass: () => pass, finish: () => ({})}),
    queue: {writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {}},
  };
}

test("near-maximum corrupted input is rejected as invalid pixels", async () => {
  const shaders = [], released = [];
  const width = 4, height = 4, largest = new Float32Array([3e38]);
  const read = async (buffer, size) => size === 16
    ? new Uint32Array([new Uint32Array(largest.buffer)[0], 0, 0, 0]).buffer
    : new Float32Array(width * height).fill(1).buffer;   // every pixel clipped
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  await assert.rejects(
    globalThis.HDREdgeColour.reconstruct({
      device: fakeDevice(shaders), planes: [{}, {}, {}], ratio: {}, width, height, expand: 0.5,
      toBT: identity, fromBT: identity, make: () => ({}), release: b => released.push(b), read,
    }),
    error => error.gpuInvalidPixels === true && /invalid pixels/.test(error.message));
  assert.ok(shaders.every(code => !code.includes("Infinity")));
});
