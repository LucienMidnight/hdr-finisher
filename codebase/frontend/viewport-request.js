(function () {
  "use strict";

  /**
   * Immutable viewport requests (sprint PRD Phase 2, work items 2, 6, 7, 9).
   *
   * A viewport request states exactly what the foreground is waiting for: the
   * visible output region, the padded region of interest that will survive a
   * small pan, the source region it maps back to, the halo the graph needs
   * around it, and the globally anchored tiles that cover the result. It is
   * frozen and carries no renderer state, so the same request can be compared,
   * logged and replayed.
   *
   * This module is geometry and contract only. It performs no GPU work and
   * holds no resources; the coordinator and the offscreen presentation target
   * that consume it land with the rest of Phase 2.
   */

  const DEFAULT_MINIMUM_ROI_FRACTION = 0.15;
  const DEFAULT_TILE_SIZE = 512;

  function toInt(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function normalizedRect(rect, width, height, fallbackToWhole = true) {
    if (!rect && !fallbackToWhole) return null;
    const source = rect || { x: 0, y: 0, width, height };
    const x = clamp(toInt(source.x, 0), 0, width);
    const y = clamp(toInt(source.y, 0), 0, height);
    const right = clamp(x + Math.max(0, toInt(source.width, 0)), x, width);
    const bottom = clamp(y + Math.max(0, toInt(source.height, 0)), y, height);
    return { x, y, width: right - x, height: bottom - y };
  }

  function freezeRect(rect) {
    return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  function sameRect(a, b) {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  /**
   * Pad the visible rect by a fraction of its own size on every side, then
   * clamp to the output. The padding is what makes a small pan reuse the
   * tiles already resident instead of re-rendering the whole viewport.
   */
  function paddedRoi(visible, outputWidth, outputHeight, fraction) {
    const padX = Math.ceil(visible.width * fraction);
    const padY = Math.ceil(visible.height * fraction);
    return normalizedRect({
      x: visible.x - padX,
      y: visible.y - padY,
      width: visible.width + padX * 2,
      height: visible.height + padY * 2,
    }, outputWidth, outputHeight);
  }

  /** The source-pixel region a padded output region maps back to. */
  function sourceRectFor(roi, output, source) {
    const scaleX = source.width / output.width;
    const scaleY = source.height / output.height;
    return normalizedRect({
      x: Math.floor(roi.x * scaleX),
      y: Math.floor(roi.y * scaleY),
      width: Math.ceil(roi.width * scaleX) + 1,
      height: Math.ceil(roi.height * scaleY) + 1,
    }, source.width, source.height);
  }

  /**
   * Globally anchored tiles intersecting `region`, in stable row-major order.
   * Anchoring is to the global grid origin, so the same output region keeps
   * the same identity across pans, zooms and grid changes.
   */
  function tilesCovering(region, tileSize) {
    const size = Math.max(64, Math.floor(Number(tileSize) || DEFAULT_TILE_SIZE));
    const tiles = [];
    const firstX = Math.floor(region.x / size) * size;
    const firstY = Math.floor(region.y / size) * size;
    for (let y = firstY; y < region.y + region.height; y += size) {
      for (let x = firstX; x < region.x + region.width; x += size) {
        const left = Math.max(x, region.x);
        const top = Math.max(y, region.y);
        const right = Math.min(x + size, region.x + region.width);
        const bottom = Math.min(y + size, region.y + region.height);
        if (right > left && bottom > top) {
          tiles.push(freezeRect({ x: left, y: top, width: right - left, height: bottom - top }));
        }
      }
    }
    return tiles;
  }

  class HDRViewportRequest {
    static get DEFAULT_MINIMUM_ROI_FRACTION() {
      return DEFAULT_MINIMUM_ROI_FRACTION;
    }

    /**
     * Build a frozen viewport request.
     *
     * `visible` is the region of the processed output the viewer can see, in
     * output pixels. Omit it (or pass null) for Fit, where the whole output is
     * visible. `source` is the source image size the output was derived from,
     * used only to map the ROI back to source coordinates.
     */
    static build(options = {}) {
      const output = {
        width: Math.max(1, toInt(options.output?.width, 0) || 1),
        height: Math.max(1, toInt(options.output?.height, 0) || 1),
      };
      const source = {
        width: Math.max(1, toInt(options.source?.width, output.width) || output.width),
        height: Math.max(1, toInt(options.source?.height, output.height) || output.height),
      };
      const halo = Math.max(0, toInt(options.halo, 0));
      const fraction = clamp(
        Number.isFinite(Number(options.minimumRoiFraction))
          ? Number(options.minimumRoiFraction)
          : DEFAULT_MINIMUM_ROI_FRACTION,
        0,
        1,
      );
      const fit = !options.visible;
      const visible = fit
        ? { x: 0, y: 0, width: output.width, height: output.height }
        : normalizedRect(options.visible, output.width, output.height);
      if (!visible.width || !visible.height) {
        throw new Error("A viewport request needs a visible region with area");
      }
      const roi = fit ? visible : paddedRoi(visible, output.width, output.height, fraction);
      const haloRect = normalizedRect({
        x: roi.x - halo,
        y: roi.y - halo,
        width: roi.width + halo * 2,
        height: roi.height + halo * 2,
      }, output.width, output.height);
      const tiles = fit
        ? tilesCovering({ x: 0, y: 0, width: output.width, height: output.height }, options.tileSize)
        : tilesCovering(haloRect, options.tileSize);
      const roiPixels = roi.width * roi.height;
      const processedPixels = haloRect.width * haloRect.height;
      return Object.freeze({
        version: 1,
        lane: String(options.lane || "hdr"),
        sessionId: options.sessionId ?? null,
        geometrySignature: String(options.geometrySignature || "{}"),
        applicationGeneration: toInt(options.applicationGeneration, 0),
        editRevision: toInt(options.editRevision, 0),
        output: Object.freeze(output),
        source: Object.freeze(source),
        dpr: Number.isFinite(Number(options.dpr)) ? Number(options.dpr) : 1,
        zoom: Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : 1,
        scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : 1,
        halo,
        minimumRoiFraction: fraction,
        fit,
        visible: freezeRect(visible),
        roi: freezeRect(roi),
        haloRect: freezeRect(haloRect),
        sourceRect: freezeRect(sourceRectFor(roi, output, source)),
        tiles: Object.freeze(tiles),
        telemetry: Object.freeze({
          outputPixels: output.width * output.height,
          roiPixels,
          processedPixels,
          // How much more work the halo and ROI padding ask for relative to
          // the padded region itself. Fit is 1: there is nothing to amplify.
          haloAmplification: roiPixels ? processedPixels / roiPixels : 1,
          tileCount: tiles.length,
          visibleTiles: tiles.filter((tile) => (
            tile.x < visible.x + visible.width && visible.x < tile.x + tile.width
            && tile.y < visible.y + visible.height && visible.y < tile.y + tile.height
          )).length,
        }),
      });
    }

    /**
     * Engineering switch support (work item 9): compare an ROI-rendered region
     * against the same region of a legacy whole-frame render.
     *
     * Both inputs are row-major pixel buffers with the same channel count. The
     * comparison is pointwise over the overlap of `roiRect` and `legacyRect`,
     * which is what the Phase 2 exit gate asks for.
     */
    static compareWithLegacy(options = {}) {
      const channels = Math.max(1, toInt(options.channels, 4));
      const tolerance = Number.isFinite(Number(options.tolerance)) ? Math.abs(Number(options.tolerance)) : 0;
      const roi = options.roiPixels;
      const legacy = options.legacyPixels;
      const roiRect = options.roiRect;
      const legacyRect = options.legacyRect;
      if (!roi || !legacy || !roiRect || !legacyRect) {
        throw new Error("compareWithLegacy needs both buffers and both rects");
      }
      const roiWidth = Math.max(1, toInt(options.roiWidth, roiRect.width));
      const legacyWidth = Math.max(1, toInt(options.legacyWidth, legacyRect.width));
      const left = Math.max(roiRect.x, legacyRect.x);
      const top = Math.max(roiRect.y, legacyRect.y);
      const right = Math.min(roiRect.x + roiRect.width, legacyRect.x + legacyRect.width);
      const bottom = Math.min(roiRect.y + roiRect.height, legacyRect.y + legacyRect.height);
      let comparedPixels = 0;
      let maxAbsDifference = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const roiIndex = ((y - roiRect.y) * roiWidth + (x - roiRect.x)) * channels;
          const legacyIndex = ((y - legacyRect.y) * legacyWidth + (x - legacyRect.x)) * channels;
          for (let channel = 0; channel < channels; channel += 1) {
            const difference = Math.abs(roi[roiIndex + channel] - legacy[legacyIndex + channel]);
            if (difference > maxAbsDifference) maxAbsDifference = difference;
          }
          comparedPixels += 1;
        }
      }
      return Object.freeze({
        comparedPixels,
        maxAbsDifference,
        tolerance,
        withinTolerance: comparedPixels > 0 && maxAbsDifference <= tolerance,
      });
    }

    static sameRect(a, b) {
      return Boolean(a && b) && sameRect(a, b);
    }

    /**
     * The tiles a foreground pass must process for one viewport: those that
     * intersect the visible region, in the plan's own order.
     *
     * Offscreen tiles are not part of the foreground batch (Phase 2 exit
     * gate). They stay resident for the pan cache and are refreshed only when
     * the viewport reaches them; the accepted frame keeps their pixels until
     * then. With no viewport every tile is foreground, which is Fit.
     */
    static foregroundTiles(tiles, viewport) {
      const list = Array.isArray(tiles) ? tiles : [];
      if (!viewport) return list;
      return list.filter((entry) => {
        const rect = entry && entry.rect ? entry.rect : entry;
        if (!rect) return false;
        return rect.x < viewport.x + viewport.width && viewport.x < rect.x + rect.width
          && rect.y < viewport.y + viewport.height && viewport.y < rect.y + rect.height;
      });
    }
  }

  if (typeof window !== "undefined") window.HDRViewportRequest = HDRViewportRequest;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRViewportRequest };
})();
