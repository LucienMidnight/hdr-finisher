"""Resampled source tiles are cut from the source, not from a rebuilt frame.

``apply_geometry_region`` resamples only the window for straighten and
perspective. What a window cannot know by itself is the range of each whole
source channel, which the full-frame path clips to. ``range_cache`` holds
those numbers across the tiles of one source.

These tests pin both halves of that: a straightened tile never rebuilds the
rotated frame, and the held range belongs to exactly one source.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from hdr_finisher import finishing  # noqa: E402
from hdr_finisher.finishing import (  # noqa: E402
    apply_geometry,
    apply_geometry_region,
    geometry_resample_stage,
)
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, PreviewKind  # noqa: E402
from hdr_finisher.render_cache import SessionRenderCache  # noqa: E402

# The approved tolerance of the windowed resamples; see test_geometry_region.
WARP_ATOL = 1e-6
WARP_RTOL = 1e-6


def straightened(**overrides) -> GeometryAdjustments:
    return GeometryAdjustments(straighten_angle=-1.8, **overrides)


@pytest.fixture()
def image() -> np.ndarray:
    generator = np.random.default_rng(20260920)
    return generator.random((181, 293, 4), dtype=np.float32)


@pytest.fixture()
def counted(monkeypatch):
    """Count the whole-source scans and the full-frame rotations."""
    calls = {"ranges": 0, "rotations": 0}
    original_minimum = np.min
    original_rotate = finishing._rotate_to_valid_pixels

    def counting_minimum(array, *args, **kwargs):
        calls["ranges"] += 1
        return original_minimum(array, *args, **kwargs)

    def counting_rotate(array, angle):
        calls["rotations"] += 1
        return original_rotate(array, angle)

    monkeypatch.setattr(finishing.np, "min", counting_minimum)
    monkeypatch.setattr(finishing, "_rotate_to_valid_pixels", counting_rotate)
    return calls


def chunks(height: int, rows: int) -> list[tuple[int, int, int, int]]:
    """The row strips a streamed proxy asks for, widest possible."""
    return [(0, top, 10_000, min(top + rows, height)) for top in range(0, height, rows)]


def test_strips_match_the_frame_with_and_without_the_cache(image):
    geometry = straightened()
    assert geometry_resample_stage(geometry) == "roll"
    reference = apply_geometry(image, geometry)
    cache: dict = {}
    for rect in chunks(reference.shape[0], 40):
        plain = apply_geometry_region(image, geometry, rect)
        cached = apply_geometry_region(image, geometry, rect, range_cache=cache, range_cache_key="k")
        np.testing.assert_array_equal(cached, plain)
        top, bottom = rect[1], min(rect[3], reference.shape[0])
        np.testing.assert_allclose(cached, reference[top:bottom], atol=WARP_ATOL, rtol=WARP_RTOL)


def test_one_source_scan_serves_every_strip(image, counted):
    channels = image.shape[2]
    for geometry in (straightened(), GeometryAdjustments(perspective_vertical=12.0)):
        height = apply_geometry(image, geometry).shape[0]
        strips = chunks(height, 40)
        assert len(strips) > 1, "the point of the cache is more than one strip"
        cache: dict = {}
        counted["ranges"] = counted["rotations"] = 0
        for rect in strips:
            apply_geometry_region(image, geometry, rect, range_cache=cache, range_cache_key="k")
        assert counted["ranges"] == channels
        assert counted["rotations"] == 0, "a tile must not rebuild the rotated frame"
        counted["ranges"] = 0
        for rect in strips:
            apply_geometry_region(image, geometry, rect)
        assert counted["ranges"] == channels * len(strips)


def test_the_cache_holds_one_source_and_survives_geometry_changes(image, counted):
    cache: dict = {}
    scans = 0
    for angle, width in ((-1.8, 1.0), (2.5, 0.9), (-1.8, 0.7)):
        geometry = GeometryAdjustments(straighten_angle=angle, crop={"x": 0.0, "y": 0.0, "width": width, "height": width})
        counted["ranges"] = 0
        result = apply_geometry_region(image, geometry, None, range_cache=cache, range_cache_key="k")
        scans += counted["ranges"]
        np.testing.assert_allclose(result, apply_geometry(image, geometry), atol=WARP_ATOL, rtol=WARP_RTOL)
    assert scans == image.shape[2], "the range belongs to the source, not to its geometry"
    assert len(cache) == 1


def test_a_key_collision_between_two_bases_is_refused(image, counted):
    # Two different source arrays can legitimately produce the same key -- an
    # SDR-matched base and an authored SDR reference are both "linear-srgb" at
    # the same epoch. Clipping one to the other's range would be silent
    # corruption, so the entry is accepted on identity.
    other = (image[:, ::-1] * np.float32(0.5)).copy()
    geometry = straightened()
    cache: dict = {}
    counted["ranges"] = 0
    first = apply_geometry_region(image, geometry, None, range_cache=cache, range_cache_key="same")
    second = apply_geometry_region(other, geometry, None, range_cache=cache, range_cache_key="same")
    scans = counted["ranges"]
    np.testing.assert_allclose(first, apply_geometry(image, geometry), atol=WARP_ATOL, rtol=WARP_RTOL)
    np.testing.assert_allclose(second, apply_geometry(other, geometry), atol=WARP_ATOL, rtol=WARP_RTOL)
    # Neither call may reuse the other's range, so both scan.
    assert scans == 2 * image.shape[2]


def test_the_index_route_ignores_the_cache(image, counted):
    cache: dict = {}
    geometry = GeometryAdjustments(rotation=90)
    result = apply_geometry_region(image, geometry, None, range_cache=cache, range_cache_key="k")
    np.testing.assert_array_equal(result, apply_geometry(image, geometry))
    assert cache == {}


# --- the route that actually pays for this ---------------------------------


def straightened_state() -> AdjustmentState:
    adjustments = AdjustmentState()
    adjustments.shared.geometry.straighten_angle = -1.8
    return adjustments


def test_streamed_row_chunks_never_roll_the_frame(image, counted):
    cache = SessionRenderCache(image, None)
    adjustments = straightened_state()
    edge = max(image.shape[:2])

    counted["ranges"] = counted["rotations"] = 0
    _first, _space, _signature, placement = cache.geometry_source_tile(
        PreviewKind.HDR, edge, adjustments, (0, 0, 10_000, 40)
    )
    assert placement["resample_stage"] == "roll"
    height = placement["output_height"]
    strips = list(range(0, height, 40))
    assert len(strips) > 1

    collected = []
    for top in strips:
        tile, _space, _signature, _placement = cache.geometry_source_tile(
            PreviewKind.HDR, edge, adjustments, (0, top, 10_000, top + 40)
        )
        collected.append(tile)
    assert counted["rotations"] == 0
    assert counted["ranges"] == image.shape[2], "the range measured for the first chunk serves the rest"

    # And the strips still assemble into the full-frame result.
    reference = apply_geometry(cache.source_proxy(PreviewKind.HDR, edge)[0], adjustments.shared.geometry)
    np.testing.assert_allclose(np.concatenate(collected, axis=0), reference, atol=WARP_ATOL, rtol=WARP_RTOL)


def test_a_new_source_drops_the_held_range(image):
    cache = SessionRenderCache(image, None)
    adjustments = straightened_state()
    edge = max(image.shape[:2])
    cache.geometry_source_tile(PreviewKind.HDR, edge, adjustments, (0, 0, 10_000, 40))
    assert cache._source_ranges

    cache.replace_source(image[:, ::-1].copy(), None)
    assert not cache._source_ranges, "a range measured on the old source must not outlive it"


def test_oriented_luminance_is_the_source_the_mask_qualifies(image):
    from hdr_finisher.local_adjustments import ACESCG_LUMA

    cache = SessionRenderCache(image, None)
    edge = max(image.shape[:2])
    geometry = GeometryAdjustments(rotation=90, flip_horizontal=True)
    luminance, delivered, size, _epoch = cache.oriented_source_luminance(edge, geometry, (5, 7, 60, 10_000))
    oriented = np.flip(np.rot90(image, k=-1), axis=1)
    assert size == (oriented.shape[1], oriented.shape[0])
    assert delivered == (5, 7, 60, oriented.shape[0])
    expected = np.einsum("...c,c->...", oriented[7:, 5:60, :3], ACESCG_LUMA, optimize=True)
    np.testing.assert_array_equal(luminance, expected)
