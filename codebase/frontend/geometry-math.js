(function () {
  "use strict";

  function geometryTransformIsNeutral(geometry) {
    const crop = geometry?.crop || {};
    return (Number(geometry?.rotation) || 0) === 0
      && !geometry?.flip_horizontal
      && !geometry?.flip_vertical
      && Math.abs(Number(geometry?.straighten_angle) || 0) < 1e-8
      && Math.abs(Number(geometry?.perspective_horizontal) || 0) < 1e-8
      && Math.abs(Number(geometry?.perspective_vertical) || 0) < 1e-8
      && Math.abs(Number(geometry?.perspective_rotate) || 0) < 1e-8
      && Math.abs(Number(crop.x) || 0) < 1e-8
      && Math.abs(Number(crop.y) || 0) < 1e-8
      && Math.abs((Number(crop.width) || 1) - 1) < 1e-8
      && Math.abs((Number(crop.height) || 1) - 1) < 1e-8;
  }

  function projectivePoint(matrix, point) {
    const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
    if (Math.abs(denominator) < 1e-10) return { x: Number.NaN, y: Number.NaN };
    return {
      x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
      y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
    };
  }

  function rotatedFrameDimensions(source, geometry) {
    if (!source?.width || !source?.height || !geometry) return null;
    let width = Number(source.width);
    let height = Number(source.height);
    if ([90, 270].includes(Number(geometry.rotation) || 0)) [width, height] = [height, width];
    const angle = Math.abs((Number(geometry.straighten_angle) || 0) + (Number(geometry.perspective_rotate) || 0)) * Math.PI / 180;
    const sine = Math.abs(Math.sin(angle));
    const cosine = Math.abs(Math.cos(angle));
    if (sine < 1e-9) return { width, height };
    const widthIsLonger = width >= height;
    const sideLong = widthIsLonger ? width : height;
    const sideShort = widthIsLonger ? height : width;
    let safeWidth;
    let safeHeight;
    if (sideShort <= 2 * sine * cosine * sideLong || Math.abs(sine - cosine) < 1e-9) {
      const halfShort = 0.5 * sideShort;
      safeWidth = widthIsLonger ? halfShort / sine : halfShort / cosine;
      safeHeight = widthIsLonger ? halfShort / cosine : halfShort / sine;
    } else {
      const cosineDouble = cosine * cosine - sine * sine;
      safeWidth = (width * cosine - height * sine) / cosineDouble;
      safeHeight = (height * cosine - width * sine) / cosineDouble;
    }
    return {
      width: Math.max(1, Math.floor(Math.abs(safeWidth)) - 4),
      height: Math.max(1, Math.floor(Math.abs(safeHeight)) - 4),
    };
  }

  function sourcePixelFrameDimensions(source, geometry, coordinateMap = null) {
    if (!source?.width || !source?.height || !geometry) return null;
    if (coordinateMap?.fullOutputWidth && coordinateMap?.fullOutputHeight) {
      return { width: coordinateMap.fullOutputWidth, height: coordinateMap.fullOutputHeight };
    }
    const frame = rotatedFrameDimensions(source, geometry);
    const crop = geometry.crop || { x: 0, y: 0, width: 1, height: 1 };
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const left = clamp(Math.round(Number(crop.x || 0) * frame.width), 0, Math.max(0, frame.width - 1));
    const top = clamp(Math.round(Number(crop.y || 0) * frame.height), 0, Math.max(0, frame.height - 1));
    const right = clamp(Math.round((Number(crop.x || 0) + Number(crop.width || 1)) * frame.width), left + 1, frame.width);
    const bottom = clamp(Math.round((Number(crop.y || 0) + Number(crop.height || 1)) * frame.height), top + 1, frame.height);
    return { width: right - left, height: bottom - top };
  }

  /**
   * The exact size of the frame a render at `longEdge` produces, or null when
   * it is not known.
   *
   * The backend applies geometry to the source resized to that edge, and its
   * safe inset and crop round at that size. Scaling the full-resolution frame
   * lands a pixel away, which is enough for a region fetched against the
   * guess to miss the last column of the real frame. Only the coordinate map
   * fitted at this edge states the size; without geometry it is the resize.
   */
  function frameSizeAtEdge(source, geometry, longEdge, edgeMap = null) {
    if (!source?.width || !source?.height || !(longEdge > 0)) return null;
    if (geometryTransformIsNeutral(geometry)) {
      const scale = Math.min(1, longEdge / Math.max(source.width, source.height));
      return {
        width: Math.max(1, Math.round(source.width * scale)),
        height: Math.max(1, Math.round(source.height * scale)),
      };
    }
    if (edgeMap?.outputWidth > 0 && edgeMap?.outputHeight > 0) {
      return { width: edgeMap.outputWidth, height: edgeMap.outputHeight };
    }
    return null;
  }

  function cropAspectRatio(geometry, source) {
    if (geometry.ratio_mode === "free") return null;
    if (geometry.ratio_mode === "original") {
      if (!source) return null;
      return [90, 270].includes(geometry.rotation) ? source.height / source.width : source.width / source.height;
    }
    if (geometry.ratio_mode === "custom") return geometry.custom_ratio.width / geometry.custom_ratio.height;
    const [width, height] = geometry.ratio_mode.split(":").map(Number);
    return width / height;
  }

  function projectiveMatrixIsAffine(matrix) {
    return matrix?.length === 9
      && Math.abs(Number(matrix[6])) < 1e-10
      && Math.abs(Number(matrix[7])) < 1e-10
      && Math.abs(Number(matrix[8])) > 1e-10;
  }

  function projectPathNodeToOutput(node, matrix) {
    const projected = { ...node, ...projectivePoint(matrix, node) };
    for (const prefix of ["in", "out"]) {
      const source = { x: node?.[`${prefix}_x`], y: node?.[`${prefix}_y`] };
      if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) continue;
      const handle = projectivePoint(matrix, source);
      projected[`${prefix}_x`] = handle.x;
      projected[`${prefix}_y`] = handle.y;
    }
    return projected;
  }

  function projectMaskExpressionToOutput(expression, matrix) {
    if (!expression) return expression;
    if (expression.operator !== "leaf") {
      return {
        ...expression,
        children: (expression.children || []).map((child) => projectMaskExpressionToOutput(child, matrix)),
      };
    }
    const leaf = expression.leaf;
    if (!leaf) return expression;
    const projectedLeaf = { ...leaf };
    if (leaf.type === "linear_gradient") {
      projectedLeaf.start = projectivePoint(matrix, leaf.start);
      projectedLeaf.end = projectivePoint(matrix, leaf.end);
    } else if (leaf.type === "path") {
      projectedLeaf.nodes = (leaf.nodes || []).map((node) => projectPathNodeToOutput(node, matrix));
      projectedLeaf.feather_nodes = (leaf.feather_nodes || []).map((node) => projectPathNodeToOutput(node, matrix));
    }
    return { ...expression, leaf: projectedLeaf };
  }

  const HDRGeometryMath = Object.freeze({
    geometryTransformIsNeutral,
    projectivePoint,
    rotatedFrameDimensions,
    sourcePixelFrameDimensions,
    frameSizeAtEdge,
    cropAspectRatio,
    projectiveMatrixIsAffine,
    projectPathNodeToOutput,
    projectMaskExpressionToOutput,
  });

  if (typeof window !== "undefined") window.HDRGeometryMath = HDRGeometryMath;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRGeometryMath };
})();
