const assert = require("node:assert/strict");
const { test } = require("node:test");
const model = require("../frontend/tone-preview-model.js");
const tone = require("../frontend/tone-engine.js");

test("Tone gestures recognize all global and local ranges without matching unrelated controls", () => {
  for (const prefix of ["", "hdr.", "sdr."]) {
    for (const zone of ["blacks", "shadows", "midtones", "highlights", "whites"]) {
      assert.equal(model.control(prefix + zone).zone, zone);
      for (const suffix of ["_center", "_width"]) assert.ok(model.control(prefix + zone + suffix));
    }
  }
  for (const path of ["hdr.exposure", "shared.blacks", "color_grading.shadows", "midtones_width_extra", ""]) assert.equal(model.control(path), null);
});

test("Effective neutral-ray ranges use photographic grey and both endpoint gates in both lanes", () => {
  for (const hdr of [false, true]) {
    const grey = 0.18 * (hdr ? 0.18 : 100 / 203);
    const peak = hdr ? 1000 * 0.18 / 203 : 1;
    const branch = { highlight_compression_target_nits: 1000 };
    const sample = (zone, luminance, maximum = luminance, selected = branch) => model.influence(selected, hdr, zone, luminance, maximum, 203, tone);
    assert.equal(sample("midtones", grey).weight, 1);
    assert.equal(sample("midtones", grey / 4).weight, 0);
    assert.equal(sample("midtones", grey, peak).weight, 0);
    assert.equal(sample("blacks", 0).weight, 1);
    assert.equal(sample("blacks", grey / 8).weight, 0);
    assert.equal(sample("whites", peak / 2).weight, 0);
    assert.equal(sample("whites", peak).weight, 1);
    assert.ok(Math.abs(sample("whites", peak / Math.SQRT2).weight - 0.25) < 1e-12);
    assert.equal(sample("midtones", 0).weight, 0);
    assert.equal(sample("midtones", grey, grey, { tone_section_enabled: false }).weight, 0);
  }
});

test("Effective ranges include the real combined limiter without moving the frozen guide", () => {
  const branch = { blacks: 100, shadows: -100, midtones: 100, highlights: -100, whites: -100,
    midtones_center: -4, midtones_width: 12, shadows_width: 12, highlights_width: 12 };
  const limiter = tone.parameters(branch, true, 203)[3];
  assert.ok(limiter > 0 && limiter < 1);
  const actual = model.influence(branch, true, "midtones", 0.0324 * 2 ** -4, undefined, 203, tone);
  assert.ok(actual.weight <= limiter);
  assert.equal(actual.limiter, limiter);
});

test("Endpoint contact is not proof of clipped channels; drag-start transitions are separate", () => {
  assert.deepEqual(model.endpoint(1, 1, 1), { touching: true, lost: false, newly: false });
  assert.deepEqual(model.endpoint(1, 1.2, 1), { touching: true, lost: true, newly: false });
  assert.deepEqual(model.endpoint(1, 1.2, 0.8), { touching: true, lost: true, newly: true });
  assert.deepEqual(model.endpoint(0, 0, 0, { black: true }), { touching: true, lost: false, newly: false });
  assert.deepEqual(model.endpoint(0, 0, 0.2, { black: true }), { touching: true, lost: false, newly: true });
  assert.equal(model.endpoint(0.9, 1.2, 0.8).lost, false);
  assert.equal(model.endpoint(1.2, 1.2, 0.8).touching, false);
});

test("Display warning maps reported physical nits, not headroom against an assumed project white", () => {
  assert.equal(model.displayPeak({ max_luminance_nits: 1000 }, 100), 1.8);
  assert.equal(model.displayPeak({ nominal_headroom: 2, sdr_white_nits: 100 }, 100), 0.72);
  assert.equal(model.displayPeak({ nominal_headroom: 2 }), 0);
  assert.equal(model.displayPeak(null), 0);
});
