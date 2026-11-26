const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { frontendSource } = require("./frontend-source.js");
const { HDRGraphScale } = require("../frontend/graph-scale.js");
const { HDRGpuParamLayout } = require("../frontend/gpu-param-layout.js");

const context = vm.createContext({ window: { HDRGraphScale }, HDRTone: require("../frontend/tone-engine.js") });
for (const script of ["webgpu-shaders.js", "hsl-engine.js", "gpu-render-plan.js", "gpu-params.js"]) {
  vm.runInContext(frontendSource(script), context);
}
const { buildLocalParams, buildTiledLocalState, activeGpuLocals } = vm.runInContext(
  "({ buildLocalParams, buildTiledLocalState, activeGpuLocals })", context,
);

function local(id, detail, { type = "brush", opacity = 1, maskOpacity = 1, enabled = true } = {}) {
  return { id, enabled, opacity, hdr_grade: { detail }, sdr_grade: { detail: {} },
    mask: { operator: "leaf", leaf: { type, mask_opacity: maskOpacity } } };
}

test("only shader-active Texture and Sharpen need the packed band pair", () => {
  const runs = HDRGraphScale.localDetailReadsPackedBands;
  const cases = [
    [{}, false],
    [{ clarity_amount: -45, clarity_radius_percent: 2.75, sharpen_radius_px: 3, sharpen_threshold: 90 }, false],
    [{ texture_amount: 20 }, true],
    [{ texture_amount: -20 }, true],
    [{ sharpen_amount: 20, sharpen_threshold: 100 }, true],
    [{ sharpen_amount: -20, clarity_amount: 45 }, false],
    [{ texture_amount: 0.0001, sharpen_amount: 0.0001, clarity_amount: 45 }, false],
    [{ texture_amount: -0.00010000001 }, true],
    [{ sharpen_amount: 0.00010000001 }, true],
    [{ texture_amount: -20, clarity_amount: -45, sharpen_amount: 20 }, true],
  ];
  for (const [detail, expected] of cases) {
    const layer = local("test", detail);
    assert.equal(runs(buildLocalParams(layer, "hdr")), expected, JSON.stringify(detail));
  }
});

test("band demand uses the uniforms of the lane being rendered", () => {
  const layer = local("linked", { texture_amount: -20 });
  const params = new Float32Array(HDRGpuParamLayout.count);
  assert.equal(HDRGraphScale.localDetailReadsPackedBands(buildLocalParams(layer, "sdr", 1, 0, params)), false);
  params[HDRGpuParamLayout.indices.LINKED_SDR] = 1;
  assert.equal(HDRGraphScale.localDetailReadsPackedBands(buildLocalParams(layer, "sdr", 1, 0, params)), true);
});

test("mixed local stack keeps order and live bands regardless of mask kind or softness", () => {
  const layers = [
    local("paint", { clarity_amount: 45 }, { opacity: 0.2 }),
    local("gradient", { texture_amount: -20 }, { type: "linear_gradient", opacity: 0.01 }),
    local("luma", { sharpen_amount: 20, clarity_amount: 45 }, { type: "luminance_range", maskOpacity: 0 }),
    local("hue", {}, { type: "hue_range" }),
    local("off", { texture_amount: 20 }, { enabled: false }),
    local("transparent", { sharpen_amount: 20 }, { opacity: 0 }),
  ];
  const params = new Float32Array(HDRGpuParamLayout.count);
  const enabled = activeGpuLocals("hdr", layers);
  const states = buildTiledLocalState("fixture", params, enabled, "hdr");
  assert.deepEqual(Array.from(enabled, layer => layer.id), ["paint", "gradient", "luma", "hue"]);
  assert.deepEqual(Array.from(enabled, layer => HDRGraphScale.localDetailActive(layer.hdr_grade)), [true, true, true, false]);
  assert.deepEqual(Array.from(states, layer => HDRGraphScale.localDetailReadsPackedBands(layer.params)), [false, true, true, false]);
  const reversed = buildTiledLocalState("fixture", params, [...enabled].reverse(), "hdr");
  assert.notEqual(states[1].detailPrefix, reversed[2].detailPrefix);
  assert.notEqual(states[2].detailPrefix, reversed[1].detailPrefix);
});
