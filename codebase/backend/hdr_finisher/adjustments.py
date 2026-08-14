from __future__ import annotations

import numpy as np

from .color import acescg_to_linear_srgb, linear_srgb_to_acescg, rgb_primaries_adjustment_matrix
from .finishing import apply_geometry
from .models import AdjustmentState, LocalAdjustment, PreviewKind, ToneMapper


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
    *,
    include_grain: bool = True,
    local_adjustments: list[LocalAdjustment] | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
) -> np.ndarray:
    geometry = adjustments.shared.geometry
    fixed_source = apply_geometry(image, geometry)
    if kind == PreviewKind.HDR:
        return _apply_hdr_adjustments(
            fixed_source,
            adjustments,
            include_grain,
            local_adjustments=local_adjustments,
            fixed_source=fixed_source,
            compiled_local_masks=compiled_local_masks,
        )
    if sdr_reference_image is not None:
        reference = apply_geometry(sdr_reference_image, geometry)
        return _apply_sdr_adjustments_to_reference(
            reference,
            adjustments,
            include_grain,
            local_adjustments=local_adjustments,
            fixed_source=fixed_source,
            compiled_local_masks=compiled_local_masks,
        )
    return _apply_sdr_adjustments(
        fixed_source,
        adjustments,
        include_grain,
        local_adjustments=local_adjustments,
        fixed_source=fixed_source,
        compiled_local_masks=compiled_local_masks,
    )


