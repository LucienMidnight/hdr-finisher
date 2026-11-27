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
    MATCH_REVIEW_P95_LUMA_LIMIT,
    SDRMatchMaterializationError,
    _materialize_local_grades,
    _quality_metrics,
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
    # Retired artistic controls have no physical equivalent; physical controls
    # have independent coverage in test_film_controls.py.
    # The removed 6% Bloom has no equivalent physical filter grade.
    # Lens recipe copying and safe rejection have separate coverage.
    hdr.film_look.halation_amount = 5
    hdr.detail.clarity_amount = 4
    hdr.vignette.amount = -4

    local = LocalAdjustment(name="Calibrated highlight mask")
    local.hdr_grade.exposure = 0.2
    local.hdr_grade.highlights = 0.4
    local.hdr_grade.saturation = 0.08
    local.hdr_grade.luma_curve = [[0, 0], [.4, .42], [1, 1]]
    return adjustments, [local]


def _curve_is_identity(points: list[list[float]]) -> bool:
    return all(abs(x - y) < 1e-7 for x, y in points)


def test_local_translation_keeps_its_independent_enabled_flag():
    from hdr_finisher.sdr_match import _translate_local_grade
    from hdr_finisher.models import LocalGrade
    grade = LocalGrade(enabled=False, exposure=.7, whites=35, midtones=-25)
    translated = _translate_local_grade(grade, 1.)
    assert translated.enabled is False
    assert grade.enabled is False


def test_local_translation_uses_the_parent_hdr_target_and_reference(monkeypatch):
    import hdr_finisher.sdr_match as matching
    from hdr_finisher.models import LocalGrade
    render = matching._apply_local_grade
    calls = []

    def measured(pixels, grade, kind, **options):
        if kind == PreviewKind.HDR:
            calls.append(options)
        return render(pixels, grade, kind, **options)

    monkeypatch.setattr(matching, "_apply_local_grade", measured)
    matching._translate_local_grade(LocalGrade(whites=-100), 1., reference_white_nits=100, target_peak_nits=400)
    assert calls == [dict(reference_white_nits=100, target_peak_nits=400)]


def test_local_tone_fit_calls_the_shared_renderer(monkeypatch):
    import hdr_finisher.sdr_match as matching
    from hdr_finisher.models import LocalGrade
    values = np.geomspace(.001, 1., 64).astype(np.float32)
    grade = LocalGrade()
    calls = []
    render = matching._apply_local_grade
    def measure(*args, **kwargs):
        calls.append(args[2])
        return render(*args, **kwargs)
    monkeypatch.setattr(matching, "_apply_local_grade", measure)
    matching._fit_local_tonal_controls(grade, values, values * 1.1)
    assert calls and set(calls) == {PreviewKind.SDR}
    pixels = np.repeat(values[None, :, None], 3, axis=-1)
    fitted = render(pixels, grade, PreviewKind.SDR)[0, :, 0]
    assert np.mean(np.abs(fitted - values * 1.1)) < np.mean(values * .1)


