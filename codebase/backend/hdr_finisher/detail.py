from __future__ import annotations

import math

import numpy as np

from .models import DetailAdjustments, PreviewKind


_ACESCG_LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
_SRGB_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def detail_is_neutral(detail: DetailAdjustments) -> bool:
    return (
        float(detail.texture_amount) == 0.0
        and float(detail.clarity_amount) == 0.0
        and float(detail.sharpen_amount) == 0.0
    )


def apply_detail(
    image: np.ndarray,
    detail: DetailAdjustments,
    kind: PreviewKind,
    *,
    source_pixel_scale: float = 1.0,
) -> np.ndarray:
    """Apply band-limited luminance detail while preserving RGB hue ratios."""
    if detail_is_neutral(detail):
        return image
    weights = _ACESCG_LUMA if kind == PreviewKind.HDR else _SRGB_LUMA
    original_luma = np.maximum(np.einsum("...c,c->...", image[..., :3], weights, optimize=True), 1e-7)
    # Log luminance makes equal local contrast changes read consistently in
    # shadows and highlights.  Values below black remain clamped and finite.
    log_luma = np.log2(original_luma)
    adjusted = log_luma.copy()
    diagonal = math.hypot(image.shape[0], image.shape[1])

    if detail.texture_amount:
        fine = _gaussian_blur(log_luma, max(0.35, diagonal * 0.0003))
        coarse = _gaussian_blur(log_luma, max(0.70, diagonal * 0.0012))
        band = fine - coarse
        adjusted += band * np.float32(float(detail.texture_amount) / 100.0)

    if detail.clarity_amount:
        radius = max(0.5, diagonal * float(detail.clarity_radius_percent) / 100.0)
        base = _gaussian_blur(log_luma, radius)
        band = log_luma - base
        # Suppress cross-edge bleeding while keeping texture inside surfaces.
        edge_weight = np.exp(-np.square(band / np.float32(0.75))).astype(np.float32)
        adjusted += band * edge_weight * np.float32(float(detail.clarity_amount) / 125.0)

    if detail.sharpen_amount:
        radius = max(0.3, float(detail.sharpen_radius_px) * max(0.05, float(source_pixel_scale)))
        base = _gaussian_blur(log_luma, radius)
        edge = log_luma - base
        threshold = np.float32(float(detail.sharpen_threshold) / 100.0 * 0.50)
        if threshold <= 1e-8:
            qualification = np.ones_like(edge, dtype=np.float32)
        else:
            qualification = np.clip((np.abs(edge) - threshold) / np.float32(0.04), 0.0, 1.0)
            qualification = qualification * qualification * (np.float32(3.0) - np.float32(2.0) * qualification)
        qualified = edge * qualification
        sharpened = adjusted + qualified * np.float32(float(detail.sharpen_amount) / 100.0)
        local_min, local_max = _local_extrema(log_luma)
        # A strict local-extrema fence pins the brightest and darkest edge
        # samples at every non-zero Amount, which makes sharpening behave like
        # an on/off switch. Permit a small, range-relative excursion while
        # retaining a firm halo bound.
        allowance = np.float32(0.12) * (local_max - local_min)
        adjusted = np.clip(sharpened, local_min - allowance, local_max + allowance)

    delta = np.clip(adjusted - log_luma, -16.0, 16.0).astype(np.float32)
    gain = np.exp2(delta).astype(np.float32)
    result = image.astype(np.float32, copy=False) * gain[..., None]
    clipped = np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)
    # Preserve exact source samples wherever all selected bands made no change;
    # merely enabling Detail must never alter or soften the image.
    return np.where((np.abs(delta) > 1e-7)[..., None], clipped, image).astype(np.float32)


def _gaussian_blur(values: np.ndarray, sigma: float) -> np.ndarray:
    if sigma < 0.35:
        return values.astype(np.float32, copy=False)
    # Three box passes approximate a Gaussian and remain linear in radius.
    width = max(3, int(round(math.sqrt(4.0 * sigma * sigma + 1.0))))
    if width % 2 == 0:
        width += 1
    radius = min(2048, width // 2)
    result = values.astype(np.float32, copy=True)
    for _ in range(3):
        result = _box_blur_axis(result, radius, 1)
        result = _box_blur_axis(result, radius, 0)
    return result


def _box_blur_axis(values: np.ndarray, radius: int, axis: int) -> np.ndarray:
    if radius <= 0:
        return values
    padding = [(0, 0)] * values.ndim
    padding[axis] = (radius, radius)
    padded = np.pad(values, padding, mode="edge")
    zero_shape = list(padded.shape)
    zero_shape[axis] = 1
    cumulative = np.concatenate(
        (np.zeros(zero_shape, dtype=np.float32), np.cumsum(padded, axis=axis, dtype=np.float32)), axis=axis
    )
    width = radius * 2 + 1
    after = [slice(None)] * values.ndim
    before = [slice(None)] * values.ndim
    after[axis] = slice(width, None)
    before[axis] = slice(None, -width)
    return (cumulative[tuple(after)] - cumulative[tuple(before)]) / np.float32(width)


def _local_extrema(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    padded = np.pad(values, ((1, 1), (1, 1)), mode="edge")
    samples = [padded[y:y + values.shape[0], x:x + values.shape[1]] for y in range(3) for x in range(3)]
    return np.minimum.reduce(samples), np.maximum.reduce(samples)