def _apply_hdr_adjustments(
    image: np.ndarray,
    adjustments: AdjustmentState,
    include_grain: bool = True,
    *,
    local_adjustments: list[LocalAdjustment] | None = None,
    fixed_source: np.ndarray | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
) -> np.ndarray:
    hdr = adjustments.hdr
    result = image.astype(np.float32, copy=True)
    if hdr.tone_section_enabled:
        result = _apply_hdr_base_adjustments(result, adjustments)
        result = _apply_luminance_section_controls(
            result, hdr, PreviewKind.HDR, apply_primaries=False, apply_contrast=True
        )
    if hdr.highlight_section_enabled:
        if hdr.highlight_compression_mode == "peak_fit":
            result = _compress_scene_highlights(
                result,
                hdr.highlight_compression_start_nits,
                hdr.highlight_compression_target_nits,
                hdr.highlight_compression_softness,
                mode="peak_fit",
                source_peak_nits=_tone_adjusted_source_peak_nits(hdr, tone_enabled=hdr.tone_section_enabled),
                peak_detail=hdr.highlight_compression_peak_detail,
                bias=hdr.highlight_compression_bias,
                color_handling=hdr.highlight_compression_color_handling,
            )
        elif hdr.highlight_compression_mode == "soft_ceiling":
            result = _compress_scene_highlights(
                result,
                hdr.highlight_compression_start_nits,
                hdr.highlight_compression_target_nits,
                hdr.highlight_compression_softness,
                mode="soft_ceiling",
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
    if hdr.color_grading_section_enabled:
        result = _apply_color_grading(result, hdr.color_grading, PreviewKind.HDR)
    if local_adjustments:
        from .local_adjustments import apply_local_stack

        result = apply_local_stack(
            result,
            image if fixed_source is None else fixed_source,
            local_adjustments,
            PreviewKind.HDR,
            adjustments.shared.geometry,
            compiled_masks=compiled_local_masks,
        )
    if hdr.film_look_section_enabled:
        result = _apply_film_look(result, adjustments, PreviewKind.HDR, include_grain=False)
    if hdr.vignette_section_enabled:
        result = _apply_vignette(result, hdr.vignette, PreviewKind.HDR)
    if include_grain:
        result = apply_final_grain(result, adjustments, PreviewKind.HDR)
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
    if hdr.shadow_lift != 0:
        luma = np.clip(_acescg_luma(result), 0.0, 1.0)
        lift_factor = np.clip(hdr.shadow_lift * (1.0 - luma), None, 1.0)
        result = result * (1.0 + lift_factor[..., None])
    return result


def _tone_adjusted_source_peak_nits(hdr: object, *, tone_enabled: bool = True) -> float:
    """Predict the measured source peak after controls preceding Peak Fit."""
    peak = max(float(getattr(hdr, "highlight_compression_source_peak_nits", 1000.0)), 1.0)
    if not tone_enabled:
        return peak
    peak_linear = peak * 0.18 / 100.0 * (2.0 ** float(getattr(hdr, "exposure", 0.0)))
    shadow_lift = float(getattr(hdr, "shadow_lift", 0.0))
    if shadow_lift != 0.0:
        lift_factor = float(np.clip(shadow_lift * (1.0 - np.clip(peak_linear, 0.0, 1.0)), None, 1.0))
        peak_linear *= 1.0 + lift_factor
    contrast = float(getattr(hdr, "contrast", 0.0))
    if contrast != 0.0 and peak_linear > 1e-8:
        pivot = max(float(getattr(hdr, "contrast_pivot", 0.1845)), 1e-6)
        stops = np.log2(max(peak_linear, 1e-8) / pivot)
        peak_linear = pivot * float(np.exp2(np.clip(stops * (2.0 ** contrast), -32.0, 32.0)))
    return max(1.0, peak_linear * 100.0 / 0.18)


def _apply_sdr_adjustments(
    image: np.ndarray,
    adjustments: AdjustmentState,
    include_grain: bool = True,
    *,
    local_adjustments: list[LocalAdjustment] | None = None,
    fixed_source: np.ndarray | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
) -> np.ndarray:
    sdr = adjustments.sdr
    result = image.astype(np.float32, copy=True)
    if sdr.tone_section_enabled:
        result = np.clip(result * np.float32(2.0 ** sdr.exposure), 0.0, None)
    if sdr.tone_section_enabled and sdr.shadow != 0:
        shadow_mask = 1.0 - _smoothstep(0.0, 0.5, _acescg_luma(result))
        result = np.clip(result + sdr.shadow * 0.08 * shadow_mask[..., None], 0.0, None)
    if _sdr_color_is_enabled(adjustments):
        result = _apply_hdr_color(result, adjustments.sdr)
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
    if sdr.curves_section_enabled:
        result = _apply_curves(result, adjustments, PreviewKind.SDR)
    if sdr.color_grading_section_enabled:
        result = _apply_color_grading(result, sdr.color_grading, PreviewKind.SDR)
    if local_adjustments:
        from .local_adjustments import apply_local_stack

        result = apply_local_stack(
            result,
            image if fixed_source is None else fixed_source,
            local_adjustments,
            PreviewKind.SDR,
            adjustments.shared.geometry,
            compiled_masks=compiled_local_masks,
        )
    if sdr.film_look_section_enabled:
        result = _apply_film_look(result, adjustments, PreviewKind.SDR, include_grain=False)
    if sdr.vignette_section_enabled:
        result = _apply_vignette(result, sdr.vignette, PreviewKind.SDR)
    if include_grain:
        result = apply_final_grain(result, adjustments, PreviewKind.SDR)
    return np.clip(result, 0.0, 1.0)


def _apply_sdr_adjustments_to_reference(
    image: np.ndarray,
    adjustments: AdjustmentState,
    include_grain: bool = True,
    *,
    local_adjustments: list[LocalAdjustment] | None = None,
    fixed_source: np.ndarray | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
) -> np.ndarray:
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
        graded = _apply_hdr_color(acescg, adjustments.sdr)
        result = _compress_to_srgb_gamut(acescg_to_linear_srgb(graded))
    if sdr.primaries_section_enabled:
        result = _apply_luminance_section_controls(
            result, sdr, PreviewKind.SDR, apply_primaries=True, apply_contrast=False
        )
    if sdr.curves_section_enabled:
        result = _apply_curves(result, adjustments, PreviewKind.SDR)
    if sdr.color_grading_section_enabled:
        result = _apply_color_grading(result, sdr.color_grading, PreviewKind.SDR)
    if local_adjustments:
        from .local_adjustments import apply_local_stack

        result = apply_local_stack(
            result,
            image if fixed_source is None else fixed_source,
            local_adjustments,
            PreviewKind.SDR,
            adjustments.shared.geometry,
            compiled_masks=compiled_local_masks,
        )
    if sdr.film_look_section_enabled:
        result = _apply_film_look(result, adjustments, PreviewKind.SDR, include_grain=False)
    if sdr.vignette_section_enabled:
        result = _apply_vignette(result, sdr.vignette, PreviewKind.SDR)
    if include_grain:
        result = apply_final_grain(result, adjustments, PreviewKind.SDR)
    return np.clip(result, 0.0, 1.0)


def _sdr_color_is_enabled(adjustments: AdjustmentState) -> bool:
    if not adjustments.sdr.color_section_enabled:
        return False
    return not _color_settings_are_neutral(adjustments.sdr)


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
    """Compatibility wrapper for the former 0..2 highlight-rolloff control."""
    return _compress_scene_highlights(image, start_nits, 1000.0, max(0.0, strength) * 50.0)


def _compress_scene_highlights(
    image: np.ndarray,
    start_nits: float = 400.0,
    target_nits: float = 1000.0,
    softness: float = 0.0,
    *,
    mode: str = "soft_ceiling",
    source_peak_nits: float = 1000.0,
    peak_detail: float = 35.0,
    bias: float = 0.0,
    color_handling: str = "preserve_color",
) -> np.ndarray:
    """Compress luminance above ``start_nits`` smoothly toward ``target_nits``."""
    if mode == "off" or (mode == "soft_ceiling" and softness <= 0.0):
        return image
    result = image.astype(np.float32, copy=False)
    luma = _acescg_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    start = np.float32(max(start_nits, 1.0) * 0.18 / 100.0)
    target = np.float32(max(target_nits, start_nits + 1.0) * 0.18 / 100.0)
    if mode == "peak_fit":
        peak = np.float32(max(source_peak_nits, target_nits) * 0.18 / 100.0)
        if peak <= target:
            return image
        start_stop = float(np.log2(start))
        target_stop = float(np.log2(target))
        peak_stop = float(np.log2(peak))
        detail = min(max(float(peak_detail) / 100.0, 0.0), 1.0)
        curve_bias = min(max(float(bias) / 100.0, -1.0), 1.0) * 0.6
        required_ratio = (
            1.0 / (1.0 + curve_bias) + detail / (1.0 - curve_bias)
        ) / 3.0
        required_ratio = min(max(required_ratio, 0.001), 0.95)
        requested_ratio = (target_stop - start_stop) / max(peak_stop - start_stop, 1e-6)
        effective_start_stop = start_stop
        if requested_ratio < required_ratio:
            effective_start_stop = (target_stop - required_ratio * peak_stop) / (1.0 - required_ratio)
        effective_start = np.float32(2.0 ** effective_start_stop)
        input_stop = np.log2(np.maximum(positive_luma, effective_start))
        u = np.clip((input_stop - effective_start_stop) / max(peak_stop - effective_start_stop, 1e-6), 0.0, 1.0)
        w = np.clip(u + curve_bias * u * (1.0 - u), 0.0, 1.0)
        stop_span = target_stop - effective_start_stop
        normalized_start_slope = (peak_stop - effective_start_stop) / max(stop_span * (1.0 + curve_bias), 1e-6)
        normalized_end_slope = detail * (peak_stop - effective_start_stop) / max(stop_span * (1.0 - curve_bias), 1e-6)
        h10 = w * (1.0 - w) * (1.0 - w)
        h01 = w * w * (3.0 - 2.0 * w)
        h11 = w * w * (w - 1.0)
        mapped_normalized = h10 * normalized_start_slope + h01 + h11 * normalized_end_slope
        mapped_stop = effective_start_stop + stop_span * mapped_normalized
        target_luma = np.where(
            positive_luma > effective_start,
            np.exp2(mapped_stop).astype(np.float32),
            positive_luma,
        )
        ratio = np.where(positive_luma > 1e-8, target_luma / np.maximum(positive_luma, 1e-8), 1.0).astype(np.float32)
        mapped = np.where(positive_luma[..., None] > effective_start, result * ratio[..., None], result)
        if color_handling == "path_to_white":
            # AgX-inspired, but deliberately simpler: progressively reduce
            # chroma through the Peak Fit shoulder and guarantee that no ACEScg
            # channel exceeds Target Peak. Luminance and the tone curve remain
            # unchanged; only the highlight color trajectory differs.
            neutral = target_luma[..., None]
            progress = u * u * (np.float32(3.0) - np.float32(2.0) * u)
            path_scale = np.float32(1.0) - progress
            maximum_chroma = np.max(mapped, axis=-1) - target_luma
            channel_scale = np.where(
                maximum_chroma > 1e-8,
                np.clip((target - target_luma) / np.maximum(maximum_chroma, 1e-8), 0.0, 1.0),
                1.0,
            ).astype(np.float32)
            chroma_scale = np.minimum(path_scale, channel_scale)
            color_mapped = neutral + (mapped - neutral) * chroma_scale[..., None]
            mapped = np.where(positive_luma[..., None] > effective_start, color_mapped, mapped)
        return mapped.astype(np.float32, copy=False)

    span = np.float32(target - start)
    excess = np.maximum(positive_luma - start, 0.0)
    normalized = excess / span
    # A generalized soft ceiling preserves unit slope at the start and approaches
    # the selected target without clipping. Higher softness makes the shoulder
    # engage earlier; lower values keep more contrast until close to the target.
    exponent = np.float32(2.0 ** (5.0 * (1.0 - min(max(softness, 0.0), 100.0) / 100.0)))
    compressed_normalized = np.zeros_like(normalized, dtype=np.float32)
    lower = (normalized > 0.0) & (normalized <= 1.0)
    upper = normalized > 1.0
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        compressed_normalized[lower] = normalized[lower] / np.power(
            1.0 + np.power(normalized[lower], exponent), 1.0 / exponent
        )
        compressed_normalized[upper] = 1.0 / np.power(
            1.0 + np.power(1.0 / normalized[upper], exponent), 1.0 / exponent
        )
    compressed_normalized = np.where(compressed_normalized > 0.99999, 1.0, compressed_normalized)
    activation = np.float32(min(max(softness / 10.0, 0.0), 1.0))
    activation = activation * activation * (np.float32(3.0) - np.float32(2.0) * activation)
    compressed_excess = (
        span * compressed_normalized
        if activation >= 1.0
        else excess + activation * (span * compressed_normalized - excess)
    )
    target_luma = np.where(positive_luma > start, start + compressed_excess, positive_luma)
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
    if _curve_set_is_neutral(branch):
        return image
    return _apply_curve_set(image, branch, kind)


def _apply_film_look(
    image: np.ndarray, adjustments: AdjustmentState, kind: PreviewKind, *, include_grain: bool = True
) -> np.ndarray:
    """Apply the finishing look after curves, with grain deliberately last."""
    branch = adjustments.hdr if kind == PreviewKind.HDR else adjustments.sdr
    look = branch.film_look
    strength = np.float32(look.look_strength / 100.0)
    active = any(
        (
            look.print_strength,
            look.color_density,
            look.halation_amount if look.halation_enabled else 0.0,
            look.bloom_amount if look.bloom_enabled else 0.0,
            look.image_softness if look.image_structure_enabled else 0.0,
            look.microcontrast if look.image_structure_enabled else 0.0,
            100.0 - look.film_resolution if look.grain_enabled else 0.0,
            look.grain_amount if look.grain_enabled else 0.0,
        )
    )
    if not active and not (look.halation_enabled and look.halation_view_map):
        return image

    result = image.astype(np.float32, copy=True)
    result = _apply_film_response(result, look, kind, strength)

    if look.halation_enabled:
        result, halation_map = _apply_halation(result, look, kind, strength)
        if look.halation_view_map:
            return halation_map
    if look.bloom_enabled and look.bloom_amount > 0.0 and strength > 0.0:
        result = _apply_bloom(result, look, kind, strength)
    if look.image_structure_enabled:
        result = _apply_image_structure(result, look, kind, strength)
    if look.grain_enabled:
        result = _apply_film_resolution(result, look, strength)
        if include_grain and look.grain_amount > 0.0 and strength > 0.0:
            result = _apply_density_grain(result, look, kind, adjustments.shared.film_grain_seed, strength)
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def apply_final_grain(image: np.ndarray, adjustments: AdjustmentState, kind: PreviewKind) -> np.ndarray:
    """Synthesize deterministic film grain at the current (preview or final export) resolution."""
    branch = adjustments.hdr if kind == PreviewKind.HDR else adjustments.sdr
    if not branch.film_look_section_enabled:
        return image
    look = branch.film_look
    strength = np.float32(look.look_strength / 100.0)
    if not look.grain_enabled or look.grain_amount <= 0.0 or strength <= 0.0:
        return image
    return _apply_density_grain(image, look, kind, adjustments.shared.film_grain_seed, strength)


def _apply_color_grading(image: np.ndarray, grading: object, kind: PreviewKind) -> np.ndarray:
    wheels = (grading.shadows, grading.midtones, grading.highlights)
    if all(wheel.saturation == 0.0 and wheel.luminance_ev == 0.0 for wheel in wheels):
        return image
    weights = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32) if kind == PreviewKind.HDR else np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    source_luma = np.maximum(_acescg_luma(image) if kind == PreviewKind.HDR else _linear_luma(image), 0.0)
    if kind == PreviewKind.HDR:
        zone_signal = np.log2(np.maximum(source_luma, 1e-7) / np.float32(0.18))
    else:
        zone_signal = np.log2(np.maximum(_srgb_encode(np.clip(source_luma, 0.0, 1.0)), 1e-7) / np.float32(0.5))
    balance = np.float32(grading.balance / 50.0)
    width = np.float32(0.55 + 3.45 * grading.blending / 100.0)
    shadow = 1.0 - _smoothstep(float(-1.0 + balance - width * 0.5), float(-1.0 + balance + width * 0.5), zone_signal)
    highlight = _smoothstep(float(1.0 + balance - width * 0.5), float(1.0 + balance + width * 0.5), zone_signal)
    midtone = np.maximum(0.0, 1.0 - shadow - highlight)
    masks = np.stack((shadow, midtone, highlight), axis=-1).astype(np.float32)
    masks /= np.maximum(np.sum(masks, axis=-1, keepdims=True), 1e-6)

    tint = np.zeros_like(image, dtype=np.float32)
    luminance_ev = np.zeros_like(source_luma, dtype=np.float32)
    for index, wheel in enumerate(wheels):
        angle = np.deg2rad(np.float32(wheel.hue))
        vector = np.array(
            [np.cos(angle), np.cos(angle - 2.0 * np.pi / 3.0), np.cos(angle + 2.0 * np.pi / 3.0)],
            dtype=np.float32,
        )
        vector -= np.dot(vector, weights)
        vector /= max(float(np.max(np.abs(vector))), 1e-6)
        tint += masks[..., index, None] * vector * np.float32(wheel.saturation / 400.0)
        luminance_ev += masks[..., index] * np.float32(wheel.luminance_ev)
    tinted = image.astype(np.float32, copy=False) + tint * source_luma[..., None]
    tinted_luma = np.maximum(np.einsum("...c,c->...", tinted, weights, optimize=True), 1e-7)
    tinted *= (source_luma / tinted_luma)[..., None]
    tinted *= np.exp2(luminance_ev)[..., None]
    return np.clip(tinted, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def _apply_vignette(image: np.ndarray, vignette: object, kind: PreviewKind) -> np.ndarray:
    if vignette.amount == 0.0:
        return image
    # `image` is the geometry-fixed frame produced by apply_geometry(). Build
    # the vignette entirely in that output space so its center, radius, and
    # roundness follow the crop rather than the uncropped source dimensions.
    height, width = image.shape[:2]
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    scale = np.float32(max(1.0, 0.5 * min(width, height)))
    dx = np.abs((x - np.float32(vignette.center_x * max(width - 1, 1))) / scale)
    dy = np.abs((y - np.float32(vignette.center_y * max(height - 1, 1))) / scale)
    roundness = float(vignette.roundness) / 100.0
    exponent = 2.0 + 6.0 * roundness if roundness >= 0.0 else 2.0 + roundness
    radius = np.power(np.power(dx, exponent) + np.power(dy, exponent), 1.0 / exponent)
    midpoint = np.float32(0.15 + 0.70 * vignette.midpoint / 100.0)
    feather_width = np.float32(0.02 + 0.98 * vignette.feather / 100.0)
    mask = _smoothstep(float(midpoint), float(midpoint + feather_width), radius)
    ev = np.float32(2.0 * vignette.amount / 100.0)
    if ev < 0.0 and vignette.highlight_protection > 0.0:
        luma = np.maximum(_film_luma(image, kind), 0.0)
        highlight = _smoothstep(0.55, 0.95, _film_encode_luma(luma, kind))
        mask *= 1.0 - highlight * np.float32(vignette.highlight_protection / 100.0)
    gain = np.exp2(ev * mask)
    return np.clip(image.astype(np.float32, copy=False) * gain[..., None], 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def _film_luma(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    return _acescg_luma(image) if kind == PreviewKind.HDR else _linear_luma(image)


def _film_encode_luma(luma: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        return _curve_domain_encode(luma, kind)
    return _srgb_encode(np.clip(luma, 0.0, 1.0))


def _film_decode_luma(signal: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        return _curve_domain_decode(signal, kind)
    return _srgb_decode(np.clip(signal, 0.0, 1.0))


def _apply_film_response(image: np.ndarray, look: object, kind: PreviewKind, master: np.float32) -> np.ndarray:
    print_mix = np.float32(look.print_strength / 100.0) * master
    density = np.float32(look.color_density / 100.0) * master
    if print_mix == 0.0 and density == 0.0:
        return image

    source_luma = np.maximum(_film_luma(image, kind), 0.0)
    target_luma = source_luma
    if print_mix > 0.0:
        signal = _film_encode_luma(source_luma, kind)
        contrast = np.float32(look.print_contrast / 100.0) * master
        toe = np.float32(look.print_toe / 100.0) * master
        shoulder = np.float32(look.print_shoulder / 100.0) * master
        mapped = np.float32(0.5) + (signal - np.float32(0.5)) * np.float32(2.0**(0.55 * contrast))
        mapped -= toe * np.float32(0.10) * (np.float32(1.0) - _smoothstep(0.08, 0.58, signal))
        mapped -= shoulder * np.float32(0.10) * _smoothstep(0.42, 0.98, signal)
        if kind == PreviewKind.SDR:
            mapped = np.clip(mapped, 0.0, 1.0)
        target_luma = _film_decode_luma(mapped, kind)
        target_luma = source_luma + (target_luma - source_luma) * print_mix

    gain = np.ones_like(source_luma, dtype=np.float32)
    np.divide(target_luma, source_luma, out=gain, where=source_luma > 1e-7)
    result = image * gain[..., None]
    if density != 0.0:
        # Positive density increases subtractive dye separation while slightly
        # lowering highly saturated colors, unlike a simple saturation control.
        neutral = (_acescg_luma(result) if kind == PreviewKind.HDR else _linear_luma(result))[..., None]
        chroma = result - neutral
        maximum = np.max(result, axis=-1, keepdims=True)
        minimum = np.min(result, axis=-1, keepdims=True)
        relative = np.clip((maximum - minimum) / np.maximum(np.abs(neutral), 1e-5), 0.0, 2.0)
        chroma_scale = np.float32(2.0 ** (0.45 * float(density)))
        result = neutral + chroma * chroma_scale
        result *= np.maximum(np.float32(0.75), np.float32(1.0) - density * np.float32(0.045) * relative)
    return result.astype(np.float32)


def _radius_pixels(image: np.ndarray, percent_diagonal: float, maximum: int = 256) -> int:
    diagonal = float(np.hypot(image.shape[0], image.shape[1]))
    return int(np.clip(round(diagonal * max(0.0, percent_diagonal) / 100.0), 0, maximum))


def _box_blur_axis(image: np.ndarray, radius: int, axis: int) -> np.ndarray:
    if radius <= 0:
        return image
    pads = [(0, 0)] * image.ndim
    pads[axis] = (radius, radius)
    padded = np.pad(image, pads, mode="edge")
    cumulative = np.cumsum(padded, axis=axis, dtype=np.float32)
    zero_shape = list(cumulative.shape)
    zero_shape[axis] = 1
    cumulative = np.concatenate((np.zeros(zero_shape, dtype=np.float32), cumulative), axis=axis)
    high = [slice(None)] * image.ndim
    low = [slice(None)] * image.ndim
    width = 2 * radius + 1
    high[axis] = slice(width, None)
    low[axis] = slice(None, -width)
    return ((cumulative[tuple(high)] - cumulative[tuple(low)]) / np.float32(width)).astype(np.float32)


def _box_blur(image: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return image
    return _box_blur_axis(_box_blur_axis(image, radius, 0), radius, 1)


def _diffusion_blur(image: np.ndarray, radius: int) -> np.ndarray:
    """Approximate a smooth optical point-spread function in linear light.

    Three small box passes approach a Gaussian while retaining the cumulative-
    sum performance of the previous blur.  A single large box creates visible
    square shoulders around diagonal and point highlights.
    """
    if radius <= 0:
        return image
    pass_radius = max(1, int(round(radius * 0.58)))
    result = image
    for _ in range(3):
        result = _box_blur(result, pass_radius)
    return result


def _highlight_mask(image: np.ndarray, kind: PreviewKind, sensitivity: float) -> np.ndarray:
    signal = _film_encode_luma(np.maximum(_film_luma(image, kind), 0.0), kind)
    threshold = np.float32(0.92 - 0.50 * np.clip(sensitivity / 100.0, 0.0, 1.0))
    return _smoothstep(float(threshold), float(threshold + 0.16), signal).astype(np.float32)


def _halation_tint(hue_offset: float, saturation: float) -> np.ndarray:
    angle = np.deg2rad(np.float32(12.0 + 0.45 * hue_offset))
    warm = np.array(
        [1.0, 0.34 + 0.18 * np.sin(angle), 0.07 + 0.10 * np.maximum(np.cos(angle), 0.0)],
        dtype=np.float32,
    )
    neutral = np.full(3, np.dot(warm, np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)), dtype=np.float32)
    return neutral + (warm - neutral) * np.float32(np.clip(saturation / 100.0, 0.0, 1.0))


def _apply_halation(
    image: np.ndarray, look: object, kind: PreviewKind, master: np.float32
) -> tuple[np.ndarray, np.ndarray]:
    mask = _highlight_mask(image, kind, look.halation_sensitivity)
    source = np.maximum(image, 0.0) * mask[..., None]
    radius = _radius_pixels(image, look.halation_radius)
    blurred = _diffusion_blur(source, max(1, radius))
    edge_scatter = np.maximum(blurred - source * np.float32(0.35), 0.0)
    tint = _halation_tint(look.halation_hue_offset, look.halation_saturation)
    halo_luma = _film_luma(edge_scatter, kind)
    halo = halo_luma[..., None] * tint
    map_signal = _film_encode_luma(np.maximum(halo_luma, 0.0), kind)
    halation_map = np.repeat(np.clip(map_signal, 0.0, 1.0)[..., None], 3, axis=-1).astype(np.float32)
    amount = np.float32(0.28 * look.halation_amount / 100.0) * master
    return (image + halo * amount).astype(np.float32), halation_map


def _apply_bloom(image: np.ndarray, look: object, kind: PreviewKind, master: np.float32) -> np.ndarray:
    mask = _highlight_mask(image, kind, look.bloom_sensitivity)
    source = np.maximum(image, 0.0) * mask[..., None]
    radius = max(1, _radius_pixels(image, look.bloom_radius))
    blurred = _diffusion_blur(source, radius)
    detail = np.float32(np.clip(look.bloom_highlight_detail / 100.0, 0.0, 1.0))
    amount = np.float32(look.bloom_amount / 100.0) * master

    # Bloom is the additive veil; diffusion is an energy-moving low-pass that
    # can soften the core instead of merely drawing a larger glow around it.
    # Highlight Detail crossfades only the diffusion component, so 100% keeps
    # the source edge intact while still allowing ordinary optical bloom.
    additive = blurred * (np.float32(0.22) * amount)
    diffusion = (blurred - source) * ((np.float32(1.0) - detail) * np.float32(0.35) * amount)
    return np.maximum(image + additive + diffusion, 0.0).astype(np.float32)


def _apply_image_structure(image: np.ndarray, look: object, kind: PreviewKind, master: np.float32) -> np.ndarray:
    softness = np.float32(look.image_softness / 100.0) * master
    microcontrast = np.float32(look.microcontrast / 100.0) * master
    if softness == 0.0 and microcontrast == 0.0:
        return image
    radius = max(1, _radius_pixels(image, 0.06, maximum=24))
    low_pass = _box_blur(image, radius)
    result = image + (low_pass - image) * softness * np.float32(0.65)
    result += (image - low_pass) * microcontrast * np.float32(0.5)
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def _apply_film_resolution(image: np.ndarray, look: object, master: np.float32) -> np.ndarray:
    loss = np.float32((100.0 - look.film_resolution) / 100.0) * master
    if loss <= 0.0:
        return image
    radius = max(1, _radius_pixels(image, 0.04 + 0.08 * float(loss), maximum=32))
    return (image + (_box_blur(image, radius) - image) * loss * np.float32(0.7)).astype(np.float32)


def _apply_density_grain(
    image: np.ndarray, look: object, kind: PreviewKind, seed: int, master: np.float32
) -> np.ndarray:
    height, width = image.shape[:2]
    yy, xx = np.indices((height, width), dtype=np.float32)
    diagonal = np.float32(np.hypot(height, width))
    pitch = np.maximum(
        np.float32(1.0),
        diagonal / np.float32(2400.0)
        * np.float32(0.85 + 1.8 * look.grain_size / 100.0 + 1.2 * look.grain_softness / 100.0),
    )
    grain_x = xx / pitch
    grain_y = yy / pitch
    monochrome = _grain_hash(grain_x, grain_y, seed, 0.0)
    softer = _grain_hash(grain_x * np.float32(0.53), grain_y * np.float32(0.53), seed, 17.0)
    monochrome = monochrome + (softer - monochrome) * np.float32(0.55 * look.grain_softness / 100.0)

    signal = np.clip(_film_encode_luma(np.maximum(_film_luma(image, kind), 0.0), kind), 0.0, 1.0)
    shadow_weight = np.square(np.float32(1.0) - signal)
    highlight_weight = np.square(signal)
    midtone_weight = np.maximum(np.float32(0.0), np.float32(1.0) - shadow_weight - highlight_weight)
    response = (
        shadow_weight * np.float32(look.grain_shadow_response / 100.0)
        + midtone_weight * np.float32(look.grain_midtone_response / 100.0)
        + highlight_weight * np.float32(look.grain_highlight_response / 100.0)
    )
    amount = np.float32(0.18 * look.grain_amount / 100.0) * master
    density_noise = monochrome * response * amount
    result = np.maximum(image, 0.0) * np.exp2(density_noise[..., None])

    chroma_mix = np.float32(look.grain_chroma / 100.0)
    if chroma_mix > 0.0:
        channel_noise = np.stack(
            [_grain_hash(grain_x, grain_y, seed, salt) for salt in (31.0, 59.0, 83.0)], axis=-1
        )
        # Dye-cloud color variation becomes objectionable pinhole color at the
        # display boundary.  Film grain remains present there, but converges to
        # monochrome as the highlight approaches clipping.
        chroma_highlight_guard = np.float32(1.0) - np.float32(0.8) * _smoothstep(0.88, 1.0, signal)
        result *= np.exp2(
            channel_noise
            * response[..., None]
            * amount
            * chroma_mix
            * chroma_highlight_guard[..., None]
            * np.float32(0.45)
        )
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def _grain_hash(x: np.ndarray, y: np.ndarray, seed: int, salt: float) -> np.ndarray:
    phase = x * np.float32(12.9898) + y * np.float32(78.233) + np.float32(seed * 0.001 + salt)
    return (np.mod(np.sin(phase) * np.float32(43758.5453), np.float32(1.0)) * np.float32(2.0) - np.float32(1.0)).astype(np.float32)


def _curve_set_is_neutral(curve_source: object) -> bool:
    for name in ("luma_curve", "red_curve", "green_curve", "blue_curve"):
        curve = _normalize_curve_points(getattr(curve_source, name))
        if not _curve_is_neutral_points(curve):
            return False
    return True


def _curve_is_neutral_points(curve: np.ndarray) -> bool:
    return bool(np.allclose(curve[:, 0], curve[:, 1], rtol=0.0, atol=1e-7))


def _apply_curve_set(image: np.ndarray, curve_source: object, kind: PreviewKind) -> np.ndarray:
    result = image.astype(np.float32, copy=True)

    luma_curve = _normalize_curve_points(getattr(curve_source, "luma_curve"))
    red_curve = _normalize_curve_points(getattr(curve_source, "red_curve"))
    green_curve = _normalize_curve_points(getattr(curve_source, "green_curve"))
    blue_curve = _normalize_curve_points(getattr(curve_source, "blue_curve"))

    # A luma curve must operate on scene/display-linear luminance. Applying its
    # gain after logarithmically encoding each HDR channel makes the subsequent
    # per-channel exponential decode change RGB ratios, which can turn a small
    # shadow adjustment into an extreme blue/cyan cast.
    if kind == PreviewKind.SDR:
        result = np.clip(result, 0.0, 1.0)
    if not _curve_is_neutral_points(luma_curve):
        luma_lut_x, luma_lut_y = _build_curve_lut(luma_curve)
        luma = _acescg_luma(result) if kind == PreviewKind.HDR else _linear_luma(result)
        curve_luma = _curve_domain_encode(luma, kind)
        if kind == PreviewKind.HDR:
            mapped_curve_luma = _sample_curve_extended(curve_luma, luma_curve, luma_lut_x, luma_lut_y)
        else:
            mapped_curve_luma = np.interp(
                curve_luma, luma_lut_x, luma_lut_y, left=luma_curve[0, 1], right=luma_curve[-1, 1]
            ).astype(np.float32)
        mapped_luma = _curve_domain_decode(mapped_curve_luma, kind)
        luma_gain = np.ones_like(luma, dtype=np.float32)
        np.divide(mapped_luma, luma, out=luma_gain, where=np.abs(luma) > 1e-5)
        result *= luma_gain[..., None]

    # RGB curves intentionally remain per-channel in the perceptual/log curve
    # domain. They can alter hue by design; the luma curve above cannot.
    rgb_curves = (red_curve, green_curve, blue_curve)
    active_rgb_channels = [index for index, curve in enumerate(rgb_curves) if not _curve_is_neutral_points(curve)]
    if not active_rgb_channels:
        return result

    working = _curve_domain_encode(result, kind)
    for channel_index in active_rgb_channels:
        curve = rgb_curves[channel_index]
        lut_x, lut_y = _build_curve_lut(curve)
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
# Match the derivative of the highlight log branch at reference white. The old
# linear shadow branch was 4.6x flatter there, creating a visible kink whenever
# the default middle control point moved away from the identity line.
HDR_CURVE_SHADOW_POWER = np.float32(np.log(HDR_CURVE_MAX_NITS / 100.0))


def _curve_domain_encode(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    if kind == PreviewKind.HDR:
        value = image.astype(np.float32, copy=False)
        positive = np.maximum(value, 0.0)
        below_white = np.float32(0.5) * np.power(
            positive / HDR_CURVE_REFERENCE_WHITE,
            np.float32(1.0) / HDR_CURVE_SHADOW_POWER,
        )
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
        below_white = HDR_CURVE_REFERENCE_WHITE * np.power(
            np.maximum(value * np.float32(2.0), 0.0),
            HDR_CURVE_SHADOW_POWER,
        )
        above_white = HDR_CURVE_REFERENCE_WHITE * np.exp2(
            (value - np.float32(0.5)) * np.float32(2.0) * HDR_CURVE_STOP_SPAN
        )
        decoded = np.where(value <= np.float32(0.5), below_white, above_white)
        return np.where(value >= 0.0, decoded, value * np.float32(2.0) * HDR_CURVE_REFERENCE_WHITE)
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
