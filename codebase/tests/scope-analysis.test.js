const assert = require("node:assert/strict");
const { test } = require("node:test");

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
  const expected = [
    "371d355641eb5596b1d0972c300aa173252b9e3c7135bc9575875dfaa2b994a5",
    "6efd9f8a6b50bb9fd5d1ef03f7b541ac4e413554d88ea990d3bd8f5dbdf3c2c9",
    "572369efd3edecabcebc0f33ef8b571c830bcba82d3fb21174507af751d64ad2",
    "78a5dee228ad68ee329ba36c6301ca06349403b2e5b4152eadb342ae5919a528",
    "3dc0baa5576db85a883ef4c1b2b3dc33b15d40e66ad94ece69e8c0e533742867",
    "777609bcf65162e5085f200c25b15ebc84400edcfe6028e97a378ed4a3eee19f",
    "980547f3840130e58afa5eda8273bcd338ad76037742cbbdfb0946c22c85a36b",
    "0704f0e1bee3ec8f238c261dbc274e277c42289a82a533e7c73dac90103c9794",
    "7a2c09ef9fcb08d8b6f95b21be2d653724237c58b8e03fab2f5c0a86c234fa07",
    "8e014626771ffc3f9d2299ff0dda607d2c6035c03d6fd0417147f9e49b050ff8",
    "235cc9cac4ac6fcce26855281295861756ad4ca995af9a679ed788dd816ebbf4",
    "bbabb7595439a2d20ace6bc3a1f71390bb204210173b3d0eaed75067e3b91396",
    "8a2f08139d48e4211bddda59f58b4333fe13fd5588e256c5fe0ba05db865bec8",
    "e1ca97978a10aa25ab06b305f5fbd73b1ea5d677da002e0be005295459e042aa",
    "8f79ee36ccf75cd38603c954154147c755d2678a10ff1ce48b6d0f7122bddcfb",
    "94b1131b740421837bffdbab9674f894899d543df6bd99eab3c477c823363fdf",
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
        stats: payload.stats.map(stat => stat.value) };
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
