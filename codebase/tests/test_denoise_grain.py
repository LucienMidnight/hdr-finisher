from dataclasses import replace

import numpy as np

from hdr_finisher import denoise_adaptive as adaptive, denoise_grain as grain
from hdr_finisher.models import DenoiseDocumentSettings
from tools.denoise_eval.candidates import even_keep_round4 as round4


def test_experimental_grain_matches_research():
    rng = np.random.default_rng(115)
    y, x = np.mgrid[:372, :547].astype(np.float32)
    rgb = np.broadcast_to((.12 + x * .0006 - y * .0007)[..., None], (*x.shape, 3)).copy()
    rgb += rng.normal(0, .007, rgb.shape).astype(np.float32)
    rgb[45:57, 312:326, 1] += .03
    rgb[100:109, 316:327] -= .06
    model = adaptive.AdaptiveNoiseModel(.0003, .00008, 0, ((1., .6, .36, .21, .12),) * 3)
    standard = adaptive.AdaptiveControls()
    fine = replace(standard, method="fine_grain")

    np.testing.assert_array_equal(
        adaptive.resolve_adaptive(rgb, model, replace(fine, grain_evenness=0)),
        adaptive.resolve_adaptive(rgb, model, standard),
    )
    expected_fine = round4.resolve(rgb, model, 18, calibration=round4.calibrate_brightness(rgb, model, (18,)))
    actual = adaptive.resolve_adaptive(rgb, model, fine)
    np.testing.assert_allclose(actual, expected_fine, atol=2e-6, rtol=1e-5)


def test_clean_grain_lowers_compact_colour_without_changing_luminance():
    rng = np.random.default_rng(18)
    rgb = np.full((117, 119, 3), .031, dtype=np.float32)
    rgb += rng.normal(0, .0006, rgb.shape).astype(np.float32)
    rgb[54:60, 55:61] += np.array([.019, -.005, -.014], dtype=np.float32)
    yx = np.s_[55:59, 56:60]
    clean = grain.apply_colour(rgb, grain.colour_delta(rgb, False), 1)
    np.testing.assert_allclose(clean @ grain.LUMA, rgb @ grain.LUMA, atol=1e-7)
    assert np.linalg.norm(clean[yx] @ grain.CHROMA.T) < .5 * np.linalg.norm(rgb[yx] @ grain.CHROMA.T)


def test_clean_grain_limits_colour_spread_from_a_bright_point():
    from hdr_finisher.delivery_colour import compare_finished_pixels
    from hdr_finisher.preview import _hdr_to_sdr_display

    rgb = np.broadcast_to(np.array([.014, .03, .02], dtype=np.float32), (85, 85, 3)).copy()
    rgb[40:43, 40:43] = (2, .65, .23)
    clean = grain.apply_colour(rgb, grain.colour_delta(rgb, False), 1)
    dy, dx = np.ogrid[-41:44, -41:44]
    ring = ((dy**2 + dx**2 >= 9) & (dy**2 + dx**2 <= 400))
    before, after = [_hdr_to_sdr_display(frame[ring][None] * 4) for frame in (rgb, clean)]
    assert compare_finished_pixels(before, after, "sdr").passed


def test_grain_settings_round_trip_with_standard_default():
    existing_grade = DenoiseDocumentSettings.model_validate({"hdr": {"enabled": True, "controls": {"amount": .35}}})
    assert existing_grade.hdr.controls.method == "standard"
    assert existing_grade.hdr.controls.amount == .35
    grade = DenoiseDocumentSettings.model_validate({"hdr": {"enabled": True, "controls": {
        "method": "clean_grain", "grain_evenness": .57, "color_splotches": .33,
        "splotch_size": "large",
    }}})
    assert DenoiseDocumentSettings.model_validate_json(grade.model_dump_json()) == grade
