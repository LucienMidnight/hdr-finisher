(function () {
  "use strict";
  const PASS_LAYOUTS = ((typeof window !== "undefined" && window.HDRGpuPassLayouts)
    || (typeof module !== "undefined" && module.exports && require("./gpu-param-layout.js").HDRGpuPassLayouts));
  const MASK_PARAMS = PASS_LAYOUTS.indices;

  const GPU_PARAMS = ((typeof window !== "undefined" && window.HDRGpuParamLayout)
    || (typeof module !== "undefined" && module.exports && require("./gpu-param-layout.js").HDRGpuParamLayout)).indices;

  // Film stock slots (film-stocks.js packs them; see gpu-param-layout.js).
  const FILM_STOCK = ((typeof window !== "undefined" && window.HDRFilmStockLayout)
    || (typeof module !== "undefined" && module.exports && require("./gpu-param-layout.js").HDRFilmStockLayout));
  const STOCK = FILM_STOCK.offsets;

  const HSL_WGSL = globalThis.HDRHslShader || require("./hsl-shader.js");
  const PEAK_HISTOGRAM_BINS = 4096;
  const FILM_DETAIL_BLOCK = Object.freeze({ width: 8, height: 32 });
  function toneZonesWgsl(indices, name) {
    return `    fn ${name}(input: vec3f, y: f32) -> vec3f {
      if (p[${indices.BLACKS}] == 0.0 && p[${indices.WHITES}] == 0.0 && p[${indices.SHADOWS}] == 0.0 && p[${indices.MIDTONES}] == 0.0 && p[${indices.HIGHLIGHTS}] == 0.0) { return input; }
      let delivery = select(input, acescgToBt2020(input), p[${indices.HDR_LANE}] > 0.5);
      let brightest = max(max(delivery.r, max(delivery.g, delivery.b)), 0.0);
      let stops = log2(max(y, 1e-30) / p[${indices.TONE_GREY}]);
      let whitePosition = clamp(log2(max(brightest, 1e-30) / (p[${indices.TONE_PEAK}] * 0.5)), 0.0, 1.0);
      let gate = smoothstep(0.0, 1.0, log2(max(y, 1e-30) / (p[${indices.TONE_KNEE}] * 0.5))) * (1.0 - smoothstep(0.0, 1.0, 2.0 * whitePosition));
      let whiteAmount = p[${indices.WHITES}] * select(log2(1.0 / 0.775), 1.0, p[${indices.WHITES}] >= 0.0);
      let delta = gate * (p[${indices.SHADOWS}] * toneZoneWeight(stops, p[${indices.SHADOWS_CENTER}], p[${indices.SHADOWS_WIDTH}])
        + p[${indices.MIDTONES}] * toneZoneWeight(stops, p[${indices.MIDTONES_CENTER}], p[${indices.MIDTONES_WIDTH}])
        + p[${indices.HIGHLIGHTS}] * toneZoneWeight(stops, p[${indices.HIGHLIGHTS_CENTER}], p[${indices.HIGHLIGHTS_WIDTH}])) + whiteAmount * whitePosition * whitePosition;
      let blackWeight = max(1.0 - y / p[${indices.TONE_KNEE}], 0.0);
      let floor = 0.45 * p[${indices.BLACKS}] * p[${indices.TONE_KNEE}] * blackWeight * blackWeight;
      let candidate = input * exp2(delta) + vec3f(floor);
      let result = input + p[${indices.TONE_LIMITER}] * (candidate - input);
      return select(result, max(result, vec3f(0.0)), floor < 0.0);
    }
`;
  }
  function colorDesaturationWgsl(params, name, luma) {
    return `fn ${name}(rgb: vec3f) -> vec3f {
      let high = ${params}[${GPU_PARAMS.HIGHLIGHT_DESATURATION}];
      let low = ${params}[${GPU_PARAMS.SHADOW_DESATURATION}];
      if (high == 0.0 && low == 0.0) { return rgb; }
      let y = ${luma}(rgb);
      let white = select(1.0, 0.18, ${params}[${GPU_PARAMS.HDR_LANE}] > 0.5);
      var start = ${params}[${GPU_PARAMS.HIGHLIGHT_DESATURATION_START}] * white;
      var end = start * 4.0;
      if (${params}[${GPU_PARAMS.HDR_LANE}] < 0.5) { start = min(start, 0.99); end = 1.0; }
      let shadow = ${params}[${GPU_PARAMS.SHADOW_DESATURATION_START}] * white;
      let amount = clamp(high * smoothstep(start, end, y) + low * (1.0 - smoothstep(shadow / 4.0, shadow, y)), 0.0, 1.0);
      return rgb + (vec3f(y) - rgb) * amount;
    }`;
  }

  // BW-01 Black & White, in WGSL for both the render and the peak shaders
  // (each names its parameter array differently). Mirrors
  // `_apply_black_and_white` in adjustments.py: ACEScg luminance, scaled per
  // pixel by up to two stops by the sliders either side of its Oklab hue, in
  // proportion to its relative chroma. p[${GPU_PARAMS.BLACK_AND_WHITE_ENABLED}] switches it on; p[${GPU_PARAMS.BLACK_AND_WHITE_REDS}..185] are
  // Reds..Magentas / 100. Hue, chroma and lightness come from \`guide\`: the
  // mean of a 5x5 lattice of source pixels two apart around the pixel, taken
  // through the same pointwise stages (adjustments.py BW_GUIDE_STEP), so
  // colour noise is not turned into brightness noise.
  const BLACK_AND_WHITE_PARAM = GPU_PARAMS.BLACK_AND_WHITE_ENABLED;
  const BLACK_AND_WHITE_GUIDE_STEP = 2;
  const BLACK_AND_WHITE_GUIDE_TAPS = 2;
  function blackAndWhiteWgsl(params, name) {
    return `
fn ${name}NeedsGuide() -> bool {
  if (${params}[${BLACK_AND_WHITE_PARAM}] < 0.5) { return false; }
  for (var index = 1u; index <= 8u; index = index + 1u) {
    if (${params}[${BLACK_AND_WHITE_PARAM}u + index] != 0.0) { return true; }
  }
  return false;
}
fn ${name}Cbrt(value: f32) -> f32 {
  return select(0.0, sign(value) * pow(abs(value), 1.0 / 3.0), abs(value) > 0.0);
}
fn ${name}(input: vec3f, guide: vec3f) -> vec3f {
  if (${params}[${BLACK_AND_WHITE_PARAM}] < 0.5) { return input; }
  let y = dot(input, vec3f(0.2722287, 0.6740818, 0.0536895));
  var sliders = array<f32, 9>(
    ${params}[${GPU_PARAMS.BLACK_AND_WHITE_REDS}], ${params}[${GPU_PARAMS.BLACK_AND_WHITE_ORANGES}], ${params}[${GPU_PARAMS.BLACK_AND_WHITE_YELLOWS}], ${params}[${GPU_PARAMS.BLACK_AND_WHITE_GREENS}],
    ${params}[${GPU_PARAMS.BLACK_AND_WHITE_AQUAS}], ${params}[${GPU_PARAMS.BLACK_AND_WHITE_BLUES}], ${params}[${GPU_PARAMS.BLACK_AND_WHITE_PURPLES}], ${params}[${GPU_PARAMS.BLACK_AND_WHITE_MAGENTAS}], ${params}[${GPU_PARAMS.BLACK_AND_WHITE_REDS}]
  );
  var anySlider = false;
  for (var index = 0u; index < 8u; index = index + 1u) {
    if (sliders[index] != 0.0) { anySlider = true; }
  }
  if (!anySlider) { return vec3f(y); }
  let lms = vec3f(
    ${name}Cbrt(0.6317629967 * guide.r + 0.3488996982 * guide.g + 0.0193373050 * guide.b),
    ${name}Cbrt(0.2700628984 * guide.r + 0.6309344642 * guide.g + 0.0990026374 * guide.b),
    ${name}Cbrt(0.0987429103 * guide.r + 0.1852327013 * guide.g + 0.7160243884 * guide.b)
  );
  let lightness = 0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z;
  let a = 1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z;
  let b = 0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z;
  var hue = degrees(atan2(b, a));
  hue = hue - 360.0 * floor(hue / 360.0);
  var centres = array<f32, 9>(29.0, 53.0, 110.0, 143.0, 195.0, 264.0, 294.0, 328.0, 389.0);
  if (hue < centres[0]) { hue = hue + 360.0; }
  var segment = 7u;
  for (var index = 0u; index < 8u; index = index + 1u) {
    if (hue >= centres[index] && hue < centres[index + 1u]) { segment = index; }
  }
  var t = clamp((hue - centres[segment]) / (centres[segment + 1u] - centres[segment]), 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  let response = sliders[segment] * (1.0 - t) + sliders[segment + 1u] * t;
  let relativeChroma = length(vec2f(a, b)) / (max(lightness, 0.0) + 0.05);
  let chromaT = clamp(relativeChroma / 0.12, 0.0, 1.0);
  let shadowT = clamp((lightness - 0.12) / (0.25 - 0.12), 0.0, 1.0);
  let weight = chromaT * chromaT * (3.0 - 2.0 * chromaT) * shadowT * shadowT * (3.0 - 2.0 * shadowT);
  return vec3f(y * exp2(2.0 * weight * response));
}
// The lattice mean the guide is built from, edges clamped to \`limit\`.
fn ${name}LatticeMean(texture: texture_2d<f32>, coordinate: vec2i, limit: vec2i) -> vec3f {
  var total = vec3f(0.0);
  for (var y = -${BLACK_AND_WHITE_GUIDE_TAPS}; y <= ${BLACK_AND_WHITE_GUIDE_TAPS}; y = y + 1) {
    for (var x = -${BLACK_AND_WHITE_GUIDE_TAPS}; x <= ${BLACK_AND_WHITE_GUIDE_TAPS}; x = x + 1) {
      let at = clamp(coordinate + vec2i(x, y) * ${BLACK_AND_WHITE_GUIDE_STEP}, vec2i(0), limit - vec2i(1));
      total += textureLoad(texture, at, 0).rgb;
    }
  }
  return total / ${(2 * BLACK_AND_WHITE_GUIDE_TAPS + 1) ** 2}.0;
}`;
  }

  const PEAK_REDUCTION_SHADER_SOURCE = `
@group(0) @binding(0) var peakSource: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> peakParams: array<f32>;
@group(0) @binding(2) var<storage, read_write> peakResult: array<atomic<u32>>;

fn peakLuma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2722287, 0.6740818, 0.0536895));
}
fn peakSrgbLuma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}
fn peakAcescgToSrgb(rgb: vec3f) -> vec3f {
  return vec3f(
     1.7050509927 * rgb.r - 0.6217921207 * rgb.g - 0.0832588720 * rgb.b,
    -0.1302564175 * rgb.r + 1.1408047366 * rgb.g - 0.0105483191 * rgb.b,
    -0.0240033568 * rgb.r - 0.1289689761 * rgb.g + 1.1529723329 * rgb.b
  );
}
fn peakSrgbToAcescg(rgb: vec3f) -> vec3f {
  return vec3f(
    0.6130974024 * rgb.r + 0.3395231366 * rgb.g + 0.0473794610 * rgb.b,
    0.0701937225 * rgb.r + 0.9163538791 * rgb.g + 0.0134523985 * rgb.b,
    0.0206155922 * rgb.r + 0.1095697729 * rgb.g + 0.8698146349 * rgb.b
  );
}
${blackAndWhiteWgsl("peakParams", "peakBlackAndWhite")}
fn peakAcescgToBt2020(rgb: vec3f) -> vec3f {
  return vec3f(
    1.0260187082 * rgb.r - 0.0221655448 * rgb.g - 0.0038531634 * rgb.b,
   -0.0017230808 * rgb.r + 1.0023190716 * rgb.g - 0.0005959908 * rgb.b,
   -0.0051099278 * rgb.r - 0.0216355504 * rgb.g + 1.0267454781 * rgb.b
  );
}
fn peakTone(input: vec3f) -> vec3f {
  var rgb = input * exp2(peakParams[${GPU_PARAMS.EXPOSURE}]);
  if (peakParams[${GPU_PARAMS.CONTRAST}] != 0.0) {
    let y = max(peakLuma(rgb), 0.0);
    if (y > 0.00000001) {
      let pivot = max(peakParams[${GPU_PARAMS.CONTRAST_PIVOT}], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      rgb *= pivot * exp2(clamp(stops * exp2(peakParams[${GPU_PARAMS.CONTRAST}]), -32.0, 32.0)) / y;
    }
  }
  return rgb;
}
${colorDesaturationWgsl("peakParams", "peakColorDesaturation", "peakLuma")}
fn peakSceneColor(input: vec3f) -> vec3f {
  if (peakParams[${GPU_PARAMS.COLOR_ENABLED}] < 0.5) { return input; }
  let offset = (peakParams[${GPU_PARAMS.WHITE_BALANCE_KELVIN}] - 6500.0) / 6500.0;
  let balanced = input * vec3f(1.0 + offset * 0.15, 1.0 + peakParams[${GPU_PARAMS.TINT}] * 0.08, 1.0 - offset * 0.15);
  let rgb = vec3f(
    peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_00}] * balanced.r + peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_01}] * balanced.g + peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_02}] * balanced.b,
    peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_10}] * balanced.r + peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_11}] * balanced.g + peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_12}] * balanced.b,
    peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_20}] * balanced.r + peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_21}] * balanced.g + peakParams[${GPU_PARAMS.PRIMARIES_MATRIX_22}] * balanced.b
  );
  let y = peakLuma(rgb);
  let neutral = vec3f(y);
  let chroma = rgb - neutral;
  let maximum = max(rgb.r, max(rgb.g, rgb.b));
  let minimum = min(rgb.r, min(rgb.g, rgb.b));
  let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
  let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
  let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
  return peakColorDesaturation(neutral + chroma * max(0.0, 1.0 + peakParams[${GPU_PARAMS.VIBRANCE}] * vibranceWeight) * max(0.0, 1.0 + peakParams[${GPU_PARAMS.SATURATION}]));
}
fn peakSdrReferencePrefix(input: vec3f) -> vec3f {
  var rgb = max(input * exp2(peakParams[${GPU_PARAMS.EXPOSURE}]), vec3f(0.0));
  return rgb;
}
fn peakSdrScenePrefix(input: vec3f) -> vec3f {
  let rgb = input * exp2(peakParams[${GPU_PARAMS.EXPOSURE}]);
  return peakSceneColor(rgb);
}
fn peakSdrInput(input: vec3f, guideSource: vec3f) -> vec3f {
  let needsGuide = peakBlackAndWhiteNeedsGuide();
  if (peakParams[${GPU_PARAMS.SOURCE_LINEAR_SRGB}] > 0.5) {
    var rgb = peakSdrReferencePrefix(input);
    if (peakParams[${BLACK_AND_WHITE_PARAM}] > 0.5) {
      var guide = rgb;
      if (needsGuide) { guide = peakSdrReferencePrefix(guideSource); }
      rgb = peakAcescgToSrgb(peakBlackAndWhite(peakSrgbToAcescg(rgb), peakSrgbToAcescg(guide)));
    }
    return rgb;
  }
  let scene = peakSdrScenePrefix(input);
  var guide = scene;
  if (needsGuide) { guide = peakSdrScenePrefix(guideSource); }
  return peakAcescgToSrgb(peakBlackAndWhite(scene, guide)) * ((100.0 / 203.0) / 0.18);
}

// The measurement domain follows the selected colour handling: BT.2020 channel
// peak for Smooth Rolloff, RGB channel peak for Path to White, luminance
// otherwise. Both entry points must agree on it.
fn peakSignalOf(rgb: vec3f, sdrV2: bool) -> f32 {
  let channelPeak = max(max(rgb.r, rgb.g), rgb.b);
  let transport = peakAcescgToBt2020(rgb);
  let transportPeak = max(max(transport.r, transport.g), transport.b);
  var signal = select(peakLuma(rgb), peakSrgbLuma(rgb), sdrV2);
  if (sdrV2 && peakParams[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 0.5) {
    signal = channelPeak;
  } else if (peakParams[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 1.5) {
    signal = transportPeak;
  } else if (peakParams[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 0.5) {
    signal = channelPeak;
  }
  return max(signal, 0.0);
}

fn recordPeak(signal: f32) {
  atomicMax(&peakResult[0], bitcast<u32>(signal));
  let stop = clamp(log2(max(signal, exp2(-32.0))), -32.0, 32.0);
  let bin = min(${PEAK_HISTOGRAM_BINS - 1}u, u32(floor((stop + 32.0) * ${PEAK_HISTOGRAM_BINS}.0 / 64.0)));
  atomicAdd(&peakResult[1u + bin], 1u);
}

@compute @workgroup_size(8, 8)
fn peakReductionMain(@builtin(global_invocation_id) id: vec3u) {
  let dimensions = textureDimensions(peakSource);
  if (id.x >= dimensions.x || id.y >= dimensions.y) { return; }
  let source = textureLoad(peakSource, vec2i(id.xy), 0).rgb;
  let sdrV2 = (peakParams[${GPU_PARAMS.HDR_LANE}] < 0.5 || peakParams[${GPU_PARAMS.LINKED_SDR}] > 0.5) && peakParams[${GPU_PARAMS.SDR_PEAK_LANE}] > 0.5;
  var guideSource = source;
  if (sdrV2 && peakBlackAndWhiteNeedsGuide()) {
    guideSource = peakBlackAndWhiteLatticeMean(peakSource, vec2i(id.xy), vec2i(dimensions));
  }
  let rgb = select(peakTone(source), peakSdrInput(source, guideSource), sdrV2);
  recordPeak(peakSignalOf(rgb, sdrV2));
}

// Reads an already-finished render target, so no stage of the grade has to be
// re-derived analytically. This is the domain the CPU limiter measures in.
@compute @workgroup_size(8, 8)
fn finishedPeakReductionMain(@builtin(global_invocation_id) id: vec3u) {
  let dimensions = textureDimensions(peakSource);
  if (id.x >= dimensions.x || id.y >= dimensions.y) { return; }
  let rgb = textureLoad(peakSource, vec2i(id.xy), 0).rgb;
  let sdrV2 = (peakParams[${GPU_PARAMS.HDR_LANE}] < 0.5 || peakParams[${GPU_PARAMS.LINKED_SDR}] > 0.5) && peakParams[${GPU_PARAMS.SDR_PEAK_LANE}] > 0.5;
  recordPeak(peakSignalOf(rgb, sdrV2));
}`;
  // Separate final-film entry point. The audited source-prefix and original
  // finished reduction remain byte-identical and retain their own pipeline.
  const SCALED_FILM_PEAK_REDUCTION_SHADER_SOURCE = PEAK_REDUCTION_SHADER_SOURCE + `
@compute @workgroup_size(8, 8)
fn scaledFilmPeakReductionMain(@builtin(global_invocation_id) id: vec3u) {
  var dimensions = textureDimensions(peakSource);
  if (arrayLength(&peakParams) > ${GPU_PARAMS.TILE_VALID_HEIGHT}u && peakParams[${GPU_PARAMS.TILE_VALID_WIDTH}] > 0.0 && peakParams[${GPU_PARAMS.TILE_VALID_HEIGHT}] > 0.0) {
    dimensions = min(dimensions, vec2u(u32(peakParams[${GPU_PARAMS.TILE_VALID_WIDTH}]), u32(peakParams[${GPU_PARAMS.TILE_VALID_HEIGHT}])));
  }
  if (any(id.xy >= dimensions)) { return; }
  let stored = textureLoad(peakSource, vec2i(id.xy), 0);
  recordPeak(peakSignalOf(stored.rgb * stored.a, (peakParams[${GPU_PARAMS.HDR_LANE}] < 0.5 || peakParams[${GPU_PARAMS.LINKED_SDR}] > 0.5)));
}`;
  const ADAPTIVE_DENOISE_SHADER_SOURCE = `
// scratch: (originX, originY, width, height) in frame pixels
// frame:   (frameWidth, frameHeight, level, axis)   axis 0 = horizontal
// tile:    (x, y, width, height) of the output, in frame pixels
// dest:    (originX, originY, sourceX, sourceY): where the destination's (0, 0)
//          sits, and where the source texture's (0, 0) sits (a region source)
// model:   (a, b, c, 0)
// strength:(luma, chroma, fineMultiplier, fineFloor)
// sigma:   (Y, C1, C2, 0) band noise factors at this level
struct AdaptiveParams {
  scratch: vec4f, frame: vec4f, tile: vec4f, dest: vec4f,
  model: vec4f, strength: vec4f, sigma: vec4f,
};
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var auxTex: texture_2d<f32>;
@group(0) @binding(2) var aux2Tex: texture_2d<f32>;
@group(0) @binding(3) var aux3Tex: texture_2d<f32>;
@group(0) @binding(4) var dstTex: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> ap: AdaptiveParams;

const ACES_LUMA = vec3f(0.2722287, 0.6740818, 0.0536895);
const INV_SQRT3 = 0.5773502691896258;
const INV_SQRT2 = 0.7071067811865476;
const INV_SQRT6 = 0.4082482904638631;
const B3 = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);

fn toOpponent(rgb: vec3f) -> vec3f {
  return vec3f(
    (rgb.r + rgb.g + rgb.b) * INV_SQRT3,
    (rgb.r - rgb.b) * INV_SQRT2,
    (rgb.r - 2.0 * rgb.g + rgb.b) * INV_SQRT6,
  );
}
fn fromOpponent(o: vec3f) -> vec3f {
  return vec3f(
    o.x * INV_SQRT3 + o.y * INV_SQRT2 + o.z * INV_SQRT6,
    o.x * INV_SQRT3 - 2.0 * o.z * INV_SQRT6,
    o.x * INV_SQRT3 - o.y * INV_SQRT2 + o.z * INV_SQRT6,
  );
}
fn scratchSize() -> vec2i { return vec2i(i32(ap.scratch.z), i32(ap.scratch.w)); }
fn scratchOrigin() -> vec2i { return vec2i(i32(ap.scratch.x), i32(ap.scratch.y)); }
fn inScratch(id: vec3u) -> bool { return i32(id.x) < scratchSize().x && i32(id.y) < scratchSize().y; }
fn clampLocal(local: vec2i) -> vec2i { return clamp(local, vec2i(0), scratchSize() - vec2i(1)); }

// numpy "reflect" at a frame edge when the frame is wider than the reach, else
// "edge"; then clamped into the scratch, which only disturbs the margin.
fn reflectFrame(f: i32, extent: i32, reach: i32) -> i32 {
  if (extent <= reach) { return clamp(f, 0, extent - 1); }
  var g = f;
  if (g < 0) { g = -g; }
  if (g > extent - 1) { g = 2 * (extent - 1) - g; }
  return g;
}

@compute @workgroup_size(8, 8)
fn adaptiveLoadMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let sourceOrigin = vec2i(i32(ap.dest.z), i32(ap.dest.w));
  let rgb = textureLoad(srcTex, scratchOrigin() - sourceOrigin + vec2i(id.xy), 0).rgb;
  textureStore(dstTex, vec2i(id.xy), vec4f(toOpponent(rgb), dot(rgb, ACES_LUMA)));
}

@compute @workgroup_size(8, 8)
fn adaptiveBlurMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let level = i32(ap.frame.z);
  let horizontal = ap.frame.w < 0.5;
  let step = 1 << u32(level);
  let reach = 2 * step;
  let origin = scratchOrigin();
  let p = vec2i(id.xy);
  var total = vec4f(0.0);
  for (var tap = 0; tap < 5; tap = tap + 1) {
    let offset = (tap - 2) * step;
    var f = origin + p;
    if (horizontal) {
      f.x = reflectFrame(f.x + offset, i32(ap.frame.x), reach);
    } else {
      f.y = reflectFrame(f.y + offset, i32(ap.frame.y), reach);
    }
    total += B3[tap] * textureLoad(srcTex, clampLocal(f - origin), 0);
  }
  textureStore(dstTex, p, total);
}

@compute @workgroup_size(8, 8)
fn adaptiveNoiseMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let y = max(textureLoad(srcTex, vec2i(id.xy), 0).w, 0.0);
  let variance = max(ap.model.z * y * y + ap.model.x * y + ap.model.y, 1e-20);
  textureStore(dstTex, vec2i(id.xy), vec4f(variance, 0.0, 0.0, 0.0));
}

// Box sums are edge-replicated at every scratch boundary, as numpy's "edge"
// pad is; at the frame's own edges that is the frame edge.
@compute @workgroup_size(8, 8)
fn adaptiveEnergyHorizontalMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  var total = vec3f(0.0);
  for (var tap = -3; tap <= 3; tap = tap + 1) {
    let q = clampLocal(p + vec2i(tap, 0));
    let band = textureLoad(srcTex, q, 0).xyz - textureLoad(auxTex, q, 0).xyz;
    total += band * band;
  }
  textureStore(dstTex, p, vec4f(total / 7.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn adaptiveEnergyVerticalMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  var total = vec3f(0.0);
  for (var tap = -3; tap <= 3; tap = tap + 1) {
    total += textureLoad(srcTex, clampLocal(p + vec2i(0, tap)), 0).xyz;
  }
  textureStore(dstTex, p, vec4f(total / 7.0, 0.0));
}

// src = this level's input, aux = its smooth, aux2 = band energy, aux3 = noise
// variance, sumTex = the band sum so far (read from level 1 on; the sum
// ping-pongs between two textures because rgba32float cannot be read and
// written in one pass).
@group(0) @binding(7) var sumTex: texture_2d<f32>;
@compute @workgroup_size(8, 8)
fn adaptiveAccumulateMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let level = i32(ap.frame.z);
  let band = textureLoad(srcTex, p, 0).xyz - textureLoad(auxTex, p, 0).xyz;
  let energy = textureLoad(aux2Tex, p, 0).xyz;
  let variance = textureLoad(aux3Tex, p, 0).x;
  let fine = level < 2;
  var strength = vec3f(ap.strength.x, ap.strength.y, ap.strength.y);
  if (fine) { strength *= ap.strength.z; }
  let noise = (strength * ap.sigma.xyz) * (strength * ap.sigma.xyz) * variance;
  var gain = max(energy - noise, vec3f(0.0)) / max(energy, vec3f(1e-20));
  if (fine && ap.strength.w > 0.0) { gain = max(gain, vec3f(ap.strength.w)); }
  var sum = vec4f(0.0);
  if (level > 0) { sum = textureLoad(sumTex, p, 0); }
  textureStore(dstTex, p, sum + vec4f(band * gain, 0.0));
}

// src = the band sum, aux = the coarsest smooth. Writes only the tile.
@compute @workgroup_size(8, 8)
fn adaptiveFinalMain(@builtin(global_invocation_id) id: vec3u) {
  let local = vec2i(id.xy);
  let frameAt = scratchOrigin() + local;
  let tile = vec4i(ap.tile);
  if (frameAt.x < tile.x || frameAt.y < tile.y || frameAt.x >= tile.x + tile.z || frameAt.y >= tile.y + tile.w) { return; }
  let opponent = textureLoad(srcTex, local, 0).xyz + textureLoad(auxTex, local, 0).xyz;
  let storeAt = frameAt - vec2i(i32(ap.dest.x), i32(ap.dest.y));
  textureStore(outTex, storeAt, vec4f(fromOpponent(opponent), 1.0));
}`;

  const GRAIN_DENOISE_BANDS = [1, 2];
  const GRAIN_DENOISE_RADIUS = 18;
  const GRAIN_FIT_BLOCK = 32;
  const GRAIN_DENOISE_SHADER_SOURCE = ADAPTIVE_DENOISE_SHADER_SOURCE + `
@compute @workgroup_size(8, 8)
fn adaptiveGrainGainMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let energy = textureLoad(aux2Tex, p, 0).xyz;
  let variance = textureLoad(aux3Tex, p, 0).x;
  let fine = ap.frame.z < 2.0;
  var strength = vec3f(ap.strength.x, ap.strength.y, ap.strength.y);
  if (fine) { strength *= ap.strength.z; }
  let noise = (strength * ap.sigma.xyz) * (strength * ap.sigma.xyz) * variance;
  var gain = max(energy - noise, vec3f(0.0)) / max(energy, vec3f(1e-20));
  if (fine && ap.strength.w > 0.0) { gain = max(gain, vec3f(ap.strength.w)); }
  textureStore(dstTex, p, vec4f(gain, 0.0));
}

@compute @workgroup_size(8, 8)
fn adaptiveGrainBoxMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let axis = select(vec2i(0, 1), vec2i(1, 0), ap.frame.w < 0.5);
  var total = 0.0;
  for (var tap = -${GRAIN_DENOISE_RADIUS}; tap <= ${GRAIN_DENOISE_RADIUS}; tap++) {
    total += textureLoad(srcTex, clampLocal(p + axis * tap), 0).x;
  }
  textureStore(dstTex, p, vec4f(total / ${GRAIN_DENOISE_RADIUS * 2 + 1}.0, 0.0, 0.0, 0.0));
}

@group(0) @binding(9) var<storage, read_write> grainPartials: array<vec4f>;
var<workgroup> grainBlock: array<vec4f, 64>;

@compute @workgroup_size(8, 8)
fn adaptiveGrainFitMain(@builtin(local_invocation_id) local: vec3u,
                        @builtin(local_invocation_index) index: u32,
                        @builtin(workgroup_id) group: vec3u) {
  let block = group.xy * ${GRAIN_FIT_BLOCK}u;
  let tileSize = vec2u(ap.tile.zw);
  let tileOrigin = vec2i(ap.tile.xy) - scratchOrigin();
  var terms = vec4f(0.0);
  for (var row = local.y; row < ${GRAIN_FIT_BLOCK}u; row += 8u) {
    for (var col = local.x; col < ${GRAIN_FIT_BLOCK}u; col += 8u) {
      let relative = block + vec2u(col, row);
      if (all(relative < tileSize)) {
        let p = tileOrigin + vec2i(relative);
        let band = textureLoad(srcTex, p, 0).x - textureLoad(auxTex, p, 0).x;
        let original = textureLoad(aux2Tex, p, 0).x;
        let mean = textureLoad(aux3Tex, p, 0).x;
        let power = band * band;
        let complement = 1.0 - mean;
        terms += power * vec4f(original * original, mean * mean, mean * complement, complement * complement);
      }
    }
  }
  grainBlock[index] = terms;
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride /= 2u) {
    if (index < stride) { grainBlock[index] += grainBlock[index + stride]; }
    workgroupBarrier();
  }
  if (index == 0u) {
    let pitch = (tileSize.x + ${GRAIN_FIT_BLOCK - 1}u) / ${GRAIN_FIT_BLOCK}u;
    grainPartials[u32(ap.dest.x) + group.y * pitch + group.x] = grainBlock[0];
  }
}

@compute @workgroup_size(8, 8)
fn adaptiveGrainAccumulateMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let band = textureLoad(srcTex, p, 0).xyz - textureLoad(auxTex, p, 0).xyz;
  var gain = textureLoad(aux2Tex, p, 0).xyz;
  let fitted = clamp(textureLoad(aux3Tex, p, 0).x * ap.model.w + ap.sigma.w, 0.0, 1.0);
  let difference = select(0.0, band.x * (fitted - gain.x) * INV_SQRT3, ap.dest.x < 0.0);
  gain.x = mix(gain.x, fitted, max(0.0, ap.dest.x));
  let sum = textureLoad(sumTex, p, 0);
  textureStore(dstTex, p, sum + vec4f(band * gain, difference));
}

@compute @workgroup_size(8, 8)
fn adaptiveGrainEndpointsMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.tile.zw))) { return; }
  let local = vec2i(ap.tile.xy) + vec2i(id.xy) - scratchOrigin();
  let sum = textureLoad(srcTex, local, 0);
  let rgb = fromOpponent(sum.xyz + textureLoad(auxTex, local, 0).xyz);
  textureStore(outTex, vec2i(ap.tile.xy - ap.dest.xy) + vec2i(id.xy), vec4f(rgb, sum.a));
}

@compute @workgroup_size(8, 8)
fn adaptiveGrainMixMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.tile.zw))) { return; }
  let packed = textureLoad(srcTex, vec2i(id.xy), 0);
  textureStore(outTex, vec2i(id.xy), vec4f(packed.rgb + vec3f(ap.dest.x * packed.a), 1.0));
}

@group(0) @binding(8) var preparedTex: texture_2d<u32>;

@compute @workgroup_size(8, 8)
fn adaptivePreparedMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(ap.tile.z) || id.y >= u32(ap.tile.w)) { return; }
  let p = vec2i(id.xy);
  let fields = textureLoad(preparedTex, p, 0);
  let base = bitcast<vec3f>(fields.xyz);
  let delta = fromOpponent(vec3f(0.0, unpack2x16float(fields.w) * ap.strength.x));
  let storeAt = vec2i(ap.tile.xy) + p - vec2i(ap.dest.xy);
  textureStore(outTex, storeAt, vec4f(base + delta - vec3f(dot(delta, ACES_LUMA)), 1.0));
}`;

  const CLEAN_GRAIN_SHADER_SOURCE = ADAPTIVE_DENOISE_SHADER_SOURCE + `
// Clean Grain runs on the resolved Fine values, including a colour-only
// border. Once it starts, the wavelet textures can be reused for its guides.
fn cleanRead(p: vec2i) -> vec4f { return textureLoad(srcTex, clampLocal(p), 0); }
fn cleanRamp(value: f32, low: f32, high: f32) -> f32 {
  return clamp((value - low) / (high - low), 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn cleanBaseMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.tile.zw))) { return; }
  let p = vec2i(id.xy) + vec2i(ap.tile.xy) - scratchOrigin();
  let rgb = fromOpponent(textureLoad(srcTex, p, 0).xyz + textureLoad(auxTex, p, 0).xyz);
  textureStore(dstTex, vec2i(id.xy), vec4f(rgb, dot(rgb, ACES_LUMA)));
}

@compute @workgroup_size(8, 8)
fn cleanLumaMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  var local = 0.0;
  var fine = 0.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let v = cleanRead(p + vec2i(x, y)).w;
      fine += v;
      if (abs(x) <= 1 && abs(y) <= 1) { local += v; }
    }
  }
  textureStore(dstTex, p, vec4f(local / 9.0, abs(cleanRead(p).w - fine / 25.0), 0.0, 0.0));
}

// One invocation averages sixteen consecutive pixels along a line. The
// running sum is rebased in each invocation to limit accumulated error.
@compute @workgroup_size(8, 8)
fn cleanBoxMain(@builtin(global_invocation_id) id: vec3u) {
  let vertical = ap.frame.w > 0.5;
  let axis = select(vec2i(1, 0), vec2i(0, 1), vertical);
  let start = vec2i(id.xy) * (vec2i(1) + axis * 15);
  if (any(start >= scratchSize())) { return; }
  let radius = i32(ap.frame.z);
  let scale = 1.0 / f32(radius * 2 + 1);
  var sum = vec4f(0.0);
  for (var k = -radius; k <= radius; k++) { sum += cleanRead(start + axis * k); }
  for (var k = 0; k < 16; k++) {
    let p = start + k * axis;
    if (any(p >= scratchSize())) { break; }
    textureStore(dstTex, p, sum * scale);
    sum += cleanRead(p + axis * (radius + 1)) - cleanRead(p - axis * radius);
  }
}

@compute @workgroup_size(8, 8)
fn cleanNormalizeMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let local = max(textureLoad(auxTex, p, 0).x, 0.0);
  let noise = max(1.25 * textureLoad(aux2Tex, p, 0).y, 1e-7);
  let light = local + 2.0 * noise;
  textureStore(dstTex, p, vec4f(toOpponent(cleanRead(p).rgb).yz / light, light, noise));
}

@compute @workgroup_size(8, 8)
fn cleanChromaResidualMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let mean = textureLoad(auxTex, p, 0).xy;
  textureStore(dstTex, p, vec4f(length(cleanRead(p).xy - mean), 0.0, 0.0, 0.0));
}

// Three replicated boxes for the luminance guides, computed together.
@compute @workgroup_size(8, 8)
fn cleanContextMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let row = ap.frame.w < 0.5;
  let axis = select(vec2i(0, 1), vec2i(1, 0), row);
  var sum = vec3f(0.0);
  for (var k = -12; k <= 12; k++) {
    let input = cleanRead(p + axis * k);
    let values = select(input.xyz, input.xxx, row);
    sum += values * vec3f(select(0.0, 1.0, abs(k) <= 3), select(0.0, 1.0, abs(k) <= 5), 1.0);
  }
  textureStore(dstTex, p, vec4f(sum / vec3f(7.0, 11.0, 25.0), 0.0));
}

@compute @workgroup_size(8, 8)
fn cleanTextureMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let local = cleanRead(p).x;
  let means = textureLoad(auxTex, p, 0).xyz;
  textureStore(dstTex, p, vec4f(abs(local - means.y), max(means.z, 0.0), abs(local - means.x), 0.0));
}

@compute @workgroup_size(8, 8)
fn cleanMaxMain(@builtin(global_invocation_id) id: vec3u) {
  let vertical = ap.frame.w > 0.5;
  let axis = select(vec2i(1, 0), vec2i(0, 1), vertical);
  let start = vec2i(id.xy) * (vec2i(1) + axis * 15);
  if (any(start >= scratchSize())) { return; }
  let radius = i32(ap.frame.z);
  var sharedPeak = 0.0;
  for (var k = 15 - radius; k <= radius; k++) { sharedPeak = max(sharedPeak, cleanRead(start + k * axis).x); }
  var left: array<f32, 16>;
  left[15] = sharedPeak;
  for (var k = 14; k >= 0; k--) { left[k] = max(left[k + 1], cleanRead(start + (k - radius) * axis).x); }
  var right = sharedPeak;
  for (var k = 0; k < 16; k++) {
    let p = start + k * axis;
    if (any(p >= scratchSize())) { break; }
    if (k > 0) { right = max(right, cleanRead(p + radius * axis).x); }
    textureStore(dstTex, p, vec4f(max(left[k], right), 0.0, 0.0, 0.0));
  }
}

@compute @workgroup_size(8, 8)
fn cleanGuidesMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let local = max(cleanRead(p).x, 0.0);
  let noise = textureLoad(auxTex, p, 0).w;
  let context = textureLoad(aux2Tex, p, 0);
  let texture = textureLoad(aux3Tex, p, 0).x / max(context.y + 3.0 * noise, 1e-6);
  let peak = textureLoad(sumTex, p, 0).x;
  var guide = vec3f(peak, context.y, local);
  if (ap.strength.y > 0.0) { guide *= ap.strength.y / noise; }
  let highlight = cleanRamp(guide.x, .065, .125);
  let limit = (1.0 - .97 * highlight) * (1.0 - cleanRamp(texture, .045, .15) * cleanRamp(guide.y, .004, .015));
  let dark = 1.0 - cleanRamp(guide.z, .006, .014);
  let sharpness = cleanRamp(context.z / max(local + 4.0 * noise, 1e-6), .06, .24);
  textureStore(dstTex, p, vec4f(limit, dark, .45 * highlight * sharpness, 0.0));
}

@compute @workgroup_size(8, 8)
fn cleanTapsMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.model.zw))) { return; }
  let p = vec2i(ap.model.xy) + vec2i(id.xy);
  let row = ap.frame.w < 0.5;
  let axis = select(vec2i(0, 1), vec2i(1, 0), row);
  let radius = i32(ap.frame.z);
  var outer = vec2f(0.0);
  var inner = vec2f(0.0);
  for (var k = -radius; k <= radius; k++) {
    let v = cleanRead(p + k * axis);
    outer += v.xy;
    if (abs(k) < radius) { inner += select(v.zw, v.xy, row); }
  }
  textureStore(dstTex, p, vec4f(outer / f32(2 * radius + 1), inner / f32(2 * radius - 1)));
}

fn cleanReflect(at: i32, extent: i32) -> i32 {
  if (at >= 0 && at < extent) { return at; }
  if (extent < 2) { return 0; }
  let period = 2 * (extent - 1);
  let t = abs(at) % period;
  return min(t, period - t);
}

fn cleanTap(p: vec2i) -> vec2f {
  let at = p + scratchOrigin();
  let reflected = vec2i(cleanReflect(at.x, i32(ap.frame.x)), cleanReflect(at.y, i32(ap.frame.y)));
  return textureLoad(auxTex, clampLocal(reflected - scratchOrigin()), 0).xy;
}

@compute @workgroup_size(8, 8)
fn cleanPairsMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.model.zw))) { return; }
  let p = vec2i(ap.model.xy) + vec2i(id.xy);
  let reach = i32(ap.frame.z);
  let d = select(8, 20, reach == 28);
  let offsets = array<vec2i, 4>(vec2i(reach, 0), vec2i(0, reach), vec2i(d), vec2i(-d, d));
  let core = textureLoad(auxTex, p, 0).zw;
  var closest = 1e30;
  var total = vec2f(0.0);
  var low = vec2f(1e30);
  var high = vec2f(-1e30);
  for (var k = 0; k < 4; k++) {
    let first = cleanTap(p + offsets[k]);
    let second = cleanTap(p - offsets[k]);
    closest = min(closest, min(length(core - first), length(core - second)));
    let pair = .5 * (first + second);
    total += pair;
    low = min(low, pair);
    high = max(high, pair);
  }
  let surrounding = .5 * (total - low - high);
  let delta = core - surrounding;
  let grain = max(1.25 * textureLoad(aux2Tex, p, 0).x, 1e-7);
  let signal = length(delta);
  let relative = signal / grain;
  let pixel = cleanRead(p).xy;
  let pixelRelative = length(pixel - surrounding) / grain;
  let isolated = cleanRamp(closest / max(signal, 1e-7), .1, .65);
  let protection = 1.0 - (1.0 - isolated) * cleanRamp(relative, 5.0, 12.0);
  let strength = max(cleanRamp(relative, 1.5, 5.0), cleanRamp(pixelRelative, 2.5, 5.0) * cleanRamp(relative, .65, 2.5));
  let fine = .8 * cleanRamp(pixelRelative, 1.0, 4.0);
  let limit = textureLoad(aux3Tex, p, 0).x;
  let moderate = (delta + fine * (pixel - core)) * (strength * protection * limit);
  textureStore(dstTex, p, vec4f(moderate, surrounding));
}

@compute @workgroup_size(8, 8)
fn cleanRelativeMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.model.zw))) { return; }
  let p = vec2i(ap.model.xy) + vec2i(id.xy);
  let surrounding = textureLoad(auxTex, p, 0).zw;
  let noise = max(1.25 * textureLoad(aux2Tex, p, 0).x, 1e-7);
  textureStore(dstTex, p, vec4f(length(cleanRead(p).xy - surrounding) / noise, 0.0, 0.0, 0.0));
}

fn cleanMedian(p: vec2i) -> vec2f {
  // Keep the lowest thirteen values independently for both channels.
  var lower: array<vec2f, 13>;
  for (var k = 0; k < 13; k++) { lower[k] = vec2f(1e30); }
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      var value = cleanRead(p + vec2i(x, y)).xy;
      for (var k = 0; k < 13; k++) {
        let next = max(value, lower[k]);
        lower[k] = min(value, lower[k]);
        value = next;
      }
    }
  }
  return lower[12];
}

fn cleanCross(p: vec2i, axis: vec2i, reach: i32) -> vec2f {
  return cleanRead(p + reach * axis).xy - cleanRead(p - reach * axis).xy;
}

// Matches _protect_splotch_edges: a colour edge must continue 5, 10 and 15
// pixels both ways, and only the correction along its colour step is held.
fn cleanProtectEdge(p: vec2i, grain: f32, correction: vec2f) -> vec2f {
  let axes = array<vec2i, 4>(vec2i(1,0), vec2i(0,1), vec2i(1,1), vec2i(-1,1));
  var strongest = 0.0;
  var step = vec2f(0.0);
  for (var i = 0; i < 4; i++) {
    let axis = axes[i];
    let direction = cleanCross(p, axis, 6);
    let contrast = max(length(direction), 1e-7);
    if (contrast <= 4.0 * grain) { continue; }
    var sides = contrast;
    for (var j = 1; j <= 3; j++) {
      let tangent = 5 * j * vec2i(-axis.y, axis.x);
      sides = min(sides, min(dot(direction, cleanCross(p + tangent, axis, 6)),
                             dot(direction, cleanCross(p - tangent, axis, 6))) / contrast);
    }
    let sharpness = contrast / max(length(cleanCross(p, axis, 12)), contrast);
    let weight = cleanRamp(sides / grain, 4.0, 9.0) * cleanRamp(sharpness, .4, .7);
    if (weight > strongest) { strongest = weight; step = direction / contrast; }
  }
  return correction - strongest * dot(correction, step) * step;
}

fn cleanFringe(p: vec2i, weight: f32, grain: f32) -> vec2f {
  if (weight <= 0.0) { return vec2f(0.0); }
  let delta = cleanRead(p).xy - cleanMedian(p);
  return delta * (weight * cleanRamp(length(delta) / grain, 3.0, 8.0));
}

@compute @workgroup_size(8, 8)
fn cleanFringeMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.model.zw))) { return; }
  let p = vec2i(ap.model.xy) + vec2i(id.xy);
  let grain = max(1.25 * textureLoad(sumTex, p, 0).x, 1e-7);
  let weight = textureLoad(aux3Tex, p, 0).z;
  textureStore(dstTex, p, vec4f(-cleanFringe(p, weight, grain) * cleanRead(p).z, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn cleanRepairMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.model.zw))) { return; }
  let p = vec2i(ap.model.xy) + vec2i(id.xy);
  let relative = textureLoad(aux2Tex, p, 0).x;
  let guides = textureLoad(aux3Tex, p, 0).xyz;
  let pair = textureLoad(auxTex, p, 0);
  let input = cleanRead(p).xy;
  var correction = pair.xy;
  if (guides.y > 0.0 && relative > 1.8) {
    var peak = 0.0;
    for (var y = -3; y <= 3; y++) {
      for (var x = -3; x <= 3; x++) {
        peak = max(peak, textureLoad(aux2Tex, clampLocal(p + vec2i(x, y)), 0).x);
      }
    }
    let darkPeak = guides.y * cleanRamp(relative / max(peak, 1e-6), .55, .95) * cleanRamp(relative, 1.8, 4.0);
    correction = mix(correction, (input - pair.zw) * guides.x, darkPeak);
  }
  let grain = max(1.25 * textureLoad(sumTex, p, 0).x, 1e-7);
  if (ap.strength.z > 0.5 && ap.sigma.x > 0.5 && any(correction != vec2f(0.0))) {
    correction = cleanProtectEdge(p, grain, correction);
  }
  if (ap.frame.z == 12.0 && ap.strength.w > 0.5) {
    correction += cleanFringe(p, guides.z, grain);
  }
  textureStore(dstTex, p, vec4f(input - correction, 0.0, 0.0));
}

fn cleanCorrection(p: vec2i, base: vec3f) -> vec2f {
  let fixed = textureLoad(auxTex, p, 0).xy;
  let light = textureLoad(aux2Tex, p, 0).z;
  return fixed * light - toOpponent(base).yz;
}

fn cleanAddColour(rgb: vec3f, correction: vec2f) -> vec3f {
  let delta = fromOpponent(vec3f(0.0, correction));
  return rgb + delta - vec3f(dot(delta, ACES_LUMA));
}

@compute @workgroup_size(8, 8)
fn cleanOutputMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.tile.zw))) { return; }
  let at = vec2i(ap.tile.xy) + vec2i(id.xy);
  let p = at - scratchOrigin();
  let base = cleanRead(p).rgb;
  let fringe = textureLoad(aux3Tex, p, 0).xy;
  let splotch = select(vec2f(0.0), cleanCorrection(p, base) - fringe, ap.strength.z > 0.5);
  let corrected = cleanAddColour(cleanAddColour(base, fringe), splotch * ap.strength.x);
  textureStore(outTex, at - vec2i(ap.dest.xy), vec4f(corrected, 1.0));
}

@group(0) @binding(8) var cleanPacked: texture_storage_2d<rgba32uint, write>;

@compute @workgroup_size(8, 8)
fn cleanPackMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.tile.zw))) { return; }
  let at = vec2i(ap.tile.xy) + vec2i(id.xy);
  let p = at - scratchOrigin();
  let base = cleanRead(p).rgb;
  let fringe = textureLoad(aux3Tex, p, 0).xy;
  let splotch = select(vec2f(0.0), cleanCorrection(p, base) - fringe, ap.strength.z > 0.5);
  textureStore(cleanPacked, at - vec2i(ap.dest.xy),
    vec4u(bitcast<vec3u>(cleanAddColour(base, fringe)), pack2x16float(splotch)));
}`;

  const MICRO_GRAIN_SHADER_SOURCE = CLEAN_GRAIN_SHADER_SOURCE + `
@compute @workgroup_size(8, 8)
fn microAccumulateMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let band = textureLoad(srcTex, p, 0).xyz - textureLoad(auxTex, p, 0).xyz;
  let energy = textureLoad(aux2Tex, p, 0).xyz;
  let variance = textureLoad(aux3Tex, p, 0).x;
  let strength = vec3f(ap.strength.x, ap.strength.y, ap.strength.y) * ap.sigma.xyz;
  let gain = max(energy - strength * strength * variance, vec3f(0.)) / max(energy, vec3f(1e-20));
  var sum = vec3f(0.);
  if (ap.frame.z > 0.) { sum = textureLoad(sumTex, p, 0).xyz; }
  let fine = select(1., ap.strength.z, ap.frame.z == 0.);
  textureStore(dstTex, p, vec4f(sum + band * (gain - 1.) * vec3f(fine, 1., 1.), 0.));
}

@compute @workgroup_size(8, 8)
fn microGateMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let source = textureLoad(auxTex, p + scratchOrigin() - vec2i(ap.dest.zw), 0);
  let correction = textureLoad(srcTex, p, 0).xyz;
  let keep = clamp(1. - ap.strength.w * (1. - source.a), 0., 1.);
  textureStore(dstTex, p, vec4f(correction.x * keep, correction.yz, 0.));
}

@compute @workgroup_size(8, 8)
fn microBaseMain(@builtin(global_invocation_id) id: vec3u) {
  if (!inScratch(id)) { return; }
  let p = vec2i(id.xy);
  let source = textureLoad(srcTex, p + scratchOrigin() - vec2i(ap.dest.zw), 0).rgb;
  let correction = textureLoad(auxTex, p, 0).xyz - textureLoad(aux2Tex, p, 0).xyz;
  let chroma = fromOpponent(vec3f(0., correction.yz));
  let rgb = source + chroma + vec3f(correction.x * INV_SQRT3 - dot(chroma, ACES_LUMA));
  textureStore(dstTex, p, vec4f(rgb, dot(rgb, ACES_LUMA)));
}

@compute @workgroup_size(8, 8)
fn microColourDeltaMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.model.zw))) { return; }
  let p = vec2i(ap.model.xy) + vec2i(id.xy);
  textureStore(dstTex, p, vec4f(cleanCorrection(p, cleanRead(p).rgb), 0., 0.));
}

@compute @workgroup_size(8, 8)
fn microOutputMain(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ap.tile.zw))) { return; }
  let at = vec2i(ap.tile.xy) + vec2i(id.xy);
  let p = at - scratchOrigin();
  let base = textureLoad(srcTex, p, 0).rgb;
  let colour = textureLoad(auxTex, p, 0).xy - textureLoad(aux2Tex, p, 0).xy;
  let delta = fromOpponent(vec3f(0., colour * ap.strength.x));
  textureStore(outTex, at - vec2i(ap.dest.xy), vec4f((base + delta - vec3f(dot(delta, ACES_LUMA))) * ap.strength.y, 1.));
}`;

  function grainResizeShader(clean) {
    return `
struct Resize {
  sizes: vec4f,
  strip: vec4f,
  block: vec4f,
  source: vec4f,
};
@group(0) @binding(0) var<uniform> resize: Resize;
@group(0) @binding(1) var pixels: texture_2d<f32>;
@group(0) @binding(2) var low: texture_2d<f32>;
@group(0) @binding(3) var high: texture_2d<f32>;
@group(0) @binding(4) var sampled: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var minValues: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var maxValues: texture_storage_2d<rgba32float, write>;
${clean ? `
@group(0) @binding(7) var resizedFields: texture_storage_2d<rgba32uint, write>;
@group(0) @binding(8) var nativeFields: texture_2d<u32>;
@group(0) @binding(9) var baseStripOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(10) var baseStrip: texture_2d<f32>;
` : "@group(0) @binding(7) var resizedPixels: texture_storage_2d<rgba16float, write>;"}

fn sinc(x: f32) -> f32 {
  if (abs(x) < 1e-5) { return 1.0; }
  let angle = x * 3.141592653589793;
  return sin(angle) / angle;
}
fn lanczos(x: f32) -> f32 {
  return select(sinc(x) * sinc(x / 3.0), 0.0, abs(x) >= 3.0);
}
fn support(center: f32, ratio: f32, extent: f32) -> vec2i {
  return vec2i(clamp(vec2f(center - 3.0 * ratio + 0.5, center + 3.0 * ratio + 0.5), vec2f(0.0), vec2f(extent)));
}
fn rangeWindow(center: f32, extent: f32) -> vec2i {
  let block = resize.block.x;
  let anchor = floor(center / block) * block;
  return vec2i(clamp(vec2f(anchor - block, anchor + 2.0 * block), vec2f(0.0), vec2f(extent)));
}

@compute @workgroup_size(8, 8)
fn fineGrainResizeHorizontal(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(resize.block.w) || id.y >= u32(resize.strip.y)) { return; }
  let row = i32(id.y);
  let ratio = resize.sizes.x / resize.sizes.z;
  let center = (resize.block.z + f32(id.x) + 0.5) * ratio;
  let taps = support(center, max(1.0, ratio), resize.sizes.x);
  let bounds = rangeWindow(center, resize.sizes.x);
  var sum = vec3f(0.0);
  var weightSum = 0.0;
  var minimum = vec3f(65504.0);
  var maximum = vec3f(-65504.0);
  for (var col = min(taps.x, bounds.x); col < max(taps.y, bounds.y); col++) {
    ${clean ? `let fields = textureLoad(nativeFields, vec2i(col - i32(resize.source.x), row), 0);
    let value = select(bitcast<vec3f>(fields.xyz), vec3f(unpack2x16float(fields.w), 0.0), resize.block.y > 0.5);`
      : "let value = textureLoad(pixels, vec2i(col - i32(resize.source.x), row), 0).rgb;"}
    if (col >= taps.x && col < taps.y) {
      let weight = lanczos((f32(col) + 0.5 - center) / max(1.0, ratio));
      sum += value * weight;
      weightSum += weight;
    }
    if (col >= bounds.x && col < bounds.y) {
      minimum = min(minimum, value);
      maximum = max(maximum, value);
    }
  }
  let dst = vec2i(id.xy);
  textureStore(sampled, dst, vec4f(sum / weightSum, 1.0));
  textureStore(minValues, dst, vec4f(minimum, 1.0));
  textureStore(maxValues, dst, vec4f(maximum, 1.0));
}

fn resizeVertical(destination: vec2i) -> vec3f {
  let ratio = resize.sizes.y / resize.sizes.w;
  let center = (f32(destination.y) + 0.5) * ratio;
  let taps = support(center, max(1.0, ratio), resize.sizes.y);
  let bounds = rangeWindow(center, resize.sizes.y);
  var sum = vec3f(0.0);
  var weightSum = 0.0;
  var minimum = vec3f(65504.0);
  var maximum = vec3f(-65504.0);
  for (var row = min(taps.x, bounds.x); row < max(taps.y, bounds.y); row++) {
    let sourcePoint = vec2i(destination.x, row - i32(resize.strip.x));
    if (row >= taps.x && row < taps.y) {
      let weight = lanczos((f32(row) + 0.5 - center) / max(1.0, ratio));
      sum += textureLoad(pixels, sourcePoint, 0).rgb * weight;
      weightSum += weight;
    }
    if (row >= bounds.x && row < bounds.y) {
      minimum = min(minimum, textureLoad(low, sourcePoint, 0).rgb);
      maximum = max(maximum, textureLoad(high, sourcePoint, 0).rgb);
    }
  }
  return clamp(sum / weightSum, minimum, maximum);
}

@compute @workgroup_size(8, 8)
fn fineGrainResizeVertical(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(resize.block.w) || id.y >= u32(resize.strip.w)) { return; }
  let destination = vec2i(i32(id.x), i32(resize.strip.z) + i32(id.y));
  let value = resizeVertical(destination);
  let outputPoint = destination + vec2i(i32(resize.block.z), 0);
  ${clean ? `let base = textureLoad(baseStrip, vec2i(id.xy), 0).rgb;
  textureStore(resizedFields, outputPoint, vec4u(bitcast<vec3u>(base), pack2x16float(value.xy)));`
    : "textureStore(resizedPixels, outputPoint, vec4f(value, 1.0));"}
}
${clean ? `
@compute @workgroup_size(8, 8)
fn fineGrainResizeBase(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(resize.block.w) || id.y >= u32(resize.strip.w)) { return; }
  let destination = vec2i(i32(id.x), i32(resize.strip.z) + i32(id.y));
  textureStore(baseStripOut, vec2i(id.xy), vec4f(resizeVertical(destination), 1.0));
}
` : ""}`;
  }
  const GRAIN_RESIZE_SHADER_SOURCE = grainResizeShader(false);
  const CLEAN_GRAIN_RESIZE_SHADER_SOURCE = grainResizeShader(true);

  const LENS_FILTERS = ((typeof window !== "undefined" && window.HDRLensFilters)
    || (typeof module !== "undefined" && module.exports && require("./lens-filters.js")));
  const LENS_KERNEL_LIMIT = 256;
  const LENS_KERNEL_TAPS = LENS_KERNEL_LIMIT + 1;
  const LENS_LOBE_COUNT = LENS_FILTERS.components[1].length;
  const LENS_TABLE_LENGTH = (LENS_FILTERS.components.length - 1) * LENS_LOBE_COUNT;
  // Each component's row ends with its extent and normalization sum.
  const LENS_KERNEL_SIZE = Object.freeze([LENS_KERNEL_TAPS + 2, LENS_LOBE_COUNT]);
  const LENS_COMPONENTS_WGSL = LENS_FILTERS.components.slice(1).flat().map(([sigma,weights]) =>
    `vec4f(${[sigma,...weights].map(value=>Number(value).toPrecision(12)).join(",")})`).join(",\n");

  const SHADER_SOURCE = String.raw`
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read> p: array<f32>;
    @group(0) @binding(2) var<storage, read> curveLuts: array<f32>;
    @group(0) @binding(3) var spatialTexture: texture_2d<f32>;
    @group(0) @binding(4) var spatialSampler: sampler;
    @group(0) @binding(5) var overlayMaskTexture: texture_2d<f32>;
    @group(0) @binding(6) var<storage, read> filmStock: array<f32>;
    // Global HSL coverage from the shared selection (hsl-selection-gpu.js),
    // four channels per layer, one texel per base-pass pixel. Other passes
    // bind a 1x1 placeholder, which keeps HSL pointwise there.
    @group(0) @binding(7) var hslSelection: texture_2d_array<f32>;
    @group(0) @binding(8) var filmDetailOutput: texture_storage_2d<rgba16float, write>;
    @group(1) @binding(0) var lensWeights: texture_2d<f32>;

    struct VertexOut { @builtin(position) position: vec4f, @location(0) @interpolate(flat) lensComponent: u32 }

    @vertex fn vertexMain(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> VertexOut {
      var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: VertexOut;
      output.position = vec4f(positions[index], 0.0, 1.0);
      output.lensComponent = instance;
      return output;
    }

    fn lumaAces(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2722287, 0.6740818, 0.0536895)); }
    fn lumaSrgb(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
    fn smoothRange(a: f32, b: f32, v: f32) -> f32 {
      let t = clamp((v - a) / max(b - a, 0.000001), 0.0, 1.0);
      return t * t * (3.0 - 2.0 * t);
    }
    fn curveValueOffset(channel: u32, value: f32, offset: u32) -> f32 {
      let base = offset + channel * 1024u;
      if (value < 0.0) {
        let slope = (curveLuts[base + 1u] - curveLuts[base]) * 1023.0;
        return curveLuts[base] + value * slope;
      }
      if (value > 1.0) {
        let slope = (curveLuts[base + 1023u] - curveLuts[base + 1022u]) * 1023.0;
        return curveLuts[base + 1023u] + (value - 1.0) * slope;
      }
      let location = clamp(value, 0.0, 1.0) * 1023.0;
      let lower = u32(floor(location));
      let upper = min(lower + 1u, 1023u);
      let amount = fract(location);
      return mix(curveLuts[base + lower], curveLuts[base + upper], amount);
    }
    fn filmHdrEncodeLuma(value: f32) -> f32 {
      if (value < 0.0) { return value / 0.36; }
      if (value <= 0.18) { return 0.5 * pow(value / 0.18, 1.0 / log(100.0)); }
      return 0.5 + 0.5 * log2(value / 0.18) / log2(100.0);
    }
    fn filmHdrDecodeLuma(value: f32) -> f32 {
      if (value < 0.0) { return value * 0.36; }
      if (value <= 0.5) { return 0.18 * pow(2.0 * value, log(100.0)); }
      return 0.18 * exp2((value - 0.5) * 2.0 * log2(100.0));
    }
    const CURVE_C: f32 = 0.004;
    const CURVE_LOG_SPAN: f32 = log2(901.0);
    const CURVE_TOE: f32 = CURVE_C * CURVE_LOG_SPAN * log(2.0);
    const CURVE_SDR_SCALE: f32 = (100.0 / 203.0) / 0.18;

    fn curveEncodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value / CURVE_TOE; }
      return log2(1.0 + value / CURVE_C) / CURVE_LOG_SPAN;
    }
    fn curveDecodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value * CURVE_TOE; }
      return CURVE_C * (exp2(value * CURVE_LOG_SPAN) - 1.0);
    }
    // Match color.py's CAT02 matrix here without changing other shader stages.
    fn curveSrgbToAcescg(rgb: vec3f) -> vec3f {
      return vec3f(
        0.6131178129 * rgb.r + 0.3411819959 * rgb.g + 0.0457873443 * rgb.b,
        0.0699340823 * rgb.r + 0.9181030375 * rgb.g + 0.0119327755 * rgb.b,
        0.0204629926 * rgb.r + 0.1067686634 * rgb.g + 0.8727159106 * rgb.b
      );
    }
    fn applyCurves(input: vec3f, hdr: bool) -> vec3f {
      return applyCurvesOffset(input, hdr, u32(p[${GPU_PARAMS.CURVES_ENABLED}]), 0u);
    }
    fn applyCurvesOffset(input: vec3f, hdr: bool, channels: u32, offset: u32) -> vec3f {
      if (channels == 0u) { return input; }
      var rgb = input;
      if (!hdr) { rgb = curveSrgbToAcescg(rgb) / CURVE_SDR_SCALE; }
      if ((channels & 1u) != 0u) {
        let sourceLuma = lumaAces(rgb);
        let mapped = curveDecodeChannel(curveValueOffset(0u, curveEncodeChannel(sourceLuma), offset));
        if (sourceLuma > 0.00001) {
          let black = max(0.0, min(curveDecodeChannel(curveLuts[offset]), mapped));
          rgb = vec3f(black) + rgb * ((mapped - black) / sourceLuma);
        } else {
          rgb += vec3f(mapped - sourceLuma);
        }
      }
      for (var channel = 0u; channel < 3u; channel++) {
        if ((channels & (2u << channel)) != 0u) {
          let encoded = curveEncodeChannel(rgb[channel]);
          rgb[channel] = curveDecodeChannel(curveValueOffset(channel + 1u, encoded, offset));
        }
      }
      if (!hdr) { return acescgToSrgb(rgb) * CURVE_SDR_SCALE; }
      return rgb;
    }
    fn acescgToSrgb(rgb: vec3f) -> vec3f {
      return vec3f(
        1.7048873310 * rgb.r - 0.6241572745 * rgb.g - 0.0808867739 * rgb.b,
       -0.1295209353 * rgb.r + 1.1383993260 * rgb.g - 0.0087792418 * rgb.b,
       -0.0241270599 * rgb.r - 0.1246206123 * rgb.g + 1.1488221099 * rgb.b
      );
    }
    fn srgbToAcescg(rgb: vec3f) -> vec3f {
      return vec3f(
        0.6130974024 * rgb.r + 0.3395231366 * rgb.g + 0.0473794610 * rgb.b,
        0.0701937225 * rgb.r + 0.9163538791 * rgb.g + 0.0134523985 * rgb.b,
        0.0206155922 * rgb.r + 0.1095697729 * rgb.g + 0.8698146349 * rgb.b
      );
    }
    fn acescgToP3(rgb: vec3f) -> vec3f {
      return vec3f(
        1.3793363837 * rgb.r - 0.3112868172 * rgb.g - 0.0680495665 * rgb.b,
       -0.0687964722 * rgb.r + 1.0799570656 * rgb.g - 0.0111605934 * rgb.b,
       -0.0022666792 * rgb.r - 0.0417050150 * rgb.g + 1.0439716942 * rgb.b
      );
    }
    fn acescgToBt2020(rgb: vec3f) -> vec3f {
      return vec3f(
        1.0260187082 * rgb.r - 0.0221655448 * rgb.g - 0.0038531634 * rgb.b,
       -0.0017230808 * rgb.r + 1.0023190716 * rgb.g - 0.0005959908 * rgb.b,
       -0.0051099278 * rgb.r - 0.0216355504 * rgb.g + 1.0267454781 * rgb.b
      );
    }
    fn bt2020ToAcescg(rgb: vec3f) -> vec3f {
      return vec3f(
        0.9746957086 * rgb.r + 0.0216339017 * rgb.g + 0.0036703891 * rgb.b,
        0.0016784991 * rgb.r + 0.9977360501 * rgb.g + 0.0005854508 * rgb.b,
        0.0048862547 * rgb.r + 0.0211319326 * rgb.g + 0.9739818130 * rgb.b
      );
    }
    fn bt2020ToP3(rgb: vec3f) -> vec3f {
      return vec3f(
        1.3435782526 * rgb.r - 0.2821796705 * rgb.g - 0.0613985821 * rgb.b,
       -0.0652974528 * rgb.r + 1.0757879158 * rgb.g - 0.0104904631 * rgb.b,
        0.0028217873 * rgb.r - 0.0195984945 * rgb.g + 1.0167767073 * rgb.b
      );
    }
    const SDR_GAMUT_ALPHA: f32 = 5.0;
    const SDR_GAMUT_HIGHLIGHT_START: f32 = 0.85;
    const SDR_GAMUT_HIGHLIGHT_ALPHA: f32 = 0.05;
    const SDR_GAMUT_LOW_SAT_HIGHLIGHT_START: f32 = 0.70;
    const SDR_GAMUT_SATURATION_LOW: f32 = 0.08;
    const SDR_GAMUT_SATURATION_HIGH: f32 = 0.20;
    const GAMUT_CHROMA_EPS: f32 = 0.00001;
    const GAMUT_MATH_EPS: f32 = 0.000001;
    const GAMUT_RESIDUE_EPS: f32 = 0.00002;
    const GAMUT_NEUTRAL_RGB_EPS: f32 = 0.001;
    const SIGNED_CHANNEL_TOE: f32 = 0.001;

    struct GamutCusp {
      lightness: f32,
      chroma: f32,
    }
    fn gamutFinite(value: f32) -> bool {
      return value == value && abs(value) < 3.402823e+38;
    }
    fn gamutSignedCbrt(value: f32) -> f32 {
      return sign(value) * pow(abs(value), 1.0 / 3.0);
    }
    fn linearSrgbToOklab(input: vec3f) -> vec3f {
      let ell = 0.4122214708 * input.r + 0.5363325363 * input.g + 0.0514459929 * input.b;
      let em = 0.2119034982 * input.r + 0.6806995451 * input.g + 0.1073969566 * input.b;
      let ess = 0.0883024619 * input.r + 0.2817188376 * input.g + 0.6299787005 * input.b;
      let ellRoot = gamutSignedCbrt(ell);
      let emRoot = gamutSignedCbrt(em);
      let essRoot = gamutSignedCbrt(ess);
      return vec3f(
        0.2104542553 * ellRoot + 0.7936177850 * emRoot - 0.0040720468 * essRoot,
        1.9779984951 * ellRoot - 2.4285922050 * emRoot + 0.4505937099 * essRoot,
        0.0259040371 * ellRoot + 0.7827717662 * emRoot - 0.8086757660 * essRoot
      );
    }
    fn oklabToLinearSrgb(input: vec3f) -> vec3f {
      let ellRoot = input.x + 0.3963377774 * input.y + 0.2158037573 * input.z;
      let emRoot = input.x - 0.1055613458 * input.y - 0.0638541728 * input.z;
      let essRoot = input.x - 0.0894841775 * input.y - 1.2914855480 * input.z;
      let ell = ellRoot * ellRoot * ellRoot;
      let em = emRoot * emRoot * emRoot;
      let ess = essRoot * essRoot * essRoot;
      return vec3f(
        4.0767416621 * ell - 3.3077115913 * em + 0.2309699292 * ess,
       -1.2684380046 * ell + 2.6097574011 * em - 0.3413193965 * ess,
       -0.0041960863 * ell - 0.7034186147 * em + 1.7076147010 * ess
      );
    }
    fn gamutMaxSaturation(aa: f32, bb: f32) -> f32 {
      var k0: f32;
      var k1: f32;
      var k2: f32;
      var k3: f32;
      var k4: f32;
      var weights: vec3f;
      // Keep the blue vertex on the green-limited side at a float32 tie.
      let redBoundary = -1.88170328 * aa - 0.80936493 * bb;
      let blueVertex = bb < 0.0 && abs(redBoundary - 1.0) <= GAMUT_RESIDUE_EPS;
      if (redBoundary > 1.0 && !blueVertex) {
        k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
        weights = vec3f(4.0767416621, -3.3077115913, 0.2309699292);
      } else if (1.81444104 * aa - 1.19445276 * bb > 1.0 || blueVertex) {
        k0 = 0.73956515; k1 = -0.45954404; k2 = 0.08285427; k3 = 0.12541070; k4 = 0.14503204;
        weights = vec3f(-1.2684380046, 2.6097574011, -0.3413193965);
      } else {
        k0 = 1.35733652; k1 = -0.00915799; k2 = -1.15130210; k3 = -0.50559606; k4 = 0.00692167;
        weights = vec3f(-0.0041960863, -0.7034186147, 1.7076147010);
      }
      var saturation = k0 + k1 * aa + k2 * bb + k3 * aa * aa + k4 * aa * bb;
      let k = vec3f(
        0.3963377774 * aa + 0.2158037573 * bb,
       -0.1055613458 * aa - 0.0638541728 * bb,
       -0.0894841775 * aa - 1.2914855480 * bb
      );
      for (var iteration = 0; iteration < 2; iteration++) {
        let roots = vec3f(1.0) + saturation * k;
        let cubed = roots * roots * roots;
        let first = 3.0 * k * roots * roots;
        let second = 6.0 * k * k * roots;
        let function = dot(weights, cubed);
        let derivative = dot(weights, first);
        let derivative2 = dot(weights, second);
        let denominator = derivative * derivative - 0.5 * function * derivative2;
        let candidate = saturation - function * derivative / select(1.0, denominator, abs(denominator) > GAMUT_MATH_EPS);
        if (abs(denominator) > GAMUT_MATH_EPS && gamutFinite(candidate) && candidate > GAMUT_MATH_EPS) {
          saturation = candidate;
        }
      }
      return saturation;
    }
    fn gamutCusp(aa: f32, bb: f32) -> GamutCusp {
      let saturation = gamutMaxSaturation(aa, bb);
      let atMaximum = oklabToLinearSrgb(vec3f(1.0, saturation * aa, saturation * bb));
      let maximum = max(max(atMaximum.r, atMaximum.g), max(atMaximum.b, GAMUT_MATH_EPS));
      let lightness = gamutSignedCbrt(1.0 / maximum);
      return GamutCusp(lightness, lightness * saturation);
    }
    fn gamutHalleyDelta(function: f32, derivative: f32, second: f32) -> f32 {
      let denominator = derivative * derivative - 0.5 * function * second;
      if (abs(denominator) <= GAMUT_MATH_EPS) { return 1e20; }
      let reciprocal = derivative / denominator;
      let delta = -function * reciprocal;
      if (!gamutFinite(reciprocal) || !gamutFinite(delta) || reciprocal < 0.0) { return 1e20; }
      return delta;
    }
    fn gamutIntersection(aa: f32, bb: f32, lightness: f32, chroma: f32, focus: f32, cusp: GamutCusp) -> f32 {
      let lower = (lightness - focus) * cusp.chroma - (cusp.lightness - focus) * chroma <= 0.0;
      var parameter: f32;
      if (lower) {
        let denominator = chroma * cusp.lightness + cusp.chroma * (focus - lightness);
        parameter = cusp.chroma * focus / select(1.0, denominator, abs(denominator) > GAMUT_MATH_EPS);
      } else {
        let denominator = chroma * (cusp.lightness - 1.0) + cusp.chroma * (focus - lightness);
        parameter = cusp.chroma * (focus - 1.0) / select(1.0, denominator, abs(denominator) > GAMUT_MATH_EPS);
      }
      parameter = clamp(parameter, 0.0, 1.0);
      let deltaLightness = lightness - focus;
      let k = vec3f(
        0.3963377774 * aa + 0.2158037573 * bb,
       -0.1055613458 * aa - 0.0638541728 * bb,
       -0.0894841775 * aa - 1.2914855480 * bb
      );
      let rootsDelta = vec3f(deltaLightness) + chroma * k;
      if (!lower) {
        for (var iteration = 0; iteration < 2; iteration++) {
          let currentLightness = focus * (1.0 - parameter) + parameter * lightness;
          let currentChroma = parameter * chroma;
          let roots = vec3f(currentLightness) + currentChroma * k;
          let cubed = roots * roots * roots;
          let first = 3.0 * rootsDelta * roots * roots;
          let second = 6.0 * rootsDelta * rootsDelta * roots;
          let rgb = vec3f(
            4.0767416621 * cubed.x - 3.3077115913 * cubed.y + 0.2309699292 * cubed.z - 1.0,
           -1.2684380046 * cubed.x + 2.6097574011 * cubed.y - 0.3413193965 * cubed.z - 1.0,
           -0.0041960863 * cubed.x - 0.7034186147 * cubed.y + 1.7076147010 * cubed.z - 1.0
          );
          let rgbFirst = vec3f(
            4.0767416621 * first.x - 3.3077115913 * first.y + 0.2309699292 * first.z,
           -1.2684380046 * first.x + 2.6097574011 * first.y - 0.3413193965 * first.z,
           -0.0041960863 * first.x - 0.7034186147 * first.y + 1.7076147010 * first.z
          );
          let rgbSecond = vec3f(
            4.0767416621 * second.x - 3.3077115913 * second.y + 0.2309699292 * second.z,
           -1.2684380046 * second.x + 2.6097574011 * second.y - 0.3413193965 * second.z,
           -0.0041960863 * second.x - 0.7034186147 * second.y + 1.7076147010 * second.z
          );
          let step = min(
            gamutHalleyDelta(rgb.r, rgbFirst.r, rgbSecond.r),
            min(gamutHalleyDelta(rgb.g, rgbFirst.g, rgbSecond.g), gamutHalleyDelta(rgb.b, rgbFirst.b, rgbSecond.b))
          );
          let candidate = parameter + step;
          if (gamutFinite(candidate) && candidate >= 0.0 && candidate <= 1.0) { parameter = candidate; }
        }
      }
      return parameter;
    }
    fn compressSrgbGamut(rgb: vec3f) -> vec3f {
      if (all(rgb >= vec3f(0.0)) && all(rgb <= vec3f(1.0))) { return rgb; }
      let floor = min(rgb.r, min(rgb.g, rgb.b));
      var input = rgb;
      if (floor < 0.0) {
        // Match the CPU toe before calculating hue, at every brightness.
        let positive = max(rgb, vec3f(0.0));
        let knee = min(-floor, SIGNED_CHANNEL_TOE);
        let t = min(positive, vec3f(knee)) / knee;
        input = positive * t * (2.0 - t);
      }
      if (all(input <= vec3f(1.0 + GAMUT_RESIDUE_EPS + GAMUT_MATH_EPS))) {
        return clamp(input, vec3f(0.0), vec3f(1.0));
      }
      if (max(input.r, max(input.g, input.b)) - min(input.r, min(input.g, input.b)) < GAMUT_NEUTRAL_RGB_EPS) {
        return clamp(input, vec3f(0.0), vec3f(1.0));
      }
      let lab = linearSrgbToOklab(input);
      let lightness = lab.x;
      let chroma = length(lab.yz);
      if (chroma < GAMUT_CHROMA_EPS) { return clamp(input, vec3f(0.0), vec3f(1.0)); }
      let direction = lab.yz / chroma;
      let cusp = gamutCusp(direction.x, direction.y);
      let delta = lightness - cusp.lightness;
      let k = max(2.0 * select(cusp.lightness, 1.0 - cusp.lightness, delta > 0.0), GAMUT_MATH_EPS);
      let perceptualSaturation = chroma / max(abs(lightness), GAMUT_MATH_EPS);
      let saturationT = clamp(
        (perceptualSaturation - SDR_GAMUT_SATURATION_LOW)
          / (SDR_GAMUT_SATURATION_HIGH - SDR_GAMUT_SATURATION_LOW),
        0.0,
        1.0
      );
      let saturationWeight = saturationT * saturationT * (3.0 - 2.0 * saturationT);
      let highlightStart = mix(
        SDR_GAMUT_LOW_SAT_HIGHLIGHT_START,
        SDR_GAMUT_HIGHLIGHT_START,
        saturationWeight
      );
      let highlightT = clamp(
        (lightness - highlightStart) / (1.0 - highlightStart),
        0.0,
        1.0
      );
      let highlightWeight = select(0.0, highlightT * highlightT * (3.0 - 2.0 * highlightT), delta > 0.0);
      let strength = mix(SDR_GAMUT_ALPHA, SDR_GAMUT_HIGHLIGHT_ALPHA, highlightWeight);
      let e1 = 0.5 * k + abs(delta) + strength * chroma / k;
      let adaptiveFocus = cusp.lightness + 0.5 * sign(delta) * (e1 - sqrt(max(e1 * e1 - 2.0 * k * abs(delta), 0.0)));
      let neutralAxisWeight = highlightWeight * (1.0 - saturationWeight);
      let focus = mix(adaptiveFocus, lightness, neutralAxisWeight);
      let parameter = gamutIntersection(direction.x, direction.y, lightness, chroma, focus, cusp);
      let clippedLightness = focus * (1.0 - parameter) + parameter * lightness;
      let clippedChroma = parameter * chroma;
      let mapped = oklabToLinearSrgb(vec3f(clippedLightness, clippedChroma * direction.x, clippedChroma * direction.y));
      return clamp(mapped, vec3f(0.0), vec3f(1.0));
    }
    @group(0) @binding(10) var<storage, read> gamutParityInputs: array<vec4f>;
    @group(0) @binding(11) var<storage, read_write> gamutParityOutputs: array<vec4f>;
    @compute @workgroup_size(64)
    fn gamutParityMain(@builtin(global_invocation_id) id: vec3u) {
      if (id.x >= arrayLength(&gamutParityInputs)) { return; }
      gamutParityOutputs[id.x] = vec4f(compressSrgbGamut(gamutParityInputs[id.x].rgb), 1.0);
    }
    fn whiteBalance(input: vec3f) -> vec3f {
      let offset = (p[${GPU_PARAMS.WHITE_BALANCE_KELVIN}] - 6500.0) / 6500.0;
      return input * vec3f(1.0 + offset * 0.15, 1.0 + p[${GPU_PARAMS.TINT}] * 0.08, 1.0 - offset * 0.15);
    }
    ${colorDesaturationWgsl("p", "colorDesaturation", "lumaAces")}
    fn hdrColor(input: vec3f) -> vec3f {
      let rgb = vec3f(
        p[${GPU_PARAMS.PRIMARIES_MATRIX_00}] * input.r + p[${GPU_PARAMS.PRIMARIES_MATRIX_01}] * input.g + p[${GPU_PARAMS.PRIMARIES_MATRIX_02}] * input.b,
        p[${GPU_PARAMS.PRIMARIES_MATRIX_10}] * input.r + p[${GPU_PARAMS.PRIMARIES_MATRIX_11}] * input.g + p[${GPU_PARAMS.PRIMARIES_MATRIX_12}] * input.b,
        p[${GPU_PARAMS.PRIMARIES_MATRIX_20}] * input.r + p[${GPU_PARAMS.PRIMARIES_MATRIX_21}] * input.g + p[${GPU_PARAMS.PRIMARIES_MATRIX_22}] * input.b
      );
      let y = lumaAces(rgb);
      let neutral = vec3f(y);
      let chroma = rgb - neutral;
      let maximum = max(rgb.r, max(rgb.g, rgb.b));
      let minimum = min(rgb.r, min(rgb.g, rgb.b));
      let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
      let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
      let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
      let vibranceFactor = max(0.0, 1.0 + p[${GPU_PARAMS.VIBRANCE}] * vibranceWeight);
      let saturationFactor = max(0.0, 1.0 + p[${GPU_PARAMS.SATURATION}]);
      return colorDesaturation(neutral + chroma * vibranceFactor * saturationFactor);
    }
    fn toneZoneWeight(stops: f32, center: f32, width: f32) -> f32 {
      return 1.0 - smoothstep(0.0, max(width * 0.5, 0.001), abs(stops - center));
    }
    ${toneZonesWgsl(GPU_PARAMS, "toneZones")}
    fn hdrBase(input: vec3f) -> vec3f {
      return input * exp2(p[${GPU_PARAMS.EXPOSURE}]);
    }
    fn hdrContrast(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.CONTRAST}] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[${GPU_PARAMS.CONTRAST_PIVOT}], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      let targetStops = stops * exp2(p[${GPU_PARAMS.CONTRAST}]);
      if (y <= 0.00000001) { return input; }
      return input * (pivot * exp2(clamp(targetStops, -32.0, 32.0)) / y);
    }
    fn gradingVector(hue: f32, hdr: bool) -> vec3f {
      let angle = radians(hue);
      var tint = vec3f(cos(angle), cos(angle - 2.0943951), cos(angle + 2.0943951));
      let neutral = select(lumaSrgb(tint), lumaAces(tint), hdr);
      tint -= vec3f(neutral);
      return tint / max(max(abs(tint.r), abs(tint.g)), max(abs(tint.b), 0.000001));
    }
    fn applyColorGrading(input: vec3f, hdr: bool) -> vec3f {
      if (p[${GPU_PARAMS.COLOR_GRADING_ENABLED}] < 0.5) { return input; }
      // Export treats neutral wheels as identity, including signed RAW
      // colours near black. Running the luminance normalization anyway would
      // erase a positive channel when the weighted luminance is nonpositive.
      if (p[${GPU_PARAMS.COLOR_GRADING_SHADOW_SATURATION}] == 0.0 && p[${GPU_PARAMS.COLOR_GRADING_SHADOW_LUMINANCE_EV}] == 0.0 && p[${GPU_PARAMS.COLOR_GRADING_MIDTONE_SATURATION}] == 0.0
        && p[${GPU_PARAMS.COLOR_GRADING_MIDTONE_LUMINANCE_EV}] == 0.0 && p[${GPU_PARAMS.COLOR_GRADING_HIGHLIGHT_SATURATION}] == 0.0 && p[${GPU_PARAMS.COLOR_GRADING_HIGHLIGHT_LUMINANCE_EV}] == 0.0) { return input; }
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.0);
      let signal = log2(max(sourceY, 0.0000001) / select(0.18 * (100.0 / 203.0), 0.18 * 0.18, hdr));
      let shadow = 1.0 - smoothRange(-1.0 + p[${GPU_PARAMS.COLOR_GRADING_BALANCE}] - p[${GPU_PARAMS.COLOR_GRADING_BLENDING}] * 0.5, -1.0 + p[${GPU_PARAMS.COLOR_GRADING_BALANCE}] + p[${GPU_PARAMS.COLOR_GRADING_BLENDING}] * 0.5, signal);
      let highlight = smoothRange(1.0 + p[${GPU_PARAMS.COLOR_GRADING_BALANCE}] - p[${GPU_PARAMS.COLOR_GRADING_BLENDING}] * 0.5, 1.0 + p[${GPU_PARAMS.COLOR_GRADING_BALANCE}] + p[${GPU_PARAMS.COLOR_GRADING_BLENDING}] * 0.5, signal);
      let midtone = max(0.0, 1.0 - shadow - highlight);
      let total = max(shadow + midtone + highlight, 0.000001);
      let masks = vec3f(shadow, midtone, highlight) / total;
      var tint = vec3f(0.0);
      var luminanceEv = 0.0;
      var affected = false;
      for (var index: u32 = 0u; index < 3u; index = index + 1u) {
        let offset = ${GPU_PARAMS.COLOR_GRADING_SHADOW_HUE} + index * 3;
        affected = affected || (masks[index] > 0.0 && (p[offset + 1] != 0.0 || p[offset + 2] != 0.0));
        tint += gradingVector(p[offset], hdr) * p[offset + 1] * masks[index];
        luminanceEv += p[offset + 2] * masks[index];
      }
      if (!affected) { return input; }
      var result = input + tint * sourceY;
      let tintedY = max(select(lumaSrgb(result), lumaAces(result), hdr), 0.0000001);
      if (sourceY > 0.0000001) { result *= sourceY / tintedY; }
      return result * exp2(luminanceEv);
    }
    fn hdrSoftCeiling(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.HIGHLIGHT_MODE}] != 2.0 || p[${GPU_PARAMS.HIGHLIGHT_SOFTNESS}] <= 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let start = max(p[${GPU_PARAMS.HIGHLIGHT_START}], 0.000001);
      if (y <= start) { return input; }
      let targetLevel = max(p[${GPU_PARAMS.HIGHLIGHT_TARGET}], start + 0.0018);
      let span = targetLevel - start;
      let normalized = (y - start) / span;
      let softness = clamp(p[${GPU_PARAMS.HIGHLIGHT_SOFTNESS}] / 100.0, 0.0, 1.0);
      let exponent = exp2(5.0 * (1.0 - softness));
      var compressed: f32;
      if (normalized <= 1.0) {
        compressed = normalized / pow(1.0 + pow(normalized, exponent), 1.0 / exponent);
      } else {
        compressed = 1.0 / pow(1.0 + pow(1.0 / normalized, exponent), 1.0 / exponent);
      }
      if (compressed > 0.99999) { compressed = 1.0; }
      let activationPosition = clamp(p[${GPU_PARAMS.HIGHLIGHT_SOFTNESS}] / 10.0, 0.0, 1.0);
      let activation = activationPosition * activationPosition * (3.0 - 2.0 * activationPosition);
      var targetValue: f32;
      if (activation >= 1.0) {
        targetValue = start + span * compressed;
      } else {
        targetValue = start + mix(y - start, span * compressed, activation);
      }
      return input * (targetValue / max(y, 0.00000001));
    }
    fn peakFitChannel(
      channel: f32,
      effectiveStart: f32,
      effectiveStartStop: f32,
      peakStop: f32,
      curveBias: f32,
      stopSpan: f32,
      m0: f32,
      m1: f32
    ) -> f32 {
      if (channel <= effectiveStart) { return channel; }
      let u = clamp((log2(channel) - effectiveStartStop) / max(peakStop - effectiveStartStop, 0.000001), 0.0, 1.0);
      let w = clamp(u + curveBias * u * (1.0 - u), 0.0, 1.0);
      let mapped = w * (1.0 - w) * (1.0 - w) * m0 + w * w * (3.0 - 2.0 * w) + w * w * (w - 1.0) * m1;
      return exp2(effectiveStartStop + stopSpan * mapped);
    }
    // AgX-style Attenuate (prototype): mirrors _agx_attenuate in adjustments.py.
    // Mix toward luminance, re-gain so the brightest channel is unchanged,
    // shoulder each channel, then restore the mix only where little was
    // compressed. Uncompressed pixels return exactly as they came in.
    fn agxAttenuate(
      working: vec3f,
      weights: vec3f,
      inset: f32,
      effectiveStart: f32,
      effectiveStartStop: f32,
      peakStop: f32,
      curveBias: f32,
      stopSpan: f32,
      m0: f32,
      m1: f32,
      compressionSpanStops: f32
    ) -> vec3f {
      let s = clamp(inset, 0.0, 0.9);
      let mixedRaw = working * (1.0 - s) + vec3f(s * dot(working, weights));
      let workingPeak = max(max(working.r, working.g), working.b);
      var gain = 1.0;
      if (workingPeak > 0.0) { gain = workingPeak / max(max(max(mixedRaw.r, mixedRaw.g), mixedRaw.b), 1e-12); }
      let mixed = mixedRaw * gain;
      var mapped = vec3f(
        peakFitChannel(mixed.r, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1),
        peakFitChannel(mixed.g, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1),
        peakFitChannel(mixed.b, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1)
      );
      let mixedPeak = max(max(max(mixed.r, mixed.g), mixed.b), 1e-12);
      let mappedPeak = max(max(max(mapped.r, mapped.g), mapped.b), 1e-12);
      let compression = log2(mixedPeak / mappedPeak);
      let restore = 1.0 - smoothstep(0.0, max(compressionSpanStops, 1e-6), compression);
      if (s > 0.0) {
        let outset = (mapped - vec3f(s * dot(mapped, weights))) / ((1.0 - s) * gain);
        mapped = mapped + restore * (outset - mapped);
      }
      return mapped;
    }
    // Mirrors _concave_shoulder: Detail picks an end slope that keeps the
    // per-channel shoulder concave, so hue never turns back near the peak.
    fn concaveEndSlope(m0: f32, detail: f32) -> f32 {
      let low = max(0.0, 3.0 - 2.0 * m0);
      let high = max(low, 0.9 * (3.0 - m0) / 2.0);
      return low + clamp(detail, 0.0, 1.0) * (high - low);
    }
    fn hdrPeakFitBlend(input: vec3f, mapped: vec3f, activation: f32) -> vec3f {
      if (max(max(abs(input.r),abs(input.g)),abs(input.b)) > 32752.0
          && p[${GPU_PARAMS.FILM_STOCK_SLOT}] > 0.5) {
        let base=(u32(p[${GPU_PARAMS.FILM_STOCK_SLOT}]+0.5)-1u)*${FILM_STOCK.slotFloats}u;
        if (filmStock[base + ${STOCK.SCAN_FILM}u] == 2.0) {
          // Preserve the exact CPU's float32 subtraction before its final mix.
          // At extreme ideal-paper gains, algebraic mix loses this rounding.
          if (activation >= 1.0) {
            let step = exp2(floor(log2(max(abs(input),vec3f(0.00006103515625))))-23.0);
            return round(mapped/step)*step;
          }
          let difference = mapped-input;
          return input + difference*activation;
        }
      }
      return mix(input,mapped,activation);
    }
    fn hdrPeakFit(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.HIGHLIGHT_MODE}] != 1.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let channelPeak = max(max(input.r, input.g), input.b);
      let transport = acescgToBt2020(input);
      let transportPeak = max(max(transport.r, transport.g), transport.b);
      var signal = y;
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 1.5) {
        signal = max(transportPeak, 0.0);
      } else if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 0.5) {
        signal = max(channelPeak, 0.0);
      }
      let start = max(p[${GPU_PARAMS.HIGHLIGHT_START}], 0.000001);
      let targetLevel = max(p[${GPU_PARAMS.HIGHLIGHT_TARGET}], start + 0.0018);
      let peakLevel = max(p[${GPU_PARAMS.HIGHLIGHT_ANCHOR}], targetLevel);
      if (peakLevel <= targetLevel) { return input; }
      let startStop = log2(start);
      let targetStop = log2(targetLevel);
      let peakStop = log2(peakLevel);
      // Fade the shoulder in over the first quarter stop of overage.  This
      // keeps a measurement crossing the target from switching the complete
      // colour treatment on at once; the later delivery clamp stays exact.
      let peakFitActivation = smoothstep(0.0, 0.25, peakStop - targetStop);
      let curveBias = p[${GPU_PARAMS.HIGHLIGHT_BIAS}];
      let requestedRatio = (targetStop - startStop) / max(peakStop - startStop, 0.000001);
      let requiredRatio = clamp((1.0 / (1.0 + curveBias) + p[${GPU_PARAMS.HIGHLIGHT_PEAK_DETAIL}] / (1.0 - curveBias)) / 3.0, 0.001, 0.95);
      var effectiveStartStop = startStop;
      if (requestedRatio < requiredRatio) {
        effectiveStartStop = (targetStop - requiredRatio * peakStop) / (1.0 - requiredRatio);
      }
      let effectiveStart = exp2(effectiveStartStop);
      if (signal <= effectiveStart) { return input; }
      let u = clamp((log2(signal) - effectiveStartStop) / max(peakStop - effectiveStartStop, 0.000001), 0.0, 1.0);
      let w = clamp(u + curveBias * u * (1.0 - u), 0.0, 1.0);
      let stopSpan = targetStop - effectiveStartStop;
      let m0 = (peakStop - effectiveStartStop) / max(stopSpan * (1.0 + curveBias), 0.000001);
      var m1 = p[${GPU_PARAMS.HIGHLIGHT_PEAK_DETAIL}] * (peakStop - effectiveStartStop) / max(stopSpan * (1.0 - curveBias), 0.000001);
      // Attenuate (3) keeps its whole shoulder concave; Smooth color rolloff (2)
      // keeps brightness on m1 and takes channel ratios from the concave m1c.
      let m1c = concaveEndSlope(m0, p[${GPU_PARAMS.HIGHLIGHT_PEAK_DETAIL}]);
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 2.5) { m1 = m1c; }
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 2.5) {
        let attenuated = agxAttenuate(
          transport, vec3f(0.2627, 0.6780, 0.0593), p[${GPU_PARAMS.HIGHLIGHT_ATTENUATION}],
          effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1, peakStop - targetStop
        );
        return mix(input, bt2020ToAcescg(attenuated), peakFitActivation);
      }
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 1.5) {
        // Mirrors the CPU: brightest channel on the shoulder as set, the others
        // at their concave-shoulder ratio to it, so hue never turns back.
        let brightest = max(transportPeak, 1e-12);
        let scale = peakFitChannel(brightest, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1)
          / max(peakFitChannel(brightest, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c), 1e-12);
        let mappedTransport = select(transport, vec3f(
          peakFitChannel(transport.r, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c),
          peakFitChannel(transport.g, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c),
          peakFitChannel(transport.b, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c)
        ) * scale, transport > vec3f(0.0));
        if (max(max(abs(input.r),abs(input.g)),abs(input.b)) > 32752.0) {
          return hdrPeakFitBlend(input, bt2020ToAcescg(mappedTransport), peakFitActivation);
        }
        return mix(input, bt2020ToAcescg(mappedTransport), peakFitActivation);
      }
      let mapped = w * (1.0 - w) * (1.0 - w) * m0 + w * w * (3.0 - 2.0 * w) + w * w * (w - 1.0) * m1;
      let targetValue = exp2(effectiveStartStop + stopSpan * mapped);
      let mappedRgb = input * (targetValue / max(signal, 0.00000001));
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] < 0.5) { return hdrPeakFitBlend(input, mappedRgb, peakFitActivation); }
      let progress = u * u * (3.0 - 2.0 * u);
      let neutralized = vec3f(targetValue) + (mappedRgb - vec3f(targetValue)) * (1.0 - progress);
      return hdrPeakFitBlend(input, neutralized, peakFitActivation);
    }
    fn sdrSoftCeiling(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.HIGHLIGHT_MODE}] != 2.0 || p[${GPU_PARAMS.HIGHLIGHT_SOFTNESS}] <= 0.0) { return input; }
      let y = max(lumaSrgb(input), 0.0);
      let start = max(p[${GPU_PARAMS.HIGHLIGHT_START}], 0.000001);
      if (y <= start) { return input; }
      let span = 1.0 - start;
      let normalized = (y - start) / span;
      let softness = clamp(p[${GPU_PARAMS.HIGHLIGHT_SOFTNESS}] / 100.0, 0.0, 1.0);
      let exponent = exp2(5.0 * (1.0 - softness));
      var compressed: f32;
      if (normalized <= 1.0) {
        compressed = normalized / pow(1.0 + pow(normalized, exponent), 1.0 / exponent);
      } else {
        compressed = 1.0 / pow(1.0 + pow(1.0 / normalized, exponent), 1.0 / exponent);
      }
      let position = clamp(p[${GPU_PARAMS.HIGHLIGHT_SOFTNESS}] / 10.0, 0.0, 1.0);
      let activation = position * position * (3.0 - 2.0 * position);
      let targetValue = start + mix(y - start, span * compressed, activation);
      return input * (targetValue / max(y, 0.00000001));
    }
    fn sdrPeakFit(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.HIGHLIGHT_MODE}] != 1.0) { return input; }
      let y = max(lumaSrgb(input), 0.0);
      let channelPeak = max(max(input.r, input.g), input.b);
      var signal = y;
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 0.5) { signal = max(channelPeak, 0.0); }
      let start = max(p[${GPU_PARAMS.HIGHLIGHT_START}], 0.000001);
      // Skip against the authored target, matching the CPU limiter. A fixed
      // 1.0 scene-linear threshold is reference-white dependent and diverges
      // from it for any target above that level.
      let targetPeak = max(p[${GPU_PARAMS.HIGHLIGHT_TARGET}], 0.000001);
      let peakLevel = max(p[${GPU_PARAMS.HIGHLIGHT_ANCHOR}], targetPeak);
      if (peakLevel <= targetPeak) { return input; }
      let startStop = log2(start);
      let peakStop = log2(peakLevel);
      let curveBias = p[${GPU_PARAMS.HIGHLIGHT_BIAS}];
      let requestedRatio = -startStop / max(peakStop - startStop, 0.000001);
      let requiredRatio = clamp((1.0 / (1.0 + curveBias) + p[${GPU_PARAMS.HIGHLIGHT_PEAK_DETAIL}] / (1.0 - curveBias)) / 3.0, 0.001, 0.95);
      var effectiveStartStop = startStop;
      if (requestedRatio < requiredRatio) {
        effectiveStartStop = (-requiredRatio * peakStop) / (1.0 - requiredRatio);
      }
      let effectiveStart = exp2(effectiveStartStop);
      if (signal <= effectiveStart) { return input; }
      let sourceSpan = max(peakStop - effectiveStartStop, 0.000001);
      let stopSpan = -effectiveStartStop;
      let m0 = sourceSpan / max(stopSpan * (1.0 + curveBias), 0.000001);
      var m1 = p[${GPU_PARAMS.HIGHLIGHT_PEAK_DETAIL}] * sourceSpan / max(stopSpan * (1.0 - curveBias), 0.000001);
      // Attenuate (3) keeps its whole shoulder concave; Smooth color rolloff (2)
      // keeps brightness on m1 and takes channel ratios from the concave m1c.
      let m1c = concaveEndSlope(m0, p[${GPU_PARAMS.HIGHLIGHT_PEAK_DETAIL}]);
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 2.5) { m1 = m1c; }
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 2.5) {
        return agxAttenuate(
          input, vec3f(0.2126, 0.7152, 0.0722), p[${GPU_PARAMS.HIGHLIGHT_ATTENUATION}],
          effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1, peakStop
        );
      }
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 1.5) {
        let sdrScale = peakFitChannel(channelPeak, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1)
          / max(peakFitChannel(max(channelPeak, 0.00000001), effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c), 1e-12);
        let perChannel = select(input, vec3f(
          peakFitChannel(input.r, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c),
          peakFitChannel(input.g, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c),
          peakFitChannel(input.b, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c)
        ) * sdrScale, input > vec3f(0.0));
        // Per-channel mapping leaves a small secondary channel behind while
        // its primary shrinks, turning hard-compressed saturated red magenta.
        // As the brightest channel's compression grows, move to a hue-keeping
        // form: the middle channel holds its relative position and a
        // below-zero channel shrinks with the brightest. The 0.5 and 2.0 stop
        // edges are SDR_ROLLOFF_HUE_KEEP_*_STOPS in adjustments.py.
        let low = min(min(input.r, input.g), input.b);
        let safeHigh = max(channelPeak, 0.00000001);
        let mappedHigh = peakFitChannel(channelPeak, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1);
        var mappedLow = peakFitChannel(low, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1c) * sdrScale;
        if (low < 0.0) { mappedLow = low * mappedHigh / safeHigh; }
        let position = (input - vec3f(low)) / max(channelPeak - low, 0.00000001);
        let hueKept = clamp(vec3f(mappedLow) + position * (mappedHigh - mappedLow), vec3f(mappedLow), vec3f(mappedHigh));
        let hueWeight = smoothstep(0.5, 2.0, log2(safeHigh / max(mappedHigh, 0.00000001)));
        return mix(perChannel, hueKept, hueWeight);
      }
      let u = clamp((log2(signal) - effectiveStartStop) / sourceSpan, 0.0, 1.0);
      let w = clamp(u + curveBias * u * (1.0 - u), 0.0, 1.0);
      let mapped = w * (1.0 - w) * (1.0 - w) * m0 + w * w * (3.0 - 2.0 * w) + w * w * (w - 1.0) * m1;
      let targetValue = exp2(effectiveStartStop + stopSpan * mapped);
      let mappedRgb = input * (targetValue / max(signal, 0.00000001));
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] < 0.5) { return mappedRgb; }
      let progress = u * u * (3.0 - 2.0 * u);
      return vec3f(targetValue) + (mappedRgb - vec3f(targetValue)) * (1.0 - progress);
    }
    fn hdrPrimaries(input: vec3f) -> vec3f {
      return toneZones(input, max(lumaAces(input), 0.0));
    }
    fn toneEqualizerNodeEv(index: u32) -> f32 { return p[${GPU_PARAMS.TONE_EQUALIZER_INPUT_EV_0}u + index]; }
    fn toneEqualizerTarget(index: u32) -> f32 {
      return toneEqualizerNodeEv(index) + p[${GPU_PARAMS.TONE_EQUALIZER_ADJUSTMENT_EV_0}u + index];
    }
    fn toneEqualizerSlope(index: u32) -> f32 {
      let count = u32(p[${GPU_PARAMS.TONE_EQUALIZER_NODE_COUNT}]);
      if (index == 0u) { return (toneEqualizerTarget(1u) - toneEqualizerTarget(0u)) / max(toneEqualizerNodeEv(1u) - toneEqualizerNodeEv(0u), 0.0001); }
      if (index + 1u >= count) { return (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001); }
      let previous = (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001);
      let following = (toneEqualizerTarget(index + 1u) - toneEqualizerTarget(index)) / max(toneEqualizerNodeEv(index + 1u) - toneEqualizerNodeEv(index), 0.0001);
      if (previous <= 0.0 || following <= 0.0) { return 0.0; }
      return 2.0 * previous * following / (previous + following);
    }
    fn toneEqualizer(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.TONE_EQUALIZER_ENABLED}] < 0.5) { return input; }
      let y = max(select(lumaSrgb(input), lumaAces(input), p[${GPU_PARAMS.HDR_LANE}] > 0.5), 0.0);
      if (y <= 0.00000001) { return input; }
      let inputEv = log2(max(y, 0.00000001) / 0.18);
      var targetEv = inputEv;
      let count = u32(p[${GPU_PARAMS.TONE_EQUALIZER_NODE_COUNT}]);
      if (inputEv < -6.0) {
        targetEv += p[${GPU_PARAMS.TONE_EQUALIZER_ADJUSTMENT_EV_0}];
      } else if (inputEv > 6.0) {
        targetEv += p[${GPU_PARAMS.TONE_EQUALIZER_ADJUSTMENT_EV_0}u + count - 1u];
      } else {
        var segment = 0u;
        for (var index = 0u; index < 15u; index++) {
          if (index + 1u < count && inputEv >= toneEqualizerNodeEv(index + 1u)) { segment = index + 1u; }
        }
        segment = min(segment, count - 2u);
        let width = max(toneEqualizerNodeEv(segment + 1u) - toneEqualizerNodeEv(segment), 0.0001);
        let local = (inputEv - toneEqualizerNodeEv(segment)) / width;
        let y0 = toneEqualizerTarget(segment);
        let y1 = toneEqualizerTarget(segment + 1u);
        let m0 = toneEqualizerSlope(segment) * width;
        let m1 = toneEqualizerSlope(segment + 1u) * width;
        let local2 = local * local;
        let local3 = local2 * local;
        let cubic = (2.0 * local3 - 3.0 * local2 + 1.0) * y0
          + (local3 - 2.0 * local2 + local) * m0
          + (-2.0 * local3 + 3.0 * local2) * y1
          + (local3 - local2) * m1;
        let linear = mix(y0, y1, local);
        targetEv = mix(linear, cubic, clamp(p[${GPU_PARAMS.TONE_EQUALIZER_SMOOTHING}], 0.0, 1.0));
      }
      return input * (0.18 * exp2(clamp(targetEv, -32.0, 32.0)) / y);
    }
    fn srgbEncode(value: f32) -> f32 {
      return select(1.055 * pow(clamp(value, 0.0, 1.0), 1.0 / 2.4) - 0.055, value * 12.92, value <= 0.0031308);
    }
    fn srgbDecode(value: f32) -> f32 {
      return select(pow((clamp(value, 0.0, 1.0) + 0.055) / 1.055, 2.4), value / 12.92, value <= 0.04045);
    }
    fn displayEncodeChannel(value: f32) -> f32 {
      // Canvas colorSpace values use the nonlinear sRGB/Display-P3 transfer
      // function even when the swap-chain texture itself is floating point.
      let magnitude = abs(value);
      let encoded = select(1.055 * pow(magnitude, 1.0 / 2.4) - 0.055, magnitude * 12.92, magnitude <= 0.0031308);
      return sign(value) * encoded;
    }
    fn displayEncode(rgb: vec3f) -> vec3f {
      return vec3f(displayEncodeChannel(rgb.r), displayEncodeChannel(rgb.g), displayEncodeChannel(rgb.b));
    }
    fn sdrContrast(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.CONTRAST}] == 0.0) { return input; }
      let rgb = input;
      let linearY = max(lumaSrgb(rgb), 0.0);
      let encodedY = displayEncodeChannel(linearY);
      let targetValue = (encodedY - p[${GPU_PARAMS.CONTRAST_PIVOT}]) * exp2(p[${GPU_PARAMS.CONTRAST}] * 0.5) + p[${GPU_PARAMS.CONTRAST_PIVOT}];
      let positive = max(targetValue, 0.0);
      let targetY = select(pow((positive + 0.055) / 1.055, 2.4), positive / 12.92, positive <= 0.04045);
      if (linearY > 0.000001) { return rgb * (targetY / linearY); }
      return vec3f(targetY);
    }
    fn sdrPrimaries(input: vec3f) -> vec3f {
      return toneZones(input, max(lumaSrgb(input), 0.0));
    }
    ${blackAndWhiteWgsl("p", "blackAndWhite")}
    // The source-pixel lattice mean for Black & White's guide, filled by
    // baseFragmentMain only when a slider is set.
    var<private> blackAndWhiteGuideSource: vec3f;
    fn sceneColor(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.COLOR_ENABLED}] < 0.5) { return input; }
      return hdrColor(whiteBalance(input));
    }
    fn sdrReferenceColor(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.COLOR_ENABLED}] < 0.5) { return input; }
      return acescgToSrgb(sceneColor(srgbToAcescg(input)));
    }
    ${HSL_WGSL}
    fn renderHdrBase(source: vec3f) -> vec3f {
      let scene = sceneColor(hdrContrast(hdrBase(source)));
      var guide = scene;
      if (blackAndWhiteNeedsGuide()) { guide = sceneColor(hdrContrast(hdrBase(blackAndWhiteGuideSource))); }
      let balanced = blackAndWhite(scene, guide);
      let equalized = toneEqualizer(balanced);
      let primaries = hdrPrimaries(equalized);
      // Export retains signed HDR channels until Detail and locals have run.
      // Clipping here changes the neighbourhood's luminance and Sharpen fence.
      return applyColorGrading(applyCurves(applyHsl(primaries, true), true), true);
    }
    fn displayHdr(rgb: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.HDR_SURFACE}] > 0.5) {
        // Chromium currently treats extended canvas values relative to its
        // 203-nit canvas convention. This is a qualified runtime convention,
        // not a universal WebGPU physical-nit guarantee.
        // Clamp in BT.2020 before converting to P3, exactly as the PQ encoder
        // does, so exposed highlights do not change at the settled handoff.
        let transportRgb = clamp(acescgToBt2020(rgb), vec3f(0.0), vec3f(p[${GPU_PARAMS.HDR_DISPLAY_HEADROOM}]));
        return bt2020ToP3(transportRgb) * (p[${GPU_PARAMS.PROJECT_REFERENCE_WHITE_NITS}] / p[${GPU_PARAMS.FILM_REFERENCE_WHITE_NITS}]) / 0.18;
      }
      let display = max(acescgToSrgb(rgb), vec3f(0.0));
      return display / (vec3f(1.0) + display);
    }
    fn sdrReferencePrefix(source: vec3f) -> vec3f {
      let rgb = max(source, vec3f(0.0)) * exp2(p[${GPU_PARAMS.EXPOSURE}]);
      return rgb;
    }
    fn sdrScenePrefix(source: vec3f) -> vec3f {
      let rgb = source * exp2(p[${GPU_PARAMS.EXPOSURE}]);
      return sceneColor(rgb);
    }
    fn renderSdrBase(source: vec3f) -> vec3f {
      var rgb: vec3f;
      let needsGuide = blackAndWhiteNeedsGuide();
      if (p[${GPU_PARAMS.SOURCE_LINEAR_SRGB}] > 0.5) {
        rgb = sdrReferencePrefix(source);
        // BW-01: on this path Color runs after the highlight stage, but B&W
        // must come before it (adjustments.py _sdr_reference_pre_highlight).
        if (p[${GPU_PARAMS.BLACK_AND_WHITE_ENABLED}] > 0.5) {
          var guide = rgb;
          if (needsGuide) { guide = sdrReferencePrefix(blackAndWhiteGuideSource); }
          rgb = acescgToSrgb(blackAndWhite(srgbToAcescg(rgb), srgbToAcescg(guide)));
        }
        rgb = toneEqualizer(rgb);
        rgb = sdrContrast(rgb);
        rgb = sdrReferenceColor(rgb);
        rgb = sdrPrimaries(rgb);
        rgb = applyColorGrading(applyCurves(applyHsl(rgb, false), false), false);
      } else {
        let scene = sdrScenePrefix(source);
        var guide = scene;
        if (needsGuide) { guide = sdrScenePrefix(blackAndWhiteGuideSource); }
        let grey = blackAndWhite(scene, guide);
        // Fixed placement retains headroom through tone and Film Look.
        rgb = acescgToSrgb(grey) * ((100.0 / 203.0) / 0.18);
        rgb = toneEqualizer(rgb);
        rgb = sdrContrast(rgb);
        rgb = sdrPrimaries(rgb);
        rgb = applyColorGrading(applyCurves(applyHsl(rgb, false), false), false);
      }
      // Contrast and wheels retain headroom for Detail, locals and Film Look.
      // The final output gamut mapper owns SDR white and gamut.
      return rgb;
    }

    fn filmLuma(rgb: vec3f) -> f32 {
      return select(lumaSrgb(rgb), lumaAces(rgb), p[${GPU_PARAMS.HDR_LANE}] > 0.5);
    }
    fn filmSignalFromLuma(value: f32) -> f32 {
      return select(srgbEncode(clamp(value, 0.0, 1.0)), filmHdrEncodeLuma(max(value, 0.0)), p[${GPU_PARAMS.HDR_LANE}] > 0.5);
    }
    fn filmLumaFromSignal(value: f32) -> f32 {
      return select(srgbDecode(clamp(value, 0.0, 1.0)), filmHdrDecodeLuma(value), p[${GPU_PARAMS.HDR_LANE}] > 0.5);
    }
    // Film stock: the chain F of backend/hdr_finisher/film_stock.py on the
    // stock's baked tables, read from the lane's slot of filmStock. Lookups
    // are clamped linear (1D, 256 samples) and clamped trilinear (3D) with the
    // CPU's float32 scales, and every blend is a + (b - a) * t as there.
    fn stockLerp(a: vec3f, b: vec3f, t: f32) -> vec3f { return a + (b - a) * t; }
    fn stockVec3(at: u32) -> vec3f { return vec3f(filmStock[at], filmStock[at + 1u], filmStock[at + 2u]); }
    fn stockLog10(value: vec3f) -> vec3f { return log2(value) * 0.30102999566398120; }
    fn stockCurveChannel(curve: u32, channel: u32, position: f32) -> f32 {
      let index = min(u32(position), ${FILM_STOCK.curveSamples - 2}u);
      let at = curve + index * 3u + channel;
      let a = filmStock[at];
      return a + (filmStock[at + 3u] - a) * (position - f32(index));
    }
    fn stockCurve(curve: u32, low: f32, scale: f32, value: vec3f) -> vec3f {
      let position = clamp((value - vec3f(low)) * scale, vec3f(0.0), vec3f(${FILM_STOCK.curveSamples - 1}.0));
      return vec3f(stockCurveChannel(curve, 0u, position.x), stockCurveChannel(curve, 1u, position.y), stockCurveChannel(curve, 2u, position.z));
    }
    fn stockTable(base: u32, header: u32, value: vec3f) -> vec3f {
      let size = u32(filmStock[base + header]);
      let values = base + u32(filmStock[base + header + 1u]);
      let position = clamp((value - stockVec3(base + header + 2u)) * stockVec3(base + header + 5u), vec3f(0.0), vec3f(f32(size - 1u)));
      let index = min(vec3u(position), vec3u(size - 2u));
      let t = position - vec3f(index);
      let stride0 = size * size * 3u;
      let stride1 = size * 3u;
      let corner = values + ((index.x * size + index.y) * size + index.z) * 3u;
      let near = stockLerp(
        stockLerp(stockVec3(corner), stockVec3(corner + 3u), t.z),
        stockLerp(stockVec3(corner + stride1), stockVec3(corner + stride1 + 3u), t.z),
        t.y,
      );
      let far = stockLerp(
        stockLerp(stockVec3(corner + stride0), stockVec3(corner + stride0 + 3u), t.z),
        stockLerp(stockVec3(corner + stride0 + stride1), stockVec3(corner + stride0 + stride1 + 3u), t.z),
        t.y,
      );
      return stockLerp(near, far, t.x);
    }
    // Linear sRGB -> film layer exposure -> developed density (two passes
    // for the DIR couplers). film_stock.py _film_exposure and _film_density.
    fn stockDensity(base: u32, rgb: vec3f, exposureGain: f32) -> vec3f {
      let matrix = base + ${STOCK.INPUT_MATRIX}u;
      let exposure = max(vec3f(
        dot(stockVec3(matrix), rgb), dot(stockVec3(matrix + 3u), rgb), dot(stockVec3(matrix + 6u), rgb),
      ), vec3f(0.0)) * exposureGain;
      let logExposure = stockLog10(exposure + vec3f(1e-10));
      let gamma = p[${GPU_PARAMS.FILM_DEVELOPMENT_GAMMA}];
      if (filmStock[base + ${STOCK.SCAN_FILM}u] >= 2.0) { return logExposure * gamma; }
      let low = filmStock[base + ${STOCK.FILM_LOW}u];
      let scale = filmStock[base + ${STOCK.FILM_SCALE}u];
      var first = stockCurve(base + ${STOCK.FILM_CURVES_PLAIN}u, low, scale, logExposure * gamma);
      if (filmStock[base + ${STOCK.SCAN_FILM}u] == 1.0) { first = stockVec3(base + ${STOCK.FILM_DENSITY_MAX}u) - first; }
      let shifted = first + filmStock[base + ${STOCK.COUPLER_SHIFT}u] * first * first;
      let couplers = base + ${STOCK.COUPLER_MATRIX}u;
      let correction = shifted.x * stockVec3(couplers) + shifted.y * stockVec3(couplers + 3u) + shifted.z * stockVec3(couplers + 6u);
      return stockCurve(base + ${STOCK.FILM_CURVES_CORRECTED}u, low, scale, (logExposure - correction) * gamma);
    }
    // Film density -> print exposure (with the enlarger filter shifts and
    // preflash) -> print density -> scanned linear sRGB. _print_and_scan.
    fn stockPrintDensity(base: u32, density: vec3f, printGain: f32) -> vec3f {
      if (filmStock[base + ${STOCK.SCAN_FILM}u] == 1.0) { return density; }
      let printLog = select(stockTable(base, ${STOCK.PRINT_TABLE}u, density), -density, filmStock[base + ${STOCK.SCAN_FILM}u] >= 2.0)
        + (p[${GPU_PARAMS.FILM_STOCK_WARMTH}] * stockVec3(base + ${STOCK.PRINT_WARMTH_SHIFT}u)
          + p[${GPU_PARAMS.FILM_STOCK_TINT}] * stockVec3(base + ${STOCK.PRINT_TINT_SHIFT}u));
      let printRaw = exp2(printLog * 3.32192809488736235) * printGain + p[${GPU_PARAMS.FILM_STOCK_PREFLASH}] * stockVec3(base + ${STOCK.PREFLASH_RAW}u);
      let printDensity = stockCurve(
        base + ${STOCK.PRINT_CURVES}u, filmStock[base + ${STOCK.PRINT_LOW}u], filmStock[base + ${STOCK.PRINT_SCALE}u],
        stockLog10(printRaw + vec3f(1e-10)),
      );
      return printDensity;
    }
    fn stockPrintScan(base: u32, density: vec3f, printGain: f32) -> vec3f {
      let paper = stockPrintDensity(base, density, printGain);
      if (filmStock[base + ${STOCK.SCAN_FILM}u] != 2.0) { return stockTable(base, ${STOCK.SCAN_TABLE}u, paper); }
      // Invert the same monotone 256-sample ideal paper as the CPU. Eight
      // bisections bracket one interval; no extra tables or GPU limits.
      var result = vec3f(0.0);
      for (var c = 0u; c < 3u; c++) {
        let offset = base + ${STOCK.FILM_CURVES_PLAIN}u + c;
        var lo = 0u; var hi = 255u;
        for (var step = 0u; step < 8u; step++) {
          let mid = (lo + hi) / 2u;
          if (filmStock[offset + mid*3u] <= paper[c]) { lo = mid; } else { hi = mid; }
        }
        let a = filmStock[offset + lo*3u];
        let b = filmStock[offset + hi*3u];
        let t = clamp((paper[c]-a)/max(b-a,1e-20),0.0,1.0);
        let position = f32(lo) + t*f32(hi-lo);
        let logE = filmStock[base + ${STOCK.FILM_LOW}u] + position/filmStock[base + ${STOCK.FILM_SCALE}u];
        result[c] = exp2(-logE * 3.32192809488736235);
      }
      // The ideal scanner has no physical white. Saturate extreme signals
      // to white before ACES/half-float cancellation can create false colour.
      // Keep in sync with film_stock.py scan_density; measured stocks bypass it.
      if (any(result > vec3f(16.0))) { result = vec3f(16.0); }
      let levels = stockVec3(base + ${STOCK.FILM_DENSITY_MAX}u);
      if (levels.z > 0.5) {
        let y = dot(result, vec3f(.2126,.7152,.0722));
        result *= clamp(levels.x*y+levels.y,0.0,1.0)/(y+1e-10);
      }
      return result;
    }
    // HDR keeps reference white at 0.18 and its generated SDR is the scene times
    // (100 / 203) / 0.18, so the film is exposed on the SDR scale in both lanes.
    fn stockLaneScale() -> f32 { return select(1.0, 2.7367268, p[${GPU_PARAMS.HDR_LANE}] > 0.5); }
    fn stockToSrgb(rgb: vec3f) -> vec3f { return select(rgb, acescgToSrgb(rgb) * stockLaneScale(), p[${GPU_PARAMS.HDR_LANE}] > 0.5); }
    fn stockFromSrgb(rgb: vec3f) -> vec3f {
      // Match colour.py's CAT02 conversion used by the exact stock reference.
      // The general shader conversion predates the physical stock chain and
      // has different coefficients; stronger development exposes that error.
      let aces = vec3f(
        dot(rgb, vec3f(.613117812906,.341181995856,.045787344282)),
        dot(rgb, vec3f(.069934082308,.918103037509,.011932775530)),
        dot(rgb, vec3f(.020462992638,.106768663383,.872715910619)));
      return select(rgb, aces / stockLaneScale(), p[${GPU_PARAMS.HDR_LANE}] > 0.5);
    }
    // adjustments.py _apply_film_stock, in the branch's working space. Above
    // reference white (1.0 on the SDR scale) colour is evaluated at white and the tone gain is
    // held, so HDR highlights keep their ratios. The grey (Y, Y, Y) and the
    // middle grey (0.18, 0.18, 0.18) are converted to sRGB like the pixel.
    fn filmStockStage(rgb: vec3f, densityDelta: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.FILM_STOCK_SLOT}] < 0.5) { return rgb; }
      let base = (u32(p[${GPU_PARAMS.FILM_STOCK_SLOT}] + 0.5) - 1u) * ${FILM_STOCK.slotFloats}u;
      let color = p[${GPU_PARAMS.FILM_STOCK_COLOR}];
      let tone = p[${GPU_PARAMS.FILM_STOCK_TONE}];
      let referenceWhite = 1.0 / stockLaneScale();
      let middleGrey = 0.18 / stockLaneScale();
      // Calibrate at zero camera/print EV, independently of the picture.
      let middle = stockFromSrgb(stockPrintScan(base, stockDensity(base, stockToSrgb(vec3f(middleGrey)), 1.0), 1.0));
      let neutral = filmStock[base + ${STOCK.SCAN_FILM}u] >= 2.0;
      let delta = select(densityDelta, -densityDelta, neutral);
      let toneGain = select(middleGrey / max(filmLuma(middle), 0.000001), 1.0, neutral);
      let luma = max(filmLuma(rgb), 0.0);
      let highlightScale = referenceWhite / max(luma, referenceWhite);
      let greyDensity = stockDensity(base, stockToSrgb(vec3f(luma * highlightScale)), p[${GPU_PARAMS.FILM_STOCK_EXPOSURE_GAIN}]);
      let cleanGreyLuma = max(filmLuma(stockFromSrgb(stockPrintScan(base, greyDensity, p[${GPU_PARAMS.FILM_PRINT_EXPOSURE_GAIN}]))), 0.000001);
      var greyLuma = cleanGreyLuma;
      if (any(densityDelta != vec3f(0.0))) {
        greyLuma = max(filmLuma(stockFromSrgb(stockPrintScan(base, greyDensity + delta, p[${GPU_PARAMS.FILM_PRINT_EXPOSURE_GAIN}]))), 0.000001);
      }
      let toneTarget = (luma + (toneGain * cleanGreyLuma / highlightScale - luma) * tone) * (greyLuma / cleanGreyLuma);
      var result = rgb * (toneTarget / max(luma, 0.0000001));
      if (color > 0.0) {
        var density = stockDensity(base, stockToSrgb(rgb * highlightScale), p[${GPU_PARAMS.FILM_STOCK_EXPOSURE_GAIN}]);
        if (p[${GPU_PARAMS.FILM_STOCK_SEPARATION_GAIN}] != 1.0) {
          density = greyDensity + (density - greyDensity) * p[${GPU_PARAMS.FILM_STOCK_SEPARATION_GAIN}];
        }
        let stocked = stockFromSrgb(stockPrintScan(base, density + delta, p[${GPU_PARAMS.FILM_PRINT_EXPOSURE_GAIN}])) * (toneTarget / greyLuma);
        result += (stocked - result) * color;
      }
      return result;
    }
      // Clip in the delivery primaries so the selected target is also a hard
    // per-channel ceiling in the encoded signal.
    fn clipToOutputTarget(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.HDR_LANE}] > 0.5) {
        var result = bt2020ToAcescg(clamp(acescgToBt2020(input), vec3f(0.0), vec3f(p[${GPU_PARAMS.HIGHLIGHT_TARGET}])));
        // Check after the matrix round trip and the nits conversion. Curves
        // keep their existing parameters; only an actual overshoot changes.
        let targetNits = p[${GPU_PARAMS.HIGHLIGHT_TARGET_NITS}];
        let reference = p[${GPU_PARAMS.PROJECT_REFERENCE_WHITE_NITS}];
        var transport = acescgToBt2020(result);
        var peak = max(max(transport.r, transport.g), transport.b) / 0.18 * reference;
        while (peak > targetNits) {
          let gain = min(targetNits / peak, 1.0);
          result *= bitcast<f32>(bitcast<u32>(gain) - 1u);
          transport = acescgToBt2020(result);
          peak = max(max(transport.r, transport.g), transport.b) / 0.18 * reference;
        }
        return result;
      }
      return compressSrgbGamut(input);
    }
    // The shoulder shapes the picture and the ceiling guarantees the delivery
    // spec. A shoulder anchored on a measured peak cannot promise the target on
    // its own, because ringing and grain samples sit above the picture it fits.
    fn fixedCap(input: vec3f, hdr: bool) -> vec3f {
      let transport = select(input, acescgToBt2020(input), hdr);
      let signal = max(max(max(transport.r, transport.g), transport.b), 0.0);
      let knee = p[${GPU_PARAMS.HIGHLIGHT_START}];
      if (signal <= knee) { return input; }
      let capTarget = select(1.0, p[${GPU_PARAMS.HIGHLIGHT_TARGET}], hdr);
      let span = capTarget - knee;
      let mapped = min(knee + span * (1.0 - exp(-(signal-knee)/span)), capTarget);
      return input * min(mapped/signal, 1.0);
    }
    fn outputIsHdr() -> bool {
      return p[${GPU_PARAMS.HDR_LANE}] > 0.5 && p[${GPU_PARAMS.LINKED_SDR}] < 0.5;
    }
    fn applyOutputExposure(input: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.LINKED_SDR}] > 0.5) {
        return acescgToSrgb(input) * (100.0 / 203.0 / 0.18) * p[${GPU_PARAMS.OUTPUT_EXPOSURE_GAIN}];
      }
      return input * p[${GPU_PARAMS.OUTPUT_EXPOSURE_GAIN}];
    }
    fn applyOutputHighlights(input: vec3f) -> vec3f {
      let mode = p[${GPU_PARAMS.HIGHLIGHT_MODE}];
      let hdr = outputIsHdr();
      if (!hdr) {
        var result = input;
        if (mode == 4.0) { result = fixedCap(input, false); }
        else if (mode == 3.0) { result = clamp(input, vec3f(0.0), vec3f(1.0)); }
        else if (mode > 0.5) { result = sdrPeakFit(sdrSoftCeiling(input)); }
        return compressSrgbGamut(result);
      }
      if (mode < 0.5) { return input; }
      if (mode == 4.0) { return clipToOutputTarget(fixedCap(input, true)); }
      if (mode == 3.0) { return clipToOutputTarget(input); }
      return clipToOutputTarget(hdrPeakFit(hdrSoftCeiling(input)));
    }
    // The tile work texture is allocated once at the largest tile plus halo and
    // reused, so an edge tile's valid region is smaller than the texture it
    // lives in. Every neighbourhood read has to clamp to the valid region, or
    // an edge tile samples whatever the previous tile left behind.
    fn validTileDimensions() -> vec2i {
      let textureSize = vec2i(textureDimensions(sourceTexture));
      if (arrayLength(&p) > ${GPU_PARAMS.TILE_VALID_HEIGHT}u && p[${GPU_PARAMS.TILE_VALID_WIDTH}] > 0.0 && p[${GPU_PARAMS.TILE_VALID_HEIGHT}] > 0.0) {
        return min(textureSize, vec2i(i32(p[${GPU_PARAMS.TILE_VALID_WIDTH}]), i32(p[${GPU_PARAMS.TILE_VALID_HEIGHT}])));
      }
      return textureSize;
    }

    // The whole picture's size, which is not this tile's size. Any radius
    // expressed as a fraction of the frame -- or as a physical distance on the
    // film plane -- has to be derived from this, or a tile would compute a
    // different radius than the Direct render of the same grade.
    fn frameDimensions() -> vec2f {
      if (arrayLength(&p) > ${GPU_PARAMS.FRAME_HEIGHT}u && p[${GPU_PARAMS.FRAME_WIDTH}] > 0.0 && p[${GPU_PARAMS.FRAME_HEIGHT}] > 0.0) {
        return vec2f(p[${GPU_PARAMS.FRAME_WIDTH}], p[${GPU_PARAMS.FRAME_HEIGHT}]);
      }
      return vec2f(textureDimensions(sourceTexture));
    }

    // This pixel's position in the whole picture. Vignette is placed against
    // the frame and grain is a fixed field over it, so both must ask where they
    // are in the frame, not where they are in the tile. Direct leaves the tile
    // origin at zero, which makes this the identity.
    fn frameCoordinate(coordinate: vec2i) -> vec2i {
      if (arrayLength(&p) > ${GPU_PARAMS.TILE_ORIGIN_Y}u) {
        return coordinate + vec2i(i32(p[${GPU_PARAMS.TILE_ORIGIN_X}]), i32(p[${GPU_PARAMS.TILE_ORIGIN_Y}]));
      }
      return coordinate;
    }

    fn boundedCoordinate(coordinate: vec2i) -> vec2i {
      return clamp(coordinate, vec2i(0), validTileDimensions() - vec2i(1));
    }
    fn sampleFilm(coordinate: vec2i) -> vec3f {
      return textureLoad(sourceTexture, boundedCoordinate(coordinate), 0).rgb;
    }
    fn outputRelativeOffset(percentDiagonal: f32, maximumRadius: i32) -> i32 {
      let dimensions = frameDimensions();
      return clamp(i32(round(length(dimensions) * max(percentDiagonal, 0.0) / 100.0)), 1, maximumRadius);
    }
    fn filmPixelsPerMm(dimensions: vec2f) -> f32 {
      var pixelsPerMm = max(dimensions.x / p[${GPU_PARAMS.FILM_GATE_WIDTH_MM}], dimensions.y / p[${GPU_PARAMS.FILM_GATE_HEIGHT_MM}]);
      if (p[${GPU_PARAMS.FILM_GATE_AXIS}] > 0.5 && p[${GPU_PARAMS.FILM_GATE_AXIS}] < 1.5) { pixelsPerMm = dimensions.y / p[${GPU_PARAMS.FILM_GATE_HEIGHT_MM}]; }
      if (p[${GPU_PARAMS.FILM_GATE_AXIS}] > 1.5) { pixelsPerMm = dimensions.x / p[${GPU_PARAMS.FILM_GATE_WIDTH_MM}]; }
      return pixelsPerMm;
    }
    fn filmPhysicalOffset(percent35mmDiagonal: f32, maximumRadius: i32) -> i32 {
      let dimensions = frameDimensions();
      let radiusMm = 43.2666153 * max(percent35mmDiagonal, 0.0) / 100.0;
      return clamp(i32(round(filmPixelsPerMm(dimensions) * radiusMm)), 1, maximumRadius);
    }
    // The detail low-pass behind Image Softness, Microcontrast and Film
    // Resolution. It used to be a nine-sample star: a centre and eight taps on
    // the axes and diagonals, each carrying a twelfth of the weight. Nothing
    // filled the space between them, so a bright point came back as itself
    // plus eight separate copies at 8.3% -- a faint cross rather than a blur.
    // It is the same defect the spatial kernel had, at a tenth of the radius.
    //
    // Sigma is 0.7 of the radius, measured: at that width Image Softness,
    // Microcontrast and Film Resolution move a frame within 0.3% of what the
    // star moved it, so the presets keep their tuning. Truncation stays on the
    // same +/- radius square the halo already reserves, which leaves about a
    // third of the peak weight at the boundary -- the cost of holding the
    // star's width on the star's support, since the star carried its width by
    // putting weight at exactly +/- radius. The response still falls
    // monotonically, so the cutoff reads as a glow that ends, not as a rim.
    const filmDetailBlock = vec2i(${FILM_DETAIL_BLOCK.width}, ${FILM_DETAIL_BLOCK.height});
    const filmResolutionMaxRadius = 32;
    var<workgroup> filmDetailWeights: array<f32, filmResolutionMaxRadius + 1>;
    var<workgroup> filmDetailRows: array<vec3f, filmDetailBlock.x * (filmDetailBlock.y + 2 * filmResolutionMaxRadius)>;
    fn filmDetailTap(coordinate: vec2i, bound: vec2i, stored: bool) -> vec3f {
      let texel = textureLoad(sourceTexture, clamp(coordinate, vec2i(0), bound), 0);
      return select(texel.rgb, filmStoredRgb(texel), stored);
    }
    fn filmDetailBlur(coordinate: vec2i, local: vec2i, bound: vec2i, radius: i32, stored: bool) -> vec3f {
      let weightIndex = local.y * filmDetailBlock.x + local.x;
      if (weightIndex <= radius) {
        let sigma = max(f32(radius), 1.0) * 0.7;
        filmDetailWeights[weightIndex] = exp(-f32(weightIndex * weightIndex) / (2.0 * sigma * sigma));
      }
      workgroupBarrier();
      for (var row = local.y; row < filmDetailBlock.y + 2 * radius; row += filmDetailBlock.y) {
        let center = vec2i(coordinate.x, coordinate.y - local.y + row - radius);
        var horizontal = filmDetailTap(center, bound, stored);
        for (var offset = 1; offset <= radius; offset++) {
          let step = vec2i(offset, 0);
          horizontal += (filmDetailTap(center - step, bound, stored)
            + filmDetailTap(center + step, bound, stored)) * filmDetailWeights[offset];
        }
        filmDetailRows[row * filmDetailBlock.x + local.x] = horizontal;
      }
      workgroupBarrier();
      let center = (local.y + radius) * filmDetailBlock.x + local.x;
      var vertical = filmDetailRows[center];
      var weightTotal = 1.0;
      for (var offset = 1; offset <= radius; offset++) {
        let step = offset * filmDetailBlock.x;
        let weight = filmDetailWeights[offset];
        vertical += (filmDetailRows[center - step] + filmDetailRows[center + step]) * weight;
        weightTotal += 2.0 * weight;
      }
      return vertical / (weightTotal * weightTotal);
    }
    fn filmHighlightMask(rgb: vec3f, sensitivity: f32) -> f32 {
      let threshold = 0.92 - 0.50 * clamp(sensitivity, 0.0, 1.0);
      return smoothRange(threshold, threshold + 0.16, filmSignalFromLuma(max(filmLuma(rgb), 0.0)));
    }
    fn qualifiedSample(coordinate: vec2i, sensitivity: f32) -> vec3f {
      let rgb = sampleFilm(coordinate);
      return rgb * filmHighlightMask(rgb, sensitivity);
    }

    fn qualifiedLuma(coordinate: vec2i, sensitivity: f32) -> f32 {
      let rgb = sampleFilm(coordinate);
      return max(filmLuma(rgb), 0.0) * filmHighlightMask(rgb, sensitivity);
    }
    fn halationEdgeSource(coordinate: vec2i, sensitivity: f32, edgeRadius: i32) -> f32 {
      let center = qualifiedLuma(coordinate, sensitivity);
      let neighbourMean = (
        qualifiedLuma(coordinate + vec2i(edgeRadius, 0), sensitivity)
        + qualifiedLuma(coordinate + vec2i(-edgeRadius, 0), sensitivity)
        + qualifiedLuma(coordinate + vec2i(0, edgeRadius), sensitivity)
        + qualifiedLuma(coordinate + vec2i(0, -edgeRadius), sensitivity)
      ) * 0.25;
      let relativeEdge = max(center - neighbourMean, 0.0) / (center + 0.02);
      return center * smoothRange(0.004, 0.12, relativeEdge);
    }

    fn packedQualifiedSample(coordinate: vec2f) -> vec4f {
      let pixel = vec2i(coordinate);
      let rgb = sampleFilm(pixel);
      let halationRadius = filmPhysicalOffset(p[${GPU_PARAMS.HALATION_RADIUS}], 256);
      let edgeRadius = clamp(halationRadius / 4, 1, 16);
      let halation = halationEdgeSource(pixel, 0.75, edgeRadius) * select(0.0, 1.0, p[${GPU_PARAMS.HALATION_ENABLED}] > 0.5);
      return vec4f(vec3f(0.0), halation);
    }
    // The spatial intermediates are a quarter-resolution grid anchored to the
    // frame at a strict factor of four, rather than a proportional rescale of
    // whatever texture they happen to live in. That is what lets a tile's grid
    // coincide with the frame's: with a halo that is a multiple of four, a
    // tile's texel j is the frame's texel j + haloRect.x / 4, covering the same
    // four source pixels the Direct render covered.
    // Frame pixels per spatial texel: 1, 2 or 4 by the frame's long edge, so
    // the default halation glow spans about two texels or more at every size
    // (NEXT-01 #1). Mirrors HDRGraphScale.spatialGridScale; tile halos are
    // multiples of four, so a tile's grid lines up with the frame's at every
    // scale.
    fn spatialScale() -> f32 {
      let longEdge = max(frameDimensions().x, frameDimensions().y);
      return select(select(1.0, 2.0, longEdge >= 2048.0), 4.0, longEdge >= 4096.0);
    }

    fn validSpatialDimensions() -> vec2i {
      return vec2i(ceil(vec2f(validTileDimensions()) / spatialScale()));
    }

    fn frameSpatialDimensions() -> vec2f {
      return ceil(frameDimensions() / spatialScale());
    }

    // Sampling is in texel coordinates, not in normalized uv, because the
    // texture an edge tile lives in is larger than its valid region: the clamp
    // has to stop at the last valid texel's centre and not at the texture's.
    fn sampleSpatialTexel(texel: vec2f) -> vec4f {
      let texture = vec2f(textureDimensions(spatialTexture));
      let valid = vec2f(validSpatialDimensions());
      let clamped = clamp(texel, vec2f(0.5), max(valid - vec2f(0.5), vec2f(0.5)));
      return textureSampleLevel(spatialTexture, spatialSampler, clamped / texture, 0.0);
    }
    // The kernel is the same truncated Gaussian it has always been,
    // exp(-4.5 * (offset / radius)^2) out to +/- the radius. What matters is
    // how densely it is sampled: a separable pass whose taps are further than
    // one texel apart does not blur, it reprints the source once per tap, and
    // the horizontal and vertical passes multiply those copies into a grid.
    // A fixed nine taps hold together only while the radius is about four
    // texels, which is why a draft looked clean and Full echoed -- the radius
    // grows with the frame while the tap count did not.
    fn spatialGaussianWeight(offset: f32, radius: f32) -> f32 {
      let normalized = offset / max(radius, 0.0001);
      return exp(-4.5 * normalized * normalized);
    }

    // Whole texels, addressed by index. The obvious optimisation here is to
    // read taps in pairs through the linear sampler, which halves the fetch
    // count for the same kernel, but it cannot be used: a sampler is addressed
    // in normalised uv, so every tap divides by the texture's size and the
    // sampler multiplies it back, and a tile's texture is not the frame's
    // size. On a tap that lands exactly on a texel centre that round trip
    // rounds one way for the frame and the other way for a tile, which leaves
    // a sub-LSB difference in the blur. Most of the picture absorbs it. A
    // pixel sitting on a knife edge in the tone map downstream does not, and
    // Direct and Tiled then disagree by a whole channel on a handful of
    // pixels. textureLoad takes an integer texel and has no such round trip,
    // so the two agree bit for bit at every radius.
    fn loadSpatialTexel(texel: vec2i) -> vec4f {
      return textureLoad(spatialTexture, clamp(texel, vec2i(0), validSpatialDimensions() - vec2i(1)), 0);
    }

    // The furthest tap lands at floor(radius), never past it. A tile's halo is
    // reserved from the radius, and a tap beyond it reads a texel the tile
    // does not hold.
    fn spatialGaussianAxis(direction: vec2f, coordinate: vec2f, radius: f32) -> vec4f {
      let extent = i32(floor(max(radius, 0.0)));
      let base = vec2i(floor(coordinate));
      let step = vec2i(direction);
      var total = loadSpatialTexel(base);
      var weightTotal = 1.0;
      for (var index: i32 = 1; index <= extent; index = index + 1) {
        let weight = spatialGaussianWeight(f32(index), radius);
        total += (loadSpatialTexel(base + step * index) + loadSpatialTexel(base - step * index)) * weight;
        weightTotal += 2.0 * weight;
      }
      return total / weightTotal;
    }

    fn spatialBlur(direction: vec2f, coordinate: vec2f) -> vec4f {
      // Bloom is an output-relative optical finish. Halation is a film-plane
      // distance and shares Film Format/capture geometry with grain and MTF.
      // Both are properties of the picture, so both are derived from the
      // frame's quarter-resolution size and not from this tile's.
      // The CPU/export cap of 256 full-resolution pixels is 256 / scale
      // samples in this texture.
      let frameSpatial = frameSpatialDimensions();
      let blurCap = 256.0 / spatialScale();
      let halationRadiusMm = 43.2666153 * max(p[${GPU_PARAMS.HALATION_RADIUS}], 0.0) / 100.0;
      let halationRadius = clamp(filmPixelsPerMm(frameSpatial) * halationRadiusMm, 0.25, blurCap);
      // The two effects carry different radii in the same packed texture, so
      // each walks its own kernel. An inactive effect's channels are already
      // zero out of the extract pass and are not worth walking.
      var result = vec4f(0.0);
      if (p[${GPU_PARAMS.HALATION_ENABLED}] > 0.5) {
        result.a = spatialGaussianAxis(direction, coordinate, halationRadius).a;
      }
      return result;
    }
    // Same seeded, box-filtered tent field as backend film_grain.py.
    fn grainMix(value: u32) -> u32 {
      var x = value;
      x = x ^ (x >> 16u);
      x = x * 0x7feb352du;
      x = x ^ (x >> 15u);
      x = x * 0x846ca68bu;
      x = x ^ (x >> 16u);
      return x;
    }
    fn grainSeed(salt: u32) -> u32 {
      // The seed arrives split in 16-bit halves, which f32 carries exactly.
      let seed = u32(p[${GPU_PARAMS.GRAIN_SEED_LOW}]) | (u32(p[${GPU_PARAMS.GRAIN_SEED_HIGH}]) << 16u);
      return grainMix(seed + salt * 0x9e3779b9u);
    }
    fn grainTentCdf(x: vec4f) -> vec4f {
      let edge = 1.0 - min(abs(x), vec4f(1.0));
      let area = 0.5 * edge * edge;
      return select(1.0 - area, area, x < vec4f(0.0));
    }
    fn grainMix4(value: vec4u) -> vec4u {
      var x = value;
      x = (x ^ (x >> vec4u(16u))) * 0x7feb352du;
      x = (x ^ (x >> vec4u(15u))) * 0x846ca68bu;
      return x ^ (x >> vec4u(16u));
    }
    fn grainFootprint(frame: vec2f, pitch: f32, salt: u32) -> vec2f {
      let centre = frame / pitch;
      let halfBox = vec2f(0.5 / pitch);
      let first = vec2i(floor(centre - halfBox));
      let last = vec2i(ceil(centre + halfBox));
      let seeded = grainSeed(salt);
      var field = vec2f(0.0);
      for (var y = first.y; y <= last.y; y++) {
        let rowKey = bitcast<u32>(y);
        var row = vec2f(0.0);
        for (var x = first.x; x <= last.x; x += 4) {
          let nodes = vec4i(x) + vec4i(0, 1, 2, 3);
          let delta = centre.x - vec4f(nodes);
          let weight = (grainTentCdf(delta + halfBox.x) - grainTentCdf(delta - halfBox.x)) * pitch;
          let hash = grainMix4(grainMix4(vec4u(seeded) ^ bitcast<vec4u>(nodes)) ^ vec4u(rowKey));
          let value = vec4f(hash >> vec4u(8u)) * (1.0 / 8388608.0) - 1.0;
          let square = value * value;
          row += vec2f(dot(select(square, -square, value < vec4f(0.0)), weight),
                       dot(square - 1.0 / 3.0, weight));
        }
        let delta = vec4f(centre.y - f32(y));
        let weight = (grainTentCdf(delta + halfBox.y) - grainTentCdf(delta - halfBox.y)) * pitch;
        field += row * weight.x;
      }
      return field;
    }
    fn grainLayerNoise(frame: vec2f, pitch: f32, scale: f32, signal: f32, salt: u32, mono: bool) -> f32 {
      let field = grainFootprint(frame, pitch, salt);
      let inv = 1.0 - signal;
      let skew = 1.35 * inv * inv - select(0.42, 0.95, mono) * signal;
      let nativeGain = length(vec2f(1.0, 0.58 * scale / pitch));
      let normal = 3.35 * nativeGain / sqrt(1.0 + (4.0 / 9.0) * skew * skew);
      let develop = 0.06 + 0.88 * signal;
      let contrast = sqrt(sqrt(develop / 0.5)) * (1.0 - select(0.40, 0.58, mono) * (develop - 0.5));
      return (field.x + skew * field.y) * (normal * contrast);
    }
    fn filmModuleActive() -> bool {
      return p[${GPU_PARAMS.FILM_LOOK_ENABLED}] > 0.5 && p[${GPU_PARAMS.FILM_FINISH_STRENGTH}] > 0.0
        && p[${GPU_PARAMS.FILM_RESPONSE_ENABLED}] >= 0.5 && p[${GPU_PARAMS.FILM_LOOK_STRENGTH}] > 0.0
        && (p[${GPU_PARAMS.FILM_STOCK_SLOT}] > 0.5 || p[${GPU_PARAMS.SCAN_SHARPENING}] > 0.0
          || p[${GPU_PARAMS.HALATION_ENABLED}] > 0.5
          || (p[${GPU_PARAMS.LENS_FILTER}] > 0.5 && p[${GPU_PARAMS.LENS_SCATTER}] > 0.0)
          || p[${GPU_PARAMS.FILM_RESOLUTION}] < 1.0
          || (p[${GPU_PARAMS.GRAIN_ENABLED}] > 0.5 && (p[${GPU_PARAMS.GRAIN_AMOUNT}] > 0.0 || p[${GPU_PARAMS.GRAIN_VIEW_MAP}] > 0.5)));
    }
    fn filmGrainStops(rgb: vec3f, coordinate: vec2i, master: f32) -> vec3f {
      if (p[${GPU_PARAMS.GRAIN_ENABLED}] < 0.5 || p[${GPU_PARAMS.GRAIN_AMOUNT}] <= 0.0) { return vec3f(0.0); }
      let scale = clamp(p[${GPU_PARAMS.SOURCE_PIXEL_SCALE}], 0.05, 1.0);
      let pixelsPerMm = filmPixelsPerMm(frameDimensions());
      let physicalPitch = pixelsPerMm * (6.0 + 24.0 * p[${GPU_PARAMS.GRAIN_SIZE}]) / 1000.0;
      let pixelCoverage = min(1.0, physicalPitch / scale);
      let frame = vec2f(frameCoordinate(coordinate)) + vec2f(0.5);
      let signal = clamp(filmSignalFromLuma(max(filmLuma(rgb), 0.0)), 0.0, 1.0);
      // Color negative: three dye layers, blue coarsest, each developed by
      // its own channel. Black & white: one layer of sharper, denser silver.
      let blackAndWhite = p[${GPU_PARAMS.GRAIN_FILM_TYPE}] > 0.5;
      let spacing = 0.43 * (1.11 - 0.22 * p[${GPU_PARAMS.GRAIN_SOFTNESS}]);
      // Both lanes develop the same grains (_grain_development_signals in
      // adjustments.py): HDR in sRGB primaries, reference white scaled onto
      // SDR's, encoded as SDR is, and fully developed by signal 0.45 before
      // the lanes' tone curves part. Otherwise the gain map fills with grain.
      let developLinear = select(rgb, acescgToSrgb(rgb) * 2.7367268, p[${GPU_PARAMS.HDR_LANE}] > 0.5);
      let developLuma = clamp(srgbEncode(clamp(lumaSrgb(developLinear), 0.0, 1.0)) / 0.45, 0.0, 1.0);
      var grain = vec3f(0.0);
      if (blackAndWhite) {
        let silverPitch = max(scale, physicalPitch);
        var silver = grainLayerNoise(frame, spacing * silverPitch, scale, developLuma, 239u, true);
        if (developLuma < 1.0) {
          let shadow = 1.0 - developLuma;
          silver += ((3.35 * 0.46) * (shadow * shadow)) * grainFootprint(frame, 1.5 * silverPitch, 341u).x;
        }
        grain = vec3f(silver);
      } else {
        let developRgb = clamp(developLinear, vec3f(0.0), vec3f(1.0));
        let channelSignal = clamp(
          vec3f(srgbEncode(developRgb.r), srgbEncode(developRgb.g), srgbEncode(developRgb.b)) / 0.45, vec3f(0.0), vec3f(1.0)
        );
        let layers = vec3f(
          grainLayerNoise(frame, spacing * max(scale, physicalPitch * 0.9), scale, channelSignal.r, 211u, false),
          grainLayerNoise(frame, spacing * max(scale, physicalPitch), scale, channelSignal.g, 223u, false),
          grainLayerNoise(frame, spacing * max(scale, physicalPitch * 1.3), scale, channelSignal.b, 227u, false)
        );
        let weights = vec3f(0.2126, 0.7152, 0.0722);
        let mono = dot(layers, weights) / length(weights);
        // Color separation fades toward monochrome as highlights approach clipping.
        let chroma = p[${GPU_PARAMS.GRAIN_CHROMA}] * (1.0 - 0.8 * smoothRange(0.88, 1.0, signal));
        grain = vec3f(mono) + chroma * 0.6 * (layers - vec3f(mono));
      }
      grain *= 0.37;
      let shadowWeight = pow(1.0 - signal, 2.0);
      let highlightWeight = pow(signal, 2.0);
      let midWeight = max(0.0, 1.0 - shadowWeight - highlightWeight);
      let response = shadowWeight * p[${GPU_PARAMS.GRAIN_SHADOW_RESPONSE}] + midWeight * p[${GPU_PARAMS.GRAIN_MIDTONE_RESPONSE}] + highlightWeight * p[${GPU_PARAMS.GRAIN_HIGHLIGHT_RESPONSE}];
      let amount = 0.18 * p[${GPU_PARAMS.GRAIN_AMOUNT}] * master * response * pixelCoverage;
      return grain * amount;
    }
    // Integer texel reads avoid texture-size-dependent normalized sampler
    // rounding between a frame and a tile. The interpolation is unchanged.
    fn sampleLensTexel(texel: vec2f) -> vec3f {
      let point = texel - vec2f(0.5);
      let base = vec2i(floor(point));
      let blend = fract(point);
      return mix(mix(loadSpatialTexel(base).rgb, loadSpatialTexel(base+vec2i(1,0)).rgb, blend.x),
        mix(loadSpatialTexel(base+vec2i(0,1)).rgb, loadSpatialTexel(base+vec2i(1,1)).rgb, blend.x), blend.y);
    }
    fn lensDiffusion(coordinate: vec2i) -> vec3f {
      var rgb = sampleFilm(coordinate);
      if (filmModuleActive()) {
        let spatial = sampleLensTexel((vec2f(coordinate) + vec2f(0.5)) / spatialScale());
        if (p[${GPU_PARAMS.LENS_FILTER}] > 0.5) {
          let amount = p[${GPU_PARAMS.LENS_SCATTER}];
          rgb = (1.0-amount)*rgb + amount*spatial;
        }
      }
      return rgb;
    }
    fn resolutionScatter(rgb: vec3f, blur: vec3f, loss: f32) -> vec3f {
      if (!filmModuleActive()) { return rgb; }
      let fineDetail = rgb - blur;
      let relativeDetail = max(abs(fineDetail.r), max(abs(fineDetail.g), abs(fineDetail.b)))
        / (max(abs(rgb.r), max(abs(rgb.g), abs(rgb.b))) + 0.02);
      let edgeProtection = smoothRange(0.025, 0.20, relativeDetail);
      return rgb - fineDetail * loss * 0.85 * (1.0 - edgeProtection);
    }
    fn filmStoredRgb(sample: vec4f) -> vec3f { return sample.rgb * sample.a; }
    fn sampleScannedFilm(coordinate: vec2i) -> vec3f {
      return filmStoredRgb(textureLoad(sourceTexture, boundedCoordinate(coordinate), 0));
    }
    fn finishStructure(rgb: vec3f, blur: vec3f, coordinate: vec2i) -> vec3f {
      let adjusted = rgb
        + (blur - rgb) * p[${GPU_PARAMS.STRUCTURE_SOFTNESS}] * 0.65
        + (rgb - blur) * p[${GPU_PARAMS.STRUCTURE_MICROCONTRAST}] * 0.5;
      return applyVignette(adjusted, coordinate);
    }
    fn applyFilmLook(coordinate: vec2i) -> vec3f {
      var rgb = sampleFilm(coordinate);
      if (filmModuleActive()) {
        var spatial = vec4f(0.0);
        if (p[${GPU_PARAMS.HALATION_ENABLED}] > 0.5) {
          spatial = sampleSpatialTexel((vec2f(coordinate) + vec2f(0.5)) / spatialScale());
        }
        if (p[${GPU_PARAMS.HALATION_ENABLED}] > 0.5) {
          let halationRadius = filmPhysicalOffset(p[${GPU_PARAMS.HALATION_RADIUS}], 256);
          let edgeRadius = clamp(halationRadius / 4, 1, 16);
          let edgeSource = halationEdgeSource(coordinate, 0.75, edgeRadius);
          let haloY = max(spatial.a - edgeSource * 0.15, 0.0);
          let angle = radians(45.0 * p[${GPU_PARAMS.HALATION_HUE}]);
          // Base-reflected light re-exposes mostly the red layer (_halation_tint).
          let warm = vec3f(1.0, 0.30 + 0.20 * sin(angle), 0.08 * max(-sin(angle), 0.0));
          let warmY = lumaSrgb(warm);
          let canonicalTintSrgb = mix(vec3f(warmY), warm, clamp(p[${GPU_PARAMS.HALATION_SATURATION}], 0.0, 1.0));
          let tint = select(canonicalTintSrgb, srgbToAcescg(canonicalTintSrgb), p[${GPU_PARAMS.HDR_LANE}] > 0.5);
          // The map's white sits at SDR white in either lane (adjustments.py
          // _apply_halation): 0.18 / (100 / 203) in HDR scene values.
          if (p[${GPU_PARAMS.HALATION_VIEW_MAP}] > 0.5) {
            return vec3f(clamp(filmSignalFromLuma(haloY), 0.0, 1.0) * select(1.0, 0.18 / (100.0 / 203.0), p[${GPU_PARAMS.HDR_LANE}] > 0.5));
          }
          rgb += haloY * tint * (0.42 * p[${GPU_PARAMS.HALATION_AMOUNT}]);
        }

        if (p[${GPU_PARAMS.GRAIN_ENABLED}] > 0.5 && p[${GPU_PARAMS.GRAIN_VIEW_MAP}] > 0.5) {
          return vec3f(filmLumaFromSignal(0.5)) * exp2(filmGrainStops(rgb, coordinate, p[${GPU_PARAMS.FILM_LOOK_STRENGTH}]));
        }
        let stops = filmGrainStops(rgb, coordinate, 1.0);
        if (p[${GPU_PARAMS.FILM_STOCK_SLOT}] > 0.5) {
          rgb = filmStockStage(rgb, -0.3010299956639812 * stops);
        } else {
          rgb *= exp2(stops);
        }
      }
      return rgb;
    }
    // Neutral's ideal paper can put a saturated HDR colour exactly on an
    // sRGB boundary. Independent ACES half-float rounding then creates colour
    // in the nearly empty channel. Choose a nearby representable ACES triplet
    // by its sRGB error; the texture format, allocation and limits stay fixed.
    fn filmHalfPrecision(rgb: vec3f) -> vec3f {
      if (p[${GPU_PARAMS.HDR_LANE}] < 0.5 || p[${GPU_PARAMS.FILM_STOCK_SLOT}] < 0.5) { return rgb; }
      let base = (u32(p[${GPU_PARAMS.FILM_STOCK_SLOT}] + 0.5) - 1u) * ${FILM_STOCK.slotFloats}u;
      if (filmStock[base + ${STOCK.SCAN_FILM}u] != 2.0) { return rgb; }
      let referenceRgb = acescgToSrgb(rgb);
      let q = quantizeToF16(rgb);
      let ulp = exp2(floor(log2(max(abs(q),vec3f(0.00006103515625))))-10.0);
      let rowR = vec3f(1.7048873310,-0.6241572745,-0.0808867739);
      let rowG = vec3f(-0.1295209353,1.1383993260,-0.0087792418);
      let rowB = vec3f(-0.0241270599,-0.1246206123,1.1488221099);
      var weakest = 0u;
      if (abs(referenceRgb.g) < abs(referenceRgb[weakest])) { weakest = 1u; }
      if (abs(referenceRgb.b) < abs(referenceRgb[weakest])) { weakest = 2u; }
      let row = select(select(rowR,rowG,weakest==1u),rowB,weakest==2u);
      // Solve the weakest channel using the smallest matrix coefficient;
      // that channel's half-float steps then give the finest correction.
      var solved = 0u;
      if (abs(row.g) < abs(row[solved])) { solved = 1u; }
      if (abs(row.b) < abs(row[solved])) { solved = 2u; }
      let a = (solved+1u)%3u; let b = (solved+2u)%3u;
      let weights = 1.0/max(abs(referenceRgb),vec3f(0.00001));
      var best = q;
      let initialDelta = acescgToSrgb(q)-referenceRgb;
      var error = dot(initialDelta*initialDelta,weights);
      for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
          var candidate = q;
          candidate[a] = quantizeToF16(q[a]+f32(x)*ulp[a]);
          candidate[b] = quantizeToF16(q[b]+f32(y)*ulp[b]);
          candidate[solved] = quantizeToF16((referenceRgb[weakest]-row[a]*candidate[a]-row[b]*candidate[b])/row[solved]);
          let delta = acescgToSrgb(candidate)-referenceRgb;
          let score = dot(delta*delta,weights);
          if (score < error) { best = candidate; error = score; }
        }
      }
      return best;
    }
    fn storeFilm(rgb: vec3f) -> vec4f {
      var scale = 1.0;
      if (p[${GPU_PARAMS.FILM_STOCK_SLOT}] > 0.5) {
        let base = (u32(p[${GPU_PARAMS.FILM_STOCK_SLOT}]+0.5)-1u)*${FILM_STOCK.slotFloats}u;
        if (filmStock[base + ${STOCK.SCAN_FILM}u] == 2.0) {
          // Preserve extreme ideal-paper highlights before the output shoulder.
          // Only the post-negative film, scanner and Detail passes use this
          // representation. Other stocks and earlier stages retain alpha=1.
          let peak = max(max(abs(rgb.r),abs(rgb.g)),abs(rgb.b));
          scale = exp2(max(0.0,ceil(log2(max(peak/32752.0,1.0)))));
        }
      }
      return vec4f(filmHalfPrecision(rgb/scale),scale);
    }
    fn filmDiagnosticMap() -> bool {
      return filmModuleActive() && ((p[${GPU_PARAMS.HALATION_ENABLED}] > 0.5 && p[${GPU_PARAMS.HALATION_VIEW_MAP}] > 0.5)
        || (p[${GPU_PARAMS.GRAIN_ENABLED}] > 0.5 && p[${GPU_PARAMS.GRAIN_VIEW_MAP}] > 0.5));
    }
    fn scanFilm(coordinate: vec2i) -> vec3f {
      var rgb = sampleScannedFilm(coordinate);
      if (filmDiagnosticMap()) { return applyVignette(rgb, coordinate); }
      if (filmModuleActive()) {
        let sigma = 0.7 * clamp(p[${GPU_PARAMS.SOURCE_PIXEL_SCALE}], 0.05, 1.0);
        let radius = i32(floor(4.0 * sigma + 0.5));
        if (p[${GPU_PARAMS.SCAN_SHARPENING}] > 0.0 && radius > 0) {
          var blurred = vec3f(0.0);
          var total = 0.0;
          for (var y = -3; y <= 3; y += 1) {
            for (var x = -3; x <= 3; x += 1) {
              if (abs(x) > radius || abs(y) > radius) { continue; }
              let weight = exp(-0.5 * f32(x*x + y*y) / (sigma*sigma));
              blurred += sampleScannedFilm(coordinate + vec2i(x,y)) * weight;
              total += weight;
            }
          }
          rgb += p[${GPU_PARAMS.SCAN_SHARPENING}] * (rgb - blurred / total);
        }
        let original = textureLoad(overlayMaskTexture, boundedCoordinate(coordinate), 0).rgb;
        rgb = mix(original, rgb, p[${GPU_PARAMS.FILM_LOOK_STRENGTH}]);
      }
      if (p[${GPU_PARAMS.STRUCTURE_ENABLED}] > 0.5 && (abs(p[${GPU_PARAMS.STRUCTURE_SOFTNESS}]) > 0.000001 || abs(p[${GPU_PARAMS.STRUCTURE_MICROCONTRAST}]) > 0.000001)) { return rgb; }
      return applyVignette(rgb, coordinate);
    }
    fn applyVignette(rgb: vec3f, coordinate: vec2i) -> vec3f {
      if (p[${GPU_PARAMS.VIGNETTE_ENABLED}] < 0.5 || abs(p[${GPU_PARAMS.VIGNETTE_AMOUNT}]) < 0.000001) { return rgb; }
      let dimensions = frameDimensions();
      let center = vec2f(p[${GPU_PARAMS.VIGNETTE_CENTER_X}], p[${GPU_PARAMS.VIGNETTE_CENTER_Y}]) * max(dimensions - vec2f(1.0), vec2f(1.0));
      let scale = max(1.0, 0.5 * min(dimensions.x, dimensions.y));
      let delta = abs((vec2f(frameCoordinate(coordinate)) - center) / scale)
        / vec2f(p[${GPU_PARAMS.VIGNETTE_SCALE_X}], p[${GPU_PARAMS.VIGNETTE_SCALE_Y}]);
      let exponent = max(p[${GPU_PARAMS.VIGNETTE_ROUNDNESS}], 1.0);
      let radius = pow(pow(delta.x, exponent) + pow(delta.y, exponent), 1.0 / exponent);
      var mask = smoothRange(p[${GPU_PARAMS.VIGNETTE_MIDPOINT}], p[${GPU_PARAMS.VIGNETTE_MIDPOINT}] + p[${GPU_PARAMS.VIGNETTE_FEATHER}], radius);
      if (p[${GPU_PARAMS.VIGNETTE_AMOUNT}] < 0.0 && p[${GPU_PARAMS.VIGNETTE_HIGHLIGHT_PROTECTION}] > 0.0) {
        let highlight = smoothRange(0.55, 0.95, filmSignalFromLuma(max(filmLuma(rgb), 0.0)));
        mask *= 1.0 - highlight * p[${GPU_PARAMS.VIGNETTE_HIGHLIGHT_PROTECTION}];
      }
      return rgb * exp2(p[${GPU_PARAMS.VIGNETTE_AMOUNT}] * mask);
    }

    fn localSaturation(input: vec3f) -> vec3f {
      let y = lumaAces(input);
      let neutral = vec3f(y);
      let chroma = input - neutral;
      let maximum = max(input.r, max(input.g, input.b));
      let minimum = min(input.r, min(input.g, input.b));
      let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
      let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
      let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
      return neutral + chroma * max(0.0, 1.0 + p[${MASK_PARAMS.LOCAL.VIBRANCE}] * vibranceWeight) * max(0.0, 1.0 + p[${MASK_PARAMS.LOCAL.SATURATION}]);
    }

    ${toneZonesWgsl(MASK_PARAMS.LOCAL, "localToneZones")}
    fn applyLocalGrade(input: vec3f) -> vec3f {
      let hdr = p[${MASK_PARAMS.LOCAL.HDR_LANE}] > 0.5;
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.00000001);
      let pivot = max(p[${MASK_PARAMS.LOCAL.CONTRAST_PIVOT}], 0.000001);
      let stops = log2(sourceY / pivot);
      let targetStops = stops * exp2(p[${MASK_PARAMS.LOCAL.CONTRAST}]) + p[${MASK_PARAMS.LOCAL.EXPOSURE}];
      var gain = pivot * exp2(clamp(targetStops, -32.0, 24.0)) / sourceY;
      if (p[${MASK_PARAMS.LOCAL.CONTRAST}] == 0.0) { gain = exp2(p[${MASK_PARAMS.LOCAL.EXPOSURE}]); }
      var rgb = input * gain;
      rgb = localToneZones(rgb, max(select(lumaSrgb(rgb), lumaAces(rgb), hdr), 0.0));
      if (hdr) {
        let offset = (p[${MASK_PARAMS.LOCAL.WHITE_BALANCE_KELVIN}] - 6500.0) / 6500.0;
        rgb *= vec3f(1.0 + offset * 0.15, 1.0 + p[${MASK_PARAMS.LOCAL.TINT}] * 0.08, 1.0 - offset * 0.15);
        rgb = localSaturation(rgb);
      } else {
        // Local export converts display-linear sRGB with CAT02. The shared
        // source transform serves a different input contract.
        var aces = vec3f(
          0.61311781290644*rgb.r + 0.34118199585562525*rgb.g + 0.04578734428233729*rgb.b,
          0.06993408230751336*rgb.r + 0.9181030375085815*rgb.g + 0.011932775530201238*rgb.b,
          0.0204629926377373*rgb.r + 0.1067686633825107*rgb.g + 0.8727159106194422*rgb.b
        );
        let offset = (p[${MASK_PARAMS.LOCAL.WHITE_BALANCE_KELVIN}] - 6500.0) / 6500.0;
        aces *= vec3f(1.0 + offset * 0.15, 1.0 + p[${MASK_PARAMS.LOCAL.TINT}] * 0.08, 1.0 - offset * 0.15);
        rgb = acescgToSrgb(localSaturation(aces));
      }
      rgb = applyHsl(rgb,hdr);
      // Local curves precede colour wheels and Detail, just as in export.
      rgb = applyCurvesOffset(rgb,hdr,u32(p[${MASK_PARAMS.LOCAL.CURVE_FLAGS}]),u32(p[${MASK_PARAMS.LOCAL.CURVE_OFFSET}]));
      rgb = applyColorGrading(rgb,hdr);
      // Wheels retain headroom through Detail and the local mask blend.
      return rgb;
    }

    // Log luminance needs a floor well above zero. A floor at the edge of float
    // precision makes the local neighbourhood range around any near-black sample
    // span twenty stops or more, which the sharpening halo fence reads as licence
    // for an unbounded excursion.
    const DETAIL_LUMA_FLOOR: f32 = 0.0001;
    // Absolute ceiling on how far a sharpened sample may travel past its local
    // neighbourhood. The fence stays range-relative for ordinary structure and
    // only this cap engages at high-contrast edges.
    const SHARPEN_HALO_ALLOWANCE_EV: f32 = 0.25;

    fn detailLogLuma(rgb: vec3f) -> f32 {
      let y = select(lumaSrgb(rgb), lumaAces(rgb), p[${GPU_PARAMS.HDR_LANE}] > 0.5);
      return log2(max(y, DETAIL_LUMA_FLOOR));
    }

    fn detailRadii() -> vec4f {
      let dimensions = frameDimensions();
      let diagonal = length(dimensions);
      return vec4f(
        max(0.35, diagonal * 0.0003),
        max(0.70, diagonal * 0.0012),
        max(0.50, diagonal * p[${GPU_PARAMS.CLARITY_RADIUS}] / 100.0),
        max(0.30, p[${GPU_PARAMS.SHARPEN_RADIUS}] * p[${GPU_PARAMS.SOURCE_PIXEL_SCALE}])
      );
    }

    // Texture and Sharpen follow detail.py's three box passes, rather than a sparse
    // Gaussian. Fuse each axis in the interior; retain each pass's edge
    // clamping at the image boundary. The axes commute, including clamping.
    fn sharpenBoxRadius(sigma: f32) -> i32 {
      if (sigma < 0.35) { return 0; }
      var width = max(3, i32(floor(sqrt(4.0 * sigma * sigma + 1.0) + 0.5)));
      if (width % 2 == 0) { width += 1; }
      return width / 2;
    }

    fn sharpenTriangle(value: i32) -> f32 {
      if (value < 0) { return 0.0; }
      return f32((value + 1) * (value + 2)) * 0.5;
    }

    fn sharpenBoxWeight(offset: i32, radius: i32) -> f32 {
      let width = 2 * radius + 1;
      let index = offset + 3 * radius;
      return (sharpenTriangle(index) - 3.0 * sharpenTriangle(index - width)
        + 3.0 * sharpenTriangle(index - 2 * width) - sharpenTriangle(index - 3 * width))
        / f32(width * width * width);
    }

    fn detailBoxSample(coordinate: vec2i, vertical: bool, channel: u32) -> f32 {
      let sample = textureLoad(spatialTexture, coordinate, 0);
      if (vertical) {
        if (channel == 3u) { return sample.w + sample.z; }
        return sample[channel];
      }
      return detailLogLuma(sample.rgb);
    }

    fn detailBoxCount(origin: i32, samplePosition: i32, limit: i32, radius: i32) -> f32 {
      if (limit == 0) { return f32(2 * radius + 1); }
      if (samplePosition == 0) { return f32(max(0, radius - origin + 1)); }
      if (samplePosition == limit) { return f32(max(0, origin + radius - limit + 1)); }
      return select(0.0, 1.0, abs(samplePosition - origin) <= radius);
    }

    fn detailBoxBlur(coordinate: vec2i, sigma: f32, vertical: bool, channel: u32) -> f32 {
      let radius = sharpenBoxRadius(sigma);
      if (radius == 0) { return detailBoxSample(coordinate, vertical, channel); }
      let step = select(vec2i(1, 0), vec2i(0, 1), vertical);
      let bound = validTileDimensions() - vec2i(1);
      let position = select(coordinate.x, coordinate.y, vertical);
      let limit = select(bound.x, bound.y, vertical);
      var total = 0.0;
      if (position < 3 * radius || position + 3 * radius > limit) {
        // Extending the original image once is different from clamping after
        // each box. This small boundary strip retains the reference's order.
        // Count the first two clamped passes at each intermediate texel,
        // then apply the final box. Quadratic work avoids a cubic edge strip
        // for Texture's wider native-resolution support.
        for (var middle = max(0, position - 2 * radius); middle <= min(limit, position + 2 * radius); middle++) {
          var count = 0.0;
          for (var first = max(0, position - radius); first <= min(limit, position + radius); first++) {
            count += detailBoxCount(position, first, limit, radius)
              * detailBoxCount(first, middle, limit, radius);
          }
          var last = 0.0;
          for (var sample = max(0, middle - radius); sample <= min(limit, middle + radius); sample++) {
            last += detailBoxSample(coordinate + (sample - position) * step, vertical, channel)
              * detailBoxCount(middle, sample, limit, radius);
          }
          total += count * last;
        }
        let width = 2 * radius + 1;
        return total / f32(width * width * width);
      }
      for (var offset = -3 * radius; offset <= 3 * radius; offset++) {
        total += detailBoxSample(coordinate + offset * step, vertical, channel) * sharpenBoxWeight(offset, radius);
      }
      return total;
    }

    fn sharpenBlur(coordinate: vec2i, sigma: f32, vertical: bool) -> f32 {
      return detailBoxBlur(coordinate, sigma, vertical, 3u);
    }

    fn packSharpenBand(fine: f32, coarse: f32, sharpen: f32) -> vec4f {
      // The unused Clarity channel carries the Sharpen remainder, avoiding
      // half-float log-luminance rounding before threshold qualification.
      let high = unpack2x16float(pack2x16float(vec2f(sharpen, 0.0))).x;
      return vec4f(fine, coarse, sharpen - high, high);
    }

    // Clarity's brightness map. Log luminance is box-averaged over blocks of
    // p[${GPU_PARAMS.CLARITY_BASE_SCALE}] pixels anchored to the frame (the base map), averaged again over
    // blocks of base texels up to p[${GPU_PARAMS.CLARITY_MAP_SCALE}] pixels, blurred densely there (p[${GPU_PARAMS.CLARITY_MAP_SIGMA}]
    // sigma, p[${GPU_PARAMS.CLARITY_MAP_TAPS}] taps) and read back with a cubic B-spline. clarity_base in
    // detail.py is the same arithmetic. Each value is stored as a half-float
    // pair, value then remainder, so the filterable map keeps float precision.
    // p[${GPU_PARAMS.CLARITY_MAP_ORIGIN_X}], p[${GPU_PARAMS.CLARITY_MAP_ORIGIN_Y}] name the frame texel held at the bound map's origin, and
    // p[${GPU_PARAMS.CLARITY_BASE_ORIGIN_X}], p[${GPU_PARAMS.CLARITY_BASE_ORIGIN_Y}] the same for the base map.
    fn clarityScale() -> i32 {
      return max(1, i32(p[${GPU_PARAMS.CLARITY_MAP_SCALE}]));
    }
    fn clarityMapOrigin() -> vec2i {
      return vec2i(i32(p[${GPU_PARAMS.CLARITY_MAP_ORIGIN_X}]), i32(p[${GPU_PARAMS.CLARITY_MAP_ORIGIN_Y}]));
    }
    fn clarityBaseScale() -> i32 {
      return max(1, i32(p[${GPU_PARAMS.CLARITY_BASE_SCALE}]));
    }
    fn clarityBaseOrigin() -> vec2i {
      return vec2i(i32(p[${GPU_PARAMS.CLARITY_BASE_ORIGIN_X}]), i32(p[${GPU_PARAMS.CLARITY_BASE_ORIGIN_Y}]));
    }
    // The last texel of the whole frame's map at a block size. Every read
    // clamps to the frame, never to the tile, so a tile reads what the
    // whole-frame map holds.
    fn clarityTexelLimit(scale: i32) -> vec2i {
      let frame = vec2i(frameDimensions());
      return (frame + vec2i(scale - 1)) / scale - vec2i(1);
    }
    fn clarityFrameTexelLimit() -> vec2i {
      return clarityTexelLimit(clarityScale());
    }
    fn claritySplit(value: f32) -> vec4f {
      let upper = quantizeToF16(value);
      return vec4f(upper, value - upper, 0.0, 1.0);
    }
    fn clarityMapValue(stored: vec4f) -> f32 {
      return stored.x + stored.y;
    }

    // One base-map texel: the mean log luminance of its block, repeating the
    // frame's edge pixels where the block runs off the picture.
    @fragment fn clarityReduceFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let scale = clarityBaseScale();
      let texel = vec2i(input.position.xy) + clarityBaseOrigin();
      let lastPixel = vec2i(frameDimensions()) - vec2i(1);
      let tileOrigin = vec2i(i32(p[${GPU_PARAMS.TILE_ORIGIN_X}]), i32(p[${GPU_PARAMS.TILE_ORIGIN_Y}]));
      let lastLocal = validTileDimensions() - vec2i(1);
      var total = 0.0;
      for (var y: i32 = 0; y < scale; y = y + 1) {
        for (var x: i32 = 0; x < scale; x = x + 1) {
          let framePixel = min(texel * scale + vec2i(x, y), lastPixel);
          let localPixel = clamp(framePixel - tileOrigin, vec2i(0), lastLocal);
          total += detailLogLuma(textureLoad(sourceTexture, localPixel, 0).rgb);
        }
      }
      return claritySplit(total / f32(scale * scale));
    }

    // One map texel at the radius's block size: the mean of the base texels it
    // covers, repeating the frame's edge texels where it runs off the picture.
    @fragment fn clarityLevelFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let ratio = max(1, clarityScale() / clarityBaseScale());
      let texel = vec2i(input.position.xy) + clarityMapOrigin();
      let lastBase = clarityTexelLimit(clarityBaseScale());
      let baseOrigin = clarityBaseOrigin();
      let lastStored = vec2i(textureDimensions(sourceTexture)) - vec2i(1);
      var total = 0.0;
      for (var y: i32 = 0; y < ratio; y = y + 1) {
        for (var x: i32 = 0; x < ratio; x = x + 1) {
          let baseTexel = min(texel * ratio + vec2i(x, y), lastBase);
          let stored = clamp(baseTexel - baseOrigin, vec2i(0), lastStored);
          total += clarityMapValue(textureLoad(sourceTexture, stored, 0));
        }
      }
      return claritySplit(total / f32(ratio * ratio));
    }

    fn clarityBlur(texel: vec2i, axis: vec2i) -> vec4f {
      let taps = i32(p[${GPU_PARAMS.CLARITY_MAP_TAPS}]);
      if (taps <= 0) { return textureLoad(sourceTexture, texel, 0); }
      let sigma = p[${GPU_PARAMS.CLARITY_MAP_SIGMA}];
      let origin = clarityMapOrigin();
      let limit = clarityFrameTexelLimit();
      let lastStored = vec2i(textureDimensions(sourceTexture)) - vec2i(1);
      var total = 0.0;
      var weights = 0.0;
      for (var tap: i32 = -taps; tap <= taps; tap = tap + 1) {
        let distance = f32(tap) / sigma;
        let weight = exp(-0.5 * distance * distance);
        let frameTexel = clamp(texel + origin + axis * tap, vec2i(0), limit);
        let stored = clamp(frameTexel - origin, vec2i(0), lastStored);
        total += clarityMapValue(textureLoad(sourceTexture, stored, 0)) * weight;
        weights += weight;
      }
      return claritySplit(total / weights);
    }

    @fragment fn clarityBlurHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return clarityBlur(vec2i(input.position.xy), vec2i(1, 0));
    }

    @fragment fn clarityBlurVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return clarityBlur(vec2i(input.position.xy), vec2i(0, 1));
    }

    fn clarityMapAt(frameTexel: vec2i) -> f32 {
      let limit = clarityFrameTexelLimit();
      let lastStored = vec2i(textureDimensions(overlayMaskTexture)) - vec2i(1);
      let stored = clamp(clamp(frameTexel, vec2i(0), limit) - clarityMapOrigin(), vec2i(0), lastStored);
      return clarityMapValue(textureLoad(overlayMaskTexture, stored, 0));
    }

    fn clarityBsplineWeights(t: f32) -> vec4f {
      let t2 = t * t;
      let t3 = t2 * t;
      let oneMinus = 1.0 - t;
      return vec4f(
        oneMinus * oneMinus * oneMinus / 6.0,
        (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0,
        (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0,
        t3 / 6.0
      );
    }

    // Clarity's blurred base at a tile pixel, read from the map bound in the
    // overlay slot.
    fn clarityBase(coordinate: vec2i) -> f32 {
      let scale = clarityScale();
      let pixel = frameCoordinate(coordinate);
      if (scale == 1) { return clarityMapAt(pixel); }
      let position = (vec2f(pixel) + vec2f(0.5)) / f32(scale) - vec2f(0.5);
      let firstTexel = vec2i(floor(position)) - vec2i(1);
      let fraction = position - floor(position);
      let across = clarityBsplineWeights(fraction.x);
      let down = clarityBsplineWeights(fraction.y);
      var total = 0.0;
      for (var row: i32 = 0; row < 4; row = row + 1) {
        var rowTotal = 0.0;
        for (var column: i32 = 0; column < 4; column = column + 1) {
          rowTotal += clarityMapAt(firstTexel + vec2i(column, row)) * across[column];
        }
        total += rowTotal * down[row];
      }
      return total;
    }

    // One map texel for a measurement patch, read from the finished map of a
    // reduced render of the whole frame (bound as the source). p[${GPU_PARAMS.TILE_ORIGIN_X}], p[${GPU_PARAMS.TILE_ORIGIN_Y}]
    // are that render's frame size and p[${GPU_PARAMS.CLARITY_BASE_SCALE}] its map's block size. The patch
    // then reads this texture exactly as it would a map built from its halo.
    @fragment fn claritySurroundFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let texel = clamp(vec2i(input.position.xy) + clarityMapOrigin(), vec2i(0), clarityFrameTexelLimit());
      let frame = frameDimensions();
      let centre = min((vec2f(texel) + vec2f(0.5)) * f32(clarityScale()), frame);
      let position = centre * vec2f(p[${GPU_PARAMS.TILE_ORIGIN_X}], p[${GPU_PARAMS.TILE_ORIGIN_Y}]) / frame / f32(clarityBaseScale()) - vec2f(0.5);
      let firstTexel = vec2i(floor(position)) - vec2i(1);
      let fraction = position - floor(position);
      let across = clarityBsplineWeights(fraction.x);
      let down = clarityBsplineWeights(fraction.y);
      let lastStored = vec2i(textureDimensions(sourceTexture)) - vec2i(1);
      var total = 0.0;
      for (var row: i32 = 0; row < 4; row = row + 1) {
        var rowTotal = 0.0;
        for (var column: i32 = 0; column < 4; column = column + 1) {
          let stored = clamp(firstTexel + vec2i(column, row), vec2i(0), lastStored);
          rowTotal += clarityMapValue(textureLoad(sourceTexture, stored, 0)) * across[column];
        }
        total += rowTotal * down[row];
      }
      return claritySplit(total);
    }

    fn detailTextureEdgeWeight(coordinate: vec2f, logY: f32, coarse: f32) -> f32 {
      let dimensions = vec2f(textureDimensions(spatialTexture));
      let coarseRadius = max(0.70, length(frameDimensions()) * 0.0012);
      let reach = max(1.0, 2.0 * coarseRadius);
      let valid = vec2f(validTileDimensions());
      let centerUv = clamp(coordinate + vec2f(0.5), vec2f(0.5), valid - vec2f(0.5)) / dimensions;
      let rightUv = clamp(coordinate + vec2f(reach, 0.0) + vec2f(0.5), vec2f(0.5), valid - vec2f(0.5)) / dimensions;
      let leftUv = clamp(coordinate - vec2f(reach, 0.0) + vec2f(0.5), vec2f(0.5), valid - vec2f(0.5)) / dimensions;
      let downUv = clamp(coordinate + vec2f(0.0, reach) + vec2f(0.5), vec2f(0.5), valid - vec2f(0.5)) / dimensions;
      let upUv = clamp(coordinate - vec2f(0.0, reach) + vec2f(0.5), vec2f(0.5), valid - vec2f(0.5)) / dimensions;
      var guide = abs(logY - coarse);
      guide = max(guide, abs(coarse - textureSampleLevel(spatialTexture, spatialSampler, rightUv, 0.0).y));
      guide = max(guide, abs(coarse - textureSampleLevel(spatialTexture, spatialSampler, leftUv, 0.0).y));
      guide = max(guide, abs(coarse - textureSampleLevel(spatialTexture, spatialSampler, downUv, 0.0).y));
      guide = max(guide, abs(coarse - textureSampleLevel(spatialTexture, spatialSampler, upUv, 0.0).y));
      return exp(-(guide / 0.20) * (guide / 0.20));
    }

    fn detailLocalExtrema(coordinate: vec2i) -> vec2f {
      let dimensions = validTileDimensions();
      var minimum = 1000000.0;
      var maximum = -1000000.0;
      for (var y: i32 = -1; y <= 1; y = y + 1) {
        for (var x: i32 = -1; x <= 1; x = x + 1) {
          let sampleCoordinate = clamp(coordinate + vec2i(x, y), vec2i(0), dimensions - vec2i(1));
          let value = detailLogLuma(textureLoad(sourceTexture, sampleCoordinate, 0).rgb);
          minimum = min(minimum, value);
          maximum = max(maximum, value);
        }
      }
      return vec2f(minimum, maximum);
    }

    @fragment fn detailHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let radii = detailRadii();
      return packSharpenBand(
        detailBoxBlur(coordinate, radii.x, false, 0u),
        detailBoxBlur(coordinate, radii.y, false, 1u),
        sharpenBlur(coordinate, radii.w, false)
      );
    }

    @fragment fn detailVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let radii = detailRadii();
      return packSharpenBand(
        detailBoxBlur(coordinate, radii.x, true, 0u),
        detailBoxBlur(coordinate, radii.y, true, 1u),
        sharpenBlur(coordinate, radii.w, true)
      );
    }

    @fragment fn detailCompositeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let blurred = textureLoad(spatialTexture, coordinate, 0);
      let sourceY = max(select(lumaSrgb(source), lumaAces(source), p[${GPU_PARAMS.HDR_LANE}] > 0.5), DETAIL_LUMA_FLOOR);
      let logY = log2(sourceY);
      var adjusted = logY;
      if (abs(p[${GPU_PARAMS.TEXTURE_AMOUNT}]) > 0.000001) {
        let edgeWeight = detailTextureEdgeWeight(vec2f(coordinate), logY, blurred.y);
        adjusted += (blurred.x - blurred.y) * edgeWeight * p[${GPU_PARAMS.TEXTURE_AMOUNT}];
      }
      if (abs(p[${GPU_PARAMS.CLARITY_AMOUNT}]) > 0.000001) {
        let band = logY - clarityBase(coordinate);
        let edgeWeight = exp(-(band / 0.75) * (band / 0.75));
        adjusted += band * edgeWeight * p[${GPU_PARAMS.CLARITY_AMOUNT}];
      }
      if (p[${GPU_PARAMS.SHARPEN_AMOUNT}] > 0.000001) {
        let edge = logY - (blurred.w + blurred.z);
        let qualification = select(smoothRange(p[${GPU_PARAMS.SHARPEN_THRESHOLD}], p[${GPU_PARAMS.SHARPEN_THRESHOLD}] + 0.04, abs(edge)), 1.0, p[${GPU_PARAMS.SHARPEN_THRESHOLD}] <= 0.000001);
        let qualified = edge * qualification;
        let extrema = detailLocalExtrema(coordinate);
        let allowance = min(0.12 * (extrema.y - extrema.x), SHARPEN_HALO_ALLOWANCE_EV);
        adjusted = clamp(adjusted + qualified * p[${GPU_PARAMS.SHARPEN_AMOUNT}], extrema.x - allowance, extrema.y + allowance);
      }
      let delta = clamp(adjusted - logY, -16.0, 16.0);
      if (abs(delta) <= 0.0000001) { return vec4f(source, 1.0); }
      var result = source * exp2(delta);
      // Preserve SDR headroom until Film Look and the final output ceiling.
      return vec4f(result, 1.0);
    }

    fn localDetailRadii() -> vec4f {
      let dimensions = frameDimensions();
      let diagonal = length(dimensions);
      return vec4f(
        max(0.35, diagonal * 0.0003),
        max(0.70, diagonal * 0.0012),
        max(0.50, diagonal * p[${MASK_PARAMS.LOCAL.CLARITY_RADIUS}] / 100.0),
        max(0.30, p[${MASK_PARAMS.LOCAL.SHARPEN_RADIUS}] * p[${MASK_PARAMS.LOCAL.SOURCE_PIXEL_SCALE}])
      );
    }

    @fragment fn localDetailHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let radii = localDetailRadii();
      return packSharpenBand(
        detailBoxBlur(coordinate, radii.x, false, 0u),
        detailBoxBlur(coordinate, radii.y, false, 1u),
        sharpenBlur(coordinate, radii.w, false)
      );
    }

    @fragment fn localDetailVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let radii = localDetailRadii();
      return packSharpenBand(
        detailBoxBlur(coordinate, radii.x, true, 0u),
        detailBoxBlur(coordinate, radii.y, true, 1u),
        sharpenBlur(coordinate, radii.w, true)
      );
    }

    @fragment fn localDetailCompositeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let blurred = textureLoad(spatialTexture, coordinate, 0);
      let sourceY = max(select(lumaSrgb(source), lumaAces(source), p[${MASK_PARAMS.LOCAL.HDR_LANE}] > 0.5), DETAIL_LUMA_FLOOR);
      let logY = log2(sourceY);
      var adjusted = logY;
      if (abs(p[${MASK_PARAMS.LOCAL.TEXTURE_AMOUNT}]) > 0.000001) {
        let edgeWeight = detailTextureEdgeWeight(vec2f(coordinate), logY, blurred.y);
        adjusted += (blurred.x - blurred.y) * edgeWeight * p[${MASK_PARAMS.LOCAL.TEXTURE_AMOUNT}];
      }
      if (abs(p[${MASK_PARAMS.LOCAL.CLARITY_AMOUNT}]) > 0.000001) {
        let band = logY - clarityBase(coordinate);
        let edgeWeight = exp(-(band / 0.75) * (band / 0.75));
        adjusted += band * edgeWeight * p[${MASK_PARAMS.LOCAL.CLARITY_AMOUNT}];
      }
      if (p[${MASK_PARAMS.LOCAL.SHARPEN_AMOUNT}] > 0.000001) {
        let edge = logY - (blurred.w + blurred.z);
        let qualification = select(smoothRange(p[${MASK_PARAMS.LOCAL.SHARPEN_THRESHOLD}], p[${MASK_PARAMS.LOCAL.SHARPEN_THRESHOLD}] + 0.04, abs(edge)), 1.0, p[${MASK_PARAMS.LOCAL.SHARPEN_THRESHOLD}] <= 0.000001);
        let qualified = edge * qualification;
        let extrema = detailLocalExtrema(coordinate);
        let allowance = min(0.12 * (extrema.y - extrema.x), SHARPEN_HALO_ALLOWANCE_EV);
        adjusted = clamp(adjusted + qualified * p[${MASK_PARAMS.LOCAL.SHARPEN_AMOUNT}], extrema.x - allowance, extrema.y + allowance);
      }
      let delta = clamp(adjusted - logY, -16.0, 16.0);
      if (abs(delta) <= 0.0000001) { return vec4f(source, 1.0); }
      var result = source * exp2(delta);
      // Preserve SDR headroom until Film Look and the final output ceiling.
      return vec4f(result, 1.0);
    }

    // Denoise's Show noise view. The difference is taken after a fixed display
    // transform (lane exposure, a simple shoulder, a 2.2 gamma) so shadow noise
    // reads about as strongly as it looks, and so the view is independent of
    // every other grade setting. Mid gray is "nothing removed".
    // Mirrors NOISE_VIEW_INDEX in the JS above.
    const NOISE_VIEW_INDEX: u32 = ${GPU_PARAMS.NOISE_VIEW}u;
    const NOISE_VIEW_GAIN: f32 = 6.0;
    fn noiseViewEncode(rgb: vec3f) -> vec3f {
      let exposed = max(rgb * exp2(p[${GPU_PARAMS.EXPOSURE}]), vec3f(0.0));
      return pow(exposed / (vec3f(1.0) + exposed), vec3f(1.0 / 2.2));
    }
    fn noiseViewActive() -> bool {
      return arrayLength(&p) > NOISE_VIEW_INDEX && p[NOISE_VIEW_INDEX] > 0.5;
    }

    @fragment fn baseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      if (noiseViewActive()) {
        // 1: the original is bound as the source and the denoised picture as
        // the overlay. 2: Denoise produced nothing for this frame, so nothing
        // was removed and the view is flat.
        if (p[NOISE_VIEW_INDEX] > 1.5) { return vec4f(vec3f(0.5), 1.0); }
        let denoised = textureLoad(overlayMaskTexture, coordinate, 0).rgb;
        let removed = noiseViewEncode(source) - noiseViewEncode(denoised);
        return vec4f(clamp(vec3f(0.5) + removed * NOISE_VIEW_GAIN, vec3f(0.0), vec3f(1.0)), 1.0);
      }
      if (blackAndWhiteNeedsGuide()) {
        blackAndWhiteGuideSource = blackAndWhiteLatticeMean(sourceTexture, coordinate, validTileDimensions());
      }
      hslSelectionActive = p[${GPU_PARAMS.HSL_SHARED_SELECTION}] > 0.5 && textureDimensions(hslSelection).x > 1u;
      hslSelectionPixel = coordinate;
      if (p[${GPU_PARAMS.HDR_LANE}] > 0.5) { return vec4f(renderHdrBase(source), 1.0); }
      return vec4f(renderSdrBase(source), 1.0);
    }

    // The HSL stage input as selection fields, for the shared selection. Same
    // prefix as the base pass; everything after HSL is discarded.
    @fragment fn hslFieldsFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      if (blackAndWhiteNeedsGuide()) {
        blackAndWhiteGuideSource = blackAndWhiteLatticeMean(sourceTexture, coordinate, validTileDimensions());
      }
      hslCapture = true;
      // Not select(): it evaluates both lanes and the last capture would win.
      if (p[${GPU_PARAMS.HDR_LANE}] > 0.5) { _ = renderHdrBase(source); } else { _ = renderSdrBase(source); }
      return hslSelectionFields(hslCaptured);
    }

    // A Local hue-mask leaf: lane 0 of the bound shared selection, written into
    // a mask texture. TILE_ORIGIN is the selection region's offset inside the
    // mask (one band of a large frame); HSL_SHARED_SELECTION 2 inverts.
    @fragment fn hslMaskFragmentMain(input: VertexOut) -> @location(0) vec4f {
      hslSelectionPixel = vec2i(input.position.xy)
        - vec2i(i32(p[${GPU_PARAMS.TILE_ORIGIN_X}]), i32(p[${GPU_PARAMS.TILE_ORIGIN_Y}]));
      var coverage = hslSharedCoverage(0u);
      if (p[${GPU_PARAMS.HSL_SHARED_SELECTION}] > 1.5) { coverage = 1.0 - coverage; }
      return vec4f(coverage, 0.0, 0.0, 1.0);
    }

    // Where a pass's pixel falls in its mask texture. A mask texture normally
    // has one texel per pixel of the pass. A soft mask is one small bitmap of
    // a stated rectangle of the picture (slots 186-189: origin and size, in
    // frame pixels), stretched over whatever the pass is drawing; slots 160
    // and 161 hold the pass's own origin in the frame.
    fn maskUv(coordinate: vec2i, textureSize: vec2f) -> vec2f {
      if (arrayLength(&p) > ${GPU_PARAMS.MASK_RECT_HEIGHT}u && p[${GPU_PARAMS.MASK_RECT_WIDTH}] > 0.0 && p[${GPU_PARAMS.MASK_RECT_HEIGHT}] > 0.0) {
        let framePosition = vec2f(p[${GPU_PARAMS.TILE_ORIGIN_X}], p[${GPU_PARAMS.TILE_ORIGIN_Y}]) + vec2f(coordinate) + vec2f(0.5);
        return (framePosition - vec2f(p[${GPU_PARAMS.MASK_RECT_X}], p[${GPU_PARAMS.MASK_RECT_Y}])) / vec2f(p[${GPU_PARAMS.MASK_RECT_WIDTH}], p[${GPU_PARAMS.MASK_RECT_HEIGHT}]);
      }
      return (vec2f(coordinate) + vec2f(0.5)) / textureSize;
    }

    // The one place a local reads its mask. The local passes and the
    // diagnostic probe below all call it, so what the probe reports is what
    // the picture was drawn with.
    fn localMaskValue(coordinate: vec2i) -> f32 {
      let uv = maskUv(coordinate, vec2f(textureDimensions(spatialTexture)));
      return textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0).r;
    }

    // Diagnostic only: the mask as a local pass samples it, before the local's
    // and the mask's opacity, for the preview-versus-export comparison.
    @fragment fn localMaskProbeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      // Every pixel of the probe's target is a pixel of the pass it stands in
      // for, where the local passes' clamp to the valid size changes nothing.
      return vec4f(vec3f(localMaskValue(vec2i(input.position.xy))), 1.0);
    }

    @fragment fn localAdjustmentFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let influence = clamp(localMaskValue(coordinate) * p[${MASK_PARAMS.LOCAL.OPACITY}] * p[${MASK_PARAMS.LOCAL.MASK_OPACITY}], 0.0, 1.0);
      let graded = applyLocalGrade(source);
      let candidate = graded;
      return vec4f(mix(source,candidate,influence), 1.0);
    }

    @fragment fn localCandidateFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      return vec4f(applyLocalGrade(textureLoad(sourceTexture, coordinate, 0).rgb), 1.0);
    }

    // A candidate atlas has unrelated real source pixels beside one another.
    // Its position atlas keeps mask lookup in the photograph's coordinates.
    // Neighbourhood effects are evaluated later in bounded native patches.
    @fragment fn peakCandidateLocalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = vec2i(input.position.xy);
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let frameUv = textureLoad(overlayMaskTexture, coordinate, 0).xy;
      let mask = textureSampleLevel(spatialTexture, spatialSampler, frameUv, 0.0).r;
      let influence = clamp(mask * p[${MASK_PARAMS.LOCAL.OPACITY}] * p[${MASK_PARAMS.LOCAL.MASK_OPACITY}], 0.0, 1.0);
      return vec4f(mix(source, applyLocalGrade(source), influence), 1.0);
    }

    @fragment fn localDetailMixFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let influence = clamp(localMaskValue(coordinate) * p[${MASK_PARAMS.LOCAL.OPACITY}] * p[${MASK_PARAMS.LOCAL.MASK_OPACITY}], 0.0, 1.0);
      let candidate = textureLoad(overlayMaskTexture, coordinate, 0).rgb;
      return vec4f(mix(source, candidate, influence), 1.0);
    }

    @fragment fn filmResponseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      return textureLoad(sourceTexture, coordinate, 0);
    }

    @fragment fn lensFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), validTileDimensions() - vec2i(1));
      return vec4f(lensDiffusion(coordinate), 1.0);
    }

    @compute @workgroup_size(${FILM_DETAIL_BLOCK.width}, ${FILM_DETAIL_BLOCK.height})
    fn scatterComputeMain(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_id) local: vec3u) {
      let coordinate = vec2i(id.xy);
      let bound = validTileDimensions() - vec2i(1);
      let loss = 1.0 - p[${GPU_PARAMS.FILM_RESOLUTION}];
      let radius = filmPhysicalOffset(0.04 + 0.08 * loss, filmResolutionMaxRadius);
      let blur = filmDetailBlur(coordinate, vec2i(local.xy), bound, radius, false);
      if (any(coordinate > bound)) { return; }
      let rgb = textureLoad(sourceTexture, coordinate, 0).rgb;
      textureStore(filmDetailOutput, coordinate, vec4f(resolutionScatter(rgb, blur, loss), 1.0));
    }

    @compute @workgroup_size(${FILM_DETAIL_BLOCK.width}, ${FILM_DETAIL_BLOCK.height})
    fn structureComputeMain(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_id) local: vec3u) {
      let coordinate = vec2i(id.xy);
      let bound = validTileDimensions() - vec2i(1);
      let radius = outputRelativeOffset(0.06, 24);
      let blur = filmDetailBlur(coordinate, vec2i(local.xy), bound, radius, true);
      if (any(coordinate > bound)) { return; }
      let rgb = filmStoredRgb(textureLoad(sourceTexture, coordinate, 0));
      textureStore(filmDetailOutput, coordinate, storeFilm(applyOutputExposure(finishStructure(rgb, blur, coordinate))));
    }

    const LENS_COMPONENTS = array<vec4f,${LENS_TABLE_LENGTH}>(${LENS_COMPONENTS_WGSL});
    fn lensComponent(index: u32) -> vec4f {
      return LENS_COMPONENTS[(u32(p[${GPU_PARAMS.LENS_FILTER}])-1u)*${LENS_LOBE_COUNT}u+index];
    }
    fn lensSigma(index: u32) -> f32 {
      return max(0.000001,lensComponent(index).x*p[${GPU_PARAMS.LENS_SIZE}]*filmPixelsPerMm(frameDimensions())/(1000.0*spatialScale()));
    }
    fn lensExtent(sigma: f32) -> i32 {
      let cap = floor(${LENS_KERNEL_LIMIT}.0*clamp(p[${GPU_PARAMS.SOURCE_PIXEL_SCALE}],0.05,1.0)/spatialScale());
      return i32(min(cap,floor(3.0*sigma+0.5)));
    }
    fn lensSourceAtSpatial(pixel: vec2i) -> vec3f {
      let point = (vec2f(clamp(pixel,vec2i(0),validSpatialDimensions()-vec2i(1)))+vec2f(0.5))*spatialScale();
      let offset = spatialScale()*0.25;
      return (sampleFilm(vec2i(point+vec2f(-offset,-offset)))
        +sampleFilm(vec2i(point+vec2f(offset,-offset)))
        +sampleFilm(vec2i(point+vec2f(-offset,offset)))
        +sampleFilm(vec2i(point+vec2f(offset,offset))))*0.25;
    }
    @fragment fn lensExtractFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return vec4f(lensSourceAtSpatial(vec2i(input.position.xy)),1.0);
    }
    // A Gaussian's negative and positive taps have the same weight.
    // Keep the center and positive half in the full-precision tap table.
    fn lensGaussianWeight(tap: i32, sigma: f32) -> f32 {
      let distance = f32(tap) / sigma;
      return exp(-0.5 * distance * distance);
    }
    @fragment fn lensWeightsFragmentMain(input: VertexOut) -> @location(0) f32 {
      let column = i32(input.position.x);
      let sigma = lensSigma(u32(input.position.y));
      let extent = lensExtent(sigma);
      if (column == ${LENS_KERNEL_TAPS}) { return f32(extent); }
      if (column == ${LENS_KERNEL_TAPS + 1}) {
        var sum = 1.0;
        for (var tap = 1; tap <= extent; tap++) { sum += 2.0 * lensGaussianWeight(tap, sigma); }
        return sum;
      }
      return lensGaussianWeight(column, sigma);
    }
    fn lensWeight(column: i32, component: u32) -> f32 {
      return textureLoad(lensWeights, vec2i(column, i32(component)), 0).r;
    }
    fn lensBlurAxis(input: VertexOut, axis: vec2i) -> vec3f {
      let component = input.lensComponent;
      let extent = i32(lensWeight(${LENS_KERNEL_TAPS}, component));
      let upper = validSpatialDimensions() - vec2i(1);
      let center = clamp(vec2i(input.position.xy), vec2i(0), upper);
      var total = textureLoad(spatialTexture, center, 0).rgb;
      for (var tap = 1; tap <= extent; tap++) {
        let offset = tap * axis;
        let a = textureLoad(spatialTexture, max(center - offset, vec2i(0)), 0).rgb;
        let b = textureLoad(spatialTexture, min(center + offset, upper), 0).rgb;
        total += (a + b) * lensWeight(tap, component);
      }
      return total / lensWeight(${LENS_KERNEL_TAPS + 1}, component);
    }
    @fragment fn lensHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return vec4f(lensBlurAxis(input, vec2i(1, 0)), 1.0);
    }
    @fragment fn lensVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return vec4f(lensBlurAxis(input, vec2i(0, 1)) * lensComponent(input.lensComponent).yzw, 0.0);
    }

    @fragment fn spatialExtractFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let center = input.position.xy * spatialScale();
      let offset = vec2f(spatialScale() * 0.25);
      return (
        packedQualifiedSample(center + vec2f(-offset.x, -offset.y))
        + packedQualifiedSample(center + vec2f(offset.x, -offset.y))
        + packedQualifiedSample(center + vec2f(-offset.x, offset.y))
        + packedQualifiedSample(center + vec2f(offset.x, offset.y))
      ) * 0.25;
    }

    @fragment fn spatialBlurHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return spatialBlur(vec2f(1.0, 0.0), input.position.xy);
    }

    @fragment fn spatialBlurVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return spatialBlur(vec2f(0.0, 1.0), input.position.xy);
    }

    // Film Look, Vignette and grain resolve into their own texture so the output
    // limiter measures the finished picture rather than predicting it from the
    // source, and so the scope pass reads that result instead of recomputing it.
    @fragment fn scanFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), validTileDimensions() - vec2i(1));
      let rgb = scanFilm(coordinate);
      let structure = p[${GPU_PARAMS.STRUCTURE_ENABLED}] > 0.5
        && (abs(p[${GPU_PARAMS.STRUCTURE_SOFTNESS}]) > 0.000001 || abs(p[${GPU_PARAMS.STRUCTURE_MICROCONTRAST}]) > 0.000001);
      if (structure && !filmDiagnosticMap()) { return storeFilm(rgb); }
      return storeFilm(applyOutputExposure(rgb));
    }

    @fragment fn finishFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), validTileDimensions() - vec2i(1));
      return storeFilm(applyFilmLook(coordinate));
    }

    fn finishedAt(coordinate: vec2i) -> vec3f {
      return filmStoredRgb(textureLoad(sourceTexture, boundedCoordinate(coordinate), 0));
    }
    fn scopeOutputAt(coordinate: vec2i) -> vec3f {
      let filmOutput = applyOutputHighlights(finishedAt(coordinate));
      return select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), max(filmOutput, vec3f(0.0)), outputIsHdr());
    }
    fn scopePeakSignal(rgb: vec3f) -> f32 {
      // SDR scopes report display signal, matching scopes.py and the histogram.
      let signal = vec3f(srgbEncode(rgb.r), srgbEncode(rgb.g), srgbEncode(rgb.b));
      return max(select(lumaSrgb(signal), lumaAces(rgb), outputIsHdr()), 0.0);
    }
    fn highlightAnchorSignal(rgb: vec3f) -> f32 {
      if (!outputIsHdr()) {
        if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 0.5) { return max(max(max(rgb.r, rgb.g), rgb.b), 0.0); }
        return max(lumaSrgb(rgb), 0.0);
      }
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 1.5) {
        let transport = acescgToBt2020(rgb);
        return max(max(max(transport.r, transport.g), transport.b), 0.0);
      }
      if (p[${GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING}] > 0.5) {
        return max(max(max(rgb.r, rgb.g), rgb.b), 0.0);
      }
      return max(lumaAces(rgb), 0.0);
    }
    @fragment fn scopeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let targetDimensions = max(vec2f(p[${GPU_PARAMS.SCOPE_WIDTH}], p[${GPU_PARAMS.SCOPE_HEIGHT}]), vec2f(1.0));
      let sourceDimensions = vec2f(textureDimensions(sourceTexture));
      let cellOrigin = floor(input.position.xy - vec2f(0.5));
      let sourceStart = cellOrigin * sourceDimensions / targetDimensions;
      let sourceSpan = sourceDimensions / targetDimensions;
      var total = vec3f(0.0);
      var peak = 0.0;
      // Interactive scopes use bounded stratified coverage. They remain
      // responsive while sampling the full cell footprint instead of one
      // nearest texel, and the settled pass below replaces this estimate.
      for (var sy: u32 = 0u; sy < 4u; sy = sy + 1u) {
        for (var sx: u32 = 0u; sx < 4u; sx = sx + 1u) {
          let samplePosition = sourceStart + (vec2f(f32(sx), f32(sy)) + vec2f(0.5)) * sourceSpan / 4.0;
          let coordinate = clamp(vec2i(samplePosition), vec2i(0), vec2i(sourceDimensions) - vec2i(1));
          let output = scopeOutputAt(coordinate);
          total += output;
          peak = max(peak, scopePeakSignal(output));
        }
      }
      return vec4f(total / 16.0, peak);
    }
    // The exact maximum of the finished picture over one tile.
    //
    // This is the number a delivery decision is made on -- "is this under 1000
    // nits" -- so it is a true maximum over every pixel, never a sample. The
    // grid it writes into is a reduction target and not a picture: cell (i, j)
    // holds the maximum over its share of *this tile*, with no relationship to
    // any frame position. A maximum is decomposable, so max-blending every
    // tile into one grid and taking the largest cell at the end is exactly the
    // maximum over the frame, whatever the tiling. That is what makes this
    // affordable: the grid stays small, each fragment's loop stays short, and
    // the readback is one small texture per generation rather than one per
    // tile.
    //
    // It reduces the same expression the settled scope pass reduces, so this
    // cannot drift from what the scopes draw.
    @fragment fn scopePeakTileFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let grid = max(vec2u(u32(p[${GPU_PARAMS.SCOPE_WIDTH}]), u32(p[${GPU_PARAMS.SCOPE_HEIGHT}])), vec2u(1u));
      let valid = vec2u(max(validTileDimensions(), vec2i(1)));
      let cell = vec2u(input.position.xy - vec2f(0.5));
      let start = vec2u(floor(vec2f(cell) * vec2f(valid) / vec2f(grid)));
      let end = min(
        valid,
        max(start + vec2u(1u), vec2u(ceil(vec2f(cell + vec2u(1u)) * vec2f(valid) / vec2f(grid))))
      );
      var peak = 0.0;
      for (var y = start.y; y < end.y; y = y + 1u) {
        for (var x = start.x; x < end.x; x = x + 1u) {
          let coordinate = vec2i(i32(x), i32(y));
          // p[${GPU_PARAMS.HIGHLIGHT_MODE}] == -1 selects the native, pre-compression Peak Fit anchor.
          // Ordinary scope reductions continue to measure post-compression
          // output luminance.
          let signal = select(
            scopePeakSignal(scopeOutputAt(coordinate)),
            highlightAnchorSignal(finishedAt(coordinate)),
            p[${GPU_PARAMS.HIGHLIGHT_MODE}] < -0.5
          );
          peak = max(peak, signal);
        }
      }
      return vec4f(peak, peak, peak, peak);
    }

    @fragment fn settledScopeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let targetDimensions = max(vec2u(u32(p[${GPU_PARAMS.SCOPE_WIDTH}]), u32(p[${GPU_PARAMS.SCOPE_HEIGHT}])), vec2u(1u));
      let sourceDimensions = textureDimensions(sourceTexture);
      let cell = vec2u(input.position.xy - vec2f(0.5));
      let start = vec2u(floor(vec2f(cell) * vec2f(sourceDimensions) / vec2f(targetDimensions)));
      let end = min(
        sourceDimensions,
        max(start + vec2u(1u), vec2u(ceil(vec2f(cell + vec2u(1u)) * vec2f(sourceDimensions) / vec2f(targetDimensions))))
      );
      var total = vec3f(0.0);
      var peak = 0.0;
      var count = 0u;
      // Settled/refined scopes cover every source texel assigned to this cell.
      // RGB is area-averaged for distributions; alpha carries the conservative
      // full-cell maximum so isolated speculars cannot disappear on resize.
      for (var y = start.y; y < end.y; y = y + 1u) {
        for (var x = start.x; x < end.x; x = x + 1u) {
          let output = scopeOutputAt(vec2i(i32(x), i32(y)));
          total += output;
          peak = max(peak, scopePeakSignal(output));
          count += 1u;
        }
      }
      return vec4f(total / f32(max(count, 1u)), peak);
    }

    // The finished, output-mapped picture itself, one texel per pixel. The
    // settled scope pass above is a reduction whose float cell bounds can
    // take in a neighbouring row; a readback of the picture must not.
    @fragment fn outputPictureFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let output = scopeOutputAt(vec2i(input.position.xy));
      return vec4f(output, scopePeakSignal(output));
    }

    // What a region pass shows outside the tiles it has drawn: the whole
    // picture from the last finished frame, which may be a smaller one,
    // stretched over this frame and given the same output mapping.
    @fragment fn placeholderFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let uv = input.position.xy / frameDimensions();
      let dimensions=vec2i(textureDimensions(spatialTexture));
      let point=uv*vec2f(dimensions)-vec2f(0.5);
      let first=vec2i(floor(point)); let fraction=fract(point);
      let bound=dimensions-vec2i(1);
      let a=filmStoredRgb(textureLoad(spatialTexture,clamp(first,vec2i(0),bound),0));
      let b=filmStoredRgb(textureLoad(spatialTexture,clamp(first+vec2i(1,0),vec2i(0),bound),0));
      let c=filmStoredRgb(textureLoad(spatialTexture,clamp(first+vec2i(0,1),vec2i(0),bound),0));
      let d=filmStoredRgb(textureLoad(spatialTexture,clamp(first+vec2i(1,1),vec2i(0),bound),0));
      let filmOutput = applyOutputHighlights(mix(mix(a,b,fraction.x),mix(c,d,fraction.x),fraction.y));
      let output = select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), displayHdr(filmOutput), outputIsHdr());
      return vec4f(displayEncode(output), 1.0);
    }

    @fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      // This is the one pass whose render target is the whole canvas while its
      // input may be a single tile, so it is the one place that has to convert
      // a global fragment position into a tile-local texel. p[${GPU_PARAMS.TILE_ORIGIN_X}..161] are the
      // tile origin, and Direct leaves them at zero.
      let tileOrigin = vec2i(i32(p[${GPU_PARAMS.TILE_ORIGIN_X}]), i32(p[${GPU_PARAMS.TILE_ORIGIN_Y}]));
      let coordinate = clamp(vec2i(input.position.xy) - tileOrigin, vec2i(0), vec2i(dimensions) - vec2i(1));
      // The noise view is already display-encoded gray; it bypasses the grade's
      // output mapping, and the canvas transfer is the same sRGB curve.
      if (noiseViewActive()) { return vec4f(clamp(finishedAt(coordinate), vec3f(0.0), vec3f(1.0)), 1.0); }
      let filmOutput = applyOutputHighlights(finishedAt(coordinate));
      let output = select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), displayHdr(filmOutput), outputIsHdr());
      var encoded = displayEncode(output);
      if (p[${GPU_PARAMS.OVERLAY_ENABLED}] > 0.5) {
        let uv = maskUv(coordinate, vec2f(textureDimensions(overlayMaskTexture)));
        let mask = textureSampleLevel(overlayMaskTexture, spatialSampler, uv, 0.0).r;
        encoded = mix(encoded, vec3f(p[${GPU_PARAMS.OVERLAY_RED}], p[${GPU_PARAMS.OVERLAY_GREEN}], p[${GPU_PARAMS.OVERLAY_BLUE}]), clamp(mask * p[${GPU_PARAMS.OVERLAY_OPACITY}] * 0.52, 0.0, 0.52));
      }
      return vec4f(encoded, 1.0);
    }
  `;

  const LUMA_MASK_SHADER_SOURCE = String.raw`
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read> p: array<f32>;
    @group(0) @binding(2) var operandTexture: texture_2d<f32>;

    struct VertexOut { @builtin(position) position: vec4f }

    @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
      var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: VertexOut;
      output.position = vec4f(positions[index], 0.0, 1.0);
      return output;
    }

    fn pixelCoordinate(position: vec2f) -> vec2i {
      let dimensions = textureDimensions(sourceTexture);
      return clamp(vec2i(position), vec2i(0), vec2i(dimensions) - vec2i(1));
    }

    @fragment fn sceneLuminanceFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let source = textureLoad(sourceTexture, pixelCoordinate(input.position.xy), 0).rgb;
      let luma = dot(source, vec3f(0.2722287, 0.6740818, 0.0536895));
      return vec4f(luma, luma, luma, 1.0);
    }

    @fragment fn linearGradientFragmentMain(input: VertexOut) -> @location(0) vec4f {
      var coordinate = input.position.xy + vec2f(p[${MASK_PARAMS.GRADIENT.ORIGIN_X}], p[${MASK_PARAMS.GRADIENT.ORIGIN_Y}]);
      let transform = u32(p[${MASK_PARAMS.GRADIENT.TRANSFORM}]);
      let rotation = transform & 3u;
      let sourceSize = vec2f(p[${MASK_PARAMS.GRADIENT.SOURCE_WIDTH}], p[${MASK_PARAMS.GRADIENT.SOURCE_HEIGHT}]);
      let outputSize = select(sourceSize, sourceSize.yx, (rotation & 1u) != 0u);
      if ((transform & 4u) != 0u) { coordinate.x = outputSize.x - coordinate.x; }
      if ((transform & 8u) != 0u) { coordinate.y = outputSize.y - coordinate.y; }
      if (rotation == 1u) { coordinate = vec2f(coordinate.y, sourceSize.y - coordinate.x); }
      else if (rotation == 2u) { coordinate = sourceSize - coordinate; }
      else if (rotation == 3u) { coordinate = vec2f(sourceSize.x - coordinate.y, coordinate.x); }
      let uv = coordinate / max(vec2f(p[${MASK_PARAMS.GRADIENT.SOURCE_WIDTH}], p[${MASK_PARAMS.GRADIENT.SOURCE_HEIGHT}]), vec2f(1.0));
      let axis = vec2f(p[${MASK_PARAMS.GRADIENT.END_X}] - p[${MASK_PARAMS.GRADIENT.START_X}], p[${MASK_PARAMS.GRADIENT.END_Y}] - p[${MASK_PARAMS.GRADIENT.START_Y}]);
      let denominator = max(dot(axis, axis), 0.00000001);
      let axisLength = max(sqrt(denominator), 0.00000001);
      let perpendicular = tanh(dot(uv - vec2f(p[${MASK_PARAMS.GRADIENT.START_X}], p[${MASK_PARAMS.GRADIENT.START_Y}]), vec2f(-axis.y, axis.x)) / (axisLength * axisLength));
      let fanScale = clamp(1.0 + p[${MASK_PARAMS.GRADIENT.FAN}] * 0.8 * perpendicular * perpendicular, 0.2, 1.8);
      let position = dot(uv - vec2f(p[${MASK_PARAMS.GRADIENT.START_X}], p[${MASK_PARAMS.GRADIENT.START_Y}]), axis) / denominator / fanScale;
      let first = clamp(position / max(p[${MASK_PARAMS.GRADIENT.MIDPOINT_1}], 0.000001), 0.0, 1.0);
      let middle = clamp((position - p[${MASK_PARAMS.GRADIENT.MIDPOINT_1}]) / max(p[${MASK_PARAMS.GRADIENT.MIDPOINT_2}] - p[${MASK_PARAMS.GRADIENT.MIDPOINT_1}], 0.000001), 0.0, 1.0);
      let last = clamp((position - p[${MASK_PARAMS.GRADIENT.MIDPOINT_2}]) / max(1.0 - p[${MASK_PARAMS.GRADIENT.MIDPOINT_2}], 0.000001), 0.0, 1.0);
      var value = select(1.0 - first / 3.0,
        select(2.0 / 3.0 - middle / 3.0, (1.0 - last) / 3.0, position > p[${MASK_PARAMS.GRADIENT.MIDPOINT_2}]),
        position > p[${MASK_PARAMS.GRADIENT.MIDPOINT_1}]);
      if (p[${MASK_PARAMS.GRADIENT.INVERT}] > 0.5) { value = 1.0 - value; }
      if (p[${MASK_PARAMS.GRADIENT.ENABLED}] < 0.5) { value = 0.0; }
      // Keep Fan coverage in float: rounding its curved profile to a byte
      // before half-float storage adds a second quantization at byte ties.
      // The neutral Fan path retains its established byte coverage.
      value = clamp(value, 0.0, 1.0);
      if (p[${MASK_PARAMS.GRADIENT.FAN}] == 0.0) { value = round(value * 255.0) / 255.0; }
      return vec4f(value, value, value, 1.0);
    }

    fn maskSegmentDistance(point: vec2f, first: vec2f, last: vec2f, floorValue: f32) -> f32 {
      let delta = last - first;
      let projection = clamp(dot(point - first, delta) / max(dot(delta, delta), floorValue), 0.0, 1.0);
      return distance(point, first + projection * delta);
    }

    // Native hard edges need the CPU's rounded pixel-centre division. A GPU
    // reciprocal approximation can move a centre across a polygon edge.
    fn maskDivide(numerator: f32, denominator: f32) -> f32 {
      let quotient = numerator / denominator;
      return quotient + fma(-quotient, denominator, numerator) / denominator;
    }

    fn shapeRasterCoverage(position: vec2f) -> vec2f {
      var pixel = position + vec2f(p[${MASK_PARAMS.RASTER.ORIGIN_X}], p[${MASK_PARAMS.RASTER.ORIGIN_Y}]);
      // Export rasterizes in source space, then applies quarter turns and
      // flips. Invert those exact pixel permutations before qualification.
      let transform = u32(p[${MASK_PARAMS.RASTER.TRANSFORM}]);
      let rotation = transform & 3u;
      let sourceSize = vec2f(p[${MASK_PARAMS.RASTER.SOURCE_WIDTH}],p[${MASK_PARAMS.RASTER.SOURCE_HEIGHT}]);
      let outputSize = select(sourceSize,sourceSize.yx,(rotation & 1u) != 0u);
      if ((transform & 4u) != 0u) { pixel.x = outputSize.x-pixel.x; }
      if ((transform & 8u) != 0u) { pixel.y = outputSize.y-pixel.y; }
      if (rotation == 1u) { pixel = vec2f(pixel.y,sourceSize.y-pixel.x); }
      else if (rotation == 2u) { pixel = sourceSize-pixel; }
      else if (rotation == 3u) { pixel = vec2f(sourceSize.x-pixel.y,pixel.x); }
      let uv = vec2f(maskDivide(pixel.x, p[${MASK_PARAMS.RASTER.SOURCE_WIDTH}]), maskDivide(pixel.y, p[${MASK_PARAMS.RASTER.SOURCE_HEIGHT}]));
      var value = 0.0;
      var attenuation = 1.0;
      let count = u32(p[${MASK_PARAMS.RASTER.ITEM_COUNT}]);
      if (p[${MASK_PARAMS.RASTER.KIND}] > 0.5) {
        var inside = false;
        var edge = 1e20;
        let aspect = p[${MASK_PARAMS.RASTER.SOURCE_WIDTH}] / p[${MASK_PARAMS.RASTER.SOURCE_HEIGHT}];
        let metric = vec2f(max(aspect, 1.0), max(1.0 / aspect, 1.0));
        let outer = p[${MASK_PARAMS.RASTER.KIND}] > 1.5;
        let stride = select(${PASS_LAYOUTS.layouts.PATH_POINT.count}u,${PASS_LAYOUTS.layouts.PATH_POINT.count + PASS_LAYOUTS.layouts.PATH_WIDTH.count}u,outer);
        let start = select(${PASS_LAYOUTS.layouts.RASTER.count}u,${PASS_LAYOUTS.layouts.RASTER.count + PASS_LAYOUTS.layouts.PATH_OUTER.count}u,outer);
        var transition = 0.0;
        for (var i = 0u; i < count; i++) {
          let firstIndex = start + stride * i;
          let lastIndex = start + stride * ((i + 1u) % count);
          let first = vec2f(p[${PASS_LAYOUTS.offset("firstIndex", MASK_PARAMS.PATH_POINT.X)}], p[${PASS_LAYOUTS.offset("firstIndex", MASK_PARAMS.PATH_POINT.Y)}]);
          let last = vec2f(p[${PASS_LAYOUTS.offset("lastIndex", MASK_PARAMS.PATH_POINT.X)}], p[${PASS_LAYOUTS.offset("lastIndex", MASK_PARAMS.PATH_POINT.Y)}]);
          let crossing = (first.y > uv.y) != (last.y > uv.y);
          let edgeX = maskDivide((last.x-first.x)*(uv.y-first.y), last.y-first.y+1e-12)+first.x;
          if (crossing && uv.x < edgeX) { inside = !inside; }
          edge = min(edge, maskSegmentDistance(uv*metric, first*metric, last*metric, 1e-12));
          if (outer) {
            let a=first*metric;let delta=last*metric-a;
            let projection=clamp(dot(uv*metric-a,delta)/max(dot(delta,delta),1e-12),0.0,1.0);
            let distance=length(uv*metric-(a+projection*delta));
            let width=p[${PASS_LAYOUTS.offset("firstIndex", PASS_LAYOUTS.layouts.PATH_POINT.count + MASK_PARAMS.PATH_WIDTH.WIDTH_START)}]+projection*(p[${PASS_LAYOUTS.offset("firstIndex", PASS_LAYOUTS.layouts.PATH_POINT.count + MASK_PARAMS.PATH_WIDTH.WIDTH_END)}]-p[${PASS_LAYOUTS.offset("firstIndex", PASS_LAYOUTS.layouts.PATH_POINT.count + MASK_PARAMS.PATH_WIDTH.WIDTH_START)}]);
            let t=distance/max(width,1e-6);
            let compact=clamp(1.0-t,0.0,1.0);
            let compactProfile=compact*compact*(3.0-2.0*compact);
            var soft=1.0-(t-.05)/.9;
            if(t<.1){soft=1.0-t*t/.18;}
            else if(t>.9){soft=(1.0-t)*(1.0-t)/.18;}
            soft=select(0.0,clamp(soft,0.0,1.0),t<=1.0);
            transition=max(transition,compactProfile+clamp(p[${PASS_LAYOUTS.layouts.RASTER.count + MASK_PARAMS.PATH_OUTER.SOFTNESS}],0.0,1.0)*(soft-compactProfile));
          }
        }
        value = select(0.0, 1.0, inside);
        if (outer) {value=select(transition,1.0,inside);}
        else if (count > 0u && p[${MASK_PARAMS.RASTER.FEATHER}] > 0.0) {
          let feather = clamp(edge / max(p[${MASK_PARAMS.RASTER.FEATHER}], 1e-6), 0.0, 1.0);
          value = select(0.5-0.5*feather, 0.5+0.5*feather, inside);
        }
      } else {
        let point = pixel / p[${MASK_PARAMS.RASTER.SOURCE_WIDTH}];
        var cursor = ${PASS_LAYOUTS.layouts.RASTER.count}u;
        var eraseSeen = false;
        for (var i = 0u; i < count; i++) {
          let segments = u32(p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.SEGMENT_COUNT)}]);
          let hardness = p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.HARDNESS)}];
          let flow = p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.FLOW)}];
          let opacity = p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.OPACITY)}];
          let erase = p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.ERASE)}] > 0.5;
          let within = pixel.x >= p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.LEFT)}] && pixel.y >= p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.TOP)}]
            && pixel.x < p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.RIGHT)}] && pixel.y < p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.STROKE.BOTTOM)}];
          cursor += ${PASS_LAYOUTS.layouts.STROKE.count}u;
          var coverage = 0.0;
          for (var j = 0u; j < segments; j++) {
            if (within) {
              let first = vec2f(p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.SEGMENT.START_X)}],p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.SEGMENT.START_Y)}]);
              let last = vec2f(p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.SEGMENT.END_X)}],p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.SEGMENT.END_Y)}]);
              let radius = p[${PASS_LAYOUTS.offset("cursor", MASK_PARAMS.SEGMENT.RADIUS)}];
              let distance = maskSegmentDistance(point, first, last, 1e-8);
              coverage = max(coverage, 1.0-clamp((distance-radius*hardness)/max(radius*(1.0-hardness),1e-6),0.0,1.0));
            }
            cursor += ${PASS_LAYOUTS.layouts.SEGMENT.count}u;
          }
          let strength = min(opacity, coverage*flow);
          if (erase) { attenuation *= 1.0-strength; eraseSeen = true; }
          else if (within) {
            value = max(value, min(opacity, value+strength));
            if (eraseSeen) { attenuation = max(attenuation, min(opacity, attenuation+strength)); }
          }
        }
      }
      return vec2f(value, attenuation);
    }

    @fragment fn brushPaintFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return vec4f(shapeRasterCoverage(input.position.xy).xxx, 1.0);
    }
    @fragment fn brushEraseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return vec4f(shapeRasterCoverage(input.position.xy).yyy, 1.0);
    }
    // Feather/Invert precede Erase in export. Keep the qualified painted
    // bitmap, but evaluate post-feather attenuation at native pixel centres.
    @fragment fn brushRegionalEraseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let tail=arrayLength(&p)-${PASS_LAYOUTS.layouts.REGIONAL_ERASE.count}u;
      let frame=vec2f(p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.FRAME_WIDTH)}],p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.FRAME_HEIGHT)}]);
      let pixel=input.position.xy+vec2f(p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.ORIGIN_X)}],p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.ORIGIN_Y)}]);
      let origin=vec2f(p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.RECT_X)}],p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.RECT_Y)}]);
      let extent=vec2f(p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.RECT_WIDTH)}],p[${PASS_LAYOUTS.offset("tail", MASK_PARAMS.REGIONAL_ERASE.RECT_HEIGHT)}]);
      let size=vec2i(textureDimensions(sourceTexture));
      let at=(pixel/frame-origin)/extent*vec2f(size)-.5;
      let base=vec2i(floor(at));let fraction=fract(at);
      let a=textureLoad(sourceTexture,clamp(base,vec2i(0),size-1),0).r;
      let b=textureLoad(sourceTexture,clamp(base+vec2i(1,0),vec2i(0),size-1),0).r;
      let c=textureLoad(sourceTexture,clamp(base+vec2i(0,1),vec2i(0),size-1),0).r;
      let d=textureLoad(sourceTexture,clamp(base+vec2i(1,1),vec2i(0),size-1),0).r;
      let painted=mix(mix(a,b,fraction.x),mix(c,d,fraction.x),fraction.y);
      let value=round(clamp(painted*shapeRasterCoverage(input.position.xy).y,0.0,1.0)*255.0)/255.0;
      return vec4f(vec3f(value),1.0);
    }
    @fragment fn shapeRasterFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coverage = shapeRasterCoverage(input.position.xy);
      var value = coverage.x;
      if (p[${MASK_PARAMS.RASTER.INVERT}] > 0.5) { value = 1.0-value; }
      value *= coverage.y;
      if (p[${MASK_PARAMS.RASTER.ENABLED}] < 0.5) { value = 0.0; }
      value = round(clamp(value,0.0,1.0)*255.0)/255.0;
      return vec4f(value,value,value,1.0);
    }

    @fragment fn lumaQualificationFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let luma = textureLoad(sourceTexture, pixelCoordinate(input.position.xy), 0).r;
      let ev = log2(max(luma, 0.00000001) / 0.18);
      let rise = clamp((ev - p[${MASK_PARAMS.LUMA.FADE_IN_START}]) / max(p[${MASK_PARAMS.LUMA.FULL_START}] - p[${MASK_PARAMS.LUMA.FADE_IN_START}], 0.000001), 0.0, 1.0);
      let fall = clamp((p[${MASK_PARAMS.LUMA.FADE_OUT_END}] - ev) / max(p[${MASK_PARAMS.LUMA.FADE_OUT_END}] - p[${MASK_PARAMS.LUMA.FULL_END}], 0.000001), 0.0, 1.0);
      let mask = min(rise, fall);
      return vec4f(mask, mask, mask, 1.0);
    }

    // One axis of a Gaussian feather: p[${MASK_PARAMS.LUMA.FADE_IN_START}] sigma in texels, p[${MASK_PARAMS.LUMA.FULL_END}] axis (0 x,
    // 1 y), p[${MASK_PARAMS.LUMA.FADE_OUT_END}] invert. Every texel within three sigma is read. The former
    // pass read 25 taps a quarter-sigma apart, which skipped any feature
    // narrower than the spacing and turned a thin strip into a row of copies.
    // The edge is extended, as in the backend's blur.
    @fragment fn maskRefinementFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2i(textureDimensions(sourceTexture));
      let coordinate = pixelCoordinate(input.position.xy);
      let sigma = p[${MASK_PARAMS.FEATHER.SIGMA}];
      var value = textureLoad(sourceTexture, coordinate, 0).r;
      if (p[${MASK_PARAMS.FEATHER.TAP_COUNT}] > 0.0 && sigma >= 0.25) {
        let direction = select(vec2i(1,0),vec2i(0,1),p[${MASK_PARAMS.FEATHER.AXIS}]>.5);
        value*=p[${PASS_LAYOUTS.layouts.FEATHER.count + MASK_PARAMS.FEATHER_WEIGHT.WEIGHT}];
        for(var tap=1;tap<i32(p[${MASK_PARAMS.FEATHER.TAP_COUNT}]);tap++){
          value+=p[u32(tap)+${PASS_LAYOUTS.layouts.FEATHER.count + MASK_PARAMS.FEATHER_WEIGHT.WEIGHT}u]*(textureLoad(sourceTexture,clamp(coordinate+direction*tap,vec2i(0),dimensions-1),0).r
            +textureLoad(sourceTexture,clamp(coordinate-direction*tap,vec2i(0),dimensions-1),0).r);
        }
      } else if (sigma >= 0.25) {
        let direction = select(vec2i(1, 0), vec2i(0, 1), p[${MASK_PARAMS.FEATHER.AXIS}] > 0.5);
        let reach = min(i32(ceil(sigma * 3.0)), 64);
        var total = 0.0;
        var weightTotal = 0.0;
        for (var tap = -reach; tap <= reach; tap = tap + 1) {
          let weight = exp(-0.5 * f32(tap * tap) / (sigma * sigma));
          let sampleCoordinate = clamp(coordinate + direction * tap, vec2i(0), dimensions - vec2i(1));
          total += textureLoad(sourceTexture, sampleCoordinate, 0).r * weight;
          weightTotal += weight;
        }
        value = total / max(weightTotal, 0.000001);
      }
      if (p[${MASK_PARAMS.FEATHER.INVERT}] > 0.5) { value = 1.0 - value; }
      return vec4f(value, value, value, 1.0);
    }

    // Area-average p[${MASK_PARAMS.FEATHER.SIGMA}] texels along one axis (p[${MASK_PARAMS.FEATHER.TAP_COUNT}]: 0 x, 1 y) into one. A
    // thin feature keeps its share of the average instead of being missed.
    @fragment fn maskDownsampleFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2i(textureDimensions(sourceTexture));
      let output = vec2i(input.position.xy);
      let factor = i32(p[${MASK_PARAMS.DOWNSAMPLE.FACTOR}]);
      let alongY = p[${MASK_PARAMS.DOWNSAMPLE.AXIS}] > 0.5;
      let start = select(output.x, output.y, alongY) * factor;
      let stop = min(start + factor, select(dimensions.x, dimensions.y, alongY));
      var total = 0.0;
      var count = 0.0;
      for (var index = start; index < stop; index = index + 1) {
        let coordinate = select(vec2i(index, output.y), vec2i(output.x, index), alongY);
        total += textureLoad(sourceTexture, clamp(coordinate, vec2i(0), dimensions - vec2i(1)), 0).r;
        count += 1.0;
      }
      let value = total / max(count, 1.0);
      return vec4f(value, value, value, 1.0);
    }

    // Bilinear upsample of a mask reduced by p[${MASK_PARAMS.DOWNSAMPLE.FACTOR}] in both axes; p[${MASK_PARAMS.DOWNSAMPLE.AXIS}] inverts.
    @fragment fn maskUpsampleFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let reduced = vec2i(textureDimensions(sourceTexture));
      let position = input.position.xy / p[${MASK_PARAMS.UPSAMPLE.FACTOR}] - vec2f(0.5);
      let origin = floor(position);
      let fraction = position - origin;
      let base = vec2i(origin);
      let last = reduced - vec2i(1);
      let a = textureLoad(sourceTexture, clamp(base, vec2i(0), last), 0).r;
      let b = textureLoad(sourceTexture, clamp(base + vec2i(1, 0), vec2i(0), last), 0).r;
      let c = textureLoad(sourceTexture, clamp(base + vec2i(0, 1), vec2i(0), last), 0).r;
      let d = textureLoad(sourceTexture, clamp(base + vec2i(1, 1), vec2i(0), last), 0).r;
      var value = mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
      if (p[${MASK_PARAMS.UPSAMPLE.INVERT}] > 0.5) { value = 1.0 - value; }
      return vec4f(value, value, value, 1.0);
    }

    @fragment fn maskCombineFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = pixelCoordinate(input.position.xy);
      let left = clamp(textureLoad(sourceTexture, coordinate, 0).r * p[${MASK_PARAMS.COMBINE.LEFT_OPACITY}], 0.0, 1.0);
      let right = clamp(textureLoad(operandTexture, coordinate, 0).r * p[${MASK_PARAMS.COMBINE.RIGHT_OPACITY}], 0.0, 1.0);
      var value = max(left, right);
      if (p[${MASK_PARAMS.COMBINE.OPERATOR}] > 0.5 && p[${MASK_PARAMS.COMBINE.OPERATOR}] < 1.5) { value = left * right; }
      if (p[${MASK_PARAMS.COMBINE.OPERATOR}] > 1.5) { value = left * (1.0 - right); }
      if (p[${MASK_PARAMS.COMBINE.INVERT}] > 0.5) { value = 1.0 - value; }
      return vec4f(value, value, value, 1.0);
    }
  `;

  const HDRWebGPUShaders = Object.freeze({
    BLACK_AND_WHITE_PARAM,
    FILM_DETAIL_BLOCK,
    PEAK_REDUCTION_SHADER_SOURCE,
    SCALED_FILM_PEAK_REDUCTION_SHADER_SOURCE,
    ADAPTIVE_DENOISE_SHADER_SOURCE,
    GRAIN_DENOISE_SHADER_SOURCE, GRAIN_DENOISE_BANDS, GRAIN_DENOISE_RADIUS, GRAIN_FIT_BLOCK, GRAIN_RESIZE_SHADER_SOURCE,
    CLEAN_GRAIN_SHADER_SOURCE, CLEAN_GRAIN_RESIZE_SHADER_SOURCE,
    MICRO_GRAIN_SHADER_SOURCE,
    SHADER_SOURCE, LENS_KERNEL_SIZE,
    LUMA_MASK_SHADER_SOURCE,
  });

  if (typeof window !== "undefined") window.HDRWebGPUShaders = HDRWebGPUShaders;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRWebGPUShaders };
})();
