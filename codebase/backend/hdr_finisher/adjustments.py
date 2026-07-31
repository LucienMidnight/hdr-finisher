from __future__ import annotations

import numpy as np

from .color import acescg_to_linear_srgb
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
    result = _apply_hdr_base_adjustments(image, adjustments)
    result = _apply_luminance_section_controls(result, adjustments.hdr, PreviewKind.HDR)
    result = _apply_curves(result, adjustments, PreviewKind.HDR)
    return np.clip(result, 0.0, None)


def _apply_hdr_base_adjustments(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    hdr = adjustments.hdr
    result = image.astype(np.float32, copy=True)
    result *= np.float32(2.0 ** hdr.exposure)
    result = _rolloff_scene_highlights(result, hdr.highlight_rolloff)
    if hdr.shadow_lift != 0:
        luma = np.clip(0.2126 * result[..., 0] + 0.7152 * result[..., 1] + 0.0722 * result[..., 2], 0.0, 1.0)
        lift_factor = np.clip(hdr.shadow_lift * (1.0 - luma), None, 1.0)
        result = result * (1.0 + lift_factor[..., None])
    result = _apply_white_balance(result, hdr.white_balance_kelvin, hdr.tint)
    return result


def _apply_sdr_adjustments(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    sdr = adjustments.sdr
    result = np.clip(image.astype(np.float32, copy=True) * np.float32(2.0 ** sdr.exposure), 0.0, None)
    if sdr.shadow != 0:
        shadow_mask = 1.0 - _smoothstep(0.0, 0.5, _acescg_luma(result))
        result = np.clip(result + sdr.shadow * 0.08 * shadow_mask[..., None], 0.0, None)
    result = _tone_map_sdr(result, sdr.tone_mapper, sdr.tone_contrast, sdr.tone_skew)
    result = _apply_sdr_highlight_recovery(result, sdr.highlight_recovery)
    result = _apply_luminance_section_controls(result, sdr, PreviewKind.SDR)
    return _apply_curves(result, adjustments, PreviewKind.SDR)


def _apply_sdr_adjustments_to_reference(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    sdr = adjustments.sdr
    result = np.clip(image.astype(np.float32, copy=True), 0.0, 1.0)
    result *= np.float32(2.0 ** sdr.exposure)
    if sdr.shadow != 0:
        shadow_mask = 1.0 - _smoothstep(0.0, 0.5, _linear_luma(result))
        result = np.clip(result + sdr.shadow * 0.08 * shadow_mask[..., None], 0.0, None)
    result = _apply_sdr_highlight_recovery(result, sdr.highlight_recovery)
    result = _apply_luminance_section_controls(result, sdr, PreviewKind.SDR)
    return np.clip(_apply_curves(result, adjustments, PreviewKind.SDR), 0.0, 1.0)


def _apply_white_balance(image: np.ndarray, kelvin: int, tint: float) -> np.ndarray:
    temperature_offset = (kelvin - 6500) / 6500.0
    red_gain = 1.0 + (temperature_offset * 0.15)
    blue_gain = 1.0 - (temperature_offset * 0.15)
    green_gain = 1.0 + (tint * 0.08)
    gains = np.array([red_gain, green_gain, blue_gain], dtype=np.float32)
    return image * gains.reshape((1, 1, 3))


def _apply_luminance_section_controls(image: np.ndarray, branch_adjustments: object, kind: PreviewKind) -> np.ndarray:
    lift = float(getattr(branch_adjustments, "lift", 0.0))
    gamma = float(getattr(branch_adjustments, "gamma", 0.0))
    gain = float(getattr(branch_adjustments, "gain", 0.0))
    contrast = float(getattr(branch_adjustments, "contrast", 0.0))
    if lift == 0.0 and gamma == 0.0 and gain == 0.0 and contrast == 0.0:
        return image

    if kind == PreviewKind.HDR:
        return _apply_scene_luminance_controls(image, branch_adjustments)

    working = _curve_domain_encode(image.astype(np.float32, copy=True), kind)
    luma = np.clip(0.2126 * working[..., 0] + 0.7152 * working[..., 1] + 0.0722 * working[..., 2], 0.0, 1.0)
    target_luma = luma.copy()

    if contrast != 0.0:
        pivot = _contrast_pivot_in_curve_domain(branch_adjustments, kind)
        slope = np.float32(2.0 ** contrast)
        target_luma = (target_luma - pivot) * slope + pivot

    shadow_mask = 1.0 - _smoothstep(0.05, 0.65, luma)
    highlight_mask = _smoothstep(0.35, 0.95, luma)
    midtone_mask = np.clip(1.0 - np.abs(luma - 0.5) / 0.42, 0.0, 1.0) ** 2

    if lift != 0.0:
        target_luma += np.float32(lift) * shadow_mask
    if gamma != 0.0:
        exponent = np.float32(2.0 ** (-gamma))
        gamma_mapped = np.power(np.clip(target_luma, 0.0, 1.0), exponent)
        target_luma = target_luma * (1.0 - midtone_mask) + gamma_mapped * midtone_mask
    if gain != 0.0:
        if gain > 0:
            target_luma += np.float32(gain) * highlight_mask * (1.0 - target_luma)
        else:
            target_luma += np.float32(gain) * highlight_mask * target_luma

    target_luma = np.clip(target_luma, 0.0, 1.0)
    luma_ratio = np.where(luma > 1e-5, target_luma / np.maximum(luma, 1e-5), 0.0).astype(np.float32)
    working = np.where(luma[..., None] > 1e-5, working * luma_ratio[..., None], target_luma[..., None])
    return _curve_domain_decode(np.clip(working, 0.0, 1.0), kind)


def _apply_scene_luminance_controls(image: np.ndarray, branch_adjustments: object) -> np.ndarray:
    """Apply HDR primary controls as smooth stop offsets in scene-linear light."""
    result = image.astype(np.float32, copy=True)
    luma = _linear_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    pivot = np.float32(max(float(getattr(branch_adjustments, "contrast_pivot", 0.1845)), 1e-6))
    stops = np.log2(np.maximum(positive_luma, 1e-8) / pivot)
    target_stops = stops.copy()

    contrast = float(getattr(branch_adjustments, "contrast", 0.0))
    if contrast != 0.0:
        target_stops *= np.float32(2.0 ** contrast)

    shadow_mask = 1.0 - _smoothstep(-4.0, 0.0, stops)
    midtone_mask = np.exp2(-0.5 * (stops / 1.5) ** 2).astype(np.float32)
    highlight_mask = _smoothstep(0.0, 4.0, stops)

    # One unit represents two stops at the center of each luminance zone.
    target_stops += np.float32(2.0 * float(getattr(branch_adjustments, "lift", 0.0))) * shadow_mask
    target_stops += np.float32(2.0 * float(getattr(branch_adjustments, "gamma", 0.0))) * midtone_mask
    target_stops += np.float32(2.0 * float(getattr(branch_adjustments, "gain", 0.0))) * highlight_mask

    target_luma = pivot * np.exp2(np.clip(target_stops, -32.0, 32.0))
    ratio = np.where(positive_luma > 1e-8, target_luma / np.maximum(positive_luma, 1e-8), 1.0).astype(np.float32)
    return np.where(positive_luma[..., None] > 1e-8, result * ratio[..., None], result)


def _apply_sdr_highlight_recovery(image: np.ndarray, strength: float) -> np.ndarray:
    """Add a monotonic display shoulder while holding scene mid-gray stable."""
    if strength <= 0.0:
        return image
    result = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    luma = _linear_luma(result)
    amount = np.float32(0.4 * strength)
    pivot = np.float32(0.18)
    target_luma = luma * (1.0 + amount * pivot) / (1.0 + amount * luma)
    ratio = np.where(luma > 1e-8, target_luma / np.maximum(luma, 1e-8), 0.0).astype(np.float32)
    return result * ratio[..., None]


def _rolloff_scene_highlights(image: np.ndarray, strength: float) -> np.ndarray:
    """Apply a gradual HDR shoulder in stops without imposing a low hard ceiling."""
    if strength <= 0.0:
        return image
    result = image.astype(np.float32, copy=False)
    luma = _linear_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    highlight_stops = np.log2(np.maximum(positive_luma, 1.0))
    compressed_stops = highlight_stops / (1.0 + np.float32(strength) * highlight_stops / 40.0)
    target_luma = np.where(positive_luma > 1.0, np.exp2(compressed_stops), positive_luma)
    ratio = np.where(positive_luma > 1e-8, target_luma / np.maximum(positive_luma, 1e-8), 1.0).astype(np.float32)
    return np.where(positive_luma[..., None] > 1.0, result * ratio[..., None], result)


def _tone_map_sdr(
    image: np.ndarray,
    tone_mapper: ToneMapper,
    tone_contrast: float = 1.0,
    tone_skew: float = 0.0,
) -> np.ndarray:
    """Render scene-linear ACEScg into display-linear sRGB."""
    result = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    luma = _acescg_luma(result)
    if tone_mapper == ToneMapper.REINHARD:
        mapped_luma = luma / (1.0 + luma)
    elif tone_mapper == ToneMapper.ACES:
        a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
        mapped_luma = (luma * (a * luma + b)) / (luma * (c * luma + d) + e)
        mapped_luma /= a / c
    else:
        # This filmic sigmoid always passes through middle gray. Curve contrast
        # sets its overall steepness; skew varies the shadow and highlight
        # steepness independently while blending smoothly around middle gray.
        middle_gray = np.float32(0.18)
        base_power = np.float32(1.1 * np.clip(tone_contrast, 0.5, 1.5))
        skew = np.float32(np.clip(tone_skew, -1.0, 1.0))
        shadow_power = base_power * np.exp2(np.float32(-0.75) * skew)
        highlight_power = base_power * np.exp2(np.float32(0.75) * skew)
        log_exposure = np.log(np.maximum(luma, 1e-8) / middle_gray)
        highlight_blend = _smoothstep(-0.5, 0.5, log_exposure)
        local_power = shadow_power * (1.0 - highlight_blend) + highlight_power * highlight_blend
        middle_log_odds = np.log(middle_gray / (1.0 - middle_gray))
        log_odds = middle_log_odds + local_power * log_exposure
        mapped_luma = 1.0 / (1.0 + np.exp(-np.clip(log_odds, -32.0, 32.0)))
        mapped_luma = np.where(luma > 0.0, mapped_luma, 0.0)
    mapped_luma = np.clip(mapped_luma, 0.0, 1.0)
    ratio = np.where(luma > 1e-8, mapped_luma / np.maximum(luma, 1e-8), 0.0).astype(np.float32)
    display_rgb = acescg_to_linear_srgb(result * ratio[..., None])
    return _compress_to_srgb_gamut(display_rgb)


def _compress_to_srgb_gamut(image: np.ndarray) -> np.ndarray:
    """Reduce out-of-gamut chroma toward display luma without changing hue."""
    rgb = image.astype(np.float32, copy=False)
    luma = np.clip(_linear_luma(rgb), 0.0, 1.0)
    minimum = np.min(rgb, axis=-1)
    maximum = np.max(rgb, axis=-1)
    scale = np.ones_like(luma, dtype=np.float32)

    below_black = minimum < 0.0
    scale = np.where(
        below_black,
        np.minimum(scale, luma / np.maximum(luma - minimum, 1e-8)),
        scale,
    )
    above_white = maximum > 1.0
    scale = np.where(
        above_white,
        np.minimum(scale, (1.0 - luma) / np.maximum(maximum - luma, 1e-8)),
        scale,
    )
    compressed = luma[..., None] + (rgb - luma[..., None]) * np.clip(scale[..., None], 0.0, 1.0)
    return np.clip(compressed, 0.0, 1.0)


def _linear_luma(image: np.ndarray) -> np.ndarray:
    return 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]


def _acescg_luma(image: np.ndarray) -> np.ndarray:
    return 0.2722287 * image[..., 0] + 0.6740818 * image[..., 1] + 0.0536895 * image[..., 2]


def _contrast_pivot_in_curve_domain(branch_adjustments: object, kind: PreviewKind) -> np.float32:
    pivot = float(getattr(branch_adjustments, "contrast_pivot", 0.5))
    if kind == PreviewKind.HDR:
        encoded = _curve_domain_encode(np.array([[[max(pivot, 0.0)] * 3]], dtype=np.float32), kind)
        return np.float32(encoded[0, 0, 0])
    return np.float32(np.clip(pivot, 0.0, 1.0))


def _smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _apply_curves(image: np.ndarray, adjustments: AdjustmentState, kind: PreviewKind) -> np.ndarray:
    branch = adjustments.hdr if kind == PreviewKind.HDR else adjustments.sdr
    if getattr(branch, "curves_enabled", False):
        return _apply_curve_set(image, branch, kind)
    return _apply_legacy_shared_curves(image, adjustments, kind)


def _apply_legacy_shared_curves(image: np.ndarray, adjustments: AdjustmentState, kind: PreviewKind) -> np.ndarray:
    shared = adjustments.shared
    if not shared.curves_enabled or shared.active_focus != kind:
        return image
    return _apply_curve_set(image, shared, kind)


def _apply_curve_set(image: np.ndarray, curve_source: object, kind: PreviewKind) -> np.ndarray:
    result = image.astype(np.float32, copy=True)
    working = _curve_domain_encode(result, kind)

    luma_curve = _normalize_curve_points(getattr(curve_source, "luma_curve"))
    red_curve = _normalize_curve_points(getattr(curve_source, "red_curve"))
    green_curve = _normalize_curve_points(getattr(curve_source, "green_curve"))
    blue_curve = _normalize_curve_points(getattr(curve_source, "blue_curve"))

    luma_x = luma_curve[:, 0]
    luma_y = luma_curve[:, 1]
    red_lut_x, red_lut_y = _build_curve_lut(red_curve)
    green_lut_x, green_lut_y = _build_curve_lut(green_curve)
    blue_lut_x, blue_lut_y = _build_curve_lut(blue_curve)
    luma_lut_x, luma_lut_y = _build_curve_lut(luma_curve)

    luma = _linear_luma(working)
    curve_luma = np.clip(luma, 0.0, 1.0)
    interpolated_luma = np.interp(curve_luma, luma_lut_x, luma_lut_y, left=luma_y[0], right=luma_y[-1]).astype(np.float32)
    mapped_luma = np.where((luma >= 0.0) & (luma <= 1.0), interpolated_luma, luma)
    luma_gain = np.where(np.abs(luma) > 1e-5, mapped_luma / luma, 1.0).astype(np.float32)
    working *= luma_gain[..., None]

    for channel_index, (curve, lut_x, lut_y) in enumerate(
        ((red_curve, red_lut_x, red_lut_y), (green_curve, green_lut_x, green_lut_y), (blue_curve, blue_lut_x, blue_lut_y))
    ):
        channel = working[..., channel_index]
        interpolated = np.interp(np.clip(channel, 0.0, 1.0), lut_x, lut_y, left=curve[0, 1], right=curve[-1, 1]).astype(
            np.float32
        )
        working[..., channel_index] = np.where((channel >= 0.0) & (channel <= 1.0), interpolated, channel)

    return _curve_domain_decode(working, kind)


HDR_CURVE_MAX = 10.0


def _curve_domain_encode(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        denominator = np.float32(np.log2(1.0 + HDR_CURVE_MAX))
        return np.sign(image) * np.log2(np.float32(1.0) + np.abs(image)) / denominator
    return np.clip(image, 0.0, 1.0)


def _curve_domain_decode(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        denominator = np.float32(np.log2(1.0 + HDR_CURVE_MAX))
        return np.sign(image) * (np.power(np.float32(2.0), np.abs(image) * denominator) - np.float32(1.0))
    return np.clip(image, 0.0, 1.0)


def _normalize_curve_points(points: list[list[float]]) -> np.ndarray:
    curve = np.asarray(points, dtype=np.float32)
    if curve.ndim != 2 or curve.shape[1] != 2 or curve.shape[0] < 2 or curve.shape[0] > 16:
        raise ValueError("Curves must contain between 2 and 16 [x, y] control points.")
    curve = curve[np.argsort(curve[:, 0])]
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
