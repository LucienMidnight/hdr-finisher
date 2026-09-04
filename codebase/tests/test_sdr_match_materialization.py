from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import tifffile

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.models import (
    AdjustmentState,
    LocalAdjustment,
    MaskExpression,
    MaskLeaf,
    PreviewKind,
    SDRAdjustments,
)
from hdr_finisher.sdr_match import (
    MATCH_SHOULDER_START,
    SDRMatchMaterializationError,
    _materialize_local_grades,
    build_sdr_match_target,
    materialize_sdr_match,
)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hdr_match_scene.tiff"
SDR_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
HDR_LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)


def _calibrated_grade() -> tuple[AdjustmentState, list[LocalAdjustment]]:
    adjustments = AdjustmentState()
    hdr = adjustments.hdr
    hdr.exposure = 0.2
    hdr.contrast = 0.12
    hdr.saturation = 0.1
    hdr.tone_equalizer_nodes[-1].adjustment_ev = 0.2
    hdr.luma_curve = [[0, 0], [0.25, 0.23], [0.5, 0.5], [0.75, 0.78], [1, 1]]
    hdr.color_grading.highlights.luminance_ev = 0.15
    hdr.color_grading.highlights.saturation = 18
    hdr.film_look.print_strength = 8
    hdr.film_look.highlight_desaturation = 12
    hdr.film_look.bloom_amount = 6
    hdr.film_look.halation_amount = 5
    hdr.detail.clarity_amount = 4
    hdr.vignette.amount = -4

    local = LocalAdjustment(name="Calibrated highlight mask")
    local.hdr_grade.exposure = 0.2
    local.hdr_grade.highlights = 0.4
    local.hdr_grade.saturation = 0.08
    return adjustments, [local]


def _curve_is_identity(points: list[list[float]]) -> bool:
    return all(abs(x - y) < 1e-7 for x, y in points)


def _curve_has_useful_slope(points: list[list[float]]) -> bool:
    values = np.asarray(points, dtype=np.float32)
    return bool(np.all(np.diff(values[:, 1]) / np.diff(values[:, 0]) >= 0.19))


