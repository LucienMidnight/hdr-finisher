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


test("a partially allocated HSL working set is released when allocation throws", () => {
  global.GPUTextureUsage = { TEXTURE_BINDING: 1, STORAGE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8, RENDER_ATTACHMENT: 16 };
  const created = [];
  const failure = new Error("texture allocation failed");
  const engine = new HslSelectionGpu({ createTexture() {
    if (created.length === 3) throw failure;
    const texture = { destroyed: false, destroy() { this.destroyed = true; } };
    created.push(texture);
    return texture;
  } });
  assert.throws(() => engine.ensure(64, 64, 1, 4), error => error === failure);
  assert.equal(created.length, 3);
  assert.ok(created.every(texture => texture.destroyed));
  assert.equal(engine.capacity, null);
  assert.equal(Object.keys(engine.textures).length, 0);
});
