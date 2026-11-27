"""Perceptual HDR-to-SDR match materialization.

The image target built here is deliberately temporary.  The public result is
an ordinary :class:`SDRAdjustments` recipe and ordinary SDR local grades; no
pixel snapshot or match-only rendering stage is returned or persisted.
"""

from __future__ import annotations

from dataclasses import dataclass
from contextvars import ContextVar
from contextlib import contextmanager
from time import perf_counter
from typing import Iterator, Literal

import numpy as np

from .adjustments import _acescg_luma, _linear_luma, apply_adjustments
from .color import acescg_to_linear_srgb, linear_srgb_to_acescg
from .color_context import RenderColorContext
from .finishing import apply_geometry, geometry_output_dimensions
from .local_adjustments import _apply_local_grade
from .models import (
    AdjustmentState,
    ColorGradingAdjustments,
    DetailAdjustments,
    LocalAdjustment,
    LocalGrade,
    PreviewKind,
    SDRAdjustments,
    SDRMatchQualityMetrics,
)
from .sdr_gamut import compress_to_srgb_gamut, linear_srgb_to_oklab
from .sdr_match_inputs import match_spatial_mask, render_match_candidate, render_match_target, reuse_match_render_inputs
from .sdr_match_remote import RemoteCandidateBridge, RemoteCandidateUnavailable
from .sdr_match_tone import PictureToneFit


# Match-only placement. Ordinary generated SDR and saved recipes are unchanged.
MATCH_REFERENCE_WHITE = np.float32(0.985)
MATCH_SHOULDER_START = np.float32(0.75)
MATCH_SHOULDER_WIDTH = np.float32(1.0) - MATCH_SHOULDER_START
MATCH_ANALYSIS_EDGE = 384
MatchSection = Literal["whole", "tone", "highlight"]
MATCH_REVIEW_P95_LUMA_LIMIT = 0.06


_MATCH_TIMING: ContextVar[dict[str, object] | None] = ContextVar("sdr_match_timing", default=None)
# Set while the page's GPU renders this fit's candidates (sdr_match_remote).
_MATCH_REMOTE: ContextVar[RemoteCandidateBridge | None] = ContextVar("sdr_match_remote", default=None)


@contextmanager
def _match_stage(name: str) -> Iterator[None]:
    timing = _MATCH_TIMING.get()
    previous = timing.get("candidate_label") if timing is not None else None
    started = perf_counter()
    if timing is not None:
        timing["candidate_label"] = name
    try:
        yield
    finally:
        if timing is not None:
            stages = timing.setdefault("stage_ms", {})
            stages[name] = round(float(stages.get(name, 0.0)) + (perf_counter() - started) * 1000.0, 3)
            timing["candidate_label"] = previous


class SDRMatchMaterializationError(ValueError):
    """Raised when a visible SDR recipe cannot safely represent the target."""


@dataclass(frozen=True)
class MaterializedSDRMatch:
    adjustments: AdjustmentState
    local_adjustments: list[LocalAdjustment]
    quality: SDRMatchQualityMetrics
    status: str
    link_fallback_reason: str | None = None


def match_uncompressed_luma(hdr_luma: np.ndarray) -> np.ndarray:
    """Place reference-relative HDR luma on SDR before the Match shoulder."""
    positive = np.maximum(np.asarray(hdr_luma, dtype=np.float32), 0.0)
    return positive / np.float32(0.18) * MATCH_REFERENCE_WHITE


def automatic_sdr_match_luma(hdr_luma: np.ndarray) -> np.ndarray:
    """Keep the brighter main tones linear, then roll off toward SDR white."""
    normalized = match_uncompressed_luma(hdr_luma)
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


