(function () {
  // 160 and 161 carry the tile origin in global output coordinates. Direct
  // execution leaves them at zero, so its arithmetic is unchanged.
  // 160/161: tile origin; 162/163: valid tile extent; 164/165: full output
  // extent. Direct leaves the tile fields zero and falls back to the bound
  // texture dimensions.
  const PARAM_COUNT = 166;
  const TILE_ORIGIN_X_INDEX = 160;
  const TILE_ORIGIN_Y_INDEX = 161;
  const CURVE_SAMPLES = 1024;
  const PEAK_HISTOGRAM_BINS = 4096;
  // The tile peak reduction target. A maximum is decomposable, so this grid
  // is a work-splitting device and not a picture: any size gives the exact same
  // answer. 64 x 64 keeps each fragment's loop to roughly (workTile / 64)^2
  // iterations -- about 64 for a 528-pixel work tile -- and the readback to
  // 32 KB per generation.
  const SCOPE_PEAK_GRID = 64;

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
fn peakAcescgToBt2020(rgb: vec3f) -> vec3f {
  return vec3f(
    1.0260187082 * rgb.r - 0.0221655448 * rgb.g - 0.0038531634 * rgb.b,
   -0.0017230808 * rgb.r + 1.0023190716 * rgb.g - 0.0005959908 * rgb.b,
   -0.0051099278 * rgb.r - 0.0216355504 * rgb.g + 1.0267454781 * rgb.b
  );
}
fn peakTone(input: vec3f) -> vec3f {
  var rgb = input * exp2(peakParams[2]);
  if (peakParams[4] != 0.0) {
    let lift = min(peakParams[4] * (1.0 - clamp(peakLuma(rgb), 0.0, 1.0)), 1.0);
    rgb *= 1.0 + lift;
  }
  if (peakParams[8] != 0.0) {
    let y = max(peakLuma(rgb), 0.0);
    if (y > 0.00000001) {
      let pivot = max(peakParams[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      rgb *= pivot * exp2(clamp(stops * exp2(peakParams[8]), -32.0, 32.0)) / y;
    }
  }
  return rgb;
}
fn peakSceneColor(input: vec3f) -> vec3f {
  if (peakParams[72] < 0.5) { return input; }
  let offset = (peakParams[10] - 6500.0) / 6500.0;
  let balanced = input * vec3f(1.0 + offset * 0.15, 1.0 + peakParams[11] * 0.08, 1.0 - offset * 0.15);
  let rgb = vec3f(
    peakParams[61] * balanced.r + peakParams[62] * balanced.g + peakParams[63] * balanced.b,
    peakParams[64] * balanced.r + peakParams[65] * balanced.g + peakParams[66] * balanced.b,
    peakParams[67] * balanced.r + peakParams[68] * balanced.g + peakParams[69] * balanced.b
  );
  let y = peakLuma(rgb);
  let neutral = vec3f(y);
  let chroma = rgb - neutral;
  let maximum = max(rgb.r, max(rgb.g, rgb.b));
  let minimum = min(rgb.r, min(rgb.g, rgb.b));
  let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
  let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
  let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
  return neutral + chroma * max(0.0, 1.0 + peakParams[71] * vibranceWeight) * max(0.0, 1.0 + peakParams[70]);
}
fn peakSdrInput(input: vec3f) -> vec3f {
  var rgb = input * exp2(peakParams[2]);
  if (peakParams[1] > 0.5) {
    rgb = max(rgb, vec3f(0.0));
    if (peakParams[4] != 0.0) {
      let mask = 1.0 - smoothstep(0.0, 0.5, peakSrgbLuma(rgb));
      rgb = max(rgb + vec3f(peakParams[4] * 0.08 * mask), vec3f(0.0));
    }
    return rgb;
  }
  rgb = max(rgb, vec3f(0.0));
  if (peakParams[4] != 0.0) {
    let mask = 1.0 - smoothstep(0.0, 0.5, peakLuma(rgb));
    rgb = max(rgb + vec3f(peakParams[4] * 0.08 * mask), vec3f(0.0));
  }
  return peakAcescgToSrgb(peakSceneColor(rgb)) * ((100.0 / 203.0) / 0.18);
}

// The measurement domain follows the selected colour handling: BT.2020 channel
// peak for Smooth Rolloff, RGB channel peak for Path to White, luminance
// otherwise. Both entry points must agree on it.
fn peakSignalOf(rgb: vec3f, sdrV2: bool) -> f32 {
  let channelPeak = max(max(rgb.r, rgb.g), rgb.b);
  let transport = peakAcescgToBt2020(rgb);
  let transportPeak = max(max(transport.r, transport.g), transport.b);
  var signal = select(peakLuma(rgb), peakSrgbLuma(rgb), sdrV2);
  if (sdrV2 && peakParams[110] > 0.5) {
    signal = channelPeak;
  } else if (peakParams[110] > 1.5) {
    signal = transportPeak;
  } else if (peakParams[110] > 0.5) {
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
  let sdrV2 = peakParams[0] < 0.5 && peakParams[159] > 0.5;
  let rgb = select(peakTone(source), peakSdrInput(source), sdrV2);
  recordPeak(peakSignalOf(rgb, sdrV2));
}

// Reads an already-finished render target, so no stage of the grade has to be
// re-derived analytically. This is the domain the CPU limiter measures in.
@compute @workgroup_size(8, 8)
fn finishedPeakReductionMain(@builtin(global_invocation_id) id: vec3u) {
  let dimensions = textureDimensions(peakSource);
  if (id.x >= dimensions.x || id.y >= dimensions.y) { return; }
  let rgb = textureLoad(peakSource, vec2i(id.xy), 0).rgb;
  let sdrV2 = peakParams[0] < 0.5 && peakParams[159] > 0.5;
  recordPeak(peakSignalOf(rgb, sdrV2));
}`;
  const DENOISE_ALGORITHM_VERSION = "compact-haar-residual-v1";
  // Preserve progressively more structure at medium/coarse Haar scales. Full
  // strength at all levels makes a three-level resolve visibly tile into 8x8
  // blocks when Amount and Luminance approach 100%.
  const DENOISE_LEVEL_WEIGHTS = Object.freeze([1.0, 0.55, 0.25, 0.1]);
  // Large enough that one 42 MP frame is tens of tiles rather than hundreds of
  // textures, small enough that the reusable analysis scratch chain stays a
  // couple of megabytes. Rounded up to the wavelet alignment when used.
  const DENOISE_TILE_SIZE = 1024;
  const DENOISE_SHADER_SOURCE = `
// rect: (outWidth, outHeight, sourceOriginX, sourceOriginY) and valid:
// (sourceValidWidth, sourceValidHeight, ...) turn this into a tiled kernel.
// The Haar block grid is what a tile has to respect, so a tile origin is always
// a multiple of 2^levels and the parity arithmetic below is unchanged by it.
// Clamping is to the *valid* sub-rect rather than to the bound texture, because
// level 1 and above read a reusable scratch texture that is larger than the
// tile's own low band; clamping to the allocation would invent edge pixels that
// the whole-image run never sees.
struct AnalysisParams { sigmaThreshold: vec4f, rect: vec4f, valid: vec4f, };
@group(0) @binding(0) var analysisSource: texture_2d<f32>;
@group(0) @binding(1) var analysisLow: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var analysisH: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var analysisV: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var analysisD: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> analysisParams: AnalysisParams;

fn loadClamped(source: texture_2d<f32>, p: vec2i) -> vec3f {
  let valid = vec2i(i32(analysisParams.valid.x), i32(analysisParams.valid.y));
  let origin = vec2i(i32(analysisParams.rect.z), i32(analysisParams.rect.w));
  let size = min(valid, vec2i(textureDimensions(source)) - origin);
  return textureLoad(source, origin + clamp(p, vec2i(0), size - vec2i(1)), 0).rgb;
}
fn components(rgb: vec3f) -> vec3f {
  let y = dot(rgb, vec3f(0.2722287, 0.6740818, 0.0536895));
  return vec3f(y, rgb.r - y, rgb.b - y);
}
fn magnitude(c: vec3f, sigma: vec3f) -> f32 {
  let scaled = c / sigma;
  return sqrt(scaled.x * scaled.x + dot(scaled.yz, scaled.yz));
}
fn evidence(c: vec3f, mag: f32, total: f32) -> vec4f {
  let ratio = mag / analysisParams.sigmaThreshold.w;
  let confidence = 1.0 / (1.0 + ratio * ratio * ratio * ratio);
  let directional = clamp((mag / max(total, 1e-6) - 0.5) / 0.4, 0.0, 1.0);
  let threshold = clamp(4.0 * confidence * (1.0 - confidence), 0.0, 1.0);
  return vec4f(c * confidence, max(directional, threshold));
}
@compute @workgroup_size(8, 8)
fn analyzeMain(@builtin(global_invocation_id) id: vec3u) {
  let outSize = vec2u(u32(analysisParams.rect.x), u32(analysisParams.rect.y));
  if (id.x >= outSize.x || id.y >= outSize.y) { return; }
  let p = vec2i(id.xy) * 2;
  let a = loadClamped(analysisSource, p);
  let b = loadClamped(analysisSource, p + vec2i(1, 0));
  let c = loadClamped(analysisSource, p + vec2i(0, 1));
  let d = loadClamped(analysisSource, p + vec2i(1, 1));
  let h = components((a - b + c - d) * 0.25);
  let v = components((a + b - c - d) * 0.25);
  let diagonal = components((a - b - c + d) * 0.25);
  let sigma = analysisParams.sigmaThreshold.xyz;
  let mh = magnitude(h, sigma);
  let mv = magnitude(v, sigma);
  let md = magnitude(diagonal, sigma);
  let total = mh + mv + md;
  textureStore(analysisLow, vec2i(id.xy), vec4f((a + b + c + d) * 0.25, 1.0));
  textureStore(analysisH, vec2i(id.xy), evidence(h, mh, total));
  textureStore(analysisV, vec2i(id.xy), evidence(v, mv, total));
  textureStore(analysisD, vec2i(id.xy), evidence(diagonal, md, total));
}

// rect: (outWidth, outHeight, originX, originY). The origin applies to the
// output store and to the original read, and is zero for the intermediate
// passes that write into a tile-local scratch. Evidence is always read at
// tile-local coordinates, because evidence is stored per tile.
// The rect is (width, height, x, y) in frame coordinates. The origin is where
// the destination texture's own (0, 0) sits in those coordinates, so a
// reconstruction can read the whole-frame original at its true position while
// writing into a texture that covers only one tile. Whole-frame destinations
// leave it at zero, which makes reading and writing the same coordinate again.
struct ResolveParams { weights: vec4f, flags: vec4f, rect: vec4f, origin: vec4f, };
@group(1) @binding(0) var resolveLow: texture_2d<f32>;
@group(1) @binding(1) var resolveH: texture_2d<f32>;
@group(1) @binding(2) var resolveV: texture_2d<f32>;
@group(1) @binding(3) var resolveD: texture_2d<f32>;
@group(1) @binding(4) var resolveOriginal: texture_2d<f32>;
@group(1) @binding(5) var resolveOutput: texture_storage_2d<rgba16float, write>;
@group(1) @binding(6) var<uniform> resolveParams: ResolveParams;

fn componentRgb(value: vec3f) -> vec3f {
  let red = value.x + value.y;
  let blue = value.x + value.z;
  let green = (value.x - 0.2722287 * red - 0.0536895 * blue) / 0.6740818;
  return vec3f(red, green, blue);
}
fn weightedDetailWith(packed: vec4f, weights: vec4f) -> vec3f {
  let recovery = 1.0 - weights.w * packed.w;
  let c = packed.xyz * vec3f(weights.y, weights.z, weights.z) * recovery;
  return componentRgb(c) * weights.x;
}
fn weightedDetail(packed: vec4f) -> vec3f {
  return weightedDetailWith(packed, resolveParams.weights);
}
@compute @workgroup_size(8, 8)
fn resolveMain(@builtin(global_invocation_id) id: vec3u) {
  let outSize = vec2u(u32(resolveParams.rect.x), u32(resolveParams.rect.y));
  if (id.x >= outSize.x || id.y >= outSize.y) { return; }
  let p = vec2i(id.xy);
  let frameAt = p + vec2i(i32(resolveParams.rect.z), i32(resolveParams.rect.w));
  let storeAt = frameAt - vec2i(i32(resolveParams.origin.x), i32(resolveParams.origin.y));
  let q = p / 2;
  // A tile origin is a multiple of 2^levels, so local and global parity agree
  // at every level and the sign pattern is the whole-image one.
  let sx = select(1.0, -1.0, (p.x & 1) == 1);
  let sy = select(1.0, -1.0, (p.y & 1) == 1);
  var residual = vec3f(0.0);
  if (resolveParams.flags.x > 0.5) { residual = textureLoad(resolveLow, q, 0).rgb; }
  residual += sx * weightedDetail(textureLoad(resolveH, q, 0));
  residual += sy * weightedDetail(textureLoad(resolveV, q, 0));
  residual += sx * sy * weightedDetail(textureLoad(resolveD, q, 0));
  var rgb = residual;
  if (resolveParams.flags.y > 0.5) { rgb = textureLoad(resolveOriginal, frameAt, 0).rgb - residual; }
  textureStore(resolveOutput, storeAt, vec4f(rgb, 1.0));
}

@group(2) @binding(0) var directH0: texture_2d<f32>;
@group(2) @binding(1) var directV0: texture_2d<f32>;
@group(2) @binding(2) var directD0: texture_2d<f32>;
@group(2) @binding(3) var directH1: texture_2d<f32>;
@group(2) @binding(4) var directV1: texture_2d<f32>;
@group(2) @binding(5) var directD1: texture_2d<f32>;
@group(2) @binding(6) var directOriginal: texture_2d<f32>;
@group(2) @binding(7) var directOutput: texture_storage_2d<rgba16float, write>;
@group(2) @binding(8) var<uniform> directParams: ResolveParams;

@compute @workgroup_size(8, 8)
fn resolveTwoLevelMain(@builtin(global_invocation_id) id: vec3u) {
  let outSize = vec2u(u32(directParams.rect.x), u32(directParams.rect.y));
  if (id.x >= outSize.x || id.y >= outSize.y) { return; }
  let p = vec2i(id.xy);
  let frameAt = p + vec2i(i32(directParams.rect.z), i32(directParams.rect.w));
  let storeAt = frameAt - vec2i(i32(directParams.origin.x), i32(directParams.origin.y));
  let q0 = p / 2;
  let q1 = q0 / 2;
  let sx0 = select(1.0, -1.0, (p.x & 1) == 1);
  let sy0 = select(1.0, -1.0, (p.y & 1) == 1);
  let sx1 = select(1.0, -1.0, (q0.x & 1) == 1);
  let sy1 = select(1.0, -1.0, (q0.y & 1) == 1);
  let weights = directParams.weights;
  var residual = ${DENOISE_LEVEL_WEIGHTS[1]} * sx1 * weightedDetailWith(textureLoad(directH1, q1, 0), weights);
  residual += ${DENOISE_LEVEL_WEIGHTS[1]} * sy1 * weightedDetailWith(textureLoad(directV1, q1, 0), weights);
  residual += ${DENOISE_LEVEL_WEIGHTS[1]} * sx1 * sy1 * weightedDetailWith(textureLoad(directD1, q1, 0), weights);
  residual += sx0 * weightedDetailWith(textureLoad(directH0, q0, 0), weights);
  residual += sy0 * weightedDetailWith(textureLoad(directV0, q0, 0), weights);
  residual += sx0 * sy0 * weightedDetailWith(textureLoad(directD0, q0, 0), weights);
  let rgb = textureLoad(directOriginal, frameAt, 0).rgb - residual;
  textureStore(directOutput, storeAt, vec4f(rgb, 1.0));
}`;

  // The Haar grid a denoise tile must land on. Level 0 consumes 2x2 source
  // blocks, level 1 consumes 2x2 blocks of those, and so on, so a tile that
  // starts on a multiple of 2^levels decomposes exactly as the whole image
  // does at that position -- and needs no halo, because no stage of a Haar
  // transform reads outside its own block.
  function denoiseTileAlignment(levels) {
    if (!Number.isInteger(levels) || levels < 1 || levels > 4) {
      throw new Error("Wavelet analysis supports one through four decimated scales.");
    }
    return 2 ** levels;
  }

  function denoiseSpans(extent, step) {
    const spans = [];
    for (let offset = 0; offset < extent; offset += step) {
      spans.push({ offset, length: Math.min(step, extent - offset) });
    }
    // A one-pixel trailing span has no 2x2 block to transform. Folding it into
    // the previous span leaves every origin on the grid and still covers the
    // image exactly once.
    if (spans.length > 1 && spans.at(-1).length < 2) {
      spans[spans.length - 2].length += spans.at(-1).length;
      spans.pop();
    }
    return spans;
  }

  function alignedDenoiseTiles(width, height, tileSize, levels) {
    if (width <= 0 || height <= 0) throw new Error("Denoise tiling requires a positive image size.");
    if (!(tileSize > 0)) throw new Error("Denoise tile size must be positive.");
    const alignment = denoiseTileAlignment(levels);
    const step = Math.ceil(tileSize / alignment) * alignment;
    const columns = denoiseSpans(width, step);
    const rows = denoiseSpans(height, step);
    const tiles = [];
    for (const row of rows) {
      for (const column of columns) {
        tiles.push({
          x: column.offset,
          y: row.offset,
          width: column.length,
          height: row.length,
          key: `${column.offset},${row.offset},${column.length},${row.length}`,
        });
      }
    }
    return tiles;
  }

  /**
   * The identity an analysis result is cached under.
   *
   * Excludes the live reconstruction controls on purpose: they consume
   * evidence and never create it, so including them would make every slider
   * drag a cache miss -- the exact behaviour the wavelet cache exists to
   * avoid. Kept byte-for-byte in step with `denoise_cache_identity()` in
   * `backend/hdr_finisher/denoise_tiles.py`.
   */
  function denoiseCacheIdentity(sourceIdentity, settings, tile = null) {
    const number = (value) => Number(value).toPrecision(6).replace(/\.?0+e/, "e").replace(/\.?0+$/, "");
    const parts = [
      sourceIdentity,
      DENOISE_ALGORITHM_VERSION,
      `levels=${Math.trunc(settings.levels)}`,
      `noise=${number(settings.noiseThreshold)}`,
      `luma_sigma=${number(settings.lumaSigma)}`,
      `chroma_sigma=${number(settings.chromaSigma)}`,
      `luma_strength=${number(settings.lumaStrength)}`,
      `chroma_strength=${number(settings.chromaStrength)}`,
    ];
    if (tile) parts.push(`tile=${tile.key}`);
    return parts.join("|");
  }

  // Extents of one tile's band chain: entry 0 is the tile itself, entry i is
  // the extent at scale 2^i.
  function denoiseExtentChain(width, height, levels) {
    const chain = [{ width, height }];
    for (let index = 0; index < levels; index += 1) {
      const previous = chain[index];
      chain.push({ width: Math.ceil(previous.width / 2), height: Math.ceil(previous.height / 2) });
    }
    return chain;
  }

  const DEVICE_LIMIT_NAMES = [
    "maxTextureDimension1D", "maxTextureDimension2D", "maxTextureDimension3D",
    "maxTextureArrayLayers", "maxBindGroups", "maxBindingsPerBindGroup",
    "maxDynamicUniformBuffersPerPipelineLayout", "maxDynamicStorageBuffersPerPipelineLayout",
    "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage",
    "maxStorageBuffersPerShaderStage", "maxStorageTexturesPerShaderStage",
    "maxUniformBuffersPerShaderStage", "maxUniformBufferBindingSize",
    "maxStorageBufferBindingSize", "minUniformBufferOffsetAlignment",
    "minStorageBufferOffsetAlignment", "maxBufferSize", "maxColorAttachments",
    "maxColorAttachmentBytesPerSample", "maxComputeWorkgroupStorageSize",
    "maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupSizeY", "maxComputeWorkgroupSizeZ",
    "maxComputeWorkgroupsPerDimension",
  ];

  const STATIC_PREVIEW_MEMORY_CASES = Object.freeze([
    Object.freeze({ id: "24MP", width: 6000, height: 4000 }),
    Object.freeze({ id: "42MP", width: 7000, height: 6000 }),
    Object.freeze({ id: "8K UHD", width: 7680, height: 4320 }),
  ]);

  function denoiseLogicalBytes(width, height, levels = 2) {
    let inputWidth = width;
    let inputHeight = height;
    let evidenceBytes = 0;
    let reconstructionScratchBytes = 0;
    for (let level = 0; level < levels; level += 1) {
      const levelWidth = Math.ceil(inputWidth / 2);
      const levelHeight = Math.ceil(inputHeight / 2);
      evidenceBytes += levelWidth * levelHeight * 8 * 3;
      if (level > 0) reconstructionScratchBytes += inputWidth * inputHeight * 8;
      inputWidth = levelWidth;
      inputHeight = levelHeight;
    }
    return {
      evidenceBytes,
      reconstructionScratchBytes,
      resolvedBytes: width * height * 8,
      totalBytes: evidenceBytes + reconstructionScratchBytes + width * height * 8,
    };
  }

  function directPreviewMemoryModel(width, height, options = {}) {
    const normalizedWidth = Math.max(1, Math.floor(Number(width) || 1));
    const normalizedHeight = Math.max(1, Math.floor(Number(height) || 1));
    const pixels = normalizedWidth * normalizedHeight;
    const detailActive = options.detailActive !== false;
    const spatialActive = options.spatialActive !== false;
    const denoiseLevels = Math.max(0, Math.min(4, Math.floor(Number(options.denoiseLevels ?? 2) || 0)));
    const sourceBytesPerPixel = options.sourceBytesPerPixel === 16 ? 16 : 8;
    const sourceBytes = pixels * sourceBytesPerPixel;
    const gradingBytes = pixels * 8 * 4;
    const detailBytes = detailActive ? pixels * 8 * 2 : 0;
    const spatialWidth = Math.ceil(normalizedWidth / 4);
    const spatialHeight = Math.ceil(normalizedHeight / 4);
    const spatialBytes = spatialActive ? spatialWidth * spatialHeight * 8 * 2 : 0;
    const denoise = denoiseLevels > 0
      ? denoiseLogicalBytes(normalizedWidth, normalizedHeight, denoiseLevels)
      : { evidenceBytes: 0, reconstructionScratchBytes: 0, resolvedBytes: 0, totalBytes: 0 };
    const residentBytes = sourceBytes + gradingBytes + detailBytes + spatialBytes
      + denoise.evidenceBytes + denoise.resolvedBytes;
    const transientBytes = denoise.reconstructionScratchBytes;
    const retainedPresentationOverlapBytes = Math.max(0, Math.floor(Number(options.retainedPresentationOverlapBytes) || 0));
    return {
      width: normalizedWidth,
      height: normalizedHeight,
      pixelCount: pixels,
      sourceBytesPerPixel,
      categories: {
        sourceBytes,
        gradingBytes,
        detailBytes,
        spatialBytes,
        denoiseEvidenceBytes: denoise.evidenceBytes,
        denoiseResolvedBytes: denoise.resolvedBytes,
        denoiseReconstructionScratchBytes: denoise.reconstructionScratchBytes,
      },
      plannedBytes: residentBytes + transientBytes,
      residentBytes,
      transientBytes,
      cachedBytes: sourceBytes + denoise.evidenceBytes,
      retainedPresentationOverlapBytes,
      peakLogicalBytes: residentBytes + transientBytes + retainedPresentationOverlapBytes,
      totalBytes: residentBytes + transientBytes + retainedPresentationOverlapBytes,
    };
  }

  function snapshotDeviceLimits(limits) {
    if (!limits) return null;
    return Object.fromEntries(DEVICE_LIMIT_NAMES
      .filter((name) => Number.isFinite(Number(limits[name])))
      .map((name) => [name, Number(limits[name])]));
  }

  // PRD 4.2: Auto is an application allocation budget, not detected physical
  // VRAM. WebGPU does not report capacity, so the default is a stated policy
  // number rather than a measurement.
  const GPU_BUDGET_AUTO_BYTES = 2 * 1024 * 1024 * 1024;
  const GPU_PLAN_CONTINGENCY_FRACTION = 0.1;

  function normalizeGpuBudgetBytes(value) {
    if (value === "auto" || value === null || value === undefined) return GPU_BUDGET_AUTO_BYTES;
    const gib = Number(value);
    if (!Number.isFinite(gib) || gib < 0.25 || gib > 64) return GPU_BUDGET_AUTO_BYTES;
    return Math.round(gib * 1024 * 1024 * 1024);
  }

  /**
   * Enumerate every resource a Direct render of this graph would hold, rather
   * than estimating a bytes-per-pixel figure. PRD 4.3 admits Direct only when
   * the predicted peak — including retained-presentation overlap, transient
   * scratch, and a contingency margin — fits the configured budget and the
   * device's own limits.
   *
   * This function is pure: the same inputs always produce the same plan and the
   * same decision, which is what the Phase 2 exit gate requires.
   */
  const DEFAULT_TILE_SIZE = 512;

  function detailTileHalo(width, height, params, localAdjustments = [], lane = "hdr") {
    const diagonal = Math.hypot(Math.max(1, width), Math.max(1, height));
    const globalRadii = [
      Math.max(0.35, diagonal * 0.0003),
      Math.max(0.70, diagonal * 0.0012),
      Math.max(0.50, diagonal * Number(params?.[151] || 0) / 100),
      Math.max(0.30, Number(params?.[153] || 0) * Number(params?.[155] || 1)),
    ];
    const radii = [...globalRadii];
    for (const local of localAdjustments) {
      const detail = local?.[`${lane}_grade`]?.detail || {};
      radii.push(
        Math.max(0.35, diagonal * 0.0003),
        Math.max(0.70, diagonal * 0.0012),
        Math.max(0.50, diagonal * Math.min(3, Math.max(0.2, Number(detail.clarity_radius_percent) || 0.75)) / 100),
        Math.max(0.30, Math.min(3, Math.max(0.3, Number(detail.sharpen_radius_px) || 0.8))
          * Math.min(1, Math.max(0.05, Number(params?.[155]) || 1))),
      );
    }
    // Separable analysis reaches two radii in each direction. Texture's edge
    // guide then reaches another two coarse radii into that packed band.
    return Math.ceil(Math.max(2 * radii[0], 4 * radii[1], ...radii.slice(2).map((radius) => 2 * radius)) + 2);
  }

  /**
   * How far past its own rectangle a tile has to be correct for the film stage.
   *
   * Every number here mirrors a line of the shader, because a halo that is
   * derived differently from the radius it is covering is a seam waiting to
   * appear at one particular setting. The blur runs on the quarter-resolution
   * grid, so its reach converts back to full resolution by four; the extract
   * and the finish pass read the film texture directly and reach their own
   * short distances into it.
   *
   * The result is rounded up to a multiple of four so that a tile's halo
   * rectangle starts on a frame quarter-texel boundary. Without that the
   * tile's spatial grid would be offset from the frame's by one, two or three
   * pixels and could not be byte-exact against Direct whatever its size.
   */
  function spatialTileHalo(width, height, params) {
    const quarter = [Math.ceil(Math.max(1, width) / 4), Math.ceil(Math.max(1, height) / 4)];
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const bloomActive = params[92] > 0.5 && params[93] > 0;
    const halationActive = params[85] > 0.5;

    // `spatialBlur`: nine taps out to +/- the radius, in quarter-resolution
    // texels, capped at 64 by the shader exactly as it is here.
    let blurTexels = 0;
    if (bloomActive) {
      blurTexels = Math.max(blurTexels,
        clamp(Math.hypot(quarter[0], quarter[1]) * Math.max(Number(params[95]) || 0, 0) / 100, 0.25, 64));
    }
    if (halationActive) {
      // `filmPixelsPerMm` over the frame's quarter-resolution size.
      let pixelsPerMm = Math.max(quarter[0] / params[140], quarter[1] / params[141]);
      if (params[142] > 0.5 && params[142] < 1.5) pixelsPerMm = quarter[1] / params[141];
      if (params[142] > 1.5) pixelsPerMm = quarter[0] / params[140];
      blurTexels = Math.max(blurTexels,
        clamp(pixelsPerMm * 43.2666153 * Math.max(Number(params[88]) || 0, 0) / 100, 0.25, 64));
    }

    // Full-resolution reads: halation's edge source from `filmPhysicalOffset`,
    // the image-structure blur from `outputRelativeOffset(0.06, 24)`, and the
    // film-resolution blur from `filmPhysicalBlur(<= 0.12, 32)`. `blurAtRadius`
    // taps at exactly +/- its radius.
    const frameDiagonal = Math.hypot(Math.max(1, width), Math.max(1, height));
    let framePixelsPerMm = Math.max(width / params[140], height / params[141]);
    if (params[142] > 0.5 && params[142] < 1.5) framePixelsPerMm = height / params[141];
    if (params[142] > 1.5) framePixelsPerMm = width / params[140];
    const physicalOffset = (percent, maximum) => clamp(
      Math.round(framePixelsPerMm * 43.2666153 * Math.max(percent, 0) / 100), 1, maximum,
    );
    let direct = 0;
    if (halationActive) {
      direct = Math.max(direct, clamp(Math.floor(physicalOffset(Number(params[88]) || 0, 256) / 4), 1, 16));
    }
    const structureActive = params[97] > 0.5 && (Math.abs(params[98]) > 0 || Math.abs(params[99]) > 0);
    if (structureActive) {
      direct = Math.max(direct, clamp(Math.round(frameDiagonal * 0.06 / 100), 1, 24));
    }
    if (params[108] < 1) {
      direct = Math.max(direct, physicalOffset(0.04 + 0.08 * (1 - params[108]) * params[79], 32));
    }

    const total = Math.ceil(blurTexels) * 4 + Math.ceil(direct);
    return total > 0 ? Math.ceil(total / 4) * 4 : 0;
  }

  function detailBandIdentity(params, inputIdentity, scope = "global") {
    const values = Array.from(params || []);
    // Amounts and sharpen threshold consume packed bands but do not create
    // them. Excluding them is what makes live drags true cache hits.
    const ignored = scope === "global" ? [149, 150, 152, 154] : [14, 15, 17, 19];
    ignored.forEach((index) => { if (index < values.length) values[index] = 0; });
    return `${inputIdentity}|${JSON.stringify(values)}`;
  }

  /**
   * Model a Tiled execution of the same graph.
   *
   * Direct sizes every intermediate to the whole output, which is what puts a
   * 42 MP or 8K graph over the budget. Tiled keeps the source and the
   * presentation surface whole but sizes the working set to one tile plus its
   * halo, so peak residency stops following the image.
   */
  function buildTiledPlan(options = {}) {
    const width = Math.max(1, Math.floor(Number(options.width) || 1));
    const height = Math.max(1, Math.floor(Number(options.height) || 1));
    const tileSize = Math.max(64, Math.floor(Number(options.tileSize) || DEFAULT_TILE_SIZE));
    const halo = Math.max(0, Math.floor(Number(options.halo) || 0));
    const sourceBytesPerPixel = options.sourceBytesPerPixel === 16 ? 16 : 8;
    const detailActive = options.detailActive !== false;
    const spatialActive = options.spatialActive !== false;
    const denoiseLevels = Math.max(0, Math.min(4, Math.floor(Number(options.denoiseLevels ?? 0) || 0)));
    const retainedPresentation = options.retainedPresentation !== false;
    const contingencyFraction = Number.isFinite(Number(options.contingencyFraction))
      ? Math.max(0, Number(options.contingencyFraction))
      : GPU_PLAN_CONTINGENCY_FRACTION;

    const columns = Math.ceil(width / tileSize);
    const rows = Math.ceil(height / tileSize);
    const tileCount = columns * rows;
    // The working tile is one full tile plus its halo on every side, which is
    // the largest tile the graph ever has to hold.
    const workWidth = Math.min(width, tileSize + halo * 2);
    const workHeight = Math.min(height, tileSize + halo * 2);
    const workPixels = workWidth * workHeight;

    const entries = [];
    const add = (id, category, lifetime, bytes, detail = {}) => {
      if (bytes > 0) entries.push({ id, category, lifetime, bytes, ...detail });
    };

    // Whole-image resources that tiling does not shrink.
    add("source-proxy", "source", "cached", width * height * sourceBytesPerPixel, { bytesPerPixel: sourceBytesPerPixel });
    add("presentation-surface", "presentation", "resident", width * height * 8, { whole: true });

    // Per-tile working set, sized to one tile rather than to the image.
    add("tile-grading-core", "grading", "resident", workPixels * 8 * 4, { textures: 4, tile: true });
    if (detailActive) {
      add("tile-detail-packed-cache", "detail", "cached",
        Math.max(0, Math.floor(Number(options.detailCacheBytes) || width * height * 8)),
        { textures: "one packed RGBA16F band tile per resident output tile", tile: true });
      add("tile-detail-horizontal-scratch", "detail", "transient", workPixels * 8,
        { textures: 1, tile: true });
    }
    if (spatialActive) {
      add("tile-spatial-film", "spatial", "resident",
        Math.ceil(workWidth / 4) * Math.ceil(workHeight / 4) * 8 * 2, { textures: 2, tile: true });
    }
    if (denoiseLevels > 0) {
      const denoise = denoiseLogicalBytes(workWidth, workHeight, denoiseLevels);
      add("tile-denoise-evidence", "denoise", "cached", denoise.evidenceBytes, { levels: denoiseLevels, tile: true });
      add("tile-denoise-resolved", "denoise", "resident", denoise.resolvedBytes, { tile: true });
      add("tile-denoise-scratch", "denoise", "transient", denoise.reconstructionScratchBytes, { tile: true });
    }
    add("tile-result-cache", "tile-cache", "cached",
      Math.max(0, Math.floor(Number(options.tileCacheBytes) || 0)), { tile: true });
    add("upload-staging", "staging", "transient", Math.max(0, Math.floor(Number(options.stagingBytes) || 0)));
    add("parameter-buffers", "parameter", "resident", Math.max(0, Math.floor(Number(options.parameterBufferBytes) || 0)));

    const sumBy = (lifetime) => entries
      .filter((entry) => entry.lifetime === lifetime)
      .reduce((total, entry) => total + entry.bytes, 0);
    const residentBytes = sumBy("resident");
    const cachedBytes = sumBy("cached");
    const transientBytes = sumBy("transient");
    const retainedPresentationOverlapBytes = retainedPresentation ? width * height * 8 : 0;
    if (retainedPresentationOverlapBytes > 0) {
      entries.push({
        id: "retained-presentation-overlap",
        category: "presentation",
        lifetime: "overlap",
        bytes: retainedPresentationOverlapBytes,
      });
    }
    const beforeContingency = residentBytes + cachedBytes + transientBytes + retainedPresentationOverlapBytes;
    const contingencyBytes = Math.round(beforeContingency * contingencyFraction);
    if (contingencyBytes > 0) {
      entries.push({ id: "contingency-margin", category: "margin", lifetime: "margin", bytes: contingencyBytes });
    }

    return {
      mode: "tiled",
      width,
      height,
      tileSize,
      halo,
      columns,
      rows,
      tileCount,
      workWidth,
      workHeight,
      entries,
      totals: {
        residentBytes,
        cachedBytes,
        transientBytes,
        retainedPresentationOverlapBytes,
        contingencyBytes,
        peakLogicalBytes: beforeContingency + contingencyBytes,
      },
    };
  }

  function buildRenderPlan(options = {}) {
    const width = Math.max(1, Math.floor(Number(options.width) || 1));
    const height = Math.max(1, Math.floor(Number(options.height) || 1));
    const pixels = width * height;
    const spatialPixels = Math.ceil(width / 4) * Math.ceil(height / 4);
    const sourceBytesPerPixel = options.sourceBytesPerPixel === 16 ? 16 : 8;
    const detailActive = options.detailActive !== false;
    const spatialActive = options.spatialActive !== false;
    const denoiseLevels = Math.max(0, Math.min(4, Math.floor(Number(options.denoiseLevels ?? 0) || 0)));
    const cachedProxyLevels = Math.max(1, Math.floor(Number(options.cachedProxyLevels ?? 1) || 1));
    const maskCount = Math.max(0, Math.floor(Number(options.maskCount) || 0));
    const booleanMaskPasses = Math.max(0, Math.floor(Number(options.booleanMaskPasses) || 0));
    const sceneLuminanceEntries = Math.max(0, Math.floor(Number(options.sceneLuminanceEntries) || 0));
    const comparisonLanes = Math.max(0, Math.floor(Number(options.comparisonLanes) || 0));
    const scopeBytes = Math.max(0, Math.floor(Number(options.scopeBytes) || 0));
    const parameterBufferBytes = Math.max(0, Math.floor(Number(options.parameterBufferBytes) || 0));
    const stagingBytes = Math.max(0, Math.floor(Number(options.stagingBytes) || 0));
    const retainedPresentation = options.retainedPresentation !== false;
    const contingencyFraction = Number.isFinite(Number(options.contingencyFraction))
      ? Math.max(0, Number(options.contingencyFraction))
      : GPU_PLAN_CONTINGENCY_FRACTION;

    const entries = [];
    const add = (id, category, lifetime, bytes, detail = {}) => {
      if (bytes > 0) entries.push({ id, category, lifetime, bytes, ...detail });
    };

    add("source-proxy", "source", "cached", pixels * sourceBytesPerPixel * cachedProxyLevels,
      { levels: cachedProxyLevels, bytesPerPixel: sourceBytesPerPixel });
    add("grading-core", "grading", "resident", pixels * 8 * 4, { textures: 4 });
    if (detailActive) add("grading-detail", "detail", "resident", pixels * 8 * 2, { textures: 2 });
    if (spatialActive) add("spatial-film", "spatial", "resident", spatialPixels * 8 * 2, { textures: 2 });

    if (denoiseLevels > 0) {
      const denoise = denoiseLogicalBytes(width, height, denoiseLevels);
      add("denoise-evidence", "denoise", "cached", denoise.evidenceBytes, { levels: denoiseLevels });
      add("denoise-resolved", "denoise", "resident", denoise.resolvedBytes);
      add("denoise-reconstruction-scratch", "denoise", "transient", denoise.reconstructionScratchBytes);
    }

    add("cpu-mask-leaves", "mask", "cached", pixels * maskCount, { masks: maskCount });
    add("boolean-mask-nodes", "mask", "resident", pixels * 2 * booleanMaskPasses, { passes: booleanMaskPasses });
    add("scene-luminance", "mask", "cached", pixels * 2 * sceneLuminanceEntries, { entries: sceneLuminanceEntries });
    add("scope-pool", "scope", "resident", scopeBytes);
    add("parameter-buffers", "parameter", "resident", parameterBufferBytes);
    add("upload-staging", "staging", "transient", stagingBytes);
    // A comparison canvas owns a second graph of the same size.
    add("comparison-lanes", "comparison", "resident", comparisonLanes * pixels * 8 * 4, { lanes: comparisonLanes });

    const sumBy = (lifetime) => entries
      .filter((entry) => entry.lifetime === lifetime)
      .reduce((total, entry) => total + entry.bytes, 0);
    const residentBytes = sumBy("resident");
    const cachedBytes = sumBy("cached");
    const transientBytes = sumBy("transient");

    // PRD 2.2 keeps the previous accepted image alive while the replacement is
    // built, so its surface overlaps the new graph and must be admitted.
    const retainedPresentationOverlapBytes = retainedPresentation ? pixels * 8 : 0;
    if (retainedPresentationOverlapBytes > 0) {
      entries.push({
        id: "retained-presentation-overlap",
        category: "presentation",
        lifetime: "overlap",
        bytes: retainedPresentationOverlapBytes,
      });
    }

    const beforeContingency = residentBytes + cachedBytes + transientBytes + retainedPresentationOverlapBytes;
    const contingencyBytes = Math.round(beforeContingency * contingencyFraction);
    if (contingencyBytes > 0) {
      entries.push({
        id: "contingency-margin",
        category: "margin",
        lifetime: "margin",
        bytes: contingencyBytes,
        fraction: contingencyFraction,
      });
    }
    const peakLogicalBytes = beforeContingency + contingencyBytes;

    const budgetBytes = normalizeGpuBudgetBytes(options.budget);
    const limits = options.limits || null;
    const maxTextureDimension2D = Number(limits?.maxTextureDimension2D) || null;

    const violations = [];
    if (maxTextureDimension2D && (width > maxTextureDimension2D || height > maxTextureDimension2D)) {
      violations.push({
        rule: "maxTextureDimension2D",
        detail: `${width}x${height} exceeds the device limit of ${maxTextureDimension2D}`,
      });
    }
    if (peakLogicalBytes > budgetBytes) {
      violations.push({
        rule: "budget",
        detail: `predicted peak ${peakLogicalBytes} exceeds the configured budget ${budgetBytes}`,
      });
    }
    if (options.formatsSupported === false) {
      violations.push({ rule: "formats", detail: "a planned texture format or usage is unsupported" });
    }
    if (options.allocationBackoff) {
      violations.push({ rule: "allocation-backoff", detail: String(options.allocationBackoff) });
    }

    // The Tiled alternative is computed for every plan, so a Direct refusal
    // always arrives with the execution that replaces it rather than with a
    // question about the resolution.
    const tiled = buildTiledPlan({
      ...options,
      width,
      height,
      sourceBytesPerPixel,
      detailActive,
      spatialActive,
      denoiseLevels,
      contingencyFraction,
      retainedPresentation,
      stagingBytes,
      parameterBufferBytes,
    });

    return {
      width,
      height,
      pixelCount: pixels,
      entries,
      totals: {
        residentBytes,
        cachedBytes,
        transientBytes,
        retainedPresentationOverlapBytes,
        contingencyBytes,
        peakLogicalBytes,
      },
      tiled,
      budgetBytes,
      limits,
      decision: {
        // Admission chooses how to execute. It never changes the selected
        // resolution: PRD 4.3 requires allocation failure to retry through
        // Tiled execution instead of silently reducing the tier.
        //
        // `executionOverride` forces one route for testing. It can only make
        // admission *more* conservative or equal to it: forcing Tiled is always
        // safe, and forcing Direct is honoured only when admission would have
        // allowed it anyway. Otherwise the override could ask for a render the
        // budget cannot hold, and a diagnostic switch has no business
        // overriding the memory guard.
        mode: options.executionOverride === "tiled" ? "tiled"
          : options.executionOverride === "direct" && violations.length === 0 ? "direct"
            : violations.length ? "tiled" : "direct",
        overridden: options.executionOverride === "tiled"
          || (options.executionOverride === "direct" && violations.length === 0),
        overrideRefused: options.executionOverride === "direct" && violations.length > 0,
        admitted: violations.length === 0,
        violations,
        tier: options.tier ?? null,
      },
    };
  }

  class HDRWebGPUPreview {
    static directPreviewMemoryModel(width, height, options = {}) {
      return directPreviewMemoryModel(width, height, options);
    }

    static staticPreviewMemoryModels(options = {}) {
      return STATIC_PREVIEW_MEMORY_CASES.map((entry) => ({
        id: entry.id,
        ...directPreviewMemoryModel(entry.width, entry.height, options),
      }));
    }

    static buildRenderPlan(options = {}) {
      return buildRenderPlan(options);
    }

    static buildTiledPlan(options = {}) {
      return buildTiledPlan(options);
    }

    static detailTileHalo(width, height, params, localAdjustments = [], lane = "hdr") {
      return detailTileHalo(width, height, params, localAdjustments, lane);
    }

    static detailBandIdentity(params, inputIdentity, scope = "global") {
      return detailBandIdentity(params, inputIdentity, scope);
    }

    static normalizeGpuBudgetBytes(value) {
      return normalizeGpuBudgetBytes(value);
    }

    constructor(canvas) {
      this.canvas = canvas;
      this.context = null;
      this.adapter = null;
      this.device = null;
      this.module = null;
      this.maskModule = null;
      this.pipelines = new Map();
      this.proxies = new Map();
      this.proxyInflight = new Map();
      this.sceneLuminance = new Map();
      this.sceneLuminanceInflight = new Map();
      this.sessionId = null;
      this.available = false;
      this.detail = "WebGPU has not been initialized";
      this.renderSerials = new WeakMap();
      this.paramBuffer = null;
      this.curveBuffer = null;
      this.curveSampleCache = new Map();
      this.lastCurveSamples = null;
      this.surfaceKeys = new WeakMap();
      this.intermediates = new Map();
      this.localMasks = new Map();
      this.localParamBuffers = new Map();
      this.localParamValues = new Map();
      this.scopeSources = new WeakMap();
      this.scopeResources = new Map();
      this.peakReductionPipeline = null;
      this.peakReductionCache = new Map();
      this.bindGroupLayout = null;
      this.pipelineLayout = null;
      this.maskBindGroupLayout = null;
      this.maskPipelineLayout = null;
      this.maskPipelines = null;
      this.instrumentationEnabled = false;
      this.performanceMetrics = { renders: [], scopes: [], maskEvents: [], stages: [], allocations: [], presentations: [] };
      // Phase 0 denoise seam. This remains null until the explicit selector
      // benchmark asks for it, so the established never-used path owns no
      // denoise resources and performs no denoise dispatches.
      this.denoiseSourceSelector = null;
      this.denoiseSelectorGeneration = 0;
      this.denoiseCounters = this.emptyDenoiseCounters();
      this.denoiseTileSize = DENOISE_TILE_SIZE;
      this.denoisePipelines = null;
      this.adapterInfo = null;
      this.resourceGeneration = 0;
      this.activeRenderCount = 0;
      this.activeScopeCount = 0;
      this.deferredDestroy = [];
      // Phase 2 planner state. The budget is an application allocation budget
      // chosen by the user, never a physical VRAM measurement.
      this.memoryBudget = "auto";
      this.lastRenderPlan = null;
      // Set when a real allocation fails. It forces subsequent admission to
      // Tiled and is cleared only by an explicit reset, so a transient OOM can
      // never be mistaken for continuing headroom. It never changes the tier.
      this.allocationBackoff = null;
      // Largest source response the browser is ever asked to buffer. Direct
      // execution still allocates one full texture, but fills it from chunks
      // no larger than this.
      this.maxSourceChunkBytes = 16 * 1024 * 1024;
      this.sourceTransportMetrics = null;
      // Phase 4 tiled execution. The admission planner uses it when Direct
      // does not fit; the diagnostic hook can still invoke it explicitly.
      this.tileGraph = null;
      this.tileScheduler = null;
      this.tileCompositeParamBuffer = null;
      this.tiledExecutionMetrics = null;
      this.pendingCacheTrim = null;
      this.detailBandTiles = new Map();
      this.maskTiles = new Map();
      this.detailCacheCounters = {
        hits: 0, misses: 0, analysisPasses: 0, evictions: 0,
        globalHits: 0, globalMisses: 0, localHits: 0, localMisses: 0,
      };
    }

    setMemoryBudget(value) {
      this.memoryBudget = value === "auto" ? "auto" : value;
      return this.memoryBudgetBytes();
    }

    memoryBudgetBytes() {
      return normalizeGpuBudgetBytes(this.memoryBudget);
    }

    clearAllocationBackoff() {
      this.allocationBackoff = null;
    }

    recordAllocationFailure(kind, error, detail = {}) {
      const reason = `${kind}: ${error?.message || String(error || "allocation failed")}`;
      this.allocationBackoff = { kind, reason, at: performance.now(), ...detail };
      this.recordStage("allocation-failure", { kind, reason, ...detail });
      return this.allocationBackoff;
    }

    /**
     * Merge live renderer state into a render plan for the given output size.
     * Cache multiplicities, mask residency, scope pools, and parameter buffers
     * come from what the renderer is actually holding, so the plan describes
     * this session rather than a generic graph.
     */
    planRender(width, height, options = {}) {
      const denoiseLevels = this.denoiseSourceSelector?.cache?.levels?.length || 0;
      const scopeBytes = [...this.scopeResources.values()].reduce(
        (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
        0,
      );
      const parameterBufferBytes = (this.paramBuffer?.size || 0) + (this.curveBuffer?.size || 0)
        + [...this.localParamBuffers.values()].reduce((sum, buffer) => sum + (buffer.size || 0), 0);
      const plan = buildRenderPlan({
        width,
        height,
        denoiseLevels,
        cachedProxyLevels: Math.max(1, this.proxies.size),
        maskCount: [...this.localMasks.values()].filter((mask) => mask.kind !== "gpu-mask-graph").length,
        booleanMaskPasses: [...this.localMasks.values()].filter((mask) => mask.kind === "gpu-mask-graph").length,
        sceneLuminanceEntries: this.sceneLuminance.size,
        scopeBytes,
        parameterBufferBytes,
        budget: this.memoryBudget,
        // Bounded transport means staging is one chunk, not one image.
        stagingBytes: this.maxSourceChunkBytes,
        limits: this.adapterInfo?.limits || snapshotDeviceLimits(this.device?.limits),
        allocationBackoff: this.allocationBackoff?.reason || null,
        ...options,
      });
      this.lastRenderPlan = plan;
      return plan;
    }

    admitDirect(width, height, options = {}) {
      return this.planRender(width, height, options).decision;
    }

    async initialize() {
      if (!navigator.gpu) {
        this.detail = "WebGPU is unavailable in this browser";
        return false;
      }
      try {
        this.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!this.adapter) throw new Error("No WebGPU adapter was returned");
        const timestampQueries = this.adapter.features.has("timestamp-query");
        // The default WebGPU maxBufferSize is 256 MiB even when the adapter can
        // support more. An 8192² RGBA16F Full surface is 512 MiB, and Chromium's
        // compositor/readback path may require one buffer of that size. Request
        // only the bounded surface maximum, capped to the adapter's capability;
        // this raises a limit but does not allocate the buffer.
        const fullSurfaceBufferLimit = Math.min(
          Number(this.adapter.limits.maxBufferSize) || (256 * 1024 * 1024),
          512 * 1024 * 1024,
        );
        this.device = await this.adapter.requestDevice({
          requiredFeatures: timestampQueries ? ["timestamp-query"] : [],
          requiredLimits: { maxBufferSize: fullSurfaceBufferLimit },
        });
        const info = this.adapter.info || {};
        const adapterDescription = [info.vendor, info.architecture, info.device, info.description]
          .filter(Boolean)
          .join(" ");
        this.adapterInfo = {
          vendor: info.vendor || "unknown",
          architecture: info.architecture || "unknown",
          device: info.device || "unknown",
          description: info.description || "unknown",
          fallback: Boolean(this.adapter.isFallbackAdapter)
            || /swiftshader|llvmpipe|lavapipe|software rasterizer/i.test(adapterDescription),
          timestampQueries,
          limits: snapshotDeviceLimits(this.device.limits),
        };
        this.context = this.canvas.getContext("webgpu");
        if (!this.context) throw new Error("The WebGPU canvas context is unavailable");
        this.module = this.device.createShaderModule({ code: SHADER_SOURCE });
        this.maskModule = this.device.createShaderModule({ code: LUMA_MASK_SHADER_SOURCE });
        const [compilation, maskCompilation] = await Promise.all([
          this.module.getCompilationInfo(),
          this.maskModule.getCompilationInfo(),
        ]);
        const errors = [...compilation.messages, ...maskCompilation.messages].filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors.map((message) => (
          `${message.lineNum || "?"}:${message.linePos || "?"} ${message.message}`
        )).join("; "));
        this.bindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
            { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          ],
        });
        this.spatialSampler = this.device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        });
        this.pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
        this.scopePipeline = this.device.createRenderPipeline({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "scopeFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        this.settledScopePipeline = this.device.createRenderPipeline({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "settledScopeFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        this.maskBindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
          ],
        });
        this.maskPipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.maskBindGroupLayout] });
        this.maskPipelines = {
          sceneLuminance: this.createMaskPipeline("sceneLuminanceFragmentMain"),
          qualify: this.createMaskPipeline("lumaQualificationFragmentMain"),
          refine: this.createMaskPipeline("maskRefinementFragmentMain"),
          combine: this.createMaskPipeline("maskCombineFragmentMain"),
        };
        this.device.lost.then((info) => {
          this.available = false;
          this.detail = `WebGPU device lost: ${info.message || info.reason}`;
          window.dispatchEvent(new CustomEvent("hdrfinisher:webgpulost", { detail: { message: this.detail } }));
        });
        this.available = true;
        this.detail = this.adapterInfo.fallback
          ? "WebGPU software adapter active; HDR presentation is not authoritative"
          : `WebGPU settled authoring renderer ready (${this.adapterInfo.description})`;
        return true;
      } catch (error) {
        this.available = false;
        this.detail = error?.message || "WebGPU initialization failed";
        return false;
      }
    }

    resetSession(sessionId = null) {
      this.resourceGeneration += 1;
      this.disposeDenoiseSelectorSeam();
      this.destroyTileGraph();
      for (const entry of this.detailBandTiles.values()) entry.texture?.destroy();
      this.detailBandTiles.clear();
      for (const entry of this.maskTiles.values()) entry.texture?.destroy();
      this.maskTiles.clear();
      this.detailCacheCounters = {
        hits: 0, misses: 0, analysisPasses: 0, evictions: 0,
        globalHits: 0, globalMisses: 0, localHits: 0, localMisses: 0,
      };
      this.tileScheduler = null;
      this.tiledExecutionMetrics = null;
      this.pendingCacheTrim = null;
      this.sessionId = sessionId;
      this.renderSerials = new WeakMap();
      for (const proxy of this.proxies.values()) this.destroyAfterActiveRenders(() => proxy.texture?.destroy());
      this.proxies.clear();
      this.proxyInflight.clear();
      for (const scene of this.sceneLuminance.values()) this.destroyAfterActiveRenders(() => scene.texture?.destroy());
      this.sceneLuminance.clear();
      this.sceneLuminanceInflight.clear();
      for (const intermediate of this.intermediates.values()) {
        this.destroyAfterActiveRenders(() => {
          intermediate.baseTexture?.destroy();
          intermediate.filmTexture?.destroy();
          intermediate.spatialATexture?.destroy();
          intermediate.spatialBTexture?.destroy();
          intermediate.localTexture?.destroy();
          intermediate.detailATexture?.destroy();
          intermediate.detailBTexture?.destroy();
        });
      }
      this.intermediates.clear();
      for (const mask of this.localMasks.values()) this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(mask));
      this.localMasks.clear();
      for (const buffer of this.localParamBuffers.values()) buffer.destroy();
      this.localParamBuffers.clear();
      this.localParamValues.clear();
      this.curveSampleCache.clear();
      this.lastCurveSamples = null;
      this.scopeSources = new WeakMap();
      for (const pool of this.scopeResources.values()) {
        for (const resource of pool) {
          this.destroyAfterActiveRenders(() => {
            resource.texture.destroy();
            resource.readBuffer.destroy();
            resource.paramBuffer.destroy();
          });
        }
      }
      this.scopeResources.clear();
      this.peakReductionCache.clear();
    }

    invalidateSurfaces() {
      this.surfaceKeys = new WeakMap();
    }

    destroyAfterActiveRenders(callback) {
      if (this.activeRenderCount > 0 || this.activeScopeCount > 0) this.deferredDestroy.push(callback);
      else callback();
    }

    flushDeferredDestroy() {
      if (this.activeRenderCount > 0 || this.activeScopeCount > 0 || !this.deferredDestroy.length) return;
      const callbacks = this.deferredDestroy.splice(0);
      callbacks.forEach((callback) => callback());
    }

    finishActiveRender() {
      this.activeRenderCount = Math.max(0, this.activeRenderCount - 1);
      this.flushDeferredDestroy();
    }

    async render(sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203, sourceSize = null, sourceOptions = null) {
      return this.renderTo(this.canvas, sessionId, lane, adjustments, curveSampler, longEdge, localAdjustments, editRevision, maskOverlay, referenceWhiteNits, sourceSize, sourceOptions);
    }

    supportsLocalAdjustments(lane, localAdjustments = []) {
      return activeGpuLocals(lane, localAdjustments).every((local) =>
        gpuLocalSupported(local[`${lane}_grade`]));
    }

    setInstrumentationEnabled(enabled = true) {
      this.instrumentationEnabled = Boolean(enabled);
      if (enabled) {
        this.performanceMetrics = {
          renders: [], scopes: [], maskEvents: [], stages: [], allocations: [], presentations: [],
        };
      }
    }

    async waitForSubmittedWork() {
      if (!this.available || !this.device) return false;
      try {
        await this.device.queue.onSubmittedWorkDone();
        return this.available;
      } catch {
        // Device-loss handling owns fallback and resource reset. Backpressure
        // must not turn that asynchronous transition into an unhandled error.
        return false;
      }
    }

    emptyDenoiseCounters() {
      return {
        analysisCalls: 0,
        resolveCalls: 0,
        allocations: 0,
        allocatedBytes: 0,
        atomicSwaps: 0,
        toggles: 0,
        // `analysisDispatches` is the number that makes the live-control
        // contract checkable: a drag of Amount, Luminance, Color Noise or
        // Detail Recovery must leave it untouched.
        analysisDispatches: 0,
        resolveDispatches: 0,
        analysisTiles: 0,
        resolveTiles: 0,
        evidenceBytes: 0,
        analysisScratchBytes: 0,
        resolveScratchBytes: 0,
      };
    }

    /**
     * Cover a denoise source with tiles the Haar grid agrees with.
     *
     * Mirrors `backend/hdr_finisher/denoise_tiles.py` exactly, including the
     * absorbed short trailing span, because the CPU reference and this renderer
     * must agree on what a tile is before they can agree on what is cached.
     */
    static alignedDenoiseTiles(width, height, tileSize, levels) {
      return alignedDenoiseTiles(width, height, tileSize, levels);
    }

    static denoiseCacheIdentity(sourceIdentity, settings, tile = null) {
      return denoiseCacheIdentity(sourceIdentity, settings, tile);
    }

    recordStage(stage, detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.stages;
      entries.push({ stage, at: performance.now(), ...detail });
      if (entries.length > 720) entries.shift();
    }

    recordAllocation(kind, bytes, detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.allocations;
      entries.push({ kind, bytes, at: performance.now(), ...detail });
      if (entries.length > 480) entries.shift();
    }

    recordPresentation(detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.presentations;
      entries.push({ at: performance.now(), ...detail });
      if (entries.length > 240) entries.shift();
      this.recordStage("presentation", detail);
    }

    resourceMemorySnapshot() {
      const proxyBytes = [...this.proxies.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const sceneLuminanceBytes = [...this.sceneLuminance.values()]
        .reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const localMaskBytes = [...this.localMasks.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      // Phase 5's two LRU caches and the tiled working graph. These are real
      // device textures with the same lifetime as any other cache here, so
      // leaving them out made a tiled render's reported peak smaller than a
      // Direct one's while it actually held more.
      const detailBandCacheBytes = [...this.detailBandTiles.values()]
        .reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const maskTileBytes = [...this.maskTiles.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const tileGraphBytes = this.tileGraph?.byteSize || 0;
      const scopeBytes = [...this.scopeResources.values()].reduce(
        (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
        0,
      );
      const intermediateEntries = [...this.intermediates.values()];
      const gradingCoreBytes = intermediateEntries.reduce(
        (sum, entry) => sum + entry.width * entry.height * 8 * 4,
        0,
      );
      const gradingSpatialBytes = intermediateEntries.reduce((sum, entry) => {
        if (!entry.spatialATexture || !entry.spatialBTexture) return sum;
        return sum + Math.ceil(entry.width / 4) * Math.ceil(entry.height / 4) * 8 * 2;
      }, 0);
      const gradingDetailBytes = intermediateEntries.reduce((sum, entry) => (
        sum + (entry.detailATexture && entry.detailBTexture ? entry.width * entry.height * 8 * 2 : 0)
      ), 0);
      const gradingIntermediateBytes = gradingCoreBytes + gradingSpatialBytes + gradingDetailBytes;
      const denoiseCache = this.denoiseSourceSelector?.cache;
      const hasMeasuredDenoiseEvidence = denoiseCache?.levels?.some((level) => Array.isArray(level.evidence));
      const measuredDenoiseEvidenceBytes = hasMeasuredDenoiseEvidence
        ? denoiseCache.levels.reduce((sum, level) => (
          sum + (level.evidence || []).reduce((levelSum, entry) => levelSum + (entry.byteSize || 0), 0)
        ), 0)
        : undefined;
      const denoiseReconstructionScratchBytes = (denoiseCache?.resolveScratch || [])
        .reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const denoiseParameterBufferBytes = (denoiseCache?.resolveParamBuffers || [])
        .reduce((sum, buffer) => sum + (buffer.size || 0), 0);
      const denoiseEvidenceBytes = measuredDenoiseEvidenceBytes === undefined
        ? (denoiseCache?.byteSize || 0)
        : measuredDenoiseEvidenceBytes;
      const denoiseResolvedBytes = this.denoiseSourceSelector?.resolved?.byteSize || 0;
      const parameterBufferBytes = (this.paramBuffer?.size || 0) + (this.curveBuffer?.size || 0)
        + [...this.localParamBuffers.values()].reduce((sum, buffer) => sum + (buffer.size || 0), 0)
        + intermediateEntries.reduce((sum, entry) => sum + (entry.compositeParamBuffer?.size || 0), 0)
        + denoiseParameterBufferBytes;
      const residentCategories = {
        sourceProxyBytes: proxyBytes,
        gradingCoreBytes,
        gradingSpatialBytes,
        gradingDetailBytes,
        sceneLuminanceBytes,
        localMaskBytes,
        detailBandCacheBytes,
        maskTileBytes,
        tileGraphBytes,
        scopeBytes,
        denoiseEvidenceBytes,
        denoiseReconstructionScratchBytes,
        denoiseResolvedBytes,
        parameterBufferBytes,
      };
      const residentBytes = Object.values(residentCategories).reduce((sum, value) => sum + value, 0);
      const cachedCategories = {
        sourceProxyBytes: proxyBytes,
        sceneLuminanceBytes,
        localMaskBytes,
        detailBandCacheBytes,
        maskTileBytes,
        denoiseEvidenceBytes,
        denoiseReconstructionScratchBytes,
      };
      const cachedBytes = Object.values(cachedCategories).reduce((sum, value) => sum + value, 0);
      // Submitted GPU work may still reference resources queued for destruction.
      // These bytes are not part of the current cache, but remain logically live
      // until queue completion. Destruction callbacks do not expose resource size,
      // so this starts at zero and is explicitly marked as untracked below.
      const transientBytes = 0;
      const largestPresentationBytes = intermediateEntries.reduce(
        (largest, entry) => Math.max(largest, entry.width * entry.height * 8),
        0,
      );
      const retainedPresentationOverlapBytes = this.performanceMetrics.presentations?.length
        ? largestPresentationBytes
        : 0;
      const planningEntry = intermediateEntries.reduce((largest, entry) => (
        !largest || entry.width * entry.height > largest.width * largest.height ? entry : largest
      ), null);
      const planned = planningEntry
        ? directPreviewMemoryModel(planningEntry.width, planningEntry.height, {
          detailActive: Boolean(planningEntry.detailATexture && planningEntry.detailBTexture),
          spatialActive: Boolean(planningEntry.spatialATexture && planningEntry.spatialBTexture),
          denoiseLevels: this.denoiseSourceSelector?.cache?.levels?.length || 0,
          retainedPresentationOverlapBytes,
        })
        : null;
      return {
        planned,
        resident: { totalBytes: residentBytes, categories: residentCategories },
        transient: {
          totalBytes: transientBytes,
          categories: { submittedWorkPendingDestructionBytes: 0 },
          complete: this.deferredDestroy.length === 0,
        },
        cached: { totalBytes: cachedBytes, categories: cachedCategories },
        retainedPresentationOverlapBytes,
        peakLogicalBytes: residentBytes + transientBytes + retainedPresentationOverlapBytes,
        totals: {
          plannedBytes: planned?.plannedBytes || 0,
          residentBytes,
          transientBytes,
          cachedBytes,
          retainedPresentationOverlapBytes,
          peakLogicalBytes: residentBytes + transientBytes + retainedPresentationOverlapBytes,
        },
        staticModels: HDRWebGPUPreview.staticPreviewMemoryModels(),
      };
    }

    diagnosticsSnapshot() {
      const memory = this.resourceMemorySnapshot();
      return {
        adapter: this.adapterInfo,
        available: this.available,
        detail: this.detail,
        renders: this.performanceMetrics.renders.map((entry) => ({ ...entry })),
        scopes: (this.performanceMetrics.scopes || []).map((entry) => ({ ...entry })),
        maskEvents: (this.performanceMetrics.maskEvents || []).map((entry) => ({ ...entry })),
        stages: (this.performanceMetrics.stages || []).map((entry) => ({ ...entry })),
        allocations: (this.performanceMetrics.allocations || []).map((entry) => ({ ...entry })),
        presentations: (this.performanceMetrics.presentations || []).map((entry) => ({ ...entry })),
        denoise: {
          ...this.denoiseCounters,
          selectorCreated: Boolean(this.denoiseSourceSelector),
          selectedSource: this.denoiseSourceSelector?.selected || "original",
          identity: this.denoiseSourceSelector?.identity || null,
          resolvedResident: Boolean(this.denoiseSourceSelector?.resolved),
          cacheReady: Boolean(this.denoiseSourceSelector?.cache),
          algorithmVersion: this.denoiseSourceSelector?.cache?.algorithmVersion || null,
          controls: this.denoiseSourceSelector?.controls
            ? { ...this.denoiseSourceSelector.controls }
            : null,
        },
        resources: {
          proxies: this.proxies.size,
          proxyBytes: [...this.proxies.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0),
          sceneLuminanceTextures: this.sceneLuminance.size,
          localMasks: this.localMasks.size,
          localMaskBytes: [...this.localMasks.values()].reduce((sum, entry) => sum + entry.byteSize, 0),
          maskGraphs: [...this.localMasks.values()].filter((entry) => entry.kind === "gpu-mask-graph").length,
          scopePools: this.scopeResources.size,
          scopeBuffers: [...this.scopeResources.values()].reduce((sum, pool) => sum + pool.length, 0),
          scopeBytes: [...this.scopeResources.values()].reduce(
            (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
            0,
          ),
          gradingIntermediateBytes: [...this.intermediates.values()].reduce((sum, entry) => {
            const spatialWidth = Math.max(1, Math.ceil(entry.width / 4));
            const spatialHeight = Math.max(1, Math.ceil(entry.height / 4));
            const spatialBytes = entry.spatialATexture && entry.spatialBTexture
              ? spatialWidth * spatialHeight * 8 * 2
              : 0;
            const detailBytes = entry.detailATexture && entry.detailBTexture
              ? entry.width * entry.height * 8 * 2
              : 0;
            return sum + entry.width * entry.height * 8 * 4 + spatialBytes + detailBytes;
          }, 0),
          denoiseTextures: (this.denoiseSourceSelector?.resolved ? 1 : 0)
            + (this.denoiseSourceSelector?.cache?.textureCount || 0),
          denoiseBytes: (this.denoiseSourceSelector?.resolved?.byteSize || 0)
            + (this.denoiseSourceSelector?.cache?.byteSize || 0),
          memory,
          // Phase 2 planner surface: the budget in force, the last plan and its
          // admission decision, and any recorded allocation backoff.
          budget: {
            setting: this.memoryBudget,
            bytes: this.memoryBudgetBytes(),
          },
          plan: this.lastRenderPlan,
          allocationBackoff: this.allocationBackoff,
          sourceTransport: this.sourceTransportMetrics,
          maxSourceChunkBytes: this.maxSourceChunkBytes,
          tiledExecution: this.tiledExecutionMetrics,
          tileScheduler: this.tileScheduler?.snapshot?.() || null,
        },
      };
    }

    /**
     * Why a node keeps a graph off the tiled path.
     *
     * Phase 5 adds haloed Detail, mask tiles, overlays and the sequential local
     * stack. Remaining refusals are modules whose absolute-coordinate or
     * multiscale contracts are owned by later phases.
     */
    tiledExecutionRefusals({ activeLocals = [], detailActive, spatialActive, overlayMask, params, surface }) {
      const reasons = [];
      return reasons;
    }

    /**
     * How far past its rectangle a tile has to be correct, for this whole graph.
     *
     * Detail runs before the film stage and the film stage reads a
     * neighbourhood of Detail's output, so the two reaches compose rather than
     * compete. The sum is rounded up to a multiple of four whenever the film
     * stage is involved, because that is what keeps a tile's halo rectangle on
     * a frame quarter-texel boundary and its spatial grid aligned with the
     * frame's.
     *
     * The planner and the encoder both call this. If they disagreed, the
     * planner would admit a tiled execution against a working set the encoder
     * does not build -- which is the same class of defect as a memory ledger
     * that does not count a cache.
     */
    composedTileHalo(width, height, params, activeLocals = [], lane = "hdr") {
      const { detailActive, filmNeighbourhoodActive } = this.graphActivity(params);
      const localDetailActive = activeLocals.some((local) => gpuLocalDetailActive(local[`${lane}_grade`]));
      const detailHalo = (detailActive || localDetailActive)
        ? detailTileHalo(width, height, params, activeLocals, lane)
        : 0;
      const spatialHalo = filmNeighbourhoodActive ? spatialTileHalo(width, height, params) : 0;
      const halo = spatialHalo > 0
        ? Math.ceil((detailHalo + spatialHalo) / 4) * 4
        : detailHalo;
      return { halo, detailHalo, spatialHalo };
    }

    /**
     * The proxy-to-source scale every parameter build needs.
     *
     * Direct and Tiled must derive this identically or the same grade would
     * read as two different pictures depending on which route ran.
     */
    sourcePixelScaleFor(proxy, sourceSize) {
      const sourceLongEdge = Math.max(
        Number(sourceSize?.width) || proxy.width,
        Number(sourceSize?.height) || proxy.height,
      );
      return Math.min(1, Math.max(proxy.width, proxy.height) / Math.max(1, sourceLongEdge));
    }

    /** Which optional stages this parameter set actually switches on. */
    graphActivity(params) {
      const filmActive = params[78] > 0.5 && params[79] > 0;
      // Halation and bloom are the two stages that need the quarter-resolution
      // pair, because they are the two that blur on it.
      const spatialActive = filmActive
        && (params[85] > 0.5 || (params[92] > 0.5 && params[93] > 0));
      // Image structure and film resolution blur the film texture directly, at
      // full resolution. They allocate nothing, but they read past the pixel
      // they are writing just as surely, so they need a halo. The CPU strip
      // path has always counted them; this side had not.
      const filmBlurActive = filmActive && (
        (params[97] > 0.5 && (Math.abs(params[98]) > 0.000001 || Math.abs(params[99]) > 0.000001))
        || params[108] < 1
      );
      return {
        spatialActive,
        filmNeighbourhoodActive: spatialActive || filmBlurActive,
        detailActive: params[148] > 0.5
          && (Math.abs(params[149]) > 0.000001 || Math.abs(params[150]) > 0.000001 || params[152] > 0.000001),
      };
    }

    /**
     * Describe the highlight-peak anchor this render needs, without taking it.
     *
     * The anchor is a whole-image measurement, and its cache key is a long
     * list of parameter indices that has to mean the same thing on both
     * routes -- a Direct render and a Tiled one of the same grade must hit the
     * same cache entry, or the shoulder moves when execution changes. Returns
     * `null` when this graph does not measure, and otherwise the key and any
     * cached value; *taking* the measurement is left to the caller, because
     * Direct and Tiled differ on when they are willing to await one.
     */
    highlightAnchorRequest(lane, adjustments, proxy, params) {
      const measurement = adjustments[lane]?.highlight_compression_peak_measurement || "maximum";
      const measures = (lane === "hdr" || params[159] > 0.5) && params[74] === 1 && measurement !== "manual";
      if (!measures) return null;
      const key = JSON.stringify([
        proxy.identity, lane, params[1], params[159], measurement,
        params[2], params[4], params[8], params[9], params[110],
        ...params.slice(10, 12), ...params.slice(61, 73),
      ]);
      return { measurement, key, cached: this.peakReductionCache.get(key) };
    }

    /** Upload the parameter and curve storage both routes read from. */
    uploadParamsAndCurves(lane, adjustments, curveSampler, params) {
      const curves = buildCurves(lane, adjustments, curveSampler, this.curveSampleCache);
      this.ensureStorageBuffers(params.byteLength, curves.byteLength);
      this.device.queue.writeBuffer(this.paramBuffer, 0, params);
      if (curves !== this.lastCurveSamples) {
        this.device.queue.writeBuffer(this.curveBuffer, 0, curves);
        this.lastCurveSamples = curves;
      }
      return curves;
    }

    /** The one bind-group shape every pass on either route uses. */
    bindGraphResources(sourceView, spatialView, parameterBinding = { buffer: this.paramBuffer }, overlayView = spatialView) {
      return this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: parameterBinding },
          { binding: 2, resource: { buffer: this.curveBuffer } },
          { binding: 3, resource: spatialView },
          { binding: 4, resource: this.spatialSampler },
          { binding: 5, resource: overlayView },
        ],
      });
    }

    /**
     * The grid every tile max-blends its peak into, and the buffer it reads
     * back through. One per renderer, reused for every generation: it is 64x64
     * whatever the image is, so it never follows the picture.
     */
    ensureScopePeakTarget() {
      if (this.scopePeakTarget) return this.scopePeakTarget;
      const size = SCOPE_PEAK_GRID;
      // rgba16float is 8 bytes a texel, and copyTextureToBuffer wants rows
      // aligned to 256 bytes. 64 texels is 512 bytes, so the pitch is already
      // aligned and the readback needs no row padding arithmetic.
      const bytesPerRow = size * 8;
      try {
        this.scopePeakTarget = {
          size,
          bytesPerRow,
          texture: this.device.createTexture({
            size: { width: size, height: size },
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
              | GPUTextureUsage.COPY_SRC,
          }),
          readBuffer: this.device.createBuffer({
            size: bytesPerRow * size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
        };
      } catch (error) {
        this.recordAllocationFailure("scope-peak", error, { width: size, height: size });
        return null;
      }
      this.recordAllocation("scope-peak", bytesPerRow * size * 2, { width: size, height: size });
      return this.scopePeakTarget;
    }

    /**
     * The exact maximum of a finished generation, from the accumulated grid.
     *
     * Returns null rather than a guess when the readback cannot be taken, so a
     * caller can say the peak is unmeasured instead of reporting a wrong one.
     */
    async readScopePeak(target) {
      if (!target) return null;
      try {
        await target.readBuffer.mapAsync(GPUMapMode.READ);
        const values = new Uint16Array(target.readBuffer.getMappedRange());
        let peak = 0;
        for (let index = 0; index < values.length; index += 4) {
          const value = halfToFloat(values[index]);
          if (value > peak) peak = value;
        }
        return peak;
      } catch (error) {
        return null;
      } finally {
        if (target.readBuffer.mapState === "mapped") target.readBuffer.unmap();
      }
    }

    /**
     * One reusable tile-sized working set.
     *
     * This is the whole point of tiled execution: the graph's intermediates
     * stop following the image and follow the tile instead, so peak residency
     * stays flat as the selected tier grows.
     */
    ensureTileGraph(width, height, outputFormat, sourceFormat, spatialActive = false, denoiseActive = false) {
      const current = this.tileGraph;
      if (current && current.width === width && current.height === height
        && current.outputFormat === outputFormat && current.sourceFormat === sourceFormat
        && current.spatialActive === spatialActive && current.denoiseActive === denoiseActive) {
        return current;
      }
      this.destroyTileGraph();
      const make = (format, usage) => this.device.createTexture({
        size: { width, height }, format, usage,
      });
      const attachment = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      // The spatial pair is a quarter of the work tile in each axis, the same
      // ratio the Direct graph uses, so it costs an eighth of one intermediate.
      const spatialWidth = Math.max(1, Math.ceil(width / 4));
      const spatialHeight = Math.max(1, Math.ceil(height / 4));
      const makeSpatial = () => this.device.createTexture({
        size: { width: spatialWidth, height: spatialHeight }, format: "rgba16float", usage: attachment,
      });
      try {
        this.tileGraph = {
          width,
          height,
          outputFormat,
          sourceFormat,
          spatialActive,
          sourceTexture: make(sourceFormat, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST),
          baseTexture: make("rgba16float", attachment),
          localTexture: make("rgba16float", attachment),
          detailScratchTexture: make("rgba16float", attachment),
          detailResultTexture: make("rgba16float", attachment | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST),
          filmTexture: make("rgba16float", attachment),
          finishTexture: make("rgba16float", attachment),
          spatialATexture: spatialActive ? makeSpatial() : null,
          spatialBTexture: spatialActive ? makeSpatial() : null,
          spatialWidth,
          spatialHeight,
          denoiseActive,
          // One tile's worth of denoised picture, rebuilt per tile from cached
          // evidence. The whole-frame resolved texture this replaces is 340 MB
          // on a 42 MP frame, and allocating it is what used to put a denoised
          // Full over any budget.
          denoiseResolvedTexture: denoiseActive
            ? this.device.createTexture({
              label: "tile-denoise-resolved",
              size: { width, height },
              format: "rgba16float",
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
                | GPUTextureUsage.COPY_SRC,
            })
            : null,
          byteSize: width * height * (8 * 6 + (sourceFormat === "rgba16float" ? 8 : 16))
            + (spatialActive ? spatialWidth * spatialHeight * 8 * 2 : 0)
            + (denoiseActive ? width * height * 8 : 0),
        };
      } catch (error) {
        this.recordAllocationFailure("tile-graph", error, { width, height });
        this.tileGraph = null;
        return null;
      }
      this.recordAllocation("tile-graph", this.tileGraph.byteSize, { width, height });
      return this.tileGraph;
    }

    destroyTileGraph() {
      const graph = this.tileGraph;
      if (!graph) return;
      this.tileGraph = null;
      this.destroyAfterActiveRenders(() => {
        graph.sourceTexture?.destroy();
        graph.baseTexture?.destroy();
        graph.localTexture?.destroy();
        graph.detailScratchTexture?.destroy();
        graph.detailResultTexture?.destroy();
        graph.filmTexture?.destroy();
        graph.finishTexture?.destroy();
        graph.spatialATexture?.destroy();
        graph.spatialBTexture?.destroy();
        graph.denoiseResolvedTexture?.destroy();
      });
    }

    /**
     * Render the selected tier tile by tile.
     *
     * Every tile is copied out of the resident proxy into a tile-sized source,
     * run through the same pipelines the Direct path uses, and copied back into
     * the canvas at its global origin. Because each pass reads its input at the
     * fragment position and its input is the same tile, the shaders need no
     * knowledge that they are running on a tile at all.
     *
     * The whole generation is encoded into one command buffer and submitted
     * once, so the canvas presents the complete assembly or nothing. That is
     * what makes replacement atomic and a mixed-generation frame impossible.
     */
    async renderTiledTo(canvas, sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203, sourceSize = null, sourceOptions = null) {
      if (!this.available || !this.device) return false;
      const Scheduler = typeof window !== "undefined" ? window.HDRTileScheduler : null;
      if (!Scheduler) return { rendered: false, refusals: ["tile scheduler is unavailable"] };

      const tileSize = Math.max(64, Math.floor(Number(sourceOptions?.tileSize) || Scheduler.DEFAULT_TILE_SIZE));
      // The signature is derived from the adjustments this render was handed,
      // exactly as the Direct path derives it, so both request the same proxy.
      const geometrySignature = JSON.stringify(adjustments.shared?.geometry || {});
      const sourceIdentity = sourceOptions?.identity || "source";
      const activeLocals = activeGpuLocals(lane, localAdjustments);

      const proxy = await this.loadProxy(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity);
      if (!proxy) return { rendered: false, refusals: ["source proxy unavailable"] };

      const context = canvas.getContext("webgpu");
      if (!context) return { rendered: false, refusals: ["no webgpu canvas context"] };
      // A measurement pass never presents, so it must not resize the canvas
      // the viewer is looking at, and it needs no presentation surface at its
      // own resolution -- which is the whole reason a native measurement is
      // affordable when a native *presentation* would not be. It borrows the
      // surface format only, to pick the same pipelines.
      const measureOnly = Boolean(sourceOptions?.measureOnly);
      if (!measureOnly && (canvas.width !== proxy.width || canvas.height !== proxy.height)) {
        canvas.width = proxy.width;
        canvas.height = proxy.height;
      }
      const surface = this.configureSurface(canvas, context, lane === "hdr");
      const pipelines = this.pipelineFor(surface.format);

      const params = buildParams(
        lane, adjustments, proxy.workingSpace, surface.hdr, referenceWhiteNits,
        this.sourcePixelScaleFor(proxy, sourceSize),
        sourceOptions?.inheritedGrain || null,
      );
      const { spatialActive, detailActive } = this.graphActivity(params);

      const refusals = this.tiledExecutionRefusals({
        activeLocals, detailActive, spatialActive, overlayMask: maskOverlay, params, surface,
      });
      if (refusals.length) {
        this.recordStage("tiled-refused", { lane, longEdge, refusals });
        return { rendered: false, refusals };
      }

      // The highlight anchor is a whole-image measurement, so it is taken once
      // and shared by every tile. Measuring per tile would make each tile fit
      // its own peak and the seams would show.
      const anchor = this.highlightAnchorRequest(lane, adjustments, proxy, params);
      if (anchor) {
        params[75] = anchor.cached !== undefined
          ? anchor.cached
          : await this.measureToneAdjustedPeak(proxy, params, anchor.measurement, anchor.key);
      }

      const overlayIndex = maskOverlay?.localId
        ? activeLocals.findIndex((local) => local.id === maskOverlay.localId)
        : -1;
      const overlayColor = Array.isArray(maskOverlay?.color) ? maskOverlay.color : [0.12, 0.72, 0.86];
      params[131] = overlayIndex >= 0 ? 1 : 0;
      params[132] = overlayIndex >= 0 ? gpuMaskInfluenceOpacity(activeLocals[overlayIndex].mask) : 0;
      params[133] = Number(overlayColor[0]) || 0;
      params[134] = Number(overlayColor[1]) || 0;
      params[135] = Number(overlayColor[2]) || 0;

      this.uploadParamsAndCurves(lane, adjustments, curveSampler, params);

      return this.encodeTiledGeneration(canvas, context, proxy, surface, pipelines, params, {
        measureOnly,
        Scheduler,
        tileSize,
        lane,
        longEdge,
        editRevision,
        applicationGeneration: sourceOptions?.applicationGeneration,
        sessionId,
        activeLocals,
        geometrySignature,
        overlayIndex,
        sourcePixelScale: this.sourcePixelScaleFor(proxy, sourceSize),
      });
    }

    // `scope` is "global" or "local". The two are counted apart because they
    // answer different questions: a global amount drag must reuse every global
    // band, while the local bands below it legitimately regenerate, since the
    // global Detail composite is their input. One combined counter cannot tell
    // correct downstream invalidation from a cache that simply does not work.
    detailBandTile(key, width, height, scope = "global") {
      let entry = this.detailBandTiles.get(key);
      if (entry && entry.width === width && entry.height === height) {
        this.detailBandTiles.delete(key);
        this.detailBandTiles.set(key, entry);
        this.detailCacheCounters.hits += 1;
        this.detailCacheCounters[`${scope}Hits`] += 1;
        return { ...entry, hit: true };
      }
      if (entry) entry.texture.destroy();
      const texture = this.device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      entry = { texture, width, height, byteSize: width * height * 8 };
      this.detailBandTiles.set(key, entry);
      this.detailCacheCounters.misses += 1;
      this.detailCacheCounters[`${scope}Misses`] += 1;
      this.detailCacheCounters.analysisPasses += 2;
      return { ...entry, hit: false };
    }

    /**
     * How many bytes the two tile caches may hold between them.
     *
     * A flat fraction of the configured budget is wrong: the proxy, the
     * presentation surface and the tiled working graph are resident too, and at
     * 24 MP and above they are a large share of the budget. Taking 60% and 15%
     * of the *total* for the caches left less than the rest of the resident set
     * needed, so a measured peak could exceed the budget the planner had just
     * admitted the render against. Sizing the caches from what is actually
     * free keeps the two consistent.
     */
    cacheBudgetBytes(share, floorBytes) {
      const snapshot = this.resourceMemorySnapshot();
      const categories = snapshot.resident?.categories || {};
      const cacheBytes = (categories.detailBandCacheBytes || 0) + (categories.maskTileBytes || 0);
      const nonCacheBytes = Math.max(0, (snapshot.resident?.totalBytes || 0) - cacheBytes);
      // A tenth of the budget is held back for the contingency the planner
      // already reserves, so the two do not disagree about what fits.
      const free = Math.max(0, this.memoryBudgetBytes() * 0.9 - nonCacheBytes);
      return Math.max(floorBytes, Math.floor(free * share));
    }

    trimDetailBandTiles(pinned = []) {
      const protectedKeys = new Set(pinned);
      const budget = this.cacheBudgetBytes(0.80, 64 * 1024 * 1024);
      let bytes = [...this.detailBandTiles.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      for (const [key, entry] of [...this.detailBandTiles]) {
        if (bytes <= budget) break;
        if (protectedKeys.has(key)) continue;
        this.detailBandTiles.delete(key);
        entry.texture.destroy();
        bytes -= entry.byteSize;
        this.detailCacheCounters.evictions += 1;
      }
      return bytes;
    }

    async loadLocalMaskTile(sessionId, local, tile, longEdge, editRevision, geometrySignature, isCurrent) {
      const signature = gpuMaskIdentity(local.mask);
      const key = `${sessionId}:${local.id}:${longEdge}:${geometrySignature}:${editRevision}:${signature}:${tile.key}`;
      const cached = this.maskTiles.get(key);
      if (cached) {
        this.maskTiles.delete(key);
        this.maskTiles.set(key, cached);
        return cached;
      }
      const rect = tile.rect;
      const query = new URLSearchParams({
        x: String(rect.x), y: String(rect.y), width: String(rect.width), height: String(rect.height),
        halo: String(tile.halo), long_edge: String(longEdge), edit_revision: String(editRevision),
        geometry_signature: geometrySignature,
      });
      const response = await fetch(`/api/session/${sessionId}/local-mask-tile/${encodeURIComponent(local.id)}?${query}`);
      if (!response.ok) return null;
      const width = Number(response.headers.get("X-Tile-Width"));
      const height = Number(response.headers.get("X-Tile-Height"));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isCurrent()) return null;
      const bytesPerRow = Math.ceil(width / 256) * 256;
      const padded = bytesPerRow === width ? bytes : new Uint8Array(bytesPerRow * height);
      if (padded !== bytes) {
        for (let row = 0; row < height; row += 1) {
          padded.set(bytes.subarray(row * width, (row + 1) * width), row * bytesPerRow);
        }
      }
      const texture = this.device.createTexture({
        size: { width, height }, format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture }, padded, { bytesPerRow, rowsPerImage: height }, { width, height },
      );
      const entry = { texture, width, height, byteSize: width * height, key };
      this.maskTiles.set(key, entry);
      return entry;
    }

    trimMaskTiles(pinned = []) {
      const protectedKeys = new Set(pinned);
      const budget = this.cacheBudgetBytes(0.20, 32 * 1024 * 1024);
      let bytes = [...this.maskTiles.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      for (const [key, entry] of [...this.maskTiles]) {
        if (bytes <= budget) break;
        if (protectedKeys.has(key)) continue;
        this.maskTiles.delete(key);
        entry.texture.destroy();
        bytes -= entry.byteSize;
      }
      return bytes;
    }

    /** Encode and submit one complete haloed tiled generation. */
    async encodeTiledGeneration(canvas, context, proxy, surface, pipelines, params, options = {}) {
      const Scheduler = options.Scheduler
        || (typeof window !== "undefined" ? window.HDRTileScheduler : null);
      if (!Scheduler) return { rendered: false, refusals: ["tile scheduler is unavailable"] };
      const tileSize = Math.max(64, Math.floor(Number(options.tileSize) || Scheduler.DEFAULT_TILE_SIZE));
      // A measurement pass renders the graph to read one number off it and
      // presents nothing, so it must leave every piece of state that describes
      // the presented generation exactly as it found it.
      const measureOnly = Boolean(options.measureOnly);
      const lane = options.lane || "hdr";
      const longEdge = Number(options.longEdge) || Math.max(proxy.width, proxy.height);
      const editRevision = Number(options.editRevision) || 0;
      const activeLocals = options.activeLocals || [];
      const { detailActive, spatialActive, filmNeighbourhoodActive } = this.graphActivity(params);
      const localDetailActive = activeLocals.some((local) => gpuLocalDetailActive(local[`${lane}_grade`]));
      // Denoise reconstructs into a tile-sized texture rather than reading a
      // whole-frame resolved one. The alignment is the wavelet grid: a Haar
      // decomposition indexes from the frame's origin, so a tile that started
      // off the grid would reconstruct against the wrong parity.
      const denoiseSelector = this.denoiseSourceSelector;
      // The evidence is indexed against the frame the analysis ran on. If this
      // render is at a different resolution the indexing does not line up, and
      // reconstructing anyway would denoise against the wrong pixels -- so the
      // graph renders undenoised rather than wrongly, exactly as it did before
      // an analysis existed.
      const denoiseActive = Boolean(
        denoiseSelector?.cache && denoiseSelector.original
        && denoiseSelector.original.width === proxy.width
        && denoiseSelector.original.height === proxy.height,
      );
      const denoiseControls = denoiseSelector?.controls
        || { amount: 0.5, luminance: 0.5, colorNoise: 0.5, detailRecovery: 0.5 };
      const denoiseAlignment = denoiseActive
        ? denoiseTileAlignment(denoiseSelector.cache.settings.levels)
        : 1;
      let { halo, detailHalo, spatialHalo } = this.composedTileHalo(
        proxy.width, proxy.height, params, activeLocals, lane,
      );
      if (denoiseActive && halo % denoiseAlignment) {
        halo = Math.ceil(halo / denoiseAlignment) * denoiseAlignment;
      }
      const scheduler = this.tileScheduler instanceof Scheduler
        ? this.tileScheduler
        : (this.tileScheduler = new Scheduler({
          tileSize,
          maxResidentBytes: Math.floor(this.memoryBudgetBytes() * 0.7),
          maxScratchBytes: (tileSize + halo * 2) ** 2 * 8,
        }));
      const identity = `${proxy.identity}|${editRevision}|${surface.format}`;
      const nodes = ["geometry", "exposure", "white-balance", "curves", "color", "grading"];
      // Every neighbourhood node declares the composed reach, because each of
      // them has to be correct over the tile plus whatever the stages after it
      // will read. Detail runs first, so its own reach is the largest.
      if (detailActive || localDetailActive) nodes.push({ id: "detail", halo });
      if (params[85] > 0.5) nodes.push({ id: "halation", halo });
      if (params[92] > 0.5 && params[93] > 0) nodes.push({ id: "bloom", halo });
      if (filmNeighbourhoodActive && !spatialActive) nodes.push({ id: "softness", halo });
      const plan = scheduler.plan({
        width: proxy.width,
        height: proxy.height,
        identity,
        generation: Number(options.applicationGeneration ?? 0),
        tileSize,
        nodes,
      });
      const workWidth = Math.min(proxy.width, tileSize + halo * 2);
      const workHeight = Math.min(proxy.height, tileSize + halo * 2);
      const graph = this.ensureTileGraph(
        workWidth, workHeight, surface.format, proxy.pixelFormat, spatialActive, denoiseActive,
      );
      if (!graph) return { rendered: false, refusals: ["tile graph allocation failed"] };

      const isCurrent = options.isCurrent || (() => true);
      // Parameter buffers the reconstruction encoded against. They must outlive
      // the submission that reads them, so they are freed alongside the local
      // buffers once it has gone through.
      const denoiseParamBuffers = [];
      let denoiseTileResolves = 0;
      const maskMatrix = activeLocals.length
        ? await Promise.all(plan.tiles.map((tile) => Promise.all(activeLocals.map((local) => this.loadLocalMaskTile(
          options.sessionId, local, tile, longEdge, editRevision, options.geometrySignature || "{}", isCurrent,
        )))))
        : plan.tiles.map(() => []);
      if (!isCurrent() || maskMatrix.some((row) => row.some((entry) => !entry))) {
        return { rendered: false, refusals: ["mask tile unavailable or superseded"] };
      }

      const alignment = 256;
      const stride = Math.ceil(params.byteLength / alignment) * alignment;
      const required = stride * plan.tileCount;
      if (!this.tileCompositeParamBuffer || this.tileCompositeParamBuffer.size < required) {
        this.tileCompositeParamBuffer?.destroy();
        this.tileCompositeParamBuffer = this.device.createBuffer({
          size: required, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      const slots = new Float32Array((stride / 4) * plan.tileCount);
      plan.tiles.forEach((tile, index) => {
        const base = index * (stride / 4);
        slots.set(params, base);
        slots[base + 160] = tile.haloRect.x;
        slots[base + 161] = tile.haloRect.y;
        slots[base + 162] = tile.haloRect.width;
        slots[base + 163] = tile.haloRect.height;
        slots[base + 164] = proxy.width;
        slots[base + 165] = proxy.height;
        // The peak reduction reads its grid from the same slots the scope
        // passes do. Nothing else in the render graph reads them.
        slots[base + 136] = SCOPE_PEAK_GRID;
        slots[base + 137] = SCOPE_PEAK_GRID;
      });
      this.device.queue.writeBuffer(this.tileCompositeParamBuffer, 0, slots);

      const localBuffers = activeLocals.map((local) => {
        const localStride = Math.ceil(PARAM_COUNT * 4 / alignment) * alignment;
        const buffer = this.device.createBuffer({
          size: localStride * plan.tileCount,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const values = new Float32Array((localStride / 4) * plan.tileCount);
        plan.tiles.forEach((tile, index) => {
          const offset = index * (localStride / 4);
          values.set(buildLocalParams(local, lane, options.sourcePixelScale || 1), offset);
          values[offset + 162] = tile.haloRect.width;
          values[offset + 163] = tile.haloRect.height;
          values[offset + 164] = proxy.width;
          values[offset + 165] = proxy.height;
        });
        this.device.queue.writeBuffer(buffer, 0, values);
        return { buffer, stride: localStride };
      });

      const sourceView = graph.sourceTexture.createView();
      const baseView = graph.baseTexture.createView();
      const localView = graph.localTexture.createView();
      const scratchView = graph.detailScratchTexture.createView();
      const detailResultView = graph.detailResultTexture.createView();
      const filmView = graph.filmTexture.createView();
      const finishView = graph.finishTexture.createView();
      const peakTarget = this.ensureScopePeakTarget();
      const peakView = peakTarget?.texture.createView() || null;
      const globalInputIdentity = detailBandIdentity(params, proxy.identity, "global");
      const pinnedDetail = [];
      const pinnedMasks = maskMatrix.flat().map((entry) => entry.key);
      const cacheBefore = { ...this.detailCacheCounters };
      const startedAt = performance.now();
      if (!measureOnly) this.scopeSources.delete(canvas);
      this.device.pushErrorScope("validation");
      const encoder = this.device.createCommandEncoder();
      const pass = (view, pipeline, bindGroup, width, height, alpha = 1) => {
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: alpha }, loadOp: "clear", storeOp: "store" }],
        });
        renderPass.setViewport(0, 0, width, height, 0, 1);
        renderPass.setScissorRect(0, 0, width, height);
        renderPass.setPipeline(pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3);
        renderPass.end();
      };
      // A measurement pass must not acquire the swap chain: doing so would
      // hand it a texture sized to the canvas the viewer is looking at, and
      // presenting it would replace their frame with a partial one.
      const canvasView = measureOnly ? null : context.getCurrentTexture().createView();
      const bandTileKey = (prefix, candidate) => `${prefix}|${candidate.rect.x},${candidate.rect.y},${candidate.rect.width},${candidate.rect.height}|h${candidate.halo}`;
      const intersect = (left, right) => {
        const x0 = Math.max(left.x, right.x);
        const y0 = Math.max(left.y, right.y);
        const x1 = Math.min(left.x + left.width, right.x + right.width);
        const y1 = Math.min(left.y + left.height, right.y + right.height);
        return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
      };
      const assemblePackedHalo = (prefix, targetTile) => {
        const pieces = plan.tiles.map((candidate) => ({
          candidate,
          overlap: intersect(candidate.rect, targetTile.haloRect),
          entry: this.detailBandTiles.get(bandTileKey(prefix, candidate)),
        })).filter((piece) => piece.overlap);
        if (pieces.some((piece) => !piece.entry)) return false;
        pieces.forEach(({ candidate, overlap, entry }) => {
          encoder.copyTextureToTexture(
            { texture: entry.texture, origin: { x: overlap.x - candidate.rect.x, y: overlap.y - candidate.rect.y, z: 0 } },
            { texture: graph.detailResultTexture, origin: { x: overlap.x - targetTile.haloRect.x, y: overlap.y - targetTile.haloRect.y, z: 0 } },
            { width: overlap.width, height: overlap.height, depthOrArrayLayers: 1 },
          );
        });
        return true;
      };

      // Denoise reconstructs into the same encoder, one tile at a time, so this
      // loop has to be able to wait for it. Command order is call order, and
      // every tile is reconstructed before the copy that reads it.
      for (const [index, tile] of plan.tiles.entries()) {
        const width = tile.haloRect.width;
        const height = tile.haloRect.height;
        const parameterBinding = {
          buffer: this.tileCompositeParamBuffer, offset: index * stride, size: params.byteLength,
        };
        const bind = (source, spatial = source, overlay = spatial, binding = parameterBinding) =>
          this.bindGraphResources(source, spatial, binding, overlay);
        if (denoiseActive) {
          // Reconstruct only this tile, into a texture the size of one tile,
          // and into the same encoder so the generation stays one submission.
          // The reconstruction reads the original at its true frame position,
          // so the pixels are the ones the whole-frame resolve would produce.
          const resolved = await this.resolveDenoiseProxy(denoiseControls, {
            region: {
              x: tile.haloRect.x, y: tile.haloRect.y,
              width: tile.haloRect.width, height: tile.haloRect.height,
            },
            destination: {
              texture: graph.denoiseResolvedTexture,
              width: graph.width,
              height: graph.height,
              byteSize: graph.width * graph.height * 8,
            },
            encoder,
          });
          if (resolved?.paramBuffer) denoiseParamBuffers.push(resolved.paramBuffer);
          denoiseTileResolves += 1;
          encoder.copyTextureToTexture(
            { texture: graph.denoiseResolvedTexture, origin: { x: 0, y: 0, z: 0 } },
            { texture: graph.sourceTexture, origin: { x: 0, y: 0, z: 0 } },
            { width, height, depthOrArrayLayers: 1 },
          );
        } else {
          encoder.copyTextureToTexture(
            { texture: proxy.texture, origin: { x: tile.haloRect.x, y: tile.haloRect.y, z: 0 } },
            { texture: graph.sourceTexture, origin: { x: 0, y: 0, z: 0 } },
            { width, height, depthOrArrayLayers: 1 },
          );
        }
        pass(baseView, pipelines.base, bind(sourceView), width, height);
        let localSource = graph.baseTexture;

        if (detailActive) {
          const prefix = `global|${globalInputIdentity}`;
          const key = bandTileKey(prefix, tile);
          const packed = this.detailBandTile(key, tile.rect.width, tile.rect.height, "global");
          pinnedDetail.push(key);
          const assembled = packed.hit && assemblePackedHalo(prefix, tile);
          if (!assembled) {
            pass(scratchView, pipelines.detailHorizontal, bind(baseView, baseView), width, height, 0);
            pass(detailResultView, pipelines.detailVertical, bind(scratchView, scratchView), width, height, 0);
            encoder.copyTextureToTexture(
              { texture: graph.detailResultTexture, origin: { x: tile.rect.x - tile.haloRect.x, y: tile.rect.y - tile.haloRect.y, z: 0 } },
              { texture: packed.texture },
              { width: tile.rect.width, height: tile.rect.height, depthOrArrayLayers: 1 },
            );
          }
          pass(localView, pipelines.detailComposite, bind(baseView, detailResultView), width, height);
          localSource = graph.localTexture;
        }

        let precedingIdentity = `${proxy.identity}|${JSON.stringify(Array.from(params))}`;
        activeLocals.forEach((local, localIndex) => {
          const target = localSource === graph.baseTexture ? graph.localTexture : graph.baseTexture;
          const targetView = target.createView();
          const localBinding = {
            buffer: localBuffers[localIndex].buffer,
            offset: index * localBuffers[localIndex].stride,
            size: PARAM_COUNT * 4,
          };
          const maskView = maskMatrix[index][localIndex].texture.createView();
          if (gpuLocalDetailActive(local[`${lane}_grade`])) {
            pass(finishView, pipelines.localCandidate,
              bind(localSource.createView(), localSource.createView(), localSource.createView(), localBinding), width, height);
            const localValues = buildLocalParams(local, lane, options.sourcePixelScale || 1);
            const bandIdentity = detailBandIdentity(localValues, precedingIdentity, "local");
            const prefix = `local:${local.id}|${bandIdentity}`;
            const key = bandTileKey(prefix, tile);
            const packed = this.detailBandTile(key, tile.rect.width, tile.rect.height, "local");
            pinnedDetail.push(key);
            const assembled = packed.hit && assemblePackedHalo(prefix, tile);
            if (!assembled) {
              pass(scratchView, pipelines.localDetailHorizontal,
                bind(finishView, finishView, finishView, localBinding), width, height, 0);
              pass(detailResultView, pipelines.localDetailVertical,
                bind(scratchView, scratchView, scratchView, localBinding), width, height, 0);
              encoder.copyTextureToTexture(
                { texture: graph.detailResultTexture, origin: { x: tile.rect.x - tile.haloRect.x, y: tile.rect.y - tile.haloRect.y, z: 0 } },
                { texture: packed.texture },
                { width: tile.rect.width, height: tile.rect.height, depthOrArrayLayers: 1 },
              );
            }
            pass(scratchView, pipelines.localDetailComposite,
              bind(finishView, detailResultView, detailResultView, localBinding), width, height);
            pass(targetView, pipelines.localDetailMix,
              bind(localSource.createView(), maskView, scratchView, localBinding), width, height);
          } else {
            pass(targetView, pipelines.local,
              bind(localSource.createView(), maskView, maskView, localBinding), width, height);
          }
          localSource = target;
          precedingIdentity += `|${JSON.stringify(gpuMaskRenderPayload(local.mask))}|${JSON.stringify(local[`${lane}_grade`])}|${local.opacity}`;
        });

        pass(filmView, pipelines.response, bind(localSource.createView()), width, height);
        let spatialResultView = sourceView;
        if (spatialActive) {
          // The quarter-resolution grid is anchored to the frame, and this
          // tile's halo rectangle starts on one of its texels, so the valid
          // region is exactly the tile's own quarter extent. Rendering only
          // that region keeps an edge tile from writing texels its source
          // never covered, which `validSpatialDimensions()` then reads back.
          const spatialWidth = Math.ceil(width / 4);
          const spatialHeight = Math.ceil(height / 4);
          const spatialAView = graph.spatialATexture.createView();
          const spatialBView = graph.spatialBTexture.createView();
          pass(spatialAView, pipelines.extract, bind(filmView, spatialBView), spatialWidth, spatialHeight, 0);
          pass(spatialBView, pipelines.blurHorizontal, bind(filmView, spatialAView), spatialWidth, spatialHeight, 0);
          pass(spatialAView, pipelines.blurVertical, bind(filmView, spatialBView), spatialWidth, spatialHeight, 0);
          spatialResultView = graph.spatialATexture.createView();
        }
        pass(finishView, pipelines.finish, bind(filmView, spatialResultView), width, height);
        // The finished tile is measured before it is composited, because the
        // composite encodes for the display and this has to read the picture.
        // On a measurement pass this is the only thing the tile is for.
        if (peakTarget) {
          const peakPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: peakView,
              loadOp: index === 0 ? "clear" : "load",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              storeOp: "store",
            }],
          });
          peakPass.setPipeline(pipelines.scopePeakTile);
          peakPass.setBindGroup(0, bind(finishView));
          peakPass.draw(3);
          peakPass.end();
        }
        if (!measureOnly) {
          const overlayView = options.overlayIndex >= 0
            ? maskMatrix[index][options.overlayIndex].texture.createView()
            : sourceView;
          const compositeBind = bind(finishView, sourceView, overlayView);
          const compositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: canvasView, loadOp: index === 0 ? "clear" : "load",
              clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
            }],
          });
          compositePass.setScissorRect(tile.rect.x, tile.rect.y, tile.rect.width, tile.rect.height);
          compositePass.setPipeline(pipelines.composite);
          compositePass.setBindGroup(0, compositeBind);
          compositePass.draw(3);
          compositePass.end();
        }
        scheduler.acceptTile(tile.key, plan.generation);
      }

      if (peakTarget) {
        encoder.copyTextureToBuffer(
          { texture: peakTarget.texture },
          { buffer: peakTarget.readBuffer, bytesPerRow: peakTarget.bytesPerRow, rowsPerImage: peakTarget.size },
          { width: peakTarget.size, height: peakTarget.size },
        );
      }
      this.device.queue.submit([encoder.finish()]);
      localBuffers.forEach((entry) => entry.buffer.destroy());
      denoiseParamBuffers.forEach((buffer) => buffer.destroy());
      const validationError = await this.device.popErrorScope();
      if (validationError) {
        this.recordStage("tiled-validation-error", { message: validationError.message });
        return { rendered: false, refusals: [`validation: ${validationError.message}`] };
      }
      // Taken now, while this generation's grid is still the one in the
      // target. It is an exact maximum over every pixel the tiles covered, and
      // `measuredLongEdge` says what resolution those pixels were, because a
      // maximum over a downsampled proxy is a lower bound on the real one and
      // must never be presented as though it were not.
      const measuredPeak = await this.readScopePeak(peakTarget);
      if (measuredPeak !== null && !measureOnly) {
        this.exactScopePeak = {
          peak: measuredPeak,
          lane,
          longEdge: Math.max(proxy.width, proxy.height),
          width: proxy.width,
          height: proxy.height,
          editRevision,
          applicationGeneration: Number(options.applicationGeneration ?? 0),
          identity: proxy.identity,
        };
      }
      const detailCacheBytes = this.trimDetailBandTiles(pinnedDetail);
      const maskCacheBytes = this.trimMaskTiles(pinnedMasks);
      // The trim above cannot evict this generation's own tiles, because
      // submitted work still references them. Once the queue drains they are
      // evictable, so trim again without pins. Retained as a promise so a
      // measurement can await the steady state rather than sampling mid-trim.
      this.pendingCacheTrim = this.device.queue.onSubmittedWorkDone().then(() => {
        this.trimDetailBandTiles();
        this.trimMaskTiles();
      }).catch(() => null);
      const durationMs = performance.now() - startedAt;
      const metrics = {
        width: proxy.width, height: proxy.height, tileSize, halo,
        detailHalo, spatialHalo, tileWidth: workWidth, tileHeight: workHeight,
        exactPeak: measuredPeak, exactPeakLongEdge: Math.max(proxy.width, proxy.height),
        tileCount: plan.tileCount, visibleCount: plan.visibleCount, submissions: 1,
        workingSetBytes: graph.byteSize, proxyBytes: proxy.byteSize,
        detailCacheBytes, maskCacheBytes,
        detailCacheHits: this.detailCacheCounters.hits - cacheBefore.hits,
        detailCacheMisses: this.detailCacheCounters.misses - cacheBefore.misses,
        detailAnalysisPasses: this.detailCacheCounters.analysisPasses - cacheBefore.analysisPasses,
        detailGlobalCacheHits: this.detailCacheCounters.globalHits - cacheBefore.globalHits,
        detailGlobalCacheMisses: this.detailCacheCounters.globalMisses - cacheBefore.globalMisses,
        detailLocalCacheHits: this.detailCacheCounters.localHits - cacheBefore.localHits,
        detailLocalCacheMisses: this.detailCacheCounters.localMisses - cacheBefore.localMisses,
        detailBandStacks: (detailActive ? 1 : 0)
          + activeLocals.filter((local) => gpuLocalDetailActive(local[`${lane}_grade`])).length,
        presentableGeneration: scheduler.presentableGeneration(plan), durationMs,
      };
      this.recordStage("detail-cache", { ...this.tiledExecutionMetrics });
      // Likewise the diagnostics: `tiledExecutionMetrics` describes the
      // generation on screen, and a measurement pass has not put one there.
      // Its own numbers come back through the return value instead.
      if (!measureOnly) this.tiledExecutionMetrics = metrics;
      this.recordStage(measureOnly ? "tiled-measure" : "tiled-render", { lane, longEdge, ...metrics });
      return {
        rendered: true, refusals: [], width: proxy.width, height: proxy.height,
        hdr: surface.hdr, proxyFormat: proxy.pixelFormat,
        sourceSerial: proxy.sourceSerial ?? null, execution: "tiled", metrics,
      };
    }

    /** Record why a render declined, so a falsy result is diagnosable. */
    refuseRender(reason) {
      this.lastRenderRefusal = { reason, at: performance.now() };
      this.recordStage("render-refused", { reason });
      return false;
    }

    async renderTo(canvas, sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203, sourceSize = null, sourceOptions = null) {
      if (!this.available || !sessionId) return this.refuseRender("unavailable-or-no-session");
      const activeLocals = activeGpuLocals(lane, localAdjustments);
      // Eligibility is deliberately checked before resetting a session or
      // requesting a proxy. Unsupported local modules use the CPU renderer,
      // and must not first pay for a WebGPU proxy that cannot be presented.
      if (!activeLocals.every((local) => gpuLocalSupported(local[`${lane}_grade`]))) return this.refuseRender("unsupported-local-adjustment");
      const renderStartedAt = performance.now();
      if (this.sessionId !== sessionId) this.resetSession(sessionId);
      const resourceGeneration = this.resourceGeneration;
      this.activeRenderCount += 1;
      try {
      const serial = (this.renderSerials.get(canvas) || 0) + 1;
      this.renderSerials.set(canvas, serial);
      const geometrySignature = JSON.stringify(adjustments.shared?.geometry || {});
      const sourceIdentity = sourceOptions?.identity || "source";
      const retainedOriginal = this.denoiseSourceSelector?.original;
      if (retainedOriginal
        && retainedOriginal.sessionId === sessionId
        && retainedOriginal.lane === lane
        && retainedOriginal.geometrySignature === geometrySignature
        && retainedOriginal.sourceIdentity === sourceIdentity) {
        longEdge = retainedOriginal.longEdge;
      }
      const proxy = await this.loadProxy(
        sessionId,
        lane,
        longEdge,
        geometrySignature,
        editRevision,
        sourceIdentity,
      );
      const proxyReadyAt = performance.now();
      if (resourceGeneration !== this.resourceGeneration
        || serial !== this.renderSerials.get(canvas)
        || !proxy
        || sourceOptions?.isCurrent?.() === false) return this.refuseRender("superseded-before-proxy");
      const sourceProxy = this.selectedDenoiseSource(proxy);
      let masks = [];
      let masksReadyAt = proxyReadyAt;

      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The comparison WebGPU canvas context is unavailable");
      let surface = this.configureSurface(canvas, context, lane === "hdr");
      let pipelines = this.pipelineFor(surface.format);
      const sourcePixelScale = this.sourcePixelScaleFor(proxy, sourceSize);
      let params = buildParams(
        lane,
        adjustments,
        proxy.workingSpace,
        surface.hdr,
        referenceWhiteNits,
        sourcePixelScale,
        sourceOptions?.inheritedGrain || null,
      );
      // The anchor is measured before anything is encoded, so this render can
      // never await once it owns GPU resources or the canvas. A settled draft
      // that loses its race returns false, and the scheduler answers that with
      // a full CPU preview -- visible as a flash -- so awaiting later is not an
      // option here. Measuring the finished picture instead of this
      // source-domain estimate needs the scheduler to request a refinement
      // after the reduction lands, rather than an await inside the render.
      const anchor = this.highlightAnchorRequest(lane, adjustments, sourceProxy, params);
      if (anchor) {
        if (anchor.cached !== undefined) {
          params[75] = anchor.cached;
        } else if (sourceOptions?.tier !== "interactive") {
          // Only Direct declines to await here: an interactive frame that
          // stopped for a whole-image reduction would miss its deadline, and
          // Tiled is never the interactive route.
          params[75] = await this.measureToneAdjustedPeak(sourceProxy, params, anchor.measurement, anchor.key);
          if (resourceGeneration !== this.resourceGeneration) return this.refuseRender("peak:resource-generation");
          if (serial !== this.renderSerials.get(canvas)) return this.refuseRender("peak:newer-render-started");
          if (sourceOptions?.isCurrent?.() === false) return this.refuseRender("peak:application-not-current");
        }
      }
      // Changing a visible canvas's backing size clears its presented frame.
      // Keep the previous interactive image intact while settled/refinement
      // work awaits highlight-peak analysis, then resize and submit the new
      // frame in one synchronous presentation step. Otherwise the compositor
      // can expose the cleared (black) canvas between pointerup and settle.
      // Activity and admission are decided here, before the canvas is resized.
      // They read only grade-derived parameter slots, so the surface-format
      // rebuild below cannot change them.
      const { spatialActive, detailActive } = this.graphActivity(params);
      const localDetailActive = activeLocals.some((local) => gpuLocalDetailActive(local[`${lane}_grade`]));
      // Admission runs against the graph this render is about to build, so the
      // plan and the decision describe real work rather than a generic guess.
      const plan = this.planRender(proxy.width, proxy.height, {
        executionOverride: this.executionOverride || null,
        detailActive: detailActive || localDetailActive,
        spatialActive,
        // Without this the tiled model sizes its working set to a bare tile
        // while the encoder builds one tile plus its halo, and admission would
        // be decided against a working set nobody allocates. A spatial graph
        // makes the gap large: a 256 tile with a 136 halo is 528 on a side.
        halo: this.composedTileHalo(proxy.width, proxy.height, params, activeLocals, lane).halo,
        sourceBytesPerPixel: proxy.pixelFormat === "rgba16float" ? 8 : 16,
        tier: sourceOptions?.tier ?? null,
      });
      // Direct's whole-frame masks must be fetched before the resize below.
      // Resizing a visible canvas clears its presented frame, so any await
      // between the resize and the submission can leave a cleared canvas on
      // screen -- and, if the render is then superseded, leave it there with no
      // accepted presentation at all, which strands the geometry handoff. Tiled
      // skips this entirely: it carries bounded per-tile masks instead.
      if (plan.decision.mode !== "tiled") {
        masks = await Promise.all(activeLocals.map((local) => this.loadLocalMask(
          sessionId,
          local,
          longEdge,
          editRevision,
          geometrySignature,
          () => serial === this.renderSerials.get(canvas),
        )));
        masksReadyAt = performance.now();
        if (resourceGeneration !== this.resourceGeneration
          || serial !== this.renderSerials.get(canvas)
          || masks.some((mask) => !mask)
          || sourceOptions?.isCurrent?.() === false) return this.refuseRender("superseded-after-masks");
      }
      const measuredPeak = params[75];
      if (canvas.width !== proxy.width) canvas.width = proxy.width;
      if (canvas.height !== proxy.height) canvas.height = proxy.height;
      const presentationSurface = this.configureSurface(canvas, context, lane === "hdr");
      if (presentationSurface.format !== surface.format || presentationSurface.hdr !== surface.hdr) {
        surface = presentationSurface;
        pipelines = this.pipelineFor(surface.format);
        params = buildParams(
          lane,
          adjustments,
          proxy.workingSpace,
          surface.hdr,
          referenceWhiteNits,
          sourcePixelScale,
          sourceOptions?.inheritedGrain || null,
        );
        params[75] = measuredPeak;
      }
      const overlayIndex = maskOverlay?.localId
        ? activeLocals.findIndex((local) => local.id === maskOverlay.localId)
        : -1;
      const overlayMask = overlayIndex >= 0;
      const overlayLocal = overlayIndex >= 0 ? activeLocals[overlayIndex] : null;
      const overlayColor = Array.isArray(maskOverlay?.color) ? maskOverlay.color : [0.12, 0.72, 0.86];
      params[131] = overlayMask ? 1 : 0;
      params[132] = overlayLocal ? gpuMaskInfluenceOpacity(overlayLocal.mask) : 0;
      params[133] = Number(overlayColor[0]) || 0;
      params[134] = Number(overlayColor[1]) || 0;
      params[135] = Number(overlayColor[2]) || 0;
      this.uploadParamsAndCurves(lane, adjustments, curveSampler, params);
      if (plan.decision.mode === "tiled") {
        const refusals = this.tiledExecutionRefusals({
          activeLocals,
          detailActive,
          spatialActive,
          overlayMask,
          params,
          surface,
        });
        if (sourceOptions?.tier === "interactive") refusals.push("interactive render");
        if (refusals.length) {
          this.recordStage("tiled-refused", { lane, longEdge, refusals });
          return this.refuseRender(`tiled-refused:${refusals.join(",")}`);
        }
        this.recordStage("admission", {
          mode: "tiled",
          reason: plan.decision.violations.map((violation) => violation.rule).join(",") || "planner",
          width: proxy.width,
          height: proxy.height,
          peakLogicalBytes: plan.totals.peakLogicalBytes,
          budgetBytes: plan.budgetBytes,
        });
        const tiled = await this.encodeTiledGeneration(canvas, context, sourceProxy, surface, pipelines, params, {
          tileSize: sourceOptions?.tileSize,
          lane,
          longEdge,
          editRevision,
          applicationGeneration: sourceOptions?.applicationGeneration,
          sessionId,
          activeLocals,
          geometrySignature,
          overlayIndex,
          sourcePixelScale,
          isCurrent: () => resourceGeneration === this.resourceGeneration
            && serial === this.renderSerials.get(canvas)
            && sourceOptions?.isCurrent?.() !== false,
        });
        if (!tiled?.rendered) {
          return this.refuseRender(`tiled-encode-failed:${(tiled?.refusals || []).join(",")}`);
        }
        // The resolution this generation was processed at, which is not the
        // size of the picture it produced: geometry trims the frame. The
        // viewer needs the former to decide whether the selected tier has
        // been reached.
        return { ...tiled, sourceSerial: serial, processedLongEdge: proxy.longEdge };
      }
      const intermediate = this.ensureIntermediate(
        canvas,
        proxy.width,
        proxy.height,
        spatialActive,
        detailActive || localDetailActive,
      );
      if (!intermediate) {
        // An allocation failed and the backoff is recorded. Abandon this render
        // and keep the previous presentation; the selected tier is unchanged.
        this.recordStage("admission", {
          mode: "tiled",
          reason: this.allocationBackoff?.reason || "allocation failed",
          width: proxy.width,
          height: proxy.height,
          peakLogicalBytes: plan.totals.peakLogicalBytes,
          budgetBytes: plan.budgetBytes,
        });
        return this.refuseRender("intermediate-allocation-failed");
      }
      // Direct's passes each own a whole parameter buffer, while Tiled binds
      // one buffer at a per-tile offset, so this adapts the buffer to the
      // binding resource the shared helper takes.
      const makeBindGroup = (sourceView, spatialView, parameterBuffer = this.paramBuffer, overlayView = spatialView) =>
        this.bindGraphResources(sourceView, spatialView, { buffer: parameterBuffer }, overlayView);
      // When spatial effects are inactive, use the immutable proxy as the
      // required placeholder binding. Binding filmTexture here would make the
      // response pass sample from the same texture it renders into, which is
      // invalid in WebGPU even when the inactive shader branch never samples it.
      const fallbackSpatialView = sourceProxy.texture.createView();
      const spatialAView = intermediate.spatialATexture?.createView() || fallbackSpatialView;
      const baseBindGroup = makeBindGroup(sourceProxy.texture.createView(), spatialAView);
      // Detail blur samples the filterable spatial binding so fractional radii
      // move continuously instead of jumping between integer texels. Each pass
      // binds its immutable input to both sampled slots; neither aliases that
      // pass's render attachment.
      const detailHorizontalBindGroup = detailActive
        ? makeBindGroup(intermediate.baseTexture.createView(), intermediate.baseTexture.createView())
        : null;
      const detailVerticalBindGroup = detailActive
        ? makeBindGroup(intermediate.detailATexture.createView(), intermediate.detailATexture.createView())
        : null;
      const detailCompositeBindGroup = detailActive
        ? makeBindGroup(intermediate.baseTexture.createView(), intermediate.detailBTexture.createView())
        : null;
      const extractBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView())
        : null;
      const horizontalBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialATexture.createView())
        : null;
      const verticalBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView())
        : null;
      const finishBindGroup = makeBindGroup(intermediate.filmTexture.createView(), spatialAView);
      if (!intermediate.compositeParamBuffer
        || intermediate.compositeParamBuffer.size < Math.max(16, Math.ceil(params.byteLength / 4) * 4)) {
        intermediate.compositeParamBuffer?.destroy();
        intermediate.compositeParamBuffer = this.createStorageBuffer(params);
      }
      const compositeBindGroup = makeBindGroup(
        intermediate.finishTexture.createView(),
        spatialAView,
        intermediate.compositeParamBuffer,
        masks[overlayIndex]?.texture?.createView() || spatialAView,
      );
      const encoder = this.device.createCommandEncoder();
      const gpuTiming = this.instrumentationEnabled && this.device.features.has("timestamp-query")
        ? this.createGpuTimingResources()
        : null;
      const basePass = encoder.beginRenderPass({
        ...(gpuTiming ? { timestampWrites: { querySet: gpuTiming.querySet, beginningOfPassWriteIndex: 0 } } : {}),
        colorAttachments: [{
          view: intermediate.baseTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      basePass.setPipeline(pipelines.base);
      basePass.setBindGroup(0, baseBindGroup);
      basePass.draw(3);
      basePass.end();
      let localSource = intermediate.baseTexture;
      if (detailActive) {
        const detailHorizontalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.detailATexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        detailHorizontalPass.setPipeline(pipelines.detailHorizontal);
        detailHorizontalPass.setBindGroup(0, detailHorizontalBindGroup);
        detailHorizontalPass.draw(3);
        detailHorizontalPass.end();

        const detailVerticalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.detailBTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        detailVerticalPass.setPipeline(pipelines.detailVertical);
        detailVerticalPass.setBindGroup(0, detailVerticalBindGroup);
        detailVerticalPass.draw(3);
        detailVerticalPass.end();

        const detailCompositePass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.localTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        detailCompositePass.setPipeline(pipelines.detailComposite);
        detailCompositePass.setBindGroup(0, detailCompositeBindGroup);
        detailCompositePass.draw(3);
        detailCompositePass.end();
        localSource = intermediate.localTexture;
      }
      for (let index = 0; index < activeLocals.length; index += 1) {
        const local = activeLocals[index];
        const target = localSource === intermediate.baseTexture ? intermediate.localTexture : intermediate.baseTexture;
        const localBuffer = this.localParamBuffer(local, lane, sourcePixelScale);
        if (gpuLocalDetailActive(local[`${lane}_grade`])) {
          // Preserve the pre-local source until the final mask mix. The normal
          // ping-pong target holds the unmasked candidate, while the two Detail
          // scratch textures are reused serially for every local adjustment.
          const candidateBindGroup = makeBindGroup(localSource.createView(), localSource.createView(), localBuffer);
          const candidatePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: target.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          candidatePass.setPipeline(pipelines.localCandidate);
          candidatePass.setBindGroup(0, candidateBindGroup);
          candidatePass.draw(3);
          candidatePass.end();

          const horizontalBindGroup = makeBindGroup(target.createView(), target.createView(), localBuffer);
          const horizontalPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: intermediate.detailATexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          horizontalPass.setPipeline(pipelines.localDetailHorizontal);
          horizontalPass.setBindGroup(0, horizontalBindGroup);
          horizontalPass.draw(3);
          horizontalPass.end();

          const verticalBindGroup = makeBindGroup(
            intermediate.detailATexture.createView(),
            intermediate.detailATexture.createView(),
            localBuffer,
          );
          const verticalPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: intermediate.detailBTexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          verticalPass.setPipeline(pipelines.localDetailVertical);
          verticalPass.setBindGroup(0, verticalBindGroup);
          verticalPass.draw(3);
          verticalPass.end();

          const detailCompositeBindGroup = makeBindGroup(
            target.createView(),
            intermediate.detailBTexture.createView(),
            localBuffer,
          );
          const detailCompositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: intermediate.detailATexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          detailCompositePass.setPipeline(pipelines.localDetailComposite);
          detailCompositePass.setBindGroup(0, detailCompositeBindGroup);
          detailCompositePass.draw(3);
          detailCompositePass.end();

          const mixBindGroup = makeBindGroup(
            localSource.createView(),
            masks[index].texture.createView(),
            localBuffer,
            intermediate.detailATexture.createView(),
          );
          const mixPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: target.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          mixPass.setPipeline(pipelines.localDetailMix);
          mixPass.setBindGroup(0, mixBindGroup);
          mixPass.draw(3);
          mixPass.end();
          localSource = target;
          continue;
        }
        const localBindGroup = makeBindGroup(localSource.createView(), masks[index].texture.createView(), localBuffer);
        const localPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: target.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        localPass.setPipeline(pipelines.local);
        localPass.setBindGroup(0, localBindGroup);
        localPass.draw(3);
        localPass.end();
        localSource = target;
      }
      const responseBindGroup = makeBindGroup(localSource.createView(), spatialAView);
      const responsePass = encoder.beginRenderPass({
        colorAttachments: [{
          view: intermediate.filmTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      responsePass.setPipeline(pipelines.response);
      responsePass.setBindGroup(0, responseBindGroup);
      responsePass.draw(3);
      responsePass.end();
      if (spatialActive) {
        const extractPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialATexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        extractPass.setPipeline(pipelines.extract);
        extractPass.setBindGroup(0, extractBindGroup);
        extractPass.draw(3);
        extractPass.end();
        const horizontalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialBTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        horizontalPass.setPipeline(pipelines.blurHorizontal);
        horizontalPass.setBindGroup(0, horizontalBindGroup);
        horizontalPass.draw(3);
        horizontalPass.end();
        const verticalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialATexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        verticalPass.setPipeline(pipelines.blurVertical);
        verticalPass.setBindGroup(0, verticalBindGroup);
        verticalPass.draw(3);
        verticalPass.end();
      }
      const finishPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: intermediate.finishTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      finishPass.setPipeline(pipelines.finish);
      finishPass.setBindGroup(0, finishBindGroup);
      finishPass.draw(3);
      finishPass.end();
      // A settled render splits here: the finished picture has to exist before
      // its peak can be measured, and the measured peak has to exist before the
      // limiter runs. The submit count matches the previous scheme, which also
      // performed one reduction and one readback per settled render.
      this.device.queue.writeBuffer(intermediate.compositeParamBuffer, 0, params);
      const pass = encoder.beginRenderPass({
        ...(gpuTiming ? { timestampWrites: { querySet: gpuTiming.querySet, endOfPassWriteIndex: 1 } } : {}),
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipelines.composite);
      pass.setBindGroup(0, compositeBindGroup);
      pass.draw(3);
      pass.end();
      if (gpuTiming) {
        encoder.resolveQuerySet(gpuTiming.querySet, 0, 2, gpuTiming.resolveBuffer, 0);
        encoder.copyBufferToBuffer(gpuTiming.resolveBuffer, 0, gpuTiming.readBuffer, 0, 16);
      }
      this.device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      this.recordStage("grading", {
        serial,
        lane,
        longEdge,
        source: sourceProxy === proxy ? "original" : "resolved",
        durationMs: submittedAt - masksReadyAt,
      });
      this.scopeSources.set(canvas, {
        serial,
        applicationGeneration: sourceOptions?.applicationGeneration ?? null,
        geometrySignature,
        lane,
        width: proxy.width,
        height: proxy.height,
        // Scopes read the finished picture the composite pass presented, so they
        // never recompute Film Look and never disagree with it.
        filmTexture: intermediate.finishTexture,
        spatialTexture: intermediate.spatialATexture || intermediate.finishTexture,
        params: new Float32Array(params),
        sessionId,
      });
      if (this.instrumentationEnabled) {
        const metric = {
          serial,
          lane,
          longEdge,
          width: proxy.width,
          height: proxy.height,
          localCount: activeLocals.length,
          proxyAwaitMs: proxyReadyAt - renderStartedAt,
          maskAwaitMs: masksReadyAt - proxyReadyAt,
          encodeSubmitMs: submittedAt - masksReadyAt,
          submissionMs: submittedAt - renderStartedAt,
          queueCompleteMs: null,
          gpuMs: null,
        };
        this.performanceMetrics.renders.push(metric);
        if (this.performanceMetrics.renders.length > 240) this.performanceMetrics.renders.shift();
        void this.device.queue.onSubmittedWorkDone().then(() => {
          metric.queueCompleteMs = performance.now() - submittedAt;
        }).catch(() => null);
        if (gpuTiming) this.collectGpuTiming(gpuTiming, metric);
      } else {
        gpuTiming?.querySet.destroy();
        gpuTiming?.resolveBuffer.destroy();
        gpuTiming?.readBuffer.destroy();
      }
      return {
        width: proxy.width,
        height: proxy.height,
        hdr: surface.hdr,
        proxyFormat: proxy.pixelFormat,
        sourceSerial: serial,
        execution: "direct",
        processedLongEdge: proxy.longEdge,
      };
      } finally {
        this.finishActiveRender();
      }
    }

    selectedDenoiseSource(originalProxy) {
      const selector = this.denoiseSourceSelector;
      if (!selector || selector.identity !== originalProxy.identity) {
        return originalProxy;
      }
      if (selector.selected === "resolved" && selector.resolved) return selector.resolved;
      return selector.original;
    }

    async ensureDenoisePipelines() {
      if (this.denoisePipelines) return this.denoisePipelines;
      const module = this.device.createShaderModule({ code: DENOISE_SHADER_SOURCE });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === "error");
      if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
      const [analysis, resolve, resolveTwoLevel] = await Promise.all([
        this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "analyzeMain" } }),
        this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "resolveMain" } }),
        this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "resolveTwoLevelMain" } }),
      ]);
      this.denoisePipelines = { analysis, resolve, resolveTwoLevel };
      return this.denoisePipelines;
    }

    createDenoiseTexture(width, height, label) {
      const texture = this.device.createTexture({
        label,
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      return { texture, width, height, byteSize: width * height * 8 };
    }

    /**
     * Analyse the proxy tile by tile into a cache of Haar evidence.
     *
     * Tiling buys two things. The transient low-band chain becomes one tile's
     * worth instead of the whole image's, so analysis scratch stops following
     * the source; and evidence becomes a set of per-tile textures rather than
     * one monolithic band per level, which is what lets a cache evict it.
     *
     * It costs nothing in accuracy. A tile origin is a multiple of 2^levels, so
     * its block grid is the whole image's block grid, and a Haar stage never
     * reads outside its own block. The result is the same coefficients, not
     * approximately the same ones.
     */
    async analyzeDenoiseProxy(sessionId, lane, adjustments, longEdge, editRevision = 0, preset = {}, sourceIdentity = "source", controls = {}) {
      if (!this.available || !sessionId) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const geometrySignature = JSON.stringify(adjustments?.shared?.geometry || {});
      const original = await this.loadProxy(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity);
      if (!original) return false;
      if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) return false;
      const pipelines = await this.ensureDenoisePipelines();
      const settings = {
        name: "Photo / Fine",
        levels: 2,
        noiseThreshold: 3.0,
        lumaSigma: 0.035,
        chromaSigma: 0.035,
        lumaStrength: 1.0,
        chromaStrength: 1.25,
        ...preset,
      };
      if (!Number.isInteger(settings.levels) || settings.levels < 1 || settings.levels > 4) {
        throw new Error("Wavelet analysis supports one through four decimated scales.");
      }
      const startedAt = performance.now();
      this.denoiseCounters.analysisCalls += 1;
      this.recordStage("denoise-analysis", { state: "started", generation, longEdge });

      const tileSize = Math.max(64, Number(this.denoiseTileSize) || DENOISE_TILE_SIZE);
      const tiles = alignedDenoiseTiles(original.width, original.height, tileSize, settings.levels);
      const alignment = denoiseTileAlignment(settings.levels);
      const step = Math.ceil(tileSize / alignment) * alignment;
      // One scratch chain, sized to the largest tile, reused by every tile.
      // Passes in a command buffer execute in order with implicit barriers, so
      // reuse across tiles is safe without a fence per tile.
      const scratchChain = denoiseExtentChain(step, step, settings.levels);
      const scratch = [];
      const evidenceAllocated = [];
      const tileEvidence = [];
      let paramBuffer = null;
      let cacheInstalled = false;
      try {
        for (let index = 1; index <= settings.levels; index += 1) {
          scratch.push(this.createDenoiseTexture(
            scratchChain[index].width,
            scratchChain[index].height,
            `denoise-analysis-scratch-${index}`,
          ));
        }
        const slot = 256;
        paramBuffer = this.device.createBuffer({
          size: Math.max(slot, tiles.length * settings.levels * slot),
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const slots = new Float32Array((paramBuffer.size / 4));

        const encoder = this.device.createCommandEncoder();
        let dispatches = 0;
        tiles.forEach((tile, tileIndex) => {
          const chain = denoiseExtentChain(tile.width, tile.height, settings.levels);
          const levels = [];
          let source = original.texture;
          let originX = tile.x;
          let originY = tile.y;
          for (let index = 0; index < settings.levels; index += 1) {
            const valid = chain[index];
            const out = chain[index + 1];
            const evidence = ["h", "v", "d"].map((axis) =>
              this.createDenoiseTexture(out.width, out.height, `denoise-${axis}-${index}-${tile.key}`));
            evidenceAllocated.push(...evidence);
            const base = (tileIndex * settings.levels + index) * (slot / 4);
            const scale = 0.5 ** (index + 1);
            slots.set([
              settings.lumaSigma * scale * settings.lumaStrength,
              settings.chromaSigma * scale * settings.chromaStrength,
              settings.chromaSigma * scale * settings.chromaStrength,
              settings.noiseThreshold,
              out.width, out.height, originX, originY,
              valid.width, valid.height, 0, 0,
            ], base);
            const bindGroup = this.device.createBindGroup({
              layout: pipelines.analysis.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: source.createView() },
                { binding: 1, resource: scratch[index].texture.createView() },
                { binding: 2, resource: evidence[0].texture.createView() },
                { binding: 3, resource: evidence[1].texture.createView() },
                { binding: 4, resource: evidence[2].texture.createView() },
                { binding: 5, resource: { buffer: paramBuffer, offset: (tileIndex * settings.levels + index) * slot, size: 48 } },
              ],
            });
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipelines.analysis);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(out.width / 8), Math.ceil(out.height / 8));
            pass.end();
            dispatches += 1;
            levels.push({ evidence, width: out.width, height: out.height });
            source = scratch[index].texture;
            originX = 0;
            originY = 0;
          }
          tileEvidence.push({ tile, levels, chain });
        });
        this.device.queue.writeBuffer(paramBuffer, 0, slots);
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) {
          this.recordStage("denoise-analysis", { state: "stale", generation });
          return false;
        }

        const resolveChain = denoiseExtentChain(step, step, settings.levels);
        const resolveScratch = [];
        for (let index = 1; index < settings.levels; index += 1) {
          resolveScratch.push(this.createDenoiseTexture(
            resolveChain[index].width,
            resolveChain[index].height,
            `denoise-resolve-scratch-${index}`,
          ));
        }
        const previous = this.denoiseSourceSelector;
        const evidenceByteSize = evidenceAllocated.reduce((sum, item) => sum + item.byteSize, 0);
        const analysisScratchBytes = scratch.reduce((sum, item) => sum + item.byteSize, 0);
        const resolveScratchBytes = resolveScratch.reduce((sum, item) => sum + item.byteSize, 0);
        const cache = {
          algorithmVersion: DENOISE_ALGORITHM_VERSION,
          settings,
          identity: denoiseCacheIdentity(original.identity, settings),
          tileSize: step,
          tiles: tileEvidence,
          // Retained so the existing diagnostics keep reporting a per-level
          // view of the evidence even though it is now stored per tile.
          levels: Array.from({ length: settings.levels }, (_, index) => ({
            sourceWidth: denoiseExtentChain(original.width, original.height, settings.levels)[index].width,
            sourceHeight: denoiseExtentChain(original.width, original.height, settings.levels)[index].height,
            evidence: tileEvidence.flatMap((entry) => entry.levels[index].evidence),
          })),
          resolveScratch,
          resolveParamBuffer: null,
          byteSize: evidenceByteSize + resolveScratchBytes,
          textureCount: evidenceAllocated.length + resolveScratch.length,
        };
        this.denoiseSourceSelector = {
          identity: original.identity,
          original,
          resolved: null,
          selected: previous?.identity === original.identity ? previous.selected : "original",
          cache,
          generation,
        };
        cacheInstalled = true;
        this.destroyDenoiseSelector(previous);
        this.denoiseCounters.allocations += cache.textureCount;
        this.denoiseCounters.allocatedBytes += cache.byteSize;
        this.denoiseCounters.analysisDispatches += dispatches;
        this.denoiseCounters.analysisTiles += tiles.length;
        this.denoiseCounters.evidenceBytes = evidenceByteSize;
        this.denoiseCounters.analysisScratchBytes = analysisScratchBytes;
        this.denoiseCounters.resolveScratchBytes = resolveScratchBytes;
        this.recordAllocation("denoise-wavelet-cache", cache.byteSize, { textures: cache.textureCount, longEdge });
        this.recordStage("denoise-analysis", {
          state: "ready",
          generation,
          durationMs: performance.now() - startedAt,
          tiles: tiles.length,
          dispatches,
          evidenceBytes: evidenceByteSize,
          analysisScratchBytes,
        });
      } catch (error) {
        this.recordStage("denoise-analysis", { state: "error", generation, durationMs: performance.now() - startedAt });
        throw error;
      } finally {
        for (const item of scratch) item.texture.destroy();
        paramBuffer?.destroy();
        if (!cacheInstalled) {
          for (const item of evidenceAllocated) item.texture.destroy();
        }
      }
      return this.resolveDenoiseProxy({
        amount: controls.amount ?? 0.5,
        luminance: controls.luminance ?? 0.5,
        colorNoise: controls.colorNoise ?? controls.color_noise ?? 0.5,
        detailRecovery: controls.detailRecovery ?? controls.detail_recovery ?? 0.5,
      });
    }

    /**
     * Reconstruct from cached evidence. Runs no analysis, by construction:
     * nothing here touches the analysis pipeline, so a drag of any live control
     * cannot issue an analysis dispatch however often it fires.
     *
     * `region` reconstructs only part of the frame, which is what makes zoom
     * and pan cheap. It must start on the wavelet grid for the same reason a
     * tile must.
     */
    /**
     * Reconstruct the denoised picture from cached evidence.
     *
     * With no `destination` this fills the selector's whole-frame resolved
     * texture, which is what an interactive control drag wants: one texture the
     * renderer keeps binding as its source.
     *
     * With one, it fills a caller-owned texture that covers only `region`,
     * which is what tiled execution wants: the resolved picture is then bounded
     * by a tile rather than by the image, and the whole-frame resolved
     * texture -- 340 MB on a 42 MP frame -- is never allocated at all. The
     * reconstruction still reads the original at its true frame position, so
     * the result is the same pixels either way; only where they land differs.
     */
    async resolveDenoiseProxy(controls = {}, { region = null, destination = null, encoder: sharedEncoder = null } = {}) {
      const selector = this.denoiseSourceSelector;
      if (!selector?.cache || !selector.original) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const startedAt = performance.now();
      this.denoiseCounters.resolveCalls += 1;
      const weights = ["amount", "luminance", "colorNoise", "detailRecovery"].map((name) => {
        const value = Number(controls[name] ?? 0.5);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
        return value;
      });
      const pipelines = await this.ensureDenoisePipelines();
      const cache = selector.cache;
      const levelCount = cache.settings.levels;
      const alignment = denoiseTileAlignment(levelCount);
      if (region && ((region.x % alignment) || (region.y % alignment))) {
        throw new Error(`A denoise resolve region must start on the ${alignment}px wavelet grid.`);
      }
      const overlaps = (tile) => !region || (
        tile.x < region.x + region.width && tile.x + tile.width > region.x
        && tile.y < region.y + region.height && tile.y + tile.height > region.y
      );
      const active = cache.tiles.filter((entry) => overlaps(entry.tile));
      if (!active.length) return false;

    // Where the destination's own (0, 0) sits in frame coordinates. A
    // whole-frame destination is the identity.
      const destinationOrigin = destination
        ? { x: Math.max(0, Math.floor(region?.x || 0)), y: Math.max(0, Math.floor(region?.y || 0)) }
        : { x: 0, y: 0 };
      const candidateIsNew = !destination && !selector.resolved;
      const candidate = destination || selector.resolved
        || this.createDenoiseTexture(selector.original.width, selector.original.height, "denoise-resolved");
      let paramBuffer = null;
      try {
        const slot = 256;
        paramBuffer = this.device.createBuffer({
          size: Math.max(slot, active.length * Math.max(1, levelCount) * slot),
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const slots = new Float32Array(paramBuffer.size / 4);
        // A tiled generation is one submission, because that is what makes
        // replacement atomic. When the caller hands over its encoder, the
        // reconstruction joins that submission instead of making one of its
        // own, and the caller frees the parameter buffer after its own submit.
        const encoder = sharedEncoder || this.device.createCommandEncoder();
        let dispatches = 0;

        active.forEach((entry, entryIndex) => {
          const { tile, levels, chain } = entry;
          if (levelCount === 2) {
            const base = entryIndex * levelCount * (slot / 4);
            slots.set([
              ...weights, 0, 1, 0, 0, tile.width, tile.height, tile.x, tile.y,
              destinationOrigin.x, destinationOrigin.y, 0, 0,
            ], base);
            const fine = levels[0].evidence;
            const medium = levels[1].evidence;
            const bindGroup = this.device.createBindGroup({
              layout: pipelines.resolveTwoLevel.getBindGroupLayout(2),
              entries: [
                { binding: 0, resource: fine[0].texture.createView() },
                { binding: 1, resource: fine[1].texture.createView() },
                { binding: 2, resource: fine[2].texture.createView() },
                { binding: 3, resource: medium[0].texture.createView() },
                { binding: 4, resource: medium[1].texture.createView() },
                { binding: 5, resource: medium[2].texture.createView() },
                { binding: 6, resource: selector.original.texture.createView() },
                { binding: 7, resource: candidate.texture.createView() },
                { binding: 8, resource: { buffer: paramBuffer, offset: entryIndex * levelCount * slot, size: 64 } },
              ],
            });
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipelines.resolveTwoLevel);
            pass.setBindGroup(2, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(tile.width / 8), Math.ceil(tile.height / 8));
            pass.end();
            dispatches += 1;
            return;
          }
          let reconstructedLow = null;
          for (let index = levelCount - 1; index >= 0; index -= 1) {
            const finalPass = index === 0;
            const out = chain[index];
            const output = finalPass ? candidate : cache.resolveScratch[index - 1];
            const levelWeight = DENOISE_LEVEL_WEIGHTS[Math.min(index, DENOISE_LEVEL_WEIGHTS.length - 1)];
            const base = (entryIndex * levelCount + index) * (slot / 4);
            slots.set([
              weights[0] * levelWeight, weights[1], weights[2], weights[3],
              reconstructedLow ? 1 : 0, finalPass ? 1 : 0, 0, 0,
              out.width, out.height, finalPass ? tile.x : 0, finalPass ? tile.y : 0,
              // Only the final pass writes into the caller's destination. The
              // intermediate levels write into whole scratch textures of their
              // own and are already at their own origin.
              finalPass ? destinationOrigin.x : 0, finalPass ? destinationOrigin.y : 0, 0, 0,
            ], base);
            const dummyLow = reconstructedLow || levels[index].evidence[0];
            const bindGroup = this.device.createBindGroup({
              layout: pipelines.resolve.getBindGroupLayout(1),
              entries: [
                { binding: 0, resource: dummyLow.texture.createView() },
                { binding: 1, resource: levels[index].evidence[0].texture.createView() },
                { binding: 2, resource: levels[index].evidence[1].texture.createView() },
                { binding: 3, resource: levels[index].evidence[2].texture.createView() },
                { binding: 4, resource: selector.original.texture.createView() },
                { binding: 5, resource: output.texture.createView() },
                { binding: 6, resource: { buffer: paramBuffer, offset: (entryIndex * levelCount + index) * slot, size: 64 } },
              ],
            });
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipelines.resolve);
            pass.setBindGroup(1, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(out.width / 8), Math.ceil(out.height / 8));
            pass.end();
            dispatches += 1;
            reconstructedLow = output;
          }
        });

        this.device.queue.writeBuffer(paramBuffer, 0, slots);
        if (sharedEncoder) {
          this.denoiseCounters.resolveDispatches += dispatches;
          this.denoiseCounters.resolveTiles += active.length;
          const encoded = paramBuffer;
          paramBuffer = null;
          return { encoded: true, dispatches, tiles: active.length, paramBuffer: encoded };
        }
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        if (generation !== this.denoiseSelectorGeneration || selector !== this.denoiseSourceSelector) {
          if (candidateIsNew) candidate.texture.destroy();
          this.recordStage("denoise-resolve", { state: "stale", generation });
          return false;
        }
        if (candidateIsNew) {
          selector.resolved = {
            ...candidate,
            workingSpace: selector.original.workingSpace,
            pixelFormat: "rgba16float",
            geometrySignature: selector.original.geometrySignature,
            identity: selector.original.identity,
          };
        }
        // A bounded destination is the caller's own texture for one tile. It
        // is not the selector's resolved picture, so it does not become the
        // selected source and does not claim a resolved region: saying it did
        // would tell the renderer a whole frame is denoised when one tile is.
        if (destination) {
          this.denoiseCounters.resolveDispatches += dispatches;
          this.denoiseCounters.resolveTiles += active.length;
          this.recordStage("denoise-resolve", {
            state: "ready",
            generation,
            durationMs: performance.now() - startedAt,
            tiles: active.length,
            dispatches,
            region: `${region.x},${region.y},${region.width},${region.height}`,
            destination: "bounded",
          });
          return true;
        }
        // The swap is the last thing that happens, and only on success. A
        // half-finished reconstruction can never become the presented result.
        selector.selected = "resolved";
        selector.controls = {
          amount: weights[0],
          luminance: weights[1],
          colorNoise: weights[2],
          detailRecovery: weights[3],
        };
        // A region is honoured at tile granularity: a tile is the smallest unit
        // whose evidence indexing lines up, so the rectangle actually rewritten
        // is the union of the tiles the request touches. Report that rather
        // than the request, or a caller cannot tell what is now current.
        selector.resolvedRegion = region
          ? active.reduce((union, entry) => {
            const { tile } = entry;
            const x = Math.min(union.x, tile.x);
            const y = Math.min(union.y, tile.y);
            return {
              x,
              y,
              width: Math.max(union.x + union.width, tile.x + tile.width) - x,
              height: Math.max(union.y + union.height, tile.y + tile.height) - y,
            };
          }, { ...active[0].tile })
          : null;
        this.denoiseCounters.atomicSwaps += 1;
        this.denoiseCounters.resolveDispatches += dispatches;
        this.denoiseCounters.resolveTiles += active.length;
        if (candidateIsNew) {
          this.denoiseCounters.allocations += 1;
          this.denoiseCounters.allocatedBytes += candidate.byteSize;
          this.recordAllocation("denoise-resolved", candidate.byteSize, { generation });
        }
        this.recordStage("denoise-resolve", {
          state: "ready",
          generation,
          durationMs: performance.now() - startedAt,
          tiles: active.length,
          dispatches,
          region: region ? `${region.x},${region.y},${region.width},${region.height}` : "whole",
        });
        return true;
      } catch (error) {
        if (candidateIsNew) candidate.texture.destroy();
        this.recordStage("denoise-resolve", { state: "error", generation, durationMs: performance.now() - startedAt });
        throw error;
      } finally {
        paramBuffer?.destroy();
      }
    }

    async prepareDenoiseSelectorSeam(sessionId, lane, adjustments, longEdge, editRevision = 0, variant = "resolved-a", sourceIdentity = "source") {
      if (!this.available || !sessionId) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const geometrySignature = JSON.stringify(adjustments?.shared?.geometry || {});
      const original = await this.loadProxy(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity);
      if (!original) return false;
      if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) return false;
      const startedAt = performance.now();
      const texture = this.device.createTexture({
        size: { width: original.width, height: original.height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const byteSize = original.width * original.height * 8;
      this.denoiseCounters.allocations += 1;
      this.denoiseCounters.allocatedBytes += byteSize;
      this.recordAllocation("denoise-selector-fixture", byteSize, { width: original.width, height: original.height, variant });
      const colors = {
        "resolved-a": { r: 0, g: 0, b: 0, a: 1 },
        "resolved-b": { r: 4, g: 4, b: 4, a: 1 },
      };
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          clearValue: colors[variant] || colors["resolved-a"],
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) {
        texture.destroy();
        this.recordStage("selector-stale-candidate", { generation, variant });
        return false;
      }
      const previous = this.denoiseSourceSelector;
      this.denoiseSourceSelector = {
        identity: original.identity,
        original,
        resolved: {
          texture,
          width: original.width,
          height: original.height,
          workingSpace: original.workingSpace,
          pixelFormat: "rgba16float",
          geometrySignature: original.geometrySignature,
          identity: original.identity,
          byteSize,
        },
        selected: previous?.identity === original.identity ? previous.selected : "original",
        variant,
        generation,
      };
      this.destroyDenoiseSelector(previous);
      this.denoiseCounters.atomicSwaps += 1;
      this.recordStage("selector-atomic-swap", { generation, variant, durationMs: performance.now() - startedAt });
      return true;
    }

    selectDenoiseSelectorSource(enabled) {
      if (!this.denoiseSourceSelector) return false;
      this.denoiseSourceSelector.selected = enabled ? "resolved" : "original";
      this.denoiseCounters.toggles += 1;
      this.recordStage("selector-toggle", { source: this.denoiseSourceSelector.selected });
      return true;
    }

    cancelDenoiseProcessing({ selectOriginal = true } = {}) {
      const generation = ++this.denoiseSelectorGeneration;
      if (selectOriginal && this.denoiseSourceSelector) {
        this.denoiseSourceSelector.selected = "original";
      }
      this.recordStage("denoise-cancel", {
        generation,
        source: this.denoiseSourceSelector?.selected || "none",
      });
      return Boolean(this.denoiseSourceSelector);
    }

    async readDenoiseSelectorPixel() {
      const resolved = this.denoiseSourceSelector?.resolved;
      if (!resolved) return null;
      const buffer = this.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: resolved.texture },
        { buffer, bytesPerRow: 256, rowsPerImage: 1 },
        { width: 1, height: 1 },
      );
      this.device.queue.submit([encoder.finish()]);
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const values = new Uint16Array(buffer.getMappedRange());
        return [halfToFloat(values[0]), halfToFloat(values[1]), halfToFloat(values[2]), halfToFloat(values[3])];
      } finally {
        if (buffer.mapState === "mapped") buffer.unmap();
        buffer.destroy();
      }
    }

    // `x` and `y` let a caller read a window that straddles a denoise tile
    // boundary, which is where a seam would be if there were one.
    async readDenoiseResolvedRegion(width = 16, height = 16, x = 0, y = 0) {
      const resolved = this.denoiseSourceSelector?.resolved;
      if (!resolved) return null;
      const originX = Math.min(Math.max(0, Math.trunc(Number(x) || 0)), resolved.width - 1);
      const originY = Math.min(Math.max(0, Math.trunc(Number(y) || 0)), resolved.height - 1);
      const copyWidth = Math.min(Math.max(1, Number(width) || 1), resolved.width - originX);
      const copyHeight = Math.min(Math.max(1, Number(height) || 1), resolved.height - originY);
      const bytesPerRow = Math.ceil((copyWidth * 8) / 256) * 256;
      const buffer = this.device.createBuffer({
        size: bytesPerRow * copyHeight,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: resolved.texture, origin: { x: originX, y: originY, z: 0 } },
        { buffer, bytesPerRow, rowsPerImage: copyHeight },
        { width: copyWidth, height: copyHeight },
      );
      this.device.queue.submit([encoder.finish()]);
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint16Array(buffer.getMappedRange());
        const stride = bytesPerRow / 2;
        const values = [];
        for (let y = 0; y < copyHeight; y += 1) {
          for (let x = 0; x < copyWidth * 4; x += 1) values.push(halfToFloat(source[y * stride + x]));
        }
        return { width: copyWidth, height: copyHeight, x: originX, y: originY, values };
      } finally {
        if (buffer.mapState === "mapped") buffer.unmap();
        buffer.destroy();
      }
    }

    disposeDenoiseSelectorSeam() {
      this.denoiseSelectorGeneration += 1;
      const selector = this.denoiseSourceSelector;
      this.denoiseSourceSelector = null;
      this.destroyAfterActiveRenders(() => this.destroyDenoiseSelector(selector));
      this.denoiseCounters = this.emptyDenoiseCounters();
    }

    evictDenoiseCache() {
      this.denoiseSelectorGeneration += 1;
      const selector = this.denoiseSourceSelector;
      this.denoiseSourceSelector = null;
      this.destroyAfterActiveRenders(() => this.destroyDenoiseSelector(selector));
      this.recordStage("denoise-cache-evicted", {});
    }

    destroyDenoiseSelector(selector) {
      if (!selector) return;
      selector.resolved?.texture?.destroy();
      for (const level of selector.cache?.levels || []) {
        for (const item of level.evidence || []) item.texture?.destroy();
      }
      for (const item of selector.cache?.resolveScratch || []) item.texture?.destroy();
      for (const buffer of selector.cache?.resolveParamBuffers || []) buffer.destroy();
    }

    async analyzeScope(canvas, { width = 256, height = 128, generation = 0, tier = "interactive" } = {}) {
      if (!this.available) return null;
      const source = this.scopeSources.get(canvas);
      if (!source) return null;
      const resource = this.acquireScopeResource(width, height);
      if (!resource) return null;
      const startedAt = performance.now();
      resource.busy = true;
      this.activeScopeCount += 1;
      const params = new Float32Array(source.params);
      params[136] = width;
      params[137] = height;
      this.device.queue.writeBuffer(resource.paramBuffer, 0, params);
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: source.filmTexture.createView() },
          { binding: 1, resource: { buffer: resource.paramBuffer } },
          { binding: 2, resource: { buffer: this.curveBuffer } },
          { binding: 3, resource: source.spatialTexture.createView() },
          { binding: 4, resource: this.spatialSampler },
          { binding: 5, resource: source.spatialTexture.createView() },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: resource.texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(tier === "interactive" ? this.scopePipeline : this.settledScopePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: resource.texture },
        { buffer: resource.readBuffer, bytesPerRow: resource.bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const encodedAt = performance.now();
      this.device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      try {
        await resource.readBuffer.mapAsync(GPUMapMode.READ);
        if (this.scopeSources.get(canvas) !== source) return null;
        const mappedAt = performance.now();
        const sourceBytes = new Uint16Array(resource.readBuffer.getMappedRange());
        const rowStride = resource.bytesPerRow / 2;
        const pixels = new Float32Array(width * height * 3);
        const cellPeaks = new Float32Array(width * height);
        let targetIndex = 0;
        let peakIndex = 0;
        for (let row = 0; row < height; row += 1) {
          let sourceIndex = row * rowStride;
          for (let column = 0; column < width; column += 1) {
            pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex]);
            pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex + 1]);
            pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex + 2]);
            cellPeaks[peakIndex++] = halfToFloat(sourceBytes[sourceIndex + 3]);
            sourceIndex += 4;
          }
        }
        const completedAt = performance.now();
        const metric = {
          generation,
          tier,
          lane: source.lane,
          sourceSerial: source.serial,
          applicationGeneration: source.applicationGeneration,
          geometrySignature: source.geometrySignature,
          width,
          height,
          encodeMs: encodedAt - startedAt,
          submitMs: submittedAt - encodedAt,
          mapReadbackMs: mappedAt - submittedAt,
          unpackMs: completedAt - mappedAt,
          totalMs: completedAt - startedAt,
          byteLength: resource.bytesPerRow * height,
        };
        if (this.instrumentationEnabled) {
          this.performanceMetrics.scopes.push(metric);
          if (this.performanceMetrics.scopes.length > 240) this.performanceMetrics.scopes.shift();
          this.recordStage("scopes", { ...metric });
        }
        return {
          pixels,
          cellPeaks,
          width,
          height,
          lane: source.lane,
          sourceSerial: source.serial,
          applicationGeneration: source.applicationGeneration,
          geometrySignature: source.geometrySignature,
          sessionId: source.sessionId,
          metric,
        };
      } catch {
        return null;
      } finally {
        if (resource.readBuffer.mapState === "mapped") resource.readBuffer.unmap();
        resource.busy = false;
        this.activeScopeCount = Math.max(0, this.activeScopeCount - 1);
        this.flushDeferredDestroy();
      }
    }

    acquireScopeResource(width, height) {
      const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
      const key = `${width}x${height}`;
      let pool = this.scopeResources.get(key);
      if (!pool) {
        pool = [];
        this.scopeResources.set(key, pool);
      }
      const available = pool.find((resource) => !resource.busy && resource.readBuffer.mapState === "unmapped");
      if (available) return available;
      if (pool.length >= 2) return null;
      const resource = {
        busy: false,
        bytesPerRow,
        byteSize: width * height * 8 + bytesPerRow * height + PARAM_COUNT * 4,
        texture: this.device.createTexture({
          size: { width, height },
          format: "rgba16float",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        }),
        readBuffer: this.device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        paramBuffer: this.device.createBuffer({
          size: PARAM_COUNT * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
      };
      pool.push(resource);
      this.recordAllocation("scope", width * height * 8 + bytesPerRow * height + PARAM_COUNT * 4, { width, height });
      return resource;
    }

    createGpuTimingResources() {
      const querySet = this.device.createQuerySet({ type: "timestamp", count: 2 });
      const resolveBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      const readBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      return { querySet, resolveBuffer, readBuffer };
    }

    collectGpuTiming(resources, metric) {
      void resources.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const timestamps = new BigUint64Array(resources.readBuffer.getMappedRange());
        metric.gpuMs = Number(timestamps[1] - timestamps[0]) / 1e6;
        resources.readBuffer.unmap();
      }).catch(() => null).finally(() => {
        resources.querySet.destroy();
        resources.resolveBuffer.destroy();
        resources.readBuffer.destroy();
      });
    }

    configureSurface(canvas, context, wantsHdr) {
      const hdrDisplay = Boolean(window.matchMedia?.("(dynamic-range: high)").matches);
      if (wantsHdr && hdrDisplay) {
        try {
          const format = "rgba16float";
          const key = `${format}:display-p3:extended:${canvas.width}x${canvas.height}`;
          if (this.surfaceKeys.get(canvas) !== key) {
            context.configure({
              device: this.device,
              format,
              colorSpace: "display-p3",
              toneMapping: { mode: "extended" },
              alphaMode: "opaque",
            });
            this.surfaceKeys.set(canvas, key);
          }
          return { format, hdr: true };
        } catch {
          // Older WebGPU implementations still provide a fast SDR draft.
        }
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      const key = `${format}:srgb:standard:${canvas.width}x${canvas.height}`;
      if (this.surfaceKeys.get(canvas) !== key) {
        context.configure({ device: this.device, format, colorSpace: "srgb", alphaMode: "opaque" });
        this.surfaceKeys.set(canvas, key);
      }
      return { format, hdr: false };
    }

    createMaskPipeline(entryPoint) {
      return this.device.createRenderPipeline({
        layout: this.maskPipelineLayout,
        vertex: { module: this.maskModule, entryPoint: "vertexMain" },
        fragment: { module: this.maskModule, entryPoint, targets: [{ format: "r16float" }] },
        primitive: { topology: "triangle-list" },
      });
    }

    pipelineFor(format) {
      if (this.pipelines.has(format)) return this.pipelines.get(format);
      const base = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "baseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const response = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "filmResponseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const local = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localAdjustmentFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localCandidate = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localCandidateFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailHorizontal = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailVertical = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailComposite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailCompositeFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailMix = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailMixFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailHorizontal = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailVertical = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailComposite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailCompositeFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const extract = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialExtractFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurHorizontal = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurVertical = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const finish = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "finishFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const composite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      // Max blending is what lets every tile accumulate into one grid without
      // a readback each. `one`/`one` with operation `max` is a plain maximum:
      // the factors are ignored for min and max operations.
      const scopePeakTile = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: {
          module: this.module,
          entryPoint: "scopePeakTileFragmentMain",
          targets: [{
            format: "rgba16float",
            blend: {
              color: { operation: "max", srcFactor: "one", dstFactor: "one" },
              alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });
      const pipelines = {
        base,
        finish,
        scopePeakTile,
        local,
        localCandidate,
        localDetailHorizontal,
        localDetailVertical,
        localDetailComposite,
        localDetailMix,
        detailHorizontal,
        detailVertical,
        detailComposite,
        response,
        extract,
        blurHorizontal,
        blurVertical,
        composite,
      };
      this.pipelines.set(format, pipelines);
      return pipelines;
    }

    ensureIntermediate(canvas, width, height, spatialActive = false, detailActive = false) {
      const current = this.intermediates.get(canvas);
      const spatialWidth = Math.max(1, Math.ceil(width / 4));
      const spatialHeight = Math.max(1, Math.ceil(height / 4));
      const createSpatialTexture = () => this.device.createTexture({
        size: { width: spatialWidth, height: spatialHeight },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const createTexture = () => this.device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      // PRD 4.3: an allocation failure records a durable backoff. This render
      // retains the last valid presentation; the next plan selects Tiled. The
      // selected preview resolution is never reduced.
      const guard = (create, kind) => {
        try {
          return create();
        } catch (error) {
          this.recordAllocationFailure(kind, error, { width, height });
          throw error;
        }
      };
      if (current?.width === width && current?.height === height) {
        if (spatialActive && (!current.spatialATexture || !current.spatialBTexture)) {
          try {
            current.spatialATexture = guard(createSpatialTexture, "spatial-a");
            current.spatialBTexture = guard(createSpatialTexture, "spatial-b");
          } catch {
            return null;
          }
          this.recordAllocation(
            "grading-spatial-intermediates",
            spatialWidth * spatialHeight * 8 * 2,
            { width, height, spatialWidth, spatialHeight },
          );
        }
        if (detailActive && (!current.detailATexture || !current.detailBTexture)) {
          try {
            current.detailATexture = guard(createTexture, "grading-detail-a");
            current.detailBTexture = guard(createTexture, "grading-detail-b");
          } catch {
            return null;
          }
          this.recordAllocation("grading-detail-intermediates", width * height * 8 * 2, { width, height });
        }
        // Retain spatial textures after first use. Bypass toggles and non-spatial
        // slider edits can then reuse every 4K intermediate instead of destroying
        // and reallocating the full render set.
        current.spatialActive = spatialActive;
        return current;
      }
      current?.baseTexture?.destroy();
      current?.filmTexture?.destroy();
      current?.finishTexture?.destroy();
      current?.spatialATexture?.destroy();
      current?.spatialBTexture?.destroy();
      current?.localTexture?.destroy();
      current?.detailATexture?.destroy();
      current?.detailBTexture?.destroy();
      current?.compositeParamBuffer?.destroy();
      let intermediate;
      try {
        intermediate = {
          baseTexture: guard(createTexture, "grading-base"),
          filmTexture: guard(createTexture, "grading-film"),
          // Film Look, Vignette and grain resolve here so the output limiter can
          // measure the finished picture instead of predicting it, and so the
          // scope pass reads that result instead of computing it a second time.
          finishTexture: guard(createTexture, "grading-finish"),
          localTexture: guard(createTexture, "grading-local"),
          detailATexture: detailActive ? guard(createTexture, "grading-detail-a") : null,
          detailBTexture: detailActive ? guard(createTexture, "grading-detail-b") : null,
          spatialATexture: spatialActive ? guard(createSpatialTexture, "spatial-a") : null,
          spatialBTexture: spatialActive ? guard(createSpatialTexture, "spatial-b") : null,
          spatialActive,
          width,
          height,
        };
      } catch {
        // The backoff is already recorded. Returning null abandons this render
        // and leaves the previous accepted presentation on screen.
        return null;
      }
      this.intermediates.set(canvas, intermediate);
      this.recordAllocation(
        "grading-intermediates",
        width * height * 8 * (4 + (detailActive ? 2 : 0)) + (spatialActive ? spatialWidth * spatialHeight * 8 * 2 : 0),
        { width, height, spatialWidth: spatialActive ? spatialWidth : 0, spatialHeight: spatialActive ? spatialHeight : 0 },
      );
      return intermediate;
    }

    ensureStorageBuffers(paramBytes, curveBytes) {
      if (!this.paramBuffer) {
        this.paramBuffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(paramBytes / 4) * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      if (!this.curveBuffer) {
        this.curveBuffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(curveBytes / 4) * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
    }

    trimProxyLevels(sessionId, lane) {
      const prefix = `${sessionId}:${lane}:`;
      const keys = [...this.proxies.keys()].filter((key) => key.startsWith(prefix));
      while (keys.length > 2) {
        const key = keys.shift();
        const proxy = this.proxies.get(key);
        this.destroyAfterActiveRenders(() => proxy?.texture?.destroy());
        this.proxies.delete(key);
      }
    }

    createStorageBuffer(values) {
      const size = Math.max(16, Math.ceil(values.byteLength / 4) * 4);
      return this.device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    async ensurePeakReductionPipeline(entryPoint = "peakReductionMain") {
      this.peakReductionPipelines = this.peakReductionPipelines || new Map();
      const existing = this.peakReductionPipelines.get(entryPoint);
      if (existing) return existing;
      if (!this.peakReductionModule) {
        const module = this.device.createShaderModule({ code: PEAK_REDUCTION_SHADER_SOURCE });
        const compilation = await module.getCompilationInfo();
        const errors = compilation.messages.filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
        this.peakReductionModule = module;
      }
      const pipeline = await this.device.createComputePipelineAsync({
        layout: "auto",
        compute: { module: this.peakReductionModule, entryPoint },
      });
      this.peakReductionPipelines.set(entryPoint, pipeline);
      return pipeline;
    }

    async measureToneAdjustedPeak(sourceProxy, params, measurement, cacheKey) {
      const cached = this.peakReductionCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const pipeline = await this.ensurePeakReductionPipeline();
      return this.runPeakReduction(
        pipeline, sourceProxy.texture, sourceProxy.width, sourceProxy.height, params, measurement, cacheKey,
      );
    }

    async runPeakReduction(pipeline, texture, width, height, params, measurement, cacheKey) {
      const valueCount = 1 + PEAK_HISTOGRAM_BINS;
      const byteSize = valueCount * 4;
      const resultBuffer = this.device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const readBuffer = this.device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const parameterBuffer = this.createStorageBuffer(params);
      this.device.queue.writeBuffer(resultBuffer, 0, new Uint32Array(valueCount));
      this.device.queue.writeBuffer(parameterBuffer, 0, params);
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: { buffer: parameterBuffer } },
          { binding: 2, resource: { buffer: resultBuffer } },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      encoder.copyBufferToBuffer(resultBuffer, 0, readBuffer, 0, byteSize);
      this.device.queue.submit([encoder.finish()]);
      try {
        await readBuffer.mapAsync(GPUMapMode.READ);
        const values = new Uint32Array(readBuffer.getMappedRange());
        let peak = new Float32Array(new Uint32Array([values[0]]).buffer)[0];
        if (measurement === "robust") {
          const population = width * height;
          const threshold = Math.max(1, Math.ceil(population * 0.9999));
          let cumulative = 0;
          for (let index = 0; index < PEAK_HISTOGRAM_BINS; index += 1) {
            cumulative += values[index + 1];
            if (cumulative >= threshold) {
              // Use the upper edge so the robust anchor remains conservative
              // rather than undershooting the selected percentile.
              peak = 2 ** (-32 + (index + 1) * 64 / PEAK_HISTOGRAM_BINS);
              break;
            }
          }
        }
        const measured = Math.max(0.0018, Number.isFinite(peak) ? peak : 0.0018);
        this.peakReductionCache.set(cacheKey, measured);
        while (this.peakReductionCache.size > 32) this.peakReductionCache.delete(this.peakReductionCache.keys().next().value);
        return measured;
      } finally {
        if (readBuffer.mapState === "mapped") readBuffer.unmap();
        resultBuffer.destroy();
        readBuffer.destroy();
        parameterBuffer.destroy();
      }
    }

    /**
     * Fill a Direct source texture from bounded tile responses.
     *
     * PRD 5.4: for Direct execution the renderer may allocate a full source
     * texture but fill it incrementally, so the browser never needs a single
     * image-sized response buffer. Chunks are full-width row strips, which
     * keeps each response's row pitch identical to the whole-frame case and
     * makes the assembled texture what the whole-frame path would have written.
     *
     * Returns null when the backend declines the tile route, so the caller can
     * fall back to the whole-frame request rather than failing the render.
     */
    async loadProxyStreamed(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key) {
      const startedAt = performance.now();
      const query = (rect) => `/api/session/${sessionId}/source-tile/${lane}`
        + `?long_edge=${longEdge}&format=rgba16f&edit_revision=${editRevision}`
        + `&geometry_signature=${encodeURIComponent(geometrySignature)}`
        + `&x=${rect.x}&y=${rect.y}&width=${rect.width}&height=${rect.height}`
        + (rect.epoch === undefined ? "" : `&source_epoch=${rect.epoch}`);

      const probe = await fetch(query({ x: 0, y: 0, width: 1, height: 1 }));
      if (!probe.ok) {
        // 409 here means this geometry cannot be served as tiles, or the
        // request is already stale. Either way the caller decides what next.
        await probe.arrayBuffer().catch(() => null);
        return null;
      }
      const width = Number(probe.headers.get("X-Output-Width"));
      const height = Number(probe.headers.get("X-Output-Height"));
      const pixelFormat = probe.headers.get("X-Pixel-Format") || "rgba16float";
      const workingSpace = probe.headers.get("X-Working-Space") || "acescg";
      const acceptedGeometry = probe.headers.get("X-Geometry-Signature") || "{}";
      const sourceEpoch = Number(probe.headers.get("X-Source-Epoch"));
      await probe.arrayBuffer().catch(() => null);
      if (!(width > 0 && height > 0)) return null;
      if (acceptedGeometry !== geometrySignature) {
        const error = new Error("Stale WebGPU geometry tile rejected");
        error.recoverable = true;
        throw error;
      }

      const bytesPerPixel = pixelFormat === "rgba16float" ? 8 : 16;
      let texture;
      try {
        texture = this.device.createTexture({
          size: { width, height },
          format: pixelFormat,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
        });
      } catch (error) {
        this.recordAllocationFailure("source-proxy", error, { width, height });
        throw error;
      }

      const rowBytes = Math.max(1, width * bytesPerPixel);
      const rowsPerChunk = Math.max(1, Math.min(height, Math.floor(this.maxSourceChunkBytes / rowBytes)));
      let transferredBytes = 0;
      let firstTileMs = null;
      let chunkCount = 0;
      try {
        for (let top = 0; top < height; top += rowsPerChunk) {
          const rows = Math.min(rowsPerChunk, height - top);
          const response = await fetch(query({ x: 0, y: top, width, height: rows, epoch: sourceEpoch }));
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            const error = new Error(payload?.detail || "A source tile could not be loaded");
            // A stale source or geometry mid-stream is recoverable: the caller
            // keeps the previous presentation and a newer request supersedes.
            error.recoverable = response.status === 409;
            error.status = response.status;
            throw error;
          }
          const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
          const data = await response.arrayBuffer();
          if (firstTileMs === null) firstTileMs = performance.now() - startedAt;
          transferredBytes += data.byteLength;
          chunkCount += 1;
          // queue.writeTexture lets Chromium accumulate every chunk in one
          // Dawn dynamic-uploader buffer until the eventual render submit. At
          // 42 MP that silently reconstructs an image-sized staging allocation
          // and exceeds WebGPU's default 256 MiB maxBufferSize. Give each chunk
          // its own mapped COPY_SRC buffer and finish that copy before moving
          // on. Source preparation may use multiple submissions; the finished
          // canvas generation is still one atomic render submission.
          const staging = this.device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
            mappedAtCreation: true,
          });
          try {
            new Uint8Array(staging.getMappedRange()).set(new Uint8Array(data));
            staging.unmap();
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToTexture(
              { buffer: staging, offset: 0, bytesPerRow, rowsPerImage: rows },
              { texture, origin: { x: 0, y: top } },
              { width, height: rows },
            );
            this.device.queue.submit([encoder.finish()]);
            await this.device.queue.onSubmittedWorkDone();
          } finally {
            staging.destroy();
          }
        }
      } catch (error) {
        this.destroyAfterActiveRenders(() => texture.destroy());
        throw error;
      }

      const byteSize = width * height * bytesPerPixel;
      const proxy = {
        texture,
        width,
        height,
        sessionId,
        lane,
        longEdge,
        workingSpace,
        pixelFormat,
        geometrySignature,
        sourceIdentity,
        identity: key,
        byteSize,
        streamed: true,
        bindGroups: new Map(),
      };
      this.proxies.set(key, proxy);
      this.sourceTransportMetrics = {
        route: "tiled",
        width,
        height,
        chunkCount,
        rowsPerChunk,
        transferredBytes,
        // The peak response buffer, which is the figure the exit gate is about.
        largestResponseBytes: Math.min(this.maxSourceChunkBytes, rowBytes * rowsPerChunk),
        timeToFirstTileMs: firstTileMs,
        totalMs: performance.now() - startedAt,
      };
      this.recordAllocation("source-proxy", byteSize, { width, height, lane, longEdge, pixelFormat, streamed: true });
      this.recordStage("proxy-request", {
        lane,
        longEdge,
        cacheHit: false,
        route: "tiled",
        chunkCount,
        durationMs: this.sourceTransportMetrics.totalMs,
        timeToFirstTileMs: firstTileMs,
        bytes: transferredBytes,
      });
      this.trimProxyLevels(sessionId, lane);
      return proxy;
    }

    async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", editRevision = 0, sourceIdentity = "source") {
      const key = `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}`;
      if (this.proxies.has(key)) {
        this.recordStage("proxy-request", { lane, longEdge, cacheHit: true });
        return this.proxies.get(key);
      }
      if (this.proxyInflight.has(key)) return this.proxyInflight.get(key);
      const pending = (async () => {
        const startedAt = performance.now();
        // A whole-frame response above the chunk budget is exactly the
        // image-sized browser buffer this sprint removes. Try tiles first; the
        // tile route returns null when the backend cannot serve this geometry.
        if (longEdge * longEdge * 8 > this.maxSourceChunkBytes) {
          const streamed = await this.loadProxyStreamed(
            sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key,
          );
          if (streamed) return streamed;
        }
        const response = await fetch(`/api/session/${sessionId}/proxy/${lane}?long_edge=${longEdge}&format=rgba16f&edit_revision=${editRevision}&geometry_signature=${encodeURIComponent(geometrySignature)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = new Error(payload?.detail || (response.status === 409
            ? "WebGPU geometry proxy is waiting for the committed edit"
            : "WebGPU proxy could not be loaded"));
          error.recoverable = response.status === 409 || response.status === 507;
          error.previewCapacity = response.status === 507;
          error.status = response.status;
          throw error;
        }
        const width = Number(response.headers.get("X-Image-Width"));
        const height = Number(response.headers.get("X-Image-Height"));
        const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
        const workingSpace = response.headers.get("X-Working-Space") || "acescg";
        const pixelFormat = response.headers.get("X-Pixel-Format") || "rgba32float";
        const acceptedGeometry = response.headers.get("X-Geometry-Signature") || "{}";
        const data = await response.arrayBuffer();
        if (acceptedGeometry !== geometrySignature) {
          const error = new Error("Stale WebGPU geometry proxy rejected");
          error.recoverable = true;
          throw error;
        }
        const texture = this.device.createTexture({
          size: { width, height },
          format: pixelFormat,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
        });
        this.device.queue.writeTexture(
          { texture },
          data,
          { offset: 0, bytesPerRow, rowsPerImage: height },
          { width, height },
        );
        const byteSize = width * height * (pixelFormat === "rgba16float" ? 8 : 16);
        const proxy = {
          texture,
          width,
          height,
          sessionId,
          lane,
          longEdge,
          workingSpace,
          pixelFormat,
          geometrySignature,
          sourceIdentity,
          identity: key,
          byteSize,
          bindGroups: new Map(),
        };
        this.proxies.set(key, proxy);
        this.recordAllocation("source-proxy", byteSize, { width, height, lane, longEdge, pixelFormat });
        this.sourceTransportMetrics = {
          route: "whole-frame",
          width,
          height,
          chunkCount: 1,
          transferredBytes: data.byteLength,
          largestResponseBytes: data.byteLength,
          timeToFirstTileMs: performance.now() - startedAt,
          totalMs: performance.now() - startedAt,
        };
        this.recordStage("proxy-request", {
          lane,
          longEdge,
          cacheHit: false,
          route: "whole-frame",
          durationMs: performance.now() - startedAt,
          bytes: data.byteLength,
        });
        this.trimProxyLevels(sessionId, lane);
        return proxy;
      })();
      this.proxyInflight.set(key, pending);
      try {
        return await pending;
      } finally {
        this.proxyInflight.delete(key);
      }
    }

    async loadLocalMask(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      if (local.mask?.operator !== "leaf") {
        return this.loadGpuMaskGraph(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent);
      }
      return this.loadMaskLeaf(sessionId, local, local.mask, "", longEdge, editRevision, geometrySignature, isCurrent);
    }

    async loadMaskLeaf(sessionId, local, expression, maskPath, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      const leafLocal = { ...local, id: maskPath ? `${local.id}:${maskPath}` : local.id, mask: expression };
      if (isGpuLumaMask(expression)) return this.loadGpuLumaMask(sessionId, leafLocal, longEdge, editRevision, geometrySignature, isCurrent);
      const maskSignature = gpuMaskIdentity(expression);
      const key = `${sessionId}:${longEdge}:${geometrySignature}:cpu-spatial-leaf:${maskSignature}`;
      const cached = this.localMasks.get(key);
      if (cached) {
        this.localMasks.delete(key);
        this.localMasks.set(key, cached);
        return cached;
      }
      const pathQuery = maskPath ? `&mask_path=${encodeURIComponent(maskPath)}` : "";
      const startedAt = performance.now();
      const response = await fetch(`/api/session/${sessionId}/local-mask/${encodeURIComponent(local.id)}?long_edge=${longEdge}&edit_revision=${editRevision}&geometry_signature=${encodeURIComponent(geometrySignature)}&spatial_only=true${pathQuery}`);
      if (!response.ok) return null;
      if (response.headers.get("X-Geometry-Signature") !== geometrySignature) return null;
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const source = new Uint8Array(await response.arrayBuffer());
      if (!isCurrent()) return null;
      const bytesPerRow = Math.ceil(width / 256) * 256;
      const padded = bytesPerRow === width ? source : new Uint8Array(bytesPerRow * height);
      if (padded !== source) {
        for (let row = 0; row < height; row += 1) padded.set(source.subarray(row * width, (row + 1) * width), row * bytesPerRow);
      }
      const texture = this.device.createTexture({
        size: { width, height },
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture },
        padded,
        { bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const entry = { kind: "cpu-spatial-leaf", texture, width, height, byteSize: width * height };
      this.localMasks.set(key, entry);
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024);
      if (this.instrumentationEnabled) {
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({
          kind: "cpu-spatial-leaf",
          maskPath: maskPath || "root",
          longEdge,
          width,
          height,
          cpuMaskMs: Number(response.headers.get("X-CPU-Mask-Ms")) || null,
          requestMs: performance.now() - startedAt,
          cpuMaskRequest: true,
        });
      }
      return entry;
    }

    async loadGpuMaskGraph(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      const startedAt = performance.now();
      const layoutIdentity = gpuMaskGraphLayoutIdentity(local.mask);
      const key = `${sessionId}:${local.id}:${longEdge}:${geometrySignature}:gpu-mask-graph:${layoutIdentity}`;
      let entry = this.localMasks.get(key);
      const influenceIdentity = JSON.stringify(gpuMaskRenderPayload(local.mask));
      if (entry?.influenceIdentity === influenceIdentity) {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
        return entry;
      }

      const resolveNode = async (expression, path) => {
        if (expression.operator === "leaf") {
          const leafEntry = await this.loadMaskLeaf(sessionId, local, expression, path, longEdge, editRevision, geometrySignature, isCurrent);
          return leafEntry ? { expression, leafEntry, children: [] } : null;
        }
        if (expression.enabled === false) {
          const child = expression.children?.[0];
          return child ? resolveNode(child, path ? `${path}.0` : "0") : null;
        }
        const activeChildren = expression.children
          .map((child, index) => ({ child, index }))
          .filter(({ child }) => child.enabled !== false);
        const children = await Promise.all(activeChildren.map(({ child, index }) =>
          resolveNode(child, path ? `${path}.${index}` : String(index))));
        return children.some((child) => !child) ? null : { expression, children };
      };
      const resolved = await resolveNode(local.mask, "");
      if (!resolved || !isCurrent()) return null;
      if (resolved.leafEntry) return resolved.leafEntry;

      const firstLeaf = firstResolvedMaskLeaf(resolved);
      const passCount = gpuMaskGraphPassCount(local.mask);
      if (!entry || entry.width !== firstLeaf.width || entry.height !== firstLeaf.height || entry.nodeTextures.length !== passCount) {
        if (entry) this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(entry));
        const nodeTextures = Array.from({ length: passCount }, () => this.createMaskTexture(firstLeaf.width, firstLeaf.height));
        entry = {
          kind: "gpu-mask-graph",
          texture: nodeTextures.at(-1),
          nodeTextures,
          width: firstLeaf.width,
          height: firstLeaf.height,
          byteSize: firstLeaf.width * firstLeaf.height * 2 * passCount,
          influenceIdentity: null,
        };
      }

      const encoder = this.device.createCommandEncoder();
      const parameterBuffers = [];
      let textureIndex = 0;
      const encodeNode = (node) => {
        if (node.expression.operator === "leaf") {
          return {
            texture: node.leafEntry.texture,
            opacity: Math.min(1, Math.max(0, Number(node.expression.leaf?.mask_opacity ?? 1))),
          };
        }
        let result = encodeNode(node.children[0]);
        for (let childIndex = 1; childIndex < node.children.length; childIndex += 1) {
          const right = encodeNode(node.children[childIndex]);
          const target = entry.nodeTextures[textureIndex++];
          const finalChild = childIndex === node.children.length - 1;
          const values = new Float32Array([
            gpuMaskOperatorCode(node.expression.operator),
            result.opacity,
            right.opacity,
            finalChild && node.expression.inverted ? 1 : 0,
          ]);
          const parameterBuffer = this.createStorageBuffer(values);
          parameterBuffers.push(parameterBuffer);
          this.device.queue.writeBuffer(parameterBuffer, 0, values);
          this.encodeMaskPass(
            encoder,
            this.maskPipelines.combine,
            this.createMaskBindGroup(result.texture, parameterBuffer, right.texture),
            target,
          );
          result = { texture: target, opacity: 1 };
        }
        return result;
      };
      const result = encodeNode(resolved);
      entry.texture = result.texture;
      entry.influenceIdentity = influenceIdentity;
      this.device.queue.submit([encoder.finish()]);
      parameterBuffers.forEach((buffer) => buffer.destroy());
      this.localMasks.set(key, entry);
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024);
      if (this.instrumentationEnabled) {
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({
          kind: "gpu-mask-graph",
          longEdge,
          width: entry.width,
          height: entry.height,
          passCount,
          encodeSubmitMs: performance.now() - startedAt,
          cpuMaskRequest: false,
        });
      }
      return entry;
    }

    async loadSceneLuminance(sessionId, longEdge, editRevision, geometrySignature) {
      const key = `${sessionId}:${longEdge}:${geometrySignature}`;
      const cached = this.sceneLuminance.get(key);
      if (cached) return { ...cached, created: false };
      if (this.sceneLuminanceInflight.has(key)) return this.sceneLuminanceInflight.get(key);
      const pending = (async () => {
        const source = await this.loadProxy(sessionId, "hdr", longEdge, geometrySignature, editRevision);
        const texture = this.createMaskTexture(source.width, source.height);
        const params = this.createStorageBuffer(new Float32Array(4));
        this.device.queue.writeBuffer(params, 0, new Float32Array(4));
        const bindGroup = this.createMaskBindGroup(source.texture, params);
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(encoder, this.maskPipelines.sceneLuminance, bindGroup, texture);
        this.device.queue.submit([encoder.finish()]);
        params.destroy();
        const entry = {
          texture,
          width: source.width,
          height: source.height,
          byteSize: source.width * source.height * 2,
        };
        this.sceneLuminance.set(key, entry);
        const prefix = `${sessionId}:`;
        const keys = [...this.sceneLuminance.keys()].filter((candidate) => candidate.startsWith(prefix));
        while (keys.length > 2) {
          const staleKey = keys.shift();
          const stale = this.sceneLuminance.get(staleKey);
          this.destroyAfterActiveRenders(() => stale?.texture?.destroy());
          this.sceneLuminance.delete(staleKey);
        }
        return { ...entry, created: true };
      })();
      this.sceneLuminanceInflight.set(key, pending);
      try {
        return await pending;
      } finally {
        this.sceneLuminanceInflight.delete(key);
      }
    }

    async loadGpuLumaMask(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      const startedAt = performance.now();
      const scene = await this.loadSceneLuminance(sessionId, longEdge, editRevision, geometrySignature);
      if (!isCurrent()) return null;
      const baseSignature = gpuLumaBaseIdentity(local.mask);
      const key = `${sessionId}:${longEdge}:${geometrySignature}:gpu-luma:${baseSignature}`;
      let entry = this.localMasks.get(key);
      let baseRegenerated = false;
      if (!entry) {
        const baseTexture = this.createMaskTexture(scene.width, scene.height);
        const qualifyValues = buildGpuLumaQualificationParams(local.mask);
        const qualifyBuffer = this.createStorageBuffer(qualifyValues);
        this.device.queue.writeBuffer(qualifyBuffer, 0, qualifyValues);
        entry = {
          kind: "gpu-luma",
          texture: baseTexture,
          baseTexture,
          horizontalTexture: null,
          refinedTexture: null,
          qualifyBuffer,
          horizontalBuffer: null,
          verticalBuffer: null,
          width: scene.width,
          height: scene.height,
          byteSize: scene.width * scene.height * 2 + 16,
          refinementIdentity: null,
        };
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(
          encoder,
          this.maskPipelines.qualify,
          this.createMaskBindGroup(scene.texture, qualifyBuffer),
          baseTexture,
        );
        this.device.queue.submit([encoder.finish()]);
        this.localMasks.set(key, entry);
        baseRegenerated = true;
      } else {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
      }

      const leaf = local.mask.leaf;
      const feather = Math.min(0.05, Math.max(0, Number(leaf.mask_feather) || 0));
      const inverted = Boolean(local.mask.inverted);
      const refinementIdentity = `${feather}:${inverted}`;
      let refinementRan = false;
      if (entry.refinementIdentity !== refinementIdentity) {
        const amount = feather / 0.05;
        const sigmaX = 0.09 * amount * entry.width;
        const sigmaY = 0.09 * amount * entry.height;
        if (Math.max(sigmaX, sigmaY) < 0.25 && !inverted) {
          entry.texture = entry.baseTexture;
        } else {
          if (!entry.horizontalTexture) {
            entry.horizontalTexture = this.createMaskTexture(entry.width, entry.height);
            entry.refinedTexture = this.createMaskTexture(entry.width, entry.height);
            entry.horizontalBuffer = this.createStorageBuffer(new Float32Array(4));
            entry.verticalBuffer = this.createStorageBuffer(new Float32Array(4));
            entry.byteSize += entry.width * entry.height * 2 * 2 + 32;
          }
          const horizontalValues = new Float32Array([sigmaX, sigmaY, 0, 0]);
          const verticalValues = new Float32Array([sigmaX, sigmaY, 1, inverted ? 1 : 0]);
          this.device.queue.writeBuffer(entry.horizontalBuffer, 0, horizontalValues);
          this.device.queue.writeBuffer(entry.verticalBuffer, 0, verticalValues);
          const encoder = this.device.createCommandEncoder();
          this.encodeMaskPass(
            encoder,
            this.maskPipelines.refine,
            this.createMaskBindGroup(entry.baseTexture, entry.horizontalBuffer),
            entry.horizontalTexture,
          );
          this.encodeMaskPass(
            encoder,
            this.maskPipelines.refine,
            this.createMaskBindGroup(entry.horizontalTexture, entry.verticalBuffer),
            entry.refinedTexture,
          );
          this.device.queue.submit([encoder.finish()]);
          entry.texture = entry.refinedTexture;
          refinementRan = true;
        }
        entry.refinementIdentity = refinementIdentity;
      }
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024);
      if (this.instrumentationEnabled) {
        const event = {
          kind: "gpu-luma",
          longEdge,
          width: entry.width,
          height: entry.height,
          sceneLuminanceCreated: scene.created,
          baseRegenerated,
          refinementRan,
          feather,
          encodeSubmitMs: performance.now() - startedAt,
          cpuMaskRequest: false,
        };
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push(event);
        if (this.performanceMetrics.maskEvents.length > 480) this.performanceMetrics.maskEvents.shift();
      }
      return entry;
    }

    createMaskTexture(width, height) {
      return this.device.createTexture({
        size: { width, height },
        format: "r16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    createMaskBindGroup(texture, parameterBuffer, operandTexture = texture) {
      return this.device.createBindGroup({
        layout: this.maskBindGroupLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: { buffer: parameterBuffer } },
          { binding: 2, resource: operandTexture.createView() },
        ],
      });
    }

    encodeMaskPass(encoder, pipeline, bindGroup, targetTexture) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }

    trimLocalMaskCache(budget) {
      let total = [...this.localMasks.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      while (this.localMasks.size && total > budget) {
        const [key, entry] = this.localMasks.entries().next().value;
        this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(entry));
        this.localMasks.delete(key);
        total -= entry.byteSize;
      }
    }

    destroyLocalMaskEntry(entry) {
      if (!entry || entry.destroyed) return;
      entry.destroyed = true;
      const textures = new Set([
        entry.texture,
        entry.baseTexture,
        entry.horizontalTexture,
        entry.refinedTexture,
        ...(entry.nodeTextures || []),
      ].filter(Boolean));
      textures.forEach((texture) => texture.destroy());
      entry.qualifyBuffer?.destroy();
      entry.horizontalBuffer?.destroy();
      entry.verticalBuffer?.destroy();
    }

    localParamBuffer(local, lane, sourcePixelScale) {
      const key = `${local.id}:${lane}`;
      let buffer = this.localParamBuffers.get(key);
      const values = buildLocalParams(local, lane, sourcePixelScale);
      if (!buffer) {
        buffer = this.createStorageBuffer(values);
        this.localParamBuffers.set(key, buffer);
      }
      const previous = this.localParamValues.get(key);
      if (!previous || !floatArraysEqual(previous, values)) {
        this.device.queue.writeBuffer(buffer, 0, values);
        this.localParamValues.set(key, values);
      }
      return buffer;
    }
  }

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
    return ["luma_curve", "red_curve", "green_curve", "blue_curve"].every((name) => {
      const points = branch?.[name];
      return Array.isArray(points) && points.length >= 2
        && points.every((point) => Array.isArray(point) && Math.abs(Number(point[0]) - Number(point[1])) < 0.000001);
    });
  }

  function toneEqualizerNeutral(branch) {
    const nodes = branch?.tone_equalizer_nodes;
    return !Array.isArray(nodes) || nodes.every((node) => Math.abs(Number(node?.adjustment_ev) || 0) < 0.000001);
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

  function buildParams(lane, adjustments, workingSpace, hdrSurface, referenceWhiteNits = 203, sourcePixelScale = 1, inheritedGrain = null) {
    const params = new Float32Array(PARAM_COUNT);
    const projectReferenceWhite = Number(referenceWhiteNits) === 100 ? 100 : 203;
    const branch = adjustments[lane];
    const colorSource = branch;
    params[0] = lane === "hdr" ? 1 : 0;
    params[1] = workingSpace === "linear-srgb" ? 1 : 0;
    const toneEnabled = branch.tone_section_enabled !== false;
    const sdrHighlightV2 = lane === "sdr" && branch.rendering_version !== "legacy_base_v1";
    const highlightEnabled = (lane === "hdr" || sdrHighlightV2) && branch.highlight_section_enabled !== false;
    const primariesEnabled = branch.primaries_section_enabled !== false;
    const colorEnabled = branch.color_section_enabled !== false;
    const colorActive = colorEnabled && !colorSettingsNeutral(colorSource);
    const baseEnabled = lane !== "sdr" || branch.base_section_enabled !== false;
    params[2] = toneEnabled ? branch.exposure || 0 : 0;
    params[3] = lane === "hdr" || sdrHighlightV2
      ? (highlightEnabled ? branch.highlight_compression_softness || 0 : 0)
      : (toneEnabled ? branch.highlight_recovery || 0 : 0);
    params[4] = toneEnabled ? (lane === "hdr" ? branch.shadow_lift || 0 : branch.shadow || 0) : 0;
    params[5] = primariesEnabled ? branch.lift || 0 : 0;
    params[6] = primariesEnabled ? branch.gamma || 0 : 0;
    params[7] = primariesEnabled ? branch.gain || 0 : 0;
    params[8] = toneEnabled ? branch.contrast || 0 : 0;
    params[9] = branch.contrast_pivot || (lane === "hdr" ? 0.1845 : 0.5);
    params[10] = colorActive ? colorSource.white_balance_kelvin || 6500 : 6500;
    params[11] = colorActive ? colorSource.tint || 0 : 0;
    params[12] = baseEnabled ? (branch.tone_mapper === "aces" ? 1 : branch.tone_mapper === "reinhard" ? 2 : 0) : 0;
    params[13] = baseEnabled ? branch.tone_contrast ?? 1 : 1;
    params[14] = baseEnabled ? branch.tone_skew || 0 : 0;
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
      : sdrHighlightV2 ? (branch.highlight_compression_start_percent ?? 50) / 100 : 0;
    params[54] = branch.lift_pivot ?? -2;
    params[55] = branch.lift_range ?? 4;
    params[56] = branch.gamma_pivot ?? 0;
    params[57] = branch.gamma_range ?? 4.25;
    params[58] = branch.gain_pivot ?? 2;
    params[59] = branch.gain_range ?? 4;
    params[60] = baseEnabled ? 1 : 0;
    const colorMatrix = colorActive ? rgbPrimariesAdjustmentMatrix(colorSource) : IDENTITY_3X3;
    colorMatrix.forEach((value, index) => { params[61 + index] = value; });
    params[70] = colorActive ? colorSource.saturation || 0 : 0;
    params[71] = colorActive ? colorSource.vibrance || 0 : 0;
    params[72] = colorActive ? 1 : 0;
    params[73] = lane === "hdr" ? ((branch.highlight_compression_target_nits ?? 1000) * 0.18 / projectReferenceWhite) : sdrHighlightV2 ? 1 : 0;
    params[74] = highlightEnabled ? (branch.highlight_compression_mode === "peak_fit" ? 1 : branch.highlight_compression_mode === "soft_ceiling" ? 2 : branch.highlight_compression_mode === "clip" ? 3 : 0) : 0;
    params[75] = lane === "hdr"
      ? toneAdjustedHighlightPeakLinear(branch, toneEnabled, projectReferenceWhite)
      : sdrHighlightV2 ? Math.max(0.01, (branch.highlight_compression_peak_measurement === "manual"
        ? branch.highlight_compression_manual_peak_percent ?? 100
        : branch.highlight_compression_source_peak_percent ?? 100) / 100 * (toneEnabled ? Math.pow(2, branch.exposure || 0) : 1)) : 0;
    params[138] = projectReferenceWhite;
    params[139] = 203;
    params[76] = lane === "hdr" || sdrHighlightV2 ? Math.min(1, Math.max(0, (branch.highlight_compression_peak_detail ?? 35) / 100)) : 0;
    params[77] = lane === "hdr" || sdrHighlightV2 ? Math.min(1, Math.max(-1, (branch.highlight_compression_bias ?? 0) / 100)) * 0.6 : 0;
    const film = branch.film_look || {};
    const filmEnabled = branch.film_look_section_enabled !== false;
    params[78] = filmEnabled ? 1 : 0;
    params[79] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0;
    params[80] = (film.print_strength || 0) / 100;
    params[81] = (film.print_contrast || 0) / 100;
    params[82] = (film.print_toe || 0) / 100;
    params[83] = (film.print_shoulder || 0) / 100;
    params[84] = (film.color_density || 0) / 100;
    params[143] = (film.red_response || 0) / 100;
    params[144] = (film.green_response || 0) / 100;
    params[145] = (film.blue_response || 0) / 100;
    params[146] = (film.highlight_desaturation || 0) / 100;
    params[147] = (film.shadow_desaturation || 0) / 100;
    params[85] = film.halation_enabled !== false && ((((film.halation_amount || 0) > 0) && (film.halation_radius || 0) > 0) || film.halation_view_map) ? 1 : 0;
    params[86] = (film.halation_amount || 0) / 100;
    params[87] = (film.halation_sensitivity ?? 75) / 100;
    params[88] = film.halation_radius ?? 0.2;
    params[89] = (film.halation_hue_offset || 0) / 100;
    params[90] = (film.halation_saturation ?? 75) / 100;
    params[91] = film.halation_view_map ? 1 : 0;
    params[92] = film.bloom_enabled !== false && (film.bloom_radius || 0) > 0 ? 1 : 0;
    params[93] = (film.bloom_amount || 0) / 100;
    params[94] = (film.bloom_sensitivity ?? 80) / 100;
    params[95] = film.bloom_radius ?? 0.5;
    params[96] = (film.bloom_highlight_detail ?? 75) / 100;
    params[97] = film.image_structure_enabled !== false ? 1 : 0;
    params[98] = (film.image_softness || 0) / 100;
    params[99] = (film.microcontrast || 0) / 100;
    const grain = inheritedGrain?.filmLook || film;
    const grainSectionEnabled = inheritedGrain
      ? inheritedGrain.filmLookSectionEnabled !== false
      : filmEnabled;
    params[100] = grain.grain_enabled !== false ? 1 : 0;
    params[101] = (grain.grain_amount || 0) / 100;
    params[102] = (grain.grain_size ?? 50) / 100;
    params[103] = (grain.grain_softness ?? 25) / 100;
    params[104] = (grain.grain_chroma || 0) / 100;
    params[105] = (grain.grain_shadow_response ?? 100) / 100;
    params[106] = (grain.grain_midtone_response ?? 100) / 100;
    params[107] = (grain.grain_highlight_response ?? 100) / 100;
    params[108] = (film.film_resolution ?? 100) / 100;
    params[109] = inheritedGrain?.filmGrainSeed ?? adjustments.shared?.film_grain_seed ?? 271828;
    const filmGates = {
      "65mm": [52.63, 23.01],
      "35mm": [36, 24],
      super35: [24.89, 18.66],
      super16: [12.52, 7.41],
      "16mm": [10.26, 7.49],
      super8: [5.79, 4.01],
    };
    const gate = grain.grain_film_format === "custom"
      ? [Math.min(500, Math.max(1, Number(grain.grain_custom_width_mm) || 36)), Math.min(500, Math.max(1, Number(grain.grain_custom_height_mm) || 24))]
      : (filmGates[grain.grain_film_format] || filmGates["35mm"]);
    params[140] = gate[0];
    params[141] = gate[1];
    params[142] = grain.grain_capture_geometry === "horizontal_strip" ? 1
      : grain.grain_capture_geometry === "vertical_strip" ? 2 : 0;
    params[156] = grainSectionEnabled ? 1 : 0;
    params[157] = grainSectionEnabled ? (grain.look_strength ?? 100) / 100 : 0;
    // Viewer-only diagnostic: it follows this branch's checkbox even when the
    // grain recipe itself is inherited from a captured HDR match.
    params[158] = film.grain_view_map ? 1 : 0;
    params[110] = lane !== "hdr" && !sdrHighlightV2 ? 0
      : branch.highlight_compression_color_handling === "smooth_rolloff" ? 2
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
    params[159] = sdrHighlightV2 ? 1 : 0;
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

  function buildCurves(lane, adjustments, curveSampler, sampleCache) {
    const branch = adjustments[lane];
    const names = ["luma_curve", "red_curve", "green_curve", "blue_curve"];
    const signatures = names.map((name) => JSON.stringify(branch[name]));
    const packedKey = `${lane}:packed`;
    const packedSignature = signatures.join("|");
    const packedCached = sampleCache.get(packedKey);
    if (packedCached?.signature === packedSignature) return packedCached.samples;
    const packed = new Float32Array(CURVE_SAMPLES * 4);
    names.forEach((name, channel) => {
      const signature = signatures[channel];
      const cacheKey = `${lane}:${name}`;
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
    if (!grade || !curveSetNeutral(grade)) return false;
    const grading = grade.color_grading || {};
    if (Math.abs(Number(grading.balance) || 0) > 0.000001 || Math.abs((Number(grading.blending) || 50) - 50) > 0.000001) return false;
    return [grading.shadows, grading.midtones, grading.highlights].every((wheel) =>
      !wheel || [wheel.hue, wheel.saturation, wheel.luminance_ev].every((value) => Math.abs(Number(value) || 0) < 0.000001));
  }

  function activeGpuLocals(lane, localAdjustments) {
    return (Array.isArray(localAdjustments) ? localAdjustments : []).filter((local) =>
      local?.enabled !== false
      && Number(local?.opacity) > 0
      && local?.[`${lane}_grade`]?.enabled !== false);
  }

  function gpuLocalDetailActive(grade) {
    const detail = grade?.detail || {};
    return [detail.texture_amount, detail.clarity_amount, detail.sharpen_amount]
      .some((value) => Math.abs(Number(value) || 0) > 0.000001);
  }

  function buildLocalParams(local, lane, sourcePixelScale = 1) {
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
    return values;
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

  function gpuMaskRenderPayload(expression) {
    if (!expression) return expression;
    const { id, children, ...payload } = expression;
    return {
      ...payload,
      children: (children || []).map(gpuMaskRenderPayload),
    };
  }

  function isGpuLumaMask(expression) {
    return expression?.operator === "leaf"
      && expression.leaf?.type === "luminance_range"
      && (!expression.children || expression.children.length === 0);
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

  window.HDRWebGPUPreview = HDRWebGPUPreview;

  const SHADER_SOURCE = String.raw`
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read> p: array<f32>;
    @group(0) @binding(2) var<storage, read> curveLuts: array<f32>;
    @group(0) @binding(3) var spatialTexture: texture_2d<f32>;
    @group(0) @binding(4) var spatialSampler: sampler;
    @group(0) @binding(5) var overlayMaskTexture: texture_2d<f32>;

    struct VertexOut { @builtin(position) position: vec4f }

    @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
      var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: VertexOut;
      output.position = vec4f(positions[index], 0.0, 1.0);
      return output;
    }

    fn lumaAces(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2722287, 0.6740818, 0.0536895)); }
    fn lumaSrgb(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
    fn smoothRange(a: f32, b: f32, v: f32) -> f32 {
      let t = clamp((v - a) / max(b - a, 0.000001), 0.0, 1.0);
      return t * t * (3.0 - 2.0 * t);
    }
    fn curveValue(channel: u32, value: f32) -> f32 {
      let base = channel * 1024u;
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
    fn curveEncodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value / 0.36; }
      if (value <= 0.18) { return 0.5 * pow(value / 0.18, 1.0 / log(100.0)); }
      return 0.5 + 0.5 * log2(value / 0.18) / log2(100.0);
    }
    fn curveDecodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value * 0.36; }
      if (value <= 0.5) { return 0.18 * pow(2.0 * value, log(100.0)); }
      return 0.18 * exp2((value - 0.5) * 2.0 * log2(100.0));
    }
    fn curveEncode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return vec3f(curveEncodeChannel(rgb.r), curveEncodeChannel(rgb.g), curveEncodeChannel(rgb.b));
    }
    fn curveDecode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return vec3f(curveDecodeChannel(rgb.r), curveDecodeChannel(rgb.g), curveDecodeChannel(rgb.b));
    }
    fn applyCurves(input: vec3f, hdr: bool) -> vec3f {
      if (p[15] < 0.5) { return input; }
      var rgb = select(clamp(input, vec3f(0.0), vec3f(1.0)), input, hdr);
      let sourceLuma = select(lumaSrgb(rgb), lumaAces(rgb), hdr);
      let curveLuma = select(clamp(sourceLuma, 0.0, 1.0), curveEncodeChannel(sourceLuma), hdr);
      let mappedCurveLuma = curveValue(0u, curveLuma);
      let mappedLuma = select(mappedCurveLuma, curveDecodeChannel(mappedCurveLuma), hdr);
      if (abs(sourceLuma) > 0.00001) { rgb *= mappedLuma / sourceLuma; }
      rgb = curveEncode(rgb, hdr);
      for (var channel = 0u; channel < 3u; channel++) {
        let value = rgb[channel];
        rgb[channel] = curveValue(channel + 1u, value);
      }
      return curveDecode(rgb, hdr);
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
      if (-1.88170328 * aa - 0.80936493 * bb > 1.0) {
        k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
        weights = vec3f(4.0767416621, -3.3077115913, 0.2309699292);
      } else if (1.81444104 * aa - 1.19445276 * bb > 1.0) {
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
    fn compressSrgbGamut(input: vec3f) -> vec3f {
      if (all(input >= vec3f(0.0)) && all(input <= vec3f(1.0))) { return input; }
      if (all(input >= vec3f(-(GAMUT_RESIDUE_EPS + GAMUT_MATH_EPS)))
          && all(input <= vec3f(1.0 + GAMUT_RESIDUE_EPS + GAMUT_MATH_EPS))) {
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
      let offset = (p[10] - 6500.0) / 6500.0;
      return input * vec3f(1.0 + offset * 0.15, 1.0 + p[11] * 0.08, 1.0 - offset * 0.15);
    }
    fn hdrColor(input: vec3f) -> vec3f {
      let rgb = vec3f(
        p[61] * input.r + p[62] * input.g + p[63] * input.b,
        p[64] * input.r + p[65] * input.g + p[66] * input.b,
        p[67] * input.r + p[68] * input.g + p[69] * input.b
      );
      let y = lumaAces(rgb);
      let neutral = vec3f(y);
      let chroma = rgb - neutral;
      let maximum = max(rgb.r, max(rgb.g, rgb.b));
      let minimum = min(rgb.r, min(rgb.g, rgb.b));
      let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
      let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
      let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
      let vibranceFactor = max(0.0, 1.0 + p[71] * vibranceWeight);
      let saturationFactor = max(0.0, 1.0 + p[70]);
      return neutral + chroma * vibranceFactor * saturationFactor;
    }
    fn hdrBase(input: vec3f) -> vec3f {
      var rgb = input * exp2(p[2]);
      if (p[4] != 0.0) {
        let lift = min(p[4] * (1.0 - clamp(lumaAces(rgb), 0.0, 1.0)), 1.0);
        rgb *= 1.0 + lift;
      }
      return rgb;
    }
    fn hdrContrast(input: vec3f) -> vec3f {
      if (p[8] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      let targetStops = stops * exp2(p[8]);
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
      if (p[111] < 0.5) { return input; }
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.0);
      let signal = select(log2(max(srgbEncode(sourceY), 0.0000001) / 0.5), log2(max(sourceY, 0.0000001) / 0.18), hdr);
      let shadow = 1.0 - smoothRange(-1.0 + p[113] - p[112] * 0.5, -1.0 + p[113] + p[112] * 0.5, signal);
      let highlight = smoothRange(1.0 + p[113] - p[112] * 0.5, 1.0 + p[113] + p[112] * 0.5, signal);
      let midtone = max(0.0, 1.0 - shadow - highlight);
      let total = max(shadow + midtone + highlight, 0.000001);
      let masks = vec3f(shadow, midtone, highlight) / total;
      var tint = vec3f(0.0);
      var luminanceEv = 0.0;
      for (var index: u32 = 0u; index < 3u; index = index + 1u) {
        let offset = 114 + index * 3;
        tint += gradingVector(p[offset], hdr) * p[offset + 1] * masks[index];
        luminanceEv += p[offset + 2] * masks[index];
      }
      var result = input + tint * sourceY;
      let tintedY = max(select(lumaSrgb(result), lumaAces(result), hdr), 0.0000001);
      result *= sourceY / tintedY;
      return max(result * exp2(luminanceEv), vec3f(0.0));
    }
    fn hdrSoftCeiling(input: vec3f) -> vec3f {
      if (p[74] != 2.0 || p[3] <= 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let start = max(p[53], 0.000001);
      if (y <= start) { return input; }
      let targetLevel = max(p[73], start + 0.0018);
      let span = targetLevel - start;
      let normalized = (y - start) / span;
      let softness = clamp(p[3] / 100.0, 0.0, 1.0);
      let exponent = exp2(5.0 * (1.0 - softness));
      var compressed: f32;
      if (normalized <= 1.0) {
        compressed = normalized / pow(1.0 + pow(normalized, exponent), 1.0 / exponent);
      } else {
        compressed = 1.0 / pow(1.0 + pow(1.0 / normalized, exponent), 1.0 / exponent);
      }
      if (compressed > 0.99999) { compressed = 1.0; }
      let activationPosition = clamp(p[3] / 10.0, 0.0, 1.0);
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
    fn hdrPeakFit(input: vec3f) -> vec3f {
      if (p[74] != 1.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let channelPeak = max(max(input.r, input.g), input.b);
      let transport = acescgToBt2020(input);
      let transportPeak = max(max(transport.r, transport.g), transport.b);
      var signal = y;
      if (p[110] > 1.5) {
        signal = max(transportPeak, 0.0);
      } else if (p[110] > 0.5) {
        signal = max(channelPeak, 0.0);
      }
      let start = max(p[53], 0.000001);
      let targetLevel = max(p[73], start + 0.0018);
      let peakLevel = max(p[75], targetLevel);
      if (peakLevel <= targetLevel) { return input; }
      let startStop = log2(start);
      let targetStop = log2(targetLevel);
      let peakStop = log2(peakLevel);
      let curveBias = p[77];
      let requestedRatio = (targetStop - startStop) / max(peakStop - startStop, 0.000001);
      let requiredRatio = clamp((1.0 / (1.0 + curveBias) + p[76] / (1.0 - curveBias)) / 3.0, 0.001, 0.95);
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
      let m1 = p[76] * (peakStop - effectiveStartStop) / max(stopSpan * (1.0 - curveBias), 0.000001);
      if (p[110] > 1.5) {
        let mappedTransport = vec3f(
          peakFitChannel(transport.r, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1),
          peakFitChannel(transport.g, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1),
          peakFitChannel(transport.b, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1)
        );
        return bt2020ToAcescg(mappedTransport);
      }
      let mapped = w * (1.0 - w) * (1.0 - w) * m0 + w * w * (3.0 - 2.0 * w) + w * w * (w - 1.0) * m1;
      let targetValue = exp2(effectiveStartStop + stopSpan * mapped);
      let mappedRgb = input * (targetValue / max(signal, 0.00000001));
      if (p[110] < 0.5) { return mappedRgb; }
      let progress = u * u * (3.0 - 2.0 * u);
      return vec3f(targetValue) + (mappedRgb - vec3f(targetValue)) * (1.0 - progress);
    }
    fn sdrSoftCeiling(input: vec3f) -> vec3f {
      if (p[74] != 2.0 || p[3] <= 0.0) { return input; }
      let y = max(lumaSrgb(input), 0.0);
      let start = max(p[53], 0.000001);
      if (y <= start) { return input; }
      let span = 1.0 - start;
      let normalized = (y - start) / span;
      let softness = clamp(p[3] / 100.0, 0.0, 1.0);
      let exponent = exp2(5.0 * (1.0 - softness));
      var compressed: f32;
      if (normalized <= 1.0) {
        compressed = normalized / pow(1.0 + pow(normalized, exponent), 1.0 / exponent);
      } else {
        compressed = 1.0 / pow(1.0 + pow(1.0 / normalized, exponent), 1.0 / exponent);
      }
      let position = clamp(p[3] / 10.0, 0.0, 1.0);
      let activation = position * position * (3.0 - 2.0 * position);
      let targetValue = start + mix(y - start, span * compressed, activation);
      return input * (targetValue / max(y, 0.00000001));
    }
    fn sdrPeakFit(input: vec3f) -> vec3f {
      if (p[74] != 1.0) { return input; }
      let y = max(lumaSrgb(input), 0.0);
      let channelPeak = max(max(input.r, input.g), input.b);
      var signal = y;
      if (p[110] > 0.5) { signal = max(channelPeak, 0.0); }
      let start = max(p[53], 0.000001);
      // Skip against the authored target, matching the CPU limiter. A fixed
      // 1.0 scene-linear threshold is reference-white dependent and diverges
      // from it for any target above that level.
      let targetPeak = max(p[73], 0.000001);
      let peakLevel = max(p[75], targetPeak);
      if (peakLevel <= targetPeak) { return input; }
      let startStop = log2(start);
      let peakStop = log2(peakLevel);
      let curveBias = p[77];
      let requestedRatio = -startStop / max(peakStop - startStop, 0.000001);
      let requiredRatio = clamp((1.0 / (1.0 + curveBias) + p[76] / (1.0 - curveBias)) / 3.0, 0.001, 0.95);
      var effectiveStartStop = startStop;
      if (requestedRatio < requiredRatio) {
        effectiveStartStop = (-requiredRatio * peakStop) / (1.0 - requiredRatio);
      }
      let effectiveStart = exp2(effectiveStartStop);
      if (signal <= effectiveStart) { return input; }
      let sourceSpan = max(peakStop - effectiveStartStop, 0.000001);
      let stopSpan = -effectiveStartStop;
      let m0 = sourceSpan / max(stopSpan * (1.0 + curveBias), 0.000001);
      let m1 = p[76] * sourceSpan / max(stopSpan * (1.0 - curveBias), 0.000001);
      if (p[110] > 1.5) {
        return vec3f(
          peakFitChannel(input.r, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1),
          peakFitChannel(input.g, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1),
          peakFitChannel(input.b, effectiveStart, effectiveStartStop, peakStop, curveBias, stopSpan, m0, m1)
        );
      }
      let u = clamp((log2(signal) - effectiveStartStop) / sourceSpan, 0.0, 1.0);
      let w = clamp(u + curveBias * u * (1.0 - u), 0.0, 1.0);
      let mapped = w * (1.0 - w) * (1.0 - w) * m0 + w * w * (3.0 - 2.0 * w) + w * w * (w - 1.0) * m1;
      let targetValue = exp2(effectiveStartStop + stopSpan * mapped);
      let mappedRgb = input * (targetValue / max(signal, 0.00000001));
      if (p[110] < 0.5) { return mappedRgb; }
      let progress = u * u * (3.0 - 2.0 * u);
      return vec3f(targetValue) + (mappedRgb - vec3f(targetValue)) * (1.0 - progress);
    }
    fn hdrPrimaries(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      var targetStops = stops;
      targetStops += 2.0 * p[5] * (1.0 - smoothRange(p[54] - p[55] * 0.5, p[54] + p[55] * 0.5, stops));
      let gammaSigma = max(p[57] / 2.355, 0.1);
      targetStops += 2.0 * p[6] * exp(-0.5 * pow((stops - p[56]) / gammaSigma, 2.0));
      let gainMask = smoothRange(p[58] - p[59] * 0.5, p[58] + p[59] * 0.5, stops);
      let gainExponent = clamp(sqrt(p[59] / 4.0), 0.5, 1.0);
      targetStops += 2.0 * p[7] * pow(gainMask, gainExponent);
      if (y <= 0.00000001) { return input; }
      return input * (pivot * exp2(clamp(targetStops, -32.0, 32.0)) / y);
    }
    fn toneEqualizerNodeEv(index: u32) -> f32 { return p[21u + index]; }
    fn toneEqualizerTarget(index: u32) -> f32 {
      return toneEqualizerNodeEv(index) + p[37u + index];
    }
    fn toneEqualizerSlope(index: u32) -> f32 {
      let count = u32(p[20]);
      if (index == 0u) { return (toneEqualizerTarget(1u) - toneEqualizerTarget(0u)) / max(toneEqualizerNodeEv(1u) - toneEqualizerNodeEv(0u), 0.0001); }
      if (index + 1u >= count) { return (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001); }
      let previous = (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001);
      let following = (toneEqualizerTarget(index + 1u) - toneEqualizerTarget(index)) / max(toneEqualizerNodeEv(index + 1u) - toneEqualizerNodeEv(index), 0.0001);
      if (previous <= 0.0 || following <= 0.0) { return 0.0; }
      return 2.0 * previous * following / (previous + following);
    }
    fn toneEqualizer(input: vec3f) -> vec3f {
      if (p[18] < 0.5) { return input; }
      let y = max(select(lumaSrgb(input), lumaAces(input), p[0] > 0.5), 0.0);
      if (y <= 0.00000001) { return input; }
      let inputEv = log2(max(y, 0.00000001) / 0.18);
      var targetEv = inputEv;
      let count = u32(p[20]);
      if (inputEv < -6.0) {
        targetEv += p[37];
      } else if (inputEv > 6.0) {
        targetEv += p[37u + count - 1u];
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
        targetEv = mix(linear, cubic, clamp(p[19], 0.0, 1.0));
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
      if (p[8] == 0.0) { return input; }
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      let linearY = clamp(lumaSrgb(rgb), 0.0, 1.0);
      let encodedY = srgbEncode(linearY);
      let targetValue = (encodedY - p[9]) * exp2(p[8] * 0.5) + p[9];
      let targetY = srgbDecode(clamp(targetValue, 0.0, 1.0));
      if (linearY > 0.000001) { return rgb * (targetY / linearY); }
      return vec3f(targetY);
    }
    fn sdrPrimaries(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0) { return input; }
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      let linearY = clamp(lumaSrgb(rgb), 0.0, 1.0);
      let encodedY = srgbEncode(linearY);
      var targetValue = encodedY;
      let zoneStops = log2(max(encodedY, 0.000001) / 0.5);
      let shadowMask = 1.0 - smoothRange(p[54] - p[55] * 0.5, p[54] + p[55] * 0.5, zoneStops);
      var highlightMask = smoothRange(p[58] - p[59] * 0.5, p[58] + p[59] * 0.5, zoneStops);
      let gainExponent = clamp(sqrt(p[59] / 4.0), 0.5, 1.0);
      highlightMask = pow(highlightMask, gainExponent);
      let gammaSigma = max(p[57] / 2.355, 0.1);
      let midtoneMask = exp(-0.5 * pow((zoneStops - p[56]) / gammaSigma, 2.0));
      targetValue += p[5] * 0.25 * shadowMask;
      if (p[6] != 0.0) { targetValue = mix(targetValue, pow(clamp(targetValue, 0.0, 1.0), exp2(-p[6])), midtoneMask); }
      if (p[7] > 0.0) { targetValue += p[7] * highlightMask * (1.0 - targetValue); }
      if (p[7] < 0.0) { targetValue += p[7] * highlightMask * targetValue; }
      let targetY = srgbDecode(clamp(targetValue, 0.0, 1.0));
      if (linearY > 0.000001) { return rgb * (targetY / linearY); }
      return vec3f(targetY);
    }
    fn highlightRecovery(input: vec3f) -> vec3f {
      if (p[3] <= 0.0) { return input; }
      let rgb = max(input, vec3f(0.0));
      let y = lumaSrgb(rgb);
      let pivot = 100.0 / 203.0;
      let span = 1.0 - pivot;
      let position = clamp((y - pivot) / span, 0.0, 1.0);
      let amount = 2.5 * (1.0 - exp(-0.5 * clamp(p[3], 0.0, 4.0)));
      let recoveredPosition = position - amount * position * position * (1.0 - position);
      let recoveredValue = pivot + span * recoveredPosition;
      let targetValue = select(y, recoveredValue, y > pivot);
      return select(vec3f(0.0), rgb * (targetValue / max(y, 0.00000001)), y > 0.00000001);
    }
    fn toneCurveLuma(y: f32) -> f32 {
      var mapped = 0.0;
      if (p[12] > 1.5) {
        let scaledY = y * 5.393743257820929;
        mapped = scaledY / (1.0 + scaledY);
      } else if (p[12] > 0.5) {
        let scaledY = y * 2.0294105241641414;
        mapped = ((scaledY * (2.51 * scaledY + 0.03)) / (scaledY * (2.43 * scaledY + 0.59) + 0.14)) / (2.51 / 2.43);
      } else {
        let basePower = 1.1 * clamp(p[13], 0.5, 1.5);
        let shadowPower = basePower * exp2(-0.75 * clamp(p[14], -1.0, 1.0));
        let highlightPower = basePower * exp2(0.75 * clamp(p[14], -1.0, 1.0));
        let sceneMiddleGray = 0.18;
        let displayReferenceWhite = 100.0 / 203.0;
        let logExposure = log(max(y, 0.00000001) / sceneMiddleGray);
        let localPower = mix(shadowPower, highlightPower, smoothRange(-0.5, 0.5, logExposure));
        let referenceOdds = log(displayReferenceWhite / (1.0 - displayReferenceWhite));
        mapped = select(0.0, 1.0 / (1.0 + exp(-clamp(referenceOdds + localPower * logExposure, -32.0, 32.0))), y > 0.0);
      }
      return clamp(mapped, 0.0, 1.0);
    }
    fn toneMap(input: vec3f) -> vec3f {
      let rgb = max(input, vec3f(0.0));
      let y = lumaAces(rgb);
      let mapped = toneCurveLuma(y);
      let scaled = select(vec3f(0.0), rgb * (mapped / max(y, 0.00000001)), y > 0.00000001);
      return compressSrgbGamut(acescgToSrgb(scaled));
    }
    fn retoneMapSdrReference(input: vec3f) -> vec3f {
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      if (p[12] < 0.5 && abs(p[13] - 1.0) < 0.000001 && abs(p[14]) < 0.000001) { return rgb; }
      let y = lumaSrgb(rgb);
      let boundedY = clamp(y, 0.0000001, 0.9999999);
      let sceneMiddleGray = 0.18;
      let displayReferenceWhite = 100.0 / 203.0;
      let displayReferenceOdds = log(displayReferenceWhite / (1.0 - displayReferenceWhite));
      let encodedOdds = log(boundedY / (1.0 - boundedY));
      let sceneY = select(0.0, sceneMiddleGray * exp(clamp((encodedOdds - displayReferenceOdds) / 1.1, -32.0, 32.0)), y > 0.0);
      let mapped = toneCurveLuma(sceneY);
      return clamp(select(vec3f(0.0), rgb * (mapped / max(y, 0.00000001)), y > 0.00000001), vec3f(0.0), vec3f(1.0));
    }
    fn sceneColor(input: vec3f) -> vec3f {
      if (p[72] < 0.5) { return input; }
      return hdrColor(whiteBalance(input));
    }
    fn sdrReferenceColor(input: vec3f) -> vec3f {
      if (p[72] < 0.5) { return input; }
      return compressSrgbGamut(acescgToSrgb(sceneColor(srgbToAcescg(input))));
    }
    fn renderHdrBase(source: vec3f) -> vec3f {
      let contrasted = hdrContrast(hdrBase(source));
      let balanced = sceneColor(contrasted);
      let equalized = toneEqualizer(balanced);
      let primaries = hdrPrimaries(equalized);
      return max(applyColorGrading(applyCurves(primaries, true), true), vec3f(0.0));
    }
    fn displayHdr(rgb: vec3f) -> vec3f {
      if (p[16] > 0.5) {
        // Chromium currently treats extended canvas values relative to its
        // 203-nit canvas convention. This is a qualified runtime convention,
        // not a universal WebGPU physical-nit guarantee.
        // Clamp in BT.2020 before converting to P3, exactly as the PQ encoder
        // does, so exposed highlights do not change at the settled handoff.
        let transportRgb = clamp(acescgToBt2020(rgb), vec3f(0.0), vec3f(p[17]));
        return bt2020ToP3(transportRgb) * (p[138] / p[139]) / 0.18;
      }
      let display = max(acescgToSrgb(rgb), vec3f(0.0));
      return display / (vec3f(1.0) + display);
    }
    fn renderSdrBase(source: vec3f) -> vec3f {
      var rgb: vec3f;
      if (p[1] > 0.5) {
        rgb = select(clamp(source, vec3f(0.0), vec3f(1.0)), max(source, vec3f(0.0)), p[159] > 0.5) * exp2(p[2]);
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaSrgb(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        if (p[159] > 0.5) {
          rgb = sdrPeakFit(sdrSoftCeiling(rgb));
          rgb = toneEqualizer(rgb);
          rgb = sdrContrast(rgb);
          rgb = sdrReferenceColor(rgb);
          rgb = sdrPrimaries(rgb);
          rgb = applyColorGrading(applyCurves(rgb, false), false);
        } else {
          if (p[60] > 0.5) { rgb = retoneMapSdrReference(rgb); }
          rgb = applyColorGrading(applyCurves(sdrPrimaries(sdrReferenceColor(sdrContrast(toneEqualizer(highlightRecovery(rgb))))), false), false);
        }
      } else {
        rgb = max(source * exp2(p[2]), vec3f(0.0));
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaAces(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        if (p[159] > 0.5) {
          // The SDR shoulder is the scene-to-display placement, not a final
          // limiter: every stage below it is display-referred. Only the ceiling
          // runs in applyOutputHighlights.
          rgb = compressSrgbGamut(sdrPeakFit(sdrSoftCeiling(acescgToSrgb(sceneColor(rgb)) * ((100.0 / 203.0) / 0.18))));
          rgb = toneEqualizer(rgb);
          rgb = sdrContrast(rgb);
          rgb = sdrPrimaries(rgb);
          rgb = applyColorGrading(applyCurves(rgb, false), false);
        } else {
          rgb = applyColorGrading(applyCurves(sdrPrimaries(sdrContrast(toneEqualizer(highlightRecovery(toneMap(sceneColor(rgb)))))), false), false);
        }
      }
      return clamp(rgb, vec3f(0.0), vec3f(1.0));
    }

    fn filmLuma(rgb: vec3f) -> f32 {
      return select(lumaSrgb(rgb), lumaAces(rgb), p[0] > 0.5);
    }
    fn filmSignalFromLuma(value: f32) -> f32 {
      return select(srgbEncode(clamp(value, 0.0, 1.0)), curveEncodeChannel(max(value, 0.0)), p[0] > 0.5);
    }
    fn filmLumaFromSignal(value: f32) -> f32 {
      return select(srgbDecode(clamp(value, 0.0, 1.0)), curveDecodeChannel(value), p[0] > 0.5);
    }
    fn filmResponse(input: vec3f) -> vec3f {
      // HDR enters as scene-linear ACEScg; SDR enters as scene-linear sRGB.
      // The response signal is encoded and decoded within that same branch.
      if (p[78] < 0.5 || p[79] <= 0.0) { return input; }
      let sourceY = max(filmLuma(input), 0.0);
      var rgb = input;
      if (p[80] > 0.0 && sourceY > 0.0000001) {
        let signal = filmSignalFromLuma(sourceY);
        var mapped = 0.5 + (signal - 0.5) * exp2(0.55 * p[81]);
        let toeKnee = 0.18 * log(1.0 + exp((0.45 - mapped) / 0.18));
        let shoulderKnee = 0.18 * log(1.0 + exp((mapped - 0.55) / 0.18));
        mapped = max(mapped - 0.28 * (p[82] * toeKnee + p[83] * shoulderKnee), 0.0);
        if (p[0] < 0.5) { mapped = clamp(mapped, 0.0, 1.0); }
        let targetY = mix(sourceY, filmLumaFromSignal(mapped), p[80] * p[79]);
        rgb *= targetY / sourceY;
      }
      let channelResponse = vec3f(p[143], p[144], p[145]) * p[79];
      if (any(abs(channelResponse) > vec3f(0.000001))) {
        let responseY = max(filmLuma(rgb), 0.0);
        let responseSignal = filmSignalFromLuma(responseY);
        let maximum = max(rgb.r, max(rgb.g, rgb.b));
        let minimum = min(rgb.r, min(rgb.g, rgb.b));
        let relative = clamp((maximum - minimum) / max(abs(responseY), 0.00001), 0.0, 2.0);
        let exposureWeight = 0.20 + 0.80 * smoothRange(0.08, 0.88, responseSignal);
        let saturationGuard = 1.0 - 0.35 * smoothRange(0.60, 1.40, relative);
        let highlightGuard = 1.0 - 0.65 * smoothRange(0.88, 1.12, responseSignal);
        rgb *= exp2(channelResponse * (0.35 * exposureWeight * saturationGuard * highlightGuard));
      }
      if (p[84] != 0.0) {
        let y = filmLuma(rgb);
        let neutral = vec3f(y);
        let maximum = max(rgb.r, max(rgb.g, rgb.b));
        let minimum = min(rgb.r, min(rgb.g, rgb.b));
        let relative = clamp((maximum - minimum) / max(abs(y), 0.00001), 0.0, 2.0);
        let density = p[84] * p[79];
        rgb = neutral + (rgb - neutral) * exp2(0.45 * density);
        rgb *= max(0.75, 1.0 - density * 0.045 * relative);
      }
      if (p[146] > 0.0 || p[147] > 0.0) {
        let responseY = max(filmLuma(rgb), 0.0);
        let responseSignal = filmSignalFromLuma(responseY);
        let shadowWeight = 1.0 - smoothRange(0.08, 0.46, responseSignal);
        // HDR reference white is 0.5 in the curve domain. Roll highlight
        // desaturation through display-visible HDR instead of reserving most
        // of the effect for extreme specular values above common headroom.
        let highlightWeight = select(
          smoothRange(0.62, 1.0, responseSignal),
          smoothRange(0.50, 0.82, responseSignal),
          p[0] > 0.5
        );
        let desaturation = clamp(
          (shadowWeight * p[147] + highlightWeight * p[146]) * p[79],
          0.0,
          1.0
        );
        rgb = vec3f(responseY) + (rgb - vec3f(responseY)) * (1.0 - desaturation);
      }
      return max(rgb, vec3f(0.0));
    }
    // Clip in the delivery primaries so the selected target is also a hard
    // per-channel ceiling in the encoded signal.
    fn clipToOutputTarget(input: vec3f) -> vec3f {
      if (p[0] > 0.5) {
        return bt2020ToAcescg(clamp(acescgToBt2020(input), vec3f(0.0), vec3f(p[73])));
      }
      return clamp(input, vec3f(0.0), vec3f(1.0));
    }
    // The shoulder shapes the picture and the ceiling guarantees the delivery
    // spec. A shoulder anchored on a measured peak cannot promise the target on
    // its own, because ringing and grain samples sit above the picture it fits.
    fn applyOutputHighlights(input: vec3f) -> vec3f {
      if (p[74] < 0.5) { return input; }
      if (p[74] == 3.0) { return clipToOutputTarget(input); }
      if (p[0] > 0.5) { return clipToOutputTarget(hdrPeakFit(hdrSoftCeiling(input))); }
      if (p[159] > 0.5) { return clipToOutputTarget(input); }
      return input;
    }
    // The tile work texture is allocated once at the largest tile plus halo and
    // reused, so an edge tile's valid region is smaller than the texture it
    // lives in. Every neighbourhood read has to clamp to the valid region, or
    // an edge tile samples whatever the previous tile left behind.
    fn validTileDimensions() -> vec2i {
      let textureSize = vec2i(textureDimensions(sourceTexture));
      if (arrayLength(&p) > 163u && p[162] > 0.0 && p[163] > 0.0) {
        return min(textureSize, vec2i(i32(p[162]), i32(p[163])));
      }
      return textureSize;
    }

    // The whole picture's size, which is not this tile's size. Any radius
    // expressed as a fraction of the frame -- or as a physical distance on the
    // film plane -- has to be derived from this, or a tile would compute a
    // different radius than the Direct render of the same grade.
    fn frameDimensions() -> vec2f {
      if (arrayLength(&p) > 165u && p[164] > 0.0 && p[165] > 0.0) {
        return vec2f(p[164], p[165]);
      }
      return vec2f(textureDimensions(sourceTexture));
    }

    // This pixel's position in the whole picture. Vignette is placed against
    // the frame and grain is a fixed field over it, so both must ask where they
    // are in the frame, not where they are in the tile. Direct leaves the tile
    // origin at zero, which makes this the identity.
    fn frameCoordinate(coordinate: vec2i) -> vec2i {
      if (arrayLength(&p) > 161u) {
        return coordinate + vec2i(i32(p[160]), i32(p[161]));
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
      var pixelsPerMm = max(dimensions.x / p[140], dimensions.y / p[141]);
      if (p[142] > 0.5 && p[142] < 1.5) { pixelsPerMm = dimensions.y / p[141]; }
      if (p[142] > 1.5) { pixelsPerMm = dimensions.x / p[140]; }
      return pixelsPerMm;
    }
    fn filmPhysicalOffset(percent35mmDiagonal: f32, maximumRadius: i32) -> i32 {
      let dimensions = frameDimensions();
      let radiusMm = 43.2666153 * max(percent35mmDiagonal, 0.0) / 100.0;
      return clamp(i32(round(filmPixelsPerMm(dimensions) * radiusMm)), 1, maximumRadius);
    }
    fn blurAtRadius(coordinate: vec2i, radius: i32) -> vec3f {
      let halfRadius = max(1, radius / 2);
      var total = sampleFilm(coordinate) * 4.0;
      total += sampleFilm(coordinate + vec2i(radius, 0));
      total += sampleFilm(coordinate + vec2i(-radius, 0));
      total += sampleFilm(coordinate + vec2i(0, radius));
      total += sampleFilm(coordinate + vec2i(0, -radius));
      total += sampleFilm(coordinate + vec2i(halfRadius, halfRadius));
      total += sampleFilm(coordinate + vec2i(-halfRadius, halfRadius));
      total += sampleFilm(coordinate + vec2i(halfRadius, -halfRadius));
      total += sampleFilm(coordinate + vec2i(-halfRadius, -halfRadius));
      return total / 12.0;
    }
    fn filmBlur(coordinate: vec2i, percentDiagonal: f32, maximumRadius: i32) -> vec3f {
      return blurAtRadius(coordinate, outputRelativeOffset(percentDiagonal, maximumRadius));
    }
    fn filmPhysicalBlur(coordinate: vec2i, percent35mmDiagonal: f32, maximumRadius: i32) -> vec3f {
      return blurAtRadius(coordinate, filmPhysicalOffset(percent35mmDiagonal, maximumRadius));
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
      let bloomMask = filmHighlightMask(rgb, p[94]);
      let bloom = rgb * bloomMask * bloomMask * select(0.0, 1.0, p[92] > 0.5 && p[93] > 0.0);
      let halationRadius = filmPhysicalOffset(p[88], 256);
      let edgeRadius = clamp(halationRadius / 4, 1, 16);
      let halation = halationEdgeSource(pixel, p[87], edgeRadius) * select(0.0, 1.0, p[85] > 0.5);
      return vec4f(bloom, halation);
    }
    // The spatial intermediates are a quarter-resolution grid anchored to the
    // frame at a strict factor of four, rather than a proportional rescale of
    // whatever texture they happen to live in. That is what lets a tile's grid
    // coincide with the frame's: with a halo that is a multiple of four, a
    // tile's texel j is the frame's texel j + haloRect.x / 4, covering the same
    // four source pixels the Direct render covered.
    const SPATIAL_SCALE: f32 = 4.0;

    fn validSpatialDimensions() -> vec2i {
      return (validTileDimensions() + vec2i(3)) / vec2i(4);
    }

    fn frameSpatialDimensions() -> vec2f {
      return ceil(frameDimensions() / SPATIAL_SCALE);
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
    fn spatialBlur(direction: vec2f, coordinate: vec2f) -> vec4f {
      // Bloom is an output-relative optical finish. Halation is a film-plane
      // distance and shares Film Format/capture geometry with grain and MTF.
      // Both are properties of the picture, so both are derived from the
      // frame's quarter-resolution size and not from this tile's.
      // Spatial intermediates are quarter resolution, so the CPU/export cap of
      // 256 full-resolution pixels becomes 64 samples in this texture.
      let frameSpatial = frameSpatialDimensions();
      let bloomRadius = clamp(length(frameSpatial) * max(p[95], 0.0) / 100.0, 0.25, 64.0);
      let halationRadiusMm = 43.2666153 * max(p[88], 0.0) / 100.0;
      let halationRadius = clamp(filmPixelsPerMm(frameSpatial) * halationRadiusMm, 0.25, 64.0);
      var bloomTotal = vec3f(0.0);
      var halationTotal = 0.0;
      var weightTotal = 0.0;
      for (var index: i32 = -4; index <= 4; index = index + 1) {
        let normalized = f32(index) / 4.0;
        let weight = exp(-4.5 * normalized * normalized);
        bloomTotal += sampleSpatialTexel(coordinate + direction * normalized * bloomRadius).rgb * weight;
        halationTotal += sampleSpatialTexel(coordinate + direction * normalized * halationRadius).a * weight;
        weightTotal += weight;
      }
      return vec4f(bloomTotal / weightTotal, halationTotal / weightTotal);
    }
    fn grainHash(coordinate: vec2f, salt: f32) -> f32 {
      return fract(sin(dot(coordinate, vec2f(12.9898, 78.233)) + p[109] * 0.001 + salt) * 43758.5453) * 2.0 - 1.0;
    }
    fn grainValueNoise(coordinate: vec2f, salt: f32) -> f32 {
      let cell = floor(coordinate);
      let local = fract(coordinate);
      let blend = local * local * (vec2f(3.0) - 2.0 * local);
      let top = mix(grainHash(cell, salt), grainHash(cell + vec2f(1.0, 0.0), salt), blend.x);
      let bottom = mix(grainHash(cell + vec2f(0.0, 1.0), salt), grainHash(cell + vec2f(1.0, 1.0), salt), blend.x);
      return mix(top, bottom, blend.y);
    }
    fn applyFilmLook(coordinate: vec2i) -> vec3f {
      var rgb = sampleFilm(coordinate);
      if (p[78] >= 0.5 && p[79] > 0.0) {
        var spatial = vec4f(0.0);
        if (p[85] > 0.5 || (p[92] > 0.5 && p[93] > 0.0)) {
          spatial = sampleSpatialTexel((vec2f(coordinate) + vec2f(0.5)) / SPATIAL_SCALE);
        }
        if (p[85] > 0.5) {
          let halationRadius = filmPhysicalOffset(p[88], 256);
          let edgeRadius = clamp(halationRadius / 4, 1, 16);
          let edgeSource = halationEdgeSource(coordinate, p[87], edgeRadius);
          let haloY = max(spatial.a - edgeSource * 0.15, 0.0);
          let angle = radians(12.0 + 45.0 * p[89]);
          let warm = vec3f(1.0, 0.34 + 0.18 * sin(angle), 0.07 + 0.10 * max(cos(angle), 0.0));
          let warmY = lumaSrgb(warm);
          let canonicalTintSrgb = mix(vec3f(warmY), warm, clamp(p[90], 0.0, 1.0));
          let tint = select(canonicalTintSrgb, srgbToAcescg(canonicalTintSrgb), p[0] > 0.5);
          if (p[91] > 0.5) { return vec3f(clamp(filmSignalFromLuma(haloY), 0.0, 1.0)); }
          rgb += haloY * tint * (0.42 * p[86] * p[79]);
        }
        if (p[92] > 0.5 && p[93] > 0.0) {
          let bloomMask = filmHighlightMask(rgb, p[94]);
          let qualified = rgb * bloomMask * bloomMask;
          let amount = p[93] * p[79];
          let additive = spatial.rgb * (0.22 * amount);
          let diffusion = (spatial.rgb - qualified) * ((1.0 - p[96]) * 0.35 * amount);
          rgb = max(rgb + additive + diffusion, vec3f(0.0));
        }
        if (p[97] > 0.5 && (abs(p[98]) > 0.000001 || abs(p[99]) > 0.000001)) {
          let structureBlur = filmBlur(coordinate, 0.06, 24);
          let structureSource = rgb;
          rgb = structureSource
            + (structureBlur - structureSource) * p[98] * p[79] * 0.65
            + (structureSource - structureBlur) * p[99] * p[79] * 0.5;
        }
        if (p[108] < 1.0) {
          let resolutionLoss = (1.0 - p[108]) * p[79];
          let resolutionSource = sampleFilm(coordinate);
          let resolutionBlur = filmPhysicalBlur(coordinate, 0.04 + 0.08 * resolutionLoss, 32);
          let fineDetail = resolutionSource - resolutionBlur;
          let relativeDetail = max(abs(fineDetail.r), max(abs(fineDetail.g), abs(fineDetail.b)))
            / (max(abs(resolutionSource.r), max(abs(resolutionSource.g), abs(resolutionSource.b))) + 0.02);
          let edgeProtection = smoothRange(0.025, 0.20, relativeDetail);
          rgb -= fineDetail * resolutionLoss * 0.85 * (1.0 - edgeProtection);
        }
      }
      rgb = applyVignette(rgb, coordinate);
      if (p[156] > 0.5 && p[157] > 0.0 && p[100] > 0.5 && (p[101] > 0.0 || p[158] > 0.5)) {
        let pixelsPerMm = filmPixelsPerMm(frameDimensions());
        let physicalPitch = pixelsPerMm * (6.0 + 24.0 * p[102]) / 1000.0;
        let pitch = max(1.0, physicalPitch);
        let pixelCoverage = min(1.0, physicalPitch);
        let grainCoordinate = vec2f(frameCoordinate(coordinate)) / pitch;
        let mono = mix(grainValueNoise(grainCoordinate, 0.0), grainValueNoise(grainCoordinate * 0.53, 17.0), p[103] * 0.55);
        let signal = clamp(filmSignalFromLuma(max(filmLuma(rgb), 0.0)), 0.0, 1.0);
        let shadowWeight = pow(1.0 - signal, 2.0);
        let highlightWeight = pow(signal, 2.0);
        let midWeight = max(0.0, 1.0 - shadowWeight - highlightWeight);
        let response = shadowWeight * p[105] + midWeight * p[106] + highlightWeight * p[107];
        let amount = 0.18 * p[101] * p[157] * response * pixelCoverage;
        // The view map swaps the picture for a neutral mid-grey card once the
        // tonal response has been read from it, isolating the grain field.
        if (p[158] > 0.5) { rgb = vec3f(filmLumaFromSignal(0.5)); }
        rgb *= exp2(vec3f(mono * amount));
        if (p[104] > 0.0) {
          let chroma = vec3f(grainValueNoise(grainCoordinate, 31.0), grainValueNoise(grainCoordinate, 59.0), grainValueNoise(grainCoordinate, 83.0));
          let chromaHighlightGuard = 1.0 - 0.8 * smoothRange(0.88, 1.0, signal);
          rgb *= exp2(chroma * amount * p[104] * chromaHighlightGuard * 0.45);
        }
      }
      return max(rgb, vec3f(0.0));
    }
    fn applyVignette(rgb: vec3f, coordinate: vec2i) -> vec3f {
      if (p[123] < 0.5 || abs(p[124]) < 0.000001) { return rgb; }
      let dimensions = frameDimensions();
      let center = vec2f(p[129], p[130]) * max(dimensions - vec2f(1.0), vec2f(1.0));
      let scale = max(1.0, 0.5 * min(dimensions.x, dimensions.y));
      let delta = abs((vec2f(frameCoordinate(coordinate)) - center) / scale);
      let exponent = max(p[126], 1.0);
      let radius = pow(pow(delta.x, exponent) + pow(delta.y, exponent), 1.0 / exponent);
      var mask = smoothRange(p[125], p[125] + p[127], radius);
      if (p[124] < 0.0 && p[128] > 0.0) {
        let highlight = smoothRange(0.55, 0.95, filmSignalFromLuma(max(filmLuma(rgb), 0.0)));
        mask *= 1.0 - highlight * p[128];
      }
      return max(rgb * exp2(p[124] * mask), vec3f(0.0));
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
      return neutral + chroma * max(0.0, 1.0 + p[12] * vibranceWeight) * max(0.0, 1.0 + p[11]);
    }

    fn applyLocalGrade(input: vec3f) -> vec3f {
      let hdr = p[0] > 0.5;
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.00000001);
      let pivot = max(p[8], 0.000001);
      let stops = log2(sourceY / pivot);
      let blacks = clamp((-stops - 3.0) / 3.0, 0.0, 1.0);
      let shadows = clamp(1.0 - abs(stops + 2.0) / 2.5, 0.0, 1.0);
      let midtones = clamp(1.0 - abs(stops) / 2.5, 0.0, 1.0);
      let highlights = clamp((stops - 0.5) / 3.0, 0.0, 1.0);
      let zoneEv = p[6] * blacks + p[5] * shadows + p[4] * midtones + p[3] * highlights;
      let targetStops = stops * exp2(p[7]) + zoneEv + p[2];
      var rgb = input * (pivot * exp2(clamp(targetStops, -32.0, 24.0)) / sourceY);
      if (hdr) {
        let offset = (p[9] - 6500.0) / 6500.0;
        rgb *= vec3f(1.0 + offset * 0.15, 1.0 + p[10] * 0.08, 1.0 - offset * 0.15);
        rgb = localSaturation(rgb);
      } else {
        var aces = srgbToAcescg(rgb);
        let offset = (p[9] - 6500.0) / 6500.0;
        aces *= vec3f(1.0 + offset * 0.15, 1.0 + p[10] * 0.08, 1.0 - offset * 0.15);
        rgb = acescgToSrgb(localSaturation(aces));
      }
      return max(rgb, vec3f(0.0));
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
      let y = select(lumaSrgb(rgb), lumaAces(rgb), p[0] > 0.5);
      return log2(max(y, DETAIL_LUMA_FLOOR));
    }

    fn detailRadii() -> vec4f {
      let dimensions = frameDimensions();
      let diagonal = length(dimensions);
      return vec4f(
        max(0.35, diagonal * 0.0003),
        max(0.70, diagonal * 0.0012),
        max(0.50, diagonal * p[151] / 100.0),
        max(0.30, p[153] * p[155])
      );
    }

    fn detailHorizontalBlur(coordinate: vec2f, radius: f32, halfSamples: i32, enabled: bool) -> f32 {
      let dimensions = vec2f(textureDimensions(spatialTexture));
      let valid = vec2f(validTileDimensions());
      let centerUv = clamp(coordinate + vec2f(0.5), vec2f(0.5), valid - vec2f(0.5)) / dimensions;
      let center = detailLogLuma(textureSampleLevel(spatialTexture, spatialSampler, centerUv, 0.0).rgb);
      if (!enabled) { return center; }
      var total = 0.0;
      var weightTotal = 0.0;
      for (var index: i32 = -8; index <= 8; index = index + 1) {
        if (abs(index) <= halfSamples) {
          let distance = 2.0 * f32(index) / f32(halfSamples);
          let weight = exp(-0.5 * distance * distance);
          let sampleUv = clamp(
            coordinate + vec2f(distance * radius, 0.0) + vec2f(0.5),
            vec2f(0.5), valid - vec2f(0.5)
          ) / dimensions;
          total += detailLogLuma(textureSampleLevel(spatialTexture, spatialSampler, sampleUv, 0.0).rgb) * weight;
          weightTotal += weight;
        }
      }
      return total / weightTotal;
    }

    fn detailVerticalBlur(coordinate: vec2f, radius: f32, channel: u32, halfSamples: i32, enabled: bool) -> f32 {
      let dimensions = vec2f(textureDimensions(spatialTexture));
      let valid = vec2f(validTileDimensions());
      let centerUv = clamp(coordinate + vec2f(0.5), vec2f(0.5), valid - vec2f(0.5)) / dimensions;
      let center = textureSampleLevel(spatialTexture, spatialSampler, centerUv, 0.0)[channel];
      if (!enabled) { return center; }
      var total = 0.0;
      var weightTotal = 0.0;
      for (var index: i32 = -8; index <= 8; index = index + 1) {
        if (abs(index) <= halfSamples) {
          let distance = 2.0 * f32(index) / f32(halfSamples);
          let weight = exp(-0.5 * distance * distance);
          let sampleUv = clamp(
            coordinate + vec2f(0.0, distance * radius) + vec2f(0.5),
            vec2f(0.5), valid - vec2f(0.5)
          ) / dimensions;
          total += textureSampleLevel(spatialTexture, spatialSampler, sampleUv, 0.0)[channel] * weight;
          weightTotal += weight;
        }
      }
      return total / weightTotal;
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
      return vec4f(
        detailHorizontalBlur(vec2f(coordinate), radii.x, 2, true),
        detailHorizontalBlur(vec2f(coordinate), radii.y, 2, true),
        detailHorizontalBlur(vec2f(coordinate), radii.z, 8, true),
        detailHorizontalBlur(vec2f(coordinate), radii.w, 3, true)
      );
    }

    @fragment fn detailVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let radii = detailRadii();
      return vec4f(
        detailVerticalBlur(vec2f(coordinate), radii.x, 0u, 2, true),
        detailVerticalBlur(vec2f(coordinate), radii.y, 1u, 2, true),
        detailVerticalBlur(vec2f(coordinate), radii.z, 2u, 8, true),
        detailVerticalBlur(vec2f(coordinate), radii.w, 3u, 3, true)
      );
    }

    @fragment fn detailCompositeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let uv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(textureDimensions(spatialTexture));
      let blurred = textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0);
      let sourceY = max(select(lumaSrgb(source), lumaAces(source), p[0] > 0.5), DETAIL_LUMA_FLOOR);
      let logY = log2(sourceY);
      var adjusted = logY;
      if (abs(p[149]) > 0.000001) {
        let edgeWeight = detailTextureEdgeWeight(vec2f(coordinate), logY, blurred.y);
        adjusted += (blurred.x - blurred.y) * edgeWeight * p[149];
      }
      if (abs(p[150]) > 0.000001) {
        let band = logY - blurred.z;
        let edgeWeight = exp(-(band / 0.75) * (band / 0.75));
        adjusted += band * edgeWeight * p[150];
      }
      if (p[152] > 0.000001) {
        let edge = logY - blurred.w;
        let qualification = select(smoothRange(p[154], p[154] + 0.04, abs(edge)), 1.0, p[154] <= 0.000001);
        let qualified = edge * qualification;
        let extrema = detailLocalExtrema(coordinate);
        let allowance = min(0.12 * (extrema.y - extrema.x), SHARPEN_HALO_ALLOWANCE_EV);
        adjusted = clamp(adjusted + qualified * p[152], extrema.x - allowance, extrema.y + allowance);
      }
      let delta = clamp(adjusted - logY, -16.0, 16.0);
      if (abs(delta) <= 0.0000001) { return vec4f(source, 1.0); }
      var result = source * exp2(delta);
      result = select(clamp(result, vec3f(0.0), vec3f(1.0)), max(result, vec3f(0.0)), p[0] > 0.5);
      return vec4f(result, 1.0);
    }

    fn localDetailRadii() -> vec4f {
      let dimensions = frameDimensions();
      let diagonal = length(dimensions);
      return vec4f(
        max(0.35, diagonal * 0.0003),
        max(0.70, diagonal * 0.0012),
        max(0.50, diagonal * p[16] / 100.0),
        max(0.30, p[18] * p[20])
      );
    }

    @fragment fn localDetailHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let radii = localDetailRadii();
      return vec4f(
        detailHorizontalBlur(vec2f(coordinate), radii.x, 2, true),
        detailHorizontalBlur(vec2f(coordinate), radii.y, 2, true),
        detailHorizontalBlur(vec2f(coordinate), radii.z, 8, true),
        detailHorizontalBlur(vec2f(coordinate), radii.w, 3, true)
      );
    }

    @fragment fn localDetailVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let radii = localDetailRadii();
      return vec4f(
        detailVerticalBlur(vec2f(coordinate), radii.x, 0u, 2, true),
        detailVerticalBlur(vec2f(coordinate), radii.y, 1u, 2, true),
        detailVerticalBlur(vec2f(coordinate), radii.z, 2u, 8, true),
        detailVerticalBlur(vec2f(coordinate), radii.w, 3u, 3, true)
      );
    }

    @fragment fn localDetailCompositeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let uv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(textureDimensions(spatialTexture));
      let blurred = textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0);
      let sourceY = max(select(lumaSrgb(source), lumaAces(source), p[0] > 0.5), DETAIL_LUMA_FLOOR);
      let logY = log2(sourceY);
      var adjusted = logY;
      if (abs(p[14]) > 0.000001) {
        let edgeWeight = detailTextureEdgeWeight(vec2f(coordinate), logY, blurred.y);
        adjusted += (blurred.x - blurred.y) * edgeWeight * p[14];
      }
      if (abs(p[15]) > 0.000001) {
        let band = logY - blurred.z;
        let edgeWeight = exp(-(band / 0.75) * (band / 0.75));
        adjusted += band * edgeWeight * p[15];
      }
      if (p[17] > 0.000001) {
        let edge = logY - blurred.w;
        let qualification = select(smoothRange(p[19], p[19] + 0.04, abs(edge)), 1.0, p[19] <= 0.000001);
        let qualified = edge * qualification;
        let extrema = detailLocalExtrema(coordinate);
        let allowance = min(0.12 * (extrema.y - extrema.x), SHARPEN_HALO_ALLOWANCE_EV);
        adjusted = clamp(adjusted + qualified * p[17], extrema.x - allowance, extrema.y + allowance);
      }
      let delta = clamp(adjusted - logY, -16.0, 16.0);
      if (abs(delta) <= 0.0000001) { return vec4f(source, 1.0); }
      var result = source * exp2(delta);
      result = select(clamp(result, vec3f(0.0), vec3f(1.0)), max(result, vec3f(0.0)), p[0] > 0.5);
      return vec4f(result, 1.0);
    }

    @fragment fn baseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let output = select(renderSdrBase(source), renderHdrBase(source), p[0] > 0.5);
      return vec4f(output, 1.0);
    }

    @fragment fn localAdjustmentFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let uv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(textureDimensions(spatialTexture));
      let influence = clamp(textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0).r * p[1] * p[13], 0.0, 1.0);
      return vec4f(mix(source, applyLocalGrade(source), influence), 1.0);
    }

    @fragment fn localCandidateFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      return vec4f(applyLocalGrade(textureLoad(sourceTexture, coordinate, 0).rgb), 1.0);
    }

    @fragment fn localDetailMixFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = vec2u(validTileDimensions());
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let uv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(textureDimensions(spatialTexture));
      let influence = clamp(textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0).r * p[1] * p[13], 0.0, 1.0);
      let candidate = textureLoad(overlayMaskTexture, coordinate, 0).rgb;
      return vec4f(mix(source, candidate, influence), 1.0);
    }

    @fragment fn filmResponseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      return vec4f(filmResponse(textureLoad(sourceTexture, coordinate, 0).rgb), 1.0);
    }

    @fragment fn spatialExtractFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let center = input.position.xy * SPATIAL_SCALE;
      let offset = vec2f(SPATIAL_SCALE * 0.25);
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
    @fragment fn finishFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), validTileDimensions() - vec2i(1));
      return vec4f(applyFilmLook(coordinate), 1.0);
    }

    fn finishedAt(coordinate: vec2i) -> vec3f {
      return textureLoad(sourceTexture, boundedCoordinate(coordinate), 0).rgb;
    }
    fn scopeOutputAt(coordinate: vec2i) -> vec3f {
      let filmOutput = applyOutputHighlights(finishedAt(coordinate));
      return select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), max(filmOutput, vec3f(0.0)), p[0] > 0.5);
    }
    fn scopePeakSignal(rgb: vec3f) -> f32 {
      return max(select(lumaSrgb(rgb), lumaAces(rgb), p[0] > 0.5), 0.0);
    }
    @fragment fn scopeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let targetDimensions = max(vec2f(p[136], p[137]), vec2f(1.0));
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
      let grid = max(vec2u(u32(p[136]), u32(p[137])), vec2u(1u));
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
          peak = max(peak, scopePeakSignal(scopeOutputAt(vec2i(i32(x), i32(y)))));
        }
      }
      return vec4f(peak, peak, peak, peak);
    }

    @fragment fn settledScopeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let targetDimensions = max(vec2u(u32(p[136]), u32(p[137])), vec2u(1u));
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

    @fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      // This is the one pass whose render target is the whole canvas while its
      // input may be a single tile, so it is the one place that has to convert
      // a global fragment position into a tile-local texel. p[160..161] are the
      // tile origin, and Direct leaves them at zero.
      let tileOrigin = vec2i(i32(p[160]), i32(p[161]));
      let coordinate = clamp(vec2i(input.position.xy) - tileOrigin, vec2i(0), vec2i(dimensions) - vec2i(1));
      let filmOutput = applyOutputHighlights(finishedAt(coordinate));
      let output = select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), displayHdr(filmOutput), p[0] > 0.5);
      var encoded = displayEncode(output);
      if (p[131] > 0.5) {
        let uv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(textureDimensions(overlayMaskTexture));
        let mask = textureSampleLevel(overlayMaskTexture, spatialSampler, uv, 0.0).r;
        encoded = mix(encoded, vec3f(p[133], p[134], p[135]), clamp(mask * p[132] * 0.52, 0.0, 0.52));
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

    @fragment fn lumaQualificationFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let luma = textureLoad(sourceTexture, pixelCoordinate(input.position.xy), 0).r;
      let ev = log2(max(luma, 0.00000001) / 0.18);
      let rise = clamp((ev - p[0]) / max(p[1] - p[0], 0.000001), 0.0, 1.0);
      let fall = clamp((p[3] - ev) / max(p[3] - p[2], 0.000001), 0.0, 1.0);
      let mask = min(rise, fall);
      return vec4f(mask, mask, mask, 1.0);
    }

    @fragment fn maskRefinementFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = pixelCoordinate(input.position.xy);
      let sigma = select(p[0], p[1], p[2] > 0.5);
      var value = textureLoad(sourceTexture, coordinate, 0).r;
      if (sigma >= 0.25) {
        let direction = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), p[2] > 0.5);
        let stepSize = max(1.0, sigma * 0.25);
        var total = 0.0;
        var weightTotal = 0.0;
        for (var tap = -12; tap <= 12; tap = tap + 1) {
          let offset = f32(tap) * stepSize;
          let weight = exp(-0.5 * offset * offset / max(sigma * sigma, 0.000001));
          let sampleCoordinate = clamp(
            coordinate + vec2i(round(direction * offset)),
            vec2i(0),
            vec2i(dimensions) - vec2i(1),
          );
          total += textureLoad(sourceTexture, sampleCoordinate, 0).r * weight;
          weightTotal += weight;
        }
        value = total / max(weightTotal, 0.000001);
      }
      if (p[3] > 0.5) { value = 1.0 - value; }
      return vec4f(value, value, value, 1.0);
    }

    @fragment fn maskCombineFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = pixelCoordinate(input.position.xy);
      let left = clamp(textureLoad(sourceTexture, coordinate, 0).r * p[1], 0.0, 1.0);
      let right = clamp(textureLoad(operandTexture, coordinate, 0).r * p[2], 0.0, 1.0);
      var value = max(left, right);
      if (p[0] > 0.5 && p[0] < 1.5) { value = left * right; }
      if (p[0] > 1.5) { value = left * (1.0 - right); }
      if (p[3] > 0.5) { value = 1.0 - value; }
      return vec4f(value, value, value, 1.0);
    }
  `;
})();
