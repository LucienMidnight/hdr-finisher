from dataclasses import replace

import numpy as np

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.models import DenoiseDocumentSettings
from tools.denoise_eval.candidates import even_keep_round4 as round4
from tools.denoise_eval.candidates import speck_round5 as round5


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
    clean = replace(standard, method="clean_grain")

    np.testing.assert_array_equal(
        adaptive.resolve_adaptive(rgb, model, replace(fine, grain_evenness=0)),
        adaptive.resolve_adaptive(rgb, model, standard),
    )
    expected_fine = round4.resolve(rgb, model, 18, calibration=round4.calibrate_brightness(rgb, model, (18,)))
    expected_clean = round5.native(round5.native(expected_fine, "colour-broad"), "heal")
    for controls, expected in ((fine, expected_fine), (clean, expected_clean)):
        actual = adaptive.resolve_adaptive(rgb, model, controls)
        np.testing.assert_allclose(actual, expected, atol=2e-6, rtol=1e-5)


def test_grain_settings_round_trip_with_standard_default():
    existing_grade = DenoiseDocumentSettings.model_validate({"hdr": {"enabled": True, "controls": {"amount": .35}}})
    assert existing_grade.hdr.controls.method == "standard"
    assert existing_grade.hdr.controls.amount == .35
    grade = DenoiseDocumentSettings.model_validate({"hdr": {"enabled": True, "controls": {
        "method": "clean_grain", "grain_evenness": .57, "color_splotches": .33,
        "splotch_size": "small", "dark_specks": .89,
    }}})
    assert DenoiseDocumentSettings.model_validate_json(grade.model_dump_json()) == grade