@reuse_match_render_inputs
def materialize_sdr_match(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    *,
    reference_white_nits: int,
    source_pixel_scale: float,
    settled_hdr: np.ndarray | None = None,
    timing: dict[str, object] | None = None,
    candidate_bridge: RemoteCandidateBridge | None = None,
    section: MatchSection = "whole",
    sdr_reference: np.ndarray | None = None,
) -> MaterializedSDRMatch:
    """Fit a temporary HDR target into normal, editable SDR controls.

    With ``candidate_bridge`` the page's GPU renders the candidates the fit
    explores.  The recipe it arrives at is then rendered and measured on the
    CPU, so quality and status are the export pipeline's.  If the page cannot
    supply a candidate, or that CPU measurement rejects the recipe, the whole
    fit runs again on the CPU exactly as it does without a bridge.
    """
    timing_token = _MATCH_TIMING.set(timing)
    materialize_started = perf_counter()
    if timing is not None:
        timing.setdefault("stage_ms", {})
        timing.setdefault("candidate_passes", {})
        timing["analysis_edge"] = MATCH_ANALYSIS_EDGE

    def run() -> MaterializedSDRMatch:
        return _materialize_sdr_match_impl(
            source,
            adjustments,
            local_adjustments,
            reference_white_nits=reference_white_nits,
            source_pixel_scale=source_pixel_scale,
            settled_hdr=settled_hdr,
            section=section,
        )

    try:
        if reference_white_nits not in {100, 203}:
            raise SDRMatchMaterializationError("SDR Match requires the app-wide 100/203-nit reference convention.")
        if settled_hdr is not None and not np.isfinite(settled_hdr).all():
            raise SDRMatchMaterializationError("The HDR analysis produced invalid values.")
        # A new Match commits the recipe the SDR controls actually edit.
        # Linked rendering reads HDR instead; disabling that link on a slider
        # change would expose a different, previously hidden SDR recipe.
        if timing is not None:
            timing["linked"] = section == "highlight" and adjustments.sdr.linked_to_hdr
        if settled_hdr is None:
            target_started = perf_counter()
            settled_hdr = render_match_target(
                source, adjustments, local_adjustments, source_pixel_scale,
                RenderColorContext(reference_white_nits),
            )
            if timing is not None:
                timing["settled_hdr_ms"] = round((perf_counter() - target_started) * 1000.0, 3)
        if not np.isfinite(settled_hdr).all():
            raise SDRMatchMaterializationError("The HDR analysis produced invalid values.")
        if candidate_bridge is None:
            return run()
        remote_token = _MATCH_REMOTE.set(candidate_bridge)
        try:
            result = run()
            if timing is not None:
                timing["candidate_renderer"] = "gpu"
            return result
        except (RemoteCandidateUnavailable, SDRMatchMaterializationError) as exc:
            if timing is not None:
                timing["gpu_candidate_fallback"] = str(exc)
                timing["gpu_attempt_ms"] = round((perf_counter() - materialize_started) * 1000.0, 3)
                timing["gpu_attempt_stage_ms"] = timing.pop("stage_ms", {})
                timing["gpu_attempt_passes"] = timing.pop("candidate_passes", {})
                timing["stage_ms"] = {}
                timing["candidate_passes"] = {}
                timing.pop("candidate_label", None)
        finally:
            _MATCH_REMOTE.reset(remote_token)
            if timing is not None:
                timing["gpu_candidates"] = candidate_bridge.rendered
                timing["gpu_candidate_wait_ms"] = round(candidate_bridge.wait_ms, 3)
            candidate_bridge.close()
        if timing is not None:
            timing["candidate_renderer"] = "cpu"
        return run()
    finally:
        if timing is not None:
            timing["materialize_total_ms"] = round((perf_counter() - materialize_started) * 1000.0, 3)
            timing.pop("candidate_label", None)
        _MATCH_TIMING.reset(timing_token)


