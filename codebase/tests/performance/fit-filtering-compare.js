// Phase 0 item 6 comparator: numbers for a pair of displayed screenshots.
//
// The Fit filtering A/B captures the same framed image twice -- once processed
// at the source resolution (Full-at-Fit) and once processed at the display
// scale -- and asks how far apart the two pictures are. This module turns two
// RGBA8 buffers of equal size into that answer.
//
// Metrics are in 0-255 display units (the screenshots are 8-bit sRGB), so a
// result can be read against the 1/255-per-channel tolerance language the rest
// of the sprint uses. Each pixel contributes its worst channel, because a
// visible difference in one channel is a visible difference.
//
// Two scales are reported. The full-scale comparison is the raw one and is
// sensitive to sub-pixel sampling phase; the half-scale comparison averages
// 2x2 blocks first, so a difference that survives it is a real difference in
// the picture rather than a half-pixel offset. `energy` measures how much
// fine detail each side kept, which is what grain, Detail and halation
// changes look like in aggregate.

/** @param {Uint8Array|Buffer} data RGBA8, row-major. */
function rgbaImage(width, height, data) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`rgbaImage needs positive integer dimensions, got ${width}x${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(`rgbaImage expected ${width * height * 4} bytes, got ${data.length}`);
  }
  return { width, height, data };
}

function assertComparable(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`screenshots differ in size: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
}

/** Smallest delta at or below which `fraction` of the pixels fall. */
function percentileFromHistogram(histogram, total, fraction) {
  if (total === 0) return 0;
  const target = Math.ceil(fraction * total);
  let seen = 0;
  for (let delta = 0; delta < histogram.length; delta += 1) {
    seen += histogram[delta];
    if (seen >= target) return delta;
  }
  return histogram.length - 1;
}

/**
 * Compare two equal-size RGBA8 images. Returns display-unit statistics over
 * every pixel: the maximum and mean of the worst-channel delta, the 95th and
 * 99th percentiles, how many pixels differ by more than 1 and 2 levels, and
 * the mean luma difference.
 */
function compareRgba(a, b) {
  assertComparable(a, b);
  const histogram = new Uint32Array(256);
  const total = a.width * a.height;
  let maxAbs = 0;
  let sumAbs = 0;
  let sumLuma = 0;
  let above1 = 0;
  let above2 = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    const index = pixel * 4;
    const dr = Math.abs(a.data[index] - b.data[index]);
    const dg = Math.abs(a.data[index + 1] - b.data[index + 1]);
    const db = Math.abs(a.data[index + 2] - b.data[index + 2]);
    const delta = Math.max(dr, dg, db);
    histogram[delta] += 1;
    if (delta > maxAbs) maxAbs = delta;
    sumAbs += delta;
    if (delta > 1) above1 += 1;
    if (delta > 2) above2 += 1;
    const lumaA = 0.2126 * a.data[index] + 0.7152 * a.data[index + 1] + 0.0722 * a.data[index + 2];
    const lumaB = 0.2126 * b.data[index] + 0.7152 * b.data[index + 1] + 0.0722 * b.data[index + 2];
    sumLuma += Math.abs(lumaA - lumaB);
  }
  return {
    comparedPixels: total,
    maxAbs,
    meanAbs: sumAbs / total,
    p95Abs: percentileFromHistogram(histogram, total, 0.95),
    p99Abs: percentileFromHistogram(histogram, total, 0.99),
    differingAbove1: above1,
    differingAbove2: above2,
    differingAbove1Fraction: above1 / total,
    meanLumaDelta: sumLuma / total,
  };
}

/** Area-average 2x2 blocks, dropping an odd final row/column. */
function halveRgba(image) {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const a = image.data[((y * 2) * image.width + x * 2) * 4 + channel];
        const b = image.data[((y * 2) * image.width + x * 2 + 1) * 4 + channel];
        const c = image.data[((y * 2 + 1) * image.width + x * 2) * 4 + channel];
        const d = image.data[((y * 2 + 1) * image.width + x * 2 + 1) * 4 + channel];
        data[out + channel] = Math.round((a + b + c + d) / 4);
      }
    }
  }
  return rgbaImage(width, height, data);
}

/**
 * Mean absolute horizontal luma gradient in 0-255 units: a rough measure of
 * how much fine detail a picture carries. Grain, sharpening and aliasing all
 * move this number; comparing it between the two branches says which one kept
 * or invented detail.
 */
