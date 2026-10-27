"""Tone sliders: Blacks, Shadows, Midtones, Highlights (Steve, 2026-10-27).

Exposure is an equal change in stops; these are curves on part of the range,
measured in stops from middle grey (0.18), and they leave other tones alone.
"""
import itertools

import numpy as np
import pytest

from hdr_finisher.adjustments import (
    _apply_tone_zones,
    _blacks_factor,
    apply_adjustments,
    tone_zone_amounts,
)
from hdr_finisher.models import AdjustmentState, HDRAdjustments, PreviewKind, SDRAdjustments


def grey(stop):
    """A neutral pixel ``stop`` stops from middle grey."""
    return np.full((1, 1, 3), 0.18 * 2.0 ** stop, dtype=np.float32)


def stops_of(pixel):
    return float(np.log2(pixel.mean() / 0.18))


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_default_tone_sliders_change_nothing(kind):
    ramp = np.repeat(np.geomspace(1e-6, 50.0, 400, dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    branch = HDRAdjustments() if kind == PreviewKind.HDR else SDRAdjustments()
    assert _apply_tone_zones(ramp, branch, kind) is ramp
    np.testing.assert_array_equal(_blacks_factor(ramp[..., 0], 0.0), np.ones(ramp.shape[:2], np.float32))


def test_blacks_moves_only_the_darkest_tones():
    assert _blacks_factor(np.float32(0.18 * 2 ** -9), 1.0) == pytest.approx(2.0, rel=1e-6)
    assert _blacks_factor(np.float32(0.18 * 2 ** -2.5), 1.5) == pytest.approx(1.0, abs=1e-7)
    assert _blacks_factor(np.float32(0.18), -2.0) == pytest.approx(1.0, abs=1e-7)


@pytest.mark.parametrize("zone", ["shadows", "midtones", "highlights"])
def test_each_zone_moves_its_centre_by_the_amount_and_leaves_outside_tones_alone(zone):
    branch = HDRAdjustments(**{zone: 0.5})
    center = getattr(branch, f"{zone}_center")
    half = getattr(branch, f"{zone}_width") / 2
    at_center = _apply_tone_zones(grey(center), branch, PreviewKind.HDR)
    assert stops_of(at_center) == pytest.approx(center + 0.5, abs=1e-4)
    for outside in (center - half - 0.25, center + half + 0.25):
        np.testing.assert_array_equal(_apply_tone_zones(grey(outside), branch, PreviewKind.HDR), grey(outside))


def test_shadows_keeps_black_and_highlights_keeps_the_peak():
    branch = HDRAdjustments(shadows=2.0, highlights=-2.0)
    for stop in (-9.0, 6.0):  # near-black and an HDR specular
        np.testing.assert_array_equal(_apply_tone_zones(grey(stop), branch, PreviewKind.HDR), grey(stop))


def test_center_and_width_move_and_resize_the_zone():
    moved = HDRAdjustments(shadows=0.5, shadows_center=-5.0, shadows_width=2.0)
    assert stops_of(_apply_tone_zones(grey(-5.0), moved, PreviewKind.HDR)) == pytest.approx(-4.5, abs=1e-4)
    # -2.5 (the default centre) is now outside the narrower, lower zone.
    np.testing.assert_array_equal(_apply_tone_zones(grey(-2.5), moved, PreviewKind.HDR), grey(-2.5))


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_tones_never_swap_order_at_extreme_settings(kind):
    ramp = np.repeat((0.18 * np.exp2(np.linspace(-14, 10, 4097))).astype(np.float32).reshape(1, -1, 1), 3, axis=2)
    for amounts in itertools.product((-2.0, 2.0), repeat=3):
        for width in (0.5, 1.0, 3.0):
            branch = HDRAdjustments(
                shadows=amounts[0], midtones=amounts[1], highlights=amounts[2],
                shadows_center=-1.0, midtones_center=-0.5, highlights_center=0.0,
                shadows_width=width, midtones_width=width, highlights_width=width,
                blacks=amounts[0],
            )
            out = _apply_tone_zones(ramp, branch, kind)
            assert np.all(np.diff(out[0, :, 0]) > 0), (amounts, width)
            whole = apply_adjustments(ramp, AdjustmentState(hdr=branch, sdr=SDRAdjustments(**branch.model_dump(include={
                "blacks", "shadows", "midtones", "highlights", "shadows_center", "shadows_width",
                "midtones_center", "midtones_width", "highlights_center", "highlights_width"}))), kind)
            assert np.all(np.diff(whole[0, :, 0]) >= -1e-6), (amounts, width)


def test_amounts_are_only_reduced_when_tones_would_fold():
    gentle = HDRAdjustments(shadows=1.0, highlights=-0.5)
    assert tone_zone_amounts(gentle) == (1.0, 0.0, -0.5)
    folding = HDRAdjustments(shadows=2.0, shadows_width=0.5)
    scaled = tone_zone_amounts(folding)
    assert 0 < scaled[0] < 2.0 and scaled[1:] == (0.0, 0.0)


# Mirrored in tests/tone-zones.test.js against gpu-params.js toneZoneAmounts.
SHARED_CASES = [{'shadows': 1.0}, {'shadows': 1.0, 'midtones': -0.5, 'highlights': 0.5}, {'shadows': 2.0, 'shadows_width': 0.5}, {'shadows': 2.0, 'midtones': -2.0, 'highlights': 2.0, 'shadows_center': -1.0, 'midtones_center': -0.5, 'highlights_center': 0.0, 'shadows_width': 1.0, 'midtones_width': 1.0, 'highlights_width': 1.0}]
SHARED_EXPECTED = [(1.0, 0.0, 0.0), (0.9344429843772813, -0.4672214921886407, 0.4672214921886407), (0.15, 0.0, 0.0), (0.15, -0.15, 0.15)]


def test_shared_cases_match_the_values_pinned_for_the_gpu():
    for case, values in zip(SHARED_CASES, SHARED_EXPECTED):
        np.testing.assert_allclose(tone_zone_amounts(HDRAdjustments(**case)), values, rtol=1e-9)
