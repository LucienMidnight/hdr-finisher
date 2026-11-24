"""Exact masks for a region only (Viewport-Bounded GPU Preview PRD 5.1).

A mask that depends on a pixel or a bounded neighbourhood is evaluated for the
visible region instead of the whole image. The region has to be the same mask
the whole compile, and therefore the export, produces.
"""
from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.local_adjustments import (
    brush_mask_working_bytes,
    compile_geometry_fixed_mask,
    compile_geometry_fixed_mask_region,
    mask_region_margin,
)
from hdr_finisher.models import GeometryAdjustments, MaskExpression

WIDTH, HEIGHT = 900, 600
CROP = {"x": 0.1234, "y": 0.0777, "width": 0.713, "height": 0.811}
GEOMETRIES = {
    "none": {},
    "crop": {"crop": CROP},
    "crop-flip": {"crop": CROP, "flip_horizontal": True},
    "crop-quarter-turn": {"crop": CROP, "rotation": 90},
    "three-quarter-turn-flip": {"rotation": 270, "flip_vertical": True},
}
GRADIENT = {"type": "linear_gradient", "start": {"x": 0.3, "y": 0.2}, "end": {"x": 0.6, "y": 0.7}, "gradient_fan": 0.4}
HARD_PATH = {"type": "path", "nodes": [
    {"x": 0.25, "y": 0.2, "node_type": "sharp"}, {"x": 0.8, "y": 0.3, "node_type": "sharp"},
    {"x": 0.7, "y": 0.8, "node_type": "sharp"}, {"x": 0.3, "y": 0.75, "node_type": "sharp"}]}
FEATHERED_PATH = {**HARD_PATH, "feather": 0.05, "feather_mode": "outer_boundary", "feather_softness": 0.5}
BRUSH = {"type": "brush", "strokes": [
    {"points": [{"x": 0.2, "y": 0.3}, {"x": 0.5, "y": 0.5}, {"x": 0.8, "y": 0.4}], "radius": 0.06, "hardness": 0.6},
    {"points": [{"x": 0.5, "y": 0.45}], "radius": 0.05, "hardness": 0.9, "erase": True},
    {"points": [{"x": 0.6, "y": 0.7}], "radius": 0.08, "hardness": 1.0, "flow": 0.5}]}
LUMINANCE = {"type": "luminance_range", "fade_in_start_ev": -3.0, "full_start_ev": -1.0, "full_end_ev": 1.0,
             "fade_out_end_ev": 2.5}
FEATHERED_LUMINANCE = {**LUMINANCE, "mask_feather": 0.004}


def _image() -> np.ndarray:
    generator = np.random.default_rng(5)
    y, x = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    base = 0.18 * np.exp2(3.0 * np.sin(x / 70.0) * np.cos(y / 55.0))
    return (base[..., None] * generator.uniform(0.8, 1.2, size=(HEIGHT, WIDTH, 3))).astype(np.float32)


def _expression(leaf: dict, **fields) -> MaskExpression:
    return MaskExpression.model_validate({"leaf": leaf, **fields})


@pytest.mark.parametrize("geometry_name", ["none", "crop-quarter-turn"])
@pytest.mark.parametrize("enabled,center,inverted", [(True, 80, False), (True, 160, True), (True, None, True), (False, 80, True)])
@pytest.mark.parametrize("edge,shift", [(WIDTH, -3.5), (620, 4.0)])
def test_standalone_hue_regions_match_the_full_hsl_stage_mask(geometry_name, enabled, center, inverted, edge, shift):
    from hdr_finisher.models import AdjustmentState, LocalAdjustment
    from hdr_finisher.render_cache import SessionRenderCache

    image = _image()
    cache = SessionRenderCache(image, None, eager_peak_candidates=False)
    adjustments = AdjustmentState.model_validate({"hdr": {"exposure": .6, "saturation": 1.2},
                                                  "shared": {"geometry": GEOMETRIES[geometry_name]}})
    expression = _expression({"type": "hue_range", "hue_center": center, "edge": shift,
                              "edge_feather": 9, "mask_opacity": .42}, enabled=enabled, inverted=inverted)
    local = LocalAdjustment(mask=expression)
    whole = cache.compiled_local_mask(adjustments, local, edge, spatial_only=True)
    for left, top, right, bottom in [(0, 0, 85, 101), (173, 121, 411, 419),
                                     (whole.shape[1] - 100, whole.shape[0] - 91, whole.shape[1], whole.shape[0])]:
        region, size = cache.compiled_local_mask_region(adjustments, local, edge, (left, top, right, bottom))
        assert size == whole.shape[::-1]
        np.testing.assert_array_equal(region, whole[top:bottom, left:right])


