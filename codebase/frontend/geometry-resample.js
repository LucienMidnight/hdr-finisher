(function () {
  'use strict';
  // The export geometry stage for straighten and perspective, as arithmetic:
  // Pillow's output-pixel to input-pixel coefficients, the safe inset and the
  // crop rounding of backend finishing.apply_geometry. Masks are warped by
  // exactly this map; a fitted homography is not a substitute.
  const pyRound = n => { const f = Math.floor(n), d = n - f; return d === .5 ? f + (f % 2 ? 1 : 0) : Math.round(n); };
  const clip = (n, low, high) => Math.min(high, Math.max(low, n));
  const fixed = (n, digits) => Number(n.toFixed(digits));

  function cropBounds(width, height, crop = {}) {
    const x = Number(crop.x || 0), y = Number(crop.y || 0);
    const left = clip(pyRound(x * width), 0, width - 1), top = clip(pyRound(y * height), 0, height - 1);
    return { left, top,
      right: clip(pyRound((x + Number(crop.width ?? 1)) * width), left + 1, width),
      bottom: clip(pyRound((y + Number(crop.height ?? 1)) * height), top + 1, height) };
  }

  function largestRotatedRectangle(width, height, angle) {
    const sin = Math.abs(Math.sin(angle)), cos = Math.abs(Math.cos(angle));
    if (sin < 1e-9) return [width, height];
    const wider = width >= height, long = wider ? width : height, short = wider ? height : width;
    if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-9) {
      const half = .5 * short;
      return [Math.abs(wider ? half / sin : half / cos), Math.abs(wider ? half / cos : half / sin)];
    }
    const cos2 = cos * cos - sin * sin;
    return [Math.abs((width * cos - height * sin) / cos2), Math.abs((height * cos - width * sin) / cos2)];
  }

  // Image.rotate(angle, BICUBIC, expand=True) followed by the centred inset.
  function rollStage(width, height, degrees) {
    const angle = ((degrees % 360) + 360) % 360;
    if ([0, 90, 180, 270].includes(angle)) return null;
    const radians = -(angle * (Math.PI / 180));
    const m = [fixed(Math.cos(radians), 15), fixed(Math.sin(radians), 15), 0,
      fixed(-Math.sin(radians), 15), fixed(Math.cos(radians), 15), 0];
    const transform = (x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
    const cx = width / 2, cy = height / 2;
    [m[2], m[5]] = transform(-cx, -cy);
    m[2] += cx; m[5] += cy;
    const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => transform(x, y));
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const expandedWidth = Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs));
    const expandedHeight = Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys));
    [m[2], m[5]] = transform(-(expandedWidth - width) / 2, -(expandedHeight - height) / 2);
    const [safeW, safeH] = largestRotatedRectangle(width, height, Math.abs(degrees) * (Math.PI / 180));
    const safeWidth = Math.max(1, Math.min(Math.floor(safeW) - 4, expandedWidth));
    const safeHeight = Math.max(1, Math.min(Math.floor(safeH) - 4, expandedHeight));
    return { coefficients: [...m, 0, 0], left: Math.floor((expandedWidth - safeWidth) / 2),
      top: Math.floor((expandedHeight - safeHeight) / 2), width: safeWidth, height: safeHeight };
  }

  const multiply = (a, b) => a.map((row, i) => row.map((_, j) => row[0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
  function inverse3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  }

  function perspectiveInverse(width, height, roll, horizontal, vertical) {
    const w = Math.max(width, 1), h = Math.max(height, 1), angle = roll * (Math.PI / 180);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const forward = [[[w, 0, 0], [0, h, 0], [0, 0, 1]], [[1, 0, .5], [0, 1, .5], [0, 0, 1]],
      [[1, 0, 0], [0, 1, 0], [.45 * horizontal / 100, .45 * vertical / 100, 1]],
      [[cos, sin * h / w, 0], [-sin * w / h, cos, 0], [0, 0, 1]],
      [[1, 0, -.5], [0, 1, -.5], [0, 0, 1]], [[1 / w, 0, 0], [0, 1 / h, 0], [0, 0, 1]]].reduce(multiply);
    const inverse = inverse3(forward);
    return inverse.flat().map(value => value / inverse[2][2]);
  }

  function largestTrueRectangle(valid, width, height) {
    const heights = new Int32Array(width);
    let bestArea = 0, best = null;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) heights[column] = valid[row * width + column] ? heights[column] + 1 : 0;
      const stack = [];
      for (let column = 0; column <= width; column++) {
        const current = column < width ? heights[column] : 0;
        let start = column;
        while (stack.length && stack[stack.length - 1][1] > current) {
          const [index, bar] = stack.pop(), area = bar * (column - index);
          if (area > bestArea) { bestArea = area; best = [index, row + 1 - bar, column, row + 1]; }
          start = index;
        }
        if (!stack.length || stack[stack.length - 1][1] < current) stack.push([start, current]);
      }
    }
    return best;
  }

  // A constant image stays exactly one under Pillow's bicubic, so the valid
  // proxy pixels are those whose sample point lies inside the proxy.
  function perspectiveSafeRectangle(width, height, roll, horizontal, vertical) {
    const scale = Math.min(1, 512 / Math.max(width, height, 1));
    const proxyWidth = Math.max(8, pyRound(width * scale)), proxyHeight = Math.max(8, pyRound(height * scale));
    const k = perspectiveInverse(proxyWidth, proxyHeight, roll, horizontal, vertical);
    const valid = new Uint8Array(proxyWidth * proxyHeight);
    for (let y = 0; y < proxyHeight; y++) for (let x = 0; x < proxyWidth; x++) {
      const px = x + .5, py = y + .5, divisor = k[6] * px + k[7] * py + 1;
      const sx = (k[0] * px + k[1] * py + k[2]) / divisor, sy = (k[3] * px + k[4] * py + k[5]) / divisor;
      valid[y * proxyWidth + x] = sx >= 0 && sx < proxyWidth && sy >= 0 && sy < proxyHeight ? 1 : 0;
    }
    const rect = largestTrueRectangle(valid, proxyWidth, proxyHeight);
    if (!rect) return null;
    let [left, top, right, bottom] = rect;
    left = Math.min(right - 1, left + 3); top = Math.min(bottom - 1, top + 3);
    right = Math.max(left + 1, right - 3); bottom = Math.max(top + 1, bottom - 3);
    const xScale = width / proxyWidth, yScale = height / proxyHeight;
    const fullLeft = Math.min(width - 1, Math.max(0, Math.ceil(left * xScale)));
    const fullTop = Math.min(height - 1, Math.max(0, Math.ceil(top * yScale)));
    return { left: fullLeft, top: fullTop,
      right: Math.min(width, Math.max(fullLeft + 1, Math.floor(right * xScale))),
      bottom: Math.min(height, Math.max(fullTop + 1, Math.floor(bottom * yScale))) };
  }

  /** `sourceWidth`/`sourceHeight` are the unrotated source at the scale the
   * mask is made. Returns null when the geometry needs no resampling.
   * Output pixel (x, y) samples oriented pixel coordinates
   * ((k0 X + k1 Y + k2) / w, (k3 X + k4 Y + k5) / w), w = k6 X + k7 Y + 1,
   * with X = x + offsetX + 0.5 and Y = y + offsetY + 0.5.
   */
  function plan(sourceWidth, sourceHeight, geometry) {
    const quarter = Number(geometry?.rotation || 0);
    if (![0, 90, 180, 270].includes(quarter)) return null;
    const roll = Number(geometry.straighten_angle || 0) + Number(geometry.perspective_rotate || 0);
    const horizontal = Number(geometry.perspective_horizontal || 0), vertical = Number(geometry.perspective_vertical || 0);
    const width = quarter % 180 ? sourceHeight : sourceWidth, height = quarter % 180 ? sourceWidth : sourceHeight;
    let stage;
    if (horizontal || vertical) {
      const safe = perspectiveSafeRectangle(width, height, fixed(roll, 6), fixed(horizontal, 6), fixed(vertical, 6));
      if (!safe) return null;
      stage = { coefficients: perspectiveInverse(width, height, roll, horizontal, vertical).slice(0, 8),
        left: safe.left, top: safe.top, width: safe.right - safe.left, height: safe.bottom - safe.top };
    } else if (roll) stage = rollStage(width, height, roll);
    if (!stage) return null;
    const crop = cropBounds(stage.width, stage.height, geometry.crop);
    return { orientedWidth: width, orientedHeight: height, coefficients: stage.coefficients,
      offsetX: stage.left + crop.left, offsetY: stage.top + crop.top,
      width: crop.right - crop.left, height: crop.bottom - crop.top,
      orientedSignature: JSON.stringify({ rotation: quarter, flip_horizontal: Boolean(geometry.flip_horizontal),
        flip_vertical: Boolean(geometry.flip_vertical) }) };
  }

  /** Oriented pixel coordinates sampled by one output pixel centre. */
  function sample(recipe, x, y) {
    const k = recipe.coefficients, X = x + recipe.offsetX + .5, Y = y + recipe.offsetY + .5, w = k[6] * X + k[7] * Y + 1;
    return [(k[0] * X + k[1] * Y + k[2]) / w, (k[3] * X + k[4] * Y + k[5]) / w];
  }

  const HDRGeometryResample = Object.freeze({ plan, sample, cropBounds, perspectiveSafeRectangle, rollStage });
  if (typeof window !== 'undefined') window.HDRGeometryResample = HDRGeometryResample;
  if (typeof module !== 'undefined' && module.exports) module.exports = { HDRGeometryResample };
})();
