from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.analysis import classify_hdr
from hdr_finisher.color import normalize_to_acescg, sanitize_array
from hdr_finisher.exporters import _linear_to_bt2020_pq_yuv10, _linear_to_pq_rgb10, _linear_to_srgb8
from hdr_finisher.loader import _apply_apple_hdr_gainmap, _compute_apple_headroom
from hdr_finisher.models import AdjustmentState, ExportSettings, HDRAdjustments, HDRClassification, PreviewKind
from hdr_finisher.overlay import build_overlay_rgba
from hdr_finisher.preview import downsample_image
from hdr_finisher.models import ScopeMode
from hdr_finisher.scopes import _rgb_to_reference_nits, build_scope


def test_sanitize_array_replaces_invalid_values() -> None:
    image = np.array([[[np.nan, np.inf, -1.0]]], dtype=np.float32)
    sanitized = sanitize_array(image)
    assert sanitized.dtype == np.float32
    assert sanitized[0, 0, 0] == 0.0
    assert sanitized[0, 0, 1] > 1.0
    assert sanitized[0, 0, 2] == 0.0


def test_hdr_true_classification_when_values_exceed_one() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 2.0
    analysis = classify_hdr(image, {"color_space": "ACEScg"}, ".exr")
    assert analysis.classification == HDRClassification.HDR_TRUE


def test_linear_unconfirmed_when_linear_metadata_has_no_headroom() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.9
    analysis = classify_hdr(image, {"transfer_function": "LINEAR"}, ".tif")
    assert analysis.classification == HDRClassification.HDR_LINEAR_UNCONFIRMED
    assert analysis.needs_color_override is True


def test_sdr_adjustments_return_display_safe_range() -> None:
    image = np.ones((4, 4, 3), dtype=np.float32) * 3.0
    output = apply_adjustments(image, AdjustmentState(), PreviewKind.SDR)
    assert output.max() <= 1.0


def test_preview_downsample_obeys_long_edge_cap() -> None:
    image = np.zeros((200, 400, 3), dtype=np.float32)
    result = downsample_image(image, 100)
    assert max(result.shape[:2]) == 100


def test_sdr_export_quantization_returns_uint8() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    quantized = _linear_to_srgb8(image)
    assert quantized.dtype == np.uint8
    assert quantized.max() <= 255


def test_hdr_export_quantization_returns_10bit() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 4.0
    quantized = _linear_to_pq_rgb10(image)
    assert quantized.dtype == np.uint16
    assert quantized.max() <= 1023
    assert quantized.min() >= 0


def test_hdr_yuv_conversion_keeps_gray_chroma_neutral() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    quantized = _linear_to_bt2020_pq_yuv10(image)
    assert quantized.dtype == np.uint16
    assert np.all(quantized[..., 0] >= 64)
    assert np.all(quantized[..., 0] <= 940)
    assert np.all(quantized[..., 1] == 512)
    assert np.all(quantized[..., 2] == 512)


def test_normalize_srgb_to_acescg_applies_real_transform() -> None:
    image = np.array([[[1.0, 0.0, 0.0]]], dtype=np.float32)
    normalized = normalize_to_acescg(image, "sRGB", None)
    assert normalized.dtype == np.float32
    assert normalized[0, 0, 0] < 1.0
    assert normalized[0, 0, 1] > 0.0


def test_normalize_pq_bt2020_to_acescg_creates_hdr_headroom() -> None:
    image = np.ones((1, 1, 3), dtype=np.float32) * 0.75
    normalized = normalize_to_acescg(image, "BT.2020", "PQ")
    assert normalized.dtype == np.float32
    assert normalized[0, 0, 0] > 1.0


def test_normalize_acescg_linear_is_passthrough() -> None:
    image = np.array([[[0.25, 0.5, 1.0]]], dtype=np.float32)
    normalized = normalize_to_acescg(image, "ACEScg", "LINEAR")
    assert np.allclose(normalized, image)


def test_heif_aux_metadata_flags_encoded_warning() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.3
    analysis = classify_hdr(image, {"heif_aux_types": ["urn:com:apple:photo:2020:aux:hdrgainmap"]}, ".heic")
    assert analysis.classification == HDRClassification.HDR_ENCODED
    assert analysis.needs_color_override is True


def test_compute_apple_headroom_returns_hdr_scale() -> None:
    headroom = _compute_apple_headroom(1.0, 0.3405120511)
    assert headroom > 4.0


def test_apply_apple_hdr_gainmap_increases_highlight_energy() -> None:
    base = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    gainmap = np.ones((2, 2), dtype=np.float32)
    combined = _apply_apple_hdr_gainmap(base, gainmap, 4.5)
    assert combined.shape == base.shape
    assert combined.max() > 0.5


