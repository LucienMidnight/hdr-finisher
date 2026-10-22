"""Edge-colour highlight reconstruction (prototype, October 2026).

Runs after opposed-colour reconstruction, on the developed float picture, right
after camera RGB is converted to ACEScg and before lens correction.

Opposed colour rebuilds clipped channels from the other channels plus one
colour correction for the whole picture, so a clipped area often ends up a
different colour from the unclipped light just outside it (a white sun disk
inside an orange glow, a pale green blob inside pink bokeh) and the clip line
shows as a hard, often jagged edge. This step:

1. keeps each clipped pixel's brightness but takes its colour from the nearest
   unclipped, similarly bright pixels, falling back to wider areas only deeper
   inside large clipped areas;
2. feathers that change outward past the clip line by Expand;
3. smooths brightness in a band along the clip line, averaging only bright
   pixels with bright pixels, so dark objects in front of the light stay sharp.

Sizes are percentages of the picture's long edge. Blurs run on a reduced grid.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .color import acescg_to_linear_bt2020, linear_bt2020_to_acescg

BT2020_LUMA = np.array([0.2627, 0.6780, 0.0593], dtype=np.float32)
# A pixel counts as clipped from 92% of the clipping level, fully at 100%.
CLIP_SOFT_START = 0.92


def _smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / max(edge1 - edge0, 1e-9), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def _box(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    if radius <= 0:
        return values
    pad = [(0, 0)] * values.ndim
    pad[axis] = (radius + 1, radius)
    total = np.cumsum(np.pad(values, pad, mode="edge"), axis=axis, dtype=np.float64)
    count = total.shape[axis]
    upper = np.take(total, np.arange(2 * radius + 1, count), axis=axis)
    lower = np.take(total, np.arange(0, count - 2 * radius - 1), axis=axis)
    return ((upper - lower) / (2 * radius + 1)).astype(np.float32)


def _upsample(values: np.ndarray, factor: int, size: int, axis: int) -> np.ndarray:
    positions = (np.arange(size, dtype=np.float32) + 0.5) / factor - 0.5
    count = values.shape[axis]
    lower = np.clip(np.floor(positions).astype(np.int64), 0, count - 1)
    upper = np.clip(lower + 1, 0, count - 1)
    weight = np.clip(positions - np.floor(positions), 0.0, 1.0).astype(np.float32)
    shape = [1] * values.ndim
    shape[axis] = size
    weight = weight.reshape(shape)
    return np.take(values, lower, axis=axis) * (1.0 - weight) + np.take(values, upper, axis=axis) * weight


def blur(values: np.ndarray, sigma: float) -> np.ndarray:
    """Approximately Gaussian blur of an H×W or H×W×C array (three box passes)."""
    if sigma < 0.5:
        return values.astype(np.float32, copy=False)
    factor = max(1, int(sigma // 4.0))
    height, width = values.shape[:2]
    pad_h, pad_w = (-height) % factor, (-width) % factor
    padded = np.pad(values, [(0, pad_h), (0, pad_w)] + [(0, 0)] * (values.ndim - 2), mode="edge")
    small = padded.reshape(
        (padded.shape[0] // factor, factor, padded.shape[1] // factor, factor) + values.shape[2:]
    ).mean(axis=(1, 3), dtype=np.float32)
    grid_sigma = sigma / factor
    radius = max(1, int(round((np.sqrt(4.0 * grid_sigma * grid_sigma + 1.0) - 1.0) / 2.0)))
    for _ in range(3):
        small = _box(_box(small, radius, 0), radius, 1)
    if factor == 1:
        return small
    return _upsample(_upsample(small, factor, height, 0), factor, width, 1).astype(np.float32)


def reconstruct_edge_colour(
    image: np.ndarray, clip_ratio: np.ndarray, expand_percent: float
) -> tuple[np.ndarray, dict[str, Any]]:
    """Return the ACEScg picture with clipped areas recoloured from their surroundings.

    ``clip_ratio`` is each pixel's brightest camera channel divided by the
    clipping level opposed colour used (1.0 = clipped).
    """
    clipped = _smoothstep(CLIP_SOFT_START, 1.0, clip_ratio.astype(np.float32))
    diagnostics: dict[str, Any] = {
        "algorithm_version": "hdr-finisher-edge-colour-v1",
        "stage": "acescg_after_camera_conversion_before_lens_correction",
        "clipped_pixel_fraction": float(np.mean(clipped >= 0.5)),
        "expand_percent": float(expand_percent),
        "applied": False,
    }
    if not np.any(clipped >= 0.5):
        diagnostics["reason"] = "no_clipped_pixels"
        return image, diagnostics

    transport = acescg_to_linear_bt2020(image)
    long_edge = float(max(transport.shape[:2]))
    expand_px = max(0.0, float(expand_percent)) / 100.0 * long_edge
    luma = np.maximum(transport @ BT2020_LUMA, 0.0)
    total = np.maximum(transport.sum(axis=-1), 1e-12)
    chroma = np.clip(transport, 0.0, None) / total[..., None]
    clip_luma = float(np.median(luma[clipped >= 0.5]))
    diagnostics["clip_luminance"] = clip_luma

    # Colour sources: unclipped, not hugging the clip line, similarly bright.
    near_clip = blur(clipped, 2.0)
    source = (1.0 - clipped) * (1.0 - _smoothstep(0.02, 0.2, near_clip)) * _smoothstep(
        0.25, 0.5, luma / max(clip_luma, 1e-12)
    )
    # Nearest sources first; coarser scales only where finer ones found none.
    carried = None
    found = None
    sigma = max(2.0, 0.003 * long_edge)
    while sigma < 0.2 * long_edge:
        weight = blur(source, sigma)
        colour = blur(chroma * source[..., None], sigma) / np.maximum(weight, 1e-9)[..., None]
        coverage = _smoothstep(0.0, 0.08, weight)
        if carried is None:
            carried, found = colour, coverage
        else:
            take = (1.0 - found)[..., None]
            carried = carried * (1.0 - take) + colour * take
            found = np.maximum(found, coverage)
        sigma *= 3.0
    carried = carried / np.maximum(carried.sum(axis=-1, keepdims=True), 1e-12)

    # Colour: the clipped area softened, feathered outward by Expand.
    zone = blur(clipped, 2.0)
    if expand_px >= 0.5:
        zone = np.maximum(zone, _smoothstep(0.0, 0.5, blur(clipped, expand_px)))
    zone = np.clip(zone, 0.0, 1.0)[..., None]
    new_chroma = chroma + zone * (carried - chroma)

    # Brightness: smooth only a band along the clip line, bright with bright.
    edge_sigma = max(3.0, expand_px / 2.0)
    side = blur(clipped, edge_sigma)
    bright = _smoothstep(0.35, 0.7, luma / max(clip_luma, 1e-12))
    bright_mean = blur(luma * bright, edge_sigma) / np.maximum(blur(bright, edge_sigma), 1e-6)
    band = np.clip(4.0 * side * (1.0 - side), 0.0, 1.0) * bright
    luma = luma + band * (bright_mean - luma)

    rebuilt = new_chroma * (luma / np.maximum(new_chroma @ BT2020_LUMA, 1e-12))[..., None]
    rebuilt = np.where(transport < 0.0, transport, rebuilt)  # out-of-gamut negatives untouched
    diagnostics["applied"] = True
    return np.ascontiguousarray(linear_bt2020_to_acescg(rebuilt.astype(np.float32)), dtype=np.float32), diagnostics
