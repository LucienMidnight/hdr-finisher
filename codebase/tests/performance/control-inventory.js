/**
 * Generate the measurement inventory for every static data-path control.
 *
 * This does not benchmark product code. It prevents the performance sweep
 * from silently omitting a control as the UI evolves and assigns each path to
 * the module and processing family used by the sprint matrix.
 *
 *   node tests/performance/control-inventory.js \
 *     --output output/performance/review/control-inventory.json
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.join(root, "frontend", "index.html");
const outputPath = path.resolve(option(
  "--output",
  path.join(root, "output", "performance", "review", "control-inventory.json"),
));

function attribute(markup, name) {
  const match = markup.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function moduleFor(controlPath) {
  if (controlPath.startsWith("shared.geometry.")) return "Crop, Rotate & Perspective";
  if (controlPath.startsWith("shared.overlay_")) return "Viewer overlays";
  if (controlPath.startsWith("shared.false_color_")) return "Viewer overlays";
  if (controlPath.includes(".highlight_compression_")) return "Highlight Compression";
  if (controlPath.includes(".tone_equalizer_")) return "Exposure Bands";
  if (/\.(lift|gamma|gain)(_|$)/.test(controlPath)) return "Lift, Gamma, Gain";
  if (/\.(exposure|contrast|contrast_pivot|shadow|shadow_lift)$/.test(controlPath)) return "Tone";
  if (/\.(white_balance_kelvin|tint|tint_hue|tint_purity|saturation|vibrance|red_hue|red_purity|green_hue|green_purity|blue_hue|blue_purity)$/.test(controlPath)) return "Color / Primaries";
  if (controlPath.startsWith("current.black_and_white.")) return "Black & White";
  if (controlPath.startsWith("current.color_grading.")) return "Color Grading";
  if (controlPath.startsWith("current.detail.")) return "Detail";
  if (controlPath.startsWith("current.vignette.")) return "Vignette";
  if (controlPath.startsWith("current.film_look.halation_")) return "Film Look: halation";
  if (controlPath.startsWith("current.film_look.bloom_")) return "Film Look: bloom/diffusion";
  if (controlPath.startsWith("current.film_look.grain_") || controlPath.endsWith(".film_resolution")) return "Film Look: grain/resolution";
  if (controlPath.startsWith("current.film_look.")) return "Film Look: base/print";
  return "Unclassified";
}

function familyFor(controlPath, type, tag) {
  if (controlPath.startsWith("shared.geometry.")) return "geometry/resampling";
  if (controlPath.startsWith("shared.overlay_") || controlPath.startsWith("shared.false_color_")) {
    return type === "range" ? "pointwise scalar" : "structural/discrete";
  }
  if (controlPath.includes(".highlight_compression_")) {
    if (/peak_measurement|manual_peak|mode|color_handling|bias/.test(controlPath)) return "measurement-dependent";
    if (/peak_detail/.test(controlPath)) return "neighborhood/spatial";
    return "parameter-dependent pointwise";
  }
  if (controlPath.includes(".tone_equalizer_")) return "LUT/curve rebuild";
  if (controlPath.startsWith("current.detail.")) {
    return /texture|microcontrast/.test(controlPath) ? "multiscale/band" : "neighborhood/spatial";
  }
  if (controlPath.startsWith("current.film_look.halation_")
    || controlPath.startsWith("current.film_look.bloom_")) return "optical blur/composite";
  if (controlPath.startsWith("current.film_look.grain_") || controlPath.endsWith(".film_resolution")) return "procedural field";
  if (type === "checkbox" || type === "radio" || tag === "select"
    || /enabled|mode|measurement|format|geometry|film_type|view_map/.test(controlPath)) return "structural/discrete";
  if (/pivot|range|softness|midpoint|roundness|feather|protection|balance|blending|response/.test(controlPath)) {
    return "parameter-dependent pointwise";
  }
  return "pointwise scalar";
}

const html = fs.readFileSync(htmlPath, "utf8");
const controls = [];
const pattern = /<(input|select|button)\b[^>]*\bdata-path="[^"]+"[^>]*>/gi;
for (const match of html.matchAll(pattern)) {
  const markup = match[0];
  const tag = match[1].toLowerCase();
  const controlPath = attribute(markup, "data-path");
  const type = attribute(markup, "type") || (tag === "select" ? "select" : tag);
  controls.push({
    path: controlPath,
    module: moduleFor(controlPath),
    family: familyFor(controlPath, type, tag),
    element: tag,
    type,
    minimum: attribute(markup, "min"),
    maximum: attribute(markup, "max"),
    step: attribute(markup, "step"),
  });
}

controls.sort((left, right) => left.path.localeCompare(right.path));
const duplicates = controls
  .filter((control, index) => controls.findIndex((candidate) => candidate.path === control.path) !== index)
  .map((control) => control.path);
const unclassified = controls.filter((control) => control.module === "Unclassified").map((control) => control.path);
const byModule = Object.fromEntries([...new Set(controls.map((control) => control.module))]
  .sort()
  .map((moduleName) => [moduleName, controls.filter((control) => control.module === moduleName).length]));
const byFamily = Object.fromEntries([...new Set(controls.map((control) => control.family))]
  .sort()
  .map((family) => [family, controls.filter((control) => control.family === family).length]));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: path.relative(root, htmlPath).replaceAll("\\", "/"),
  controlCount: controls.length,
  duplicatePaths: [...new Set(duplicates)],
  unclassifiedPaths: unclassified,
  byModule,
  byFamily,
  controls,
  additionalDynamicFamiliesRequired: [
    "curves: add/drag/remove point and RGB/luma channel",
    "exposure bands: add/drag/remove node and Match HDR bands",
    "local masks: brush, gradient, luminance range, feather and Boolean structure",
    "local grades: unchanged-mask representatives from each supported grade family",
    "scopes: histogram, waveform, vectorscope, channel/detail/region and exact peak",
    "viewer tasks: zoom, pan, compare layout and mask overlays",
  ],
};

if (duplicates.length || unclassified.length) {
  throw new Error(`Inventory incomplete: duplicates=${duplicates.length}, unclassified=${unclassified.length}`);
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, controlCount: controls.length, byModule, byFamily }, null, 2)}\n`);
