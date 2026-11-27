const assert = require("node:assert/strict");
const { test } = require("node:test");

const { HDRScopeUI } = require("../frontend/scope-ui.js");
const { HDRScopeAnalysis } = require("../frontend/scope-analysis.js");
const { createHash } = require("node:crypto");

test("scope transport conversion retains the exact pre-cleanup double-precision results", () => {
  const pixels = [[1, 1, 1], [2, 1, 1], [1, 2, 1], [1, 1, 2], [0.18, 0.02, 1.3], [-1, 0.2, 3], [0, 0, 0]];
  const converted = pixels.map(pixel => HDRScopeAnalysis.hdrWaveformRec2020(...pixel));
  assert.equal(createHash("sha256").update(JSON.stringify(converted)).digest("hex"),
    "9d6e231c14a6e75fc69f8248b86aa8df8671875fbf2ef5ae0bbfd64abf93fea0");
  for (const [index, pixel] of pixels.entries()) {
    const destination = new Float64Array(4);
    assert.equal(HDRScopeAnalysis.hdrWaveformRec2020(...pixel, destination), destination);
    assert.deepEqual(Array.from(destination.subarray(0, 3)), converted[index]);
  }
});

test("histogram and waveform numeric payloads retain the pre-allocation-cleanup results exactly", () => {
  // Baseline taken before the readout change, excluding removed rows.
  const expected = [
    "b2e78a50b8cf02b10e7923c21298163ca4a19354f6b5d381d666a9ede11ee7a4",
    "a96884b9897e019b271865d162f98a0c4a6e85b30ed1d2cf839691f079ac20ca",
    "ad50972535b2d71ae6c9dca5c5e49b4cfee907dd7d40e21c3239afd5df22b30b",
    "a2de5997dd14ab34784d9c6cbd4631f198610169faefc40b95b19fd8aaef7b25",
    "bd1b008b74bee92fdf507926e22f0230d8b58f350fde9a0e0a337160fdaf602b",
    "6e8d4df4b6be3ca2b6c27fe13aeb8487ba3ed1b5b1188b9a23ddebf6f1cd94ca",
    "ab441adeacee319d3fa8bf5a9d05a1ca3d600f9e9b1288e2afab2e26c0df98a5",
    "6aaa85da9c3e6536d3dda73465facf66e0697218ff6d78663f013b4b6fb76bd1",
    "6cda15b0df937db87a804103f7e2a35658f82f5c48607dcae01e9f359e6e0de2",
    "8f55090bbe5a46f410c445b97ec5202a780ada2fb54c321db1fcfff7b42d2322",
    "2bb2967ddab2e19f3387fcdfc2d871f1e061d76bcaae64ca03b1e95eedc1aea7",
    "a472f8d1b167349acdd1fd7039fbe9676ff6499f8faa7198be054fd5f9d1df4c",
    "40dab5d3518ca2cdb468e48c868ae10f92c59c6524727308e837735cca3fa297",
    "0e4b8e3f8fa8a5825a634738c603547dc1c7ba7ec91cbd6249e09af5f16f27be",
    "6da07d3a0ba71b2d96b388cf03623ad071d274db1bbc8b1615d5c8298bb9e12d",
    "67cc136c299413d774bf6dcb35759586229cc54df9ace05bfaca6c04ca619674",
  ];
  const width = 64, height = 48;
  const pixels = Float32Array.from({ length: width * height * 3 }, (_, index) => index % 29 === 0 ? 0
    : index % 37 === 0 ? -(index % 17) / 100 : index % 101 === 0 ? 32 : ((index * 16807 % 65521) / 65521) ** 3 * 2);
  const cellPeaks = Float32Array.from({ length: width * height }, (_, index) => pixels[index * 3] + 0.03);
  let index = 0;
  for (const lane of ["hdr", "sdr"]) for (const mode of ["histogram", "waveform"])
    for (const channelMode of ["rgb", "luma"]) for (const region of [false, true]) {
      const payload = HDRScopeAnalysis.buildGpuScopePayload({ width, height, pixels, cellPeaks }, {
        lane, mode, channelMode, tier: "settled", generation: 3, bins: 32, columns: 16,
        maxNits: 4000, referenceWhite: 203, exactPeak: { peak: 2.3, longEdge: 7952 },
        scopeRegion: region ? { x: 0.2, y: 0.15, width: 0.6, height: 0.55 } : null,
      });
      const numbers = { counts: payload.channels.map(channel => [channel.bins, channel.grid]),
        peak: payload.peak_value, population: payload.normalization_peak, clipped: payload.clipped,
        stats: payload.stats.filter(({ label }) => lane === "hdr" || label !== "Brightest 1%").map(stat => stat.value) };
      assert.equal(createHash("sha256").update(JSON.stringify(numbers)).digest("hex"), expected[index++],
        `${lane} ${mode} ${channelMode} region=${region}`);
    }
});

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
  assert.equal(payload.stats.find(({ label }) => label === "Median brightness").value, "0.739");
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

