from __future__ import annotations

from io import BytesIO

import numpy as np

from .adjustments import apply_adjustments
from .models import AdjustmentState, OverlayMode, PreviewKind
from .preview import downsample_image


FALSE_COLOR_PRESETS: dict[str, dict[str, float]] = {
    "web_1000_100": {"reference_white_nits": 100.0, "peak_nits": 1000.0},
    "bt2408_1000_203": {"reference_white_nits": 203.0, "peak_nits": 1000.0},
    "bt2408_4000_203": {"reference_white_nits": 203.0, "peak_nits": 4000.0},
    "sdr_100": {"reference_white_nits": 100.0, "peak_nits": 100.0},
}


def render_overlay_bytes(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    long_edge: int,
    sdr_reference_image: np.ndarray | None = None,
) -> tuple[bytes, str]:
    if adjustments.shared.overlay_mode == OverlayMode.OFF:
        return b"", "image/png"

    processed = apply_adjustments(image, adjustments, kind, sdr_reference_image=sdr_reference_image)
    downsampled = downsample_image(processed, long_edge)
    overlay = build_overlay_rgba(downsampled, adjustments, kind)
    return _encode_overlay_png(overlay), "image/png"


def build_overlay_rgba(image: np.ndarray, adjustments: AdjustmentState, kind: PreviewKind) -> np.ndarray:
    mode = adjustments.shared.overlay_mode
    opacity = np.clip(np.float32(adjustments.shared.overlay_opacity), 0.0, 1.0)

    if mode == OverlayMode.FALSE_COLOR:
        return _false_color_overlay(image, adjustments, opacity, kind)
    if mode == OverlayMode.ZEBRA:
        threshold = np.float32(max(adjustments.shared.overlay_threshold, 1e-4))
        return _zebra_overlay(image, opacity, threshold, kind)
    height, width = image.shape[:2]
    return np.zeros((height, width, 4), dtype=np.uint8)


def _false_color_overlay(image: np.ndarray, adjustments: AdjustmentState, opacity: np.float32, kind: PreviewKind) -> np.ndarray:
    preset = FALSE_COLOR_PRESETS.get(adjustments.shared.overlay_preset, FALSE_COLOR_PRESETS["web_1000_100"])
    reference_white = np.float32(preset["reference_white_nits"])
    peak_nits = np.float32(preset["peak_nits"])
    luminance_nits = _luminance_nits(image, kind)

    bands = np.array(
        [
            reference_white * 0.1,
            reference_white * 0.25,
            reference_white * 0.5,
            reference_white,
            min(reference_white * 2.0, peak_nits * 0.5),
            peak_nits,
        ],
        dtype=np.float32,
    )
    normalized = np.clip(luminance_nits / max(peak_nits, 1e-4), 0.0, 1.0)

    palette = np.empty((*normalized.shape, 3), dtype=np.float32)
    palette[luminance_nits < bands[0]] = np.array([0.18, 0.0, 0.42], dtype=np.float32)
    palette[(luminance_nits >= bands[0]) & (luminance_nits < bands[1])] = np.array([0.0, 0.18, 0.85], dtype=np.float32)
    palette[(luminance_nits >= bands[1]) & (luminance_nits < bands[2])] = np.array([0.0, 0.62, 1.0], dtype=np.float32)
    palette[(luminance_nits >= bands[2]) & (luminance_nits < bands[3])] = np.array([0.0, 0.85, 0.35], dtype=np.float32)
    palette[(luminance_nits >= bands[3]) & (luminance_nits < bands[4])] = np.array([0.98, 0.88, 0.18], dtype=np.float32)
    palette[(luminance_nits >= bands[4]) & (luminance_nits < bands[5])] = np.array([1.0, 0.48, 0.12], dtype=np.float32)
    palette[luminance_nits >= bands[5]] = np.array([1.0, 0.12, 0.12], dtype=np.float32)

    alpha = np.full(normalized.shape, opacity * 255.0, dtype=np.float32)
    alpha = np.clip(alpha * (0.45 + 0.55 * normalized), 0.0, 255.0)
    return _stack_rgba(palette, alpha)


def _zebra_overlay(image: np.ndarray, opacity: np.float32, threshold: np.float32, kind: PreviewKind) -> np.ndarray:
    metric = _luminance(image, kind)
    hot = metric >= threshold
    if not np.any(hot):
        height, width = image.shape[:2]
        return np.zeros((height, width, 4), dtype=np.uint8)

    yy, xx = np.indices(metric.shape)
    stripes = ((xx + yy) // 10) % 2 == 0

    rgba = np.zeros((*metric.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.where(stripes[..., None], 255, 24).astype(np.uint8)
    rgba[..., 3] = np.where(hot, np.uint8(np.clip(opacity * 255.0, 0.0, 255.0)), 0)
    return rgba


def _luminance(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    image = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    if kind == PreviewKind.HDR:
        luminance = 0.2722287 * image[..., 0] + 0.6740818 * image[..., 1] + 0.0536895 * image[..., 2]
    else:
        luminance = 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]
    if kind == PreviewKind.HDR:
        return luminance / 0.18
    return np.clip(luminance, 0.0, 1.0)


def _luminance_nits(image: np.ndarray, kind: PreviewKind = PreviewKind.HDR) -> np.ndarray:
    image = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    if kind == PreviewKind.HDR:
        luminance = 0.2722287 * image[..., 0] + 0.6740818 * image[..., 1] + 0.0536895 * image[..., 2]
    else:
        luminance = 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]
    return (luminance / 0.18) * 100.0


def _stack_rgba(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    rgba = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(np.round(rgb * 255.0), 0.0, 255.0).astype(np.uint8)
    rgba[..., 3] = np.clip(np.round(alpha), 0.0, 255.0).astype(np.uint8)
    return rgba


def _encode_overlay_png(image: np.ndarray) -> bytes:
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow is required for overlay rendering.") from exc

    buffer = BytesIO()
    Image.fromarray(image).save(buffer, format="PNG")
    return buffer.getvalue()
