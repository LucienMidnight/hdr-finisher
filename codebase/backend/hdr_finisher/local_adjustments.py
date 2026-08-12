from __future__ import annotations

import math
import os

import numpy as np

from .color import acescg_to_linear_srgb, linear_srgb_to_acescg
from .models import GeometryAdjustments, LocalAdjustment, LocalGrade, MaskExpression, MaskLeaf, PreviewKind


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
                compiled = compiled_masks.get(local.id) if compiled_masks else None
                if compiled is not None and compiled.shape == (height, width):
                    mask = compiled[top:bottom, left:right].astype(np.float32) / np.float32(255.0)
                else:
                    mask = evaluate_mask(local.mask, reference_tile, source_x, source_y)
                influence = np.clip(mask * np.float32(local.opacity), 0.0, 1.0)
                if not np.any(influence > 1e-6):
                    continue
                candidate = _apply_local_grade(tile, grade, kind)
                tile[...] = tile + (candidate - tile) * influence[..., None]
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


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


def evaluate_mask(
    expression: MaskExpression,
    fixed_source_tile: np.ndarray,
    source_x: np.ndarray,
    source_y: np.ndarray,
) -> np.ndarray:
    if expression.operator == "leaf":
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
    if expression.inverted:
        result = 1.0 - result
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
        return _linear_gradient(leaf, source_x, source_y)
    if leaf.type == "luminance_range":
        return _luminance_range(leaf, fixed_source_tile)
    if leaf.type == "brush":
        return _brush_mask(leaf, source_x, source_y)
    if leaf.type == "path":
        return _path_mask(leaf, source_x, source_y)
    if not SAMPLED_MASKS_ENABLED:
        return np.zeros(source_x.shape, dtype=np.float32)
    return _sampled_mask(leaf, fixed_source_tile, source_x, source_y)


def _linear_gradient(leaf: MaskLeaf, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    start = leaf.start
    end = leaf.end
    dx = np.float32(end.x - start.x)
    dy = np.float32(end.y - start.y)
    denominator = max(float(dx * dx + dy * dy), 1e-8)
    return np.clip(((x - start.x) * dx + (y - start.y) * dy) / denominator, 0.0, 1.0).astype(np.float32)


def _luminance_range(leaf: MaskLeaf, image: np.ndarray) -> np.ndarray:
    luma = np.einsum("...c,c->...", image[..., :3], ACESCG_LUMA, optimize=True)
    ev = np.log2(np.maximum(luma, np.float32(1e-8)) / np.float32(0.18))
    rise_width = max(leaf.full_start_ev - leaf.fade_in_start_ev, 1e-6)
    fall_width = max(leaf.fade_out_end_ev - leaf.full_end_ev, 1e-6)
    rise = np.clip((ev - leaf.fade_in_start_ev) / rise_width, 0.0, 1.0)
    fall = np.clip((leaf.fade_out_end_ev - ev) / fall_width, 0.0, 1.0)
    return np.minimum(rise, fall).astype(np.float32)


def _brush_mask(leaf: MaskLeaf, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    result = np.zeros(x.shape, dtype=np.float32)
    for stroke in leaf.strokes:
        stroke_mask = np.zeros(x.shape, dtype=np.float32)
        points = stroke.points
        if len(points) == 1:
            point = points[0]
            stroke_mask = _soft_disc(x, y, point.x, point.y, stroke.radius * point.pressure, stroke.hardness)
        else:
            for first, second in zip(points[:-1], points[1:]):
                pressure = max(0.05, 0.5 * (first.pressure + second.pressure))
                segment = _soft_segment(
                    x,
                    y,
                    first.x,
                    first.y,
                    second.x,
                    second.y,
                    stroke.radius * pressure,
                    stroke.hardness,
                )
                stroke_mask = np.maximum(stroke_mask, segment)
        stroke_mask *= np.float32(stroke.flow * stroke.opacity)
        if stroke.erase:
            result *= 1.0 - stroke_mask
        else:
            result = np.maximum(result, stroke_mask)
    return result


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
