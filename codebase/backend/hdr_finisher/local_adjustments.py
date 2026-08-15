from __future__ import annotations

import math
import os

import numpy as np

from .color import acescg_to_linear_srgb, linear_srgb_to_acescg
from .models import GeometryAdjustments, LocalAdjustment, LocalGrade, MaskExpression, MaskLeaf, MaskPoint, PreviewKind


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
) -> np.ndarray:
    """Apply ordered local corrections without allocating per-layer frames or masks."""
    active = [item for item in local_adjustments if item.enabled and item.opacity > 0.0]
    if not active:
        return image
    if image.shape[:2] != fixed_source.shape[:2]:
        raise ValueError("The fixed mask source and local-stage image must have matching geometry.")

    result = image.astype(np.float32, copy=True)
    height, width = result.shape[:2]
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
                    mask = evaluate_mask(local.mask, reference_tile, source_x, source_y)
                influence = np.clip(mask * np.float32(local.opacity), 0.0, 1.0)
                if not np.any(influence > 1e-6):
                    continue
                candidate = _apply_local_grade(tile, grade, kind)
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
    height, width = fixed_source.shape[:2]
    source_x, source_y = source_coordinate_grid(width, height, 0, 0, width, height, geometry)
    mask = evaluate_mask(expression, fixed_source, source_x, source_y)
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
    return spatial_mask_expression(expression).model_dump_json()


def compile_spatial_preview_mask(
    fixed_source: np.ndarray,
    expression: MaskExpression,
    geometry: GeometryAdjustments,
) -> np.ndarray:
    """Compile reusable spatial coverage without simple-leaf influence opacity."""
    return compile_preview_mask(fixed_source, spatial_mask_expression(expression), geometry)


def evaluate_mask(
    expression: MaskExpression,
    fixed_source_tile: np.ndarray,
    source_x: np.ndarray,
    source_y: np.ndarray,
) -> np.ndarray:
    brush_erase_attenuation: np.ndarray | None = None
    if expression.operator == "leaf":
        if expression.leaf is not None and expression.leaf.type == "brush":
            result, brush_erase_attenuation = _brush_masks(expression.leaf, source_x, source_y)
        else:
            result = _evaluate_leaf(expression.leaf, fixed_source_tile, source_x, source_y)
    else:
        children = [evaluate_mask(child, fixed_source_tile, source_x, source_y) for child in expression.children]
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

    if geometry.straighten_angle:
        angle = math.radians(-float(geometry.straighten_angle))
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
        return _path_mask(leaf, source_x, source_y)
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
    luma = np.einsum("...c,c->...", image[..., :3], ACESCG_LUMA, optimize=True)
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


