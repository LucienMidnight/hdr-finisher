from __future__ import annotations

import math

import numpy as np

from .models import DetailAdjustments, PreviewKind


_ACESCG_LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
_SRGB_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
_TEXTURE_EDGE_THRESHOLD_EV = np.float32(0.20)
# Log luminance needs a floor well above zero. A floor at the edge of float
# precision makes the local neighbourhood range around any near-black sample
# span twenty stops or more, which the sharpening halo fence reads as licence
# for an unbounded excursion.
_DETAIL_LUMA_FLOOR = np.float32(1e-4)
# Absolute ceiling on how far a sharpened sample may travel past its local
# neighbourhood. The fence stays range-relative for ordinary structure and only
# this cap engages at high-contrast edges.
_SHARPEN_HALO_ALLOWANCE_EV = np.float32(0.25)


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
    original_luma = np.maximum(
        np.einsum("...c,c->...", image[..., :3], weights, optimize=True), _DETAIL_LUMA_FLOOR
    )
    # Log luminance makes equal local contrast changes read consistently in
    # shadows and highlights.  Values below black remain clamped and finite.
    log_luma = np.log2(original_luma)
    adjusted = log_luma.copy()
    diagonal = math.hypot(image.shape[0], image.shape[1])

    if detail.texture_amount:
        fine_radius = max(0.35, diagonal * 0.0003)
        coarse_radius = max(0.70, diagonal * 0.0012)
        fine = _gaussian_blur(log_luma, fine_radius)
        coarse = _gaussian_blur(log_luma, coarse_radius)
        band = fine - coarse
        # A difference of blurs rings around narrow, high-contrast structure.
        # Qualify the band with contrast measured across the coarse filter's
        # support so wires and hard edges do not acquire light/dark outlines,
        # while low-amplitude, non-coherent surface texture remains active.
        edge_weight = _texture_edge_weight(log_luma, coarse, coarse_radius)
        adjusted += band * edge_weight * np.float32(float(detail.texture_amount) / 100.0)

    if detail.clarity_amount:
        radius = max(0.5, diagonal * float(detail.clarity_radius_percent) / 100.0)
        base = clarity_base(log_luma, radius)
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
        # retaining a firm halo bound. The absolute cap keeps that excursion
        # bounded where the local range is itself large, so a specular edge
        # cannot be sharpened into a value the picture never contained.
        allowance = np.minimum(np.float32(0.12) * (local_max - local_min), _SHARPEN_HALO_ALLOWANCE_EV)
        adjusted = np.clip(sharpened, local_min - allowance, local_max + allowance)

    delta = np.clip(adjusted - log_luma, -16.0, 16.0).astype(np.float32)
    gain = np.exp2(delta).astype(np.float32)
    result = image.astype(np.float32, copy=False) * gain[..., None]
    clipped = np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)
    # Preserve exact source samples wherever all selected bands made no change;
    # merely enabling Detail must never alter or soften the image.
    return np.where((np.abs(delta) > 1e-7)[..., None], clipped, image).astype(np.float32)


# Clarity's base is built on a brightness pyramid: box-average the log
# luminance down by 2**level until sigma is CLARITY_MAP_MIN_TEXELS to twice
# that, blur densely there, and upsample with a cubic B-spline. The box and the
# B-spline blur a little themselves and the dense blur takes exactly the rest.
# Sampling the full-resolution picture sparsely instead turns a smooth fade
# into a staircase. `clarityMapPlan` in graph-scale.js is the same arithmetic,
# and the WebGPU preview runs the same three steps.
CLARITY_MAP_MIN_TEXELS = 3.0
CLARITY_MAP_TAP_REACH = 3.0
# The Clarity Radius slider's lower bound, in percent of the diagonal. The
# picture is first averaged to that radius's block size, then further for
# wider radii, so a radius change never re-reads the picture in the preview.
CLARITY_RADIUS_MIN_PERCENT = 0.2


def clarity_map_plan(sigma: float) -> dict:
    target = max(0.5, float(sigma))
    level = 0 if target < 2.0 * CLARITY_MAP_MIN_TEXELS else int(math.floor(math.log2(target / CLARITY_MAP_MIN_TEXELS)))
    scale = 2 ** level
    inherent = 0.0 if level == 0 else (1.0 - 4.0 ** -level) / 12.0 + 1.0 / 3.0
    dense_sigma = math.sqrt(max((target / scale) ** 2 - inherent, 0.0))
    taps = int(math.ceil(CLARITY_MAP_TAP_REACH * dense_sigma)) if dense_sigma > 1e-6 else 0
    reach = taps if level == 0 else int(math.ceil((taps + 2.5) * scale))
    return {"sigma": target, "level": level, "scale": scale, "dense_sigma": dense_sigma, "taps": taps, "reach": reach}


