from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, wait
import json
import math
import os
from threading import Lock

import numpy as np

from .color import acescg_to_linear_srgb, linear_srgb_to_acescg
from .mask_work import checkpoint as mask_checkpoint, in_request_context as mask_in_request_context
from .finishing import apply_geometry
from .models import GeometryAdjustments, LocalAdjustment, LocalGrade, MaskExpression, MaskLeaf, MaskPoint, PreviewKind
from .detail import apply_detail, detail_is_neutral


ACESCG_LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
LINEAR_SRGB_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
SAMPLED_MASKS_ENABLED = os.getenv("HDR_FINISHER_ENABLE_SAMPLED_MASKS", "0") == "1"


def apply_local_stack(
    image: np.ndarray,
    fixed_source: np.ndarray,
    local_adjustments: list[LocalAdjustment],
    kind: PreviewKind,
    geometry: GeometryAdjustments,
    *,
    tile_size: int = 512,
    compiled_masks: dict[str, np.ndarray] | None = None,
    source_pixel_scale: float = 1.0,
) -> np.ndarray:
    """Apply ordered local corrections without allocating per-layer frames or masks."""
    active = [item for item in local_adjustments if item.enabled and item.opacity > 0.0]
    if not active:
        return image
    if image.shape[:2] != fixed_source.shape[:2]:
        raise ValueError("The fixed mask source and local-stage image must have matching geometry.")

    result = image.astype(np.float32, copy=True)
    height, width = result.shape[:2]
    if any(not detail_is_neutral((item.hdr_grade if kind == PreviewKind.HDR else item.sdr_grade).detail) for item in active):
        # Detail needs neighboring pixels. Processing the full frame preserves
        # continuous halos across what would otherwise be local-stack tiles.
        tile_size = max(height, width)
    runtime_masks = compiled_masks
    for local in active:
        if not _mask_needs_full_frame_evaluation(local.mask):
            continue
        if runtime_masks is None:
            runtime_masks = {}
        elif runtime_masks is compiled_masks:
            runtime_masks = dict(runtime_masks)
        if local.id not in runtime_masks:
            runtime_masks[local.id] = compile_spatial_preview_mask(fixed_source, local.mask, geometry)
    for top in range(0, height, tile_size):
        bottom = min(top + tile_size, height)
        for left in range(0, width, tile_size):
            right = min(left + tile_size, width)
            tile = result[top:bottom, left:right]
            reference_tile = fixed_source[top:bottom, left:right]
            source_x, source_y = source_coordinate_grid(
                width,
                height,
                left,
                top,
                right - left,
                bottom - top,
                geometry,
            )
            for local in active:
                grade = local.hdr_grade if kind == PreviewKind.HDR else local.sdr_grade
                if not grade.enabled:
                    continue
                compiled = runtime_masks.get(local.id) if runtime_masks else None
                if compiled is not None and compiled.shape == (height, width):
                    mask = compiled[top:bottom, left:right].astype(np.float32) / np.float32(255.0)
                    mask *= np.float32(mask_influence_opacity(local.mask))
                else:
                    mask = evaluate_mask(local.mask, reference_tile, source_x, source_y, width / max(height, 1))
                influence = np.clip(mask * np.float32(local.opacity), 0.0, 1.0)
                if not np.any(influence > 1e-6):
                    continue
                candidate = _apply_local_grade(
                    tile,
                    grade,
                    kind,
                    source_pixel_scale=source_pixel_scale,
                )
                tile[...] = tile + (candidate - tile) * influence[..., None]
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def _mask_needs_full_frame_evaluation(expression: MaskExpression) -> bool:
    if expression.operator == "leaf":
        return bool(
            expression.leaf
            and (
                (expression.leaf.type == "brush" and expression.leaf.mask_shift_edge != 0.0)
                or (expression.leaf.type in {"brush", "luminance_range"} and expression.leaf.mask_feather > 0.0)
            )
        )
    return any(_mask_needs_full_frame_evaluation(child) for child in expression.children)


def compile_preview_mask(
    fixed_source: np.ndarray,
    expression: MaskExpression,
    geometry: GeometryAdjustments,
) -> np.ndarray:
    """Compile one preview mask to an r8-equivalent array for cache reuse."""
    mask_checkpoint()
    height, width = fixed_source.shape[:2]
    source_x, source_y = source_coordinate_grid(width, height, 0, 0, width, height, geometry)
    mask = evaluate_mask(expression, fixed_source, source_x, source_y, width / max(height, 1))
    return np.rint(np.clip(mask, 0.0, 1.0) * 255.0).astype(np.uint8)


def mask_influence_opacity(expression: MaskExpression) -> float:
    """Return the redraw-only opacity for a simple leaf mask.

    Boolean expressions retain their existing per-leaf evaluation semantics and
    therefore return one here until the retained mask graph is generalized.
    """
    if expression.operator == "leaf" and expression.leaf is not None:
        return float(expression.leaf.mask_opacity)
    return 1.0


def spatial_mask_expression(expression: MaskExpression) -> MaskExpression:
    """Remove influence-only opacity from a simple mask's spatial identity."""
    if expression.operator != "leaf" or expression.leaf is None:
        return expression
    return expression.model_copy(
        update={"leaf": expression.leaf.model_copy(update={"mask_opacity": 1.0})},
        deep=True,
    )


def spatial_mask_signature(expression: MaskExpression) -> str:
    def render_payload(node: MaskExpression) -> dict[str, object]:
        payload = node.model_dump(mode="json")
        payload.pop("id", None)
        payload["children"] = [render_payload(child) for child in node.children]
        return payload

    return json.dumps(render_payload(spatial_mask_expression(expression)), separators=(",", ":"))


def compile_spatial_preview_mask(
    fixed_source: np.ndarray,
    expression: MaskExpression,
    geometry: GeometryAdjustments,
) -> np.ndarray:
    """Compile reusable spatial coverage without simple-leaf influence opacity."""
    return compile_preview_mask(fixed_source, spatial_mask_expression(expression), geometry)


def compile_geometry_fixed_mask(
    source: np.ndarray,
    expression: MaskExpression,
    geometry: GeometryAdjustments,
    *,
    spatial_only: bool = False,
) -> np.ndarray:
    """Compile a source-anchored mask through the exact image geometry stage.

    Local mask coordinates belong to the imported source.  Compiling directly
    in the geometry-fixed output requires an inverse mapping, which is easy for
    flips and quarter turns but is not equivalent to straightening: the image
    path expands the rotation and then crops to the largest valid rectangle.
    Build the mask in source space and run the same destructive geometry code
    instead so image pixels and local influence cannot diverge.
    """
    mask_checkpoint()
    mask_expression = spatial_mask_expression(expression) if spatial_only else expression
    source_mask = compile_preview_mask(source, mask_expression, GeometryAdjustments())
    mask_checkpoint()
    fixed = apply_geometry(source_mask[..., None], geometry)[..., 0]
    return np.rint(np.clip(fixed, 0.0, 255.0)).astype(np.uint8)


# A feathered luminance mask is a plain blur, so a region of it is exact once
# the blur's whole reach is evaluated around it. Beyond this reach the region
# would be most of the image anyway and the whole mask is compiled instead.
_REGION_MARGIN_LIMIT = 768


def mask_region_margin(expression: MaskExpression, long_edge: int) -> int | None:
    """How much surrounding mask a region needs to come out exact.

    ``None`` means the mask cannot be evaluated for a region at all: a brush
    feather rescales to the painted peak of the whole image and Shift Edge
    normalizes to it. Everything else depends only on a pixel or on a bounded
    neighbourhood of it. ``long_edge`` is the uncropped source's, at the size
    the mask is evaluated at.
    """
    if not expression.enabled:
        if expression.operator != "leaf" and expression.children:
            return mask_region_margin(expression.children[0], long_edge)
        return 0
    if expression.operator != "leaf":
        margins = [mask_region_margin(child, long_edge) for child in expression.children if child.enabled]
        return None if any(margin is None for margin in margins) else max(margins, default=0)
    leaf = expression.leaf
    if leaf is None:
        return 0
    if leaf.type == "brush":
        return None if leaf.mask_feather > 0.0 or leaf.mask_shift_edge != 0.0 else 0
    if leaf.type == "luminance_range":
        if leaf.mask_feather <= 0.0:
            return 0
        sigma = min(2048.0, _luminance_mask_feather_radius(leaf.mask_feather) * long_edge)
        if sigma < 0.25:
            return 0
        # Six box passes together reach about 4.3 sigma; the first and last
        # pixels of each pass repeat the block's edge, which must stay outside.
        margin = int(math.ceil(sigma * 5.0)) + 8
        return margin if margin <= _REGION_MARGIN_LIMIT else None
    if leaf.type in {"linear_gradient", "path"}:
        return 0
    return None


