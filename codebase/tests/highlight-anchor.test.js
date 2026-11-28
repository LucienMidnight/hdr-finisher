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
const { frontendSource } = require("./frontend-source.js");

const dispatched = [];
const context = vm.createContext({
  window: { dispatchEvent(event) { dispatched.push(event); } },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  performance: { now: () => 1 },
  console,
  GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
  GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 },
  GPUMapMode: { READ: 1 },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/render-failure.js"), "utf8"), context);
vm.runInContext(frontendSource("graph-scale.js"), context);
vm.runInContext(frontendSource("webgpu-shaders.js"), context);
vm.runInContext(frontendSource("webgpu-preview.js"), context);
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
  // Bounded measurement keys follow the canonical selected source, even
  // when the display proxy supplied here is the original frame. Toggle that
  // selection as the app does when Denoise is switched on or off.
  preview.denoiseSourceSelector.selected = "original";
  const onOriginal = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params).key;
  preview.denoiseSourceSelector.selected = "resolved";
  const onResolved = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, resolved, params).key;
  assert.notEqual(onOriginal, onResolved);
  assert.equal(preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params).key, onResolved);
  preview.denoiseSourceSelector.resolvedVersion = 2;
  assert.notEqual(preview.highlightAnchorRequest("hdr", ADJUSTMENTS, resolved, params).key, onResolved);
});

test("display resolutions share one canonical highlight-anchor key", () => {
  const preview = new Preview(null);
  const smaller = { ...original, identity: "s:hdr:2356:{}:source", longEdge: 2356 };
  const larger = { ...original, identity: "s:hdr:2871:{}:source", longEdge: 2871 };
  assert.equal(
    preview.highlightAnchorRequest("hdr", ADJUSTMENTS, smaller, peakFitParams()).key,
    preview.highlightAnchorRequest("hdr", ADJUSTMENTS, larger, peakFitParams()).key,
  );
});

test("a Grain underlayer rebuild reuses the native highlight anchor for the same preparation", async () => {
  const preview = new Preview(null);
  const native = { ...original, sessionId: "s", geometrySignature: "{}", sourceIdentity: "source" };
  const soft = { ...native, identity: "s:hdr:1600:{}:source", longEdge: 1600 };
  const grain = { token: "fine-preparation" };
  const selector = preview.denoiseSourceSelector = {
    identity: native.identity, selected: "resolved", resolvedVersion: 1,
    controls: { method: "clean_grain", cleanSplotches: false, cleanFringes: false, colorSplotches: 1 },
    cache: { grain, preparedFrame: JSON.stringify(["s", "hdr", "{}", "source"]) },
  };
  const params = peakFitParams();
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, native, params);
  preview.peakReductionCache.set(anchor.key, 4.83);

  assert.ok(preview.retargetPreparedDenoise("s", "hdr", 1600, "{}", "source"));
  selector.resolvedVersion++;
  const underlayerAnchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, soft, params);
  assert.equal(underlayerAnchor.key, anchor.key);
  assert.equal(await preview.resolveHighlightAnchor(underlayerAnchor, soft, params), 4.83);

  assert.ok(preview.retargetPreparedDenoise("s", "hdr", 7968, "{}", "source"));
  assert.equal(preview.highlightAnchorRequest("hdr", ADJUSTMENTS, native, params).key, anchor.key);
  selector.controls.colorSplotches = 0.5;
  assert.notEqual(preview.highlightAnchorRequest("hdr", ADJUSTMENTS, native, params).key, anchor.key);
  selector.controls.colorSplotches = 1;
  grain.token = "new-preparation";
  assert.notEqual(preview.highlightAnchorRequest("hdr", ADJUSTMENTS, native, params).key, anchor.key);
});

test("a display proxy uses its estimate and requests one native reduction", async () => {
  dispatched.length = 0;
  const { preview, calls } = previewWithReductions([4.83]);
  const params = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params);
  assert.equal(await preview.resolveHighlightAnchor(anchor, original, params, { interactive: false, lane: "hdr" }), params[75]);
  assert.equal(await preview.resolveHighlightAnchor(anchor, original, params, { interactive: false, lane: "hdr" }), params[75]);
  assert.equal(calls.length, 0, "the zoom-sized proxy must never populate the canonical cache");
  assert.equal(dispatched.filter((event) => event.type === "hdrfinisher:highlight-anchor-needed").length, 1);
});

