from __future__ import annotations

import math

import numpy as np

from .models import GeometryAdjustments, OutputFinishingSettings, PreviewKind


def apply_geometry(image: np.ndarray, geometry: GeometryAdjustments) -> np.ndarray:
    """Apply the one shared, destructive geometry stage without inventing pixels."""
    crop = geometry.crop
    neutral_crop = crop.x == 0.0 and crop.y == 0.0 and crop.width == 1.0 and crop.height == 1.0
    if (
        geometry.rotation == 0
        and not geometry.flip_horizontal
        and not geometry.flip_vertical
        and geometry.straighten_angle == 0.0
        and neutral_crop
    ):
        return image

    result = image.astype(np.float32, copy=True)
    if geometry.rotation:
        # Persist positive quarter turns as clockwise, matching the editor labels.
        result = np.rot90(result, k=(-geometry.rotation // 90) % 4).copy()
    if geometry.flip_horizontal:
        result = np.flip(result, axis=1).copy()
    if geometry.flip_vertical:
        result = np.flip(result, axis=0).copy()
    if geometry.straighten_angle:
        result = _rotate_to_valid_pixels(result, geometry.straighten_angle)

    height, width = result.shape[:2]
    left = int(np.clip(round(crop.x * width), 0, width - 1))
    top = int(np.clip(round(crop.y * height), 0, height - 1))
    right = int(np.clip(round((crop.x + crop.width) * width), left + 1, width))
    bottom = int(np.clip(round((crop.y + crop.height) * height), top + 1, height))
    return np.ascontiguousarray(result[top:bottom, left:right], dtype=np.float32)


def geometry_coordinate_map(
    width: int,
    height: int,
    geometry: GeometryAdjustments,
) -> tuple[tuple[float, ...], tuple[float, ...], int, int]:
    """Return normalized output/source affine maps from the exact geometry path."""
    source_x = np.broadcast_to(
        (np.arange(width, dtype=np.float32) + np.float32(0.5)) / max(width, 1),
        (height, width),
    )
    source_y = np.broadcast_to(
        ((np.arange(height, dtype=np.float32) + np.float32(0.5)) / max(height, 1))[:, None],
        (height, width),
    )
    mapped = apply_geometry(np.stack((source_x, source_y), axis=-1), geometry)
    output_height, output_width = mapped.shape[:2]

    # Geometry is affine. Fit against interior pixel centers after running the
    # coordinate ramps through the real image operation so Pillow expansion,
    # the valid-pixel inset, crop rounding, flips, and quarter turns are all
    # represented by the same contract as the rendered frame.
    sample_x = np.unique(np.linspace(1, max(1, output_width - 2), 7).round().astype(int))
    sample_y = np.unique(np.linspace(1, max(1, output_height - 2), 7).round().astype(int))
    sample_x = np.clip(sample_x, 0, output_width - 1)
    sample_y = np.clip(sample_y, 0, output_height - 1)
    grid_x, grid_y = np.meshgrid(sample_x, sample_y)
    output_u = (grid_x.ravel().astype(np.float64) + 0.5) / max(output_width, 1)
    output_v = (grid_y.ravel().astype(np.float64) + 0.5) / max(output_height, 1)
    design = np.column_stack((output_u, output_v, np.ones_like(output_u)))
    samples = mapped[grid_y.ravel(), grid_x.ravel(), :].astype(np.float64)
    coefficients, *_ = np.linalg.lstsq(design, samples, rcond=None)
    output_to_source_matrix = np.array(
        [
            [coefficients[0, 0], coefficients[1, 0], coefficients[2, 0]],
            [coefficients[0, 1], coefficients[1, 1], coefficients[2, 1]],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    source_to_output_matrix = np.linalg.inv(output_to_source_matrix)
    output_to_source = tuple(float(value) for value in output_to_source_matrix[:2].ravel())
    source_to_output = tuple(float(value) for value in source_to_output_matrix[:2].ravel())
    return output_to_source, source_to_output, output_width, output_height


def _rotate_to_valid_pixels(image: np.ndarray, angle_degrees: float) -> np.ndarray:
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - Pillow is a required runtime dependency
        raise RuntimeError("Pillow is required for straightening") from exc

    height, width = image.shape[:2]
    channels: list[np.ndarray] = []
    for index in range(image.shape[2]):
        source = image[..., index].astype(np.float32, copy=False)
        rotated = Image.fromarray(source).rotate(
            float(angle_degrees), resample=Image.Resampling.BICUBIC, expand=True, fillcolor=0.0
        )
        channel = np.asarray(rotated, dtype=np.float32)
        channels.append(np.clip(channel, float(np.min(source)), float(np.max(source))))
    result = np.stack(channels, axis=-1)
    safe_width, safe_height = _largest_rotated_rectangle(width, height, math.radians(abs(angle_degrees)))
    # Bicubic support reaches two samples beyond the nominal coordinate. Keep a
    # two-pixel inset on each edge so even the resampling kernel sees source
    # pixels only; this is what guarantees there are no synthesized corners.
    safe_width = max(1, min(int(math.floor(safe_width)) - 4, result.shape[1]))
    safe_height = max(1, min(int(math.floor(safe_height)) - 4, result.shape[0]))
    left = (result.shape[1] - safe_width) // 2
    top = (result.shape[0] - safe_height) // 2
    return np.ascontiguousarray(result[top : top + safe_height, left : left + safe_width], dtype=np.float32)


def _largest_rotated_rectangle(width: int, height: int, angle: float) -> tuple[float, float]:
    """Largest centered axis-aligned rectangle containing only rotated source pixels."""
    if width <= 0 or height <= 0:
        return 0.0, 0.0
    sin_a = abs(math.sin(angle))
    cos_a = abs(math.cos(angle))
    if sin_a < 1e-9:
        return float(width), float(height)
    width_is_longer = width >= height
    side_long = float(width if width_is_longer else height)
    side_short = float(height if width_is_longer else width)
    if side_short <= 2.0 * sin_a * cos_a * side_long or abs(sin_a - cos_a) < 1e-9:
        half_short = 0.5 * side_short
        safe_width = half_short / sin_a if width_is_longer else half_short / cos_a
        safe_height = half_short / cos_a if width_is_longer else half_short / sin_a
    else:
        cos_2a = cos_a * cos_a - sin_a * sin_a
        safe_width = (width * cos_a - height * sin_a) / cos_2a
        safe_height = (height * cos_a - width * sin_a) / cos_2a
    return abs(safe_width), abs(safe_height)


def resolve_output_dimensions(
    width: int, height: int, settings: OutputFinishingSettings
) -> tuple[int, int]:
    if settings.resize_mode == "original":
        return width, height
    if settings.resize_mode == "long_edge":
        scale = float(settings.long_edge) / max(width, height)
    else:
        scale = min(float(settings.width) / width, float(settings.height) / height)
    if settings.prevent_enlargement:
        scale = min(1.0, scale)
    return max(1, int(round(width * scale))), max(1, int(round(height * scale)))


def apply_output_finishing(
    image: np.ndarray, settings: OutputFinishingSettings, kind: PreviewKind
) -> np.ndarray:
    height, width = image.shape[:2]
    target_width, target_height = resolve_output_dimensions(width, height, settings)
    result = image
    if (target_width, target_height) != (width, height):
        result = _resize_lanczos(result, target_width, target_height)
    if settings.sharpening != "off":
        result = _edge_aware_multiscale_sharpen(result, settings.sharpening, kind)
    upper = None if kind == PreviewKind.HDR else 1.0
    return np.nan_to_num(np.clip(result, 0.0, upper), nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def _resize_lanczos(image: np.ndarray, width: int, height: int) -> np.ndarray:
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Pillow is required for export resizing") from exc
    channels: list[np.ndarray] = []
    for index in range(image.shape[2]):
        source = image[..., index].astype(np.float32, copy=False)
        resized = Image.fromarray(source, mode="F").resize((width, height), Image.Resampling.LANCZOS)
        channel = np.asarray(resized, dtype=np.float32)
        channels.append(np.clip(channel, float(np.min(source)), float(np.max(source))))
    return np.stack(channels, axis=-1).astype(np.float32)


def _edge_aware_multiscale_sharpen(image: np.ndarray, strength: str, kind: PreviewKind) -> np.ndarray:
    if float(np.max(image) - np.min(image)) <= 1e-7:
        return image
    amounts = {
        "subtle": (0.22, 0.08),
        "standard": (0.38, 0.14),
        "strong": (0.58, 0.22),
    }
    fine_amount, medium_amount = amounts[strength]
    source_luma = _luminance(image, kind)
    if kind == PreviewKind.HDR:
        signal = np.log2(np.maximum(source_luma, 1e-7) / np.float32(0.18))
    else:
        signal = _srgb_encode(np.clip(source_luma, 0.0, 1.0))

    fine_base = _box_blur(signal, 1)
    medium_base = _box_blur(fine_base, 2)
    fine = signal - fine_base
    medium = fine_base - medium_base

    gradient_x = np.abs(np.diff(medium_base, axis=1, append=medium_base[:, -1:]))
    gradient_y = np.abs(np.diff(medium_base, axis=0, append=medium_base[-1:, :]))
    structure = np.sqrt(gradient_x * gradient_x + gradient_y * gradient_y)
    residual = _box_blur(np.abs(fine), 1)
    # Coherent structure wins over stochastic residuals, while ordinary texture
    # retains a conservative floor. Flat fields remain exactly unchanged.
    mask = np.clip(0.18 + 2.8 * structure / (structure + residual + 1e-6), 0.0, 1.0)
    mask = np.where((np.abs(fine) + np.abs(medium)) > 1e-7, mask, 0.0).astype(np.float32)
    detail = mask * (np.float32(fine_amount) * fine + np.float32(medium_amount) * medium)
    if not np.any(np.abs(detail) > 1e-7):
        return image

    local_min, local_max = _local_extrema(signal)
    allowance = np.float32(0.12 if strength != "strong" else 0.18) * (local_max - local_min)
    sharpened = np.clip(signal + detail, local_min - allowance, local_max + allowance)
    if kind == PreviewKind.HDR:
        target_luma = np.float32(0.18) * np.exp2(np.clip(sharpened, -32.0, 16.0))
    else:
        target_luma = _srgb_decode(np.clip(sharpened, 0.0, 1.0))
    gain = np.ones_like(source_luma, dtype=np.float32)
    np.divide(target_luma, source_luma, out=gain, where=source_luma > 1e-7)
    return (image.astype(np.float32, copy=False) * gain[..., None]).astype(np.float32)


def _luminance(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    weights = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32) if kind == PreviewKind.HDR else np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return np.einsum("...c,c->...", image[..., :3], weights, optimize=True).astype(np.float32)


def _box_blur(image: np.ndarray, radius: int) -> np.ndarray:
    result = image.astype(np.float32, copy=False)
    for axis in (0, 1):
        padded = np.pad(result, [(radius, radius), (radius, radius)], mode="edge") if axis == 0 else None
        if axis == 0:
            padded = padded[:, radius:-radius] if radius else padded
        else:
            padded = np.pad(result, [(0, 0), (radius, radius)], mode="edge")
        cumulative = np.cumsum(padded, axis=axis, dtype=np.float32)
        zero_shape = list(cumulative.shape)
        zero_shape[axis] = 1
        cumulative = np.concatenate([np.zeros(zero_shape, dtype=np.float32), cumulative], axis=axis)
        high = [slice(None), slice(None)]
        low = [slice(None), slice(None)]
        width = radius * 2 + 1
        high[axis] = slice(width, None)
        low[axis] = slice(None, -width)
        result = (cumulative[tuple(high)] - cumulative[tuple(low)]) / np.float32(width)
    return result.astype(np.float32)


def _local_extrema(signal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    padded = np.pad(signal, 1, mode="edge")
    neighborhoods = [padded[y : y + signal.shape[0], x : x + signal.shape[1]] for y in range(3) for x in range(3)]
    return np.minimum.reduce(neighborhoods), np.maximum.reduce(neighborhoods)


def _srgb_encode(value: np.ndarray) -> np.ndarray:
    clipped = np.clip(value, 0.0, 1.0)
    return np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055).astype(np.float32)


def _srgb_decode(value: np.ndarray) -> np.ndarray:
    clipped = np.clip(value, 0.0, 1.0)
    return np.where(clipped <= 0.04045, clipped / 12.92, np.power((clipped + 0.055) / 1.055, 2.4)).astype(np.float32)
