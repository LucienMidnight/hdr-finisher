"""Tone sliders: Blacks, Shadows, Midtones, Highlights (Steve, 2026-10-27).

Exposure is an equal change in stops; these are curves on part of the range,
measured in stops from middle grey (0.18), and they leave other tones alone.
Each is a strength from -100 to +100: Blacks 100 is two stops on the darkest
tones; a zone's 100 is the most its centre can move without tones swapping.
"""
import itertools

import numpy as np
import pytest

from hdr_finisher.adjustments import (
    _apply_tone_zones,
    _blacks_factor,
    apply_adjustments,
    blacks_stops,
    tone_zone_amounts,
)
from hdr_finisher.models import AdjustmentState, HDRAdjustments, PreviewKind, SDRAdjustments

TONE_FIELDS = {"blacks", "shadows", "midtones", "highlights", "shadows_center", "shadows_width",
               "midtones_center", "midtones_width", "highlights_center", "highlights_width"}


def grey(stop):
    """A neutral pixel ``stop`` stops from middle grey."""
    return np.full((1, 1, 3), 0.18 * 2.0 ** stop, dtype=np.float32)


def stops_of(pixel):
    return float(np.log2(pixel.mean() / 0.18))


def full_stops(branch, zone):
    """What strength 100 moves this zone's centre by, in stops."""
    return 0.6 * getattr(branch, f"{zone}_width") / 2


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_default_tone_sliders_change_nothing(kind):
    ramp = np.repeat(np.geomspace(1e-6, 50.0, 400, dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    branch = HDRAdjustments() if kind == PreviewKind.HDR else SDRAdjustments()
    assert _apply_tone_zones(ramp, branch, kind) is ramp
    np.testing.assert_array_equal(_blacks_factor(ramp[..., 0], 0.0), np.ones(ramp.shape[:2], np.float32))


def test_blacks_moves_only_the_darkest_tones():
    assert blacks_stops(100) == 2.0 and blacks_stops(-50) == -1.0
    assert _blacks_factor(np.float32(0.18 * 2 ** -9), blacks_stops(50)) == pytest.approx(2.0, rel=1e-6)
    assert _blacks_factor(np.float32(0.18 * 2 ** -2.5), blacks_stops(75)) == pytest.approx(1.0, abs=1e-7)
    assert _blacks_factor(np.float32(0.18), blacks_stops(-100)) == pytest.approx(1.0, abs=1e-7)


@pytest.mark.parametrize("zone", ["shadows", "midtones", "highlights"])
@pytest.mark.parametrize("strength", [50.0, 100.0, -100.0])
def test_each_zone_moves_its_centre_by_its_strength_and_leaves_outside_tones_alone(zone, strength):
    branch = HDRAdjustments(**{zone: strength})
    center = getattr(branch, f"{zone}_center")
    half = getattr(branch, f"{zone}_width") / 2
    expected = center + strength / 100 * full_stops(branch, zone)
    assert stops_of(_apply_tone_zones(grey(center), branch, PreviewKind.HDR)) == pytest.approx(expected, abs=1e-4)
    for outside in (center - half - 0.25, center + half + 0.25):
        np.testing.assert_array_equal(_apply_tone_zones(grey(outside), branch, PreviewKind.HDR), grey(outside))


def test_shadows_keeps_black_and_highlights_keeps_the_peak():
    branch = HDRAdjustments(shadows=100, highlights=-100)
    for stop in (-9.0, 6.0):  # near-black and an HDR specular
        np.testing.assert_array_equal(_apply_tone_zones(grey(stop), branch, PreviewKind.HDR), grey(stop))


def test_center_and_width_move_and_resize_the_zone():
    moved = HDRAdjustments(shadows=100, shadows_center=-5.0, shadows_width=2.0)
    assert stops_of(_apply_tone_zones(grey(-5.0), moved, PreviewKind.HDR)) == pytest.approx(-5.0 + 0.6, abs=1e-4)
    # -2.5 (the default centre) is now outside the narrower, lower zone.
    np.testing.assert_array_equal(_apply_tone_zones(grey(-2.5), moved, PreviewKind.HDR), grey(-2.5))


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_tones_never_swap_order_at_extreme_settings(kind):
    ramp = np.repeat((0.18 * np.exp2(np.linspace(-14, 10, 4097))).astype(np.float32).reshape(1, -1, 1), 3, axis=2)
    for strengths in itertools.product((-100.0, 100.0), repeat=3):
        for width in (0.5, 1.0, 3.0):
            branch = HDRAdjustments(
                shadows=strengths[0], midtones=strengths[1], highlights=strengths[2],
                shadows_center=-1.0, midtones_center=-0.5, highlights_center=0.0,
                shadows_width=width, midtones_width=width, highlights_width=width,
                blacks=strengths[0],
            )
            out = _apply_tone_zones(ramp, branch, kind)
            assert np.all(np.diff(out[0, :, 0]) > 0), (strengths, width)
            sdr = SDRAdjustments(**branch.model_dump(include=TONE_FIELDS))
            whole = apply_adjustments(ramp, AdjustmentState(hdr=branch, sdr=sdr), kind)
            assert np.all(np.diff(whole[0, :, 0]) >= -1e-6), (strengths, width)


def test_a_single_zone_at_full_strength_is_never_reduced():
    for zone in ("shadows", "midtones", "highlights"):
        for strength in (100.0, -100.0):
            branch = HDRAdjustments(**{zone: strength})
            amounts = dict(zip(("shadows", "midtones", "highlights"), tone_zone_amounts(branch)))
            assert amounts[zone] == pytest.approx(strength / 100 * full_stops(branch, zone), rel=1e-12)


def test_overlapping_opposed_zones_shrink_together():
    branch = HDRAdjustments(shadows=100, midtones=-100)
    shadows, midtones, _ = tone_zone_amounts(branch)
    assert 0 < shadows < full_stops(branch, "shadows")
    assert shadows / full_stops(branch, "shadows") == pytest.approx(-midtones / full_stops(branch, "midtones"))


# Mirrored in tests/tone-zones.test.js against gpu-params.js toneZoneAmounts.
SHARED_CASES = [
    dict(shadows=100.0),
    dict(shadows=60.0, midtones=-40.0, highlights=50.0),
    dict(shadows=100.0, midtones=-100.0),
    dict(shadows=100.0, midtones=-100.0, highlights=100.0, shadows_center=-1.0, midtones_center=-0.5,
         highlights_center=0.0, shadows_width=1.0, midtones_width=1.0, highlights_width=1.0),
]


def test_shared_cases_match_the_values_pinned_for_the_gpu():
    import json, pathlib
    source = (pathlib.Path(__file__).with_name("tone-zones.test.js")).read_text(encoding="utf-8")
    expected = json.loads(source.split("const EXPECTED = ")[1].split(";")[0])
    cases = json.loads(source.split("const CASES = ")[1].split(";")[0])
    assert cases == SHARED_CASES
    for case, values in zip(SHARED_CASES, expected):
        np.testing.assert_allclose(tone_zone_amounts(HDRAdjustments(**case)), values, rtol=1e-12)
