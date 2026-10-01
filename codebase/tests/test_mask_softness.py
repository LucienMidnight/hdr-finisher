"""The soft-mask rule (Viewport-Bounded GPU Preview PRD 5.1).

A mask is drawn from one small bitmap at every zoom only when the backend can
show the stretched bitmap stays within the soft limit of the exact mask. These
pin the rule's conservative answers and check it, on a small scale, against
the exact compile. ``tests/performance/soft_mask_fuzz.py`` is the full-size
version the rule was calibrated on.
"""
from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "performance"))

from hdr_finisher.finishing import apply_geometry
from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
from hdr_finisher.mask_softness import (
    SOFT_ESTIMATE_LIMIT,
    bitmap_bend_levels,
    bitmap_border_levels,
    bitmap_frame_rect,
    soft_mask_verdict,
)
from hdr_finisher.models import GeometryAdjustments, MaskExpression
from hdr_finisher.preview import downsample_image
from soft_mask_fuzz import random_brush, random_geometry, random_gradient, random_path  # noqa: E402
from soft_mask_survey import sample_bilinear  # noqa: E402

SOURCE = (3000, 2000)
EDGE = 800


def _expression(leaf: dict, **fields) -> MaskExpression:
    return MaskExpression.model_validate({"leaf": leaf, **fields})


def _bitmap(expression: MaskExpression, geometry: GeometryAdjustments | None = None):
    geometry = geometry or GeometryAdjustments()
    proxy = downsample_image(np.zeros((SOURCE[1], SOURCE[0], 3), dtype=np.float32), EDGE)
    bitmap = downsample_image(compile_geometry_fixed_mask(proxy, expression, geometry, spatial_only=True), EDGE)
    rect = bitmap_frame_rect(SOURCE[0], SOURCE[1], proxy.shape[1], proxy.shape[0], geometry)
    return bitmap, proxy, rect


def _verdict(leaf: dict, geometry: GeometryAdjustments | None = None, **fields):
    expression = _expression(leaf, **fields)
    bitmap, proxy, rect = _bitmap(expression, geometry)
    return soft_mask_verdict(expression, bitmap, proxy.shape[1], proxy.shape[0], rect=rect)


GRADIENT = {"type": "linear_gradient", "start": {"x": 0.5, "y": 0.1}, "end": {"x": 0.5, "y": 0.6}}
SOFT_BRUSH = {"type": "brush", "mask_feather": 0.0085, "strokes": [
    {"points": [{"x": 0.3, "y": 0.4}, {"x": 0.6, "y": 0.55}], "radius": 0.05, "hardness": 0.5}]}
HARD_PATH = {"type": "path", "nodes": [
    {"x": 0.3, "y": 0.3, "node_type": "sharp"}, {"x": 0.7, "y": 0.3, "node_type": "sharp"},
    {"x": 0.7, "y": 0.7, "node_type": "sharp"}, {"x": 0.3, "y": 0.7, "node_type": "sharp"}]}


def test_a_long_gradient_and_a_feathered_brush_are_soft() -> None:
    assert _verdict(GRADIENT).soft is True
    assert _verdict(SOFT_BRUSH).soft is True
    assert _verdict(GRADIENT, inverted=True).soft is True


def test_a_hard_edge_is_never_soft() -> None:
    verdict = _verdict(HARD_PATH)
    assert verdict.soft is False and verdict.reason == "bend"
    hard_brush = {"type": "brush", "strokes": [{"points": [{"x": 0.5, "y": 0.5}], "radius": 0.1, "hardness": 1.0}]}
    assert _verdict(hard_brush).soft is False


def test_what_the_rule_cannot_judge_takes_the_exact_path() -> None:
    luminance = {"type": "luminance_range", "mask_feather": 0.05}
    assert _verdict(luminance).reason == "follows-image-content"
    assert _verdict({**GRADIENT, "gradient_luma_enabled": True}).reason == "follows-image-content"
    assert _verdict({**SOFT_BRUSH, "mask_shift_edge": 0.01}).reason == "shift-edge"
    combination = MaskExpression.model_validate({"operator": "union", "children": [
        {"leaf": GRADIENT}, {"leaf": SOFT_BRUSH}]})
    bitmap, proxy, rect = _bitmap(combination)
    verdict = soft_mask_verdict(combination, bitmap, proxy.shape[1], proxy.shape[0], rect=rect)
    assert verdict.soft is False and verdict.reason == "combination"
    assert all(_verdict(leaf).soft is False for leaf in (luminance, {**SOFT_BRUSH, "mask_shift_edge": 0.01}))


def test_a_small_mark_under_a_wide_feather_is_not_soft() -> None:
    # A soft dab a pixel or two across at the bitmap's size: the bitmap cannot
    # see its full strength, and the feather rescales the whole mask to it.
    dab = {"type": "brush", "mask_feather": 0.03, "strokes": [
        {"points": [{"x": 0.5, "y": 0.5}], "radius": 0.002, "hardness": 0.0}]}
    verdict = _verdict(dab)
    assert verdict.soft is False and verdict.terms["peak"] > SOFT_ESTIMATE_LIMIT
    # A small hard mark is seen at full strength, but its area is misjudged.
    hard_dab = {"type": "brush", "mask_feather": 0.03, "strokes": [
        {"points": [{"x": 0.5, "y": 0.5}], "radius": 0.006, "hardness": 1.0}]}
    verdict = _verdict(hard_dab)
    assert verdict.soft is False and verdict.terms["mass"] > SOFT_ESTIMATE_LIMIT


