from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .color import (
    acescg_to_linear_bt2020,
    acescg_to_linear_srgb,
    linear_bt2020_to_acescg,
    linear_srgb_to_acescg,
    rgb_primaries_adjustment_matrix,
)
from .color_context import RenderColorContext, nits_to_scene_linear, scene_linear_to_nits
from .finishing import apply_geometry
from .models import AdjustmentState, LocalAdjustment, LocalGrade, PreviewKind, SdrMatchState, ToneMapper
from .detail import apply_detail
from .sdr_gamut import compress_to_srgb_gamut


TONE_EQUALIZER_MIN_EV = -6
TONE_EQUALIZER_MAX_EV = 6
TONE_EQUALIZER_BAND_COUNT = TONE_EQUALIZER_MAX_EV - TONE_EQUALIZER_MIN_EV + 1
TONE_EQUALIZER_MAX_ADJUSTMENT_EV = 2.0
_TONE_EQUALIZER_MIN_TARGET_STEP = np.float32(1e-3)
SDR_DISPLAY_REFERENCE_WHITE = np.float32(100.0 / 203.0)
SDR_SCENE_MIDDLE_GRAY = np.float32(0.18)
SDR_SCENE_TO_DISPLAY_SCALE = np.float32(SDR_DISPLAY_REFERENCE_WHITE / SDR_SCENE_MIDDLE_GRAY)
# Keep every selectable SDR rendering curve on the same exposure convention:
# scene-linear 0.18 maps to the app's 100-nit reference white. The Reinhard
# scale has a closed-form solution; the ACES-style fit scale solves the same
# anchor for the rational curve below.
SDR_REINHARD_INPUT_SCALE = np.float32(
    SDR_DISPLAY_REFERENCE_WHITE
    / (SDR_SCENE_MIDDLE_GRAY * (np.float32(1.0) - SDR_DISPLAY_REFERENCE_WHITE))
)
SDR_ACES_FIT_INPUT_SCALE = np.float32(2.0294105241641414)
FILM_GRAIN_GATE_DIMENSIONS_MM: dict[str, tuple[float, float]] = {
    "65mm": (52.63, 23.01),
    "35mm": (36.0, 24.0),
    "super35": (24.89, 18.66),
    "super16": (12.52, 7.41),
    "16mm": (10.26, 7.49),
    "super8": (5.79, 4.01),
}
FILM_SPATIAL_REFERENCE_DIAGONAL_MM = float(np.hypot(36.0, 24.0))
HDR_FILM_HIGHLIGHT_DESATURATION_START = np.float32(0.50)
HDR_FILM_HIGHLIGHT_DESATURATION_END = np.float32(0.82)
SDR_FILM_HIGHLIGHT_DESATURATION_START = np.float32(0.62)
SDR_FILM_HIGHLIGHT_DESATURATION_END = np.float32(1.0)


@dataclass(frozen=True)
class FrameWindow:
    """Where a rendered region sits in the whole output frame.

    A strip is not a small picture. A vignette is placed against the frame and
    grain is a fixed field over it, so both have to ask where they are in the
    frame rather than where they are in the region they happen to be rendered
    in. Without this a strip would draw its own small vignette and restart the
    grain field at its own first row.

    ``None`` everywhere on the ordinary whole-frame path, where the region is
    the frame and the offsets are zero.
    """

    left: int
    top: int
    width: int
    height: int

    @staticmethod
    def resolve(window: "FrameWindow | None", region: np.ndarray) -> tuple[int, int, int, int]:
        """This region's origin and the frame's size.

        With no window the region is the frame: the origin is zero and the
        frame is whatever was handed in, which is what the whole-frame path
        has always computed.
        """
        if window is None:
            height, width = region.shape[:2]
            return 0, 0, int(width), int(height)
        return int(window.left), int(window.top), int(window.width), int(window.height)


@dataclass(frozen=True)
class HighlightAnchor:
    """Whole-frame reductions the highlight stages cannot measure from a strip.

    Peak Fit fits its shoulder to the brightest pixel in the *image*, and
    ``_clip_to_output_target`` chooses between two branches that differ once a
    delivery channel is negative. A strip that measured either for itself would
    get its own shoulder and its own branch, so the bounded CPU path measures
    them once over the whole frame and injects them here.

    Every field is ``None`` on the ordinary whole-frame path, which keeps
    measuring exactly as before.
    """

    hdr_source_peak_nits: float | None = None
    hdr_clip_transport_max: float | None = None
    hdr_output_transport_max: float | None = None
    sdr_peak: float | None = None


def apply_adjustments(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    sdr_reference_image: np.ndarray | None = None,
    *,
    include_grain: bool = True,
    include_output_highlight_compression: bool = True,
    local_adjustments: list[LocalAdjustment] | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
    color_context: RenderColorContext | None = None,
    source_pixel_scale: float = 1.0,
    sdr_match: SdrMatchState | None = None,
    matched_sdr_base: np.ndarray | None = None,
    highlight_anchor: HighlightAnchor | None = None,
    apply_output_clamp: bool = True,
) -> np.ndarray:
    color_context = color_context or RenderColorContext()
    if kind == PreviewKind.SDR and sdr_match is not None and sdr_match.active:
        return _apply_matched_sdr(
            image,
            adjustments,
            sdr_match,
            include_grain=include_grain,
            local_adjustments=local_adjustments,
            color_context=color_context,
            source_pixel_scale=source_pixel_scale,
            matched_sdr_base=matched_sdr_base,
        )
    geometry = adjustments.shared.geometry
    fixed_source = apply_geometry(image, geometry)
    if local_adjustments and compiled_local_masks is None:
        from .local_adjustments import compile_geometry_fixed_mask

        compiled_local_masks = {
            local.id: compile_geometry_fixed_mask(image, local.mask, geometry, spatial_only=True)
            for local in local_adjustments
            if local.enabled and local.opacity > 0.0
        }
    fixed_reference = (
        apply_geometry(sdr_reference_image, geometry)
        if kind == PreviewKind.SDR
        and sdr_reference_image is not None
        and adjustments.sdr.use_authored_base
        else None
    )
    return apply_fixed_source_adjustments(
        fixed_source,
        adjustments,
        kind,
        fixed_sdr_reference=fixed_reference,
        include_grain=include_grain,
        include_output_highlight_compression=include_output_highlight_compression,
        local_adjustments=local_adjustments,
        compiled_local_masks=compiled_local_masks,
        color_context=color_context,
        source_pixel_scale=source_pixel_scale,
        highlight_anchor=highlight_anchor,
        apply_output_clamp=apply_output_clamp,
    )


def apply_fixed_source_adjustments(
    fixed_source: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    *,
    fixed_sdr_reference: np.ndarray | None = None,
    include_grain: bool = True,
    include_output_highlight_compression: bool = True,
    local_adjustments: list[LocalAdjustment] | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
    color_context: RenderColorContext | None = None,
    source_pixel_scale: float = 1.0,
    highlight_anchor: HighlightAnchor | None = None,
    apply_output_clamp: bool = True,
    frame_window: FrameWindow | None = None,
) -> np.ndarray:
    """Grade an already geometry-fixed frame, or one bounded region of one.

    ``apply_adjustments`` is this function preceded by the geometry stage. The
    bounded CPU path extracts its own post-geometry region and enters here, so
    it must not pay for, or re-apply, a whole-frame geometry pass.
    """
    color_context = color_context or RenderColorContext()
    if kind == PreviewKind.HDR:
        return _apply_hdr_adjustments(
            fixed_source,
            adjustments,
            include_grain,
            include_output_highlight_compression=include_output_highlight_compression,
            local_adjustments=local_adjustments,
            fixed_source=fixed_source,
            compiled_local_masks=compiled_local_masks,
            color_context=color_context,
            source_pixel_scale=source_pixel_scale,
            highlight_anchor=highlight_anchor,
            apply_output_clamp=apply_output_clamp,
            frame_window=frame_window,
        )
    if fixed_sdr_reference is not None:
        return _apply_sdr_adjustments_to_reference(
            fixed_sdr_reference,
            adjustments,
            include_grain,
            include_output_highlight_compression=include_output_highlight_compression,
            local_adjustments=local_adjustments,
            fixed_source=fixed_source,
            compiled_local_masks=compiled_local_masks,
            source_pixel_scale=source_pixel_scale,
            highlight_anchor=highlight_anchor,
            frame_window=frame_window,
        )
    return _apply_sdr_adjustments(
        fixed_source,
        adjustments,
        include_grain,
        include_output_highlight_compression=include_output_highlight_compression,
        local_adjustments=local_adjustments,
        fixed_source=fixed_source,
        compiled_local_masks=compiled_local_masks,
        source_pixel_scale=source_pixel_scale,
        highlight_anchor=highlight_anchor,
        frame_window=frame_window,
    )


def _apply_matched_sdr(
    image: np.ndarray,
    adjustments: AdjustmentState,
    match: SdrMatchState,
    *,
    include_grain: bool,
    local_adjustments: list[LocalAdjustment] | None,
    color_context: RenderColorContext,
    source_pixel_scale: float,
    matched_sdr_base: np.ndarray | None = None,
) -> np.ndarray:
    """Render the captured HDR recipe, map its remaining headroom, then apply SDR trims."""
    base = matched_sdr_base
    if base is None:
        base = render_matched_sdr_base(
            image,
            adjustments,
            match,
            color_context=color_context,
            source_pixel_scale=source_pixel_scale,
        )
    fixed_source = apply_geometry(image, adjustments.shared.geometry)
    result = _apply_sdr_adjustments_to_reference(
        base,
        adjustments,
        include_grain=False,
        local_adjustments=local_adjustments,
        fixed_source=fixed_source,
        compiled_local_masks=None,
        source_pixel_scale=source_pixel_scale,
    )
    if not include_grain:
        return np.clip(result, 0.0, 1.0)
    return apply_matched_final_grain(result, adjustments, match)


