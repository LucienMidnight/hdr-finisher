"""Perceptual HDR-to-SDR match materialization.

The image target built here is deliberately temporary.  The public result is
an ordinary :class:`SDRAdjustments` recipe and ordinary SDR local grades; no
pixel snapshot or match-only rendering stage is returned or persisted.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .adjustments import (
    SDR_DISPLAY_REFERENCE_WHITE,
    _acescg_luma,
    _film_decode_luma,
    _linear_luma,
    _srgb_encode,
    apply_adjustments,
)
from .color import acescg_to_linear_srgb
from .color_context import RenderColorContext
from .finishing import apply_geometry
from .local_adjustments import _apply_local_grade, compile_geometry_fixed_mask
from .models import (
    AdjustmentState,
    ColorGradingAdjustments,
    DetailAdjustments,
    GeometryAdjustments,
    LocalAdjustment,
    LocalGrade,
    PreviewKind,
    SDRAdjustments,
    SDRMatchQualityMetrics,
    ToneEqualizerNode,
)
from .sdr_gamut import compress_to_srgb_gamut, linear_srgb_to_oklab


MATCH_SHOULDER_START = np.float32(0.90)
MATCH_SHOULDER_WIDTH = np.float32(0.10)
MATCH_ANALYSIS_EDGE = 768


class SDRMatchMaterializationError(ValueError):
    """Raised when a visible SDR recipe cannot safely represent the target."""


@dataclass(frozen=True)
class MaterializedSDRMatch:
    adjustments: AdjustmentState
    local_adjustments: list[LocalAdjustment]
    quality: SDRMatchQualityMetrics
    status: str


def automatic_sdr_match_luma(hdr_luma: np.ndarray) -> np.ndarray:
    """Place reference-relative HDR luminance on SDR and roll only its top 10%."""
    positive = np.maximum(np.asarray(hdr_luma, dtype=np.float32), 0.0)
    normalized = positive / np.float32(0.18) * SDR_DISPLAY_REFERENCE_WHITE
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        shoulder = np.float32(1.0) - MATCH_SHOULDER_WIDTH * np.exp(
            -(normalized - MATCH_SHOULDER_START) / MATCH_SHOULDER_WIDTH
        )
    return np.where(normalized <= MATCH_SHOULDER_START, normalized, shoulder).astype(np.float32)


def automatic_sdr_match_derivative(normalized_sdr_luma: np.ndarray | float) -> np.ndarray:
    """Derivative of the automatic shoulder, used to attenuate HDR-only boosts."""
    value = np.asarray(normalized_sdr_luma, dtype=np.float32)
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        shoulder = np.exp(-(value - MATCH_SHOULDER_START) / MATCH_SHOULDER_WIDTH)
    return np.where(value <= MATCH_SHOULDER_START, 1.0, shoulder).astype(np.float32)


def build_sdr_match_target(settled_hdr: np.ndarray) -> np.ndarray:
    """Construct the disposable display-linear sRGB target from a settled HDR frame."""
    hdr = np.maximum(np.asarray(settled_hdr, dtype=np.float32), 0.0)
    luma = np.maximum(_acescg_luma(hdr), 0.0)
    mapped_luma = automatic_sdr_match_luma(luma)
    ratio = np.zeros_like(luma, dtype=np.float32)
    np.divide(mapped_luma, luma, out=ratio, where=luma > np.float32(1e-8))
    mapped_acescg = hdr * ratio[..., None]
    return compress_to_srgb_gamut(acescg_to_linear_srgb(mapped_acescg))


def _refinement_improves(
    current: SDRMatchQualityMetrics, trial: SDRMatchQualityMetrics
) -> bool:
    """Accept a curve refinement only when nothing a normal match needs regresses.

    Perceptual error at the 95th percentile is what these passes are chasing, but
    a curve that buys it by pushing the median across a normal-match gate the
    current candidate still satisfies leaves the whole result worse off.
    """
    return (
        trial.p95_oklab_error < current.p95_oklab_error
        and trial.p95_luma_error <= max(0.05, current.p95_luma_error)
        and trial.median_luma_error <= max(0.01, current.median_luma_error)
        and trial.median_oklab_error <= max(0.015, current.median_oklab_error)
    )


def _apply_tone_equalizer_merge(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    source_pixel_scale: float,
    target: np.ndarray,
    body: np.ndarray,
    candidate: np.ndarray,
    quality: SDRMatchQualityMetrics,
    *,
    gain: float = 0.65,
) -> tuple[np.ndarray, SDRMatchQualityMetrics]:
    """Merge the image residual into Exposure Bands, keeping it only if it helps.

    Every other stage here proposes a change and verifies it.  This one used to
    apply unconditionally, and the Tone Equalizer's response over a narrow band
    is neither strong nor monotonic once the node corrections are re-ordered, so
    the merge could darken the very band it was computed to lift.
    """
    sdr = adjustments.sdr
    previous_nodes = [node.model_copy(deep=True) for node in sdr.tone_equalizer_nodes]
    previous_enabled = sdr.tone_equalizer_section_enabled
    _merge_image_tone_equalizer(sdr, candidate, target, body, gain=gain)
    trial = _render_candidate(source, adjustments, local_adjustments, source_pixel_scale)
    trial_quality = _quality_metrics(target, trial, body)
    improves = (
        trial_quality.p95_luma_error + 1e-6 < quality.p95_luma_error
        or (
            trial_quality.p95_luma_error <= quality.p95_luma_error + 1e-6
            and trial_quality.median_luma_error + 1e-6 < quality.median_luma_error
        )
    )
    if improves:
        return trial, trial_quality
    sdr.tone_equalizer_nodes = previous_nodes
    sdr.tone_equalizer_section_enabled = previous_enabled
    return candidate, quality


def _refine_image_exposure(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    source_pixel_scale: float,
    target: np.ndarray,
    body: np.ndarray,
) -> None:
    """Correct the neutral-ramp Exposure fit against the actual image.

    The neutral fit only ever sees a synthetic grey ramp, so it is blind to any
    error that depends on what colour the image was.  A fully desaturated grade
    is the extreme case: the HDR and SDR desaturation paths weight their
    primaries differently, which leaves a near-uniform brightness offset the
    ramp has no way to show.  The Tone Equalizer cannot clean that up on its own
    -- over a narrow band its authority is weak and not even monotonic -- so a
    bounded Exposure refinement runs first, against the real target.
    """
    sdr = adjustments.sdr
    authored = float(sdr.exposure)

    def measure(exposure: float) -> SDRMatchQualityMetrics:
        sdr.exposure = float(np.clip(exposure, -8.0, 8.0))
        return _quality_metrics(
            target, _render_candidate(source, adjustments, local_adjustments, source_pixel_scale), body
        )

    best_exposure = authored
    best_quality = measure(authored)

    def consider(offset: float) -> None:
        nonlocal best_exposure, best_quality
        exposure = authored + offset
        trial_quality = measure(exposure)
        if (
            trial_quality.p95_luma_error + 1e-6 < best_quality.p95_luma_error
            and trial_quality.p95_oklab_error <= best_quality.p95_oklab_error + 0.003
        ):
            best_exposure = float(sdr.exposure)
            best_quality = trial_quality

    for offset in (-0.30, -0.20, -0.10, 0.10, 0.20, 0.30):
        consider(offset)
    coarse = best_exposure - authored
    for offset in (coarse - 0.05, coarse + 0.05):
        consider(offset)
    sdr.exposure = best_exposure


def materialize_sdr_match(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    *,
    reference_white_nits: int,
    source_pixel_scale: float,
    settled_hdr: np.ndarray | None = None,
) -> MaterializedSDRMatch:
    """Fit a temporary HDR target into normal, editable SDR controls."""
    if reference_white_nits not in {100, 203}:
        raise SDRMatchMaterializationError("SDR Match requires the app-wide 100/203-nit reference convention.")
    source = np.asarray(source, dtype=np.float32)
    if settled_hdr is None:
        settled_hdr = apply_adjustments(
            source,
            adjustments,
            PreviewKind.HDR,
            include_grain=False,
            local_adjustments=local_adjustments,
            color_context=RenderColorContext(reference_white_nits),
            source_pixel_scale=source_pixel_scale,
        )
    if not np.isfinite(settled_hdr).all():
        raise SDRMatchMaterializationError("The HDR analysis produced invalid values.")
    target = build_sdr_match_target(settled_hdr)
    hdr_normalized_luma = (
        np.maximum(_acescg_luma(settled_hdr), 0.0)
        / np.float32(0.18)
        * SDR_DISPLAY_REFERENCE_WHITE
    )
    body = hdr_normalized_luma <= MATCH_SHOULDER_START
    if target.shape[:2] != apply_geometry(source, adjustments.shared.geometry).shape[:2]:
        raise SDRMatchMaterializationError("The HDR analysis target has inconsistent geometry.")
    if not np.isfinite(target).all():
        raise SDRMatchMaterializationError("The HDR analysis produced invalid values.")

    result_adjustments = adjustments.model_copy(deep=True)
    result_adjustments.sdr = _semantic_sdr_translation(adjustments, settled_hdr)
    result_locals = _materialize_local_grades(source, settled_hdr, adjustments, local_adjustments)

    _fit_neutral_tonal_response(result_adjustments, adjustments, reference_white_nits)
    _refine_image_exposure(
        source, result_adjustments, result_locals, source_pixel_scale, target, body
    )

    candidate = _render_candidate(source, result_adjustments, result_locals, source_pixel_scale)
    quality = _quality_metrics(target, candidate, body)
    candidate, quality = _apply_tone_equalizer_merge(
        source, result_adjustments, result_locals, source_pixel_scale, target, body, candidate, quality
    )
    candidate, quality = _fit_image_semantic_controls(
        source,
        result_adjustments,
        result_locals,
        source_pixel_scale,
        target,
        candidate,
        quality,
        body,
    )
    if quality.p95_oklab_error > 0.04:
        # A color-only residual is occasionally needed for saturated gamut-edge
        # patches. Keep these curves sparse and strictly sloped; the luma curve
        # remains neutral, so Exposure stays responsive throughout the range.
        original_curves = {
            channel_name: getattr(result_adjustments.sdr, channel_name)
            for channel_name in ("red_curve", "green_curve", "blue_curve")
        }
        jointly_fitted = {
            channel_name: _fit_image_curve(candidate[..., channel_index], target[..., channel_index], body)
            for channel_name, channel_index in (("red_curve", 0), ("green_curve", 1), ("blue_curve", 2))
        }
        for channel_name, curve in jointly_fitted.items():
            setattr(result_adjustments.sdr, channel_name, curve)
        joint_candidate = _render_candidate(source, result_adjustments, result_locals, source_pixel_scale)
        joint_quality = _quality_metrics(target, joint_candidate, body)
        if _refinement_improves(quality, joint_quality):
            candidate = joint_candidate
            quality = joint_quality
        else:
            for channel_name, curve in original_curves.items():
                setattr(result_adjustments.sdr, channel_name, curve)
        # A second small residual pass is materially better than making the
        # first seven-point fit aggressive. Compose only while both perceptual
        # error and the luma safety gate improve, retaining editable slope.
        for _ in range(2):
            previous_curves = {
                channel_name: getattr(result_adjustments.sdr, channel_name)
                for channel_name in ("red_curve", "green_curve", "blue_curve")
            }
            for channel_name, channel_index in (("red_curve", 0), ("green_curve", 1), ("blue_curve", 2)):
                correction = _fit_image_curve(candidate[..., channel_index], target[..., channel_index], body)
                setattr(
                    result_adjustments.sdr,
                    channel_name,
                    _compose_curve(previous_curves[channel_name], correction),
                )
            residual_candidate = _render_candidate(
                source, result_adjustments, result_locals, source_pixel_scale
            )
            residual_quality = _quality_metrics(target, residual_candidate, body)
            if _refinement_improves(quality, residual_quality):
                candidate = residual_candidate
                quality = residual_quality
            else:
                for channel_name, curve in previous_curves.items():
                    setattr(result_adjustments.sdr, channel_name, curve)
                break
        for channel_name, channel_index in (("red_curve", 0), ("green_curve", 1), ("blue_curve", 2)):
            previous = getattr(result_adjustments.sdr, channel_name)
            setattr(result_adjustments.sdr, channel_name, _fit_image_curve(
                candidate[..., channel_index], target[..., channel_index], body
            ))
            trial_candidate = _render_candidate(source, result_adjustments, result_locals, source_pixel_scale)
            trial_quality = _quality_metrics(target, trial_candidate, body)
            if _refinement_improves(quality, trial_quality):
                candidate = trial_candidate
                quality = trial_quality
            else:
                setattr(result_adjustments.sdr, channel_name, previous)
    if quality.p95_luma_error > 0.05 or quality.p95_oklab_error > 0.05:
        # One conservative luma-only correction is permitted before rejecting.
        # It remains an ordinary Tone Equalizer edit so later Exposure changes
        # keep useful slope and never run into an auto-generated curve plateau.
        candidate, quality = _apply_tone_equalizer_merge(
            source, result_adjustments, result_locals, source_pixel_scale, target, body,
            candidate, quality, gain=0.45,
        )

    if not np.isfinite(candidate).all() or quality.p95_luma_error > 0.05 or quality.p95_oklab_error > 0.05:
        raise SDRMatchMaterializationError(
            "Automatic Match could not be safely materialized into the visible SDR controls "
            f"(P95 luma {quality.p95_luma_error:.3f}, OKLab {quality.p95_oklab_error:.3f})."
        )

    normal = (
        quality.median_luma_error <= 0.01
        and quality.p95_luma_error <= 0.03
        and quality.median_oklab_error <= 0.015
        and quality.p95_oklab_error <= 0.04
        and _highlight_order_is_safe(settled_hdr, candidate)
    )
    return MaterializedSDRMatch(
        adjustments=result_adjustments,
        local_adjustments=result_locals,
        quality=quality,
        status="matched" if normal else "needs_review",
    )


# The luma weights _apply_color_grading uses to make a wheel's tint neutral.
# They differ per lane, which is why the same wheel is a different colour in
# each -- see _translate_color_grading_wheels.
_HDR_GRADING_LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
_SDR_GRADING_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _grading_tint_vectors(hues: object, weights: np.ndarray) -> np.ndarray:
    """The tint directions _apply_color_grading builds for these wheel angles."""
    angle = np.deg2rad(np.asarray(hues, dtype=np.float32)).reshape(-1, 1)
    vectors = np.concatenate(
        (np.cos(angle), np.cos(angle - 2.0 * np.pi / 3.0), np.cos(angle + 2.0 * np.pi / 3.0)),
        axis=1,
    ).astype(np.float32)
    vectors -= vectors @ np.asarray(weights, dtype=np.float32).reshape(3, 1)
    vectors /= np.maximum(np.max(np.abs(vectors), axis=1, keepdims=True), 1e-6)
    return vectors


def _translate_color_grading_wheels(
    grading: ColorGradingAdjustments, source: ColorGradingAdjustments
) -> None:
    """Re-aim each wheel so SDR tints the colour the HDR lane actually produced.

    Each lane builds its wheel direction in its own primaries and makes it
    luma-neutral with its own weights, so an identical hue number is a
    different colour in each -- up to sixteen degrees apart, and up to twice the
    strength, once the HDR tint is measured in display primaries. Copying the
    numbers across therefore does not copy the grade.  Solve instead for the
    wheel angle and saturation whose SDR tint best reproduces the HDR one.
    """
    candidate_hues = np.arange(0.0, 360.0, 0.25, dtype=np.float32)
    candidates = _grading_tint_vectors(candidate_hues, _SDR_GRADING_LUMA)
    energy = np.maximum(np.sum(candidates * candidates, axis=1), 1e-6)
    for name in ("shadows", "midtones", "highlights"):
        authored = getattr(source, name)
        saturation = float(authored.saturation)
        if saturation <= 1e-6:
            continue
        target = acescg_to_linear_srgb(
            (
                _grading_tint_vectors([authored.hue], _HDR_GRADING_LUMA)[0]
                * np.float32(saturation)
            ).reshape(1, 1, 3)
        ).reshape(3)
        scales = (candidates @ target) / energy
        residuals = np.linalg.norm(candidates * scales[:, None] - target, axis=1)
        residuals = np.where(scales > 0.0, residuals, np.float32(np.inf))
        best = int(np.argmin(residuals))
        wheel = getattr(grading, name)
        wheel.hue = float(candidate_hues[best] % 360.0)
        wheel.saturation = float(np.clip(scales[best], 0.0, 100.0))


def _semantic_sdr_translation(adjustments: AdjustmentState, settled_hdr: np.ndarray) -> SDRAdjustments:
    hdr = adjustments.hdr
    sdr = SDRAdjustments(use_authored_base=False)
    sdr.rendering_version = "highlight_v2"
    sdr.highlight_section_enabled = True
    sdr.highlight_compression_mode = "peak_fit"
    sdr.highlight_compression_start_percent = 90.0
    # Match is reproducing an already rendered HDR target, whose shoulder is
    # luma-ratio preserving. Ordinary new SDR grades still default to Smooth
    # Color Rolloff; the materialized recipe chooses the faithful target mode.
    sdr.highlight_compression_color_handling = "preserve_color"
    sdr.tone_section_enabled = True
    sdr.tone_equalizer_section_enabled = True
    sdr.color_section_enabled = hdr.color_section_enabled
    sdr.primaries_section_enabled = hdr.primaries_section_enabled
    sdr.curves_section_enabled = True
    sdr.detail_section_enabled = hdr.detail_section_enabled
    sdr.film_look_section_enabled = hdr.film_look_section_enabled
    sdr.color_grading_section_enabled = hdr.color_grading_section_enabled
    sdr.vignette_section_enabled = hdr.vignette_section_enabled

    for name in (
        "white_balance_kelvin", "tint", "saturation", "vibrance",
        "red_hue", "red_purity", "green_hue", "green_purity",
        "blue_hue", "blue_purity", "tint_hue", "tint_purity",
    ):
        setattr(sdr, name, getattr(hdr, name))
    sdr.detail = hdr.detail.model_copy(deep=True)
    sdr.vignette = hdr.vignette.model_copy(deep=True)
    sdr.film_look = hdr.film_look.model_copy(deep=True)
    sdr.color_grading = hdr.color_grading.model_copy(deep=True)
    _translate_color_grading_wheels(sdr.color_grading, hdr.color_grading)

    luma = np.maximum(_acescg_luma(settled_hdr), 0.0)
    normalized = luma / np.float32(0.18) * SDR_DISPLAY_REFERENCE_WHITE
    # Use the complete highlight population, not an extreme percentile. A
    # percentile was driven to effectively zero by a few very bright pixels,
    # which removed legitimate highlight color and film response from the SDR
    # body. Weight the shoulder derivative by the region where qualified
    # controls actually become visible.
    highlight_support = np.clip((normalized - np.float32(0.35)) / np.float32(0.55), 0.0, 1.0)
    support_sum = float(np.sum(highlight_support))
    highlight_factor = (
        float(np.sum(highlight_support * automatic_sdr_match_derivative(normalized)) / support_sum)
        if support_sum > 1e-6
        else 1.0
    )
    # Compensate for the narrower SDR qualification zone while retaining the
    # required limit: a control supported only by compressed speculars tends to
    # zero, and a control supported entirely by the body remains unchanged.
    qualification_scale = float(np.clip(highlight_factor * (4.0 - 3.0 * highlight_factor), 0.0, 4.0 / 3.0))
    _attenuate_highlight_qualified_controls(sdr.color_grading, min(1.0, qualification_scale))
    sdr.film_look.highlight_desaturation *= qualification_scale
    _translate_film_highlight_sensitivity(sdr.film_look, hdr.film_look, highlight_factor)
    return sdr


def _attenuate_highlight_qualified_controls(grading: ColorGradingAdjustments, factor: float) -> None:
    grading.highlights.saturation *= factor
    grading.highlights.luminance_ev *= factor


def _translate_film_highlight_sensitivity(target: object, source: object, factor: float) -> None:
    for name in ("halation_sensitivity", "bloom_sensitivity"):
        sensitivity = float(getattr(source, name))
        hdr_threshold = np.float32(0.92 - 0.50 * np.clip(sensitivity / 100.0, 0.0, 1.0))
        hdr_luma = _film_decode_luma(np.array(hdr_threshold, dtype=np.float32), PreviewKind.HDR)
        sdr_threshold = float(_srgb_encode(automatic_sdr_match_luma(hdr_luma)))
        setattr(target, name, float(np.clip((0.92 - sdr_threshold) / 0.50 * 100.0, 0.0, 100.0)))
    target.halation_amount *= max(0.50, float(np.sqrt(max(factor, 0.0))))
    target.bloom_amount *= max(0.25, float(np.sqrt(max(factor, 0.0))))


def _materialize_local_grades(
    source: np.ndarray,
    settled_hdr: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
) -> list[LocalAdjustment]:
    if not local_adjustments:
        return []
    hdr_luma = np.maximum(_acescg_luma(settled_hdr), 0.0)
    normalized = hdr_luma / np.float32(0.18) * SDR_DISPLAY_REFERENCE_WHITE
    derivative = automatic_sdr_match_derivative(normalized)
    materialized: list[LocalAdjustment] = []
    for local in local_adjustments:
        factor = 1.0
        try:
            mask = compile_geometry_fixed_mask(source, local.mask, adjustments.shared.geometry, spatial_only=True)
            weights = np.maximum(mask.astype(np.float32), 0.0)
            if weights.shape == derivative.shape and float(np.sum(weights)) > 1e-6:
                factor = float(np.sum(weights * derivative) / np.sum(weights))
        except (ValueError, FloatingPointError):
            factor = 1.0
        translated = _translate_local_grade(local.hdr_grade, factor)
        materialized.append(local.model_copy(update={"sdr_grade": translated}, deep=True))
    return materialized


def _translate_local_grade(hdr_grade: LocalGrade, highlight_factor: float) -> LocalGrade:
    sdr_grade = LocalGrade()
    for name in ("white_balance_kelvin", "tint", "saturation", "vibrance"):
        setattr(sdr_grade, name, getattr(hdr_grade, name))
    sdr_grade.detail = hdr_grade.detail.model_copy(deep=True)
    sdr_grade.color_grading = hdr_grade.color_grading.model_copy(deep=True)
    _attenuate_highlight_qualified_controls(sdr_grade.color_grading, highlight_factor)

    scene_values = np.concatenate(
        (np.array([0.0], dtype=np.float32), np.geomspace(1e-5, 0.18 * 64.0, 1023).astype(np.float32))
    )
    ramp = np.repeat(scene_values[None, :, None], 3, axis=2)
    tonal = hdr_grade.model_copy(deep=True)
    tonal.white_balance_kelvin = 6500
    tonal.tint = tonal.saturation = tonal.vibrance = 0.0
    tonal.detail = DetailAdjustments()
    tonal.color_grading.shadows.saturation = 0.0
    tonal.color_grading.midtones.saturation = 0.0
    tonal.color_grading.highlights.saturation = 0.0
    output = _apply_local_grade(ramp, tonal, PreviewKind.HDR)
    input_sdr = automatic_sdr_match_luma(scene_values)
    output_sdr = automatic_sdr_match_luma(np.maximum(_acescg_luma(output)[0], 0.0))
    _fit_local_tonal_controls(sdr_grade, input_sdr, output_sdr)
    # A local supported only by specular pixels must not reappear as a broad SDR
    # adjustment. Preserve mixed/body masks, but smoothly neutralize tone when
    # the mask-weighted shoulder derivative says no editable SDR body remains.
    tonal_strength = float(np.clip((highlight_factor - 0.02) / 0.48, 0.0, 1.0))
    tonal_strength = tonal_strength * tonal_strength * (3.0 - 2.0 * tonal_strength)
    for name in ("exposure", "highlights", "midtones", "shadows", "blacks", "contrast"):
        setattr(sdr_grade, name, float(getattr(sdr_grade, name) * tonal_strength))
    return sdr_grade


def _fit_local_tonal_controls(grade: LocalGrade, source_luma: np.ndarray, target_luma: np.ndarray) -> None:
    """Represent a local HDR transfer with the GPU-supported local tone sliders."""
    source = np.asarray(source_luma, dtype=np.float64)
    target = np.asarray(target_luma, dtype=np.float64)
    valid = (
        np.isfinite(source)
        & np.isfinite(target)
        & (source > 1e-5)
        & (source < 0.995)
        & (target > 1e-5)
    )
    if int(np.count_nonzero(valid)) < 16:
        return
    source = source[valid]
    target = np.clip(target[valid], 1e-6, 1.0)
    # Specular samples describe a diminishing shoulder. They should influence
    # the highlight slider, but must not redistribute that energy into the SDR
    # body or force a flat local curve.
    weights = np.where(source <= MATCH_SHOULDER_START, 1.0, automatic_sdr_match_derivative(source))
    weights = np.maximum(weights.astype(np.float64), 0.05)
    best: tuple[float, float, np.ndarray] | None = None
    best_loss = float("inf")
    for pivot in (0.18, 0.25, 0.36, float(SDR_DISPLAY_REFERENCE_WHITE)):
        stops = np.log2(source / pivot)
        features = np.column_stack((
            np.ones_like(stops),
            np.clip((-stops - 3.0) / 3.0, 0.0, 1.0),
            np.clip(1.0 - np.abs(stops + 2.0) / 2.5, 0.0, 1.0),
            np.clip(1.0 - np.abs(stops) / 2.5, 0.0, 1.0),
            np.clip((stops - 0.5) / 3.0, 0.0, 1.0),
            stops,
        ))
        desired = np.log2(target / pivot)
        root_weight = np.sqrt(weights)
        coefficients, *_ = np.linalg.lstsq(features * root_weight[:, None], desired * root_weight, rcond=None)
        coefficients[0] = np.clip(coefficients[0], -8.0, 8.0)
        coefficients[1:5] = np.clip(coefficients[1:5], -2.0, 2.0)
        coefficients[5] = np.clip(coefficients[5], 0.25, 4.0)
        predicted_stops = features[:, :-1] @ coefficients[:-1] + features[:, -1] * coefficients[-1]
        predicted = pivot * np.exp2(np.clip(predicted_stops, -32.0, 24.0))
        loss = float(np.median(np.abs(predicted - target)) + 0.25 * np.percentile(np.abs(predicted - target), 95))
        if loss < best_loss:
            best_loss = loss
            best = (pivot, float(np.log2(coefficients[5])), coefficients)
    if best is None:
        return
    pivot, contrast, coefficients = best
    grade.contrast_pivot = pivot
    grade.exposure = float(coefficients[0])
    grade.blacks = float(coefficients[1])
    grade.shadows = float(coefficients[2])
    grade.midtones = float(coefficients[3])
    grade.highlights = float(coefficients[4])
    grade.contrast = contrast
    grade.luma_curve = _identity_curve()
    grade.red_curve = _identity_curve()
    grade.green_curve = _identity_curve()
    grade.blue_curve = _identity_curve()


def _fit_neutral_tonal_response(
    target_adjustments: AdjustmentState,
    hdr_adjustments: AdjustmentState,
    reference_white_nits: int,
) -> None:
    values = np.concatenate(
        (np.array([0.0], dtype=np.float32), np.geomspace(1e-5, 0.18 * 64.0, 767).astype(np.float32))
    )
    ramp = np.repeat(values[None, :, None], 3, axis=2)
    hdr_analysis = _tonal_analysis_copy(hdr_adjustments)
    target_hdr = apply_adjustments(
        ramp,
        hdr_analysis,
        PreviewKind.HDR,
        include_grain=False,
        color_context=RenderColorContext(reference_white_nits),
    )
    target_luma = automatic_sdr_match_luma(np.maximum(_acescg_luma(target_hdr)[0], 0.0))
    body = (target_luma > 0.002) & (target_luma <= MATCH_SHOULDER_START)

    best: tuple[float, float, float, float] | None = None
    best_loss = float("inf")
    exposure_center = float(np.clip(hdr_adjustments.hdr.exposure, -4.0, 4.0))
    for exposure in np.linspace(exposure_center - 2.0, exposure_center + 2.0, 9):
        for start_percent in (70.0, 80.0, 90.0, 95.0):
            for detail in (0.0, 35.0, 70.0):
                for bias in (-35.0, 0.0, 35.0):
                    trial = _tonal_analysis_copy(target_adjustments)
                    trial.sdr.tone_equalizer_section_enabled = False
                    trial.sdr.exposure = float(np.clip(exposure, -8.0, 8.0))
                    trial.sdr.highlight_compression_start_percent = start_percent
                    trial.sdr.highlight_compression_peak_detail = detail
                    trial.sdr.highlight_compression_bias = bias
                    candidate = apply_adjustments(ramp, trial, PreviewKind.SDR, include_grain=False)
                    candidate_luma = np.maximum(_linear_luma(candidate)[0], 1e-6)
                    log_error = np.abs(np.log2(candidate_luma[body] / np.maximum(target_luma[body], 1e-6)))
                    linear_error = np.abs(candidate_luma[body] - target_luma[body])
                    loss = float(np.median(log_error) + np.percentile(linear_error, 90))
                    if loss < best_loss:
                        best_loss = loss
                        best = (
                            trial.sdr.exposure,
                            start_percent,
                            detail,
                            bias,
                        )
    assert best is not None
    (
        target_adjustments.sdr.exposure,
        target_adjustments.sdr.highlight_compression_start_percent,
        target_adjustments.sdr.highlight_compression_peak_detail,
        target_adjustments.sdr.highlight_compression_bias,
    ) = best
    best_contrast = 0.0
    best_contrast_loss = float("inf")
    for contrast in np.linspace(-0.30, 0.30, 7):
        trial = _tonal_analysis_copy(target_adjustments)
        trial.sdr.tone_equalizer_section_enabled = False
        trial.sdr.contrast = float(contrast)
        candidate = apply_adjustments(ramp, trial, PreviewKind.SDR, include_grain=False)
        candidate_luma = np.maximum(_linear_luma(candidate)[0], 1e-6)
        loss = float(np.median(np.abs(np.log2(candidate_luma[body] / np.maximum(target_luma[body], 1e-6)))))
        if loss < best_contrast_loss:
            best_contrast_loss = loss
            best_contrast = float(contrast)
    target_adjustments.sdr.contrast = best_contrast
    fitted = _tonal_analysis_copy(target_adjustments)
    fitted.sdr.tone_equalizer_section_enabled = False
    candidate = apply_adjustments(ramp, fitted, PreviewKind.SDR, include_grain=False)
    target_adjustments.sdr.tone_equalizer_nodes = _fit_tone_equalizer_nodes(
        _linear_luma(candidate)[0], target_luma, body
    )
    target_adjustments.sdr.tone_equalizer_section_enabled = True
    target_adjustments.sdr.luma_curve = _identity_curve()
    target_adjustments.sdr.red_curve = _identity_curve()
    target_adjustments.sdr.green_curve = _identity_curve()
    target_adjustments.sdr.blue_curve = _identity_curve()


def _tonal_analysis_copy(adjustments: AdjustmentState) -> AdjustmentState:
    result = adjustments.model_copy(deep=True)
    result.shared.geometry = GeometryAdjustments()
    for branch in (result.hdr, result.sdr):
        branch.detail_section_enabled = False
        branch.vignette_section_enabled = False
        look = branch.film_look
        look.grain_enabled = False
        look.halation_enabled = False
        look.bloom_enabled = False
        look.image_structure_enabled = False
        look.film_resolution = 100.0
    return result


def _render_candidate(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    source_pixel_scale: float,
) -> np.ndarray:
    return apply_adjustments(
        source,
        adjustments,
        PreviewKind.SDR,
        include_grain=False,
        local_adjustments=local_adjustments,
        source_pixel_scale=source_pixel_scale,
    )


def _fit_image_semantic_controls(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    source_pixel_scale: float,
    target: np.ndarray,
    candidate: np.ndarray,
    quality: SDRMatchQualityMetrics,
    body: np.ndarray,
) -> tuple[np.ndarray, SDRMatchQualityMetrics]:
    """Prefer small visible semantic corrections before authoring RGB curves."""
    sdr = adjustments.sdr

    def score(metrics: SDRMatchQualityMetrics) -> float:
        gate_penalty = (
            10.0 * max(0.0, metrics.p95_luma_error - 0.03)
            + 10.0 * max(0.0, metrics.p95_oklab_error - 0.04)
            + 10.0 * max(0.0, metrics.median_luma_error - 0.01)
            + 10.0 * max(0.0, metrics.median_oklab_error - 0.015)
        )
        return float(
            gate_penalty
            + metrics.p95_luma_error
            + metrics.p95_oklab_error
            + 0.25 * metrics.median_luma_error
            + 0.25 * metrics.median_oklab_error
        )

    def accept_trial(trial: np.ndarray, trial_quality: SDRMatchQualityMetrics) -> bool:
        return (
            score(trial_quality) + 1e-6 < score(quality)
            and trial_quality.p95_luma_error <= max(0.05, quality.p95_luma_error + 0.003)
            and trial_quality.p95_oklab_error <= max(0.05, quality.p95_oklab_error + 0.003)
            # A semantic correction may improve the aggregate score while
            # pushing a normal-match gate the current candidate still meets
            # over its limit. Never trade a satisfied gate away.
            and trial_quality.median_luma_error <= max(0.01, quality.median_luma_error)
            and trial_quality.median_oklab_error <= max(0.015, quality.median_oklab_error)
        )

    if quality.p95_luma_error <= 0.03 and quality.p95_oklab_error <= 0.04:
        return candidate, quality

    authored_saturation = float(sdr.saturation)
    authored_vignette = float(sdr.vignette.amount)
    best_saturation = authored_saturation
    best_vignette = authored_vignette

    def try_trial(saturation: float, vignette_amount: float) -> None:
        nonlocal candidate, quality, best_saturation, best_vignette
        sdr.saturation = float(np.clip(saturation, -1.0, 3.0))
        sdr.vignette.amount = float(np.clip(vignette_amount, -100.0, 100.0))
        trial = _render_candidate(source, adjustments, local_adjustments, source_pixel_scale)
        trial_quality = _quality_metrics(target, trial, body)
        if accept_trial(trial, trial_quality):
            candidate, quality = trial, trial_quality
            best_saturation = sdr.saturation
            best_vignette = sdr.vignette.amount

    # Saturation is fitted against the vignette the grade actually authored.
    # Pairing every saturation offset with a scaled-away vignette let a residual
    # that has nothing to do with falloff quietly halve or erase a copied
    # Vignette, so the two axes are searched separately.
    # Ordered by magnitude so the smallest departure from the authored
    # Saturation wins whenever a larger one is not materially better.
    for saturation_offset in (-0.08, 0.08, -0.16, 0.16, -0.24, 0.24, -0.32, 0.32, -0.40):
        try_trial(authored_saturation + saturation_offset, authored_vignette)
    # Only once saturation has settled may the vignette itself give, and only
    # when the grade authored one at all.
    if sdr.vignette_section_enabled and abs(authored_vignette) > 1e-6:
        for vignette_scale in (0.5, 0.0):
            try_trial(best_saturation, authored_vignette * vignette_scale)
    sdr.saturation = best_saturation
    sdr.vignette.amount = best_vignette

    return candidate, quality


_MATCH_TONE_NODE_EV = np.array([-6.0, -4.0, -2.0, 0.0, 1.25, 2.30, 3.50, 6.0], dtype=np.float32)


def _fit_tone_equalizer_nodes(
    source: np.ndarray,
    target: np.ndarray,
    selection: np.ndarray,
) -> list[ToneEqualizerNode]:
    """Fit a compact, ordered stop-domain residual without authoring curves."""
    source_luma = np.asarray(source, dtype=np.float32).reshape(-1)
    target_luma = np.asarray(target, dtype=np.float32).reshape(-1)
    selected = np.asarray(selection, dtype=bool).reshape(-1)
    valid = (
        selected
        & np.isfinite(source_luma)
        & np.isfinite(target_luma)
        & (source_luma > 1e-6)
        & (target_luma > 1e-6)
    )
    if int(np.count_nonzero(valid)) < 8:
        return [ToneEqualizerNode(input_ev=float(node), adjustment_ev=0.0) for node in _MATCH_TONE_NODE_EV]
    source_ev = np.log2(source_luma[valid] / np.float32(0.18))
    target_ev = np.log2(target_luma[valid] / np.float32(0.18))
    correction = _binned_stop_residual(source_ev, target_ev - source_ev, _MATCH_TONE_NODE_EV)
    correction = _ordered_tone_corrections(_MATCH_TONE_NODE_EV, correction)
    return [
        ToneEqualizerNode(input_ev=float(node), adjustment_ev=float(delta))
        for node, delta in zip(_MATCH_TONE_NODE_EV, correction, strict=True)
    ]


def _merge_image_tone_equalizer(
    sdr: SDRAdjustments,
    candidate: np.ndarray,
    target: np.ndarray,
    selection: np.ndarray,
    *,
    gain: float = 0.65,
) -> None:
    """Merge a conservative image residual into visible Tone Equalizer nodes."""
    candidate_luma = _linear_luma(candidate).reshape(-1)
    target_luma = _linear_luma(target).reshape(-1)
    selected = np.asarray(selection, dtype=bool).reshape(-1)
    valid = (
        selected
        & np.isfinite(candidate_luma)
        & np.isfinite(target_luma)
        & (candidate_luma > 1e-6)
        & (target_luma > 1e-6)
    )
    if int(np.count_nonzero(valid)) < 8:
        return
    source_ev = np.log2(candidate_luma[valid] / np.float32(0.18))
    residual = np.log2(target_luma[valid] / np.float32(0.18)) - source_ev
    node_ev = np.asarray([node.input_ev for node in sdr.tone_equalizer_nodes], dtype=np.float32)
    current = np.asarray([node.adjustment_ev for node in sdr.tone_equalizer_nodes], dtype=np.float32)
    delta = _binned_stop_residual(source_ev, residual, node_ev, extrapolate=False)
    merged = _ordered_tone_corrections(node_ev, current + np.float32(gain) * delta)
    sdr.tone_equalizer_nodes = [
        ToneEqualizerNode(input_ev=float(node), adjustment_ev=float(correction))
        for node, correction in zip(node_ev, merged, strict=True)
    ]
    sdr.tone_equalizer_section_enabled = True


def _binned_stop_residual(
    sample_ev: np.ndarray,
    residual_ev: np.ndarray,
    node_ev: np.ndarray,
    *,
    extrapolate: bool = True,
) -> np.ndarray:
    order = np.argsort(sample_ev)
    sample = np.asarray(sample_ev, dtype=np.float32)[order]
    residual = np.asarray(residual_ev, dtype=np.float32)[order]
    centers: list[float] = []
    values: list[float] = []
    edges = np.concatenate((
        np.array([-np.inf], dtype=np.float32),
        (node_ev[:-1] + node_ev[1:]) * np.float32(0.5),
        np.array([np.inf], dtype=np.float32),
    ))
    for index, node in enumerate(node_ev):
        members = (sample >= edges[index]) & (sample < edges[index + 1])
        if int(np.count_nonzero(members)) >= 2:
            centers.append(float(node))
            values.append(float(np.median(residual[members])))
    if not centers:
        return np.zeros_like(node_ev, dtype=np.float32)
    left = values[0] if extrapolate else 0.0
    right = values[-1] if extrapolate else 0.0
    result = np.interp(node_ev, np.asarray(centers), np.asarray(values), left=left, right=right).astype(np.float32)
    return np.clip(result, -2.0, 2.0)


def _ordered_tone_corrections(node_ev: np.ndarray, corrections: np.ndarray) -> np.ndarray:
    corrections = np.clip(np.asarray(corrections, dtype=np.float32), -2.0, 2.0)
    targets = node_ev.astype(np.float32) + corrections
    minimum_step = np.float32(0.02)
    for index in range(1, len(targets)):
        targets[index] = max(targets[index], targets[index - 1] + minimum_step)
    for index in range(len(targets) - 2, -1, -1):
        targets[index] = min(targets[index], targets[index + 1] - minimum_step)
    return np.clip(targets - node_ev, -2.0, 2.0).astype(np.float32)


def _fit_image_curve(source: np.ndarray, target: np.ndarray, selection: np.ndarray) -> list[list[float]]:
    x = np.asarray(source, dtype=np.float32).reshape(-1)
    y = np.asarray(target, dtype=np.float32).reshape(-1)
    mask = np.asarray(selection, dtype=bool).reshape(-1)
    valid = mask & np.isfinite(x) & np.isfinite(y) & (x >= 0.0) & (x <= 1.0)
    if int(np.count_nonzero(valid)) < 8:
        return _identity_curve()
    x = np.clip(x[valid], 0.0, 1.0)
    y = np.clip(y[valid], 0.0, 1.0)
    edges = np.linspace(0.0, 1.0, 129, dtype=np.float32)
    centers: list[float] = []
    medians: list[float] = []
    weights: list[float] = []
    indices = np.minimum(np.searchsorted(edges, x, side="right") - 1, len(edges) - 2)
    for index in range(len(edges) - 1):
        selected = indices == index
        count = int(np.count_nonzero(selected))
        if count:
            centers.append(float(np.median(x[selected])))
            medians.append(float(np.median(y[selected])))
            weights.append(float(count))
    if len(centers) < 2:
        return _identity_curve()
    centers_array = np.asarray(centers, dtype=np.float32)
    medians_array = _pav(np.asarray(medians, dtype=np.float32), np.asarray(weights, dtype=np.float32))
    sample_x = np.array([0.0, 0.08, 0.20, 0.40, 0.65, 0.85, 1.0], dtype=np.float32)
    sample_y = np.interp(sample_x, centers_array, medians_array, left=0.0, right=1.0).astype(np.float32)
    sample_y[0] = 0.0
    sample_y[-1] = 1.0
    sample_y = _constrain_editable_curve(sample_x, sample_y)
    return [[float(xx), float(yy)] for xx, yy in zip(sample_x, sample_y, strict=True)]


def _constrain_editable_curve(sample_x: np.ndarray, sample_y: np.ndarray) -> np.ndarray:
    """Keep generated color residuals responsive and free of flat shoulders."""
    output = np.clip(np.asarray(sample_y, dtype=np.float32), 0.0, 1.0)
    output[0] = 0.0
    output[-1] = 1.0
    minimum_slope = np.float32(0.20)
    maximum_slope = np.float32(3.0)
    for _ in range(3):
        for index in range(1, len(output) - 1):
            width = sample_x[index] - sample_x[index - 1]
            output[index] = np.clip(
                output[index],
                output[index - 1] + minimum_slope * width,
                output[index - 1] + maximum_slope * width,
            )
        for index in range(len(output) - 2, 0, -1):
            width = sample_x[index + 1] - sample_x[index]
            output[index] = np.clip(
                output[index],
                output[index + 1] - maximum_slope * width,
                output[index + 1] - minimum_slope * width,
            )
    return output


def _pav(values: np.ndarray, weights: np.ndarray) -> np.ndarray:
    levels: list[float] = []
    masses: list[float] = []
    starts: list[int] = []
    ends: list[int] = []
    for index, (value, weight) in enumerate(zip(values, weights, strict=True)):
        levels.append(float(value))
        masses.append(max(float(weight), 1e-6))
        starts.append(index)
        ends.append(index + 1)
        while len(levels) >= 2 and levels[-2] > levels[-1]:
            mass = masses[-2] + masses[-1]
            level = (levels[-2] * masses[-2] + levels[-1] * masses[-1]) / mass
            levels[-2:] = [level]
            masses[-2:] = [mass]
            ends[-2:] = [ends[-1]]
            starts.pop()
    result = np.empty_like(values, dtype=np.float32)
    for level, start, end in zip(levels, starts, ends, strict=True):
        result[start:end] = np.float32(level)
    return result


def _compose_curve(base: list[list[float]], correction: list[list[float]]) -> list[list[float]]:
    base_array = np.asarray(base, dtype=np.float32)
    correction_array = np.asarray(correction, dtype=np.float32)
    sample_x = np.array([0.0, 0.08, 0.20, 0.40, 0.65, 0.85, 1.0], dtype=np.float32)
    base_y = np.interp(sample_x, base_array[:, 0], base_array[:, 1]).astype(np.float32)
    output = np.interp(base_y, correction_array[:, 0], correction_array[:, 1]).astype(np.float32)
    output = _constrain_editable_curve(sample_x, output)
    return [[float(xx), float(yy)] for xx, yy in zip(sample_x, output, strict=True)]


def _identity_curve() -> list[list[float]]:
    return [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]


def _quality_metrics(
    target: np.ndarray,
    candidate: np.ndarray,
    body: np.ndarray | None = None,
) -> SDRMatchQualityMetrics:
    target_luma = _linear_luma(target)
    candidate_luma = _linear_luma(candidate)
    if body is None:
        body = target_luma <= MATCH_SHOULDER_START
    else:
        body = np.asarray(body, dtype=bool)
        if body.shape != target_luma.shape:
            raise ValueError("SDR Match quality selection must match the rendered image geometry.")
    # OKLab's cube-root toe makes minute linear values look numerically large:
    # mapping 0.0002 to display black is roughly a 0.058 Lab distance despite
    # being below the useful SDR grading floor. Keep the safety metric focused
    # on visible body tones rather than letting sub-0.1% patches dominate P95.
    body = body & (target_luma >= np.float32(0.0008))
    if not np.any(body):
        body = np.ones_like(target_luma, dtype=bool)
    luma_error = np.abs(candidate_luma - target_luma)[body]
    target_lab = linear_srgb_to_oklab(np.clip(target, 0.0, 1.0))
    candidate_lab = linear_srgb_to_oklab(np.clip(candidate, 0.0, 1.0))
    oklab_error = np.linalg.norm(candidate_lab - target_lab, axis=-1)[body]
    return SDRMatchQualityMetrics(
        median_luma_error=float(np.median(luma_error)),
        p95_luma_error=float(np.percentile(luma_error, 95.0)),
        median_oklab_error=float(np.median(oklab_error)),
        p95_oklab_error=float(np.percentile(oklab_error, 95.0)),
    )


def _highlight_order_is_safe(settled_hdr: np.ndarray, candidate: np.ndarray) -> bool:
    source_luma = np.maximum(_acescg_luma(settled_hdr), 0.0)
    normalized = source_luma / np.float32(0.18) * SDR_DISPLAY_REFERENCE_WHITE
    output = _linear_luma(candidate)
    selection = normalized > MATCH_SHOULDER_START
    if int(np.count_nonzero(selection)) < 8:
        return True
    x = normalized[selection]
    y = output[selection]
    edges = np.quantile(x, np.linspace(0.0, 1.0, 9))
    medians: list[float] = []
    for lower, upper in zip(edges[:-1], edges[1:], strict=True):
        members = (x >= lower) & (x <= upper)
        if np.any(members):
            medians.append(float(np.median(y[members])))
    return len(medians) < 2 or bool(np.all(np.diff(medians) >= -0.005))
