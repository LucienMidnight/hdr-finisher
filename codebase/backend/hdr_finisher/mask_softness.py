"""Can one small bitmap stand in for a mask at every zoom? (Viewport PRD 5.1)

A soft mask is drawn from the bitmap compiled for the Fit view, stretched by
the renderer to whatever is on screen. That is only right for a mask with no
edge steeper than the bitmap can carry, so every mask is judged when its
bitmap is compiled and anything not shown to be soft takes the exact path.

The judgement uses what is known without the full-resolution mask: the mask's
own settings, and how sharply the bitmap itself bends.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .finishing import _crop_bounds, geometry_resample_stage
from .models import GeometryAdjustments, MaskExpression


def bitmap_bend_levels(bitmap: np.ndarray) -> float:
    """How sharply the bitmap bends, as the error stretching it could cause.

    Stretching interpolates in straight lines between neighbouring pixels, so
    it is wrong by at most a quarter of the second difference, per axis, where
    the mask turns a corner between them. In 255ths.
    """
    if bitmap.shape[0] < 3 or bitmap.shape[1] < 3:
        return 255.0
    values = bitmap.astype(np.int16)
    across = np.abs(values[:, 2:] - 2 * values[:, 1:-1] + values[:, :-2]).max(initial=0)
    down = np.abs(values[2:] - 2 * values[1:-1] + values[:-2]).max(initial=0)
    return float(across + down) / 4.0


def mask_facts(expression: MaskExpression, bitmap_width: int, bitmap_height: int) -> dict[str, Any]:
    """What a mask's settings say about its edges, in pixels of its bitmap.

    ``bitmap_width`` and ``bitmap_height`` are those of the uncropped source at
    the bitmap's scale, which is the frame the settings are expressed in.
    """
    from .local_adjustments import _painted_mask_feather_radius

    if expression.operator != "leaf" or expression.leaf is None:
        return {"kind": expression.operator}
    leaf = expression.leaf
    long_edge = max(bitmap_width, bitmap_height)
    facts: dict[str, Any] = {"kind": leaf.type}
    if leaf.type == "brush":
        radii = []
        bands = []
        for stroke in leaf.strokes:
            pressure = min((point.pressure for point in stroke.points), default=1.0)
            if len(stroke.points) > 1:
                pressure = max(0.05, pressure)
            radius = stroke.radius * pressure * bitmap_width
            radii.append(radius)
            bands.append(radius * (1.0 - stroke.hardness) / max(stroke.flow, 1e-6))
        facts.update({
            "strokes": len(leaf.strokes),
            "eraseStrokes": sum(1 for stroke in leaf.strokes if stroke.erase),
            "minRadiusPx": round(min(radii, default=0.0), 2),
            "minBandPx": round(min(bands, default=0.0), 2),
            "minEraseBandPx": round(min((band for band, stroke in zip(bands, leaf.strokes) if stroke.erase), default=-1.0), 2),
            "featherSigmaPx": round(min(2048.0, _painted_mask_feather_radius(leaf.mask_feather) * long_edge), 2)
            if leaf.mask_feather > 0.0 else 0.0,
            "shifted": leaf.mask_shift_edge != 0.0,
        })
    elif leaf.type == "linear_gradient" and leaf.start is not None and leaf.end is not None:
        length = float(np.hypot((leaf.end.x - leaf.start.x) * bitmap_width, (leaf.end.y - leaf.start.y) * bitmap_height))
        segments = (leaf.gradient_midpoint_1, leaf.gradient_midpoint_2 - leaf.gradient_midpoint_1,
                    1.0 - leaf.gradient_midpoint_2)
        facts.update({
            "lengthPx": round(length, 2),
            "minSegmentPx": round(length * min(segments), 2),
            "fan": float(leaf.gradient_fan),
            "luma": bool(leaf.gradient_luma_enabled),
        })
    elif leaf.type == "path":
        facts.update({
            "featherPx": round(float(leaf.feather) * min(bitmap_width, bitmap_height), 2),
            "featherMode": leaf.feather_mode,
            "featherNodes": len(leaf.feather_nodes),
            "softness": float(leaf.feather_softness),
        })
    return facts


# The bitmap and the export's mask are each rounded to 8 bits, which alone can
# separate them by a level. The same rounding puts a level of bend into the
# flattest bitmap, so a measured bend of one level or less means "no bend, one
# level of rounding", and a larger one already contains the rounding.
ROUNDING_LEVELS = 1.0
# A mask is soft when everything known to separate the stretched bitmap from
# the exact mask adds up to no more than this many 255ths. The approved soft
# limit is 2 (PRD 4.2); 3 is the owner's working limit while he judges it on
# screen (October 1, 2026). On 300 random masks at two bitmap sizes
# (tests/performance/soft_mask_fuzz.py) an estimate of 3 or less never came
# with a true difference above 2.75, and one of 2.5 or less never above 2.2.
SOFT_ESTIMATE_LIMIT = 3.0
# How far, in bitmap pixels, the bitmap can sit from the frame it is stretched
# over when its placement is not known exactly (straighten, perspective).
CROP_MISALIGNMENT_PIXELS = 0.85
# The farthest a pixel centre can be from a brush point.
_PIXEL_MISS = 0.71
# A hard mark of radius r bitmap pixels under a wider feather was seen up to
# about 28 / r levels out in the fuzz (tests/performance/soft_mask_fuzz.py).
_MASS_LEVELS_PER_PIXEL_RADIUS = 30.0


def bitmap_frame_rect(
    source_width: int,
    source_height: int,
    bitmap_source_width: int,
    bitmap_source_height: int,
    geometry: GeometryAdjustments,
) -> tuple[float, float, float, float] | None:
    """Where a mask bitmap sits in the full-resolution output frame.

    The crop is rounded to whole pixels at whatever size it is applied, so a
    bitmap cropped at its own size does not cover exactly the frame the
    full-resolution crop does. Returns the bitmap's origin and size as
    fractions of that frame (x, y, width, height), for the renderer to stretch
    it into place. ``bitmap_source_*`` is the uncropped source at the bitmap's
    scale. ``None`` when the geometry resamples (straighten, perspective) and
    the placement is not known to the pixel.
    """
    if geometry_resample_stage(geometry) != "index":
        return None
    quarter = geometry.rotation in (90, 270)
    frame_width, frame_height = (source_height, source_width) if quarter else (source_width, source_height)
    small_width, small_height = (
        (bitmap_source_height, bitmap_source_width) if quarter else (bitmap_source_width, bitmap_source_height)
    )
    left, top, right, bottom = _crop_bounds(frame_width, frame_height, geometry)
    small_left, small_top, small_right, small_bottom = _crop_bounds(small_width, small_height, geometry)
    scale_x = frame_width / small_width
    scale_y = frame_height / small_height
    return (
        (small_left * scale_x - left) / (right - left),
        (small_top * scale_y - top) / (bottom - top),
        (small_right - small_left) * scale_x / (right - left),
        (small_bottom - small_top) * scale_y / (bottom - top),
    )


class SoftVerdict:
    __slots__ = ("soft", "estimate", "reason", "terms")

    def __init__(self, soft: bool, estimate: float, reason: str, terms: dict[str, float] | None = None) -> None:
        self.soft = soft
        self.estimate = estimate
        self.reason = reason
        self.terms = terms or {}


def bitmap_slope_levels(bitmap: np.ndarray) -> float:
    """The steepest step between neighbouring pixels of the bitmap, in 255ths."""
    if bitmap.shape[0] < 2 or bitmap.shape[1] < 2:
        return 255.0
    values = bitmap.astype(np.int16)
    across = np.abs(values[:, 1:] - values[:, :-1]).max(initial=0)
    down = np.abs(values[1:] - values[:-1]).max(initial=0)
    return float(max(across, down))


def brush_peak_deficit_levels(expression: MaskExpression, bitmap_width: int) -> float:
    """How far a feathered brush's bitmap can fall short of its painted peak.

    The feather rescales the whole mask to the strongest painted value. A
    bitmap only sees paint at its pixel centres, so a mark whose full-strength
    core is smaller than a pixel is seen weaker than it is, and the whole
    mask is scaled down by that much. In 255ths.
    """
    leaf = expression.leaf
    if leaf is None or leaf.type != "brush" or leaf.mask_feather <= 0.0:
        return 0.0
    candidates: list[tuple[float, float]] = []
    for stroke in leaf.strokes:
        if stroke.erase:
            continue
        ideal = min(stroke.opacity, stroke.flow)
        if ideal <= 0.0:
            continue
        pressures = [point.pressure for point in stroke.points]
        if len(pressures) > 1:
            pressures = [max(0.05, 0.5 * (first + second)) for first, second in zip(pressures, pressures[1:])]
        radius = stroke.radius * max(pressures) * bitmap_width
        core = radius * stroke.hardness
        band = max(radius - core, 1e-6)
        seen = max(0.0, 1.0 - max(0.0, _PIXEL_MISS - core) / band)
        achieved = min(stroke.opacity, stroke.flow * seen)
        candidates.append((ideal, 1.0 - achieved / ideal))
    if not candidates:
        return 0.0
    strongest = max(ideal for ideal, _deficit in candidates)
    # The peak is set by whichever of the strongest strokes is seen best.
    return 255.0 * strongest * min(deficit for ideal, deficit in candidates if ideal >= strongest * 0.98)


def brush_mass_error_levels(expression: MaskExpression, bitmap_width: int, bitmap_height: int) -> float:
    """How far a feathered brush's bitmap can misjudge a small hard mark.

    A bitmap sees a hard-edged mark as whole pixels, so it gets the mark's
    area wrong by a little; under a feather wider than the mark, the mark's
    whole contribution is wrong by that fraction. In 255ths.
    """
    from .local_adjustments import _painted_mask_feather_radius

    leaf = expression.leaf
    if leaf is None or leaf.type != "brush" or leaf.mask_feather <= 0.0:
        return 0.0
    sigma = min(2048.0, _painted_mask_feather_radius(leaf.mask_feather) * max(bitmap_width, bitmap_height))
    worst = 0.0
    for stroke in leaf.strokes:
        if stroke.erase:
            continue
        pressure = min(point.pressure for point in stroke.points)
        if len(stroke.points) > 1:
            pressure = max(0.05, pressure)
        radius = max(stroke.radius * pressure * bitmap_width, 1e-3)
        band = radius * (1.0 - stroke.hardness)
        edge = 1.0 if band < 1.0 else 1.0 / band
        spread = min(1.0, sigma / radius)
        worst = max(worst, _MASS_LEVELS_PER_PIXEL_RADIUS * edge * spread * min(stroke.opacity, stroke.flow) / radius)
    return worst


def bitmap_border_levels(bitmap: np.ndarray, rect: tuple[float, float, float, float] | None) -> float:
    """What the bitmap's outermost pixels cost at the edge of the frame.

    A stretched bitmap has nothing beyond its outermost pixel centres, so the
    strip of frame outside them repeats the edge value where the mask may
    still be changing. The strip is half a bitmap pixel wide, or a little more
    or less once a crop has been rounded. In 255ths.
    """
    height, width = bitmap.shape
    if height < 2 or width < 2:
        return 255.0
    origin_x, origin_y, extent_x, extent_y = rect or (0.0, 0.0, 1.0, 1.0)
    values = bitmap.astype(np.int16)
    # The frame's edges in bitmap pixels, measured from the bitmap's own edges.
    left = -origin_x / extent_x * width
    right = (1.0 - origin_x) / extent_x * width
    top = -origin_y / extent_y * height
    bottom = (1.0 - origin_y) / extent_y * height
    strips = (
        (max(0.0, 0.5 - left), np.abs(values[:, 1] - values[:, 0]).max(initial=0)),
        (max(0.0, right - (width - 0.5)), np.abs(values[:, -1] - values[:, -2]).max(initial=0)),
        (max(0.0, 0.5 - top), np.abs(values[1] - values[0]).max(initial=0)),
        (max(0.0, bottom - (height - 0.5)), np.abs(values[-1] - values[-2]).max(initial=0)),
    )
    return float(max(strip * step for strip, step in strips))


def soft_mask_verdict(
    expression: MaskExpression,
    bitmap: np.ndarray,
    bitmap_frame_width: int,
    bitmap_frame_height: int,
    *,
    rect: tuple[float, float, float, float] | None = (0.0, 0.0, 1.0, 1.0),
) -> SoftVerdict:
    """Whether ``bitmap`` may stand in for ``expression`` at every zoom.

    ``bitmap_frame_width`` and ``bitmap_frame_height`` are the uncropped
    source's size at the bitmap's scale. ``rect`` is where the renderer is told
    the bitmap sits in the frame (``bitmap_frame_rect``), or ``None`` when that
    is not known to the pixel.
    The conservative answer is "not soft": the caller then takes the exact path.
    """
    if expression.operator != "leaf" or expression.leaf is None:
        return SoftVerdict(False, float("inf"), "combination")
    leaf = expression.leaf
    if leaf.type not in {"brush", "linear_gradient", "path"}:
        return SoftVerdict(False, float("inf"), "follows-image-content")
    if leaf.type == "linear_gradient" and leaf.gradient_luma_enabled:
        return SoftVerdict(False, float("inf"), "follows-image-content")
    if leaf.type == "brush" and leaf.mask_shift_edge != 0.0:
        # Shift Edge cuts a new edge about a pixel wide at whatever size it is
        # compiled, so its bitmap is a different mask, not a smaller one.
        return SoftVerdict(False, float("inf"), "shift-edge")
    terms = {
        "bend": max(ROUNDING_LEVELS, bitmap_bend_levels(bitmap)),
        "misalignment": 0.0 if rect is not None else CROP_MISALIGNMENT_PIXELS * bitmap_slope_levels(bitmap),
        "border": bitmap_border_levels(bitmap, rect),
        "peak": brush_peak_deficit_levels(expression, bitmap_frame_width),
        "mass": brush_mass_error_levels(expression, bitmap_frame_width, bitmap_frame_height),
    }
    estimate = float(sum(terms.values()))
    soft = estimate <= SOFT_ESTIMATE_LIMIT
    reason = "soft" if soft else max(terms, key=lambda name: terms[name])
    return SoftVerdict(soft, round(estimate, 3), reason, {name: round(value, 3) for name, value in terms.items()})