def render_matched_sdr_base(
    image: np.ndarray,
    adjustments: AdjustmentState,
    match: SdrMatchState,
    *,
    color_context: RenderColorContext,
    source_pixel_scale: float,
) -> np.ndarray:
    """Render only the captured HDR snapshot and its HDR-to-SDR shoulder."""
    assert match.captured_hdr_adjustments is not None
    assert match.captured_shared_adjustments is not None
    captured = adjustments.model_copy(deep=True)
    captured.hdr = match.captured_hdr_adjustments.model_copy(deep=True)
    captured.shared = match.captured_shared_adjustments.model_copy(deep=True)
    # Shared geometry intentionally stays live after the snapshot.
    captured.shared.geometry = adjustments.shared.geometry.model_copy(deep=True)
    captured_locals = [
        LocalAdjustment(
            id=item.id,
            name=item.name,
            enabled=item.enabled,
            opacity=item.opacity,
            mask=item.mask,
            hdr_grade=item.hdr_grade,
            sdr_grade=LocalGrade(),
        )
        for item in match.captured_locals
    ]
    hdr_result = apply_adjustments(
        image,
        captured,
        PreviewKind.HDR,
        include_grain=False,
        local_adjustments=captured_locals,
        color_context=RenderColorContext(match.captured_reference_white_nits or color_context.hdr_reference_white_nits),
        source_pixel_scale=source_pixel_scale,
        sdr_match=None,
    )
    luma = np.maximum(_acescg_luma(hdr_result), 1e-8)
    normalized = luma / np.float32(0.18)
    knee = np.float32(match.manual_highlight_boundary_ratio or match.automatic_highlight_boundary_ratio or 0.9)
    mapped = np.where(
        normalized <= knee,
        normalized,
        np.float32(1.0) - (np.float32(1.0) - knee)
        * np.exp(-(normalized - knee) / max(np.float32(1.0) - knee, np.float32(1e-6))),
    )
    # The match curve is expressed relative to HDR diffuse white, while the
    # established SDR reference pipeline represents that same 100-nit anchor
    # at 100/203 display-linear. Without this scale, reference white becomes
    # code value 1.0 and the matched rendition is about a stop too hot.
    mapped_acescg = hdr_result * (mapped * SDR_DISPLAY_REFERENCE_WHITE / luma)[..., None]
    return _compress_to_srgb_gamut(acescg_to_linear_srgb(mapped_acescg))


def apply_matched_final_grain(
    image: np.ndarray, adjustments: AdjustmentState, match: SdrMatchState
) -> np.ndarray:
    if match.grain_source == "captured_hdr" and match.captured_hdr_adjustments and match.captured_shared_adjustments:
        grain_adjustments = adjustments.model_copy(deep=True)
        grain_adjustments.sdr.film_look = match.captured_hdr_adjustments.film_look.model_copy(deep=True)
        grain_adjustments.sdr.film_look_section_enabled = match.captured_hdr_adjustments.film_look_section_enabled
        grain_adjustments.shared.film_grain_seed = match.captured_shared_adjustments.film_grain_seed
        # The diagnostic maps are viewer-only, so they follow the SDR branch's
        # own checkboxes rather than the captured HDR recipe.
        grain_adjustments.sdr.film_look.grain_view_map = adjustments.sdr.film_look.grain_view_map
        grain_adjustments.sdr.film_look.halation_view_map = adjustments.sdr.film_look.halation_view_map
        return apply_final_grain(image, grain_adjustments, PreviewKind.SDR)
    return apply_final_grain(image, adjustments, PreviewKind.SDR)


def _apply_hdr_adjustments(
    image: np.ndarray,
    adjustments: AdjustmentState,
    include_grain: bool = True,
    *,
    include_output_highlight_compression: bool = True,
    local_adjustments: list[LocalAdjustment] | None = None,
    fixed_source: np.ndarray | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
    color_context: RenderColorContext | None = None,
    source_pixel_scale: float = 1.0,
    highlight_anchor: HighlightAnchor | None = None,
    apply_output_clamp: bool = True,
    frame_window: FrameWindow | None = None,
) -> np.ndarray:
    color_context = color_context or RenderColorContext()
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
    if hdr.color_grading_section_enabled:
        result = _apply_color_grading(result, hdr.color_grading, PreviewKind.HDR)
    if hdr.detail_section_enabled:
        result = apply_detail(result, hdr.detail, PreviewKind.HDR, source_pixel_scale=source_pixel_scale)
    if local_adjustments:
        from .local_adjustments import apply_local_stack

        result = apply_local_stack(
            result,
            image if fixed_source is None else fixed_source,
            local_adjustments,
            PreviewKind.HDR,
            adjustments.shared.geometry,
            compiled_masks=compiled_local_masks,
            source_pixel_scale=source_pixel_scale,
        )
    if hdr.film_look_section_enabled:
        result = _apply_film_look(result, adjustments, PreviewKind.HDR, include_grain=False)
    if hdr.vignette_section_enabled:
        result = _apply_vignette(result, hdr.vignette, PreviewKind.HDR, frame_window=frame_window)
    if include_grain:
        result = apply_final_grain(result, adjustments, PreviewKind.HDR, frame_window=frame_window)
    if include_output_highlight_compression:
        result = apply_hdr_output_highlight_compression(
            result, adjustments, color_context=color_context, anchor=highlight_anchor
        )
    if not apply_output_clamp:
        # The bounded strip path retains this exact value and runs the output
        # stage over it afterwards. Clamping here would feed the shoulder a
        # different picture than the whole-frame path gives it.
        return result
    return np.clip(result, 0.0, None)


def apply_hdr_output_highlight_compression(
    image: np.ndarray,
    adjustments: AdjustmentState,
    *,
    color_context: RenderColorContext | None = None,
    anchor: HighlightAnchor | None = None,
) -> np.ndarray:
    """Apply the HDR output limiter after all creative and finishing operations.

    The shoulder shapes the picture and the ceiling guarantees the delivery
    spec. Anchoring the shoulder on a measured peak alone cannot promise the
    target, because a single ringing or grain sample sits far above the picture
    the shoulder was fitted to.
    """
    hdr = adjustments.hdr
    if not hdr.highlight_section_enabled:
        return image
    color_context = color_context or RenderColorContext()
    compressed = compress_hdr_output_highlights(
        image, adjustments, color_context=color_context, anchor=anchor
    )
    if hdr.highlight_compression_mode == "off":
        return compressed
    return clip_hdr_output_target(compressed, adjustments, color_context=color_context, anchor=anchor)


def compress_hdr_output_highlights(
    image: np.ndarray,
    adjustments: AdjustmentState,
    *,
    color_context: RenderColorContext | None = None,
    anchor: HighlightAnchor | None = None,
    source_peak_nits: float | None = None,
) -> np.ndarray:
    """The shoulder half of the HDR output stage, without the delivery ceiling.

    Exposed separately because the ceiling measures the *compressed* frame,
    so a bounded path has to reduce between the two halves.
    """
    hdr = adjustments.hdr
    color_context = color_context or RenderColorContext()
    if source_peak_nits is None:
        source_peak_nits = anchor.hdr_source_peak_nits if anchor is not None else None
    if source_peak_nits is None:
        source_peak_nits = _tone_adjusted_source_peak_nits(
            image, hdr, tone_enabled=False, color_context=color_context
        )
    return _compress_scene_highlights(
        image,
        hdr.highlight_compression_start_nits,
        hdr.highlight_compression_target_nits,
        hdr.highlight_compression_softness,
        mode=hdr.highlight_compression_mode,
        source_peak_nits=source_peak_nits,
        peak_detail=hdr.highlight_compression_peak_detail,
        bias=hdr.highlight_compression_bias,
        color_handling=hdr.highlight_compression_color_handling,
        reference_white_nits=color_context.hdr_reference_white_nits,
        clip_transport_max=anchor.hdr_clip_transport_max if anchor is not None else None,
    )


def clip_hdr_output_target(
    image: np.ndarray,
    adjustments: AdjustmentState,
    *,
    color_context: RenderColorContext | None = None,
    anchor: HighlightAnchor | None = None,
) -> np.ndarray:
    """The delivery-ceiling half of the HDR output stage."""
    color_context = color_context or RenderColorContext()
    return _clip_to_output_target(
        image,
        adjustments.hdr.highlight_compression_target_nits,
        color_context.hdr_reference_white_nits,
        transport_max=anchor.hdr_output_transport_max if anchor is not None else None,
    )


def hdr_output_transport_signal(image: np.ndarray) -> np.ndarray:
    """The BT.2020 delivery signal ``clip_hdr_output_target`` takes its maximum of."""
    return acescg_to_linear_bt2020(image)


def _clip_to_output_target(
    image: np.ndarray,
    target_nits: float,
    reference_white_nits: int,
    *,
    transport_max: float | None = None,
) -> np.ndarray:
    """Bound every delivery channel at the authored output target.

    Clipping happens in the delivery primaries so the selected target is also a
    hard per-channel ceiling in the encoded BT.2020 HDR signal.
    """
    target = np.float32(nits_to_scene_linear(max(target_nits, 1.0), reference_white_nits))
    transport = acescg_to_linear_bt2020(image)
    # The two branches are not interchangeable once a delivery channel is
    # negative, so a strip has to use the whole frame's maximum, not its own.
    measured_max = float(np.max(transport)) if transport_max is None else float(transport_max)
    if measured_max <= float(target):
        return np.clip(image, 0.0, None).astype(np.float32, copy=False)
    np.clip(transport, np.float32(0.0), target, out=transport)
    return np.clip(linear_bt2020_to_acescg(transport), 0.0, None).astype(np.float32, copy=False)


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


