from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.finishing import apply_geometry, apply_geometry_region
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, PreviewKind
from hdr_finisher.preview import downsample_image
from hdr_finisher.preview_geometry import limit_geometry_overshoot
from hdr_finisher.render_cache import SessionRenderCache


def clipped_source():
    image = np.full((640, 960, 3), .18, dtype=np.float32)
    image[310:325, 120:840] = [80, 65, 55]
    # A genuine negative outside the crop makes global clipping ineffective.
    image[:20, :20, 2] = -.2
    return image


@pytest.mark.parametrize('perspective', [False, True])
@pytest.mark.parametrize('kind', [PreviewKind.HDR, PreviewKind.SDR])
def test_reduced_geometry_does_not_invent_negative_highlight_edges(perspective, kind):
    image = clipped_source()
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(
        straighten_angle=-.9, perspective_rotate=-.43,
        perspective_horizontal=1.4 if perspective else 0,
        crop={'x': .1, 'y': .1, 'width': .8, 'height': .8},
    )
    cache = SessionRenderCache(image, image.copy())
    reduced = downsample_image(image, 480)
    old = apply_geometry(reduced, adjustments.shared.geometry)
    assert np.min(old) < 0, 'fixture must expose geometry overshoot'
    fixed, _, _ = cache.geometry_source_proxy(kind, 480, adjustments)
    assert np.min(fixed) >= np.float32(.18)
    windows = cache.geometry_source_windows(kind, 480, adjustments)
    assert windows is not None
    height, width, read = windows
    assert (height, width) == fixed.shape[:2]
    for rect in [(0, 0, width // 2, height), (width // 2, 0, width, height)]:
        x0, y0, x1, y1 = rect
        expected = fixed[y0:y1, x0:x1]
        np.testing.assert_allclose(read(y0, x0, y1, x1), expected, atol=1e-6, rtol=1e-6)
        tile, _, _, placement = cache.geometry_source_tile(kind, 480, adjustments, rect, halo=3)
        left, top, right, bottom = placement['delivered']
        np.testing.assert_allclose(tile, fixed[top:bottom, left:right], atol=1e-6, rtol=1e-6)


@pytest.mark.parametrize('geometry', [
    GeometryAdjustments(straighten_angle=2.5),
    GeometryAdjustments(straighten_angle=-.9, perspective_rotate=-.43, perspective_horizontal=1.4),
    GeometryAdjustments(rotation=90, flip_horizontal=True, straighten_angle=3, perspective_vertical=-12,
                        crop={'x': .1, 'y': .12, 'width': .7, 'height': .65}),
])
def test_native_gpu_geometry_stays_byte_identical(geometry):
    image = clipped_source()
    adjustments = AdjustmentState()
    adjustments.shared.geometry = geometry
    cache = SessionRenderCache(image, None)
    expected = apply_geometry(image, geometry)
    native, _, _ = cache.geometry_source_proxy(PreviewKind.HDR, 960, adjustments)
    np.testing.assert_array_equal(native, expected)
    height, width, read = cache.geometry_source_windows(PreviewKind.HDR, 960, adjustments)
    rect = (width // 4, height // 4, width // 2, height // 2)
    x0, y0, x1, y1 = rect
    np.testing.assert_array_equal(read(y0, x0, y1, x1), apply_geometry_region(image, geometry, rect))
    tile, _, _, _ = cache.geometry_source_tile(PreviewKind.HDR, 960, adjustments, rect)
    np.testing.assert_array_equal(tile, apply_geometry_region(image, geometry, rect))


def test_reduced_geometry_preserves_real_negative_source_colours():
    source = np.full((120, 180, 3), [.3, .2, -.08], dtype=np.float32)
    geometry = GeometryAdjustments(straighten_angle=-.9, perspective_horizontal=1.4)
    result = limit_geometry_overshoot(source, geometry, apply_geometry(source, geometry))
    np.testing.assert_array_equal(result[..., 2], np.full(result.shape[:2], -.08, dtype=np.float32))


def test_reduced_window_bounds_match_full_frame_with_orientation_and_crop():
    source = downsample_image(clipped_source(), 480)
    geometry = GeometryAdjustments(rotation=90, flip_vertical=True, straighten_angle=3,
                                   perspective_vertical=-12, crop={'x': .1, 'y': .12, 'width': .7, 'height': .65})
    full = limit_geometry_overshoot(source, geometry, apply_geometry(source, geometry))
    height, width = full.shape[:2]
    x0, y0, x1, y1 = width // 3, height // 4, width - 7, height - 11
    window = apply_geometry_region(source, geometry, (x0, y0, x1, y1))
    window = limit_geometry_overshoot(source, geometry, window, (x0, y0))
    np.testing.assert_allclose(window, full[y0:y1, x0:x1], atol=1e-6, rtol=1e-6)
