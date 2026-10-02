// A leaf luma mask qualifies the scene's ACEScg source. A magnified pass may
// make it on the GPU from its own source region in either lane, but only when
// that region is the scene picture: Match and an authored SDR base replace the
// SDR lane's source, and their regions must keep the established fallback.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const read = (name) => fs.readFileSync(path.join(__dirname, "../frontend", name), "utf8");

function loadPreview() {
  const context = vm.createContext({
    window: {}, performance: { now: () => Date.now() }, console,
    fetch: async () => { throw new Error("unexpected request"); },
    AbortController, setInterval, clearInterval, setTimeout, clearTimeout,
    GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
    GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 },
    GPUMapMode: { READ: 1, WRITE: 2 },
  });
  for (const name of ["graph-scale.js", "gpu-allocator.js", "source-transport.js", "webgpu-shaders.js", "webgpu-preview.js"]) {
    vm.runInContext(read(name), context);
  }
  return context.window.HDRWebGPUPreview;
}

const luma = { operator: "leaf", enabled: true, inverted: false, leaf: { type: "luminance_range", mask_feather: 0.004,
  fade_in_start_ev: -6, full_start_ev: -3, full_end_ev: 2, fade_out_end_ev: 5 } };
const batch = { localIndex: 0, local: { id: "local-1", mask: luma }, tiles: [{ key: "0:0" }, { key: "0:1" }] };
const region = { x: 512, y: 1024, width: 2048, height: 1536 };

async function route(proxy) {
  const Preview = loadPreview();
  const preview = new Preview(null);
  const calls = { luma: [], soft: 0 };
  preview.loadGpuLumaMask = async (...args) => { calls.luma.push(args[8]); return { kind: "gpu-luma-region" }; };
  preview.softLeafMask = async () => { calls.soft += 1; return { kind: "soft" }; };
  const result = await preview.loadLocalMaskTiles("session", batch, 7968, 3, "{}", () => true, undefined, proxy);
  return { calls, kinds: [...result.entries.values()].map((entry) => entry.kind) };
}

test("an HDR source region makes its own luma mask", async () => {
  const proxy = { region, lane: "hdr", sourceIdentity: "source", workingSpace: "acescg" };
  const { calls, kinds } = await route(proxy);
  assert.deepEqual(calls.luma, [proxy]);
  assert.deepEqual(kinds, ["gpu-luma-region", "gpu-luma-region"]);
});

test("an SDR region of the scene source makes the same mask without a CPU request", async () => {
  const proxy = { region, lane: "sdr", sourceIdentity: "source", workingSpace: "acescg" };
  const { calls, kinds } = await route(proxy);
  assert.deepEqual(calls.luma, [proxy]);
  assert.equal(calls.soft, 0);
  assert.deepEqual(kinds, ["gpu-luma-region", "gpu-luma-region"]);
});

test("a matched or authored SDR region is not scene luminance and keeps the fallback", async () => {
  for (const proxy of [
    { region, lane: "sdr", sourceIdentity: "source", workingSpace: "linear-srgb" },
    { region, lane: "sdr", sourceIdentity: "hdr-to-sdr-match-v1:signature", workingSpace: "linear-srgb" },
    { region, lane: "sdr", sourceIdentity: "hdr-to-sdr-match-v1:signature", workingSpace: "acescg" },
  ]) {
    const { calls, kinds } = await route(proxy);
    assert.deepEqual(calls.luma, [], JSON.stringify(proxy));
    assert.equal(calls.soft, 1);
    assert.deepEqual(kinds, ["soft", "soft"]);
  }
});
