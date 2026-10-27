const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

// gpu-params.js toneZoneAmounts must equal adjustments.py tone_zone_amounts:
// the GPU and CPU apply the same limited Shadows/Midtones/Highlights.
// Sliders are strengths (-100..+100); values pinned from tests/test_tone_zones.py SHARED_CASES.
const source = fs.readFileSync(path.join(__dirname, "../frontend/gpu-params.js"), "utf8");
const toneZoneAmounts = new Function(source.slice(source.indexOf("  const TONE_ZONES"), source.indexOf("  function applyHighlightTone")) + ";return toneZoneAmounts;")();
const DEFAULTS = { shadows_center: -2.5, shadows_width: 5, midtones_center: 0, midtones_width: 4, highlights_center: 1.25, highlights_width: 2.5 };
const CASES = [{"shadows": 100.0}, {"shadows": 60.0, "midtones": -40.0, "highlights": 50.0}, {"shadows": 100.0, "midtones": -100.0}, {"shadows": 100.0, "midtones": -100.0, "highlights": 100.0, "shadows_center": -1.0, "midtones_center": -0.5, "highlights_center": 0.0, "shadows_width": 1.0, "midtones_width": 1.0, "highlights_width": 1.0}];
const EXPECTED = [[1.5, 0.0, 0.0], [0.8999999999999999, -0.48, 0.375], [0.7592684132476522, -0.6074147305981217, 0.0], [0.15000000000000002, -0.15000000000000002, 0.15000000000000002]];

test("GPU tone zone amounts match the CPU's", () => {
  CASES.forEach((settings, index) => {
    const actual = toneZoneAmounts({ ...DEFAULTS, ...settings });
    actual.forEach((value, zone) => assert.ok(Math.abs(value - EXPECTED[index][zone]) < 1e-12, `case ${index} zone ${zone}: ${value}`));
  });
});
