"""The comparison tool's own arithmetic (Viewport-Bounded GPU Preview PRD, 4.6).

The tool judges the preview against the export, so its statistics have to be
right before anything it reports can be believed. These pin the pieces that are
easy to get subtly wrong: the transfer inverse, the luminance floor, the typical
bound versus the ceiling, and the placement measure for mask edges.
"""
from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "performance"))

import preview_export_compare as compare  # noqa: E402
from export_parity_check import display_encode, presentation_encode  # noqa: E402


def _frame(seed: int = 3, height: int = 60, width: int = 80) -> np.ndarray:
    generator = np.random.default_rng(seed)
    return generator.uniform(0.02, 4.0, size=(height, width, 3))


def test_transfer_inverse_round_trips_the_preview_encoding() -> None:
    linear = np.linspace(-0.5, 12.0, 4001)
    assert np.allclose(compare.srgb_decode(display_encode(linear)), linear, rtol=1e-9, atol=1e-12)


def test_export_side_matches_the_existing_presentation_transform() -> None:
    scene = _frame()
    for hdr_surface in (True, False):
        linear = compare.export_to_presentation_linear(
            scene, lane="hdr", hdr_surface=hdr_surface, reference_white_nits=203.0
        )
        encoded = presentation_encode(scene, hdr_surface=hdr_surface, reference_white_nits=203)
        assert np.allclose(display_encode(linear), encoded, rtol=1e-9, atol=1e-12)


def test_identical_frames_report_zero_and_pass() -> None:
    space = compare.presentation_space("hdr", True, 203.0)
    frame = _frame()
    statistics = compare.tone_statistics(frame, frame.copy(), space)
    assert statistics["luminance"]["max"] == 0.0
    assert statistics["oklab"]["max"] == 0.0
    assert all(statistics[key][name] for key in ("luminance", "oklab") for name in ("typicalOk", "ceilingOk"))


def test_uniform_three_percent_gain_fails_typical_and_passes_ceiling() -> None:
    space = compare.presentation_space("hdr", True, 203.0)
    frame = _frame()
    statistics = compare.tone_statistics(frame * 1.03, frame, space)
    assert abs(statistics["luminance"]["p99"] - 0.03) < 1e-6
    assert statistics["luminance"]["typicalOk"] is False
    assert statistics["luminance"]["ceilingOk"] is True


def test_one_outlier_fails_the_ceiling_without_moving_the_typical_bound() -> None:
    space = compare.presentation_space("sdr", False, 203.0)
    frame = np.full((50, 50, 3), 0.4)
    preview = frame.copy()
    preview[10, 20] *= 1.2
    statistics = compare.tone_statistics(preview, frame, space)
    assert statistics["luminance"]["typicalOk"] is True
    assert statistics["luminance"]["ceilingOk"] is False
    assert statistics["luminance"]["countAboveCeiling"] == 1
    assert statistics["luminance"]["worstPixel"]["x"] == 20
    assert statistics["luminance"]["worstPixel"]["y"] == 10


def test_luminance_floor_bounds_the_error_near_black() -> None:
    space = compare.presentation_space("sdr", False, 203.0)
    export = np.full((8, 8, 3), 1e-5)
    # Twice the export's value, but a difference of 0.001% of white: invisible,
    # and far inside 2% of the 1%-of-white floor.
    statistics = compare.tone_statistics(export * 2.0, export, space)
    assert statistics["belowFloorFraction"] == 1.0
    assert statistics["luminance"]["max"] < compare.LIMITS["luminanceTypical"]
    # A difference of 0.1% of white in the same shadow is ten times the floor's
    # 2% allowance and must be reported as a failure.
    statistics = compare.tone_statistics(export + 1e-3, export, space)
    assert statistics["luminance"]["ceilingOk"] is False