def test_input_reuse_preserves_the_complete_generated_recipe() -> None:
    source = tifffile.imread(FIXTURE).astype(np.float32)
    adjustments, locals_ = _calibrated_grade()
    options = dict(reference_white_nits=203, source_pixel_scale=1.0)
    baseline = materialize_sdr_match.__wrapped__(source, adjustments, locals_, **options)
    reused = materialize_sdr_match(source, adjustments, locals_, **options)
    assert reused.adjustments.model_dump() == baseline.adjustments.model_dump()
    assert [local.model_dump() for local in reused.local_adjustments] == [local.model_dump() for local in baseline.local_adjustments]
    assert reused.quality == baseline.quality
    assert reused.status == baseline.status


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
    assert result.adjustments.sdr.use_authored_base is False
    assert result.adjustments.sdr.highlight_section_enabled is True
    sdr = result.adjustments.sdr
    assert sdr.highlight_compression_mode in {"soft_ceiling", "peak_fit"}
    assert sdr.highlight_compression_color_handling == (
        "preserve_color" if sdr.highlight_compression_mode == "soft_ceiling"
        else adjustments.hdr.highlight_compression_color_handling
    )
    assert all(getattr(sdr, name) == 0 for name in ("blacks", "shadows", "midtones", "highlights", "whites"))
    nodes = sdr.tone_equalizer_nodes
    assert len(nodes) == 5 and nodes[0].input_ev == -6 and nodes[-1].input_ev == 6
    assert np.all(np.diff([node.input_ev for node in nodes]) >= .75 - 1e-6)
    assert np.all(np.diff([node.input_ev + node.adjustment_ev for node in nodes]) > 0)
    keys = ("luma_curve", "red_curve", "green_curve", "blue_curve")
    assert sdr.curves_section_enabled == adjustments.hdr.curves_section_enabled
    assert all(getattr(sdr, key) == getattr(adjustments.hdr, key) for key in keys)
    # Match may never invent RGB curves to compensate channel clipping.
    # Judge the finished result against the existing quality limits above.
    finished = apply_adjustments(source, result.adjustments, PreviewKind.SDR,
                                 include_grain=False, local_adjustments=result.local_adjustments)
    assert np.isfinite(finished).all() and finished.min() >= 0 and finished.max() <= 1
    local_grade = result.local_adjustments[0].sdr_grade
    assert all(getattr(local_grade, key) == getattr(locals_[0].hdr_grade, key) for key in keys)
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
    if raised.sdr.linked_to_hdr:
        raised.sdr.output_exposure += 0.5
    else:
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

    sdr_grey = np.full((8, 8, 3), 0.18 * 100.0 / 203.0, dtype=np.float32)
    hdr_grey = linear_srgb_to_acescg(np.full_like(sdr_grey, 0.18 * 0.18))
    hdr_neutral = acescg_to_linear_srgb(hdr_grey)

    for wheel_name in ("shadows", "midtones", "highlights"):
        for hue in (0.0, 90.0, 120.0, 210.0, 300.0):
            authored = ColorGradingAdjustments()
            authored.blending = 100.0
            getattr(authored, wheel_name).hue = hue
            getattr(authored, wheel_name).saturation = 60.0

            reference = acescg_to_linear_srgb(
                _apply_color_grading(hdr_grey.copy(), authored, PreviewKind.HDR)
            )
            reference_hue = hue_of(reference.mean(axis=(0, 1)) - hdr_neutral.mean(axis=(0, 1)))

            translated = authored.model_copy(deep=True)
            _translate_color_grading_wheels(translated, authored)
            graded = _apply_color_grading(sdr_grey.copy(), translated, PreviewKind.SDR)
            graded_hue = hue_of(graded.mean(axis=(0, 1)) - sdr_grey.mean(axis=(0, 1)))

            error = abs((graded_hue - reference_hue + 180.0) % 360.0 - 180.0)
            assert error <= 1.0, f"{wheel_name} at {hue} deg drifted {error:.1f} deg"


@pytest.mark.parametrize("family", ["glimmerglass", "black_pro_mist", "pro_mist", "cinebloom"])
def test_match_copies_physical_lens_recipe_without_threshold_translation(family) -> None:
    from hdr_finisher.sdr_match import _semantic_sdr_translation
    adjustments = AdjustmentState()
    look = adjustments.hdr.film_look
    look.lens_filter, look.lens_strength, look.lens_size = family, 0.375, 2.5
    translated = _semantic_sdr_translation(adjustments, np.full((8, 8, 3), 20.0, np.float32))
    assert translated.film_look.lens_filter == family
    assert translated.film_look.lens_strength == 0.375
    assert translated.film_look.lens_size == 2.5


def test_match_coloured_lens_target_meets_existing_quality_gate() -> None:
    source = tifffile.imread(FIXTURE).astype(np.float32)
    adjustments, locals_ = _calibrated_grade()
    adjustments.hdr.film_look.lens_filter = "black_pro_mist"
    adjustments.hdr.film_look.lens_strength = 0.5
    # The clipping fix makes this formerly rejected recipe fit without a waiver.
    result = materialize_sdr_match(source, adjustments, locals_, reference_white_nits=203, source_pixel_scale=1.0)
    assert result.status == ("matched" if result.adjustments.sdr.linked_to_hdr else "needs_review")
    assert result.quality.p95_luma_error <= MATCH_REVIEW_P95_LUMA_LIMIT
    assert result.quality.p95_oklab_error <= 0.05
    finished = apply_adjustments(source, result.adjustments, PreviewKind.SDR,
                                 include_grain=False, local_adjustments=result.local_adjustments)
    assert np.isfinite(finished).all() and finished.min() >= 0 and finished.max() <= 1