def test_a_flat_bitmap_bends_by_no_more_than_its_rounding() -> None:
    ramp = np.tile(np.linspace(0, 255, 400).round().astype(np.uint8), (300, 1))
    assert bitmap_bend_levels(ramp) <= 1.0
    step = np.zeros((300, 400), dtype=np.uint8)
    step[:, 200:] = 255
    assert bitmap_bend_levels(step) > 60.0


def test_a_mask_still_changing_at_the_frame_edge_pays_for_the_edge_strip() -> None:
    ramp = np.tile((np.arange(400) * 8 % 256).astype(np.uint8), (300, 1))
    assert bitmap_border_levels(ramp, (0.0, 0.0, 1.0, 1.0)) == 4.0  # half a pixel of an 8-level step
    flat = np.full((300, 400), 128, dtype=np.uint8)
    assert bitmap_border_levels(flat, (0.0, 0.0, 1.0, 1.0)) == 0.0


def test_the_stated_rectangle_places_a_cropped_bitmap_to_a_small_fraction_of_a_pixel() -> None:
    def ramps(width: int, height: int) -> np.ndarray:
        x = np.broadcast_to((np.arange(width, dtype=np.float64) + 0.5) / width, (height, width))
        y = np.broadcast_to(((np.arange(height, dtype=np.float64) + 0.5) / height)[:, None], (height, width))
        return np.stack([x, y], axis=-1).astype(np.float32)

    width, height, small_width, small_height = 3000, 2000, 800, 533
    crop = {"x": 0.1234, "y": 0.0777, "width": 0.713, "height": 0.811}
    assert bitmap_frame_rect(width, height, small_width, small_height, GeometryAdjustments()) == (0.0, 0.0, 1.0, 1.0)
    assert bitmap_frame_rect(width, height, small_width, small_height,
                             GeometryAdjustments.model_validate({"straighten_angle": 1.5})) is None
    for fields in ({"crop": crop}, {"crop": crop, "flip_horizontal": True}, {"crop": crop, "rotation": 90},
                   {"crop": crop, "rotation": 270, "flip_vertical": True}):
        geometry = GeometryAdjustments.model_validate(fields)
        exact = apply_geometry(ramps(width, height), geometry)
        bitmap = apply_geometry(ramps(small_width, small_height), geometry)
        origin_x, origin_y, extent_x, extent_y = bitmap_frame_rect(width, height, small_width, small_height, geometry)
        frame_height, frame_width = exact.shape[:2]
        bitmap_height, bitmap_width = bitmap.shape[:2]
        column = np.broadcast_to((((np.arange(frame_width, dtype=np.float32) + 0.5) / frame_width - origin_x) / extent_x)
                                 * bitmap_width - 0.5, (frame_height, frame_width))
        row = np.broadcast_to(((((np.arange(frame_height, dtype=np.float32) + 0.5) / frame_height - origin_y) / extent_y)
                               * bitmap_height - 0.5)[:, None], (frame_height, frame_width))
        inner = (column > 1) & (column < bitmap_width - 2) & (row > 1) & (row < bitmap_height - 2)
        for channel, scale in ((0, small_width), (1, small_height)):
            off = np.abs(sample_bilinear(np.ascontiguousarray(bitmap[..., channel]), column, row) - exact[..., channel]) * scale
            assert float(off[inner].max()) < 0.01, fields


def test_masks_judged_soft_stay_within_the_working_limit_of_the_exact_mask() -> None:
    rng = np.random.default_rng(7)
    image = np.zeros((SOURCE[1], SOURCE[0], 3), dtype=np.float32)
    proxy = downsample_image(image, EDGE)
    judged_soft = 0
    for index in range(90):
        kind = ("brush-feather", "brush-erase", "gradient", "path", "brush-plain", "brush-feather")[index % 6]
        leaf = random_gradient(rng) if kind == "gradient" else random_path(rng) if kind == "path" else random_brush(rng, kind)
        try:
            expression = MaskExpression.model_validate({"leaf": leaf})
        except ValueError:
            continue
        geometry = GeometryAdjustments.model_validate(random_geometry(rng))
        bitmap = downsample_image(compile_geometry_fixed_mask(proxy, expression, geometry, spatial_only=True), EDGE)
        rect = bitmap_frame_rect(SOURCE[0], SOURCE[1], proxy.shape[1], proxy.shape[0], geometry)
        if not soft_mask_verdict(expression, bitmap, proxy.shape[1], proxy.shape[0], rect=rect).soft:
            continue
        judged_soft += 1
        exact = compile_geometry_fixed_mask(image, expression, geometry, spatial_only=True)
        height, width = exact.shape
        origin_x, origin_y, extent_x, extent_y = rect
        column = np.broadcast_to((((np.arange(width, dtype=np.float32) + 0.5) / width - origin_x) / extent_x)
                                 * bitmap.shape[1] - 0.5, (height, width))
        row = np.broadcast_to(((((np.arange(height, dtype=np.float32) + 0.5) / height - origin_y) / extent_y)
                               * bitmap.shape[0] - 0.5)[:, None], (height, width))
        worst = float(np.abs(sample_bilinear(bitmap.astype(np.float32), column, row) - exact).max())
        assert worst <= 3.0, (kind, leaf, worst)
    assert judged_soft >= 5
