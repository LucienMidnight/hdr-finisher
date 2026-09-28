(function () {
  "use strict";

  const vectorscopeTransferLutCache = new Map();
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function hdrWaveformRec2020(r, g, b) {
  return [
    Math.max(0, 1.0260187082 * r - 0.0221655448 * g - 0.0038531634 * b),
    Math.max(0, -0.0017230808 * r + 1.0023190716 * g - 0.0005959908 * b),
    Math.max(0, -0.0051099278 * r - 0.0216355504 * g + 1.0267454781 * b),
  ];
}

function linearSrgbToScopeSignal(value) {
  const linear = clamp(value, 0, 1);
  return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
}

function buildGpuScopePayload(analysis, { lane, mode, tier, generation, bins, columns, maxNits, scopeRegion = null, exactPeak = null, channelMode = "rgb", referenceWhite = 203 }) {
  const hdr = lane === "hdr";
  const ceiling = maxNits === 1000 ? 1000 : maxNits === 10000 ? 10000 : 4000;
  const channelEntries = channelMode === "luma"
    ? [[3, "Y"]]
    : [[0, "R"], [1, "G"], [2, "B"]];
  if (mode === "vectorscope") return buildGpuVectorscopePayload(analysis, { lane, tier, generation, bins, scopeRegion, referenceWhite });
  const binEdges = hdr
    ? Array.from({ length: bins + 1 }, (_, index) => 10 ** (Math.log10(ceiling) * index / bins))
    : Array.from({ length: bins + 1 }, (_, index) => index / bins);
  const counts = channelEntries.map(() => new Int32Array(mode === "waveform" ? bins * columns : bins));
  const bounds = scopeAnalysisBounds(analysis, scopeRegion);
  const lumaValues = new Float32Array(bounds.width * bounds.height);
  let peak = 0;
  let clipped = false;
  let above100 = 0;
  let above203 = 0;
  let above1000 = 0;
  let regionPixel = 0;
  for (let sourceY = bounds.y0; sourceY < bounds.y1; sourceY += 1) {
    for (let sourceX = bounds.x0; sourceX < bounds.x1; sourceX += 1) {
      const pixel = sourceY * analysis.width + sourceX;
      const offset = pixel * 3;
      const r = Math.max(0, analysis.pixels[offset]);
      const g = Math.max(0, analysis.pixels[offset + 1]);
      const b = Math.max(0, analysis.pixels[offset + 2]);
      const scopeRgb = hdr
        ? hdrWaveformRec2020(r, g, b)
        : [linearSrgbToScopeSignal(r), linearSrgbToScopeSignal(g), linearSrgbToScopeSignal(b)];
      const luma = hdr
        ? 0.2627 * scopeRgb[0] + 0.6780 * scopeRgb[1] + 0.0593 * scopeRgb[2]
        : 0.2126 * scopeRgb[0] + 0.7152 * scopeRgb[1] + 0.0722 * scopeRgb[2];
      const scopeLuma = luma;
      const values = hdr
        ? [...scopeRgb, scopeLuma].map((value) => value / 0.18 * referenceWhite)
        : [...scopeRgb, scopeLuma].map((value) => clamp(value, 0, 1));
      lumaValues[regionPixel] = values[3];
      regionPixel += 1;
      peak = Math.max(peak, values[3]);
      if (hdr && analysis.cellPeaks) {
        peak = Math.max(peak, Math.max(0, analysis.cellPeaks[pixel]) / 0.18 * referenceWhite);
      }
      clipped ||= hdr
        ? values[0] >= 10000 || values[1] >= 10000 || values[2] >= 10000
        : r >= 1 || g >= 1 || b >= 1;
      if (hdr) {
        above100 += values[3] > 100 ? 1 : 0;
        above203 += values[3] > 203 ? 1 : 0;
        above1000 += values[3] > 1000 ? 1 : 0;
      }
      const column = Math.min(columns - 1, Math.floor((sourceX - bounds.x0) / bounds.width * columns));
      channelEntries.forEach(([valueIndex], channel) => {
        const value = values[valueIndex];
        const bin = hdr
          ? Math.min(bins - 1, Math.max(0, Math.floor(Math.log10(clamp(value, 1, ceiling)) / Math.log10(ceiling) * bins)))
          : Math.min(bins - 1, Math.max(0, Math.floor(value * bins)));
        counts[channel][mode === "waveform" ? bin * columns + column : bin] += 1;
      });
    }
  }
  // TypedArray#sort is numeric and in-place. Avoid boxing every sample into a
  // second JavaScript array during frequent scope refreshes.
  const sortedLuma = lumaValues.sort();
  const percentile = (amount) => sortedLuma[Math.min(sortedLuma.length - 1, Math.round((sortedLuma.length - 1) * amount))] || 0;
  const formatNits = (value) => value >= 1000 ? `${value.toFixed(0)} nit` : value >= 99.995 ? `${value.toFixed(1)} nit` : `${value.toFixed(2)} nit`;
  const sampleCount = Math.max(1, lumaValues.length);
  // A measured full-resolution peak replaces the proxy's rather than being
  // maximised with it. The proxy can read *high* as well as low -- Lanczos
  // rings at a hard edge and can overshoot the values it resampled from -- and
  // that overshoot is an artifact of the preview, not something the export
  // will contain. What this number promises is what the export contains.
  const measuredPeak = Number.isFinite(exactPeak?.peak)
    ? exactPeak.peak / 0.18 * referenceWhite
    : null;
  const reportedPeak = hdr && measuredPeak !== null ? measuredPeak : peak;
  const peakLabel = hdr && measuredPeak !== null ? "Peak" : "Peak (preview)";
  const stats = hdr ? [
    { label: peakLabel, value: formatNits(reportedPeak) },
    { label: "P99", value: formatNits(percentile(0.99)) },
    { label: "P95", value: formatNits(percentile(0.95)) },
    { label: "Median", value: formatNits(percentile(0.5)) },
    { label: "% > 100", value: `${(above100 / sampleCount * 100).toFixed(2)}%` },
    { label: "% > 203", value: `${(above203 / sampleCount * 100).toFixed(2)}%` },
    { label: "% > 1000", value: `${(above1000 / sampleCount * 100).toFixed(2)}%` },
  ] : [
    { label: "Peak", value: peak.toFixed(3) },
    { label: "P95", value: percentile(0.95).toFixed(3) },
    { label: "Median", value: percentile(0.5).toFixed(3) },
  ];
  const channels = channelEntries.map(([, name], index) => ({
    name,
    bins: mode === "waveform" ? [] : Array.from(counts[index]),
    grid: mode === "waveform"
      ? Array.from({ length: bins }, (_, row) => Array.from(counts[index].subarray(row * columns, (row + 1) * columns)))
      : [],
  }));
  const populationPeak = robustScopePopulationPeak(counts, mode === "histogram" ? 0.985 : 0.995);
  const hdrGuides = [[1, "1 nit"], [10, "10"], [25, "25"], [50, "50"], [100, "100 controlled white"], [203, "203 standard white"], [400, "400"], [600, "600"], [1000, "1000"], [2000, "2000"], [4000, "4000"], [10000, "10000 PQ limit"]]
    .map(([value, label]) => [value, value === referenceWhite ? `${label} · active` : label]);
  return {
    preview_kind: lane,
    scope_type: hdr ? `reference_nits_${mode}` : `normalized_${mode}`,
    tier,
    generation,
    normalization_peak: populationPeak,
    peak_value: reportedPeak,
    peak_exact: hdr && measuredPeak !== null,
    peak_measured_long_edge: exactPeak?.longEdge ?? null,
    clipped,
    x_axis: hdr ? "reference_nits_log10" : "normalized",
    bin_edges: binEdges,
    guides: hdr ? hdrGuides.filter(([value]) => value <= ceiling).map(([value, label]) => ({ value, label })) : [{ value: 0.18, label: mode === "histogram" ? "18% signal" : "18%" }, { value: 0.5, label: mode === "histogram" ? "50% signal" : "50%" }, { value: 1, label: mode === "histogram" ? "100% signal" : "100%" }],
    stats,
    channels,
  };
}

function robustScopePopulationPeak(counts, percentile = 0.995) {
  const positive = [];
  counts.forEach((channel) => channel.forEach((value) => {
    if (value > 0) positive.push(value);
  }));
  if (!positive.length) return 1;
  positive.sort((left, right) => left - right);
  return Math.max(1, positive[Math.floor((positive.length - 1) * percentile)]);
}

function scopeAnalysisBounds(analysis, region = null) {
  if (!region) return { x0: 0, y0: 0, x1: analysis.width, y1: analysis.height, width: analysis.width, height: analysis.height };
  const x0 = Math.min(analysis.width - 1, Math.max(0, Math.floor(region.x * analysis.width)));
  const y0 = Math.min(analysis.height - 1, Math.max(0, Math.floor(region.y * analysis.height)));
  const x1 = Math.min(analysis.width, Math.max(x0 + 1, Math.ceil((region.x + region.width) * analysis.width)));
  const y1 = Math.min(analysis.height, Math.max(y0 + 1, Math.ceil((region.y + region.height) * analysis.height)));
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

function buildGpuVectorscopePayload(analysis, { lane, tier, generation, bins, scopeRegion = null, referenceWhite = 203 }) {
  const hdr = lane === "hdr";
  const transfer = vectorscopeTransferLut(hdr, referenceWhite);
  const grid = Array.from({ length: bins }, () => new Int32Array(bins));
  let peak = 0;
  const bounds = scopeAnalysisBounds(analysis, scopeRegion);
  for (let sourceY = bounds.y0; sourceY < bounds.y1; sourceY += 1) {
    for (let sourceX = bounds.x0; sourceX < bounds.x1; sourceX += 1) {
      const pixel = sourceY * analysis.width + sourceX;
      const offset = pixel * 3;
      const workingR = Math.max(0, analysis.pixels[offset]);
      const workingG = Math.max(0, analysis.pixels[offset + 1]);
      const workingB = Math.max(0, analysis.pixels[offset + 2]);
      const sceneY = hdr
        ? 0.2722287 * workingR + 0.6740818 * workingG + 0.0536895 * workingB
        : 0.2126 * workingR + 0.7152 * workingG + 0.0722 * workingB;
      peak = Math.max(peak, hdr ? sceneY / 0.18 * referenceWhite : sceneY);
      if (hdr && analysis.cellPeaks) {
        peak = Math.max(peak, Math.max(0, analysis.cellPeaks[pixel]) / 0.18 * referenceWhite);
      }
      const linearR = hdr ? Math.max(0, 1.0260187082 * workingR - 0.0221655448 * workingG - 0.0038531634 * workingB) : workingR;
      const linearG = hdr ? Math.max(0, -0.0017230808 * workingR + 1.0023190716 * workingG - 0.0005959908 * workingB) : workingG;
      const linearB = hdr ? Math.max(0, -0.0051099278 * workingR - 0.0216355504 * workingG + 1.0267454781 * workingB) : workingB;
      const r = sampleVectorscopeTransfer(transfer, linearR);
      const g = sampleVectorscopeTransfer(transfer, linearG);
      const b = sampleVectorscopeTransfer(transfer, linearB);
      const [kr, kg, kb] = hdr ? [0.2627, 0.6780, 0.0593] : [0.2126, 0.7152, 0.0722];
      const y = kr * r + kg * g + kb * b;
      const u = clamp(0.5 + (b - y) / (2 * (1 - kb)), 0, 1);
      const v = clamp(0.5 + (r - y) / (2 * (1 - kr)), 0, 1);
      grid[Math.min(bins - 1, Math.floor(v * bins))][Math.min(bins - 1, Math.floor(u * bins))] += 1;
    }
  }
  const normalizationPeak = robustScopePopulationPeak(grid);
  return {
    preview_kind: lane,
    scope_type: "vectorscope",
    tier,
    generation,
    normalization_peak: normalizationPeak,
    peak_value: peak,
    clipped: peak >= (hdr ? 10000 : 1),
    x_axis: "chroma_uv",
    bin_edges: Array.from({ length: bins + 1 }, (_, index) => index / bins),
    guides: [],
    stats: [{ label: "Peak", value: hdr ? `${peak.toFixed(1)} nit` : peak.toFixed(3) }],
    channels: [{ name: "Y", bins: [], grid: grid.map((row) => Array.from(row)) }],
  };
}

function vectorscopeTransferLut(hdr, referenceWhite) {
  const key = `${hdr ? "pq" : "srgb"}:${hdr ? referenceWhite : 1}`;
  const cached = vectorscopeTransferLutCache.get(key);
  if (cached) return cached;
  const size = 4096;
  const maximumLinear = hdr ? 10000 * 0.18 / Math.max(1, referenceWhite) : 1;
  const values = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const linear = maximumLinear * index / (size - 1);
    if (hdr) {
      const m1 = 2610 / 16384;
      const m2 = 2523 / 32;
      const c1 = 3424 / 4096;
      const c2 = 2413 / 128;
      const c3 = 2392 / 128;
      const lm1 = Math.pow(linear / maximumLinear, m1);
      values[index] = Math.pow((c1 + c2 * lm1) / (1 + c3 * lm1), m2);
    } else {
      values[index] = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    }
  }
  const result = { values, maximumLinear };
  vectorscopeTransferLutCache.set(key, result);
  return result;
}

function sampleVectorscopeTransfer(transfer, linear) {
  const position = clamp(linear / transfer.maximumLinear, 0, 1) * (transfer.values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(transfer.values.length - 1, lower + 1);
  const mix = position - lower;
  return transfer.values[lower] + (transfer.values[upper] - transfer.values[lower]) * mix;
}


  const HDRScopeAnalysis = Object.freeze({
    buildGpuScopePayload,
    robustScopePopulationPeak,
    scopeAnalysisBounds,
    hdrWaveformRec2020,
    linearSrgbToScopeSignal,
  });

  if (typeof window !== "undefined") window.HDRScopeAnalysis = HDRScopeAnalysis;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRScopeAnalysis };
})();
