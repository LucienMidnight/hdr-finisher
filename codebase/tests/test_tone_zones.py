import itertools

import numpy as np
import pytest

from hdr_finisher.adjustments import (
    GRAIN_DEVELOP_HDR_SCALE, SDR_SCENE_TO_DISPLAY_SCALE, _apply_color_grading,
    apply_adjustments, apply_hdr_output_highlight_compression, _apply_sdr_adjustments_to_reference,
)
from hdr_finisher.color import acescg_to_linear_bt2020, linear_bt2020_to_acescg, linear_srgb_to_acescg
from hdr_finisher.models import AdjustmentState, HDRAdjustments, SDRAdjustments, PreviewKind, ColorGradingAdjustments
from hdr_finisher.tone import apply_tone, parameters, reference_grey, ZONES, _smooth


@pytest.mark.parametrize("hdr", [True, False])
def test_zero_is_an_exact_bypass_including_signed_pixels(hdr):
    branch = HDRAdjustments() if hdr else SDRAdjustments()
    pixels = np.array([[[-0.1, 0.0, 0.1], [0.0, 0.0, 0.0], [10.0, 1.0, 0.2]]], np.float32)
    assert apply_tone(pixels, branch, hdr) is pixels


def test_reference_units_and_defaults():
    assert reference_grey(True) == pytest.approx(0.0324)
    assert reference_grey(False) == pytest.approx(0.18 * 100 / 203)
    assert reference_grey(True) * 203 / 0.18 == pytest.approx(36.54)
    assert SDR_SCENE_TO_DISPLAY_SCALE == pytest.approx((100 / 203) / 0.18)
    assert GRAIN_DEVELOP_HDR_SCALE == SDR_SCENE_TO_DISPLAY_SCALE
    assert (HDRAdjustments().highlights_center, HDRAdjustments().highlights_width) == (2.25, 4.5)
    assert (SDRAdjustments().highlights_center, SDRAdjustments().highlights_width) == (1.75, 3.5)


@pytest.mark.parametrize("hdr", [True, False])
@pytest.mark.parametrize("reference,peak", [(203, 1000), (100, 400)])
def test_local_tone_is_the_global_block_after_local_exposure_contrast(hdr, reference, peak):
    from hdr_finisher.models import LocalGrade
    from hdr_finisher.local_adjustments import _apply_local_grade
    kind = PreviewKind.HDR if hdr else PreviewKind.SDR
    branch = HDRAdjustments() if hdr else SDRAdjustments()
    values = np.geomspace(1e-5, 4, 257).astype(np.float32)
    pixels = np.repeat(values[None, :, None], 3, axis=-1)
    grade = LocalGrade(exposure=.4, contrast=.2, blacks=70, whites=-90,
                       shadows=100, midtones=-60, highlights=80,
                       highlights_center=branch.highlights_center, highlights_width=branch.highlights_width)
    entry = grade.contrast_pivot * np.exp2(
        np.log2(values / grade.contrast_pivot) * np.float32(2 ** grade.contrast) + grade.exposure
    )
    entry = np.repeat(entry[None, :, None], 3, axis=-1)
    for name in ("blacks", "whites", "shadows", "midtones", "highlights", "highlights_center", "highlights_width"):
        setattr(branch, name, getattr(grade, name))
    if hdr:
        branch.highlight_compression_target_nits = peak
    expected = apply_tone(entry, branch, hdr, reference)
    if not hdr:
        from hdr_finisher.adjustments import _apply_white_balance
        from hdr_finisher.color import acescg_to_linear_srgb
        expected = acescg_to_linear_srgb(_apply_white_balance(linear_srgb_to_acescg(expected), 6500, 0))
    expected = np.maximum(expected, 0)
    actual = _apply_local_grade(pixels, grade, kind, reference_white_nits=reference, target_peak_nits=peak)
    np.testing.assert_allclose(actual, expected, rtol=3e-6, atol=3e-7)


@pytest.mark.parametrize("reference", [100, 203])
def test_hdr_whites_uses_project_reference_white_without_changing_target(reference):
    branch = HDRAdjustments(whites=-100, highlight_section_enabled=False)
    peak = branch.highlight_compression_target_nits * .18 / reference
    pixels = np.full((1, 1, 3), peak, np.float32)
    np.testing.assert_allclose(apply_tone(pixels, branch, True, reference), pixels * .775, rtol=1e-6)
    assert branch.highlight_compression_target_nits == 1000


