(function () {
  const zones = ["shadows", "midtones", "highlights"];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smooth = (value) => { const clipped = clamp(value, 0, 1); return clipped * clipped * (3 - 2 * clipped); };

  function control(path) {
    const match = /^(?:(hdr|sdr)\.)?(blacks|whites|shadows|midtones|highlights)(?:_(center|width))?$/.exec(path || "");
    return match ? { lane: match[1], zone: match[2], dimension: match[3] || "amount" } : null;
  }

  function influence(branch, hdr, zone, luminance, maximum = luminance, referenceWhite = 203, tone = globalThis.HDRTone) {
    const grey = 0.18 * (hdr ? 0.18 : 100 / 203);
    const peak = hdr ? (branch.highlight_compression_target_nits ?? 1000) * 0.18 / referenceWhite : 1;
    const parameters = tone.parameters(branch, hdr, referenceWhite);
    const limiter = parameters[3];
    const knee = parameters[4];
    const white = clamp(Math.log2(Math.max(maximum, 1e-30) / (peak / 2)), 0, 1);
    let weight;
    if (zone === "blacks") weight = Math.max(1 - Math.max(luminance, 0) / knee, 0) ** 2;
    else if (zone === "whites") weight = white ** 2;
    else {
      const index = zones.indexOf(zone);
      const defaults = [[-1.5, 5], [0, 4], hdr ? [2.25, 4.5] : [1.75, 3.5]][index];
      if (!defaults) return { weight: 0, limiter };
      const center = branch[`${zone}_center`] ?? defaults[0];
      const half = Math.max(0.001, (branch[`${zone}_width`] ?? defaults[1]) / 2);
      const stops = Math.log2(Math.max(luminance, 1e-30) / grey);
      weight = (1 - smooth(Math.abs(stops - center) / half))
        * smooth(Math.log2(Math.max(luminance, 1e-30) / (knee / 2)))
        * (1 - smooth(2 * white));
    }
    const enabled = branch.tone_section_enabled !== false;
    return { weight: enabled ? weight * limiter : 0, limiter: enabled ? limiter : 0, grey, peak, knee };
  }

  function endpoint(post, pre, baseline, { black = false, peak = 1 } = {}) {
    const epsilon = Math.max(peak * 0.001, 1e-6);
    const touching = black ? Math.abs(post) <= 1e-6 : Math.abs(post - peak) <= epsilon;
    const lost = touching && (black ? pre < -1e-6 : pre > peak + epsilon);
    const newly = touching && Number.isFinite(baseline)
      && (black ? baseline > 1e-6 : baseline < peak - epsilon);
    return { touching, lost, newly };
  }

  function displayPeak(display, referenceWhite = 203) {
    const nits = Number.isFinite(display?.max_luminance_nits) ? display.max_luminance_nits
      : Number.isFinite(display?.nominal_headroom) && Number.isFinite(display?.sdr_white_nits)
        ? display.sdr_white_nits * 2 ** display.nominal_headroom : 0;
    return Math.max(0, nits * 0.18 / referenceWhite);
  }

  const api = Object.freeze({ control, influence, endpoint, displayPeak });
  if (typeof window !== "undefined") window.HDRTonePreviewModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
