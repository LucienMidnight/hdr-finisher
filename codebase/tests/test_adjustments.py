from __future__ import annotations

import copy

import numpy as np
import pytest

from hdr_finisher.adjustments import apply_adjustments, _apply_hdr_adjustments, _apply_sdr_adjustments, _curve_domain_encode, _curve_domain_decode
from hdr_finisher.analysis import classify_hdr
from hdr_finisher.models import AdjustmentState, HDRAdjustments, PreviewKind, SDRAdjustments, SourceLatitude


def test_gentle_contrast_at_max_slider_stays_in_range() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(contrast=0.5))
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.5
    output = _apply_sdr_adjustments(image, state)
    assert output.min() >= 0.0, "SDR contrast should not produce negative values"
    assert output.max() <= 1.0, "SDR contrast at max should not exceed 1.0"


def test_gentle_contrast_negative_at_max_slider_stays_in_range() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(contrast=-0.5))
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.5
    output = _apply_sdr_adjustments(image, state)
    assert output.min() >= 0.0, "SDR negative contrast should not produce negative values"
    assert output.max() <= 1.0, "SDR negative contrast should not exceed 1.0"


def test_sdr_contrast_is_gentle_for_scene_linear_midtones() -> None:
    levels = np.array([0.03, 0.08, 0.18, 0.35, 0.7], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
    )
    contrasted = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(contrast=0.25, highlight_recovery=0.0)),
    )

    assert np.all(np.diff(contrasted[0, :, 0]) > 0.0)
    assert 0.0 < float(np.max(np.abs(contrasted - baseline))) < 0.08


def test_sdr_lift_is_a_fine_perceptual_shadow_adjustment() -> None:
    image = np.full((2, 2, 3), 0.03, dtype=np.float32)
    baseline = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
    )
    lifted = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(lift=0.1, highlight_recovery=0.0)),
    )

    change = float(np.max(lifted - baseline))
    assert 0.0 < change < 0.02


def test_sdr_shadow_multiplier_is_gentle() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(shadow=1.0))
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.3
    output = _apply_sdr_adjustments(image, state)
    assert output.max() <= 1.0, "SDR shadow at max should not clip to above 1.0"


def test_log_domain_hdr_curves_no_infinities_up_to_peak_10() -> None:
    image = np.array([[[1.0, 2.0, 5.0], [3.0, 8.0, 10.0]]], dtype=np.float32)
    encoded = _curve_domain_encode(image, PreviewKind.HDR)
    assert not np.any(np.isinf(encoded)), "Log HDR curves should not produce infinities"
    assert not np.any(np.isnan(encoded)), "Log HDR curves should not produce NaNs"
    assert encoded.max() <= 1.0, "Encoded HDR values should be normalized to 0-1"
    decoded = _curve_domain_decode(encoded, PreviewKind.HDR)
    assert not np.any(np.isinf(decoded)), "Decoded HDR curves should not produce infinities"
    assert not np.any(np.isnan(decoded)), "Decoded HDR curves should not produce NaNs"


def test_hdr_curves_preserve_high_values() -> None:
    image = np.array([[[10.0, 8.0, 6.0]]], dtype=np.float32)
    encoded = _curve_domain_encode(image, PreviewKind.HDR)
    decoded = _curve_domain_decode(encoded, PreviewKind.HDR)
    assert decoded[0, 0, 0] > 5.0, "HDR curve decode should preserve high values above 1.0"


def test_tiny_hdr_contrast_change_does_not_clamp_wide_exr_values() -> None:
    image = np.array([[[10.0, 50.0, 1000.0]]], dtype=np.float32)
    state = AdjustmentState(hdr=HDRAdjustments(highlight_rolloff=0.0, contrast=0.005))

    output = _apply_hdr_adjustments(image, state)

    assert output.max() > 900.0
    assert output[0, 0, 2] > output[0, 0, 1] > output[0, 0, 0]