@pytest.mark.parametrize("operator, leaf", [("union", GRADIENT), ("intersect", LUMINANCE), ("union", BRUSH)])
@pytest.mark.parametrize("geometry_name", ["none", "crop-quarter-turn"])
def test_compound_hue_regions_match_whole_at_edges_and_chunk_joins(monkeypatch, operator, leaf, geometry_name):
    from hdr_finisher import local_adjustments
    from hdr_finisher.models import AdjustmentState, LocalAdjustment
    from hdr_finisher.render_cache import SessionRenderCache

    monkeypatch.setattr(local_adjustments, "MASK_REGION_CHUNK_PIXELS", 256**2)
    cache = SessionRenderCache(_image(), None, eager_peak_candidates=False)
    adjustments = AdjustmentState.model_validate({"hdr": {"exposure": .6, "saturation": 1.2},
                                                  "shared": {"geometry": GEOMETRIES[geometry_name]}})
    hue = _expression({"type": "hue_range", "hue_center": 160, "hue_width": 100,
                       "edge": -4, "edge_feather": 7, "mask_opacity": .81}, inverted=True)
    expression = MaskExpression(operator=operator, children=[hue, _expression({**leaf, "mask_opacity": .95})])
    local = LocalAdjustment(mask=expression)
    whole = cache.compiled_local_mask(adjustments, local, WIDTH, spatial_only=True)
    assert np.ptp(whole) > 0
    width, height = whole.shape[::-1]
    for rect in [(0, 0, width - 47, height - 35), (83, 119, width, height)]:
        region, size = cache.compiled_local_mask_region(adjustments, local, WIDTH, rect)
        assert size == (width, height)
        left, top, right, bottom = rect
        np.testing.assert_array_equal(region, whole[top:bottom, left:right])


@pytest.mark.parametrize("compound", [False, True])
def test_hue_region_memory_plan_reserves_expression_scratch(compound):
    from hdr_finisher.models import AdjustmentState
    from hdr_finisher.render_cache import SessionRenderCache

    cache = SessionRenderCache(_image(), None, eager_peak_candidates=False)
    hue = _expression({"type": "hue_range", "hue_center": 160, "hue_width": 100})
    expression = MaskExpression(operator="union", children=[hue, _expression(GRADIENT)]) if compound else hue
    size, method, margin, block, _, _, reserved = cache.local_mask_region_plan(
        AdjustmentState(), expression, WIDTH, (0, 0, 100, 80),
    )
    assert size == (WIDTH, HEIGHT)
    assert method == "hue"
    working_width = min(WIDTH, min(block, 100) + 2 * margin + 32)
    working_height = min(WIDTH, min(block, 80) + 2 * margin + 32)
    bytes_per_pixel = 152 if compound else 128
    assert reserved == 100 * 80 + working_width * working_height * bytes_per_pixel


@pytest.mark.parametrize("geometry_name", list(GEOMETRIES))
@pytest.mark.parametrize("leaf_name,leaf,tolerance", [
    ("gradient", GRADIENT, 0), ("hard path", HARD_PATH, 0), ("feathered path", FEATHERED_PATH, 0),
    ("luminance", LUMINANCE, 0), ("feathered luminance", FEATHERED_LUMINANCE, 1), ("brush", BRUSH, 1),
])
def test_a_region_is_the_same_mask_as_the_whole_compile(geometry_name, leaf_name, leaf, tolerance) -> None:
    image = _image()
    geometry = GeometryAdjustments.model_validate(GEOMETRIES[geometry_name])
    expression = _expression(leaf, inverted=leaf_name == "gradient")
    whole = compile_geometry_fixed_mask(image, expression, geometry, spatial_only=True)
    height, width = whole.shape
    for rect in ((0, 0, width, height), (37, 21, 37 + 260, 21 + 190), (width - 150, height - 120, width + 40, height + 40)):
        compiled = compile_geometry_fixed_mask_region(image, expression, geometry, rect, spatial_only=True)
        assert compiled is not None
        block, output_size = compiled
        assert output_size == (width, height)
        expected = whole[rect[1]:min(rect[3], height), rect[0]:min(rect[2], width)]
        assert block.shape == expected.shape
        difference = np.abs(block.astype(np.int16) - expected.astype(np.int16))
        assert int(difference.max(initial=0)) <= tolerance, (leaf_name, geometry_name, rect)
        # Rounding in the last place may move a value by one level; it never moves many.
        assert np.count_nonzero(difference) <= 0.01 * difference.size, (leaf_name, geometry_name, rect)


