(function () {
  "use strict";

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
