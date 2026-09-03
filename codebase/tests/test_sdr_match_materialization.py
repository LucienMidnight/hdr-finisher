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
    assert float(np.percentile(raised_luma, 75)) > float(np.percentile(candidate_luma, 75)) + 0.02
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