def test_sdr_curves_apply_only_to_active_focus() -> None:
    image = np.ones((1, 1, 3), dtype=np.float32) * 0.5
    adjustments = AdjustmentState.model_validate(
        {
            "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
            "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
            "shared": {
                "active_focus": "sdr",
                "curves_enabled": True,
                "luma_curve": [[0.0, 0.0], [0.18, 0.2], [0.45, 0.35], [0.72, 0.55], [1.0, 0.8]],
                "red_curve": [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]],
                "green_curve": [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]],
                "blue_curve": [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]],
            },
        }
    )

    sdr_output = apply_adjustments(image, adjustments, PreviewKind.SDR)
    hdr_output = apply_adjustments(image, adjustments, PreviewKind.HDR)
    baseline_hdr = apply_adjustments(image, AdjustmentState(), PreviewKind.HDR)

    assert sdr_output.mean() < 0.5
    assert np.allclose(hdr_output, baseline_hdr)


def test_hdr_curves_can_bias_individual_channels() -> None:
    image = np.array([[[2.0, 1.0, 1.0]]], dtype=np.float32)
    adjustments = AdjustmentState.model_validate(
        {
            "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
            "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
            "shared": {
                "active_focus": "hdr",
                "curves_enabled": True,
                "luma_curve": [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]],
                "red_curve": [[0.0, 0.0], [0.2, 0.3], [0.45, 0.65], [0.7, 0.9], [1.0, 1.0]],
                "green_curve": [[0.0, 0.0], [0.2, 0.2], [0.45, 0.45], [0.7, 0.65], [1.0, 0.9]],
                "blue_curve": [[0.0, 0.0], [0.2, 0.2], [0.45, 0.45], [0.7, 0.65], [1.0, 0.9]],
            },
        }
    )

    output = apply_adjustments(image, adjustments, PreviewKind.HDR)
    assert output[0, 0, 0] > output[0, 0, 1]


def test_hdr_branch_curves_do_not_affect_sdr_branch() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    baseline = apply_adjustments(image, AdjustmentState(), PreviewKind.SDR)
    adjustments = AdjustmentState.model_validate(
        {
            "hdr": {
                "curves_enabled": True,
                "luma_curve": [[0.0, 0.0], [0.4, 0.08], [1.0, 0.08]],
            },
            "sdr": {"curves_enabled": False},
        }
    )

    output = apply_adjustments(image, adjustments, PreviewKind.SDR)
    assert np.allclose(output, baseline)


def test_all_hdr_lane_controls_are_isolated_from_sdr_fallback() -> None:
    image = np.array([[[0.05, 0.18, 0.5], [1.0, 4.0, 20.0]]], dtype=np.float32)
    baseline = apply_adjustments(image, AdjustmentState(), PreviewKind.SDR)
    adjustments = AdjustmentState.model_validate(
        {
            "hdr": {
                "exposure": 1.5,
                "highlight_rolloff": 1.5,
                "shadow_lift": 0.4,
                "lift": 0.2,
                "gamma": -0.3,
                "gain": 0.25,
                "contrast": 0.5,
                "contrast_pivot": 0.3,
                "white_balance_kelvin": 11000,
                "tint": 0.8,
                "curves_enabled": True,
                "luma_curve": [[0.0, 0.0], [0.5, 0.1], [1.0, 0.3]],
            }
        }
    )

    output = apply_adjustments(image, adjustments, PreviewKind.SDR)

    np.testing.assert_allclose(output, baseline, rtol=0.0, atol=0.0)


