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

The work is split into strips of rows (or columns, for vertical box passes) on
the shared CPU pool. Each pixel gets the same arithmetic whatever the strip
count, so the result does not depend on how many cores ran it.
"""
from __future__ import annotations

from typing import Any

import numpy as np
from concurrent.futures import CancelledError

from .color import acescg_to_linear_bt2020, linear_bt2020_to_acescg
from .cpu_budget import CpuExecutor, logical_cpus

BT2020_LUMA = np.array([0.2627, 0.6780, 0.0593], dtype=np.float32)
# A pixel counts as clipped from 92% of the clipping level, fully at 100%.
CLIP_SOFT_START = 0.92
# Smallest strip worth a pool task. Tests set _strips to force a strip count.
_MIN_STRIP = 32
_strips = None


def _strip_slices(length: int) -> list[slice]:
    count = _strips if _strips is not None else min(logical_cpus(), length // _MIN_STRIP)
    count = max(1, min(int(count), length))
    edges = np.linspace(0, length, count + 1).astype(int)
    return [slice(int(a), int(b)) for a, b in zip(edges[:-1], edges[1:]) if b > a]


def _each(function, length: int) -> list:
    """Run ``function(strip)`` over strips of ``range(length)``; results in strip order."""
    strips = _strip_slices(length)
    if len(strips) == 1:
        return [function(strips[0])]
    with CpuExecutor() as pool:
        return list(pool.map(function, strips))


def _smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / max(edge1 - edge0, 1e-9), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def _box_strip(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    pad = [(0, 0)] * values.ndim
    pad[axis] = (radius + 1, radius)
    total = np.cumsum(np.pad(values, pad, mode="edge"), axis=axis, dtype=np.float64)
    count = total.shape[axis]
    upper = [slice(None)] * values.ndim
    lower = [slice(None)] * values.ndim
    upper[axis] = slice(2 * radius + 1, count)
    lower[axis] = slice(0, count - 2 * radius - 1)
    return ((total[tuple(upper)] - total[tuple(lower)]) / (2 * radius + 1)).astype(np.float32)


def _box(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    if radius <= 0:
        return values
    out = np.empty(values.shape, dtype=np.float32)
    across = 1 - axis  # each strip runs the whole length of the blurred axis

    def strip(part):
        index = [slice(None)] * values.ndim
        index[across] = part
        index = tuple(index)
        out[index] = _box_strip(values[index], radius, axis)

    _each(strip, values.shape[across])
    return out


def _upsample(values: np.ndarray, factor: int, size: int, axis: int, part: slice = slice(None)) -> np.ndarray:
    positions = ((np.arange(size, dtype=np.float32) + 0.5) / factor - 0.5)[part]
    count = values.shape[axis]
    lower = np.clip(np.floor(positions).astype(np.int64), 0, count - 1)
    upper = np.clip(lower + 1, 0, count - 1)
    weight = np.clip(positions - np.floor(positions), 0.0, 1.0).astype(np.float32)
    shape = [1] * values.ndim
    shape[axis] = len(positions)
    weight = weight.reshape(shape)
    return np.take(values, lower, axis=axis) * (1.0 - weight) + np.take(values, upper, axis=axis) * weight


def _shrink(values: np.ndarray, factor: int) -> np.ndarray:
    """Block means on the reduced grid; the last row and column are edge padded."""
    height, width = values.shape[:2]
    rows, columns = -(-height // factor), -(-width // factor)
    pad_w = columns * factor - width
    out = np.empty((rows, columns) + values.shape[2:], dtype=np.float32)

    def strip(part):
        source = values[part.start * factor:min(part.stop * factor, height)]
        pad_h = (part.stop - part.start) * factor - source.shape[0]
        padded = np.pad(source, [(0, pad_h), (0, pad_w)] + [(0, 0)] * (values.ndim - 2), mode="edge")
        out[part] = padded.reshape(
            (padded.shape[0] // factor, factor, padded.shape[1] // factor, factor) + values.shape[2:]
        ).mean(axis=(1, 3), dtype=np.float32)

    _each(strip, rows)
    return out


def _enlarge(small: np.ndarray, factor: int, height: int, width: int) -> np.ndarray:
    out = np.empty((height, width) + small.shape[2:], dtype=np.float32)

    def strip(part):
        out[part] = _upsample(_upsample(small, factor, height, 0, part), factor, width, 1)

    _each(strip, height)
    return out


def blur(values: np.ndarray, sigma: float, cancelled=None) -> np.ndarray:
    """Approximately Gaussian blur of an H×W or H×W×C array (three box passes)."""
    if sigma < 0.5:
        return values.astype(np.float32, copy=False)
    factor = max(1, int(sigma // 4.0))
    height, width = values.shape[:2]
    small = _shrink(values, factor)
    grid_sigma = sigma / factor
    radius = max(1, int(round((np.sqrt(4.0 * grid_sigma * grid_sigma + 1.0) - 1.0) / 2.0)))
    for _ in range(3):
        if cancelled and cancelled(): raise CancelledError("CPU edge colour cancelled.")
        small = _box(_box(small, radius, 0), radius, 1)
    if factor == 1:
        return small
    return _enlarge(small, factor, height, width)


def reconstruct_edge_colour(
    image: np.ndarray, clip_ratio: np.ndarray, expand_percent: float, *, cancelled=None
) -> tuple[np.ndarray, dict[str, Any]]:
    """Return the ACEScg picture with clipped areas recoloured from their surroundings.

    ``clip_ratio`` is each pixel's brightest camera channel divided by the
    clipping level opposed colour used (1.0 = clipped).
    """
    def checkpoint():
        if cancelled and cancelled(): raise CancelledError("CPU edge colour cancelled.")
    def smooth(values, sigma):
        checkpoint()
        result = blur(values, sigma, cancelled)
        checkpoint()
        return result
    def plane(channels=0):
        return np.empty((height, width, channels) if channels else (height, width), dtype=np.float32)
    checkpoint()
    height, width = clip_ratio.shape
    clipped = plane()

    def clip_strip(part):
        clipped[part] = _smoothstep(CLIP_SOFT_START, 1.0, clip_ratio[part].astype(np.float32))
        return int(np.count_nonzero(clipped[part] >= 0.5))

    clipped_count = sum(_each(clip_strip, height))
    diagnostics: dict[str, Any] = {
        "algorithm_version": "hdr-finisher-edge-colour-v1",
        "stage": "acescg_after_camera_conversion_before_lens_correction",
        "clipped_pixel_fraction": float(clipped_count / clipped.size),
        "expand_percent": float(expand_percent),
        "applied": False,
    }
    if not clipped_count:
        diagnostics["reason"] = "no_clipped_pixels"
        return image, diagnostics

    luma, chroma = plane(), plane(3)

    # The BT.2020 copy is recomputed at the end rather than held throughout.
    def colour_strip(part):
        moved = acescg_to_linear_bt2020(image[part])
        luma[part] = np.maximum(moved @ BT2020_LUMA, 0.0)
        total = np.maximum(moved.sum(axis=-1), 1e-12)
        chroma[part] = np.clip(moved, 0.0, None) / total[..., None]
        return luma[part][clipped[part] >= 0.5]

    clip_luma = float(np.median(np.concatenate(_each(colour_strip, height))))
    diagnostics["clip_luminance"] = clip_luma
    long_edge = float(max(height, width))
    expand_px = max(0.0, float(expand_percent)) / 100.0 * long_edge
    luma_scale = max(clip_luma, 1e-12)

    # Colour sources: unclipped, not hugging the clip line, similarly bright.
    near_clip = smooth(clipped, 2.0)
    source, seed = plane(), plane(3)

    def source_strip(part):
        source[part] = (1.0 - clipped[part]) * (1.0 - _smoothstep(0.02, 0.2, near_clip[part])) * _smoothstep(
            0.25, 0.5, luma[part] / luma_scale
        )
        seed[part] = chroma[part] * source[part][..., None]

    _each(source_strip, height)
    del near_clip
    # Nearest sources first; coarser scales only where finer ones found none.
    carried = plane(3)
    found = plane()
    first = True
    sigma = max(2.0, 0.003 * long_edge)
    while sigma < 0.2 * long_edge:
        weight = smooth(source, sigma)
        colour = smooth(seed, sigma)

        def scale_strip(part, first=first):
            # In place, with the same operations as carried * (1 - take) + here * take.
            here = colour[part]
            here /= np.maximum(weight[part], 1e-9)[..., None]
            coverage = _smoothstep(0.0, 0.08, weight[part])
            if first:
                carried[part], found[part] = here, coverage
            else:
                kept = carried[part]
                take = (1.0 - found[part])[..., None]
                kept *= 1.0 - take
                here *= take
                kept += here
                np.maximum(found[part], coverage, out=found[part])

        _each(scale_strip, height)
        del weight, colour
        first = False
        sigma *= 3.0
    del source, seed, found

    # Colour: the clipped area softened, feathered outward by Expand.
    zone = smooth(clipped, 2.0)
    wide = smooth(clipped, expand_px) if expand_px >= 0.5 else None

    def chroma_strip(part):
        mixed = carried[part] / np.maximum(carried[part].sum(axis=-1, keepdims=True), 1e-12)
        here = zone[part]
        if wide is not None:
            here = np.maximum(here, _smoothstep(0.0, 0.5, wide[part]))
        here = np.clip(here, 0.0, 1.0)[..., None]
        chroma[part] = chroma[part] + here * (mixed - chroma[part])

    _each(chroma_strip, height)
    del zone, wide, carried

    # Brightness: smooth only a band along the clip line, bright with bright.
    edge_sigma = max(3.0, expand_px / 2.0)
    side = smooth(clipped, edge_sigma)
    bright, weighted = plane(), plane()

    def bright_strip(part):
        bright[part] = _smoothstep(0.35, 0.7, luma[part] / luma_scale)
        weighted[part] = luma[part] * bright[part]

    _each(bright_strip, height)
    numerator = smooth(weighted, edge_sigma)
    del weighted
    denominator = smooth(bright, edge_sigma)
    checkpoint()

    def luma_strip(part):
        bright_mean = numerator[part] / np.maximum(denominator[part], 1e-6)
        band = np.clip(4.0 * side[part] * (1.0 - side[part]), 0.0, 1.0) * bright[part]
        luma[part] = luma[part] + band * (bright_mean - luma[part])

    _each(luma_strip, height)
    del clipped, side, bright, numerator, denominator
    result = plane(3)

    def rebuild_strip(part):
        transport = acescg_to_linear_bt2020(image[part])
        new_chroma = chroma[part]
        rebuilt = new_chroma * (luma[part] / np.maximum(new_chroma @ BT2020_LUMA, 1e-12))[..., None]
        rebuilt = np.where(transport < 0.0, transport, rebuilt)  # out-of-gamut negatives untouched
        del transport
        result[part] = linear_bt2020_to_acescg(rebuilt)

    _each(rebuild_strip, height)
    del luma, chroma
    checkpoint()
    diagnostics["applied"] = True
    return result, diagnostics