def test_calibrated_scene_materializes_into_normal_visible_modules() -> None:
    source = tifffile.imread(FIXTURE).astype(np.float32)
    adjustments, locals_ = _calibrated_grade()
    settled_hdr = apply_adjustments(
        source, adjustments, PreviewKind.HDR, include_grain=False, local_adjustments=locals_
    )
    result = materialize_sdr_match(
        source,
        adjustments,
        locals_,
        reference_white_nits=203,
        source_pixel_scale=1.0,
        settled_hdr=settled_hdr,
    )

    assert result.status in {"matched", "needs_review"}
    assert result.quality.median_luma_error <= 0.012
    assert result.quality.p95_luma_error <= 0.05
    assert result.quality.median_oklab_error <= 0.015
    assert result.quality.p95_oklab_error <= 0.05
    if result.status == "matched":
        assert result.quality.p95_luma_error <= 0.03
        assert result.quality.p95_oklab_error <= 0.04
    assert result.adjustments.sdr.rendering_version == "highlight_v2"
    assert result.adjustments.sdr.use_authored_base is False
    assert result.adjustments.sdr.highlight_section_enabled is True
    assert result.adjustments.sdr.highlight_compression_mode == "peak_fit"
    assert result.adjustments.sdr.highlight_compression_color_handling == "preserve_color"
    assert _curve_is_identity(result.adjustments.sdr.luma_curve)
    assert any(abs(node.adjustment_ev) > 0.001 for node in result.adjustments.sdr.tone_equalizer_nodes)
    tone_targets = [node.input_ev + node.adjustment_ev for node in result.adjustments.sdr.tone_equalizer_nodes]
    assert np.all(np.diff(tone_targets) > 0.0)
    for curve in (
        result.adjustments.sdr.red_curve,
        result.adjustments.sdr.green_curve,
        result.adjustments.sdr.blue_curve,
    ):
        assert len(curve) <= 7
        assert _curve_has_useful_slope(curve)
    assert any(
        not _curve_is_identity(curve)
        for curve in (
            result.adjustments.sdr.red_curve,
            result.adjustments.sdr.green_curve,
            result.adjustments.sdr.blue_curve,
        )
    )
    local_grade = result.local_adjustments[0].sdr_grade
    assert _curve_is_identity(local_grade.luma_curve)
    assert _curve_is_identity(local_grade.red_curve)
    assert _curve_is_identity(local_grade.green_curve)
    assert _curve_is_identity(local_grade.blue_curve)
    assert abs(local_grade.exposure) > 0.01 or abs(local_grade.highlights) > 0.01
    assert result.local_adjustments[0].mask == locals_[0].mask

    target = build_sdr_match_target(settled_hdr)
    candidate = apply_adjustments(
        source,
        result.adjustments,
        PreviewKind.SDR,
        include_grain=False,
        local_adjustments=result.local_adjustments,
    )
    target_luma = np.einsum("...c,c->...", target, SDR_LUMA, optimize=True)
    candidate_luma = np.einsum("...c,c->...", candidate, SDR_LUMA, optimize=True)
    source_luma = np.einsum("...c,c->...", settled_hdr, HDR_LUMA, optimize=True)
    uncompressed = source_luma / 0.18 * (100.0 / 203.0)
    body = uncompressed <= MATCH_SHOULDER_START
    body_p95 = float(np.percentile(np.abs(target_luma[body] - candidate_luma[body]), 95))
    assert body_p95 <= (0.03 if result.status == "matched" else 0.05)

    specular = uncompressed > MATCH_SHOULDER_START
    assert np.any(specular)
    assert float(np.max(candidate_luma)) <= 1.0
    assert float(np.percentile(uncompressed[specular] - candidate_luma[specular], 95)) > 0.1
    ordinary_highlights = (uncompressed >= 0.65) & (uncompressed <= MATCH_SHOULDER_START)
    assert float(np.mean(candidate_luma[ordinary_highlights] >= 0.999)) < 0.01

    raised = result.adjustments.model_copy(deep=True)
    raised.sdr.exposure += 0.5
    raised_candidate = apply_adjustments(
        source,
        raised,
        PreviewKind.SDR,
        include_grain=False,
        local_adjustments=result.local_adjustments,
    )
    raised_luma = np.einsum("...c,c->...", raised_candidate, SDR_LUMA, optimize=True)
    editable_body = (candidate_luma >= 0.10) & (candidate_luma <= 0.80)
    assert float(np.median(raised_luma[editable_body] - candidate_luma[editable_body])) > 0.05
    # Sampled inside the editable body. The match now lands a brighter, more
    # faithful upper-mid, so a whole-frame P75 sits in the deliberately
    # compressed shoulder, where a squashed response is the intended behaviour
    # rather than a loss of Exposure headroom.
    assert float(np.percentile(raised_luma[editable_body], 75)) > float(np.percentile(candidate_luma[editable_body], 75)) + 0.02
    assert float(np.mean(raised_luma >= 0.999)) <= float(np.mean(candidate_luma >= 0.999)) + 0.01
    robust_body = (candidate_luma >= 0.05) & (candidate_luma <= 0.75)
    body_delta = raised_luma[robust_body] - candidate_luma[robust_body]
    assert float(np.percentile(body_delta, 5)) > 0.02
    assert float(np.median(raised_luma[robust_body] / candidate_luma[robust_body])) > 1.20
    assert float(np.mean(body_delta > 0.005)) > 0.95

    reset = result.adjustments.model_copy(deep=True)
    reset.sdr = SDRAdjustments()
    reset_candidate = apply_adjustments(
        source, reset, PreviewKind.SDR, include_grain=False, local_adjustments=[]
    )
    assert float(np.mean(np.abs(reset_candidate - candidate))) > 0.005


def test_invalid_hdr_analysis_is_rejected_before_a_recipe_is_returned() -> None:
    source = np.full((12, 16, 3), 0.18, dtype=np.float32)
    settled = source.copy()
    settled[3, 4, 1] = np.nan
    with pytest.raises(SDRMatchMaterializationError, match="invalid values"):
        materialize_sdr_match(
            source,
            AdjustmentState(),
            [],
            reference_white_nits=203,
            source_pixel_scale=1.0,
            settled_hdr=settled,
        )


def test_specular_only_local_tone_is_neutralized_without_authoring_curves() -> None:
    source = tifffile.imread(FIXTURE).astype(np.float32)
    adjustments = AdjustmentState()
    local = LocalAdjustment(mask=MaskExpression(leaf=MaskLeaf(
        type="luminance_range",
        fade_in_start_ev=1.0,
        full_start_ev=2.0,
        full_end_ev=6.0,
        fade_out_end_ev=8.0,
    )))
    local.hdr_grade.exposure = 1.2
    local.hdr_grade.highlights = 1.5
    local.hdr_grade.midtones = 0.4
    local.hdr_grade.contrast = 0.7
    settled_hdr = apply_adjustments(
        source,
        adjustments,
        PreviewKind.HDR,
        include_grain=False,
        local_adjustments=[local],
    )

    translated = _materialize_local_grades(source, settled_hdr, adjustments, [local])[0].sdr_grade

    for name in ("exposure", "highlights", "midtones", "shadows", "blacks", "contrast"):
        assert abs(getattr(translated, name)) < 0.01
    assert _curve_is_identity(translated.luma_curve)
    assert _curve_is_identity(translated.red_curve)
    assert _curve_is_identity(translated.green_curve)
    assert _curve_is_identity(translated.blue_curve)


