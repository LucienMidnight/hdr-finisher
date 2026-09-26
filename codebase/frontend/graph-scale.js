(function () {
  "use strict";

  /**
   * The processing-scale contract for the preview graph (sprint PRD Phase 3
   * item 3; PRD 5.9 module parity policy).
   *
   * Every spatial module in the graph is asked two questions at a processing
   * scale that is not necessarily native: where is its radius, and how far past
   * its own rectangle does it read. This module answers both in one place, so
   * the declaration below is the contract and the functions beside it are its
   * arithmetic. `webgpu-preview.js` consumes them for the tile halo, which is
   * the number a missing conversion would turn into a seam.
   *
   * The scale itself is the ratio the CPU reference already uses:
   *
   *     source_pixel_scale = min(1, processing_edge / source_long_edge)
   *
   * (`render_cache.py`, `sessions.py`, `detail.py`). Processing never exceeds
   * native 1.0: CSS magnification must not buy more pixels (PRD 4.2). A radius
   * the user authored in source pixels -- Detail's sharpen radius is the one
   * live case -- converts by multiplying by this scale. A radius authored as a
   * fraction of the frame or as a physical distance on the film plane does not
   * convert at all, because the processing frame is the frame.
   *
   * This file is pure arithmetic and declarations. It holds no GPU resources
   * and performs no rendering, so it is unit-testable on its own.
   */

  const CONTRACT_VERSION = 1;

  // The quarter-resolution grid the spatial stage runs on. Mirrors
  // `SPATIAL_SCALE` in the shader; the halo converts a quarter-res reach back
  // to full resolution by this factor.
  const SPATIAL_SCALE = 4;

  // Film gate widths the pixels-per-mm conversion divides by, in millimetres.
  // p[140] and p[141] are the gate dimensions, p[142] selects the axis the
  // pixels-per-mm figure is taken from (0 = longer, 1 = width, 2 = height).
  const FILM_GATE_WIDTH_INDEX = 140;
  const FILM_GATE_HEIGHT_INDEX = 141;
  const FILM_GATE_AXIS_INDEX = 142;

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  /**
   * The canonical processing scale of one pass.
   *
   * `sourceSize` is the imported source's dimensions, before geometry;
   * `frame` is the geometry-fixed processing frame (a proxy's `width`/
   * `height`, which stay the frame's even when the texture carries only a
   * region). The result is clamped to 1.0 so an upscaled view is not treated
   * as a reason to process more pixels.
   */
  function processingScaleFor(sourceSize, frame) {
    const frameWidth = Math.max(1, finiteNumber(frame?.width, 1));
    const frameHeight = Math.max(1, finiteNumber(frame?.height, 1));
    const sourceLongEdge = Math.max(
      finiteNumber(sourceSize?.width, 0) || frameWidth,
      finiteNumber(sourceSize?.height, 0) || frameHeight,
    );
    return Math.min(1, Math.max(frameWidth, frameHeight) / Math.max(1, sourceLongEdge));
  }

  /**
   * Which optional stages this parameter set actually switches on.
   *
   * The planner, the encoder and the halo all ask this question, so it is
   * answered once, from grade-derived slots only, and must not depend on the
   * scale: a coarse pass and a refined pass enable the same modules (PRD 4.3).
   */
  function graphActivity(params) {
    const filmActive = params[78] > 0.5 && params[79] > 0;
    // Halation and bloom are the two stages that need the quarter-resolution
    // pair, because they are the two that blur on it.
    const spatialActive = filmActive
      && (params[85] > 0.5 || (params[92] > 0.5 && params[93] > 0));
    // Image structure and film resolution blur the film texture directly, at
    // full resolution. They allocate nothing, but they read past the pixel
    // they are writing just as surely, so they need a halo.
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

  function localDetailGrade(local, lane) {
    return local?.[`${lane}_grade`]?.detail || {};
  }

  /**
   * Whether a local grade switches its Detail stage on. The encoder asks this
   * to pick the ordered local chain, the metrics ask it to count band stacks
   * and the halo asks it to decide whether to reserve one; one answer, so a
   * local cannot be counted as active for the halo and inactive for the chain.
   */
  function localDetailActive(grade) {
    const detail = grade?.detail || {};
    return [detail.texture_amount, detail.clarity_amount, detail.sharpen_amount]
      .some((value) => Math.abs(Number(value) || 0) > 0.000001);
  }

  /**
   * The four separable analysis radii the Detail stage runs at, in processing
   * pixels: fine texture, coarse texture, clarity, sharpen. The shader's
   * `detailRadii()` and `localDetailRadii()` are the same four expressions;
   * this is the JS side of that mirror, which is why the halo below can be
   * derived from the same numbers the shader will use.
   *
   * The local sharpen radius converts through the *same* scale as the global
   * one: the local shader reads its own parameter buffer, where slot 20 holds
   * this identical source-pixel scale.
   */
  function detailRadii(width, height, params, localAdjustments = [], lane = "hdr") {
    const diagonal = Math.hypot(Math.max(1, finiteNumber(width, 1)), Math.max(1, finiteNumber(height, 1)));
    // `Number(params?.[155]) || 1` is the renderer's own fallback: an unset
    // scale slot reads as native. The global radius uses it directly; the
    // local radius applies the same 0.05 floor the local parameter build does.
    const rawScale = finiteNumber(params?.[155], 0) || 1;
    const localScale = Math.min(1, Math.max(0.05, rawScale));
    const global = [
      Math.max(0.35, diagonal * 0.0003),
      Math.max(0.70, diagonal * 0.0012),
      Math.max(0.50, diagonal * finiteNumber(params?.[151], 0) / 100),
      Math.max(0.30, finiteNumber(params?.[153], 0) * rawScale),
    ];
    const locals = (Array.isArray(localAdjustments) ? localAdjustments : []).map((local) => {
      const detail = localDetailGrade(local, lane);
      return [
        Math.max(0.35, diagonal * 0.0003),
        Math.max(0.70, diagonal * 0.0012),
        Math.max(0.50, diagonal * Math.min(3, Math.max(0.2, finiteNumber(detail.clarity_radius_percent, 0.75))) / 100),
        Math.max(
          0.30,
          Math.min(3, Math.max(0.3, finiteNumber(detail.sharpen_radius_px, 0.8))) * localScale,
        ),
      ];
    });
    return { diagonal, sourcePixelScale: rawScale, global, locals };
  }

  // Clarity's blurred base is built on a brightness pyramid rather than by
  // sampling the full-resolution picture. The log luminance is box-averaged
  // down by 2^level until the blur is CLARITY_MAP_MIN_TEXELS to twice that
  // wide, blurred densely there, and brought back with a cubic B-spline. The
  // averaging happens in two steps -- to the frame's base block size (see
  // `clarityBaseScale`), then from those blocks to the radius's -- repeating
  // the frame's edge pixels, then its edge blocks, where a block runs off the
  // picture. The
  // box and the B-spline each blur a little themselves; the dense blur takes
  // exactly the rest, so the total spread is the requested sigma. Sampling the
  // full picture sparsely instead turns a smooth fade into a staircase.
  const CLARITY_MAP_MIN_TEXELS = 3;
  // The dense blur's kernel stops at this many of its own sigmas.
  const CLARITY_MAP_TAP_REACH = 3;
  // The Clarity Radius slider's lower bound, in percent of the diagonal.
  const CLARITY_RADIUS_MIN_PERCENT = 0.2;

  /**
   * The brightness map for one clarity sigma, in processing pixels. `detail.py`
   * `clarity_map_plan` is the same arithmetic in float64; the shader receives
   * these numbers rather than deriving them, so a level can never be chosen
   * differently on either side of a boundary.
   *
   * `reach` is how far from a pixel the map reads the picture: the B-spline
   * spans two coarse texels either side, each blurred texel reads `taps`
   * texels either side, and each texel averages its whole block.
   */
  function clarityMapPlan(sigma) {
    const target = Math.max(0.5, finiteNumber(sigma, 0.5));
    const level = target < 2 * CLARITY_MAP_MIN_TEXELS
      ? 0
      : Math.floor(Math.log2(target / CLARITY_MAP_MIN_TEXELS));
    const scale = 2 ** level;
    const inherent = level === 0 ? 0 : (1 - 4 ** -level) / 12 + 1 / 3;
    const denseSigma = Math.sqrt(Math.max((target / scale) ** 2 - inherent, 0));
    const taps = denseSigma > 0.000001 ? Math.ceil(CLARITY_MAP_TAP_REACH * denseSigma) : 0;
    const reach = level === 0 ? taps : Math.ceil((taps + 2.5) * scale);
    return { sigma: target, level, scale, denseSigma, taps, reach };
  }

  /** Clarity's sigma: a fraction of the processing frame's diagonal. */
  function claritySigma(width, height, radiusPercent) {
    const diagonal = Math.hypot(Math.max(1, finiteNumber(width, 1)), Math.max(1, finiteNumber(height, 1)));
    return Math.max(0.50, diagonal * Math.min(3, Math.max(CLARITY_RADIUS_MIN_PERCENT, finiteNumber(radiusPercent, 0.75))) / 100);
  }

  /**
   * The block size the picture is first averaged to, whatever the radius:
   * the map level of the slider's smallest radius on this frame. Every other
   * radius averages that base map further. Changing the radius therefore never
   * re-reads the picture, and the base map a frame keeps serves every radius.
   */
  function clarityBaseScale(width, height) {
    return clarityMapPlan(claritySigma(width, height, CLARITY_RADIUS_MIN_PERCENT)).scale;
  }

  /** Whether global Clarity runs, and so whether the frame map is needed. */
  function clarityActive(params) {
    return params[148] > 0.5 && Math.abs(finiteNumber(params[150], 0)) > 0.000001;
  }

  function localClarityActive(grade) {
    return Math.abs(finiteNumber(grade?.detail?.clarity_amount, 0)) > 0.000001;
  }

  /**
   * How far past its own rectangle a tile has to be correct for the Detail
   * stage.
   *
   * Separable analysis reaches two radii in each direction. Texture's edge
   * guide then reaches another two coarse radii into that packed band. The
   * extra two pixels cover the bilinear sample at the reach's edge.
   *
   * Global Clarity is absent: its map is built once for the whole frame, so a
   * tile only samples it. Local Clarity builds its map inside the tile, which
   * therefore has to carry the map's whole reach.
   */
  function detailReach(width, height, params, localAdjustments = [], lane = "hdr") {
    const { global, locals } = detailRadii(width, height, params, localAdjustments, lane);
    const reaches = [2 * global[0], 4 * global[1], 2 * global[3]];
    const grades = (Array.isArray(localAdjustments) ? localAdjustments : []).map((local) => local?.[`${lane}_grade`]);
    locals.forEach((radii, index) => {
      reaches.push(2 * radii[0], 4 * radii[1], 2 * radii[3]);
      if (localClarityActive(grades[index])) reaches.push(clarityMapPlan(radii[2]).reach);
    });
    return Math.ceil(Math.max(...reaches) + 2);
  }

  /**
   * The picture area around a tile the global Clarity map has to have seen
   * before that tile can be composited. It is not part of the tile halo: only
   * the map's own pre-pass reads it, and only the base grade runs there.
   */
  function clarityMapReach(width, height, params) {
    if (!clarityActive(params)) return 0;
    return clarityMapPlan(claritySigma(width, height, params?.[151])).reach;
  }

  /**
   * The reaches the film stage reads at, before they are composed into one
   * halo. Every number mirrors a line of the shader, because a halo derived
   * differently from the radius it covers is a seam waiting to appear at one
   * particular setting.
   */
  function spatialReachDetail(width, height, params) {
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const quarter = [
      Math.ceil(Math.max(1, finiteNumber(width, 1)) / SPATIAL_SCALE),
      Math.ceil(Math.max(1, finiteNumber(height, 1)) / SPATIAL_SCALE),
    ];
    const bloomActive = params[92] > 0.5 && params[93] > 0;
    const halationActive = params[85] > 0.5;

    // `spatialBlur`: a Gaussian sampled one texel apart out to floor(radius),
    // in quarter-resolution texels, capped at 64 by the shader exactly as it
    // is here. Rounding up below reserves one texel more than the kernel
    // reaches, which is the right way round: a halo shorter than the kernel
    // substitutes the tile's edge for the picture and shows a seam.
    let blurTexels = 0;
    if (bloomActive) {
      blurTexels = Math.max(blurTexels,
        clamp(Math.hypot(quarter[0], quarter[1]) * Math.max(finiteNumber(params[95], 0), 0) / 100, 0.25, 64));
    }
    if (halationActive) {
      // `filmPixelsPerMm` over the frame's quarter-resolution size.
      let pixelsPerMm = Math.max(
        quarter[0] / params[FILM_GATE_WIDTH_INDEX],
        quarter[1] / params[FILM_GATE_HEIGHT_INDEX],
      );
      if (params[FILM_GATE_AXIS_INDEX] > 0.5 && params[FILM_GATE_AXIS_INDEX] < 1.5) {
        pixelsPerMm = quarter[1] / params[FILM_GATE_HEIGHT_INDEX];
      }
      if (params[FILM_GATE_AXIS_INDEX] > 1.5) {
        pixelsPerMm = quarter[0] / params[FILM_GATE_WIDTH_INDEX];
      }
      blurTexels = Math.max(blurTexels,
        clamp(pixelsPerMm * 43.2666153 * Math.max(finiteNumber(params[88], 0), 0) / 100, 0.25, 64));
    }

    // Full-resolution reads: halation's edge source from `filmPhysicalOffset`,
    // the image-structure blur from `outputRelativeOffset(0.06, 24)`, and the
    // film-resolution blur from `filmPhysicalBlur(<= 0.12, 32)`. `blurAtRadius`
    // spans a square of exactly +/- its radius on each axis.
    const frameWidth = Math.max(1, finiteNumber(width, 1));
    const frameHeight = Math.max(1, finiteNumber(height, 1));
    const frameDiagonal = Math.hypot(frameWidth, frameHeight);
    let framePixelsPerMm = Math.max(
      frameWidth / params[FILM_GATE_WIDTH_INDEX],
      frameHeight / params[FILM_GATE_HEIGHT_INDEX],
    );
    if (params[FILM_GATE_AXIS_INDEX] > 0.5 && params[FILM_GATE_AXIS_INDEX] < 1.5) {
      framePixelsPerMm = frameHeight / params[FILM_GATE_HEIGHT_INDEX];
    }
    if (params[FILM_GATE_AXIS_INDEX] > 1.5) {
      framePixelsPerMm = frameWidth / params[FILM_GATE_WIDTH_INDEX];
    }
    const physicalOffset = (percent, maximum) => clamp(
      Math.round(framePixelsPerMm * 43.2666153 * Math.max(percent, 0) / 100), 1, maximum,
    );
    let direct = 0;
    if (halationActive) {
      direct = Math.max(direct, clamp(Math.floor(physicalOffset(finiteNumber(params[88], 0), 256) / 4), 1, 16));
    }
    const structureActive = params[97] > 0.5
      && (Math.abs(params[98]) > 0 || Math.abs(params[99]) > 0);
    if (structureActive) {
      direct = Math.max(direct, clamp(Math.round(frameDiagonal * 0.06 / 100), 1, 24));
    }
    if (params[108] < 1) {
      direct = Math.max(direct, physicalOffset(0.04 + 0.08 * (1 - params[108]) * params[79], 32));
    }

    const total = Math.ceil(blurTexels) * SPATIAL_SCALE + Math.ceil(direct);
    return {
      quarter,
      blurTexels,
      direct,
      total: total > 0 ? Math.ceil(total / SPATIAL_SCALE) * SPATIAL_SCALE : 0,
    };
  }

  function spatialReach(width, height, params) {
    return spatialReachDetail(width, height, params).total;
  }

  /**
   * How far past its rectangle a tile has to be correct for this whole graph.
   *
   * Detail runs before the film stage and the film stage reads a
   * neighbourhood of Detail's output, so the two reaches compose rather than
   * compete. The sum is rounded up to a multiple of four whenever the film
   * stage is involved, because that is what keeps a tile's halo rectangle on
   * a frame quarter-texel boundary and its spatial grid aligned with the
   * frame's.
   */
  function composedReach(width, height, params, localAdjustments = [], lane = "hdr") {
    const { detailActive, filmNeighbourhoodActive } = graphActivity(params);
    const localDetailOn = (Array.isArray(localAdjustments) ? localAdjustments : [])
      .some((local) => localDetailActive(local?.[`${lane}_grade`]));
    const detailHalo = (detailActive || localDetailOn)
      ? detailReach(width, height, params, localAdjustments, lane)
      : 0;
    const spatialHalo = filmNeighbourhoodActive ? spatialReach(width, height, params) : 0;
    const halo = spatialHalo > 0
      ? Math.ceil((detailHalo + spatialHalo) / SPATIAL_SCALE) * SPATIAL_SCALE
      : detailHalo;
    return { halo, detailHalo, spatialHalo };
  }

  /**
   * Round a composed halo up to a denoise tile's wavelet grid.
   *
   * A Haar decomposition indexes from the frame's origin, so a tile that
   * started off the grid would reconstruct against the wrong parity. The
   * alignment is 2^levels, and rounding *up* keeps the halo conservative.
   */
  function alignReach(halo, alignment) {
    const step = Math.max(1, Math.floor(finiteNumber(alignment, 1)));
    const value = Math.max(0, Math.floor(finiteNumber(halo, 0)));
    return step > 1 && value % step ? Math.ceil(value / step) * step : value;
  }

  /**
   * The declared contract, one entry per module the sprint names.
   *
   * `unit` says what the authored value means before any conversion:
   *   - `frame-diagonal` -- a fraction of the processing frame's diagonal;
   *   - `film-plane`     -- a physical distance on the 35 mm film plane;
   *   - `source-pixels`  -- pixels of the imported source, converted by scale;
   *   - `normalized`     -- 0..1 of the geometry-fixed output;
   *   - `pointwise`      -- no radius at all.
   * `radius` is the conversion in words; `halo` is which reach covers it;
   * `coarse` says whether the module may run at a reduced processing scale
   * (PRD 4.3: only scale-dependent sampling and radii may differ); `cache`
   * names the identity the module's result is keyed by, and `cpuFallback` the
   * reference implementation the parity contract is judged against.
   */
  const MODULE_SCALE_CONTRACT = Object.freeze([
    Object.freeze({
      id: "detail",
      label: "Detail (global)",
      unit: "frame-diagonal + source-pixels",
      radius: "texture and clarity are fractions of the processing frame's diagonal; "
        + "the sharpen radius converts from source pixels by the processing scale (p[155])",
      halo: "detail (texture and sharpen only; clarity reads a frame-level brightness map built "
        + "by its own pre-pass over clarityMapReach, so it adds nothing to the tile halo)",
      coarse: "yes",
      cache: "detail band tiles, keyed by upstream identity and the full parameter set; "
        + "amounts, sharpen threshold and the clarity radius are excluded because they consume "
        + "bands, not create them. The clarity map is keyed by the same upstream identity, and "
        + "a radius change only re-blurs it",
      cpuFallback: "apply_detail(..., source_pixel_scale)",
    }),
    Object.freeze({
      id: "detail-local",
      label: "Detail (local)",
      unit: "frame-diagonal + source-pixels",
      radius: "same conversion as global Detail; the local shader reads its own copy of the "
        + "source-pixel scale in slot 20",
      halo: "detail, including the clarity map's reach: a local builds its clarity map inside "
        + "the tile (PRD CLARITY-01 tracks moving it to a frame-level map)",
      coarse: "yes",
      cache: "detail band tiles, keyed by the preceding local's identity plus this local's "
        + "parameters and scale; the in-tile clarity map is rebuilt per tile",
      cpuFallback: "apply_local_stack -> _apply_local_grade -> apply_detail",
    }),
    Object.freeze({
      id: "denoise",
      label: "Denoise reconstruction",
      unit: "analysis-grid",
      radius: "no authored radius; the reconstruction is a Haar pyramid whose tile origins "
        + "must land on a 2^levels grid, so the composed halo is rounded up to it",
      halo: "wavelet-alignment",
      coarse: "scale-bound: the analysis runs at one long edge and its evidence is indexed "
        + "against that frame, so a pass at another scale renders undenoised rather than "
        + "wrongly until it is re-analysed (item 7 owns making the analysis edge scale-aware)",
      cache: "evidence cache keyed by the proxy identity (which carries long_edge) and the "
        + "locked analysis settings; live reconstruction controls are deliberately absent",
      cpuFallback: "denoise_tiles / denoise_reference",
    }),
    Object.freeze({
      id: "grain",
      label: "Film grain",
      unit: "film-plane",
      radius: "pitch is pixels-per-mm of the processing frame times the millimetre pitch; a "
        + "pitch below one processing pixel reduces coverage instead of growing the field",
      halo: "none (pointwise, frame-placed noise field)",
      coarse: "yes",
      cache: "none; the field is regenerated per pass from the frame anchor",
      cpuFallback: "apply_final_grain",
    }),
    Object.freeze({
      id: "bloom",
      label: "Bloom",
      unit: "frame-diagonal",
      radius: "a fraction of the processing frame's diagonal, sampled on the quarter-resolution "
        + "grid anchored to the frame",
      halo: "spatial",
      coarse: "yes",
      cache: "none",
      cpuFallback: "_apply_film_look bloom pass",
    }),
    Object.freeze({
      id: "halation",
      label: "Halation",
      unit: "film-plane",
      radius: "a 35 mm film-plane distance converted through the processing frame's "
        + "pixels-per-mm at quarter resolution",
      halo: "spatial",
      coarse: "yes",
      cache: "none",
      cpuFallback: "_apply_film_look halation pass",
    }),
    Object.freeze({
      id: "softness",
      label: "Image structure (softness, microcontrast, film resolution)",
      unit: "frame-diagonal + film-plane",
      radius: "the structure blur is a fraction of the frame diagonal; the film-resolution blur "
        + "is a film-plane distance; both read the film texture at full resolution",
      halo: "spatial",
      coarse: "yes",
      cache: "none",
      cpuFallback: "_apply_film_look structure pass",
    }),
    Object.freeze({
      id: "masks",
      label: "Local masks (brush, path, gradient, luma)",
      unit: "normalized",
      radius: "compiled backend-side in normalized source coordinates, so feather, shift edge "
        + "and path widths convert through the requested long edge; the GPU luma feather uses "
        + "sigma = 0.09 * amount * long_edge",
      halo: "tile halo (mask tiles are fetched for the tile's halo rect)",
      coarse: "yes",
      cache: "mask tiles keyed by session, local id, long_edge, geometry signature and the "
        + "spatial mask signature; influence-only opacity is excluded",
      cpuFallback: "compile_preview_mask / evaluate_mask",
    }),
    Object.freeze({
      id: "geometry",
      label: "Geometry",
      unit: "source-space",
      radius: "no radius; crop/rotate/perspective are applied before the graph, and the ROI "
        + "fetch region maps through the geometry-fixed frame at the pass's scale",
      halo: "the composed halo is computed in the geometry-fixed frame, so the fetch region "
        + "covers it after the same mapping",
      coarse: "yes",
      cache: "geometry signature is part of every proxy, mask and tile identity",
      cpuFallback: "apply_geometry",
    }),
    Object.freeze({
      id: "vignette",
      label: "Vignette",
      unit: "frame-relative (pointwise)",
      radius: "placement is a fraction of the frame; no neighbourhood",
      halo: "none",
      coarse: "yes",
      cache: "none",
      cpuFallback: "_apply_vignette",
    }),
  ]);

  const CONTRACT_BY_ID = new Map(MODULE_SCALE_CONTRACT.map((entry) => [entry.id, entry]));

  function moduleContract(id) {
    return CONTRACT_BY_ID.get(String(id)) || null;
  }

  const HDRGraphScale = Object.freeze({
    CONTRACT_VERSION,
    SPATIAL_SCALE,
    processingScaleFor,
    graphActivity,
    localDetailActive,
    detailRadii,
    detailReach,
    CLARITY_MAP_MIN_TEXELS,
    CLARITY_MAP_TAP_REACH,
    clarityMapPlan,
    claritySigma,
    clarityBaseScale,
    clarityActive,
    localClarityActive,
    clarityMapReach,
    spatialReachDetail,
    spatialReach,
    composedReach,
    alignReach,
    MODULE_SCALE_CONTRACT,
    moduleContract,
  });

  if (typeof window !== "undefined") window.HDRGraphScale = HDRGraphScale;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRGraphScale };
})();
