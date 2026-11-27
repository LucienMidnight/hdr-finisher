(function () {
  "use strict";

  const DEFAULT_DISPLAY_PEAK_NITS = 1000;

  const scopeStatTooltips = {
    "Peak": "The brightest point in the picture.",
    "Peak (preview)": "The brightest point the current preview found. A tiny highlight may be missed.",
    "Peak (estimate)": "The brightest point found in a more detailed preview. This is still an estimate.",
    "Brightest 1%": "How bright the brightest 1% of the picture is, ignoring tiny specks.",
    "Median brightness": "Half the picture is darker than this. Compare it to see if HDR and SDR main tones match.",
    "Above reference white": "Share of the picture brighter than the project's HDR reference white.",
    "Display threshold": "Share of the picture above the display's reported peak. Uses 1,000 nits if no reading is available.",
  };

  function statTooltip(label) {
    return /^% > /.test(label) ? scopeStatTooltips["Display threshold"] : scopeStatTooltips[label];
  }

  function displayPeakNits(currentDisplay, displays = []) {
    const bounds = currentDisplay?.physicalBounds;
    if (!bounds) return DEFAULT_DISPLAY_PEAK_NITS;
    // Use the physical midpoint so a fractional Windows scale factor cannot
    // miss a monitor when its DIP bounds round by a pixel at the edge.
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    const matches = displays.filter(({ physical_bounds: rect }) => rect
      && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
    // Mirrored outputs can have identical bounds. Don't silently guess which
    // peak to use if they disagree.
    const peaks = new Set(matches.map((display) => display.max_luminance_nits));
    const [peak] = peaks;
    return peaks.size === 1 && Number.isFinite(peak) && peak > 0 ? peak : DEFAULT_DISPLAY_PEAK_NITS;
  }

  function freshnessLabel(tier) {
    return tier === "interactive" ? "Preview" : tier === "refinement" ? "Refined" : "Settled";
  }

  function requestResolution(tier, quality) {
    if (quality === "performance") {
      const bins = tier === "interactive" ? 96 : 128;
      return { bins, columns: bins };
    }
    if (quality === "reference") {
      const bins = tier === "interactive" ? 192 : 384;
      return { bins, columns: bins };
    }
    const bins = tier === "interactive" ? 128 : 256;
    return { bins, columns: bins };
  }

  function qualityProfile(profiles, quality, defaultQuality) {
    return profiles[quality] || profiles[defaultQuality];
  }

  function hdrCeiling(scope) {
    const edges = scope?.bin_edges || [];
    const edge = Number(edges[edges.length - 1]);
    if (!Number.isFinite(edge)) return 4000;
    if (edge >= 10000 - 1) return 10000;
    if (edge >= 4000 - 1) return 4000;
    return 1000;
  }

  function guidesForDisplay(scope) {
    if (scope.preview_kind === "hdr") {
      const ceiling = hdrCeiling(scope);
      if (ceiling >= 10000) return new Set([1, 10, 100, 203, 1000, 4000, 10000]);
      if (ceiling >= 4000) return new Set([1, 10, 100, 203, 1000, 4000]);
      return new Set([1, 10, 100, 203, 1000]);
    }
    return new Set([0.18, 0.5, 1]);
  }

  function compactGuideLabel(scope, guide) {
    if (scope.preview_kind !== "hdr") return guide.label;
    const value = Number(guide.value);
    const compactValue = value >= 1000
      ? `${Number((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))}k`
      : String(Number(value.toFixed(value < 10 ? 1 : 0)));
    return /\bactive\b/i.test(guide.label) ? `RW ${compactValue}` : compactValue;
  }

  function guideTooltip(scope) {
    if (scope?.scope_type === "vectorscope") {
      return "Chroma direction and saturation. Distance from center indicates saturation.";
    }
    const labeledGuides = guidesForDisplay(scope);
    const guides = (scope?.guides || []).filter((guide) => labeledGuides.has(Number(guide.value)));
    if (!guides.length) return "";
    const descriptions = guides.map((guide) => {
      const shortLabel = compactGuideLabel(scope, guide);
      if (scope.preview_kind !== "hdr") return `${shortLabel} output`;
      if (/\bactive\b/i.test(guide.label)) return `${shortLabel}: active HDR reference white`;
      const detail = String(guide.label || "").replace(/^\s*[\d.]+\s*/, "").trim();
      if (detail === "nit") return `${shortLabel}: 1 nit`;
      return detail ? `${shortLabel}: ${detail}` : `${shortLabel}: ${Number(guide.value)} nits`;
    });
    return `Scope guides — ${descriptions.join("; ")}. RW means active HDR reference white.`;
  }

  function guidePosition(scope, value) {
    if (scope.preview_kind === "hdr") {
      const min = Math.log10(1);
      const max = Math.log10(hdrCeiling(scope));
      return (Math.log10(Math.max(value, 1)) - min) / (max - min);
    }
    return Math.min(1, Math.max(0, value));
  }

  function filteredChannels(channels, channelMode) {
    if (channelMode === "luma") return channels.filter((channel) => channel.name === "Y");
    return channels.filter((channel) => channel.name === "R" || channel.name === "G" || channel.name === "B");
  }

  function titleFor(scope, channelMode) {
    const suffix = channelMode === "luma" ? " Luma" : channelMode === "parade" ? " Parade" : "";
    if (scope.scope_type === "vectorscope") return `${scope.preview_kind.toUpperCase()} Vectorscope`;
    if (scope.scope_type === "reference_nits_waveform") return `HDR Reference Waveform${suffix}`;
    if (scope.scope_type === "normalized_waveform") return `SDR Waveform${suffix}`;
    if (scope.scope_type === "reference_nits_histogram") return `Reference Nit Histogram${suffix}`;
    return `SDR Histogram${suffix}`;
  }

  const HDRScopeUI = Object.freeze({
    displayPeakNits,
    statTooltip,
    freshnessLabel,
    requestResolution,
    qualityProfile,
    hdrCeiling,
    guidesForDisplay,
    compactGuideLabel,
    guideTooltip,
    guidePosition,
    filteredChannels,
    titleFor,
  });

  if (typeof window !== "undefined") window.HDRScopeUI = HDRScopeUI;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRScopeUI };
})();