@pytest.mark.parametrize("strength", [-100, 100])
def test_generated_and_authored_sdr_apply_one_identical_display_linear_block(strength):
    pixels = np.repeat(np.geomspace(1e-5, 3, 257).astype(np.float32)[None, :, None], 3, -1)
    state = AdjustmentState(sdr=SDRAdjustments(blacks=strength, whites=strength,
        shadows=strength, midtones=-strength, highlights=strength))
    expected = apply_tone(pixels, state.sdr, False)
    authored = _apply_sdr_adjustments_to_reference(pixels, state,
        include_grain=False, include_output_highlight_compression=False)
    scene = linear_srgb_to_acescg(pixels) / SDR_SCENE_TO_DISPLAY_SCALE
    placed = apply_adjustments(scene, AdjustmentState(), PreviewKind.SDR,
        include_grain=False, include_output_highlight_compression=False)
    generated = apply_adjustments(scene, state, PreviewKind.SDR,
        include_grain=False, include_output_highlight_compression=False)
    np.testing.assert_allclose(authored, expected, rtol=3e-6, atol=3e-7)
    np.testing.assert_allclose(generated, apply_tone(placed, state.sdr, False), rtol=3e-6, atol=3e-7)


@pytest.mark.parametrize("hdr", [True, False])
def test_endpoint_weights_and_neutral_floor(hdr):
    branch = HDRAdjustments(blacks=100) if hdr else SDRAdjustments(blacks=100)
    knee = parameters(branch, hdr)[4]
    pixels = np.repeat(np.array([0, knee / 2, knee, knee * 2], np.float32)[None, :, None], 3, axis=-1)
    output = apply_tone(pixels, branch, hdr)
    np.testing.assert_allclose(output[0, :, 0] - pixels[0, :, 0], [0.45 * knee, 0.45 * knee / 4, 0, 0], atol=1e-9)
    np.testing.assert_array_equal(output[..., 0], output[..., 1])
    branch.blacks = -100
    assert np.all(apply_tone(pixels[:, :1], branch, hdr) == 0)


@pytest.mark.parametrize("hdr", [True, False])
@pytest.mark.parametrize("strength,gain", [(-100, 0.775), (100, 2)])
def test_whites_top_stop_and_target_with_compression_bypassed(hdr, strength, gain):
    branch = HDRAdjustments(whites=strength) if hdr else SDRAdjustments(whites=strength)
    peak = branch.highlight_compression_target_nits * 0.18 / 203 if hdr else 1
    pixels = np.repeat(np.array([peak / 4, peak / 2, peak, peak * 2], np.float32)[None, :, None], 3, axis=-1)
    output = apply_tone(pixels, branch, hdr)
    np.testing.assert_array_equal(output[:, :2], pixels[:, :2])
    np.testing.assert_allclose(output[:, 2:], pixels[:, 2:] * gain, rtol=1e-6)
    if hdr:
        branch.highlight_compression_target_nits = 2000
        np.testing.assert_array_equal(apply_tone(pixels[:, :3], branch, hdr), pixels[:, :3])


@pytest.mark.parametrize("hdr", [True, False])
def test_frozen_guide_matches_one_candidate_not_sequential_controls(hdr):
    branch = HDRAdjustments(blacks=65, shadows=80, midtones=-65, highlights=50, whites=70) if hdr else SDRAdjustments(blacks=65, shadows=80, midtones=-65, highlights=50, whites=70)
    grey = reference_grey(hdr)
    pixels = (np.geomspace(grey / 64, 2, 129)[:, None] * np.array([[0.8, 1, 0.3]])).astype(np.float32)[None]
    luma_weights = np.array([0.2722287, 0.6740818, 0.0536895] if hdr else [0.2126, 0.7152, 0.0722])
    luminance = (pixels * luma_weights).sum(-1)
    brightest = (acescg_to_linear_bt2020(pixels) if hdr else pixels).max(-1)
    amounts = parameters(branch, hdr)
    peak = branch.highlight_compression_target_nits * 0.18 / 203 if hdr else 1
    position = np.clip(np.log2(brightest / (peak / 2)), 0, 1)
    gate = _smooth(np.log2(luminance / (amounts[4] / 2))) * (1 - _smooth(2 * position))
    exponent = 0.7 * position ** 2
    for amount, zone in zip(amounts[:3], ZONES):
        exponent += amount * (1 - _smooth(np.abs(np.log2(luminance / grey) - getattr(branch, zone + "_center")) / (getattr(branch, zone + "_width") / 2))) * gate
    floor = 0.45 * 0.65 * amounts[4] * np.maximum(1 - luminance / amounts[4], 0) ** 2
    expected = pixels + amounts[3] * (pixels * np.exp2(exponent)[..., None] + floor[..., None] - pixels)
    np.testing.assert_allclose(apply_tone(pixels, branch, hdr), expected, rtol=2e-6, atol=1e-8)


