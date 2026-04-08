from __future__ import annotations

import numpy as np

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.analysis import classify_hdr
from hdr_finisher.color import normalize_to_acescg, sanitize_array
from hdr_finisher.exporters import _linear_to_bt2020_pq_yuv10, _linear_to_pq_rgb10, _linear_to_srgb8
from hdr_finisher.loader import _apply_apple_hdr_gainmap, _compute_apple_headroom
from hdr_finisher.models import AdjustmentState, HDRClassification, PreviewKind
from hdr_finisher.preview import downsample_image


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
