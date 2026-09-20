"""The straighten route rebuilds the whole rolled frame for every tile.

``apply_geometry_region`` extracts the ``index`` and ``perspective`` stages a
window at a time, but ``roll`` -- any straighten -- still materializes the
complete rotated frame and slices it, because Image.rotate(expand=True)'s
expansion and safe inset are not yet reproducible for a window.

That is a known limitation. What made it expensive is that a streamed proxy
asks for the same frame once per row chunk: a straightened 4K tier is six
chunks, each paying a full-frame rotation measured at ~1.2 s, serially, before
anything reaches the viewer. ``roll_cache`` holds one frame across those
chunks.

These tests pin both halves of that: the cache must not change a single pixel,
and it must actually prevent the recomputation -- otherwise it is dead weight
that still holds the memory.
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
from hdr_finisher.models import GeometryAdjustments  # noqa: E402


def straightened(**overrides) -> GeometryAdjustments:
    return GeometryAdjustments(straighten_angle=-1.8, **overrides)


@pytest.fixture()
def image() -> np.ndarray:
    generator = np.random.default_rng(20260920)
    return generator.random((181, 293, 4), dtype=np.float32)


@pytest.fixture()
def counted(monkeypatch):
    """Count the full-frame rotations, which is the cost being avoided.

    ``apply_geometry`` rolls too, so a test that builds a reference frame
    clears the counter before asserting on the region calls it cares about.
    """
    calls = []
    original = finishing._rotate_to_valid_pixels

    def counting(array, angle):
        calls.append(angle)
        return original(array, angle)

    monkeypatch.setattr(finishing, "_rotate_to_valid_pixels", counting)
    return calls


def chunks(height: int, rows: int) -> list[tuple[int, int, int, int]]:
    """The row strips a streamed proxy asks for, widest possible."""
    return [(0, top, 10_000, min(top + rows, height)) for top in range(0, height, rows)]


def test_the_straighten_route_is_the_one_that_materializes(image):
    assert geometry_resample_stage(straightened()) == "roll"


def test_cached_strips_are_byte_identical_to_uncached_ones(image, counted):
    geometry = straightened()
    reference = apply_geometry(image, geometry)
    cache: dict = {}
    for rect in chunks(reference.shape[0], 40):
        plain = apply_geometry_region(image, geometry, rect)
        cached = apply_geometry_region(image, geometry, rect, roll_cache=cache, roll_cache_key="k")
        np.testing.assert_array_equal(cached, plain)
        top, bottom = rect[1], min(rect[3], reference.shape[0])
        np.testing.assert_array_equal(cached, reference[top:bottom, 0 : reference.shape[1]])


def test_one_rotation_serves_every_strip(image, counted):
    geometry = straightened()
    height = apply_geometry(image, geometry).shape[0]
    cache: dict = {}
    strips = chunks(height, 40)
    assert len(strips) > 1, "the point of the cache is more than one strip"
    counted.clear()
    for rect in strips:
        apply_geometry_region(image, geometry, rect, roll_cache=cache, roll_cache_key="k")
    assert len(counted) == 1


def test_without_a_cache_every_strip_pays_again(image, counted):
    geometry = straightened()
    height = apply_geometry(image, geometry).shape[0]
    strips = chunks(height, 40)
    counted.clear()
    for rect in strips:
        apply_geometry_region(image, geometry, rect)
    assert len(counted) == len(strips)


def test_a_crop_drag_reuses_the_frame(image, counted):
    # The crop is applied by slicing the rolled frame, so it is deliberately
    # not part of the key: dragging a crop rectangle over a straightened image
    # must not rebuild anything.
    cache: dict = {}
    for width in (1.0, 0.9, 0.8, 0.7):
        geometry = straightened(crop={"x": 0.0, "y": 0.0, "width": width, "height": width})
        apply_geometry_region(image, geometry, None, roll_cache=cache, roll_cache_key="k")
    assert len(counted) == 1


def test_a_different_angle_rebuilds_and_is_correct(image, counted):
    cache: dict = {}
    rebuilds = 0
    for angle in (-1.8, 2.5):
        geometry = GeometryAdjustments(straighten_angle=angle)
        counted.clear()
        result = apply_geometry_region(image, geometry, None, roll_cache=cache, roll_cache_key=("k", angle))
        rebuilds += len(counted)
        np.testing.assert_array_equal(result, apply_geometry(image, geometry))
    assert rebuilds == 2
    assert len(cache) == 1, "the cache holds one frame, it does not accumulate them"


def test_a_key_collision_between_two_bases_is_refused(image, counted):
    # Two different source arrays can legitimately produce the same key -- an
    # SDR-matched base and an authored SDR reference are both "linear-srgb" at
    # the same epoch and geometry. Serving one frame's pixels for the other
    # would be silent corruption, so the entry is accepted on identity.
    other = image[:, ::-1].copy()
    geometry = straightened()
    cache: dict = {}
    counted.clear()
    first = apply_geometry_region(image, geometry, None, roll_cache=cache, roll_cache_key="same")
    second = apply_geometry_region(other, geometry, None, roll_cache=cache, roll_cache_key="same")
    rebuilds = len(counted)
    np.testing.assert_array_equal(first, apply_geometry(image, geometry))
    np.testing.assert_array_equal(second, apply_geometry(other, geometry))
    # Neither call may reuse the other's frame, so both pay.
    assert rebuilds == 2


def test_the_index_and_perspective_routes_ignore_the_cache(image, counted):
    cache: dict = {}
    for geometry in (
        GeometryAdjustments(rotation=90),
        GeometryAdjustments(perspective_horizontal=0.2),
    ):
        reference = apply_geometry(image, geometry)
        counted.clear()
        result = apply_geometry_region(image, geometry, None, roll_cache=cache, roll_cache_key="k")
        np.testing.assert_allclose(result, reference, atol=1e-6, rtol=1e-6)
        assert counted == []
    assert cache == {}


# --- the route that actually pays for this ---------------------------------
#
# The unit tests above pin the mechanism. This one pins that the caller wired
# it up: the streamed source-tile route is what asks for the same rolled frame
# once per row chunk, and it is the only reason the cache exists.

from hdr_finisher.models import AdjustmentState, PreviewKind  # noqa: E402
from hdr_finisher.render_cache import SessionRenderCache  # noqa: E402


def straightened_state() -> AdjustmentState:
    adjustments = AdjustmentState()
    adjustments.shared.geometry.straighten_angle = -1.8
    return adjustments


def test_streamed_row_chunks_roll_the_frame_once(image, counted):
    cache = SessionRenderCache(image, None)
    adjustments = straightened_state()
    edge = max(image.shape[:2])

    _first, _space, _signature, placement = cache.geometry_source_tile(
        PreviewKind.HDR, edge, adjustments, None, (0, 0, 10_000, 40)
    )
    assert placement["resample_stage"] == "roll"
    height = placement["output_height"]
    strips = list(range(0, height, 40))
    assert len(strips) > 1

    counted.clear()
    collected = []
    for top in strips:
        tile, _space, _signature, _placement = cache.geometry_source_tile(
            PreviewKind.HDR, edge, adjustments, None, (0, top, 10_000, top + 40)
        )
        collected.append(tile)
    assert len(counted) == 0, "the frame rolled for the first chunk still serves the rest"

    # And the strips still assemble into exactly the full-frame result.
    reference = apply_geometry(cache.source_proxy(PreviewKind.HDR, edge)[0], adjustments.shared.geometry)
    np.testing.assert_array_equal(np.concatenate(collected, axis=0), reference)


def test_a_new_source_drops_the_held_frame(image, counted):
    cache = SessionRenderCache(image, None)
    adjustments = straightened_state()
    edge = max(image.shape[:2])
    cache.geometry_source_tile(PreviewKind.HDR, edge, adjustments, None, (0, 0, 10_000, 40))
    assert cache._roll_frame

    cache.replace_source(image[:, ::-1].copy(), None)
    assert not cache._roll_frame, "a frame rolled from the old source must not outlive it"
