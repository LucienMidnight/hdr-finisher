const assert = require("node:assert/strict");
const test = require("node:test");
const { HslSelectionGpu } = require("../frontend/hsl-selection-gpu.js");
global.GPUBufferUsage = { STORAGE: 1 };

test("HSL parameter buffers survive encoding and are destroyed with retired submission resources", () => {
  const created = [];
  const engine = new HslSelectionGpu({ createBuffer({ size }) {
    const buffer = { destroyed: false, getMappedRange: () => new ArrayBuffer(size),
      unmap() {}, destroy() { this.destroyed = true; } };
    created.push(buffer);
    return buffer;
  } });
  const buffer = engine.paramBuffer(new Float32Array([1, 2, 3, 4]));
  assert.equal(buffer.destroyed, false, "unsubmitted bind groups still need this buffer");
  engine.dropRetired();
  assert.equal(buffer.destroyed, true);
  engine.paramBuffer(new Float32Array([5, 6, 7, 8]));
  engine.release();
  assert.ok(created.every(buffer => buffer.destroyed), "abandoned encoders must also release buffers");
});