test("a published native anchor is reused at every display resolution", async () => {
  const preview = new Preview(null);
  const params = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params);
  preview.peakReductionCache.set(anchor.key, 4.83);
  const otherSize = { ...original, identity: "s:hdr:2871:{}:source", longEdge: 2871 };
  const otherAnchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, otherSize, params);
  assert.equal(otherAnchor.key, anchor.key);
  assert.equal(await preview.resolveHighlightAnchor(otherAnchor, otherSize, params, { lane: "hdr" }), 4.83);
});

test("native Maximum measurements retain at most 32 anchors and reset with the session", async () => {
  const preview = new Preview(null);
  const size = { width: 128, height: 128 };
  preview.rankEditingPeakCandidates = async (_session, lane, adjustments) => ({
    ...size, working_space: "acescg", patches: [{ x: 0, y: 0, ...size }],
    anchor: preview.highlightAnchorRequest(lane, adjustments, original, peakFitParams()),
  });
  preview.roiSourceHalo = () => 0;
  preview.renderTiledTo = async (_canvas, _session, _lane, adjustments) => ({
    rendered: true, metrics: { exactPeak: adjustments.hdr.exposure },
  });
  const keys = [];
  for (let exposure = 1; exposure <= 40; exposure++) {
    const adjustments = { hdr: { ...ADJUSTMENTS.hdr, exposure } };
    const measured = await preview.measureEditingPeak(null, "s", "hdr", adjustments, null, [], 0, 203, size,
      { highlightAnchorOnly: true });
    assert.equal(measured.highlightAnchor.value, exposure);
    keys.push(measured.highlightAnchor.key);
  }
  assert.deepEqual([...preview.peakReductionCache.keys()], keys.slice(-32));
  assert.equal(preview.peakReductionCache.get(keys.at(-1)), 40);
  preview.resetSession();
  assert.equal(preview.peakReductionCache.size, 0);
});

test("native Maximum reads each exact neutral-paper patch value in one mapping", async () => {
  const preview = new Preview(null);
  const size = { width: 512, height: 128 };
  const adjustments = { hdr: { ...ADJUSTMENTS.hdr, film_look: { film_stock: "none" } } };
  const values = [1.25, -0, 8.125, 2.5];
  const patches = values.map((_, index) => ({ x: index * 128, y: 0, width: 128, height: 128 }));
  const anchor = preview.highlightAnchorRequest("hdr", adjustments, original, peakFitParams());
  const maps = [];
  let destroyed = false;
  preview.device = { createBuffer({ size }) {
    const storage = new Float32Array(size / 4);
    return { storage, mapState: "unmapped",
      async mapAsync() { maps.push(Array.from(storage)); this.mapState = "mapped"; },
      getMappedRange() { return storage.buffer; },
      unmap() { this.mapState = "unmapped"; },
      destroy() { destroyed = true; },
    };
  } };
  preview.rankEditingPeakCandidates = async () => ({ ...size, working_space: "acescg", patches, anchor });
  preview.roiSourceHalo = () => 0;
  preview.renderTiledTo = async (...args) => {
    const { analysisPatch, peakReadback } = args[11];
    peakReadback.buffer.storage[peakReadback.offset / 4] = values[analysisPatch.x / 128];
    return { rendered: true, metrics: { exactPeak: null } };
  };
  const measured = await preview.measureEditingPeak(null, "s", "hdr", adjustments, null, [], 0, 203, size,
    { highlightAnchorOnly: true });
  assert.equal(measured.highlightAnchor.value, 8.125);
  assert.equal(measured.metrics.tileCount, 4);
  assert.deepEqual(maps, [values]);
  assert.equal(destroyed, true);

  destroyed = false;
  preview.renderTiledTo = async () => {
    preview.resetSession();
    return { rendered: true };
  };
  assert.equal(await preview.measureEditingPeak(null, "s", "hdr", adjustments, null, [], 0, 203, size,
    { highlightAnchorOnly: true }), null);
  assert.equal(maps.length, 1, "a superseded batch is never read or cached");
  assert.equal(preview.peakReductionCache.size, 0);
  assert.equal(destroyed, true);
});