def _materialize_sdr_match_impl(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    *,
    reference_white_nits: int,
    source_pixel_scale: float,
    settled_hdr: np.ndarray | None = None,
    section: MatchSection = "whole",
) -> MaterializedSDRMatch:
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
    with _match_stage("target_build"):
        target = build_sdr_match_target(settled_hdr)
    hdr_normalized_luma = match_uncompressed_luma(_acescg_luma(settled_hdr))
    body = hdr_normalized_luma <= MATCH_SHOULDER_START
    if target.shape[:2] != apply_geometry(source, adjustments.shared.geometry).shape[:2]:
        raise SDRMatchMaterializationError("The HDR analysis target has inconsistent geometry.")
    if not np.isfinite(target).all():
        raise SDRMatchMaterializationError("The HDR analysis produced invalid values.")

    timing = _MATCH_TIMING.get()
    with _match_stage("semantic_translation"):
        result_adjustments = adjustments.model_copy(deep=True)
        if section == "whole":
            result_adjustments.sdr = _semantic_sdr_translation(adjustments, settled_hdr)
            result_locals = _materialize_local_grades(
                source, settled_hdr, adjustments, local_adjustments, reference_white_nits
            )
        else:
            result_locals = local_adjustments
            if section == "tone":
                # Like any SDR creative edit, fitting Tone edits the independent
                # rendition. Highlight Compression alone can keep an HDR link.
                result_adjustments.sdr.linked_to_hdr = False

    def render(sdr):
        result_adjustments.sdr = sdr
        return _render_candidate(source, result_adjustments, result_locals, source_pixel_scale)

    with _match_stage("picture_tone_fit"):
        fit = PictureToneFit(target, body, render, MATCH_REVIEW_P95_LUMA_LIMIT,
                             shoulder_start=MATCH_SHOULDER_START)
        result_adjustments.sdr, trial = fit.fit(
            result_adjustments.sdr, adjustments.hdr,
            tone=section != "highlight", shoulder=section != "tone",
            reference_white_nits=reference_white_nits,
        )
        candidate = trial.pixels
        quality = _quality_metrics(target, candidate, body)

    if _MATCH_REMOTE.get() is not None:
        # Only the exact CPU render can certify a recipe. If it is unsafe, the
        # caller abandons every GPU decision and restarts the search on CPU.
        with _match_stage("cpu_certification"):
            explored = quality
            candidate = render_match_candidate(source, result_adjustments, result_locals, source_pixel_scale)
            quality = _quality_metrics(target, candidate, body)
            if timing is not None:
                timing["gpu_explored_quality"] = explored.model_dump(mode="json")
                timing["cpu_certified_quality"] = quality.model_dump(mode="json")

    # A final-output HDR shoulder can leave a slightly broader luma residual
    # than the former early-stage curve. Preserve a valid editable recipe as
    # needs_review through six percent; color retains the stricter five-percent
    # safety gate.
    if (
        not np.isfinite(candidate).all()
        or quality.p95_luma_error > MATCH_REVIEW_P95_LUMA_LIMIT
        or quality.p95_oklab_error > 0.05
    ):
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
    grading: ColorGradingAdjustments, source: ColorGradingAdjustments,
    *, source_lane: PreviewKind = PreviewKind.HDR,
) -> None:
    """Re-aim wheels between lane primaries, without highlight attenuation.

    Each lane builds its wheel direction in its own primaries and makes it
    luma-neutral with its own weights, so an identical hue number is a
    different colour in each -- up to sixteen degrees apart, and up to twice the
    strength, once the HDR tint is measured in display primaries. Copying the
    numbers across therefore does not copy the grade.  Solve instead for the
    wheel angle and saturation whose destination tint best reproduces the
    source one. SDR-to-HDR uses the inverse primaries transform directly;
    it does not divide by the forward Match shoulder's attenuation.
    """
    candidate_hues = np.arange(0.0, 360.0, 0.25, dtype=np.float32)
    forward = source_lane == PreviewKind.HDR
    source_weights = _HDR_GRADING_LUMA if forward else _SDR_GRADING_LUMA
    target_weights = _SDR_GRADING_LUMA if forward else _HDR_GRADING_LUMA
    convert = acescg_to_linear_srgb if forward else linear_srgb_to_acescg
    candidates = _grading_tint_vectors(candidate_hues, target_weights)
    energy = np.maximum(np.sum(candidates * candidates, axis=1), 1e-6)
    for name in ("shadows", "midtones", "highlights"):
        authored = getattr(source, name)
        saturation = float(authored.saturation)
        if saturation <= 1e-6:
            continue
        target = convert(
            (
                _grading_tint_vectors([authored.hue], source_weights)[0]
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


def _copy_curves(source, destination) -> None:
    for name in ("luma_curve", "red_curve", "green_curve", "blue_curve"):
        setattr(destination, name, [point.copy() for point in getattr(source, name)])


def _semantic_sdr_translation(adjustments: AdjustmentState, settled_hdr: np.ndarray) -> SDRAdjustments:
    hdr = adjustments.hdr
    sdr = SDRAdjustments(use_authored_base=False)
    sdr.color_section_enabled = hdr.color_section_enabled
    sdr.curves_section_enabled = hdr.curves_section_enabled
    _copy_curves(hdr, sdr)  # Fixed recipe, never a fit parameter.
    sdr.detail_section_enabled = hdr.detail_section_enabled
    sdr.film_look_section_enabled = hdr.film_look_section_enabled
    sdr.color_grading_section_enabled = hdr.color_grading_section_enabled
    sdr.vignette_section_enabled = hdr.vignette_section_enabled
    # A mono HDR target needs a mono SDR: the translation cannot reach grey
    # through Saturation alone once the B&W sliders reshape it (BW-01).
    sdr.black_and_white_section_enabled = hdr.black_and_white_section_enabled
    sdr.black_and_white = hdr.black_and_white.model_copy(deep=True)

    for name in (
        "white_balance_kelvin", "tint", "saturation", "vibrance",
        "highlight_desaturation", "highlight_desaturation_start", "shadow_desaturation", "shadow_desaturation_start",
        "red_hue", "red_purity", "green_hue", "green_purity",
        "blue_hue", "blue_purity", "tint_hue", "tint_purity",
    ):
        setattr(sdr, name, getattr(hdr, name))
    sdr.highlight_desaturation_start = min(hdr.highlight_desaturation_start, 0.99)
    sdr.detail = hdr.detail.model_copy(deep=True)
    sdr.vignette = hdr.vignette.model_copy(deep=True)
    sdr.film_look = hdr.film_look.model_copy(deep=True)
    sdr.hsl_section_enabled = hdr.hsl_section_enabled
    sdr.hsl = hdr.hsl.model_copy(deep=True)
    sdr.color_grading = hdr.color_grading.model_copy(deep=True)
    _translate_color_grading_wheels(sdr.color_grading, hdr.color_grading)

    luma = np.maximum(_acescg_luma(settled_hdr), 0.0)
    normalized = match_uncompressed_luma(luma)
    # Use the complete highlight population, not an extreme percentile. A
    # percentile was driven to effectively zero by a few very bright pixels,
    # which removed legitimate highlight color and film response from the SDR
    # body. Weight the shoulder derivative by the region where qualified
    # controls actually become visible.
    support_start = np.float32(0.35)
    highlight_support = np.clip((normalized - support_start) / (MATCH_SHOULDER_START - support_start), 0.0, 1.0)
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
    _translate_film_highlight_sensitivity(sdr.film_look, hdr.film_look, highlight_factor)
    return sdr


def _attenuate_highlight_qualified_controls(grading: ColorGradingAdjustments, factor: float) -> None:
    grading.highlights.saturation *= factor
    grading.highlights.luminance_ev *= factor


def _translate_film_highlight_sensitivity(target: object, source: object, factor: float) -> None:
    target.halation_amount *= max(0.50, float(np.sqrt(max(factor, 0.0))))


def _materialize_local_grades(
    source: np.ndarray,
    settled_hdr: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    reference_white_nits: float = 203.0,
) -> list[LocalAdjustment]:
    if not local_adjustments:
        return []
    hdr_luma = np.maximum(_acescg_luma(settled_hdr), 0.0)
    normalized = match_uncompressed_luma(hdr_luma)
    derivative = automatic_sdr_match_derivative(normalized)
    materialized: list[LocalAdjustment] = []
    for local in local_adjustments:
        factor = 1.0
        try:
            mask = match_spatial_mask(source, local.mask, adjustments.shared.geometry)
            weights = np.maximum(mask.astype(np.float32), 0.0)
            if weights.shape == derivative.shape and float(np.sum(weights)) > 1e-6:
                factor = float(np.sum(weights * derivative) / np.sum(weights))
        except (ValueError, FloatingPointError):
            factor = 1.0
        translated = _translate_local_grade(
            local.hdr_grade, factor, reference_white_nits=reference_white_nits,
            target_peak_nits=adjustments.hdr.highlight_compression_target_nits,
        )
        materialized.append(local.model_copy(update={"sdr_grade": translated}, deep=True))
    return materialized


def _translate_local_grade(
    hdr_grade: LocalGrade, highlight_factor: float, *,
    reference_white_nits: float = 203.0, target_peak_nits: float = 1000.0,
) -> LocalGrade:
    sdr_grade = LocalGrade(enabled=hdr_grade.enabled, highlights_center=1.75, highlights_width=3.5)
    tonal = hdr_grade.model_copy(deep=True)
    _copy_curves(sdr_grade, tonal)  # Fit only the local tone, not the copied curves.
    _copy_curves(hdr_grade, sdr_grade)
    for name in ("white_balance_kelvin", "tint", "saturation", "vibrance"):
        setattr(sdr_grade, name, getattr(hdr_grade, name))
    sdr_grade.detail = hdr_grade.detail.model_copy(deep=True)
    sdr_grade.hsl_section_enabled = hdr_grade.hsl_section_enabled
    sdr_grade.hsl = hdr_grade.hsl.model_copy(deep=True)
    sdr_grade.color_grading = hdr_grade.color_grading.model_copy(deep=True)
    _translate_color_grading_wheels(sdr_grade.color_grading, hdr_grade.color_grading)
    _attenuate_highlight_qualified_controls(sdr_grade.color_grading, highlight_factor)

    scene_values = np.concatenate(
        (np.array([0.0], dtype=np.float32), np.geomspace(1e-5, 0.18 * 64.0, 1023).astype(np.float32))
    )
    ramp = np.repeat(scene_values[None, :, None], 3, axis=2)
    tonal.hsl_section_enabled = False
    tonal.white_balance_kelvin = 6500
    tonal.tint = tonal.saturation = tonal.vibrance = 0.0
    tonal.detail = DetailAdjustments()
    tonal.color_grading.shadows.saturation = 0.0
    tonal.color_grading.midtones.saturation = 0.0
    tonal.color_grading.highlights.saturation = 0.0
    output = _apply_local_grade(
        ramp, tonal, PreviewKind.HDR, reference_white_nits=reference_white_nits,
        target_peak_nits=target_peak_nits,
    )
    input_sdr = automatic_sdr_match_luma(scene_values)
    output_sdr = automatic_sdr_match_luma(np.maximum(_acescg_luma(output)[0], 0.0))
    _fit_local_tonal_controls(sdr_grade, input_sdr, output_sdr)
    # A local supported only by specular pixels must not reappear as a broad SDR
    # adjustment. Preserve mixed/body masks, but smoothly neutralize tone when
    # the mask-weighted shoulder derivative says no editable SDR body remains.
    tonal_strength = float(np.clip((highlight_factor - 0.02) / 0.48, 0.0, 1.0))
    tonal_strength = tonal_strength * tonal_strength * (3.0 - 2.0 * tonal_strength)
    for name in ("exposure", "highlights", "midtones", "shadows", "blacks", "whites", "contrast"):
        setattr(sdr_grade, name, float(getattr(sdr_grade, name) * tonal_strength))
    return sdr_grade


def _fit_local_tonal_controls(grade: LocalGrade, source_luma: np.ndarray, target_luma: np.ndarray) -> None:
    source = np.asarray(source_luma, dtype=np.float32)
    target = np.asarray(target_luma, dtype=np.float32)
    valid = np.isfinite(source) & np.isfinite(target) & (source > 1e-5) & (target > 1e-5)
    if np.count_nonzero(valid) < 16:
        return
    source = source[valid]
    target = target[valid]
    ramp = np.repeat(source[None, :, None], 3, axis=-1)
    trial = LocalGrade(highlights_center=1.75, highlights_width=3.5)
    weights = np.maximum(automatic_sdr_match_derivative(source), 0.05)

    def loss():
        rendered = _apply_local_grade(ramp, trial, PreviewKind.SDR)[0, :, 0]
        linear = np.abs(rendered - target)
        log = np.abs(np.log2(np.maximum(rendered, 1e-6) / target))
        return float(np.mean(weights * (linear + .05 * log)))

    best = loss()
    for scale in (1.0, .5, .2, .1, .05):
        for name, step in (("exposure", .5), ("contrast", .25), ("blacks", 50),
                           ("shadows", 50), ("midtones", 50), ("highlights", 50), ("whites", 50)):
            previous = float(getattr(trial, name))
            selected = previous
            bound = 8 if name == "exposure" else 2 if name == "contrast" else 100
            for direction in (-1, 1):
                value = float(np.clip(previous + direction * step * scale, -bound, bound))
                setattr(trial, name, value)
                measured = loss()
                if measured < best:
                    best, selected = measured, value
            setattr(trial, name, selected)
    for name in ("exposure", "contrast", "blacks", "shadows", "midtones", "highlights", "whites"):
        setattr(grade, name, getattr(trial, name))
    grade.contrast_pivot = trial.contrast_pivot


def _render_candidate(
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    source_pixel_scale: float,
) -> np.ndarray:
    timing = _MATCH_TIMING.get()
    label = str(timing.get("candidate_label") or "unclassified") if timing is not None else ""
    started = perf_counter()
    bridge = _MATCH_REMOTE.get()
    try:
        if bridge is not None:
            return _render_remote_candidate(bridge, source, adjustments, local_adjustments, source_pixel_scale)
        return render_match_candidate(source, adjustments, local_adjustments, source_pixel_scale)
    finally:
        if timing is not None:
            passes = timing.setdefault("candidate_passes", {})
            entry = passes.setdefault(label, {"count": 0, "total_ms": 0.0})
            entry["count"] = int(entry["count"]) + 1
            entry["total_ms"] = round(float(entry["total_ms"]) + (perf_counter() - started) * 1000.0, 3)


def _render_remote_candidate(
    bridge: RemoteCandidateBridge,
    source: np.ndarray,
    adjustments: AdjustmentState,
    local_adjustments: list[LocalAdjustment],
    source_pixel_scale: float,
) -> np.ndarray:
    """One candidate from the page's GPU, in the CPU candidate's frame and units."""
    width, height = geometry_output_dimensions(source.shape[1], source.shape[0], adjustments.shared.geometry)
    payload: dict[str, object] = {
        "adjustments": adjustments.model_dump(mode="json"),
        "long_edge": MATCH_ANALYSIS_EDGE,
    }
    # The locals are fixed once translated; send them when they change, not
    # with every trial.
    if bridge.locals_identity != id(local_adjustments):
        payload["local_adjustments"] = [item.model_dump(mode="json") for item in local_adjustments]
        bridge.locals_identity = id(local_adjustments)
    candidate = bridge.render(payload, int(width), int(height))
    timing = _MATCH_TIMING.get()
    if timing is not None and timing.get("verify_gpu_candidates"):
        reference = render_match_candidate(source, adjustments, local_adjustments, source_pixel_scale)
        difference = np.abs(_linear_luma(candidate) - _linear_luma(reference))
        timing.setdefault("gpu_candidate_parity", []).append({
            "stage": timing.get("candidate_label"),
            "luma_abs_median": float(np.median(difference)),
            "luma_abs_p99": float(np.percentile(difference, 99.0)),
            "luma_abs_max": float(np.max(difference)),
            "rgb_abs_max": float(np.max(np.abs(candidate - reference))),
            **_parity_diagnostics(candidate, reference),
            "gpu_anchor": bridge.last_anchor,
            "cpu_anchor": _cpu_sdr_anchor(source, adjustments),
        })
    return candidate


def _cpu_sdr_anchor(source: np.ndarray, adjustments: AdjustmentState) -> float | None:
    """The shoulder peak the CPU candidate measures on its own frame (diagnostic only)."""
    from .adjustments import sdr_highlight_stage_input, sdr_highlight_peak_signal

    signal = sdr_highlight_peak_signal(
        sdr_highlight_stage_input(apply_geometry(source, adjustments.shared.geometry), adjustments, authored_reference=False), adjustments.sdr
    )
    if signal is None or not signal.size:
        return None
    robust = adjustments.sdr.highlight_compression_peak_measurement == "robust"
    return float(np.quantile(signal, 0.9999) if robust else np.max(signal))


def _parity_diagnostics(candidate: np.ndarray, reference: np.ndarray) -> dict[str, object]:
    """Where a GPU candidate departs from the CPU one (diagnostic only)."""
    gpu = _linear_luma(candidate)
    cpu = _linear_luma(reference)
    far = np.abs(gpu - cpu) > 0.02
    return {
        "far_fraction": float(np.mean(far)),
        "far_gpu_mean": float(np.mean(gpu[far])) if far.any() else None,
        "far_cpu_mean": float(np.mean(cpu[far])) if far.any() else None,
        "gpu_max": float(np.max(gpu)),
        "cpu_max": float(np.max(cpu)),
        "shape": list(gpu.shape),
    }


def _quality_metrics(
    target: np.ndarray,
    candidate: np.ndarray,
    body: np.ndarray | None = None,
) -> SDRMatchQualityMetrics:
    target_luma, target_lab, body = _quality_target(target, body)
    candidate_luma = _linear_luma(candidate)
    luma_error = np.abs(candidate_luma - target_luma)[body]
    candidate_lab = linear_srgb_to_oklab(np.clip(candidate, 0.0, 1.0))
    oklab_error = np.linalg.norm(candidate_lab - target_lab, axis=-1)[body]
    return SDRMatchQualityMetrics(
        median_luma_error=float(np.median(luma_error)),
        p95_luma_error=float(np.percentile(luma_error, 95.0)),
        median_oklab_error=float(np.median(oklab_error)),
        p95_oklab_error=float(np.percentile(oklab_error, 95.0)),
    )


# One fit measures every candidate against the same target and selection, so
# the target's half of the metric is computed once. The entry holds the arrays
# it was built from and is used only for those exact objects.
_QUALITY_TARGET: tuple[np.ndarray, np.ndarray | None, np.ndarray, np.ndarray, np.ndarray] | None = None


def _quality_target(
    target: np.ndarray, body: np.ndarray | None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    global _QUALITY_TARGET
    cached = _QUALITY_TARGET
    if cached is not None and cached[0] is target and cached[1] is body:
        return cached[2], cached[3], cached[4]
    target_luma = _linear_luma(target)
    if body is None:
        selection = target_luma <= MATCH_SHOULDER_START
    else:
        selection = np.asarray(body, dtype=bool)
        if selection.shape != target_luma.shape:
            raise ValueError("SDR Match quality selection must match the rendered image geometry.")
    # OKLab's cube-root toe makes minute linear values look numerically large:
    # mapping 0.0002 to display black is roughly a 0.058 Lab distance despite
    # being below the useful SDR grading floor. Keep the safety metric focused
    # on visible body tones rather than letting sub-0.1% patches dominate P95.
    selection = selection & (target_luma >= np.float32(0.0008))
    if not np.any(selection):
        selection = np.ones_like(target_luma, dtype=bool)
    target_lab = linear_srgb_to_oklab(np.clip(target, 0.0, 1.0))
    _QUALITY_TARGET = (target, body, target_luma, target_lab, selection)
    return target_luma, target_lab, selection


def _highlight_order_is_safe(settled_hdr: np.ndarray, candidate: np.ndarray) -> bool:
    source_luma = np.maximum(_acescg_luma(settled_hdr), 0.0)
    normalized = match_uncompressed_luma(source_luma)
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