def _tone_adjusted_source_peak_nits(
    tone_adjusted_image: np.ndarray,
    hdr: object,
    *,
    tone_enabled: bool = True,
    color_context: RenderColorContext | None = None,
) -> float:
    """Measure the signal entering Peak Fit in its selected operating domain.

    Automatic peak modes must measure the already tone-adjusted pixels.  A
    scalar source peak cannot be transformed accurately for either channel-peak
    mode: HDR contrast is driven by ACEScg luminance, while those modes anchor
    their shoulders on the brightest ACEScg or BT.2020 channel. Saturated peak
    pixels therefore do not receive the gain predicted by treating their
    maximum channel as luma.

    Manual mode remains an authored source-domain estimate and is transformed
    with the legacy scalar calculation, since no corresponding source pixel is
    available for measurement.
    """
    context = color_context or RenderColorContext()
    measurement = str(getattr(hdr, "highlight_compression_peak_measurement", "maximum"))
    if measurement != "manual":
        signal = hdr_highlight_peak_signal(tone_adjusted_image, hdr)
        if signal is not None and signal.size:
            measured = float(np.quantile(signal, 0.9999)) if measurement == "robust" else float(np.max(signal))
            return hdr_peak_nits_from_measured(measured, context)

    peak = max(
        float(
            getattr(
                hdr,
                "highlight_compression_manual_peak_nits",
                getattr(hdr, "highlight_compression_source_peak_nits", 1000.0),
            )
        ),
        1.0,
    )
    if not tone_enabled:
        return peak
    peak_linear = float(nits_to_scene_linear(peak, context.hdr_reference_white_nits)) * (2.0 ** float(getattr(hdr, "exposure", 0.0)))
    shadow_lift = float(getattr(hdr, "shadow_lift", 0.0))
    if shadow_lift != 0.0:
        lift_factor = float(np.clip(shadow_lift * (1.0 - np.clip(peak_linear, 0.0, 1.0)), None, 1.0))
        peak_linear *= 1.0 + lift_factor
    contrast = float(getattr(hdr, "contrast", 0.0))
    if contrast != 0.0 and peak_linear > 1e-8:
        pivot = max(float(getattr(hdr, "contrast_pivot", 0.1845)), 1e-6)
        stops = np.log2(max(peak_linear, 1e-8) / pivot)
        peak_linear = pivot * float(np.exp2(np.clip(stops * (2.0 ** contrast), -32.0, 32.0)))
    return max(1.0, float(scene_linear_to_nits(peak_linear, context.hdr_reference_white_nits)))


def hdr_highlight_peak_signal(tone_adjusted_image: np.ndarray, hdr: object) -> np.ndarray | None:
    """Return the per-pixel signal Peak Fit reduces, or ``None`` for a manual peak.

    Shared so the bounded strip path reduces exactly the array the whole-frame
    path reduces, rather than a second copy of this selection that could drift.
    """
    measurement = str(getattr(hdr, "highlight_compression_peak_measurement", "maximum"))
    if measurement == "manual":
        return None
    color_handling = str(getattr(hdr, "highlight_compression_color_handling", "smooth_rolloff"))
    if color_handling == "smooth_rolloff":
        transport = acescg_to_linear_bt2020(tone_adjusted_image)
        signal = np.max(transport, axis=-1)
        np.maximum(signal, np.float32(0.0), out=signal)
        return signal
    if color_handling == "path_to_white":
        return np.max(np.clip(tone_adjusted_image, 0.0, None), axis=-1)
    return np.clip(_acescg_luma(tone_adjusted_image), 0.0, None)


def hdr_peak_nits_from_measured(measured: float, context: RenderColorContext) -> float:
    """Convert a reduced peak signal into the nits Peak Fit anchors on."""
    return max(1.0, float(scene_linear_to_nits(measured, context.hdr_reference_white_nits)))


def apply_sdr_output_highlight_compression(
    image: np.ndarray,
    adjustments: AdjustmentState,
) -> np.ndarray:
    """Bound the SDR lane at display white after finishing operations.

    Unlike HDR, the SDR shoulder cannot move to the end of the lane: it is the
    scene-to-display placement that fits the remaining scene headroom onto the
    normalized canvas, and every stage after it — Exposure Bands, contrast,
    curves, colour grading, Film Look — is display-referred. So the SDR shoulder
    stays where the headroom still exists and only the ceiling runs last, which
    is what output finishing and grain need bounding by.
    """
    sdr = adjustments.sdr
    if sdr.rendering_version == "legacy_base_v1" or not sdr.highlight_section_enabled:
        return image
    if sdr.highlight_compression_mode == "off":
        return image
    return np.clip(image, 0.0, 1.0).astype(np.float32, copy=False)


def _apply_sdr_adjustments(
    image: np.ndarray,
    adjustments: AdjustmentState,
    include_grain: bool = True,
    *,
    include_output_highlight_compression: bool = True,
    local_adjustments: list[LocalAdjustment] | None = None,
    fixed_source: np.ndarray | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
    source_pixel_scale: float = 1.0,
    highlight_anchor: HighlightAnchor | None = None,
    frame_window: FrameWindow | None = None,
) -> np.ndarray:
    sdr = adjustments.sdr
    result = _sdr_pre_highlight(image, adjustments)
    if sdr.rendering_version == "legacy_base_v1":
        tone_mapper = sdr.tone_mapper if sdr.base_section_enabled else ToneMapper.FILMIC
        tone_contrast = sdr.tone_contrast if sdr.base_section_enabled else 1.0
        tone_skew = sdr.tone_skew if sdr.base_section_enabled else 0.0
        result = _tone_map_sdr(result, tone_mapper, tone_contrast, tone_skew)
        if sdr.tone_section_enabled:
            result = _apply_sdr_highlight_recovery(result, sdr.highlight_recovery)
    else:
        # Neutral SDR placement: scene 0.18 is the 100-nit diffuse-white anchor
        # on the normalized 203-nit SDR canvas. The explicit highlight stage is
        # solely responsible for fitting the remaining scene headroom.
        if sdr.highlight_section_enabled:
            result = _compress_sdr_highlights(
                result, sdr, peak_override=None if highlight_anchor is None else highlight_anchor.sdr_peak
            )
        result = _compress_to_srgb_gamut(result)
    if sdr.tone_equalizer_section_enabled:
        result = _apply_sdr_tone_equalizer(result, sdr)
    if sdr.tone_section_enabled:
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
    if sdr.detail_section_enabled:
        result = apply_detail(result, sdr.detail, PreviewKind.SDR, source_pixel_scale=source_pixel_scale)
    if local_adjustments:
        from .local_adjustments import apply_local_stack

        result = apply_local_stack(
            result,
            image if fixed_source is None else fixed_source,
            local_adjustments,
            PreviewKind.SDR,
            adjustments.shared.geometry,
            compiled_masks=compiled_local_masks,
            source_pixel_scale=source_pixel_scale,
        )
    if sdr.film_look_section_enabled:
        result = _apply_film_look(result, adjustments, PreviewKind.SDR, include_grain=False)
    if sdr.vignette_section_enabled:
        result = _apply_vignette(result, sdr.vignette, PreviewKind.SDR, frame_window=frame_window)
    if include_grain:
        result = apply_final_grain(result, adjustments, PreviewKind.SDR, frame_window=frame_window)
    if include_output_highlight_compression:
        result = apply_sdr_output_highlight_compression(result, adjustments)
    return np.clip(result, 0.0, 1.0)


