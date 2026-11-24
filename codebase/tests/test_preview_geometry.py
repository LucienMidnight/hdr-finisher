from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.finishing import apply_geometry, apply_geometry_region
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, PreviewKind
from hdr_finisher.preview import downsample_image
from hdr_finisher.preview_geometry import limit_geometry_overshoot
from hdr_finisher.render_cache import SessionRenderCache


@pytest.mark.parametrize("roll", [-90, 90])
def test_combined_quarter_turn_map_and_tile_are_analytic(monkeypatch, roll):
    from hdr_finisher import finishing

    width, height = 191, 127
    geometry = GeometryAdjustments(rotation=90, flip_vertical=True,
        straighten_angle=roll / 2, perspective_rotate=roll / 2,
        crop={"x": .13, "y": .08, "width": .78, "height": .84})
    source = np.stack(np.meshgrid((np.arange(width, dtype=np.float32) + .5) / width,
                                  (np.arange(height, dtype=np.float32) + .5) / height), axis=-1)
    full = apply_geometry(source, geometry)

    def reject_whole(*args, **kwargs):
        pytest.fail("An exact quarter turn must not build a transformed coordinate frame")

    monkeypatch.setattr(finishing, "apply_geometry", reject_whole)
    output_to_source, _, output_width, output_height = finishing.geometry_coordinate_map(width, height, geometry)
    assert (output_height, output_width) == full.shape[:2]
    pixel_x, pixel_y = output_width - 8, output_height - 6
    mapped = np.array(output_to_source).reshape(3, 3) @ np.array([
        (pixel_x + .5) / output_width, (pixel_y + .5) / output_height, 1,
    ])
    np.testing.assert_allclose(mapped[:2] / mapped[2], full[pixel_y, pixel_x], atol=1e-6)
    np.testing.assert_array_equal(apply_geometry_region(source, geometry, (0, 0, 8, 6)), full[:6, :8])


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


def test_map_sized_viewports_match_whole_geometry_at_crop_and_warp_edges():
    image = clipped_source()[:637, :957]
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(
        rotation=90, straighten_angle=2.4, perspective_horizontal=-8, perspective_rotate=.81,
        crop={'x': .073, 'y': .127, 'width': .731, 'height': .757},
    )
    for edge in (957, 481):
        region_cache = SessionRenderCache(image, None)
        _, _, width, height = region_cache.geometry_map(adjustments, edge)
        whole, _, _ = SessionRenderCache(image, None).geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
        assert (width, height) == whole.shape[1::-1]
        for rect in [(0, 0, 63, 75), (width - 63, height - 75, width, height)]:
            tile, _, _, placement = region_cache.geometry_source_tile(PreviewKind.HDR, edge, adjustments, rect, halo=3)
            assert (placement['output_width'], placement['output_height']) == (width, height)
            left, top, right, bottom = placement['delivered']
            np.testing.assert_allclose(tile, whole[top:bottom, left:right], atol=1e-6, rtol=1e-6)


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
