const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { HDRWebGPUShaders } = require("../frontend/webgpu-shaders.js");

const EXPECTED_SHA256 = Object.freeze({
  PEAK_REDUCTION_SHADER_SOURCE: "2ee99c34c3f21654730ff6b19a64335c0cdb6e2c9f7500a354a1a67319fdf7eb",
  DENOISE_SHADER_SOURCE: "8107942837fab77bbf2feb6a3873063d3b6270d79c51cb6cf194b980e365480d",
  ADAPTIVE_DENOISE_SHADER_SOURCE: "541c32df5d7f20e936b21737460cc3302ef90d962e2b34b93334fefcf789afbc",
  SHADER_SOURCE: "60226d058e072d6f3713c68fee7a36a4aec589a8010a7c36421e818cb367ffc9",
  LUMA_MASK_SHADER_SOURCE: "a8002ec5b8e9cd17904dbea4748b0099ea87ee1390f300c86dc6236485305244",
});

test("extracted WGSL sources retain the audited byte identities", () => {
  for (const [name, expected] of Object.entries(EXPECTED_SHA256)) {
    const source = HDRWebGPUShaders[name];
    assert.equal(typeof source, "string", `${name} must be exported`);
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), expected, name);
  }
});

test("the renderer depends on the shader module without retaining shader bodies", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../frontend/webgpu-preview.js"), "utf8");
  const markup = fs.readFileSync(path.join(__dirname, "../frontend/index.html"), "utf8");

  assert.match(renderer, /HDRWebGPUShaders/);
  assert.doesNotMatch(renderer, /@(?:fragment|compute|vertex)\s+fn/);
  assert.ok(markup.indexOf("webgpu-shaders.js") < markup.indexOf("webgpu-preview.js"));
});