test("HDR readout uses project white and the display threshold in every scope mode", () => {
  const levels = [50, 99, 150, 300, 450, 1200];
  const pixels = levels.flatMap(nits => Array(3).fill(nits * 0.18 / 100));
  for (const mode of ["histogram", "waveform", "vectorscope"]) {
    const options = { lane: "hdr", mode, bins: 8, columns: 8, referenceWhite: 100 };
    const readout = (extra) => Object.fromEntries(HDRScopeAnalysis.buildGpuScopePayload(
      analysis(pixels, levels.length), { ...options, ...extra },
    ).stats.map(({ label, value }) => [label, value]));
    const hdr = readout({ displayPeakNits: 445.25 });
    assert.equal(hdr["Above reference white"], "66.67%", mode);
    assert.equal(hdr["% > 445.25 nit"], "33.33%", mode);
    assert.equal(readout()["% > 1000 nit"], "16.67%", mode);
    assert.equal(Object.keys(hdr).length, 5, mode);
  }
});

test("SDR uses the brightest 1%, not the former 5%, and omits HDR thresholds", () => {
  const levels = Array(98).fill(0.1).concat([0.5, 0.5, 0.5]);
  const pixels = levels.flatMap(level => Array(3).fill(level));
  for (const mode of ["histogram", "waveform", "vectorscope"]) {
    const { stats } = HDRScopeAnalysis.buildGpuScopePayload(analysis(pixels, levels.length),
      { lane: "sdr", mode, bins: 8, columns: 8 });
    assert.deepEqual(stats.map(({ label }) => label), ["Peak (preview)", "Brightest 1%", "Median brightness"]);
    assert.equal(stats[1].value, mode === "vectorscope" ? "0.500" : "0.735", mode);
    assert.equal(stats[2].value, mode === "vectorscope" ? "0.100" : "0.349", mode);
  }
});

test("display peak follows physical monitor position and falls back for a missing or ambiguous reading", () => {
  const main = { x: 0, y: 0, width: 2560, height: 1440 };
  const side = { x: -1920, y: 90, width: 1920, height: 1080 };
  const telemetry = [
    { physical_bounds: main, max_luminance_nits: 445.25 },
    { physical_bounds: side, max_luminance_nits: 400 },
  ];
  const peak = (bounds, displays = telemetry) => HDRScopeUI.displayPeakNits({ physicalBounds: bounds }, displays);
  assert.equal(peak({ ...main, width: 2561 }), 445.25);
  assert.equal(peak(side), 400);
  assert.equal(peak(side, telemetry.slice(0, 1)), 1000);
  assert.equal(peak(main, telemetry.concat({ physical_bounds: main, max_luminance_nits: 650 })), 1000);
  assert.equal(peak(null), 1000);
});
