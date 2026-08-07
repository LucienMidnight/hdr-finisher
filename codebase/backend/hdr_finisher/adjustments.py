from __future__ import annotations

import numpy as np

from .color import acescg_to_linear_srgb, linear_srgb_to_acescg, rgb_primaries_adjustment_matrix
from .models import AdjustmentState, PreviewKind, ToneMapper


TONE_EQUALIZER_MIN_EV = -6
TONE_EQUALIZER_MAX_EV = 6
TONE_EQUALIZER_BAND_COUNT = TONE_EQUALIZER_MAX_EV - TONE_EQUALIZER_MIN_EV + 1
TONE_EQUALIZER_MAX_ADJUSTMENT_EV = 2.0
_TONE_EQUALIZER_MIN_TARGET_STEP = np.float32(1e-3)


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
    if hdr.tone_section_enabled:
        result = _apply_hdr_base_adjustments(result, adjustments)
        result = _apply_luminance_section_controls(
            result, hdr, PreviewKind.HDR, apply_primaries=False, apply_contrast=True
        )
    if hdr.color_section_enabled:
        result = _apply_hdr_color(result, hdr)
    if hdr.tone_equalizer_section_enabled:
        result = _apply_hdr_tone_equalizer(result, hdr)
    if hdr.primaries_section_enabled:
        result = _apply_luminance_section_controls(
            result, hdr, PreviewKind.HDR, apply_primaries=True, apply_contrast=False
        )
    if hdr.curves_section_enabled:
        result = _apply_curves(result, adjustments, PreviewKind.HDR)
    return np.clip(result, 0.0, None)


def _apply_hdr_color(image: np.ndarray, hdr) -> np.ndarray:
    if _color_settings_are_neutral(hdr):
        return image
    result = _apply_white_balance(image, hdr.white_balance_kelvin, hdr.tint)
    primary_matrix = rgb_primaries_adjustment_matrix(
        hdr.red_hue,
        hdr.red_purity,
        hdr.green_hue,
        hdr.green_purity,
        hdr.blue_hue,
        hdr.blue_purity,
        hdr.tint_hue,
        hdr.tint_purity,
    )
    result = np.einsum("...c,dc->...d", result, primary_matrix, optimize=True).astype(np.float32)
    return _apply_saturation_vibrance(result, hdr.saturation, hdr.vibrance)


def _color_settings_are_neutral(settings: object) -> bool:
    return int(getattr(settings, "white_balance_kelvin", 6500)) == 6500 and all(
        float(getattr(settings, field, 0.0)) == 0.0
        for field in (
            "tint",
            "saturation",
            "vibrance",
            "red_hue",
            "red_purity",
            "green_hue",
            "green_purity",
            "blue_hue",
            "blue_purity",
            "tint_hue",
            "tint_purity",
        )
    )


def _apply_saturation_vibrance(image: np.ndarray, saturation: float, vibrance: float) -> np.ndarray:
    if saturation == 0 and vibrance == 0:
        return image
    luma = _acescg_luma(image)[..., None]
    chroma = image - luma
    maximum = np.max(image, axis=-1, keepdims=True)
    minimum = np.min(image, axis=-1, keepdims=True)
    denominator = np.maximum.reduce((np.abs(maximum), np.abs(minimum), np.abs(luma), np.full_like(luma, 1e-6)))
    relative_chroma = np.clip((maximum - minimum) / denominator, 0.0, 1.0)
    vibrance_weight = np.square(1.0 - relative_chroma)
    vibrance_factor = np.maximum(0.0, 1.0 + np.float32(vibrance) * vibrance_weight)
    saturation_factor = max(0.0, 1.0 + float(saturation))
    return (luma + chroma * vibrance_factor * np.float32(saturation_factor)).astype(np.float32)