def test_a_combination_of_region_masks_is_a_region_mask() -> None:
    image = _image()
    geometry = GeometryAdjustments.model_validate(GEOMETRIES["crop"])
    expression = MaskExpression.model_validate({"operator": "subtract", "children": [
        {"leaf": FEATHERED_PATH}, {"leaf": FEATHERED_LUMINANCE}]})
    assert mask_region_margin(expression, WIDTH) == mask_region_margin(_expression(FEATHERED_LUMINANCE), WIDTH)
    whole = compile_geometry_fixed_mask(image, expression, geometry, spatial_only=True)
    block, _size = compile_geometry_fixed_mask_region(image, expression, geometry, (50, 40, 300, 260), spatial_only=True)
    assert int(np.abs(block.astype(np.int16) - whole[40:260, 50:300].astype(np.int16)).max()) <= 1


def test_masks_that_depend_on_the_whole_image_are_refused() -> None:
    image = _image()
    geometry = GeometryAdjustments()
    feathered_brush = _expression({**BRUSH, "mask_feather": 0.01})
    shifted_brush = _expression({**BRUSH, "mask_shift_edge": 0.01})
    wide_luminance = _expression({**LUMINANCE, "mask_feather": 0.05})
    assert mask_region_margin(_expression(BRUSH), WIDTH) == 0
    for expression in (feathered_brush, shifted_brush):
        assert mask_region_margin(expression, WIDTH) is None
        assert compile_geometry_fixed_mask_region(image, expression, geometry, (0, 0, 100, 100)) is None
    # The same feather is a bounded neighbourhood on a small frame and most of a large one.
    assert mask_region_margin(wide_luminance, 900) is not None
    assert mask_region_margin(wide_luminance, 7968) is None
    combination = MaskExpression.model_validate({"operator": "union", "children": [
        {"leaf": GRADIENT}, {"leaf": {**BRUSH, "mask_feather": 0.01}}]})
    assert mask_region_margin(combination, WIDTH) is None


def test_resampling_geometry_is_refused() -> None:
    image = _image()
    for fields in ({"straighten_angle": 2.0}, {"perspective_horizontal": 0.1}):
        geometry = GeometryAdjustments.model_validate(fields)
        assert compile_geometry_fixed_mask_region(image, _expression(GRADIENT), geometry, (0, 0, 100, 100)) is None


def test_disabled_brush_combination_accounts_for_the_first_child_only() -> None:
    brush = _expression(BRUSH)
    disabled = MaskExpression.model_validate({"operator": "union", "enabled": False, "children": [
        {"operator": "union", "enabled": False, "children": [{"leaf": BRUSH}, {"leaf": BRUSH}]},
        {"leaf": BRUSH},
    ]})
    geometry = GeometryAdjustments()
    image = _image()
    np.testing.assert_array_equal(compile_geometry_fixed_mask(image, disabled, geometry),
                                  compile_geometry_fixed_mask(image, brush, geometry))
    expected = brush_mask_working_bytes(brush)
    assert expected > 0
    assert brush_mask_working_bytes(disabled) == expected


@pytest.mark.parametrize("leaf", [{**BRUSH, "mask_feather": .042}, {**LUMINANCE, "mask_feather": .05}])
def test_warm_reduced_wide_mask_strips_match_whole_compile(leaf) -> None:
    from hdr_finisher.models import AdjustmentState, LocalAdjustment
    from hdr_finisher.render_cache import SessionRenderCache

    image = np.tile(_image(), (2, 3, 1))
    cache = SessionRenderCache(image, None, eager_peak_candidates=False)
    adjustments = AdjustmentState()
    expression = _expression(leaf, inverted=True)
    local = LocalAdjustment(mask=expression)
    edge = 1800
    assert mask_region_margin(expression, edge) is None
    whole = cache.compiled_local_mask(adjustments, local, edge, spatial_only=True)
    left, top, right, bottom = rect = (173, 121, 1245, 751)
    region, size = cache.compiled_local_mask_region(adjustments, local, edge, rect)
    assert size == whole.shape[::-1]
    np.testing.assert_array_equal(region, whole[top:bottom, left:right])
