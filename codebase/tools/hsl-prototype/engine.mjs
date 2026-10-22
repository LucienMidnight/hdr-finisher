// Isolated prototype. Input/output: unbounded, D65 linear sRGB, RGBA floats.
// Oklab matrices: Björn Ottosson, public-domain implementation (2021-01-25).
// https://bottosson.github.io/posts/oklab/ ; see README.md for integration limits.
export const MAX_RANGES = 32;
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const wrap = h => ((h % 360) + 360) % 360;
export const delta = (h, center) => wrap(h - center + 180) - 180;
export const smooth = (lo, hi, x) => { const t = clamp((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); };
export const decode = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
export const encode = x => x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055;

export function toLab([r, g, b]) {
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return [.2104542553*l + .793617785*m - .0040720468*s,
    1.9779984951*l - 2.428592205*m + .4505937099*s,
    .0259040371*l + .7827717662*m - .808675766*s];
}
export function fromLab([L, a, b]) {
  const l = (L + .3963377774*a + .2158037573*b) ** 3;
  const m = (L - .1055613458*a - .0638541728*b) ** 3;
  const s = (L - .0894841775*a - 1.291485548*b) ** 3;
  return [4.0767416621*l - 3.3077115913*m + .2309699292*s,
    -1.2684380046*l + 2.6097574011*m - .3413193965*s,
    -.0041960863*l - .7034186147*m + 1.707614701*s];
}
export function describe(rgb) {
  const [L, a, b] = toLab(rgb), chroma = Math.hypot(a, b);
  return { L, chroma, hue: wrap(Math.atan2(b, a) * 180 / Math.PI), relativeChroma: chroma / Math.max(Math.abs(L), 1e-6) };
}
export function newRecipe() {
  return { version: 1, ranges: [], hue: 0, saturation: 0, luminance: 0, uniformity: 0, opacity: 1 };
}
export function validateRecipe(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.ranges) || value.ranges.length > MAX_RANGES) throw Error('Invalid HSL prototype recipe');
  const finite = (v, lo, hi) => { if (!Number.isFinite(v) || v < lo || v > hi) throw Error('Recipe value outside supported range'); return v; };
  return { version: 1, ranges: value.ranges.map(r => ({ center: finite(r.center, 0, 360), width: finite(r.width, 1, 180), feather: finite(r.feather, 1, 90), subtract: Boolean(r.subtract) })),
    hue: finite(value.hue, -180, 180), saturation: finite(value.saturation, -100, 100), luminance: finite(value.luminance, -2, 2), uniformity: finite(value.uniformity, 0, 100), opacity: finite(value.opacity, 0, 1) };
}
export function addSample(recipe, rgb, mode = 'pick', width = 16, feather = 12) {
  if (!['pick', 'add', 'subtract'].includes(mode)) throw Error('Unknown picker mode');
  const color = describe(rgb);
  if (color.relativeChroma < .02 || Math.abs(color.L) < 1e-5) return false;
  const range = { center: color.hue, width, feather, subtract: mode === 'subtract' };
  if (mode === 'pick') recipe.ranges = [range];
  else {
    // A drag collects distinct samples without exhausting the fixed GPU capacity.
    if (recipe.ranges.some(r => r.subtract === range.subtract && Math.abs(delta(r.center, range.center)) < 3)) return false;
    if (recipe.ranges.length >= MAX_RANGES) throw Error(`Selection is limited to ${MAX_RANGES} ranges; remove or widen a range`);
    recipe.ranges.push(range);
  }
  return true;
}
export function rangeWeight(hue, range) {
  return 1 - smooth(range.width, range.width + range.feather, Math.abs(delta(hue, range.center)));
}
export function selection(rgb, ranges) {
  const c = describe(rgb);
  let include = 0, exclude = 0, sx = 0, sy = 0;
  for (const r of ranges) {
    const w = rangeWeight(c.hue, r);
    if (r.subtract) exclude = Math.max(exclude, w);
    else {
      include = Math.max(include, w);
      sx += w * Math.cos(r.center * Math.PI / 180);
      sy += w * Math.sin(r.center * Math.PI / 180);
    }
  }
  // Circular blending avoids a hard uniformity seam where included ranges overlap.
  const target = Math.hypot(sx, sy) > 1e-5 ? Math.atan2(sy, sx) * 180 / Math.PI : c.hue;
  return { ...c, target, weight: include * (1 - exclude) * smooth(.02, .06, c.relativeChroma) };
}
export function applyPixel(rgb, recipe, mask = 1) {
  const s = selection(rgb, recipe.ranges), w = s.weight * clamp(mask) * recipe.opacity;
  if (w === 0 || !(recipe.hue || recipe.saturation || recipe.luminance || recipe.uniformity)) return [...rgb];
  const h = (s.hue + delta(s.target, s.hue) * recipe.uniformity / 100 + recipe.hue) * Math.PI / 180;
  const gain = 2 ** (recipe.luminance / 3), C = s.chroma * (1 + recipe.saturation / 100) * gain;
  const changed = fromLab([s.L * gain, C * Math.cos(h), C * Math.sin(h)]);
  return rgb.map((v, i) => v + w * (changed[i] - v));
}
export function processCPU(pixels, recipe, mask = null) {
  validateRecipe(recipe);
  if (pixels.length % 4 || (mask && mask.length !== pixels.length / 4)) throw Error('Invalid pixel/mask dimensions');
  const result = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    result.set(applyPixel(Array.from(pixels.subarray(i, i + 3)), recipe, mask ? mask[i / 4] : 1), i);
    result[i + 3] = pixels[i + 3];
  }
  return result;
}
export function sampleNeighborhood(pixels, width, height, x, y, radius = 2) {
  const sum = [0, 0, 0]; let count = 0;
  for (let yy = Math.max(0, y-radius); yy <= Math.min(height-1, y+radius); yy++) {
    for (let xx = Math.max(0, x-radius); xx <= Math.min(width-1, x+radius); xx++) {
      const i = (yy*width+xx)*4, alpha = pixels[i+3];
      if (alpha <= 0) continue;
      for (let c = 0; c < 3; c++) sum[c] += pixels[i+c] * alpha;
      count += alpha;
    }
  }
  return count ? sum.map(v => v/count) : [0, 0, 0];
}
