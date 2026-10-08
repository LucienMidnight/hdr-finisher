  // 160 and 161 carry the tile origin in global output coordinates. Direct
  // execution leaves them at zero, so its arithmetic is unchanged.
  // 160/161: tile origin; 162/163: valid tile extent; 164/165: full output
  // extent. Direct leaves the tile fields zero and falls back to the bound
  // texture dimensions. 166 is Denoise's Show noise view (0 off, 1 on, 2 on
  // with nothing removed); it is view state and never reaches an export.
  // 167-171 describe the Clarity brightness map this buffer's Clarity reads:
  // its block scale, dense-blur sigma and tap count (from `clarityMapPlan`),
  // and the frame texel that the bound map's texel (0, 0) holds. The global
  // buffer's map covers the frame, so its origin is zero; a local's map is
  // built inside its tile and starts at the tile's first block. 172-174 are
  // the same pair for the base map the picture is first averaged into (its
  // block size, then its origin), which every radius averages further.
  // 175 is the grain film type (0 color negative, 1 black & white) and 176
  // the high 16 bits of the grain seed, whose low half is 109.
  const PARAM_COUNT = 190;
  // Slots 186-189: the frame rectangle a mask texture covers when it is one
  // small bitmap stretched over the pass (a soft mask), else zero.
  const MASK_RECT_INDEX = 186;
  // A soft mask is drawn from the bitmap a Fit view already holds. When none
  // is resident it is asked for at this long edge. Above the larger edge a
  // frame is magnified and its soft masks come from the small bitmap.
  const SOFT_MASK_LONG_EDGE = 1600;
  const SOFT_MASK_MAX_EDGE = 3200;
  // Un-resampled scene luminance for source-space masks: tile side, resident
  // bytes, the largest feathered region one request may build, and the
  // largest it filters with exact boxes away from the frame edge.
  const ORIENTED_LUMINANCE_TILE = 2048;
  const ORIENTED_LUMINANCE_BYTES = 192 * 1024 * 1024;
  const ORIENTED_LUMA_REGION_PIXELS = 24 * 1024 * 1024;
  const ORIENTED_LUMA_EXACT_PIXELS = 12 * 1024 * 1024;
  const TILE_ORIGIN_X_INDEX = 160;
  const TILE_ORIGIN_Y_INDEX = 161;
  const NOISE_VIEW_INDEX = 166;
  const GRAIN_FILM_TYPE_INDEX = 175;
  const GRAIN_SEED_HIGH_INDEX = 176;
  const CLARITY_MAP_SCALE_INDEX = 167;
  const CLARITY_MAP_SIGMA_INDEX = 168;
  const CLARITY_MAP_TAPS_INDEX = 169;
  const CLARITY_MAP_ORIGIN_X_INDEX = 170;
  const CLARITY_MAP_ORIGIN_Y_INDEX = 171;
  const CLARITY_BASE_SCALE_INDEX = 172;
  const CLARITY_BASE_ORIGIN_X_INDEX = 173;
  const CLARITY_BASE_ORIGIN_Y_INDEX = 174;
  // The map stores each value as a half-float pair (value, remainder): the
  // pair keeps near-float precision in a format the filterable binding takes.
  const CLARITY_MAP_FORMAT = "rg16float";
  const CURVE_SAMPLES = 1024;
  const PEAK_HISTOGRAM_BINS = 4096;
  // The tile peak reduction target. A maximum is decomposable, so this grid
  // is a work-splitting device and not a picture: any size gives the exact same
  // answer. 64 x 64 keeps each fragment's loop to roughly (workTile / 64)^2
  // iterations -- about 64 for a 528-pixel work tile -- and the readback to
  // 32 KB per generation.
  const SCOPE_PEAK_GRID = 64;

  /**
   * The processing-scale contract shared by preview nodes and diagnostics.
   *
   * Every scale-dependent radius and every tile halo is declared and computed
   * in `graph-scale.js`, which the page loads before this file. The resolver is
   * deliberately lazy and loud: a build that forgot the script must fail at the
   * first halo computation rather than quietly reserve a halo of zero.
   */
  // Frame pixels per halation/bloom texel for a frame of this size. The rule
  // is HDRGraphScale.spatialGridScale; the memory models below also run where
  // that module is not loaded, so they fall back to the same rule.
  function spatialGridScale(width, height) {
    const contract = typeof window !== "undefined" ? window.HDRGraphScale : null;
    if (contract?.spatialGridScale) return contract.spatialGridScale(width, height);
    const longEdge = Math.max(Number(width) || 1, Number(height) || 1);
    if (longEdge >= 4096) return 4;
    return longEdge >= 2048 ? 2 : 1;
  }

  function graphScaleContract() {
    const module = (typeof window !== "undefined" && window.HDRGraphScale) || null;
    if (!module) {
      throw new Error("HDRGraphScale is not loaded; the processing-scale contract is required");
    }
    return module;
  }

  function sourceTransport() {
    const module = (typeof window !== "undefined" && window.HDRSourceTransport) || null;
    if (!module) {
      throw new Error("HDRSourceTransport is not loaded; bounded source transport is required");
    }
    return module;
  }

  function maskLoader() {
    const module = (typeof window !== "undefined" && window.HDRMaskLoader) || null;
    if (!module) {
      throw new Error("HDRMaskLoader is not loaded; bounded mask loading is required");
    }
    return module;
  }

  function scopeReadback() {
    const module = (typeof window !== "undefined" && window.HDRScopeReadback) || null;
    if (!module) {
      throw new Error("HDRScopeReadback is not loaded; scope readback is required");
    }
    return module;
  }

  function shaderSources() {
    const module = (typeof window !== "undefined" && window.HDRWebGPUShaders) || null;
    if (!module) {
      throw new Error("HDRWebGPUShaders is not loaded; WebGPU shader sources are required");
    }
    return module;
  }

  const {
    BLACK_AND_WHITE_PARAM,
    PEAK_REDUCTION_SHADER_SOURCE,
    ADAPTIVE_DENOISE_SHADER_SOURCE,
    SHADER_SOURCE,
    LUMA_MASK_SHADER_SOURCE,
  } = shaderSources();

  // Adaptive denoise: the WebGPU half of backend/hdr_finisher/denoise_adaptive.py.
  // Five undecimated B3 bands in an orthonormal luminance/opponent basis, each
  // scaled by a local Wiener gain against a per-pixel noise map from a model the
  // backend measures on this exact proxy. Every constant and every edge rule
  // mirrors the Python, so the preview and the export agree.
  const ADAPTIVE_DENOISE_ALGORITHM_VERSION = "adaptive-atrous-v1";
  const ADAPTIVE_DENOISE_LEVELS = 5;
  // A tile's result equals the whole frame's when its scratch extends this far:
  // the coarsest band reaches 62 pixels and the Wiener window 3 more.
  const ADAPTIVE_DENOISE_TILE = 512;
  const ADAPTIVE_DENOISE_MARGIN = 66;
  const ADAPTIVE_DENOISE_SCRATCH = ADAPTIVE_DENOISE_TILE + 2 * ADAPTIVE_DENOISE_MARGIN;
  // Per-dispatch uniform stride.
  const ADAPTIVE_DENOISE_SLOT = 256;

  /**
   * The live controls, mapped exactly as AdaptiveControls maps them in Python:
   * 0.5 everywhere is the measured result.
   */
  function adaptiveDenoiseStrengths(controls) {
    const overall = 2 * controls.amount;
    return {
      luma: overall * 2 * controls.luminance,
      chroma: overall * 2 * controls.colorNoise,
      fineMultiplier: 1 + Math.max(0, 0.5 - controls.detailRecovery),
      fineFloor: Math.max(0, controls.detailRecovery - 0.5) * 0.6,
      // By noise size, for both components: band 0, band 1, band 2, bands 3-4.
      sizeMultiplier: (level) => 2 * (level < 3 ? [controls.finestNoise, controls.fineNoise, controls.mediumNoise][level] : controls.coarseNoise),
    };
  }

  // The size controls only the adaptive method reads, validated like the rest.
  // Finest falls back to Fine, which covered both bands before it was split.
  function adaptiveDenoiseSizes(controls = {}) {
    const fallback = { finestNoise: controls.fineNoise };
    return Object.fromEntries(["finestNoise", "fineNoise", "mediumNoise", "coarseNoise"].map((name) => {
      const value = Number(controls[name] ?? fallback[name] ?? 0.5);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
      return [name, value];
    }));
  }

  // The grid a tile's halo and a region's origin are rounded to while Denoise
  // is on: 2 ** levels, and Denoise is set up with one level.
  function denoiseTileAlignment(levels) {
    if (!Number.isInteger(levels) || levels < 1 || levels > 4) {
      throw new Error("Denoise alignment supports one through four levels.");
    }
    return 2 ** levels;
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
    const spatialGrid = spatialGridScale(normalizedWidth, normalizedHeight);
    const spatialWidth = Math.ceil(normalizedWidth / spatialGrid);
    const spatialHeight = Math.ceil(normalizedHeight / spatialGrid);
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
   * the predicted peak â€” including retained-presentation overlap, transient
   * scratch, and a contingency margin â€” fits the configured budget and the
   * device's own limits.
   *
   * This function is pure: the same inputs always produce the same plan and the
   * same decision.
   */
  const DEFAULT_TILE_SIZE = 512;
  // A highlight measurement this many times the estimate (or the carried last
  // measurement) is measured once more before it is trusted.
  const HIGHLIGHT_ANCHOR_RECHECK_FACTOR = 8;
  function detailTileHalo(width, height, params, localAdjustments = [], lane = "hdr") {
    return graphScaleContract().detailReach(width, height, params, localAdjustments, lane);
  }

  /**
   * How far past its own rectangle a tile has to be correct for the film stage.
   *
   * Every number here mirrors a line of the shader, because a halo that is
   * derived differently from the radius it is covering is a seam waiting to
   * appear at one particular setting. The blur runs on the frame's spatial
   * grid (1, 2 or 4 pixels a texel), so its reach converts back by that; the extract
   * and the finish pass read the film texture directly and reach their own
   * short distances into it.
   *
   * The result is rounded up to a multiple of four so that a tile's halo
   * rectangle starts on a frame quarter-texel boundary. Without that the
   * tile's spatial grid would be offset from the frame's by one, two or three
   * pixels and could not be byte-exact against Direct whatever its size.
   */
  function spatialTileHalo(width, height, params) {
    return graphScaleContract().spatialReach(width, height, params);
  }

  // Tile position changes the uniform slots, but neither the local grade nor
  // the picture entering its Detail bands. Build those once per generation,
  // especially for brush masks whose serialized stroke history can be large.
  function buildTiledLocalState(proxyIdentity, params, locals, lane, sourcePixelScale = 1, curveOffsets = new Map()) {
    const states = locals.map((local) => ({
      params: buildLocalParams(local, lane, sourcePixelScale,curveOffsets.get(local.id) || 0), detailPrefix: null,
    }));
    let lastDetail = -1;
    locals.forEach((local, index) => {
      if (gpuLocalDetailActive(local[`${lane}_grade`])) lastDetail = index;
    });
    if (lastDetail < 0) return states;
    let precedingIdentity = `${proxyIdentity}|${JSON.stringify(Array.from(params))}`;
    locals.forEach((local, index) => {
      if (index > lastDetail) return;
      if (gpuLocalDetailActive(local[`${lane}_grade`])) {
        states[index].detailPrefix = `local:${local.id}|${detailBandIdentity(states[index].params, precedingIdentity, "local")}`;
      }
      if (index < lastDetail) {
        precedingIdentity += `|${JSON.stringify(gpuMaskRenderPayload(local.mask))}|${JSON.stringify(local[`${lane}_grade`])}|${local.opacity}`;
      }
    });
    return states;
  }

  function detailBandIdentity(params, inputIdentity, scope = "global") {
    const values = Array.from(params || []);
    // Amounts and sharpen threshold consume packed bands but do not create
    // them. Excluding them is what makes live drags true cache hits. Clarity
    // no longer has a packed band at all -- it reads its brightness map -- so
    // its radius and map description are excluded too, and a Radius drag
    // leaves every texture and sharpen band cached.
    const clarityMap = [
      CLARITY_MAP_SCALE_INDEX, CLARITY_MAP_SIGMA_INDEX, CLARITY_MAP_TAPS_INDEX,
      CLARITY_MAP_ORIGIN_X_INDEX, CLARITY_MAP_ORIGIN_Y_INDEX,
      CLARITY_BASE_SCALE_INDEX, CLARITY_BASE_ORIGIN_X_INDEX, CLARITY_BASE_ORIGIN_Y_INDEX,
    ];
    const ignored = scope === "global" ? [149, 150, 151, 152, 154] : [14, 15, 16, 17, 19];
    [...ignored, ...clarityMap].forEach((index) => { if (index < values.length) values[index] = 0; });
    return `${inputIdentity}|${JSON.stringify(values)}`;
  }

  /**
   * The texel extents of a Clarity map built from the picture rectangle
   * `x, y, width, height`: the base map's and the finished map's, each
   * covering every block the rectangle touches.
   */
  function clarityMapExtents(plan, x, y, width, height) {
    const extent = (scale, origin, size) => Math.ceil((origin + size) / scale) - Math.floor(origin / scale);
    return {
      scale: plan.scale,
      baseScale: plan.baseScale,
      width: extent(plan.scale, x, width),
      height: extent(plan.scale, y, height),
      baseWidth: extent(plan.baseScale, x, width),
      baseHeight: extent(plan.baseScale, y, height),
    };
  }

  /**
   * Describe the Clarity map a parameter buffer's Clarity will read. The
   * shader takes these numbers as given rather than deriving them, so the
   * pyramid level is chosen once, here, with the same float64 arithmetic as
   * `detail.py`. `originX`/`originY` is the picture pixel the maps are built
   * from: zero for a whole-frame map, the halo rectangle's corner for a map
   * built inside a tile.
   */
  function writeClarityPlan(values, width, height, radiusPercent, originX = 0, originY = 0) {
    const contract = graphScaleContract();
    const plan = contract.clarityMapPlan(contract.claritySigma(width, height, radiusPercent));
    const baseScale = Math.min(plan.scale, contract.clarityBaseScale(width, height));
    values[CLARITY_MAP_SCALE_INDEX] = plan.scale;
    values[CLARITY_MAP_SIGMA_INDEX] = plan.denseSigma;
    values[CLARITY_MAP_TAPS_INDEX] = plan.taps;
    values[CLARITY_MAP_ORIGIN_X_INDEX] = Math.floor(originX / plan.scale);
    values[CLARITY_MAP_ORIGIN_Y_INDEX] = Math.floor(originY / plan.scale);
    values[CLARITY_BASE_SCALE_INDEX] = baseScale;
    values[CLARITY_BASE_ORIGIN_X_INDEX] = Math.floor(originX / baseScale);
    values[CLARITY_BASE_ORIGIN_Y_INDEX] = Math.floor(originY / baseScale);
    return { ...plan, baseScale };
  }

  // A measurement patch can read Clarity's map from a reduced render of the
  // whole frame (`measurementClaritySurround`) instead of building it from
  // its own halo. The map texture then covers the blocks the halo rectangle
  // touches plus this margin, which is as far as the B-spline reads past the
  // block a pixel is in.
  const SURROUND_MAP_MARGIN = 2;

  function surroundMapRect(haloRect, scale) {
    const x = Math.floor(haloRect.x / scale) - SURROUND_MAP_MARGIN;
    const y = Math.floor(haloRect.y / scale) - SURROUND_MAP_MARGIN;
    return {
      x, y,
      width: Math.ceil((haloRect.x + haloRect.width) / scale) + SURROUND_MAP_MARGIN - x,
      height: Math.ceil((haloRect.y + haloRect.height) / scale) + SURROUND_MAP_MARGIN - y,
    };
  }

  // The grade as the halo sees it when those maps come from the surround:
  // that Clarity reaches no further than the tile itself.
  function surroundHaloParams(params, surround) {
    if (!surround?.global) return params;
    const values = params.slice();
    values[150] = 0;
    return values;
  }

  function surroundHaloLocals(locals, lane, surround) {
    if (!surround?.locals.size) return locals;
    return locals.map((local) => {
      const grade = local[`${lane}_grade`];
      if (!surround.locals.has(local.id) || !grade?.detail) return local;
      return { ...local, [`${lane}_grade`]: { ...grade, detail: { ...grade.detail, clarity_amount: 0 } } };
    });
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
        Math.ceil(workWidth / spatialGridScale(width, height)) * Math.ceil(workHeight / spatialGridScale(width, height)) * 8 * 2,
        { textures: 2, tile: true });
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
    const spatialPixels = Math.ceil(width / spatialGridScale(width, height)) * Math.ceil(height / spatialGridScale(width, height));
    const sourceBytesPerPixel = options.sourceBytesPerPixel === 16 ? 16 : 8;
    const detailActive = options.detailActive !== false;
    const spatialActive = options.spatialActive !== false;
    const denoiseLevels = Math.max(0, Math.min(4, Math.floor(Number(options.denoiseLevels ?? 0) || 0)));
    const cachedProxyLevels = Math.max(1, Math.floor(Number(options.cachedProxyLevels ?? 1) || 1));
    // The live planner knows what each resident source level really occupies.
    // Charging the current frame's size once per cached level counted a 1024
    // px mip as if it were native, so a 42 MP render was charged 2.37 GB for
    // 339 MB of source.
    const residentSourceBytes = Number.isFinite(Number(options.sourceProxyBytes))
      ? Math.max(0, Number(options.sourceProxyBytes)) : null;
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

    add("source-proxy", "source", "cached", residentSourceBytes ?? pixels * sourceBytesPerPixel * cachedProxyLevels,
      { levels: cachedProxyLevels, bytesPerPixel: sourceBytesPerPixel, measured: residentSourceBytes !== null });
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

