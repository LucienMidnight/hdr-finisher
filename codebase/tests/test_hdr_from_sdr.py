import numpy as np
import pytest

from hdr_finisher.adjustments import _srgb_decode, apply_adjustments
from hdr_finisher.color import acescg_to_linear_srgb, linear_srgb_to_acescg
from hdr_finisher.hdr_from_sdr import (
    body_metrics, delivery_ceiling_metrics, fit_hdr_from_sdr,
    hdr_comparison_pixels, seed_hdr_from_sdr,
)
from hdr_finisher.models import AdjustmentState, LocalAdjustment, PreviewKind
from hdr_finisher.sdr_match import _HDR_GRADING_LUMA, _SDR_GRADING_LUMA, _grading_tint_vectors


def source_ramp():
    return np.tile(np.linspace(.004, .16, 64, dtype=np.float32)[None, :, None], (8, 1, 3))


@pytest.mark.parametrize("reference", [100, 203])
def test_neutral_physical_brightness_fit_and_no_mutation(reference):
    adjustments = AdjustmentState()
    adjustments.sdr.highlight_section_enabled = False
    original = adjustments.model_dump_json()
    proposal = fit_hdr_from_sdr(source_ramp(), adjustments, [], reference_white_nits=reference)
    assert proposal.body_accepted
    assert proposal.metrics["overall"]["p95_luma_error"] < 1e-5
    assert proposal.adjustments.sdr == adjustments.sdr
    assert adjustments.model_dump_json() == original


@pytest.mark.parametrize("reference", [100, 203])
def test_seed_pivot_decodes_sdr_signal_before_physical_conversion(reference):
    candidate, _ = seed_hdr_from_sdr(AdjustmentState(), [], reference_white_nits=reference)
    expected_nits = float(_srgb_decode(np.asarray(.5, dtype=np.float32))) * 203
    assert candidate.hdr.contrast_pivot * reference / .18 == pytest.approx(expected_nits)


@pytest.mark.parametrize("mode", ["peak_fit", "fixed_cap", "soft_ceiling", "clip"])
def test_preserve_enabled_cap_and_measure_finished_bt2020_channels(mode):
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_mode = mode
    adjustments.hdr.highlight_compression_target_nits = 600
    adjustments.hdr.highlight_compression_start_nits = 250
    candidate, _ = seed_hdr_from_sdr(adjustments, [])
    for name in type(adjustments.hdr).model_fields:
        if name.startswith("highlight_compression"):
            assert getattr(candidate.hdr, name) == getattr(adjustments.hdr, name)
    source = source_ramp() * 1000
    source[:, :20] *= [2, .5, .1]
    pixels = apply_adjustments(source, candidate, PreviewKind.HDR)
    metrics = delivery_ceiling_metrics(pixels, candidate, 203)
    assert metrics["finite"]
    assert metrics["target_nits"] == 600
    assert metrics["passed"] == (metrics["peak_nits"] <= 600)


def test_finished_ceiling_never_borrows_an_encoder_allowance():
    adjustments = AdjustmentState()
    pixels = np.full((8, 8, 3), 1001 * .18 / 203, dtype=np.float32)
    assert not delivery_ceiling_metrics(pixels, adjustments, 203)["passed"]


def test_bypassed_cap_preserves_target_and_uses_fixed_cap():
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_compression_target_nits = 750
    candidate, _ = seed_hdr_from_sdr(adjustments, [])
    assert candidate.hdr.highlight_section_enabled
    assert candidate.hdr.highlight_compression_mode == "fixed_cap"
    assert candidate.hdr.highlight_compression_target_nits == 750
    assert candidate.hdr.highlight_compression_start_nits == 600