def test_all_hdr_lane_controls_are_isolated_from_embedded_sdr_reference() -> None:
    scene = np.ones((1, 3, 3), dtype=np.float32) * 4.0
    reference = np.repeat(np.array([0.1, 0.5, 0.9], dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    baseline = apply_adjustments(scene, AdjustmentState(), PreviewKind.SDR, sdr_reference_image=reference)
    adjustments = AdjustmentState.model_validate(
        {
            "hdr": {
                "exposure": -2.0,
                "highlight_rolloff": 2.0,
                "shadow_lift": -0.5,
                "lift": -0.4,
                "gamma": 0.6,
                "gain": -0.3,
                "contrast": -0.7,
                "white_balance_kelvin": 2500,
                "tint": -0.9,
            }
        }
    )

    output = apply_adjustments(scene, adjustments, PreviewKind.SDR, sdr_reference_image=reference)

    np.testing.assert_allclose(output, baseline, rtol=0.0, atol=0.0)


def test_sdr_branch_curves_do_not_affect_hdr_branch() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    baseline = apply_adjustments(image, AdjustmentState(), PreviewKind.HDR)
    adjustments = AdjustmentState.model_validate(
        {
            "hdr": {"curves_enabled": False},
            "sdr": {
                "curves_enabled": True,
                "luma_curve": [[0.0, 0.0], [0.4, 0.08], [1.0, 0.08]],
            },
        }
    )

    output = apply_adjustments(image, adjustments, PreviewKind.HDR)
    assert np.allclose(output, baseline)


def test_variable_point_curves_are_supported() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    adjustments = AdjustmentState.model_validate(
        {
            "sdr": {
                "curves_enabled": True,
                "luma_curve": [[0.0, 0.0], [0.2, 0.12], [0.5, 0.35], [0.7, 0.55], [0.9, 0.72], [1.0, 0.85]],
            }
        }
    )

    output = apply_adjustments(image, adjustments, PreviewKind.SDR)
    assert output.mean() < apply_adjustments(image, AdjustmentState(), PreviewKind.SDR).mean()


def test_sdr_lift_gamma_gain_controls_target_luminance_sections() -> None:
    image = np.array([[[0.08, 0.08, 0.08], [0.5, 0.5, 0.5], [0.9, 0.9, 0.9]]], dtype=np.float32)
    lifted = apply_adjustments(image, AdjustmentState.model_validate({"sdr": {"lift": 0.15}}), PreviewKind.SDR)
    gained = apply_adjustments(image, AdjustmentState.model_validate({"sdr": {"gain": 0.15}}), PreviewKind.SDR)
    baseline = apply_adjustments(image, AdjustmentState(), PreviewKind.SDR)

    assert lifted[0, 0].mean() - baseline[0, 0].mean() > lifted[0, 2].mean() - baseline[0, 2].mean()
    assert gained[0, 2].mean() - baseline[0, 2].mean() > gained[0, 0].mean() - baseline[0, 0].mean()


def test_hdr_contrast_pivot_keeps_middle_gray_near_stable() -> None:
    image = np.array([[[0.1845, 0.1845, 0.1845], [2.0, 2.0, 2.0]]], dtype=np.float32)
    output = apply_adjustments(image, AdjustmentState.model_validate({"hdr": {"contrast": 0.5, "contrast_pivot": 0.1845}}), PreviewKind.HDR)

    assert abs(float(output[0, 0].mean()) - 0.1845) < 0.02
    assert output[0, 1].mean() > image[0, 1].mean()


def test_false_color_overlay_returns_rgba_pixels() -> None:
    image = np.ones((4, 4, 3), dtype=np.float32) * 2.0
    adjustments = AdjustmentState.model_validate(
        {
            "shared": {
                "overlay_mode": "false_color",
                "overlay_opacity": 0.7,
            }
        }
    )

    overlay = build_overlay_rgba(image, adjustments, PreviewKind.HDR)
    assert overlay.shape == (4, 4, 4)
    assert overlay.dtype == np.uint8
    assert overlay[..., 3].max() > 0


def test_zebra_overlay_is_transparent_below_threshold() -> None:
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.2
    adjustments = AdjustmentState.model_validate(
        {
            "shared": {
                "overlay_mode": "zebra",
                "overlay_opacity": 0.8,
                "overlay_threshold": 2.0,
            }
        }
    )

    overlay = build_overlay_rgba(image, adjustments, PreviewKind.HDR)
    assert overlay.shape == (4, 4, 4)
    assert np.all(overlay[..., 3] == 0)


def test_overlay_opacity_step_changes_alpha_gradually() -> None:
    image = np.ones((4, 4, 3), dtype=np.float32) * 2.0
    baseline = build_overlay_rgba(
        image,
        AdjustmentState.model_validate({"shared": {"overlay_mode": "zebra", "overlay_opacity": 0.72}}),
        PreviewKind.HDR,
    )
    stepped = build_overlay_rgba(
        image,
        AdjustmentState.model_validate({"shared": {"overlay_mode": "zebra", "overlay_opacity": 0.73}}),
        PreviewKind.HDR,
    )

    assert 1 <= int(stepped[..., 3].max()) - int(baseline[..., 3].max()) <= 4


def test_zebra_threshold_step_moves_cutoff_without_invalid_alpha() -> None:
    levels = np.linspace(0.15, 0.25, 32, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline = build_overlay_rgba(
        image,
        AdjustmentState.model_validate({"shared": {"overlay_mode": "zebra", "overlay_threshold": 1.0}}),
        PreviewKind.HDR,
    )
    stepped = build_overlay_rgba(
        image,
        AdjustmentState.model_validate({"shared": {"overlay_mode": "zebra", "overlay_threshold": 1.05}}),
        PreviewKind.HDR,
    )

    assert np.count_nonzero(stepped[..., 3]) <= np.count_nonzero(baseline[..., 3])
    assert stepped[..., 3].dtype == np.uint8


def test_export_quality_slider_bounds_are_enforced() -> None:
    assert ExportSettings(quality=1).quality == 1
    assert ExportSettings(quality=100).quality == 100
    with pytest.raises(ValueError):
        ExportSettings(quality=0)
    with pytest.raises(ValueError):
        ExportSettings(quality=101)


def test_hdr_scope_reports_reference_nits_and_stats() -> None:
    image = np.ones((8, 8, 3), dtype=np.float32) * 1.8
    scope = build_scope(image, AdjustmentState(), PreviewKind.HDR)
    assert scope.scope_type == "reference_nits_histogram"
    assert scope.x_axis == "reference_nits_log10"
    assert len(scope.guides) >= 5
    assert any(stat.label == "Peak" for stat in scope.stats)
    assert len(scope.bin_edges) == 65
    assert any(channel.name == "Y" for channel in scope.channels)


def test_reference_nits_anchor_matches_prd_values() -> None:
    image = np.array([[[0.18, 0.18, 0.18], [1.8, 1.8, 1.8]]], dtype=np.float32)
    nits = _rgb_to_reference_nits(image)
    assert np.allclose(nits[0, 0], 100.0)
    assert np.allclose(nits[0, 1], 1000.0)


def test_hdr_scope_threshold_percentages_for_known_luminance() -> None:
    image = np.zeros((2, 2, 3), dtype=np.float32)
    image[0, 0, :] = 0.18
    image[0, 1, :] = 0.3654
    image[1, 0, :] = 1.8
    image[1, 1, :] = 0.09
    adjustments = AdjustmentState(hdr=HDRAdjustments(highlight_rolloff=0))
    scope = build_scope(image, adjustments, PreviewKind.HDR)
    stats = {stat.label: stat.value for stat in scope.stats}
    assert stats["Peak"] == "1000.0 nit"
    assert stats["% > 100"] == "50.00%"
    assert stats["% > 203"] == "25.00%"
    assert stats["% > 1000"] == "0.00%"


def test_sdr_scope_reports_normalized_histogram() -> None:
    image = np.ones((8, 8, 3), dtype=np.float32) * 0.5
    scope = build_scope(image, AdjustmentState(), PreviewKind.SDR)
    assert scope.scope_type == "normalized_histogram"
    assert scope.x_axis == "normalized"
    assert len(scope.guides) == 3
    assert any(channel.name == "Y" for channel in scope.channels)


def test_hdr_waveform_reports_density_grid() -> None:
    image = np.linspace(0.18, 3.6, 32, dtype=np.float32)
    image = np.tile(image, (16, 1))
    image = np.stack([image, image, image], axis=-1)
    scope = build_scope(image, AdjustmentState(), PreviewKind.HDR, ScopeMode.WAVEFORM)
    assert scope.scope_type == "reference_nits_waveform"
    assert scope.channels[0].bins == []
    assert len(scope.channels[0].grid) == 64
    assert len(scope.channels[0].grid[0]) > 0
    assert any(channel.name == "Y" for channel in scope.channels)


def test_hdr_waveform_places_bright_columns_higher_than_dark_columns() -> None:
    image = np.ones((8, 8, 3), dtype=np.float32) * 0.18
    image[:, 4:, :] = 1.8
    adjustments = AdjustmentState(hdr=HDRAdjustments(highlight_rolloff=0))
    scope = build_scope(image, adjustments, PreviewKind.HDR, ScopeMode.WAVEFORM, bins=16, waveform_columns=8)
    y_grid = np.array(next(channel.grid for channel in scope.channels if channel.name == "Y"))
    first_half_row = int(np.argmax(y_grid[:, :4].sum(axis=1)))
    second_half_row = int(np.argmax(y_grid[:, 4:].sum(axis=1)))
    assert second_half_row > first_half_row


def test_sdr_source_has_predictable_internal_hdr_scope_anchor() -> None:
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.18
    analysis = classify_hdr(image, {}, ".png")
    scope = build_scope(image, AdjustmentState(), PreviewKind.HDR)
    stats = {stat.label: stat.value for stat in scope.stats}
    assert analysis.classification == HDRClassification.SDR_ONLY
    assert stats["Peak"] == "100.0 nit"
