const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

globalThis.GPUBufferUsage = {UNIFORM: 1, COPY_DST: 2, STORAGE: 4, COPY_SRC: 8, MAP_READ: 16};
require(path.join(__dirname, "../frontend/highlight-edge-colour.js"));

function fakeDevice() {
  const pass = {setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {}};
  return {
    createBuffer: () => ({destroy() {}}),
    createShaderModule: () => ({}),
    createComputePipelineAsync: async () => ({getBindGroupLayout: () => ({})}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({beginComputePass: () => pass, finish: () => ({})}),
    queue: {writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {}},
  };
}

for (const [name, magnitude, rejected] of [["non-finite input", 1, 1], ["near-maximum input", 1e38, 0]]) {
test(name + " goes straight to CPU before reconstruction", async () => {
  const allocated = new Set(), released = new Set();
  const width = 4, height = 4, largest = new Float32Array([magnitude]);
  let reads = 0;
  const read = async () => {
    reads++;
    return new Uint32Array([new Uint32Array(largest.buffer)[0], rejected, 0, 0]).buffer;
  };
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  await assert.rejects(
    globalThis.HDREdgeColour.reconstruct({
      device: fakeDevice(), planes: [{}, {}, {}], ratio: {}, width, height, expand: 0.5,
      toBT: identity, fromBT: identity, make: () => {const buffer = {}; allocated.add(buffer); return buffer;},
      release: buffer => released.add(buffer), read,
    }),
    error => error.gpuInvalidPixels === true && /invalid pixels/.test(error.message));
  assert.equal(reads, 1);
  assert.deepEqual(released, allocated);
});
}