def test_identity_hdr_curves_preserve_values_above_curve_editor_range() -> None:
    image = np.array([[[10.0, 50.0, 1000.0]]], dtype=np.float32)
    state = AdjustmentState(hdr=HDRAdjustments(highlight_rolloff=0.0, curves_enabled=True))

    output = _apply_hdr_adjustments(image, state)

    np.testing.assert_allclose(output, image, rtol=1e-5, atol=1e-5)


def test_hdr_shadow_lift_is_luminance_masked() -> None:
    state = AdjustmentState(hdr=HDRAdjustments(shadow_lift=0.3))
    dark_image = np.ones((4, 4, 3), dtype=np.float32) * 0.1
    bright_image = np.ones((4, 4, 3), dtype=np.float32) * 2.0
    dark_output = _apply_hdr_adjustments(dark_image, state)
    bright_output = _apply_hdr_adjustments(bright_image, state)
    dark_gain = dark_output.mean() / dark_image.mean()
    bright_gain = bright_output.mean() / bright_image.mean()
    assert dark_gain > bright_gain, "HDR shadow lift should affect dark areas more than bright ones"


def test_hdr_shadow_lift_does_not_clip() -> None:
    state = AdjustmentState(hdr=HDRAdjustments(shadow_lift=0.5))
    image = np.ones((4, 4, 3), dtype=np.float32) * 3.0
    output = _apply_hdr_adjustments(image, state)
    assert not np.any(np.isinf(output)), "HDR shadow lift should not produce infinities"


def test_hdr_highlight_rolloff_preserves_wide_exr_latitude_and_ordering() -> None:
    levels = np.array([1.0, 2.0, 10.0, 50.0, 1000.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)

    output = _apply_hdr_adjustments(image, AdjustmentState())

    assert output.max() > 500.0
    assert np.all(np.diff(output[0, :, 0]) > 0.0)


def test_single_hdr_highlight_rolloff_step_is_gradual() -> None:
    image = np.ones((1, 1, 3), dtype=np.float32) * 1000.0
    baseline = _apply_hdr_adjustments(image, AdjustmentState(hdr=HDRAdjustments(highlight_rolloff=0.25)))
    stepped = _apply_hdr_adjustments(image, AdjustmentState(hdr=HDRAdjustments(highlight_rolloff=0.30)))

    assert stepped[0, 0, 0] / baseline[0, 0, 0] > 0.9


@pytest.mark.parametrize(
    ("kind", "branch_name", "pivot_step"),
    [
        (PreviewKind.HDR, "hdr", 0.0005),
        (PreviewKind.SDR, "sdr", 0.005),
    ],
)
def test_active_contrast_pivot_step_is_gradual(kind: PreviewKind, branch_name: str, pivot_step: float) -> None:
    levels = np.geomspace(0.001, 100.0, 256, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline_state = AdjustmentState()
    moved_state = copy.deepcopy(baseline_state)
    baseline_branch = getattr(baseline_state, branch_name)
    moved_branch = getattr(moved_state, branch_name)
    baseline_branch.contrast = 0.25
    moved_branch.contrast = 0.25
    moved_branch.contrast_pivot += pivot_step

    baseline = apply_adjustments(image, baseline_state, kind)
    moved = apply_adjustments(image, moved_state, kind)
    scale = max(float(np.max(np.abs(baseline))), 1e-6)

    assert np.all(np.isfinite(moved))
    assert np.all(np.diff(moved[0, :, 0]) >= -1e-6)
    assert float(np.max(np.abs(moved - baseline))) / scale < 0.01


def test_classify_heic_returns_narrow_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {"heif_aux_types": ["hdr"]}, ".heic")
    assert analysis.source_latitude == SourceLatitude.NARROW


def test_classify_hdr_true_exr_returns_wide_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 2.0
    analysis = classify_hdr(image, {}, ".exr")
    assert analysis.source_latitude == SourceLatitude.WIDE


def test_classify_sdr_png_returns_narrow_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {}, ".png")
    assert analysis.source_latitude == SourceLatitude.MEDIUM


def test_classify_sdr_tiff_returns_narrow_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {}, ".tif")
    assert analysis.source_latitude == SourceLatitude.NARROW


def test_classify_linear_exr_returns_wide_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {"transfer_function": "LINEAR"}, ".exr")
    assert analysis.source_latitude == SourceLatitude.WIDE


