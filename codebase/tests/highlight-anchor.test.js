// The highlight-compression shoulder anchor (the measured brightest highlight
// that the Peak fit shoulder is shaped around).
//
// Preview Responsiveness Tuning Sprint, owner report 2026-09-25: after P2 made
// native zoom Direct, one bad full-size measurement (36,922 against ~4 at every
// other size) was cached and reused, and the shoulder squeezed the picture into
// SDR range. The delivery ceiling itself never depends on this anchor (the
// shader clips per channel at the target after the shoulder), so these tests
// are about picture stability, not about the ceiling:
//   - a measurement names the exact source it was taken on (original versus a
//     specific denoise reconstruction),
//   - a wildly implausible measurement is taken again rather than trusted,
//   - a drag frame carries the last real measurement instead of jumping to the
//     rough estimate, and the skipped measurement is run afterwards.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const context = vm.createContext({
  window: { dispatchEvent() {} },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  performance: { now: () => 1 },
  console,
  GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
  GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/graph-scale.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/webgpu-preview.js"), "utf8"), context);
const Preview = context.window.HDRWebGPUPreview;

const ADJUSTMENTS = { hdr: { highlight_compression_peak_measurement: "maximum", exposure: 0.4 } };

function peakFitParams(estimate = 3.79) {
  const params = new Float32Array(200);
  params[74] = 1; // Peak fit
  params[75] = estimate; // the rough estimate buildParams writes
  params[2] = 0.4;
  return params;
}

function previewWithReductions(results) {
  const preview = new Preview(null);
  const calls = [];
  preview.ensurePeakReductionPipeline = async () => ({});
  preview.runPeakReduction = async (pipeline, texture, width, height, params, measurement, cacheKey) => {
    const value = results[Math.min(calls.length, results.length - 1)];
    calls.push({ texture, cacheKey });
    preview.peakReductionCache.set(cacheKey, value);
    return value;
  };
  return { preview, calls };
}

const original = { identity: "s:hdr:7968:{}:source", texture: { id: "original" }, width: 5320, height: 7968 };

test("a measurement on the denoised source is not reused for the original, or for another reconstruction", () => {
  const preview = new Preview(null);
  const resolved = { ...original, texture: { id: "resolved" } };
  preview.denoiseSourceSelector = { identity: original.identity, original, resolved, selected: "resolved", resolvedVersion: 1 };
  const params = peakFitParams();
  const onOriginal = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params).key;
  const onResolved = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, resolved, params).key;
  assert.notEqual(onOriginal, onResolved);
  preview.denoiseSourceSelector.resolvedVersion = 2;
  assert.notEqual(preview.highlightAnchorRequest("hdr", ADJUSTMENTS, resolved, params).key, onResolved);
});

test("an implausible measurement is taken again, and the second result is used as measured", async () => {
  const { preview, calls } = previewWithReductions([36922.6, 4.5]);
  const params = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params);
  const value = await preview.resolveHighlightAnchor(anchor, original, params, { interactive: false, lane: "hdr" });
  assert.equal(value, 4.5);
  assert.equal(calls.length, 2);
  assert.equal(preview.peakReductionCache.get(anchor.key), 4.5);
});

test("a plausible measurement is used once and never second-guessed", async () => {
  const { preview, calls } = previewWithReductions([4.83, 99]);
  const params = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params);
  assert.equal(await preview.resolveHighlightAnchor(anchor, original, params, { interactive: false, lane: "hdr" }), 4.83);
  assert.equal(calls.length, 1);
});

test("a repeated implausible result stands: nothing is invented or clamped", async () => {
  const { preview } = previewWithReductions([500, 500]);
  const params = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params);
  assert.equal(await preview.resolveHighlightAnchor(anchor, original, params, { interactive: false, lane: "hdr" }), 500);
});

test("a drag frame carries the last real measurement through the change in exposure", async () => {
  const { preview, calls } = previewWithReductions([4.5, 6.0]);
  const settled = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, settled);
  await preview.resolveHighlightAnchor(anchor, original, settled, { interactive: false, lane: "hdr" });
  // One stop brighter: the estimate doubles, so the carried anchor doubles.
  const dragged = peakFitParams(7.58);
  dragged[2] = 1.4;
  const dragAnchor = preview.highlightAnchorRequest("hdr", { hdr: { ...ADJUSTMENTS.hdr, exposure: 1.4 } }, original, dragged);
  const carried = await preview.resolveHighlightAnchor(dragAnchor, original, dragged, { interactive: true, lane: "hdr" });
  assert.ok(Math.abs(carried - 9.0) < 1e-6, `carried ${carried}`);
  // The measurement the drag frame skipped runs afterwards.
  await preview.pendingHighlightMeasurement;
  assert.equal(calls.length, 2);
  assert.equal(preview.peakReductionCache.get(dragAnchor.key), 6.0);
});

test("a drag frame with nothing measured yet uses the estimate", async () => {
  const { preview } = previewWithReductions([4.5]);
  const params = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params);
  assert.equal(await preview.resolveHighlightAnchor(anchor, original, params, { interactive: true, lane: "hdr" }), params[75]);
});

test("a change to the authored source peak alone does not move a carried anchor", async () => {
  const { preview } = previewWithReductions([4.5, 4.5]);
  const settled = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, settled);
  await preview.resolveHighlightAnchor(anchor, original, settled, { interactive: false, lane: "hdr" });
  // Same tone settings, but the estimate (from the authored peak) moved 25%.
  const drifted = peakFitParams(3.79 * 1.25);
  drifted[10] = 6000; // a white-balance change: part of the cache key, not of the tone stages
  const dragAnchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, drifted);
  const carried = await preview.resolveHighlightAnchor(dragAnchor, original, drifted, { interactive: true, lane: "hdr" });
  assert.ok(Math.abs(carried - 4.5) < 1e-6, `carried ${carried}`);
});

// Owner report 2026-09-25 (black preview): the image cache replaced the
// native source copy and freed the old texture, but the denoise selector still
// held the old copy as its "original". With Denoise off every frame sampled the
// freed texture, the submit was rejected, and the canvas showed black while the
// app reported Ready.
test("the denoise selector follows the live source copy, never a freed one", () => {
  const preview = new Preview(null);
  const identity = "s:hdr:7968:{}:source";
  const stale = { identity, texture: { id: "freed" }, width: 5320, height: 7968 };
  const live = { identity, texture: { id: "live" }, width: 5320, height: 7968 };
  const resolved = { identity, texture: { id: "resolved" }, width: 5320, height: 7968 };
  preview.denoiseSourceSelector = { identity, original: stale, resolved, selected: "original" };
  assert.equal(preview.selectedDenoiseSource(live), live);
  assert.equal(preview.denoiseSourceSelector.original, live, "the selector must adopt the live copy");
  preview.denoiseSourceSelector.selected = "resolved";
  assert.equal(preview.selectedDenoiseSource(live), resolved);
});
