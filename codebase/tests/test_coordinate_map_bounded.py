import numpy as np
import pytest

from hdr_finisher import finishing
from hdr_finisher.models import GeometryAdjustments


def _whole_ramps(width, height, geometry):
    ramps = np.stack(np.broadcast_arrays(
        ((np.arange(width, dtype=np.float32) + np.float32(.5)) / width)[None, :],
        ((np.arange(height, dtype=np.float32) + np.float32(.5)) / height)[:, None]), axis=-1)
    return finishing.apply_geometry(ramps, geometry)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("horizontal,vertical", [(False,False),(True,False),(False,True),(True,True)])
def test_bounded_index_map_is_identical_to_full_coordinate_ramps(monkeypatch, rotation, horizontal, vertical):
    geometry = GeometryAdjustments(rotation=rotation, flip_horizontal=horizontal, flip_vertical=vertical,
        crop={"x":.1658516624,"y":.0633601864,"width":.6259532577,"height":.9366398136})
    bounded = finishing.geometry_coordinate_map(131,79,geometry)
    # Read the samples from whole coordinate ramps run through the real image
    # operation, while preserving the actual geometry.
    monkeypatch.setattr(finishing,"geometry_resample_stage",lambda _geometry: "perspective")
    monkeypatch.setattr(finishing,"_coordinate_ramp_samples",
        lambda width,height,geometry,xs,ys: _whole_ramps(width,height,geometry)[ys,xs].astype(np.float64))
    exact = finishing.geometry_coordinate_map(131,79,geometry)
    assert bounded[2:] == exact[2:]
    np.testing.assert_array_equal(bounded[0],exact[0])
    np.testing.assert_array_equal(bounded[1],exact[1])


def test_native_index_map_never_builds_a_coordinate_image(monkeypatch):
    def forbidden(*_args,**_kwargs):
        raise AssertionError("Whole coordinate frame requested")
    monkeypatch.setattr(finishing,"apply_geometry",forbidden)
    result = finishing.geometry_coordinate_map(7968,5320,GeometryAdjustments())
    assert result[2:] == (7968,5320)


RESAMPLED = [
    GeometryAdjustments(straighten_angle=1, perspective_horizontal=-30, perspective_vertical=-20, perspective_rotate=-2),
    GeometryAdjustments(straighten_angle=17, crop={"x": .1, "y": .08, "width": .76, "height": .81}),
    GeometryAdjustments(rotation=90, flip_vertical=True, straighten_angle=-6.7, perspective_vertical=12),
    GeometryAdjustments(straighten_angle=45, perspective_rotate=45),
]


@pytest.mark.parametrize("geometry", RESAMPLED)
def test_resampled_map_equals_whole_coordinate_ramps(geometry):
    width, height = 331, 207
    mapped = _whole_ramps(width, height, geometry)
    xs = np.unique(np.linspace(1, mapped.shape[1] - 2, 7).round().astype(int))
    ys = np.unique(np.linspace(1, mapped.shape[0] - 2, 7).round().astype(int))
    grid_x, grid_y = (grid.ravel() for grid in np.meshgrid(xs, ys))

    samples = finishing._coordinate_ramp_samples(width, height, geometry, grid_x, grid_y)

    assert finishing.geometry_coordinate_map(width, height, geometry)[2:] == mapped.shape[1::-1]
    np.testing.assert_allclose(samples, mapped[grid_y, grid_x], rtol=0, atol=1e-6)


@pytest.mark.parametrize("geometry", RESAMPLED[:3])
def test_native_resampled_map_never_builds_a_coordinate_image(monkeypatch, geometry):
    def forbidden(*_args,**_kwargs):
        raise AssertionError("Whole coordinate frame requested")
    monkeypatch.setattr(finishing,"apply_geometry",forbidden)
    result = finishing.geometry_coordinate_map(5320,7968,geometry)
    assert result[2:] == finishing.geometry_output_dimensions(5320,7968,geometry)
