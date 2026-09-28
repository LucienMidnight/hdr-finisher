const assert = require("node:assert/strict");
const { test } = require("node:test");

const { HDRScopeAnalysis } = require("../frontend/scope-analysis.js");

function analysis(pixels, width = 2, height = 1, cellPeaks = null) {
  return {
    pixels: Float32Array.from(pixels),
    cellPeaks: cellPeaks ? Float32Array.from(cellPeaks) : null,
    width,
    height,
  };
}

test("SDR histogram payloads use explicit channel mode and preserve population", () => {
  const payload = HDRScopeAnalysis.buildGpuScopePayload(
    analysis([0.18, 0.18, 0.18, 1, 0.5, 0]),
    {
      lane: "sdr", mode: "histogram", tier: "settled", generation: 3,
      bins: 16, columns: 16, maxNits: 4000, channelMode: "luma", referenceWhite: 203,
    },
  );

  assert.equal(payload.scope_type, "normalized_histogram");
  assert.deepEqual(payload.channels.map(({ name }) => name), ["Y"]);
  assert.equal(payload.channels[0].bins.reduce((sum, value) => sum + value, 0), 2);
  assert.equal(payload.stats.find(({ label }) => label === "Median").value, "0.739");
});

test("a full-resolution HDR peak replaces a proxy overshoot", () => {
  const payload = HDRScopeAnalysis.buildGpuScopePayload(
    analysis([2, 2, 2], 1, 1, [3]),
    {
      lane: "hdr", mode: "histogram", tier: "settled", generation: 4,
      bins: 16, columns: 16, maxNits: 4000, channelMode: "rgb", referenceWhite: 203,
      exactPeak: { peak: 0.9, longEdge: 6000 },
    },
  );

  assert.equal(payload.peak_exact, true);
  assert.equal(payload.peak_value, 1015);
  assert.equal(payload.peak_measured_long_edge, 6000);
  assert.equal(payload.stats[0].label, "Peak");
});

test("normalized scope regions clamp to a non-empty analysis window", () => {
  assert.deepEqual(
    HDRScopeAnalysis.scopeAnalysisBounds({ width: 8, height: 4 }, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }),
    { x0: 2, y0: 1, x1: 6, y1: 3, width: 4, height: 2 },
  );
  assert.deepEqual(
    HDRScopeAnalysis.scopeAnalysisBounds({ width: 8, height: 4 }, { x: 1, y: 1, width: 0, height: 0 }),
    { x0: 7, y0: 3, x1: 8, y1: 4, width: 1, height: 1 },
  );
});

test("vectorscope payloads retain every sampled pixel in the density grid", () => {
  const payload = HDRScopeAnalysis.buildGpuScopePayload(
    analysis([1, 0, 0, 0, 1, 0]),
    {
      lane: "sdr", mode: "vectorscope", tier: "interactive", generation: 5,
      bins: 8, columns: 8, maxNits: 4000, channelMode: "rgb", referenceWhite: 203,
    },
  );

  assert.equal(payload.scope_type, "vectorscope");
  assert.equal(payload.channels[0].grid.flat().reduce((sum, value) => sum + value, 0), 2);
  assert.ok(payload.normalization_peak >= 1);
});