def _monochrome_grade() -> AdjustmentState:
    """A black-and-white conversion on top of an ordinary HDR grade."""
    adjustments = AdjustmentState()
    hdr = adjustments.hdr
    hdr.saturation = -1.0
    hdr.exposure = 0.35
    hdr.contrast = 0.20
    hdr.highlight_section_enabled = True
    hdr.highlight_compression_start_nits = 300.0
    hdr.highlight_compression_target_nits = 800.0
    hdr.detail.clarity_amount = 20.0
    hdr.film_look.print_strength = 25.0
    hdr.vignette.amount = -25.0
    return adjustments


def _mean_chroma(image: np.ndarray) -> float:
    values = np.asarray(image, dtype=np.float32)
    return float(np.mean(np.max(values, axis=-1) - np.min(values, axis=-1)))


def test_black_and_white_grade_materializes_into_a_black_and_white_recipe() -> None:
    """A desaturated HDR grade must survive Match rather than be rejected.

    The neutral tonal fit only sees a synthetic grey ramp, so it is blind to
    error that depends on the image's colour. Pulling Saturation to -1 is the
    case where the HDR and SDR desaturation paths diverge most, and the whole
    match used to be rejected -- which left the SDR lane untouched and still in
    full colour beside a black-and-white HDR.
    """
    source = tifffile.imread(FIXTURE).astype(np.float32)
    adjustments = _monochrome_grade()
    result = materialize_sdr_match(
        source,
        adjustments,
        [],
        reference_white_nits=203,
        source_pixel_scale=1.0,
    )

    assert result.status in {"matched", "needs_review"}
    assert result.adjustments.sdr.saturation == -1.0
    candidate = apply_adjustments(
        source, result.adjustments, PreviewKind.SDR, include_grain=False, local_adjustments=[]
    )
    assert _mean_chroma(candidate) < 0.002


def test_color_grading_wheels_are_translated_into_sdr_primaries() -> None:
    """The same wheel numbers are not the same colour in both lanes.

    Each lane builds its tint direction in its own primaries and neutralises it
    with its own luma weights, so copying hue and saturation across leaves the
    SDR grade pointing at a visibly different colour -- up to sixteen degrees
    away on the green/magenta axis.
    """
    from hdr_finisher.adjustments import _apply_color_grading
    from hdr_finisher.color import acescg_to_linear_srgb, linear_srgb_to_acescg
    from hdr_finisher.models import ColorGradingAdjustments
    from hdr_finisher.sdr_match import _translate_color_grading_wheels

    def hue_of(tint: np.ndarray) -> float:
        red, green, blue = (float(channel) for channel in tint)
        x = red - 0.5 * (green + blue)
        y = (np.sqrt(3.0) / 2.0) * (green - blue)
        return float(np.degrees(np.arctan2(y, x))) % 360.0

    sdr_grey = np.full((8, 8, 3), 0.18, dtype=np.float32)
    hdr_grey = linear_srgb_to_acescg(sdr_grey.copy())

    for wheel_name in ("shadows", "midtones", "highlights"):
        for hue in (0.0, 90.0, 120.0, 210.0, 300.0):
            authored = ColorGradingAdjustments()
            authored.blending = 100.0
            getattr(authored, wheel_name).hue = hue
            getattr(authored, wheel_name).saturation = 60.0

            reference = acescg_to_linear_srgb(
                _apply_color_grading(hdr_grey.copy(), authored, PreviewKind.HDR)
            )
            reference_hue = hue_of(reference.mean(axis=(0, 1)) - sdr_grey.mean(axis=(0, 1)))

            translated = authored.model_copy(deep=True)
            _translate_color_grading_wheels(translated, authored)
            graded = _apply_color_grading(sdr_grey.copy(), translated, PreviewKind.SDR)
            graded_hue = hue_of(graded.mean(axis=(0, 1)) - sdr_grey.mean(axis=(0, 1)))

            error = abs((graded_hue - reference_hue + 180.0) % 360.0 - 180.0)
            assert error <= 1.0, f"{wheel_name} at {hue} deg drifted {error:.1f} deg"
