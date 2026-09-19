"""Phase 3: post-geometry region extraction must equal the full-frame path.

The sprint's exit gate asks that source tile assembly match the current
full-frame proxy output within approved tolerance, and that geometry seams and
edge padding pass for crop, rotation, perspective, and source boundaries. The
strongest form of that is exact equality against ``apply_geometry`` itself, so
these tests compare ``apply_geometry_region`` to a slice of the reference frame
rather than to a remembered constant.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from hdr_finisher.finishing import (  # noqa: E402
    apply_geometry,
    apply_geometry_region,
    geometry_resample_stage,
)
from hdr_finisher.models import GeometryAdjustments  # noqa: E402

# Approved tolerance for the windowed perspective route.
#
# A window that is not anchored at the warped origin composes the projective
# matrix with a translation and renormalizes it, which perturbs the float32
# resample in its last bits. Measured worst case across this corpus is 6e-08
# absolute and 9e-08 relative, on 2 of 1680 samples. RGBA16F transport carries
# roughly 1e-03 relative precision, so this is about four orders of magnitude
# below anything the preview can represent. Every other route is exact.
WARP_ATOL = 1e-6
WARP_RTOL = 1e-6


def assert_tile_matches(tile, reference, geometry, message):
    """Exact everywhere except the windowed projective resample."""
    if geometry_resample_stage(geometry) == "perspective":
        np.testing.assert_allclose(tile, reference, atol=WARP_ATOL, rtol=WARP_RTOL, err_msg=message)
    else:
        np.testing.assert_array_equal(tile, reference, err_msg=message)


def _source(width: int = 97, height: int = 61) -> np.ndarray:
    """A deterministic, non-symmetric ramp so any misindexing shows up."""
    rng = np.random.default_rng(20260919)
    x = np.linspace(0.0, 1.0, width, dtype=np.float32)[None, :, None]
    y = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None, None]
    channels = np.concatenate(
        [
            np.broadcast_to(x, (height, width, 1)),
            np.broadcast_to(y, (height, width, 1)),
            np.broadcast_to(x * y, (height, width, 1)),
            np.full((height, width, 1), 0.25, dtype=np.float32),
        ],
        axis=-1,
    )
    # HDR sources carry values outside 0..1 and occasional negatives; keep them.
    noise = rng.normal(0.0, 0.05, size=channels.shape).astype(np.float32)
    return np.ascontiguousarray(channels * 3.0 + noise - 0.1, dtype=np.float32)


def _geometry(**overrides) -> GeometryAdjustments:
    geometry = GeometryAdjustments()
    for key, value in overrides.items():
        if key == "crop":
            for field, amount in value.items():
                setattr(geometry.crop, field, amount)
        else:
            setattr(geometry, key, value)
    return geometry


IDENTITY = _geometry()
CROP = _geometry(crop={"x": 0.17, "y": 0.23, "width": 0.55, "height": 0.48})
ROTATE_90 = _geometry(rotation=90)
ROTATE_180_FLIP = _geometry(rotation=180, flip_horizontal=True)
ROTATE_270_CROP = _geometry(rotation=270, flip_vertical=True, crop={"x": 0.1, "y": 0.05, "width": 0.7, "height": 0.8})
PERSPECTIVE = _geometry(perspective_vertical=18.0)
PERSPECTIVE_CROP = _geometry(
    perspective_horizontal=-12.0,
    perspective_vertical=9.0,
    crop={"x": 0.12, "y": 0.08, "width": 0.6, "height": 0.7},
)
PERSPECTIVE_ROLL = _geometry(perspective_horizontal=7.5, straighten_angle=3.25)
ROLL = _geometry(straighten_angle=4.5)

ALL_CASES = [
    pytest.param(IDENTITY, id="identity"),
    pytest.param(CROP, id="crop"),
    pytest.param(ROTATE_90, id="rotate-90"),
    pytest.param(ROTATE_180_FLIP, id="rotate-180-flip-h"),
    pytest.param(ROTATE_270_CROP, id="rotate-270-flip-v-crop"),
    pytest.param(PERSPECTIVE, id="perspective"),
    pytest.param(PERSPECTIVE_CROP, id="perspective-crop"),
    pytest.param(PERSPECTIVE_ROLL, id="perspective-roll"),
    pytest.param(ROLL, id="roll"),
]


@pytest.mark.parametrize("geometry", ALL_CASES)
def test_full_region_equals_the_reference_frame(geometry: GeometryAdjustments) -> None:
    image = _source()
    reference = apply_geometry(image, geometry)
    region = apply_geometry_region(image, geometry, None)

    assert region.shape == reference.shape
    assert region.dtype == np.float32
    # The full output is still a window: the perspective safe rectangle rarely
    # starts at the warped origin, so this crosses the translated-homography
    # path too and carries the same approved tolerance.
    assert_tile_matches(region, reference, geometry, "full region did not match the reference")


@pytest.mark.parametrize("geometry", ALL_CASES)
def test_every_tile_of_a_grid_matches_its_slice_of_the_reference(geometry: GeometryAdjustments) -> None:
    """A seam test: adjacent tiles must join with no overlap and no gap."""
    image = _source()
    reference = apply_geometry(image, geometry)
    height, width = reference.shape[:2]

    # Deliberately uneven tiles so the last column and row are partial.
    x_edges = [0, 7, 23, width // 2, width - 5, width]
    y_edges = [0, 3, 19, height // 2, height - 2, height]
    x_edges = sorted({int(np.clip(value, 0, width)) for value in x_edges})
    y_edges = sorted({int(np.clip(value, 0, height)) for value in y_edges})

    assembled = np.zeros_like(reference)
    covered = np.zeros((height, width), dtype=np.int32)
    for top, bottom in zip(y_edges, y_edges[1:], strict=False):
        for left, right in zip(x_edges, x_edges[1:], strict=False):
            if right <= left or bottom <= top:
                continue
            tile = apply_geometry_region(image, geometry, (left, top, right, bottom))
            assert tile.shape[:2] == (bottom - top, right - left)
            assert_tile_matches(
                tile,
                reference[top:bottom, left:right],
                geometry,
                f"tile ({left},{top},{right},{bottom}) did not match the reference",
            )
            assembled[top:bottom, left:right] = tile
            covered[top:bottom, left:right] += 1

    # Every output pixel produced exactly once: no seam gap, no double coverage.
    assert int(covered.min()) == 1
    assert int(covered.max()) == 1
    assert_tile_matches(assembled, reference, geometry, "assembled tiles did not reproduce the frame")


@pytest.mark.parametrize("geometry", ALL_CASES)
def test_source_boundary_tiles_are_exact(geometry: GeometryAdjustments) -> None:
    """The first and last row and column are where padding would leak in."""
    image = _source()
    reference = apply_geometry(image, geometry)
    height, width = reference.shape[:2]

    edges = {
        "top-left": (0, 0, min(5, width), min(5, height)),
        "top-right": (max(0, width - 5), 0, width, min(5, height)),
        "bottom-left": (0, max(0, height - 5), min(5, width), height),
        "bottom-right": (max(0, width - 5), max(0, height - 5), width, height),
        "first-row": (0, 0, width, 1),
        "last-row": (0, height - 1, width, height),
        "first-column": (0, 0, 1, height),
        "last-column": (width - 1, 0, width, height),
    }
    for name, rect in edges.items():
        tile = apply_geometry_region(image, geometry, rect)
        assert_tile_matches(
            tile,
            reference[rect[1] : rect[3], rect[0] : rect[2]],
            geometry,
            f"{name} boundary tile did not match the reference",
        )


@pytest.mark.parametrize("geometry", ALL_CASES)
def test_a_rect_outside_the_output_is_clamped_rather_than_padded(geometry: GeometryAdjustments) -> None:
    image = _source()
    reference = apply_geometry(image, geometry)
    height, width = reference.shape[:2]

    tile = apply_geometry_region(image, geometry, (-40, -40, width + 40, height + 40))
    assert_tile_matches(tile, reference, geometry, "a clamped rect did not reproduce the full output")


def test_odd_and_prime_source_dimensions_still_tile_exactly() -> None:
    for width, height in ((53, 31), (64, 64), (31, 97)):
        image = _source(width, height)
        geometry = PERSPECTIVE_CROP
        reference = apply_geometry(image, geometry)
        out_height, out_width = reference.shape[:2]
        mid_x = max(1, out_width // 3)
        mid_y = max(1, out_height // 3)
        tile = apply_geometry_region(image, geometry, (mid_x, mid_y, out_width, out_height))
        assert_tile_matches(
            tile,
            reference[mid_y:out_height, mid_x:out_width],
            geometry,
            f"{width}x{height} interior tile did not match the reference",
        )


def test_resample_stage_names_the_route_each_geometry_takes() -> None:
    assert geometry_resample_stage(IDENTITY) == "index"
    assert geometry_resample_stage(CROP) == "index"
    assert geometry_resample_stage(ROTATE_270_CROP) == "index"
    assert geometry_resample_stage(PERSPECTIVE) == "perspective"
    assert geometry_resample_stage(PERSPECTIVE_ROLL) == "perspective"
    assert geometry_resample_stage(ROLL) == "roll"


def test_the_index_route_allocates_no_full_transformed_frame(monkeypatch) -> None:
    """The common geometries must never build the whole output to slice it."""
    import hdr_finisher.finishing as finishing

    def fail(*_args, **_kwargs):  # pragma: no cover - only runs on regression
        raise AssertionError("a region extraction materialized the full frame")

    monkeypatch.setattr(finishing, "_rotate_to_valid_pixels", fail)
    monkeypatch.setattr(finishing, "_warp_perspective_to_valid_pixels", fail)

    image = _source()
    for geometry in (IDENTITY, CROP, ROTATE_90, ROTATE_270_CROP):
        apply_geometry_region(image, geometry, (0, 0, 4, 4))


def test_the_perspective_route_windows_the_warp_instead_of_the_frame(monkeypatch) -> None:
    import hdr_finisher.finishing as finishing

    def fail(*_args, **_kwargs):  # pragma: no cover - only runs on regression
        raise AssertionError("the perspective region built the full transformed frame")

    monkeypatch.setattr(finishing, "_warp_perspective_to_valid_pixels", fail)

    image = _source()
    reference_geometry = PERSPECTIVE_CROP
    tile = apply_geometry_region(image, reference_geometry, (0, 0, 6, 6))
    assert tile.shape[:2] == (6, 6)
