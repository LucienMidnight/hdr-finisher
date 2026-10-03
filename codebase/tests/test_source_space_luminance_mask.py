"""A luminance mask under straighten or perspective is finished before the warp.

Export qualifies scene luminance in source space, rounds the mask to bytes and
warps it with the picture. The preview used to qualify the warped picture
instead, which is a different mask wherever luminance changes from pixel to
pixel (P3-LUMA-RESAMPLE-01). The GPU now receives un-resampled luminance as
one half float per pixel and repeats export's order.

This is the CPU model of that route: it shows the half-float transport is
precise enough, and that the previous order of operations was the fault.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from hdr_finisher.finishing import apply_geometry  # noqa: E402
from hdr_finisher.local_adjustments import (  # noqa: E402
    _luminance_range,
    compile_geometry_fixed_mask,
    compile_preview_mask,
)
from hdr_finisher.models import GeometryAdjustments, MaskExpression, PreviewKind  # noqa: E402
from hdr_finisher.render_cache import SessionRenderCache  # noqa: E402


def scene(width: int = 384, height: int = 256) -> np.ndarray:
    x, y = np.meshgrid(np.arange(width, dtype=np.float64), np.arange(height, dtype=np.float64))
    noise = np.random.default_rng(width * 7 + height).standard_normal((height, width)).clip(-2, 2)
    value = 0.18 * 2 ** (5 * np.sin(x * 27.3 / width) + 2 * np.cos(y * 33.3 / height)) * (1 + 0.25 * noise)
    return np.stack((value, value * 0.7, value * 0.4), axis=-1).astype(np.float32)


def luminance_leaf(**stops) -> MaskExpression:
    leaf = {"type": "luminance_range", "fade_in_start_ev": -6, "full_start_ev": -3, "full_end_ev": 2, "fade_out_end_ev": 5}
    return MaskExpression(leaf={**leaf, **stops})


GEOMETRIES = [
    pytest.param(GeometryAdjustments(straighten_angle=2.0), id="straighten"),
    pytest.param(GeometryAdjustments(perspective_vertical=15.0), id="perspective"),
    pytest.param(
        GeometryAdjustments(rotation=90, flip_horizontal=True, straighten_angle=-7.25, perspective_horizontal=-12.0),
        id="oriented-perspective-roll",
    ),
]


def source_space_mask(source: np.ndarray, expression: MaskExpression, geometry: GeometryAdjustments) -> np.ndarray:
    """What the GPU route computes, from the luminance the endpoint serves."""
    cache = SessionRenderCache(source, None)
    oriented = GeometryAdjustments(
        rotation=geometry.rotation, flip_horizontal=geometry.flip_horizontal, flip_vertical=geometry.flip_vertical
    )
    luminance, _delivered, (width, height), _epoch = cache.oriented_source_luminance(
        max(source.shape[:2]), oriented, (0, 0, 100_000, 100_000)
    )
    assert luminance.shape == (height, width)
    transported = luminance.astype(np.float16).astype(np.float32)
    # The qualify shader reads luminance directly; a grey picture carries it.
    mask = _luminance_range(expression.leaf, np.repeat(transported[..., None], 3, axis=-1))
    levels = np.rint(np.clip(mask, 0.0, 1.0) * 255.0).astype(np.float32)
    resample_only = GeometryAdjustments(
        straighten_angle=geometry.straighten_angle,
        perspective_rotate=geometry.perspective_rotate,
        perspective_horizontal=geometry.perspective_horizontal,
        perspective_vertical=geometry.perspective_vertical,
        crop=geometry.crop,
    )
    warped = apply_geometry(levels[..., None], resample_only)[..., 0]
    return np.rint(np.clip(warped, 0.0, 255.0)).astype(np.uint8)


@pytest.mark.parametrize("geometry", GEOMETRIES)
def test_half_float_source_luminance_reproduces_the_export_mask(geometry: GeometryAdjustments) -> None:
    source = scene()
    for expression in (luminance_leaf(), luminance_leaf(fade_in_start_ev=5.5, full_start_ev=9, full_end_ev=12, fade_out_end_ev=14)):
        expected = compile_geometry_fixed_mask(source, expression, geometry, spatial_only=True)
        produced = source_space_mask(source, expression, geometry)
        assert produced.shape == expected.shape
        difference = np.abs(produced.astype(np.int16) - expected.astype(np.int16))
        # Half-float luminance moves a byte only where it sat on a rounding
        # tie; the bicubic warp can then carry that one level a little further.
        assert int(difference.max()) <= 2, int(difference.max())
        assert float(np.mean(difference > 1)) < 1e-4


@pytest.mark.parametrize("geometry", GEOMETRIES)
def test_qualifying_the_warped_picture_is_a_different_mask(geometry: GeometryAdjustments) -> None:
    source = scene()
    expression = luminance_leaf()
    expected = compile_geometry_fixed_mask(source, expression, geometry, spatial_only=True)
    warped_picture = apply_geometry(source, geometry)
    previous = compile_preview_mask(warped_picture, expression, GeometryAdjustments())
    difference = np.abs(previous.astype(np.int16) - expected.astype(np.int16))
    assert int(difference.max()) > 2, "the previous route would have matched; the fault is elsewhere"


def test_source_luminance_is_the_hdr_scene_for_every_lane() -> None:
    source = scene(96, 64)
    authored = np.full_like(source, 0.25)
    cache = SessionRenderCache(source, authored)
    luminance, _delivered, _size, _epoch = cache.oriented_source_luminance(96, GeometryAdjustments(), (0, 0, 96, 64))
    assert float(luminance.std()) > 0.0, "an authored SDR base is not what a luminance mask qualifies"
    assert cache.source_proxy(PreviewKind.SDR, 96)[1] == "linear-srgb"