@pytest.mark.parametrize("hdr", [True, False])
def test_endpoint_gates_and_gated_strength(hdr):
    branch = HDRAdjustments(shadows=100, midtones=-100, highlights=100) if hdr else SDRAdjustments(shadows=100, midtones=-100, highlights=100)
    for zone in ZONES:
        setattr(branch, zone + "_width", 24)
    knee = parameters(branch, hdr)[4]
    peak = branch.highlight_compression_target_nits * 0.18 / 203 if hdr else 1
    values = np.array([knee / 4, knee / 2, peak / np.sqrt(2), peak, 2 * peak], np.float32)
    pixels = np.repeat(values[None, :, None], 3, -1)
    np.testing.assert_allclose(apply_tone(pixels, branch, hdr), pixels, atol=1e-7)
    branch = HDRAdjustments(shadows=100) if hdr else SDRAdjustments(shadows=100)
    center = reference_grey(hdr) * 2 ** branch.shadows_center
    pixels = np.full((1, 1, 3), center, np.float32)
    amount = parameters(branch, hdr)[0]
    np.testing.assert_allclose(apply_tone(pixels, branch, hdr), pixels * 2 ** amount, rtol=1e-6)
    assert 0 < amount <= 0.6 * branch.shadows_width / 2


@pytest.mark.parametrize("hdr", [True, False])
def test_combined_limiter_on_fixed_colour_rays_and_parameter_extremes(hdr):
    reference = reference_grey(hdr)
    values = np.geomspace(reference / 1024, 16, 4097).astype(np.float32)
    colours = np.array([[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, .1, .01]], np.float32)
    if hdr:
        colours = linear_bt2020_to_acescg(colours.reshape(1, -1, 3))[0]
    luma_weights = np.array([0.2722287, 0.6740818, 0.0536895] if hdr else [0.2126, 0.7152, 0.0722])
    for strengths in itertools.product((-100, 100), repeat=3):
        for width in (0.5, 4, 24):
            branch = HDRAdjustments() if hdr else SDRAdjustments()
            branch.blacks, branch.whites = strengths[0], strengths[2]
            for zone, strength, center in zip(ZONES, strengths, (-3.5, 0, 3)):
                setattr(branch, zone, strength)
                setattr(branch, zone + "_width", width)
                setattr(branch, zone + "_center", center)
            pixels = values[None, :, None] * colours[:, None, :]
            output = apply_tone(pixels, branch, hdr)
            source_luma, output_luma = (pixels * luma_weights).sum(-1), (output * luma_weights).sum(-1)
            slope = np.diff(output_luma) / np.diff(source_luma)
            unclipped = (np.all(output[:, 1:] > 0, axis=-1)
                & np.all(output[:, :-1] > 0, axis=-1)
                & (source_luma[:, :-1] > parameters(branch, hdr)[4] / 32))
            assert np.min(slope) >= -1e-5, (hdr, strengths, width, np.min(slope))
            assert np.min(slope[unclipped]) >= 0.099, (hdr, strengths, width)
            assert 0 < parameters(branch, hdr)[3] <= 1


def test_whites_does_not_raise_the_final_hdr_ceiling():
    pixels = np.repeat(np.geomspace(1e-5, 30, 512).astype(np.float32)[None, :, None], 3, -1)
    for mode in ("fixed_cap", "peak_fit", "soft_ceiling", "clip"):
        state = AdjustmentState(hdr=HDRAdjustments(whites=100, blacks=50, shadows=50, highlight_section_enabled=True, highlight_compression_mode=mode))
        toned = apply_adjustments(pixels, state, PreviewKind.HDR, include_output_highlight_compression=False)
        output = apply_hdr_output_highlight_compression(toned, state)
        assert np.max(acescg_to_linear_bt2020(output)) <= 1000 * .18 / 203 + 1e-6


@pytest.mark.parametrize("balance", [-100, 0, 100])
@pytest.mark.parametrize("blending", [0, 50, 100])
def test_wheel_ranges_are_equal_relative_to_reference_white(balance, blending):
    grading = ColorGradingAdjustments(balance=balance, blending=blending)
    grading.shadows.luminance_ev = .7
    grading.midtones.luminance_ev = -.4
    grading.highlights.luminance_ev = .9
    ramp = np.repeat(np.geomspace(1e-4, 16, 513).astype(np.float32)[None, :, None], 3, -1)
    hdr = _apply_color_grading(ramp * .18, grading, PreviewKind.HDR) / .18
    sdr = _apply_color_grading(ramp * (100 / 203), grading, PreviewKind.SDR) / (100 / 203)
    np.testing.assert_allclose(hdr, sdr, rtol=2e-6, atol=1e-7)
