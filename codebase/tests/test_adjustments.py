from __future__ import annotations

import numpy as np

from hdr_finisher.adjustments import _apply_hdr_adjustments, _apply_sdr_adjustments, _curve_domain_encode, _curve_domain_decode
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