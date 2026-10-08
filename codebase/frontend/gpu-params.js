  function halfToFloat(value) {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1f;
    const fraction = value & 0x03ff;
    if (exponent === 0) return sign * fraction * 5.960464477539063e-8;
    if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
    return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
  }

  function floatArraysEqual(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  const IDENTITY_3X3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ACESCG_PRIMARIES = [[0.713, 0.293], [0.165, 0.830], [0.128, 0.044]];
  const ACESCG_WHITE = [0.32168, 0.33767];

  function multiply3x3(left, right) {
    const output = new Array(9).fill(0);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        for (let inner = 0; inner < 3; inner += 1) output[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
    return output;
  }

  function invert3x3(matrix) {
    const [a, b, c, d, e, f, g, h, i] = matrix;
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(determinant) < 1e-12) return null;
    return [
      e * i - f * h, c * h - b * i, b * f - c * e,
      f * g - d * i, a * i - c * g, c * d - a * f,
      d * h - e * g, b * g - a * h, a * e - b * d,
    ].map((value) => value / determinant);
  }

  function rgbToXyzMatrix(primaries, white) {
    const unscaled = [
      primaries[0][0] / primaries[0][1], primaries[1][0] / primaries[1][1], primaries[2][0] / primaries[2][1],
      1, 1, 1,
      (1 - primaries[0][0] - primaries[0][1]) / primaries[0][1],
      (1 - primaries[1][0] - primaries[1][1]) / primaries[1][1],
      (1 - primaries[2][0] - primaries[2][1]) / primaries[2][1],
    ];
    const inverse = invert3x3(unscaled);
    if (!inverse) return null;
    const whiteXyz = [white[0] / white[1], 1, (1 - white[0] - white[1]) / white[1]];
    const scales = [0, 1, 2].map((row) => inverse[row * 3] * whiteXyz[0] + inverse[row * 3 + 1] * whiteXyz[1] + inverse[row * 3 + 2] * whiteXyz[2]);
    return unscaled.map((value, index) => value * scales[index % 3]);
  }

  function rayTriangleDistance(origin, direction, triangle) {
    let nearest = Infinity;
    for (let index = 0; index < 3; index += 1) {
      const start = triangle[index];
      const end = triangle[(index + 1) % 3];
      const edge = [end[0] - start[0], end[1] - start[1]];
      const determinant = direction[1] * edge[0] - direction[0] * edge[1];
      if (Math.abs(determinant) < 1e-12) continue;
      const delta = [start[0] - origin[0], start[1] - origin[1]];
      const distance = (edge[0] * delta[1] - edge[1] * delta[0]) / determinant;
      const edgePosition = (direction[0] * delta[1] - direction[1] * delta[0]) / determinant;
      if (distance >= -1e-9 && edgePosition >= -1e-9 && edgePosition <= 1 + 1e-9) nearest = Math.min(nearest, Math.max(0, distance));
    }
    return Number.isFinite(nearest) ? nearest : Math.hypot(triangle[0][0] - origin[0], triangle[0][1] - origin[1]);
  }

  function rotateScalePrimary(reference, hueDegrees, purityScale) {
    const baseAngle = Math.atan2(reference[1] - ACESCG_WHITE[1], reference[0] - ACESCG_WHITE[0]);
    const angle = baseAngle + hueDegrees * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const distance = rayTriangleDistance(ACESCG_WHITE, direction, ACESCG_PRIMARIES);
    return [ACESCG_WHITE[0] + direction[0] * distance * purityScale, ACESCG_WHITE[1] + direction[1] * distance * purityScale];
  }

  function rgbPrimariesAdjustmentMatrix(branch) {
    const customPrimaries = ACESCG_PRIMARIES.map((primary, index) => {
      const channel = ["red", "green", "blue"][index];
      const hue = Number(branch?.[`${channel}_hue`]) || 0;
      const purity = Math.max(0.01, 1 + (Number(branch?.[`${channel}_purity`]) || 0) / 100);
      return rotateScalePrimary(primary, hue, purity);
    });
    const tintHue = Number(branch?.tint_hue) || 0;
    const tintPurity = Math.min(0.99, Math.max(0, (Number(branch?.tint_purity) || 0) / 100));
    const customWhite = rotateScalePrimary(ACESCG_PRIMARIES[0], tintHue, tintPurity);
    const base = rgbToXyzMatrix(ACESCG_PRIMARIES, ACESCG_WHITE);
    const custom = rgbToXyzMatrix(customPrimaries, customWhite);
    const inverseBase = base && invert3x3(base);
    if (!custom || !inverseBase) return IDENTITY_3X3;
    const adjustment = multiply3x3(inverseBase, custom);
    return adjustment.every((value) => Number.isFinite(value) && Math.abs(value) <= 64) ? adjustment : IDENTITY_3X3;
  }

  function colorSettingsNeutral(branch) {
    if ((Number(branch?.white_balance_kelvin) || 6500) !== 6500) return false;
    return [
      "tint", "saturation", "vibrance",
      "red_hue", "red_purity", "green_hue", "green_purity",
      "blue_hue", "blue_purity", "tint_hue", "tint_purity",
    ].every((name) => Math.abs(Number(branch?.[name]) || 0) < 0.000001);
  }

  function curveSetNeutral(branch) {
    return ["luma_curve", "red_curve", "green_curve", "blue_curve"].every(name=>curvePointsNeutral(branch?.[name]));
  }

  function curvePointsNeutral(points) {
    return Array.isArray(points) && points.length >= 2
      && points.every(point=>Array.isArray(point) && Math.abs(Number(point[0])-Number(point[1]))<0.000001);
  }

  function toneEqualizerNeutral(branch) {
    const nodes = branch?.tone_equalizer_nodes;
    return !Array.isArray(nodes) || nodes.every((node) => Math.abs(Number(node?.adjustment_ev) || 0) < 0.000001);
  }

  // The tone stages the highlight reduction applies before it takes the peak
  // (peakTone in the reduction shader), for one neutral value. Carrying a
  // measurement across a drag runs it back through the settings it was taken
  // with and forward through the current ones.
  function highlightToneSettings(params) {
    return { exposure: params[2] || 0, lift: params[4] || 0, contrast: params[8] || 0, pivot: params[9] || 0.1845 };
  }

  function applyHighlightTone(value, tone) {
    let rgb = value * Math.pow(2, tone.exposure);
    if (tone.lift !== 0) rgb *= 1 + Math.min(tone.lift * (1 - Math.min(1, Math.max(0, rgb))), 1);
    if (tone.contrast !== 0 && rgb > 0.00000001) {
      const pivot = Math.max(tone.pivot, 0.000001);
      const stops = Math.log2(rgb / pivot);
      rgb = pivot * Math.pow(2, Math.min(32, Math.max(-32, stops * Math.pow(2, tone.contrast))));
    }
    return rgb;
  }

  function invertHighlightTone(value, tone) {
    // Monotonic for every legal setting, so bisect in log space.
    let low = -40;
    let high = 40;
    for (let step = 0; step < 80; step += 1) {
      const middle = (low + high) / 2;
      if (applyHighlightTone(2 ** middle, tone) < value) low = middle; else high = middle;
    }
    return 2 ** ((low + high) / 2);
  }

  function toneAdjustedHighlightPeakLinear(branch, toneEnabled, referenceWhiteNits) {
    const authoredPeak = branch.highlight_compression_peak_measurement === "manual"
      ? branch.highlight_compression_manual_peak_nits
      : branch.highlight_compression_source_peak_nits;
    let peak = Math.max(1, Number(authoredPeak) || 1000) * 0.18 / referenceWhiteNits;
    if (!toneEnabled) return peak;
    peak *= Math.pow(2, Number(branch.exposure) || 0);
    const shadowLift = Number(branch.shadow_lift) || 0;
    if (shadowLift !== 0) {
      const liftFactor = Math.min(1, shadowLift * (1 - Math.min(1, Math.max(0, peak))));
      peak *= 1 + liftFactor;
    }
    const contrast = Number(branch.contrast) || 0;
    if (contrast !== 0 && peak > 0.00000001) {
      const pivot = Math.max(Number(branch.contrast_pivot) || 0.1845, 0.000001);
      const stops = Math.log2(Math.max(peak, 0.00000001) / pivot);
      peak = pivot * Math.pow(2, Math.min(32, Math.max(-32, stops * Math.pow(2, contrast))));
    }
    return Math.max(0.0018, peak);
  }

  function buildParams(lane, adjustments, workingSpace, hdrSurface, referenceWhiteNits = 203, sourcePixelScale = 1) {
    const params = new Float32Array(PARAM_COUNT);
    const projectReferenceWhite = Number(referenceWhiteNits) === 100 ? 100 : 203;
    const branch = adjustments[lane];
    const colorSource = branch;
    params[0] = lane === "hdr" ? 1 : 0;
    params[1] = workingSpace === "linear-srgb" ? 1 : 0;
    const toneEnabled = branch.tone_section_enabled !== false;
    const highlightEnabled = branch.highlight_section_enabled !== false;
    const primariesEnabled = branch.primaries_section_enabled !== false;
    const colorEnabled = branch.color_section_enabled !== false;
    const colorActive = colorEnabled && !colorSettingsNeutral(colorSource);
    params[2] = toneEnabled ? branch.exposure || 0 : 0;
    params[3] = highlightEnabled ? branch.highlight_compression_softness || 0 : 0;
    params[4] = toneEnabled ? (lane === "hdr" ? branch.shadow_lift || 0 : branch.shadow || 0) : 0;
    params[5] = primariesEnabled ? branch.lift || 0 : 0;
    params[6] = primariesEnabled ? branch.gamma || 0 : 0;
    params[7] = primariesEnabled ? branch.gain || 0 : 0;
    params[8] = toneEnabled ? branch.contrast || 0 : 0;
    params[9] = branch.contrast_pivot || (lane === "hdr" ? 0.1845 : 0.5);
    params[10] = colorActive ? colorSource.white_balance_kelvin || 6500 : 6500;
    params[11] = colorActive ? colorSource.tint || 0 : 0;
    params[15] = branch.curves_section_enabled !== false && !curveSetNeutral(branch) ? 1 : 0;
    params[16] = hdrSurface ? 1 : 0;
    // The transport limit is absolute; scene-linear scale follows the project.
    params[17] = 10000 * 0.18 / projectReferenceWhite;
    params[18] = branch.tone_equalizer_section_enabled !== false && !toneEqualizerNeutral(branch) ? 1 : 0;
    params[19] = Math.min(1, Math.max(0, branch.tone_equalizer_smoothing ?? 0.5));
    const toneNodes = normalizedToneEqualizerNodes(branch.tone_equalizer_nodes);
    params[20] = toneNodes.length;
    toneNodes.forEach((node, index) => {
      params[21 + index] = node.input_ev;
      params[37 + index] = node.adjustment_ev;
    });
    params[53] = lane === "hdr"
      ? ((branch.highlight_compression_start_nits ?? 400) * 0.18 / projectReferenceWhite)
      : (branch.highlight_compression_start_percent ?? 50) / 100;
    params[54] = branch.lift_pivot ?? -2;
    params[55] = branch.lift_range ?? 4;
    params[56] = branch.gamma_pivot ?? 0;
    params[57] = branch.gamma_range ?? 4.25;
    params[58] = branch.gain_pivot ?? 2;
    params[59] = branch.gain_range ?? 4;
    const colorMatrix = colorActive ? rgbPrimariesAdjustmentMatrix(colorSource) : IDENTITY_3X3;
    colorMatrix.forEach((value, index) => { params[61 + index] = value; });
    params[70] = colorActive ? colorSource.saturation || 0 : 0;
    params[71] = colorActive ? colorSource.vibrance || 0 : 0;
    params[72] = colorActive ? 1 : 0;
    // BW-01 Black & White: on/off and Reds..Magentas / 100 (blackAndWhiteWgsl).
    const blackAndWhiteOn = branch.black_and_white_section_enabled === true;
    const blackAndWhite = branch.black_and_white || {};
    params[BLACK_AND_WHITE_PARAM] = blackAndWhiteOn ? 1 : 0;
    ["reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas"].forEach((name, index) => {
      params[BLACK_AND_WHITE_PARAM + 1 + index] = blackAndWhiteOn ? (Number(blackAndWhite[name]) || 0) / 100 : 0;
    });
    params[73] = lane === "hdr" ? ((branch.highlight_compression_target_nits ?? 1000) * 0.18 / projectReferenceWhite) : 1;
    params[74] = highlightEnabled ? (branch.highlight_compression_mode === "peak_fit" ? 1 : branch.highlight_compression_mode === "soft_ceiling" ? 2 : branch.highlight_compression_mode === "clip" ? 3 : 0) : 0;
    params[75] = lane === "hdr"
      ? toneAdjustedHighlightPeakLinear(branch, toneEnabled, projectReferenceWhite)
      : Math.max(0.01, (branch.highlight_compression_peak_measurement === "manual"
        ? branch.highlight_compression_manual_peak_percent ?? 100
        : branch.highlight_compression_source_peak_percent ?? 100) / 100 * (toneEnabled ? Math.pow(2, branch.exposure || 0) : 1));
    params[138] = projectReferenceWhite;
    params[139] = 203;
    params[76] = Math.min(1, Math.max(0, (branch.highlight_compression_peak_detail ?? 35) / 100));
    params[77] = Math.min(1, Math.max(-1, (branch.highlight_compression_bias ?? 0) / 100)) * 0.6;
    const film = branch.film_look || {};
    const filmEnabled = branch.film_look_section_enabled !== false;
    params[78] = filmEnabled ? 1 : 0;
    params[79] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0;
    params[80] = (film.print_strength || 0) / 100;
    params[81] = (film.print_contrast || 0) / 100;
    params[82] = (film.print_toe || 0) / 100;
    params[83] = (film.print_shoulder || 0) / 100;
    params[84] = (film.color_density || 0) / 100;
    // With Black & White on, Film Look adds no colour back: no per-channel
    // print response, no halation tint, no grain colour
    // (adjustments.py black_and_white_neutral_film_look).
    params[143] = blackAndWhiteOn ? 0 : (film.red_response || 0) / 100;
    params[144] = blackAndWhiteOn ? 0 : (film.green_response || 0) / 100;
    params[145] = blackAndWhiteOn ? 0 : (film.blue_response || 0) / 100;
    params[146] = (film.highlight_desaturation || 0) / 100;
    params[147] = (film.shadow_desaturation || 0) / 100;
    params[85] = film.halation_enabled !== false && ((((film.halation_amount || 0) > 0) && (film.halation_radius || 0) > 0) || film.halation_view_map) ? 1 : 0;
    params[86] = (film.halation_amount || 0) / 100;
    params[87] = (film.halation_sensitivity ?? 75) / 100;
    params[88] = film.halation_radius ?? 0.2;
    params[89] = (film.halation_hue_offset || 0) / 100;
    params[90] = blackAndWhiteOn ? 0 : (film.halation_saturation ?? 75) / 100;
    params[91] = film.halation_view_map ? 1 : 0;
    params[92] = film.bloom_enabled !== false && (film.bloom_radius || 0) > 0 ? 1 : 0;
    params[93] = (film.bloom_amount || 0) / 100;
    params[94] = (film.bloom_sensitivity ?? 80) / 100;
    params[95] = film.bloom_radius ?? 0.5;
    params[96] = (film.bloom_highlight_detail ?? 75) / 100;
    // 97-99: Detail's Softness and Microcontrast, run in the film stage where
    // Film Look's Image Structure ran (NEXT-01 #2). Detail's switch gates
    // them; Look Strength and the Film Look switch do not.
    const structureDetail = branch.detail || {};
    params[97] = branch.detail_section_enabled !== false ? 1 : 0;
    params[98] = (Number(structureDetail.softness) || 0) / 100;
    params[99] = (Number(structureDetail.microcontrast) || 0) / 100;
    params[100] = film.grain_enabled !== false ? 1 : 0;
    params[101] = (film.grain_amount || 0) / 100;
    params[102] = (film.grain_size ?? 50) / 100;
    params[103] = (film.grain_softness ?? 25) / 100;
    params[104] = blackAndWhiteOn ? 0 : (film.grain_chroma || 0) / 100;
    params[105] = (film.grain_shadow_response ?? 100) / 100;
    params[106] = (film.grain_midtone_response ?? 100) / 100;
    params[107] = (film.grain_highlight_response ?? 100) / 100;
    params[108] = (film.film_resolution ?? 100) / 100;
    // f32 holds integers exactly only to 2^24, so the seed travels in two
    // 16-bit halves (109 low, 176 high) and the shader reassembles it.
    const grainSeed = (adjustments.shared?.film_grain_seed ?? 271828) >>> 0;
    params[109] = grainSeed & 0xffff;
    params[GRAIN_SEED_HIGH_INDEX] = grainSeed >>> 16;
    params[GRAIN_FILM_TYPE_INDEX] = film.grain_film_type === "black_and_white" ? 1 : 0;
    const filmGates = {
      "65mm": [52.63, 23.01],
      "35mm": [36, 24],
      super35: [24.89, 18.66],
      super16: [12.52, 7.41],
      "16mm": [10.26, 7.49],
      super8: [5.79, 4.01],
    };
    const gate = film.grain_film_format === "custom"
      ? [Math.min(500, Math.max(1, Number(film.grain_custom_width_mm) || 36)), Math.min(500, Math.max(1, Number(film.grain_custom_height_mm) || 24))]
      : (filmGates[film.grain_film_format] || filmGates["35mm"]);
    params[140] = gate[0];
    params[141] = gate[1];
    params[142] = film.grain_capture_geometry === "horizontal_strip" ? 1
      : film.grain_capture_geometry === "vertical_strip" ? 2 : 0;
    params[156] = filmEnabled ? 1 : 0;
    params[157] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0;
    // Viewer-only diagnostic.
    params[158] = film.grain_view_map ? 1 : 0;
    params[110] = branch.highlight_compression_color_handling === "smooth_rolloff" ? 2
      : branch.highlight_compression_color_handling === "path_to_white" ? 1 : 0;
    const grading = branch.color_grading || {};
    params[111] = branch.color_grading_section_enabled !== false ? 1 : 0;
    params[112] = 0.55 + 3.45 * (grading.blending ?? 50) / 100;
    params[113] = (grading.balance || 0) / 50;
    [grading.shadows || {}, grading.midtones || {}, grading.highlights || {}].forEach((wheel, index) => {
      params[114 + index * 3] = wheel.hue || 0;
      params[115 + index * 3] = (wheel.saturation || 0) / 400;
      params[116 + index * 3] = wheel.luminance_ev || 0;
    });
    const vignette = branch.vignette || {};
    params[123] = branch.vignette_section_enabled !== false ? 1 : 0;
    params[124] = 2 * (vignette.amount || 0) / 100;
    params[125] = 0.15 + 0.70 * (vignette.midpoint ?? 50) / 100;
    const roundness = (vignette.roundness || 0) / 100;
    params[126] = roundness >= 0 ? 2 + 6 * roundness : 2 + roundness;
    params[127] = 0.02 + 0.98 * (vignette.feather ?? 75) / 100;
    params[128] = (vignette.highlight_protection || 0) / 100;
    params[129] = vignette.center_x ?? 0.5;
    params[130] = vignette.center_y ?? 0.5;
    const detail = branch.detail || {};
    params[148] = branch.detail_section_enabled !== false ? 1 : 0;
    params[149] = (Number(detail.texture_amount) || 0) / 100;
    params[150] = (Number(detail.clarity_amount) || 0) / 125;
    params[151] = Math.min(3, Math.max(0.2, Number(detail.clarity_radius_percent) || 0.75));
    params[152] = Math.max(0, Number(detail.sharpen_amount) || 0) / 100;
    params[153] = Math.min(3, Math.max(0.3, Number(detail.sharpen_radius_px) || 0.8));
    params[154] = Math.min(1, Math.max(0, Number(detail.sharpen_threshold) || 0) / 100) * 0.50;
    params[155] = Math.min(1, Math.max(0.05, Number(sourcePixelScale) || 1));
    // Read only by the pinned peak-measurement shader, to tell the SDR lane.
    params[159] = lane === "sdr" ? 1 : 0;
    // Direct renders the whole output, so its tile origin is the origin.
    params[TILE_ORIGIN_X_INDEX] = 0;
    params[TILE_ORIGIN_Y_INDEX] = 0;
    return params;
  }

  function normalizedToneEqualizerNodes(values) {
    const source = Array.isArray(values) && values.length >= 2
      ? values.slice(0, 16)
      : [-6, -3, 0, 3, 6].map((inputEv) => ({ input_ev: inputEv, adjustment_ev: 0 }));
    const nodes = source.map((node) => ({
      input_ev: Math.min(6, Math.max(-6, Number(node?.input_ev) || 0)),
      adjustment_ev: Math.min(2, Math.max(-2, Number(node?.adjustment_ev) || 0)),
    })).sort((left, right) => left.input_ev - right.input_ev);
    nodes[0].input_ev = -6;
    nodes[nodes.length - 1].input_ev = 6;
    const targets = nodes.map((node) => node.input_ev + node.adjustment_ev);
    for (let index = 1; index < targets.length; index += 1) {
      targets[index] = Math.max(targets[index], targets[index - 1] + 0.001);
    }
    nodes.forEach((node, index) => { node.adjustment_ev = Math.min(2, Math.max(-2, targets[index] - node.input_ev)); });
    return nodes;
  }

  function buildCurves(lane, adjustments, curveSampler, sampleCache, cacheNamespace = lane) {
    const branch = adjustments[lane];
    const names = ["luma_curve", "red_curve", "green_curve", "blue_curve"];
    const signatures = names.map((name) => JSON.stringify(branch[name]));
    const packedKey = `${cacheNamespace}:packed`;
    const packedSignature = signatures.join("|");
    const packedCached = sampleCache.get(packedKey);
    if (packedCached?.signature === packedSignature) return packedCached.samples;
    const packed = new Float32Array(CURVE_SAMPLES * 4);
    names.forEach((name, channel) => {
      const signature = signatures[channel];
      const cacheKey = `${cacheNamespace}:${name}`;
      let cached = sampleCache.get(cacheKey);
      if (!cached || cached.signature !== signature) {
        cached = { signature, samples: curveSampler(branch[name], CURVE_SAMPLES) };
        sampleCache.set(cacheKey, cached);
      }
      const samples = cached.samples;
      for (let index = 0; index < CURVE_SAMPLES; index += 1) {
        const sample = samples[index];
        packed[channel * CURVE_SAMPLES + index] = Array.isArray(sample) ? sample[1] : sample;
      }
    });
    sampleCache.set(packedKey, { signature: packedSignature, samples: packed });
    return packed;
  }

  function gpuLocalSupported(grade) {
    return Boolean(grade);
  }

  function activeGpuLocals(lane, localAdjustments) {
    return (Array.isArray(localAdjustments) ? localAdjustments : []).filter((local) =>
      local?.enabled !== false
      && Number(local?.opacity) > 0
      && local?.[`${lane}_grade`]?.enabled !== false);
  }

  function gpuLocalDetailActive(grade) {
    return graphScaleContract().localDetailActive(grade);
  }

  function buildLocalParams(local, lane, sourcePixelScale = 1, curveOffset = 0) {
    const grade = local[`${lane}_grade`];
    const detail = grade.detail || {};
    const values = new Float32Array(PARAM_COUNT);
    values[0] = lane === "hdr" ? 1 : 0;
    values[1] = Number(local.opacity) || 0;
    values[2] = Number(grade.exposure) || 0;
    values[3] = Number(grade.highlights) || 0;
    values[4] = Number(grade.midtones) || 0;
    values[5] = Number(grade.shadows) || 0;
    values[6] = Number(grade.blacks) || 0;
    values[7] = Number(grade.contrast) || 0;
    values[8] = Math.max(0.001, Number(grade.contrast_pivot) || 0.18);
    values[9] = Number(grade.white_balance_kelvin) || 6500;
    values[10] = Number(grade.tint) || 0;
    values[11] = Number(grade.saturation) || 0;
    values[12] = Number(grade.vibrance) || 0;
    values[13] = gpuMaskInfluenceOpacity(local.mask);
    values[14] = (Number(detail.texture_amount) || 0) / 100;
    values[15] = (Number(detail.clarity_amount) || 0) / 125;
    values[16] = Math.min(3, Math.max(0.2, Number(detail.clarity_radius_percent) || 0.75));
    values[17] = Math.min(2, Math.max(0, (Number(detail.sharpen_amount) || 0) / 100));
    values[18] = Math.min(3, Math.max(0.3, Number(detail.sharpen_radius_px) || 0.8));
    values[19] = Math.min(1, Math.max(0, (Number(detail.sharpen_threshold) || 0) / 100)) * 0.5;
    values[20] = Math.min(1, Math.max(0.05, Number(sourcePixelScale) || 1));
    ['luma_curve','red_curve','green_curve','blue_curve'].forEach((name,index)=>{
      if (!curvePointsNeutral(grade[name])) values[21] += 1 << index;
    });
    values[22] = curveOffset;
    const grading = grade.color_grading || {};
    values[111] = 1;
    values[112] = 0.55 + 3.45 * (grading.blending ?? 50) / 100;
    values[113] = (grading.balance || 0) / 50;
    [grading.shadows || {},grading.midtones || {},grading.highlights || {}].forEach((wheel,index)=>{
      values[114+index*3] = wheel.hue || 0;
      values[115+index*3] = (wheel.saturation || 0)/400;
      values[116+index*3] = wheel.luminance_ev || 0;
    });
    return values;
  }

  function softMaskIdentity(sessionId, geometrySignature, maskSignature) {
    return `${sessionId}:${geometrySignature}:${maskSignature}`;
  }

  /**
   * State where a pass's mask texture sits in the frame. A soft mask's small
   * bitmap and a whole-frame mask need it; a tile's own mask texture has one
   * texel per pixel of the pass, which the zero rectangle means.
   */
  function writeMaskRect(values, offset, entry, frameWidth, frameHeight) {
    // A whole-frame mask bound to a tile's pass is placed the same way, at
    // one texel per pixel.
    const stretched = Boolean(entry?.wholeFrame)
      || (Boolean(entry?.soft) && (entry.width !== frameWidth || entry.height !== frameHeight));
    const rect = stretched && Array.isArray(entry.frameRect) && entry.frameRect.length === 4
      && entry.frameRect.every(Number.isFinite) && entry.frameRect[2] > 0 && entry.frameRect[3] > 0
      ? entry.frameRect : [0, 0, 1, 1];
    values[offset + MASK_RECT_INDEX] = stretched ? rect[0] * frameWidth : 0;
    values[offset + MASK_RECT_INDEX + 1] = stretched ? rect[1] * frameHeight : 0;
    values[offset + MASK_RECT_INDEX + 2] = stretched ? rect[2] * frameWidth : 0;
    values[offset + MASK_RECT_INDEX + 3] = stretched ? rect[3] * frameHeight : 0;
    return stretched;
  }

  function gpuMaskInfluenceOpacity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return 1;
    return Math.min(1, Math.max(0, Number(expression.leaf.mask_opacity ?? 1)));
  }

  function gpuMaskIdentity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return JSON.stringify(gpuMaskRenderPayload(expression));
    return JSON.stringify({
      ...gpuMaskRenderPayload(expression),
      leaf: { ...expression.leaf, mask_opacity: 1 },
    });
  }

  function spatialLeafExpression(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return expression;
    return { ...expression, leaf: { ...expression.leaf, mask_opacity: 1 } };
  }

  /** Key-order independent spatial identity, comparable with a backend document. */
  function spatialMaskSignature(expression) {
    return JSON.stringify(gpuMaskRenderPayload(spatialLeafExpression(expression)) ?? null, (key, entry) => (
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map((name) => [name, entry[name]]))
        : entry
    ));
  }

  function gpuMaskRenderPayload(expression) {
    if (!expression) return expression;
    const { id, children, ...payload } = expression;
    return {
      ...payload,
      children: (children || []).map(gpuMaskRenderPayload),
    };
  }

  function maskUsesLuminance(expression) {
    if (!expression) return false;
    if (expression.operator === "leaf") return expression.leaf?.type === "luminance_range";
    return (expression.children || []).some(maskUsesLuminance);
  }

  function gpuLumaLeaves(expression) {
    if (!expression || expression.enabled === false) return [];
    if (isGpuLumaMask(expression)) return [expression.leaf];
    return (expression.children || []).flatMap(gpuLumaLeaves);
  }

  function gpuRegionalGraphEligible(expression, geometrySignature) {
    if (!expression || expression.enabled === false || expression.operator === "leaf") return false;
    // Index crops change placement, not leaf raster eligibility. The region
    // loader separately verifies the rounded uncropped frame and crop bounds.
    let geometry;
    try { geometry = JSON.parse(geometrySignature); } catch { return false; }
    const leafGeometry = JSON.stringify({...geometry, crop:{x:0,y:0,width:1,height:1}});
    const children = (expression.children || []).filter(child => child.enabled !== false);
    // A proper combination has at least two operands. Degenerate/disabled
    // graphs retain the established path and its opacity/inversion contract.
    return children.length >= 2 && children.every(child => child.operator === "leaf"
      ? isGpuLumaMask(child) || window.HDRMaskRaster?.eligible(child, leafGeometry)
        || isGpuLinearGradientMask(child, leafGeometry)
      : gpuRegionalGraphEligible(child, geometrySignature));
  }

  /**
   * Whether a lane's source is the scene picture a luma mask qualifies.
   *
   * Export always reads ACEScg scene luminance. The HDR lane's source is that
   * picture; so is the SDR lane's unless Match or an authored SDR base
   * replaces it, which the backend states as a different working space.
   */
  function lumaSceneSource(lane, sourceIdentity, workingSpace) {
    return (sourceIdentity || "source") === "source"
      && (lane === "hdr" || (lane === "sdr" && workingSpace === "acescg"));
  }

  function isGpuLumaMask(expression) {
    return expression?.operator === "leaf"
      && expression.leaf?.type === "luminance_range"
      && (!expression.children || expression.children.length === 0);
  }

  function buildGpuLinearGradientParams(expression, rect, width, height, geometrySignature) {
    const geometry = JSON.parse(geometrySignature), rotation = Number(geometry.rotation || 0) / 90;
    const leaf = expression.leaf;
    return new Float32Array([
      Number(leaf.start.x), Number(leaf.start.y), Number(leaf.end.x), Number(leaf.end.y),
      Number(leaf.gradient_midpoint_1), Number(leaf.gradient_midpoint_2), rect.x, rect.y,
      rotation % 2 ? height : width, rotation % 2 ? width : height,
      expression.inverted ? 1 : 0, expression.enabled === false ? 0 : 1,
      rotation + (geometry.flip_horizontal ? 4 : 0) + (geometry.flip_vertical ? 8 : 0),
      Number(leaf.gradient_fan || 0),
    ]);
  }

  function isGpuLinearGradientMask(expression, geometrySignature) {
    if (expression?.operator !== "leaf" || expression.leaf?.type !== "linear_gradient"
      || expression.children?.length || expression.leaf.gradient_luma_enabled
      || !(Number(expression.leaf.gradient_midpoint_1) > 0)
      || !(Number(expression.leaf.gradient_midpoint_2) > Number(expression.leaf.gradient_midpoint_1))
      || !(Number(expression.leaf.gradient_midpoint_2) < 1)) return false;
    let geometry;
    try { geometry = JSON.parse(geometrySignature); } catch (_) { return false; }
    const crop = geometry?.crop || {};
    return [0, 90, 180, 270].includes(Number(geometry.rotation || 0))
      && Number(geometry.straighten_angle || 0) === 0
      && Number(geometry.perspective_horizontal || 0) === 0
      && Number(geometry.perspective_vertical || 0) === 0
      && Number(geometry.perspective_rotate || 0) === 0
      && Number(crop.x ?? 0) === 0 && Number(crop.y ?? 0) === 0
      && Number(crop.width ?? 1) === 1 && Number(crop.height ?? 1) === 1;
  }

  function gpuLumaBaseIdentity(expression) {
    if (!isGpuLumaMask(expression)) return JSON.stringify(gpuMaskRenderPayload(expression));
    return JSON.stringify({
      ...gpuMaskRenderPayload(expression),
      inverted: false,
      leaf: {
        ...expression.leaf,
        mask_feather: 0,
        mask_opacity: 1,
      },
    });
  }

  /**
   * The luma feather's Gaussian, in pixels of a mask `width` x `height`.
   *
   * Feather is a distance: 0.09 of the uncropped source's long edge at 100%,
   * the same in both directions. `referenceScale` is that long edge over the
   * mask's own (cropped, straightened) long edge, so cropping never changes
   * how soft a mask is, and the preview matches the export. It used to be
   * 0.09 of each side of the cropped frame, which on a 3:2 image spread the
   * feather 1.5 times further sideways than up and down, and halved it under
   * a 50% crop. Above 8 px the
   * blur runs on a copy area-averaged by `factor`, with `reducedSigma` chosen so
   * the averaging and the bilinear upsample (together about a quarter of a
   * reduced texel squared) add up to the requested spread.
   */
  function lumaFeatherPlan(feather, width, height, referenceScale = 1) {
    const amount = Math.min(1, Math.max(0, Number(feather) || 0) / 0.05);
    const sigma = 0.09 * amount * Math.max(width, height) * referenceScale;
    if (sigma < 8) return { sigma, factor: 1, reducedSigma: sigma };
    const factor = Math.floor(sigma / 4);
    return { sigma, factor, reducedSigma: Math.sqrt(Math.max(0.0625, (sigma * sigma) / (factor * factor) - 0.25)) };
  }

  // The feather plan of a mask a measurement patch can make from its own
  // pixels: a plain luminance leaf whose feather is filtered at full size. A
  // wider feather is blurred on a grid anchored to the frame and keeps the
  // reduced bitmap, which such a blur leaves close to the truth anyway.
  function analysisLumaPlan(expression, width, height, referenceScale = 1) {
    if (!isGpuLumaMask(expression) || expression.enabled === false) return null;
    const feather = Math.min(0.05, Math.max(0, Number(expression.leaf.mask_feather) || 0));
    const plan = lumaFeatherPlan(feather, width, height, referenceScale);
    return plan.factor === 1 ? plan : null;
  }

  function lumaFeatherReach(plan) {
    // Six boxes have finite support wider than the former three-sigma
    // Gaussian truncation. Include the reduced-grid interpolation footprint.
    return lumaBoxRadii(plan.sigma).reduce((sum,radius)=>sum+radius,0) + 2 * plan.factor;
  }

  function lumaBoxRadii(sigma) {
    let lower=Math.max(1,Math.floor(Math.sqrt(2*sigma*sigma+1)));
    if(!(lower%2))lower=Math.max(1,lower-1);
    const count=Math.max(0,Math.min(6,lumaEvenRound((12*sigma*sigma-6*lower*lower-24*lower-18)/(-4*lower-4))));
    return Array.from({length:6},(_,i)=>(lower+(i<count?0:2)-1)/2);
  }

  function lumaEvenRound(value) {
    const lower=Math.floor(value),fraction=value-lower;
    return fraction===.5 ? lower+(lower%2) : Math.round(value);
  }

  // Export uses six discrete boxes rather than an ideal Gaussian. Build its
  // exact one-dimensional impulse response in linear time, then sample that
  // response on the existing reduced grid with the grid's variance removed.
  // This preserves the same bounded textures and halo/grid contract.
  function lumaBlurParams(plan,axis,inverted) {
    const sigma=Math.min(2048,plan.sigma),round=lumaEvenRound;
    let lower=Math.max(1,Math.floor(Math.sqrt(2*sigma*sigma+1)));
    if(!(lower%2))lower=Math.max(1,lower-1);
    const count=Math.max(0,Math.min(6,round((12*sigma*sigma-6*lower*lower-24*lower-18)/(-4*lower-4))));
    let kernel=new Float64Array([1]),variance=0;
    for(let pass=0;pass<6;pass++){
      const width=lower+(pass<count?0:2),radius=(width-1)/2;
      variance+=(width*width-1)/12;
      const next=new Float64Array(kernel.length+2*radius);
      let sum=0;
      for(let i=0;i<next.length;i++){
        if(i<kernel.length)sum+=kernel[i];
        if(i>=width&&i-width<kernel.length)sum-=kernel[i-width];
        next[i]=sum/width;
      }
      kernel=next;
    }
    const factor=plan.factor,center=(kernel.length-1)/2;
    const spread=factor===1?1:Math.sqrt(Math.max(.01,variance-factor*factor*.25)/Math.max(variance,1e-9));
    const pitch=factor/spread,reach=Math.min(255,Math.ceil(center/pitch)),weights=[];
    for(let i=0;i<=reach;i++){
      const at=center+i*pitch,left=Math.floor(at),fraction=at-left;
      weights.push((kernel[left]||0)*(1-fraction)+(kernel[left+1]||0)*fraction);
    }
    const total=weights[0]+2*weights.slice(1).reduce((sum,w)=>sum+w,0);
    return new Float32Array([sigma,reach+1,axis,inverted?1:0,...weights.map(w=>w/total)]);
  }

  function buildGpuLumaQualificationParams(expression) {
    const leaf = expression.leaf;
    return new Float32Array([
      Number(leaf.fade_in_start_ev),
      Number(leaf.full_start_ev),
      Number(leaf.full_end_ev),
      Number(leaf.fade_out_end_ev),
    ]);
  }

  function gpuMaskGraphLayoutIdentity(expression) {
    if (expression?.operator === "leaf") return `leaf:${expression.leaf?.type || "unknown"}`;
    if (expression?.enabled === false) return gpuMaskGraphLayoutIdentity(expression?.children?.[0]);
    const children = (expression?.children || []).filter((child) => child.enabled !== false);
    return children.length === 1
      ? gpuMaskGraphLayoutIdentity(children[0])
      : `node(${children.map(gpuMaskGraphLayoutIdentity).join(",")})`;
  }

  function gpuMaskGraphPassCount(expression) {
    if (expression?.operator === "leaf") return 0;
    if (expression?.enabled === false) return gpuMaskGraphPassCount(expression?.children?.[0]);
    const children = (expression?.children || []).filter((child) => child.enabled !== false);
    return Math.max(0, children.length - 1)
      + children.reduce((total, child) => total + gpuMaskGraphPassCount(child), 0);
  }

  function firstResolvedMaskLeaf(node) {
    if (node.leafEntry) return node.leafEntry;
    for (const child of node.children || []) {
      const leaf = firstResolvedMaskLeaf(child);
      if (leaf) return leaf;
    }
    return null;
  }

  function gpuMaskOperatorCode(operator) {
    if (operator === "intersect") return 1;
    if (operator === "subtract") return 2;
    return 0;
  }

