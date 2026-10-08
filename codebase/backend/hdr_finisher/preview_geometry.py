"""Local resampling bounds for reduced GPU sources, separate from export."""
from __future__ import annotations

import numpy as np

from .finishing import (
    _crop_bounds,
    _oriented_view,
    _perspective_inverse_matrix,
    _perspective_safe_rectangle,
    _roll_stage,
    geometry_resample_stage,
)
from .models import GeometryAdjustments


def limit_geometry_overshoot(
    source: np.ndarray,
    geometry: GeometryAdjustments,
    result: np.ndarray,
    origin: tuple[int, int] = (0, 0),
) -> np.ndarray:
    """Bound each output by the 4x4 source samples its bicubic kernel uses.

    The map uses full-output coordinates even for a window, so adjacent tiles
    take the same bounds as the full frame. Real source negatives are retained.
    Call only for reduced levels; native geometry and export stay untouched.
    """
    stage = geometry_resample_stage(geometry)
    if stage == "index":
        return result
    oriented = _oriented_view(source, geometry)
    height, width = oriented.shape[:2]
    roll = geometry.straighten_angle + geometry.perspective_rotate
    if stage == "roll":
        mapping = _roll_stage(width, height, roll)
        if mapping is None:  # Pillow transposes exact quarter turns.
            return result
        terms, left, top, safe_width, safe_height = mapping
        inverse = np.array((*terms, 0.0, 0.0, 1.0), dtype=np.float64).reshape(3, 3)
    else:
        inverse = _perspective_inverse_matrix(
            width, height, roll, geometry.perspective_horizontal, geometry.perspective_vertical
        )
        left, top, right, bottom = _perspective_safe_rectangle(
            width, height, round(float(roll), 6),
            round(float(geometry.perspective_horizontal), 6),
            round(float(geometry.perspective_vertical), 6),
        )
        safe_width, safe_height = right - left, bottom - top
    crop_left, crop_top, _, _ = _crop_bounds(safe_width, safe_height, geometry)
    offset_x = left + crop_left + origin[0]
    offset_y = top + crop_top + origin[1]
    output = result.copy()
    x = np.arange(result.shape[1], dtype=np.float64)[None, :] + offset_x + 0.5
    # Bound temporary arrays by rows, rather than allocating 16 full frames.
    for start in range(0, result.shape[0], 128):
        stop = min(start + 128, result.shape[0])
        y = np.arange(start, stop, dtype=np.float64)[:, None] + offset_y + 0.5
        divisor = inverse[2, 0] * x + inverse[2, 1] * y + inverse[2, 2]
        sample_x = np.floor((inverse[0, 0] * x + inverse[0, 1] * y + inverse[0, 2]) / divisor - 0.5).astype(np.intp)
        sample_y = np.floor((inverse[1, 0] * x + inverse[1, 1] * y + inverse[1, 2]) / divisor - 0.5).astype(np.intp)
        low = np.full(output[start:stop].shape, np.inf, dtype=np.float32)
        high = np.full_like(low, -np.inf)
        for dy in (-1, 0, 1, 2):
            rows = np.clip(sample_y + dy, 0, height - 1)
            for dx in (-1, 0, 1, 2):
                values = oriented[rows, np.clip(sample_x + dx, 0, width - 1)]
                np.minimum(low, values, out=low)
                np.maximum(high, values, out=high)
        np.clip(output[start:stop], low, high, out=output[start:stop])
    return output