def _disc(shift: int = 0, size: int = 96, radius: int = 24) -> np.ndarray:
    y, x = np.mgrid[0:size, 0:size]
    return np.where((x - size // 2 - shift) ** 2 + (y - size // 2) ** 2 <= radius**2, 255, 0).astype(np.uint8)


def test_mask_edge_displacement_counts_whole_pixels() -> None:
    same = compare.mask_statistics(_disc(), _disc())
    assert same["maxLevels"] == 0 and same["edge"]["maxPixels"] == 0
    assert same["softOk"] and same["hardEdgeOk"] and same["regionOk"]

    one = compare.mask_statistics(_disc(1), _disc())
    assert one["edge"]["maxPixels"] == 1
    assert one["hardEdgeOk"] is True and one["softOk"] is False

    three = compare.mask_statistics(_disc(3), _disc())
    assert three["edge"]["maxPixels"] == 3
    assert three["hardEdgeOk"] is False and three["regionOk"] is False


def test_mask_that_vanishes_is_a_region_failure() -> None:
    gone = compare.mask_statistics(np.zeros((96, 96), dtype=np.uint8), _disc())
    assert gone["presentInPreview"] is False and gone["presentInExport"] is True
    assert gone["regionOk"] is False


def test_soft_mask_limits_approved_and_working() -> None:
    ramp = np.tile(np.linspace(0, 255, 96).round().astype(np.uint8), (96, 1))
    nudged = np.clip(ramp.astype(np.int16) + 2, 0, 255).astype(np.uint8)
    statistics = compare.mask_statistics(nudged, ramp)
    assert statistics["maxLevels"] == 2 and statistics["softOk"] is True
    assert statistics["overApprovedSoftLimit"] is False
    # Between the approved two levels and the working three: passes, and says so.
    on_trial = compare.mask_statistics(np.clip(ramp.astype(np.int16) + 3, 0, 255).astype(np.uint8), ramp)
    assert on_trial["softOk"] is True and on_trial["overApprovedSoftLimit"] is True
    too_far = np.clip(ramp.astype(np.int16) + 4, 0, 255).astype(np.uint8)
    assert compare.mask_statistics(too_far, ramp)["softOk"] is False


def test_a_gradual_mask_is_not_failed_for_where_its_halfway_line_sits() -> None:
    # A ramp one level per 8 pixels: two levels of difference move the 50%
    # contour sixteen pixels, and nobody could see it.
    ramp = np.tile(np.repeat(np.arange(96, 160), 8), (32, 1)).astype(np.float32)
    statistics = compare.mask_statistics(ramp + 2.0, ramp)
    assert statistics["edge"]["maxPixels"] is not None and statistics["edge"]["maxPixels"] > 2
    assert statistics["softOk"] is True and statistics["regionOk"] is True
    # A hard edge that moved three pixels is still a failure.
    assert compare.mask_statistics(_disc(3), _disc())["regionOk"] is False


def _grey(levels: float, height: int = 40, width: int = 50) -> np.ndarray:
    """A flat frame, as linear light, at a given level of the 8-bit display encoding."""
    return np.full((height, width, 3), float(compare.srgb_decode(np.array(levels / 255.0))))


def test_only_a_format_that_names_itself_eight_bit_gets_the_rule() -> None:
    assert compare.target_is_eight_bit("bgra8unorm") is True
    assert compare.target_is_eight_bit("rgba8unorm") is True
    assert compare.target_is_eight_bit("rgba16float") is False
    assert compare.target_is_eight_bit("") is False
    assert compare.target_is_eight_bit("rgb10a2unorm") is False


def test_within_one_level_on_an_eight_bit_target_does_not_count() -> None:
    space = compare.presentation_space("sdr", False, 203.0)
    # Just above the luminance floor one level is about 6% of luminance, so a
    # preview 0.9 of a level from the export is over the 5% ceiling as measured.
    export, preview = _grey(25.1), _grey(26.0)
    pixels = export.shape[0] * export.shape[1]

    judged = compare.tone_statistics(preview, export, space, eight_bit_target=True)
    assert judged["luminance"]["max"] > compare.LIMITS["luminanceCeiling"]
    assert judged["luminance"]["judged"]["max"] == 0.0
    assert all(judged[key][name] for key in ("luminance", "oklab") for name in ("typicalOk", "ceilingOk"))
    assert judged["eightBitRule"]["applied"] is True
    assert judged["eightBitRule"]["exemptPixels"] == pixels
    assert judged["eightBitRule"]["exemptOverLuminanceCeiling"] == pixels

    # The same pixels on a float target, where the HDR lane is presented, are
    # judged by the limits as written.
    written = compare.tone_statistics(preview, export, space)
    assert written["eightBitRule"]["applied"] is False and written["eightBitRule"]["exemptPixels"] == 0
    assert written["luminance"]["typicalOk"] is False and written["luminance"]["ceilingOk"] is False
    assert written["luminance"]["max"] == judged["luminance"]["max"]


def test_more_than_one_level_is_judged_as_written_on_an_eight_bit_target() -> None:
    space = compare.presentation_space("sdr", False, 203.0)
    export = _grey(25.1)
    preview = export.copy()
    preview[7, 11] = _grey(27.0)[0, 0]  # 1.9 levels away
    preview[8, 12] = _grey(26.0)[0, 0]  # 0.9 of a level away
    statistics = compare.tone_statistics(preview, export, space, eight_bit_target=True)
    assert statistics["eightBitRule"]["exemptPixels"] == statistics["pixels"] - 1
    assert statistics["luminance"]["ceilingOk"] is False
    assert statistics["luminance"]["countAboveCeiling"] == 1
    # The pixel that counts is reported with its full error, not a reduced one.
    assert statistics["luminance"]["judged"]["max"] == statistics["luminance"]["max"]
    assert statistics["luminance"]["judged"]["worstPixel"]["x"] == 11
    assert statistics["luminance"]["judged"]["worstPixel"]["y"] == 7
    assert 1.8 < statistics["luminance"]["judged"]["worstPixel"]["levels"] < 2.0


def test_exempt_pixels_stay_in_the_population_as_pixels_inside_the_limits() -> None:
    space = compare.presentation_space("sdr", False, 203.0)
    export = np.concatenate([_grey(25.1, 50, 100), np.full((50, 100, 3), 0.5)])
    preview = np.concatenate([_grey(26.0, 50, 100), np.full((50, 100, 3), 0.5)])
    # 75 bright pixels 3% high: about 2.5 levels, so they count. They are 0.75%
    # of the frame, inside the 99% bound, but 1.5% of the non-exempt half.
    preview[50, :75] *= 1.03
    statistics = compare.tone_statistics(preview, export, space, eight_bit_target=True)
    assert statistics["eightBitRule"]["exemptPixels"] == 5000 + 25 + 49 * 100
    assert statistics["luminance"]["fractionAboveTypical"] == 0.0075
    assert statistics["luminance"]["typicalOk"] is True and statistics["luminance"]["ceilingOk"] is True
    assert compare.tone_statistics(preview, export, space)["luminance"]["typicalOk"] is False


def test_an_unrounded_preview_mask_is_judged_as_it_is() -> None:
    ramp = np.tile(np.linspace(0, 255, 96).round().astype(np.uint8), (96, 1))
    inside = compare.mask_statistics(ramp.astype(np.float32) + 1.6, ramp)
    assert inside["softOk"] is True and abs(inside["maxLevels"] - 1.6) < 1e-3
    on_trial = compare.mask_statistics(ramp.astype(np.float32) + 2.4, ramp)
    assert on_trial["softOk"] is True and on_trial["overApprovedSoftLimit"] is True
    assert on_trial["pixelsAboveSoftLimit"] == ramp.size
    outside = compare.mask_statistics(ramp.astype(np.float32) + 3.4, ramp)
    assert outside["softOk"] is False


def test_a_trace_below_half_a_level_is_not_a_mask_that_appeared() -> None:
    empty = np.zeros((96, 96), dtype=np.uint8)
    trace = compare.mask_statistics(np.full((96, 96), 0.4, dtype=np.float32), empty)
    assert trace["presentInPreview"] is False and trace["regionOk"] is True
    appeared = compare.mask_statistics(np.full((96, 96), 0.6, dtype=np.float32), empty)
    assert appeared["presentInPreview"] is True and appeared["regionOk"] is False


def test_an_unrounded_hard_edge_is_placed_where_it_would_round() -> None:
    disc = _disc()
    statistics = compare.mask_statistics(disc.astype(np.float32) * 0.999, disc)
    assert statistics["edge"]["maxPixels"] == 0 and statistics["hardEdgeOk"] is True
