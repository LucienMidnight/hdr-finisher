from __future__ import annotations

from io import BytesIO

import numpy as np

from .color_context import RenderColorContext, scene_linear_to_nits
from .models import AdjustmentState, OverlayMode, PreviewKind

FALSE_COLOR_PALETTE = np.array(
    [
        [0.18, 0.0, 0.42],
        [0.0, 0.18, 0.85],
        [0.0, 0.62, 1.0],
        [0.0, 0.85, 0.35],
        [0.98, 0.88, 0.18],
        [1.0, 0.48, 0.12],
        [1.0, 0.12, 0.12],
    ],
    dtype=np.float32,
)


def encode_processed_overlay_bytes(
    processed: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    color_context: RenderColorContext | None = None,
) -> tuple[bytes, str]:
    if adjustments.shared.overlay_mode == OverlayMode.OFF:
        return b"", "image/png"
    return _encode_overlay_png(build_overlay_rgba(processed, adjustments, kind, color_context=color_context)), "image/png"


def build_overlay_rgba(image: np.ndarray, adjustments: AdjustmentState, kind: PreviewKind, *, color_context: RenderColorContext | None = None) -> np.ndarray:
    context = color_context or RenderColorContext()
    mode = adjustments.shared.overlay_mode
    opacity = np.clip(np.float32(adjustments.shared.overlay_opacity), 0.0, 1.0)

    if mode == OverlayMode.FALSE_COLOR:
        return _false_color_overlay(image, adjustments, opacity, kind, context)
    if mode == OverlayMode.ZEBRA:
        threshold_nits = np.float32(max(adjustments.shared.overlay_threshold, 1.0))
        return _zebra_overlay(image, opacity, threshold_nits, kind, context)
    height, width = image.shape[:2]
    return np.zeros((height, width, 4), dtype=np.uint8)


def _false_color_overlay(image: np.ndarray, adjustments: AdjustmentState, opacity: np.float32, kind: PreviewKind, color_context: RenderColorContext) -> np.ndarray:
    anchor = adjustments.shared.false_color_band_anchor
    reference_white = np.float32(color_context.hdr_reference_white_nits if anchor == "project" else (100 if anchor == "100_nits" else 203))
    peak_nits = np.float32(adjustments.shared.false_color_ceiling_nits)
    analysis_context = color_context if anchor == "project" else RenderColorContext(int(reference_white))
    luminance_nits = _luminance_nits(image, kind, analysis_context)

    highlight_start = max(reference_white, min(reference_white * 2.0, peak_nits * 0.5))
    bands = np.array(
        [
            reference_white * 0.1,
            reference_white * 0.25,
            reference_white * 0.5,
            reference_white,
            highlight_start,
            peak_nits,
        ],
        dtype=np.float32,
    )
    # A reference white above the ceiling would leave the boundaries out of order; searchsorted needs them sorted.
    bands = np.maximum.accumulate(bands)
    # One band index per pixel: band i covers [bands[i - 1], bands[i]), with the last colour above the ceiling.
    band_index = np.searchsorted(bands, luminance_nits, side="right")
    palette = FALSE_COLOR_PALETTE[band_index]

    normalized = np.clip(luminance_nits / max(peak_nits, 1e-4), 0.0, 1.0)
    alpha = opacity * 255.0 * (0.45 + 0.55 * normalized)
    return _stack_rgba(palette, alpha)


def _zebra_overlay(image: np.ndarray, opacity: np.float32, threshold_nits: np.float32, kind: PreviewKind, color_context: RenderColorContext) -> np.ndarray:
    metric_nits = _luminance_nits(image, kind, color_context)
    hot = metric_nits >= threshold_nits
    if not np.any(hot):
        height, width = image.shape[:2]
        return np.zeros((height, width, 4), dtype=np.uint8)

    yy, xx = np.indices(metric_nits.shape)
    stripes = ((xx + yy) // 10) % 2 == 0

    rgba = np.zeros((*metric_nits.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.where(stripes[..., None], 255, 24).astype(np.uint8)
    rgba[..., 3] = np.where(hot, np.uint8(np.clip(opacity * 255.0, 0.0, 255.0)), 0)
    return rgba


def _luminance_nits(image: np.ndarray, kind: PreviewKind = PreviewKind.HDR, color_context: RenderColorContext | None = None) -> np.ndarray:
    image = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    if kind == PreviewKind.HDR:
        luminance = 0.2722287 * image[..., 0] + 0.6740818 * image[..., 1] + 0.0536895 * image[..., 2]
    else:
        luminance = 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]
    if kind == PreviewKind.SDR:
        return luminance * 100.0
    context = color_context or RenderColorContext()
    return scene_linear_to_nits(luminance, context.hdr_reference_white_nits)


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