def test_seed_retains_creative_settings_film_once_and_local_masks():
    adjustments = AdjustmentState()
    adjustments.sdr.shadows = 18
    adjustments.sdr.whites = -15
    adjustments.sdr.red_curve = [[0, 0], [.5, .55], [1, 1]]
    adjustments.sdr.film_look.film_stock = "kodak_portra_400"
    adjustments.sdr.film_look.look_strength = 50
    adjustments.sdr.film_look.print_exposure = .2
    adjustments.sdr.color_grading.highlights.hue = 240
    adjustments.sdr.color_grading.highlights.saturation = 6
    local = LocalAdjustment(name="Keep mask")
    local.sdr_grade.enabled = False
    local.sdr_grade.exposure = .3
    local.sdr_grade.hsl_section_enabled = False
    before = local.model_dump_json()
    candidate, translated = seed_hdr_from_sdr(adjustments, [local])
    assert candidate.hdr.shadows == 18 and candidate.hdr.whites == -15
    assert candidate.hdr.red_curve == adjustments.sdr.red_curve
    assert candidate.hdr.hsl == adjustments.sdr.hsl
    assert candidate.hdr.film_look == adjustments.sdr.film_look
    assert translated[0].sdr_grade == local.sdr_grade
    assert translated[0].mask == local.mask
    assert translated[0].hdr_grade.enabled is False
    assert translated[0].hdr_grade.exposure == .3
    assert translated[0].id == local.id
    assert local.model_dump_json() == before
    wheel = candidate.hdr.color_grading.highlights
    expected = linear_srgb_to_acescg((_grading_tint_vectors([240], _SDR_GRADING_LUMA) * 6).reshape(1, 1, 3))
    actual = (_grading_tint_vectors([wheel.hue], _HDR_GRADING_LUMA) * wheel.saturation).reshape(1, 1, 3)
    assert np.linalg.norm(actual - expected) / np.linalg.norm(expected) < .015


def test_family_gate_catches_error_hidden_by_aggregate_percentile():
    target = np.full((1, 1000, 3), .2, dtype=np.float32)
    target[:, :20] = [.04, .1, .4]
    candidate = target.copy()
    candidate[:, :20] *= .5
    metrics, accepted = body_metrics(target, candidate, np.ones((1, 1000), dtype=bool))
    assert metrics["overall"]["status"] == "pass"
    assert metrics["families"]["blue"]["status"] == "fail"
    assert metrics["families"]["red"]["status"] == "insufficient_coverage"
    assert not accepted


def test_authored_target_is_captured_and_an_unfit_target_changes_nothing():
    source = source_ramp()
    adjustments = AdjustmentState()
    reference = np.broadcast_to(np.array([.25, .35, .55], dtype=np.float32), source.shape).copy()
    before = [source.copy(), reference.copy(), adjustments.model_dump_json()]
    proposal = fit_hdr_from_sdr(source, adjustments, [], sdr_reference=reference)
    assert not proposal.body_accepted
    assert "HDR is unchanged" in proposal.message
    assert np.array_equal(source, before[0])
    assert np.array_equal(reference, before[1])
    assert adjustments.model_dump_json() == before[2]


def test_empty_body_refuses_without_edits():
    adjustments = AdjustmentState()
    original = adjustments.model_dump_json()
    with pytest.raises(ValueError, match="Too little"):
        fit_hdr_from_sdr(np.zeros((8, 8, 3), dtype=np.float32), adjustments, [])
    assert adjustments.model_dump_json() == original


@pytest.mark.parametrize("source", [np.zeros((257, 256, 3)), np.full((8, 8, 3), np.nan)])
def test_research_proxy_budget_and_finite_source(source):
    with pytest.raises(ValueError):
        fit_hdr_from_sdr(source, AdjustmentState(), [])


def test_comparison_space_uses_project_reference_without_gamut_clipping():
    source = np.array([[[.18, .18, .18], [.9, .9, .9]]], dtype=np.float32)
    common_203 = hdr_comparison_pixels(source, 203)
    common_100 = hdr_comparison_pixels(source, 100)
    assert common_203 == pytest.approx(acescg_to_linear_srgb(source) / .18)
    assert common_100 == pytest.approx(common_203 * (100 / 203))
    assert common_203[0, 1, 0] > 1