def test_sdr_exposure_applied_before_tone_mapping_preserves_headroom() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(exposure=2.0, tone_mapper="aces"))
    image = np.ones((4, 4, 3), dtype=np.float32) * 2.0
    output = _apply_sdr_adjustments(image, state)
    assert output.max() <= 1.0, "SDR exposure should tone-map back into display range"


def test_sdr_tone_mapping_preserves_wide_exr_highlight_ordering() -> None:
    levels = np.array([1.0, 2.0, 10.0, 50.0, 1000.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)

    output = _apply_sdr_adjustments(image, AdjustmentState())
    output_levels = output[0, :, 0]

    assert np.all(np.diff(output_levels) > 0.0)


def test_default_sdr_render_holds_scene_middle_gray() -> None:
    image = np.full((2, 2, 3), 0.18, dtype=np.float32)
    output = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
    )

    assert np.allclose(output, 0.18, atol=0.005)


def test_filmic_curve_contrast_changes_steepness_around_middle_gray() -> None:
    levels = np.array([0.04, 0.18, 1.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    soft = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_contrast=0.6, highlight_recovery=0.0)),
    )[0, :, 0]
    strong = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_contrast=1.4, highlight_recovery=0.0)),
    )[0, :, 0]

    assert strong[0] < soft[0]
    assert np.isclose(strong[1], soft[1], atol=0.005)
    assert strong[2] > soft[2]


def test_filmic_skew_moves_emphasis_between_shadows_and_highlights() -> None:
    levels = np.array([0.04, 0.18, 1.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    toward_shadows = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_skew=-0.8, highlight_recovery=0.0)),
    )[0, :, 0]
    toward_highlights = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_skew=0.8, highlight_recovery=0.0)),
    )[0, :, 0]

    assert toward_highlights[0] > toward_shadows[0]
    assert np.isclose(toward_highlights[1], toward_shadows[1], atol=0.005)
    assert toward_highlights[2] > toward_shadows[2]


def test_default_sdr_render_compresses_wide_gamut_colors_without_clipping_hue() -> None:
    image = np.array([[[2.0, 0.15, 0.02], [0.02, 1.5, 0.1], [0.05, 0.2, 3.0]]], dtype=np.float32)
    output = _apply_sdr_adjustments(image, AdjustmentState())

    assert np.all(np.isfinite(output))
    assert float(output.min()) >= 0.0
    assert float(output.max()) <= 1.0
    assert np.all(np.sum(output, axis=-1) > 0.0)


def test_sdr_highlight_recovery_is_visible_and_targets_highlights() -> None:
    levels = np.array([0.18, 0.5, 1.0, 4.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)))
    recovered = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(highlight_recovery=1.0)))
    baseline_levels = baseline[0, :, 0]
    recovered_levels = recovered[0, :, 0]

    assert baseline_levels[-1] - recovered_levels[-1] > 0.1
    assert recovered_levels[0] / baseline_levels[0] > recovered_levels[-1] / baseline_levels[-1]
    assert np.all(np.diff(recovered_levels) > 0.0)


def test_sdr_reference_highlight_recovery_holds_mid_gray_and_recovers_white() -> None:
    levels = np.array([0.05, 0.18, 0.5, 1.0], dtype=np.float32)
    reference = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    scene = np.ones_like(reference)
    baseline = apply_adjustments(
        scene,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
        PreviewKind.SDR,
        sdr_reference_image=reference,
    )
    recovered = apply_adjustments(
        scene,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=1.0)),
        PreviewKind.SDR,
        sdr_reference_image=reference,
    )

    assert abs(float(recovered[0, 1, 0]) - float(baseline[0, 1, 0])) < 1e-6
    assert float(baseline[0, -1, 0] - recovered[0, -1, 0]) > 0.15
    assert np.all(np.diff(recovered[0, :, 0]) > 0.0)


def test_single_sdr_exposure_step_is_continuous_for_wide_exr() -> None:
    levels = np.geomspace(0.001, 1000.0, 128, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(exposure=0.0)))
    stepped = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(exposure=0.1)))

    assert np.max(np.abs(stepped - baseline)) < 0.06
    assert np.mean(np.abs(stepped - baseline)) > 0.0


