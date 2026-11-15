"""W3: grading ranges are edits, never an implicit output limiter."""
import numpy as np
import pytest

from hdr_finisher import adjustments as a
from hdr_finisher.models import AdjustmentState, ColorGradingAdjustments, LocalGrade, PreviewKind
from hdr_finisher.sdr_gamut import compress_to_srgb_gamut, linear_srgb_to_oklab


@pytest.mark.parametrize('kind', list(PreviewKind))
@pytest.mark.parametrize('control', ['saturation', 'luminance_ev'])
def test_wheel_continuous_at_zero_and_unaffected_pixels_exact(kind, control):
    # Bright headroom and signed RAW colours used to jump as soon as any wheel moved.
    pixels = np.array([[[2, 3, 5], [-.01, .001, .002], [.001, .002, .004],
                        [.02, .04, .08], [.1, .2, .4]]], np.float32)
    grade = ColorGradingAdjustments(blending=0)
    for amount in [1e-5, .001, 1.0]:
        setattr(grade.shadows, control, amount)
        result = a._apply_color_grading(pixels, grade, kind)
        np.testing.assert_array_equal(result[:, :1], pixels[:, :1])
        bound = .08 * np.expm1(amount * np.log(2)) if control == "luminance_ev" else amount * .01
        assert np.max(np.abs(result - pixels)) <= bound + 1e-7


@pytest.mark.parametrize('kind', list(PreviewKind))
def test_positive_balance_favours_highlights(kind):
    # Equal tint directions isolate the weight of each range.
    pivot = .18 if kind == PreviewKind.HDR else float(a._srgb_decode(np.array(.5)))
    pixels = np.full((1, 1, 3), pivot, np.float32)
    for wheel, direction in [('highlights', 1), ('shadows', -1)]:
        strengths = []
        for balance in [-50, 0, 50]:
            grade = ColorGradingAdjustments(blending=100, balance=balance)
            getattr(grade, wheel).saturation = 50
            strengths.append(float(np.linalg.norm(a._apply_color_grading(pixels, grade, kind) - pixels)))
        assert direction * (strengths[2] - strengths[0]) > .001
        assert strengths[0] <= strengths[1] <= strengths[2] if direction > 0 else strengths[0] >= strengths[1] >= strengths[2]


@pytest.mark.parametrize('contrast', [-.5, 1e-6, .5])
def test_sdr_contrast_preserves_above_white_rgb_ratios(contrast):
    pixels = np.array([[[.04, .2, 2.5], [.2, .8, 6.0], [1.2, 1.8, 4.0]]], np.float32)
    branch = AdjustmentState().sdr
    branch.contrast = contrast
    result = a._apply_luminance_section_controls(pixels, branch, PreviewKind.SDR, apply_primaries=False)
    np.testing.assert_allclose(result / result[..., 2:], pixels / pixels[..., 2:], rtol=2e-6, atol=1e-7)
    assert result.max() > 1
    if abs(contrast) < 1e-5:
        np.testing.assert_allclose(result, pixels, rtol=3e-6)


def test_sdr_finish_preserves_oklab_hue_and_respects_white_and_gamut():
    pixels = np.array([[[.04, .2, 2.5], [.2, .8, 6.0], [1.2, 1.8, 4.0]]], np.float32)
    state = AdjustmentState()
    for enabled in [True, False]:
        state.sdr.highlight_section_enabled = enabled
        result = a.apply_sdr_output_highlight_compression(pixels, state)
        assert np.isfinite(result).all() and result.min() >= 0 and result.max() <= 1
        mapper_input = a._compress_sdr_highlights(pixels, state.sdr) if enabled else pixels
        before, after = linear_srgb_to_oklab(mapper_input), linear_srgb_to_oklab(result)
        before_hue = np.arctan2(before[..., 2], before[..., 1])
        after_hue = np.arctan2(after[..., 2], after[..., 1])
        np.testing.assert_allclose(after_hue[:, :2], before_hue[:, :2], atol=2e-4)
        if not enabled:
            np.testing.assert_allclose(result[:, 2], 1)  # The bypassed shoulder leaves this above white.


@pytest.mark.parametrize('structure', [False, True])
def test_film_strength_mix_keeps_headroom_until_finish(structure):
    pixels = np.full((8, 8, 3), [.05, .2, 2.5], np.float32)
    state = AdjustmentState()
    # Physical neutral paper controls activate Film without changing its colour.
    look = state.sdr.film_look
    look.film_stock = 'none'
    look.grain_enabled = look.halation_enabled = False
    look.print_exposure = .5
    look.look_strength = 1e-5
    if structure:
        state.sdr.detail.microcontrast = 1
    result = a._apply_film_look(pixels, state, PreviewKind.SDR, include_grain=False)
    assert result.max() > 2
    np.testing.assert_allclose(result, pixels, rtol=3e-6, atol=1e-7)
    state.sdr.highlight_section_enabled = False
    np.testing.assert_allclose(a.apply_sdr_output_highlight_compression(result, state), compress_to_srgb_gamut(result))


def test_match_translates_local_wheel_direction_and_keeps_balance():
    from hdr_finisher.sdr_match import _translate_local_grade, _translate_color_grading_wheels
    grade = LocalGrade()
    grade.color_grading.balance = 35
    grade.color_grading.midtones.hue = 120
    grade.color_grading.midtones.saturation = 60
    translated = _translate_local_grade(grade, 1)
    expected = grade.color_grading.model_copy(deep=True)
    _translate_color_grading_wheels(expected, grade.color_grading)
    assert translated.color_grading == expected
    assert translated.color_grading.midtones.hue != grade.color_grading.midtones.hue


def test_delivery_finishing_leaves_hue_and_headroom_to_final_mapper():
    from hdr_finisher.finishing import apply_output_finishing
    from hdr_finisher.models import OutputFinishingSettings
    pixels = np.full((8, 8, 3), [.05, .2, 2.5], np.float32)
    for sharpening in ['off', 'standard']:
        finished = apply_output_finishing(pixels, OutputFinishingSettings(sharpening=sharpening), PreviewKind.SDR)
        np.testing.assert_array_equal(finished, pixels)
        delivered = a.apply_sdr_output_highlight_compression(finished, AdjustmentState())
        assert delivered.min() >= 0 and delivered.max() <= 1


def test_output_sharpening_keeps_flat_above_white_pixels_when_other_pixels_have_detail():
    from hdr_finisher.finishing import apply_output_finishing
    from hdr_finisher.models import OutputFinishingSettings
    pixels = np.full((32, 64, 3), .2, np.float32)
    pixels[:, 32:] = [2., 4., 8.]
    pixels[8:12, 8:12] = .3
    result = apply_output_finishing(pixels, OutputFinishingSettings(sharpening='standard'), PreviewKind.SDR)
    np.testing.assert_array_equal(result[:, 48:], pixels[:, 48:])
    assert np.any(result[:, :24] != pixels[:, :24])