def _apply_hdr_base_adjustments(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    hdr = adjustments.hdr
    result = image.astype(np.float32, copy=True)
    result *= np.float32(2.0 ** hdr.exposure)
    result = _rolloff_scene_highlights(result, hdr.highlight_rolloff, hdr.highlight_rolloff_start_nits)
    if hdr.shadow_lift != 0:
        luma = np.clip(_acescg_luma(result), 0.0, 1.0)
        lift_factor = np.clip(hdr.shadow_lift * (1.0 - luma), None, 1.0)
        result = result * (1.0 + lift_factor[..., None])
    return result


def _apply_sdr_adjustments(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    sdr = adjustments.sdr
    result = image.astype(np.float32, copy=True)
    if sdr.tone_section_enabled:
        result = np.clip(result * np.float32(2.0 ** sdr.exposure), 0.0, None)
    if sdr.tone_section_enabled and sdr.shadow != 0:
        shadow_mask = 1.0 - _smoothstep(0.0, 0.5, _acescg_luma(result))
        result = np.clip(result + sdr.shadow * 0.08 * shadow_mask[..., None], 0.0, None)
    if _sdr_color_is_enabled(adjustments):
        result = _apply_hdr_color(result, _effective_sdr_color_settings(adjustments))
    tone_mapper = sdr.tone_mapper if sdr.base_section_enabled else ToneMapper.FILMIC
    tone_contrast = sdr.tone_contrast if sdr.base_section_enabled else 1.0
    tone_skew = sdr.tone_skew if sdr.base_section_enabled else 0.0
    result = _tone_map_sdr(result, tone_mapper, tone_contrast, tone_skew)
    if sdr.tone_section_enabled:
        result = _apply_sdr_highlight_recovery(result, sdr.highlight_recovery)
        result = _apply_luminance_section_controls(
            result, sdr, PreviewKind.SDR, apply_primaries=False, apply_contrast=True
        )
    if sdr.primaries_section_enabled:
        result = _apply_luminance_section_controls(
            result, sdr, PreviewKind.SDR, apply_primaries=True, apply_contrast=False
        )
    return _apply_curves(result, adjustments, PreviewKind.SDR) if sdr.curves_section_enabled else result


def _apply_sdr_adjustments_to_reference(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    sdr = adjustments.sdr
    result = np.clip(image.astype(np.float32, copy=True), 0.0, 1.0)
    if sdr.tone_section_enabled:
        result *= np.float32(2.0 ** sdr.exposure)
    if sdr.tone_section_enabled and sdr.shadow != 0:
        shadow_mask = 1.0 - _smoothstep(0.0, 0.5, _linear_luma(result))
        result = np.clip(result + sdr.shadow * 0.08 * shadow_mask[..., None], 0.0, None)
    if sdr.base_section_enabled:
        result = _retone_map_sdr_reference(
            result,
            sdr.tone_mapper,
            sdr.tone_contrast,
            sdr.tone_skew,
        )
    if sdr.tone_section_enabled:
        result = _apply_sdr_highlight_recovery(result, sdr.highlight_recovery)
        result = _apply_luminance_section_controls(
            result, sdr, PreviewKind.SDR, apply_primaries=False, apply_contrast=True
        )
    if _sdr_color_is_enabled(adjustments):
        acescg = linear_srgb_to_acescg(result)
        graded = _apply_hdr_color(acescg, _effective_sdr_color_settings(adjustments))
        result = _compress_to_srgb_gamut(acescg_to_linear_srgb(graded))
    if sdr.primaries_section_enabled:
        result = _apply_luminance_section_controls(
            result, sdr, PreviewKind.SDR, apply_primaries=True, apply_contrast=False
        )
    if sdr.curves_section_enabled:
        result = _apply_curves(result, adjustments, PreviewKind.SDR)
    return np.clip(result, 0.0, 1.0)


def _effective_sdr_color_settings(adjustments: AdjustmentState):
    return adjustments.hdr if adjustments.sdr.match_hdr_color else adjustments.sdr


def _sdr_color_is_enabled(adjustments: AdjustmentState) -> bool:
    if not adjustments.sdr.color_section_enabled:
        return False
    if adjustments.sdr.match_hdr_color and not adjustments.hdr.color_section_enabled:
        return False
    return not _color_settings_are_neutral(_effective_sdr_color_settings(adjustments))


def _apply_white_balance(image: np.ndarray, kelvin: int, tint: float) -> np.ndarray:
    temperature_offset = (kelvin - 6500) / 6500.0
    red_gain = 1.0 + (temperature_offset * 0.15)
    blue_gain = 1.0 - (temperature_offset * 0.15)
    green_gain = 1.0 + (tint * 0.08)
    gains = np.array([red_gain, green_gain, blue_gain], dtype=np.float32)
    return image * gains.reshape((1, 1, 3))


def _apply_luminance_section_controls(
    image: np.ndarray,
    branch_adjustments: object,
    kind: PreviewKind,
    *,
    apply_primaries: bool = True,
    apply_contrast: bool = True,
) -> np.ndarray:
    lift = float(getattr(branch_adjustments, "lift", 0.0)) if apply_primaries else 0.0
    gamma = float(getattr(branch_adjustments, "gamma", 0.0)) if apply_primaries else 0.0
    gain = float(getattr(branch_adjustments, "gain", 0.0)) if apply_primaries else 0.0
    contrast = float(getattr(branch_adjustments, "contrast", 0.0)) if apply_contrast else 0.0
    if lift == 0.0 and gamma == 0.0 and gain == 0.0 and contrast == 0.0:
        return image

    if kind == PreviewKind.HDR:
        return _apply_scene_luminance_controls(
            image,
            branch_adjustments,
            apply_primaries=apply_primaries,
            apply_contrast=apply_contrast,
        )

    # SDR primaries should feel perceptually uniform even though the pipeline stores
    # linear-light pixels. Work on an encoded luma signal, then scale linear RGB
    # together so the adjustment remains hue preserving.
    working = np.clip(image.astype(np.float32, copy=True), 0.0, 1.0)
    linear_luma = np.clip(_linear_luma(working), 0.0, 1.0)
    luma = _srgb_encode(linear_luma)
    target_luma = luma.copy()

    if contrast != 0.0:
        pivot = _contrast_pivot_in_curve_domain(branch_adjustments, kind)
        # A full slider unit is one half-stop of contrast slope. The previous
        # one-stop mapping was excessively strong for scene-linear sources.
        slope = np.float32(2.0 ** (contrast * 0.5))
        target_luma = (target_luma - pivot) * slope + pivot

    zone_stops = np.log2(np.maximum(luma, 1e-6) / np.float32(0.5))
    shadow_mask, midtone_mask, highlight_mask = _primary_zone_masks(zone_stops, branch_adjustments)

    if lift != 0.0:
        # Lift is an intentionally fine toe offset rather than a direct linear
        # addition. At full travel it moves the encoded black region by 0.125.
        target_luma += np.float32(lift * 0.25) * shadow_mask
    if gamma != 0.0:
        exponent = np.float32(2.0 ** (-gamma))
        gamma_mapped = np.power(np.clip(target_luma, 0.0, 1.0), exponent)
        target_luma = target_luma * (1.0 - midtone_mask) + gamma_mapped * midtone_mask
    if gain != 0.0:
        if gain > 0:
            target_luma += np.float32(gain) * highlight_mask * (1.0 - target_luma)
        else:
            target_luma += np.float32(gain) * highlight_mask * target_luma

    target_linear_luma = _srgb_decode(np.clip(target_luma, 0.0, 1.0))
    luma_ratio = np.where(
        linear_luma > 1e-6,
        target_linear_luma / np.maximum(linear_luma, 1e-6),
        0.0,
    ).astype(np.float32)
    return np.where(
        linear_luma[..., None] > 1e-6,
        working * luma_ratio[..., None],
        target_linear_luma[..., None],
    )


def _apply_scene_luminance_controls(
    image: np.ndarray,
    branch_adjustments: object,
    *,
    apply_primaries: bool = True,
    apply_contrast: bool = True,
) -> np.ndarray:
    """Apply HDR primary controls as smooth stop offsets in scene-linear light."""
    result = image.astype(np.float32, copy=True)
    luma = _acescg_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    pivot = np.float32(max(float(getattr(branch_adjustments, "contrast_pivot", 0.1845)), 1e-6))
    stops = np.log2(np.maximum(positive_luma, 1e-8) / pivot)
    target_stops = stops.copy()

    contrast = float(getattr(branch_adjustments, "contrast", 0.0)) if apply_contrast else 0.0
    if contrast != 0.0:
        target_stops *= np.float32(2.0 ** contrast)

    shadow_mask, midtone_mask, highlight_mask = _primary_zone_masks(stops, branch_adjustments)

    # One unit represents two stops at the center of each luminance zone.
    if apply_primaries:
        target_stops += np.float32(2.0 * float(getattr(branch_adjustments, "lift", 0.0))) * shadow_mask
        target_stops += np.float32(2.0 * float(getattr(branch_adjustments, "gamma", 0.0))) * midtone_mask
        target_stops += np.float32(2.0 * float(getattr(branch_adjustments, "gain", 0.0))) * highlight_mask

    target_luma = pivot * np.exp2(np.clip(target_stops, -32.0, 32.0))
    ratio = np.where(positive_luma > 1e-8, target_luma / np.maximum(positive_luma, 1e-8), 1.0).astype(np.float32)
    return np.where(positive_luma[..., None] > 1e-8, result * ratio[..., None], result)


def _apply_hdr_tone_equalizer(image: np.ndarray, hdr_adjustments: object) -> np.ndarray:
    """Apply fixed scene-referred EV-band exposure corrections without clipping HDR headroom."""
    if not bool(getattr(hdr_adjustments, "tone_equalizer_enabled", False)):
        return image

    node_ev, corrections = _tone_equalizer_nodes(hdr_adjustments)
    if not np.any(corrections):
        return image

    result = image.astype(np.float32, copy=True)
    luma = _acescg_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    input_ev = np.log2(np.maximum(positive_luma, 1e-8) / np.float32(0.18))
    target_ev = _sample_tone_equalizer_target_ev(
        input_ev,
        node_ev,
        corrections,
        float(getattr(hdr_adjustments, "tone_equalizer_smoothing", 0.5)),
    )
    target_luma = np.float32(0.18) * np.exp2(np.clip(target_ev, -32.0, 32.0))
    ratio = np.where(positive_luma > 1e-8, target_luma / np.maximum(positive_luma, 1e-8), 1.0).astype(np.float32)
    return np.where(positive_luma[..., None] > 1e-8, result * ratio[..., None], result)


def _primary_zone_masks(stops: np.ndarray, branch_adjustments: object) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lift_pivot = float(getattr(branch_adjustments, "lift_pivot", -2.0))
    lift_range = max(float(getattr(branch_adjustments, "lift_range", 4.0)), 0.5)
    gamma_pivot = float(getattr(branch_adjustments, "gamma_pivot", 0.0))
    gamma_range = max(float(getattr(branch_adjustments, "gamma_range", 4.25)), 0.5)
    gain_pivot = float(getattr(branch_adjustments, "gain_pivot", 2.0))
    gain_range = max(float(getattr(branch_adjustments, "gain_range", 4.0)), 0.5)
    shadow = 1.0 - _smoothstep(lift_pivot - lift_range / 2.0, lift_pivot + lift_range / 2.0, stops)
    sigma = np.float32(max(gamma_range / 2.355, 0.1))
    midtone = np.exp(-0.5 * ((stops - np.float32(gamma_pivot)) / sigma) ** 2).astype(np.float32)
    highlight = _smoothstep(gain_pivot - gain_range / 2.0, gain_pivot + gain_range / 2.0, stops)
    return shadow.astype(np.float32), midtone, highlight.astype(np.float32)


def _tone_equalizer_nodes(hdr_adjustments: object) -> tuple[np.ndarray, np.ndarray]:
    nodes = getattr(hdr_adjustments, "tone_equalizer_nodes", [])
    if not 2 <= len(nodes) <= 16:
        positions = np.array([TONE_EQUALIZER_MIN_EV, TONE_EQUALIZER_MAX_EV], dtype=np.float32)
        return positions, np.zeros(2, dtype=np.float32)
    positions = np.asarray([float(getattr(node, "input_ev", 0.0)) for node in nodes], dtype=np.float32)
    corrections = np.asarray([float(getattr(node, "adjustment_ev", 0.0)) for node in nodes], dtype=np.float32)
    order = np.argsort(positions)
    positions = positions[order]
    corrections = np.clip(corrections[order], -TONE_EQUALIZER_MAX_ADJUSTMENT_EV, TONE_EQUALIZER_MAX_ADJUSTMENT_EV)
    positions[0] = np.float32(TONE_EQUALIZER_MIN_EV)
    positions[-1] = np.float32(TONE_EQUALIZER_MAX_EV)
    return positions, corrections


def _tone_equalizer_targets(node_ev: np.ndarray, corrections: np.ndarray) -> np.ndarray:
    targets = node_ev + corrections.astype(np.float32, copy=False)
    # API clients can bypass the graph's drag constraints. Keep their mappings
    # ordered as a final safety guard so tonal values never reverse.
    for index in range(1, targets.size):
        targets[index] = max(targets[index], targets[index - 1] + _TONE_EQUALIZER_MIN_TARGET_STEP)
    return targets


def _sample_tone_equalizer_target_ev(
    input_ev: np.ndarray,
    node_ev: np.ndarray,
    corrections: np.ndarray,
    smoothing: float,
) -> np.ndarray:
    targets = _tone_equalizer_targets(node_ev, corrections)
    clipped_ev = np.clip(input_ev, TONE_EQUALIZER_MIN_EV, TONE_EQUALIZER_MAX_EV)
    segment = np.clip(np.searchsorted(node_ev, clipped_ev, side="right") - 1, 0, len(node_ev) - 2)
    widths = np.maximum(np.diff(node_ev), np.float32(1e-4))
    local = (clipped_ev - node_ev[segment]) / widths[segment]

    deltas = np.diff(targets) / widths
    slopes = np.empty_like(targets)
    slopes[0] = deltas[0]
    slopes[-1] = deltas[-1]
    for index in range(1, targets.size - 1):
        previous = deltas[index - 1]
        following = deltas[index]
        slopes[index] = (
            np.float32(0.0)
            if previous <= 0.0 or following <= 0.0
            else np.float32(2.0) * previous * following / (previous + following)
        )

    y0 = targets[segment]
    y1 = targets[segment + 1]
    segment_width = widths[segment]
    m0 = slopes[segment] * segment_width
    m1 = slopes[segment + 1] * segment_width
    local2 = local * local
    local3 = local2 * local
    cubic = (
        ((np.float32(2.0) * local3) - (np.float32(3.0) * local2) + np.float32(1.0)) * y0
        + (local3 - (np.float32(2.0) * local2) + local) * m0
        + ((-np.float32(2.0) * local3) + (np.float32(3.0) * local2)) * y1
        + (local3 - local2) * m1
    )
    linear = y0 + (y1 - y0) * local
    amount = np.float32(np.clip(smoothing, 0.0, 1.0))
    mapped = linear * (np.float32(1.0) - amount) + cubic * amount

    # Outside the editable range, continue the nearest band's exposure offset.
    lower_correction = targets[0] - node_ev[0]
    upper_correction = targets[-1] - node_ev[-1]
    mapped = np.where(input_ev < TONE_EQUALIZER_MIN_EV, input_ev + lower_correction, mapped)
    mapped = np.where(input_ev > TONE_EQUALIZER_MAX_EV, input_ev + upper_correction, mapped)
    return mapped.astype(np.float32, copy=False)


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


def _rolloff_scene_highlights(image: np.ndarray, strength: float, start_nits: float = 400.0) -> np.ndarray:
    """Apply a continuous logarithmic HDR shoulder above a luminance-defined start."""
    if strength <= 0.0:
        return image
    result = image.astype(np.float32, copy=False)
    luma = _acescg_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    start = np.float32(max(start_nits, 1.0) * 0.18 / 100.0)
    # Scale the UI amount so a single slider step remains subtle while the
    # upper end still provides a materially stronger shoulder than the legacy control.
    amount = np.float32(max(strength, 0.0) / 50.0)
    excess = np.maximum(positive_luma - start, 0.0)
    compressed = np.log1p(amount * excess) / amount
    target_luma = np.where(positive_luma > start, start + compressed, positive_luma)
    ratio = np.where(positive_luma > 1e-8, target_luma / np.maximum(positive_luma, 1e-8), 1.0).astype(np.float32)
    return np.where(positive_luma[..., None] > start, result * ratio[..., None], result)


def _tone_map_sdr(
    image: np.ndarray,
    tone_mapper: ToneMapper,
    tone_contrast: float = 1.0,
    tone_skew: float = 0.0,
) -> np.ndarray:
    """Render scene-linear ACEScg into display-linear sRGB."""
    result = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    luma = _acescg_luma(result)
    mapped_luma = _map_sdr_luma(luma, tone_mapper, tone_contrast, tone_skew)
    ratio = np.where(luma > 1e-8, mapped_luma / np.maximum(luma, 1e-8), 0.0).astype(np.float32)
    display_rgb = acescg_to_linear_srgb(result * ratio[..., None])
    return _compress_to_srgb_gamut(display_rgb)


def _retone_map_sdr_reference(
    image: np.ndarray,
    tone_mapper: ToneMapper,
    tone_contrast: float = 1.0,
    tone_skew: float = 0.0,
) -> np.ndarray:
    """Apply Base Rendition controls to an authored display-linear SDR image.

    The embedded SDR rendition is already tone mapped. Treat it as the output
    of the neutral filmic curve, invert that curve to recover a stable scene
    luminance estimate, then apply the selected curve. This makes the neutral
    defaults an exact identity while keeping the controls meaningful for HEIC
    sources that contain their own SDR rendition.
    """
    result = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    if tone_mapper == ToneMapper.FILMIC and tone_contrast == 1.0 and tone_skew == 0.0:
        return result

    luma = _linear_luma(result)
    bounded_luma = np.clip(luma, 1e-7, 1.0 - 1e-7)
    middle_gray = np.float32(0.18)
    middle_log_odds = np.log(middle_gray / (1.0 - middle_gray))
    reference_log_odds = np.log(bounded_luma / (1.0 - bounded_luma))
    scene_luma = middle_gray * np.exp(np.clip((reference_log_odds - middle_log_odds) / 1.1, -32.0, 32.0))
    scene_luma = np.where(luma > 0.0, scene_luma, 0.0).astype(np.float32)
    mapped_luma = _map_sdr_luma(scene_luma, tone_mapper, tone_contrast, tone_skew)
    ratio = np.where(luma > 1e-8, mapped_luma / np.maximum(luma, 1e-8), 0.0).astype(np.float32)
    return np.clip(result * ratio[..., None], 0.0, 1.0)


def _map_sdr_luma(
    luma: np.ndarray,
    tone_mapper: ToneMapper,
    tone_contrast: float = 1.0,
    tone_skew: float = 0.0,
) -> np.ndarray:
    """Map non-negative scene luminance into the normalized SDR range."""
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
    return np.clip(mapped_luma, 0.0, 1.0).astype(np.float32)


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


def _srgb_encode(value: np.ndarray) -> np.ndarray:
    positive = np.clip(value.astype(np.float32, copy=False), 0.0, 1.0)
    return np.where(
        positive <= 0.0031308,
        positive * np.float32(12.92),
        np.float32(1.055) * np.power(positive, np.float32(1.0 / 2.4)) - np.float32(0.055),
    ).astype(np.float32)


def _srgb_decode(value: np.ndarray) -> np.ndarray:
    encoded = np.clip(value.astype(np.float32, copy=False), 0.0, 1.0)
    return np.where(
        encoded <= 0.04045,
        encoded / np.float32(12.92),
        np.power((encoded + np.float32(0.055)) / np.float32(1.055), np.float32(2.4)),
    ).astype(np.float32)


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

    luma = _acescg_luma(working) if kind == PreviewKind.HDR else _linear_luma(working)
    if kind == PreviewKind.HDR:
        mapped_luma = _sample_curve_extended(luma, luma_curve, luma_lut_x, luma_lut_y)
    else:
        curve_luma = np.clip(luma, 0.0, 1.0)
        mapped_luma = np.interp(
            curve_luma, luma_lut_x, luma_lut_y, left=luma_y[0], right=luma_y[-1]
        ).astype(np.float32)
    luma_gain = np.where(np.abs(luma) > 1e-5, mapped_luma / luma, 1.0).astype(np.float32)
    working *= luma_gain[..., None]

    for channel_index, (curve, lut_x, lut_y) in enumerate(
        ((red_curve, red_lut_x, red_lut_y), (green_curve, green_lut_x, green_lut_y), (blue_curve, blue_lut_x, blue_lut_y))
    ):
        channel = working[..., channel_index]
        if kind == PreviewKind.HDR:
            working[..., channel_index] = _sample_curve_extended(channel, curve, lut_x, lut_y)
        else:
            working[..., channel_index] = np.interp(
                np.clip(channel, 0.0, 1.0), lut_x, lut_y, left=curve[0, 1], right=curve[-1, 1]
            ).astype(np.float32)

    return _curve_domain_decode(working, kind)


HDR_CURVE_REFERENCE_WHITE = np.float32(0.18)
HDR_CURVE_MAX_NITS = np.float32(10000.0)
HDR_CURVE_STOP_SPAN = np.float32(np.log2(HDR_CURVE_MAX_NITS / 100.0))


def _curve_domain_encode(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        value = image.astype(np.float32, copy=False)
        positive = np.maximum(value, 0.0)
        below_white = np.float32(0.5) * positive / HDR_CURVE_REFERENCE_WHITE
        above_white = np.float32(0.5) + np.float32(0.5) * (
            np.log2(np.maximum(positive, HDR_CURVE_REFERENCE_WHITE) / HDR_CURVE_REFERENCE_WHITE)
            / HDR_CURVE_STOP_SPAN
        )
        encoded = np.where(positive <= HDR_CURVE_REFERENCE_WHITE, below_white, above_white)
        return np.where(value >= 0.0, encoded, value / (np.float32(2.0) * HDR_CURVE_REFERENCE_WHITE))
    return np.clip(image, 0.0, 1.0)


def _curve_domain_decode(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        value = image.astype(np.float32, copy=False)
        below_white = value * np.float32(2.0) * HDR_CURVE_REFERENCE_WHITE
        above_white = HDR_CURVE_REFERENCE_WHITE * np.exp2(
            (value - np.float32(0.5)) * np.float32(2.0) * HDR_CURVE_STOP_SPAN
        )
        return np.where(value <= np.float32(0.5), below_white, above_white)
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


def _sample_curve_extended(
    values: np.ndarray,
    curve: np.ndarray,
    lut_x: np.ndarray,
    lut_y: np.ndarray,
) -> np.ndarray:
    clipped = np.clip(values, 0.0, 1.0)
    sampled = np.interp(clipped, lut_x, lut_y).astype(np.float32)
    lower_span = max(float(curve[1, 0] - curve[0, 0]), 1e-6)
    upper_span = max(float(curve[-1, 0] - curve[-2, 0]), 1e-6)
    lower_slope = np.float32((curve[1, 1] - curve[0, 1]) / lower_span)
    upper_slope = np.float32((curve[-1, 1] - curve[-2, 1]) / upper_span)
    sampled = np.where(values < 0.0, curve[0, 1] + values * lower_slope, sampled)
    sampled = np.where(values > 1.0, curve[-1, 1] + (values - 1.0) * upper_slope, sampled)
    return sampled.astype(np.float32, copy=False)


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
