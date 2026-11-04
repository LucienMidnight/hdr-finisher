"""Which reduced Library scenes the page may draw from its own planes."""
from hdr_finisher.library_api import direct_drawable, direct_eligible
from hdr_finisher.models import CropRectangle, GeometryAdjustments


def test_plain_crops_draw_directly_and_resampling_or_masks_do_not():
    crop = GeometryAdjustments(crop=CropRectangle(x=0.04, y=0.05, width=0.9, height=0.92))
    assert direct_drawable(GeometryAdjustments(), [], {})
    assert direct_drawable(crop, [], {"hdr": {"enabled": False}})
    for geometry in (GeometryAdjustments(rotation=90), GeometryAdjustments(flip_horizontal=True),
                     GeometryAdjustments(straighten_angle=1.5), GeometryAdjustments(perspective_horizontal=13.0),
                     GeometryAdjustments(perspective_rotate=-0.6)):
        assert not direct_drawable(geometry, [], {})
    assert not direct_drawable(crop, [{"id": "brush"}], {})
    assert not direct_drawable(crop, [], {"sdr": {"enabled": True}})


def test_prediction_follows_the_saved_grade():
    assert direct_eligible(None)
    assert not direct_eligible({"local_adjustments": [{"id": "brush"}]})
    assert not direct_eligible({"denoise": {"hdr": {"enabled": True}}})