def compile_geometry_fixed_mask_region(
    source: np.ndarray,
    expression: MaskExpression,
    geometry: GeometryAdjustments,
    rect: tuple[int, int, int, int],
    *,
    spatial_only: bool = False,
) -> tuple[np.ndarray, tuple[int, int]] | None:
    """One rectangle of ``compile_geometry_fixed_mask`` without the rest of it.

    ``rect`` is ``(left, top, right, bottom)`` in the geometry-fixed output.
    Returns the block and the whole output's ``(width, height)``, or ``None``
    when this mask or this geometry needs the whole image (see
    ``mask_region_margin``; straighten and perspective resample the frame).
    The block holds the values the whole compile would, up to float rounding
    in the last place: the same source-space evaluation, at the same pixel
    centres, carried through the same quarter turns, flips and crop.
    """
    from .finishing import _crop_bounds, _oriented_view, geometry_resample_stage

    if geometry_resample_stage(geometry) != "index":
        return None
    mask_expression = spatial_mask_expression(expression) if spatial_only else expression
    source_height, source_width = source.shape[:2]
    margin = mask_region_margin(mask_expression, max(source_width, source_height))
    if margin is None:
        return None
    mask_checkpoint()
    quarter = geometry.rotation in (90, 270)
    oriented_width, oriented_height = (source_height, source_width) if quarter else (source_width, source_height)
    crop_left, crop_top, crop_right, crop_bottom = _crop_bounds(oriented_width, oriented_height, geometry)
    output_width, output_height = crop_right - crop_left, crop_bottom - crop_top
    left = min(max(0, int(rect[0])), output_width)
    top = min(max(0, int(rect[1])), output_height)
    right = min(max(left, int(rect[2])), output_width)
    bottom = min(max(top, int(rect[3])), output_height)
    if right <= left or bottom <= top:
        return np.zeros((0, 0), dtype=np.uint8), (output_width, output_height)
    # The rectangle in the oriented, uncropped frame, with the margin the
    # mask's neighbourhood needs. The frame continues past the crop.
    wide_left = max(0, crop_left + left - margin)
    wide_top = max(0, crop_top + top - margin)
    wide_right = min(oriented_width, crop_left + right + margin)
    wide_bottom = min(oriented_height, crop_top + bottom + margin)
    # Which source pixels that is: quarter turns and flips only move whole
    # pixels, so the rectangle is a rectangle of the source too.
    columns = np.broadcast_to(np.arange(source_width, dtype=np.int32), (source_height, source_width))
    rows = np.broadcast_to(np.arange(source_height, dtype=np.int32)[:, None], (source_height, source_width))
    source_columns = _oriented_view(columns, geometry)[wide_top:wide_bottom, wide_left:wide_right]
    source_rows = _oriented_view(rows, geometry)[wide_top:wide_bottom, wide_left:wide_right]
    source_left, source_right = int(source_columns.min()), int(source_columns.max()) + 1
    source_top, source_bottom = int(source_rows.min()), int(source_rows.max()) + 1
    source_x, source_y = source_coordinate_grid(
        source_width, source_height, source_left, source_top,
        source_right - source_left, source_bottom - source_top, GeometryAdjustments(),
    )
    mask = evaluate_mask(
        mask_expression,
        source[source_top:source_bottom, source_left:source_right],
        source_x,
        source_y,
        source_width / max(source_height, 1),
    )
    block = np.rint(np.clip(mask, 0.0, 1.0) * 255.0).astype(np.uint8)
    mask_checkpoint()
    oriented = _oriented_view(block, geometry)
    inner_left = crop_left + left - wide_left
    inner_top = crop_top + top - wide_top
    result = oriented[inner_top:inner_top + (bottom - top), inner_left:inner_left + (right - left)]
    return np.ascontiguousarray(result), (output_width, output_height)


def evaluate_mask(
    expression: MaskExpression,
    fixed_source_tile: np.ndarray,
    source_x: np.ndarray,
    source_y: np.ndarray,
    pixel_aspect: float = 1.0,
) -> np.ndarray:
    mask_checkpoint()
    if not expression.enabled:
        if expression.operator != "leaf" and expression.children:
            return evaluate_mask(
                expression.children[0],
                fixed_source_tile,
                source_x,
                source_y,
                pixel_aspect,
            )
        return np.zeros(source_x.shape, dtype=np.float32)
    brush_erase_attenuation: np.ndarray | None = None
    if expression.operator == "leaf":
        if expression.leaf is not None and expression.leaf.type == "brush":
            result, brush_erase_attenuation = _brush_masks(expression.leaf, source_x, source_y)
        else:
            result = _evaluate_leaf(expression.leaf, fixed_source_tile, source_x, source_y, pixel_aspect)
    else:
        active_children = [child for child in expression.children if child.enabled]
        children = [
            evaluate_mask(child, fixed_source_tile, source_x, source_y, pixel_aspect)
            for child in active_children
        ]
        if not children:
            result = np.zeros(source_x.shape, dtype=np.float32)
        else:
            result = children[0]
            for child in children[1:]:
                if expression.operator == "union":
                    result = np.maximum(result, child)
                elif expression.operator == "intersect":
                    result = result * child
                else:
                    result = result * (1.0 - child)
    if expression.operator == "leaf" and expression.leaf is not None and expression.leaf.type == "brush":
        leaf = expression.leaf
        if leaf.mask_shift_edge != 0.0 and np.any(result > 0.0):
            result = _shift_brush_mask(result, source_x, source_y, leaf.mask_shift_edge)
    if (
        expression.operator == "leaf"
        and expression.leaf is not None
        and expression.leaf.type in {"brush", "luminance_range"}
        and expression.leaf.mask_feather > 0.0
        and np.any(result > 0.0)
    ):
        result = _feather_mask(
            result,
            source_x,
            source_y,
            expression.leaf.mask_feather,
            luminance_range=expression.leaf.type == "luminance_range",
        )
    if expression.inverted:
        result = 1.0 - result
    if expression.operator == "leaf" and expression.leaf is not None:
        result *= np.float32(expression.leaf.mask_opacity)
    # Erase is the top operation for a brush mask. Applying its attenuation
    # after Shift Edge, Feather, Invert, and Mask Opacity lets it remove every
    # pixel visible in the finished mask, including generated coverage outside
    # the original paint footprint.
    if brush_erase_attenuation is not None:
        result *= brush_erase_attenuation
    return np.clip(result, 0.0, 1.0).astype(np.float32)


def source_coordinate_grid(
    output_width: int,
    output_height: int,
    left: int,
    top: int,
    width: int,
    height: int,
    geometry: GeometryAdjustments,
) -> tuple[np.ndarray, np.ndarray]:
    """Map output pixels back to normalized coordinates in the uncropped source."""
    x = (np.arange(left, left + width, dtype=np.float32) + 0.5) / max(output_width, 1)
    y = (np.arange(top, top + height, dtype=np.float32) + 0.5) / max(output_height, 1)
    u, v = np.meshgrid(x, y)
    crop = geometry.crop
    u = np.float32(crop.x) + u * np.float32(crop.width)
    v = np.float32(crop.y) + v * np.float32(crop.height)

    total_roll = float(geometry.straighten_angle) + float(geometry.perspective_rotate)
    if total_roll:
        angle = math.radians(-total_roll)
        cosine = np.float32(math.cos(angle))
        sine = np.float32(math.sin(angle))
        centered_x = u - 0.5
        centered_y = v - 0.5
        u = centered_x * cosine - centered_y * sine + 0.5
        v = centered_x * sine + centered_y * cosine + 0.5
    if geometry.flip_horizontal:
        u = 1.0 - u
    if geometry.flip_vertical:
        v = 1.0 - v
    if geometry.rotation == 90:
        u, v = v, 1.0 - u
    elif geometry.rotation == 180:
        u, v = 1.0 - u, 1.0 - v
    elif geometry.rotation == 270:
        u, v = 1.0 - v, u
    return u.astype(np.float32), v.astype(np.float32)


