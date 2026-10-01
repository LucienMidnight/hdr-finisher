const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { HDRWebGPUShaders } = require("../frontend/webgpu-shaders.js");

// Byte pins for the shaders the viewport work must leave alone: the peak
// measurement and Denoise. A change to one of them fails here.
const EXPECTED_SHA256 = Object.freeze({
  PEAK_REDUCTION_SHADER_SOURCE: "2ee99c34c3f21654730ff6b19a64335c0cdb6e2c9f7500a354a1a67319fdf7eb",
  DENOISE_SHADER_SOURCE: "8107942837fab77bbf2feb6a3873063d3b6270d79c51cb6cf194b980e365480d",
  ADAPTIVE_DENOISE_SHADER_SOURCE: "541c32df5d7f20e936b21737460cc3302ef90d962e2b34b93334fefcf789afbc",
});

// The picture and mask shaders change by design (Viewport-Bounded GPU Preview,
// owner decision October 1, 2026), so they carry no byte pin. What they draw is
// held by the preview-versus-export comparison's limits instead (PRD 4.6).
const UNPINNED = Object.freeze(["SHADER_SOURCE", "LUMA_MASK_SHADER_SOURCE"]);

test("the peak and Denoise WGSL sources retain the audited byte identities", () => {
  for (const [name, expected] of Object.entries(EXPECTED_SHA256)) {
    const source = HDRWebGPUShaders[name];
    assert.equal(typeof source, "string", `${name} must be exported`);
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), expected, name);
  }
});

test("the picture and mask WGSL sources are exported", () => {
  for (const name of UNPINNED) {
    assert.equal(typeof HDRWebGPUShaders[name], "string", `${name} must be exported`);
    assert.ok(HDRWebGPUShaders[name].length > 0, `${name} must not be empty`);
  }
});

test("every local pass and the mask probe read the mask through one function", () => {
  const source = HDRWebGPUShaders.SHADER_SOURCE;
  for (const entryPoint of ["localAdjustmentFragmentMain", "localDetailMixFragmentMain", "localMaskProbeFragmentMain"]) {
    const start = source.indexOf(`fn ${entryPoint}(`);
    assert.ok(start >= 0, `${entryPoint} must exist`);
    const body = source.slice(start, source.indexOf("\n    }", start));
    assert.match(body, /localMaskValue\(/, `${entryPoint} must call localMaskValue`);
    assert.doesNotMatch(body, /spatialTexture/, `${entryPoint} must not sample the mask itself`);
  }
});

test("the renderer depends on the shader module without retaining shader bodies", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../frontend/webgpu-preview.js"), "utf8");
  const markup = fs.readFileSync(path.join(__dirname, "../frontend/index.html"), "utf8");

  assert.match(renderer, /HDRWebGPUShaders/);
  assert.doesNotMatch(renderer, /@(?:fragment|compute|vertex)\s+fn/);
  assert.ok(markup.indexOf("webgpu-shaders.js") < markup.indexOf("webgpu-preview.js"));
});
