const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const context = vm.createContext({
  AbortController,
  console,
  fetch: null,
  performance: { now: () => 1 },
  setTimeout,
  clearTimeout,
  window: {},
  GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
  GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 },
});
for (const file of ["mask-request-coordinator.js", "graph-scale.js", "mask-loader.js", "webgpu-shaders.js", "webgpu-preview.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend", file), "utf8"), context);
}
const Preview = context.window.HDRWebGPUPreview;

const request = (preview, generation, locals, isCurrent = () => true) => preview.loadDirectMasks({
  generation,
  sessionId: "session",
  activeLocals: locals,
  longEdge: 2048,
  editRevision: 4,
  geometrySignature: "{}",
  isCurrent,
});

test("Direct masks use the foreground coordinator and preserve local order", async () => {
  const preview = new Preview(null);
  let active = 0;
  let maxActive = 0;
  preview.loadLocalMask = async (_session, local, _edge, _revision, _geometry, _current, signal) => {
    assert.ok(signal instanceof AbortSignal);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 4));
    active -= 1;
    return `mask-${local.id}`;
  };
  const locals = Array.from({ length: 15 }, (_value, id) => ({ id }));

  const loaded = await request(preview, "generation-1", locals);

  assert.equal(loaded.current, true);
  assert.ok(maxActive <= 6, `observed ${maxActive} concurrent Direct mask requests`);
  assert.deepEqual(Array.from(loaded.results), locals.map((local) => `mask-${local.id}`));
});

test("a newer Direct generation aborts active work and never starts the old queue", async () => {
  const preview = new Preview(null);
  const oldStarted = [];
  preview.loadLocalMask = async (_session, local, _edge, _revision, _geometry, _current, signal) => {
    if (String(local.id).startsWith("new")) return local.id;
    oldStarted.push(local.id);
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    ), { once: true }));
  };
  const old = request(preview, "old", Array.from({ length: 20 }, (_value, id) => ({ id: `old-${id}` })));
  await Promise.resolve();

  const current = await request(preview, "new", [{ id: "new-0" }, { id: "new-1" }]);
  const obsolete = await old;

  assert.equal(obsolete.current, false);
  assert.equal(current.current, true);
  assert.deepEqual(Array.from(current.results), ["new-0", "new-1"]);
  assert.ok(oldStarted.length <= 6, `${oldStarted.length} obsolete requests started`);
});

test("identical Direct mask leaves reuse one in-flight fetch", async () => {
  const preview = new Preview(null);
  preview.device = {
    createTexture: () => ({ destroy() {} }),
    queue: { writeTexture() {} },
  };
  let fetches = 0;
  context.fetch = async () => {
    fetches += 1;
    await new Promise((resolve) => setTimeout(resolve, 3));
    return {
      ok: true,
      headers: { get: (name) => ({
        "X-Geometry-Signature": "{}",
        "X-Image-Width": "2",
        "X-Image-Height": "2",
      }[name] || null) },
      arrayBuffer: async () => new Uint8Array([0, 64, 128, 255]).buffer,
    };
  };
  const expression = { operator: "leaf", enabled: true, inverted: false,
    leaf: { type: "brush", mask_opacity: 1 } };
  const local = { id: "local-1", mask: expression };
  const signal = new AbortController().signal;

  const [first, second] = await Promise.all([
    preview.loadMaskLeaf("session", local, expression, "", 2048, 4, "{}", () => true, signal),
    preview.loadMaskLeaf("session", local, expression, "", 2048, 4, "{}", () => true, signal),
  ]);

  assert.equal(fetches, 1);
  assert.equal(first, second);
});