function lumaEnergy(image) {
  if (image.width < 2) return 0;
  let total = 0;
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 1; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const previous = index - 4;
      const luma = 0.2126 * image.data[index] + 0.7152 * image.data[index + 1] + 0.0722 * image.data[index + 2];
      const lumaPrevious = 0.2126 * image.data[previous] + 0.7152 * image.data[previous + 1] + 0.0722 * image.data[previous + 2];
      total += Math.abs(luma - lumaPrevious);
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

/** Rows `y` through `y + height` of an image, as a new image. */
function cropRgba(image, x, y, width, height) {
  const left = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const top = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const cropWidth = Math.max(1, Math.min(image.width - left, Math.floor(width)));
  const cropHeight = Math.max(1, Math.min(image.height - top, Math.floor(height)));
  const data = new Uint8Array(cropWidth * cropHeight * 4);
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = ((top + row) * image.width + left) * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + cropWidth * 4), row * cropWidth * 4);
  }
  return rgbaImage(cropWidth, cropHeight, data);
}

/**
 * Separable Lanczos-3 resample of an RGBA8 image.
 *
 * This is the reference filter for "what the exported file would look like on
 * this screen": the A/B downsamples the full-resolution processed frame with
 * it, so the comparison is against a correct display of the full render rather
 * than against whatever filter the browser happens to apply to a huge canvas.
 *
 * Self-contained on purpose: the driver injects its source into the page with
 * `Function` so the readback is reduced to display size before it crosses the
 * CDP boundary.
 */
function lanczosResampleRgba(image, targetWidth, targetHeight, lobes = 3) {
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(targetHeight));
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  const supportX = lobes * scaleX;
  const supportY = lobes * scaleY;
  const kernel = (distance) => {
    const x = Math.abs(distance);
    if (x === 0) return 1;
    if (x >= lobes) return 0;
    const pix = Math.PI * x;
    return (Math.sin(pix) / pix) * (Math.sin(pix / lobes) / (pix / lobes));
  };
  // Weights depend only on the output index, so they are built once per axis
  // and reused down the other axis. This runs in the page twelve times per A/B
  // run, so the kernel must not be evaluated per sample.
  const buildTaps = (count, scale, support, sourceSize) => {
    const taps = [];
    for (let index = 0; index < count; index += 1) {
      const center = (index + 0.5) * scale - 0.5;
      const first = Math.ceil(center - support);
      const last = Math.floor(center + support);
      const entries = [];
      let total = 0;
      for (let sample = first; sample <= last; sample += 1) {
        const weight = kernel((sample - center) / scale);
        if (weight === 0) continue;
        entries.push([Math.min(sourceSize - 1, Math.max(0, sample)), weight]);
        total += weight;
      }
      const norm = total || 1;
      for (const entry of entries) entry[1] /= norm;
      taps.push(entries);
    }
    return taps;
  };
  const tapsX = buildTaps(width, scaleX, supportX, sourceWidth);
  const tapsY = buildTaps(height, scaleY, supportY, sourceHeight);
  const horizontal = new Float32Array(width * sourceHeight * 4);
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const entries = tapsX[x];
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let tap = 0; tap < entries.length; tap += 1) {
        const index = (y * sourceWidth + entries[tap][0]) * 4;
        const weight = entries[tap][1];
        r += image.data[index] * weight;
        g += image.data[index + 1] * weight;
        b += image.data[index + 2] * weight;
        a += image.data[index + 3] * weight;
      }
      const out = (y * width + x) * 4;
      horizontal[out] = r;
      horizontal[out + 1] = g;
      horizontal[out + 2] = b;
      horizontal[out + 3] = a;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const entries = tapsY[y];
    for (let x = 0; x < width; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let tap = 0; tap < entries.length; tap += 1) {
        const index = (entries[tap][0] * width + x) * 4;
        const weight = entries[tap][1];
        r += horizontal[index] * weight;
        g += horizontal[index + 1] * weight;
        b += horizontal[index + 2] * weight;
        a += horizontal[index + 3] * weight;
      }
      const out = (y * width + x) * 4;
      data[out] = r;
      data[out + 1] = g;
      data[out + 2] = b;
      data[out + 3] = a;
    }
  }
  return { width, height, data };
}

/**
 * The full answer for one captured pair: raw comparison, phase-robust
 * half-scale comparison, and the fine-detail energy of each side.
 */
function summarizePair(fullAtFit, displayScale) {
  const halfFull = halveRgba(fullAtFit);
  const halfDisplay = halveRgba(displayScale);
  const full = compareRgba(fullAtFit, displayScale);
  const half = compareRgba(halfFull, halfDisplay);
  const fullEnergy = lumaEnergy(fullAtFit);
  const displayEnergy = lumaEnergy(displayScale);
  return {
    full,
    half,
    energy: {
      fullAtFit: fullEnergy,
      displayScale: displayEnergy,
      ratio: displayEnergy / Math.max(1e-9, fullEnergy),
    },
    halfEnergy: {
      fullAtFit: lumaEnergy(halfFull),
      displayScale: lumaEnergy(halfDisplay),
    },
  };
}

module.exports = {
  rgbaImage,
  compareRgba,
  cropRgba,
  halveRgba,
  lanczosResampleRgba,
  lumaEnergy,
  summarizePair,
};
