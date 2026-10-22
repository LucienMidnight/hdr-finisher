"""Smooth highlight rebuild (prototype, October 2026).

Runs after opposed-colour reconstruction and camera-to-ACEScg conversion, on
the developed float picture, so it can use the whole clipped area at once.

Opposed colour repairs the colour of clipped photosites but leaves a clipped
area flat at about the clipping level. Next to a bright, unclipped glow that
flat core can be dimmer in one channel than its surroundings (the sunset
IMG_3129: the sun's red is ~1330 nits against ~1600 just outside), and later
highlight compression turns that into rings. This stage lets brightness keep
rising smoothly toward the middle of each clipped area ("centre lift") and can
spread part of that light outward ("bloom").

Every size is a percentage of the picture's long edge, so the result does not
depend on the camera's pixel count. Blurs run at reduced resolution.
"""
from __future__ import annotations

from typing import Any

import numpy as np

ACESCG_LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)

# A pixel counts as clipped from 92% of the clipping level, fully at 100%.
CLIP_SOFT_START = 0.92


def _smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _box_blur_axis(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    if radius <= 0:
        return values
    pad = [(0, 0)] * values.ndim
    pad[axis] = (radius + 1, radius)
    padded = np.pad(values, pad, mode="edge")
    total = np.cumsum(padded, axis=axis, dtype=np.float64)
    upper = np.take(total, np.arange(2 * radius + 1, total.shape[axis]), axis=axis)
    lower = np.take(total, np.arange(0, total.shape[axis] - 2 * radius - 1), axis=axis)
    return ((upper - lower) / (2 * radius + 1)).astype(np.float32)


def _gaussian_small(values: np.ndarray, sigma: float) -> np.ndarray:
    """Three box passes approximate a Gaussian (sigma in this grid's pixels)."""
    if sigma < 0.5:
        return values
    width = np.sqrt(12.0 * sigma * sigma / 3.0 + 1.0)
    radius = max(1, int(round((width - 1.0) / 2.0)))
    result = values
    for _ in range(3):
        result = _box_blur_axis(result, radius, 0)
        result = _box_blur_axis(result, radius, 1)
    return result


def _downsample(values: np.ndarray, factor: int) -> np.ndarray:
    if factor <= 1:
        return values.astype(np.float32, copy=False)
    height, width = values.shape[:2]
    pad_h, pad_w = (-height) % factor, (-width) % factor
    padded = np.pad(values, [(0, pad_h), (0, pad_w)] + [(0, 0)] * (values.ndim - 2), mode="edge")
    shape = (padded.shape[0] // factor, factor, padded.shape[1] // factor, factor) + values.shape[2:]
    return padded.reshape(shape).mean(axis=(1, 3), dtype=np.float32)


def _upsample_axis(values: np.ndarray, factor: int, size: int, axis: int) -> np.ndarray:
    positions = (np.arange(size, dtype=np.float32) + 0.5) / factor - 0.5
    count = values.shape[axis]
    lower = np.clip(np.floor(positions).astype(np.int64), 0, count - 1)
    upper = np.clip(lower + 1, 0, count - 1)
    weight = np.clip(positions - np.floor(positions), 0.0, 1.0).astype(np.float32)
    shape = [1] * values.ndim
    shape[axis] = size
    weight = weight.reshape(shape)
    return np.take(values, lower, axis=axis) * (1.0 - weight) + np.take(values, upper, axis=axis) * weight


def gaussian_blur(values: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur of an H×W or H×W×C float array; large sigmas run on a reduced grid."""
    if sigma < 0.5:
        return values.astype(np.float32, copy=False)
    factor = max(1, int(sigma // 4.0))
    small = _gaussian_small(_downsample(values, factor), sigma / factor)
    if factor == 1:
        return small
    height, width = values.shape[:2]
    return _upsample_axis(_upsample_axis(small, factor, height, 0), factor, width, 1).astype(np.float32)


def _local_maximum(values: np.ndarray, radius_px: float) -> np.ndarray:
    """Smooth local maximum over about ``radius_px``, computed on a reduced grid."""
    factor = max(1, int(radius_px // 6.0))
    height, width = values.shape
    pad_h, pad_w = (-height) % factor, (-width) % factor
    padded = np.pad(values, [(0, pad_h), (0, pad_w)], mode="edge")
    small = padded.reshape(padded.shape[0] // factor, factor, padded.shape[1] // factor, factor).max(axis=(1, 3))
    steps = max(1, int(round(radius_px / factor)))
    for _ in range(steps):
        grown = small.copy()
        grown[1:, :] = np.maximum(grown[1:, :], small[:-1, :])
        grown[:-1, :] = np.maximum(grown[:-1, :], small[1:, :])
        grown[:, 1:] = np.maximum(grown[:, 1:], small[:, :-1])
        grown[:, :-1] = np.maximum(grown[:, :-1], small[:, 1:])
        small = grown
    small = _gaussian_small(small, max(1.0, steps / 2.0))
    if factor == 1:
        return small
    return _upsample_axis(_upsample_axis(small, factor, height, 0), factor, width, 1).astype(np.float32)


def rebuild_highlights(
    image: np.ndarray,
    clip_ratio: np.ndarray,
    settings: Any,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Lift and optionally bloom clipped areas of a scene-linear ACEScg picture.

    ``clip_ratio`` is each pixel's brightest camera channel divided by the
    clipping level used by opposed-colour reconstruction (1.0 = clipped).
    """
    long_edge = float(max(image.shape[:2]))
    core_sigma = float(settings.rebuild_core_size_percent) / 100.0 * long_edge
    lift_stops = float(settings.rebuild_centre_lift_stops)
    bloom_sigma = float(settings.rebuild_bloom_radius_percent) / 100.0 * long_edge
    bloom_amount = float(settings.rebuild_bloom_amount_percent) / 100.0
    spill = float(settings.rebuild_spill_percent) / 100.0
    clipped = _smoothstep(CLIP_SOFT_START, 1.0, clip_ratio.astype(np.float32))
    diagnostics: dict[str, Any] = {
        "algorithm_version": "hdr-finisher-smooth-rebuild-v1",
        "stage": "acescg_after_camera_conversion_before_lens_correction",
        "clipped_pixel_fraction": float(np.mean(clipped >= 0.5)),
        "core_sigma_px": core_sigma,
        "bloom_sigma_px": bloom_sigma,
        "applied": False,
    }
    if not np.any(clipped > 0.0):
        diagnostics["reason"] = "no_clipped_pixels"
        return image, diagnostics

    # Level floor: opposed colour can leave the inside of a clipped area a
    # little dimmer than its clipped rim. Raise clipped pixels toward the
    # brightest clipped value nearby so the inside cannot sag into a ring.
    # The raise fades in over a soft band around the clip edge (a hard switch
    # at the clip boundary leaves a faint contour), and skips pixels well
    # below the floor, such as dark objects in front of the light.
    brightest = np.max(image, axis=-1)
    floor = _local_maximum(brightest * clipped, core_sigma)
    ratio = floor / np.maximum(brightest, 1e-12)
    near_clip = _smoothstep(0.35, 0.65, gaussian_blur(clipped, max(core_sigma / 3.0, 1.0)))
    weight = near_clip * (1.0 - _smoothstep(1.15, 1.4, ratio))
    raise_by = 1.0 + weight * (np.maximum(ratio, 1.0) - 1.0)
    result = image * raise_by[..., None].astype(np.float32)
    diagnostics["max_floor_raise_stops"] = float(np.log2(np.max(raise_by)))

    # Depth inside a clipped area: about 0.5 at its edge, toward 1 in the
    # middle of an area wider than the core size, below 0.5 outside. Small or
    # thin clipped areas never get deep enough to be lifted.
    depth = gaussian_blur(clipped, core_sigma)
    lift = lift_stops * _smoothstep(0.5, 1.0, depth)
    result *= np.exp2(lift)[..., None].astype(np.float32)
    diagnostics["max_lift_stops"] = float(np.max(lift))

    if bloom_amount > 0.0 and bloom_sigma >= 0.5:
        # Bloom adds a Gaussian-spread copy of the rebuilt clipped light on
        # top. It never takes light out of the clipped area: when a clipped
        # core sits inside a bright unclipped glow (a sunset), moving light
        # out leaves a darker band at the clip edge, which reads as a ring.
        # A bump added to a falling profile keeps it falling, so no ring forms;
        # the core edge melts as Amount and Radius grow.
        source = result * _smoothstep(0.3, 0.7, depth)[..., None]
        bloom = gaussian_blur(source, bloom_sigma) * np.float32(bloom_amount)
        # Light landing on darker objects is cut to the Spill share.
        base_luma = np.maximum(np.einsum("...c,c->...", result, ACESCG_LUMA), 0.0)
        bloom_luma = np.maximum(np.einsum("...c,c->...", bloom, ACESCG_LUMA), 1e-12)
        landing = spill + (1.0 - spill) * np.clip(base_luma / bloom_luma, 0.0, 1.0)
        result = result + bloom * landing[..., None].astype(np.float32)
        diagnostics["bloom_applied"] = True
    diagnostics["applied"] = True
    return np.ascontiguousarray(result, dtype=np.float32), diagnostics