def _sdr_pre_highlight(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    """Render the scene up to the SDR highlight stage, in display-linear sRGB.

    Peak Fit measures the whole frame here, so the bounded strip path needs the
    same picture the highlight stage sees. Sharing this prefix is what keeps the
    measured anchor the anchor the render actually uses.
    """
    sdr = adjustments.sdr
    result = image.astype(np.float32, copy=True)
    if sdr.tone_section_enabled:
        result = np.clip(result * np.float32(2.0 ** sdr.exposure), 0.0, None)
    if sdr.tone_section_enabled and sdr.shadow != 0:
        shadow_mask = 1.0 - _smoothstep(0.0, 0.5, _acescg_luma(result))
        result = np.clip(result + sdr.shadow * 0.08 * shadow_mask[..., None], 0.0, None)
    if _sdr_color_is_enabled(adjustments):
        result = _apply_hdr_color(result, adjustments.sdr)
    if sdr.rendering_version == "legacy_base_v1":
        return result
    # Neutral SDR placement: scene 0.18 is the 100-nit diffuse-white anchor
    # on the normalized 203-nit SDR canvas. The explicit highlight stage is
    # solely responsible for fitting the remaining scene headroom.
    return acescg_to_linear_srgb(result * SDR_SCENE_TO_DISPLAY_SCALE)


def _sdr_reference_pre_highlight(image: np.ndarray, adjustments: AdjustmentState) -> np.ndarray:
    """The authored-SDR-base equivalent of ``_sdr_pre_highlight``."""
    sdr = adjustments.sdr
    result = image.astype(np.float32, copy=True)
    if sdr.rendering_version == "legacy_base_v1":
        result = np.clip(result, 0.0, 1.0)
    else:
        result = np.clip(result, 0.0, None)
    if sdr.tone_section_enabled:
        result *= np.float32(2.0 ** sdr.exposure)
    if sdr.tone_section_enabled and sdr.shadow != 0:
        shadow_mask = 1.0 - _smoothstep(0.0, 0.5, _linear_luma(result))
        result = np.clip(result + sdr.shadow * 0.08 * shadow_mask[..., None], 0.0, None)
    return result


def sdr_highlight_stage_input(
    image: np.ndarray, adjustments: AdjustmentState, *, authored_reference: bool
) -> np.ndarray:
    """Return the picture the SDR highlight stage receives, for anchor measurement."""
    if authored_reference:
        return _sdr_reference_pre_highlight(image, adjustments)
    return _sdr_pre_highlight(image, adjustments)


def _apply_sdr_adjustments_to_reference(
    image: np.ndarray,
    adjustments: AdjustmentState,
    include_grain: bool = True,
    *,
    include_output_highlight_compression: bool = True,
    local_adjustments: list[LocalAdjustment] | None = None,
    fixed_source: np.ndarray | None = None,
    compiled_local_masks: dict[str, np.ndarray] | None = None,
    source_pixel_scale: float = 1.0,
    highlight_anchor: HighlightAnchor | None = None,
    frame_window: FrameWindow | None = None,
) -> np.ndarray:
    sdr = adjustments.sdr
    result = _sdr_reference_pre_highlight(image, adjustments)
    if sdr.rendering_version == "legacy_base_v1":
        if sdr.base_section_enabled:
            result = _retone_map_sdr_reference(
                result,
                sdr.tone_mapper,
                sdr.tone_contrast,
                sdr.tone_skew,
            )
        if sdr.tone_section_enabled:
            result = _apply_sdr_highlight_recovery(result, sdr.highlight_recovery)
    elif sdr.highlight_section_enabled:
        result = _compress_sdr_highlights(
            result, sdr, peak_override=None if highlight_anchor is None else highlight_anchor.sdr_peak
        )
    if sdr.tone_equalizer_section_enabled:
        result = _apply_sdr_tone_equalizer(result, sdr)
    if sdr.tone_section_enabled:
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
    if sdr.detail_section_enabled:
        result = apply_detail(result, sdr.detail, PreviewKind.SDR, source_pixel_scale=source_pixel_scale)
    if local_adjustments:
        from .local_adjustments import apply_local_stack

        result = apply_local_stack(
            result,
            image if fixed_source is None else fixed_source,
            local_adjustments,
            PreviewKind.SDR,
            adjustments.shared.geometry,
            compiled_masks=compiled_local_masks,
            source_pixel_scale=source_pixel_scale,
        )
    if sdr.film_look_section_enabled:
        result = _apply_film_look(result, adjustments, PreviewKind.SDR, include_grain=False)
    if sdr.vignette_section_enabled:
        result = _apply_vignette(result, sdr.vignette, PreviewKind.SDR, frame_window=frame_window)
    if include_grain:
        result = apply_final_grain(result, adjustments, PreviewKind.SDR, frame_window=frame_window)
    if include_output_highlight_compression:
        result = apply_sdr_output_highlight_compression(result, adjustments)
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


def _apply_sdr_tone_equalizer(image: np.ndarray, sdr_adjustments: object) -> np.ndarray:
    """Apply independent display-linear exposure bands to the SDR rendition."""
    node_ev, corrections = _tone_equalizer_nodes(sdr_adjustments)
    if not np.any(corrections):
        return image

    result = image.astype(np.float32, copy=True)
    luma = _linear_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    input_ev = np.log2(np.maximum(positive_luma, 1e-8) / np.float32(0.18))
    target_ev = _sample_tone_equalizer_target_ev(
        input_ev,
        node_ev,
        corrections,
        float(getattr(sdr_adjustments, "tone_equalizer_smoothing", 0.5)),
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
    # A very narrow transition contains few samples and previously left most
    # selected tones near the weak foot of smoothstep. Preserve the full upper
    # plateau while lifting the interior response smoothly; the default and
    # wider ranges retain the established curve.
    gain_exponent = np.float32(np.clip(np.sqrt(gain_range / 4.0), 0.5, 1.0))
    highlight = np.power(highlight, gain_exponent).astype(np.float32)
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
    """Redistribute SDR highlights without imposing a sub-white ceiling."""
    if strength <= 0.0:
        return image
    result = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    luma = _linear_luma(result)
    pivot = SDR_DISPLAY_REFERENCE_WHITE
    span = np.float32(1.0) - pivot
    position = np.clip((luma - pivot) / span, 0.0, 1.0).astype(np.float32)
    # This endpoint-preserving Hermite shoulder is identity at reference white
    # and display white. Its derivative stays positive across the supported
    # 0..4 range, so exposure continues to reveal ordered highlight detail
    # instead of accumulating pixels at a strength-dependent gray ceiling.
    amount = np.float32(2.5 * (1.0 - np.exp(-0.5 * np.clip(strength, 0.0, 4.0))))
    recovered_position = position - amount * position * position * (np.float32(1.0) - position)
    recovered_luma = pivot + span * recovered_position
    target_luma = np.where(luma > pivot, recovered_luma, luma)
    ratio = np.where(luma > 1e-8, target_luma / np.maximum(luma, 1e-8), 0.0).astype(np.float32)
    return result * ratio[..., None]


def sdr_highlight_peak_signal(display_linear: np.ndarray, sdr: object) -> np.ndarray | None:
    """Return the per-pixel signal SDR Peak Fit reduces, or ``None`` when it does not measure.

    ``display_linear`` is the picture as it reaches the highlight stage. Shared
    with ``_compress_sdr_highlights`` so the bounded strip path reduces exactly
    the array the whole-frame path reduces.
    """
    if str(getattr(sdr, "highlight_compression_mode", "peak_fit")) != "peak_fit":
        return None
    if str(getattr(sdr, "highlight_compression_peak_measurement", "maximum")) == "manual":
        return None
    color_handling = str(getattr(sdr, "highlight_compression_color_handling", "smooth_rolloff"))
    if color_handling in ("smooth_rolloff", "path_to_white"):
        return np.max(np.clip(display_linear, 0.0, None), axis=-1)
    return np.clip(_linear_luma(display_linear), 0.0, None)


def _compress_sdr_highlights(
    image: np.ndarray, sdr: object, *, peak_override: float | None = None
) -> np.ndarray:
    """Fit display-linear sRGB highlights into the normalized SDR canvas.

    Peak Fit uses the same stop-domain Hermite shoulder as HDR, but its target
    is fixed at display white (1.0) and Smooth Color Rolloff operates directly
    on the SDR delivery primaries. This prevents saturated channel crossings
    from turning into abrupt magenta/green highlight boundaries.
    """
    mode = str(getattr(sdr, "highlight_compression_mode", "peak_fit"))
    softness = float(getattr(sdr, "highlight_compression_softness", 0.0))
    if mode == "off" or (mode == "soft_ceiling" and softness <= 0.0):
        return image

    result = image.astype(np.float32, copy=True)
    start = np.float32(np.clip(float(getattr(sdr, "highlight_compression_start_percent", 50.0)) / 100.0, 0.01, 0.99))
    target = np.float32(1.0)
    if mode == "clip":
        return np.clip(result, 0.0, target).astype(np.float32, copy=False)
    luma = _linear_luma(result)
    positive_luma = np.clip(luma, 0.0, None)

    if mode == "peak_fit":
        color_handling = str(getattr(sdr, "highlight_compression_color_handling", "smooth_rolloff"))
        smooth_rolloff = color_handling == "smooth_rolloff"
        grouped_channels = color_handling == "path_to_white"
        measured_signal = sdr_highlight_peak_signal(result, sdr)
        compression_signal = (
            np.max(np.clip(result, 0.0, None), axis=-1)
            if smooth_rolloff or grouped_channels
            else positive_luma
        )
        measurement = str(getattr(sdr, "highlight_compression_peak_measurement", "maximum"))
        if measurement == "manual":
            peak = np.float32(
                max(float(getattr(sdr, "highlight_compression_manual_peak_percent", 100.0)) / 100.0, 0.01)
            )
            if bool(getattr(sdr, "tone_section_enabled", True)):
                peak *= np.float32(2.0 ** float(getattr(sdr, "exposure", 0.0)))
        elif peak_override is not None:
            peak = np.float32(peak_override)
        elif measured_signal is not None and measured_signal.size:
            peak = np.float32(
                np.quantile(measured_signal, 0.9999)
                if measurement == "robust"
                else np.max(measured_signal)
            )
        else:
            peak = np.float32(
                max(float(getattr(sdr, "highlight_compression_source_peak_percent", 100.0)) / 100.0, 0.01)
            )
        if peak <= target:
            return image

        start_stop = float(np.log2(start))
        target_stop = 0.0
        peak_stop = float(np.log2(peak))
        detail = np.clip(float(getattr(sdr, "highlight_compression_peak_detail", 35.0)) / 100.0, 0.0, 1.0)
        curve_bias = np.clip(float(getattr(sdr, "highlight_compression_bias", 0.0)) / 100.0, -1.0, 1.0) * 0.6
        required_ratio = np.clip(
            (1.0 / (1.0 + curve_bias) + detail / (1.0 - curve_bias)) / 3.0,
            0.001,
            0.95,
        )
        requested_ratio = (target_stop - start_stop) / max(peak_stop - start_stop, 1e-6)
        effective_start_stop = start_stop
        if requested_ratio < required_ratio:
            effective_start_stop = (target_stop - required_ratio * peak_stop) / (1.0 - required_ratio)
        effective_start = np.float32(2.0**effective_start_stop)
        stop_span = target_stop - effective_start_stop
        source_span = max(peak_stop - effective_start_stop, 1e-6)
        normalized_start_slope = source_span / max(stop_span * (1.0 + curve_bias), 1e-6)
        normalized_end_slope = detail * source_span / max(stop_span * (1.0 - curve_bias), 1e-6)

        def map_signal(signal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            input_stop = np.log2(np.maximum(signal, effective_start))
            u = np.clip((input_stop - effective_start_stop) / source_span, 0.0, 1.0)
            w = np.clip(u + curve_bias * u * (1.0 - u), 0.0, 1.0)
            mapped_normalized = w * (
                normalized_start_slope
                + w
                * (
                    -2.0 * normalized_start_slope
                    + 3.0
                    - normalized_end_slope
                    + w * (normalized_start_slope - 2.0 + normalized_end_slope)
                )
            )
            mapped = np.exp2(effective_start_stop + stop_span * mapped_normalized).astype(np.float32)
            return np.where(signal > effective_start, mapped, signal), u

        if smooth_rolloff:
            for channel_index in range(3):
                channel = result[..., channel_index]
                mapped, _ = map_signal(channel)
                result[..., channel_index] = np.where(channel > effective_start, mapped, channel)
            return result

        target_signal, progress = map_signal(compression_signal)
        ratio = np.where(
            compression_signal > 1e-8,
            target_signal / np.maximum(compression_signal, 1e-8),
            1.0,
        ).astype(np.float32)
        mapped = np.where(compression_signal[..., None] > effective_start, result * ratio[..., None], result)
        if grouped_channels:
            neutral = target_signal[..., None]
            blend = progress * progress * (np.float32(3.0) - np.float32(2.0) * progress)
            mapped = np.where(
                compression_signal[..., None] > effective_start,
                neutral + (mapped - neutral) * (np.float32(1.0) - blend[..., None]),
                mapped,
            )
        return mapped.astype(np.float32, copy=False)

    span = target - start
    excess = np.maximum(positive_luma - start, 0.0)
    normalized = excess / span
    exponent = np.float32(2.0 ** (5.0 * (1.0 - np.clip(softness, 0.0, 100.0) / 100.0)))
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
    activation = np.float32(np.clip(softness / 10.0, 0.0, 1.0))
    activation = activation * activation * (np.float32(3.0) - np.float32(2.0) * activation)
    compressed_excess = excess + activation * (span * compressed_normalized - excess)
    target_luma = np.where(positive_luma > start, start + compressed_excess, positive_luma)
    ratio = np.where(positive_luma > 1e-8, target_luma / np.maximum(positive_luma, 1e-8), 1.0).astype(np.float32)
    return np.where(positive_luma[..., None] > start, result * ratio[..., None], result)


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
    color_handling: str = "smooth_rolloff",
    reference_white_nits: int = 203,
    clip_transport_max: float | None = None,
) -> np.ndarray:
    """Compress luminance above ``start_nits`` smoothly toward ``target_nits``."""
    if mode == "off" or (mode == "soft_ceiling" and softness <= 0.0):
        return image
    result = image.astype(np.float32, copy=False)
    luma = _acescg_luma(result)
    positive_luma = np.clip(luma, 0.0, None)
    if mode == "clip":
        return _clip_to_output_target(
            result, target_nits, reference_white_nits, transport_max=clip_transport_max
        )
    smooth_rolloff = mode == "peak_fit" and color_handling == "smooth_rolloff"
    grouped_channels = mode == "peak_fit" and color_handling == "path_to_white"
    transport = acescg_to_linear_bt2020(result) if smooth_rolloff else None
    compression_signal = (
        np.maximum(np.max(transport, axis=-1), np.float32(0.0))
        if smooth_rolloff
        else np.max(np.clip(result, 0.0, None), axis=-1)
        if grouped_channels
        else positive_luma
    )
    start = np.float32(nits_to_scene_linear(max(start_nits, 1.0), reference_white_nits))
    target = np.float32(nits_to_scene_linear(max(target_nits, start_nits + 1.0), reference_white_nits))
    if mode == "peak_fit":
        peak = np.float32(nits_to_scene_linear(max(source_peak_nits, target_nits), reference_white_nits))
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
        stop_span = target_stop - effective_start_stop
        normalized_start_slope = (peak_stop - effective_start_stop) / max(stop_span * (1.0 + curve_bias), 1e-6)
        normalized_end_slope = detail * (peak_stop - effective_start_stop) / max(stop_span * (1.0 - curve_bias), 1e-6)
        if smooth_rolloff:
            # Work on one BT.2020 channel at a time to avoid several
            # full-resolution HxWx3 curve temporaries for large RAW exports.
            for channel_index in range(3):
                channel = transport[..., channel_index]
                active = channel > effective_start
                if not np.any(active):
                    continue
                u = np.maximum(channel, effective_start)
                np.log2(u, out=u)
                u -= np.float32(effective_start_stop)
                u /= np.float32(max(peak_stop - effective_start_stop, 1e-6))
                np.clip(u, 0.0, 1.0, out=u)
                w = u + np.float32(curve_bias) * u * (np.float32(1.0) - u)
                np.clip(w, 0.0, 1.0, out=w)
                mapped = w * (
                    np.float32(normalized_start_slope)
                    + w
                    * (
                        np.float32(-2.0 * normalized_start_slope + 3.0 - normalized_end_slope)
                        + w * np.float32(normalized_start_slope - 2.0 + normalized_end_slope)
                    )
                )
                mapped *= np.float32(stop_span)
                mapped += np.float32(effective_start_stop)
                np.exp2(mapped, out=mapped)
                channel[active] = mapped[active]
            mapped_acescg = linear_bt2020_to_acescg(transport)
            return np.where(
                compression_signal[..., None] > effective_start,
                mapped_acescg,
                result,
            ).astype(np.float32, copy=False)
        curve_input = compression_signal
        input_stop = np.log2(np.maximum(curve_input, effective_start))
        u = np.clip((input_stop - effective_start_stop) / max(peak_stop - effective_start_stop, 1e-6), 0.0, 1.0)
        w = np.clip(u + curve_bias * u * (1.0 - u), 0.0, 1.0)
        h10 = w * (1.0 - w) * (1.0 - w)
        h01 = w * w * (3.0 - 2.0 * w)
        h11 = w * w * (w - 1.0)
        mapped_normalized = h10 * normalized_start_slope + h01 + h11 * normalized_end_slope
        mapped_stop = effective_start_stop + stop_span * mapped_normalized
        target_luma = np.where(
            curve_input > effective_start,
            np.exp2(mapped_stop).astype(np.float32),
            curve_input,
        )
        ratio = np.where(
            compression_signal > 1e-8,
            target_luma / np.maximum(compression_signal, 1e-8),
            1.0,
        ).astype(np.float32)
        mapped = np.where(compression_signal[..., None] > effective_start, result * ratio[..., None], result)
        if grouped_channels:
            # Qualify and anchor on the brightest RGB channel, then converge the
            # grouped channels toward white through the Peak Fit shoulder.
            neutral = target_luma[..., None]
            progress = u * u * (np.float32(3.0) - np.float32(2.0) * u)
            color_mapped = neutral + (mapped - neutral) * (np.float32(1.0) - progress[..., None])
            mapped = np.where(compression_signal[..., None] > effective_start, color_mapped, mapped)
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
    scene_middle_gray = SDR_SCENE_MIDDLE_GRAY
    reference_log_odds = np.log(
        SDR_DISPLAY_REFERENCE_WHITE / (np.float32(1.0) - SDR_DISPLAY_REFERENCE_WHITE)
    )
    encoded_log_odds = np.log(bounded_luma / (1.0 - bounded_luma))
    scene_luma = scene_middle_gray * np.exp(
        np.clip((encoded_log_odds - reference_log_odds) / 1.1, -32.0, 32.0)
    )
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
        scaled_luma = luma * SDR_REINHARD_INPUT_SCALE
        mapped_luma = scaled_luma / (1.0 + scaled_luma)
    elif tone_mapper == ToneMapper.ACES:
        a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
        scaled_luma = luma * SDR_ACES_FIT_INPUT_SCALE
        mapped_luma = (scaled_luma * (a * scaled_luma + b)) / (
            scaled_luma * (c * scaled_luma + d) + e
        )
        mapped_luma /= a / c
    else:
        # Scene 0.18 is the app's 100-nit diffuse-white anchor. Map it to the
        # matching fraction of the 203-nit display canvas, then preserve that
        # anchor while contrast and skew shape the surrounding response.
        scene_middle_gray = SDR_SCENE_MIDDLE_GRAY
        base_power = np.float32(1.1 * np.clip(tone_contrast, 0.5, 1.5))
        skew = np.float32(np.clip(tone_skew, -1.0, 1.0))
        shadow_power = base_power * np.exp2(np.float32(-0.75) * skew)
        highlight_power = base_power * np.exp2(np.float32(0.75) * skew)
        log_exposure = np.log(np.maximum(luma, 1e-8) / scene_middle_gray)
        highlight_blend = _smoothstep(-0.5, 0.5, log_exposure)
        local_power = shadow_power * (1.0 - highlight_blend) + highlight_power * highlight_blend
        reference_log_odds = np.log(
            SDR_DISPLAY_REFERENCE_WHITE / (np.float32(1.0) - SDR_DISPLAY_REFERENCE_WHITE)
        )
        log_odds = reference_log_odds + local_power * log_exposure
        mapped_luma = 1.0 / (1.0 + np.exp(-np.clip(log_odds, -32.0, 32.0)))
        mapped_luma = np.where(luma > 0.0, mapped_luma, 0.0)
    return np.clip(mapped_luma, 0.0, 1.0).astype(np.float32)


def _compress_to_srgb_gamut(image: np.ndarray) -> np.ndarray:
    """Map out-of-gamut linear sRGB with the shared perceptual clipper."""
    return compress_to_srgb_gamut(image)


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
    if strength <= 0.0:
        return image

    response_active = any(
        float(getattr(look, field, 0.0)) != 0.0
        for field in (
            "print_strength",
            "color_density",
            "red_response",
            "green_response",
            "blue_response",
            "highlight_desaturation",
            "shadow_desaturation",
        )
    )
    halation_active = (
        look.halation_enabled and look.halation_amount > 0.0 and look.halation_radius > 0.0
    )
    halation_map_active = look.halation_enabled and look.halation_view_map
    bloom_active = look.bloom_enabled and look.bloom_amount > 0.0 and look.bloom_radius > 0.0
    structure_active = look.image_structure_enabled and (
        look.image_softness != 0.0 or look.microcontrast != 0.0
    )
    resolution_active = look.film_resolution < 100.0
    grain_active = include_grain and look.grain_enabled and (
        look.grain_amount > 0.0 or look.grain_view_map
    )
    active = any(
        (
            response_active,
            halation_active,
            halation_map_active,
            bloom_active,
            structure_active,
            resolution_active,
            grain_active,
        )
    )
    if not active:
        return image

    result = image.astype(np.float32, copy=True)
    result = _apply_film_response(result, look, kind, strength)
    # WebGPU retains the completed response frame as the source for all Film
    # Look spatial kernels. Keep the CPU path on the same stage boundary: the
    # effects are composited in order below, while every blur is derived from
    # this immutable response frame rather than an already blurred result.
    spatial_source = result

    if halation_active or halation_map_active:
        result, halation_map = _apply_halation(result, look, kind, strength)
        if look.halation_view_map:
            return halation_map
    if bloom_active:
        result = _apply_bloom(result, look, kind, strength, spatial_source=spatial_source)
    if structure_active:
        result = _apply_image_structure(result, look, kind, strength, spatial_source=spatial_source)
    if resolution_active:
        result = _apply_film_resolution(result, look, strength, spatial_source=spatial_source)
    if include_grain and look.grain_enabled and strength > 0.0:
        if look.grain_view_map:
            return _apply_density_grain(
                result, look, kind, adjustments.shared.film_grain_seed, strength, view_map=True
            )
        if look.grain_amount > 0.0:
            result = _apply_density_grain(result, look, kind, adjustments.shared.film_grain_seed, strength)
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def apply_final_grain(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    *,
    frame_window: FrameWindow | None = None,
) -> np.ndarray:
    """Synthesize deterministic film grain at the current (preview or final export) resolution.

    ``frame_window`` places ``image`` in the whole frame when it is one region
    of one, so a strip samples the frame's grain field rather than starting a
    new one at its own first row.
    """
    branch = adjustments.hdr if kind == PreviewKind.HDR else adjustments.sdr
    if not branch.film_look_section_enabled:
        return image
    look = branch.film_look
    strength = np.float32(look.look_strength / 100.0)
    if not look.grain_enabled or strength <= 0.0:
        return image
    if look.halation_enabled and look.halation_view_map:
        # The halation map replaces the picture upstream, on this path and in
        # the WebGPU shader alike. Grain must not be sprinkled over it.
        return image
    if look.grain_view_map:
        return _apply_density_grain(
            image, look, kind, adjustments.shared.film_grain_seed, strength,
            view_map=True, frame_window=frame_window,
        )
    if look.grain_amount <= 0.0:
        return image
    return _apply_density_grain(
        image, look, kind, adjustments.shared.film_grain_seed, strength, frame_window=frame_window
    )


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


def _apply_vignette(
    image: np.ndarray,
    vignette: object,
    kind: PreviewKind,
    *,
    frame_window: FrameWindow | None = None,
) -> np.ndarray:
    if vignette.amount == 0.0:
        return image
    # `image` is the geometry-fixed frame produced by apply_geometry(), or one
    # region of it. Build the vignette in that output space so its center,
    # radius, and roundness follow the crop rather than the uncropped source
    # dimensions -- and, when this is a region, against the whole frame's size
    # at this region's place in it rather than against the region itself.
    region_height, region_width = image.shape[:2]
    left, top, width, height = FrameWindow.resolve(frame_window, image)
    y, x = np.mgrid[top:top + region_height, left:left + region_width].astype(np.float32)
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


def _film_highlight_desaturation_weight(response_signal: np.ndarray, kind: PreviewKind) -> np.ndarray:
    """Return a display-relevant highlight mask for the current lane.

    The HDR curve places reference white at 0.5. The former shared 0.62..1.0
    range did not begin until roughly 600 nits and was only about five percent
    active at 1,000 nits, leaving most of the adjustment beyond common display
    headroom. HDR now rolls in above reference white and becomes strong across
    the visible 400..2,000-nit range. SDR retains its existing response.
    """
    if kind == PreviewKind.HDR:
        return _smoothstep(
            float(HDR_FILM_HIGHLIGHT_DESATURATION_START),
            float(HDR_FILM_HIGHLIGHT_DESATURATION_END),
            response_signal,
        )
    return _smoothstep(
        float(SDR_FILM_HIGHLIGHT_DESATURATION_START),
        float(SDR_FILM_HIGHLIGHT_DESATURATION_END),
        response_signal,
    )


def _apply_film_response(image: np.ndarray, look: object, kind: PreviewKind, master: np.float32) -> np.ndarray:
    """Apply Film Response in the branch's scene-linear working RGB.

    HDR is ACEScg and SDR is linear sRGB. Tone shaping is authored through a
    perceptual luma signal, then decoded back to the same scene-linear branch;
    density changes operate in that branch without reinterpreting RGB values as
    coordinates from the other working space.
    """
    print_mix = np.float32(look.print_strength / 100.0) * master
    density = np.float32(look.color_density / 100.0) * master
    channel_response = np.array(
        [
            getattr(look, "red_response", 0.0),
            getattr(look, "green_response", 0.0),
            getattr(look, "blue_response", 0.0),
        ],
        dtype=np.float32,
    ) * (master / np.float32(100.0))
    highlight_desaturation = np.float32(getattr(look, "highlight_desaturation", 0.0) / 100.0) * master
    shadow_desaturation = np.float32(getattr(look, "shadow_desaturation", 0.0) / 100.0) * master
    if (
        print_mix == 0.0
        and density == 0.0
        and not np.any(channel_response)
        and highlight_desaturation == 0.0
        and shadow_desaturation == 0.0
    ):
        return image

    source_luma = np.maximum(_film_luma(image, kind), 0.0)
    target_luma = source_luma
    if print_mix > 0.0:
        signal = _film_encode_luma(source_luma, kind)
        # Author the response curve at its requested values, then use master
        # only for the final response blend. Scaling both made intermediate
        # Look Strength values behave approximately strength-squared.
        contrast = np.float32(look.print_contrast / 100.0)
        toe = np.float32(look.print_toe / 100.0)
        shoulder = np.float32(look.print_shoulder / 100.0)
        mapped = np.float32(0.5) + (signal - np.float32(0.5)) * np.float32(2.0**(0.55 * contrast))
        # Softplus knees retain a positive derivative at every legal setting.
        # Unlike additive masks, they cannot introduce a hard join or reverse
        # tone order around the toe and shoulder boundaries.
        toe_knee = np.float32(0.18) * np.logaddexp(
            np.float32(0.0), (np.float32(0.45) - mapped) / np.float32(0.18)
        )
        shoulder_knee = np.float32(0.18) * np.logaddexp(
            np.float32(0.0), (mapped - np.float32(0.55)) / np.float32(0.18)
        )
        mapped -= np.float32(0.28) * (toe * toe_knee + shoulder * shoulder_knee)
        mapped = np.maximum(mapped, np.float32(0.0))
        if kind == PreviewKind.SDR:
            mapped = np.clip(mapped, 0.0, 1.0)
        target_luma = _film_decode_luma(mapped, kind)
        target_luma = source_luma + (target_luma - source_luma) * print_mix

    gain = np.ones_like(source_luma, dtype=np.float32)
    np.divide(target_luma, source_luma, out=gain, where=source_luma > 1e-7)
    result = image * gain[..., None]

    if np.any(channel_response):
        response_luma = np.maximum(_film_luma(result, kind), 0.0)
        response_signal = _film_encode_luma(response_luma, kind)
        neutral = response_luma[..., None]
        maximum = np.max(result, axis=-1, keepdims=True)
        minimum = np.min(result, axis=-1, keepdims=True)
        relative = np.clip((maximum - minimum) / np.maximum(np.abs(neutral), 1e-5), 0.0, 2.0)[..., 0]
        exposure_weight = np.float32(0.20) + np.float32(0.80) * _smoothstep(0.08, 0.88, response_signal)
        saturation_guard = np.float32(1.0) - np.float32(0.35) * _smoothstep(0.60, 1.40, relative)
        highlight_guard = np.float32(1.0) - np.float32(0.65) * _smoothstep(0.88, 1.12, response_signal)
        response_ev = (
            channel_response.reshape(1, 1, 3)
            * np.float32(0.35)
            * (exposure_weight * saturation_guard * highlight_guard)[..., None]
        )
        result *= np.exp2(response_ev)

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

    if highlight_desaturation > 0.0 or shadow_desaturation > 0.0:
        response_luma = np.maximum(_film_luma(result, kind), 0.0)
        response_signal = _film_encode_luma(response_luma, kind)
        shadow_weight = np.float32(1.0) - _smoothstep(0.08, 0.46, response_signal)
        highlight_weight = _film_highlight_desaturation_weight(response_signal, kind)
        desaturation = np.clip(
            shadow_weight * shadow_desaturation + highlight_weight * highlight_desaturation,
            0.0,
            1.0,
        )
        neutral = response_luma[..., None]
        result = neutral + (result - neutral) * (np.float32(1.0) - desaturation[..., None])
    return result.astype(np.float32)


def _radius_pixels(image: np.ndarray, percent_diagonal: float, maximum: int = 256) -> int:
    """Return an output-relative radius for optical/display-space effects.

    Bloom and image-structure diffusion intentionally use rendered-frame units;
    they describe the finished optical image rather than a film-plane distance.
    """
    diagonal = float(np.hypot(image.shape[0], image.shape[1]))
    return int(np.clip(round(diagonal * max(0.0, percent_diagonal) / 100.0), 0, maximum))


def _film_gate_dimensions_mm(look: object) -> tuple[float, float]:
    if look.grain_film_format == "custom":
        return float(look.grain_custom_width_mm), float(look.grain_custom_height_mm)
    return FILM_GRAIN_GATE_DIMENSIONS_MM.get(
        look.grain_film_format, FILM_GRAIN_GATE_DIMENSIONS_MM["35mm"]
    )


def _film_pixels_per_mm(width: int, height: int, look: object) -> float:
    """Map film-plane millimetres to pixels using the selected capture geometry.

    Strip captures anchor their scale to the cross-scan dimension, so a stitched
    panorama or line scan does not acquire an enormous effect radius merely
    because its scanned axis is unusually long.
    """
    gate_width, gate_height = _film_gate_dimensions_mm(look)
    geometry = look.grain_capture_geometry
    if geometry == "horizontal_strip":
        return float(height) / gate_height
    if geometry == "vertical_strip":
        return float(width) / gate_width
    return max(float(width) / gate_width, float(height) / gate_height)


def _film_radius_pixels(
    image: np.ndarray, look: object, percent_35mm_diagonal: float, maximum: int = 256
) -> int:
    """Return a film-plane radius calibrated to the legacy 35mm control scale."""
    radius_mm = FILM_SPATIAL_REFERENCE_DIAGONAL_MM * max(0.0, percent_35mm_diagonal) / 100.0
    return int(np.clip(round(_film_pixels_per_mm(image.shape[1], image.shape[0], look) * radius_mm), 0, maximum))


def _box_blur_axis(image: np.ndarray, radius: int, axis: int) -> np.ndarray:
    if radius <= 0:
        return image
    pads = [(0, 0)] * image.ndim
    pads[axis] = (radius, radius)
    padded = np.pad(image, pads, mode="edge")
    # The running sum is written straight into a buffer that already carries
    # the leading zero the difference needs, rather than being concatenated
    # onto one afterwards. At export sizes each avoided copy of the frame is
    # worth about a second.
    cumulative_shape = list(padded.shape)
    cumulative_shape[axis] += 1
    cumulative = np.zeros(cumulative_shape, dtype=np.float32)
    tail = [slice(None)] * image.ndim
    tail[axis] = slice(1, None)
    np.cumsum(padded, axis=axis, dtype=np.float32, out=cumulative[tuple(tail)])
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


# Above this radius the exact tap-by-tap kernel costs more than the frame is
# worth and the box cascade below stands in for it. The threshold is in output
# pixels and is generous: a 17-tap pass is still cheap.
_DIFFUSION_EXACT_RADIUS = 8


def _diffusion_kernel(radius: int) -> tuple[np.ndarray, np.ndarray]:
    """Return the offsets and weights of the optical kernel at ``radius``.

    The shape is the truncated Gaussian the WebGPU preview uses,
    ``exp(-4.5 * (offset / radius) ** 2)`` out to +/- the radius. The taps sit
    one pixel apart. Spacing is the whole point: a separable pass whose taps
    are further apart than a pixel does not blur, it reprints the source once
    per tap, and the two axes multiply those copies into a grid of echoes. The
    old kernel used nine taps whatever the radius, so the spacing grew with the
    frame and Full echoed where a draft did not.
    """
    extent = max(1, int(np.ceil(radius)))
    offsets = np.arange(-extent, extent + 1, dtype=np.float32)
    normalized = offsets / np.float32(max(radius, 1))
    weights = np.exp(np.float32(-4.5) * normalized * normalized).astype(np.float32)
    weights /= np.sum(weights, dtype=np.float32)
    return offsets, weights


def _box_cascade_radii(variance: float, passes: int = 3) -> list[int]:
    """Return box radii whose cascade carries ``variance``.

    Three successive box blurs converge on a Gaussian closely enough that the
    difference does not survive an 8-bit view, and each one is O(1) in the
    radius through the cumulative sums in :func:`_box_blur_axis`. That is what
    makes a 256-pixel export radius affordable: sampling it tap by tap costs
    half a minute per axis on a 24-megapixel frame.

    A box of radius ``r`` has variance ``(r * r + r) / 3``. Mixing two adjacent
    integer radii lets the cascade land on the requested variance rather than
    on the nearest whole box.
    """
    if variance <= 0.0 or passes <= 0:
        return []
    ideal = (-1.0 + float(np.sqrt(1.0 + 12.0 * variance / passes))) / 2.0
    lower = int(np.floor(ideal))
    carried = lambda count: (
        count * (lower * lower + lower) + (passes - count) * ((lower + 1) ** 2 + (lower + 1))
    ) / 3.0
    wide = min(range(passes + 1), key=lambda count: abs(carried(count) - variance))
    return [lower] * wide + [lower + 1] * (passes - wide)


def _diffusion_blur(image: np.ndarray, radius: int) -> np.ndarray:
    """Apply the separable optical kernel used by the WebGPU preview."""
    if radius <= 0:
        return image
    offsets, weights = _diffusion_kernel(radius)
    if radius <= _DIFFUSION_EXACT_RADIUS:
        return _weighted_blur_axis(_weighted_blur_axis(image, offsets, weights, 1), offsets, weights, 0)
    variance = float(np.sum(weights * offsets * offsets, dtype=np.float64))
    result = image
    for box in _box_cascade_radii(variance):
        result = _box_blur_axis(_box_blur_axis(result, box, 1), box, 0)
    return result.astype(np.float32)


def _weighted_blur_axis(
    image: np.ndarray, offsets: np.ndarray, weights: np.ndarray, axis: int
) -> np.ndarray:
    """Accumulate whole-pixel taps along one clamped axis.

    Both kernels that use this sample at whole pixels, so a tap is a shift of
    the frame rather than an interpolation of it. Padding once and taking
    slices keeps every read contiguous; addressing the same taps through
    ``np.take`` costs about eleven times as much at export sizes, because
    fancy indexing rebuilds the frame per tap.
    """
    extent = int(np.max(np.abs(offsets))) if len(offsets) else 0
    if extent <= 0:
        return image.astype(np.float32, copy=True)
    pads = [(0, 0)] * image.ndim
    pads[axis] = (extent, extent)
    padded = np.pad(image, pads, mode="edge")
    length = image.shape[axis]
    result = np.zeros_like(image, dtype=np.float32)
    window = [slice(None)] * image.ndim
    for offset, weight in zip(offsets, weights, strict=True):
        start = extent + int(round(float(offset)))
        window[axis] = slice(start, start + length)
        result += padded[tuple(window)] * weight
    return result.astype(np.float32)


FILM_DETAIL_SIGMA_SCALE = np.float32(0.7)


def _film_detail_blur(image: np.ndarray, radius: int) -> np.ndarray:
    """Apply the detail low-pass used by WebGPU preview.

    Image Softness, Microcontrast and Film Resolution all read this. It was a
    nine-sample star -- a centre plus eight taps on the axes and diagonals --
    which left the space between the taps empty, so a bright point came back
    as itself plus eight separate copies at 8.3%: a faint cross rather than a
    blur. The kernel is now a Gaussian sampled at every pixel it spans.

    Sigma is 0.7 of the radius, measured: at that width Image Softness,
    Microcontrast and Film Resolution move a frame within 0.3% of what the
    star moved it, so the presets keep their tuning. Matching the star's
    variance instead would mean a value that wobbles with the radius, because
    ``max(1, radius // 2)`` placed its diagonal taps differently for odd and
    even radii, and it would still not match the strength.

    Truncation stays on the same +/- radius the halo already reserves, which
    leaves about a third of the peak weight at the boundary. That is the cost
    of holding the star's width on the star's support: the star carried its
    width by putting weight at exactly +/- radius, and no kernel that tapers
    to nothing by then is as wide. The response still falls monotonically, so
    the cutoff reads as a glow that ends rather than as a rim.

    The preview walks the square directly because its fragment shader has no
    second pass to hand the axes to. Here the two axes are separable, which is
    the same kernel for 2 * (2r + 1) reads per pixel instead of (2r + 1) ** 2.
    The radii stay small by construction -- 0.06% of the output diagonal and
    at most 0.12% of the film gate -- so the taps are counted rather than
    approximated the way the much wider :func:`_diffusion_blur` has to.
    """
    if radius <= 0:
        return image
    offsets = np.arange(-radius, radius + 1, dtype=np.float32)
    sigma = np.float32(max(radius, 1)) * FILM_DETAIL_SIGMA_SCALE
    weights = np.exp(-(offsets * offsets) / (np.float32(2.0) * sigma * sigma)).astype(np.float32)
    weights /= np.sum(weights, dtype=np.float32)
    return _weighted_blur_axis(_weighted_blur_axis(image, offsets, weights, 1), offsets, weights, 0)


def _highlight_mask(image: np.ndarray, kind: PreviewKind, sensitivity: float) -> np.ndarray:
    signal = _film_encode_luma(np.maximum(_film_luma(image, kind), 0.0), kind)
    threshold = np.float32(0.92 - 0.50 * np.clip(sensitivity / 100.0, 0.0, 1.0))
    return _smoothstep(float(threshold), float(threshold + 0.16), signal).astype(np.float32)


def _halation_edge_source(
    image: np.ndarray, kind: PreviewKind, sensitivity: float, edge_radius: int = 1
) -> np.ndarray:
    """Extract bright-side exposed boundaries instead of whole highlight areas.

    Real anti-halation failure is driven most visibly where a strongly exposed
    region meets a darker neighbour.  A relative, one-pixel cross gradient
    keeps broad uniform highlights from becoming a generic warm bloom and is
    sampled at a fraction of the authored physical extent, so smooth 4K edges
    qualify as reliably as the same edge in a smaller preview.
    """
    qualified = np.maximum(_film_luma(image, kind), 0.0) * _highlight_mask(image, kind, sensitivity)
    edge_radius = max(1, min(int(edge_radius), 16))
    padded = np.pad(qualified, ((edge_radius, edge_radius), (edge_radius, edge_radius)), mode="edge")
    neighbour_mean = (
        padded[edge_radius:-edge_radius, :-2 * edge_radius]
        + padded[edge_radius:-edge_radius, 2 * edge_radius:]
        + padded[:-2 * edge_radius, edge_radius:-edge_radius]
        + padded[2 * edge_radius:, edge_radius:-edge_radius]
    ) * np.float32(0.25)
    bright_edge = np.maximum(qualified - neighbour_mean, 0.0)
    relative_edge = bright_edge / (qualified + np.float32(0.02))
    edge_gate = _smoothstep(0.004, 0.12, relative_edge)
    return (qualified * edge_gate).astype(np.float32)


def _bloom_source(image: np.ndarray, kind: PreviewKind, sensitivity: float) -> np.ndarray:
    """Return a soft-knee optical bloom source with subdued threshold chatter."""
    mask = _highlight_mask(image, kind, sensitivity)
    return (np.maximum(image, 0.0) * (mask * mask)[..., None]).astype(np.float32)


def _halation_tint(hue_offset: float, saturation: float, kind: PreviewKind) -> np.ndarray:
    """Return one canonical linear-sRGB tint in the branch working space."""
    angle = np.deg2rad(np.float32(12.0 + 0.45 * hue_offset))
    warm = np.array(
        [1.0, 0.34 + 0.18 * np.sin(angle), 0.07 + 0.10 * np.maximum(np.cos(angle), 0.0)],
        dtype=np.float32,
    )
    neutral = np.full(3, np.dot(warm, np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)), dtype=np.float32)
    canonical_srgb = neutral + (warm - neutral) * np.float32(np.clip(saturation / 100.0, 0.0, 1.0))
    if kind == PreviewKind.HDR:
        return linear_srgb_to_acescg(canonical_srgb.reshape(1, 1, 3))[0, 0]
    return canonical_srgb


def _apply_halation(
    image: np.ndarray, look: object, kind: PreviewKind, master: np.float32
) -> tuple[np.ndarray, np.ndarray]:
    radius = _film_radius_pixels(image, look, look.halation_radius)
    source = _halation_edge_source(
        image, kind, look.halation_sensitivity, edge_radius=max(1, radius // 4)
    )
    blurred = _diffusion_blur(source, max(1, radius))
    edge_scatter = np.maximum(blurred - source * np.float32(0.15), 0.0)
    tint = _halation_tint(look.halation_hue_offset, look.halation_saturation, kind)
    halo = edge_scatter[..., None] * tint
    map_signal = _film_encode_luma(np.maximum(edge_scatter, 0.0), kind)
    halation_map = np.repeat(np.clip(map_signal, 0.0, 1.0)[..., None], 3, axis=-1).astype(np.float32)
    amount = np.float32(0.42 * look.halation_amount / 100.0) * master
    return (image + halo * amount).astype(np.float32), halation_map


def _apply_bloom(
    image: np.ndarray,
    look: object,
    kind: PreviewKind,
    master: np.float32,
    *,
    spatial_source: np.ndarray | None = None,
) -> np.ndarray:
    blur_input = image if spatial_source is None else spatial_source
    source = _bloom_source(blur_input, kind, look.bloom_sensitivity)
    current_qualified = _bloom_source(image, kind, look.bloom_sensitivity)
    # Bloom is an optical finish measured against the rendered output, not the
    # film gate. Changing Film Format must therefore leave its spread unchanged.
    radius = max(1, _radius_pixels(image, look.bloom_radius))
    blurred = _diffusion_blur(source, radius)
    detail = np.float32(np.clip(look.bloom_highlight_detail / 100.0, 0.0, 1.0))
    amount = np.float32(look.bloom_amount / 100.0) * master

    # Bloom is the additive veil; diffusion is an energy-moving low-pass that
    # can soften the core instead of merely drawing a larger glow around it.
    # Highlight Detail crossfades only the diffusion component, so 100% keeps
    # the source edge intact while still allowing ordinary optical bloom.
    additive = blurred * (np.float32(0.22) * amount)
    # Do not turn a decisive object boundary into a dark/bright echo. The
    # qualified highlight is nonlinear, so subtracting it from its blur at an
    # unprotected hard edge is resolution-sensitive: a Full frame retains a
    # sharper threshold crossing than its 4K proxy. Keep diffusion on smooth
    # highlight structure while letting the additive veil handle hard edges.
    diffusion_delta = blurred - current_qualified
    relative_detail = np.max(np.abs(diffusion_delta), axis=-1) / (
        np.max(np.abs(current_qualified), axis=-1) + np.float32(0.02)
    )
    edge_protection = _smoothstep(0.025, 0.20, relative_detail)
    diffusion = diffusion_delta * (
        (np.float32(1.0) - detail)
        * np.float32(0.35)
        * amount
        * (np.float32(1.0) - edge_protection)[..., None]
    )
    return np.maximum(image + additive + diffusion, 0.0).astype(np.float32)


def _apply_image_structure(
    image: np.ndarray,
    look: object,
    kind: PreviewKind,
    master: np.float32,
    *,
    spatial_source: np.ndarray | None = None,
) -> np.ndarray:
    softness = np.float32(look.image_softness / 100.0) * master
    microcontrast = np.float32(look.microcontrast / 100.0) * master
    if softness == 0.0 and microcontrast == 0.0:
        return image
    radius = max(1, _radius_pixels(image, 0.06, maximum=24))
    source = image if spatial_source is None else spatial_source
    low_pass = _film_detail_blur(source, radius)
    result = image + (low_pass - image) * softness * np.float32(0.65)
    result += (image - low_pass) * microcontrast * np.float32(0.5)
    return np.clip(result, 0.0, None if kind == PreviewKind.HDR else 1.0).astype(np.float32)


def _apply_film_resolution(
    image: np.ndarray,
    look: object,
    master: np.float32,
    *,
    spatial_source: np.ndarray | None = None,
) -> np.ndarray:
    loss = np.float32((100.0 - look.film_resolution) / 100.0) * master
    if loss <= 0.0:
        return image
    radius = max(1, _film_radius_pixels(image, look, 0.04 + 0.08 * float(loss), maximum=32))
    source = image if spatial_source is None else spatial_source
    low_pass = _film_detail_blur(source, radius)
    fine_detail = source - low_pass
    relative_detail = np.max(np.abs(fine_detail), axis=-1) / (
        np.max(np.abs(source), axis=-1) + np.float32(0.02)
    )
    edge_protection = _smoothstep(0.025, 0.20, relative_detail)
    attenuation = loss * np.float32(0.85) * (np.float32(1.0) - edge_protection)
    # Attenuate low-contrast high frequencies while retaining decisive edges;
    # this reads as finite film MTF rather than a conventional Gaussian blur.
    return (image - fine_detail * attenuation[..., None]).astype(np.float32)


def _apply_density_grain(
    image: np.ndarray,
    look: object,
    kind: PreviewKind,
    seed: int,
    master: np.float32,
    *,
    view_map: bool = False,
    frame_window: FrameWindow | None = None,
) -> np.ndarray:
    """Modulate the frame by the film grain density field.

    ``view_map`` substitutes a neutral mid-grey card for the picture after the
    tonal response has been measured from it, so the viewer sees the grain
    field alone at exactly the density it is contributing to a mid-grey
    subject, still carrying the shadow/midtone/highlight qualification the
    image drives.
    """
    region_height, region_width = image.shape[:2]
    left, top, width, height = FrameWindow.resolve(frame_window, image)
    yy, xx = np.indices((region_height, region_width), dtype=np.float32)
    yy += np.float32(top)
    xx += np.float32(left)
    physical_pitch = np.float32(_grain_pitch_pixels(width, height, look))
    pitch = np.maximum(np.float32(1.0), physical_pitch)
    pixel_coverage = np.minimum(np.float32(1.0), physical_pitch)
    grain_x = xx / pitch
    grain_y = yy / pitch
    monochrome = _grain_value_noise(grain_x, grain_y, seed, 0.0)
    softer = _grain_value_noise(grain_x * np.float32(0.53), grain_y * np.float32(0.53), seed, 17.0)
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
    amount = np.float32(0.18 * look.grain_amount / 100.0) * master * pixel_coverage
    density_noise = monochrome * response * amount
    base = image
    if view_map:
        base = np.full_like(image, _film_decode_luma(np.float32(0.5), kind))
    result = np.maximum(base, 0.0) * np.exp2(density_noise[..., None])

    chroma_mix = np.float32(look.grain_chroma / 100.0)
    if chroma_mix > 0.0:
        channel_noise = np.stack(
            [_grain_value_noise(grain_x, grain_y, seed, salt) for salt in (31.0, 59.0, 83.0)], axis=-1
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


def _grain_pitch_pixels(width: int, height: int, look: object) -> float:
    """Return the physical grain correlation pitch at this render resolution."""
    grain_diameter_mm = (6.0 + 24.0 * float(look.grain_size) / 100.0) / 1000.0
    return _film_pixels_per_mm(width, height, look) * grain_diameter_mm


def _grain_value_noise(x: np.ndarray, y: np.ndarray, seed: int, salt: float) -> np.ndarray:
    """Bilinearly interpolate seeded lattice values into correlated grain clouds."""
    x0 = np.floor(x).astype(np.float32)
    y0 = np.floor(y).astype(np.float32)
    tx = (x - x0).astype(np.float32)
    ty = (y - y0).astype(np.float32)
    tx = tx * tx * (np.float32(3.0) - np.float32(2.0) * tx)
    ty = ty * ty * (np.float32(3.0) - np.float32(2.0) * ty)
    top_left = _grain_hash(x0, y0, seed, salt)
    top = top_left + (_grain_hash(x0 + np.float32(1.0), y0, seed, salt) - top_left) * tx
    bottom_left = _grain_hash(x0, y0 + np.float32(1.0), seed, salt)
    bottom = bottom_left + (
        _grain_hash(x0 + np.float32(1.0), y0 + np.float32(1.0), seed, salt) - bottom_left
    ) * tx
    return (top + (bottom - top) * ty).astype(np.float32)


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
