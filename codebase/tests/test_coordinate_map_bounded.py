import numpy as np
import pytest

from hdr_finisher import finishing
from hdr_finisher.models import GeometryAdjustments


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("horizontal,vertical", [(False,False),(True,False),(False,True),(True,True)])
def test_bounded_index_map_is_identical_to_full_coordinate_ramps(monkeypatch, rotation, horizontal, vertical):
    geometry = GeometryAdjustments(rotation=rotation, flip_horizontal=horizontal, flip_vertical=vertical,
        crop={"x":.1658516624,"y":.0633601864,"width":.6259532577,"height":.9366398136})
    bounded = finishing.geometry_coordinate_map(131,79,geometry)
    # Force the existing full-ramp route while preserving the actual geometry.
    monkeypatch.setattr(finishing,"geometry_resample_stage",lambda _geometry: "perspective")
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
