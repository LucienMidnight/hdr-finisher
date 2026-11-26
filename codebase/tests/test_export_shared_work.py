"""Export renditions share work they would otherwise repeat, with the same pixels."""
from weakref import ref

import numpy as np
import pytest

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.local_adjustments import compile_geometry_fixed_mask, share_fixed_masks
from hdr_finisher.models import (
    AdjustmentState, BrushStroke, GeometryAdjustments, LocalAdjustment, MaskExpression, MaskLeaf, MaskPoint,
    PreviewKind,
)

GEOMETRY = GeometryAdjustments(perspective_vertical=30.0, perspective_rotate=1.0,
                               crop={"x": 0.0, "y": 0.05, "width": 1.0, "height": 0.9})


def _brush():
    stroke = BrushStroke(points=[MaskPoint(x=.3, y=.4), MaskPoint(x=.6, y=.5)], radius=.2, hardness=.5,
                         flow=1.0, opacity=1.0)
    return MaskExpression(leaf=MaskLeaf(type="brush", strokes=[stroke], mask_feather=0.02))


def _image():
    return np.random.default_rng(9).random((96, 144, 3), dtype=np.float32)


def test_one_export_compiles_each_fixed_mask_once_with_the_same_values():
    image, mask = _image(), _brush()
    fresh = compile_geometry_fixed_mask(image, mask, GEOMETRY, spatial_only=True)
    with share_fixed_masks():
        first = compile_geometry_fixed_mask(image, mask, GEOMETRY, spatial_only=True)
        second = compile_geometry_fixed_mask(image, mask, GEOMETRY, spatial_only=True)
        other = compile_geometry_fixed_mask(image.copy(), mask, GEOMETRY, spatial_only=True)
    assert second is first and other is not first
    np.testing.assert_array_equal(first, fresh)
    with pytest.raises(ValueError):
        first[0, 0] = 1  # Shared between renditions, so it cannot be changed in place.


def test_fixed_mask_memo_releases_old_masks_and_does_not_pin_sources():
    mask = _brush()
    hdr, sdr = _image(), _image()
    hdr_ref, sdr_ref = ref(hdr), ref(sdr)
    with share_fixed_masks():
        hdr_mask = ref(compile_geometry_fixed_mask(hdr, mask, GEOMETRY, spatial_only=True))
        assert hdr_mask() is not None
        del hdr
        assert hdr_ref() is None
        sdr_mask = ref(compile_geometry_fixed_mask(sdr, mask, GEOMETRY, spatial_only=True))
        assert hdr_mask() is None
        assert compile_geometry_fixed_mask(sdr, mask, GEOMETRY, spatial_only=True) is sdr_mask()
        del sdr
        assert sdr_ref() is None
    assert sdr_mask() is None


def test_local_stack_reports_each_completed_tile_band(monkeypatch):
    from hdr_finisher import export_timing
    from hdr_finisher.local_adjustments import apply_local_stack

    image = _image()
    calls = []
    monkeypatch.setattr(export_timing, "tick", lambda done, total: calls.append((done, total)))
    local = LocalAdjustment(name="Brush", mask=_brush())
    apply_local_stack(image, image, [local], PreviewKind.HDR, GeometryAdjustments(), tile_size=40)
    assert calls == [(40, 96), (80, 96), (96, 96)]


def test_a_resolved_shared_source_renders_like_its_full_path():
    image = _image()
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GEOMETRY
    local = LocalAdjustment(name="Brush", mask=_brush())
    local.sdr_grade.exposure = 1.0
    cache = {}

    def make_filter(shared):
        def source_filter(fixed, authored):
            if "pixels" not in cache:
                cache["pixels"] = fixed * np.float32(.5)
            return cache["pixels"]
        if shared:
            source_filter.resolved = lambda: "pixels" in cache
        return source_filter

    hdr = apply_adjustments(image, adjustments, PreviewKind.HDR, local_adjustments=[local],
                            source_filter=make_filter(True))
    # The SDR rendition skips its geometry pass and reuses the shared pixels.
    shared = apply_adjustments(image, adjustments, PreviewKind.SDR, local_adjustments=[local],
                               source_filter=make_filter(True))
    full = apply_adjustments(image, adjustments, PreviewKind.SDR, local_adjustments=[local],
                             source_filter=make_filter(False))
    assert hdr.shape == shared.shape
    np.testing.assert_array_equal(shared, full)