def clarity_base_scale(height: int, width: int) -> int:
    diagonal = math.hypot(height, width)
    return clarity_map_plan(max(0.5, diagonal * CLARITY_RADIUS_MIN_PERCENT / 100.0))["scale"]


def clarity_base(log_luma: np.ndarray, sigma: float) -> np.ndarray:
    plan = clarity_map_plan(sigma)
    scale = plan["scale"]
    height, width = log_luma.shape
    base_scale = min(scale, clarity_base_scale(height, width))
    values = _block_mean(log_luma.astype(np.float32, copy=False), base_scale)
    values = _block_mean(values, scale // base_scale)
    kernel = _clarity_kernel(plan["dense_sigma"], plan["taps"])
    values = _dense_blur_axis(_dense_blur_axis(values, kernel, 1), kernel, 0)
    if scale == 1:
        return values
    return _bspline_upsample_axis(_bspline_upsample_axis(values, scale, width, 1), scale, height, 0)


def _block_mean(values: np.ndarray, block: int) -> np.ndarray:
    """Average ``block`` x ``block`` cells, repeating the edge where one runs off."""
    if block <= 1:
        return values
    height, width = values.shape
    rows, columns = -(-height // block), -(-width // block)
    padded = np.pad(values, ((0, rows * block - height), (0, columns * block - width)), mode="edge")
    return padded.reshape(rows, block, columns, block).mean(axis=(1, 3), dtype=np.float32)


def _clarity_kernel(sigma: float, taps: int) -> np.ndarray:
    if taps <= 0:
        return np.ones(1, dtype=np.float32)
    offsets = np.arange(-taps, taps + 1, dtype=np.float32)
    kernel = np.exp(np.float32(-0.5) * np.square(offsets / np.float32(sigma)))
    return (kernel / kernel.sum(dtype=np.float32)).astype(np.float32)


def _dense_blur_axis(values: np.ndarray, kernel: np.ndarray, axis: int) -> np.ndarray:
    taps = kernel.size // 2
    if taps == 0:
        return values
    padding = [(0, 0), (0, 0)]
    padding[axis] = (taps, taps)
    padded = np.pad(values, padding, mode="edge")
    size = values.shape[axis]
    result = np.zeros_like(values, dtype=np.float32)
    for tap, weight in enumerate(kernel):
        window = [slice(None), slice(None)]
        window[axis] = slice(tap, tap + size)
        result += padded[tuple(window)] * weight
    return result


def _bspline_upsample_axis(coarse: np.ndarray, scale: int, size: int, axis: int) -> np.ndarray:
    # Pixel centre x sits at (x + 0.5) / scale - 0.5 in coarse texel units.
    position = (np.arange(size, dtype=np.float64) + 0.5) / scale - 0.5
    base = np.floor(position).astype(np.int64)
    t = (position - base).astype(np.float32)
    weights = (
        (1 - t) ** 3 / 6,
        (3 * t ** 3 - 6 * t ** 2 + 4) / 6,
        (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6,
        t ** 3 / 6,
    )
    shape = [1, 1]
    shape[axis] = -1
    limit = coarse.shape[axis] - 1
    result = np.zeros(coarse.shape[:axis] + (size,) + coarse.shape[axis + 1:], dtype=np.float32)
    for offset, weight in enumerate(weights):
        result += np.take(coarse, np.clip(base - 1 + offset, 0, limit), axis=axis) * weight.reshape(shape)
    return result


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


def _texture_edge_weight(log_luma: np.ndarray, coarse: np.ndarray, coarse_radius: float) -> np.ndarray:
    guide = np.abs(log_luma - coarse).astype(np.float32)
    shifted = np.empty_like(coarse, dtype=np.float32)
    requested_reach = max(1, int(round(2.0 * coarse_radius)))

    for axis in (1, 0):
        reach = min(requested_reach, log_luma.shape[axis] - 1)
        if reach <= 0:
            continue
        for direction in (-1, 1):
            if axis == 1 and direction < 0:
                shifted[:, reach:] = coarse[:, :-reach]
                shifted[:, :reach] = coarse[:, :1]
            elif axis == 1:
                shifted[:, :-reach] = coarse[:, reach:]
                shifted[:, -reach:] = coarse[:, -1:]
            elif direction < 0:
                shifted[reach:, :] = coarse[:-reach, :]
                shifted[:reach, :] = coarse[:1, :]
            else:
                shifted[:-reach, :] = coarse[reach:, :]
                shifted[-reach:, :] = coarse[-1:, :]
            np.subtract(coarse, shifted, out=shifted)
            np.abs(shifted, out=shifted)
            np.maximum(guide, shifted, out=guide)

    np.divide(guide, _TEXTURE_EDGE_THRESHOLD_EV, out=guide)
    np.square(guide, out=guide)
    np.negative(guide, out=guide)
    np.exp(guide, out=guide)
    return guide


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