@pytest.mark.parametrize(
    ("kind", "path", "step"),
    [
        (PreviewKind.HDR, "hdr.exposure", 0.05),
        (PreviewKind.HDR, "hdr.highlight_rolloff", 0.01),
        (PreviewKind.HDR, "hdr.shadow_lift", 0.005),
        (PreviewKind.HDR, "hdr.lift", 0.005),
        (PreviewKind.HDR, "hdr.gamma", 0.005),
        (PreviewKind.HDR, "hdr.gain", 0.005),
        (PreviewKind.HDR, "hdr.contrast", 0.001),
        (PreviewKind.HDR, "hdr.white_balance_kelvin", 50),
        (PreviewKind.HDR, "hdr.tint", 0.01),
        (PreviewKind.SDR, "sdr.exposure", 0.05),
        (PreviewKind.SDR, "sdr.highlight_recovery", 0.01),
        (PreviewKind.SDR, "sdr.shadow", 0.01),
        (PreviewKind.SDR, "sdr.lift", 0.002),
        (PreviewKind.SDR, "sdr.gamma", 0.005),
        (PreviewKind.SDR, "sdr.gain", 0.005),
        (PreviewKind.SDR, "sdr.contrast", 0.001),
    ],
)
def test_one_slider_step_is_finite_ordered_and_gradual(kind: PreviewKind, path: str, step: float) -> None:
    levels = np.geomspace(1e-6, 1000.0, 512, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline_state = AdjustmentState()
    moved_state = copy.deepcopy(baseline_state)
    branch_name, field_name = path.split(".")
    branch = getattr(moved_state, branch_name)
    setattr(branch, field_name, getattr(branch, field_name) + step)

    baseline = apply_adjustments(image, baseline_state, kind)
    moved = apply_adjustments(image, moved_state, kind)
    scale = max(float(np.max(baseline) - np.min(baseline)), 1e-6)

    assert np.all(np.isfinite(moved)), f"{path} produced non-finite pixels"
    assert np.all(np.diff(moved[0, :, 0]) >= -1e-6), f"{path} inverted grayscale luminance ordering"
    assert float(np.max(np.abs(moved - baseline))) / scale < 0.12, f"{path} changed too much in one UI step"


@pytest.mark.parametrize(
    ("path", "step"),
    [
        ("sdr.exposure", 0.05),
        ("sdr.highlight_recovery", 0.01),
        ("sdr.shadow", 0.01),
        ("sdr.lift", 0.002),
        ("sdr.gamma", 0.005),
        ("sdr.gain", 0.005),
        ("sdr.contrast", 0.001),
    ],
)
def test_sdr_reference_slider_step_is_finite_ordered_and_gradual(path: str, step: float) -> None:
    scene_levels = np.geomspace(1e-6, 1000.0, 512, dtype=np.float32)
    scene_image = np.repeat(scene_levels.reshape(1, -1, 1), 3, axis=2)
    reference_levels = np.linspace(0.0, 1.0, 512, dtype=np.float32)
    reference_image = np.repeat(reference_levels.reshape(1, -1, 1), 3, axis=2)
    baseline_state = AdjustmentState()
    moved_state = copy.deepcopy(baseline_state)
    branch_name, field_name = path.split(".")
    branch = getattr(moved_state, branch_name)
    setattr(branch, field_name, getattr(branch, field_name) + step)

    baseline = apply_adjustments(scene_image, baseline_state, PreviewKind.SDR, sdr_reference_image=reference_image)
    moved = apply_adjustments(scene_image, moved_state, PreviewKind.SDR, sdr_reference_image=reference_image)

    assert np.all(np.isfinite(moved)), f"{path} produced non-finite SDR-reference pixels"
    assert np.all(np.diff(moved[0, :, 0]) >= -1e-6), f"{path} inverted SDR-reference luminance ordering"
    assert float(np.max(np.abs(moved - baseline))) < 0.12, f"{path} changed too much in one UI step"
