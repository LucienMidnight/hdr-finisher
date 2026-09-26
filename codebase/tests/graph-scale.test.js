// Phase 3 item 3: the processing-scale contract.
//
// Every spatial module in the preview graph is asked, at a scale that is not
// necessarily native, where its radius is and how far past its own rectangle it
// reads. `frontend/graph-scale.js` declares that contract and computes the tile
// halo from it; the renderer consumes it rather than carrying a second copy of
// the arithmetic. These tests pin the two things a seam would come from:
//
//  1. a radius whose authored unit is not converted (or is converted twice), and
//  2. a halo that is shorter than the radius it is supposed to cover.
//
// The shader expressions are re-derived independently here, not imported from
// the module, so a change to one side that the other does not follow fails.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const { HDRGraphScale: Scale } = require("../frontend/graph-scale.js");
const { HDRViewportRequest: Request } = require("../frontend/viewport-request.js");

function loadPreview() {
  const context = vm.createContext({
    window: {},
    performance: { now: () => 1 },
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/graph-scale.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/webgpu-preview.js"), "utf8"), context);
  return context.window.HDRWebGPUPreview;
}

const Preview = loadPreview();

const NATIVE = { width: 4096, height: 2304 };
const DISPLAY = { width: 1024, height: 576 };

// A parameter set with the film stage, Detail and the spatial pair switched on,
// filled with the defaults `buildParams` would produce for a 35 mm gate.
function activeParams(overrides = {}) {
  const params = new Float32Array(166);
  params[78] = 1;   // film stage enabled
  params[79] = 1;   // film look strength
  params[85] = 1;   // halation enabled
  params[86] = 0.5;
  params[88] = 0.2; // halation radius (film plane, percent)
  params[92] = 1;   // bloom enabled
  params[93] = 0.5;
  params[95] = 0.5; // bloom radius (frame diagonal, percent)
  params[97] = 1;   // image structure enabled
  params[98] = 0.4; // softness
  params[99] = 0.3; // microcontrast
  params[108] = 1;  // film resolution 100%
  params[140] = 36;
  params[141] = 24;
  params[142] = 0;
  params[148] = 1;  // Detail enabled
  params[149] = 0.6;
  params[150] = 0.5;
  params[151] = 0.75;
  params[152] = 0.4;
  params[153] = 0.8;
  params[155] = 1;
  for (const [index, value] of Object.entries(overrides)) params[Number(index)] = value;
  return params;
}

test("the declared contract names every module the sprint asks about", () => {
  const ids = Scale.MODULE_SCALE_CONTRACT.map((entry) => entry.id);
  for (const required of [
    "detail", "detail-local", "denoise", "grain", "bloom", "halation",
    "softness", "masks", "geometry",
  ]) {
    assert.ok(ids.includes(required), `missing scale contract for ${required}`);
  }
  assert.equal(new Set(ids).size, ids.length, "contract ids must be unique");
  assert.ok(Scale.CONTRACT_VERSION >= 1);
  for (const entry of Scale.MODULE_SCALE_CONTRACT) {
    for (const field of ["unit", "radius", "halo", "coarse", "cache", "cpuFallback"]) {
      assert.equal(typeof entry[field], "string", `${entry.id} is missing ${field}`);
      assert.ok(entry[field].length > 0, `${entry.id}.${field} must not be empty`);
    }
    assert.equal(Scale.moduleContract(entry.id), entry);
  }
  assert.equal(Scale.moduleContract("not-a-module"), null);
});

test("processing scale is the CPU reference's source_pixel_scale", () => {
  // min(1, processing_edge / source_long_edge), the convention `detail.py`,
  // `sessions.py` and `render_cache.py` all use.
  assert.equal(Scale.processingScaleFor(NATIVE, DISPLAY), 0.25);
  assert.equal(Scale.processingScaleFor(NATIVE, { width: 2048, height: 1152 }), 0.5);
  assert.equal(Scale.processingScaleFor(NATIVE, NATIVE), 1);
  // CSS magnification never buys more pixels than the source has.
  assert.equal(Scale.processingScaleFor(DISPLAY, NATIVE), 1);
  // A region proxy's texture carries a fraction of the frame, but its width and
  // height stay the frame's, so the scale is unchanged.
  assert.equal(Scale.processingScaleFor(NATIVE, { width: 4096, height: 2304, region: { x: 0, y: 0 } }), 0.25 * 4);
  // Missing source dimensions fall back to the frame, as the renderer's own
  // derivation did before it was moved here.
  assert.equal(Scale.processingScaleFor(null, DISPLAY), 1);
  // The renderer's static surface is the same function, not a copy.
  assert.equal(Preview.processingScaleFor(NATIVE, DISPLAY), Scale.processingScaleFor(NATIVE, DISPLAY));
});

test("a radius authored in source pixels converts by the processing scale", () => {
  const native = Scale.detailRadii(NATIVE.width, NATIVE.height, activeParams({ 153: 3 }), [], "hdr");
  const display = Scale.detailRadii(DISPLAY.width, DISPLAY.height, activeParams({ 153: 3, 155: 0.25 }), [], "hdr");
  // Sharpen: 3 source pixels is 3 processing pixels at native, 0.75 at 0.25.
  assert.equal(native.global[3], 3);
  assert.equal(display.global[3], 0.75);
  // Texture and clarity are frame-relative, so they follow the frame, not the
  // scale: the display frame is a quarter of the size and its radii are too.
  assert.equal(native.global[0] / display.global[0], 4);
  assert.equal(native.global[2] / display.global[2], 4);
  // The local Detail radius converts through the same scale.
  const local = { id: "l1", enabled: true, opacity: 1, hdr_grade: { detail: { sharpen_radius_px: 3 } } };
  const localNative = Scale.detailRadii(NATIVE.width, NATIVE.height, activeParams(), [local], "hdr");
  const localDisplay = Scale.detailRadii(DISPLAY.width, DISPLAY.height, activeParams({ 155: 0.25 }), [local], "hdr");
  assert.equal(localNative.locals[0][3], 3);
  assert.equal(localDisplay.locals[0][3], 0.75);
});

test("the Detail halo covers the shader's reach at maximum radii", () => {
  const width = 7680;
  const height = 4320;
  const params = activeParams({ 151: 3, 153: 3, 155: 1 });
  const local = {
    id: "l1",
    enabled: true,
    opacity: 1,
    hdr_grade: { detail: { clarity_amount: 40, clarity_radius_percent: 3, sharpen_radius_px: 3 } },
  };

  // The shader's own expressions, re-derived: `detailRadii()` and
  // `localDetailRadii()` from webgpu-preview.js.
  const diagonal = Math.hypot(width, height);
  const shaderRadii = [
    Math.max(0.35, diagonal * 0.0003),
    Math.max(0.70, diagonal * 0.0012),
    Math.max(0.30, 3 * 1),
  ];
  // Separable analysis reaches two radii; texture's edge guide reaches two
  // coarse radii into the packed band; two pixels cover the edge sample.
  const bandReach = Math.max(2 * shaderRadii[0], 4 * shaderRadii[1], 2 * shaderRadii[2]);
  // A local's Clarity map is built inside the tile: the B-spline spans two
  // coarse texels either side, each blurred texel reads `taps` texels either
  // side, and each texel averages a whole block.
  const map = Scale.clarityMapPlan(Math.max(0.50, diagonal * 3 / 100));
  const shaderReach = Math.ceil(Math.max(bandReach, (map.taps + 2.5) * map.scale) + 2);

  const halo = Scale.detailReach(width, height, params, [local], "hdr");
  assert.ok(halo >= shaderReach, `halo ${halo} is shorter than the shader's ${shaderReach}`);
  assert.equal(halo, Preview.detailTileHalo(width, height, params, [local], "hdr"));
  // Global Clarity reads a frame-level map, so however wide its radius it adds
  // nothing to the halo: only texture and sharpen remain.
  assert.equal(Scale.detailReach(width, height, params, [], "hdr"), Math.ceil(bandReach + 2));
  assert.equal(
    Scale.detailReach(width, height, activeParams({ 151: 0.2, 153: 3, 155: 1 }), [], "hdr"),
    Scale.detailReach(width, height, params, [], "hdr"),
  );
  // A local whose Clarity is off builds no map and needs no map reach.
  const clarityOff = { ...local, hdr_grade: { detail: { ...local.hdr_grade.detail, clarity_amount: 0 } } };
  assert.equal(Scale.detailReach(width, height, params, [clarityOff], "hdr"), Math.ceil(bandReach + 2));
  // The halo grows with the radius it covers rather than being a constant.
  const smallLocal = {
    id: "l1",
    enabled: true,
    opacity: 1,
    hdr_grade: { detail: { clarity_amount: 40, clarity_radius_percent: 0.2, sharpen_radius_px: 0.3 } },
  };
  const smaller = Scale.detailReach(
    width, height, activeParams({ 151: 0.2, 153: 0.3, 155: 0.25 }), [smallLocal], "hdr",
  );
  assert.ok(halo > smaller);
});

test("the Clarity map spends exactly the requested blur, on a level a few texels wide", () => {
  for (const sigma of [0.5, 2, 5.99, 6, 14.4, 54.1, 107.9, 216.3, 400]) {
    const plan = Scale.clarityMapPlan(sigma);
    assert.equal(plan.scale, 2 ** plan.level);
    if (plan.level === 0) {
      // Too narrow to shrink: the dense blur is the whole blur.
      assert.ok(sigma < 2 * Scale.CLARITY_MAP_MIN_TEXELS);
      assert.equal(plan.denseSigma, sigma);
      assert.equal(plan.reach, plan.taps);
    } else {
      // The blur is between the minimum and twice it at the chosen level ...
      const texels = sigma / plan.scale;
      assert.ok(texels >= Scale.CLARITY_MAP_MIN_TEXELS && texels < 2 * Scale.CLARITY_MAP_MIN_TEXELS, `${sigma}: ${texels}`);
      // ... and the box average and the B-spline's own spread plus the dense
      // blur's add up to it exactly, in variance.
      const inherent = (1 - 4 ** -plan.level) / 12 + 1 / 3;
      assert.ok(Math.abs(plan.denseSigma ** 2 + inherent - texels ** 2) < 1e-9);
      assert.equal(plan.reach, Math.ceil((plan.taps + 2.5) * plan.scale));
    }
    assert.equal(plan.taps, Math.ceil(Scale.CLARITY_MAP_TAP_REACH * plan.denseSigma));
  }
  // The level follows the radius; the map shrinks as the blur widens, so its
  // cost does not.
  assert.equal(Scale.clarityMapPlan(54.1).scale, 16);
  assert.equal(Scale.clarityMapPlan(216.3).scale, 64);
  // Sigma is a fraction of the frame diagonal, clamped to the slider's range.
  assert.equal(Scale.claritySigma(6000, 4000, 3), Math.hypot(6000, 4000) * 0.03);
  assert.equal(Scale.claritySigma(6000, 4000, 9), Math.hypot(6000, 4000) * 0.03);
  assert.equal(Scale.claritySigma(10, 10, 0.2), 0.5);
});

test("the Clarity frame map's reach is declared only while global Clarity runs", () => {
  const on = activeParams({ 150: 0.3, 151: 3 });
  const off = activeParams({ 150: 0, 151: 3 });
  const plan = Scale.clarityMapPlan(Scale.claritySigma(6000, 4000, 3));
  assert.equal(Scale.clarityMapReach(6000, 4000, on), plan.reach);
  assert.equal(Scale.clarityMapReach(6000, 4000, off), 0);
});

test("the film-plane halation reach follows the processing scale", () => {
  const radius = 0.2;
  const native = Scale.spatialReachDetail(NATIVE.width, NATIVE.height, activeParams({ 88: radius }));
  const display = Scale.spatialReachDetail(DISPLAY.width, DISPLAY.height, activeParams({ 88: radius }));
  // The physical radius is the same, so its pixel reach is proportional to the
  // frame's pixels-per-mm: a quarter-size frame reaches a quarter as far.
  assert.ok(Math.abs(native.blurTexels / display.blurTexels - 4) < 0.01,
    `expected a 4x reach ratio, got ${native.blurTexels} vs ${display.blurTexels}`);
  assert.ok(native.total > display.total);
  // A radius of zero switches the stage off in the parameter build, so the
  // halation contribution is zero.
  const off = Scale.spatialReachDetail(NATIVE.width, NATIVE.height, activeParams({ 85: 0, 92: 0 }));
  assert.equal(off.blurTexels, 0);
});

test("the spatial reach is anchored to the quarter-resolution grid and capped", () => {
  const maxed = activeParams({ 95: 100, 88: 100 });
  const detail = Scale.spatialReachDetail(NATIVE.width, NATIVE.height, maxed);
  // The shader caps `spatialBlur` at 64 quarter-resolution texels; the halo
  // reserves exactly that, converted back to full resolution.
  assert.equal(detail.blurTexels, 64);
  assert.equal(Scale.spatialReach(NATIVE.width, NATIVE.height, maxed) % Scale.SPATIAL_SCALE, 0);
  // The full-resolution reads are capped too: halation's edge source at 16,
  // the structure blur at 24, the film-resolution blur at 32.
  const structure = Scale.spatialReachDetail(NATIVE.width, NATIVE.height, activeParams({ 92: 0, 85: 0, 95: 0 }));
  assert.equal(structure.blurTexels, 0);
  assert.ok(structure.direct >= Math.round(Math.hypot(NATIVE.width, NATIVE.height) * 0.06 / 100));
  assert.equal(Scale.spatialReach(NATIVE.width, NATIVE.height, activeParams()), Scale.spatialReachDetail(NATIVE.width, NATIVE.height, activeParams()).total);
  // The bloom reach is monotone in its radius up to the cap.
  const small = Scale.spatialReachDetail(NATIVE.width, NATIVE.height, activeParams({ 95: 0.5 }));
  const larger = Scale.spatialReachDetail(NATIVE.width, NATIVE.height, activeParams({ 95: 2 }));
  assert.ok(small.blurTexels < larger.blurTexels && larger.blurTexels <= 64);
});

test("the composed reach composes Detail and the film stage, and rounds to the grid", () => {
  const params = activeParams();
  const local = { id: "l1", enabled: true, opacity: 1, hdr_grade: { detail: { sharpen_amount: 40 } } };
  const both = Scale.composedReach(NATIVE.width, NATIVE.height, params, [local], "hdr");
  assert.equal(both.halo, Math.ceil((both.detailHalo + both.spatialHalo) / 4) * 4);
  assert.ok(both.detailHalo > 0 && both.spatialHalo > 0);
  assert.equal(both.halo, Preview.prototype.composedTileHalo.call(null, NATIVE.width, NATIVE.height, params, [local], "hdr").halo);

  // Detail alone keeps its own reach: there is no grid to align to.
  const detailOnly = Scale.composedReach(NATIVE.width, NATIVE.height, activeParams({ 85: 0, 92: 0, 97: 0, 108: 0.5, 79: 0 }), [], "hdr");
  assert.equal(detailOnly.spatialHalo, 0);
  assert.equal(detailOnly.halo, detailOnly.detailHalo);

  // Nothing active reserves nothing.
  const idle = Scale.composedReach(NATIVE.width, NATIVE.height, activeParams({ 78: 0, 79: 0, 148: 0 }), [], "hdr");
  assert.deepEqual(idle, { halo: 0, detailHalo: 0, spatialHalo: 0 });
});

test("the denoise grid rounds a composed halo up, never down", () => {
  for (const levels of [1, 2, 3, 4]) {
    const step = 2 ** levels;
    for (const halo of [0, 1, 3, 16, 17, 31, 32, 33, 127]) {
      const aligned = Scale.alignReach(halo, step);
      assert.ok(aligned >= halo, `alignment shrank ${halo} at ${step}`);
      assert.equal(aligned % step, 0);
      assert.equal(Scale.alignReach(aligned, step), aligned, "alignment must be idempotent");
    }
  }
  assert.equal(Scale.alignReach(7, 1), 7);
  assert.equal(Scale.alignReach(0, 8), 0);
});

test("the local-detail switch is one rule for the chain, the metrics and the halo", () => {
  assert.equal(Scale.localDetailActive({ detail: { sharpen_amount: 1 } }), true);
  assert.equal(Scale.localDetailActive({ detail: { clarity_amount: -0.5 } }), true);
  assert.equal(Scale.localDetailActive({ detail: { texture_amount: 0.0000005 } }), false);
  assert.equal(Scale.localDetailActive({ detail: {} }), false);
  assert.equal(Scale.localDetailActive(undefined), false);
  // A local whose only active module is Detail still reserves a detail halo.
  const local = { id: "l1", enabled: true, opacity: 1, hdr_grade: { detail: { sharpen_amount: 40 } } };
  const composed = Scale.composedReach(
    NATIVE.width, NATIVE.height, activeParams({ 148: 0, 79: 0 }), [local], "hdr",
  );
  assert.ok(composed.detailHalo > 0);
  assert.equal(composed.spatialHalo, 0);
});

test("cache identities include the processing scale and upstream inputs", () => {
  const params = activeParams();
  const baseline = Preview.detailBandIdentity(params, "proxy:source-a:4096");
  // The scale slot is part of the identity: the same grade at another scale is
  // another band, because the radii it packs are different.
  const rescaled = activeParams({ 155: 0.25 });
  assert.notEqual(Preview.detailBandIdentity(rescaled, "proxy:source-a:4096"), baseline);
  // The upstream identity (which carries the proxy's long edge) is too.
  assert.notEqual(Preview.detailBandIdentity(params, "proxy:source-a:1024"), baseline);
  // Live amounts and the sharpen threshold consume bands, not create them.
  const dragging = activeParams({ 149: -0.9, 150: 0.9, 152: 1.5, 154: 0.4 });
  assert.equal(Preview.detailBandIdentity(dragging, "proxy:source-a:4096"), baseline);
  // Local bands are keyed by the preceding local's identity plus this local's
  // parameters, so an earlier local changing invalidates downstream bands.
  const localValues = activeParams();
  const localBefore = Preview.detailBandIdentity(localValues, "source|local-a:v1", "local");
  assert.notEqual(Preview.detailBandIdentity(localValues, "source|local-a:v2", "local"), localBefore);
});

test("the viewport request carries the declared processing scale", () => {
  const scale = Scale.processingScaleFor(NATIVE, DISPLAY);
  const request = Request.build({
    lane: "hdr",
    sessionId: "s1",
    geometrySignature: "{}",
    applicationGeneration: 1,
    editRevision: 0,
    output: DISPLAY,
    source: NATIVE,
    scale,
  });
  assert.equal(request.scale, 0.25);
  assert.ok(Object.isFrozen(request), "the request is immutable");
  assert.equal(Request.build({ output: DISPLAY, source: NATIVE }).scale, 1, "an omitted scale stays native");
});

test("the renderer's declared contract is the module's", () => {
  // The renderer runs in its own VM realm, so its arrays do not share the host
  // Array prototype. Compare contents, not realms.
  const idsOf = (contract) => Array.from(contract, (entry) => entry.id).join("|");
  assert.equal(idsOf(Preview.graphScaleContract()), idsOf(Scale.MODULE_SCALE_CONTRACT));
});
