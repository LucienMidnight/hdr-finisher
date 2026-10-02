"""Source evidence for bounded editing measurements, built once at import.

Keep real RGB pixels and their positions: independently pooled channels would
invent colours. Editing only transforms this fixed, small list. It never scans
the native source again and never grades pixels on the CPU.
"""
from __future__ import annotations

import numpy as np

from .finishing import geometry_coordinate_map, geometry_output_dimensions, geometry_resample_stage, _crop_bounds

GRID = 64
MAX_CANDIDATES = GRID * GRID * 4


def source_candidates(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    positions = set()
    ys = np.linspace(0, height, min(GRID, height) + 1, dtype=int)
    xs = np.linspace(0, width, min(GRID, width) + 1, dtype=int)
    weights = np.array([.2722287, .6740818, .0536895], dtype=np.float32)
    for top, bottom in zip(ys[:-1], ys[1:]):
        for left, right in zip(xs[:-1], xs[1:]):
            cell = image[top:bottom, left:right, :3]
            for signal in [cell[..., channel] for channel in range(3)] + [cell @ weights]:
                y, x = np.unravel_index(np.argmax(signal), signal.shape)
                positions.add((left + int(x), top + int(y)))
    xy = np.array(sorted(positions), dtype=np.float32)
    return np.column_stack((xy, image[xy[:, 1].astype(int), xy[:, 0].astype(int), :3])).astype(np.float32)


def positioned_candidates(evidence: np.ndarray, source_shape: tuple, geometry) -> dict:
    height, width = source_shape[:2]
    output_width, output_height = geometry_output_dimensions(width, height, geometry)
    xy = evidence[:, :2].astype(np.float64).copy()
    stage = geometry_resample_stage(geometry)
    if stage == "index":
        if geometry.rotation == 90:
            xy = np.column_stack((height - 1 - xy[:, 1], xy[:, 0]))
            width, height = height, width
        elif geometry.rotation == 180:
            xy = np.column_stack((width - 1 - xy[:, 0], height - 1 - xy[:, 1]))
        elif geometry.rotation == 270:
            xy = np.column_stack((xy[:, 1], width - 1 - xy[:, 0]))
            width, height = height, width
        if geometry.flip_horizontal:
            xy[:, 0] = width - 1 - xy[:, 0]
        if geometry.flip_vertical:
            xy[:, 1] = height - 1 - xy[:, 1]
        left, top, _, _ = _crop_bounds(width, height, geometry)
        xy -= [left, top]
    else:
        # A bounded coordinate ramp locates candidates for resampled geometry.
        # The native patches subsequently read the actual transformed pixels.
        scale = min(1., 512 / max(width, height))
        _, forward, _, _ = geometry_coordinate_map(max(2, round(width * scale)), max(2, round(height * scale)), geometry)
        uv = np.column_stack(((xy[:, 0] + .5) / width, (xy[:, 1] + .5) / height, np.ones(len(xy))))
        mapped = uv @ np.array(forward).reshape(3, 3).T
        xy = mapped[:, :2] / mapped[:, 2:3] * [output_width, output_height] - .5
    keep = np.isfinite(xy).all(axis=1) & (xy[:, 0] >= 0) & (xy[:, 1] >= 0) & (xy[:, 0] < output_width) & (xy[:, 1] < output_height)
    samples = np.column_stack((xy[keep], evidence[keep, 2:]))
    return {"width": output_width, "height": output_height, "samples": samples.tolist(), "resample_stage": stage}
