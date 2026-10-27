const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

// gpu-params.js toneZoneAmounts must equal adjustments.py tone_zone_amounts:
// the GPU and CPU apply the same limited Shadows/Midtones/Highlights.
// Values pinned from tests/test_tone_zones.py SHARED_CASES.
const source = fs.readFileSync(path.join(__dirname, "../frontend/gpu-params.js"), "utf8");
const toneZoneAmounts = new Function(source.slice(source.indexOf("  const TONE_ZONES"), source.indexOf("  function applyHighlightTone")) + ";return toneZoneAmounts;")();
const DEFAULTS = { shadows_center: -2.5, shadows_width: 5, midtones_center: 0, midtones_width: 4, highlights_center: 1.25, highlights_width: 2.5 };
const CASES = [{"shadows": 1.0}, {"shadows": 1.0, "midtones": -0.5, "highlights": 0.5}, {"shadows": 2.0, "shadows_width": 0.5}, {"shadows": 2.0, "midtones": -2.0, "highlights": 2.0, "shadows_center": -1.0, "midtones_center": -0.5, "highlights_center": 0.0, "shadows_width": 1.0, "midtones_width": 1.0, "highlights_width": 1.0}];
const EXPECTED = [[1.0, 0.0, 0.0], [0.9344429843772813, -0.4672214921886407, 0.4672214921886407], [0.15, 0.0, 0.0], [0.15, -0.15, 0.15]];

test("GPU tone zone amounts match the CPU's", () => {
  CASES.forEach((settings, index) => {
    const actual = toneZoneAmounts({ ...DEFAULTS, ...settings });
    actual.forEach((value, zone) => assert.ok(Math.abs(value - EXPECTED[index][zone]) < 1e-12, `case ${index} zone ${zone}: ${value}`));
  });
});