def _evaluate_leaf(
    leaf: MaskLeaf | None,
    fixed_source_tile: np.ndarray,
    source_x: np.ndarray,
    source_y: np.ndarray,
    pixel_aspect: float = 1.0,
) -> np.ndarray:
    if leaf is None:
        return np.zeros(source_x.shape, dtype=np.float32)
    if leaf.type == "linear_gradient":
        return _linear_gradient(leaf, fixed_source_tile, source_x, source_y)
    if leaf.type == "luminance_range":
        return _luminance_range(leaf, fixed_source_tile)
    if leaf.type == "brush":
        return _brush_mask(leaf, source_x, source_y)
    if leaf.type == "path":
        return _path_mask(leaf, source_x, source_y, pixel_aspect)
    if not SAMPLED_MASKS_ENABLED:
        return np.zeros(source_x.shape, dtype=np.float32)
    return _sampled_mask(leaf, fixed_source_tile, source_x, source_y)


def _linear_gradient(leaf: MaskLeaf, image: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    start = leaf.start
    end = leaf.end
    dx = np.float32(end.x - start.x)
    dy = np.float32(end.y - start.y)
    denominator = max(float(dx * dx + dy * dy), 1e-8)
    length = np.float32(math.sqrt(denominator))
    axis_position = ((x - start.x) * dx + (y - start.y) * dy) / denominator

    # Fan bends the zero-density boundary while keeping the full-density start
    # anchored. A bounded perpendicular coordinate keeps the control stable far
    # outside the image and allows both outward fans and inward pinches.
    perpendicular = ((x - start.x) * -dy + (y - start.y) * dx) / max(float(length), 1e-8)
    perpendicular = np.tanh(perpendicular / max(float(length), 1e-8))
    fan_scale = np.clip(
        1.0 + np.float32(leaf.gradient_fan * 0.8) * perpendicular * perpendicular,
        0.2,
        1.8,
    )
    position = axis_position / fan_scale

    midpoint_1 = float(leaf.gradient_midpoint_1)
    midpoint_2 = float(leaf.gradient_midpoint_2)
    xp = np.array([0.0, midpoint_1, midpoint_2, 1.0], dtype=np.float32)
    fp = np.array([1.0, 2.0 / 3.0, 1.0 / 3.0, 0.0], dtype=np.float32)
    spatial = np.interp(position, xp, fp, left=1.0, right=0.0).astype(np.float32)

    if leaf.gradient_luma_enabled:
        spatial *= _luminance_range(leaf, image)
    return np.clip(spatial, 0.0, 1.0).astype(np.float32)


def _luminance_range(leaf: MaskLeaf, image: np.ndarray) -> np.ndarray:
    # Not ``optimize=True``: that hands the sum to the BLAS library, whose last
    # digit depends on where a pixel sits in the array, so a region of the
    # picture and the whole picture could round to different mask levels.
    luma = np.einsum("...c,c->...", image[..., :3], ACESCG_LUMA, optimize=False)
    ev = np.log2(np.maximum(luma, np.float32(1e-8)) / np.float32(0.18))
    rise_width = max(leaf.full_start_ev - leaf.fade_in_start_ev, 1e-6)
    fall_width = max(leaf.fade_out_end_ev - leaf.full_end_ev, 1e-6)
    rise = np.clip((ev - leaf.fade_in_start_ev) / rise_width, 0.0, 1.0)
    fall = np.clip((leaf.fade_out_end_ev - ev) / fall_width, 0.0, 1.0)
    return np.minimum(rise, fall).astype(np.float32)


def sample_luminance_evs(
    image: np.ndarray,
    points: list[MaskPoint],
    *,
    patch_radius: int = 3,
    quantization_ev: float = 0.25,
) -> tuple[float, float, float, int]:
    """Return a low-precision robust EV interval for viewport picker points.

    Each point averages a small scene-linear neighborhood after rejecting
    median-absolute-deviation outliers. Path samples are then smoothed and
    trimmed again so isolated noise and HDR fireflies cannot dominate the
    selected range.
    """
    height, width = image.shape[:2]
    sampled: list[float] = []
    for point in points:
        column = int(round(np.clip(point.x, 0.0, 1.0) * max(width - 1, 0)))
        row = int(round(np.clip(point.y, 0.0, 1.0) * max(height - 1, 0)))
        left = max(0, column - patch_radius)
        right = min(width, column + patch_radius + 1)
        top = max(0, row - patch_radius)
        bottom = min(height, row + patch_radius + 1)
        patch = image[top:bottom, left:right, :3]
        luma = np.einsum("...c,c->...", patch, ACESCG_LUMA, optimize=True).reshape(-1)
        valid = luma[np.isfinite(luma) & (luma > 1e-8)]
        if valid.size == 0:
            sampled.append(-24.0)
            continue
        ev = np.log2(valid / np.float32(0.18))
        median = float(np.median(ev))
        mad = float(np.median(np.abs(ev - median)))
        cutoff = max(0.18, 3.0 * 1.4826 * mad)
        filtered = ev[np.abs(ev - median) <= cutoff]
        if filtered.size == 0:
            filtered = np.array([median], dtype=np.float32)
        sampled.append(float(np.mean(filtered, dtype=np.float64)))

    values = np.asarray(sampled, dtype=np.float32)
    if values.size >= 3:
        padded = np.pad(values, (1, 1), mode="edge")
        values = (
            padded[:-2] * np.float32(0.25)
            + padded[1:-1] * np.float32(0.5)
            + padded[2:] * np.float32(0.25)
        )
        median = float(np.median(values))
        mad = float(np.median(np.abs(values - median)))
        cutoff = max(0.35, 3.5 * 1.4826 * mad)
        retained = values[np.abs(values - median) <= cutoff]
        if retained.size:
            values = retained

    center = float(np.median(values))
    low = float(np.percentile(values, 5.0))
    high = float(np.percentile(values, 95.0))
    step = max(0.05, float(quantization_ev))
    center = round(center / step) * step
    if high - low < 0.5:
        low = center - 0.5
        high = center + 0.5
    else:
        low = math.floor((low - 0.25) / step) * step
        high = math.ceil((high + 0.25) / step) * step
    low = float(np.clip(low, -24.0, 24.0))
    high = float(np.clip(high, low, 24.0))
    return low, high, float(np.clip(center, low, high)), len(sampled)


# A brush raster this large is split into row bands on worker threads. Every
# pixel still gets the same float32 operations in the same order, so the mask
# is byte-identical to the single-threaded one.
# Below this size the bands are too small for threads to pay for themselves:
# a 6 MP raster measured about twice as slow threaded as on one thread.
_BRUSH_THREADED_PIXELS = 16_000_000
_BRUSH_WORKERS = max(1, min(8, (os.cpu_count() or 2) // 2))
_brush_pool: ThreadPoolExecutor | None = None
_brush_pool_lock = Lock()


def _brush_executor() -> ThreadPoolExecutor:
    global _brush_pool
    with _brush_pool_lock:
        if _brush_pool is None:
            _brush_pool = ThreadPoolExecutor(max_workers=_BRUSH_WORKERS, thread_name_prefix="brush-raster")
        return _brush_pool


def _brush_masks(leaf: MaskLeaf, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
    result = np.zeros(x.shape, dtype=np.float32)
    metric_x, metric_y, metric_transform, metric_origin = _brush_display_metric(x, y)

    def metric_point(point: MaskPoint) -> tuple[float, float]:
        transformed = metric_transform @ (
            np.array([point.x, point.y], dtype=np.float64) - metric_origin
        )
        return float(transformed[0]), float(transformed[1])

    prepared = []
    for stroke in leaf.strokes:
        mask_checkpoint()
        points = stroke.points
        shapes = []
        if len(points) == 1:
            point = points[0]
            point_x, point_y = metric_point(point)
            radius = stroke.radius * point.pressure
            rows, columns = _brush_shape_roi(
                metric_x,
                metric_y,
                point_x,
                point_y,
                point_x,
                point_y,
                radius,
            )
            shapes.append((rows, columns, point_x, point_y, point_x, point_y, radius))
        else:
            for first, second in zip(points[:-1], points[1:]):
                first_x, first_y = metric_point(first)
                second_x, second_y = metric_point(second)
                pressure = max(0.05, 0.5 * (first.pressure + second.pressure))
                radius = stroke.radius * pressure
                rows, columns = _brush_shape_roi(
                    metric_x,
                    metric_y,
                    first_x,
                    first_y,
                    second_x,
                    second_y,
                    radius,
                )
                shapes.append((rows, columns, first_x, first_y, second_x, second_y, radius))
        shapes = [
            shape for shape in shapes
            if shape[0].stop > shape[0].start and shape[1].stop > shape[1].start
        ]
        if not shapes:
            continue
        # Outside the union of the capsule bounds paint/erase strength is zero.
        # Keep stroke accumulation local too: a short mark must not allocate
        # and traverse several native-size float arrays for every stroke.
        rows = slice(min(shape[0].start for shape in shapes), max(shape[0].stop for shape in shapes))
        columns = slice(min(shape[1].start for shape in shapes), max(shape[1].stop for shape in shapes))
        prepared.append((stroke, len(points) == 1, shapes, rows, columns))

    erase_attenuation: np.ndarray | None = (
        np.ones(x.shape, dtype=np.float32) if any(item[0].erase for item in prepared) else None
    )

    def accumulate(top: int, bottom: int) -> None:
        """Apply every stroke, in order, to the rows ``top:bottom``."""
        erase_seen = False
        for stroke, single_point, shapes, stroke_rows, columns in prepared:
            mask_checkpoint()
            rows = slice(max(stroke_rows.start, top), min(stroke_rows.stop, bottom))
            if rows.stop <= rows.start:
                erase_seen = erase_seen or stroke.erase
                continue
            stroke_mask = np.zeros((rows.stop - rows.start, columns.stop - columns.start), dtype=np.float32)
            for all_shape_rows, shape_columns, x0, y0, x1, y1, radius in shapes:
                shape_rows = slice(max(all_shape_rows.start, top), min(all_shape_rows.stop, bottom))
                if shape_rows.stop <= shape_rows.start:
                    continue
                mask_checkpoint()
                local_rows = slice(shape_rows.start - rows.start, shape_rows.stop - rows.start)
                local_columns = slice(shape_columns.start - columns.start, shape_columns.stop - columns.start)
                if single_point:
                    segment = _soft_disc(
                        metric_x[shape_rows, shape_columns], metric_y[shape_rows, shape_columns],
                        x0, y0, radius, stroke.hardness,
                    )
                else:
                    segment = _soft_segment(
                        metric_x[shape_rows, shape_columns], metric_y[shape_rows, shape_columns],
                        x0, y0, x1, y1, radius, stroke.hardness,
                    )
                np.maximum(
                    stroke_mask[local_rows, local_columns], segment,
                    out=stroke_mask[local_rows, local_columns],
                )
            coverage = result[rows, columns]
            if stroke.erase:
                erase_seen = True
                erase_strength = np.minimum(
                    np.float32(stroke.opacity),
                    stroke_mask * np.float32(stroke.flow),
                )
                erase_attenuation[rows, columns] *= 1.0 - erase_strength
            else:
                # Repeated low-flow passes build coverage, while opacity is the
                # ceiling for this brush preset. A lower-opacity stroke must never
                # reduce coverage that was painted previously.
                paint_strength = np.minimum(
                    np.float32(stroke.opacity),
                    stroke_mask * np.float32(stroke.flow),
                )
                accumulated = np.minimum(
                    np.float32(stroke.opacity),
                    coverage + paint_strength,
                )
                np.maximum(coverage, accumulated, out=coverage)
                if erase_seen:
                    # Erase is retained as a final-stage attenuation so it can cut
                    # shifted, feathered, and inverted coverage. A later paint
                    # stroke must nevertheless be able to restore that attenuation
                    # in stroke order; otherwise an erased pixel is permanent.
                    restored = np.minimum(
                        np.float32(stroke.opacity),
                        erase_attenuation[rows, columns] + paint_strength,
                    )
                    attenuation = erase_attenuation[rows, columns]
                    np.maximum(attenuation, restored, out=attenuation)

    if not prepared:
        return result, erase_attenuation
    top = min(item[3].start for item in prepared)
    bottom = max(item[3].stop for item in prepared)
    _over_row_bands(accumulate, top, bottom, x.size)
    return result, erase_attenuation


def _over_row_bands(work, top: int, bottom: int, pixels: int) -> None:
    """Run ``work(top, bottom)`` over the rows, in threaded bands when large.

    Bands are disjoint row ranges, so no two workers write the same pixel.
    """
    band_count = min(_BRUSH_WORKERS * 4, bottom - top) if pixels >= _BRUSH_THREADED_PIXELS else 1
    if _BRUSH_WORKERS < 2 or band_count < 2:
        work(top, bottom)
        return
    edges = [top + (bottom - top) * index // band_count for index in range(band_count + 1)]
    run = mask_in_request_context(work)
    futures = [_brush_executor().submit(run, edges[index], edges[index + 1]) for index in range(band_count)]
    try:
        for future in futures:
            future.result()
    finally:
        for future in futures:
            future.cancel()
        wait(futures)


# A painted mask's feather is far wider than a pixel, so the blur itself is
# done on a grid of block averages and interpolated back. The strokes are
# still painted at full resolution: the feather rescales its result to the
# painted peak, which multiplies any error in painted area across the whole
# mask. The reduction keeps the feather at least this many coarse pixels wide,
# which holds the result within two of 255 mask levels of the full-resolution
# blur (owner decision, 2026-10-01).
_REDUCED_BLUR_MIN_SIGMA = 16.0
_REDUCED_BLUR_MAX_FACTOR = 32


def _reduced_blur_factor(mask: np.ndarray, sigma: float) -> int:
    """Block size for the reduced blur; 1 keeps the full-resolution blur."""
    factor = int(min(sigma / _REDUCED_BLUR_MIN_SIGMA, _REDUCED_BLUR_MAX_FACTOR))
    return factor if factor >= 2 and min(mask.shape) >= 2 * factor else 1


def _gaussian_blur_reduced(mask: np.ndarray, sigma: float, factor: int) -> np.ndarray:
    """Approximate ``_gaussian_blur_float`` through ``factor``-pixel block means.

    Two properties of the full blur decide how this is built:

    * The feather rescales the blur to the painted peak, so it has to match in
      proportion, not just in level: a small mark under a wide feather is
      amplified many times over. Each coarse pass is therefore a box of the
      exact fractional width that reproduces the full passes' spread.
    * Every full pass repeats the frame's outermost pixel as padding. A mark
      against the frame edge makes that pixel differ sharply from the block
      around it, so the value at the outermost pixel is carried through every
      pass alongside the block values instead of being inferred from them.
    """
    height, width = mask.shape
    passes = 6
    # Block averaging and the interpolation back add a little spread of their
    # own, which is taken out of the passes.
    full_variance = sum((box * box - 1) / 12.0 for box in _gaussian_box_widths(sigma, passes))
    own_variance = (1.0 - 1.0 / (factor * factor)) / 12.0 + 1.0 / 6.0
    half_width = math.sqrt(3.0 * max(full_variance / (factor * factor) - own_variance, 1e-6) / passes)

    def block_means(values: np.ndarray, axis: int) -> np.ndarray:
        length = values.shape[axis]
        means = np.add.reduceat(values, np.arange(0, length, factor), axis=axis, dtype=np.float64)
        means /= factor
        short = -length % factor
        if short:
            # The last block is narrower; average only the pixels it holds.
            last = [slice(None)] * values.ndim
            last[axis] = -1
            means[tuple(last)] *= factor / (factor - short)
        return means

    def layout(length: int) -> tuple[np.ndarray, np.ndarray]:
        """Cell boundaries and sample positions along one axis, in block units.

        Samples are the first pixel, every block center, and the last pixel.
        Cells are the blocks, with a padding cell outside each end.
        """
        count = -(-length // factor)
        boundaries = np.minimum(np.arange(count + 1, dtype=np.float64), length / factor) - 0.5
        centers = 0.5 * (boundaries[:-1] + boundaries[1:])
        first, last = 0.5 / factor - 0.5, (length - 0.5) / factor - 0.5
        padding = half_width + 2.0
        edges = np.concatenate(([boundaries[0] - padding], boundaries, [boundaries[-1] + padding]))
        return edges, np.concatenate(([first], centers, [last]))

    def box_pass(samples: np.ndarray, edges: np.ndarray, positions: np.ndarray) -> np.ndarray:
        """Average each row over a box centered on every sample position.

        ``samples`` holds the first-pixel value, the block values and the
        last-pixel value. The row is the block values as a step function,
        continued outward by the first and last pixel values.
        """
        integral = np.zeros((samples.shape[0], samples.shape[1] + 1), dtype=np.float64)
        np.cumsum(samples * np.diff(edges), axis=1, out=integral[:, 1:])

        def up_to(points: np.ndarray) -> np.ndarray:
            cell = np.clip(np.searchsorted(edges, points, side="right") - 1, 0, samples.shape[1] - 1)
            return integral[:, cell] + (points - edges[cell]) * samples[:, cell]

        return (up_to(positions + half_width) - up_to(positions - half_width)) / (2.0 * half_width)

    mask_checkpoint()
    # The coarse grid is small; float64 keeps its sums exact enough that only
    # the approximation itself separates it from the full blur. The frame's
    # top and bottom pixel rows ride along through the horizontal passes: they
    # are what the first vertical pass pads with.
    column_edges, column_positions = layout(width)
    row_edges, row_positions = layout(height)
    rows = np.concatenate((mask[:1], block_means(mask, 0), mask[-1:]), axis=0, dtype=np.float64)
    coarse = np.concatenate((rows[:, :1], block_means(rows, 1), rows[:, -1:]), axis=1)
    for _ in range(passes):
        coarse = box_pass(coarse, column_edges, column_positions)
    coarse = np.ascontiguousarray(coarse.T)
    for _ in range(passes):
        coarse = box_pass(coarse, row_edges, row_positions)
    coarse = np.ascontiguousarray(coarse.T).astype(np.float32)

    def taps(length: int, positions: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        pixels = (np.arange(length, dtype=np.float64) + 0.5) / factor - 0.5
        lower = np.clip(np.searchsorted(positions, pixels, side="right") - 1, 0, len(positions) - 2)
        span = np.maximum(positions[lower + 1] - positions[lower], 1e-9)
        return lower, np.clip((pixels - positions[lower]) / span, 0.0, 1.0).astype(np.float32)

    left, across = taps(width, column_positions)
    wide = coarse[:, left]
    wide += (coarse[:, left + 1] - wide) * across
    top, down = taps(height, row_positions)
    result = np.empty((height, width), dtype=np.float32)
    for start in range(0, height, 256):
        mask_checkpoint()
        band = slice(start, start + 256)
        rows = wide[top[band]]
        rows += (wide[top[band] + 1] - rows) * down[band, None]
        result[band] = rows
    return np.clip(result, 0.0, 1.0, out=result)


def _brush_display_metric(
    x: np.ndarray,
    y: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Map source coordinates to the browser brush's square-pixel metric.

    Brush radius is expressed as a fraction of image width. Normalized source Y
    is not in that metric on a non-square image, so measuring directly in X/Y
    makes the authoritative mask change shape after the live Canvas stroke is
    committed. The source grid is affine; its inverse maps both pixels and
    stored points back to display pixels, which we scale by one horizontal-pixel
    source step to retain the existing radius units.
    """
    if x.ndim != 2 or y.ndim != 2 or x.shape != y.shape or min(x.shape) < 2:
        identity = np.eye(2, dtype=np.float64)
        origin = np.zeros(2, dtype=np.float64)
        return x, y, identity, origin

    origin = np.array([x[0, 0], y[0, 0]], dtype=np.float64)
    basis = np.array(
        [
            [x[0, 1] - x[0, 0], x[1, 0] - x[0, 0]],
            [y[0, 1] - y[0, 0], y[1, 0] - y[0, 0]],
        ],
        dtype=np.float64,
    )
    determinant = float(np.linalg.det(basis))
    if abs(determinant) < 1e-12:
        identity = np.eye(2, dtype=np.float64)
        return x, y, identity, np.zeros(2, dtype=np.float64)

    horizontal_step = float(np.linalg.norm(basis[:, 0]))
    transform = np.linalg.inv(basis) * horizontal_step
    metric_x = np.empty(x.shape, dtype=np.float32)
    metric_y = np.empty(x.shape, dtype=np.float32)

    def convert(top: int, bottom: int) -> None:
        # A few rows at a time: the float64 intermediates of a native frame
        # are several hundred megabytes each when taken whole.
        for start in range(top, bottom, 64):
            rows = slice(start, min(start + 64, bottom))
            delta_x = x[rows].astype(np.float64, copy=False) - origin[0]
            delta_y = y[rows].astype(np.float64, copy=False) - origin[1]
            metric_x[rows] = transform[0, 0] * delta_x + transform[0, 1] * delta_y
            metric_y[rows] = transform[1, 0] * delta_x + transform[1, 1] * delta_y

    _over_row_bands(convert, 0, x.shape[0], x.size)
    return metric_x, metric_y, transform, origin


def _brush_mask(leaf: MaskLeaf, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    result, erase_attenuation = _brush_masks(leaf, x, y)
    if erase_attenuation is not None:
        result *= erase_attenuation
    return result


def _feather_mask(
    mask: np.ndarray,
    x: np.ndarray,
    y: np.ndarray,
    value: float,
    *,
    luminance_range: bool = False,
) -> np.ndarray:
    radius = _luminance_mask_feather_radius(value) if luminance_range else _painted_mask_feather_radius(value)
    pixel_radii = _mask_radii_pixels(x, y, radius)
    if max(pixel_radii) < 0.25:
        return mask
    # A luminance mask carries image detail down to the pixel and its feather
    # is narrow; only painted masks take the reduced blur.
    factor = 1 if luminance_range else _reduced_blur_factor(mask, pixel_radii[0])
    if factor >= 2:
        blurred = _gaussian_blur_reduced(mask, pixel_radii[0], factor)
    else:
        blurred = _gaussian_blur_float(mask, pixel_radii)
    if luminance_range:
        # A luma feather is a plain blur of what the range selects (owner
        # decision, 2026-09-25): a large area keeps full strength with a soft
        # edge, and a feature thinner than the feather spreads and weakens by
        # the same rule everywhere. It used to be rescaled so its strongest
        # point was full strength, which tied every thin highlight to whatever
        # else in the image was selected and made the export several times
        # stronger than the preview, which never rescaled.
        return blurred.astype(np.float32, copy=False)
    # A painted mark keeps its Density: normalize the blurred alpha back to the
    # painted peak so a small mark feathered heavily stays as strong.
    source_peak = float(np.max(mask))
    blurred_peak = float(np.max(blurred))
    if source_peak <= 0.0 or blurred_peak <= 0.0:
        return np.zeros_like(mask, dtype=np.float32)
    return np.clip(blurred * np.float32(source_peak / blurred_peak), 0.0, source_peak).astype(np.float32)


def _shift_brush_mask(mask: np.ndarray, x: np.ndarray, y: np.ndarray, radius: float) -> np.ndarray:
    """Move a painted mask edge without coupling the move to feather softness."""
    pixel_radii = _mask_radii_pixels(x, y, abs(radius))
    if max(pixel_radii) < 0.25:
        return mask
    source_peak = float(np.max(mask))
    if source_peak <= 0.0:
        return np.zeros_like(mask, dtype=np.float32)
    # Shift Edge changes mask geometry, not painted Density. Normalize before
    # thresholding so a 35% mask contracts by the same distance as a 100% mask,
    # then restore its original peak.
    normalized = mask / np.float32(source_peak)
    blurred = _gaussian_blur_float(normalized, pixel_radii)
    # A one-sigma threshold moves the 50% contour by approximately the requested
    # radius while retaining the source contour's rounded geometry. The narrow
    # smoothstep avoids a quantized edge in the r8 mask cache.
    threshold = np.float32(0.158655 if radius > 0.0 else 0.841345)
    half_band = np.float32(0.035)
    shifted = np.clip((blurred - (threshold - half_band)) / (half_band * 2.0), 0.0, 1.0)
    shifted = shifted * shifted * (np.float32(3.0) - np.float32(2.0) * shifted)
    shifted *= np.float32(source_peak)
    if radius > 0.0:
        return np.maximum(mask, shifted).astype(np.float32)
    return np.minimum(mask, shifted).astype(np.float32)


def _gaussian_blur_float(
    mask: np.ndarray,
    sigma: float | tuple[float, float],
    passes: int = 6,
) -> np.ndarray:
    """Blur mask alpha without the banding of Pillow's 8-bit large-radius path.

    A sequence of float32 box filters converges on a Gaussian while retaining
    sub-byte values between passes. That precision matters when a contracted
    mark is feathered across a large area: quantizing the low blurred peak to
    uint8 before normalization can leave only a handful of visible plateaus.
    """
    sigma_x, sigma_y = (sigma, sigma) if isinstance(sigma, (int, float)) else sigma
    if max(sigma_x, sigma_y) < 0.25:
        return mask.astype(np.float32, copy=False)
    result = mask.astype(np.float32, copy=True)
    for width in _gaussian_box_widths(float(sigma_x), passes):
        radius = max(0, (width - 1) // 2)
        if radius:
            result = _box_blur_axis(result, radius, axis=1)
    vertical_widths = _gaussian_box_widths(float(sigma_y), passes)
    # Keep all vertical passes contiguous in the same orientation. Previously
    # each pass gathered and scattered every strip independently. Transposing
    # once preserves each column's prefix-sum order and float32 rounding.
    if any(width > 1 for width in vertical_widths):
        mask_checkpoint()
        result = np.ascontiguousarray(result.T)
    for width in vertical_widths:
        radius = max(0, (width - 1) // 2)
        if radius:
            result = _box_blur_axis(result, radius, axis=1)
    if any(width > 1 for width in vertical_widths):
        mask_checkpoint()
        result = np.ascontiguousarray(result.T)
    return np.clip(result, 0.0, 1.0).astype(np.float32, copy=False)


def _gaussian_box_widths(sigma: float, passes: int) -> list[int]:
    """Return odd box widths whose combined variance approximates sigma."""
    count = max(1, int(passes))
    ideal = math.sqrt(12.0 * sigma * sigma / count + 1.0)
    lower = int(math.floor(ideal))
    if lower % 2 == 0:
        lower -= 1
    lower = max(1, lower)
    upper = lower + 2
    numerator = 12.0 * sigma * sigma - count * lower * lower - 4 * count * lower - 3 * count
    lower_count = int(round(numerator / (-4 * lower - 4)))
    lower_count = min(count, max(0, lower_count))
    return [lower] * lower_count + [upper] * (count - lower_count)


def _box_blur_axis(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    """Apply an exact box pass with bounded prefix-sum scratch arrays.

    Rows (horizontal) or columns (vertical) are independent. Splitting the
    other axis preserves each prefix sum's order and float32 rounding, while
    avoiding native-frame padding, cumulative and concatenation copies.
    """
    other_axis = 1 - axis
    extended_length = values.shape[axis] + 2 * radius + 1
    strip_size = max(1, min(512, (64 * 1024 * 1024) // (16 * extended_length)))
    result = np.empty(values.shape, dtype=np.float32)
    for start in range(0, values.shape[other_axis], strip_size):
        mask_checkpoint()
        region = [slice(None)] * 2
        region[other_axis] = slice(start, start + strip_size)
        strip = values[tuple(region)]
        if axis == 0:
            # Prefix sums along contiguous rows avoid a native-width stride
            # for every addition in the vertical pass.
            result[tuple(region)] = _box_blur_strip(np.ascontiguousarray(strip.T), radius, 1).T
        else:
            result[tuple(region)] = _box_blur_strip(strip, radius, axis)
    return result


def _box_blur_strip(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    padding = [(0, 0)] * values.ndim
    padding[axis] = (radius, radius)
    padded = np.pad(values, padding, mode="edge")
    cumulative_shape = list(padded.shape)
    cumulative_shape[axis] += 1
    cumulative = np.empty(cumulative_shape, dtype=np.float32)
    first = [slice(None)] * values.ndim
    first[axis] = 0
    cumulative[tuple(first)] = 0.0
    rest = [slice(None)] * values.ndim
    rest[axis] = slice(1, None)
    np.cumsum(padded, axis=axis, dtype=np.float32, out=cumulative[tuple(rest)])
    width = radius * 2 + 1
    after = [slice(None)] * values.ndim
    before = [slice(None)] * values.ndim
    after[axis] = slice(width, None)
    before[axis] = slice(None, -width)
    result = np.subtract(cumulative[tuple(after)], cumulative[tuple(before)])
    result /= np.float32(width)
    return result


def _mask_radii_pixels(x: np.ndarray, y: np.ndarray, radius: float) -> tuple[float, float]:
    """Turn a mask radius (a fraction of the source's long edge) into pixels.

    The grid holds source coordinates normalized per axis, so one pixel is
    1/width across and 1/height down. A radius is a distance, so it is taken
    against the long edge on both axes and the blur is round. Dividing each
    axis by its own step made it 1.5 times wider than tall on a 3:2 image.
    """
    x_step = 0.0
    y_step = 0.0
    if x.shape[1] > 1:
        x_step = float(math.hypot(x[0, 1] - x[0, 0], y[0, 1] - y[0, 0]))
    if x.shape[0] > 1:
        y_step = float(math.hypot(x[1, 0] - x[0, 0], y[1, 0] - y[0, 0]))
    fallback = next((step for step in (x_step, y_step) if step > 1e-12), 1.0)
    x_step = x_step if x_step > 1e-12 else fallback
    y_step = y_step if y_step > 1e-12 else fallback
    # The smaller normalized step belongs to the long edge.
    pixels = min(2048.0, max(0.0, radius / min(x_step, y_step)))
    return (pixels, pixels)


def _painted_mask_feather_radius(value: float) -> float:
    """Map Brush whole-mask feather to its source-space blur radius."""
    amount = min(1.0, max(0.0, float(value) / 0.05))
    return 0.18 * amount**0.75


def _luminance_mask_feather_radius(value: float) -> float:
    """Give Luma a linear, half-strength response with a controllable low end."""
    amount = min(1.0, max(0.0, float(value) / 0.05))
    return 0.09 * amount


def _brush_shape_roi(
    x: np.ndarray,
    y: np.ndarray,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    radius: float,
) -> tuple[slice, slice]:
    """Return a conservative pixel ROI for a source-space brush capsule.

    Source-coordinate grids are affine for crop, flip, straighten, and quarter
    rotation. Inverting that affine map avoids evaluating every brush segment
    against every pixel in the preview frame.
    """
    height, width = x.shape
    if height < 2 or width < 2:
        return slice(0, height), slice(0, width)

    origin = np.array([x[0, 0], y[0, 0]], dtype=np.float64)
    transform = np.array(
        [
            [x[0, 1] - x[0, 0], x[1, 0] - x[0, 0]],
            [y[0, 1] - y[0, 0], y[1, 0] - y[0, 0]],
        ],
        dtype=np.float64,
    )
    determinant = float(np.linalg.det(transform))
    if abs(determinant) < 1e-12:
        return slice(0, height), slice(0, width)

    inverse = np.linalg.inv(transform)
    minimum_x = min(x0, x1) - radius
    maximum_x = max(x0, x1) + radius
    minimum_y = min(y0, y1) - radius
    maximum_y = max(y0, y1) + radius
    corners = np.array(
        [
            [minimum_x, minimum_y],
            [minimum_x, maximum_y],
            [maximum_x, minimum_y],
            [maximum_x, maximum_y],
        ],
        dtype=np.float64,
    )
    pixel_coordinates = (inverse @ (corners - origin).T).T
    columns = pixel_coordinates[:, 0]
    rows = pixel_coordinates[:, 1]
    left = max(0, int(math.floor(float(np.min(columns)))) - 1)
    right = min(width, int(math.ceil(float(np.max(columns)))) + 2)
    top = max(0, int(math.floor(float(np.min(rows)))) - 1)
    bottom = min(height, int(math.ceil(float(np.max(rows)))) + 2)
    return slice(top, bottom), slice(left, right)


def _soft_disc(
    x: np.ndarray, y: np.ndarray, center_x: float, center_y: float, radius: float, hardness: float
) -> np.ndarray:
    distance = np.sqrt((x - center_x) ** 2 + (y - center_y) ** 2)
    inner = radius * hardness
    return 1.0 - np.clip((distance - inner) / max(radius - inner, 1e-6), 0.0, 1.0)


def _soft_segment(
    x: np.ndarray,
    y: np.ndarray,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    radius: float,
    hardness: float,
) -> np.ndarray:
    dx = np.float32(x1 - x0)
    dy = np.float32(y1 - y0)
    denominator = max(float(dx * dx + dy * dy), 1e-8)
    projection = np.clip(((x - x0) * dx + (y - y0) * dy) / denominator, 0.0, 1.0)
    closest_x = np.float32(x0) + projection * dx
    closest_y = np.float32(y0) + projection * dy
    return _soft_disc(x, y, closest_x, closest_y, radius, hardness)


def _path_mask(leaf: MaskLeaf, x: np.ndarray, y: np.ndarray, pixel_aspect: float = 1.0) -> np.ndarray:
    nodes = _flatten_path(leaf)
    outer: list[tuple[float, float]] | None = None
    if (
        leaf.feather_mode == "outer_boundary"
        and leaf.feather_nodes
        and len(leaf.nodes) == len(leaf.feather_nodes)
    ):
        # Corresponding Path and Feather nodes describe the two ends of the
        # same falloff band. Flatten them with the same t values per segment.
        # Flattening independently can give a smooth side twelve samples while
        # its sharp counterpart gets one; resampling the complete perimeter
        # then pairs unrelated segments and collapses parts of the band.
        nodes, outer = _flatten_corresponding_path_nodes(leaf.nodes, leaf.feather_nodes)
    inside = _points_inside_polygon(x, y, nodes)
    if leaf.feather_mode != "outer_boundary":
        if leaf.feather <= 0.0:
            return inside.astype(np.float32)
        edge_distance = _distance_to_polygon(x, y, nodes, pixel_aspect)
        feather = np.clip(edge_distance / max(leaf.feather, 1e-6), 0.0, 1.0)
        return np.where(inside, 0.5 + 0.5 * feather, 0.5 - 0.5 * feather).astype(np.float32)

    if not leaf.feather_nodes and leaf.feather <= 0.0:
        return inside.astype(np.float32)
    if outer is None and leaf.feather_nodes:
        outer = _flatten_path_nodes(leaf.feather_nodes)
    transition = _additive_outer_path_feather(
        x,
        y,
        nodes,
        outer,
        float(leaf.feather),
        float(leaf.feather_softness),
        pixel_aspect,
    )
    return np.where(inside, 1.0, transition).astype(np.float32)


def _resample_closed_path(vertices: list[tuple[float, float]], count: int) -> list[tuple[float, float]]:
    if not vertices or count <= 0:
        return []
    points = np.asarray(vertices, dtype=np.float64)
    following = np.roll(points, -1, axis=0)
    lengths = np.linalg.norm(following - points, axis=1)
    perimeter = float(np.sum(lengths))
    if perimeter <= 1e-12:
        return [tuple(map(float, points[0]))] * count
    cumulative = np.concatenate(([0.0], np.cumsum(lengths)))
    samples: list[tuple[float, float]] = []
    for distance in np.linspace(0.0, perimeter, count, endpoint=False):
        index = min(int(np.searchsorted(cumulative, distance, side="right") - 1), len(points) - 1)
        fraction = (distance - cumulative[index]) / max(float(lengths[index]), 1e-12)
        point = points[index] + (following[index] - points[index]) * fraction
        samples.append((float(point[0]), float(point[1])))
    return samples


def _additive_outer_path_feather(
    x: np.ndarray,
    y: np.ndarray,
    inner: list[tuple[float, float]],
    outer: list[tuple[float, float]] | None,
    uniform_width: float,
    softness: float,
    pixel_aspect: float,
) -> np.ndarray:
    """Merge local outward feather bands with an adjustable falloff profile."""
    if len(inner) < 3:
        return np.zeros(x.shape, dtype=np.float32)
    aspect = max(float(pixel_aspect), 1e-6)
    scale_x = np.float32(max(aspect, 1.0))
    scale_y = np.float32(max(1.0 / aspect, 1.0))
    inner_points = np.asarray([(px * scale_x, py * scale_y) for px, py in inner], dtype=np.float32)
    outer_points = None
    if outer:
        sampled = outer if len(outer) == len(inner) else _resample_closed_path(outer, len(inner))
        outer_points = np.asarray([(px * scale_x, py * scale_y) for px, py in sampled], dtype=np.float32)
    signed_area = np.sum(
        inner_points[:, 0] * np.roll(inner_points[:, 1], -1)
        - np.roll(inner_points[:, 0], -1) * inner_points[:, 1]
    )
    orientation = np.float32(1.0 if signed_area >= 0.0 else -1.0)
    coverage = np.zeros(x.shape, dtype=np.float32)
    for index, first in enumerate(inner_points):
        second = inner_points[(index + 1) % len(inner_points)]
        dx = np.float32(second[0] - first[0])
        dy = np.float32(second[1] - first[1])
        length = max(float(math.hypot(float(dx), float(dy))), 1e-8)
        denominator = max(float(dx * dx + dy * dy), 1e-12)
        if outer_points is None:
            width_first = width_second = max(uniform_width, 1e-6)
        else:
            normal_x = orientation * dy / np.float32(length)
            normal_y = orientation * -dx / np.float32(length)
            outer_first = outer_points[index]
            outer_second = outer_points[(index + 1) % len(outer_points)]
            width_first = max(float((outer_first[0] - first[0]) * normal_x + (outer_first[1] - first[1]) * normal_y), 1e-6)
            width_second = max(float((outer_second[0] - second[0]) * normal_x + (outer_second[1] - second[1]) * normal_y), 1e-6)
        source_first = inner[index]
        source_second = inner[(index + 1) % len(inner)]
        rows, columns = _brush_shape_roi(
            x,
            y,
            source_first[0],
            source_first[1],
            source_second[0],
            source_second[1],
            max(width_first, width_second),
        )
        region_x = x[rows, columns] * scale_x
        region_y = y[rows, columns] * scale_y
        projection = np.clip(((region_x - first[0]) * dx + (region_y - first[1]) * dy) / denominator, 0.0, 1.0)
        closest_x = first[0] + projection * dx
        closest_y = first[1] + projection * dy
        distance = np.sqrt((region_x - closest_x) ** 2 + (region_y - closest_y) ** 2)
        width = np.float32(width_first) + projection * np.float32(width_second - width_first)
        normalized_distance = distance / np.maximum(width, np.float32(1e-6))
        active = normalized_distance <= 1.0
        compact = np.clip(1.0 - normalized_distance, 0.0, 1.0)
        compact = compact * compact * (3.0 - 2.0 * compact)
        # The soft profile is nearly linear through the broad transition, with
        # short quadratic eases at both ends.  That lowers peak falloff slope
        # by roughly a quarter versus smoothstep while still meeting the Path
        # and editable outer guide with no visible seam.
        ease = np.float32(0.1)
        maximum_slope = np.float32(1.0) / (np.float32(1.0) - ease)
        soft = np.where(
            normalized_distance < ease,
            np.float32(1.0) - maximum_slope * normalized_distance * normalized_distance / (np.float32(2.0) * ease),
            np.where(
                normalized_distance > np.float32(1.0) - ease,
                maximum_slope * (np.float32(1.0) - normalized_distance) ** 2 / (np.float32(2.0) * ease),
                np.float32(1.0) - maximum_slope * (normalized_distance - ease / np.float32(2.0)),
            ),
        )
        soft = np.where(active, np.clip(soft, 0.0, 1.0), 0.0)
        profile_mix = np.float32(np.clip(softness, 0.0, 1.0))
        contribution = compact + profile_mix * (soft - compact)
        coverage[rows, columns] = np.maximum(coverage[rows, columns], contribution.astype(np.float32))
    return coverage.astype(np.float32)


def _points_inside_polygon(
    x: np.ndarray,
    y: np.ndarray,
    vertices: list[tuple[float, float]],
) -> np.ndarray:
    inside = np.zeros(x.shape, dtype=bool)
    for first, second in zip(vertices, vertices[1:] + vertices[:1]):
        crosses = (first[1] > y) != (second[1] > y)
        edge_x = (second[0] - first[0]) * (y - first[1]) / (second[1] - first[1] + 1e-12) + first[0]
        inside ^= crosses & (x < edge_x)
    return inside


def _distance_to_polygon(
    x: np.ndarray,
    y: np.ndarray,
    vertices: list[tuple[float, float]],
    pixel_aspect: float,
) -> np.ndarray:
    edge_distance = np.full(x.shape, np.inf, dtype=np.float32)
    aspect = max(float(pixel_aspect), 1e-6)
    scale_x = np.float32(max(aspect, 1.0))
    scale_y = np.float32(max(1.0 / aspect, 1.0))
    px = x * scale_x
    py = y * scale_y
    for first, second in zip(vertices, vertices[1:] + vertices[:1]):
        x0 = np.float32(first[0]) * scale_x
        y0 = np.float32(first[1]) * scale_y
        dx = np.float32(second[0] - first[0]) * scale_x
        dy = np.float32(second[1] - first[1]) * scale_y
        denominator = max(float(dx * dx + dy * dy), 1e-12)
        projection = np.clip(((px - x0) * dx + (py - y0) * dy) / denominator, 0.0, 1.0)
        distance = np.sqrt((px - (x0 + projection * dx)) ** 2 + (py - (y0 + projection * dy)) ** 2)
        edge_distance = np.minimum(edge_distance, distance.astype(np.float32))
    return edge_distance


def _offset_polygon(
    vertices: list[tuple[float, float]],
    amount: float,
    pixel_aspect: float,
) -> list[tuple[float, float]]:
    """Build a stable miter-limited parallel polygon in display-correct space."""
    if amount <= 0.0:
        return list(vertices)
    aspect = max(float(pixel_aspect), 1e-6)
    scale_x = max(aspect, 1.0)
    scale_y = max(1.0 / aspect, 1.0)
    points = np.asarray([(vx * scale_x, vy * scale_y) for vx, vy in vertices], dtype=np.float64)
    area = 0.5 * float(
        np.sum(points[:, 0] * np.roll(points[:, 1], -1) - np.roll(points[:, 0], -1) * points[:, 1])
    )
    orientation = 1.0 if area >= 0.0 else -1.0
    result: list[tuple[float, float]] = []
    for index, point in enumerate(points):
        previous = points[(index - 1) % len(points)]
        following = points[(index + 1) % len(points)]
        before = point - previous
        after = following - point
        before /= max(float(np.linalg.norm(before)), 1e-12)
        after /= max(float(np.linalg.norm(after)), 1e-12)
        before_normal = orientation * np.array([before[1], -before[0]], dtype=np.float64)
        after_normal = orientation * np.array([after[1], -after[0]], dtype=np.float64)
        miter = before_normal + after_normal
        norm = float(np.linalg.norm(miter))
        if norm <= 1e-8:
            miter = after_normal
        else:
            miter /= norm
        projection = max(float(np.dot(miter, after_normal)), 0.25)
        distance = min(float(amount) / projection, float(amount) * 4.0)
        shifted = point + miter * distance
        result.append((float(shifted[0] / scale_x), float(shifted[1] / scale_y)))
    return result


def _flatten_path(leaf: MaskLeaf, steps: int = 12) -> list[tuple[float, float]]:
    return _flatten_path_nodes(leaf.nodes, steps)


def _path_segment_is_curved(first: object, second: object) -> bool:
    return any(
        getattr(node, f"{handle}_{axis}") is not None
        and getattr(node, f"{handle}_{axis}") != getattr(node, axis)
        for node, handle in ((first, "out"), (second, "in"))
        for axis in ("x", "y")
    )


def _flatten_path_segment(first: object, second: object, sample_count: int) -> list[tuple[float, float]]:
    p0 = np.array([first.x, first.y], dtype=np.float32)
    p1 = np.array(
        [first.out_x if first.out_x is not None else first.x, first.out_y if first.out_y is not None else first.y],
        dtype=np.float32,
    )
    p2 = np.array(
        [second.in_x if second.in_x is not None else second.x, second.in_y if second.in_y is not None else second.y],
        dtype=np.float32,
    )
    p3 = np.array([second.x, second.y], dtype=np.float32)
    vertices: list[tuple[float, float]] = []
    for index in range(sample_count):
        t = np.float32(index / sample_count)
        point = (
            ((1.0 - t) ** 3) * p0
            + 3.0 * ((1.0 - t) ** 2) * t * p1
            + 3.0 * (1.0 - t) * (t**2) * p2
            + (t**3) * p3
        )
        vertices.append((float(point[0]), float(point[1])))
    return vertices


def _flatten_corresponding_path_nodes(
    inner_nodes: list, outer_nodes: list, steps: int = 12
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    inner_vertices: list[tuple[float, float]] = []
    outer_vertices: list[tuple[float, float]] = []
    for index, inner_first in enumerate(inner_nodes):
        inner_second = inner_nodes[(index + 1) % len(inner_nodes)]
        outer_first = outer_nodes[index]
        outer_second = outer_nodes[(index + 1) % len(outer_nodes)]
        sample_count = steps if (
            _path_segment_is_curved(inner_first, inner_second)
            or _path_segment_is_curved(outer_first, outer_second)
        ) else 1
        inner_vertices.extend(_flatten_path_segment(inner_first, inner_second, sample_count))
        outer_vertices.extend(_flatten_path_segment(outer_first, outer_second, sample_count))
    return inner_vertices, outer_vertices


def _flatten_path_nodes(nodes: list, steps: int = 12) -> list[tuple[float, float]]:
    vertices: list[tuple[float, float]] = []
    for first, second in zip(nodes, nodes[1:] + nodes[:1]):
        sample_count = steps if _path_segment_is_curved(first, second) else 1
        vertices.extend(_flatten_path_segment(first, second, sample_count))
    return vertices


def _sampled_mask(
    leaf: MaskLeaf, image: np.ndarray, x: np.ndarray, y: np.ndarray
) -> np.ndarray:
    anchor = leaf.sample or leaf.start
    spatial = _soft_disc(x, y, anchor.x, anchor.y, leaf.radius, 0.35)
    # Sampling uses a small median footprint when the anchor falls in this tile.
    distance = (x - anchor.x) ** 2 + (y - anchor.y) ** 2
    flat_index = int(np.argmin(distance))
    row, column = np.unravel_index(flat_index, distance.shape)
    row0, row1 = max(0, row - 1), min(image.shape[0], row + 2)
    col0, col1 = max(0, column - 1), min(image.shape[1], column + 2)
    sample = np.median(image[row0:row1, col0:col1, :3], axis=(0, 1))
    sample_luma = max(float(np.dot(sample, ACESCG_LUMA)), 1e-8)
    luma = np.maximum(np.einsum("...c,c->...", image[..., :3], ACESCG_LUMA, optimize=True), 1e-8)
    luma_similarity = np.clip(1.0 - np.abs(np.log2(luma / sample_luma)) / leaf.luma_tolerance_ev, 0.0, 1.0)
    xyz = _acescg_to_xyz(image[..., :3])
    sample_xyz = _acescg_to_xyz(sample.reshape((1, 1, 3)))[0, 0]
    xy = xyz[..., :2] / np.maximum(np.sum(xyz, axis=-1, keepdims=True), 1e-8)
    sample_xy = sample_xyz[:2] / max(float(np.sum(sample_xyz)), 1e-8)
    chroma_distance = np.sqrt(np.sum((xy - sample_xy) ** 2, axis=-1))
    chroma_similarity = np.clip(1.0 - chroma_distance / leaf.chroma_tolerance, 0.0, 1.0)
    return (spatial * luma_similarity * chroma_similarity).astype(np.float32)


def _acescg_to_xyz(image: np.ndarray) -> np.ndarray:
    matrix = np.array(
        [[0.66245418, 0.13400421, 0.15618769], [0.27222872, 0.67408177, 0.05368952], [-0.00557465, 0.00406073, 1.0103391]],
        dtype=np.float32,
    )
    return np.einsum("...c,dc->...d", image, matrix, optimize=True).astype(np.float32)


def _apply_local_grade(
    image: np.ndarray,
    grade: LocalGrade,
    kind: PreviewKind,
    *,
    source_pixel_scale: float = 1.0,
) -> np.ndarray:
    from .adjustments import (
        _apply_color_grading,
        _apply_curve_set,
        _apply_saturation_vibrance,
        _apply_white_balance,
    )

    result = image.astype(np.float32, copy=True)
    weights = ACESCG_LUMA if kind == PreviewKind.HDR else LINEAR_SRGB_LUMA
    luma = np.maximum(np.einsum("...c,c->...", result[..., :3], weights, optimize=True), 1e-8)
    stops = np.log2(luma / np.float32(grade.contrast_pivot))
    zone_adjustment = (
        np.float32(grade.blacks) * np.clip((-stops - 3.0) / 3.0, 0.0, 1.0)
        + np.float32(grade.shadows) * np.clip(1.0 - np.abs(stops + 2.0) / 2.5, 0.0, 1.0)
        + np.float32(grade.midtones) * np.clip(1.0 - np.abs(stops) / 2.5, 0.0, 1.0)
        + np.float32(grade.highlights) * np.clip((stops - 0.5) / 3.0, 0.0, 1.0)
    )
    contrast_factor = np.float32(2.0 ** grade.contrast)
    target_stops = stops * contrast_factor + zone_adjustment + np.float32(grade.exposure)
    target_luma = np.float32(grade.contrast_pivot) * np.exp2(np.clip(target_stops, -32.0, 24.0))
    gain = target_luma / luma
    result *= gain[..., None]

    if kind == PreviewKind.SDR:
        acescg = linear_srgb_to_acescg(result)
        acescg = _apply_white_balance(acescg, grade.white_balance_kelvin, grade.tint)
        acescg = _apply_saturation_vibrance(acescg, grade.saturation, grade.vibrance)
        result = acescg_to_linear_srgb(acescg)
    else:
        result = _apply_white_balance(result, grade.white_balance_kelvin, grade.tint)
        result = _apply_saturation_vibrance(result, grade.saturation, grade.vibrance)
    result = _apply_curve_set(result, grade, kind)
    result = _apply_color_grading(result, grade.color_grading, kind)
    result = apply_detail(result, grade.detail, kind, source_pixel_scale=source_pixel_scale)
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)
