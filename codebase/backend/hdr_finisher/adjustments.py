from __future__ import annotations

import numpy as np
from colour.models import eotf_inverse_sRGB

from .models import AdjustmentState, PreviewKind, ToneMapper


def apply_adjustments(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    sdr_reference_image: np.ndarray | None = None,
) -> np.ndarray:
    if kind == PreviewKind.HDR:
        return _apply_hdr_adjustments(image, adjustments)
    if sdr_reference_image is not None:
        return _apply_sdr_adjustments_to_reference(sdr_reference_image, adjustments)
    return _apply_sdr_adjustments(image, adjustments)


def _apply_hdr_adjustments(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    hdr = adjustments.hdr
    result = image.astype(np.float32, copy=True)
    result *= np.float32(2.0 ** hdr.exposure)
    if hdr.highlight_rolloff > 0:
        threshold = 1.0
        excess = np.clip(result - threshold, 0.0, None)
        result = np.where(result > threshold, threshold + excess / (1.0 + hdr.highlight_rolloff * excess), result)
    if hdr.shadow_lift != 0:
        luma = np.clip(0.2126 * result[..., 0] + 0.7152 * result[..., 1] + 0.0722 * result[..., 2], 0.0, 1.0)
        lift_factor = np.clip(hdr.shadow_lift * (1.0 - luma), None, 1.0)
        result = result * (1.0 + lift_factor[..., None])
    result = _apply_white_balance(result, hdr.white_balance_kelvin, hdr.tint)
    result = _apply_shared_curves(result, adjustments, PreviewKind.HDR)
    return np.clip(result, 0.0, None)


def _apply_sdr_adjustments(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    sdr = adjustments.sdr
    hdr_adjusted = _apply_hdr_adjustments(image, adjustments)
    result = hdr_adjusted * np.float32(2.0 ** sdr.exposure)
    if sdr.highlight_recovery > 0:
        result = np.power(np.clip(result, 0.0, 1.0), 1.0 + (sdr.highlight_recovery * 0.5))
    if sdr.shadow != 0:
        result = np.clip(result + sdr.shadow * 0.08, 0.0, 1.0)
    if sdr.contrast != 0:
        midpoint = 0.5
        result = np.clip((result - midpoint) * (1.0 + sdr.contrast * 0.6) + midpoint, 0.0, 1.0)
    if sdr.tone_mapper == ToneMapper.REINHARD:
        result = result / (1.0 + result)
    else:
        a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
        result = np.clip((result * (a * result + b)) / (result * (c * result + d) + e), 0.0, 1.0)
    return _apply_shared_curves(result, adjustments, PreviewKind.SDR)


def _apply_sdr_adjustments_to_reference(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    sdr = adjustments.sdr
    result = np.clip(image.astype(np.float32, copy=True), 0.0, 1.0)
    result *= np.float32(2.0 ** sdr.exposure)
    if sdr.shadow != 0:
        result = np.clip(result + sdr.shadow * 0.08, 0.0, 1.0)
    if sdr.contrast != 0:
        midpoint = 0.5
        result = np.clip((result - midpoint) * (1.0 + sdr.contrast * 0.6) + midpoint, 0.0, 1.0)
    if sdr.highlight_recovery > 0:
        result = np.power(np.clip(result, 0.0, 1.0), 1.0 + (sdr.highlight_recovery * 0.35))
    return np.clip(_apply_shared_curves(result, adjustments, PreviewKind.SDR), 0.0, 1.0)


def _apply_white_balance(image: np.ndarray, kelvin: int, tint: float) -> np.ndarray:
    temperature_offset = (kelvin - 6500) / 6500.0
    red_gain = 1.0 + (temperature_offset * 0.15)
    blue_gain = 1.0 - (temperature_offset * 0.15)
    green_gain = 1.0 + (tint * 0.08)
    gains = np.array([red_gain, green_gain, blue_gain], dtype=np.float32)
    return image * gains.reshape((1, 1, 3))


def _apply_shared_curves(image: np.ndarray, adjustments: AdjustmentState, kind: PreviewKind) -> np.ndarray:
    shared = adjustments.shared
    if not shared.curves_enabled or shared.active_focus != kind:
        return image

    result = image.astype(np.float32, copy=True)
    working = _curve_domain_encode(result, kind)

    luma_curve = _normalize_curve_points(shared.luma_curve)
    red_curve = _normalize_curve_points(shared.red_curve)
    green_curve = _normalize_curve_points(shared.green_curve)
    blue_curve = _normalize_curve_points(shared.blue_curve)

    luma_x = luma_curve[:, 0]
    luma_y = luma_curve[:, 1]
    red_lut_x, red_lut_y = _build_curve_lut(red_curve)
    green_lut_x, green_lut_y = _build_curve_lut(green_curve)
    blue_lut_x, blue_lut_y = _build_curve_lut(blue_curve)
    luma_lut_x, luma_lut_y = _build_curve_lut(luma_curve)

    luma = np.clip(0.2126 * working[..., 0] + 0.7152 * working[..., 1] + 0.0722 * working[..., 2], 0.0, 1.0)
    mapped_luma = np.interp(luma, luma_lut_x, luma_lut_y, left=luma_y[0], right=luma_y[-1]).astype(np.float32)
    luma_gain = np.where(luma > 1e-5, mapped_luma / luma, 1.0).astype(np.float32)
    working *= luma_gain[..., None]
    working = np.clip(working, 0.0, 1.0)

    for channel_index, (curve, lut_x, lut_y) in enumerate(
        ((red_curve, red_lut_x, red_lut_y), (green_curve, green_lut_x, green_lut_y), (blue_curve, blue_lut_x, blue_lut_y))
    ):
        working[..., channel_index] = np.interp(
            working[..., channel_index], lut_x, lut_y, left=curve[0, 1], right=curve[-1, 1]
        ).astype(np.float32)

    return _curve_domain_decode(np.clip(working, 0.0, 1.0), kind)


HDR_CURVE_MAX = 10.0


def _curve_domain_encode(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        return np.clip(np.log2(1.0 + np.clip(image, 0.0, None)) / np.log2(1.0 + HDR_CURVE_MAX), 0.0, 1.0)
    return np.clip(image, 0.0, 1.0)


def _curve_domain_decode(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        return np.clip(np.power(2.0, image * np.log2(1.0 + HDR_CURVE_MAX)) - 1.0, 0.0, None)
    return np.clip(image, 0.0, 1.0)


def _normalize_curve_points(points: list[list[float]]) -> np.ndarray:
    curve = np.asarray(points, dtype=np.float32)
    if curve.shape != (5, 2):
        raise ValueError("Curves must contain exactly five [x, y] control points.")
    curve[:, 0] = np.clip(curve[:, 0], 0.0, 1.0)
    curve[:, 1] = np.clip(curve[:, 1], 0.0, 1.0)
    curve[0, 0] = 0.0
    curve[-1, 0] = 1.0
    for index in range(1, curve.shape[0] - 1):
        curve[index, 0] = np.clip(curve[index, 0], curve[index - 1, 0] + 0.02, curve[index + 1, 0] - 0.02)
    return curve


def _build_curve_lut(points: np.ndarray, samples: int = 1024) -> tuple[np.ndarray, np.ndarray]:
    x = points[:, 0].astype(np.float32)
    y = points[:, 1].astype(np.float32)
    sample_x = np.linspace(0.0, 1.0, samples, dtype=np.float32)
    sample_y = _monotone_cubic_interpolate(x, y, sample_x)
    return sample_x, np.clip(sample_y, 0.0, 1.0).astype(np.float32)


def _monotone_cubic_interpolate(x: np.ndarray, y: np.ndarray, sample_x: np.ndarray) -> np.ndarray:
    h = np.diff(x)
    delta = np.diff(y) / np.maximum(h, 1e-6)
    slopes = np.zeros_like(y)
    slopes[0] = delta[0]
    slopes[-1] = delta[-1]

    for index in range(1, len(y) - 1):
        if delta[index - 1] == 0.0 or delta[index] == 0.0 or np.sign(delta[index - 1]) != np.sign(delta[index]):
            slopes[index] = 0.0
        else:
            w1 = 2.0 * h[index] + h[index - 1]
            w2 = h[index] + 2.0 * h[index - 1]
            slopes[index] = (w1 + w2) / ((w1 / delta[index - 1]) + (w2 / delta[index]))

    indices = np.clip(np.searchsorted(x, sample_x, side="right") - 1, 0, len(x) - 2)
    x0 = x[indices]
    x1 = x[indices + 1]
    y0 = y[indices]
    y1 = y[indices + 1]
    m0 = slopes[indices]
    m1 = slopes[indices + 1]
    segment = np.maximum(x1 - x0, 1e-6)
    t = (sample_x - x0) / segment
    t2 = t * t
    t3 = t2 * t

    h00 = 2.0 * t3 - 3.0 * t2 + 1.0
    h10 = t3 - 2.0 * t2 + t
    h01 = -2.0 * t3 + 3.0 * t2
    h11 = t3 - t2
    return h00 * y0 + h10 * segment * m0 + h01 * y1 + h11 * segment * m1
