(function () {
  "use strict";

  // One position list for global render parameters. Reserved entries stay in
  // place so naming cannot move any value sent to a shader. Local and mask
  // pass layouts below share this same source of named positions.
  const fields = Object.freeze([
    Object.freeze({ name: "HDR_LANE", index: 0 }),
    Object.freeze({ name: "SOURCE_LINEAR_SRGB", index: 1 }),
    Object.freeze({ name: "EXPOSURE", index: 2 }),
    Object.freeze({ name: "HIGHLIGHT_SOFTNESS", index: 3 }),
    Object.freeze({ name: "SHADOW_LIFT", index: 4 }),
    Object.freeze({ name: "LIFT", index: 5 }),
    Object.freeze({ name: "GAMMA", index: 6 }),
    Object.freeze({ name: "GAIN", index: 7 }),
    Object.freeze({ name: "CONTRAST", index: 8 }),
    Object.freeze({ name: "CONTRAST_PIVOT", index: 9 }),
    Object.freeze({ name: "WHITE_BALANCE_KELVIN", index: 10 }),
    Object.freeze({ name: "TINT", index: 11 }),
    Object.freeze({ name: "VIGNETTE_SCALE_X", index: 12 }),
    Object.freeze({ name: "VIGNETTE_SCALE_Y", index: 13 }),
    Object.freeze({ name: "RESERVED_DENOISE_DETAIL", index: 14, reserved: true }),
    Object.freeze({ name: "CURVES_ENABLED", index: 15 }),
    Object.freeze({ name: "HDR_SURFACE", index: 16 }),
    Object.freeze({ name: "HDR_DISPLAY_HEADROOM", index: 17 }),
    Object.freeze({ name: "TONE_EQUALIZER_ENABLED", index: 18 }),
    Object.freeze({ name: "TONE_EQUALIZER_SMOOTHING", index: 19 }),
    Object.freeze({ name: "TONE_EQUALIZER_NODE_COUNT", index: 20 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_0", index: 21 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_1", index: 22 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_2", index: 23 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_3", index: 24 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_4", index: 25 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_5", index: 26 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_6", index: 27 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_7", index: 28 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_8", index: 29 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_9", index: 30 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_10", index: 31 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_11", index: 32 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_12", index: 33 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_13", index: 34 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_14", index: 35 }),
    Object.freeze({ name: "TONE_EQUALIZER_INPUT_EV_15", index: 36 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_0", index: 37 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_1", index: 38 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_2", index: 39 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_3", index: 40 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_4", index: 41 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_5", index: 42 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_6", index: 43 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_7", index: 44 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_8", index: 45 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_9", index: 46 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_10", index: 47 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_11", index: 48 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_12", index: 49 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_13", index: 50 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_14", index: 51 }),
    Object.freeze({ name: "TONE_EQUALIZER_ADJUSTMENT_EV_15", index: 52 }),
    Object.freeze({ name: "HIGHLIGHT_START", index: 53 }),
    Object.freeze({ name: "LIFT_PIVOT", index: 54 }),
    Object.freeze({ name: "LIFT_RANGE", index: 55 }),
    Object.freeze({ name: "GAMMA_PIVOT", index: 56 }),
    Object.freeze({ name: "GAMMA_RANGE", index: 57 }),
    Object.freeze({ name: "GAIN_PIVOT", index: 58 }),
    Object.freeze({ name: "GAIN_RANGE", index: 59 }),
    Object.freeze({ name: "RESERVED_60", index: 60, reserved: true }),
    Object.freeze({ name: "PRIMARIES_MATRIX_00", index: 61 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_01", index: 62 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_02", index: 63 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_10", index: 64 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_11", index: 65 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_12", index: 66 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_20", index: 67 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_21", index: 68 }),
    Object.freeze({ name: "PRIMARIES_MATRIX_22", index: 69 }),
    Object.freeze({ name: "SATURATION", index: 70 }),
    Object.freeze({ name: "VIBRANCE", index: 71 }),
    Object.freeze({ name: "COLOR_ENABLED", index: 72 }),
    Object.freeze({ name: "HIGHLIGHT_TARGET", index: 73 }),
    Object.freeze({ name: "HIGHLIGHT_MODE", index: 74 }),
    Object.freeze({ name: "HIGHLIGHT_ANCHOR", index: 75 }),
    Object.freeze({ name: "HIGHLIGHT_PEAK_DETAIL", index: 76 }),
    Object.freeze({ name: "HIGHLIGHT_BIAS", index: 77 }),
    Object.freeze({ name: "FILM_RESPONSE_ENABLED", index: 78 }),
    Object.freeze({ name: "FILM_LOOK_STRENGTH", index: 79 }),
    Object.freeze({ name: "FILM_PRINT_STRENGTH", index: 80 }),
    Object.freeze({ name: "FILM_PRINT_CONTRAST", index: 81 }),
    Object.freeze({ name: "FILM_PRINT_TOE", index: 82 }),
    Object.freeze({ name: "FILM_PRINT_SHOULDER", index: 83 }),
    Object.freeze({ name: "FILM_COLOR_DENSITY", index: 84 }),
    Object.freeze({ name: "HALATION_ENABLED", index: 85 }),
    Object.freeze({ name: "HALATION_AMOUNT", index: 86 }),
    Object.freeze({ name: "HALATION_SENSITIVITY", index: 87 }),
    Object.freeze({ name: "HALATION_RADIUS", index: 88 }),
    Object.freeze({ name: "HALATION_HUE", index: 89 }),
    Object.freeze({ name: "HALATION_SATURATION", index: 90 }),
    Object.freeze({ name: "HALATION_VIEW_MAP", index: 91 }),
    Object.freeze({ name: "BLOOM_ENABLED", index: 92 }),
    Object.freeze({ name: "BLOOM_AMOUNT", index: 93 }),
    Object.freeze({ name: "BLOOM_SENSITIVITY", index: 94 }),
    Object.freeze({ name: "BLOOM_RADIUS", index: 95 }),
    Object.freeze({ name: "BLOOM_HIGHLIGHT_DETAIL", index: 96 }),
    Object.freeze({ name: "STRUCTURE_ENABLED", index: 97 }),
    Object.freeze({ name: "STRUCTURE_SOFTNESS", index: 98 }),
    Object.freeze({ name: "STRUCTURE_MICROCONTRAST", index: 99 }),
    Object.freeze({ name: "GRAIN_ENABLED", index: 100 }),
    Object.freeze({ name: "GRAIN_AMOUNT", index: 101 }),
    Object.freeze({ name: "GRAIN_SIZE", index: 102 }),
    Object.freeze({ name: "GRAIN_SOFTNESS", index: 103 }),
    Object.freeze({ name: "GRAIN_CHROMA", index: 104 }),
    Object.freeze({ name: "GRAIN_SHADOW_RESPONSE", index: 105 }),
    Object.freeze({ name: "GRAIN_MIDTONE_RESPONSE", index: 106 }),
    Object.freeze({ name: "GRAIN_HIGHLIGHT_RESPONSE", index: 107 }),
    Object.freeze({ name: "FILM_RESOLUTION", index: 108 }),
    Object.freeze({ name: "GRAIN_SEED_LOW", index: 109 }),
    Object.freeze({ name: "HIGHLIGHT_COLOR_HANDLING", index: 110 }),
    Object.freeze({ name: "COLOR_GRADING_ENABLED", index: 111 }),
    Object.freeze({ name: "COLOR_GRADING_BLENDING", index: 112 }),
    Object.freeze({ name: "COLOR_GRADING_BALANCE", index: 113 }),
    Object.freeze({ name: "COLOR_GRADING_SHADOW_HUE", index: 114 }),
    Object.freeze({ name: "COLOR_GRADING_SHADOW_SATURATION", index: 115 }),
    Object.freeze({ name: "COLOR_GRADING_SHADOW_LUMINANCE_EV", index: 116 }),
    Object.freeze({ name: "COLOR_GRADING_MIDTONE_HUE", index: 117 }),
    Object.freeze({ name: "COLOR_GRADING_MIDTONE_SATURATION", index: 118 }),
    Object.freeze({ name: "COLOR_GRADING_MIDTONE_LUMINANCE_EV", index: 119 }),
    Object.freeze({ name: "COLOR_GRADING_HIGHLIGHT_HUE", index: 120 }),
    Object.freeze({ name: "COLOR_GRADING_HIGHLIGHT_SATURATION", index: 121 }),
    Object.freeze({ name: "COLOR_GRADING_HIGHLIGHT_LUMINANCE_EV", index: 122 }),
    Object.freeze({ name: "VIGNETTE_ENABLED", index: 123 }),
    Object.freeze({ name: "VIGNETTE_AMOUNT", index: 124 }),
    Object.freeze({ name: "VIGNETTE_MIDPOINT", index: 125 }),
    Object.freeze({ name: "VIGNETTE_ROUNDNESS", index: 126 }),
    Object.freeze({ name: "VIGNETTE_FEATHER", index: 127 }),
    Object.freeze({ name: "VIGNETTE_HIGHLIGHT_PROTECTION", index: 128 }),
    Object.freeze({ name: "VIGNETTE_CENTER_X", index: 129 }),
    Object.freeze({ name: "VIGNETTE_CENTER_Y", index: 130 }),
    Object.freeze({ name: "OVERLAY_ENABLED", index: 131 }),
    Object.freeze({ name: "OVERLAY_OPACITY", index: 132 }),
    Object.freeze({ name: "OVERLAY_RED", index: 133 }),
    Object.freeze({ name: "OVERLAY_GREEN", index: 134 }),
    Object.freeze({ name: "OVERLAY_BLUE", index: 135 }),
    Object.freeze({ name: "SCOPE_WIDTH", index: 136 }),
    Object.freeze({ name: "SCOPE_HEIGHT", index: 137 }),
    Object.freeze({ name: "PROJECT_REFERENCE_WHITE_NITS", index: 138 }),
    Object.freeze({ name: "FILM_REFERENCE_WHITE_NITS", index: 139 }),
    Object.freeze({ name: "FILM_GATE_WIDTH_MM", index: 140 }),
    Object.freeze({ name: "FILM_GATE_HEIGHT_MM", index: 141 }),
    Object.freeze({ name: "FILM_GATE_AXIS", index: 142 }),
    Object.freeze({ name: "FILM_RED_RESPONSE", index: 143 }),
    Object.freeze({ name: "FILM_GREEN_RESPONSE", index: 144 }),
    Object.freeze({ name: "FILM_BLUE_RESPONSE", index: 145 }),
    Object.freeze({ name: "FILM_HIGHLIGHT_DESATURATION", index: 146 }),
    Object.freeze({ name: "FILM_SHADOW_DESATURATION", index: 147 }),
    Object.freeze({ name: "DETAIL_ENABLED", index: 148, hostOnly: true }),
    Object.freeze({ name: "TEXTURE_AMOUNT", index: 149 }),
    Object.freeze({ name: "CLARITY_AMOUNT", index: 150 }),
    Object.freeze({ name: "CLARITY_RADIUS", index: 151 }),
    Object.freeze({ name: "SHARPEN_AMOUNT", index: 152 }),
    Object.freeze({ name: "SHARPEN_RADIUS", index: 153 }),
    Object.freeze({ name: "SHARPEN_THRESHOLD", index: 154 }),
    Object.freeze({ name: "SOURCE_PIXEL_SCALE", index: 155 }),
    Object.freeze({ name: "FILM_LOOK_ENABLED", index: 156 }),
    Object.freeze({ name: "FILM_FINISH_STRENGTH", index: 157 }),
    Object.freeze({ name: "GRAIN_VIEW_MAP", index: 158 }),
    Object.freeze({ name: "SDR_PEAK_LANE", index: 159 }),
    Object.freeze({ name: "TILE_ORIGIN_X", index: 160 }),
    Object.freeze({ name: "TILE_ORIGIN_Y", index: 161 }),
    Object.freeze({ name: "TILE_VALID_WIDTH", index: 162 }),
    Object.freeze({ name: "TILE_VALID_HEIGHT", index: 163 }),
    Object.freeze({ name: "FRAME_WIDTH", index: 164 }),
    Object.freeze({ name: "FRAME_HEIGHT", index: 165 }),
    Object.freeze({ name: "NOISE_VIEW", index: 166 }),
    Object.freeze({ name: "CLARITY_MAP_SCALE", index: 167 }),
    Object.freeze({ name: "CLARITY_MAP_SIGMA", index: 168 }),
    Object.freeze({ name: "CLARITY_MAP_TAPS", index: 169 }),
    Object.freeze({ name: "CLARITY_MAP_ORIGIN_X", index: 170 }),
    Object.freeze({ name: "CLARITY_MAP_ORIGIN_Y", index: 171 }),
    Object.freeze({ name: "CLARITY_BASE_SCALE", index: 172 }),
    Object.freeze({ name: "CLARITY_BASE_ORIGIN_X", index: 173 }),
    Object.freeze({ name: "CLARITY_BASE_ORIGIN_Y", index: 174 }),
    Object.freeze({ name: "GRAIN_FILM_TYPE", index: 175 }),
    Object.freeze({ name: "GRAIN_SEED_HIGH", index: 176 }),
    Object.freeze({ name: "BLACK_AND_WHITE_ENABLED", index: 177 }),
    Object.freeze({ name: "BLACK_AND_WHITE_REDS", index: 178 }),
    Object.freeze({ name: "BLACK_AND_WHITE_ORANGES", index: 179 }),
    Object.freeze({ name: "BLACK_AND_WHITE_YELLOWS", index: 180 }),
    Object.freeze({ name: "BLACK_AND_WHITE_GREENS", index: 181 }),
    Object.freeze({ name: "BLACK_AND_WHITE_AQUAS", index: 182 }),
    Object.freeze({ name: "BLACK_AND_WHITE_BLUES", index: 183 }),
    Object.freeze({ name: "BLACK_AND_WHITE_PURPLES", index: 184 }),
    Object.freeze({ name: "BLACK_AND_WHITE_MAGENTAS", index: 185 }),
    Object.freeze({ name: "MASK_RECT_X", index: 186 }),
    Object.freeze({ name: "MASK_RECT_Y", index: 187 }),
    Object.freeze({ name: "MASK_RECT_WIDTH", index: 188 }),
    Object.freeze({ name: "MASK_RECT_HEIGHT", index: 189 }),
  ]);

  const indices = Object.freeze(Object.fromEntries(fields.map(({ name, index }) => [name, index])));
  const HDRGpuParamLayout = Object.freeze({ fields, indices, count: fields.length });

  if (typeof window !== "undefined") window.HDRGpuParamLayout = HDRGpuParamLayout;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRGpuParamLayout };

  // Independent pass records. Variable-length masks concatenate the named
  // headers/records below; their counts also define each stride and tail.
  function define(fields) {
    fields = Object.freeze(fields.map(Object.freeze));
    const indices = Object.freeze(Object.fromEntries(fields.map(({name,index}) => [name,index])));
    return Object.freeze({fields, indices, count: fields.length});
  }
  const layouts = Object.freeze({
    LOCAL: define([
      { name: "HDR_LANE", index: 0 },
      { name: "OPACITY", index: 1 },
      { name: "EXPOSURE", index: 2 },
      { name: "HIGHLIGHTS", index: 3 },
      { name: "MIDTONES", index: 4 },
      { name: "SHADOWS", index: 5 },
      { name: "BLACKS", index: 6 },
      { name: "CONTRAST", index: 7 },
      { name: "CONTRAST_PIVOT", index: 8 },
      { name: "WHITE_BALANCE_KELVIN", index: 9 },
      { name: "TINT", index: 10 },
      { name: "SATURATION", index: 11 },
      { name: "VIBRANCE", index: 12 },
      { name: "MASK_OPACITY", index: 13 },
      { name: "TEXTURE_AMOUNT", index: 14 },
      { name: "CLARITY_AMOUNT", index: 15 },
      { name: "CLARITY_RADIUS", index: 16 },
      { name: "SHARPEN_AMOUNT", index: 17 },
      { name: "SHARPEN_RADIUS", index: 18 },
      { name: "SHARPEN_THRESHOLD", index: 19 },
      { name: "SOURCE_PIXEL_SCALE", index: 20 },
      { name: "CURVE_FLAGS", index: 21 },
      { name: "CURVE_OFFSET", index: 22 }
    ]),
    GRADIENT: define([
      { name: "START_X", index: 0 },
      { name: "START_Y", index: 1 },
      { name: "END_X", index: 2 },
      { name: "END_Y", index: 3 },
      { name: "MIDPOINT_1", index: 4 },
      { name: "MIDPOINT_2", index: 5 },
      { name: "ORIGIN_X", index: 6 },
      { name: "ORIGIN_Y", index: 7 },
      { name: "SOURCE_WIDTH", index: 8 },
      { name: "SOURCE_HEIGHT", index: 9 },
      { name: "INVERT", index: 10 },
      { name: "ENABLED", index: 11 },
      { name: "TRANSFORM", index: 12 },
      { name: "FAN", index: 13 }
    ]),
    RASTER: define([
      { name: "KIND", index: 0 },
      { name: "ORIGIN_X", index: 1 },
      { name: "ORIGIN_Y", index: 2 },
      { name: "SOURCE_WIDTH", index: 3 },
      { name: "SOURCE_HEIGHT", index: 4 },
      { name: "INVERT", index: 5 },
      { name: "ENABLED", index: 6 },
      { name: "ITEM_COUNT", index: 7 },
      { name: "FEATHER", index: 8 },
      { name: "TRANSFORM", index: 9 }
    ]),
    PATH_POINT: define([
      { name: "X", index: 0 },
      { name: "Y", index: 1 }
    ]),
    PATH_WIDTH: define([
      { name: "WIDTH_START", index: 0 },
      { name: "WIDTH_END", index: 1 }
    ]),
    PATH_OUTER: define([
      { name: "SOFTNESS", index: 0 }
    ]),
    STROKE: define([
      { name: "SEGMENT_COUNT", index: 0 },
      { name: "HARDNESS", index: 1 },
      { name: "FLOW", index: 2 },
      { name: "OPACITY", index: 3 },
      { name: "ERASE", index: 4 },
      { name: "LEFT", index: 5 },
      { name: "TOP", index: 6 },
      { name: "RIGHT", index: 7 },
      { name: "BOTTOM", index: 8 },
      { name: "RESERVED", index: 9, reserved: true }
    ]),
    SEGMENT: define([
      { name: "START_X", index: 0 },
      { name: "START_Y", index: 1 },
      { name: "END_X", index: 2 },
      { name: "END_Y", index: 3 },
      { name: "RADIUS", index: 4 }
    ]),
    REGIONAL_ERASE: define([
      { name: "FRAME_WIDTH", index: 0 },
      { name: "FRAME_HEIGHT", index: 1 },
      { name: "ORIGIN_X", index: 2 },
      { name: "ORIGIN_Y", index: 3 },
      { name: "RECT_X", index: 4 },
      { name: "RECT_Y", index: 5 },
      { name: "RECT_WIDTH", index: 6 },
      { name: "RECT_HEIGHT", index: 7 }
    ]),
    NATIVE_BRUSH: define([
      { name: "ORIGIN_X", index: 0 },
      { name: "ORIGIN_Y", index: 1 },
      { name: "SCALE_Y", index: 2 },
      { name: "SCALE_Y_LOW", index: 3 }
    ]),
    LUMA: define([
      { name: "FADE_IN_START", index: 0 },
      { name: "FULL_START", index: 1 },
      { name: "FULL_END", index: 2 },
      { name: "FADE_OUT_END", index: 3 }
    ]),
    FEATHER: define([
      { name: "SIGMA", index: 0 },
      { name: "TAP_COUNT", index: 1 },
      { name: "AXIS", index: 2 },
      { name: "INVERT", index: 3 }
    ]),
    FEATHER_WEIGHT: define([
      { name: "WEIGHT", index: 0 }
    ]),
    DOWNSAMPLE: define([
      { name: "FACTOR", index: 0 },
      { name: "AXIS", index: 1 },
      { name: "RESERVED_2", index: 2, reserved: true },
      { name: "RESERVED_3", index: 3, reserved: true }
    ]),
    UPSAMPLE: define([
      { name: "FACTOR", index: 0 },
      { name: "INVERT", index: 1 },
      { name: "RESERVED_2", index: 2, reserved: true },
      { name: "RESERVED_3", index: 3, reserved: true }
    ]),
    COMBINE: define([
      { name: "OPERATOR", index: 0 },
      { name: "LEFT_OPACITY", index: 1 },
      { name: "RIGHT_OPACITY", index: 2 },
      { name: "INVERT", index: 3 }
    ]),
    COARSE: define([
      { name: "FACTOR", index: 0 }
    ]),
    FRACTIONAL: define([
      { name: "FACTOR", index: 0 },
      { name: "AXIS", index: 1 },
      { name: "FRAME_WIDTH", index: 2 },
      { name: "FRAME_HEIGHT", index: 3 },
      { name: "HALF_WIDTH", index: 4 }
    ]),
    EXPAND: define([
      { name: "FACTOR", index: 0 },
      { name: "FRAME_WIDTH", index: 1 },
      { name: "FRAME_HEIGHT", index: 2 }
    ]),
    BOX: define([
      { name: "RADIUS", index: 0 },
      { name: "AXIS", index: 1 }
    ]),
    MAXIMUM: define([
      { name: "AXIS", index: 0 }
    ]),
    FINISH: define([
      { name: "INVERT", index: 0 },
      { name: "ENABLED", index: 1 }
    ]),
    SHIFT: define([
      { name: "EDGE", index: 0 },
      { name: "NORMALIZED", index: 1 }
    ]),
    BAND_MAXIMUM: define([
      { name: "TOP", index: 0 },
      { name: "BOTTOM", index: 1 },
      { name: "LEFT", index: 2 },
      { name: "RIGHT", index: 3 }
    ]),
    COARSE_BAND: define([
      { name: "FACTOR", index: 0 },
      { name: "FRAME_WIDTH", index: 1 },
      { name: "FRAME_HEIGHT", index: 2 },
      { name: "ORIGIN_X", index: 3 },
      { name: "ORIGIN_Y", index: 4 }
    ]),
    EXPAND_WINDOW: define([
      { name: "FACTOR", index: 0 },
      { name: "FRAME_WIDTH", index: 1 },
      { name: "FRAME_HEIGHT", index: 2 },
      { name: "ORIGIN_X", index: 3 },
      { name: "ORIGIN_Y", index: 4 }
    ]),
    BRUSH_BOX: define([
      { name: "RADIUS", index: 0 },
      { name: "AXIS", index: 1 },
      { name: "RESERVED_2", index: 2, reserved: true },
      { name: "RESERVED_3", index: 3, reserved: true }
    ]),
    LUMA_BOX: define([
      { name: "AXIS", index: 0 },
      { name: "RADIUS", index: 1 },
      { name: "RESERVED_2", index: 2, reserved: true },
      { name: "RESERVED_3", index: 3, reserved: true }
    ]),
    RESAMPLE: define([
      { name: "MATRIX_00", index: 0 },
      { name: "MATRIX_01", index: 1 },
      { name: "MATRIX_02", index: 2 },
      { name: "MATRIX_10", index: 3 },
      { name: "MATRIX_11", index: 4 },
      { name: "MATRIX_12", index: 5 },
      { name: "MATRIX_20", index: 6 },
      { name: "MATRIX_21", index: 7 },
      { name: "MATRIX_22", index: 8 },
      { name: "MINIMUM", index: 9 },
      { name: "MAXIMUM", index: 10 }
    ]),
    CROP: define([
      { name: "ORIGIN_X", index: 0 },
      { name: "ORIGIN_Y", index: 1 },
      { name: "RESERVED_2", index: 2, reserved: true },
      { name: "RESERVED_3", index: 3, reserved: true }
    ]),
  });
  const passIndices = Object.freeze(Object.fromEntries(Object.entries(layouts).map(([name, layout]) => [name, layout.indices])));
  function record(name, entries) {
    const layout = layouts[name], values = new Array(layout.count).fill(0);
    for (const [field, value] of Object.entries(entries)) {
      if (!Object.hasOwn(layout.indices, field)) throw new Error(`Unknown ${name} parameter ${field}`);
      values[layout.indices[field]] = value;
    }
    return values;
  }
  const offset = (base, index, suffix = "u") => base + (index ? "+" + index + suffix : "");
  const HDRGpuPassLayouts = Object.freeze({layouts, indices: passIndices, record, offset});
  if (typeof window !== "undefined") window.HDRGpuPassLayouts = HDRGpuPassLayouts;
  if (typeof module !== "undefined" && module.exports) module.exports.HDRGpuPassLayouts = HDRGpuPassLayouts;
})();