test("native anchor reuse ignores only post-measurement shoulder controls", () => {
  const preview = new Preview(null);
  const params = peakFitParams();
  params[138] = 203; // project reference white
  const recipe = { hdr: { ...ADJUSTMENTS.hdr, highlight_compression_start_nits: 200,
    highlight_compression_peak_detail: 35, highlight_compression_target_nits: 600 } };
  const withControls = controls => ({ hdr: { ...recipe.hdr, ...controls } });
  const key = (adjustments, source = original, packed = params, locals = []) =>
    preview.nativeHighlightReuseKey(adjustments, source, packed, locals);
  const initial = key(recipe);
  const shoulderOnly = withControls({ highlight_compression_start_nits: 250, highlight_compression_peak_detail: 50 });
  assert.equal(key(shoulderOnly), initial);
  assert.notEqual(preview.highlightAnchorRequest("hdr", recipe, original, params).key,
    preview.highlightAnchorRequest("hdr", shoulderOnly, original, params).key);
  assert.notEqual(key(withControls({ highlight_compression_target_nits: 800 })), initial);
  assert.notEqual(key(withControls({ contrast: 20 })), initial);
  assert.notEqual(key(recipe, { ...original, sessionId: "second" }), initial);
  assert.notEqual(key(recipe, { ...original, sourceEpoch: 2 }), initial);
  const white = new Float32Array(params);
  white[138] = 100;
  assert.notEqual(key(recipe, original, white), initial);
  assert.notEqual(key(recipe, original, params, [{ id: "new-local" }]), initial);
  preview.resetSession();
  assert.notEqual(key(recipe), initial);
});

test("an implausible low-level reduction is still rechecked before publication", async () => {
  const { preview, calls } = previewWithReductions([36922.6, 4.5]);
  const params = peakFitParams(3.79);
  const value = await preview.measureToneAdjustedPeak(original, params, "maximum", "test", { reference: 3.79 });
  assert.equal(value, 4.5);
  assert.equal(calls.length, 2);
});

test("a drag frame carries the last real measurement through the change in exposure", async () => {
  const { preview } = previewWithReductions([]);
  const settled = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, settled);
  preview.peakReductionCache.set(anchor.key, 4.5);
  await preview.resolveHighlightAnchor(anchor, original, settled, { interactive: false, lane: "hdr" });
  // One stop brighter: the estimate doubles, so the carried anchor doubles.
  const dragged = peakFitParams(7.58);
  dragged[2] = 1.4;
  const dragAnchor = preview.highlightAnchorRequest("hdr", { hdr: { ...ADJUSTMENTS.hdr, exposure: 1.4 } }, original, dragged);
  const carried = await preview.resolveHighlightAnchor(dragAnchor, original, dragged, { interactive: true, lane: "hdr" });
  assert.ok(Math.abs(carried - 9.0) < 1e-6, `carried ${carried}`);
});

test("a drag frame with nothing measured yet uses the estimate", async () => {
  const { preview } = previewWithReductions([4.5]);
  const params = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, params);
  assert.equal(await preview.resolveHighlightAnchor(anchor, original, params, { interactive: true, lane: "hdr" }), params[75]);
});

test("measurement failures keep a bounded classified diagnostic", () => {
  const { preview } = previewWithReductions([]);
  preview.recordHighlightMeasurementFailure(new Error("device lost during mapAsync"), {
    lane: "hdr", key: "failed", used: 3.79,
  });
  const failures = preview.diagnosticsSnapshot().highlightMeasurementFailures;
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, "device-lost");
  assert.match(failures[0].detail, /device lost/);
  for (let index = 0; index < 45; index += 1) {
    preview.recordHighlightMeasurementFailure(new Error(`failure ${index}`), {
      lane: "hdr", key: `key-${index}`, used: 1,
    });
  }
  assert.equal(preview.diagnosticsSnapshot().highlightMeasurementFailures.length, 40);
  assert.equal(preview.diagnosticsSnapshot().highlightMeasurementFailures[0].key, "key-5");
});

test("a change to the authored source peak alone does not move a carried anchor", async () => {
  const { preview } = previewWithReductions([]);
  const settled = peakFitParams(3.79);
  const anchor = preview.highlightAnchorRequest("hdr", ADJUSTMENTS, original, settled);
  preview.peakReductionCache.set(anchor.key, 4.5);
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