def _brush_masks(leaf: MaskLeaf, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
    result = np.zeros(x.shape, dtype=np.float32)
    erase_attenuation: np.ndarray | None = None
    metric_x, metric_y, metric_transform, metric_origin = _brush_display_metric(x, y)

    def metric_point(point: MaskPoint) -> tuple[float, float]:
        transformed = metric_transform @ (
            np.array([point.x, point.y], dtype=np.float64) - metric_origin
        )
        return float(transformed[0]), float(transformed[1])

    for stroke in leaf.strokes:
        stroke_mask = np.zeros(x.shape, dtype=np.float32)
        points = stroke.points
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
            if rows.stop > rows.start and columns.stop > columns.start:
                stroke_mask[rows, columns] = _soft_disc(
                    metric_x[rows, columns],
                    metric_y[rows, columns],
                    point_x,
                    point_y,
                    radius,
                    stroke.hardness,
                )
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
                if rows.stop <= rows.start or columns.stop <= columns.start:
                    continue
                segment = _soft_segment(
                    metric_x[rows, columns],
                    metric_y[rows, columns],
                    first_x,
                    first_y,
                    second_x,
                    second_y,
                    radius,
                    stroke.hardness,
                )
                stroke_mask[rows, columns] = np.maximum(stroke_mask[rows, columns], segment)
        if stroke.erase:
            if erase_attenuation is None:
                erase_attenuation = np.ones(x.shape, dtype=np.float32)
            erase_strength = np.minimum(
                np.float32(stroke.opacity),
                stroke_mask * np.float32(stroke.flow),
            )
            erase_attenuation *= 1.0 - erase_strength
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
                result + paint_strength,
            )
            result = np.maximum(result, accumulated)
            if erase_attenuation is not None:
                # Erase is retained as a final-stage attenuation so it can cut
                # shifted, feathered, and inverted coverage. A later paint
                # stroke must nevertheless be able to restore that attenuation
                # in stroke order; otherwise an erased pixel is permanent.
                restored = np.minimum(
                    np.float32(stroke.opacity),
                    erase_attenuation + paint_strength,
                )
                erase_attenuation = np.maximum(erase_attenuation, restored)
    return result, erase_attenuation


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
    delta_x = x.astype(np.float64, copy=False) - origin[0]
    delta_y = y.astype(np.float64, copy=False) - origin[1]
    metric_x = transform[0, 0] * delta_x + transform[0, 1] * delta_y
    metric_y = transform[1, 0] * delta_x + transform[1, 1] * delta_y
    return metric_x.astype(np.float32), metric_y.astype(np.float32), transform, origin


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
    blurred = _gaussian_blur_float(mask, pixel_radii)
    # Feather is a true smoothing operation, not an additive halo. Normalize
    # the blurred alpha back to the painted peak so Density remains stable even
    # when a small mark is feathered heavily.
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
    for width in _gaussian_box_widths(float(sigma_y), passes):
        radius = max(0, (width - 1) // 2)
        if radius:
            result = _box_blur_axis(result, radius, axis=0)
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
    """Apply one edge-extended float32 box pass in linear time."""
    padding = [(0, 0)] * values.ndim
    padding[axis] = (radius, radius)
    padded = np.pad(values, padding, mode="edge")
    zero_shape = list(padded.shape)
    zero_shape[axis] = 1
    cumulative = np.concatenate(
        [
            np.zeros(zero_shape, dtype=np.float32),
            np.cumsum(padded, axis=axis, dtype=np.float32),
        ],
        axis=axis,
    )
    width = radius * 2 + 1
    after = [slice(None)] * values.ndim
    before = [slice(None)] * values.ndim
    after[axis] = slice(width, None)
    before[axis] = slice(None, -width)
    return (cumulative[tuple(after)] - cumulative[tuple(before)]) / np.float32(width)


def _mask_radii_pixels(x: np.ndarray, y: np.ndarray, radius: float) -> tuple[float, float]:
    x_step = 0.0
    y_step = 0.0
    if x.shape[1] > 1:
        x_step = float(math.hypot(x[0, 1] - x[0, 0], y[0, 1] - y[0, 0]))
    if x.shape[0] > 1:
        y_step = float(math.hypot(x[1, 0] - x[0, 0], y[1, 0] - y[0, 0]))
    fallback = next((step for step in (x_step, y_step) if step > 1e-12), 1.0)
    x_step = x_step if x_step > 1e-12 else fallback
    y_step = y_step if y_step > 1e-12 else fallback
    return (
        min(2048.0, max(0.0, radius / x_step)),
        min(2048.0, max(0.0, radius / y_step)),
    )


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


def _path_mask(leaf: MaskLeaf, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    nodes = _flatten_path(leaf)
    inside = np.zeros(x.shape, dtype=bool)
    for first, second in zip(nodes, nodes[1:] + nodes[:1]):
        crosses = (first[1] > y) != (second[1] > y)
        edge_x = (second[0] - first[0]) * (y - first[1]) / (second[1] - first[1] + 1e-12) + first[0]
        inside ^= crosses & (x < edge_x)
    if leaf.feather <= 0.0:
        return inside.astype(np.float32)
    edge_distance = np.full(x.shape, np.inf, dtype=np.float32)
    for first, second in zip(nodes, nodes[1:] + nodes[:1]):
        distance_mask = _soft_segment(x, y, first[0], first[1], second[0], second[1], leaf.feather, 0.0)
        distance = (1.0 - distance_mask) * leaf.feather
        edge_distance = np.minimum(edge_distance, distance)
    feather = np.clip(edge_distance / max(leaf.feather, 1e-6), 0.0, 1.0)
    return np.where(inside, 0.5 + 0.5 * feather, 0.5 - 0.5 * feather).astype(np.float32)


def _flatten_path(leaf: MaskLeaf, steps: int = 12) -> list[tuple[float, float]]:
    vertices: list[tuple[float, float]] = []
    nodes = leaf.nodes
    for first, second in zip(nodes, nodes[1:] + nodes[:1]):
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
        curved = not (np.array_equal(p0, p1) and np.array_equal(p2, p3))
        sample_count = steps if curved else 1
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


def _apply_local_grade(image: np.ndarray, grade: LocalGrade, kind: PreviewKind) -> np.ndarray:
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
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)
